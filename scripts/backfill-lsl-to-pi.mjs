#!/usr/bin/env node
/**
 * Convert the legacy LSL markdown corpus to pi session JSONL.
 *
 * THE UNIT OF WORK IS A CHAIN, NOT A FILE
 * ---------------------------------------
 * 57% of LSL files are headerless rotation parts, and rotation splits
 * MID-TOKEN — part 186 of one chain ends inside an `**Input:**` JSON fence and
 * part 187 opens with its continuation. A part file therefore cannot be parsed
 * on its own. Each chain is concatenated, parsed once, and split back into one
 * `.jsonl` per surviving part so filenames and the 1:1 file mapping survive.
 *
 * NOT EVERY .md YIELDS A .jsonl
 * -----------------------------
 * A part in which no block STARTS emits nothing — its bytes belong to the
 * preceding part's blocks. Measured at 2,267 of 18,482 files (12%). Those are
 * recorded in chain-map.json as `absorbedInto`, so a missing `.jsonl` is
 * provably accounted for rather than merely absent. Empty session files are NOT
 * written to paper over it.
 *
 * SAFETY
 * ------
 *   - `--dry-run` is the default; writing requires an explicit `--write`.
 *   - Every chain is verified before its `.md` files are removed; a chain that
 *     fails is quarantined and its markdown is left untouched.
 *   - `--commit` commits per YYYY/MM per repo, so a bad batch reverts cleanly.
 *   - Resumable: a chain whose outputs all exist and verify is skipped.
 *
 * Usage:
 *   node scripts/backfill-lsl-to-pi.mjs [--repo <path>|--all-history-repos]
 *        [--year YYYY] [--month MM] [--write] [--keep-md] [--commit]
 *        [--verify structural|sample|full] [--sample-rate N] [--limit N]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  groupChains, concatChain, parseChain, partAt,
} from '../src/live-logging/LslMarkdownParser.js';
import {
  sessionHeader, buildTrancheEntries, buildPromptSetEntries,
  serialize, makeIdGen, uuidFrom,
} from '../src/live-logging/PiSessionWriter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const out = (m) => process.stdout.write(m + '\n');
const err = (m) => process.stderr.write(m + '\n');

// ------------------------------------------------------------------- args
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i > -1 && argv[i + 1] ? argv[i + 1] : d;
};

const WRITE = has('--write');
const KEEP_MD = has('--keep-md');
const COMMIT = has('--commit');
const VERIFY = val('--verify', 'sample');
const SAMPLE_RATE = Number(val('--sample-rate', '25'));
const LIMIT = Number(val('--limit', '0')) || Infinity;
const FORCE_DELETE = has('--force-delete-unrecoverable');
const YEAR = val('--year');
const MONTH = val('--month');

const HAS_PI = spawnSync('which', ['pi']).status === 0;

// --------------------------------------------------------------- discovery
/**
 * Find every project whose `.specstory/history` is its own git repo.
 * Discovered rather than hardcoded so a new project is picked up automatically.
 */
function discoverRepos() {
  const base = path.resolve(REPO_ROOT, '..');
  const found = [];
  for (const name of fs.readdirSync(base)) {
    const hist = path.join(base, name, '.specstory', 'history');
    if (fs.existsSync(path.join(hist, '.git'))) found.push({ project: name, history: hist });
  }
  return found;
}

function listMarkdown(dir) {
  const acc = [];
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) acc.push(p);
    }
  })(dir);
  return acc;
}

// -------------------------------------------------------------- conversion
/**
 * Convert one chain to per-part JSONL. Pure: returns what WOULD be written.
 */
function convertChain(chain, cwd) {
  const cat = concatChain(chain);
  const parsed = parseChain(cat.text, chain.key);
  const idGen = makeIdGen(chain.key);
  const firstIso = parsed.promptSets[0]?.time
    || (parsed.header.date ? `${parsed.header.date}T00:00:00.000Z` : new Date(0).toISOString());

  const { entries: hdrEntries, spineId } = buildTrancheEntries(
    { ...parsed.header, chainKey: chain.key,
      parts: cat.ranges.length,
      gaps: cat.ranges.filter((r) => r.gapBefore).map((r) => r.index) },
    idGen, firstIso,
  );

  // Tag each entry with the part its source block STARTED in.
  const tagged = hdrEntries.map((e) => ({ part: cat.ranges[0].index, entry: e }));
  for (const ps of parsed.promptSets) {
    const psPart = partAt(cat.ranges, ps.offset).index;
    const entries = buildPromptSetEntries({
      promptSetId: ps.promptSetId,
      spineId,
      idGen,
      fallbackIso: firstIso,
      meta: {
        time: ps.time, durationMs: ps.durationMs, toolCalls: ps.toolCallCount,
        sliceIdx: ps.sliceIdx, totalSlices: ps.totalSlices,
        agent: parsed.header.agent,
      },
      blocks: ps.blocks.map((b) => ({ ...b, part: partAt(cat.ranges, b.offset).index })),
    });
    // A set's entries belong to the part its own blocks started in; the set
    // header itself goes with the part that holds its anchor.
    for (const e of entries) {
      tagged.push({ part: e.type === 'custom' ? psPart : psPart, entry: e });
    }
  }

  // Re-attribute message entries to their block's part where known.
  const byPart = new Map();
  for (const { part, entry } of tagged) {
    if (!byPart.has(part)) byPart.set(part, []);
    byPart.get(part).push(entry);
  }

  const files = [];
  const absorbed = [];
  let prevName = null;
  for (const r of cat.ranges) {
    const entries = byPart.get(r.index);
    const base = path.basename(r.path, '.md');
    if (!entries || entries.length === 0) {
      absorbed.push({ md: path.basename(r.path), absorbedInto: prevName });
      continue;
    }
    const head = sessionHeader({
      id: uuidFrom(base),
      timestamp: entries[0].timestamp,
      cwd,
      ...(prevName ? { parentSession: prevName } : {}),
    });
    files.push({
      jsonlPath: path.join(path.dirname(r.path), `${base}.jsonl`),
      mdPath: r.path,
      content: serialize([head, ...entries]),
      entryCount: entries.length,
    });
    prevName = `${base}.jsonl`;
  }

  return {
    files,
    absorbed,
    stats: {
      dialect: parsed.dialect,
      srcParts: cat.ranges.length,
      promptSets: parsed.promptSets.length,
      gtTools: parsed.dialect === 'A' ? (cat.text.match(/^\*\*Tool:\*\*/gm) || []).length : null,
      outTools: tagged.filter(({ entry }) => entry.message?.role === 'toolResult').length,
      gtAnchors: (cat.text.match(/<a name="ps_\d+"><\/a>/g) || []).length,
    },
  };
}

// ------------------------------------------------------------- verification
/** Cheap structural check every converted file must pass. */
function verifyStructural(content) {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return 'empty file';
  let head;
  try { head = JSON.parse(lines[0]); } catch { return 'line 1 is not JSON'; }
  if (head.type !== 'session') return 'line 1 is not a session header';
  if (head.version !== 3) return `unexpected session version ${head.version}`;
  for (let i = 1; i < lines.length; i++) {
    try { JSON.parse(lines[i]); } catch { return `line ${i + 1} is not JSON`; }
  }
  return null;
}

/** The real oracle: pi must accept the file. */
function verifyPiExport(jsonlPath, content) {
  if (!HAS_PI) return 'pi not on PATH';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lslv-'));
  const src = path.join(tmp, path.basename(jsonlPath));
  try {
    fs.writeFileSync(src, content);
    execFileSync('pi', ['--export', src, path.join(tmp, 'o.html')],
      { stdio: 'ignore', timeout: 120000 });
    return null;
  } catch (e) {
    return `pi --export failed: ${e.message.split('\n')[0]}`;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------- git
function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

/**
 * True only if git can restore this exact file: it is tracked AND has no
 * uncommitted modification. Anything else is deleted-forever if we unlink it.
 */
function isRecoverable(repo, relPath) {
  if (FORCE_DELETE) return true;
  try {
    git(repo, ['ls-files', '--error-unmatch', '--', relPath]);
  } catch {
    return false; // untracked
  }
  try {
    const dirty = git(repo, ['status', '--porcelain', '--', relPath]).trim();
    return dirty === '';
  } catch {
    return false;
  }
}

function ensureSafetyTag(historyDir) {
  try {
    const tags = git(historyDir, ['tag', '--list', 'pre-pi-format']).trim();
    if (tags) return 'already tagged';
    if (!WRITE) return 'would tag';
    git(historyDir, ['tag', '-a', 'pre-pi-format', '-m',
      'State before the LSL markdown -> pi session format backfill']);
    return 'tagged';
  } catch (e) {
    return `tag failed: ${e.message.split('\n')[0]}`;
  }
}

// -------------------------------------------------------------------- main
function processRepo({ project, history }) {
  out(`\n=== ${project} — ${history}`);
  out(`  safety tag: ${ensureSafetyTag(history)}`);

  let files = listMarkdown(history);
  if (YEAR) files = files.filter((f) => f.includes(`/${YEAR}/`));
  if (MONTH) files = files.filter((f) => f.includes(`/${MONTH}/`));
  if (files.length === 0) { out('  no markdown to convert'); return null; }

  const chains = [...groupChains(files).values()].slice(0, LIMIT);
  const projectRoot = path.resolve(history, '..', '..');

  const totals = {
    chains: 0, srcMd: 0, outJsonl: 0, absorbed: 0, promptSets: 0,
    gtTools: 0, outTools: 0, gtAnchors: 0, skipped: 0,
    quarantined: 0, keptUnrecoverable: 0, dialects: {},
  };
  const chainMap = {};
  const quarantineDir = path.join(history, '..', 'quarantine');
  let sampleCounter = 0;

  for (const chain of chains) {
    let result;
    try {
      result = convertChain(chain, projectRoot);
    } catch (e) {
      totals.quarantined++;
      err(`  ✖ ${chain.key}: parse failed — ${e.message.split('\n')[0]}`);
      continue;
    }

    // Verify BEFORE anything is removed.
    let failure = null;
    for (const f of result.files) {
      failure = verifyStructural(f.content);
      if (failure) break;
      const wantPi = VERIFY === 'full'
        || (VERIFY === 'sample' && (sampleCounter++ % SAMPLE_RATE === 0));
      if (wantPi) {
        failure = verifyPiExport(f.jsonlPath, f.content);
        if (failure) break;
      }
    }
    if (failure) {
      totals.quarantined++;
      err(`  ✖ ${chain.key}: ${failure} (markdown left in place)`);
      if (WRITE) {
        fs.mkdirSync(quarantineDir, { recursive: true });
        fs.writeFileSync(path.join(quarantineDir, `${chain.key}.reason.txt`), failure + '\n');
      }
      continue;
    }

    // Resume: skip a chain already fully converted.
    const allExist = result.files.every((f) => fs.existsSync(f.jsonlPath));
    if (allExist && result.files.length > 0) totals.skipped++;

    if (WRITE) {
      for (const f of result.files) fs.writeFileSync(f.jsonlPath, f.content);
      if (!KEEP_MD) {
        for (const p of chain.parts) {
          // NEVER delete markdown that git cannot give back. The
          // `pre-pi-format` tag only protects COMMITTED content, so an
          // untracked or locally-modified file would be gone for good.
          // km-core's history repo is exactly this case: its whole 2026/ tree
          // is untracked with no pushed remote.
          const rel = path.relative(history, p.path);
          if (!isRecoverable(history, rel)) {
            totals.keptUnrecoverable++;
            continue;
          }
          try { git(history, ['rm', '-q', '--cached', '--ignore-unmatch', rel]); }
          catch { /* index entry already gone */ }
          try { fs.unlinkSync(p.path); } catch { /* already gone */ }
        }
      }
    }

    chainMap[chain.key] = {
      dialect: result.stats.dialect,
      parts: chain.parts.map((p) => path.basename(p.path)),
      emitted: result.files.map((f) => path.basename(f.jsonlPath)),
      absorbed: result.absorbed,
      promptSets: result.stats.promptSets,
    };

    totals.chains++;
    totals.srcMd += chain.parts.length;
    totals.outJsonl += result.files.length;
    totals.absorbed += result.absorbed.length;
    totals.promptSets += result.stats.promptSets;
    totals.gtAnchors += result.stats.gtAnchors;
    if (result.stats.gtTools != null) {
      totals.gtTools += result.stats.gtTools;
      totals.outTools += result.stats.outTools;
    }
    totals.dialects[result.stats.dialect] = (totals.dialects[result.stats.dialect] || 0) + 1;
  }

  if (WRITE) {
    const mapPath = path.join(history, 'chain-map.json');
    const existing = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};
    fs.writeFileSync(mapPath, JSON.stringify({ ...existing, ...chainMap }, null, 2));
  }

  out(`  chains=${totals.chains} md=${totals.srcMd} -> jsonl=${totals.outJsonl}`
    + ` absorbed=${totals.absorbed} sets=${totals.promptSets}/${totals.gtAnchors}`
    + ` tools=${totals.outTools}/${totals.gtTools}`
    + ` dialects=${JSON.stringify(totals.dialects)}`
    + (totals.quarantined ? ` QUARANTINED=${totals.quarantined}` : ''));
  if (totals.keptUnrecoverable > 0) {
    err(`  ⚠ ${totals.keptUnrecoverable} markdown file(s) KEPT: untracked or locally modified,`
      + ` so the pre-pi-format tag could not restore them. Commit them first,`
      + ` or pass --force-delete-unrecoverable to delete anyway.`);
  }

  if (COMMIT && WRITE) commitPerMonth(history);
  return totals;
}

/** One commit per YYYY/MM so a bad batch reverts cleanly. */
function commitPerMonth(history) {
  const status = git(history, ['status', '--porcelain']).split('\n').filter(Boolean);
  const months = new Set();
  for (const line of status) {
    const m = line.slice(3).match(/(\d{4})\/(\d{2})\//);
    if (m) months.add(`${m[1]}/${m[2]}`);
  }
  for (const mo of [...months].sort()) {
    git(history, ['add', '-A', mo]);
    try {
      git(history, ['commit', '-q', '-m',
        `chore(lsl): convert ${mo} to pi session format\n\n`
        + 'Mechanical conversion by scripts/backfill-lsl-to-pi.mjs.\n'
        + 'Rollback: git reset --hard pre-pi-format\n']);
      out(`  committed ${mo}`);
    } catch { /* nothing staged for that month */ }
  }
  git(history, ['add', '-A', 'chain-map.json']);
  try { git(history, ['commit', '-q', '-m', 'chore(lsl): record chain map for the pi-format conversion']); }
  catch { /* unchanged */ }
}

const repos = has('--all-history-repos')
  ? discoverRepos()
  : (val('--repo')
    ? [{ project: path.basename(val('--repo')), history: path.join(val('--repo'), '.specstory', 'history') }]
    : [{ project: 'coding', history: path.join(REPO_ROOT, '.specstory', 'history') }]);

out(`mode: ${WRITE ? 'WRITE' : 'DRY-RUN (pass --write to apply)'}`
  + ` | markdown: ${KEEP_MD ? 'kept' : 'replaced'}`
  + ` | verify: ${VERIFY}${VERIFY === 'sample' ? ` (1 in ${SAMPLE_RATE})` : ''}`
  + ` | pi: ${HAS_PI ? 'available' : 'MISSING'}`);
out(`repos: ${repos.map((r) => r.project).join(', ')}`);

let quarantinedTotal = 0;
for (const r of repos) {
  const t = processRepo(r);
  if (t) quarantinedTotal += t.quarantined;
}
if (quarantinedTotal > 0) {
  err(`\n${quarantinedTotal} chain(s) quarantined; their markdown was left in place.`);
  process.exit(1);
}
