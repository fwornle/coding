/**
 * WebAuthn ceremonies for the host guard (enrol an authenticator, prove the
 * user is present), on top of @simplewebauthn/server.
 *
 * Every ceremony is single-use and expires in 2 minutes. What the user is
 * agreeing to — approve request X with scope Y, or unlock factor management —
 * is fixed when the challenge is issued, so a page (or anything else) cannot
 * swap the scope after the fingerprint was given.
 *
 * Relying party: rpID `localhost`, origin http://localhost:<port>. WebAuthn
 * accepts plain http only on localhost and never on an IP address, so the
 * daemon redirects 127.0.0.1 page loads to localhost.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1, item 3).
 */

import { randomBytes } from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

export const CEREMONY_TTL_MS = 2 * 60 * 1000;
export const TICKET_TTL_MS = 5 * 60 * 1000;
export const RP_ID = 'localhost';
export const RP_NAME = 'coding guard';

/** Which kind of authenticator the browser should offer first. */
const PREFERRED = { platform: 'localDevice', hybrid: 'remoteDevice', 'security-key': 'securityKey' };

export class Ceremonies {
  constructor(factors, { origins, rpID = RP_ID, now = () => Date.now(), userName = 'coding' } = {}) {
    this.factors = factors;
    this.origins = origins;
    this.rpID = rpID;
    this.now = now;
    this.userName = userName;
    this.pending = new Map();
    this.tickets = new Map();
  }

  #open(data) {
    for (const [k, v] of this.pending) if (v.expires <= this.now()) this.pending.delete(k);
    const id = randomBytes(12).toString('base64url');
    this.pending.set(id, { ...data, expires: this.now() + CEREMONY_TTL_MS });
    return id;
  }

  /** Take (and so consume) a ceremony; throws when unknown, expired or of another type. */
  #take(id, type) {
    const c = this.pending.get(id);
    this.pending.delete(id);
    if (!c || c.type !== type || c.expires <= this.now()) throw new Error('ceremony expired or unknown — start again');
    return c;
  }

  async enrollOptions({ kind = 'platform', label } = {}) {
    const excludeCredentials = this.factors.data.credentials.map((c) => ({ id: c.id, transports: c.transports }));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: this.rpID,
      userName: this.userName,
      userID: Buffer.from(this.factors.data.userId, 'base64url'),
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      preferredAuthenticatorType: PREFERRED[kind],
      timeout: CEREMONY_TTL_MS,
    });
    const id = this.#open({ type: 'enroll', challenge: options.challenge, kind, label });
    return { ceremony: id, options };
  }

  async enrollVerify(id, response) {
    const c = this.#take(id, 'enroll');
    const v = await verifyRegistrationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: this.origins, expectedRPID: this.rpID,
      requireUserVerification: true,
    });
    if (!v.verified) throw new Error('registration not verified');
    const cred = v.registrationInfo.credential;
    const kind = response.authenticatorAttachment === 'platform' ? 'platform'
      : (cred.transports || []).includes('hybrid') ? 'hybrid'
        : (cred.transports || []).some((t) => t === 'usb' || t === 'nfc') ? 'security-key' : c.kind;
    return this.factors.addCredential({
      id: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports || [],
      kind, label: c.label || kind,
    });
  }

  /** `purpose` is what a successful proof is for: { kind: 'approve', request, scope, minutes } | { kind: 'manage' } */
  async authOptions(purpose) {
    if (!this.factors.data.credentials.length) throw new Error('no authenticator enrolled');
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: this.factors.data.credentials.map((c) => ({ id: c.id, transports: c.transports })),
      userVerification: 'required',
      timeout: CEREMONY_TTL_MS,
    });
    return { ceremony: this.#open({ type: 'auth', challenge: options.challenge, purpose }), options };
  }

  /** Verify an assertion; returns the purpose it was issued for, and which credential proved it. */
  async authVerify(id, response) {
    const c = this.#take(id, 'auth');
    const credential = this.factors.credential(response?.id);
    if (!credential) throw new Error('unknown authenticator');
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: this.origins, expectedRPID: this.rpID,
      credential, requireUserVerification: true,
    });
    if (!v.verified) throw new Error('authentication not verified');
    this.factors.bumpCounter(credential.id, v.authenticationInfo.newCounter);
    return { purpose: c.purpose, credential: credential.id };
  }

  // ── management tickets: proof of a factor, spent on enrol/remove/regenerate ──
  issueTicket() {
    for (const [k, v] of this.tickets) if (v <= this.now()) this.tickets.delete(k);
    const t = randomBytes(24).toString('base64url');
    this.tickets.set(t, this.now() + TICKET_TTL_MS);
    return t;
  }

  checkTicket(t) {
    const exp = t ? this.tickets.get(t) : undefined;
    return Boolean(exp && exp > this.now());
  }
}
