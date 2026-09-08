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
const modelLimits = require('./model-limits.cjs');

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Segments in the bar.
 *
 * Was 10, matching what the Claude statusline rendered, and dropped to 8 to buy
 * back two cells on a status line that had grown wide. The cost is resolution:
 * one block is 12.5% rather than a tidy 10%, so the bar reads as an
 * approximation. That is what a bar is for — the exact figure is printed
 * immediately to its right and is unaffected.
 *
 * GAUGE_CELLS and GAUGE_RE both derive from this, so a change here is picked up
 * by the renderer, the blank, the zero position and the fast-path patcher
 * together. Caches written at the old width simply stop matching GAUGE_RE, and
 * patchContextGauge's no-op-on-no-match leaves them alone until the next full
 * render replaces the whole line — which is correct: patching an 11-cell
 * segment over a 13-cell one would shorten the line and re-open the
 * trailing-residue bug.
 */
const BAR_SEGMENTS = 8;

/**
 * Rendered width in terminal cells, IDENTICAL in every severity state.
 *
 * BAR_SEGMENTS bar cells + 1 space + 4 percentage cells. The percentage is right-padded
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
const EMPTY = ' ';    // the trough is PAINTED, by the band's bg colour — see below

/**
 * WHY THE TROUGH IS A PAINTED SPACE AND NOT '░' (U+2591, light shade).
 *
 * The dither was fine while fill was whole-cell. It stops working the moment a
 * cell can be PARTIALLY filled: the unfilled remainder of a partial cell is flat
 * background, while every '░' cell beside it carries bright foreground dots that
 * lift its apparent brightness. The darkest part of the bar then lands exactly
 * where the fill ends, reading as a hard dark line pinned to the fill edge —
 * reported as "a strange dark green line at the right edge of the light green".
 *
 * A flat trough makes the partial cell continuous with the cells after it, so
 * the only boundary left is the real one: where the fill stops. The trough stays
 * perfectly visible because the band paints bg across the full width, which is
 * also what keeps GAUGE_ZERO a visible bar rather than the hole GAUGE_BLANK is.
 */

/**
 * Eighth-width block elements, 1/8 through 7/8 (U+258F down to U+2589), used to
 * fill the LEADING cell partially.
 *
 * WHY, given the bar already has BAR_SEGMENTS cells: those cells are the scarce
 * resource. GAUGE_CELLS feeds a line combined-status-line.js truncates to the
 * pane, and the segment count was deliberately cut 10 -> 8 when the line was
 * slimmed, so buying resolution with more cells spends exactly what that change
 * reclaimed. Sub-cell fill buys 8x the resolution (64 levels, ~1.6% each,
 * against 12.5%) at zero additional width and zero additional cost -- the bar is
 * two string repeats either way, noise beside the node spawn each tick pays.
 *
 * Same EAW=Ambiguous class as FILLED and EMPTY, so tmux's cell accounting is
 * unchanged; a partial cell is still one cell.
 *
 * Ordered so PARTIALS[n - 1] is n eighths.
 */
const PARTIALS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const SUBCELLS = PARTIALS.length + 1;   // eighths: 7 partial glyphs + the full block

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
  // Fill is measured in eighths of a cell, not whole cells. A whole-cell floor()
  // rendered everything under 12.5% as a completely empty trough, so the entire
  // first eighth of the context window was pixel-identical to 0% — and since the
  // ░ trough dithers into what reads as a solid block at terminal font sizes,
  // that looked like a broken bar rather than a low reading.
  //
  // The max(1) floor keeps the same promise at the very bottom of the range:
  // any usage at all is visible. 0% still renders an empty trough, because
  // "nothing used" and "barely used" SHOULD differ — it is 1%-vs-0% that must
  // not look identical.
  const units = Math.floor((pct / 100) * BAR_SEGMENTS * SUBCELLS);
  const shown = pct > 0 ? Math.max(1, units) : 0;
  const full = Math.floor(shown / SUBCELLS);
  const rem = shown % SUBCELLS;
  // Cell count is invariant: full + (1 if partial) + empty === BAR_SEGMENTS.
  // That is the fixed-width contract GAUGE_CELLS encodes; breaking it re-opens
  // the trailing-residue bug.
  const bar = FILLED.repeat(full)
    + (rem ? PARTIALS[rem - 1] : '')
    + EMPTY.repeat(BAR_SEGMENTS - full - (rem ? 1 : 0));
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
 * The gauge's zero position: an empty trough in the calm band, reading 0%.
 *
 * This is what a pane shows while its agent has not reported yet — the window
 * between a session starting and the agent first rendering its own status line,
 * during which the bridge file simply does not exist.
 *
 * That window used to render as GAUGE_BLANK, on the principle that "a gauge
 * reading 0% and a gauge that cannot see its source must not look the same".
 * The principle is right; it was being applied to the wrong case. A brand-new
 * session is not a gauge that cannot see its source, it is a gauge whose source
 * has nothing to report yet — and one tick later the agent reports exactly this,
 * 0%. Rendering a black hole for that interval made a working system look
 * broken, which is the failure mode the whole fail-open convention exists to
 * avoid.
 *
 * The distinction is kept where it is still real: hasContextReader() separates
 * "this agent has no readable store at all" (still blank/absent — a structural
 * fact that will not change on the next tick) from "supported agent, no reading
 * yet" (this constant).
 */
const GAUGE_ZERO = renderGauge(0);

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
  + `(?:[${FILLED}${EMPTY}${PARTIALS.join('')}]{${BAR_SEGMENTS}} {1,4}\\d{1,3}%| {${GAUGE_CELLS}})`
  + '#\\[fg=default,bg=default,nobold\\]'
);

// ---------------------------------------------------------------------------
// Context windows
// ---------------------------------------------------------------------------

/**
 * Fallback window when a model is in neither the catalogue nor the table below.
 *
 * 200K is the common denominator across the Claude and GPT families these
 * agents actually route to. It is a floor, not a guess dressed as fact: an
 * unknown model with a LARGER real window renders a gauge that over-reports
 * usage, which errs toward warning early rather than lulling.
 */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * LAST-RESORT window table, consulted only when the models.dev catalogue has no
 * entry for the model (see lib/statusline/model-limits.cjs).
 *
 * It used to be the ONLY source, and that is what made a 188K opencode session
 * render 94% bold-red instead of 19% green: the /^claude-/ line asserts 200K,
 * while the catalogue — the same file opencode's own compaction reads — puts
 * claude-opus-5 and claude-sonnet-5 at 1,000,000. It also flattened the gauge's
 * response to a model switch, since sonnet-5 and opus-5 both landed on the same
 * fabricated number.
 *
 * Regexes cannot track a model catalogue; they only ever encode the day they
 * were written. This table survives for the machine with no catalogue on disk,
 * and the 1M line stays first because a `[1m]` suffix is a statement about the
 * SESSION's window that no catalogue keyed on model id can carry.
 */
const CONTEXT_WINDOWS = [
  // Order matters — first regex match wins.
  [/\[1m\]|-1m\b/i, 1_000_000],       // explicit 1M-context variants
  [/^claude-/i, 200_000],
  [/^gpt-5|^gpt-4\.1/i, 400_000],
  [/^gpt-/i, 128_000],
  // The on-prem cluster's own ids, ahead of the generic qwen3 line below.
  //
  // 65,536 is what the cluster's owner publishes for every `dual-*` and `hga-*`
  // variant (`contextWindow: 65536` in the endpoint definition handed to
  // Copilot). DECLARED, NOT PROBED, and it is worth saying which: the endpoint
  // does not report `max_model_len` on /v1/models, and a deliberate overflow
  // does not error — it simply never returns — so there is no way to confirm
  // this from outside. It is believed because the operator said so.
  //
  // Without this line these ids fall to /^qwen3/i and are sized at 262,144,
  // which is not a measurement of anything: it is the laptop GGUF's window
  // applied to a different deployment by a regex that predates it. A full
  // cluster session would have rendered as 25%, which is the same class of
  // mistake as the /^claude-/ 200K line this file already carries a warning
  // about.
  [/^qwen3\.8-27b-(dual|hga)\b/i, 65_536],
  [/^qwen3/i, 262_144],
];

/**
 * Usable context window for a model, catalogue first.
 *
 * The `[1m]` / `-1m` suffix is checked BEFORE the catalogue: it is a per-session
 * opt-in flag appended to a model id, so the catalogue's entry for the bare id
 * would under-report it.
 *
 * @param {string} model
 * @param {string} [provider] provider id as the agent reports it. Improves the
 *   lookup (a model id can differ in window between providers) but is optional.
 * @returns {number} usable context window in tokens
 */
function contextWindowFor(model, provider) {
  const m = String(model || '');
  if (CONTEXT_WINDOWS[0][0].test(m)) return CONTEXT_WINDOWS[0][1];
  try {
    const catalogued = modelLimits.catalogueContextWindow(m, provider);
    if (catalogued) return catalogued;
  } catch {
    // Catalogue unreadable — the table below is exactly the fallback for that.
  }
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

function pctFromTokens(usedTokens, model, provider) {
  const win = contextWindowFor(model, provider);
  if (!win) return null;
  return Math.max(0, Math.min(100, (usedTokens / win) * 100));
}

/**
 * When the agent in this tmux session started, in epoch ms, or 0 if unknown.
 *
 * Written by _record_agent_session() in scripts/tmux-session-wrapper.sh at
 * launch. This is the ONLY per-pane timestamp available to a status line: tmux
 * knows when the SESSION started, but a relaunch inside an existing pane
 * (`coding --opencode` again after a /quit) keeps the tmux session, and it is
 * exactly that case the gauge has to notice.
 *
 * 0 means "no record" and callers must treat it as "no lower bound", never as
 * "started at the epoch" — an unwrapped agent has no record and must still get
 * a gauge, just an unbounded one.
 */
function paneStartedAtMs(tmuxSession) {
  const name = String(tmuxSession || process.env.TMUX_SESSION_NAME || '');
  const repo = process.env.CODING_REPO;
  // Same shape guard the Claude session record applies: this value reaches a path.
  if (!name || !repo || /[/\\]|\.\./.test(name)) return 0;
  try {
    const rec = JSON.parse(
      fs.readFileSync(path.join(repo, '.data', 'agent-sessions', `${name}.json`), 'utf8')
    );
    const ts = Number(rec && rec.startedAt) || 0;
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  } catch {
    return 0;
  }
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
 *
 * The window counts only messages that actually reported tokens, and never
 * reaches past a compaction — see readOpencode. Both were ways the max smeared
 * across a boundary it was never meant to cross.
 */
const OPENCODE_TRAILING_MESSAGES = 5;

/**
 * How many sessions to rank. `time_updated DESC` still selects the pool — it is
 * a sound filter, it was only ever a bad tie-break — and the pane's session is
 * always in the top few by it, because /clear stamps time_updated at creation
 * and a resumed session is written the moment it is prompted.
 */
const OPENCODE_SESSION_CANDIDATES = 5;

/**
 * Finds user messages without parsing every row's JSON.
 *
 * opencode serialises message records with JSON.stringify, so the separator has
 * no spaces and this substring is exact. It is matched in SQLite rather than in
 * JS deliberately: the alternative is reading back every message of every
 * candidate and JSON.parse-ing it, and a measured session here carries a run of
 * 102 consecutive non-user messages, so a bounded lookback would have to read
 * ~120 rows per candidate on every 5s tick. The LIKE does the whole ranking in
 * one query in 0.5ms.
 */
const OPENCODE_USER_MESSAGE_LIKE = '%"role":"user"%';

/**
 * The session this PANE is on — not merely the newest one in this directory.
 *
 * THE FILTERS. Three ways the old `WHERE directory = ?` query read a session the
 * pane was not in. All three were observed on one machine at once, and together
 * they are why a freshly restarted opencode rendered 94% red.
 *
 *   parent_id IS NULL   — opencode gives every SUBAGENT its own session row in
 *     the same directory, and a busy subagent's row is the most recently
 *     updated one for as long as it runs. The gauge was reporting a @explore
 *     task's context as the user's.
 *
 *   time_archived IS NULL — an archived session is one the user has explicitly
 *     put away. It is never the pane's current session.
 *
 *   time_created >= paneStartedAt — opencode creates the session row LAZILY, on
 *     the first assistant message, so between launching and sending the first
 *     prompt there is NO row for this pane at all — and the newest row in the
 *     directory is the PREVIOUS session, from before the restart. That is not a
 *     stale cache that a tick will clear; it is a different conversation, and it
 *     would have gone on being reported until the user sent a message. Bounding
 *     on pane start makes the empty result an honest empty result.
 *
 * THE RANKING, and why it is no longer `ORDER BY time_updated DESC LIMIT 1`.
 * The filters above cover a pane RESTART. `/clear` is the case they cannot see:
 * it makes a new session inside the same pane, so both sessions pass every
 * filter and only the tie-break separates them. Measured, from one machine's
 * database:
 *
 *   16:19:46.249  /clear — new session row created
 *   16:20:46.849  PREVIOUS session written again (an in-flight compaction
 *                 landing its summary message)
 *
 * For that whole minute the previous conversation was the most recently updated
 * row in the directory, so a pane the user had just emptied went on rendering
 * the context of the conversation they had just discarded — at 100% bold red.
 * It is not a stale cache a tick clears; the row genuinely is newer.
 *
 * time_updated cannot tell a background write from the user's own activity, and
 * that is the whole distinction needed here. A user message can: it exists only
 * because a human typed into that session. So candidates are ranked by
 * max(time_created, last user message) — creation counts because a session the
 * user has just opened and not yet prompted is still the one they are looking
 * at, and that fallback is exactly the /clear case.
 *
 * `time_updated DESC` is kept to pick the POOL, so the property its comment
 * defended survives: resuming an earlier session from the picker moves the gauge
 * with it as soon as it is prompted, because that prompt is a user message and
 * outranks everything else.
 *
 * Residual, and it is honest to name it: two opencode panes started in the SAME
 * directory after the same instant are indistinguishable to this query, and the
 * gauge follows whichever spoke last. Fixing that needs a session id the TUI
 * does not publish — opencode's `event` table, the obvious place, is empty.
 */
function currentOpencodeSession(db, projectPath, tmuxSession) {
  const since = paneStartedAtMs(tmuxSession);
  const candidates = db
    .prepare(
      `SELECT id, model, time_created FROM session
        WHERE directory = ?
          AND parent_id IS NULL
          AND time_archived IS NULL
          AND time_created >= ?
        ORDER BY time_updated DESC
        LIMIT ?`
    )
    .all(projectPath, since, OPENCODE_SESSION_CANDIDATES);
  if (candidates.length <= 1) return candidates[0];

  const spokeAt = new Map();
  try {
    const slots = candidates.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT session_id, MAX(time_created) AS t FROM message
          WHERE session_id IN (${slots})
            AND data LIKE ?
          GROUP BY session_id`
      )
      .all(...candidates.map(c => c.id), OPENCODE_USER_MESSAGE_LIKE);
    for (const r of rows) spokeAt.set(r.session_id, Number(r.t) || 0);
  } catch {
    // Should opencode ever change how it serialises a message, every candidate
    // ranks on time_created alone — which still answers /clear correctly, and
    // degrades only the picker-resume case. Never a thrown query, never a hole.
  }

  const rank = c => Math.max(Number(c.time_created) || 0, spokeAt.get(c.id) || 0);
  return candidates.reduce((best, c) => (rank(c) > rank(best) ? c : best));
}

/**
 * A pane whose session has not been created yet is at zero, and says so.
 *
 * Distinct from returning null, which means "cannot see the store" and renders
 * a hole. A wrapped opencode with a readable database and no session row yet is
 * a NEW session: 0% is the measured truth, and it is the number that would have
 * been shown a moment later anyway.
 */
const OPENCODE_FRESH = Object.freeze({
  usedPct: 0,
  model: null,
  source: 'opencode-db-fresh',
  ageMs: null,
});

/**
 * Compaction has just reset the conversation and the new size is not yet known.
 *
 * Reported as zero for the same reason OPENCODE_FRESH is: the session really has
 * been emptied, the next assistant turn measures what replaced it, and one tick
 * of "0%" on a session that just shed its history is far closer to the truth
 * than the pre-compaction number would be. Distinct `source` because the two
 * reach zero for different reasons and a gauge that cannot be explained is a
 * gauge that gets rewritten.
 */
const OPENCODE_COMPACTED = Object.freeze({
  usedPct: 0,
  model: null,
  source: 'opencode-db-compacted',
  ageMs: null,
});

/**
 * Is this the assistant message that COMPACTED the session?
 *
 * opencode marks it three ways at once — `summary: true`, `mode: 'compaction'`,
 * `agent: 'compaction'` — verified across all 216 such messages in a real
 * database, so any one of them identifies it and checking all three costs
 * nothing and survives two of them being dropped.
 *
 * It matters twice over, and both were live bugs:
 *
 *  - Its tokens are the SUMMARISER's prompt, not the conversation's occupancy.
 *  - It runs on whatever model is configured for compaction, which is routinely
 *    NOT the conversation's model — measured: claude-opus-4.6, gpt-5.4, and
 *    gpt-4o on a `rapid-proxy` provider, in a database whose conversations are
 *    claude-opus-5 on github-copilot.
 *
 * It is also the boundary itself: everything at or before it belongs to the
 * conversation that was discarded.
 */
function isOpencodeCompaction(d) {
  return d?.summary === true || d?.mode === 'compaction' || d?.agent === 'compaction';
}

function readOpencode({ projectPath, tmuxSession }) {
  if (!projectPath) return null;
  const db = openReadonly(opencodeDbPath());
  if (!db) return null;
  try {
    const session = currentOpencodeSession(db, projectPath, tmuxSession);
    if (!session?.id) return OPENCODE_FRESH;

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
    let provider = null;
    let seen = 0;
    let compacted = false;
    for (const r of rows) {
      if (seen >= OPENCODE_TRAILING_MESSAGES) break;
      let d;
      try { d = JSON.parse(r.data); } catch { continue; }
      if (d?.role !== 'assistant') continue;
      // The trailing window must not straddle a compaction. Everything older
      // than this message is the conversation that was just thrown away, and
      // taking a max across the boundary reports the size of the discarded one:
      // measured, 194K on a session compaction had just reduced to 42K, and it
      // persisted for several turns as the window drained.
      if (isOpencodeCompaction(d)) { compacted = true; break; }
      if (!d.tokens) continue;
      // Anthropic wire: input EXCLUDES cache reads, so they add.
      const t = (Number(d.tokens.input) || 0) + (Number(d.tokens.cache?.read) || 0);
      // opencode inserts the assistant row at the START of a turn, with every
      // token field zero, and fills it in on completion. That placeholder is not
      // a reading of anything, and counting it against the window evicts the
      // readings the window exists to hold: runs of 4 consecutive zero-token
      // assistant rows are measured in a real database, which leaves a
      // 5-message window holding exactly ONE real number and defeats the
      // interstitial-dip protection above. One more, and `used` is 0 and a
      // mid-conversation session reports itself empty.
      if (!t) continue;
      seen++;
      // Model and count come from the SAME message, always. They used to be
      // gathered independently — count as a max over the window, model from
      // whichever message happened to be newest — so a compaction on a foreign
      // model lent its context window to a count that belonged to the
      // conversation's model. Measured: 194,184 claude-opus-5 tokens (19% of a
      // 1M window) normalised against gpt-4o's 128K, which clamps to a bold red
      // 100% on a session that was one fifth full.
      if (t > used) {
        used = t;
        model = d.modelID || null;
        provider = d.providerID || null;
      }
    }

    // No reading in this session yet. Either it has never had one (a new pane,
    // or a /clear) or compaction has just discarded the ones it had.
    if (!used) return compacted ? OPENCODE_COMPACTED : OPENCODE_FRESH;

    // session.model is a JSON blob ({"id":...,"providerID":...}) in current
    // schema versions and a bare string in older ones. Only consulted when the
    // winning message named neither — never to override it.
    if (!model || !provider) {
      try {
        const parsed = JSON.parse(session.model);
        model ||= parsed?.id;
        provider ||= parsed?.providerID;
      } catch {
        model ||= session.model;
      }
    }

    const usedPct = pctFromTokens(used, model, provider);
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
    // The Copilot CLI serves the github-copilot catalogue by definition, so the
    // provider is not a guess here — naming it makes the window lookup exact.
    const usedPct = pctFromTokens(used, row.model, 'github-copilot');
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

/**
 * Which agent scope this install runs in, resolved exactly the way
 * config/agents/pi.sh and claude-mcp-launcher.sh resolve it: the environment
 * first, then CODING_REPO/.env. The status line is not launched by the agent
 * wrapper, so it usually has no CODING_AGENT_SCOPE in its environment and the
 * file is the only source.
 */
function agentScope() {
  if (process.env.CODING_AGENT_SCOPE) return process.env.CODING_AGENT_SCOPE;
  const repo = process.env.CODING_REPO;
  if (!repo) return 'wrapper';
  try {
    const m = fs.readFileSync(path.join(repo, '.env'), 'utf8')
      .match(/^CODING_AGENT_SCOPE=(.*)$/m);
    return m ? m[1].trim() : 'wrapper';
  } catch {
    return 'wrapper';
  }
}

/**
 * pi's agent directory — where its session JSONLs live.
 *
 * Decided by SCOPE, not by which directory happens to exist. Wrapper scope puts
 * it at $CODING_REPO/.pi-agent, global scope at ~/.pi/agent (config/agents/pi.sh
 * lines 396-406). An existence check looks equivalent and is not: switching an
 * install to global leaves the old .pi-agent on disk, so the gauge would keep
 * reading a frozen snapshot of pre-switch sessions and report a stale context
 * for a live pi pane, indefinitely and with no error.
 */
function piConfigDir() {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  const repo = process.env.CODING_REPO;
  if (repo && agentScope() !== 'global') return path.join(repo, '.pi-agent');
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

/**
 * WHICH CLAUDE SESSION OWNS THIS TMUX SESSION
 * -------------------------------------------
 * Everything above answers "how full is this context". This answers "whose
 * context is it" — the one input readClaude() cannot observe for itself, and
 * the one that was wrong.
 *
 * Both renderers used to infer the session id from a PROJECT-keyed source: the
 * newest-beating coordinator LSL entry for the project in the full render, the
 * single transcript path per project in the fast path's sidecar. Neither is per
 * session, and the per-pane tie-break meant to disambiguate them
 * (`e.tmuxPane === myPane` in combined-status-line.js) never fires — coordinator
 * entries take their pane from the ETM heartbeat's `tmux_pane`
 * (health-coordinator.js:500), and ETMs are project singletons carrying only the
 * launcher's pane, so that field is null in practice.
 *
 * So a fresh session rendered the context of the session the user had just
 * left, until its own ETM registered and out-beat the old one's remaining
 * heartbeats. Measured on a first-turn session: 66%, which is exactly what the
 * PREVIOUS session's bridge file normalises to (remaining 45%) while its own
 * said 13%.
 *
 * Claude Code hands the status-line command its own session_id on stdin, per
 * session, from the very first render. scripts/claude-statusline.cjs records it
 * here so the gauge reads the session it is actually drawing for.
 *
 * KEYED ON THE TMUX SESSION NAME rather than the pane, because that is the only
 * identifier both ends can see. tmux runs `status-right` in the server, not in a
 * pane, so the renderers never receive TMUX_PANE; what the format string does
 * hand them is `#{session_name}` as TMUX_SESSION_NAME. It is also the right
 * granularity — `status-right` is drawn once per tmux session, so a finer key
 * could not be rendered separately anyway, and these agent launches are one tmux
 * session apiece.
 */

/**
 * Upper bound on how long a record may outlive the session that wrote it.
 *
 * NOT a freshness requirement: a live session rewrites this on every status-line
 * render, but an idle one may not render for hours and must keep its mapping —
 * expiring it would drop the pane straight back onto the project-keyed guess
 * this exists to replace. The bound covers the one case where the tmux session
 * name alone is ambiguous: names embed the launcher pid, and pids are reused
 * across reboots. A relaunched session overwrites the record on its first render
 * (seconds), so this only has to stop yesterday's leftovers from being believed
 * forever.
 */
const CLAUDE_SESSION_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Sanitised to a filename. Real names are `<project>-<agent>-<pid>`, so this is
 * the identity function for every name that actually occurs; it is here to keep
 * an unexpected one from escaping the temp directory, not to normalise.
 */
function claudeSessionRecordFile(tmuxSession) {
  const safe = String(tmuxSession || '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  if (!safe || /^[-.]+$/.test(safe)) return null;
  return path.join(os.tmpdir(), `claude-tmux-session-${safe}.json`);
}

/**
 * Record the Claude session currently rendering in a tmux session.
 *
 * Written via a temp file and rename so a reader on the 5s tick can never
 * observe a half-written record — the renderers parse this on every tick and a
 * truncated read would just silently blank the gauge.
 *
 * @returns {boolean} whether the record was written. Callers ignore it; the
 *   status line must not change behaviour because a temp file was unwritable.
 */
function recordClaudeSession({ tmuxSession, sessionId, cwd } = {}) {
  const file = claudeSessionRecordFile(tmuxSession);
  const id = String(sessionId || '');
  // Same shape guard readClaude() applies before building a bridge-file path.
  if (!file || !id || /[/\\]|\.\./.test(id)) return false;
  const tmpFile = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({
      session_id: id,
      tmux_session: String(tmuxSession),
      cwd: cwd ? String(cwd) : null,
      ts: Date.now(),
    }));
    fs.renameSync(tmpFile, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmpFile); } catch { /* nothing to clean up */ }
    return false;
  }
}

/**
 * The Claude session id recorded for a tmux session, or null when there is no
 * trustworthy record — an unwrapped `claude` that never runs the shim, a tick
 * before the first render, or a record past its TTL. Null means "fall back",
 * never "no context".
 */
function claudeSessionForTmuxSession(tmuxSession) {
  const file = claudeSessionRecordFile(tmuxSession);
  if (!file) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const id = rec?.session_id;
    if (!id || typeof id !== 'string') return null;
    const ts = Number(rec.ts) || 0;
    if (!ts || Date.now() - ts > CLAUDE_SESSION_RECORD_TTL_MS) return null;
    return id;
  } catch {
    return null;
  }
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
 * @param {string} [opts.tmuxSession] this pane's tmux session name, used to
 *   date the pane's launch so a PREVIOUS session's context is never reported as
 *   this one's (opencode only — see currentOpencodeSession)
 * @returns {{usedPct:number, model:string|null, source:string, ageMs:number|null}|null}
 *   null whenever no trustworthy number is available — the caller renders
 *   nothing rather than a zero, because a gauge reading 0% and a gauge that
 *   cannot see its source must not look the same.
 */
/**
 * Can this agent's context store be read at all?
 *
 * Separates the two reasons readContextUsage() returns null. "No reader" is
 * structural — an unsupported agent, or a pane with no agent at all — and no
 * number will ever arrive, so the caller renders nothing. "Reader, but no data"
 * is transient, and the caller renders GAUGE_ZERO rather than a hole.
 *
 * @param {string} agent
 * @returns {boolean}
 */
function hasContextReader(agent) {
  return Object.hasOwn(READERS, String(agent || '').toLowerCase());
}

function readContextUsage({ agent, projectPath, sessionId, tmuxSession } = {}) {
  const reader = READERS[String(agent || '').toLowerCase()];
  if (!reader) return null;
  try {
    const r = reader({ projectPath, sessionId, tmuxSession });
    if (!r || !Number.isFinite(r.usedPct)) return null;
    return r;
  } catch {
    return null;
  }
}

module.exports = {
  readContextUsage,
  hasContextReader,
  recordClaudeSession,
  claudeSessionForTmuxSession,
  renderGauge,
  contextWindowFor,
  paneStartedAtMs,
  encodePiSessionDir,
  sessionIdFromTranscriptPath,
  GAUGE_RE,
  GAUGE_BLANK,
  GAUGE_ZERO,
  GAUGE_CELLS,
  BAR_SEGMENTS,
  PARTIALS,
  SUBCELLS,
  FILLED,
  EMPTY,
  DEFAULT_CONTEXT_WINDOW,
};
