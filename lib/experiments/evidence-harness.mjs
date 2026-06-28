// lib/experiments/evidence-harness.mjs
//
// Phase 73, Plan 73-03 (Wave 1) — D-01 deterministic evidence harness (SCORE-01).
// The judge (73-04) feeds this structured evidence object into the 5-dimension
// rubric. The harness reads ONLY cheap, already-on-disk artifacts for the active
// phase and NEVER runs tests/linters/code-review at scoring time. Every slot is
// fail-soft → null (a dimension with no evidence is null, NOT zero/guessed —
// carries Phase 72 D-02 strict-calibration; see 73-PATTERNS.md §evidence-harness).
//
// Analogs (copied verbatim, 73-PATTERNS.md §evidence-harness):
//   - scripts/measurement-stop.mjs:107-122  locatePlanMd phase-dir resolver
//   - scripts/measurement-stop.mjs:92-98     readArchivedSpan fail-soft idiom
//   - lib/experiments/goal-sentence.mjs      fail-soft on-disk reader style
//
// PURE stdlib (fs + child_process), no km-core, no network, no LLM. The only
// external process is a fixed-argv `git diff --stat` (no shell string, no
// untrusted interpolation — T-73-03-EXEC mitigated by spawning an argv array).
// Diagnostics via process.stderr.write only — the no-console-log rule (CLAUDE.md)
// forbids the stdout/err logging family here.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

/**
 * Best-effort locate the active phase dir under <repoRoot>/.planning/phases for a
 * phase token (number or '73-name' slug). Returns the absolute dir path, or null
 * on any read error / no match. Ported from measurement-stop.mjs:107-122.
 * @param {string} phasesRoot
 * @param {number|string} phaseToken
 * @returns {string|null}
 */
function locatePhaseDir(phasesRoot, phaseToken) {
  try {
    const num = String(phaseToken).trim().match(/^\d+/)?.[0];
    if (!num) return null;
    const dirs = fs.readdirSync(phasesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && new RegExp(`^0*${num}(?:[.-]|$)`).test(d.name))
      .map((d) => d.name)
      .sort();
    if (dirs.length === 0) return null;
    return path.join(phasesRoot, dirs[0]);
  } catch {
    return null;
  }
}

/**
 * Return the FIRST file in `dir` matching `suffixRe` (sorted), or null. Fail-soft:
 * a missing dir / unreadable entry is a normal path (D-01), never an error.
 * @param {string} dir
 * @param {RegExp} suffixRe
 * @returns {string|null}
 */
function firstMatch(dir, suffixRe) {
  try {
    const hit = fs.readdirSync(dir).filter((f) => suffixRe.test(f)).sort();
    return hit.length ? path.join(dir, hit[0]) : null;
  } catch {
    return null;
  }
}

/** Read a file fail-soft → '' (never throws). measurement-stop.mjs:92-98 idiom. */
function readSoft(filePath) {
  if (!filePath) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Parse the VERIFICATION verdict from a *-VERIFICATION.md. Reads either the
 * frontmatter `status:` field or a `**Status:**` header line; normalizes to an
 * upper-case verdict token (PASSED/PASS/FAIL/PARTIAL/GAPS_FOUND/…). null when the
 * file is absent/unreadable or carries no recognizable status marker.
 * @param {string|null} filePath
 * @returns {string|null}
 */
function parseVerification(filePath) {
  const text = readSoft(filePath);
  if (!text) return null;
  // frontmatter `status: passed` OR `**Status:** passed`
  const m = /^\s*(?:\*\*)?status(?:\*\*)?\s*:\s*([A-Za-z_]+)/im.exec(text);
  if (m) return m[1].trim().toUpperCase();
  // bare PASS/FAIL/PARTIAL verdict header anywhere in the doc
  const v = /\b(PASS(?:ED)?|FAIL(?:ED)?|PARTIAL|GAPS_FOUND)\b/.exec(text);
  return v ? v[1].toUpperCase() : null;
}

/**
 * Count review findings in a *-REVIEW.md. Prefers the frontmatter `total:` count
 * line under `findings:`; falls back to summing `critical/warning/info` count
 * lines. null when the file is absent/unreadable or carries no count.
 * @param {string|null} filePath
 * @returns {number|null}
 */
function parseReviewFindings(filePath) {
  const text = readSoft(filePath);
  if (!text) return null;
  const total = /^\s*total\s*:\s*(\d+)/im.exec(text);
  if (total) return Number(total[1]);
  // sum the severity buckets when no explicit total line exists
  const buckets = ['critical', 'warning', 'info']
    .map((k) => new RegExp(`^\\s*${k}\\s*:\\s*(\\d+)`, 'im').exec(text))
    .filter(Boolean)
    .map((mm) => Number(mm[1]));
  if (buckets.length === 0) return null;
  return buckets.reduce((a, b) => a + b, 0);
}

/**
 * Parse a pass/fail summary from EXISTING test output on disk (D-01: NEVER run
 * tests). Recognizes the node:test TAP summary (`# pass N` / `# fail N`) and the
 * mocha-style `N passing` / `M failing` lines. null when no test-output artifact
 * exists or no counts are parseable.
 * @param {string} phaseDir
 * @returns {{passed:number, failed:number}|null}
 */
function parseTestSummary(phaseDir) {
  const file = firstMatch(phaseDir, /(?:TEST|test-output|test-results)[^/]*\.(?:md|txt|log|tap)$/i);
  const text = readSoft(file);
  if (!text) return null;
  let passed = null;
  let failed = null;
  const tapPass = /^#\s*pass\s+(\d+)/im.exec(text);
  const tapFail = /^#\s*fail\s+(\d+)/im.exec(text);
  if (tapPass) passed = Number(tapPass[1]);
  if (tapFail) failed = Number(tapFail[1]);
  if (passed === null) {
    const mp = /(\d+)\s+passing/i.exec(text);
    if (mp) passed = Number(mp[1]);
  }
  if (failed === null) {
    const mf = /(\d+)\s+failing/i.exec(text);
    if (mf) failed = Number(mf[1]);
  }
  if (passed === null && failed === null) return null;
  return { passed: passed ?? 0, failed: failed ?? 0 };
}

/**
 * Run `git diff --stat` (a cheap READ, not a test run) with a fixed argv array so
 * no shell string / untrusted flag is interpolated (T-73-03-EXEC mitigation).
 * Returns the trimmed stdout string, or null on non-zero exit / spawn throw.
 * @param {string} repoRoot
 * @returns {string|null}
 */
function readDiffStat(repoRoot) {
  try {
    const res = spawnSync('git', ['diff', '--stat'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return null;
    const out = res.stdout.trim();
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Extract the PLAN.md task list (task names) for spec_drift scoring. Prefers
 * `<name>…</name>` entries inside `<task>` blocks; falls back to bare
 * `<task>text</task>` content. Returns a non-empty array of trimmed names, or
 * null when the file is absent/unreadable or carries no task markers.
 * @param {string|null} filePath
 * @returns {string[]|null}
 */
function parsePlanTasks(filePath) {
  const text = readSoft(filePath);
  if (!text) return null;
  const names = [];
  const nameRe = /<name>\s*([^<]+?)\s*<\/name>/gi;
  let m;
  while ((m = nameRe.exec(text)) !== null) names.push(m[1].trim());
  if (names.length === 0) {
    const bareRe = /<task[^>]*>\s*([^<]+?)\s*<\/task>/gi;
    while ((m = bareRe.exec(text)) !== null) names.push(m[1].trim());
  }
  return names.length ? names : null;
}

/**
 * Gather the deterministic, on-disk evidence object for the active phase (D-01).
 * Reads VERIFICATION/REVIEW/PLAN artifacts + a `git diff --stat` + any existing
 * test-output summary. NEVER runs tests/linters/review. Every slot is fail-soft to
 * null (absent evidence is null, NOT zero/guessed). NEVER throws.
 *
 * @param {object} opts
 * @param {object}        [opts.span]      - archived span (unused stub for the judge seam; reserved).
 * @param {number|string} opts.phaseArg    - phase number/slug locating the phase dir.
 * @param {string}        [opts.repoRoot]  - repo root (defaults to CODING_REPO / hardcoded REPO_ROOT).
 * @returns {{verification:string|null, reviewFindings:number|null,
 *           testSummary:{passed:number,failed:number}|null, diffStat:string|null,
 *           planTasks:string[]|null}}
 */
export function gatherEvidence({ span, phaseArg, repoRoot } = {}) {
  const root = repoRoot || REPO_ROOT;
  const phasesRoot = path.join(root, '.planning', 'phases');
  const phaseDir = locatePhaseDir(phasesRoot, phaseArg);

  if (!phaseDir) {
    // No phase dir → every on-disk slot is null; diffStat is still a valid read.
    return {
      verification: null,
      reviewFindings: null,
      testSummary: null,
      diffStat: readDiffStat(root),
      planTasks: null,
    };
  }

  return {
    verification: parseVerification(firstMatch(phaseDir, /-VERIFICATION\.md$/)),
    reviewFindings: parseReviewFindings(firstMatch(phaseDir, /-REVIEW\.md$/)),
    testSummary: parseTestSummary(phaseDir),
    diffStat: readDiffStat(root),
    planTasks: parsePlanTasks(firstMatch(phaseDir, /-PLAN\.md$/)),
  };
}
