#!/usr/bin/env node
/**
 * Capture at turn start: the repo a turn is about to work in, so a sampled turn
 * can later be replayed against the state it actually saw
 * (.planning/shared-job-classes.md, P4 "The loop", step 1).
 *
 * WHO STARTS IT. The LLM proxy's job-class tagger, at the first call of every
 * human turn it labels (rapid-llm-proxy proxy-bridge/turn-record.mjs) — for every
 * agent alike, since every agent's turns pass through the proxy, and before any of
 * the turn's tools can have run. It is started detached as
 * `node <this file> --worker <json>` with the turn's identity
 * {conversationKey, turnIndex, agent, project, at, replayRoot}; the proxy never
 * waits on it. The proxy knows the turn's project, not its directory: the repo is
 * the discovered repo whose project id that is (lib/teams/discover.mjs).
 *
 * WHAT IS KEPT. HEAD, the binary dirty patch, untracked files and each
 * submodule's HEAD and patch — the lib/repro/git-state.mjs primitives, nothing
 * else: no KB, no env, no prompt text (the proxy's turn record holds the prompt).
 * Git-ignored files are not captured, which is a recorded parity gap: a turn that
 * read `.data/` cannot be replayed faithfully.
 *
 * WHY IT IS CHEAP. Nothing runs between prompts: the retention sweep piggybacks on
 * a capture, at most once an hour. A machine nobody types into does no work (the
 * overnight battery drain of 2026-10-30 is why that matters).
 *
 * RETENTION. A capture is only worth keeping for a turn the replay will sample: a
 * turn of a kept class (the proxy's `job_classes.replay.keep`; answer-only by
 * default: status, explain). Once the turn is labelled, the sweep moves a
 * kept-class capture to `kept/<class>/` and deletes every other one; a capture
 * with no label after RETAIN_MS is deleted too. Kept captures and turn records
 * are capped by count, oldest first.
 *
 * Layout: <data home>/var/job-classes/replay/
 *   snapshots/<conversation>-t<turn>/   meta.json, dirty.patch, untracked/…, submodules/<n>.patch
 *   kept/<class>/<conversation>-t<turn>/
 *   turns/<conversation>-t<turn>.json   the proxy's turn records
 *   .last-sweep
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { captureGitState } from '../repro/git-state.mjs';
import { discoveredProjects } from '../teams/discover.mjs';
import { projectOfCwd } from '../lsl/token/project-of.mjs';

const require = createRequire(import.meta.url);
const dataHome = require('../paths/data-home.cjs');

const CODING_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Over these the capture is marked incomplete and the turn is not replayed: a partial tree answers a different question. */
export const CAPS = Object.freeze({
  patchBytes: 8 * 1024 * 1024,
  untrackedFiles: 2000,
  untrackedFileBytes: 2 * 1024 * 1024,
  untrackedTotalBytes: 16 * 1024 * 1024,
});
/** The answer-only classes P4 starts with (the proxy's default `replay.keep`): the outcome is the final text. */
export const DEFAULT_KEEP_CLASSES = ['status', 'explain'];
/** A capture whose turn has had this long to be labelled is decided on. Labels land within seconds. */
const DECIDE_AFTER_MS = 30 * 60 * 1000;
/** An undecided capture (no label found) is deleted after this. */
const RETAIN_MS = 6 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const MAX_KEPT = 300;

export function replayRoot(opts = {}) {
  return opts.replayRoot || path.join(dataHome.varDir(opts), 'job-classes', 'replay');
}

export function keepClasses(env = process.env) {
  const v = String(env.CODING_REPLAY_CLASSES || '').trim();
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_KEEP_CLASSES;
}

const safeId = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'unknown';

/** The file-system name of a turn: `<conversation key>-t<turn index>`, as the proxy names its record. */
export function turnName(conversationKey, turnIndex) {
  return `${safeId(conversationKey)}-t${Number(turnIndex)}`;
}

/**
 * The checkout a project id names, among the discovered repos.
 * @returns {{dir: string|null, reason: string|null}}
 */
export function repoForProject(project, opts = {}) {
  if (!project) return { dir: null, reason: 'the turn names no project' };
  const repos = opts.repos || discoveredProjects({ codingRoot: CODING_ROOT });
  const hits = [...new Set(repos.map((r) => r.path).filter((p) => projectOfCwd(p) === project))];
  if (hits.length === 1) return { dir: hits[0], reason: null };
  return { dir: null, reason: hits.length ? `project ${project} names ${hits.length} checkouts` : `no discovered repo is project ${project}` };
}

function branchOf(repoRoot) {
  const r = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 5000 });
  return !r.error && r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Capture the repo of one turn. Never throws for a repo it cannot read: that is a
 * meta.json with `complete: false` and its reasons.
 *
 * @param {{conversationKey: string, turnIndex: number, agent?: string, project: string, at?: string, repoRoot?: string}} turn
 * @returns {{dir: string, meta: object}|null}  null when the turn carries no identity
 */
export function captureTurn(turn, opts = {}) {
  if (!turn?.conversationKey || !(Number(turn.turnIndex) > 0)) return null;
  const at = turn.at || new Date().toISOString();
  const dir = path.join(replayRoot(opts), 'snapshots', turnName(turn.conversationKey, turn.turnIndex));
  fs.mkdirSync(dir, { recursive: true });
  const reasons = [];
  const found = turn.repoRoot ? { dir: turn.repoRoot, reason: null } : repoForProject(turn.project, opts);
  const repoRoot = found.dir;
  const base = { conversationKey: turn.conversationKey, turnIndex: Number(turn.turnIndex), agent: turn.agent || '', project: turn.project || '', at, repoRoot };
  if (!repoRoot) {
    const meta = { ...base, complete: false, reasons: [found.reason] };
    fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    return { dir, meta };
  }
  const git = captureGitState(repoRoot);
  if (!git.sha) reasons.push('no HEAD');

  if (git.dirtyPatch) {
    if (Buffer.byteLength(git.dirtyPatch) > CAPS.patchBytes) reasons.push(`dirty patch over ${CAPS.patchBytes} bytes`);
    else fs.writeFileSync(path.join(dir, 'dirty.patch'), git.dirtyPatch);
  }

  const untracked = git.untracked || [];
  if (untracked.length > CAPS.untrackedFiles) reasons.push(`${untracked.length} untracked files, over ${CAPS.untrackedFiles}`);
  else {
    let total = 0;
    for (const rel of untracked) {
      const src = path.join(repoRoot, rel);
      let st;
      try { st = fs.lstatSync(src); } catch { continue; }
      if (!st.isFile()) continue;
      if (st.size > CAPS.untrackedFileBytes) { reasons.push(`untracked ${rel} over ${CAPS.untrackedFileBytes} bytes`); break; }
      total += st.size;
      if (total > CAPS.untrackedTotalBytes) { reasons.push(`untracked files over ${CAPS.untrackedTotalBytes} bytes`); break; }
      const dst = path.join(dir, 'untracked', rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  const submodules = (git.submodules || []).map((s, i) => {
    if (s.dirtyPatch && Buffer.byteLength(s.dirtyPatch) <= CAPS.patchBytes) {
      fs.mkdirSync(path.join(dir, 'submodules'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'submodules', `${i}.patch`), s.dirtyPatch);
    } else if (s.dirtyPatch) reasons.push(`submodule ${s.path}: dirty patch over ${CAPS.patchBytes} bytes`);
    return { path: s.path, sha: s.sha, patch: s.dirtyPatch ? `${i}.patch` : null };
  });

  const meta = {
    ...base,
    sha: git.sha,
    branch: branchOf(repoRoot),
    untracked: untracked.length <= CAPS.untrackedFiles ? untracked : [],
    submodules,
    complete: reasons.length === 0,
    reasons,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return { dir, meta };
}

/** Every capture under snapshots/ (undecided) or kept/ (decided), with its meta. */
export function listCaptures(opts = {}) {
  const root = replayRoot(opts);
  const out = [];
  const read = (dir, state, cls = null) => {
    try { out.push({ dir, state, cls, meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) }); } catch { /* half-written or foreign */ }
  };
  const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  for (const t of ls(path.join(root, 'snapshots'))) read(path.join(root, 'snapshots', t), 'pending');
  for (const c of ls(path.join(root, 'kept'))) for (const t of ls(path.join(root, 'kept', c))) read(path.join(root, 'kept', c, t), 'kept', c);
  return out;
}

/** The capture of one turn, kept or still pending, or null. */
export function captureOf(conversationKey, turnIndex, opts = {}) {
  const name = turnName(conversationKey, turnIndex);
  return listCaptures(opts).find((c) => path.basename(c.dir) === name) || null;
}

/** The label of a turn from the token DB, or null. */
export function labelOfTurn(conversationKey, turnIndex, opts = {}) {
  const file = opts.tokenDb || dataHome.tokenUsageDb(opts);
  if (!opts.db && !fs.existsSync(file)) return null;
  const Database = opts.db ? null : require('better-sqlite3');
  const db = opts.db || new Database(file, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT job_class FROM turn_job_class WHERE conversation_key = ? AND turn_index = ?').get(conversationKey, Number(turnIndex));
    return row ? { jobClass: row.job_class } : null;
  } catch {
    return null; // no labels table yet
  } finally {
    if (!opts.db) db.close();
  }
}

/**
 * Decide on every pending capture old enough: keep it under its class, or delete it.
 * Then cap the kept captures and the turn records, oldest first.
 *
 * @param {object} o
 * @param {(meta: object) => ({jobClass: string}|null)} [o.labelOf]  capture → its turn's label
 * @param {string[]} [o.classes]
 * @param {number} [o.now]
 * @returns {{kept: number, deleted: number, waiting: number, trimmed: number}}
 */
export function sweep({ labelOf, classes = keepClasses(), now = Date.now(), ...opts } = {}) {
  const root = replayRoot(opts);
  const of = labelOf || ((meta) => labelOfTurn(meta.conversationKey, meta.turnIndex, opts));
  const stats = { kept: 0, deleted: 0, waiting: 0, trimmed: 0 };
  for (const c of listCaptures(opts).filter((x) => x.state === 'pending')) {
    const age = now - Date.parse(c.meta.at || 0);
    if (age < DECIDE_AFTER_MS) { stats.waiting += 1; continue; }
    let label = null;
    try { label = of(c.meta); } catch { label = null; }
    if (label && classes.includes(label.jobClass) && c.meta.complete) {
      const dst = path.join(root, 'kept', safeId(label.jobClass), path.basename(c.dir));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.rmSync(dst, { recursive: true, force: true });
      fs.renameSync(c.dir, dst);
      stats.kept += 1;
    } else if (label || age > RETAIN_MS) {
      fs.rmSync(c.dir, { recursive: true, force: true });
      stats.deleted += 1;
    } else stats.waiting += 1;
  }
  const max = opts.maxKept ?? MAX_KEPT;
  const kept = listCaptures(opts).filter((x) => x.state === 'kept').sort((a, b) => Date.parse(a.meta.at) - Date.parse(b.meta.at));
  for (const c of kept.slice(0, Math.max(0, kept.length - max))) {
    fs.rmSync(c.dir, { recursive: true, force: true });
    stats.trimmed += 1;
  }
  const turnsDir = path.join(root, 'turns');
  let records = [];
  try { records = fs.readdirSync(turnsDir).filter((f) => f.endsWith('.json')).map((f) => ({ f, t: fs.statSync(path.join(turnsDir, f)).mtimeMs })); } catch { /* none yet */ }
  records.sort((a, b) => a.t - b.t);
  for (const r of records.slice(0, Math.max(0, records.length - max))) {
    fs.rmSync(path.join(turnsDir, r.f), { force: true });
    stats.trimmed += 1;
  }
  return stats;
}

/** True at most once per SWEEP_EVERY_MS; stamps the time when it says yes. */
export function sweepDue(opts = {}, now = Date.now()) {
  const stamp = path.join(replayRoot(opts), '.last-sweep');
  try { if (now - fs.statSync(stamp).mtimeMs < SWEEP_EVERY_MS) return false; } catch { /* never swept */ }
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, new Date(now).toISOString());
  return true;
}

// The detached worker the proxy starts: capture, then sweep when due.
function worker(payloadJson) {
  const p = JSON.parse(payloadJson);
  const opts = p.replayRoot ? { replayRoot: p.replayRoot } : {};
  captureTurn(p, opts);
  if (sweepDue(opts)) sweep(opts);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--worker') {
  try { worker(process.argv[3]); } catch (err) { process.stderr.write(`[turn-capture] ${err.message}\n`); }
  process.exit(0);
}
