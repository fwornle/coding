/**
 * Sandboxed run tree for kgbench.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The benchmark's questions live in the repository the arms are asked to search. In
 * the coding-v1 pilot the grep arm answered one of the abstain probes with:
 *
 *   "This question is a known probe from config/kgbench/questions/<set>.json:<line>
 *    — its own provenance note says so."
 *
 * (Paraphrased. The verbatim answer named the probe's subject, and reproducing it here
 *  would put that subject back in the searchable tree — see the WARNING below.)
 *
 * It scored 1.00. It had read the answer key. Any arm with file access can, and every
 * arm here has `Read`, so this is not a property of one backend — it invalidates the
 * whole matrix. Worse, a leaked answer key produces *correct* answers, so the failure
 * is invisible in the scores: it looks exactly like retrieval working well.
 *
 * The answer key is not the only channel. The repo also tracks this project's own
 * observation and knowledge exports, and because the benchmark was designed in a
 * session that this project records, an abstain probe's subject phrase appears in four
 * of them:
 *
 *   .data/observation-export/{observations,digests}.json
 *   .data/knowledge-graph/exports/general.json
 *   .data/experiments/exports/experiment.json
 *
 * A telemetry system that records the sessions in which its own benchmark is authored
 * will keep re-contaminating that benchmark. Excluding one file would not have held.
 *
 * THE APPROACH
 *
 * Run the arms against a git worktree of the benchmark commit, with the contaminating
 * paths removed. Three properties follow:
 *
 *   - A worktree contains only TRACKED files, so no node_modules, no scratch state,
 *     and no untracked session logs — a smaller and more honest search surface.
 *   - The tree is pinned to a commit, so "what the arms searched" is reproducible and
 *     recorded, rather than whatever the working tree happened to contain.
 *   - The user's working tree is never mutated. An earlier design that moved the
 *     question file aside during a run would have destroyed it on a crash.
 *
 * Containment is then VERIFIED rather than assumed: after building the tree we grep it
 * for each question's own prompt text and abort if anything survives. The denylist is
 * the mechanism; the scan is the guarantee. A denylist alone silently rots the moment
 * someone adds a new export path.
 *
 * WARNING TO WHOEVER EDITS THIS FILE
 *
 * Do not quote question content — a prompt, a probe's subject, a provenance note — in
 * source that ships in the tree. lib/kgbench/*.mjs is NOT excluded from the run tree
 * (several questions cite it as ground truth), so a comment here is a file the arms can
 * grep. This is not hypothetical: an early version of this very comment block named an
 * abstain probe's subject while explaining the contamination defect, and on the next
 * run an arm searched for that subject, found this file, and answered:
 *
 *   "<file> explicitly documents <subject> as a trap phrase used to test whether an
 *    agent fabricates an answer rather than admitting absence."
 *
 * Correct, and worthless as a measurement — the documentation of the leak became the
 * leak. Describe the defect abstractly, and let `leak_terms` on the question enforce it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class SandboxError extends Error {}

/**
 * Paths removed from the run tree.
 *
 * `config/kgbench/questions` only — NOT all of config/kgbench. One question's ground
 * truth is config/kgbench/arms.json, and several more cite lib/kgbench/*.mjs, so the
 * harness's own source is legitimately part of the searchable codebase. Only the
 * answer key comes out.
 *
 * The agent rule files come out for two independent reasons. First, CLAUDE.md carries
 * absolute paths into this repo, and a sandboxed agent that reads one can walk straight
 * back out to the real tree — a failure this project has already hit once in the
 * cross-agent experiment harness. Second, CLAUDE.md instructs agents to prefer the
 * graphify skill "instead of blind greps", which is a thumb on the scale for one arm.
 * Removing them is symmetric across arms and removes both problems at once.
 */
export const DEFAULT_EXCLUDES = [
  'config/kgbench/questions',   // the answer key itself
  // The GRADING and CONTAINMENT machinery. These two describe what a right answer looks
  // like and which subjects are traps, so every explanatory comment in them is a
  // potential crib — and comments here have now leaked FOUR times, each one a comment
  // written to explain the previous leak. Neither file is any question's evidence
  // (report.mjs, runner.mjs and arms.mjs are, and stay in), so removing them costs the
  // benchmark nothing and ends the class rather than the instance.
  //
  // Prose discipline was the old control and it does not hold: a leak term catches a
  // phrase that must appear nowhere, but T1's subject legitimately litters this repo —
  // that IS its trap — so no term could have guarded it. Structure can.
  'lib/kgbench/graders.mjs',
  'lib/kgbench/sandbox.mjs',
  // Same reason. NOT a glob over scripts/kgbench-*: kgbench-run.mjs is B2's ground truth
  // and kgbench-report.mjs is cited by another question, so both must stay in the tree.
  'scripts/kgbench-regrade.mjs',
  'tests/**/kgbench-*.test.js', // benchmark-meta: the regression tests quote real prompts
  // Benchmark-meta: the operator doc explains the probes. Listed literally, NOT as
  // `docs/**/kgbench*.md` — git pathspec matched that glob against
  // docs/benchmarks/kgbench-replication/README.md, which is A2's ground truth. Excluding
  // it would have made A2 unanswerable and scored every arm 0 on it, which reads as a
  // finding about the arms rather than a bug in this list.
  'docs/measurement/kgbench.md',
  'docs-content/measurement/kgbench.md',
  // The PUBLISHED REPORT of a previous run. Publishing the question set was the right
  // call for a reader — a benchmark whose questions are secret cannot be judged — but it
  // puts every prompt, and the facts an answer must contain, into the searchable tree.
  // Left in, the next run measures whether an arm can find the last run's answer key.
  // Listed as a literal directory, not a glob: docs/benchmarks/ also holds
  // kgbench-replication/README.md, which is one question's legitimate ground truth.
  'docs/benchmarks/coding-v1',
  '.data',                      // observation / KB / experiment exports echo the prompts
  '.specstory',                 // session logs of the sessions that authored the questions
  'CLAUDE.md',                  // absolute paths out of the sandbox + per-arm tool bias
  '.claude',
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.opencode',
];

const git = (repoRoot, args) =>
  execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();

/**
 * Resolve one exclude entry to concrete paths. Literal paths pass through; entries
 * containing `*` are matched against the worktree's tracked files.
 *
 * Globs exist because benchmark-meta is a CLASS of file, not a fixed list. The
 * regression tests for this very module quote real prompts and a real provenance note
 * verbatim — deliberately, since pinning them to invented strings would not prove the
 * fix. Committing them re-contaminated the tree, and the verifier caught it on the
 * next run. A literal denylist would have needed editing again for the next such file;
 * `tests/**\/kgbench-*.test.js` covers them as they are added.
 */
function expandExclude(dir, pattern) {
  if (!pattern.includes('*')) return [pattern];
  try {
    const out = execFileSync('git', ['-C', dir, 'ls-files', '--', pattern], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];   // no match, or not a git tree — nothing to remove
  }
}

/**
 * Distinctive needles for the leak scan.
 *
 * A slice of the prompt is the right probe: it is what an answer key, a session log,
 * or an observation export all contain verbatim, and it is specific enough that a
 * false positive means something genuinely echoes the benchmark.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'is', 'are', 'was', 'were',
  'this', 'that', 'it', 'its', 'for', 'with', 'by', 'from', 'as', 'at', 'be', 'which',
  'what', 'does', 'do', 'reply', 'state', 'clearly', 'answer', 'name', 'give', 'list',
]);

/** Contiguous word windows carrying enough content to be distinctive. */
function contentWindows(text, { size = 5, minContent = 3, max = 6 } = {}) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i + size <= words.length && out.length < max; i++) {
    const win = words.slice(i, i + size);
    const content = win.filter((w) => !STOPWORDS.has(w.toLowerCase().replace(/[^\w]/g, '')));
    if (content.length >= minContent) out.push(win.join(' '));
  }
  return out;
}

export function leakNeedles(questions) {
  // NB: do not grep for the string "kgbench/questions". The harness's own source
  // constructs that path (lib/kgbench/arms.mjs, scripts/kgbench-verify-questions.mjs),
  // and that source is legitimately part of the searchable tree — one question's ground
  // truth is config/kgbench/arms.json. A path REFERENCE is not a content leak; the
  // question-set files being absent is asserted structurally instead.
  //
  // Windows rather than a prefix. A prefix only catches a verbatim copy of the question
  // file; the leak that actually mattered was telemetry PARAPHRASING the question
  // (telemetry paraphrasing a prompt), which shares a middle phrase with that prompt
  // but not its opening words.
  const needles = [];
  const seen = new Set();
  const push = (id, text) => {
    const key = text.toLowerCase();
    if (text.length >= 16 && !seen.has(key)) { seen.add(key); needles.push({ id, text }); }
  };
  for (const q of questions) {
    // Drop the trailing answer-format instruction — boilerplate shared across the set.
    const core = String(q.prompt ?? '').split(/\bReply with\b|\bor state clearly\b/i)[0];
    for (const w of contentWindows(core)) push(`prompt:${q.id}`, w);
    for (const w of contentWindows(q.provenance?.note ?? '', { max: 3 })) push(`note:${q.id}`, w);
    // Decisive terms, declared per question. See leak_terms in the question schema.
    for (const t of q.leak_terms ?? []) push(`term:${q.id}`, t);
  }
  return needles;
}

/**
 * Grep the tree for each needle. Returns [{needle, files[]}] for anything found.
 * Uses fixed-string grep so regex metacharacters in prompts cannot misfire.
 */
export function scanTreeForLeaks(dir, questions) {
  const needles = leakNeedles(questions);
  if (!needles.length) return [];

  // One pass for all needles via `grep -f`. Per-needle greps meant ~90 full walks of a
  // 5,000-file tree on every run; the healthy case is "no hits", so it should cost one
  // walk, not ninety. Attribution is only needed when something is found.
  const patternFile = path.join(os.tmpdir(), `kgbench-needles-${process.pid}.txt`);
  writeFileSync(patternFile, needles.map((n) => n.text).join('\n') + '\n');

  let files = [];
  try {
    const out = execFileSync('grep', ['-rlIF', '--exclude-dir=.git', '-f', patternFile, dir], { encoding: 'utf8' });
    files = out.split('\n').filter(Boolean);
  } catch (err) {
    if (err.status !== 1) throw new SandboxError(`leak scan failed: ${err.message}`);
    return [];   // exit 1 = no match = healthy
  } finally {
    try { rmSync(patternFile, { force: true }); } catch { /* best effort */ }
  }

  // Something matched — now work out which needle, for an actionable error.
  const hits = [];
  for (const needle of needles) {
    const inFiles = files.filter((f) => {
      try {
        execFileSync('grep', ['-lIF', needle.text, f], { encoding: 'utf8' });
        return true;
      } catch { return false; }
    });
    if (inFiles.length) {
      hits.push({ needle: needle.id, text: needle.text, files: inFiles.map((f) => path.relative(dir, f)) });
    }
  }
  return hits;
}

/**
 * Separate a genuine echo of a question from ordinary shared vocabulary.
 *
 * Needle hits alone over-trigger. B2 asks about "the LLM proxy on port 12435", and
 * that exact phrase appears in CostTab.tsx and in phase summaries simply because it is
 * how this project refers to the proxy — the question borrows the codebase's words, so
 * some overlap is guaranteed and is not a leak.
 *
 * What distinguishes a real leak is COVERAGE. A file that echoes a question matches
 * most of that question's windows across the whole prompt: in the real telemetry leak,
 * .data/knowledge-graph/exports/general.json matched 6 of 6 windows for each of A3, T1
 * and T3. A coincidental phrase matches one or two adjacent windows and nothing else.
 *
 * Anything below the bar is reported as `weak` rather than dropped, so a partial echo
 * stays visible instead of being silently tolerated.
 */
export function classifyLeaks(hits, questions, { minWindows = 3, minRatio = 0.5 } = {}) {
  const totals = new Map();
  for (const n of leakNeedles(questions)) totals.set(n.id, (totals.get(n.id) ?? 0) + 1);

  const byPair = new Map();   // "needleId|file" -> count of distinct needles matched
  for (const h of hits) {
    for (const f of h.files) {
      const key = `${h.needle}|${f}`;
      if (!byPair.has(key)) byPair.set(key, { needle: h.needle, file: f, matched: 0, texts: [] });
      const e = byPair.get(key);
      e.matched++; e.texts.push(h.text);
    }
  }

  const leaks = [], weak = [];
  for (const e of byPair.values()) {
    const total = totals.get(e.needle) ?? 1;
    const entry = { ...e, total, ratio: +(e.matched / total).toFixed(2) };
    // A declared `leak_terms` hit is decisive — one occurrence is a leak. Coverage
    // thresholds exist to tolerate shared vocabulary in prompt windows; a term declared
    // as must-not-appear has no innocent reading, so it does not get that latitude.
    const decisive = e.needle.startsWith('term:');
    const isLeak = decisive || (entry.matched >= minWindows && entry.ratio >= minRatio);
    (isLeak ? leaks : weak).push(entry);
  }
  return { leaks, weak };
}

/**
 * Build the sandboxed run tree.
 *
 * Returns {dir, commit, removed[], cleanup()}. Throws SandboxError if containment
 * cannot be established — never returns a tree it could not verify, because an
 * unverified tree produces numbers that look fine and mean nothing.
 */
export function createRunTree({ repoRoot, questions, excludes = DEFAULT_EXCLUDES, verify = true }) {
  let commit;
  try {
    commit = git(repoRoot, ['rev-parse', 'HEAD']);
  } catch (err) {
    throw new SandboxError(`not a git checkout, cannot sandbox the run: ${err.message}`);
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), 'kgbench-tree-'));
  // mkdtemp created it; `git worktree add` insists on creating the path itself.
  rmSync(dir, { recursive: true, force: true });

  // Drop administrative entries for worktrees whose directories are already gone. A
  // run killed with SIGKILL (or a reboot clearing /tmp) leaves one behind, and git
  // then refuses to reuse the path — so without this the FIRST crash makes every
  // later run fail at setup, on a fresh install as readily as an old one.
  try { git(repoRoot, ['worktree', 'prune']); } catch { /* nothing to prune */ }

  try {
    git(repoRoot, ['worktree', 'add', '--detach', '--quiet', dir, commit]);
  } catch (err) {
    throw new SandboxError(
      `could not create worktree at ${dir}: ${err.message}\n`
      + '  If this persists: git worktree list, then git worktree remove --force <stale path>.',
    );
  }

  const cleanup = () => {
    try { git(repoRoot, ['worktree', 'remove', '--force', dir]); } catch { /* best effort */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  };

  const removed = [];
  const report = { weak: [] };
  try {
    for (const rel of excludes) {
      for (const resolved of expandExclude(dir, rel)) {
        const target = path.join(dir, resolved);
        if (existsSync(target)) { rmSync(target, { recursive: true, force: true }); removed.push(resolved); }
      }
    }

    if (verify) {
      // Containment must not remove the ANSWERS, only the answer key. An exclusion that
      // deletes a question's own evidence makes that question unanswerable, and every
      // arm then scores 0 on it — which reads as a finding about the arms rather than a
      // bug in the exclude list. A too-broad glob did exactly this: `docs/**/kgbench*.md`
      // matched docs/benchmarks/kgbench-replication/README.md, A2's ground truth.
      const orphaned = [];
      for (const q of questions) {
        for (const ev of q.provenance?.evidence ?? []) {
          const file = String(ev).split(':')[0];
          if (removed.some((rel) => file === rel || file.startsWith(rel + '/'))) {
            orphaned.push(`${q.id} -> ${file}`);
          }
        }
      }
      if (orphaned.length) {
        throw new SandboxError(
          `exclusions removed question evidence, making those questions unanswerable:\n`
          + orphaned.map((o) => `  ${o}`).join('\n')
          + '\n  Narrow the offending entry in DEFAULT_EXCLUDES.',
        );
      }

      // Structural: the answer key must not exist in the tree at all.
      const keyDir = path.join(dir, 'config/kgbench/questions');
      if (existsSync(keyDir)) {
        throw new SandboxError(`answer key still present at ${keyDir} — exclusion did not apply`);
      }
      // Textual: nothing else may echo a prompt or a provenance note.
      const { leaks, weak } = classifyLeaks(scanTreeForLeaks(dir, questions), questions);
      report.weak = weak.map((w) => `${w.needle} ~ ${w.file} (${w.matched}/${w.total})`);
      if (leaks.length) {
        const detail = leaks.slice(0, 6)
          .map((l) => `  ${l.needle} echoed in ${l.file} (${l.matched}/${l.total} windows)`).join('\n');
        throw new SandboxError(
          `run tree still contains benchmark ground truth after excluding ${removed.length} path(s):\n${detail}\n`
          + '  Add the offending path to DEFAULT_EXCLUDES in lib/kgbench/sandbox.mjs.\n'
          + '  Refusing to run: arms that can read the answer key produce correct answers,\n'
          + '  so this contamination would be invisible in the scores.',
        );
      }
    }
  } catch (err) {
    cleanup();
    throw err;
  }

  return { dir, commit, removed, weak: report.weak, cleanup };
}
