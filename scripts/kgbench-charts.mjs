#!/usr/bin/env node
/**
 * Render the kgbench report figures as SVG, straight from results.jsonl.
 *
 *   node scripts/kgbench-charts.mjs --run coding-v1-r5 --out docs/images
 *
 * Two files per figure, light and dark, because GitHub renders markdown on either
 * surface and a single SVG cannot adapt (its <style> is sanitised away). The report
 * pairs them with <picture media="(prefers-color-scheme: dark)">.
 *
 * Palette: categorical slots 1-4 of the project's validated default, in fixed order —
 * blue/orange/aqua/yellow. Validated with scripts/validate_palette.js in both modes:
 * every gate passes on the adjacent pairlist (worst adjacent CVD ΔE 9.1 light / 8.4
 * dark). Slot 4 is yellow, which the palette warns against pairing with orange — the
 * fixed slot order keeps them non-adjacent, so the pair the gate dislikes is never
 * drawn side by side. Aqua and yellow both sit below 3:1 on the light surface, so
 * every bar carries a visible value label; that is the documented relief, not decoration.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { summaryStats } from '../lib/kgbench/report.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const runId = opt('run', 'coding-v1-r6');
const outDir = opt('out', 'docs/images');
const repoRoot = process.cwd();

const THEME = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
    text: '#0b0b0b', muted: '#52514e', grid: '#e3e3e0', surface: 'none',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
    text: '#f0f0ee', muted: '#a8a79e', grid: '#33332f', surface: 'none',
  },
};

const CLASSES = ['lookup', 'structural', 'blast', 'arch', 'abstain'];

// Retired questions are excluded here for the same reason the report excludes them:
// a figure and a table drawn from the same run must not disagree. T2's premise was
// false, so its rows are not measurements of anything.
const runJson = JSON.parse(readFileSync(path.join(repoRoot, '.data/kgbench/runs', runId, 'run.json'), 'utf8'));
const setName = runJson.set;
const activeIds = new Set(
  JSON.parse(readFileSync(path.join(repoRoot, 'config/kgbench/questions', `${setName}.json`), 'utf8'))
    .questions.filter((q) => q.enabled !== false).map((q) => q.id),
);
// AGENT SCOPE. A bar labelled `grep` that averages claude, copilot and opencode is the
// pooling the report itself calls "arithmetic, not comparable" — three agents with
// different tool enforcement and different elicitation have no meaningful midpoint, and on
// a run where one agent answers 12% of the time the pooled bar is mostly the other two.
// Charts had no agent axis at all, so a multi-agent run silently produced pooled figures
// that a per-agent table then contradicted. Pass --agent to scope them; the published
// figures use claude, the only agent whose tool surface is actually enforced.
const agentFilter = opt('agent', null);
const allRows = readFileSync(path.join(repoRoot, '.data/kgbench/runs', runId, 'results.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => activeIds.has(r.id));
const agentsPresent = [...new Set(allRows.map((r) => r.agent ?? 'claude'))];
if (!agentFilter && agentsPresent.length > 1) {
  console.error(`kgbench-charts: WARNING — this run has ${agentsPresent.length} agents `
    + `(${agentsPresent.join(', ')}) and no --agent was given, so every bar pools them. `
    + 'That is the comparison the report marks as not meaningful. Pass --agent claude.');
}
const rows = agentFilter
  ? allRows.filter((r) => (r.agent ?? 'claude') === agentFilter)
  : allRows;
if (!rows.length) {
  console.error(`kgbench-charts: no rows for --agent ${agentFilter} in ${runId}`);
  process.exit(2);
}

/**
 * Which arms this run contains, and what colour each one wears.
 *
 * Both come from configuration, not from the figure. The arm LIST is the run's own
 * manifest — hardcoding it here is how a fourth arm gets measured, scored, tabulated,
 * and then silently omitted from every figure, so the charts quietly describe a
 * different experiment than the tables beside them.
 *
 * The colour SLOT is the arm's position in config/kgbench/arms.json, not its position in
 * this run. Colour follows the entity: rendering a two-arm subset must not repaint the
 * survivors, or the same arm is blue in one figure and orange in the next.
 */
const canonicalArmOrder = Object.keys(
  JSON.parse(readFileSync(path.join(repoRoot, 'config/kgbench/arms.json'), 'utf8')).arms ?? {},
);
const presentArms = new Set(rows.map((r) => r.arm));
const ARMS = (runJson.arms?.map((a) => a.id) ?? [...presentArms])
  .filter((id) => presentArms.has(id))
  .sort((a, b) => canonicalArmOrder.indexOf(a) - canonicalArmOrder.indexOf(b));
const slotOf = (arm) => {
  const i = canonicalArmOrder.indexOf(arm);
  return i >= 0 ? i : ARMS.indexOf(arm);
};
// The palette is validated for four slots. A fifth arm is a palette decision, not a
// modulo — cycling would give two arms the same colour and the figure would lie.
const colorOf = (t, arm) => {
  const i = slotOf(arm);
  if (i >= t.series.length) {
    throw new Error(
      `arm "${arm}" is slot ${i + 1}, beyond the ${t.series.length} validated palette slots.\n`
      + '  Extend THEME.series with the next categorical slot and re-run\n'
      + '  scripts/validate_palette.js (dataviz skill) for BOTH modes before shipping.',
    );
  }
  return t.series[i];
};

// The report's own median, imported rather than reimplemented. A local copy took the
// upper-middle value on even n, so the figures printed 18.4s where the table said 18.3s
// — a small discrepancy, but a figure and a table from one run disagreeing is exactly
// the kind of thing that makes a reader distrust both.
const median = (xs) => summaryStats(xs).median;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rounded-top bar: 4px radius on the data end, square on the baseline. */
function bar(x, y, w, h, fill, r = 4) {
  if (h <= 0.5) return '';
  const rr = Math.min(r, h, w / 2);
  return `<path d="M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} `
    + `L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z" fill="${fill}"/>`;
}

/** Right-aligned legend. Left-aligned at the plot top collided with the value labels
 *  on the first bar of every group — visible only once rendered, never in the code. */
function legend(t, rightX, y) {
  // Width tracks the longest label so a fourth entry cannot overlap its neighbour.
  const w = Math.max(74, 20 + Math.max(...ARMS.map((a) => a.length)) * 6.4);
  return ARMS.map((a, i) => {
    const dx = rightX - (ARMS.length - i) * w;
    return `<rect x="${dx}" y="${y - 8}" width="9" height="9" rx="2" fill="${colorOf(t, a)}"/>`
      + `<text x="${dx + 14}" y="${y}" font-size="11" fill="${t.muted}">${esc(a)}</text>`;
  }).join('');
}

const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
const wrap = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" `
  + `font-family="${FONT}" role="img">${body}</svg>\n`;

/* ---- Figure 1: correctness by question class ------------------------------ */
function figCorrectness(mode) {
  const t = THEME[mode];
  const W = 760, H = 360, L = 52, R = 16, T = 60, B = 76;
  const pw = W - L - R, ph = H - T - B;
  const gw = pw / CLASSES.length, bw = Math.min(26, (gw - 18) / ARMS.length);

  let s = `<text x="0" y="16" font-size="13" font-weight="600" fill="${t.text}">Correctness by question class</text>`;
  // Say what a GROUP is and what a BAR is. Without it a reader sees five clusters of
  // three columns and has to guess which dimension is which.
  s += `<text x="0" y="32" font-size="11" fill="${t.muted}">one group per question class · one bar per arm · median score across reps</text>`;
  s += `<text x="0" y="47" font-size="10.5" fill="${t.muted}">1.00 = every required fact recovered</text>`;
  s += legend(t, W - R, 26);

  for (let i = 0; i <= 4; i++) {
    const v = i / 4, y = T + ph - v * ph;
    s += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${t.grid}" stroke-width="1"/>`;
    s += `<text x="${L - 8}" y="${y + 3.5}" font-size="10" fill="${t.muted}" text-anchor="end">${v.toFixed(2)}</text>`;
  }

  CLASSES.forEach((cls, ci) => {
    const gx = L + ci * gw;
    ARMS.forEach((arm, ai) => {
      const vals = rows.filter((r) => r.arm === arm && r.cls === cls && r.score != null).map((r) => r.score);
      const m = median(vals);
      if (m == null) return;
      const x = gx + (gw - (bw + 2) * ARMS.length + 2) / 2 + ai * (bw + 2);   // 2px surface gap between bars
      const h = m * ph, y = T + ph - h;
      s += bar(x, y, bw, h, colorOf(t, arm));
      // Direct label on every bar: required relief for the light-surface contrast WARN.
      s += `<text x="${x + bw / 2}" y="${y - 5}" font-size="9.5" fill="${t.muted}" text-anchor="middle">${m.toFixed(2)}</text>`;
    });
    // Reps per arm for this class. Counted on the arm that HAS the most rows rather than
    // a named one: "grep" is not guaranteed to be in every run, and an absent reference
    // arm silently printed n=0 under every group.
    const n = Math.max(...ARMS.map((a) =>
      rows.filter((r) => r.cls === cls && r.arm === a && r.score != null).length));
    s += `<text x="${gx + gw / 2}" y="${T + ph + 16}" font-size="11" fill="${t.text}" text-anchor="middle">${esc(cls)}</text>`;
    const ids = [...new Set(rows.filter((r) => r.cls === cls).map((r) => r.id))].sort().join(' ');
    s += `<text x="${gx + gw / 2}" y="${T + ph + 30}" font-size="9" fill="${t.muted}" text-anchor="middle">${esc(ids)}</text>`;
    s += `<text x="${gx + gw / 2}" y="${T + ph + 43}" font-size="9" fill="${t.muted}" text-anchor="middle">n=${n} per arm</text>`;
  });

  s += `<line x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}" stroke="${t.grid}" stroke-width="1"/>`;
  s += `<text x="${L + (W - L - R) / 2}" y="${H - 6}" font-size="10.5" fill="${t.muted}" text-anchor="middle">question class</text>`;
  s += `<text transform="translate(12,${T + ph / 2}) rotate(-90)" font-size="10.5" fill="${t.muted}" text-anchor="middle">score</text>`;
  return wrap(W, H, s);
}

/* ---- Figure 2: what a query costs (small multiples, one scale each) ------- */
function figCost(mode) {
  const t = THEME[mode];
  const W = 760, H = 300, T = 58, B = 46;
  const panels = [
    { title: 'Content tokens per query', sub: 'median, excluding each arm\'s fixed baseline',
      get: (a) => median(rows.filter((r) => r.arm === a).map((r) => r.content_tokens)),
      fmt: (v) => (v / 1000).toFixed(0) + 'k' },
    { title: 'Latency per query', sub: 'median wall-clock seconds',
      get: (a) => median(rows.filter((r) => r.arm === a).map((r) => r.wall_s)),
      fmt: (v) => v.toFixed(1) + 's' },
  ];
  const pw = (W - 40) / 2, ph = H - T - B;

  let s = `<text x="0" y="16" font-size="13" font-weight="600" fill="${t.text}">What one query costs</text>`;
  s += `<text x="0" y="32" font-size="11" fill="${t.muted}">one bar per arm · lower is better · medians across all questions and reps</text>`;
  // No legend: every bar is named directly beneath it, so a legend would repeat itself.

  panels.forEach((p, pi) => {
    const ox = pi * (pw + 40);
    const vals = ARMS.map(p.get);
    const max = Math.max(...vals.filter((v) => v != null)) * 1.18;
    s += `<text x="${ox}" y="${T - 10}" font-size="11.5" font-weight="600" fill="${t.text}">${esc(p.title)}</text>`;
    s += `<text x="${ox}" y="${T + 4}" font-size="10" fill="${t.muted}">${esc(p.sub)}</text>`;
    const bw = Math.min(54, (pw - 16) / ARMS.length - 12), gap = (pw - bw * ARMS.length) / (ARMS.length + 1);
    ARMS.forEach((arm, ai) => {
      const v = vals[ai];
      if (v == null) return;
      const x = ox + gap + ai * (bw + gap);
      const h = (v / max) * (ph - 18), y = T + 14 + (ph - 18) - h;
      s += bar(x, y, bw, h, colorOf(t, arm));
      s += `<text x="${x + bw / 2}" y="${y - 5}" font-size="11" font-weight="600" fill="${t.text}" text-anchor="middle">${esc(p.fmt(v))}</text>`;
      s += `<text x="${x + bw / 2}" y="${T + ph + 14}" font-size="10.5" fill="${t.muted}" text-anchor="middle">${esc(arm)}</text>`;
    });
    s += `<line x1="${ox}" y1="${T + ph}" x2="${ox + pw}" y2="${T + ph}" stroke="${t.grid}" stroke-width="1"/>`;
  });
  return wrap(W, H, s);
}

/* ---- Figure 3: why 3 reps could not settle the arch class ----------------- */
/**
 * The spread plot, not a bar. The arch result was called a tie because the arms'
 * score distributions overlapped, and a bar chart of medians is exactly the picture
 * that hides that. Every rep is drawn.
 */
function figArchSpread(mode) {
  const t = THEME[mode];
  // The canvas GROWS with the arm count instead of dividing a fixed height between the
  // lanes. Ten reps across four questions stack five deep at eight dots per row, which
  // needs ~52px; a fixed 300px canvas gave four lanes 47px each and the stacks collided.
  const W = 760, L = 118, R = 122, T = 66, B = 44;   // R holds the per-lane median annotation
  const laneH = 64;
  const pw = W - L - R, ph = laneH * ARMS.length;
  const H = T + ph + B;

  let s = `<text x="0" y="16" font-size="13" font-weight="600" fill="${t.text}">Architecture class: every individual run</text>`;
  // Describe the ENCODING, not the finding. This subtitle used to assert that the
  // spreads overlap completely, which was true of the run it was written for and false
  // of the next one — a conclusion baked into a renderer silently outlives its evidence.
  //
  // The same line then did it again with a FACT rather than a conclusion: "A1-A4, 10 reps
  // each" was hardcoded from the runs that deepened the architecture questions to 10 reps.
  // coding-v1-x2 ran 3, so the figure asserted 10 while its own lane labels read n=12, and
  // it published that way. A caption is part of the figure; deriving the questions and the
  // rep count from the rows is the only version that cannot go stale.
  const archIds = [...new Set(rows.filter((r) => r.cls === 'arch').map((r) => r.id))].sort();
  const repsPerQ = Math.max(...ARMS.map((a) => {
    const perQ = archIds.map((id) => rows.filter((r) => r.arm === a && r.id === id).length);
    return perQ.length ? Math.max(...perQ) : 0;
  }), 0);
  const span = archIds.length > 1 ? `${archIds[0]}-${archIds[archIds.length - 1]}` : (archIds[0] ?? 'none');
  s += `<text x="0" y="32" font-size="11" fill="${t.muted}">one lane per arm · each dot is one answer `
    + `(${span}, ${repsPerQ} rep${repsPerQ === 1 ? '' : 's'} each) · black rule = median</text>`;

  for (let i = 0; i <= 4; i++) {
    const v = i / 4, x = L + v * pw;
    s += `<line x1="${x}" y1="${T - 6}" x2="${x}" y2="${T + ph}" stroke="${t.grid}" stroke-width="1"/>`;
    s += `<text x="${x}" y="${T + ph + 16}" font-size="10" fill="${t.muted}" text-anchor="middle">${v.toFixed(2)}</text>`;
  }
  s += `<text x="${L + pw / 2}" y="${T + ph + 32}" font-size="10.5" fill="${t.muted}" text-anchor="middle">score</text>`;

  ARMS.forEach((arm, ai) => {
    const cy = T + laneH * ai + laneH / 2;
    const vals = rows.filter((r) => r.arm === arm && r.cls === 'arch' && r.score != null).map((r) => r.score);
    // Tally first, so each stack can be CENTRED on its lane. Growing downward from the
    // lane centre made a tall stack lean into the lane below it, which reads as the two
    // arms sharing dots — the one thing a spread plot must not imply.
    const tally = new Map();
    for (const v of vals) { const k = v.toFixed(3); tally.set(k, (tally.get(k) ?? 0) + 1); }
    const placed = new Map();
    s += `<text x="${L - 12}" y="${cy + 4}" font-size="11" fill="${t.text}" text-anchor="end">${esc(arm)}</text>`;
    for (const v of vals) {
      const k = v.toFixed(3);
      const idx = placed.get(k) ?? 0;
      placed.set(k, idx + 1);
      // Stack duplicates vertically so density is visible rather than one dot on top
      // of forty — the whole point of this figure.
      const rows_ = Math.ceil(tally.get(k) / 8);
      const row = Math.floor(idx / 8), col = idx % 8;
      // Clamp the cluster inside the axis: at score 0 an un-clamped spread ran left of
      // the baseline and collided with the arm label.
      const spread = (col - 3.5) * 5.6;
      const x = Math.min(L + pw - 4, Math.max(L + 4, L + v * pw + spread));
      const y = cy + (row - (rows_ - 1) / 2) * 10.5;
      s += `<circle cx="${x}" cy="${y}" r="3.6" fill="${colorOf(t, arm)}" fill-opacity="0.85" `
        + `stroke="${mode === 'dark' ? '#1a1a19' : '#ffffff'}" stroke-width="1.5"/>`;
    }
    const m = median(vals);
    if (m != null) {
      const mx = L + m * pw;
      s += `<line x1="${mx}" y1="${cy - laneH / 2 + 8}" x2="${mx}" y2="${cy + laneH / 2 - 8}" `
        + `stroke="${t.text}" stroke-width="2" stroke-linecap="round"/>`;
      // The annotation lives in the right MARGIN, not beside its rule. Placed inside the
      // plot it had to dodge the canvas edge, and the dodge put it straight under the
      // dot stack whenever the median was 1.00 — which, on this question set, is most
      // lanes. Out here its position cannot depend on the value it reports.
      s += `<text x="${L + pw + 10}" y="${cy + 3.5}" font-size="9.5" `
        + `fill="${t.muted}">median ${m.toFixed(2)} · n=${vals.length}</text>`;
    }
  });
  return wrap(W, H, s);
}

const figures = {
  'kgbench-correctness': figCorrectness,
  'kgbench-cost': figCost,
  'kgbench-arch-spread': figArchSpread,
};

/**
 * WRITE TO BOTH IMAGE TREES.
 *
 * This project has two: `docs/` is where the source documents live, and `docs-content/` is
 * mkdocs's `docs_dir` — the only tree the published site can see. A figure written to one is
 * invisible in the other, and the failure is silent in the direction that matters: the page
 * renders perfectly on GitHub while the site shows three broken images.
 *
 * Copying by hand is what the sibling benchmark does, and it is why this one was never
 * published at all. A generator that emits into only half the places its output is consumed
 * from makes drift the default and correctness the manual step. So the mirror is derived from
 * `--out` rather than requested: ask for one tree and get the matching path in the other.
 */
const MIRROR = { 'docs/images': 'docs-content/images', 'docs-content/images': 'docs/images' };
const outDirs = [...new Set([outDir, MIRROR[outDir]].filter(Boolean))];
if (outDirs.length === 1) {
  console.error(`kgbench-charts: NOTE — ${outDir} has no docs-content mirror, so these figures `
    + 'will not reach the published site. Use --out docs/images for anything published.');
}

for (const dir of outDirs) mkdirSync(path.join(repoRoot, dir), { recursive: true });
for (const [name, fn] of Object.entries(figures)) {
  for (const mode of ['light', 'dark']) {
    // Render once per figure, not once per tree: two trees must not be able to disagree.
    const svg = fn(mode);
    for (const dir of outDirs) {
      const file = path.join(repoRoot, dir, `${name}-${mode}.svg`);
      writeFileSync(file, svg);
      console.log(`wrote ${path.relative(repoRoot, file)}`);
    }
  }
}
