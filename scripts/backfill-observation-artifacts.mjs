#!/usr/bin/env node
/**
 * backfill-observation-artifacts.mjs — re-derive the Artifacts line of existing
 * observations from the transcripts they were written from.
 *
 * WHY THIS EXISTS. The Artifacts line is not the LLM's: ObservationWriter
 * overwrites it from `metadata.modifiedFiles`, which ETM's extractor derives from
 * the turn's tool calls (scripts/enhanced-transcript-monitor.js,
 * extractFileChanges + subagentFileChanges). Whatever the extractor missed reads
 * "Artifacts: none". It missed a lot — measured 2026-10-14, 62 of 201 tool-using
 * turns in this repo's last 15 transcripts had files; 83 with the current rules:
 *
 *   - edits made by `python3 - <<'EOF' … open(p,'w').write(s)` (the dominant
 *     editing shape in auto mode), helper functions, dict / tuple loops;
 *   - edits made by sub-agents (their own transcripts);
 *   - opencode / copilot apply_patch envelopes, copilot `create`;
 *   - pi tool calls, which never reached the extractor at all.
 *
 * And some rows carry WRONG files: until the same day, `/patch-artifacts/recent`
 * wrote one turn's list into every "none" row of that agent within 4h — an
 * LSL-loading turn read "Artifacts: edited fake-upstream.mjs".
 *
 * WHAT IT DOES. Indexes every Claude transcript turn (user prompt → next user
 * prompt) by its prompt uuid and by every message timestamp in it, computes the
 * turn's files with the CURRENT extractor (imported, never re-implemented), and
 * SETS each matched row's Artifacts to exactly that list — "none" included:
 *
 *   hot rows   (km-core, obs-api)  matched by metadata.turnKey — the prompt uuid
 *   cold rows  (JSON export)       matched by createdAt — the timestamp of the
 *              batch's first message, equal to the millisecond; a different
 *              session's turn cannot collide with it
 *
 * A row with no match (transcript gone, another agent) is left as it is. No LLM
 * call, nothing created; re-running is a no-op once rows agree.
 *
 * Usage:
 *   node scripts/backfill-observation-artifacts.mjs                 # dry run, hot + cold
 *   node scripts/backfill-observation-artifacts.mjs --apply
 *   node scripts/backfill-observation-artifacts.mjs --since 2026-09-01 --project coding
 *   node scripts/backfill-observation-artifacts.mjs --only hot|cold
 *
 * Env: OBS_API_URL (default http://localhost:12436), OBSERVATION_EXPORT_DIR
 *      (default: the data home's observation-export, lib/paths/data-home.cjs)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import EnhancedTranscriptMonitor, { extractFileChanges, subagentFileChanges, relativizeArtifact } from './enhanced-transcript-monitor.js';
import { execFileSync } from 'node:child_process';
import { setArtifactsInPlace } from './lib/artifacts-patch-util.mjs';
import ConfigurableRedactor from '../src/live-logging/ConfigurableRedactor.js';

const require = createRequire(import.meta.url);
const { observationExportDir } = require('../lib/paths/data-home.cjs');

const args = process.argv.slice(2);
const getArg = (k, d = null) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const APPLY = args.includes('--apply');
const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const SINCE = getArg('since', '2026-01-01');
const ONLY_PROJECT = getArg('project', null);
const ONLY = getArg('only', null); // 'hot' | 'cold' | null (both)
const EXPORT_DIR = process.env.OBSERVATION_EXPORT_DIR || observationExportDir();
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const say = (s) => process.stderr.write(`${s}\n`);

// The live writer redacts the summary AND the metadata JSON
// (ObservationWriter._redact), so a stored path reads `/Users/<USER_ID_REDACTED>/…`.
// A re-derived path goes through the same redactor before it is compared or
// written — otherwise every absolute path would "differ", and the backfill
// would write the raw ones the live path never stores.
let redact = (t) => t;

/**
 * A user message opens a turn — EXACTLY the rule ETM's exchange builder applies
 * (type:user that is not a tool_result), so turn boundaries and turnKeys agree
 * with the live rows'. That includes `isMeta` messages: a sub-agent hand-back
 * arrives as one and the live tap keys a turn on it.
 */
function isUserPrompt(o) {
  if (o.type !== 'user' || o.message?.role !== 'user') return false;
  const c = o.message?.content;
  return !(Array.isArray(c) && c.some((b) => b && b.type === 'tool_result' && b.tool_use_id));
}

/**
 * Every turn of one transcript, with its files, and the timestamps of all its
 * messages. Files are repo-relative to the session's own cwd, as the live tap
 * writes them.
 */
function turnsOf(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const turns = [];
  let cur = null;
  let cwd = null;
  for (const ln of raw.split('\n')) {
    if (!ln.trim()) continue;
    let o;
    try { o = JSON.parse(ln); } catch { continue; }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    if (isUserPrompt(o)) {
      if (cur) turns.push(cur);
      const c = o.message.content || '';
      cur = {
        key: o.uuid,
        stamps: new Set(),
        exchange: { userMessage: typeof c === 'string' ? c : (Array.isArray(c) ? c.map((b) => b?.text || '').join('\n') : ''), toolCalls: [], toolResults: [] },
      };
    }
    if (!cur) continue;
    if (o.timestamp) cur.stamps.add(Date.parse(o.timestamp));
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use') cur.exchange.toolCalls.push({ name: b.name, input: b.input, id: b.id });
      if (b?.type === 'tool_result') cur.exchange.toolResults.push({ tool_use_id: b.tool_use_id, content: b.content });
    }
  }
  if (cur) turns.push(cur);
  return turns.map((t) => {
    const own = extractFileChanges([t.exchange]).modifiedFiles;
    const sub = subagentFileChanges([t.exchange], file).modifiedFiles;
    const files = [...new Set([...own, ...sub].map((p) => redact(relativizeArtifact(p, cwd))))];
    return { key: t.key, stamps: t.stamps, files, file, tools: t.exchange.toolCalls.map((tc) => tc.name) };
  });
}

/** Index: prompt uuid → turn, message timestamp (ms) → turn. */
async function indexTranscripts() {
  const byKey = new Map();
  const byStamp = new Map();
  const sinceMs = Date.parse(SINCE);
  let slugs = [];
  try { slugs = fs.readdirSync(PROJECTS_DIR); } catch {
    say(`ERROR: cannot read ${PROJECTS_DIR}`);
    process.exit(2);
  }
  let transcripts = 0;
  for (const slug of slugs) {
    const dir = path.join(PROJECTS_DIR, slug);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      try { if (fs.statSync(full).mtimeMs < sinceMs) continue; } catch { continue; }
      transcripts += 1;
      for (const t of turnsOf(full)) {
        if (t.key) byKey.set(t.key, t);
        for (const s of t.stamps) if (Number.isFinite(s) && !byStamp.has(s)) byStamp.set(s, t);
      }
    }
  }
  say(`indexed ${transcripts} transcripts: ${byKey.size} turns`);
  await indexOtherAgents({ byKey, byStamp }, sinceMs);
  return { byKey, byStamp };
}

/**
 * opencode, copilot and pi, through ETM's OWN readers — readTranscriptMessages
 * (opencode's SQLite, copilot's events.jsonl, pi's session JSONL, each
 * normalized to Claude's shape) and extractExchanges — so turn boundaries,
 * turnKeys and tool calls are exactly the live tap's.
 */
async function indexOtherAgents(idx, sinceMs) {
  const etm = Object.create(EnhancedTranscriptMonitor.prototype);
  etm.debug = () => {};
  etm.config = {};
  const sources = [];
  // opencode: one virtual path per session updated since SINCE
  try {
    const db = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
    const out = execFileSync('sqlite3', ['-readonly', '-separator', '\t', db,
      `select id, directory from session where time_updated >= ${sinceMs};`], { encoding: 'utf8', timeout: 20_000 });
    for (const line of out.split('\n').filter(Boolean)) {
      const [id, dir] = line.split('\t');
      sources.push({ agent: 'opencode', path: `opencode://${id}`, cwd: dir || null });
    }
  } catch { /* no opencode */ }
  // copilot: ~/.copilot/session-state/<id>/events.jsonl
  const copilotRoot = path.join(os.homedir(), '.copilot', 'session-state');
  for (const d of (() => { try { return fs.readdirSync(copilotRoot); } catch { return []; } })()) {
    const f = path.join(copilotRoot, d, 'events.jsonl');
    try { if (fs.statSync(f).mtimeMs >= sinceMs) sources.push({ agent: 'copilot', path: f, cwd: null }); } catch { /* none */ }
  }
  // pi: ~/.pi/agent/sessions/<slug>/*.jsonl, cwd in the session header
  const piRoot = path.join(os.homedir(), '.pi', 'agent', 'sessions');
  for (const d of (() => { try { return fs.readdirSync(piRoot); } catch { return []; } })()) {
    for (const f of (() => { try { return fs.readdirSync(path.join(piRoot, d)); } catch { return []; } })()) {
      const full = path.join(piRoot, d, f);
      if (!f.endsWith('.jsonl')) continue;
      try { if (fs.statSync(full).mtimeMs < sinceMs) continue; } catch { continue; }
      let cwd = null;
      try { cwd = JSON.parse(fs.readFileSync(full, 'utf8').split('\n', 1)[0]).cwd || null; } catch { /* no header */ }
      sources.push({ agent: 'pi', path: full, cwd });
    }
  }

  const counts = {};
  for (const src of sources) {
    etm.agentType = src.agent;
    let msgs;
    let exchanges;
    try {
      msgs = etm.readTranscriptMessages(src.path) || [];
      exchanges = await etm.extractExchanges(msgs);
    } catch { continue; }
    if (!exchanges?.length) continue;
    const turns = exchanges.map((ex) => ({
      tools: (ex.toolCalls || []).map((tc) => tc.name),
      key: ex.id,
      at: Date.parse(ex.timestamp),
      stamps: new Set(),
      files: [...new Set(extractFileChanges([ex]).modifiedFiles.map((p) => redact(relativizeArtifact(p, src.cwd))))],
    })).filter((t) => Number.isFinite(t.at)).sort((a, b) => a.at - b.at);
    // A message belongs to the latest turn that began at or before it.
    for (const m of msgs) {
      const at = Date.parse(m.timestamp);
      if (!Number.isFinite(at)) continue;
      let owner = null;
      for (const t of turns) { if (t.at <= at) owner = t; else break; }
      owner?.stamps.add(at);
    }
    for (const t of turns) {
      t.stamps.add(t.at);
      if (t.key) idx.byKey.set(t.key, t);
      for (const st of t.stamps) if (!idx.byStamp.has(st)) idx.byStamp.set(st, t);
    }
    counts[src.agent] = (counts[src.agent] || 0) + turns.length;
  }
  say(`indexed other agents: ${JSON.stringify(counts)}`);
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A timestamp match is only evidence when it is the row's own message time.
 * Two shapes say it is not, and the row is left alone:
 *   - several rows carry the SAME createdAt (an earlier gap backfill stamped
 *     a session's rows with one instant — 5 different opencode intents at
 *     2026-05-13T05:52:28.273Z, 9 km-core rows at 2026-05-20T08:01:08.682Z);
 *   - the matched turn ran no tools at all, yet the row lists files — the row
 *     describes work that turn did not do, so clearing it would erase it.
 */
function trustStampMatch(turn, before, sharedStamp) {
  if (sharedStamp) return false;
  if (!(turn.tools || []).length && !turn.files.length && before.length) return false;
  return true;
}

/**
 * Whether a row already says exactly `files` — in its summary line AND its
 * metadata. Both, because they drifted apart: the old recent-patch route wrote
 * basenames into the summary ("edited enhanced-transcript-monitor.js") while
 * metadata held the full path, so comparing metadata alone skipped those rows.
 */
function agrees(summary, modifiedFiles, files) {
  const line = (String(summary).match(/^[ \t]*Artifacts:(.*)$/m) || [])[1];
  const want = files.length ? files.map((f) => `edited ${f}`).join(', ') : 'none';
  const meta = Array.isArray(modifiedFiles) ? modifiedFiles : [];
  return line !== undefined && line.trim() === want && sameList(meta, files);
}

function report(label, changes) {
  const toFiles = changes.filter((c) => c.files.length && !c.before.length).length;
  const toNone = changes.filter((c) => !c.files.length).length;
  const corrected = changes.length - toFiles - toNone;
  say(`${label}: ${changes.length} row(s) to change — none→files ${toFiles}, wrong→right ${corrected}, wrong→none ${toNone}`);
  const byAgent = {};
  for (const c of changes) {
    const k = `${c.agent || '?'}:${!c.files.length ? 'wrong→none' : c.before.length ? 'wrong→right' : 'none→files'}`;
    byAgent[k] = (byAgent[k] || 0) + 1;
  }
  say(`  by agent: ${JSON.stringify(byAgent)}`);
  if (args.includes('--sample')) {
    const want = getArg('sample');
    for (const c of changes.filter((x) => `${x.agent}:${!x.files.length ? 'wrong→none' : x.before.length ? 'wrong→right' : 'none→files'}` === want).slice(0, 6)) {
      say(`  --- ${c.when} ${c.project} [${c.before.join(', ').slice(0, 90)}] → [${c.files.join(', ').slice(0, 90)}]`);
      say(`      intent: ${String(c.summary || '').split('\n')[0].slice(0, 140)}`);
      say(`      turn tools: ${(c.tools || []).slice(0, 18).join(' ')}`);
    }
    return;
  }
  for (const c of changes.slice(0, 15)) {
    say(`  ${c.when} ${c.project || ''}  [${c.before.join(', ').slice(0, 60) || 'none'}] → [${c.files.join(', ').slice(0, 80) || 'none'}]`);
  }
}

async function hotPass(idx) {
  const resp = await fetch(`${OBS_API}/api/v1/entities?ontologyClass=Observation&limit=100000`);
  if (!resp.ok) { say(`ERROR: obs-api ${resp.status}`); process.exit(2); }
  const rows = (await resp.json()).data || [];
  const changes = [];
  let matched = 0;
  const hotStamps = new Map();
  for (const e of rows) hotStamps.set(e.createdAt, (hotStamps.get(e.createdAt) || 0) + 1);
  for (const e of rows) {
    const m = e.metadata || {};
    if ((e.createdAt || '') < SINCE) continue;
    if (ONLY_PROJECT && m.project !== ONLY_PROJECT) continue;
    const keyed = m.turnKey && idx.byKey.get(m.turnKey);
    const turn = keyed || idx.byStamp.get(Date.parse(e.createdAt));
    if (!turn) continue;
    const before = Array.isArray(m.modifiedFiles) ? m.modifiedFiles : [];
    if (!keyed && !trustStampMatch(turn, before, hotStamps.get(e.createdAt) > 1)) continue;
    matched += 1;
    const summary = m.summary || e.description || '';
    if (!/^[ \t]*Artifacts:/m.test(summary)) continue;
    const shown = /^[ \t]*Artifacts:\s*none\s*$/im.test(summary) ? [] : before;
    if (agrees(summary, before, turn.files)) continue;
    changes.push({ id: e.id, before: shown, files: turn.files, when: e.createdAt, project: m.project, agent: m.agent });
  }
  say(`hot: ${rows.length} rows, ${matched} matched to a transcript turn`);
  report('hot', changes);
  if (!changes.length || !APPLY) return;
  for (let i = 0; i < changes.length; i += 100) {
    const r = await fetch(`${OBS_API}/api/observations/patch-artifacts/by-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace: true, updates: changes.slice(i, i + 100).map((c) => ({ id: c.id, modifiedFiles: c.files })) }),
    });
    say(`  applied: ${JSON.stringify(await r.json().catch(() => ({ status: r.status })))}`);
  }
}

/**
 * The JSON cold store, patched in place: rows absent from the hot store are
 * carried over verbatim by ObservationExporter (keyed on id), so the change
 * survives later exports; per-project slices are rebuilt from this file by id.
 */
function coldPass(idx) {
  const file = path.join(EXPORT_DIR, 'observations.json');
  let rows;
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    say(`ERROR: cannot read cold store ${file}: ${err.message}`);
    process.exit(2);
  }
  const changes = [];
  let matched = 0;
  const coldStamps = new Map();
  for (const r of rows) if (r?.createdAt) coldStamps.set(r.createdAt, (coldStamps.get(r.createdAt) || 0) + 1);
  for (const row of rows) {
    if (!row || (row.createdAt || '') < SINCE) continue;
    if (ONLY_PROJECT && row.project !== ONLY_PROJECT) continue;
    const turn = idx.byStamp.get(Date.parse(row.createdAt));
    if (!turn) continue;
    const before = Array.isArray(row.modifiedFiles) ? row.modifiedFiles : [];
    if (!trustStampMatch(turn, before, coldStamps.get(row.createdAt) > 1)) continue;
    matched += 1;
    const shown = /^[ \t]*Artifacts:\s*none\s*$/im.test(row.summary || '') ? [] : before;
    if (!/^[ \t]*Artifacts:/m.test(row.summary || '')) continue;
    if (agrees(row.summary, before, turn.files)) continue;
    changes.push({ row, before: shown, files: turn.files, when: row.createdAt, project: row.project, agent: row.agent, summary: row.summary, tools: turn.tools });
  }
  say(`cold: ${rows.length} rows in ${file}, ${matched} matched to a transcript turn`);
  report('cold', changes);
  if (!changes.length || !APPLY) return;
  let patched = 0;
  // The util reads/writes metadata.summary + metadata.modifiedFiles, which on
  // this shim ARE the row's own fields.
  for (const c of changes) if (setArtifactsInPlace({ metadata: c.row }, c.files)) patched += 1;
  // Backup, then atomic replace — the exporter rewrites this file on its own
  // debounce, and a torn write would take the whole history with it.
  const backup = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, file);
  say(`  applied: ${patched} cold row(s); backup ${backup}`);
}

async function main() {
  try {
    const redactor = new ConfigurableRedactor();
    await redactor.initialize();
    redact = (t) => redactor.redact(t);
  } catch (err) {
    say(`ERROR: redactor unavailable (${err.message}) — refusing to write unredacted paths`);
    process.exit(2);
  }
  const idx = await indexTranscripts();
  if (ONLY !== 'cold') await hotPass(idx);
  if (ONLY !== 'hot') coldPass(idx);
  if (!APPLY) say('\nDRY RUN — re-run with --apply to write');
}

main().catch((err) => {
  say(`ERROR: ${err.message}`);
  process.exit(1);
});
