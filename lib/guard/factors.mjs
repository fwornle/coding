/**
 * The user's approval factors — what proves "this is the user, not the agent".
 *
 *   ~/.coding/guard/factors.json (0600, host only)
 *     userId        WebAuthn user handle (random, stable)
 *     credentials   enrolled authenticators: Touch ID / Windows Hello (platform),
 *                   a phone passkey (hybrid, the QR flow), a FIDO2 key (YubiKey)
 *                   — { id, publicKey (b64url COSE), counter, transports, kind, label, created }
 *     password      { salt, kdf, hash, params } or null
 *     recovery      one-time codes, hashed — { salt, kdf, hash, used }
 *     lockout       { failures, until } for password + recovery attempts
 *
 * WebAuthn credentials only hold PUBLIC keys: the private half never leaves the
 * Secure Enclave / phone / security key, so neither this file nor anything in
 * the box can produce an assertion. Passwords are typed into the host browser
 * page, never the agent's terminal.
 *
 * KDF: argon2id where Node has it (crypto.argon2Sync, Node 24.7+), else scrypt
 * — Node 22 is the supported floor, and a static argon2Sync import made every
 * guard module fail to load there. Each hash records its kdf; one without
 * (written before the tag existed) is argon2id.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1, item 3).
 */

import * as crypto from 'node:crypto';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ARGON2 = { parallelism: 1, tagLength: 32, memory: 65536, passes: 3 };
/** scrypt at the same 64 MiB as ARGON2 (N·r·128 bytes). */
export const SCRYPT = { N: 65536, r: 8, p: 1, keylen: 32, maxmem: 128 * 1024 * 1024 };
export const HAS_ARGON2 = typeof crypto.argon2Sync === 'function';
/** What new hashes use on this Node. */
export const DEFAULT_KDF = HAS_ARGON2 ? 'argon2id' : 'scrypt';
const PARAMS = { argon2id: ARGON2, scrypt: SCRYPT };
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const MIN_PASSWORD = 12;
export const RECOVERY_CODES = 10;
export const KINDS = ['platform', 'hybrid', 'security-key', 'unknown'];

export function factorsFile(dir) {
  return path.join(dir, 'factors.json');
}

export function hash(secret, salt, kdf = DEFAULT_KDF, params = PARAMS[kdf]) {
  const nonce = Buffer.from(salt, 'base64url');
  if (kdf === 'argon2id') {
    if (!HAS_ARGON2) throw new Error(`this secret was hashed with argon2id, which Node ${process.version} lacks (it needs Node 24.7 or later)`);
    return crypto.argon2Sync('argon2id', { message: String(secret), nonce, ...params }).toString('base64url');
  }
  if (kdf === 'scrypt') {
    const { keylen, ...options } = params;
    return crypto.scryptSync(String(secret), nonce, keylen, options).toString('base64url');
  }
  throw new Error(`unknown kdf '${kdf}'`);
}

function equal(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class FactorStore {
  constructor(dir, { now = () => Date.now() } = {}) {
    this.file = factorsFile(dir);
    this.now = now;
    this.data = { userId: randomBytes(32).toString('base64url'), credentials: [], password: null, recovery: [], lockout: { failures: 0, until: 0 } };
    if (fs.existsSync(this.file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    else this.save();
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Something that can approve exists (a recovery code alone does not count). */
  hasFactors() {
    return this.data.credentials.length > 0 || Boolean(this.data.password);
  }

  summary() {
    return {
      credentials: this.data.credentials.map(({ id, kind, label, created, transports }) => ({ id, kind, label, created, transports })),
      password: Boolean(this.data.password),
      recoveryLeft: this.data.recovery.filter((r) => !r.used).length,
      locked: this.lockedFor() > 0,
    };
  }

  // ── WebAuthn credentials ─────────────────────────────────────────────
  addCredential({ id, publicKey, counter = 0, transports = [], kind = 'unknown', label }) {
    if (this.data.credentials.some((c) => c.id === id)) throw new Error('credential already enrolled');
    const entry = {
      id, publicKey: Buffer.from(publicKey).toString('base64url'), counter, transports,
      kind: KINDS.includes(kind) ? kind : 'unknown', label: String(label || kind).slice(0, 60), created: this.now(),
    };
    this.data.credentials.push(entry);
    this.save();
    return entry;
  }

  credential(id) {
    const c = this.data.credentials.find((x) => x.id === id);
    return c ? { id: c.id, publicKey: Buffer.from(c.publicKey, 'base64url'), counter: c.counter, transports: c.transports } : null;
  }

  bumpCounter(id, counter) {
    const c = this.data.credentials.find((x) => x.id === id);
    if (c) { c.counter = counter; c.lastUsed = this.now(); this.save(); }
  }

  removeCredential(id) {
    const before = this.data.credentials.length;
    this.data.credentials = this.data.credentials.filter((c) => c.id !== id);
    this.save();
    return this.data.credentials.length < before;
  }

  // ── password ─────────────────────────────────────────────────────────
  setPassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    }
    const salt = randomBytes(16).toString('base64url');
    this.data.password = { salt, kdf: DEFAULT_KDF, hash: hash(password, salt), params: PARAMS[DEFAULT_KDF] };
    this.save();
  }

  clearPassword() {
    this.data.password = null;
    this.save();
  }

  // ── recovery codes ───────────────────────────────────────────────────
  /** New set; returns the plain codes ONCE. */
  newRecoveryCodes() {
    const codes = Array.from({ length: RECOVERY_CODES }, () => {
      const raw = randomBytes(8).toString('hex');
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
    });
    this.data.recovery = codes.map((code) => {
      const salt = randomBytes(16).toString('base64url');
      return { salt, kdf: DEFAULT_KDF, hash: hash(code, salt), used: false };
    });
    this.save();
    return codes;
  }

  // ── attempts that can be guessed: password and recovery code ─────────
  lockedFor() {
    return Math.max(0, (this.data.lockout?.until || 0) - this.now());
  }

  #attempt(ok) {
    if (ok) {
      this.data.lockout = { failures: 0, until: 0 };
    } else {
      const failures = (this.data.lockout?.failures || 0) + 1;
      this.data.lockout = { failures, until: failures >= MAX_FAILURES ? this.now() + LOCKOUT_MS : 0 };
      if (failures >= MAX_FAILURES) this.data.lockout.failures = 0;
    }
    this.save();
    return ok;
  }

  checkPassword(password) {
    if (this.lockedFor() > 0) throw new Error('locked after too many failed attempts');
    const p = this.data.password;
    if (!p) return false;
    const kdf = p.kdf || 'argon2id';
    return this.#attempt(equal(hash(password, p.salt, kdf, p.params || PARAMS[kdf]), p.hash));
  }

  useRecoveryCode(code) {
    if (this.lockedFor() > 0) throw new Error('locked after too many failed attempts');
    const normal = String(code || '').trim().toLowerCase();
    const hit = this.data.recovery.find((r) => !r.used && equal(hash(normal, r.salt, r.kdf || 'argon2id'), r.hash));
    if (hit) hit.used = this.now();
    return this.#attempt(Boolean(hit));
  }
}
