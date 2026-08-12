#!/usr/bin/env node
/**
 * Check every number the hand-written coding-v1 analysis quotes against the run data.
 *
 *   node scripts/kgbench-verify-report-claims.mjs
 *
 * WHY THIS EXISTS. docs/benchmarks/coding-v1/README.md is hand-written around generated
 * tables, which is what makes it worth reading and also what lets it rot: nothing regenerates
 * it, so a number can stay in the prose long after the data moved under it. Splitting the
 * generated RESULTS.md out stopped the page being DESTROYED by a re-render; it did nothing
 * about the page quietly disagreeing with the run.
 *
 * It is not hypothetical. The first run of this checker over a page that had just been written
 * from the data found two defects: a figure that was generated on every publish and embedded
 * nowhere, and a judge-substitution claim ("the remaining 76") that described one agent's
 * split as though it were the whole run's — the real numbers are 20 opus / 58 haiku / 18
 * unjudged for copilot alone.
 *
 * The expected values below are deliberately hardcoded. They are a snapshot of what the
 * published page asserts, so when the page is rewritten for a new run this file is rewritten
 * with it, and any claim that was carried over unchanged gets re-checked against new data.
 *
 * Exits 2 when the run data is absent (results.jsonl is gitignored — a fresh clone cannot
 * run this), non-zero on any mismatch, 0 when the page and the data agree.
 */
import { readFileSync, existsSync } from 'node:fs';

// The run the published page describes. Must move with the page: this checker compares the
// PROSE against the ROWS, so pointing it at a different run than the one README.md analyses
// makes every number disagree at once — which is loud, but for the wrong reason.
const RUN = '.data/kgbench/runs/coding-v1-r8';
if (!existsSync(`${RUN}/results.jsonl`)) {
  process.stdout.write(`kgbench: no run data at ${RUN}/results.jsonl (gitignored) — nothing to check.\n`);
  process.exit(2);
}
const rows = readFileSync(`${RUN}/results.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const md = readFileSync('docs/benchmarks/coding-v1/README.md', 'utf8');
const report = JSON.parse(readFileSync('docs/benchmarks/coding-v1/report.json', 'utf8'));

const med = (a) => {
  const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const p90 = (a) => {
  const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  return v.length ? v[Math.min(v.length - 1, Math.floor(0.9 * v.length))] : null;
};
const ok = (arm, agent) => rows.filter((r) => r.arm === arm && r.agent === agent && r.outcome === 'ok');
const all = (arm, agent) => rows.filter((r) => r.arm === arm && r.agent === agent);

let pass = 0; let fail = 0;
const check = (label, actual, expected, tol = 0) => {
  const good = typeof expected === 'number' && typeof actual === 'number'
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  process.stdout.write(`  ${good ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} claimed=${expected}  actual=${actual}\n`);
  good ? pass++ : fail++;
};
/** The claim must literally appear in the published prose. */
const claims = (label, needle) => {
  const good = md.includes(needle);
  process.stdout.write(`  ${good ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} "${needle.slice(0, 44)}"\n`);
  good ? pass++ : fail++;
};

process.stdout.write('\n== header ==\n');
check('total cells', rows.length, 384);
check('contaminated', rows.filter((r) => r.contaminated).length, 0);
check('tool escapes', rows.filter((r) => r.outcome === 'tool_escape').length, 0);
check('sandbox paths removed', report.meta.sandbox.excluded.length, 31);
check('tree commit', report.meta.sandbox.tree_commit.slice(0, 9), 'f4f13e86a');

process.stdout.write('\n== bottom line, claude arms ==\n');
const BOTTOM = {
  grep: { content: 77394, lat: 18.1, p90: 34.9, cost: 0.084 },
  graphify: { content: 131190, lat: 28.1, p90: 69.2, cost: 0.153 },
  codegraph: { content: 161322, lat: 50.3, p90: 122.0, cost: 0.192 },
  hybrid: { content: 86579, lat: 18.5, p90: 32.4, cost: 0.090 },
};
for (const [arm, e] of Object.entries(BOTTOM)) {
  const r = ok(arm, 'claude');
  check(`${arm} n`, r.length, 48);
  check(`${arm} correctness median`, med(r.map((x) => x.score)), 1);
  check(`${arm} content tokens`, Math.round(med(r.map((x) => x.content_tokens))), e.content, 1);
  check(`${arm} latency`, Number(med(r.map((x) => x.wall_s)).toFixed(1)), e.lat, 0.05);
  check(`${arm} p90 latency`, Number(p90(r.map((x) => x.wall_s)).toFixed(1)), e.p90, 0.05);
  check(`${arm} cost`, Number(med(r.map((x) => x.cost_usd)).toFixed(3)), e.cost, 0.0005);
  check(`${arm} hard failures`, all(arm, 'claude').length - r.length, 0);
}

process.stdout.write('\n== the stated ratios ==\n');
const g = med(ok('grep', 'claude').map((x) => x.content_tokens));
const ratios = ['graphify', 'codegraph'].map((a) => med(ok(a, 'claude').map((x) => x.content_tokens)) / g);
check('token ratio range low  (claims 1.7)', Number(Math.min(...ratios).toFixed(1)), 1.7, 0.05);
check('token ratio range high (claims 2.1)', Number(Math.max(...ratios).toFixed(1)), 2.1, 0.05);
const gl = med(ok('grep', 'claude').map((x) => x.wall_s));
const lr = ['graphify', 'codegraph'].map((a) => med(ok(a, 'claude').map((x) => x.wall_s)) / gl);
check('latency ratio low  (claims 1.5)', Number(Math.min(...lr).toFixed(1)), 1.5, 0.05);
check('latency ratio high (claims 2.8)', Number(Math.max(...lr).toFixed(1)), 2.8, 0.05);
const gc = med(ok('grep', 'claude').map((x) => x.cost_usd));
const cr = ['graphify', 'codegraph'].map((a) => med(ok(a, 'claude').map((x) => x.cost_usd)) / gc);
check('cost ratio low  (claims 1.8)', Number(Math.min(...cr).toFixed(1)), 1.8, 0.05);
check('cost ratio high (claims 2.3)', Number(Math.max(...cr).toFixed(1)), 2.3, 0.05);

process.stdout.write('\n== hybrid tool choice ==\n');
const h = all('hybrid', 'claude');
const tools = {};
for (const r of h) for (const t of (r.tools_executed || [])) tools[t] = (tools[t] || 0) + 1;
check('total tool calls', Object.values(tools).reduce((a, b) => a + b, 0), 230);
check('graph-tool calls', Object.entries(tools).filter(([k]) => k.startsWith('mcp__')).reduce((a, [, n]) => a + n, 0), 6);
check('graphify calls', Object.entries(tools).filter(([k]) => k.includes('graphify')).reduce((a, [, n]) => a + n, 0), 1);
check('cells using any graph tool', h.filter((r) => (r.tools_executed || []).some((t) => t.startsWith('mcp__'))).length, 6);
check('Grep calls', tools.Grep ?? 0, 156);

// THE POOLED TOOL-CHOICE RESULT, computed across every run whose hybrid arm has the identical
// tool surface. This is the page's central conclusion and the only claim on it that a replicate
// STRENGTHENED, so it is checked across runs rather than pinned to this one. It also catches the
// class of error that produced the retracted "r6: 4 graph calls in 348" — a figure matching no
// run, arm or agent in the corpus, which survived because nothing recomputed it.
const POOL_RUNS = ['coding-v1-r6', 'coding-v1-r7', 'coding-v1-x2', 'coding-v1-r8'];
const HYBRID_SURFACE = ['Glob', 'Grep', 'Read', 'mcp__graphify__query_graph', 'mcp__graphify__get_node',
  'mcp__graphify__get_neighbors', 'mcp__graphify__shortest_path', 'mcp__graphify__graph_stats',
  'mcp__graphify__god_nodes', 'mcp__codegraph__codegraph_explore'];
const pooled = { cells: 0, calls: 0, graph: 0, gfy: 0, touched: 0, runs: 0 };
for (const runId of POOL_RUNS) {
  const rf = `.data/kgbench/runs/${runId}/results.jsonl`;
  const mf = `.data/kgbench/runs/${runId}/run.json`;
  if (!existsSync(rf) || !existsSync(mf)) continue;
  // Pooling is only legitimate while the tool surface is identical — a run offering different
  // tools is a different experiment, and averaging it in would hide that.
  const arm = (JSON.parse(readFileSync(mf, 'utf8')).arms || []).find((a) => a.id === 'hybrid');
  if (!arm || JSON.stringify(arm.allowedTools) !== JSON.stringify(HYBRID_SURFACE)) continue;
  pooled.runs += 1;
  for (const r of readFileSync(rf, 'utf8').trim().split('\n').map((l) => JSON.parse(l))) {
    if (r.arm !== 'hybrid' || (r.agent ?? 'claude') !== 'claude' || r.outcome !== 'ok') continue;
    const t = r.tools_executed ?? r.tools ?? [];
    const g = t.filter((x) => x.startsWith('mcp__'));
    pooled.cells += 1; pooled.calls += t.length; pooled.graph += g.length;
    pooled.gfy += t.filter((x) => x.includes('graphify')).length;
    if (g.length) pooled.touched += 1;
  }
}
if (pooled.runs === POOL_RUNS.length) {
  check('pooled runs with an identical hybrid surface', pooled.runs, 4);
  check('pooled hybrid cells', pooled.cells, 248);
  check('pooled hybrid tool calls', pooled.calls, 1084);
  check('pooled graph calls', pooled.graph, 17);
  check('pooled Graphify calls', pooled.gfy, 3);
  check('pooled cells touching the index', pooled.touched, 17);
  check('pooled graph share of calls %', Number((100 * pooled.graph / pooled.calls).toFixed(2)), 1.57, 0.005);
  check('pooled cell share %', Number((100 * pooled.touched / pooled.cells).toFixed(1)), 6.9, 0.05);
  // The retracted figure must not come back: no run in the pool has 4 graph calls or 348 calls.
  claims('the page records that r6 is 3 in 322', '3 in 322');
} else {
  process.stdout.write(`  SKIP  pooled tool-choice checks (${pooled.runs}/${POOL_RUNS.length} runs present)\n`);
}
check('Read calls', tools.Read ?? 0, 49);
check('Glob calls', tools.Glob ?? 0, 19);
for (const arm of ['graphify', 'codegraph']) {
  check(`${arm}: cells with no graph call`, all(arm, 'claude').filter((r) => !(r.tools_executed || []).some((t) => t.startsWith('mcp__'))).length, 6);
}

process.stdout.write('\n== agent axis table ==\n');
const AGENTS = [
  ['grep', 'claude', 48, 48, 77394, 18.1], ['grep', 'copilot', 48, 48, 143346, 33.8],
  ['grep', 'opencode', 44, 48, 107170, 41.0], ['hybrid', 'claude', 48, 48, 86579, 18.5],
  ['hybrid', 'copilot', 48, 48, 139868, 32.1], ['hybrid', 'opencode', 46, 48, 121469, 30.1],
];
for (const [arm, ag, ranked, runs, content, lat] of AGENTS) {
  check(`${arm}/${ag} ranked`, ok(arm, ag).length, ranked);
  check(`${arm}/${ag} runs`, all(arm, ag).length, runs);
  check(`${arm}/${ag} content (all cells, as in RESULTS.md)`, Math.round(med(ok(arm, ag).map((x) => x.content_tokens))), content, 1);
  check(`${arm}/${ag} latency`, Number(med(ok(arm, ag).map((x) => x.wall_s)).toFixed(1)), lat, 0.05);
}

// THE PAGE AND RESULTS.md NOW QUOTE THE SAME DENOMINATOR, and this is what holds them there.
//
// They did not before. The page quoted opencode over an "unambiguous subset" of 35 and 40 cells,
// on the belief that the excluded rows double-counted a neighbour's session. They did not — they
// were the retried cells, correctly attributed, and dropping them removed the cells that had paid
// for two attempts, which moved opencode's cost DOWN rather than correcting it. Every retried cell
// is now attributed per attempt and none are flagged, so the subset IS the ranked set. Asserting
// that identity is stronger than checking two numbers: it fails the moment a subset reappears.
const clean = (arm, ag) => ok(arm, ag).filter((r) => !r.token_ambiguous);
for (const arm of ['grep', 'hybrid']) {
  check(`${arm}/opencode: the clean subset IS the ranked set`, clean(arm, 'opencode').length, ok(arm, 'opencode').length);
}
const ocVsClaude = med(ok('grep', 'opencode').map((x) => x.content_tokens)) / med(ok('grep', 'claude').map((x) => x.content_tokens));
check('opencode ~1.38x claude tokens', Number(ocVsClaude.toFixed(2)), 1.38, 0.005);
check('opencode hard-fail rate %', Math.round((1 - ok('grep', 'opencode').length / 48) * 100), 8);
const copilotVsClaude = med(ok('grep', 'copilot').map((x) => x.content_tokens)) / med(ok('grep', 'claude').map((x) => x.content_tokens));
check('copilot ~1.85x claude tokens', Number(copilotVsClaude.toFixed(2)), 1.85, 0.005);

process.stdout.write('\n== per-question, where the analysis names a number ==\n');
const q = (id, arm) => med(rows.filter((r) => r.id === id && r.arm === arm && r.agent === 'claude' && r.outcome === 'ok').map((r) => r.score));
check('codegraph L2', Number(q('L2', 'codegraph').toFixed(2)), 0.00, 0.005);
check('codegraph B3', Number(q('B3', 'codegraph').toFixed(2)), 0.50, 0.005);
check('codegraph A1', Number(q('A1', 'codegraph').toFixed(2)), 0.65, 0.005);
check('graphify L2', Number(q('L2', 'graphify').toFixed(2)), 0.65, 0.005);
// A4 IS NOT AN ARM DIFFERENCE, and pinning its per-arm medians as though it were is what let
// the page report one. It is a two-value question — every cell scores 0.82 or 1.00 — so the
// three-rep median is decided by which value lands twice. What gets pinned is that bimodality,
// because it is the reason no A4 median means anything.
const a4 = rows.filter((r) => r.id === 'A4' && r.agent === 'claude' && r.outcome === 'ok');
check('A4 takes exactly two distinct scores', [...new Set(a4.map((r) => Number(r.score.toFixed(2))))].sort().join('/'), '0.82/1');
check('every A4 arm produces BOTH values', ['grep', 'graphify', 'codegraph', 'hybrid']
  .every((arm) => new Set(a4.filter((r) => r.arm === arm).map((r) => Number(r.score.toFixed(2)))).size === 2), true);
for (const arm of ['grep', 'hybrid']) check(`${arm} L2`, Number(q('L2', arm).toFixed(2)), 1.00, 0.005);
// TRUE OF THIS RUN, and the page now says only that. grep scores 0.82 on A4 in r7 and x2, so
// stating it unqualified turned a run-local fact into a property of the arm.
check('grep is 1.00 on every question IN THIS RUN', [...new Set(rows.map((r) => r.id))].every((id) => q(id, 'grep') === 1), true);
claims('the page qualifies that claim to this run', 'so that is a fact about this run rather than a property of the arm');
// THE PER-QUESTION CLAIMS, COUNTED IN CELLS ACROSS RUNS. Medians are what let a bad cell hide:
// reading per-run medians alone, B3 looked like an r8 artifact, because its x2 failure is the
// minority cell of a 1.00/1.00/0.00 triple. This page was published with that verdict. Counting
// cells has no such blind spot, and it is checked across every run sharing this answer key.
const KEY_RUNS = ['coding-v1-r7', 'coding-v1-x2', 'coding-v1-r8'];
const pooledCells = [];
for (const runId of KEY_RUNS) {
  const f = `.data/kgbench/runs/${runId}/results.jsonl`;
  if (!existsSync(f)) continue;
  for (const r of readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l))) {
    if ((r.agent ?? 'claude') === 'claude' && r.outcome === 'ok') pooledCells.push({ ...r, run: runId });
  }
}
if (new Set(pooledCells.map((r) => r.run)).size === KEY_RUNS.length) {
  const below = (id, arm) => pooledCells.filter((r) => r.id === id && r.arm === arm && r.score < 0.995);
  const total = (id, arm) => pooledCells.filter((r) => r.id === id && r.arm === arm).length;
  const runsOf = (id, arm) => new Set(below(id, arm).map((r) => r.run)).size;
  // L2 — the one result that never once reaches 1.00.
  check('L2/codegraph cells below 1.00', `${below('L2', 'codegraph').length}/${total('L2', 'codegraph')}`, '9/9');
  check('L2/codegraph never reaches 1.00', below('L2', 'codegraph').every((r) => r.score <= 0.5), true);
  check('L2/grep and hybrid are perfect', below('L2', 'grep').length + below('L2', 'hybrid').length, 0);
  check('L2/graphify is a single-run miss', runsOf('L2', 'graphify'), 1);
  // A1 — implicates BOTH backends, which the page said only of codegraph until it was counted.
  check('A1/codegraph cells below 1.00', `${below('A1', 'codegraph').length}/${total('A1', 'codegraph')}`, '10/16');
  check('A1/graphify cells below 1.00', `${below('A1', 'graphify').length}/${total('A1', 'graphify')}`, '5/16');
  check('A1/graphify misses span 2 runs', runsOf('A1', 'graphify'), 2);
  check('A1/grep and hybrid are perfect', below('A1', 'grep').length + below('A1', 'hybrid').length, 0);
  // B3 — real but thin, and NOT the r8-only artifact a median reading suggested.
  check('B3/codegraph cells below 1.00', `${below('B3', 'codegraph').length}/${total('B3', 'codegraph')}`, '3/9');
  check('B3/codegraph misses span 2 runs, not 1', runsOf('B3', 'codegraph'), 2);
  // A4 — every arm loses cells, which is why no A4 median means anything.
  check('A4 costs every arm cells', ['grep', 'graphify', 'codegraph', 'hybrid']
    .every((arm) => below('A4', arm).length >= 10), true);
  // A1'S MECHANISM. The section claims Graphify misses the RATIONALE while never missing the
  // entities, because the rationale lives in a YAML comment and Graphify indexes no YAML. Each
  // link in that chain is checked, because a mechanism story is exactly the kind of claim that
  // reads well and rots quietly.
  const gA1bad = below('A1', 'graphify');
  check('every graphify A1 miss is the same fact (f1)',
    gA1bad.every((r) => JSON.stringify(r.grade_missing ?? []) === '["f1"]'), true);
  check('graphify never misses f2 or f3 on A1',
    gA1bad.some((r) => (r.grade_missing ?? []).some((f) => f !== 'f1')), false);
  const citesCompose = (r) => /docker-compose/i.test(String(r.answer ?? ''));
  const a1Of = (arm) => pooledCells.filter((r) => r.id === 'A1' && r.arm === arm);
  check('graphify cites docker-compose.yml on A1', a1Of('graphify').filter(citesCompose).length, 2);
  check('grep cites docker-compose.yml on A1', a1Of('grep').filter(citesCompose).length, 14);
  // THE RETRACTED CLAIM, KEPT AS A PIN. This page once read 4/10 here as "codegraph reaches the
  // file and still fails", concluding its A1 losses were a separate unexplained problem. The
  // number is real; the reading was backwards, because `citesCompose` is a KEYWORD test and six
  // of those ten cells name the file only to say they could not read it. The pin stays so the
  // artifact stays reproducible, relabelled so nobody reaches for it as evidence again.
  const cgCiting = a1Of('codegraph').filter(citesCompose);
  check('ARTIFACT: keyword-citation metric on codegraph A1',
    `${cgCiting.filter((r) => r.score > 0.995).length}/${cgCiting.length}`, '4/10');

  // WHAT THE CELLS ACTUALLY CLAIM. Classified by assertion rather than vocabulary, and this is
  // the axis the section now rests on: claiming to have READ the file predicts 1.00 perfectly,
  // and claiming the repository is ABSENT predicts failure perfectly.
  const claimsRead = (r) => /found (it|the (exact )?answer)[^.]{0,40}docker[/-]compose|docker\/docker-compose\.yml[`']?\s*[:#]\s*\d/i.test(String(r.answer ?? ''));
  // THE ABSENCE CLASSIFICATION IS HAND-AUDITED, NOT PATTERN-MATCHED. A phrase-enumerating regex
  // stood here for one commit and published "five failing cells make no claim in either
  // direction". It was two: the pattern missed r7/8's "no `.codegraph/` index or file access
  // available in this sandbox" — a denial in words it had not listed — and counted r7/1 and
  // r7/10 as silent when both name memory as their source. Enumerating phrasings is the same
  // defect as the substring test it replaced, one level in. So the categories below come from
  // reading all sixteen answers end to end, and the regex survives only as a TRIPWIRE (below)
  // that fires if the underlying answers ever change.
  const A1_AUDIT = {
    'r7/9': 'read-compose', 'x2/1': 'read-compose', 'x2/2': 'read-compose', 'x2/3': 'read-compose',
    'r7/2': 'read-other-file', 'r7/3': 'read-other-file',
    'r7/5': 'denies-access', 'r7/7': 'denies-access', 'r7/8': 'denies-access',
    'r8/1': 'denies-access', 'r8/2': 'denies-access', 'r8/3': 'denies-access',
    'r7/1': 'memory-sourced', 'r7/10': 'memory-sourced',
    'r7/4': 'silent', 'r7/6': 'silent',
  };
  const shortRun = (r) => r.run.replace('coding-v1-', '');
  const cgA1 = pooledCells.filter((r) => r.id === 'A1' && r.arm === 'codegraph');
  const bucket = (name) => cgA1.filter((r) => A1_AUDIT[`${shortRun(r)}/${r.rep}`] === name);
  check('A1 hand-audit covers every codegraph cell',
    cgA1.every((r) => A1_AUDIT[`${shortRun(r)}/${r.rep}`] !== undefined) && cgA1.length === 16, true);
  for (const [name, expect] of [['read-compose', '4/4'], ['read-other-file', '2/2'],
    ['denies-access', '0/6'], ['memory-sourced', '0/2'], ['silent', '0/2']]) {
    const v = bucket(name);
    check(`A1/codegraph ${name}`, `${v.filter((r) => r.score > 0.995).length}/${v.length}`, expect);
  }
  // The partition the section rests on: claiming a file read is exactly equivalent to scoring 1.00.
  const claimedRead = cgA1.filter((r) => ['read-compose', 'read-other-file'].includes(A1_AUDIT[`${shortRun(r)}/${r.rep}`]));
  check('A1/codegraph: every file-read claim scores 1.00',
    claimedRead.every((r) => r.score > 0.995) && claimedRead.length === 6, true);
  check('A1/codegraph: every non-claim fails',
    cgA1.filter((r) => !claimedRead.includes(r)).every((r) => r.score < 0.995), true);
  check('A1/codegraph: 8 of 10 failures disclose a non-repo source',
    bucket('denies-access').length + bucket('memory-sourced').length, 8);
  const a1All = pooledCells.filter((r) => r.id === 'A1');
  const readers = a1All.filter(claimsRead);
  const absenters = bucket('denies-access');
  check('A1: claiming to have read the file is a perfect predictor',
    `${readers.filter((r) => r.score > 0.995).length}/${readers.length}`, '29/29');
  check('A1: claiming the repo is absent is a perfect predictor of failure',
    `${absenters.filter((r) => r.score > 0.995).length}/${absenters.length}`, '0/6');
  check('A1: only codegraph ever claims the repo is absent',
    [...new Set(absenters.map((r) => r.arm))].join(','), 'codegraph');
  // THE CROSS-QUESTION SPREAD. Regex-derived and therefore a LOWER BOUND, labelled as one on the
  // page: only A1's sixteen cells have been read individually. Widened to include the phrasing
  // that produced the retracted count of 7.
  const DENY_RE = /no live access|can't grep|cannot grep|isn't present in this working tree|stripped down for the benchmark|don't have live filesystem|no Bash\/Grep tool|working tree has no|isn't checked out here|no direct filesystem access|no shell\/grep access|file access available in this sandbox|isn't available in this session|no `?\.codegraph\/?`? index|I'd need file access/i;
  const denialCells = pooledCells.filter((r) => DENY_RE.test(String(r.answer ?? '')));
  check('denial-of-access cells, all questions (lower bound)', denialCells.length, 18);
  check('denial-of-access is codegraph-only across every question',
    [...new Set(denialCells.map((r) => r.arm))].join(','), 'codegraph');
  check('denial cells span six questions',
    [...new Set(denialCells.map((r) => r.id))].sort().join(','), 'A1,B2,L2,T1,T3,T4');
  // Denial is fatal only where nothing else carries the answer — A1 and L2, the two questions
  // this page independently identifies as outside the index.
  check('denial is fatal on A1 and L2, harmless elsewhere',
    [...new Set(denialCells.filter((r) => r.score < 0.995).map((r) => r.id))].sort().join(','), 'A1,L2');

  // THE CODEGRAPH INDEX DOES NOT COVER THE SANDBOX. A harness defect, so it is checked against
  // the harness (sandbox.mjs, docker-compose.yml, the registry) as well as against the answers.
  const NOINDEX = /codegraph init|not indexed by codegraph|no `?\.codegraph\/?`?( directory| index)?|isn't indexed|not initialized/i;
  const cgAll = pooledCells.filter((r) => r.arm === 'codegraph');
  const unreachable = cgAll.filter((r) => NOINDEX.test(String(r.answer ?? '')));
  check('codegraph cells reporting no index (lower bound)', unreachable.length, 30);
  check('reporting no index is not uniformly fatal (T4 all pass)',
    unreachable.filter((r) => r.id === 'T4').every((r) => r.score > 0.995), true);
  // L2 splits into a harness defect and a capability result. The page quotes BOTH, not the blend.
  const l2 = cgAll.filter((r) => r.id === 'L2');
  const l2Bad = l2.filter((r) => NOINDEX.test(String(r.answer ?? '')));
  const l2Ok = l2.filter((r) => !NOINDEX.test(String(r.answer ?? '')));
  check('L2: index-unreachable cells all score 0.00',
    `${l2Bad.length}:${l2Bad.every((r) => r.score < 0.01)}`, '5:true');
  check('L2: index-reached cells all score exactly 0.50',
    `${l2Ok.length}:${l2Ok.every((r) => Math.abs(r.score - 0.5) < 0.01)}`, '4:true');
  check('L2: every index-reached cell misses f2, the importer',
    l2Ok.every((r) => (r.grade_missing ?? []).includes('f2')), true);
  // THE STRUCTURAL FACTS, checked at their source rather than quoted from prose.
  const sbSrc = existsSync('lib/kgbench/sandbox.mjs') ? readFileSync('lib/kgbench/sandbox.mjs', 'utf8') : '';
  check('sandbox worktree is built under os.tmpdir()',
    /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'kgbench-tree-'\)\)/.test(sbSrc), true);
  const compose = existsSync('docker/docker-compose.yml') ? readFileSync('docker/docker-compose.yml', 'utf8') : '';
  check('container mounts only ~/Agentic as /workspace',
    /\$\{HOME\}\/Agentic:\/workspace:ro/.test(compose), true);
  const reg = JSON.parse(readFileSync('config/code-graph.json', 'utf8'));
  check('codegraph MCP is container-side stdio',
    `${reg.backends.codegraph.mcp.transport}/${reg.backends.codegraph.mcp.command}`, 'stdio/docker');
  check('codegraph indexes /workspace/coding, not the sandbox',
    reg.backends.codegraph.index.target, '/workspace/coding');
  // The containment hole: excluded paths present in the index. Bounded, and the ANSWER KEY is
  // not among them — that distinction is the difference between a flaw and a retraction.
  if (existsSync('.data/codegraph/codegraph.db')) {
    const { execFileSync } = await import('node:child_process');
    const q = (sql) => execFileSync('sqlite3', ['.data/codegraph/codegraph.db', sql], { encoding: 'utf8' }).trim();
    check('answer key is NOT in the codegraph index',
      q("SELECT count(*) FROM files WHERE path LIKE 'config/kgbench%';"), '0');
    check('observation exports are NOT in the codegraph index',
      q("SELECT count(*) FROM files WHERE path LIKE '.data/%';"), '0');
    const excluded = JSON.parse(readFileSync(`${RUN}/run.json`, 'utf8')).sandbox.excluded;
    const indexed = q('SELECT path FROM files;').split('\n');
    const leaked = excluded.filter((e) => indexed.some((p) => p === e || p.startsWith(`${e.replace(/\/$/, '')}/`)));
    check('sandbox-excluded paths reachable via the index', `${leaked.length}/${excluded.length}`, '15/31');
  } else {
    process.stdout.write('  SKIP  codegraph.db absent — index-containment claims unchecked\n');
  }

  // THE RE-MEASUREMENT. Every number in the r8-cgidx section is computed here rather than
  // transcribed, including the ones that went AGAINST the fix — a section that pins only its
  // good news is a press release.
  const FIXED = '.data/kgbench/runs/coding-v1-r8-cgidx/results.jsonl';
  if (existsSync(FIXED)) {
    const fx = readFileSync(FIXED, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const base = rows.filter((r) => r.agent === 'claude' && r.outcome === 'ok');
    const qm = (set, arm, id) => {
      const v = set.filter((r) => r.arm === arm && r.id === id);
      return v.reduce((a, b) => a + b.score, 0) / v.length;
    };
    check('cgidx ran 96 cells, all ok', `${fx.length}:${fx.every((r) => r.outcome === 'ok')}`, '96:true');
    check('cgidx corpus is pinned to r8\'s commit',
      JSON.parse(readFileSync('.data/kgbench/runs/coding-v1-r8-cgidx/run.json', 'utf8')).sandbox.tree_commit.slice(0, 9),
      'f4f13e86a');
    // L2 — the artifact, now resolved.
    check('L2/codegraph r8 -> cgidx', `${qm(base, 'codegraph', 'L2').toFixed(2)} -> ${qm(fx, 'codegraph', 'L2').toFixed(2)}`, '0.17 -> 1.00');
    // A1 — must NOT move, or the corpus-scope explanation on this page is wrong.
    check('A1/codegraph is unchanged (corpus scope, not the harness)',
      `${qm(base, 'codegraph', 'A1').toFixed(2)} -> ${qm(fx, 'codegraph', 'A1').toFixed(2)}`, '0.65 -> 0.65');
    check('A1 still misses exactly f1',
      fx.filter((r) => r.arm === 'codegraph' && r.id === 'A1' && r.score < 0.995)
        .every((r) => JSON.stringify(r.grade_missing ?? []) === '["f1"]'), true);
    // A4 — the one that went DOWN, and the reason it is not claimed as an effect.
    check('A4/codegraph dropped', `${qm(fx, 'codegraph', 'A4').toFixed(2)}`, '0.54');
    check('A4 0.54 is inside its historical spread (x2 was lower)',
      qm(pooledCells.filter((r) => r.run === 'coding-v1-x2'), 'codegraph', 'A4') <= qm(fx, 'codegraph', 'A4'), true);
    // Arm means.
    const mean = (set, arm) => {
      const v = set.filter((r) => r.arm === arm);
      return v.reduce((a, b) => a + b.score, 0) / v.length;
    };
    check('codegraph arm mean', `${mean(base, 'codegraph').toFixed(3)} -> ${mean(fx, 'codegraph').toFixed(3)}`, '0.881 -> 0.929');
    // THE BEHAVIOURAL RESULT, which is the larger one.
    const tools = (set, arm, pred) => set.filter((r) => r.arm === arm).flatMap((r) => r.tools_executed ?? []).filter(pred).length;
    const isRead = (t) => t === 'Read'; const isCg = (t) => t.includes('codegraph');
    check('codegraph Read calls collapse', `${tools(base, 'codegraph', isRead)} -> ${tools(fx, 'codegraph', isRead)}`, '427 -> 94');
    check('codegraph MCP calls double', `${tools(base, 'codegraph', isCg)} -> ${tools(fx, 'codegraph', isCg)}`, '67 -> 136');
    const touched = (set, arm) => set.filter((r) => r.arm === arm && (r.tools_executed ?? []).some((t) => t.startsWith('mcp__'))).length;
    check('hybrid cells using a graph tool', `${touched(base, 'hybrid')}/48 -> ${touched(fx, 'hybrid')}/48`, '6/48 -> 20/48');
    // ...and the direction that SURVIVES the fix: more reaching, no better answers.
    check('no hybrid question improved', [...new Set(fx.filter((r) => r.arm === 'hybrid').map((r) => r.id))]
      .every((id) => qm(fx, 'hybrid', id) <= qm(base, 'hybrid', id) + 0.001), true);
    // Containment: the index is over the SWEPT corpus, so excluded paths must not surface.
    const EXCLUDED_PATHS = ['lib/kgbench/judge.mjs', 'lib/kgbench/graders.mjs', 'lib/kgbench/agents.mjs'];
    check('no cgidx cell cites a sandbox-excluded path',
      fx.filter((r) => EXCLUDED_PATHS.some((p) => String(r.answer).includes(p))).length, 0);
    // T3 — the grader defect this run exposed, now FIXED. What is pinned is the mechanism, not
    // the outcome: the cell must be scored correctly AND the old character window must still be
    // demonstrably wrong about it. Pinning only "T3 is 1.00" would stay green if someone
    // special-cased the answer; pinning only the gap length would stay green if the fix were
    // reverted. Both together say: this specific sentence is why the unit changed.
    const t3 = fx.find((r) => r.arm === 'hybrid' && r.id === 'T3'
      && /No payment-processing/i.test(String(r.answer)));
    check('the cgidx T3 cell is present', Boolean(t3), true);
    if (t3) {
      const gap = String(t3.answer).match(/\bNo\b([^.!?]*?)\bexists?\b/i);
      check('its abstention is 64 chars wide — the old window allowed 60', gap ? gap[1].length : null, 64);
      check('the retired 60-CHARACTER window rejects it',
        /\bno\b[^.!?]{0,60}\b(?:exists?)\b/i.test(String(t3.answer)), false);
      check('the retired adjacent-noun pattern rejects it too',
        /\bno (?:module|file|service|implementation)\b/i.test(String(t3.answer)), false);
      check('the WORD-counted gap accepts it', /\bno\b(?:\s+[^\s.!?]+){0,6}\s+(?:exists?)\b/i
        .test(String(t3.answer)), true);
      check('and it is now scored as the correct abstention it is',
        `${t3.score}:${t3.hallucinated}`, '1:false');
    }
    // The regrade touched three cells in three runs and nothing else. Pinned because a scoring
    // fix that quietly moved a fourth cell would be a measurement change wearing a fix's clothes.
    for (const [run, expect] of [['coding-v1-r8', 'grep/T4/1'], ['coding-v1-x2', 'grep/T3/1'],
      ['coding-v1-r8-cgidx', 'hybrid/T3/2']]) {
      const f = `.data/kgbench/runs/${run}/regrade.json`;
      if (!existsSync(f)) { process.stdout.write(`  SKIP  ${run} regrade log absent\n`); continue; }
      const g = JSON.parse(readFileSync(f, 'utf8'));
      check(`${run} regrade moved exactly one cell`,
        g.changes.map((c) => `${c.arm}/${c.id}/${c.rep}`).join(','), expect);
      check(`${run} regrade only cleared a false hallucination`,
        g.changes.every((c) => c.score[0] === 0 && c.score[1] === 1
          && c.hallucinated[0] === true && c.hallucinated[1] === false), true);
    }
  } else {
    process.stdout.write('  SKIP  coding-v1-r8-cgidx absent — re-measurement claims unchecked\n');
  }

  // TRIPWIRE. Not a classifier — a change detector. If the answers behind the hand-audit are ever
  // replaced, the broad net's hit count moves and this fires, forcing a re-read rather than
  // letting a stale hand-audit silently describe different data.
  const BROAD = /\b(memory|memories|can'?t|cannot|couldn'?t|unable|no access|not available|isn'?t available|unverified|not verified|sandbox|checked out|working tree|spot-check|treat this as)\b/i;
  check('TRIPWIRE: broad-net hedge count on codegraph A1 is unchanged',
    cgA1.filter((r) => BROAD.test(String(r.answer ?? ''))).length, 11);
  // The claim is FALSE: the sandbox is a full worktree and the file is not excluded.
  const r8run = '.data/kgbench/runs/coding-v1-r8/run.json';
  if (existsSync(r8run)) {
    const sb = JSON.parse(readFileSync(r8run, 'utf8')).sandbox ?? {};
    check('r8 sandbox is a verified worktree', `${sb.mode}/${sb.verified}`, 'worktree/true');
    check('docker-compose.yml is NOT sandbox-excluded',
      (sb.excluded ?? []).some((p) => p.includes('docker')), false);
  }
  // The tool surface is the root cause: these arms have Read but no way to FIND a path.
  const surfaceOf = (arm) => [...new Set(pooledCells.filter((r) => r.arm === arm)
    .map((r) => JSON.stringify(r.available_tools ?? [])))];
  for (const arm of ['codegraph', 'graphify']) {
    const s = surfaceOf(arm);
    check(`${arm} arm has exactly one tool surface`, s.length, 1);
    check(`${arm} arm has Read`, JSON.parse(s[0]).includes('Read'), true);
    check(`${arm} arm has no path-discovery tool`,
      JSON.parse(s[0]).some((t) => t === 'Glob' || t === 'Grep'), false);
  }
  check('grep arm does have them', JSON.parse(surfaceOf('grep')[0]).join(','), 'Glob,Grep,Read');
  // Both backends fail A1 on the same substrate error, which is why it is ONE mechanism.
  const cgA1bad = below('A1', 'codegraph');
  check('every codegraph A1 miss is also f1',
    cgA1bad.every((r) => JSON.stringify(r.grade_missing ?? []) === '["f1"]'), true);
  check('every codegraph A1 miss names LevelDB, none names SQLite',
    `${cgA1bad.filter((r) => /leveldb/i.test(String(r.answer))).length}/${cgA1bad.filter((r) => /sqlite/i.test(String(r.answer))).length}`,
    '10/0');

  // THE INDEX CLAIM ITSELF. "Graphify indexes no YAML" is the load-bearing premise of the A1
  // mechanism, and it is a fact about graph.json rather than about any run — so it is checked
  // against graph.json. A regex scan rather than JSON.parse: the file is ~60MB and parsing it
  // would cost more than every other check on this page combined, for one boolean.
  const GRAPH = '.data/graphify/graphify-out/graph.json';
  if (existsSync(GRAPH)) {
    const raw = readFileSync(GRAPH, 'utf8');
    check('graphify indexes no YAML source files', (raw.match(/"source_file":\s*"[^"]*\.ya?ml"/g) ?? []).length, 0);
    check('docker-compose.yml is not a graphify source', /"source_file":\s*"[^"]*docker-compose\.yml"/.test(raw), false);
  } else {
    process.stdout.write('  SKIP  graph.json absent — index-coverage claims unchecked\n');
  }

  // grep pooled is NOT clean, though it is clean within r8.
  const grepBad = [...new Set(pooledCells.filter((r) => r.arm === 'grep' && r.score < 0.995).map((r) => r.id))].sort();
  check('grep drops cells on four questions when pooled', grepBad.join(','), 'A4,B1,B3,T4');
} else {
  process.stdout.write('  SKIP  pooled per-question checks (not all key runs present)\n');
}

check('codegraph L2 median tool calls', med(rows.filter((r) => r.id === 'L2' && r.arm === 'codegraph' && r.agent === 'claude').map((r) => r.tool_calls)), 12);

process.stdout.write('\n== class medians all 1.00 (claude) ==\n');
for (const cls of [...new Set(rows.map((r) => r.cls))].sort()) {
  for (const arm of ['grep', 'graphify', 'codegraph', 'hybrid']) {
    const m = med(rows.filter((r) => r.cls === cls && r.arm === arm && r.agent === 'claude' && r.outcome === 'ok').map((r) => r.score));
    if (m !== 1) { process.stdout.write(`  FAIL  ${cls}/${arm} median is ${m}, analysis says every class ties at 1.00\n`); fail++; } else pass++;
  }
}
process.stdout.write(`  (checked ${5 * 4} class/arm medians)\n`);

process.stdout.write('\n== reliability and hallucination ==\n');
check('hallucinated rows', rows.filter((r) => r.hallucinated).length, 3);
// WHAT SURVIVES A REPLICATE, and only that. "No forced graph arm hallucinated" is still true of
// this run and is NOT pinned as a finding: balanced claude-only across four runs it is 1/72 vs
// 0/72, P(observe 0) = 0.61. Pinning a null result invites the next reader to quote it. The
// abstain fix moved it from 2/72 and P = 0.37 — a withdrawn claim getting weaker, as it should.
check('all hallucinations are abstain-class', rows.filter((r) => r.hallucinated).every((r) => r.id.startsWith('T')), true);
claims('the page withdraws the graph-arm claim', 'indistinguishable from chance and is withdrawn');
claims('the page states the cost of settling it', '400 abstain cells per family');

process.stdout.write('\n== token attribution after the fix ==\n');
// ZERO, and it took two corrections to get here. 21 cells were flagged, the page called them
// double-counts of a neighbour's session, and they were nothing of the kind: they were the 21
// cells that had been RETRIED, each owning one session per attempt. Ambiguity is now judged per
// attempt, so a retry is priced without a warning and only genuine concurrency flags.
check('ambiguous cells', rows.filter((r) => r.token_ambiguous).length, 0);
check('cells with an inherited predecessor', rows.filter((r) => r.token_sessions_inherited > 0).length, 44);
check('proxy-db-session cells', rows.filter((r) => r.token_source === 'proxy-db-session').length, 192);
check('stream-json cells', rows.filter((r) => r.token_source === 'stream-json').length, 192);
check('unmeasured cells', rows.filter((r) => r.token_source === 'unmeasured').length, 0);

// THE ROW MUST DESCRIBE THE CELL. This is the invariant the whole repair exists to restore, and
// it is checked on the published rows rather than only in unit tests: a row whose wall_s is less
// than the attempts it lists is contradicting itself, which is how the defect was visible all
// along without anything objecting.
const retried = rows.filter((r) => Array.isArray(r.attempts) && r.attempts.length > 1);
check('retried cells', retried.length, 21);
check('every retried cell records a window per attempt',
  retried.every((r) => r.attempts.every((a) => a.started_at && a.ended_at)), true);
check('no row is charged less than its own attempts',
  retried.filter((r) => r.wall_s + 0.05 < r.attempts.reduce((a, x) => a + (x.wall_s ?? 0), 0)).length, 0);
check('every retried cell attributes one session per attempt',
  retried.every((r) => (r.token_attempt_sessions ?? []).every((c) => c <= 1)), true);
// The continuation-budget table refuses to print an x2 latency, because x2's rows still carry the
// pre-fix understatement. Pinned so nobody "completes" the table with a number that would read as
// a slowdown the budget did not cause.
claims('the x2 latency is withheld, not estimated', '| `x2` — budget 0 | 6/48 (13%) | 1.00 | not comparable |');

process.stdout.write('\n== the continuation-budget comparison, RECOMPUTED not matched ==\n');
// A published figure here was arithmetically impossible for weeks — a shared-denominator mean of
// 0.935 over 44 answered cells summing to 43.00, which needs those cells to average 1.020. It
// survived because it sat between two correct numbers and agreed with the surrounding argument.
// So these are derived from the rows and compared to the page, never matched as text.
const CONT2B = '.data/kgbench/runs/coding-v1-r8-cont2b/results.jsonl';
const b1 = rows.filter((r) => r.arm === 'grep' && r.agent === 'opencode');
const b1ok = b1.filter((r) => r.outcome === 'ok');
const meanOf = (a) => a.reduce((x, y) => x + y, 0) / a.length;
check('budget 1 answered', b1ok.length, 44);
check('budget 1 mean over answered', Number(meanOf(b1ok.map((r) => r.score)).toFixed(3)), 0.977, 0.0005);
check('budget 1 mean with non-answers at 0',
  Number(meanOf(b1.map((r) => (r.outcome === 'ok' ? r.score : 0))).toFixed(3)), 0.896, 0.0005);
claims('the page prints the shared-denominator pair it can support', '0.896 → 0.975');
// The impossible figure is still ON the page — inside defect 31, which is where a withdrawn
// number belongs. What must never come back is 0.935 stated as a live result, and the check
// above is what enforces that: the live pair is 0.896 → 0.975 and there is only one of them.
claims('defect 31 names the figure it withdraws', '0.935 → 0.948');

if (existsSync(CONT2B)) {
  const c2b = readFileSync(CONT2B, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const c2bok = c2b.filter((r) => r.outcome === 'ok');
  check('budget 2 answered (cont2b)', c2bok.length, 48);
  check('budget 2 mean over answered (cont2b)', Number(meanOf(c2bok.map((r) => r.score)).toFixed(3)), 0.975, 0.0005);
  // The retracted claim was that this FALLS below budget 1's 0.977. It does not.
  check('budget 2 does NOT fall materially below budget 1',
    meanOf(c2bok.map((r) => r.score)) > meanOf(b1ok.map((r) => r.score)) - 0.01, true);
  const spread = [0, 1, 2].map((k) => c2b.filter((r) => (r.continuations_used ?? 0) === k).length);
  check('budget 2 continuation spread (cont2b)', spread.join('/'), '7/31/10');
  // The page used to say "nothing reaches the ceiling" beside a spread whose last number IS the
  // ceiling count. Pinned as a number so the contradiction cannot come back.
  check('cells that spend the budget in full', spread[2], 10);
  check('every ceiling cell still answered',
    c2b.filter((r) => (r.continuations_used ?? 0) >= 2).every((r) => r.outcome === 'ok'), true);
}

process.stdout.write('\n== disagreements ==\n');
check('disagreement count', report.disagreements.length, 20);
check('all are checklist_higher', report.disagreements.every((d) => d.kind === 'checklist_higher'), true);

process.stdout.write('\n== judge ==\n');
const served = rows.map((r) => r.judge_model_served).filter(Boolean);
check('sonnet-5-judged cells', served.filter((m) => m.includes('sonnet-5')).length, 308);
check('haiku-judged cells (all re-judged)', served.filter((m) => m.includes('haiku')).length, 0);
check('report records NO mismatch', report.meta.judge.mismatch, false);

process.stdout.write('\n== provenance ==\n');
check('claude cells', rows.filter((r) => r.agent === 'claude').length, 192);
check('non-claude cells', rows.filter((r) => r.agent !== 'claude').length, 192);
check('cross-question answer reuse (all agents)', (() => {
  let n = 0;
  for (const ag of ['claude', 'copilot', 'opencode']) {
    const byText = {};
    for (const r of rows.filter((x) => x.agent === ag && x.answer)) (byText[r.answer] ??= new Set()).add(r.id);
    n += Object.values(byText).filter((s) => s.size > 1).length;
  }
  return n;
})(), 0);

process.stdout.write('\n== figure captions (a caption is part of the figure) ==\n');
// The arch figure asserted "A1-A4, 10 reps each" — hardcoded from the runs that deepened the
// architecture questions — while its own lane labels read n=12 for a 3-rep run, and it was
// published that way. Only a visual check caught it, because nothing reads an SVG's text.
{
  const svg = readFileSync('docs/images/kgbench-arch-spread-light.svg', 'utf8');
  const archIds = [...new Set(rows.filter((r) => r.cls === 'arch').map((r) => r.id))].sort();
  const claudeArch = rows.filter((r) => r.agent === 'claude' && r.cls === 'arch');
  const reps = Math.max(...archIds.map((id) => claudeArch.filter((r) => r.arm === 'grep' && r.id === id).length));
  const span = `${archIds[0]}-${archIds[archIds.length - 1]}`;
  check('arch caption question span', svg.includes(span), true);
  check('arch caption rep count', svg.includes(`${reps} rep${reps === 1 ? '' : 's'} each`), true);
  check('arch caption agrees with lane n=', svg.includes(`n=${archIds.length * reps}`), true);
}
// Both image trees must carry the same bytes, or the site and GitHub show different figures.
for (const name of ['kgbench-correctness', 'kgbench-cost', 'kgbench-arch-spread']) {
  for (const mode of ['light', 'dark']) {
    const a = readFileSync(`docs/images/${name}-${mode}.svg`, 'utf8');
    const b = existsSync(`docs-content/images/${name}-${mode}.svg`)
      ? readFileSync(`docs-content/images/${name}-${mode}.svg`, 'utf8') : null;
    check(`${name}-${mode} mirrored to docs-content`, b === a, true);
  }
}

process.stdout.write('\n== prose claims that must match the data ==\n');
claims('defect table has 40 rows', '| 40 |');
claims('says forty defects', 'Forty defects were found');
claims('links RESULTS.md', '[`RESULTS.md`](RESULTS.md)');
claims('embeds the correctness chart', 'kgbench-correctness-light.svg');
claims('embeds the cost chart', 'kgbench-cost-light.svg');
claims('embeds the arch-spread chart', 'kgbench-arch-spread-light.svg');

process.stdout.write(`\n${fail ? 'FAILURES' : 'ALL CLAIMS VERIFIED'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
