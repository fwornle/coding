// lib/experiments/goal-sentence.mjs
// ROUTE-01 / D-03: the zero-LLM `goal_sentence` extractor for /gsd runs. PURE and
// deterministic — fs.readFileSync + regex, no LLM, no network.
//
//   deriveGoalSentence({ phase, planPath?, roadmapPath? }) → string
//
// Resolution order (D-03):
//   1. If planPath exists on disk, return the first '**Goal**:' line in it.
//   2. Else if roadmapPath exists, locate the `### Phase {phase}:` block and return
//      the first '**Goal**:' line within that block.
//   3. Else (or on any read failure / missing marker) return '' — the close must
//      not hard-block, so the caller quarantines headless per D-05. NEVER throws.
//
// No package installs (stdlib only). Diagnostics go to process.stderr — the
// no-console-log rule (CLAUDE.md) forbids the stdout/err logging family here.
import fs from 'node:fs';
import process from 'node:process';

// Anchored, linear, '/m' line match — tolerates leading/trailing whitespace and a
// trailing period. No catastrophic backtracking (T-72-02-DOS: the inner `.+?` is
// bounded by the end-of-line anchor).
const GOAL_LINE_RE = /^\s*\*\*Goal\*\*:\s*(.+?)\s*$/m;

/**
 * Read `filePath` and return the first '**Goal**:' sentence, or '' if the file is
 * unreadable / has no marker. Never throws.
 * @param {string} filePath
 * @returns {string}
 */
function extractGoalFromFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const m = GOAL_LINE_RE.exec(text);
    return m ? m[1].trim() : '';
  } catch {
    // ENOENT / EACCES / EISDIR etc. — a missing or unreadable source is a normal
    // path (D-05), not an error to propagate.
    return '';
  }
}

/**
 * Normalize a phase identifier to its leading numeric token. Accepts a number
 * (72), a numeric string ('72'), or a slug ('72-syntactic-route-quality') and
 * returns the digits as a string ('72'), or '' if none are present.
 * @param {number|string|undefined} phase
 * @returns {string}
 */
function phaseNumber(phase) {
  if (phase === undefined || phase === null) return '';
  const m = String(phase).match(/\d+/);
  return m ? m[0] : '';
}

/**
 * Read `roadmapPath` and return the '**Goal**:' sentence inside the `### Phase
 * {phase}:` block, or '' if the file/heading/marker is absent. Never throws. The
 * block ends at the next `### ` heading (or EOF), so adjacent phase goals are not
 * mismatched.
 * @param {string} roadmapPath
 * @param {number|string} phase
 * @returns {string}
 */
function extractGoalFromRoadmap(roadmapPath, phase) {
  const num = phaseNumber(phase);
  if (!num) return '';
  try {
    const text = fs.readFileSync(roadmapPath, 'utf8');
    // Locate the `### Phase {num}:` heading, then bound the block at the next
    // `### ` heading (or EOF). JS regex has no \Z anchor, so this index-slice
    // approach emulates "until next heading" portably and keeps adjacent-phase
    // goal sentences from being mismatched.
    const heading = new RegExp(`^###\\s+Phase\\s+${num}\\b[^\\n]*$`, 'm');
    const hMatch = heading.exec(text);
    if (!hMatch) return '';
    const after = text.slice(hMatch.index + hMatch[0].length);
    const nextHeading = /^###\s/m.exec(after);
    const block = nextHeading ? after.slice(0, nextHeading.index) : after;
    const m = GOAL_LINE_RE.exec(block);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Derive the one-sentence run goal for a /gsd run (ROUTE-01, D-03). Zero-LLM, pure
 * fs + regex. Returns '' (never throws) when no goal source is available so the
 * caller can quarantine a headless run per D-05.
 *
 * @param {object} opts
 * @param {number|string} opts.phase - phase number/slug used to locate the ROADMAP block.
 * @param {string} [opts.planPath] - path to the active phase PLAN.md (primary source).
 * @param {string} [opts.roadmapPath] - path to ROADMAP.md (fallback source).
 * @returns {string} the trimmed goal sentence, or ''.
 */
export function deriveGoalSentence({ phase, planPath, roadmapPath } = {}) {
  // (1) PLAN.md is the primary, most run-specific source.
  if (planPath) {
    const fromPlan = extractGoalFromFile(planPath);
    if (fromPlan) return fromPlan;
  }
  // (2) ROADMAP phase block fallback.
  if (roadmapPath) {
    const fromRoadmap = extractGoalFromRoadmap(roadmapPath, phase);
    if (fromRoadmap) return fromRoadmap;
  }
  // (3) No source → '' (D-05 quarantine path). Diagnostic to stderr only.
  if (process.env.GOAL_SENTENCE_DEBUG) {
    process.stderr.write(
      `[goal-sentence] no goal found (phase=${phase}, planPath=${planPath ?? ''}, roadmapPath=${roadmapPath ?? ''})\n`,
    );
  }
  return '';
}
