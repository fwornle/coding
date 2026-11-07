/**
 * The guard's audit log: one JSON object per line, hash-chained.
 *
 * Each entry carries `prev` (the previous entry's `hash`) and `hash` =
 * sha256(prev + canonical JSON of the entry without `hash`). Deleting,
 * reordering or editing a line breaks the chain from that point on, and
 * `verifyAudit` names the first broken line. That does not stop the host user
 * (or an unboxed agent running as them) from rewriting the whole file — it
 * makes a quiet edit of one line visible, which is what an audit log is for.
 *
 * Only one writer at a time: the daemon while it runs, a CLI fallback when it
 * does not (scripts/coding-guard.mjs `note`).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { canonicalJson } from './grants.mjs';

export const GENESIS = '0'.repeat(64);

function hashOf(prev, entry) {
  return createHash('sha256').update(prev).update(canonicalJson(entry)).digest('hex');
}

function lines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

export function lastHash(file) {
  const all = lines(file);
  if (!all.length) return GENESIS;
  try {
    return JSON.parse(all[all.length - 1]).hash || GENESIS;
  } catch {
    return GENESIS;
  }
}

/** Append one event; returns the stored entry. */
export function appendAudit(file, event, { now = Date.now(), prev = lastHash(file) } = {}) {
  const entry = { ts: new Date(now).toISOString(), ...event, prev };
  const stored = { ...entry, hash: hashOf(prev, entry) };
  fs.appendFileSync(file, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
  return stored;
}

/** { ok, entries, brokenAt } — brokenAt is the 1-based line of the first bad entry. */
export function verifyAudit(file) {
  const all = lines(file);
  let prev = GENESIS;
  for (let i = 0; i < all.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(all[i]);
    } catch {
      return { ok: false, entries: all.length, brokenAt: i + 1 };
    }
    const { hash, ...entry } = parsed;
    if (entry.prev !== prev || hashOf(prev, entry) !== hash) {
      return { ok: false, entries: all.length, brokenAt: i + 1 };
    }
    prev = hash;
  }
  return { ok: true, entries: all.length, brokenAt: null };
}

export function readAudit(file, { limit = 50 } = {}) {
  return lines(file).slice(-limit).map((l) => {
    try { return JSON.parse(l); } catch { return { unparseable: l }; }
  });
}
