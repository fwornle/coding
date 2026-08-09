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

const RUN = '.data/kgbench/runs/coding-v1-x2';
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
check('sandbox paths removed', report.meta.sandbox.excluded.length, 26);
check('tree commit', report.meta.sandbox.tree_commit.slice(0, 9), '56d581a48');

process.stdout.write('\n== bottom line, claude arms ==\n');
const BOTTOM = {
  grep: { content: 74872, lat: 17.8, p90: 47.4, cost: 0.091 },
  graphify: { content: 180527, lat: 36.5, p90: 95.1, cost: 0.194 },
  codegraph: { content: 133001, lat: 33.4, p90: 112.4, cost: 0.165 },
  hybrid: { content: 83081, lat: 20.1, p90: 33.2, cost: 0.087 },
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
check('token ratio range low  (claims 1.8)', Number(Math.min(...ratios).toFixed(1)), 1.8, 0.05);
check('token ratio range high (claims 2.4)', Number(Math.max(...ratios).toFixed(1)), 2.4, 0.05);
const gl = med(ok('grep', 'claude').map((x) => x.wall_s));
const lr = ['graphify', 'codegraph'].map((a) => med(ok(a, 'claude').map((x) => x.wall_s)) / gl);
check('latency ratio low  (claims 1.9)', Number(Math.min(...lr).toFixed(1)), 1.9, 0.05);
check('latency ratio high (claims 2.1)', Number(Math.max(...lr).toFixed(1)), 2.1, 0.05);
const gc = med(ok('grep', 'claude').map((x) => x.cost_usd));
const cr = ['graphify', 'codegraph'].map((a) => med(ok(a, 'claude').map((x) => x.cost_usd)) / gc);
check('cost ratio low  (claims 1.8)', Number(Math.min(...cr).toFixed(1)), 1.8, 0.05);
check('cost ratio high (claims 2.1)', Number(Math.max(...cr).toFixed(1)), 2.1, 0.05);

process.stdout.write('\n== hybrid tool choice ==\n');
const h = all('hybrid', 'claude');
const tools = {};
for (const r of h) for (const t of (r.tools_executed || [])) tools[t] = (tools[t] || 0) + 1;
check('total tool calls', Object.values(tools).reduce((a, b) => a + b, 0), 226);
check('graph-tool calls', Object.entries(tools).filter(([k]) => k.startsWith('mcp__')).reduce((a, [, n]) => a + n, 0), 3);
check('graphify calls', Object.entries(tools).filter(([k]) => k.includes('graphify')).reduce((a, [, n]) => a + n, 0), 0);
check('cells using any graph tool', h.filter((r) => (r.tools_executed || []).some((t) => t.startsWith('mcp__'))).length, 3);
check('Grep calls', tools.Grep ?? 0, 150);
check('Read calls', tools.Read ?? 0, 51);
check('Glob calls', tools.Glob ?? 0, 22);
for (const arm of ['graphify', 'codegraph']) {
  check(`${arm}: cells with no graph call`, all(arm, 'claude').filter((r) => !(r.tools_executed || []).some((t) => t.startsWith('mcp__'))).length, 6);
}

process.stdout.write('\n== agent axis table ==\n');
const AGENTS = [
  ['grep', 'claude', 48, 48, 74872, 17.8], ['grep', 'copilot', 48, 48, 132147, 35.2],
  ['grep', 'opencode', 6, 48, 43571, 23.4], ['hybrid', 'claude', 48, 48, 83081, 20.1],
  ['hybrid', 'copilot', 48, 48, 105865, 33.6], ['hybrid', 'opencode', 6, 48, 79003, 18.3],
];
for (const [arm, ag, ranked, runs, content, lat] of AGENTS) {
  check(`${arm}/${ag} ranked`, ok(arm, ag).length, ranked);
  check(`${arm}/${ag} runs`, all(arm, ag).length, runs);
  check(`${arm}/${ag} content`, Math.round(med(ok(arm, ag).map((x) => x.content_tokens))), content, 1);
  check(`${arm}/${ag} latency`, Number(med(ok(arm, ag).map((x) => x.wall_s)).toFixed(1)), lat, 0.05);
}
check('opencode hard-fail rate %', Math.round((1 - ok('grep', 'opencode').length / 48) * 100), 88);
const copilotVsClaude = med(ok('grep', 'copilot').map((x) => x.content_tokens)) / med(ok('grep', 'claude').map((x) => x.content_tokens));
check('copilot ~1.8x claude tokens', Number(copilotVsClaude.toFixed(1)), 1.8, 0.05);

process.stdout.write('\n== per-question, where the analysis names a number ==\n');
const q = (id, arm) => med(rows.filter((r) => r.id === id && r.arm === arm && r.agent === 'claude' && r.outcome === 'ok').map((r) => r.score));
check('codegraph L2', Number(q('L2', 'codegraph').toFixed(2)), 0.00, 0.005);
check('codegraph A2', Number(q('A2', 'codegraph').toFixed(2)), 0.65, 0.005);
check('codegraph A4', Number(q('A4', 'codegraph').toFixed(2)), 0.33, 0.005);
for (const arm of ['grep', 'graphify', 'hybrid']) check(`${arm} A4`, Number(q('A4', arm).toFixed(2)), 0.82, 0.005);
for (const arm of ['grep', 'graphify', 'hybrid']) check(`${arm} L2`, Number(q('L2', arm).toFixed(2)), 1.00, 0.005);
check('codegraph A2 median tool calls', med(rows.filter((r) => r.id === 'A2' && r.arm === 'codegraph' && r.agent === 'claude').map((r) => r.tool_calls)), 20);

process.stdout.write('\n== class medians all 1.00 (claude) ==\n');
for (const cls of [...new Set(rows.map((r) => r.cls))].sort()) {
  for (const arm of ['grep', 'graphify', 'codegraph', 'hybrid']) {
    const m = med(rows.filter((r) => r.cls === cls && r.arm === arm && r.agent === 'claude' && r.outcome === 'ok').map((r) => r.score));
    if (m !== 1) { process.stdout.write(`  FAIL  ${cls}/${arm} median is ${m}, analysis says every class ties at 1.00\n`); fail++; } else pass++;
  }
}
process.stdout.write(`  (checked ${5 * 4} class/arm medians)\n`);

process.stdout.write('\n== reliability and hallucination ==\n');
check('hallucinated rows', rows.filter((r) => r.hallucinated).length, 1);
const hal = rows.find((r) => r.hallucinated);
check('the hallucination is grep/claude/T3', `${hal.arm}/${hal.agent}/${hal.id}/rep${hal.rep}`, 'grep/claude/T3/rep1');

process.stdout.write('\n== token attribution after the fix ==\n');
check('ambiguous cells', rows.filter((r) => r.token_ambiguous).length, 0);
check('cells with an inherited predecessor', rows.filter((r) => r.token_sessions_inherited > 0).length, 94);
check('proxy-db-session cells', rows.filter((r) => r.token_source === 'proxy-db-session').length, 192);
check('stream-json cells', rows.filter((r) => r.token_source === 'stream-json').length, 192);
check('unmeasured cells', rows.filter((r) => r.token_source === 'unmeasured').length, 0);

process.stdout.write('\n== disagreements ==\n');
check('disagreement count', report.disagreements.length, 8);
check('all are checklist_higher', report.disagreements.every((d) => d.kind === 'checklist_higher'), true);

process.stdout.write('\n== judge ==\n');
const served = rows.map((r) => r.judge_model_served).filter(Boolean);
check('opus-judged cells', served.filter((m) => m.includes('opus')).length, 23);
check('haiku-judged cells', served.filter((m) => m.includes('haiku')).length, 218);
check('report records a mismatch', report.meta.judge.mismatch, true);

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
claims('defect table has 18 rows', '| 18 |');
claims('says eighteen defects', 'Eighteen defects were found');
claims('links RESULTS.md', '[`RESULTS.md`](RESULTS.md)');
claims('embeds the correctness chart', 'kgbench-correctness-light.svg');
claims('embeds the cost chart', 'kgbench-cost-light.svg');
claims('embeds the arch-spread chart', 'kgbench-arch-spread-light.svg');

process.stdout.write(`\n${fail ? 'FAILURES' : 'ALL CLAIMS VERIFIED'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
