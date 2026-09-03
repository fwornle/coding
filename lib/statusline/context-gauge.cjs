'use strict';
/**
 * Context-window gauge for the tmux status bar — one implementation, four agents.
 *
 * WHY THIS FILE IS CommonJS
 * -------------------------
 * Both status-line renderers need it: `scripts/status-line-fast.cjs` (CJS, the
 * 5s-tick fast path) and `scripts/combined-status-line.js` (ESM, the full
 * render). CJS is the only module format both can load without a second copy —
 * ESM default-imports a .cjs file fine, the reverse is not true synchronously.
 * The alternative, duplicating the logic the way LIFECYCLE_ICONS and
 * lastContentTimestampMs are duplicated, is exactly the drift trap those two
 * carry "keep them in step" comments about. One file, no drift.
 *
 * WHAT IT REPLACES
 * ----------------
 * The gauge used to live only in ~/.claude/hooks/gsd-statusline.js, so it
 * existed for Claude and nowhere else. That file is GSD-managed (it is listed
 * in ~/.claude/gsd-file-manifest.json), so editing it is not a durable place to
 * own this. Here it is ours, and every agent gets it.
 *
 * THE FOUR SOURCES (all measured, none inferred)
 * ----------------------------------------------
 *   claude    $TMPDIR/claude-ctx-<sessionId>.json — the bridge gsd-statusline
 *             already writes for the context-monitor hook. Pre-normalised:
 *             carries remaining_percentage directly.
 *   opencode  ~/.local/share/opencode/opencode.db → newest assistant `message`
 *             rows for the session. Anthropic-wire: input EXCLUDES cache reads,
 *             so occupancy = input + cache.read.
 *   copilot   ~/.copilot/session-store.db → assistant_usage_events.
 *             OpenAI-wire: input_tokens ALREADY INCLUDES cache reads, so adding
 *             cache_read_tokens here would double-count. This is the same
 *             two-wires trap documented in CLAUDE.md for token accounting.
 *   pi        <piCfgDir>/sessions/<encoded-cwd>/*.jsonl → last `usage` record.
 *             Anthropic-wire: input + cacheRead.
 *
 * Deliberately NOT used: opencode's `session.tokens_input` column. Measured
 * cumulative (91977 on a session whose last turn was 243 tokens) — that is a
 * spend total, not context occupancy.
 *
 * COST
 * ----
 * Runs on every tmux tick (5s), in every pane. Measured: copilot 9ms, opencode
 * 10ms. The opencode query MUST filter by session_id so it rides
 * `message_session_time_created_id_idx`; the same query without that filter
 * takes 1.5s on a 2.2GB database, which would be visible as statusline lag.
 *
 * Every read fails soft: a missing store, an absent native module, a corrupt
 * row, an unknown agent — all return null and the gauge is simply absent. A
 * status line must never be the thing that breaks.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Segments in the bar. Matches what the Claude statusline rendered. */
const BAR_SEGMENTS = 10;

/**
 * Rendered width in terminal cells, IDENTICAL in every severity state.
 *
 * 10 bar cells + 1 space + 4 percentage cells. The percentage is right-padded
 * to 4 ("  0%" … "100%") specifically so the width cannot change between ticks.
 *
 * This matters more than it looks. `status-line-fast.cjs` patches this segment
 * into a string `combined-status-line.js` already truncated to fit the pane; a
 * state change that also changed the width would push the line past the pane
 * edge, and tmux's cell-clear math then leaves the previous frame's rightmost
 * cells on screen — the recurring "15:322" / "07:407" trailing-residue bug.
 *
 * It is also why the ≥80% state does NOT get the 💀 prefix the Claude
 * statusline used: three extra cells in one state only. Severity is carried by
 * colour and bold instead, which is what the rest of this status line already
 * does (see STATE_DOTS in combined-status-line.js — emoji identify WHAT a badge
 * is, never how bad it is).
 */
const GAUGE_CELLS = BAR_SEGMENTS + 1 + 4;

const FILLED = '█';   // U+2588, EAW=Ambiguous ⇒ 1 cell in tmux (non-East-Asian locale)
const EMPTY = '░';    // U+2591, same class

/**
 * Severity bands, in ascending order of used-context. Thresholds are carried
 * over unchanged from the Claude statusline so the gauge means what it always
 * meant; only the colours gain a background.
 *
 * Each band is a bright foreground over a DULLER BACKGROUND OF THE SAME HUE —
 * the fill reads as a watermark against a tinted trough, which is the look this
 * replaces. 256-palette indices, never hex: tmux re-parses '#' inside a
 * status-right format string, so a "#rrggbb" colour silently corrupts the line.
 */
const BANDS = [
  { max: 50, fg: 'colour46', bg: 'colour22', bold: false },   // green   on dark green
  { max: 65, fg: 'colour226', bg: 'colour58', bold: false },  // yellow  on olive
  { max: 80, fg: 'colour208', bg: 'colour94', bold: false },  // orange  on brown
  { max: Infinity, fg: 'colour196', bg: 'colour52', bold: true }, // red on dark red
];

function bandFor(usedPct) {
  return BANDS.find(b => usedPct < b.max) || BANDS[BANDS.length - 1];
}

/**
 * Render the gauge as a tmux-styled, fixed-width segment.
 *
 * @param {number} usedPct 0-100, clamped.
 * @returns {string} e.g. '#[fg=colour46,bg=colour22]██████░░░░  74%#[fg=default,bg=default]'
 */
function renderGauge(usedPct) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(usedPct) || 0)));
  const filled = Math.floor((pct / 100) * BAR_SEGMENTS);
  const bar = FILLED.repeat(filled) + EMPTY.repeat(BAR_SEGMENTS - filled);
  const label = `${pct}%`.padStart(4, ' ');
  const b = bandFor(pct);
  const style = `#[fg=${b.fg},bg=${b.bg}${b.bold ? ',bold' : ''}]`;
  // The trailing reset restores BOTH channels. Resetting only fg would leave
  // the background tint bleeding across every following badge.
  return `${style}${bar} ${label}#[fg=default,bg=default,nobold]`;
}

/**
 * A gauge-shaped hole: the same GAUGE_CELLS of space, no reading.
 *
 * Needed because status-line-fast.cjs, when a pane has no cache of its own,
 * borrows a SIBLING pane's cached line and re-labels it. That line belongs to a
 * different project and possibly a different agent, so its gauge is somebody
 * else's context — a pi pane was observed rendering a Claude pane's 41%. Blanking
 * on borrow is what stops a real-looking number from being attributed to the
 * wrong session.
 *
 * It is a blank rather than a deletion because the line has already been
 * left-padded to a stable cell count by the time the fast path sees it. Removing
 * cells there makes the payload narrower than tmux was told to allocate, which is
 * the trailing-residue bug ("07:407") all over again.
 */
const GAUGE_BLANK = `#[fg=default,bg=default]${' '.repeat(GAUGE_CELLS)}#[fg=default,bg=default,nobold]`;

/**
 * Matches a rendered gauge OR a blanked one, anywhere in a status line, so the
 * fast path can replace whatever is there with this pane's current reading.
 *
 * Anchored on the structure (style marker, payload, reset) rather than on any
 * one colour, so adding or retuning a band does not silently stop the patcher
 * from matching — a failure mode that would freeze the gauge at whatever the
 * last full render wrote.
 */
const GAUGE_RE = new RegExp(
  '#\\[fg=(?:colour\\d+|default),bg=(?:colour\\d+|default)(?:,bold)?\\]'
  + `(?:[${FILLED}${EMPTY}]{${BAR_SEGMENTS}} {1,4}\\d{1,3}%| {${GAUGE_CELLS}})`
  + '#\\[fg=default,bg=default,nobold\\]'
);

// ---------------------------------------------------------------------------
// Context windows
// ---------------------------------------------------------------------------

/**
 * Fallback window when a model is not in the table below.
 *
 * 200K is the common denominator across the Claude and GPT families these
 * agents actually route to. It is a floor, not a guess dressed as fact: an
 * unknown model with a LARGER real window renders a gauge that over-reports
 * usage, which errs toward warning early rather than lulling.
 */
const DEFAULT_CONTEXT_WINDOW = 200_000;

const CONTEXT_WINDOWS = [
  // Order matters — first regex match wins.
  [/\[1m\]|-1m\b/i, 1_000_000],       // explicit 1M-context variants
  [/^claude-/i, 200_000],
  [/^gpt-5|^gpt-4\.1/i, 400_000],
  [/^gpt-/i, 128_000],
  [/^qwen3/i, 262_144],
];

/**
 * @param {string} model
 * @returns {number} usable context window in tokens
 */
function contextWindowFor(model) {
  const m = String(model || '');
  for (const [re, win] of CONTEXT_WINDOWS) {
    if (re.test(m)) return win;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Lazy, failure-tolerant better-sqlite3 load. Native module — may be absent. */
let _Database;
let _databaseTried = false;
function getDatabase() {
  if (_databaseTried) return _Database;
  _databaseTried = true;
  try {
    _Database = require('better-sqlite3');
  } catch {
    _Database = null;
  }
  return _Database;
}

/**
 * Open a database read-only. Mirrors openReadonlyDb() in
 * lib/lsl/live/opencode-sqlite-poll.mjs — same flags, same busy_timeout.
 * Read-only is not optional here: these are the agents' own live databases and
 * a status line has no business writing to them.
 */
function openReadonly(dbPath) {
  const Database = getDatabase();
  if (!Database || !dbPath || !fs.existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 2000');
    return db;
  } catch {
    return null;
  }
}

function pctFromTokens(usedTokens, model) {
  const win = contextWindowFor(model);
  if (!win) return null;
  return Math.max(0, Math.min(100, (usedTokens / win) * 100));
}

// ---------------------------------------------------------------------------
// Per-agent readers
// ---------------------------------------------------------------------------

/**
 * Claude — read the bridge file gsd-statusline.js already writes.
 *
 * The normalisation below is deliberately identical to the Claude statusline's
 * (gsd-statusline.js): Claude Code reserves a slice of the window for
 * autocompact, so the honest "how full am I" number is the used fraction of the
 * USABLE range, not of the raw window. Users can move that reserve with
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW, so read it rather than hardcoding 16.5%.
 *
 * Uses remaining_percentage, not the bridge's own used_pct: used_pct is the
 * un-normalised value the context-monitor hook wants for its warnings, and
 * reading it here would show a number ~13 points off what the gauge always
 * showed.
 */
function readClaude({ sessionId }) {
  if (!sessionId || /[/\\]|\.\./.test(sessionId)) return null;
  try {
    const p = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const remaining = raw?.remaining_percentage;
    if (remaining == null || !Number.isFinite(Number(remaining))) return null;

    const totalCtx = Number(raw.total_tokens) || 1_000_000;
    const acw = parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '0', 10);
    const bufferPct = acw > 0 ? Math.min(100, (acw / totalCtx) * 100) : 16.5;
    const usableRemaining = Math.max(
      0,
      ((Number(remaining) - bufferPct) / (100 - bufferPct)) * 100
    );

    const ts = Number(raw.timestamp) || 0;
    return {
      usedPct: Math.max(0, Math.min(100, 100 - usableRemaining)),
      model: null,
      source: 'claude-bridge',
      ageMs: ts ? Date.now() - ts * 1000 : null,
    };
  } catch {
    return null;
  }
}

/** Default opencode database location. */
function opencodeDbPath() {
  return (
    process.env.OPENCODE_DB_PATH ||
    path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
  );
}

/**
 * How many trailing assistant messages to consider, and why more than one.
 *
 * Within a single user turn opencode writes one assistant message per step of
 * the agentic loop, all sharing a parentID. Their prompt sizes are close but
 * not monotonic, and a short interstitial step (a summary or title call) can
 * land last and read far below the real conversation size. Taking the max over
 * a small trailing window absorbs that without smearing across turns — measured
 * on a long session the window is flat (43.4K–47.0K), so the max is the honest
 * number rather than an inflated one.
 */
const OPENCODE_TRAILING_MESSAGES = 5;

function readOpencode({ projectPath }) {
  if (!projectPath) return null;
  const db = openReadonly(opencodeDbPath());
  if (!db) return null;
  try {
    const session = db
      .prepare(
        `SELECT id, model FROM session
          WHERE directory = ?
          ORDER BY time_updated DESC
          LIMIT 1`
      )
      .get(projectPath);
    if (!session?.id) return null;

    // session_id filter is load-bearing — see the COST note at the top.
    const rows = db
      .prepare(
        `SELECT data FROM message
          WHERE session_id = ?
          ORDER BY time_created DESC
          LIMIT ?`
      )
      .all(session.id, OPENCODE_TRAILING_MESSAGES * 3);

    let used = 0;
    let model = null;
    let seen = 0;
    for (const r of rows) {
      if (seen >= OPENCODE_TRAILING_MESSAGES) break;
      let d;
      try { d = JSON.parse(r.data); } catch { continue; }
      if (d?.role !== 'assistant' || !d?.tokens) continue;
      seen++;
      // Anthropic wire: input excludes cache reads, so they add.
      const t = (Number(d.tokens.input) || 0) + (Number(d.tokens.cache?.read) || 0);
      if (t > used) used = t;
      if (!model && d.modelID) model = d.modelID;
    }
    if (!used) return null;

    if (!model) {
      // session.model is a JSON blob ({"id":...,"providerID":...}) in current
      // schema versions and a bare string in older ones.
      try { model = JSON.parse(session.model)?.id; } catch { model = session.model; }
    }
    const usedPct = pctFromTokens(used, model);
    return usedPct == null ? null : { usedPct, model, source: 'opencode-db', ageMs: null };
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

/** Default copilot session-store location. */
function copilotDbPath() {
  return (
    process.env.COPILOT_SESSION_DB_PATH ||
    path.join(os.homedir(), '.copilot', 'session-store.db')
  );
}

function readCopilot({ projectPath }) {
  if (!projectPath) return null;
  const db = openReadonly(copilotDbPath());
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT u.model AS model,
                u.input_tokens AS input_tokens,
                u.created_at AS created_at
           FROM assistant_usage_events u
           JOIN sessions s ON s.id = u.session_id
          WHERE s.cwd = ?
          ORDER BY u.id DESC
          LIMIT 1`
      )
      .get(projectPath);
    if (!row || !row.input_tokens) return null;

    // OpenAI wire: input_tokens ALREADY includes cache reads. Adding
    // cache_read_tokens here would double-count — see the header note.
    const used = Number(row.input_tokens) || 0;
    const usedPct = pctFromTokens(used, row.model);
    if (usedPct == null) return null;

    const ts = Date.parse(row.created_at);
    return {
      usedPct,
      model: row.model,
      source: 'copilot-db',
      ageMs: Number.isFinite(ts) ? Date.now() - ts : null,
    };
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

/**
 * pi's session directory for a given project.
 *
 * pi encodes the cwd by replacing '/' with '-' and wrapping the result, e.g.
 * /Users/x/Agentic/coding → --Users-x-Agentic-coding--. The encoding is
 * reproduced here for the fast path, but a scan fallback follows it: this is
 * pi's private convention, not a contract, and a silent miss would look
 * identical to "no pi session" forever.
 */
function encodePiSessionDir(projectPath) {
  return `-${String(projectPath).split('/').join('-')}--`;
}

function piConfigDir() {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  // Wrapper scope keeps pi's agent dir inside the repo; global scope uses ~/.pi.
  // Mirrors config/agents/pi.sh.
  const repo = process.env.CODING_REPO;
  if (repo) {
    const wrapperDir = path.join(repo, '.pi-agent');
    if (fs.existsSync(wrapperDir)) return wrapperDir;
  }
  return path.join(os.homedir(), '.pi', 'agent');
}

function findPiSessionDir(sessionsRoot, projectPath) {
  const exact = path.join(sessionsRoot, encodePiSessionDir(projectPath));
  if (fs.existsSync(exact)) return exact;
  // Fallback: match on the '/'-substituted path as a substring, so a change in
  // pi's wrapping characters degrades to "still works" instead of "silently
  // never finds anything".
  const needle = String(projectPath).split('/').join('-');
  try {
    for (const d of fs.readdirSync(sessionsRoot)) {
      if (d.includes(needle)) return path.join(sessionsRoot, d);
    }
  } catch { /* unreadable root */ }
  return null;
}

/** Bounded tail read — pi session files grow without limit. */
function readTail(file, tailBytes = 64 * 1024) {
  let fd = null;
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return '';
    const len = Math.min(size, tailBytes);
    const buf = Buffer.allocUnsafe(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* gone */ } }
  }
}

function readPi({ projectPath }) {
  if (!projectPath) return null;
  try {
    const sessionsRoot = path.join(piConfigDir(), 'sessions');
    const dir = findPiSessionDir(sessionsRoot, projectPath);
    if (!dir) return null;

    const newest = fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const p = path.join(dir, f);
        let mt = 0;
        try { mt = fs.statSync(p).mtimeMs; } catch { /* skip */ }
        return { p, mt };
      })
      .sort((a, b) => b.mt - a.mt)[0];
    if (!newest?.p) return null;

    const lines = readTail(newest.p).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line[0] !== '{') continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      const usage = rec?.usage || rec?.message?.usage;
      if (!usage) continue;
      // Anthropic wire: input excludes cache reads.
      const used = (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0);
      if (!used) continue;
      const model = rec?.model || rec?.message?.model || null;
      const usedPct = pctFromTokens(used, model);
      if (usedPct == null) return null;
      return { usedPct, model, source: 'pi-session', ageMs: Date.now() - newest.mt };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Claude Code's own session id, recovered from a transcript path.
 *
 * The bridge file is keyed on the id Claude Code generates for itself, which
 * the launcher never sees — CLAUDE_SESSION_ID is the coding wrapper's own
 * `claude-<pid>-<epoch>` string, a different namespace entirely. The transcript
 * filename IS that id, and both renderers already hold a transcript path for
 * the pane's project (the coordinator's lsl entry in the full render, the
 * .logs/combined-status-line-projects.json sidecar in the fast path), so this
 * is the seam that needs no extra I/O on either side.
 */
function sessionIdFromTranscriptPath(transcriptPath) {
  if (!transcriptPath || !String(transcriptPath).endsWith('.jsonl')) return null;
  return path.basename(String(transcriptPath), '.jsonl') || null;
}

const READERS = {
  claude: readClaude,
  opencode: readOpencode,
  copilot: readCopilot,
  pi: readPi,
};

/**
 * Current context occupancy for the agent running in this pane.
 *
 * @param {object} opts
 * @param {string} opts.agent        'claude' | 'opencode' | 'copilot' | 'pi'
 * @param {string} opts.projectPath  absolute project directory for this pane
 * @param {string} [opts.sessionId]  agent-native session id (Claude only)
 * @returns {{usedPct:number, model:string|null, source:string, ageMs:number|null}|null}
 *   null whenever no trustworthy number is available — the caller renders
 *   nothing rather than a zero, because a gauge reading 0% and a gauge that
 *   cannot see its source must not look the same.
 */
function readContextUsage({ agent, projectPath, sessionId } = {}) {
  const reader = READERS[String(agent || '').toLowerCase()];
  if (!reader) return null;
  try {
    const r = reader({ projectPath, sessionId });
    if (!r || !Number.isFinite(r.usedPct)) return null;
    return r;
  } catch {
    return null;
  }
}

module.exports = {
  readContextUsage,
  renderGauge,
  contextWindowFor,
  encodePiSessionDir,
  sessionIdFromTranscriptPath,
  GAUGE_RE,
  GAUGE_BLANK,
  GAUGE_CELLS,
  BAR_SEGMENTS,
  DEFAULT_CONTEXT_WINDOW,
};
