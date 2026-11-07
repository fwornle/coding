/**
 * Signed override grants — what the user's approval turns into.
 *
 * The host guard daemon holds the Ed25519 private key and signs; anything in the
 * agent box holds only the public key and verifies. An agent can ASK for a
 * grant (an override request) but cannot make one: forging the signature needs
 * the key, which lives in ~/.coding/guard on the host and is mounted nowhere.
 *
 * Pure and dependency-free (node:crypto only) so the hook inside the box can
 * import it unchanged (Phase 1 item 4).
 *
 * A grant is { payload, sig } where `sig` is base64 Ed25519 over the canonical
 * JSON of `payload`:
 *   v        1
 *   id       grant id
 *   request  the override request it answers
 *   rule     constraint id, or `svc:<verb>` for a gated broker verb
 *   session  the box session it is bound to
 *   scope    'call' (one use) | 'minutes' | 'session'
 *   file     path the request named, or null (= any file)
 *   iat/exp  issued / expires, epoch ms
 */

import { createPrivateKey, createPublicKey, sign, verify, randomUUID } from 'node:crypto';

export const SCOPES = ['call', 'minutes', 'session'];
export const CALL_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_MINUTES = 240;

/** JSON with object keys sorted at every level: one byte string per value. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Expiry for a scope; throws on an unknown scope or an out-of-range duration. */
export function expiryFor(scope, { now = Date.now(), minutes } = {}) {
  if (scope === 'call') return now + CALL_TTL_MS;
  if (scope === 'session') return now + SESSION_TTL_MS;
  if (scope === 'minutes') {
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > MAX_MINUTES) {
      throw new Error(`minutes must be an integer 1..${MAX_MINUTES}`);
    }
    return now + m * 60 * 1000;
  }
  throw new Error(`unknown scope '${scope}' (one of: ${SCOPES.join(', ')})`);
}

export function signGrant(request, { scope, minutes, privatePem, now = Date.now(), id = randomUUID() }) {
  const payload = {
    v: 1,
    id,
    request: request.id,
    rule: request.rule,
    session: request.session,
    scope,
    file: request.file ?? null,
    iat: now,
    exp: expiryFor(scope, { now, minutes }),
  };
  const sig = sign(null, Buffer.from(canonicalJson(payload)), createPrivateKey(privatePem)).toString('base64');
  return { payload, sig };
}

/** True only for a well-formed grant whose signature the public key accepts. */
export function verifyGrant(grant, publicPem) {
  if (!grant || typeof grant !== 'object' || typeof grant.sig !== 'string') return false;
  const p = grant.payload;
  if (!p || p.v !== 1 || !SCOPES.includes(p.scope) || typeof p.exp !== 'number') return false;
  try {
    return verify(null, Buffer.from(canonicalJson(p)), createPublicKey(publicPem), Buffer.from(grant.sig, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Does a VERIFIED grant cover this call? Signature checking is verifyGrant's
 * job; this is only the matching, so callers must do both.
 */
export function grantCovers(grant, { rule, session, file = null, now = Date.now() }) {
  const p = grant?.payload;
  if (!p || p.exp <= now) return false;
  if (p.rule !== rule || p.session !== session) return false;
  return p.file === null || p.file === file;
}
