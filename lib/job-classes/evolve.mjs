/**
 * Shared job classes, P3 — members propose, one maintainer folds
 * (.planning/shared-job-classes.md, "Dedup and the class cap").
 *
 * PROPOSE (any member). The teacher reads the prompts this member's taxonomy
 * could not place — reference-set prompts it labelled `none` or the two teacher
 * passes disagreed on, and live turns labelled `none` — and proposes at most a
 * few new classes. A proposal carries a test and SYNTHETIC examples only, never
 * a prompt: every example that shares a run of words with a real prompt is
 * dropped. It is written to the member's OWN learning repo,
 * `job-classes/proposals/<team>/<member>-<time>.json`, because a teammate's
 * package repo is pull-only here; the maintainer already pulls every member's
 * repo, so that is where the fold finds it.
 *
 * FOLD (the maintainer: whoever has the package in their own checkout). Each
 * pending proposal, oldest first:
 *   1. absorb — the teacher labels its examples under the current taxonomy;
 *      most land in one class → that class already holds it, nothing changes;
 *   2. add    — distinct, and the taxonomy is under `maxClasses` → a new class;
 *   3. merge to make room — at the cap, the two classes the teacher confuses
 *      most in the maintainer's reference set are merged (the one holding more
 *      prompts survives, the teacher writes one test for both, the other is
 *      RETIRED with `mergedInto`, a tombstone that keeps its old labels
 *      resolvable), then the proposal is added; with no pair close enough the
 *      proposal is rejected;
 *   4. stability — before anything is written, a sample of reference prompts
 *      is labelled under the old and the new taxonomy; below kappa 0.7 on the
 *      classes the fold did not touch, the new version is refused.
 * A change is one version bump with a CHANGELOG line per decision, written
 * with comments kept, committed locally. Every decision (absorbed and rejected
 * too) lands in `job-classes/folded.json`, so no proposal is folded twice.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { CODING_DIR, readRegistry } from '../history/repo-link.mjs';
import { isHarnessNoise } from './noise.mjs';
import { projectsOfTeams } from '../teams/scope.mjs';
import { sharedRoot } from '../teams/shared.mjs';
import {
  CHANGELOG_FILE, CODING_ROOT, PACKAGE_DIR, TAXONOMY_FILE,
  checkoutOf, defaultRepoFor, validateTaxonomy,
} from './package.mjs';

const require = createRequire(import.meta.url);
const YAML = require('yaml');
const teamsConfig = require('../teams/config.cjs');
const dataHome = require('../paths/data-home.cjs');

export const DEFAULT_MAX_CLASSES = 16;
export const STABILITY_KAPPA = 0.7;
const REQUEST_CHARS = 500;
/** Gap prompts shown to the teacher per proposal run. */
const MAX_GAPS = 40;
/** A proposed class must hold at least this many of the gaps it was shown. */
const MIN_SUPPORT = 3;
/** A shared run of this many words between an example and a real prompt drops the example. */
const SHINGLE = 6;
/** Teacher disagreements between two classes before they count as close enough to merge. */
const MIN_CONFUSION = 3;
const LEDGER_FILE = 'folded.json';
const PROPOSALS_DIR = 'proposals';

// ── taxonomy as data ─────────────────────────────────────────────────────────

/** Plain view of a taxonomy file: what classification and the fold need. */
export function readTaxonomy(file) {
  const raw = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  const classes = (raw.classes || []).map((c) => ({ ...c, id: String(c.id) }));
  return {
    name: raw.name || path.basename(file).replace(/\.ya?ml$/, ''),
    version: raw.version ?? 0,
    maxClasses: Number.isInteger(raw.maxClasses) ? raw.maxClasses : DEFAULT_MAX_CLASSES,
    none: String(raw.none || ''),
    precedence: (raw.precedence || []).map(String),
    prompt: String(raw.prompt || ''),
    groups: raw.groups || [],
    classes,
    retired: (raw.retired || []).map((r) => ({ ...r, id: String(r.id), mergedInto: String(r.mergedInto) })),
  };
}

/** A label made under any earlier version → the class that holds it now (follows mergedInto). */
export function resolveClass(tax, id) {
  const merged = new Map(tax.retired.map((r) => [r.id, r.mergedInto]));
  let cur = id;
  for (let i = 0; i < 32 && merged.has(cur); i++) cur = merged.get(cur);
  return cur;
}

/** The request the student and teacher see — rapid-llm-proxy's renderRequest, kept in step. */
export function renderRequest(tax, text) {
  const catalogue = tax.classes.map((c) => [`- ${c.id}: ${c.test}`,
    ...(c.examples || []).map((e) => `    e.g. ${e}`)].join('\n')).join('\n');
  const fill = { none: tax.none, precedence: tax.precedence.join(' > '), catalogue, request: String(text).slice(0, REQUEST_CHARS).replace(/\s+/g, ' ') };
  return [{ role: 'user', content: tax.prompt.replace(/\{(none|precedence|catalogue|request)\}/g, (_, k) => fill[k]) }];
}

export function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const ob = s.indexOf('{');
  const ar = s.indexOf('[');
  const arr = ar !== -1 && (ob === -1 || ar < ob);
  return JSON.parse(arr ? s.slice(ar, s.lastIndexOf(']') + 1) : s.slice(ob, s.lastIndexOf('}') + 1));
}

/** A model's answer → a class id, 'none', or 'invalid'. */
export function parseLabel(tax, content) {
  try {
    const got = String(parseJson(content)?.class || '').trim();
    return tax.classes.some((c) => c.id === got) ? got : got === 'none' ? 'none' : 'invalid';
  } catch { return 'invalid'; }
}

export function kappa(a, b) {
  const n = a.length;
  if (!n) return null;
  const cats = [...new Set([...a, ...b])];
  let po = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) po += 1;
  po /= n;
  let pe = 0;
  for (const c of cats) pe += (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** The teacher, through rapid-llm-proxy (CLAUDE.md: URL precedence, POST /api/complete). */
export function proxyTeacher({ process: proc = 'job-class-teacher' } = {}) {
  const base = (process.env.RAPID_LLM_PROXY_URL || process.env.LLM_CLI_PROXY_URL || process.env.LLM_PROXY_URL
    || `http://localhost:${process.env.LLM_CLI_PROXY_PORT ?? '12435'}`).replace(/\/$/, '');
  return async (messages) => {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`${base}/api/complete`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ process: proc, messages, complexity: 'high' }), signal: AbortSignal.timeout(120_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
        return (await r.json()).content;
      } catch (err) { last = err; await new Promise((res) => setTimeout(res, 2000 * (i + 1))); }
    }
    throw last;
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function labelAll(tax, texts, complete) {
  return pool(texts, 6, async (t) => {
    try { return parseLabel(tax, await complete(renderRequest(tax, t))); } catch { return 'invalid'; }
  });
}

// ── where things are ─────────────────────────────────────────────────────────

/** The team's package and whether this machine may fold it (only from its own checkout). */
export function teamPackage(team, opts = {}) {
  const teamsDoc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  const t = teamsDoc.teams[team];
  if (!t) throw new Error(`no team '${team}'`);
  if (!t.jobClasses) throw new Error(`team '${team}' shares no job classes (coding job-classes init --team ${team})`);
  const where = checkoutOf(t.jobClasses.repo, opts);
  const dir = path.join(where.dir, PACKAGE_DIR);
  return { repo: t.jobClasses.repo, state: where.state, checkout: where.dir, dir, file: path.join(dir, TAXONOMY_FILE) };
}

/** Every learning checkout here: the member's own and the pull-only clones. */
function allCheckouts(opts = {}) {
  const out = new Set();
  try {
    for (const [repo, entry] of Object.entries(readRegistry(opts).repos || {})) {
      if (entry?.remote) out.add(path.join(repo, CODING_DIR));
    }
  } catch { /* none */ }
  for (const r of opts.repos || []) if (r.learningRemote) out.add(path.join(r.hostPath || r.path, CODING_DIR));
  const root = sharedRoot(opts);
  try { for (const n of fs.readdirSync(root)) out.add(path.join(root, n)); } catch { /* none */ }
  return [...out].filter((d) => fs.existsSync(d));
}

/** Projects of a team, lowercased (reference rows name their repo by its directory). */
function teamProjects(team, opts) {
  const teamsDoc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  const { projects } = projectsOfTeams([team], { teamsDoc, repos: opts.repos, codingRoot: opts.codingRoot || CODING_ROOT });
  return new Set([...projects].map((p) => String(p).toLowerCase()));
}

/** Reference-set rows of a team's projects, from every scope folder (measure-job-classes.mjs). */
export function referenceRows(team, opts = {}) {
  const root = opts.referenceDir || path.join(dataHome.proxyDataDir(opts), PACKAGE_DIR);
  const projects = teamProjects(team, opts);
  const byId = new Map();
  let scopes = [];
  try { scopes = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* none */ }
  for (const s of scopes) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, s)).filter((f) => /^reference-.+\.jsonl$/.test(f)); } catch { continue; }
    for (const f of files) {
      for (const line of fs.readFileSync(path.join(root, s, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        if (!r?.text || !projects.has(String(r.repo || '').toLowerCase())) continue;
        byId.set(r.id, r);
      }
    }
  }
  return [...byId.values()];
}

/** Live turns labelled `none` under the team's taxonomy name (their redacted openings). */
function liveGaps(tax, team, opts) {
  const file = opts.tokenDb || dataHome.tokenUsageDb(opts);
  if (!fs.existsSync(file)) return [];
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`SELECT project, prompt_preview AS text FROM turn_job_class
      WHERE job_class = 'none' AND prompt_preview != '' AND taxonomy LIKE ?`).all(`${tax.name}-v%`);
    const projects = teamProjects(team, opts);
    return rows.filter((r) => projects.has(String(r.project).toLowerCase())).map((r) => r.text);
  } catch { return []; } finally { try { db?.close(); } catch { /* closed */ } }
}

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

/** This member, as a stable pseudonym (no user or host name in a shared repo). */
export function memberId(opts = {}) {
  return hash(`${opts.hostname || os.hostname()}:${opts.user || os.userInfo().username}`).slice(0, 10);
}

function words(s) { return String(s).toLowerCase().match(/[a-z0-9]+/g) || []; }
function shingles(s) {
  const w = words(s);
  const out = new Set();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return out;
}

// ── propose ──────────────────────────────────────────────────────────────────

/** The teacher's instruction for proposals. Names after modules were the failure at cap 16–24 (P0). */
export function proposeMessages(tax, gaps, max) {
  const catalogue = tax.classes.map((c) => `- ${c.id}: ${c.test}`).join('\n');
  const groups = tax.groups.map((g) => g.id).join(', ') || '(none)';
  const listed = gaps.map((g, i) => `[${i}] ${String(g).slice(0, 300).replace(/\s+/g, ' ')}`).join('\n');
  return [{ role: 'user', content: [
    'A team labels each prompt it gives a coding agent with a job class. These are its classes:',
    catalogue, '',
    'The prompts below were NOT placed in any class (labelled none, or labelled two different ways).',
    listed, '',
    `Propose at most ${max} NEW classes that would each hold a clear share of these prompts.`,
    'A class is a KIND OF JOB the agent is asked to do: what it has to do, never a module, repo, product, tool or topic.',
    'Propose nothing for prompts that are noise, chit-chat or that an existing class should hold: [] is a good answer.',
    `For each class: id (lowercase-hyphenated), label, test (one sentence: when a prompt belongs), group (one of: ${groups}, or null),`,
    'covers (the [index] of every listed prompt it holds), and examples: 3 short prompts YOU write fresh.',
    'Examples must not copy or closely paraphrase the listed prompts, and must contain no names, paths, URLs or project names.',
    'Answer with JSON only: {"proposals":[{"id":"","label":"","test":"","group":null,"covers":[],"examples":["","",""]}]}',
  ].join('\n') }];
}

/**
 * Ask the teacher for new classes from this member's gaps; write the proposal
 * file into the member's own learning repo. Returns what was (or would be) written.
 */
export async function propose({ team, complete, max = 3, dryRun = false, ...opts }) {
  const id = String(team || '').toLowerCase();
  const pkg = teamPackage(id, opts);
  if (pkg.state === 'missing' || !fs.existsSync(pkg.file)) throw new Error(`team ${id}'s package is not on this machine (coding job-classes join, then coding sync pull)`);
  const tax = readTaxonomy(pkg.file);
  const tag = `${tax.name}-v${tax.version}`;

  const ref = referenceRows(id, opts).filter((r) => r.class == null || r.class === 'none').map((r) => r.text);
  const gapsAll = [...new Set([...ref, ...liveGaps(tax, id, opts)].map((t) => String(t).trim()).filter((t) => t && !isHarnessNoise(t)))];
  // A stable sample: the same gaps give the same request.
  const gaps = gapsAll.map((t) => ({ t, h: hash(t) })).sort((a, b) => (a.h < b.h ? -1 : 1)).slice(0, MAX_GAPS).map((x) => x.t);
  const result = { team: id, taxonomy: tag, gapsSeen: gaps.length, gapsAvailable: gapsAll.length, proposals: [], dropped: [], file: null };
  if (gaps.length < MIN_SUPPORT) return { ...result, note: `only ${gaps.length} unplaced prompts: nothing to propose from` };

  const raw = parseJson(await complete(proposeMessages(tax, gaps, max)));
  const proposed = Array.isArray(raw) ? raw : Array.isArray(raw?.proposals) ? raw.proposals : [];
  const real = gapsAll.map(shingles);
  const active = new Set(tax.classes.map((c) => c.id));
  const groupIds = new Set(tax.groups.map((g) => String(g.id)));
  for (const p of proposed.slice(0, max)) {
    const cid = String(p?.id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const covers = [...new Set((p?.covers || []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < gaps.length))];
    const examples = (p?.examples || []).map(String).filter((e) => {
      const sh = shingles(e);
      return e.trim() && !real.some((r) => [...sh].some((x) => r.has(x)));
    });
    const why = !cid ? 'no id'
      : active.has(cid) ? `id ${cid} is already a class`
        : typeof p?.test !== 'string' || !p.test.trim() ? 'no test'
          : covers.length < MIN_SUPPORT ? `holds ${covers.length} of the prompts (needs ${MIN_SUPPORT})`
            : examples.length < 2 ? 'fewer than 2 examples left after dropping ones that copy a prompt' : null;
    if (why) { result.dropped.push({ id: cid || null, reason: why }); continue; }
    result.proposals.push({
      id: cid, label: String(p.label || cid), test: p.test.trim(), group: p.group && groupIds.has(String(p.group)) ? String(p.group) : null,
      examples: examples.slice(0, 3), support: covers.length,
    });
  }
  if (!result.proposals.length || dryRun) return result;

  // The member's OWN learning repo — never the pull-only package clone: the
  // package's own checkout when this member is the maintainer, else the repo
  // they are working in, else the first of the team's repos that is theirs.
  const own = opts.ownRepo || (pkg.state === 'linked' ? pkg.repo : defaultRepoFor(id, opts));
  const mine = own && checkoutOf(own, opts);
  if (!mine || mine.state !== 'linked') throw new Error(`no learning repo of team ${id} is your own checkout here: a proposal needs one to live in`);
  const member = memberId(opts);
  const stamp = new Date(opts.now ? opts.now() : Date.now()).toISOString().replace(/[-:]/g, '').slice(0, 13);
  const dir = path.join(mine.dir, PACKAGE_DIR, PROPOSALS_DIR, id);
  const file = path.join(dir, `${member}-${stamp}.json`);
  const doc = {
    schema: 1, team: id, taxonomy: tag, member, createdAt: new Date(opts.now ? opts.now() : Date.now()).toISOString(),
    gapsSeen: gaps.length,
    proposals: result.proposals.map((p, i) => ({ key: `${member}-${stamp}-${i}`, ...p })),
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  const commit = opts.commit ? opts.commit(mine.dir, `coding: job-class proposal for team ${id} (${doc.proposals.map((p) => p.id).join(', ')})`) : null;
  return { ...result, proposals: doc.proposals, file, commit };
}

// ── fold ─────────────────────────────────────────────────────────────────────

function readLedger(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, LEDGER_FILE), 'utf8')); } catch { return { folded: {} }; }
}

/** Every proposal for the team in any checkout here, not yet folded, oldest first. */
export function pendingProposals(team, opts = {}) {
  const pkg = opts.pkg || teamPackage(team, opts);
  const ledger = readLedger(pkg.dir);
  const out = new Map();
  for (const checkout of allCheckouts(opts)) {
    const dir = path.join(checkout, PACKAGE_DIR, PROPOSALS_DIR, team);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { continue; }
    for (const f of files) {
      let doc;
      try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      for (const p of doc.proposals || []) {
        if (!p?.key || ledger.folded[p.key] || out.has(p.key)) continue;
        out.set(p.key, { ...p, member: doc.member, createdAt: doc.createdAt, file: path.join(dir, f) });
      }
    }
  }
  return [...out.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.key.localeCompare(b.key));
}

/** Teacher disagreements per class pair in the reference set (current ids), most first. */
export function confusedPairs(tax, rows) {
  const active = new Set(tax.classes.map((c) => c.id));
  const counts = new Map();
  for (const r of rows) {
    const [a, b] = (r.teacher || []).map((x) => resolveClass(tax, String(x)));
    if (!a || !b || a === b || !active.has(a) || !active.has(b)) continue;
    const k = [a, b].sort().join('|');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts].map(([k, n]) => ({ pair: k.split('|'), n })).sort((x, y) => y.n - x.n || x.pair.join().localeCompare(y.pair.join()));
}

export function mergeMessages(a, b) {
  return [{ role: 'user', content: [
    'Two job classes are merged into one. Write ONE test (one or two sentences) that admits every prompt either test admits,',
    'and nothing else. Keep the id of the first. Answer with JSON only: {"test":""}',
    `- ${a.id}: ${a.test}`, `- ${b.id}: ${b.test}`,
  ].join('\n') }];
}

/**
 * Fold every pending proposal into a new taxonomy version.
 *
 * @param {{team: string, complete: Function, dryRun?: boolean, sample?: number, commit?: Function}} args
 * @returns the decisions, the stability check, and what was written
 */
export async function fold({ team, complete, dryRun = false, sample = 40, ...opts }) {
  const id = String(team || '').toLowerCase();
  const pkg = teamPackage(id, opts);
  if (pkg.state !== 'linked') throw new Error(`team ${id}'s package is in ${pkg.repo}, which is not your own checkout here (${pkg.state}): only its maintainer folds`);
  const before = readTaxonomy(pkg.file);
  const pending = pendingProposals(id, { ...opts, pkg });
  const result = { team: id, from: `${before.name}-v${before.version}`, to: null, decisions: [], stability: null, written: false };
  if (!pending.length) return { ...result, note: 'no pending proposals' };

  const rows = referenceRows(id, opts);
  const work = JSON.parse(JSON.stringify(before));
  const added = new Set();
  const touched = new Set(); // survivors of a merge: their test changed
  const retiredNow = [];

  for (const p of pending) {
    const labels = await labelAll(work, p.examples || [], complete);
    const counts = new Map();
    for (const l of labels) if (l !== 'none' && l !== 'invalid') counts.set(l, (counts.get(l) || 0) + 1);
    const [top, n] = [...counts].sort((x, y) => y[1] - x[1])[0] || [null, 0];
    if (top && n * 2 > labels.length) { result.decisions.push({ key: p.key, id: p.id, decision: 'absorb', into: top, labels }); continue; }
    if (work.classes.some((c) => c.id === p.id) || work.retired.some((r) => r.id === p.id)) {
      result.decisions.push({ key: p.key, id: p.id, decision: 'reject', reason: `id ${p.id} is taken (a current or retired class)`, labels });
      continue;
    }
    if (work.classes.length >= work.maxClasses) {
      const pair = confusedPairs(work, rows).find((x) => x.n >= MIN_CONFUSION && !x.pair.some((c) => added.has(c)));
      if (!pair) {
        result.decisions.push({ key: p.key, id: p.id, decision: 'reject', reason: `at the cap of ${work.maxClasses} and no two classes are confused often enough to merge`, labels });
        continue;
      }
      const size = (c) => rows.filter((r) => r.class != null && resolveClass(work, String(r.class)) === c).length;
      const [a, b] = pair.pair.slice().sort((x, y) => size(y) - size(x) || x.localeCompare(y));
      const ca = work.classes.find((c) => c.id === a);
      const cb = work.classes.find((c) => c.id === b);
      let test = `${ca.test} ${cb.test}`;
      try { const j = parseJson(await complete(mergeMessages(ca, cb))); if (typeof j?.test === 'string' && j.test.trim()) test = j.test.trim(); } catch { /* the joined tests stand */ }
      ca.test = test;
      ca.examples = [...(ca.examples || []), ...(cb.examples || [])].slice(0, 4);
      work.classes = work.classes.filter((c) => c.id !== b);
      work.precedence = work.precedence.filter((x) => x !== b);
      const tomb = { id: b, mergedInto: a, version: before.version + 1, test: cb.test };
      work.retired.push(tomb);
      retiredNow.push(tomb);
      touched.add(a);
      result.decisions.push({ key: null, decision: 'merge', into: a, retired: b, confusions: pair.n, reason: `to make room for ${p.id}` });
    }
    work.classes.push({ id: p.id, ...(p.group ? { group: p.group } : {}), test: p.test, examples: (p.examples || []).slice(0, 2) });
    work.precedence.push(p.id);
    added.add(p.id);
    result.decisions.push({ key: p.key, id: p.id, decision: 'add', support: p.support, labels });
  }

  const changed = added.size > 0 || retiredNow.length > 0;
  work.version = before.version + (changed ? 1 : 0);
  result.to = `${work.name}-v${work.version}`;

  if (changed) {
    // Stability: the same prompts under the old and the new taxonomy, compared
    // on the classes this fold did not touch.
    const picked = rows.filter((r) => r.class != null && r.class !== 'none')
      .map((r) => ({ r, h: hash(`stability:${r.id}`) })).sort((x, y) => (x.h < y.h ? -1 : 1)).slice(0, sample).map((x) => x.r.text);
    const [old, neu] = [await labelAll(before, picked, complete), await labelAll(work, picked, complete)];
    const changedIds = new Set([...added, ...touched, ...retiredNow.map((r) => r.id)]);
    const a = [];
    const b = [];
    for (let i = 0; i < picked.length; i++) {
      const o = resolveClass(work, old[i]);
      if (changedIds.has(old[i]) || changedIds.has(o) || changedIds.has(neu[i]) || old[i] === 'invalid' || neu[i] === 'invalid') continue;
      a.push(o); b.push(neu[i]);
    }
    const k = kappa(a, b);
    result.stability = { sample: picked.length, compared: a.length, kappa: k, gate: STABILITY_KAPPA };
    if (a.length < 10 || k === null || k < STABILITY_KAPPA) {
      result.refused = a.length < 10 ? `only ${a.length} prompts to compare (need 10)` : `kappa ${k?.toFixed(2)} on the unchanged classes is below ${STABILITY_KAPPA}: churn, not learning`;
      return result;
    }
  }
  if (dryRun) return result;

  // Write: taxonomy (comments kept), CHANGELOG, ledger — then one local commit.
  const date = new Date(opts.now ? opts.now() : Date.now()).toISOString().slice(0, 10);
  if (changed) {
    const doc = YAML.parseDocument(fs.readFileSync(pkg.file, 'utf8'));
    doc.set('version', work.version);
    if (!doc.has('maxClasses')) doc.set('maxClasses', work.maxClasses);
    const prec = doc.createNode(work.precedence);
    prec.flow = true;
    doc.set('precedence', prec);
    const seq = doc.get('classes');
    for (const t of retiredNow) {
      const i = seq.items.findIndex((it) => String(it.get('id')) === t.id);
      if (i >= 0) seq.items.splice(i, 1);
    }
    for (const c of touched) {
      const it = seq.items.find((x) => String(x.get('id')) === c);
      const w = work.classes.find((x) => x.id === c);
      it.set('test', w.test);
      if (w.examples?.length) it.set('examples', doc.createNode(w.examples));
    }
    for (const c of work.classes.filter((x) => added.has(x.id))) seq.items.push(doc.createNode(c));
    if (retiredNow.length) {
      if (!doc.has('retired')) doc.set('retired', doc.createNode([]));
      for (const t of retiredNow) doc.get('retired').items.push(doc.createNode(t));
    }
    fs.writeFileSync(pkg.file, doc.toString({ lineWidth: 0 }));
    const v = validateTaxonomy(pkg.file, { requireName: true });
    if (v.errors.length) throw new Error(`the folded taxonomy does not validate (${v.errors.join('; ')}) — ${pkg.file} needs fixing by hand`);
    const lines = result.decisions.filter((d) => d.decision === 'add' || d.decision === 'merge').map((d) => (d.decision === 'add'
      ? `added ${d.id} (held ${d.support} unplaced prompts)` : `merged ${d.retired} into ${d.into} (${d.confusions} teacher disagreements)`));
    fs.appendFileSync(path.join(pkg.dir, CHANGELOG_FILE), `- v${work.version} (${date}): ${lines.join('; ')}. Stability kappa ${result.stability.kappa.toFixed(2)} on ${result.stability.compared} prompts.\n`);
  }
  const ledger = readLedger(pkg.dir);
  for (const d of result.decisions) {
    if (!d.key) continue;
    ledger.folded[d.key] = { decision: d.decision, ...(d.into ? { into: d.into } : {}), ...(d.reason ? { reason: d.reason } : {}), version: work.version, at: date };
  }
  fs.writeFileSync(path.join(pkg.dir, LEDGER_FILE), `${JSON.stringify(ledger, null, 2)}\n`);
  result.written = true;
  if (opts.commit) result.commit = opts.commit(pkg.checkout, `coding: job classes for team ${id} → ${result.to}`);
  return result;
}
