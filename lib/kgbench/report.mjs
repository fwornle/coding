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

/**
 * The measurement provenance of a set of rows: which agent ran them, whether its tool
 * surface was actually enforced, how the answer was got out of it, and where the token
 * numbers came from.
 *
 * This exists because the agent axis makes cells that look alike mean different things. A
 * "grep arm" cell on claude was CONFINED to Glob/Grep/Read by `--disallowedTools`; the same
 * cell on opencode was merely CONFIGURED with no MCP servers and kept every built-in it
 * ships with. Both land in the results file as `arm: "grep"`. Averaging them into one median
 * and printing it under a single heading would state a comparison that was never run — so
 * every number this module prints carries the provenance of the rows behind it.
 */
export function provenanceOf(rows) {
  const agents = [...new Set(rows.map((r) => r.agent ?? 'claude'))].sort();
  const elicitations = [...new Set(rows.map((r) => r.elicitation ?? 'stream-json'))].sort();
  const tokenSources = {};
  for (const r of rows) {
    const s = r.token_source ?? (r.total_tokens != null ? 'stream-json' : 'unmeasured');
    tokenSources[s] = (tokenSources[s] ?? 0) + 1;
  }
  // 'enforced' only when EVERY row was: a single unenforced cell means the arm's label
  // over-claims for the run as a whole, and the weaker fact is the true one.
  const builtins = rows.map((r) => r.enforcement?.builtins ?? (r.agent && r.agent !== 'claude' ? 'ungated' : 'enforced'));
  return {
    agents,
    elicitations,
    token_sources: tokenSources,
    builtins_enforced: builtins.length > 0 && builtins.every((b) => b === 'enforced'),
    builtins_states: [...new Set(builtins)].sort(),
    ambiguous_token_rows: rows.filter((r) => r.token_ambiguous).length,
  };
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
      provenance: provenanceOf(armRows),
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

  // The agent axis, when a run has one. A single-agent run produces `byArmAgent: null` and
  // renders exactly as it did before the axis existed — the cross-agent tables appear only
  // when there is genuinely more than one agent to tell apart.
  const agents = [...new Set(rows.map((r) => r.agent ?? 'claude'))].sort();
  let byArmAgent = null;
  if (agents.length > 1) {
    byArmAgent = {};
    for (const arm of arms) {
      for (const ag of agents) {
        const cellRows = rows.filter((r) => r.arm === arm && (r.agent ?? 'claude') === ag);
        if (!cellRows.length) continue;
        const ok = cellRows.filter((r) => classifyRow(r) === 'ranked');
        byArmAgent[`${arm}@${ag}`] = {
          arm,
          agent: ag,
          runs: cellRows.length,
          ranked: ok.length,
          failed: cellRows.filter((r) => classifyRow(r) === 'failed').length,
          hard_fail_rate: cellRows.length ? cellRows.filter((r) => classifyRow(r) === 'failed').length / cellRows.length : null,
          provenance: provenanceOf(cellRows),
          metrics: {
            score: summaryStats(ok.map((r) => r.score)),
            total_tokens: summaryStats(ok.map((r) => r.total_tokens)),
            content_tokens: summaryStats(ok.map((r) => r.content_tokens)),
            tool_calls: summaryStats(ok.map((r) => r.tool_calls)),
            wall_s: summaryStats(ok.map((r) => r.wall_s)),
          },
        };
      }
    }
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

  return { byArm, byClass, classes, agents, byArmAgent, provenance: provenanceOf(rows) };
}

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

/**
 * How the numbers above were obtained, and what each way of obtaining them is worth.
 *
 * Rendered only when there is something to disclose — a non-claude agent, or a token figure
 * that did not come from the agent's own report. A pure single-agent claude run prints
 * nothing here and is byte-identical to the reports that came before the agent axis.
 *
 * Token sources are spelled out rather than footnoted because they differ in KIND, not
 * precision. `proxy-db-window` sums the proxy rows that were written while the cell ran; it
 * is a time join, and a time join is only as good as the assumption that nothing else of that
 * agent was running. That assumption is checked, not asserted — `token_ambiguous` counts the
 * cells where it failed.
 */
function renderProvenance({ agents, provenance, byArmAgent }) {
  const L = [];
  const sources = provenance?.token_sources ?? {};
  const crossAgent = agents.length > 1 || agents.some((a) => a !== 'claude');
  const derivedTokens = Object.keys(sources).some((s) => s !== 'stream-json');
  if (!crossAgent && !derivedTokens) return L;

  L.push('## Measurement provenance', '');

  if (crossAgent) {
    L.push('**Only claude cells were tool-enforced.** `--allowedTools`, `--disallowedTools` and '
      + '`--strict-mcp-config` are claude flags. For copilot and opencode an arm\'s MCP servers are '
      + 'restricted by writing the config file each CLI reads, but their built-in file and search '
      + 'tools cannot be withheld — so on those agents an arm name describes the retrieval strategy '
      + 'the cell was *asked* to use, not one it was *confined* to. Arms whose identity depends on '
      + 'withholding built-in search are refused outright on those agents rather than run under a '
      + 'label they would not honour.', '');
    L.push('**Answers were elicited differently.** claude streams its answer as structured JSON; the '
      + 'others are told to write it to a file, because an analysis-shaped prompt makes copilot exit '
      + 'in seconds and opencode yield on its first toolless step, both "succeeding" having answered '
      + 'nothing. That difference is a confound in every cross-agent comparison here, and it is not '
      + 'removable — it is what makes those cells produce an answer at all.', '');
  }

  if (derivedTokens) {
    L.push('**Where the token numbers came from.**', '');
    L.push('| Source | cells | what it means |');
    L.push('|---|--:|---|');
    const meaning = {
      'stream-json': 'the agent reported its own usage — first-party and exact',
      'proxy-db-taskid': 'the wire carried this cell\'s task id — exact, reconstructed from the proxy',
      'proxy-db-window': 'proxy rows that ran while the cell ran — a time join, weaker than a tag',
      unmeasured: 'no rows found; the field is null, never 0',
    };
    for (const [src, n] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
      L.push(`| \`${src}\` | ${n} | ${meaning[src] ?? '—'} |`);
    }
    L.push('');
    L.push('A cell whose tokens are `unmeasured` still ranks on correctness; it is only absent from the '
      + 'token medians. Reporting 0 there would make the least measurable agent look the cheapest.', '');
    if (provenance?.ambiguous_token_rows) {
      L.push(`> **${provenance.ambiguous_token_rows} cell(s) had more than one session of the same agent `
        + 'inside their window.** Their token figures may include traffic that is not the cell\'s. '
        + 'This happens when another session of that agent runs alongside the benchmark; re-run those '
        + 'cells on an otherwise idle machine before quoting their cost.', '');
    }
  }

  if (byArmAgent) {
    const seams = [...new Set(Object.values(byArmAgent).map((c) => c.agent))];
    L.push(`Agents in this run: \`${seams.join('`, `')}\`.`, '');
  }
  return L;
}

export function renderMarkdown(report) {
  const {
    meta, byArm, byClass, classes, disagreements = [],
    agents = ['claude'], byArmAgent = null, provenance = null,
  } = report;
  const arms = Object.keys(byArm);
  const L = [];

  // An arm whose cells were not all tool-enforced gets a dagger next to its name EVERYWHERE
  // its numbers appear. A caveat that lives only in a Limitations section at the bottom is a
  // caveat nobody reads next to the number it qualifies.
  const unenforced = (arm) => byArm[arm]?.provenance && !byArm[arm].provenance.builtins_enforced;
  const armLabel = (arm) => `${arm}${unenforced(arm) ? ' †' : ''}`;

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
  // A partial publication has to announce itself in the header, not in a footnote. Every
  // count below — cells, reps, medians — is over the kept subset, so a reader who does not
  // know an axis was dropped will read "384 cells" out of a table built from 192.
  if (meta.agentFilter) {
    const f = meta.agentFilter;
    L.push(`> **Partial run: only \`${f.kept.join('`, `')}\` cells are reported here.** `
      + `${f.rowsExcluded} cell(s) from \`${f.excluded.join('`, `')}\` are excluded and every number `
      + `below is over the kept subset alone. Reason: ${f.reason}`, '');
  }

  L.push('## Overall', '');
  // The warning goes ABOVE the table. A pooled median across agents is not a summary of the
  // run, it is an average of two different experiments — 96k tokens on copilot and 1k on
  // claude have no meaningful midpoint — and a reader who meets the number first has already
  // drawn a conclusion by the time a footnote arrives to withdraw it.
  if (agents.length > 1) {
    L.push(`> **Pooled across ${agents.length} agents (\`${agents.join('`, `')}\`).** Each row below mixes cells `
      + 'that were run by different agents, elicited differently, and — for everything except claude — not '
      + 'confined to the arm\'s tool surface. The medians are arithmetic, not comparable. **[Per agent]'
      + '(#per-agent) is the table to read**; this one is kept only so arm-level reliability counts have '
      + 'somewhere to live.', '');
  }
  L.push('| Arm | ranked | correctness (median) | content tokens (median) | total tokens (median) | tool calls | latency s | hard-fail | hallucination |');
  L.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const a of arms) {
    const m = byArm[a].metrics;
    L.push(`| ${armLabel(a)} | ${byArm[a].ranked}/${byArm[a].runs} | ${fmt(m.score.median, 2)} | ${fmt(m.content_tokens.median)} | ${fmt(m.total_tokens.median)} | ${fmt(m.tool_calls.median, 1)} | ${fmt(m.wall_s.median, 1)} | ${pct(byArm[a].hard_fail_rate)} | ${pct(byArm[a].hallucination_rate)} |`);
  }
  L.push('');
  L.push('**content tokens** = total minus that arm\'s measured empty-run baseline. Whole-session totals are dominated by a fixed floor of system prompt + tool schemas, which compresses every ratio; content tokens are what separate retrieval strategies.', '');
  if (arms.some(unenforced)) {
    L.push('† **This arm\'s tool surface was not enforced on every cell.** Only claude can be confined '
      + 'to an arm\'s tools (`--allowedTools`/`--disallowedTools`/`--strict-mcp-config`); on the other '
      + 'agents the arm\'s MCP servers are restricted but the built-in file and search tools stay open. '
      + 'The row above is what the cells *did*, under a label describing what they were *asked* to be '
      + 'confined to. See [Measurement provenance](#measurement-provenance).', '');
  }

  // Split by agent when there is more than one. Without this split a single "grep" median
  // silently averages an enforced claude cell together with an ungated opencode one — one
  // number standing for two different experiments.
  if (byArmAgent && agents.length > 1) {
    L.push('## Per agent', '');
    L.push('These are the numbers the run actually produced. The `Overall` table above pools them per arm, and pooling across agents is only meaningful for `hybrid`, whose surface is "everything" on every agent.', '');
    L.push('| Arm | Agent | ranked | correctness | content tokens | total tokens | tool calls | latency s | hard-fail | built-ins | answer via | tokens from |');
    L.push('|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|---|');
    for (const key of Object.keys(byArmAgent)) {
      const c = byArmAgent[key];
      const m = c.metrics;
      const p = c.provenance;
      const srcs = Object.entries(p.token_sources).sort((x, y) => y[1] - x[1]).map(([s, n]) => `${s}×${n}`).join(', ');
      L.push(`| ${c.arm} | ${c.agent} | ${c.ranked}/${c.runs} | ${fmt(m.score.median, 2)} | ${fmt(m.content_tokens.median)} | `
        + `${fmt(m.total_tokens.median)} | ${fmt(m.tool_calls.median, 1)} | ${fmt(m.wall_s.median, 1)} | ${pct(c.hard_fail_rate)} | `
        + `${p.builtins_states.join('/')} | ${p.elicitations.join('/')} | ${srcs || '—'} |`);
    }
    L.push('');
    L.push('`tool calls` is blank for any agent elicited by answer file: only claude\'s stream-json reports a tool trace, so a dash there means **not measured**, not zero.', '');
  }

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
    L.push(`| ${armLabel(a)} | ${s.runs} | ${s.ranked} | ${s.ungraded} | ${s.failed} | ${pct(s.retry_rate)} | ${pct(s.hard_fail_rate)} |`);
  }
  L.push('');
  L.push('Failed runs are counted, never dropped. An arm that stalls is not cheap — it is unavailable, and averaging only its successes would report the opposite.', '');

  L.push(...renderProvenance({ agents, provenance, byArmAgent }));

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
  // "one model and one scorer" was true when there was one agent and one model. Asserting it
  // over a cross-agent run would be a limitation that understates the actual limitations.
  L.push(`- ${meta.reps} reps per cell on one repository with one scorer`
    + (agents.length > 1 ? `, across ${agents.length} agents whose cells are not equivalently enforced (see above).` : ' and one model.'));
  L.push('- Arms other than `hybrid` are FORCED onto a single retrieval strategy, which is not how an agent works in practice. Read them against `hybrid`, not against each other.');
  L.push('- Indexing cost is excluded from per-query numbers; it is reported separately per backend.');
  L.push('- Corpus scope differs between backends (graphify indexes docs and PDFs; code-only backends do not), so node/edge counts are not comparable at face value.');

  return L.join('\n') + '\n';
}
