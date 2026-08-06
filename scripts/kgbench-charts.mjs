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
 * Palette: categorical slots 1-3 of the project's validated default, in fixed order —
 * blue/orange/aqua. Validated for all-pairs CVD separation in both modes. Aqua sits
 * below 3:1 on the light surface, so every bar carries a visible value label; that is
 * the documented relief, not decoration.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { summaryStats } from '../lib/kgbench/report.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const runId = opt('run', 'coding-v1-r5');
const outDir = opt('out', 'docs/images');
const repoRoot = process.cwd();

const THEME = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a'],
    text: '#0b0b0b', muted: '#52514e', grid: '#e3e3e0', surface: 'none',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70'],
    text: '#f0f0ee', muted: '#a8a79e', grid: '#33332f', surface: 'none',
  },
};

const ARMS = ['grep', 'graphify', 'codegraph'];
const CLASSES = ['lookup', 'structural', 'blast', 'arch', 'abstain'];

// Retired questions are excluded here for the same reason the report excludes them:
// a figure and a table drawn from the same run must not disagree. T2's premise was
// false, so its rows are not measurements of anything.
const setName = JSON.parse(readFileSync(path.join(repoRoot, '.data/kgbench/runs', runId, 'run.json'), 'utf8')).set;
const activeIds = new Set(
  JSON.parse(readFileSync(path.join(repoRoot, 'config/kgbench/questions', `${setName}.json`), 'utf8'))
    .questions.filter((q) => q.enabled !== false).map((q) => q.id),
);
const rows = readFileSync(path.join(repoRoot, '.data/kgbench/runs', runId, 'results.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => activeIds.has(r.id));

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
  const w = 92;
  return ARMS.map((a, i) => {
    const dx = rightX - (ARMS.length - i) * w;
    return `<rect x="${dx}" y="${y - 8}" width="9" height="9" rx="2" fill="${t.series[i]}"/>`
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
  const gw = pw / CLASSES.length, bw = Math.min(26, (gw - 18) / 3);

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
      const x = gx + (gw - bw * 3 - 4) / 2 + ai * (bw + 2);   // 2px surface gap between bars
      const h = m * ph, y = T + ph - h;
      s += bar(x, y, bw, h, t.series[ai]);
      // Direct label on every bar: required relief for the light-surface contrast WARN.
      s += `<text x="${x + bw / 2}" y="${y - 5}" font-size="9.5" fill="${t.muted}" text-anchor="middle">${m.toFixed(2)}</text>`;
    });
    const n = rows.filter((r) => r.cls === cls && r.arm === 'grep' && r.score != null).length;
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
  s += `<text x="0" y="32" font-size="11" fill="${t.muted}">one bar per arm · lower is better — correctness was a tie, so this is where the arms differ</text>`;
  // No legend: every bar is named directly beneath it, so a legend would repeat itself.

  panels.forEach((p, pi) => {
    const ox = pi * (pw + 40);
    const vals = ARMS.map(p.get);
    const max = Math.max(...vals.filter((v) => v != null)) * 1.18;
    s += `<text x="${ox}" y="${T - 10}" font-size="11.5" font-weight="600" fill="${t.text}">${esc(p.title)}</text>`;
    s += `<text x="${ox}" y="${T + 4}" font-size="10" fill="${t.muted}">${esc(p.sub)}</text>`;
    const bw = 54, gap = (pw - bw * 3) / 4;
    ARMS.forEach((arm, ai) => {
      const v = vals[ai];
      if (v == null) return;
      const x = ox + gap + ai * (bw + gap);
      const h = (v / max) * (ph - 18), y = T + 14 + (ph - 18) - h;
      s += bar(x, y, bw, h, t.series[ai]);
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
  const W = 760, H = 300, L = 118, R = 96, T = 66, B = 44;
  const pw = W - L - R, ph = H - T - B;
  const laneH = ph / ARMS.length;

  let s = `<text x="0" y="16" font-size="13" font-weight="600" fill="${t.text}">Architecture class: every individual run</text>`;
  s += `<text x="0" y="32" font-size="11" fill="${t.muted}">one lane per arm · each dot is one answer (A1-A4, 10 reps each) — the arms' spreads overlap completely</text>`;

  for (let i = 0; i <= 4; i++) {
    const v = i / 4, x = L + v * pw;
    s += `<line x1="${x}" y1="${T - 6}" x2="${x}" y2="${T + ph}" stroke="${t.grid}" stroke-width="1"/>`;
    s += `<text x="${x}" y="${T + ph + 16}" font-size="10" fill="${t.muted}" text-anchor="middle">${v.toFixed(2)}</text>`;
  }
  s += `<text x="${L + pw / 2}" y="${T + ph + 32}" font-size="10.5" fill="${t.muted}" text-anchor="middle">score</text>`;

  ARMS.forEach((arm, ai) => {
    const cy = T + laneH * ai + laneH / 2;
    const vals = rows.filter((r) => r.arm === arm && r.cls === 'arch' && r.score != null).map((r) => r.score);
    const counts = new Map();
    s += `<text x="${L - 12}" y="${cy + 4}" font-size="11" fill="${t.text}" text-anchor="end">${esc(arm)}</text>`;
    for (const v of vals) {
      const k = v.toFixed(3);
      const idx = counts.get(k) ?? 0;
      counts.set(k, idx + 1);
      // Stack duplicates vertically so density is visible rather than one dot on top
      // of forty — the whole point of this figure.
      const row = Math.floor(idx / 8), col = idx % 8;
      // Clamp the cluster inside the axis: at score 0 an un-clamped spread ran left of
      // the baseline and collided with the arm label.
      const spread = (col - 3.5) * 5.6;
      const x = Math.min(L + pw - 4, Math.max(L + 4, L + v * pw + spread));
      const y = cy + (row - 0.5) * 10.5;
      s += `<circle cx="${x}" cy="${y}" r="3.6" fill="${t.series[ai]}" fill-opacity="0.85" `
        + `stroke="${mode === 'dark' ? '#1a1a19' : '#ffffff'}" stroke-width="1.5"/>`;
    }
    const m = median(vals);
    if (m != null) {
      const mx = L + m * pw;
      s += `<line x1="${mx}" y1="${cy - laneH / 2 + 8}" x2="${mx}" y2="${cy + laneH / 2 - 8}" `
        + `stroke="${t.text}" stroke-width="2" stroke-linecap="round"/>`;
      // Flip the annotation to the left of the rule when the median sits near the
      // right edge, otherwise it runs off the canvas.
      const near = m > 0.7;
      s += `<text x="${mx + (near ? -7 : 7)}" y="${cy - laneH / 2 + 17}" font-size="9.5" `
        + `fill="${t.muted}" text-anchor="${near ? 'end' : 'start'}">median ${m.toFixed(2)} · n=${vals.length}</text>`;
    }
  });
  return wrap(W, H, s);
}

const figures = {
  'kgbench-correctness': figCorrectness,
  'kgbench-cost': figCost,
  'kgbench-arch-spread': figArchSpread,
};

mkdirSync(path.join(repoRoot, outDir), { recursive: true });
for (const [name, fn] of Object.entries(figures)) {
  for (const mode of ['light', 'dark']) {
    const file = path.join(repoRoot, outDir, `${name}-${mode}.svg`);
    writeFileSync(file, fn(mode));
    console.log(`wrote ${path.relative(repoRoot, file)}`);
  }
}
