#!/usr/bin/env node

/**
 * scripts/backfill-lsl-rotation.mjs
 *
 * Backfill helper for the LSL `-N` part-file rotation regression
 * (commit 83ff21fd5). Pre-fix, the ETM picker only consulted current
 * file size — never the size of the upcoming write — so a single fat
 * slice append could grow a file from 50KB → 800KB in one shot. Worst
 * observed: a 9.8MB single file (`...1600-1700-99_c197ef.md`).
 *
 * This script finds every oversized LSL file under
 * `.specstory/history/{YYYY}/{MM}/` and splits it at prompt-set anchor
 * boundaries (`<a name="ps_*">`) into multiple ≤maxSizeBytes parts named
 * `<base>.md`, `<base>-1.md`, `<base>-2.md`, ... matching the ETM's
 * forward-flowing naming convention.
 *
 * Algorithm (per hourly slot):
 *   1. Collect all files for the slot (base + existing -N parts).
 *   2. Parse the header from the first file.
 *   3. Concatenate the anchor blocks across all files (anchor block =
 *      `<a name="ps_*">` ... up to next `<a name=` or EOF).
 *   4. Pack blocks into output files: each file = header + packed blocks
 *      such that total ≤ maxSizeBytes. Greedy: add blocks until the next
 *      would push over the limit, then start a new file.
 *   5. Write new files; delete leftover originals not used as outputs.
 *
 * Modes:
 *   default      DRY-RUN: print the operation plan, write nothing.
 *   --apply      Execute the plan against disk.
 *   --max-kb=N   Override maxSizeKB (default: 200, matching
 *                config/live-logging-config.json max_lsl_file_size_kb).
 *   --root=PATH  Override `.specstory/history/` root (for testing).
 *   --year=YYYY  Limit scan to one year (e.g. --year=2026).
 *
 * Safety:
 *   - Originals are backed up to `<base>.lsl-rotation-backup-<ISO>.md.bak`
 *     before any rewrite. Backups can be deleted manually once the new
 *     parts look correct.
 *   - A single anchor block > maxSizeBytes is written to its own file
 *     (we accept one oversized part rather than corrupt markdown by
 *     splitting mid-anchor — matches the post-fix ETM contract).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MAX_KB = (() => {
  const a = args.find((x) => x.startsWith('--max-kb='));
  return a ? Number(a.slice('--max-kb='.length)) : 200;
})();
const ROOT = (() => {
  const a = args.find((x) => x.startsWith('--root='));
  return a ? path.resolve(a.slice('--root='.length)) : path.join(REPO_ROOT, '.specstory', 'history');
})();
const YEAR_FILTER = (() => {
  const a = args.find((x) => x.startsWith('--year='));
  return a ? a.slice('--year='.length) : null;
})();

const MAX_BYTES = MAX_KB * 1024;
const TS_BACKUP = new Date().toISOString().replace(/[:.]/g, '-');

// ---- LSL filename parsing --------------------------------------------------
// Shape:
//   {YYYY-MM-DD}_{HHMM-HHMM}[_{HHMM-HHMM-N}]_{hash}.md           (base or part)
//   2026-05-01_1100-1200_c197ef.md          (base)
//   2026-05-01_1100-1200-35_c197ef.md       (part 35)
//   2026-05-23_1100-1200_S2-1-abc1234.md    (sub-agent LSL — skip)
const BASE_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{4})_([a-z0-9]+)\.md$/i;
const PART_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{4})-(\d+)_([a-z0-9]+)\.md$/i;
const SUBAGENT_RE = /_S\d+-\d+-[a-f0-9]+\.md$/i;

function parseLslName(name) {
  if (SUBAGENT_RE.test(name)) return null;  // skip Phase 51 sub-agent LSLs
  let m = name.match(PART_RE);
  if (m) return { date: m[1], slot: m[2], part: Number(m[3]), hash: m[4], name };
  m = name.match(BASE_RE);
  if (m) return { date: m[1], slot: m[2], part: 0, hash: m[3], name };
  return null;
}

function lslFilename({ date, slot, part, hash }) {
  if (part === 0) return `${date}_${slot}_${hash}.md`;
  return `${date}_${slot}-${part}_${hash}.md`;
}

// ---- File parsing ----------------------------------------------------------

// The header ends just before the first `<a name="ps_` anchor. Everything
// from there to EOF is the body of one or more anchor blocks.
function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstAnchorIdx = content.indexOf('<a name="ps_');
  let header;
  let body;
  if (firstAnchorIdx < 0) {
    // No anchors — entire file is "header" (no blocks to redistribute).
    header = content;
    body = '';
  } else {
    header = content.slice(0, firstAnchorIdx);
    body = content.slice(firstAnchorIdx);
  }
  return { header, body, totalLen: content.length };
}

// Split a body into individual anchor blocks. Each block starts at
// `<a name="ps_..."` and runs until the next `<a name=` or EOF.
function splitAnchorBlocks(body) {
  if (!body) return [];
  const re = /<a name="ps_/g;
  const positions = [];
  let m;
  while ((m = re.exec(body)) !== null) positions.push(m.index);
  if (positions.length === 0) return [body];  // no anchors but non-empty body — single block
  const blocks = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : body.length;
    blocks.push(body.slice(start, end));
  }
  return blocks;
}

// Pack blocks into output files. Each output file = header + concatenated
// blocks, total ≤ maxBytes (unless a single block exceeds maxBytes — that
// block gets its own file, accepting the overage to preserve markdown
// integrity).
function packBlocks(header, blocks, maxBytes) {
  const outputs = [];
  let current = header;
  for (const block of blocks) {
    const candidateLen = current.length + block.length;
    if (current === header || candidateLen <= maxBytes) {
      current += block;
    } else {
      outputs.push(current);
      current = header + block;
    }
  }
  if (current.length > header.length) outputs.push(current);
  return outputs;
}

// ---- Scan + plan ------------------------------------------------------------

function listFilesRecursive(dir) {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) entries.push(...listFilesRecursive(full));
    else if (item.isFile() && item.name.endsWith('.md')) entries.push(full);
  }
  return entries;
}

function groupBySlot(files) {
  const groups = new Map();
  for (const filePath of files) {
    const name = path.basename(filePath);
    const parsed = parseLslName(name);
    if (!parsed) continue;
    const key = `${parsed.date}|${parsed.slot}|${parsed.hash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...parsed, filePath });
  }
  // sort each group by part number
  for (const g of groups.values()) g.sort((a, b) => a.part - b.part);
  return groups;
}

// ---- Main ------------------------------------------------------------------

function main() {
  if (!fs.existsSync(ROOT)) {
    process.stderr.write(`ERROR: history root not found: ${ROOT}\n`);
    process.exit(1);
  }

  const all = listFilesRecursive(ROOT)
    .filter((p) => !YEAR_FILTER || p.includes(`/${YEAR_FILTER}/`));
  const groups = groupBySlot(all);

  const plans = [];
  let totalOversizedFiles = 0;
  let totalOversizedBytes = 0;
  let skippedSlots = 0;

  for (const [key, group] of groups.entries()) {
    const oversizedInGroup = group.filter((g) => fs.statSync(g.filePath).size > MAX_BYTES);
    if (oversizedInGroup.length === 0) continue;

    // Build the plan: read all files in slot order, packed by anchor blocks.
    const headerSource = parseFile(group[0].filePath);
    const header = headerSource.header;

    const allBlocks = [];
    for (const g of group) {
      const { body } = parseFile(g.filePath);
      const blocks = splitAnchorBlocks(body);
      allBlocks.push(...blocks);
    }

    // If there are zero blocks (header-only files), nothing to redistribute;
    // such files won't be oversized anyway.
    if (allBlocks.length === 0) continue;

    // ---- Safety check — duplicate-anchor detection -----------------------
    // The 2026-01 bulk-imported files have severe duplication: the same ps_id
    // appears in dozens of part files. Concatenating + resplitting would
    // PRESERVE the duplicates (we'd just pack them differently). That's not
    // a useful outcome — the underlying data was broken before this script
    // ever ran. Skip such slots; they need a different (dedup) pass.
    //
    // Detection: extract ps_id from each block via the `ps_<unix-ms>` token
    // immediately after `<a name="`. If unique-count < total-count, the slot
    // contains duplicates and we skip it with a warning.
    const psIds = allBlocks
      .map((b) => (b.match(/<a name="(ps_[^"]+)"/) || [])[1])
      .filter(Boolean);
    const uniquePs = new Set(psIds);
    if (psIds.length > 0 && uniquePs.size < psIds.length) {
      process.stderr.write(
        `⚠ Skipping slot ${key}: ${psIds.length - uniquePs.size} duplicate ps_id(s) across ${group.length} file(s) — likely bulk-import legacy, needs a dedup pass not a resplit pass.\n`,
      );
      skippedSlots++;
      continue;
    }

    // Counted AFTER safety check — only files we'll actually touch.
    totalOversizedFiles += oversizedInGroup.length;
    totalOversizedBytes += oversizedInGroup.reduce((s, g) => s + fs.statSync(g.filePath).size, 0);

    const packed = packBlocks(header, allBlocks, MAX_BYTES);

    // Map packed[i] → output filename (i=0 base, i=1 -1, etc.)
    const dir = path.dirname(group[0].filePath);
    const outputs = packed.map((content, i) => ({
      filePath: path.join(dir, lslFilename({
        date: group[0].date, slot: group[0].slot,
        part: i, hash: group[0].hash,
      })),
      content,
      size: content.length,
    }));

    // Files that will be removed: any input file whose path is NOT one of
    // the outputs. (Outputs may overwrite same paths as inputs.)
    const outputPaths = new Set(outputs.map((o) => o.filePath));
    const toDelete = group.filter((g) => !outputPaths.has(g.filePath)).map((g) => g.filePath);

    plans.push({
      key,
      slot: `${group[0].date} ${group[0].slot}`,
      inputs: group.map((g) => ({ name: g.name, size: fs.statSync(g.filePath).size })),
      outputs: outputs.map((o) => ({ name: path.basename(o.filePath), size: o.size })),
      toDelete: toDelete.map((p) => path.basename(p)),
      _outputs: outputs,
      _toDelete: toDelete,
      _group: group,
    });
  }

  // ---- Report -------------------------------------------------------------
  process.stdout.write(`\nLSL rotation backfill — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  process.stdout.write(`  root:     ${ROOT}\n`);
  process.stdout.write(`  max:      ${MAX_KB}KB\n`);
  process.stdout.write(`  year:     ${YEAR_FILTER || '(all)'}\n`);
  process.stdout.write(`  groups:   ${plans.length} (after safety filter)\n`);
  process.stdout.write(`  skipped:  ${skippedSlots} slot(s) with duplicate ps_ids (bulk-import legacy)\n`);
  process.stdout.write(`  to process: ${totalOversizedFiles} oversized file(s) totaling ${(totalOversizedBytes/1024/1024).toFixed(1)}MB\n\n`);

  if (plans.length === 0) {
    process.stdout.write('Nothing to do — no oversized files detected.\n');
    return;
  }

  // Top-10 summary
  const sorted = plans.slice().sort((a, b) =>
    Math.max(...b.inputs.map((i) => i.size)) - Math.max(...a.inputs.map((i) => i.size)),
  );
  process.stdout.write('Top 10 by largest input file:\n');
  for (const p of sorted.slice(0, 10)) {
    const maxIn = Math.max(...p.inputs.map((i) => i.size));
    process.stdout.write(`  ${p.slot}: ${p.inputs.length} input(s), max ${(maxIn/1024).toFixed(0)}KB → ${p.outputs.length} output(s)`);
    if (p.toDelete.length) process.stdout.write(`, ${p.toDelete.length} to delete`);
    process.stdout.write('\n');
  }
  process.stdout.write('\n');

  // ---- Apply --------------------------------------------------------------
  if (!APPLY) {
    process.stdout.write('Re-run with --apply to execute. Backups will be written to <orig>.lsl-rotation-backup-<ISO>.md.bak before rewriting.\n');
    return;
  }

  let rewroteCount = 0;
  let deletedCount = 0;
  let backedUpCount = 0;
  let writtenBytes = 0;
  for (const plan of plans) {
    // Backup originals
    for (const g of plan._group) {
      const bak = `${g.filePath}.lsl-rotation-backup-${TS_BACKUP}.bak`;
      fs.copyFileSync(g.filePath, bak);
      backedUpCount++;
    }

    // Write new outputs
    for (const out of plan._outputs) {
      fs.writeFileSync(out.filePath, out.content);
      rewroteCount++;
      writtenBytes += out.content.length;
    }

    // Delete leftover inputs not used as outputs
    for (const oldPath of plan._toDelete) {
      fs.unlinkSync(oldPath);
      deletedCount++;
    }
  }

  process.stdout.write(`Applied:\n`);
  process.stdout.write(`  files backed up: ${backedUpCount}\n`);
  process.stdout.write(`  files written:   ${rewroteCount} (${(writtenBytes/1024/1024).toFixed(1)}MB)\n`);
  process.stdout.write(`  files deleted:   ${deletedCount}\n`);
  process.stdout.write(`\nNext: verify the new files look right, then optionally remove the .lsl-rotation-backup-${TS_BACKUP}.bak files.\n`);
}

main();
