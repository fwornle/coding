#!/usr/bin/env node
/**
 * backfill-observation-artifacts.mjs — re-derive the Artifacts line of existing
 * observations from the transcripts they were written from.
 *
 * WHY THIS EXISTS. `_extractFileChanges` (scripts/enhanced-transcript-monitor.js)
 * decides what an observation lists under "Artifacts:". Until 2026-09-18 it read
 * a file path from exactly one place — `tc.input.file_path|filePath|path` — and
 * therefore missed three whole classes of real change:
 *
 *   - notebook edits, whose path rides on `notebook_path`;
 *   - every pi tool call, because PiSessionReader emits `{name, type, content}`
 *     with the arguments JSON-encoded in `content` and no `input` key at all;
 *   - files written by the shell (`cat > f`, `>>`, `tee`, `sed -i`).
 *
 * Rows written before the fix carry "Artifacts: none" for turns that did touch
 * files. This walks the transcripts again, recomputes each turn's files with the
 * CURRENT extractor (imported, never re-implemented — see extractFileChanges),
 * and patches only rows that still say "none".
 *
 * NOT a re-run of backfill-gap-observations.mjs, which CREATES observations for
 * a window that has none. This one creates nothing and calls no LLM: it edits
 * the Artifacts line of rows that already exist, so it is cheap and repeatable.
 * Re-running is safe — a row already carrying artifacts no longer matches.
 *
 * Usage:
 *   node scripts/backfill-observation-artifacts.mjs --dry-run
 *   node scripts/backfill-observation-artifacts.mjs --since 2026-09-01
 *   node scripts/backfill-observation-artifacts.mjs --project coding --apply
 *
 * Env: OBS_API_URL (default http://localhost:12436)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFileChanges } from './enhanced-transcript-monitor.js';
import { patchArtifactsInPlace } from './lib/artifacts-patch-util.mjs';

const args = process.argv.slice(2);
const getArg = (k, d = null) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const APPLY = args.includes('--apply');
const DRY = !APPLY;
const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const SINCE = getArg('since', '2026-01-01');
const ONLY_PROJECT = getArg('project', null);
// Observations age out of the hot km-core store into the JSON cold store, where
// putEntity cannot reach them — so the API route fixes only recent rows and
// reports the rest as `missing`. `--cold` patches the export file instead.
const COLD = args.includes('--cold');
const EXPORT_DIR = process.env.OBSERVATION_EXPORT_DIR
  || path.join(process.env.CODING_REPO || process.cwd(), '.data', 'observation-export');
/**
 * Slack allowed when pairing an observation with the turn it describes.
 *
 * ZERO BY DEFAULT, and that is the whole safety argument. An observation's
 * `createdAt` is the earliest message timestamp of its turn — the user prompt —
 * so the row and the turn carry the SAME instant. A non-zero gap does not mean
 * "close enough", it means the nearest turn that touched files is a DIFFERENT
 * turn, and adopting its files puts edits on a row that never made them.
 *
 * Measured, before this was tightened: of 106 cold rows matched within 180s, 79
 * were exact and the loose remainder included rows whose own summary says they
 * only looked — "Search for all instances … BEFORE making edits", "Investigated
 * system configuration" — each about to inherit a neighbour's edits. A missing
 * artifact is a gap; an invented one is a lie in the record.
 *
 * `--window-ms N` loosens it deliberately, for a caller who will check the
 * result by hand.
 */
const MATCH_WINDOW_MS = Number(getArg('window-ms', '0'));

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/** Decode Claude's projects-dir slug back to a project NAME (last segment). */
function projectNameFromSlug(slug) {
  const parts = slug.split('-').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

/**
 * A user prose prompt opens a turn. Same rules as backfill-gap-observations.mjs:
 * type:user (not meta, not a pure tool_result, not a bare command marker), plus
 * the queue-operation form that carries a prompt the user typed while the agent
 * was still working.
 */
function userPromptText(o) {
  if (o.type === 'queue-operation' && o.operation === 'enqueue' && typeof o.content === 'string') {
    const t = o.content.trim();
    if (!t || (t.startsWith('<command-') && t.length < 200)) return null;
    return t;
  }
  if (o.type !== 'user' || o.isMeta) return null;
  const c = o.message?.content;
  let txt = '';
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === 'tool_result')) return null;
    txt = c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  }
  txt = (txt || '').trim();
  if (!txt) return null;
  if (txt.startsWith('<command-') && txt.length < 200) return null;
  return txt;
}

/** Turns of one transcript, each with the files it touched. */
function turnsOf(file) {
  const turns = [];
  let cur = null;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return turns; }
  for (const ln of raw.split('\n')) {
    if (!ln.trim()) continue;
    let o;
    try { o = JSON.parse(ln); } catch { continue; }
    const prompt = userPromptText(o);
    if (prompt !== null) {
      if (cur) turns.push(cur);
      cur = { ts: o.timestamp, toolCalls: [] };
      continue;
    }
    if (!cur) continue;
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const item of o.message.content) {
        if (item.type === 'tool_use') cur.toolCalls.push({ name: item.name, input: item.input });
      }
    }
  }
  if (cur) turns.push(cur);
  // One shared extractor call per turn — same rules the live tap applies.
  return turns.map((t) => ({
    ts: t.ts,
    modifiedFiles: extractFileChanges([{ toolCalls: t.toolCalls }]).modifiedFiles,
  })).filter((t) => t.ts && t.modifiedFiles.length > 0);
}

/**
 * Pair one row with the nearest same-project turn that touched files.
 * Returns the turn's files, or null when nothing lands close enough.
 */
function filesForRow(turnsByProject, project, stamp) {
  const turns = turnsByProject.get(project) || [];
  const at = Date.parse(stamp || '');
  if (!Number.isFinite(at)) return null;
  let best = null;
  let bestGap = Infinity;
  for (const t of turns) {
    const gap = Math.abs(Date.parse(t.ts) - at);
    if (gap < bestGap) { bestGap = gap; best = t; }
  }
  return best && bestGap <= MATCH_WINDOW_MS ? { files: best.modifiedFiles, gapMs: bestGap } : null;
}

/**
 * Patch the JSON cold store in place.
 *
 * This is safe to do — and it is the ONLY way to reach these rows — because of
 * how ObservationExporter rebuilds the file: rows absent from the hot store are
 * carried over verbatim from the existing JSON (`preserved`, keyed on id alone,
 * not on content), so an edited summary survives every subsequent export.
 *
 * The mutation itself goes through the SAME `patchArtifactsInPlace` the two API
 * routes use. A cold row is flat (`{id, summary, modifiedFiles, …}`) where an
 * entity nests those under `metadata`, so it is passed as `{ metadata: row }`:
 * the util then reads and writes exactly the row's own fields. Reusing it rather
 * than re-implementing the string surgery is what keeps a cold row's Artifacts
 * line identical in shape to a hot one's.
 */
function coldPass(turnsByProject) {
  const file = path.join(EXPORT_DIR, 'observations.json');
  let rows;
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    process.stderr.write(`ERROR: cannot read cold store ${file}: ${err.message}\n`);
    process.exit(2);
  }
  if (!Array.isArray(rows)) {
    process.stderr.write(`ERROR: cold store is not an array\n`);
    process.exit(2);
  }
  process.stderr.write(`cold store: ${rows.length} rows in ${file}\n`);

  const candidates = rows.filter((r) => {
    if (!r || (r.createdAt || '') < SINCE) return false;
    const mf = r.modifiedFiles;
    if (Array.isArray(mf) && mf.length > 0) return false;
    return /Artifacts:\s*none/i.test(r.summary || '');
  });
  process.stderr.write(`cold rows saying "Artifacts: none": ${candidates.length}\n`);

  let patched = 0;
  const shown = [];
  const gaps = [];
  const note = (row, m) => {
    gaps.push(m.gapMs);
    if (shown.length < 30) {
      shown.push(`  ${row.project} ${row.createdAt} +${(m.gapMs / 1000).toFixed(0)}s  ${m.files.join(', ').slice(0, 95)}`);
    }
  };
  for (const row of candidates) {
    const m = filesForRow(turnsByProject, row.project, row.createdAt);
    if (!m) continue;
    if (DRY) { patched += 1; note(row, m); continue; }
    // The util reads/writes metadata.summary + metadata.modifiedFiles, which on
    // this shim ARE the row's own fields.
    if (patchArtifactsInPlace({ metadata: row }, m.files)) { patched += 1; note(row, m); }
  }
  for (const s of shown) process.stderr.write(`${s}\n`);
  if (gaps.length) {
    const exact = gaps.filter((g) => g === 0).length;
    gaps.sort((a, b) => a - b);
    process.stderr.write(
      `\ngap: exact=${exact}/${gaps.length}  median=${(gaps[Math.floor(gaps.length / 2)] / 1000).toFixed(0)}s  max=${(gaps[gaps.length - 1] / 1000).toFixed(0)}s\n`,
    );
  }

  if (patched === 0) { process.stderr.write('\nnothing to patch\n'); return; }
  if (DRY) {
    process.stderr.write(`\nDRY-RUN: would patch ${patched} cold row(s)\nre-run with --apply to write\n`);
    return;
  }

  // Backup, then atomic replace — the exporter may rewrite this file on its own
  // 10s debounce, and a torn write would take the whole history with it.
  const backup = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, file);
  process.stderr.write(`\nAPPLIED: patched ${patched} cold row(s)\nbackup: ${backup}\n`);
}

async function main() {
  // 1. Every turn that touched a file, per project.
  const turnsByProject = new Map();
  let slugs = [];
  try { slugs = fs.readdirSync(PROJECTS_DIR); } catch {
    process.stderr.write(`ERROR: cannot read ${PROJECTS_DIR}\n`);
    process.exit(2);
  }
  for (const slug of slugs) {
    const dir = path.join(PROJECTS_DIR, slug);
    const project = projectNameFromSlug(slug);
    if (ONLY_PROJECT && project !== ONLY_PROJECT) continue;
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      for (const t of turnsOf(path.join(dir, f))) {
        if (t.ts < SINCE) continue;
        if (!turnsByProject.has(project)) turnsByProject.set(project, []);
        turnsByProject.get(project).push(t);
      }
    }
  }
  const totalTurns = [...turnsByProject.values()].reduce((n, a) => n + a.length, 0);
  process.stderr.write(`transcript turns with files (since ${SINCE}): ${totalTurns}\n`);

  if (COLD) return coldPass(turnsByProject);

  // 2. Observations that still say "Artifacts: none".
  //
  // Paged, because the typed view hard-caps `limit` at 200 (TYPED_VIEW_MAX_LIMIT)
  // and silently returns that many rather than erroring — so a single request
  // asking for 5000 quietly backfills only the newest 200 and reports success.
  const rows = [];
  const PAGE = 200;
  for (let offset = 0; ; offset += PAGE) {
    const url = `${OBS_API}/api/coding/observations?limit=${PAGE}&offset=${offset}&from=${SINCE}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      process.stderr.write(`ERROR: obs-api ${resp.status}\n`);
      process.exit(2);
    }
    const page = (await resp.json()).data || [];
    rows.push(...page);
    if (page.length < PAGE) break;
    if (offset > 50_000) break; // guard against a server that ignores offset
  }
  const candidates = rows.filter((r) => {
    const mf = r.modifiedFiles || r.metadata?.modifiedFiles;
    if (Array.isArray(mf) && mf.length > 0) return false;
    return /Artifacts:\s*none/i.test(r.content || r.summary || '');
  });
  process.stderr.write(`observations saying "Artifacts: none": ${candidates.length} (of ${rows.length})\n`);

  // 3. Pair each candidate with the nearest same-project turn.
  const updates = [];
  for (const row of candidates) {
    const m = filesForRow(turnsByProject, row.project, row.timestamp || row.createdAt);
    if (!m) continue;
    updates.push({ id: row.id, modifiedFiles: m.files, _gapMs: m.gapMs, _project: row.project });
  }
  process.stderr.write(`matched within ${MATCH_WINDOW_MS}ms: ${updates.length}\n\n`);
  for (const u of updates.slice(0, 40)) {
    process.stderr.write(`  ${u._project} +${(u._gapMs / 1000).toFixed(0)}s  ${u.modifiedFiles.join(', ').slice(0, 110)}\n`);
  }
  if (updates.length === 0) { process.stderr.write('\nnothing to patch\n'); return; }

  const r = await fetch(`${OBS_API}/api/observations/patch-artifacts/by-id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      updates: updates.map((u) => ({ id: u.id, modifiedFiles: u.modifiedFiles })),
      dryRun: DRY,
    }),
  });
  const out = await r.json().catch(() => ({}));
  process.stderr.write(`\n${DRY ? 'DRY-RUN' : 'APPLIED'}: ${JSON.stringify(out)}\n`);
  if (DRY) process.stderr.write('re-run with --apply to write\n');
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
