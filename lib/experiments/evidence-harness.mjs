// lib/experiments/evidence-harness.mjs
//
// Phase 73, Plan 73-03 (Wave 1) — D-01 deterministic evidence harness (SCORE-01).
// The judge (73-04) feeds this structured evidence object into the 5-dimension
// rubric. The harness reads cheap, already-on-disk GSD artifacts for the active
// phase. Phase 76 / Plan 76-03 (VALID-03, D-08) deliberately and honestly relaxes
// the original "NEVER runs tests at scoring time" rule for the NON-GSD case: when
// VERIFICATION.md/REVIEW.md are absent the judge has null evidence for
// code_quality/test_coverage/regressions, so the harness now DERIVES those three
// deterministically — (a) the working-tree diff (`git diff --stat`) → a
// code_quality signal, and (b) running the task's test command (fail-soft, bounded)
// → test_coverage/regressions from the exit code + parsed pass/fail counts. These
// three dims are computed here, NOT by the LLM judge (D-08 security note), and
// overlaid onto the judgment (gap-fill only) by the two score consumers. Every slot
// stays fail-soft → null: a dimension with no signal is null, NEVER zero/guessed
// (Phase 72 D-02 strict-calibration; D-10/D-11 — null ONLY when genuinely no signal
// exists, not merely because GSD files are absent). See 73-PATTERNS.md
// §evidence-harness + 76-CONTEXT.md D-08..D-11.
//
// Analogs (copied verbatim, 73-PATTERNS.md §evidence-harness):
//   - scripts/measurement-stop.mjs:107-122  locatePlanMd phase-dir resolver
//   - scripts/measurement-stop.mjs:92-98     readArchivedSpan fail-soft idiom
//   - lib/experiments/goal-sentence.mjs      fail-soft on-disk reader style
//
// PURE stdlib (fs + child_process), no km-core, no network, no LLM. Every external
// process — `git diff --stat` AND the task's test command — is spawned with a FIXED
// ARGV ARRAY (no shell string, the child_process `shell` option is never set, no
// untrusted interpolation:
// T-73-03-EXEC / T-76-03-EXEC / T-76-03-INJ mitigated). A run-metadata test_command
// that would require shell interpretation is REJECTED → null rather than executed.
// Diagnostics via process.stderr.write only — the no-console-log rule (CLAUDE.md)
// forbids the stdout/err logging family here.
import fs from 'node:fs';
import os from 'node:os';
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
 * Parse a pass/fail summary out of arbitrary test-runner output text. Recognizes
 * the node:test TAP summary (`# pass N` / `# fail N`), the node:test spec-reporter
 * summary (`ℹ pass N` / `ℹ fail N` — the default when stdout is not a TTY on newer
 * node), and the mocha-style `N passing` / `M failing` lines. null when the text is
 * empty or no counts are parseable (fail-soft — an unrecognized runner is a null
 * signal, never a guess).
 * @param {string} text
 * @returns {{passed:number, failed:number}|null}
 */
function parseTestCounts(text) {
  if (typeof text !== 'string' || !text) return null;
  let passed = null;
  let failed = null;
  // node:test TAP (`# pass N`) OR spec-reporter (`ℹ pass N`) summary line.
  const tapPass = /^\s*(?:#|ℹ)\s*pass\s+(\d+)/im.exec(text);
  const tapFail = /^\s*(?:#|ℹ)\s*fail\s+(\d+)/im.exec(text);
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
 * Parse a pass/fail summary from EXISTING test output on disk (a GSD artifact — this
 * reader NEVER runs anything). Delegates the count-parsing to parseTestCounts. null
 * when no test-output artifact exists or no counts are parseable.
 * @param {string} phaseDir
 * @returns {{passed:number, failed:number}|null}
 */
function parseTestSummary(phaseDir) {
  const file = firstMatch(phaseDir, /(?:TEST|test-output|test-results)[^/]*\.(?:md|txt|log|tap)$/i);
  return parseTestCounts(readSoft(file));
}

// Per-process counter for scratch-index filenames (avoids Date.now(); unique within a run).
let __diffStatSeq = 0;

/**
 * Run `git diff --stat` (a cheap READ, not a test run) with a fixed argv array so
 * no shell string / untrusted flag is interpolated (T-73-03-EXEC mitigation).
 * Returns the trimmed stdout string, or null on non-zero exit / spawn throw.
 *
 * INCLUDES UNTRACKED FILES (2026-07-23): a plain `git diff` EXCLUDES untracked files, but a
 * "create a new file" task's deliverable is untracked — so the naive diffstat was EMPTY and
 * `codeQualityFromDiff` was starved (code_quality read as null / a bad guess). New files are made
 * visible via `git add -N` (intent-to-add: records the path, not the content), run against a SCRATCH
 * INDEX (GIT_INDEX_FILE) seeded from the real one so the real index is NEVER mutated — critical
 * because readDiffStat can run against the MAIN repo (the sandbox-gone re-judge fallback,
 * measurement-stop.mjs:860), where dirtying the real index would be a side effect on the user's repo.
 * `git add` respects .gitignore, so ignored churn (.data/, node_modules/) is naturally excluded.
 * Fail-soft everywhere: any git error degrades to the tracked-only diff or null, never throws.
 * @param {string} repoRoot
 * @returns {string|null}
 */
function readDiffStat(repoRoot) {
  const git = (args, env) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', timeout: 10_000, env: env || process.env });
  let scratch = null;
  try {
    let env = process.env;
    const idxPath = git(['rev-parse', '--git-path', 'index']);
    if (idxPath.status === 0 && typeof idxPath.stdout === 'string' && idxPath.stdout.trim()) {
      const realIndex = path.resolve(repoRoot, idxPath.stdout.trim());
      const candidate = path.join(os.tmpdir(), `exp-diffstat-idx-${process.pid}-${__diffStatSeq++}`);
      try {
        if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, candidate);
        scratch = candidate; // reuse the seeded copy, or an absent scratch (git creates it) for a bare repo
        env = { ...process.env, GIT_INDEX_FILE: scratch };
        git(['add', '-N', '--', '.'], env); // intent-to-add untracked into the SCRATCH index only
      } catch {
        scratch = null;
        env = process.env; // copy failed → fall back to the tracked-only diff (no index mutation)
      }
    }
    const res = git(['diff', '--stat'], env);
    if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return null;
    const out = res.stdout.trim();
    return out.length ? out : null;
  } catch {
    return null;
  } finally {
    if (scratch) { try { fs.rmSync(scratch, { force: true }); } catch { /* best-effort cleanup */ } }
  }
}

// ── Phase 76 / Plan 76-03 (VALID-03, D-08..D-11): deterministic non-GSD dims ──

// Default bounded timeout for the task's test command (env-overridable, fail-soft to
// default on a malformed/non-positive value — mirrors route-heuristics resolveIdleGapMs).
const DEFAULT_TEST_RUN_TIMEOUT_MS = 120_000;
// Deterministic code_quality-from-diff heuristic ceilings (D-08, Claude's Discretion,
// documented + bounded). A focused change (few files, low churn) scores high; a
// sprawling one floors low. code_quality = 0.6*churnScore + 0.4*fileScore, each in
// [0,1]: churnScore = 1 − (insertions+deletions)/CHURN_CEILING; fileScore =
// 1 − (filesChanged−1)/FILE_CEILING. Both clamped to [0,1]; result rounded to 2 dp.
const CODE_QUALITY_CHURN_CEILING = 1500;
const CODE_QUALITY_FILE_CEILING = 20;
// A run-metadata test_command carrying any of these shell-control characters would
// require shell interpretation; per D-10/T-76-03-INJ it is REJECTED (→ null), never
// executed under a shell. The package.json fallback is a fixed argv and skips this.
// Exported (Phase 77-01) so lib/experiments/experiment-spec.mjs guards a user-authored
// spec's test_command against the SAME canonical regex — single source, no duplicate
// character class. The class is unchanged; only the `export` keyword was added.
export const SHELL_META_RE = /[|&;<>()$`\\"'\n\r]/;

/** Clamp a value into [0,1]; non-finite/non-number → 0. */
function clamp01(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Round to 2 decimal places. */
function round2(v) {
  return Math.round(v * 100) / 100;
}

/** Resolve the bounded test-run timeout (EVIDENCE_TEST_TIMEOUT_MS override, fail-soft). */
function resolveTestTimeoutMs() {
  const raw = process.env.EVIDENCE_TEST_TIMEOUT_MS;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TEST_RUN_TIMEOUT_MS;
}

/**
 * Resolve the task's test command to a FIXED ARGV ARRAY (D-09/D-10), or null.
 * Precedence: run-metadata `span.meta.test_command` → `span.test_command` (each
 * tokenized on whitespace and rejected → null if it carries shell metacharacters,
 * T-76-03-INJ) → the repo's `package.json` "test" script, run positionally as the
 * fixed argv `['npm','run','test']` (no shell string ever built). null when no
 * command is resolvable (genuinely no runnable test — D-11).
 * @param {object|undefined} span
 * @param {string} repoRoot
 * @returns {string[]|null}
 */
export function resolveTestCommand(span, repoRoot) {
  const fromMeta = span?.meta?.test_command ?? span?.test_command;
  if (typeof fromMeta === 'string' && fromMeta.trim().length) {
    const cmd = fromMeta.trim();
    // Reject anything that would need a shell — argv-only, never a shell option (D-10).
    if (SHELL_META_RE.test(cmd)) return null;
    const argv = cmd.split(/\s+/).filter(Boolean);
    return argv.length ? argv : null;
  }
  // Fallback: repo package.json "test" script → run via the package manager as a
  // fixed argv (npm interprets the script internally; no shell string here).
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const script = pkg?.scripts?.test;
    if (typeof script === 'string' && script.trim().length) {
      return ['npm', 'run', 'test'];
    }
  } catch {
    // no/unreadable package.json → no fallback command
  }
  return null;
}

/**
 * Run the resolved test command with a FIXED ARGV `spawnSync` (mirrors readDiffStat
 * — no shell string, the `shell` option is never set, bounded timeout: T-76-03-EXEC). Fail-soft:
 * returns null when there is no command or the process could not be spawned (ENOENT,
 * timeout throw); otherwise `{ status, counts }` where counts is the parsed pass/fail
 * summary (null when unrecognized). NEVER throws.
 * @param {string[]|null} argv
 * @param {string} repoRoot
 * @returns {{status:number|null, counts:{passed:number,failed:number}|null}|null}
 */
function runTestCommand(argv, repoRoot) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const [cmd, ...args] = argv;
  // Strip the parent's node:test IPC context so a `node --test` command emits its
  // normal TAP/spec summary (parseable) instead of the v8-serialized child stream
  // it uses when NODE_TEST_CONTEXT is inherited from a scoring process itself under
  // `node --test`. Harmless in production (the var is unset there).
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  try {
    const res = spawnSync(cmd, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: resolveTestTimeoutMs(),
      maxBuffer: 16 * 1024 * 1024,
      env: childEnv,
    });
    if (res.error) return null; // spawn failed (ENOENT / timeout) → no signal
    const stdout = typeof res.stdout === 'string' ? res.stdout : '';
    // node:test writes TAP to stdout; parse that (never the raw stderr error prose).
    return { status: typeof res.status === 'number' ? res.status : null, counts: parseTestCounts(stdout) };
  } catch {
    return null;
  }
}

/**
 * Derive the three non-GSD rubric dims deterministically from the gathered evidence
 * (D-08). code_quality comes from the diff; test_coverage/regressions from the
 * fail-soft test run. Each dim is a numeric signal ONLY when its source exists, and
 * `null` otherwise (no diff AND no runnable test → all null — D-11; a failed/missing
 * run yields null for coverage, NEVER a guessed 0 — D-10). PURE over `evidence`
 * (the diff + test run already happened in gatherEvidence); no LLM, no I/O here.
 * @param {{diffStat?:string|null, testRun?:{status:number|null,
 *   counts:{passed:number,failed:number}|null}|null}} evidence
 * @returns {{code_quality:number|null, test_coverage:number|null, regressions:0|1|null}}
 */
export function deriveNonGsdRubric(evidence) {
  const ev = evidence ?? {};
  return {
    code_quality: codeQualityFromDiff(ev.diffStat),
    test_coverage: testCoverageFromRun(ev.testRun),
    regressions: regressionsFromRun(ev.testRun),
  };
}

/** Diff → a bounded [0,1] code_quality signal, or null when there is no diff. */
function codeQualityFromDiff(diffStat) {
  if (typeof diffStat !== 'string' || !diffStat.trim()) return null;
  const filesM = /(\d+)\s+files?\s+changed/i.exec(diffStat);
  const insM = /(\d+)\s+insertions?\(\+\)/i.exec(diffStat);
  const delM = /(\d+)\s+deletions?\(-\)/i.exec(diffStat);
  const filesChanged = filesM ? Number(filesM[1]) : 1;
  const churn = (insM ? Number(insM[1]) : 0) + (delM ? Number(delM[1]) : 0);
  const churnScore = clamp01(1 - churn / CODE_QUALITY_CHURN_CEILING);
  const fileScore = clamp01(1 - Math.max(0, filesChanged - 1) / CODE_QUALITY_FILE_CEILING);
  return round2(clamp01(0.6 * churnScore + 0.4 * fileScore));
}

/** Test run → coverage as the pass rate; null when no parseable counts (D-10). */
function testCoverageFromRun(testRun) {
  if (!testRun || !testRun.counts) return null; // no counts parsed → null, never a guessed 0
  const { passed, failed } = testRun.counts;
  const total = passed + failed;
  if (total <= 0) return null; // no tests actually ran → no signal
  return round2(passed / total);
}

/** Test run → regressions {0,1}; null when there is no runnable test at all. */
function regressionsFromRun(testRun) {
  if (!testRun) return null; // no test → no signal (D-11)
  if (testRun.counts) return testRun.counts.failed > 0 ? 1 : 0;
  // No parseable counts: fall back to the exit status (non-zero exit → flagged).
  if (typeof testRun.status === 'number') return testRun.status === 0 ? 0 : 1;
  return null; // ran but indeterminate (e.g. killed/timeout) → no signal
}

/**
 * Derive the OBJECTIVE per-cell test-gate outcome from the already-computed evidence
 * (CMP-01 / Phase 79 D-04a). This is DISTINCT from the subjective rubric (D-04): the
 * rubric consumers (deriveNonGsdRubric) map the SAME test result onto `test_coverage`/
 * `regressions`, but the gate is the raw objective pass/fail persisted as a queryable
 * field so the Phase 79 aggregator can separate gate-passers from failed/ungated runs.
 *
 * Reads ONLY the in-hand `evidence.testRun` — it does NOT run the test a second time
 * (D-04: the agent's edits lived in an ephemeral sandbox worktree destroyed after the
 * run, so re-deriving the gate at compare time is infeasible). Mirrors the null/exit-
 * status shape of regressionsFromRun above; never throws.
 *
 *   - evidence?.testRun == null (no test_command / no runnable test — D-02) → null (UNGATED)
 *   - testRun.status === 0  → true  (objective test passed)
 *   - otherwise (non-zero exit) → false (objective test failed)
 *
 * null-not-zero: a missing test is NEVER coerced to false — an ungated run persists
 * gate_passed=null so it is shown-not-ranked, never mis-classified as a gate failure.
 *
 * @param {{ testRun?: { status: number|null, counts?: {passed:number,failed:number}|null }|null }|null|undefined} evidence
 * @returns {true|false|null}
 */
export function gateFromEvidence(evidence) {
  const testRun = evidence?.testRun ?? null;
  if (!testRun) return null; // no test_command / no runnable test → ungated (D-02), never false
  return testRun.status === 0; // exit 0 → true; any non-zero exit → false (null-not-zero above)
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
 *           testRun:{status:number|null,counts:{passed:number,failed:number}|null}|null,
 *           planTasks:string[]|null}}
 */
export function gatherEvidence({ span, phaseArg, repoRoot } = {}) {
  const root = repoRoot || REPO_ROOT;
  const phasesRoot = path.join(root, '.planning', 'phases');
  const phaseDir = locatePhaseDir(phasesRoot, phaseArg);

  // Deterministic non-GSD signals (D-08): the working-tree diff + a fail-soft
  // fixed-argv run of the task's test command. Both are computed regardless of
  // whether GSD artifacts exist — the score consumers gap-fill only null judged
  // dims from these (D-11). `testRun` is null when no command is resolvable.
  const diffStat = readDiffStat(root);
  const testRun = runTestCommand(resolveTestCommand(span, root), root);

  if (!phaseDir) {
    // No phase dir → every on-disk GSD slot is null; the non-GSD signals still read.
    return {
      verification: null,
      reviewFindings: null,
      testSummary: null,
      diffStat,
      testRun,
      planTasks: null,
    };
  }

  return {
    verification: parseVerification(firstMatch(phaseDir, /-VERIFICATION\.md$/)),
    reviewFindings: parseReviewFindings(firstMatch(phaseDir, /-REVIEW\.md$/)),
    testSummary: parseTestSummary(phaseDir),
    diffStat,
    testRun,
    planTasks: parsePlanTasks(firstMatch(phaseDir, /-PLAN\.md$/)),
  };
}
