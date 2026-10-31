/**
 * Judging two answers to one replayed turn, and the per-class verdict
 * (.planning/shared-job-classes.md, "P4 fixes and the second run").
 *
 * THE RUBRIC. "Which is better" split on answers that really differed and could
 * not tell a model from replay noise. It is replaced by three scores, read apart:
 *   same core     would a user act the same way or understand the same thing?
 *   contradictions  points where the two disagree in a way that would change what
 *                   the user does — listed for a reader, never counted: the same
 *                   model on the same snapshot disagrees with itself on side points
 *   completeness  1–5 per answer
 * Each pair is judged twice with the order swapped. A pair is "same core" only
 * when both readings say so; completeness is averaged over both readings, so a
 * position bonus cancels (measured at −0.05 on known-equal pairs, 2026-10-29).
 *
 * THE VERDICT. Per class and candidate: at least MIN_PAIRS judged pairs, and the
 * candidate gives the incumbent's core answer in at least PASS_RATE of them. The
 * A/A floor — incumbent replay against incumbent replay, or against the real
 * answer — is reported beside it; a floor below the pass rate means the replay
 * cannot show a difference the candidate is being held to.
 */

import { proxyTeacher } from './evolve.mjs';

export const MIN_PAIRS = 20;
export const PASS_RATE = 0.9;
/** The trials judge route (bg-model-trial-judge: high band, never offloaded). */
export const JUDGE_PROCESS = 'model-trial-judge';
const ANSWER_CHARS = 12_000;
const REQUEST_CHARS = 4_000;

export function judgeMessages({ request, first, second }) {
  const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}\n[…truncated]` : String(s));
  return [
    {
      role: 'system',
      content: [
        'You compare two answers an AI coding agent gave to the same request, in the same repository state.',
        'Answer with JSON only: {"same_core": true|false, "contradictions": ["…"], "completeness_first": 1-5, "completeness_second": 1-5, "note": "one sentence"}.',
        'same_core: would a user who read either answer act the same way, or come away understanding the same thing? Wording, order, length and extra detail do not matter; a different recommendation, diagnosis, set of steps or factual claim does.',
        'contradictions: only disagreements that would change what the user does. Leave it empty when the answers differ only in detail.',
        'completeness: how fully each answer covers what the request asked for, including caveats a user would need.',
        'Live figures (counts, statuses, timings read from running services) may legitimately differ between the two runs; do not count such a difference against same_core.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `REQUEST:\n${clip(request, REQUEST_CHARS)}\n\nFIRST ANSWER:\n${clip(first, ANSWER_CHARS)}\n\nSECOND ANSWER:\n${clip(second, ANSWER_CHARS)}`,
    },
  ];
}

export function parseJudgment(text) {
  const s = String(text ?? '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  if (typeof o.same_core !== 'boolean') return null;
  const score = (v) => (Number.isFinite(Number(v)) ? Math.min(5, Math.max(1, Number(v))) : null);
  return {
    sameCore: o.same_core,
    contradictions: Array.isArray(o.contradictions) ? o.contradictions.map(String).filter(Boolean) : [],
    completenessFirst: score(o.completeness_first),
    completenessSecond: score(o.completeness_second),
    note: typeof o.note === 'string' ? o.note : '',
  };
}

/**
 * Judge answers `a` and `b` twice, order swapped.
 *
 * @param {object} o
 * @param {(messages: Array) => Promise<string>} [o.complete]  the judge call (default: the proxy)
 * @returns {Promise<{sameCore: boolean|null, split: boolean, contradictions: string[], completenessA: number|null, completenessB: number|null, readings: object[]}>}
 */
export async function judgePair({ request, a, b, complete = proxyTeacher({ process: JUDGE_PROCESS }) }) {
  const ab = parseJudgment(await complete(judgeMessages({ request, first: a, second: b })));
  const ba = parseJudgment(await complete(judgeMessages({ request, first: b, second: a })));
  const readings = [ab, ba];
  if (!ab || !ba) return { sameCore: null, split: false, contradictions: [], completenessA: null, completenessB: null, readings };
  const mean = (x, y) => (x == null || y == null ? null : +((x + y) / 2).toFixed(2));
  return {
    sameCore: ab.sameCore && ba.sameCore,
    split: ab.sameCore !== ba.sameCore,
    contradictions: [...new Set([...ab.contradictions, ...ba.contradictions])],
    completenessA: mean(ab.completenessFirst, ba.completenessSecond),
    completenessB: mean(ab.completenessSecond, ba.completenessFirst),
    readings,
  };
}

/**
 * Per (class, candidate) verdict from judged replays.
 *
 * @param {Array<{jobClass: string, candidate: string, incumbent: string, trial?: object, floor?: object}>} results
 *   one per replayed turn: `trial` = incumbent replay vs candidate replay, `floor` = the A/A pair
 */
export function verdicts(results, { minPairs = MIN_PAIRS, passRate = PASS_RATE } = {}) {
  const groups = new Map();
  for (const r of results) {
    // Per agent too: a model that holds up in one agent's harness may not in another's.
    const agent = r.agent || 'claude'; // schema-1 results were claude-only
    const key = `${r.jobClass}\u0000${agent}\u0000${r.candidate}`;
    if (!groups.has(key)) groups.set(key, { jobClass: r.jobClass, agent, candidate: r.candidate, incumbents: new Set(), trial: [], floor: [], completeness: [] });
    const g = groups.get(key);
    g.incumbents.add(r.incumbent);
    if (r.trial?.sameCore != null) {
      g.trial.push(r.trial.sameCore);
      if (r.trial.completenessA != null && r.trial.completenessB != null) g.completeness.push(r.trial.completenessB - r.trial.completenessA);
    }
    if (r.floor?.sameCore != null) g.floor.push(r.floor.sameCore);
  }
  const rate = (xs) => (xs.length ? +(xs.filter(Boolean).length / xs.length).toFixed(3) : null);
  return [...groups.values()].map((g) => {
    const sameRate = rate(g.trial);
    const floorRate = rate(g.floor);
    const enough = g.trial.length >= minPairs;
    return {
      jobClass: g.jobClass,
      agent: g.agent,
      candidate: g.candidate,
      incumbents: [...g.incumbents],
      pairs: g.trial.length,
      sameCore: g.trial.filter(Boolean).length,
      sameRate,
      floorPairs: g.floor.length,
      floorRate,
      completenessDelta: g.completeness.length ? +(g.completeness.reduce((s, x) => s + x, 0) / g.completeness.length).toFixed(2) : null,
      verdict: !enough ? 'collecting'
        : floorRate != null && floorRate < passRate ? 'floor-too-low'
          : sameRate >= passRate ? 'pass' : 'fail',
    };
  });
}
