/**
 * Sandboxed run tree for kgbench.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The benchmark's questions live in the repository the arms are asked to search. In
 * the coding-v1 pilot the grep arm answered the T3 abstain probe with:
 *
 *   "This question is a known 'abstain' probe from
 *    config/kgbench/questions/coding-v1.json:184 (id T3) — its own provenance note
 *    calls it a pure fabrication probe."
 *
 * It scored 1.00. It had read the answer key. Any arm with file access can, and every
 * arm here has `Read`, so this is not a property of one backend — it invalidates the
 * whole matrix. Worse, a leaked answer key produces *correct* answers, so the failure
 * is invisible in the scores: it looks exactly like retrieval working well.
 *
 * The answer key is not the only channel. The repo also tracks this project's own
 * observation and knowledge exports, and because the benchmark was designed in a
 * session that this project records, the trap phrase "payment reconciliation" appears
 * in four of them:
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
  // ("discussed the payment reconciliation service..."), which shares a middle phrase
  // with the prompt but not its opening words.
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
    (entry.matched >= minWindows && entry.ratio >= minRatio ? leaks : weak).push(entry);
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

  try {
    git(repoRoot, ['worktree', 'add', '--detach', '--quiet', dir, commit]);
  } catch (err) {
    throw new SandboxError(`could not create worktree at ${dir}: ${err.message}`);
  }

  const cleanup = () => {
    try { git(repoRoot, ['worktree', 'remove', '--force', dir]); } catch { /* best effort */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  };

  const removed = [];
  const report = { weak: [] };
  try {
    for (const rel of excludes) {
      const target = path.join(dir, rel);
      if (existsSync(target)) { rmSync(target, { recursive: true, force: true }); removed.push(rel); }
    }

    if (verify) {
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
