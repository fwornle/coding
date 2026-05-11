#!/usr/bin/env node
// Ultra-fast status line reader — CommonJS, no ESM overhead.
// Reads the pre-rendered cache file. Falls back to the full CSL only if stale.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const codingRepo = process.env.CODING_REPO || path.join(__dirname, '..');
// Per-project + per-pane-width cache. Width suffix prevents an older wider-
// pane render from leaking into a narrower pane's display when two same-
// project panes coexist. The padStatusLine in combined-status-line.js no
// longer pads (tmux right-aligns automatically) but per-pane caching is
// still required: cache content is per-render, and two same-project panes
// would otherwise see each other's stale cache.
const projectPath = process.env.TRANSCRIPT_SOURCE_PROJECT || process.env.TMUX_PANE_PATH || '';
const projectName = projectPath ? path.basename(projectPath) : '';
const paneWidth = process.env.TMUX_PANE_WIDTH || '';
const cacheSuffix = projectName
  ? `-${projectName}${paneWidth ? `-w${paneWidth}` : ''}`
  : '';
const cacheFile = path.join(codingRepo, '.logs', `combined-status-line-cache${cacheSuffix}.txt`);
const cslScript = path.join(__dirname, 'combined-status-line.js');

// Load .env file so admin/management API keys are available
const envFromFile = {};
try {
  const envContent = fs.readFileSync(path.join(codingRepo, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    if (line && !line.startsWith('#') && line.includes('=')) {
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key && !process.env[key]) envFromFile[key] = val;
    }
  }
} catch { /* .env missing — not fatal */ }

const env = { ...process.env, ...envFromFile, CODING_REPO: codingRepo };

// Helper: get project abbreviation (mirrors CombinedStatusLine.getProjectAbbreviation)
function getAbbrev(name) {
  const n = name.toLowerCase();
  const known = {
    'coding': 'C', 'curriculum-alignment': 'CA', 'nano-degree': 'ND',
    'curriculum': 'CU', 'alignment': 'AL', 'nano': 'N',
    'ui-template': 'UT', 'balance': 'BL'
  };
  if (known[n]) return known[n];
  if (n.includes('-')) return n.split('-').map(p => p.charAt(0).toUpperCase()).join('');
  if (n.includes('_')) return n.split('_').map(p => p.charAt(0).toUpperCase()).join('');
  if (n.length <= 3) return n.toUpperCase();
  if (n.length <= 6) return n.substring(0, 2).toUpperCase();
  const c = n.match(/[bcdfghjklmnpqrstvwxyz]/g) || [];
  return c.length >= 2 ? c.slice(0, 2).join('').toUpperCase() : n.substring(0, 3).toUpperCase();
}

// Helper: re-apply underline for this project onto another project's cached output
function reunderline(text, targetAbbrev) {
  // Strip any existing underline
  let s = text.replace(/#\[underscore\]/g, '').replace(/#\[nounderscore\]/g, '');
  // Apply underline to this project's abbreviation
  s = s.replace(new RegExp(`(${targetAbbrev})([^A-Z#])`), `#[underscore]$1#[nounderscore]$2`);
  return s;
}

// Lifecycle icons we may patch in place. Mirrors the bands in
// combined-status-line.js:ageToActivityIcon. Health icons (🟡 / 🔴) are
// excluded — those reflect ETM health, not idle age, and must come from
// the full CSL.
const LIFECYCLE_ICONS = ['🟢', '🌲', '🫒', '🪨', '⚫', '💤'];
function ageToActivityIcon(ageMs) {
  // null age (no transcript anywhere) renders as Inactive ⚫, NOT Active 🟢.
  // Same reasoning as combined-status-line.js: under-promise activity rather
  // than mis-claim a stale session is Active.
  if (ageMs == null) return '⚫';
  if (ageMs < 5 * 60_000) return '🟢';
  if (ageMs < 15 * 60_000) return '🌲';
  if (ageMs < 60 * 60_000) return '🫒';
  if (ageMs < 6 * 60 * 60_000) return '🪨';
  if (ageMs < 24 * 60 * 60_000) return '⚫';
  return '💤';
}

// Read the sidecar { projectName: transcriptPath } map written by the full
// CSL. Returns {} if missing — patching becomes a no-op.
function readProjectMapping() {
  try {
    const file = path.join(codingRepo, '.logs', 'combined-status-line-projects.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return {}; }
}

// Patch each project's lifecycle icon in `text` based on its current
// transcript mtime. Only replaces lifecycle glyphs — leaves 🟡 / 🔴
// alone so health-degraded sessions keep their warning icon. Returns
// { text, anyTranscriptNewerThanCache } so the caller can decide
// whether to also force a background refresh.
function patchLifecycleIcons(text, mapping, cacheMtimeMs) {
  const lifecycleAlt = LIFECYCLE_ICONS.join('|');
  let out = text;
  let anyNewer = false;

  // Process longest abbreviations first so the regex for "C" doesn't
  // accidentally match inside "CA<icon>". (It can't with the (?![A-Z])
  // guard below, but length-sort is the cheap belt-and-braces.)
  const entries = Object.entries(mapping || {})
    .map(([name, p]) => [name, p, getAbbrev(name)])
    .sort((a, b) => b[2].length - a[2].length);

  for (const [, transcriptPath, abbrev] of entries) {
    let mt;
    try { mt = fs.statSync(transcriptPath).mtimeMs; } catch { continue; }
    if (mt > cacheMtimeMs) anyNewer = true;
    const newIcon = ageToActivityIcon(Date.now() - mt);
    // Match: <ABBREV>(?![A-Z]) optionally followed by a #[nounderscore]
    // closing tag (when the abbrev is the underlined "current project"),
    // immediately followed by exactly one lifecycle icon. The (?![A-Z])
    // guard prevents abbrev "C" from matching the "C" in "CA🟢".
    const re = new RegExp(
      `(${abbrev}(?![A-Z])(?:#\\[nounderscore\\])?)(?:${lifecycleAlt})`,
      'gu'
    );
    out = out.replace(re, `$1${newIcon}`);
  }
  return { text: out, anyNewer };
}

// Read project-specific cache.
// NEVER .trim() — combined-status-line.js LEFT-pads the output with spaces to
// a stable cell count (see leftPadToStableCellWidth there). The leading spaces
// force tmux to allocate the same status-right cell count on every render,
// which is the only way to make tmux repaint cells when payload shrinks
// (without those, a transient short payload like SYS:ERR leaves the previous
// wider render's trailing cells visible). .trim() would strip those spaces and
// reintroduce the residue ("07:407" leftover-digit artifacts, SYS:ERR overlay
// bleed). Strip the line terminator only. Same goes for the sibling-borrow +
// writeback path below: writing trimmed content back to disk poisons the
// cache for the next reader.
let cachedContent = '';
let cacheAgeMs = Infinity;
let cacheMtimeMs = 0;
try {
  const stat = fs.statSync(cacheFile);
  cacheMtimeMs = stat.mtimeMs;
  cacheAgeMs = Date.now() - stat.mtimeMs;
  cachedContent = fs.readFileSync(cacheFile, 'utf8').replace(/\r?\n$/, '');
} catch { /* no cache */ }

// If no project-specific cache, borrow from any sibling cache and re-apply underline.
// Width-filter the candidates: borrowing across pane widths poisons the new key with
// content sized for a different pane, producing a "shifted left + leftover characters"
// render until the next background refresh. The width suffix on the cache key only
// works if the borrow path respects it.
if (!cachedContent.trimEnd() && projectName) {
  try {
    const logsDir = path.join(codingRepo, '.logs');
    const widthSuffix = paneWidth ? `-w${paneWidth}.txt` : '.txt';
    const siblings = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('combined-status-line-cache-') && f.endsWith(widthSuffix));
    for (const sib of siblings) {
      const sibPath = path.join(logsDir, sib);
      const stat = fs.statSync(sibPath);
      const age = Date.now() - stat.mtimeMs;
      if (age < 60000) {
        const content = fs.readFileSync(sibPath, 'utf8').replace(/\r?\n$/, '');
        if (content.trimEnd()) {
          cachedContent = reunderline(content, getAbbrev(projectName));
          cacheAgeMs = age;
          cacheMtimeMs = stat.mtimeMs;
          // Write the re-underlined cache so future reads are instant
          try { fs.writeFileSync(cacheFile, cachedContent, 'utf8'); } catch {}
          break;
        }
      }
    }
  } catch { /* best effort */ }
}

// Fresh cache (<60s): use it directly, but first patch the per-project
// lifecycle icons against current transcript mtimes. Without this, the
// icon stays at whatever value was rendered at cache-write time and only
// updates on the next CSL refresh — which adds tens of seconds of
// "I just typed something but my session still shows ⚫" lag.
if (cacheAgeMs < 60000 && cachedContent.trimEnd()) {
  const mapping = readProjectMapping();
  const { text: patched, anyNewer } = patchLifecycleIcons(
    cachedContent, mapping, cacheMtimeMs
  );
  process.stdout.write(patched + '\n');
  // Trigger background refresh when:
  //   - cache is aging (>20s old), OR
  //   - any tracked transcript is newer than the cache (user activity
  //     happened after the last full render). The activity-newer trigger
  //     is what gets the non-lifecycle parts of the line (UKB, knowledge
  //     pipeline, etc.) caught up promptly after a long idle stretch.
  if (cacheAgeMs > 20000 || anyNewer) {
    const bg = spawn('node', [cslScript], {
      env, stdio: 'ignore', detached: true
    });
    bg.unref();
  }
  process.exit(0);
}

// Cache stale (>60s) or missing — run full CSL synchronously,
// but use stale cache as fallback if CSL fails or times out
const child = spawn('node', [cslScript], { env, stdio: 'pipe' });

let output = '';
child.stdout.on('data', (d) => { output += d; });
child.stderr.on('data', () => {}); // discard stderr

// Safety timeout: if CSL truly hangs, kill it. Must exceed CSL's own 8s
// internal timeout (combined-status-line.js emits "⚠️ SYS:TIMEOUT" at 8s);
// otherwise we SIGKILL before CSL gets to produce that informative output.
const fallbackTimer = setTimeout(() => {
  child.kill('SIGKILL');
}, 10000);

child.on('exit', (code) => {
  clearTimeout(fallbackTimer);
  // Same NO-TRIM rule as the cache reads above. Strip line terminator only.
  const result = output.replace(/\r?\n$/, '');
  if (code === 0 && result.trimEnd()) {
    process.stdout.write(result + '\n');
    process.exit(0);
  }
  // CSL failed — use stale cache rather than showing "Status Offline"
  if (cachedContent.trimEnd()) {
    // Patch lifecycle icons against current transcript mtimes so the
    // fallback render still reflects up-to-the-second activity, not the
    // icon frozen in the stale cache.
    const mapping = readProjectMapping();
    const { text: patched } = patchLifecycleIcons(cachedContent, mapping, cacheMtimeMs);
    process.stdout.write(patched + '\n');
    // Trigger background refresh for next cycle
    const bg = spawn('node', [cslScript], {
      env, stdio: 'ignore', detached: true
    });
    bg.unref();
    process.exit(0);
  }
  // Last resort: if CSL produced *any* output (even with non-zero exit, e.g.
  // its own "⚠️ SYS:TIMEOUT" marker), surface it instead of letting the
  // tmux wrapper fall back to "[Status Offline]". A diagnostic marker is
  // strictly more useful than silence.
  if (result.trimEnd()) {
    process.stdout.write(result + '\n');
    process.exit(0);
  }
  // No cache, no output — nothing to show
  process.exit(code || 1);
});
