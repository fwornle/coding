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
  // Apply underline to this project's abbreviation. The leading (?<![A-Z]) guard stops a short
  // abbrev from matching as the TAIL of a longer one — e.g. targetAbbrev "C" (coding) must not
  // underline the "C" inside "REC". The trailing [^A-Z#] already guards the prefix side.
  s = s.replace(new RegExp(`(?<![A-Z])(${targetAbbrev})([^A-Z#])`), `#[underscore]$1#[nounderscore]$2`);
  return s;
}

// Lifecycle icons we may patch in place. These MUST stay byte-identical to
// LIFECYCLE_ICONS in combined-status-line.js: this file rewrites glyphs inside
// a string that file produced, so the two are a matched pair. When they drifted
// (this file still listing the retired emoji after CSL moved to the tinted-●
// ramp) the patch regex simply stopped matching and silently no-op'd — bubbles
// then froze at whatever the last full CSL render wrote. A silent no-op is the
// friendly failure; the dangerous one is a PARTIAL match, where substituting a
// glyph of a different cell width changes the payload width after CSL already
// left-padded it, which reintroduces trailing residue.
//
// Health icons (🟡 / 🔴) are excluded — those reflect ETM health, not idle age,
// and must come from the full CSL.
const LIFECYCLE_ICONS = [
  '#[fg=colour41]●#[fg=default]',   // Active
  '#[fg=colour34]●#[fg=default]',   // Cooling
  '#[fg=colour28]●#[fg=default]',   // Fading
  '#[fg=colour22]●#[fg=default]',   // Inactive
  '#[fg=colour238]●#[fg=default]',  // Sleeping
];
const ICON_ACTIVE = LIFECYCLE_ICONS[0];
function ageToActivityIcon(ageMs) {
  // null age (no transcript anywhere) renders as Inactive, NOT Active. Same
  // reasoning as combined-status-line.js: under-promise activity rather than
  // mis-claim a stale session is Active.
  if (ageMs == null) return LIFECYCLE_ICONS[3];
  if (ageMs < 5 * 60_000) return LIFECYCLE_ICONS[0];
  if (ageMs < 30 * 60_000) return LIFECYCLE_ICONS[1];
  if (ageMs < 6 * 60 * 60_000) return LIFECYCLE_ICONS[2];
  if (ageMs < 24 * 60 * 60_000) return LIFECYCLE_ICONS[3];
  return LIFECYCLE_ICONS[4];
}

// Read the sidecar { projectName: {tp, hbTs} } map written by the full
// CSL. Returns {} if missing — patching becomes a no-op. Tolerates the
// legacy string shape ({ projectName: transcriptPath }) in case a stale
// pre-fix sidecar is still on disk during the first post-fix tick.
function readProjectMapping() {
  try {
    const file = path.join(codingRepo, '.logs', 'combined-status-line-projects.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return {}; }
}

// Normalize either shape to {tp, hbTs, subMt}. Legacy string entry has no
// heartbeat data — hbTs=0 disables the promotion path, falling back to
// pure transcript-mtime behaviour for that tick.
// `subMt` (sub-agent freshest mtime, ms) is folded into the effective
// activity age below so the bubble doesn't stay frozen when the user is
// actively confirming prompts inside a sub-agent and the parent transcript
// file isn't being written. Phase 51 interim mitigation.
function normalizeMappingEntry(v) {
  if (typeof v === 'string') return { tp: v, hbTs: 0, subMt: 0, caTs: 0 };
  return { tp: v?.tp, hbTs: v?.hbTs || 0, subMt: v?.subMt || 0, caTs: v?.caTs || 0 };
}

// Patch each project's lifecycle icon in `text` based on its current
// transcript mtime. Only replaces lifecycle glyphs — leaves 🟡 / 🔴
// alone so health-degraded sessions keep their warning icon. Returns
// { text, anyTranscriptNewerThanCache } so the caller can decide
// whether to also force a background refresh.
// Newest timestamped record at the tail of a transcript .jsonl, or 0.
// MUST mirror CombinedStatusLine._lastContentTimestampMs — this file is CommonJS
// and CSL is ESM, so the logic is duplicated rather than imported; keep them in
// step. Rationale (the whole reason this is not a plain statSync): Claude Code
// rewrites four timestamp-less trailing records — last-prompt, ai-title, mode,
// permission-mode — on a session that is merely open, so an abandoned
// transcript's mtime stays minutes-fresh forever. Patching off mtime here would
// silently re-promote idle projects to Active on every fast tick and undo the
// content-derived bucketing CSL does.
function lastContentTimestampMs(transcriptPath, tailBytes = 64 * 1024) {
  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) return 0;
  let fd = null;
  try {
    const size = fs.statSync(transcriptPath).size;
    if (size === 0) return 0;
    const readLen = Math.min(size, tailBytes);
    const buf = Buffer.allocUnsafe(readLen);
    fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, readLen, size - readLen);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line[0] !== '{') continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!rec || typeof rec.timestamp !== 'string') continue;
      const ts = Date.parse(rec.timestamp);
      if (Number.isFinite(ts)) return ts;
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* fd already gone */ }
    }
  }
}

// Escape regex metacharacters. REQUIRED now that the lifecycle icons are tmux
// style strings: `#[fg=colour41]●#[fg=default]` contains `[` and `]`, which an
// unescaped alternation would parse as a character class — matching single
// characters instead of the intended glyph, and corrupting the payload.
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function patchLifecycleIcons(text, mapping, cacheMtimeMs) {
  const lifecycleAlt = LIFECYCLE_ICONS.map(reEscape).join('|');
  let out = text;
  let anyNewer = false;

  // Process longest abbreviations first so the regex for "C" doesn't
  // accidentally match inside "CA<icon>". (It can't with the (?![A-Z])
  // guard below, but length-sort is the cheap belt-and-braces.)
  const entries = Object.entries(mapping || {})
    .map(([name, v]) => [name, normalizeMappingEntry(v), getAbbrev(name)])
    .sort((a, b) => b[2].length - a[2].length);

  const now = Date.now();
  for (const [, { tp, hbTs, subMt, caTs }, abbrev] of entries) {
    let parentMt;
    // Content timestamp, not mtime — see lastContentTimestampMs above. Falls
    // back to mtime only when no timestamped record is readable (non-Claude
    // transcript), which is also the only case where mtime carries meaning.
    // contentTs > 0 also tells us this is a real Claude .jsonl (a readable
    // timestamped record was found) — used by the promotion gate below.
    let contentTs = 0;
    try {
      contentTs = lastContentTimestampMs(tp);
      parentMt = contentTs || fs.statSync(tp).mtimeMs;
    } catch { continue; }
    // Effective mtime folds in the freshest sub-agent transcript so the
    // bubble reflects activity happening inside Task-tool / wave-execute
    // sub-agents (whose writes don't touch the parent .jsonl). Phase 51
    // interim mitigation; the on-disk subMt is published by CSL on each
    // refresh tick.
    const mt = subMt > parentMt ? subMt : parentMt;
    if (mt > cacheMtimeMs) anyNewer = true;
    let newIcon = ageToActivityIcon(now - mt);
    // Mirror combined-status-line.js's heartbeat promotion: a fresh ETM
    // heartbeat (<5min) overrides a non-Active transcript-derived icon,
    // but only when there's genuine recent activity — otherwise a heartbeat
    // that resumed after laptop wake would falsely promote an idle session.
    // Prefer the ETM's real-time content-activity clock (caTs), which is
    // immune to the sparse hourly-bucketed specstory mtime that lags far
    // behind a long OpenCode turn; fall back to transcript mtime when absent.
    //
    // MUST match combined-status-line.js's gate (~line 1334). A fresh heartbeat
    // proves the MONITOR is alive, not that anyone is working — a closed
    // session's ETM outlives it and kept this promotion painting the project
    // bright green. So the fallback to transcript age is allowed ONLY for a
    // non-Claude transcript (contentTs === 0), the one case where a missing
    // content clock is normal rather than evidence of absence.
    const activeEnough = caTs > 0
      ? (now - caTs) < 45 * 60_000
      : (contentTs === 0 && (now - mt) < 45 * 60_000);
    if (newIcon !== ICON_ACTIVE && hbTs > 0 && (now - hbTs) < 5 * 60_000 && activeEnough) {
      newIcon = ICON_ACTIVE;
    }
    // anyNewer also fires if a sub-agent file is fresher than the cache —
    // so the next tick triggers a CSL refresh that re-walks subagents/
    // and re-publishes subMt.
    // Match: <ABBREV> optionally followed by a #[nounderscore] closing tag (when the abbrev is
    // the underlined "current project"), immediately followed by exactly one lifecycle icon.
    // BOTH boundary guards are required so an abbrev only matches as a WHOLE token:
    //   • trailing (?![A-Z]) — abbrev "C" must not match the PREFIX "C" in "CA🟢";
    //   • leading  (?<![A-Z]) — abbrev "C" must not match the SUFFIX "C" in "REC🟢" (the "C" is
    //     preceded by "E" ∈ [A-Z]). Without this, the global replace for the live "coding" project
    //     rewrote REC's dot with coding's icon, so REC flickered green↔black in lock-step with it.
    const re = new RegExp(
      `(?<![A-Z])(${abbrev}(?![A-Z])(?:#\\[nounderscore\\])?)(?:${lifecycleAlt})`,
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
// Cache TTL constants. Dropped from 60s to 30s so idle-state transitions
// (📚🟡 ↔ 📚⚫ when a Claude session resumes) recover within ~30s instead
// of up to a full minute. The 10s background-refresh threshold is half the
// TTL so we serve fresh content most of the time without spawning every
// status-interval tick.
const CACHE_TTL_MS = 30000;
const BG_REFRESH_THRESHOLD_MS = 10000;

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
      if (age < CACHE_TTL_MS) {
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

// Fresh cache: use it directly, but first patch the per-project lifecycle
// icons against current transcript mtimes. Without this, the icon stays at
// whatever value was rendered at cache-write time and only updates on the
// next CSL refresh — which adds tens of seconds of "I just typed something
// but my session still shows ⚫" lag.
if (cacheAgeMs < CACHE_TTL_MS && cachedContent.trimEnd()) {
  const mapping = readProjectMapping();
  const { text: patched, anyNewer } = patchLifecycleIcons(
    cachedContent, mapping, cacheMtimeMs
  );
  process.stdout.write(patched + '\n');
  // Trigger background refresh when:
  //   - cache has aged past the background-refresh threshold, OR
  //   - any tracked transcript is newer than the cache (user activity
  //     happened after the last full render). The activity-newer trigger
  //     is what gets the non-lifecycle parts of the line (UKB, knowledge
  //     pipeline, etc.) caught up promptly after a long idle stretch.
  if (cacheAgeMs > BG_REFRESH_THRESHOLD_MS || anyNewer) {
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

// CRITICAL: close child's stdin immediately. CSL.readStdinInput() does
// `for await (const chunk of process.stdin)` which hangs until EOF.
// Without this end() call, CSL hangs the full 8s on every spawn for
// any pane whose TRANSCRIPT_SOURCE_PROJECT is outside the coding repo
// (triggering the redirect-status code path that reads stdin), then
// emits "⚠️ SYS:TIMEOUT" instead of a real statusline.
try { child.stdin.end(); } catch { /* already closed */ }

let output = '';
let stderrBuf = '';
child.stdout.on('data', (d) => { output += d; });
child.stderr.on('data', (d) => { stderrBuf += d; });

// Safety timeout: if CSL truly hangs, kill it. Must exceed CSL's own 8s
// internal timeout (combined-status-line.js emits "⚠️ SYS:TIMEOUT" at 8s);
// otherwise we SIGKILL before CSL gets to produce that informative output.
const spawnStart = Date.now();
const fallbackTimer = setTimeout(() => {
  child.kill('SIGKILL');
}, 10000);

function logFailure(reason, code, signal) {
  // Foolproof debug: append every CSL failure/timeout to a log so the user
  // (and future Claude sessions) can see WHY SYS:TIMEOUT/SYS:ERR fired.
  try {
    const entry = {
      ts: new Date().toISOString(),
      reason,
      elapsedMs: Date.now() - spawnStart,
      exitCode: code,
      signal,
      projectName,
      paneWidth,
      transcriptSourceProject: process.env.TRANSCRIPT_SOURCE_PROJECT || null,
      hadStaleCache: !!cachedContent.trimEnd(),
      cacheAgeMs: cacheAgeMs === Infinity ? null : Math.round(cacheAgeMs),
      stderrTail: stderrBuf.replace(/\r?\n$/, '').split('\n').slice(-6).join('\n'),
      stdoutTail: output.replace(/\r?\n$/, '').split('\n').slice(-2).join('\n'),
    };
    fs.appendFileSync(
      path.join(codingRepo, '.logs', 'csl-failures.jsonl'),
      JSON.stringify(entry) + '\n'
    );
  } catch { /* logging must never throw */ }
}

child.on('exit', (code, signal) => {
  clearTimeout(fallbackTimer);
  // Same NO-TRIM rule as the cache reads above. Strip line terminator only.
  const result = output.replace(/\r?\n$/, '');

  // Detect CSL-internal timeout/error markers so we can prefer cache over
  // surfacing them to the user. The user explicitly does not want to see
  // "SYS:TIMEOUT" / "SYS:ERR" in the statusline — those are diagnostic
  // markers, not user-facing content.
  // Match both the legacy ⚠️ form and the current 🟡 form. ⚠️ (U+26A0+VS16)
  // was swapped out because its tmux/terminal cell-width mismatch leaked
  // trailing chars into the statusline; kept here defensively so stale
  // caches written by older CSL builds are still recognised as markers.
  const isMarkerOnly = /^\s*(?:⚠️?|🟡)\s*SYS:(TIMEOUT|ERR)\b/.test(result.trimStart());

  if (code === 0 && result.trimEnd() && !isMarkerOnly) {
    process.stdout.write(result + '\n');
    process.exit(0);
  }

  // CSL failed OR produced only a diagnostic marker — log it.
  logFailure(
    code === 0 ? 'marker-only' : (signal === 'SIGKILL' ? 'sigkill' : 'nonzero-exit'),
    code,
    signal
  );

  // Foolproof fallback: ANY cached content beats showing a diagnostic
  // marker to the user. We accept staleness up to whatever the disk has;
  // the in-pane render will refresh on the next tmux tick once CSL recovers.
  if (cachedContent.trimEnd()) {
    const mapping = readProjectMapping();
    const { text: patched } = patchLifecycleIcons(cachedContent, mapping, cacheMtimeMs);
    process.stdout.write(patched + '\n');
    // Trigger background refresh for next cycle (also feeds stdin EOF immediately)
    const bg = spawn('node', [cslScript], {
      env, stdio: ['ignore', 'ignore', 'ignore'], detached: true
    });
    bg.unref();
    process.exit(0);
  }

  // No cache available — last resort, surface the marker (or whatever
  // partial result CSL emitted) so the pane isn't blank.
  if (result.trimEnd()) {
    process.stdout.write(result + '\n');
    process.exit(0);
  }
  // Truly nothing to show
  process.exit(code || 1);
});
