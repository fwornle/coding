#!/usr/bin/env node
/**
 * Recover `prompt_preview` for foreground Claude rows that were written empty.
 *
 * THE DEFECT. The `/v1/messages` passthrough logged `prompt_preview: ''` on
 * every row. Not by policy: `extractPromptPreview()` read `content` only when it
 * was a string, and on the Anthropic wire content is an array of typed blocks,
 * so the tap would have produced '' even had it asked. The proxy reads both
 * wires now, but ~63k existing rows carry nothing, and the Routing tab's
 * By-turn view captions every one of them "(no prompt recorded)".
 *
 * WHERE THE TEXT COMES FROM, AND WHY IT IS NOT A GUESS. The prompt was never in
 * this database, so it has to come from somewhere else — and the only honest
 * somewhere is one that can be joined EXACTLY. Claude Code's own transcripts
 * (~/.claude/projects/<encoded>/<session>.jsonl) stamp each assistant entry with
 * the upstream `requestId`, and the proxy stores that same id in
 * `tool_call_id`. So a row is matched by identity, never by timestamp
 * proximity. A timestamp join would have covered more rows and would have been
 * an inference presented as a record — the exact thing the routing columns
 * exist to stop.
 *
 * THE PROMPT OF THE TURN, NOT OF THE SESSION. Walking a transcript forward, the
 * prompt for a `requestId` is the nearest PRECEDING user message that is not a
 * `tool_result`. That is the same rule `turnPromptText()` applies live, and this
 * script imports that function rather than restating it, so a backfilled
 * caption and a live one cannot drift apart. Tool replies arrive on this wire as
 * `role: 'user'` messages, so skipping them is what stops a turn being captioned
 * with tool output.
 *
 * REDACTED THE SAME WAY. The preview goes through the same 27-pattern set as the
 * live path, loaded from the coding repo's single source of truth, and is
 * redacted BEFORE the 120-char truncation so a secret straddling the display
 * boundary is caught rather than half-stored.
 *
 * IDEMPOTENCY IS IN THE DATA HERE, AND THAT IS NOT A SHORTCUT. The sibling
 * backfill (backfill-openai-wire-cache-split.mjs) needs a marker row in
 * `token_usage_migrations` because its arithmetic cannot distinguish a corrected
 * row from an uncorrected one, so a second run would subtract twice. This one is
 * different in kind: it only ever writes rows WHERE prompt_preview = '', and
 * writing a non-empty preview removes the row from its own selection. A second
 * run therefore finds nothing, and — more importantly — it can never overwrite a
 * preview the live proxy wrote. Do not add a marker to "match the sibling": a
 * marker would be weaker here, because it would stop a later run from picking up
 * rows whose transcript had not yet been flushed when this first ran.
 *
 * WHAT IT CANNOT RECOVER. Claude Code does not keep transcripts forever. Rows
 * whose session transcript is gone have no source and are left empty rather than
 * approximated; the summary prints the split by month so the gap is visible
 * instead of implied. Re-running later is safe and picks up anything that has
 * since been written.
 *
 * Usage:
 *   node scripts/backfill-claude-prompt-preview.mjs                 # dry run (default)
 *   node scripts/backfill-claude-prompt-preview.mjs --apply
 *   node scripts/backfill-claude-prompt-preview.mjs --db=PATH
 *   node scripts/backfill-claude-prompt-preview.mjs --transcripts=DIR
 *   node scripts/backfill-claude-prompt-preview.mjs --limit=100 --verbose
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import * as readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** The proxy owns both of these; importing beats restating them. */
const PROXY_ROOT = path.resolve(REPO_ROOT, '..', '_work', 'rapid-llm-proxy');

export function parseArgs(argv) {
  const args = {
    apply: false,
    verbose: false,
    limit: 0,
    db: path.resolve(process.cwd(), '.data/llm-proxy/token-usage.db'),
    transcripts: path.join(os.homedir(), '.claude', 'projects'),
    proxy: PROXY_ROOT,
  };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a.startsWith('--db=')) args.db = path.resolve(a.slice('--db='.length));
    else if (a.startsWith('--transcripts=')) args.transcripts = path.resolve(a.slice('--transcripts='.length));
    else if (a.startsWith('--proxy=')) args.proxy = path.resolve(a.slice('--proxy='.length));
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.slice('--limit='.length), 10) || 0;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`unknown argument: ${a}`); usage(); process.exit(2); }
  }
  return args;
}

function usage() {
  console.log(`Usage: node scripts/backfill-claude-prompt-preview.mjs [--apply] [--db=PATH]
       [--transcripts=DIR] [--proxy=DIR] [--limit=N] [--verbose]`);
}

/** Every *.jsonl under the transcripts root, recursively. */
export function* transcriptFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* transcriptFiles(full);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield full;
  }
}

/**
 * requestId → the prompt of the turn that produced it.
 *
 * One forward pass per transcript. `current` holds the most recent real user
 * message; every assistant entry stamped with a requestId claims it. A user
 * entry carrying a tool_result is NOT a prompt and must not overwrite it —
 * that is how a turn ends up captioned with tool output.
 *
 * @param {Iterable<string>} files
 * @param {(messages: Array) => string} turnPromptText the proxy's own extractor
 */
export async function indexTranscripts(files, turnPromptText, onFile) {
  const byRequestId = new Map();
  let scanned = 0;

  for (const file of files) {
    let current = '';
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    try {
      for await (const line of rl) {
        if (!line) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const msg = o?.message;

        if (o?.type === 'user' && msg?.role === 'user') {
          // Hand the message to the proxy's extractor in the shape it expects.
          // It applies the tool_result skip and the both-wires content flatten,
          // so a transcript entry and a live request are read identically.
          const text = turnPromptText([{ role: 'user', content: msg.content }]);
          if (text) current = text;
        } else if (o?.type === 'assistant' && typeof o.requestId === 'string' && o.requestId) {
          // First writer wins: an id appearing twice is one API call split
          // across streamed entries, and the earlier one is the turn it began in.
          if (current && !byRequestId.has(o.requestId)) byRequestId.set(o.requestId, current);
        }
      }
    } finally {
      rl.close();
    }
    scanned += 1;
    if (onFile && scanned % 250 === 0) onFile(scanned);
  }
  return { byRequestId, scanned };
}

/** `req_x:reason:0` and `req_x` are the same API call. Match on the base id. */
export function baseRequestId(toolCallId) {
  const i = toolCallId.indexOf(':reason:');
  return i > 0 ? toolCallId.slice(0, i) : toolCallId;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The live extractor and the live redaction set, imported rather than copied.
  const { turnPromptText } = await import(
    path.join(args.proxy, 'proxy-bridge', 'turn-identity.mjs'));
  const { loadRawBodyRedactionPatterns, makeRedactRawBody } = await import(
    path.join(args.proxy, 'proxy-bridge', 'raw-bodies.mjs'));
  const patterns = loadRawBodyRedactionPatterns(
    REPO_ROOT, path.join(REPO_ROOT, '.specstory', 'config', 'redaction-patterns.json'));
  const redact = makeRedactRawBody(patterns);
  if (!patterns.length) {
    console.error('refusing to run: no redaction patterns loaded — previews would be stored raw');
    process.exit(1);
  }

  /** Byte-for-byte the live composition in server.mjs's extractPromptPreview. */
  const preview = (text) => {
    const r = redact(text).replace(/\s+/g, ' ').trim();
    return r.length > 120 ? `${r.slice(0, 117)}...` : r;
  };

  console.log(`db          ${args.db}`);
  console.log(`transcripts ${args.transcripts}`);
  console.log(`redaction   ${patterns.length} patterns`);
  console.log(`mode        ${args.apply ? 'APPLY' : 'dry run (default) — pass --apply to write'}\n`);

  if (!fs.existsSync(args.db)) {
    console.error(`no such database: ${args.db}`);
    process.exit(1);
  }

  const db = new DatabaseSync(args.db);
  // The proxy writes to this DB continuously; wait rather than fail.
  db.exec('PRAGMA busy_timeout = 15000');

  // user_hash rides along so the UPDATE below can use the (user_hash,
  // tool_call_id) unique index. It is the only index covering tool_call_id, and
  // it leads with user_hash, so matching on the id alone cannot use it — 34k
  // statements each degrade to a full scan of a 338k-row table, which is why an
  // earlier version of this did not finish. Grouping by both also happens to be
  // more correct: the pair is what is actually unique.
  const targets = db.prepare(`
    SELECT user_hash, tool_call_id, substr(timestamp, 1, 7) AS month, count(*) AS rows
    FROM token_usage
    WHERE agent = 'claude' AND prompt_preview = '' AND tool_call_id != ''
    GROUP BY user_hash, tool_call_id, month
  `).all();

  if (targets.length === 0) {
    console.log('nothing to do: no claude rows with an empty prompt_preview.');
    db.close();
    return;
  }
  const totalRows = targets.reduce((s, t) => s + t.rows, 0);
  console.log(`${totalRows} row(s) across ${targets.length} request id(s) have no preview.`);
  console.log('indexing transcripts…');

  const { byRequestId, scanned } = await indexTranscripts(
    transcriptFiles(args.transcripts), turnPromptText,
    (n) => process.stdout.write(`\r  ${n} files…`));
  process.stdout.write(`\r  ${scanned} files, ${byRequestId.size} request ids indexed.\n\n`);

  // Equality only, never LIKE. The targets are GROUPed BY tool_call_id, so
  // `req_x` and `req_x:reason:0` arrive as separate rows and each already holds
  // the literal id to match — the base id is needed only to look the PROMPT up.
  // An earlier version matched `tool_call_id = ? OR tool_call_id LIKE ?` to
  // catch the reasoning-step siblings, which was both redundant and quadratic:
  // the OR/LIKE cannot use the (user_hash, tool_call_id) index, so each of 34k
  // statements degraded to a full scan of a 338k-row table and the run did not
  // finish in two minutes.
  // `tool_call_id != ''` is REDUNDANT as a filter and load-bearing as a hint.
  // idx_token_usage_reqid is a PARTIAL index (…WHERE tool_call_id != ''), and
  // SQLite will only use one when the query provably implies its predicate — a
  // bound `tool_call_id = ?` does not, so without this the planner fell back to
  // the PK autoindex and matched on user_hash ALONE, scanning all ~63k rows of
  // that hash per statement. EXPLAIN QUERY PLAN is the check:
  //   without: SEARCH … USING INDEX sqlite_autoindex_token_usage_1 (user_hash=?)
  //   with:    SEARCH … USING INDEX idx_token_usage_reqid (user_hash=? AND tool_call_id=?)
  const update = db.prepare(`
    UPDATE token_usage SET prompt_preview = ?
    WHERE prompt_preview = '' AND user_hash = ? AND tool_call_id = ? AND tool_call_id != ''
  `);

  const byMonth = new Map();
  const bump = (month, key, n = 1) => {
    if (!byMonth.has(month)) byMonth.set(month, { matched: 0, unmatched: 0, written: 0 });
    byMonth.get(month)[key] += n;
  };

  let matchedRows = 0, unmatchedRows = 0, written = 0, empties = 0, shown = 0;

  // Rows per transaction. Big enough that fsync cost is amortised, small enough
  // that the live proxy never waits long for the write lock.
  const BATCH = 2000;
  let inBatch = 0, open = false;
  const beginBatch = () => { if (!open) { db.exec('BEGIN IMMEDIATE'); open = true; } };
  const commitBatch = (force = false) => {
    if (open && (force || inBatch >= BATCH)) {
      db.exec('COMMIT');
      open = false;
      inBatch = 0;
    }
  };

  const apply = () => {
    for (const t of targets) {
      const base = baseRequestId(t.tool_call_id);
      const text = byRequestId.get(base);
      if (!text) {
        unmatchedRows += t.rows;
        bump(t.month, 'unmatched', t.rows);
        continue;
      }
      const value = preview(text);
      if (!value) {
        // Recovered, but empty after redaction/collapse — an image-only prompt,
        // say. Left as '' rather than written blank; a later run may find better.
        empties += 1;
        continue;
      }
      matchedRows += t.rows;
      bump(t.month, 'matched', t.rows);
      if (args.verbose && shown < 20) {
        console.log(`  ${base}  ${JSON.stringify(value.slice(0, 90))}`);
        shown += 1;
      }
      if (args.apply) {
        beginBatch();
        const res = update.run(value, t.user_hash, t.tool_call_id);
        written += Number(res.changes ?? 0);
        bump(t.month, 'written', Number(res.changes ?? 0));
        inBatch += 1;
        commitBatch();
      }
      if (args.limit && matchedRows >= args.limit) break;
    }
  };

  if (args.apply) {
    // Chunked transactions, NOT one big one, and not one per row.
    //
    // Per row: 34k fsyncs. One transaction: the write lock is held for the whole
    // update phase — and the proxy is writing to this same database the entire
    // time. logCall is best-effort by contract ("a DB hiccup must never fail the
    // LLM call"), so a blocked insert is a DROPPED token row, not a retried one.
    // A backfill that silently costs live rows is a bad trade for a caption.
    //
    // Chunking bounds the lock to one batch and lets the proxy interleave.
    try {
      apply();
      commitBatch(true);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
      console.error(`\nfailed after ${written} row(s): ${err.message}`);
      console.error('Committed batches stand; re-run to continue where it stopped.');
      db.close();
      process.exit(1);
    }
  } else {
    apply();
  }

  console.log(`\n${'month'.padEnd(10)}${'recoverable'.padStart(13)}${'no transcript'.padStart(15)}${args.apply ? 'written'.padStart(10) : ''}`);
  for (const month of [...byMonth.keys()].sort()) {
    const m = byMonth.get(month);
    console.log(
      month.padEnd(10)
      + String(m.matched).padStart(13)
      + String(m.unmatched).padStart(15)
      + (args.apply ? String(m.written).padStart(10) : ''));
  }

  const pct = totalRows ? Math.round((matchedRows / totalRows) * 100) : 0;
  console.log(`\nrecoverable ${matchedRows}/${totalRows} rows (${pct}%)`);
  console.log(`no transcript ${unmatchedRows} rows — left empty, not approximated`);
  if (empties) console.log(`${empties} request id(s) recovered to an empty caption — skipped`);
  if (args.apply) {
    console.log(`\nWROTE ${written} row(s).`);
  } else {
    console.log('\nDry run — nothing written. Re-run with --apply.');
  }

  db.close();
}

// Only when run as a script — the suite imports the pieces above directly.
// Normalised because process.argv[1] can be relative on some invocations.
if (fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
