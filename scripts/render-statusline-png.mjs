#!/usr/bin/env node
/**
 * Render the live tmux status line to an HTML page, for documentation.
 *
 * The bar is the one surface with no screenshot path: it is drawn by tmux into
 * a terminal, so no browser can capture it and `tmux capture-pane` returns the
 * PANE, not the status bar. The alternative to this script is hand-drawing a
 * picture of the bar in the docs, which would be a mock-up presented as
 * evidence and would drift the moment a badge changed.
 *
 * So: take the REAL rendered string — the same bytes tmux puts on screen, read
 * from the per-pane render cache — and paint it with the real xterm-256 palette.
 * The content is verbatim; only the medium changes.
 *
 * Usage:
 *   node scripts/render-statusline-png.mjs [--cache <file>] --spans   # MkDocs markup
 *   node scripts/render-statusline-png.mjs [--cache <file>] --out <file.html>
 *   echo '<status-right output>' | node scripts/render-statusline-png.mjs --out x.html
 *
 * Then screenshot it:
 *   gsd-browser navigate "file://<abs path>"
 *   gsd-browser screenshot --selector .bar --output docs/images/<name>.png --format png
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.CODING_REPO || process.cwd();

/** xterm-256 → #rrggbb. The 16 ANSI basics, the 6×6×6 cube, then the greys. */
function xterm256(i) {
  const BASIC = [
    '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  if (i < 16) return BASIC[i];
  if (i < 232) {
    const n = i - 16;
    const L = [0, 95, 135, 175, 215, 255];
    return `#${[L[Math.floor(n / 36) % 6], L[Math.floor(n / 6) % 6], L[n % 6]]
      .map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const g = 8 + (i - 232) * 10;
  return `#${g.toString(16).padStart(2, '0').repeat(3)}`;
}

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/**
 * tmux `#[...]` markup → styled spans.
 *
 * Only the attributes this status line actually emits are honoured (fg, bg,
 * bold, nobold, default). An unknown attribute is ignored rather than guessed
 * at, so a future badge cannot silently render in the wrong colour here.
 */
function toHtml(line, { fgDefault = '#d0d0d0' } = {}) {
  let fg = fgDefault;
  let bg = 'transparent';
  let bold = false;
  let out = '';
  const open = () => `<span style="color:${fg};background:${bg}${bold ? ';font-weight:700' : ''}">`;
  for (const part of line.split(/(#\[[^\]]*\])/)) {
    if (!part) continue;
    if (part.startsWith('#[')) {
      for (const attr of part.slice(2, -1).split(',')) {
        const [k, v] = attr.includes('=') ? attr.split('=') : [attr, null];
        if (k === 'fg') fg = v === 'default' ? fgDefault : xterm256(Number(v.replace('colour', '')));
        else if (k === 'bg') bg = v === 'default' ? 'transparent' : xterm256(Number(v.replace('colour', '')));
        else if (k === 'bold') bold = true;
        else if (k === 'nobold') bold = false;
      }
      continue;
    }
    out += `${open()}${escapeHtml(part)}</span>`;
  }
  return out;
}

/**
 * Newest per-pane render cache — whatever tmux most recently drew.
 *
 * By mtime, not by readdir order. The directory holds one file per pane and
 * several stale ones, so "the first non-empty entry" picks an arbitrary pane —
 * which silently produced a bar for a DIFFERENT project than the one the
 * caller was looking at, an error visible only by reading the output carefully.
 */
function newestCache() {
  const dir = join(REPO, '.logs');
  const candidates = readdirSync(dir)
    .filter((f) => f.startsWith('combined-status-line-cache-') && f.endsWith('.txt'))
    .map((f) => join(dir, f))
    .map((f) => ({ f, mtime: statSync(f).mtimeMs, body: readFileSync(f, 'utf8') }))
    .filter((x) => x.body.trim())
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new Error('no status-line cache in .logs — is the status line on?');
  return candidates[0].body;
}

/**
 * The same line as MkDocs markup, using the `.statusline` classes in
 * docs-content/stylesheets/extra.css.
 *
 * Every badge on this bar encodes its state as a COLOUR, so a fenced code block
 * shows the layout and hides the entire point — which is what the docs' own CSS
 * comment says, and what happened anyway the first time a new page was written
 * with backticks. Generating the markup from the real output rather than typing
 * it means the page cannot drift from the bar the way the hand-written examples
 * had (ten-cell gauges and a split `[N:] [P:]` pair, months after both changed).
 *
 * Unmapped colours degrade to an unstyled span rather than being guessed at, so
 * a new badge shows up in plain text instead of silently wearing another
 * badge's meaning. Add the pair here and in extra.css together.
 */
const SPAN_CLASS = new Map([
  // the shared state dots, and the session-activity green ramp
  ['colour41', 'sl-green'], ['colour34', 'sl-green-mid'], ['colour28', 'sl-green-dark'],
  ['colour22', 'sl-green-vdark'], ['colour214', 'sl-amber'], ['colour196', 'sl-red'],
  ['colour238', 'sl-grey'],
]);

/** fg+bg pairs that are the context gauge, per band in context-gauge.cjs. */
const GAUGE_CLASS = new Map([
  ['colour46/colour22', 'gauge gauge-ok'], ['colour226/colour58', 'gauge gauge-warn'],
  ['colour208/colour94', 'gauge gauge-high'], ['colour196/colour52', 'gauge gauge-crit'],
]);

function toSpans(line) {
  let fg = 'default';
  let bg = 'default';
  let under = false;
  let out = '';
  for (const part of line.split(/(#\[[^\]]*\])/)) {
    if (!part) continue;
    if (part.startsWith('#[')) {
      for (const attr of part.slice(2, -1).split(',')) {
        const [k, v] = attr.includes('=') ? attr.split('=') : [attr, null];
        if (k === 'fg') fg = v;
        else if (k === 'bg') bg = v;
        else if (k === 'underscore') under = true;
        else if (k === 'nounderscore') under = false;
      }
      continue;
    }
    const cls = GAUGE_CLASS.get(`${fg}/${bg}`) ?? SPAN_CLASS.get(fg) ?? null;
    const classes = [cls, under ? 'sl-under' : null].filter(Boolean).join(' ');
    out += classes ? `<span class="${classes}">${escapeHtml(part)}</span>` : escapeHtml(part);
  }
  return `<span class="statusline">${out}</span>`;
}

const argv = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const spansOnly = argv.includes('--spans');
const out = argOf('--out');
if (!out && !spansOnly) { process.stderr.write('--out <file.html> or --spans is required\n'); process.exit(2); }

const cacheArg = argOf('--cache');
const raw = cacheArg ? readFileSync(cacheArg, 'utf8') : newestCache();
// Strip the fixed-width pad the renderer adds for tmux: leading spaces, and the
// trailing run that ends in a NON-BREAKING space (U+00A0). The NBSP is there so
// tmux's `#(...)` substitution cannot strip the pad; written as an escape rather
// than the literal character, which is invisible in a diff and trips eslint.
const line = raw.replace(/\r?\n$/, '').replace(/^\s+/, '').replace(/[\u00a0 ]+$/, '');

if (spansOnly) {
  process.stdout.write(`${toSpans(line)}\n`);
  process.exit(0);
}

writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #1c1c1c; }
  .bar { display: inline-block; padding: 10px 14px; background: #1c1c1c;
         font: 17px/1.5 "SFMono-Regular", "JetBrains Mono", Menlo, monospace;
         white-space: pre; letter-spacing: 0; }
</style><div class="bar">${toHtml(line)}</div>
`);
process.stdout.write(`${out}\n`);
