/**
 * Clickable status-line fields.
 *
 * tmux can turn any span of the status line into a mouse target: wrapping text
 * in `#[range=user|TAG] … #[norange]` makes a click there fire the `Status`
 * mouse key with `#{mouse_status_range}` set to TAG. The binding that reads it
 * lives in scripts/tmux-session-wrapper.sh; the actions live in
 * bin/statusline-click.
 *
 * Two constraints from tmux(1) that this file exists to enforce:
 *
 *   • TAG is capped at 15 BYTES. tmux silently drops a longer range, so the
 *     field just stops responding — there is no error anywhere. Project tags
 *     are therefore a `p:` prefix plus a TRUNCATED project name, and
 *     bin/statusline-click resolves them by prefix against the coordinator's
 *     project list rather than expecting an exact name.
 *
 *   • TAGS MUST BE LOWERCASE. status-line-fast.cjs re-applies the underline and
 *     repaints lifecycle icons by regex-matching UPPERCASE project abbreviations
 *     ("C", "REC") with `(?<![A-Z])` / `(?![A-Z])` boundary guards. An uppercase
 *     letter inside a range tag would sit inside those guards' blind spot and
 *     could be rewritten as if it were a project bubble. Lowercase tags cannot
 *     collide with an abbreviation by construction.
 *
 * Width is NOT a concern here: visibleCellWidth() strips `#[...]` before
 * counting, so range markers cost zero cells and cannot reopen the trailing-
 * residue bug (see memory/reference_tmux_emoji_width_fix.md).
 */

const MAX_TAG_BYTES = 15;

/**
 * Normalise a tag to something tmux will accept and the fast path cannot
 * mistake for a project abbreviation: lowercase, conservative charset,
 * truncated to the byte budget (not the character count — the limit is bytes).
 */
function normalizeTag(raw) {
  let tag = String(raw).toLowerCase().replace(/[^a-z0-9:_-]/g, '');
  while (Buffer.byteLength(tag, 'utf8') > MAX_TAG_BYTES) tag = tag.slice(0, -1);
  return tag;
}

/** Wrap `text` as a clickable field carrying `tag`. */
function markClickable(tag, text) {
  const t = normalizeTag(tag);
  if (!t) return text;
  return `#[range=user|${t}]${text}#[norange]`;
}

/** Tag for a project bubble, e.g. "coding" -> "p:coding". */
function buildProjectTag(projectName) {
  return normalizeTag(`p:${projectName}`);
}

/**
 * Field -> tag, matched against the part's leading glyph.
 *
 * Ordered, first match wins. Deliberately anchored on the OPENING bracket and
 * badge glyph, which is the one part of each field that does not change with
 * state — the dots, counters and percentages after it all do.
 *
 * Fields absent from this table stay unclickable on purpose: the trailing
 * clock (nothing useful to open) and the [D:]/[L:] counters.
 */
const RULES = [
  { re: /^\[🏥/u,  tag: 'health' },      // system health  -> dashboard root
  { re: /^\[LSL/u, tag: 'lsl' },         // LSL alarm badge
  { re: /^\[📋/u,  tag: 'lsl' },         // live-log target (same subject)
  { re: /^\[→/u,   tag: 'lsl' },         // redirect-only form of the same field
  { re: /^\[🔒/u,  tag: 'constraints' }, // constraint compliance
  { re: /^\[📚/u,  tag: 'obs' },         // observation pipeline
  { re: /^\[N:/u,  tag: 'net' },         // network + proxy
  { re: /^\[🧠/u,  tag: 'semantic' },    // proxy semantic readiness
];

/**
 * Tag one already-rendered field.
 *
 * A part that already carries a range is returned untouched: the project
 * bubbles wrap each project SEPARATELY at the point of render (only that code
 * knows which project each abbreviation belongs to), and nesting a second range
 * around them would throw that away.
 */
function decorate(part) {
  if (!part || typeof part !== 'string') return part;
  if (part.includes('#[range=')) return part;
  for (const { re, tag } of RULES) {
    if (re.test(part)) return markClickable(tag, part);
  }
  return part;
}

module.exports = { MAX_TAG_BYTES, normalizeTag, markClickable, buildProjectTag, decorate, RULES };
