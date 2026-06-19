#!/usr/bin/env node
/**
 * backfill-gap-observations.mjs — fill a bounded observation gap by replaying
 * the user prompt-sets of a single closed transcript into obs-api.
 *
 * Context (2026-06-19): the LLM-proxy outage (copilot 429 + proxy.muc
 * misdetect) starved the observation-writer for ~6.5h, so the morning prompt
 * sets (07:53–10:13 CEST) never produced observations. The bulk ETM
 * `--reprocess` path is UNSAFE here because the session-scoped content-hash fix
 * (ObservationWriter.js, same day) makes a fresh-sessionId reprocess DUPLICATE
 * every already-observed exchange. This tool scopes strictly to the EMPTY gap
 * window [--lo, --hi], where no rows exist to collide with, so it is dup-safe
 * regardless of sessionId.
 *
 * It reconstructs each exchange (user prose prompt → assistant text + tool-call
 * summary, until the next user prose prompt) the same way ETM's ObservationTap
 * does, stamps the messages with the ORIGINAL exchange timestamp (so obs-api
 * writes the row at created_at = that time, not now), and POSTs to
 * /api/observations/messages. obs-api still runs its own dedup + semantic
 * checks, so re-running is safe.
 *
 * Usage:
 *   node scripts/backfill-gap-observations.mjs --transcript <uuid> --lo <iso> --hi <iso> [--dry-run]
 *   node scripts/backfill-gap-observations.mjs --transcript 32749378-... \
 *        --lo 2026-06-19T04:27:48.502Z --hi 2026-06-19T11:01:36.499Z --dry-run
 *
 * Env: OBS_API_URL (default http://localhost:12436)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (k, d = null) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DRY = args.includes('--dry-run');
const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const PROJECT_DIR = os.homedir() + '/.claude/projects/-Users-Q284340-Agentic-coding';
const transcriptArg = getArg('transcript');
const LO = getArg('lo');
const HI = getArg('hi');
const AGENT = getArg('agent', 'claude');
const PROJECT = getArg('project', 'coding');

if (!transcriptArg || !LO || !HI) {
  process.stderr.write('ERROR: --transcript <uuid-prefix> --lo <iso> --hi <iso> required\n');
  process.exit(2);
}

// Resolve the full transcript path from a uuid prefix.
const file = fs.readdirSync(PROJECT_DIR)
  .filter((f) => f.endsWith('.jsonl') && f.startsWith(transcriptArg.slice(0, 8)))
  .map((f) => path.join(PROJECT_DIR, f))[0];
if (!file) {
  process.stderr.write(`ERROR: no transcript matching ${transcriptArg} in ${PROJECT_DIR}\n`);
  process.exit(2);
}
const sessionId = path.basename(file).replace('.jsonl', '');

// Parse JSONL entries.
const entries = [];
for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!ln.trim()) continue;
  try { entries.push(JSON.parse(ln)); } catch { /* skip malformed */ }
}

// A "user prose prompt" = type:user, role:user, not isMeta, content carries
// non-empty text (string OR text blocks), and is NOT a pure tool_result and NOT
// a bare slash-command marker.
function userPromptText(o) {
  if (o.type !== 'user' || o.isMeta) return null;
  const c = o.message?.content;
  let txt = '';
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === 'tool_result')) return null; // tool result turn
    txt = c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  }
  txt = (txt || '').trim();
  if (!txt) return null;
  // bare command markers (e.g. <command-name>/clear</command-name>) — skip
  if (txt.startsWith('<command-') && txt.length < 200) return null;
  return txt;
}

// Group into exchanges: each user prose prompt opens an exchange that absorbs
// subsequent assistant text + tool_use names until the next user prose prompt.
const exchanges = [];
let cur = null;
for (const o of entries) {
  const prompt = userPromptText(o);
  if (prompt !== null) {
    if (cur) exchanges.push(cur);
    cur = { ts: o.timestamp, userMessage: prompt, assistant: '', tools: [], modified: [], read: [] };
    continue;
  }
  if (!cur) continue;
  if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
    for (const item of o.message.content) {
      if (item.type === 'text') cur.assistant += item.text + '\n';
      else if (item.type === 'tool_use') {
        cur.tools.push(item.name);
        const fp = item.input?.file_path || item.input?.filePath;
        if (fp) {
          if (item.name === 'Edit' || item.name === 'Write') { if (!cur.modified.includes(fp)) cur.modified.push(fp); }
          else if (item.name === 'Read') { if (!cur.read.includes(fp)) cur.read.push(fp); }
        }
      }
    }
  }
}
if (cur) exchanges.push(cur);

// Keep only exchanges whose prompt timestamp is strictly inside the gap window.
const gap = exchanges.filter((e) => e.ts && e.ts > LO && e.ts < HI);

process.stderr.write(`transcript: ${path.basename(file)}\n`);
process.stderr.write(`window:     ${LO} .. ${HI}\n`);
process.stderr.write(`exchanges in window: ${gap.length} (of ${exchanges.length} total)\n\n`);

async function postOne(e) {
  const toolSummary = e.tools.length
    ? `[Tool calls]\n${[...new Set(e.tools)].join(', ')}\n\n` : '';
  const assistantContent = (toolSummary + e.assistant).trim();
  const messages = [
    { id: `${e.ts}-user`, role: 'user', content: e.userMessage, createdAt: e.ts, metadata: { agent: AGENT, format: 'live' } },
    { id: `${e.ts}-assistant`, role: 'assistant', content: assistantContent || '(no assistant text captured)', createdAt: e.ts, metadata: { agent: AGENT, format: 'live' } },
  ];
  const metadata = {
    agent: AGENT,
    sessionId,
    sourceFile: 'live-etm-backfill',
    project: PROJECT,
    modifiedFiles: e.modified.length ? e.modified : undefined,
    readFiles: e.read.length ? e.read : undefined,
  };
  const res = await fetch(`${OBS_API}/api/observations/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, metadata }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

let wrote = 0, deduped = 0, failed = 0;
for (const e of gap) {
  const head = `${e.ts}  «${e.userMessage.slice(0, 70).replace(/\n/g, ' ')}»  tools=${e.tools.length} mod=${e.modified.length}`;
  if (DRY) { process.stderr.write(`DRY  ${head}\n`); continue; }
  try {
    const { status, body } = await postOne(e);
    const obs = body?.observations ?? 0;
    // processMessages returns {observations, errors}; a dedup-skip still counts
    // as observations:1 with the existing id, so infer write vs dedup from logs.
    if (status === 200) { wrote += obs > 0 ? 1 : 0; process.stderr.write(`OK   ${head}  -> observations=${obs} errors=${body?.errors ?? 0}\n`); }
    else { failed++; process.stderr.write(`FAIL[${status}] ${head} -> ${JSON.stringify(body).slice(0, 160)}\n`); }
  } catch (err) {
    failed++; process.stderr.write(`ERR  ${head} -> ${err.message}\n`);
  }
}
process.stderr.write(`\n${DRY ? 'DRY-RUN' : 'DONE'}: window exchanges=${gap.length} posted_ok=${wrote} failed=${failed}\n`);
