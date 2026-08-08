/**
 * kgbench aggregation and reporting, for N arms.
 *
 * The predecessor hardcoded ("grep","graph") in four places, so adding an arm meant
 * editing the renderer. Here arms are rows and N is free.
 *
 * Two disciplines borrowed from lib/experiments/compare.mjs:
 *   - null-not-zero: a missing metric is filtered out, never averaged in as 0. A
 *     stalled run that counts as "0 tokens" makes the stalling arm look cheap.
 *   - honesty groups: every row lands in exactly one bucket, and the non-ranked
 *     counts print next to every number instead of being filtered away.
 */

/** Rows that are eligible for ranking; everything else is reported, not averaged. */
export const BUCKETS = ['ranked', 'ungraded', 'failed'];

export function classifyRow(row) {
  if (row.hard_fail || row.outcome !== 'ok') return 'failed';
  if (row.score == null) return 'ungraded';
  return 'ranked';
}

export function summaryStats(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { mean: null, median: null, min: null, max: null, p95: null, n: 0 };
  const sum = v.reduce((a, b) => a + b, 0);
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return {
    mean: sum / v.length,
    median: v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2,
    min: v[0],
    max: v[v.length - 1],
    p95: at(0.95),
    n: v.length,
  };
}

function iqr(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return [q(0.25), q(0.75)];
}

/**
 * Winner declaration gate. With N=3 a 1.3x median gap is noise, and the previous
 * report declared 1.3-1.5x winners at that n. Requires both a real effect size and
 * non-overlapping spread, else "tie".
 */
export function declareWinner(candidates, { lowerIsBetter = false, minRatio = 1.25 } = {}) {
  const scored = candidates
    .filter((c) => c.values.filter((v) => v != null).length > 0)
    .map((c) => ({ ...c, stats: summaryStats(c.values), spread: iqr(c.values) }));
  if (scored.length < 2) return { winner: null, reason: 'fewer than two arms with data' };

  scored.sort((a, b) => (lowerIsBetter ? a.stats.median - b.stats.median : b.stats.median - a.stats.median));
  const [first, second] = scored;
  const ratio = lowerIsBetter
    ? (second.stats.median || 0) / (first.stats.median || 1)
    : (first.stats.median || 0) / (second.stats.median || 1);

  if (!Number.isFinite(ratio) || ratio < minRatio) {
    return { winner: null, reason: `tie (ratio ${ratio.toFixed(2)}x < ${minRatio}x)`, ratio };
  }
  if (first.spread && second.spread) {
    const overlap = lowerIsBetter ? first.spread[1] >= second.spread[0] : first.spread[0] <= second.spread[1];
    if (overlap) return { winner: null, reason: `tie (IQR overlap, ratio ${ratio.toFixed(2)}x)`, ratio };
  }
  return { winner: first.arm, ratio, reason: `${ratio.toFixed(2)}x` };
}

/** Group graded rows into {arm: {metric: stats}} plus per-arm reliability counts. */
export function aggregate(rows, { arms, questions }) {
  const byArm = {};
  for (const arm of arms) {
    const armRows = rows.filter((r) => r.arm === arm);
    const buckets = { ranked: [], ungraded: [], failed: [] };
    for (const r of armRows) buckets[classifyRow(r)].push(r);
    const ok = buckets.ranked;

    byArm[arm] = {
      arm,
      runs: armRows.length,
      ranked: ok.length,
      ungraded: buckets.ungraded.length,
      failed: buckets.failed.length,
      hard_fail_rate: armRows.length ? buckets.failed.length / armRows.length : null,
      retry_rate: armRows.length ? armRows.filter((r) => r.retried).length / armRows.length : null,
      hallucination_rate: ok.length ? ok.filter((r) => r.hallucinated).length / ok.length : null,
      metrics: {
        score: summaryStats(ok.map((r) => r.score)),
        total_tokens: summaryStats(ok.map((r) => r.total_tokens)),
        content_tokens: summaryStats(ok.map((r) => r.content_tokens)),
        tool_calls: summaryStats(ok.map((r) => r.tool_calls)),
        wall_s: summaryStats(ok.map((r) => r.wall_s)),
        cost_usd: summaryStats(ok.map((r) => r.cost_usd)),
      },
    };
  }

  // Per-class winner matrix — the table that actually answers "which backend for
  // which kind of question". Deliberately gated, so a weak signal prints "tie".
  const classes = [...new Set(questions.map((q) => q.cls))].sort();
  const byClass = {};
  for (const cls of classes) {
    const candidates = arms.map((arm) => ({
      arm,
      values: rows.filter((r) => r.arm === arm && r.cls === cls && classifyRow(r) === 'ranked').map((r) => r.score),
    }));
    byClass[cls] = {
      scores: Object.fromEntries(candidates.map((c) => [c.arm, summaryStats(c.values)])),
      winner: declareWinner(candidates),
    };
  }

  return { byArm, byClass, classes };
}

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

export function renderMarkdown(report) {
  const { meta, byArm, byClass, classes, disagreements = [] } = report;
  const arms = Object.keys(byArm);
  const L = [];

  L.push(`# Code-retrieval benchmark: ${meta.set}`, '');
  L.push(`Question set \`${meta.set}\` (${meta.questionCount} questions, ${meta.reps} reps/arm) against ${arms.length} arms.`);
  L.push(`Repo at \`${meta.commit ?? 'unknown'}\`, model \`${meta.model}\`, generated ${meta.generatedAt}.`, '');

  // The judge is the secondary scorer, so which model was it is part of what the numbers
  // mean. Reported from the CELLS, never from the run's stated intent: runs r6 and r7
  // published a requested `claude-opus-4.8` that no provider serves while every call was
  // answered by claude-haiku-4-5, because /api/complete ignores the requested model.
  const j = meta.judge;
  if (j?.served?.length) {
    L.push(`Secondary scorer: \`${j.served.join('`, `')}\`${j.provider ? ` via \`${j.provider}\`` : ''}.`
      + (j.mismatch ? ` **Requested \`${j.requested}\` — the proxy served something else; the served model is what graded these cells.**` : ''), '');
  } else if (j?.requested) {
    L.push(`Secondary scorer: \`${j.requested}\` was *requested*; this run predates served-model recording, `
      + 'so what actually graded it is unverified. See [Measurement and judging lessons](../measurement-lessons.md).', '');
  }

  // Containment is a precondition for every number below, so it is stated up front
  // rather than buried in limitations. An uncontained run is not a weaker result — it
  // is not a result, because a leaked answer key produces correct answers and is
  // therefore invisible in the scores.
  const sb = meta.sandbox;
  if (sb?.mode === 'worktree') {
    L.push(`Arms searched a sandboxed worktree of \`${String(sb.tree_commit ?? '').slice(0, 9)}\` with `
      + `${(sb.excluded ?? []).length} path(s) removed (answer key, telemetry exports, agent rule files), `
      + 'verified to contain no question prompt or provenance note.', '');
  } else if (sb) {
    L.push('> **These numbers are not comparable.** The run was made with `--no-sandbox`, so the arms '
      + 'could read `config/kgbench/questions/` — the answer key that grades them.', '');
  }
  if (meta.history?.length) {
    const commits = [...new Set([...meta.history.map((h) => h.commit), meta.commit])].filter(Boolean);
    if (commits.length > 1) {
      L.push(`Assembled across ${commits.length} commits (\`${commits.join('`, `')}\`) — later passes added `
        + 'reps to a subset of questions. Cells are not all from one tree state.', '');
    }
  }
  if (meta.retiredQuestions?.length) {
    L.push(`Excluded: \`${meta.retiredQuestions.join('`, `')}\` — retired after this run started, and `
      + 'not folded into any median below. See the `retired` block on the question for why.', '');
  }
  if (meta.toolEscapeRows) {
    L.push(`> **${meta.toolEscapeRows} cell(s) used a tool the arm was not granted** and are unscored. `
      + 'An arm outside its tool surface is not running the strategy its label claims.', '');
  }
  // Wording kept deliberately spare. This module is one question's ground truth, so it
  // ships in the run tree — prose here explaining how a question class is built would be
  // readable by the arms being measured, which is how four earlier leaks happened.
  if (meta.selfIdentifiedProbeRows) {
    L.push(`> **${meta.selfIdentifiedProbeRows} answer(s) inferred the nature of the question** without `
      + 'citing any ground truth. Scored normally: reaching a conclusion from an empty search is the '
      + 'behaviour under test, not a leak. Counted because a question whose framing telegraphs its own '
      + 'answer measures less than retrieval does.', '');
  }
  if (meta.contaminatedRows) {
    L.push(`> **${meta.contaminatedRows} answer(s) cited the benchmark ground truth** and were excluded from `
      + 'ranking. Containment has regressed; treat this run as void.', '');
  }

  L.push('## Overall', '');
  L.push('| Arm | ranked | correctness (median) | content tokens (median) | total tokens (median) | tool calls | latency s | hard-fail | hallucination |');
  L.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const a of arms) {
    const m = byArm[a].metrics;
    L.push(`| ${a} | ${byArm[a].ranked}/${byArm[a].runs} | ${fmt(m.score.median, 2)} | ${fmt(m.content_tokens.median)} | ${fmt(m.total_tokens.median)} | ${fmt(m.tool_calls.median, 1)} | ${fmt(m.wall_s.median, 1)} | ${pct(byArm[a].hard_fail_rate)} | ${pct(byArm[a].hallucination_rate)} |`);
  }
  L.push('');
  L.push('**content tokens** = total minus that arm\'s measured empty-run baseline. Whole-session totals are dominated by a fixed floor of system prompt + tool schemas, which compresses every ratio; content tokens are what separate retrieval strategies.', '');

  L.push('## Winner by question class', '');
  L.push('| Class | ' + arms.join(' | ') + ' | winner |');
  L.push('|---' + '|--:'.repeat(arms.length) + '|---|');
  for (const cls of classes) {
    const row = arms.map((a) => fmt(byClass[cls].scores[a]?.median, 2));
    const w = byClass[cls].winner;
    L.push(`| ${cls} | ${row.join(' | ')} | ${w.winner ? `**${w.winner}** (${w.reason})` : `tie — ${w.reason}`} |`);
  }
  L.push('');
  L.push('A winner is declared only at a ≥1.25x median gap with non-overlapping IQR. Anything weaker prints "tie" — at these sample sizes a 1.3x gap is not a result.', '');

  L.push('## Reliability', '');
  L.push('| Arm | runs | ranked | ungraded | failed | retry rate | hard-fail rate |');
  L.push('|---|--:|--:|--:|--:|--:|--:|');
  for (const a of arms) {
    const s = byArm[a];
    L.push(`| ${a} | ${s.runs} | ${s.ranked} | ${s.ungraded} | ${s.failed} | ${pct(s.retry_rate)} | ${pct(s.hard_fail_rate)} |`);
  }
  L.push('');
  L.push('Failed runs are counted, never dropped. An arm that stalls is not cheap — it is unavailable, and averaging only its successes would report the opposite.', '');

  if (disagreements.length) {
    L.push('## Checklist vs judge disagreements', '');
    L.push('| Question | Arm | checklist | judge | note |');
    L.push('|---|---|--:|--:|---|');
    for (const d of disagreements) {
      L.push(`| ${d.id} | ${d.arm} | ${fmt(d.checklist, 2)} | ${fmt(d.judge, 2)} | ${d.kind} |`);
    }
    L.push('');
    L.push('`judge_higher` usually means the checklist matcher is too strict (the answer paraphrased a path) — fix the matcher and re-grade offline. `checklist_higher` usually means correct strings were padded into a wrong narrative, which is a real quality signal.', '');
    L.push('**This table is an alarm, not a diagnosis.** It says two graders differ; it does not say which is wrong, and the answer has not once been the obvious one. Across every investigation on this set the causes were a judge rubric, a false answer key, a regex, a shared match token, and a matcher that was too loose and too narrow at the same time — *never* a badly written question. Twice the arms were right and the key was wrong. And the detector is blind to the most common defect of all: because the judge\'s prompt is built from the same checklist, a WRONG KEY makes both graders agree and produces zero disagreements. See [Measurement and judging lessons](../measurement-lessons.md) before concluding a question is at fault.', '');
  }

  L.push('## Limitations', '');
  L.push(`- ${meta.reps} reps per cell on one repository with one model and one scorer.`);
  L.push('- Arms other than `hybrid` are FORCED onto a single retrieval strategy, which is not how an agent works in practice. Read them against `hybrid`, not against each other.');
  L.push('- Indexing cost is excluded from per-query numbers; it is reported separately per backend.');
  L.push('- Corpus scope differs between backends (graphify indexes docs and PDFs; code-only backends do not), so node/edge counts are not comparable at face value.');

  return L.join('\n') + '\n';
}
