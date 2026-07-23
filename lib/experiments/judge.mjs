// lib/experiments/judge.mjs
//
// Phase 73, Plan 73-04 (Wave 2) — the LLM judge (ROUTE-03 + SCORE-01). ONE
// structured `/api/complete` call (a STRONG model — Opus 4.8 by default, 2026-07-23; see
// JUDGE_MODEL below) that, given the consequential trace
// events + on-disk evidence (73-03) + goal_sentence, returns per-event
// toward/neutral/away labels AND the LOCKED 5-dimension rubric with rationales
// (D-02 / D-03). The goal_aligned_ratio is computed deterministically IN CODE
// (computeGoalAlignedRatio, 73-01) from the returned labels — never trusted to
// the LLM's own arithmetic, so ROUTE-03 stays reproducible.
//
// Degradation contract (kept tri-state distinguishable downstream, 73-02):
//   - trivial run (≈0 consequential events, D-04) → judged fields null +
//     not_scored:'trivial', and the proxy is NEVER called (the close is not paid
//     for a no-op run).
//   - proxy failure / non-OK / unparseable / shape-mismatch (D-03) → judged
//     fields null + pending:true. runJudge NEVER throws — the run-close must not
//     hard-block on a slow/unreachable proxy (T-73-04-BLOCK).
//
// Proxy contract (CLAUDE.md): POST <proxy>/api/complete on the LLM proxy port
// 12435 (NOT the Health API port, which silently returns HTML for /api/complete).
// Body { process, messages, taskType, provider, model } — /api/complete honors an explicit
// provider+model, so the judge pins a strong model (JUDGE_PROVIDER/JUDGE_MODEL) rather than
// leaning on the taskType→tier default. → resp { content, provider, model, tokens, latencyMs }
// (NOT OpenAI-wrapped). `content` is a STRING that must be defensively parsed + validated + clamped.
//
// T-73-04-LEAK: only seq/tool_name/target_path/outcome are packed into the judge
// context — never raw tool inputs / file contents.
//
// Analog (copied verbatim, 73-PATTERNS.md §judge.mjs): the callProxy + message
// envelope from scripts/backfill-raw-observations.mjs:40-42,57-106 (taskType
// added). The prompt + JSON schema + defensive parser are net-new (no in-repo
// analog — see 73-PATTERNS.md §"No Analog Found").
//
// Output via process.stderr.write only — the no-console-log rule (CLAUDE.md).
import process from 'node:process';
import {
  filterConsequential,
  isTrivialRun,
  computeGoalAlignedRatio,
} from './consequential-events.mjs';

// Reuse the canonical host-side proxy timeout (backfill-raw-observations.mjs:42).
// A slow proxy is bounded by AbortSignal.timeout so the close cannot hang
// (T-73-04-BLOCK).
const REQUEST_TIMEOUT_MS = 60_000;

// JUDGE MODEL (2026-07-23): the judge is the ARBITER of the whole cross-agent comparison, yet it
// used to route via taskType:'route_judge' → the FAST (Haiku) tier. Haiku fabricated low, wrong-
// direction rubric scores (e.g. code_quality=0.12 for a clean 4/4-passing fizzbuzz) and violated the
// "null-not-zero when no evidence" contract. It runs only on experiment closes + manual re-scores
// (measurement-stop.mjs / experiments-recompute-score.mjs — NOT a system-wide hot path), and its
// context is tiny (goal + event metadata + evidence, never file contents), so a strong model is cheap.
// `/api/complete` honors an explicit provider+model in the body (verified: copilot serves
// claude-opus-4.8 over the fast HTTP path), so pin Opus 4.8 directly — no proxy-config dependency.
// Env-overridable for cost/latency tuning or if the catalog changes (dotted copilot catalog ids).
const JUDGE_PROVIDER = process.env.JUDGE_PROVIDER || 'copilot';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-opus-4.8';

// The 5 LOCKED rubric dimensions (v73-perf-measurement-exploration.md §D5). The
// judge MUST NOT redesign these — only synthesize scores from present evidence.
const RUBRIC_DIMENSIONS = Object.freeze([
  'goal_achieved', // §D5: VERIFICATION verdict + tests + goal-vs-diff
  'code_quality', // §D5: review findings count + linter output + diff size
  'test_coverage', // §D5: test pass rate + new-tests-for-new-code ratio
  'regressions', // §D5: broken tests NOT introduced by this run's own edits (0|1)
  'spec_drift', // §D5: divergence from PLAN.md task list (null for freeform)
]);

/**
 * Resolve the proxy URL per the CLAUDE.md precedence
 * (RAPID_LLM_PROXY_URL → LLM_CLI_PROXY_URL → LLM_PROXY_URL →
 * http://localhost:${LLM_CLI_PROXY_PORT ?? '12435'}), appending /api/complete
 * exactly once. Port 12435 — NEVER the Health API port (it returns HTML there).
 * @returns {string}
 */
function resolveProxyUrl() {
  const base = process.env.RAPID_LLM_PROXY_URL
    || process.env.LLM_CLI_PROXY_URL
    || process.env.LLM_PROXY_URL
    || `http://localhost:${process.env.LLM_CLI_PROXY_PORT ?? '12435'}`;
  return `${base.replace(/\/+$/, '')}/api/complete`;
}

/**
 * The default, real proxy client (copied from backfill-raw-observations.mjs:94-106
 * with taskType riding in the body). Throws on non-OK so the caller's try/catch
 * quarantines to pending. Returns the parsed JSON envelope { content, provider,
 * model, tokens, latencyMs }.
 * @param {object} body POST body { process, messages, taskType }
 * @returns {Promise<object>}
 */
async function callProxyDefault(body) {
  const resp = await fetch(resolveProxyUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

// The STRICT JSON-only structured-output contract. The judge returns per-event
// labels + the LOCKED 5-dim rubric + two rationales — nothing else.
const JUDGE_SYSTEM_PROMPT = [
  'You are a strict, evidence-bound judge of a single coding run. You are given',
  "the run's goal sentence, its consequential (state-changing) tool calls, and a",
  'deterministic evidence object gathered from on-disk phase artifacts.',
  '',
  'Return ONLY a single JSON object (no prose, no markdown fences) of EXACTLY:',
  '{',
  '  "event_labels": [ { "seq": <int>, "label": "toward"|"neutral"|"away", "reason": "<short>" }, ... ],',
  '  "ratio_rationale": "<one sentence on the overall goal-alignment of the actions>",',
  '  "rubric": {',
  '    "goal_achieved": <0.0-1.0 or null>,',
  '    "code_quality": <0.0-1.0 or null>,',
  '    "test_coverage": <0.0-1.0 or null>,',
  '    "regressions": <0 or 1 or null>,',
  '    "spec_drift": <0.0-1.0 or null>',
  '  },',
  '  "rubric_rationale": "<one to three sentences citing the evidence used>"',
  '}',
  '',
  'Labelling rule (D-02): for EACH consequential event (by its seq) decide whether',
  'that action moved TOWARD the goal, was NEUTRAL (housekeeping / no net progress),',
  'or moved AWAY (regression / wrong direction). Do NOT compute any ratio yourself —',
  'only the labels are used; the ratio is computed in code.',
  '',
  'Rubric evidence sources (LOCKED — do NOT invent new dimensions, §D5):',
  '- goal_achieved: VERIFICATION verdict + test summary + goal-vs-diff.',
  '- code_quality: review findings count + diff size.',
  '- test_coverage: test pass rate + new-tests-for-new-code ratio.',
  '- regressions: 1 if tests broke that were NOT introduced by this run, else 0.',
  '- spec_drift: divergence from the PLAN.md task list (use null for freeform runs',
  '  with no plan tasks, or score against the goal sentence alone).',
  '',
  'CRITICAL: when the evidence does not support a dimension, return null for that',
  'dimension — NEVER guess and NEVER substitute 0. null means "no evidence"; 0 means',
  '"genuinely scored as failing". Keep them distinct.',
].join('\n');

/**
 * Build the user-content payload. T-73-04-LEAK: only seq/tool_name/target_path/
 * outcome are packed per event — raw tool inputs / file contents are NEVER sent.
 * @param {object} span the archived span (only goal_sentence is read).
 * @param {Array<object>} consequential the filtered consequential events.
 * @param {object} evidence the 73-03 evidence object.
 * @returns {string}
 */
function buildJudgeContext(span, consequential, evidence) {
  const goal = (span && span.goal_sentence) ? String(span.goal_sentence) : '(no goal sentence recorded)';
  const events = consequential.map((e) => ({
    seq: e.seq,
    tool_name: e.tool_name,
    target_path: e.target_path ?? null,
    outcome: e.outcome,
  }));
  return [
    `<goal>${goal}</goal>`,
    '<consequential_events>',
    JSON.stringify(events, null, 2),
    '</consequential_events>',
    '<evidence>',
    JSON.stringify(evidence ?? {}, null, 2),
    '</evidence>',
    '',
    'Label every consequential event by seq and fill the rubric from the evidence.',
    'Respond with the JSON object only.',
  ].join('\n');
}

/** A rubric object with every LOCKED dimension null (no evidence / quarantine). */
function nullRubric() {
  return {
    goal_achieved: null,
    code_quality: null,
    test_coverage: null,
    regressions: null,
    spec_drift: null,
  };
}

/**
 * The all-null judgment used for BOTH degradation paths (D-03/D-04). `marker`
 * carries the distinguishing state: trivial sets not_scored, pending sets pending.
 * @param {{ pending?: boolean, not_scored?: 'trivial'|null }} marker
 * @returns {object} judgment
 */
export function nullJudgment({ pending = false, not_scored = null } = {}) {
  return {
    goal_aligned_ratio: null,
    event_labels: [],
    ratio_rationale: '',
    rubric: nullRubric(),
    rubric_rationale: '',
    pending,
    not_scored,
  };
}

/** Clamp an LLM value into [0,1]; non-finite / non-number → null (no evidence). */
function clampUnit(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Coerce a regressions value to the {0,1} domain; anything else → null. */
function clampBinary(v) {
  if (v === 0 || v === 1) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v >= 0.5 ? 1 : 0;
  return null;
}

/**
 * Normalize the LLM's event_labels into the strict {seq,label} contract,
 * dropping any malformed entry. Unknown labels are kept verbatim so
 * computeGoalAlignedRatio excludes them (it counts only toward/away).
 * @param {any} raw
 * @returns {Array<{seq:number,label:string}>}
 */
function normalizeLabels(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const seq = typeof e.seq === 'number' && Number.isFinite(e.seq) ? e.seq : null;
    const label = typeof e.label === 'string' ? e.label : null;
    if (seq === null || label === null) continue;
    out.push({ seq, label });
  }
  return out;
}

/**
 * Defensively parse + validate the proxy's STRING content into a judgment
 * (T-73-04-PARSE). Strips an optional ```json fence, JSON.parses, validates the
 * shape, clamps each dimension, and computes goal_aligned_ratio IN CODE from the
 * labels. Throws on any irrecoverable shape problem so the caller quarantines to
 * pending.
 * @param {string} content the proxy resp.content string.
 * @returns {object} judgment (pending:false, not_scored:null)
 */
function parseJudgment(content) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('judge: empty/non-string proxy content');
  }
  // Tolerate a fenced ```json … ``` wrapper or surrounding prose by extracting the
  // outermost {...} block; bare JSON passes through unchanged.
  const fenced = content.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('judge: no JSON object found in proxy content');
  }
  const parsed = JSON.parse(fenced.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('judge: parsed content is not an object');
  }

  const event_labels = normalizeLabels(parsed.event_labels);
  const rubricIn = (parsed.rubric && typeof parsed.rubric === 'object') ? parsed.rubric : {};
  const rubric = {
    goal_achieved: clampUnit(rubricIn.goal_achieved),
    code_quality: clampUnit(rubricIn.code_quality),
    test_coverage: clampUnit(rubricIn.test_coverage),
    regressions: clampBinary(rubricIn.regressions),
    spec_drift: clampUnit(rubricIn.spec_drift),
  };

  return {
    // Computed IN CODE from the labels — NOT trusted to the LLM's arithmetic.
    goal_aligned_ratio: computeGoalAlignedRatio(event_labels),
    event_labels,
    ratio_rationale: typeof parsed.ratio_rationale === 'string' ? parsed.ratio_rationale : '',
    rubric,
    rubric_rationale: typeof parsed.rubric_rationale === 'string' ? parsed.rubric_rationale : '',
    pending: false,
    not_scored: null,
  };
}

/**
 * Run the LLM judge for a single closed run.
 *
 * @param {object} args
 * @param {object} args.span the archived span (goal_sentence is read for context).
 * @param {Array<object>} args.trace the run's RouteEvent[] (filtered internally).
 * @param {object} args.evidence the deterministic on-disk evidence object (73-03).
 * @param {(body:object)=>Promise<object>} [args.callProxy] injectable proxy client
 *   (defaults to the real /api/complete client; tests inject a fake).
 * @returns {Promise<object>} the judgment object (NEVER throws):
 *   { goal_aligned_ratio, event_labels, ratio_rationale, rubric, rubric_rationale,
 *     pending, not_scored }.
 */
export async function runJudge({ span, trace, evidence, callProxy, forceScore = false } = {}) {
  // (1) D-04 trivial guard — short-circuit BEFORE paying the proxy. SKIPPED when
  //     forceScore is set (spec-driven experiment cells): a cell with a real goal +
  //     test_command that produced no consequential events is a FAILURE to be judged
  //     (goal≈0 from evidence: no diff, test fails), NOT a "trivial" run to hide. The
  //     judge reads the evidence even when the trace is empty.
  if (!forceScore && isTrivialRun(trace)) {
    return nullJudgment({ pending: false, not_scored: 'trivial' });
  }
  const consequential = filterConsequential(trace);
  const proxy = typeof callProxy === 'function' ? callProxy : callProxyDefault;

  // (2) ONE structured request. Pin a STRONG model explicitly (provider+model in the body, honored
  //     by /api/complete) — Opus 4.8 by default, NOT the taskType:'route_judge' fast/Haiku tier. The
  //     rubric is the arbiter of the comparison and must be reliable; taskType stays for telemetry/
  //     tier-fallback compatibility but the explicit model wins.
  const body = {
    process: 'route-judge',
    taskType: 'route_judge',
    provider: JUDGE_PROVIDER,
    model: JUDGE_MODEL,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: buildJudgeContext(span, consequential, evidence) },
    ],
  };

  // (3) Quarantine EVERYTHING (the call AND the parse) — runJudge never throws
  //     (D-03 / T-73-04-BLOCK / T-73-04-PARSE).
  try {
    const resp = await proxy(body);
    if (!resp || typeof resp !== 'object') {
      throw new Error('judge: proxy returned a non-object response');
    }
    return parseJudgment(resp.content);
  } catch (err) {
    process.stderr.write(
      `[experiments] runJudge quarantine task_id=${span?.task_id ?? 'unknown'} ` +
      `pending=true reason=${err?.message ?? String(err)}\n`,
    );
    return nullJudgment({ pending: true, not_scored: null });
  }
}

export { RUBRIC_DIMENSIONS };
