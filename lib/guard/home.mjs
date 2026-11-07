/**
 * Where the host guard keeps its secrets, and how they come into being.
 *
 *   ~/.coding/guard/                  0700, host only — NEVER mounted anywhere
 *     signing-key.pem                 Ed25519 private key (0600): signs grants
 *     approver.token                  bearer token (0600): approves / denies
 *     audit.jsonl                     hash-chained audit log
 *     state.json                      pending requests + live grants
 *     public/                         the ONLY part the agent box sees (ro mount)
 *       guard-public.pem              verifies grants
 *       guard.json                    { url } the in-box hook asks — from here, not
 *                                     from the env, which the agent controls
 *
 * Why here and not under the data home: the data home is bind-mounted read-write
 * into coding-services, whose code an agent can edit and restart. ~/.coding
 * itself is mounted nowhere, and scripts/agent-box.mjs refuses a workspace that
 * contains this directory.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1, item 2).
 */

import { generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 3035;

export function guardHome(env = process.env, home = os.homedir()) {
  return path.resolve(env.CODING_GUARD_HOME || path.join(home, '.coding', 'guard'));
}

export function guardPaths(dir = guardHome()) {
  return {
    dir,
    signingKey: path.join(dir, 'signing-key.pem'),
    token: path.join(dir, 'approver.token'),
    audit: path.join(dir, 'audit.jsonl'),
    state: path.join(dir, 'state.json'),
    publicDir: path.join(dir, 'public'),
    publicKey: path.join(dir, 'public', 'guard-public.pem'),
    endpoint: path.join(dir, 'public', 'guard.json'),
  };
}

/** How the box reaches this daemon (Docker Desktop and Linux --add-host alike). */
export function boxGuardUrl(port) {
  return `http://host.docker.internal:${port}`;
}

/** Publish the endpoint next to the public key; rewritten only when it changes. */
export function writeGuardEndpoint(paths, port) {
  const text = `${JSON.stringify({ url: boxGuardUrl(port) })}\n`;
  if (fs.existsSync(paths.endpoint) && fs.readFileSync(paths.endpoint, 'utf8') === text) return;
  fs.writeFileSync(paths.endpoint, text, { mode: 0o644 });
}

export function guardPort(env = process.env) {
  const n = Number(env.CODING_GUARD_PORT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PORT;
}

/** Write a file only if absent, with `mode`, atomically (no half-written key). */
function createExclusive(file, content, mode) {
  try {
    fs.writeFileSync(file, content, { mode, flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

/**
 * Create the directory, key pair and approver token on first use; on later
 * runs re-derive the public key from the private one (a replaced public file
 * cannot make the box trust a different signer) and tighten modes.
 */
export function ensureGuardHome(paths = guardPaths()) {
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.publicDir, { recursive: true, mode: 0o755 });
  if (process.platform !== 'win32') fs.chmodSync(paths.dir, 0o700);

  if (!fs.existsSync(paths.signingKey)) {
    const { privateKey } = generateKeyPairSync('ed25519');
    createExclusive(paths.signingKey, privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600);
  }
  createExclusive(paths.token, `${randomBytes(32).toString('hex')}\n`, 0o600);
  if (process.platform !== 'win32') {
    fs.chmodSync(paths.signingKey, 0o600);
    fs.chmodSync(paths.token, 0o600);
  }

  const privatePem = fs.readFileSync(paths.signingKey, 'utf8');
  const publicPem = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' });
  if (!fs.existsSync(paths.publicKey) || fs.readFileSync(paths.publicKey, 'utf8') !== publicPem) {
    fs.writeFileSync(paths.publicKey, publicPem, { mode: 0o644 });
  }
  return { privatePem, publicPem, token: readToken(paths) };
}

export function readToken(paths = guardPaths()) {
  return fs.readFileSync(paths.token, 'utf8').trim();
}

/** True when `dir` is `guardDir` or one of its ancestors — mounting it would expose the keys. */
export function exposesGuardHome(dir, guardDir = guardHome()) {
  const rel = path.relative(path.resolve(dir), guardDir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
