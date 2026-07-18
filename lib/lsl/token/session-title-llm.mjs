// lib/lsl/token/session-title-llm.mjs
//
// Intelligent Run titles for auto-measured opencode sessions.
//
// PROBLEM: A first-prose-line heuristic produces garbage titles like
// "My other coding sessions claims" — it grabs whatever noisy sentence happens
// to survive filtering, not what the session was actually ABOUT.
//
// SOLUTION: Summarise the session's real signal (the user's requests + what the
// assistant actually DID — tool actions, files touched) into one short imperative
// title via the proxy's Haiku /api/complete endpoint (:12435). Because that call
// costs latency + tokens, results are CACHED to disk keyed on session id and only
// regenerated when the session has grown by REGEN_TURN_DELTA turns. The daemon
// falls back to its own heuristic whenever the LLM is unavailable — titles are a
// convenience, never allowed to break measurement.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PROXY_PORT = process.env.LLM_CLI_PROXY_PORT || process.env.LLM_PROXY_PORT || '12435';
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
const REQUEST_TIMEOUT_MS = 45_000;
const REGEN_TURN_DELTA = 4;   // regenerate only after +4 new turns
const MAX_USER_MSGS = 8;      // strongest signal: what the dev asked for
const MAX_ACTIONS = 24;       // supporting signal: what actually happened

function cachePath() {
  const dir = process.env.LLM_PROXY_DATA_DIR || '/Users/Q284340/Agentic/coding/.data';
  return path.join(dir, 'auto-measure', 'session-titles.json');
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(cachePath(), 'utf8')); }
  catch { return {}; }
}

function writeCache(cache) {
  const p = cachePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cache, null, 2));
  } catch { /* cache is best-effort */ }
}

// Compress a raw message to its human intent: drop shell prompts, command
// output, log lines and paths, keep prose. Returns '' when nothing survives.
function stripTitleNoise(s) {
  return String(s)
    .replace(/\[Image[^\]]*\]/gi, ' ')                 // [Image 1] attachment markers
    .replace(/\((?:project|repo)[^)]*\)/gi, ' ')        // (project coding) tails
    .replace(/https?:\/\/\S+/g, ' ')                    // inline URLs
    .replace(/(?:~|\/)[\w.\-]+(?:\/[\w.\-]+)+\/?/g, ' ') // absolute/home paths
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

function proseOnly(text, maxLines = 6) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (/^\S+@\S+.*[%$#]\s/.test(l)) continue;          // user@host dir % cmd
    if (/^[$#%>]\s/.test(l)) continue;                    // $ cmd / > output
    if (/^\[?\d{4}-\d{2}-\d{2}/.test(l)) continue;         // timestamps
    if (/^\[(INFO|WARN|ERROR|DEBUG)\]/i.test(l)) continue; // log levels
    if (/^(https?:\/\/|\/|~\/|\.\/)/.test(l)) continue;    // urls / paths
    const letters = (l.match(/[a-zA-Z]/g) || []).length;
    if (letters < Math.max(6, l.length * 0.4)) continue;   // mostly symbols
    const cleaned = stripTitleNoise(l);
    if (!cleaned || (cleaned.match(/[a-zA-Z]/g) || []).length < 6) continue;
    out.push(cleaned);
    if (out.length >= maxLines) break;
  }
  return out.join(' ');
}

// Gather the session's signal from opencode's store: user requests + a sample of
// assistant tool actions (verb + target). Returns { userMsgs, actions, turns }.
function gatherSignal(dbPath, sessionId) {
  let db;
  const userMsgs = [];
  const actions = [];
  let turns = 0;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    turns = db.prepare(
      `SELECT COUNT(*) AS n FROM message WHERE session_id = ?`
    ).get(sessionId)?.n || 0;

    const uRows = db.prepare(
      `SELECT p.data AS pdata FROM part p
         JOIN message m ON m.id = p.message_id
        WHERE m.session_id = ?
          AND m.data LIKE '%"role":"user"%'
          AND p.data LIKE '%"type":"text"%'
        ORDER BY p.rowid ASC LIMIT 400`
    ).all(sessionId);
    const allProse = [];
    for (const r of uRows) {
      try {
        const d = JSON.parse(r.pdata);
        const prose = proseOnly(d?.text || '');
        if (prose) allProse.push(prose);
      } catch { /* skip */ }
    }
    // Sample across the WHOLE session (head + tail) so a long session's LATER,
    // real feature framing is represented — not just the opening exploration.
    if (allProse.length <= MAX_USER_MSGS) {
      userMsgs.push(...allProse);
    } else {
      const head = Math.ceil(MAX_USER_MSGS / 3);
      const tail = MAX_USER_MSGS - head;
      userMsgs.push(...allProse.slice(0, head), ...allProse.slice(-tail));
    }

    const tRows = db.prepare(
      `SELECT p.data AS pdata FROM part p
         JOIN message m ON m.id = p.message_id
        WHERE m.session_id = ?
          AND m.data LIKE '%"role":"assistant"%'
          AND p.data LIKE '%"type":"tool"%'
        ORDER BY p.rowid ASC LIMIT 800`
    ).all(sessionId);
    const allActions = [];
    for (const r of tRows) {
      try {
        const d = JSON.parse(r.pdata);
        const tool = d?.tool || d?.name;
        const st = d?.state?.input || d?.input || {};
        const target = st.filePath || st.path || st.pattern || st.command || st.description || '';
        if (tool) allActions.push(`${tool}(${String(target).replace(/\s+/g, ' ').slice(0, 60)})`);
      } catch { /* skip */ }
    }
    if (allActions.length <= MAX_ACTIONS) {
      actions.push(...allActions);
    } else {
      const head = Math.ceil(MAX_ACTIONS / 3);
      const tail = MAX_ACTIONS - head;
      actions.push(...allActions.slice(0, head), ...allActions.slice(-tail));
    }
  } catch { /* fall through */ } finally { try { db?.close(); } catch { /* noop */ } }
  return { userMsgs, actions, turns };
}

function buildRequest({ userMsgs, actions }) {
  const requests = userMsgs.length
    ? userMsgs.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '(no clear textual request captured)';
  const activity = actions.length ? actions.join('\n') : '(no tool actions captured)';
  return {
    process: 'auto-measure-title',
    messages: [
      {
        role: 'system',
        content:
          'You name coding work sessions. Given the developer\'s requests and the ' +
          'tool actions that were actually performed, output ONE concise title ' +
          'describing what the session accomplished.\n' +
          'Rules:\n' +
          '- 4 to 9 words, imperative voice (e.g. "Add clickable context-window drilldown").\n' +
          '- Describe the CONCRETE work, not vague topics.\n' +
          '- Prefer the developer\'s requests; use the actions to disambiguate.\n' +
          '- No trailing punctuation, no quotes, no markdown. Output only the title.',
      },
      {
        role: 'user',
        content: `<requests>\n${requests}\n</requests>\n\n<actions>\n${activity}\n</actions>\n\nTitle:`,
      },
    ],
  };
}

function cleanTitle(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'`]+|["'`]+$/g, '').replace(/[.:;,\-\s]+$/, '').trim();
  if (t.length > 80) t = t.slice(0, 80).replace(/\s\S*$/, '') + '…';
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

async function callProxy(body) {
  const resp = await fetch(`${PROXY_URL}/api/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Return an intelligent, cached title for a session. NEVER throws.
 *
 * @param {string} dbPath     opencode SQLite path
 * @param {string} sessionId  opencode session id
 * @param {(msg:string)=>void} [log]
 * @returns {Promise<string|null>} title, or null when unavailable (caller falls back)
 */
export async function llmSessionTitle(dbPath, sessionId, log = () => {}) {
  const signal = gatherSignal(dbPath, sessionId);
  if (!signal.userMsgs.length && !signal.actions.length) return null;

  const cache = readCache();
  const hit = cache[sessionId];
  if (hit?.title && typeof hit.turns === 'number' && signal.turns - hit.turns < REGEN_TURN_DELTA) {
    return hit.title; // fresh enough — skip the LLM call
  }

  try {
    const res = await callProxy(buildRequest(signal));
    const title = cleanTitle(res?.content);
    if (!title) return hit?.title || null;
    cache[sessionId] = { ...hit, title, turns: signal.turns, updatedAt: new Date().toISOString() };
    writeCache(cache);
    log(`titled ${sessionId.slice(0, 12)} via ${res?.model || 'llm'}: "${title}"`);
    return title;
  } catch (e) {
    log(`title llm unavailable (${e.message}) — keeping ${hit?.title ? 'cached' : 'heuristic'}`);
    return hit?.title || null;
  }
}

function buildSummaryRequest({ userMsgs, actions }) {
  const requests = userMsgs.length
    ? userMsgs.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '(no clear textual request captured)';
  const activity = actions.length ? actions.join('\n') : '(no tool actions captured)';
  return {
    process: 'auto-measure-summary',
    messages: [
      {
        role: 'system',
        content:
          'You summarize coding work sessions for a dashboard overview. Given the ' +
          'developer\'s requests and the tool actions performed, write a 1–2 sentence ' +
          'plain-English summary of what the session set out to do and what was built.\n' +
          'Rules:\n' +
          '- 1 to 2 sentences, max ~40 words total.\n' +
          '- Describe CONCRETE work (features, fixes, files/areas touched).\n' +
          '- Neutral past tense (e.g. "Added ... Fixed ...").\n' +
          '- No markdown, no bullet points, no preamble. Output only the summary.',
      },
      {
        role: 'user',
        content: `<requests>\n${requests}\n</requests>\n\n<actions>\n${activity}\n</actions>\n\nSummary:`,
      },
    ],
  };
}

function cleanSummary(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (t.length > 320) t = t.slice(0, 320).replace(/\s\S*$/, '') + '…';
  return t;
}

/**
 * Return an intelligent, cached 1–2 sentence overview summary for a session.
 * Shares the title cache file + regen cadence. NEVER throws.
 *
 * @param {string} dbPath     opencode SQLite path
 * @param {string} sessionId  opencode session id
 * @param {(msg:string)=>void} [log]
 * @returns {Promise<string|null>} summary, or null when unavailable
 */
export async function llmSessionSummary(dbPath, sessionId, log = () => {}) {
  const signal = gatherSignal(dbPath, sessionId);
  if (!signal.userMsgs.length && !signal.actions.length) return null;

  const cache = readCache();
  const hit = cache[sessionId];
  if (hit?.summary && typeof hit.summaryTurns === 'number'
      && signal.turns - hit.summaryTurns < REGEN_TURN_DELTA) {
    return hit.summary; // fresh enough — skip the LLM call
  }

  try {
    const res = await callProxy(buildSummaryRequest(signal));
    const summary = cleanSummary(res?.content);
    if (!summary) return hit?.summary || null;
    cache[sessionId] = { ...hit, summary, summaryTurns: signal.turns, updatedAt: new Date().toISOString() };
    writeCache(cache);
    log(`summarized ${sessionId.slice(0, 12)} via ${res?.model || 'llm'}: "${summary.slice(0, 60)}…"`);
    return summary;
  } catch (e) {
    log(`summary llm unavailable (${e.message}) — keeping ${hit?.summary ? 'cached' : 'none'}`);
    return hit?.summary || null;
  }
}
