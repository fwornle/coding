// A one-line headline for an entity.
//
// Node `description` is not a description — it is a reference article. The
// consolidator prompts for `## Purpose / ## Architecture / ## Key Files /
// ## Usage / ## Troubleshooting` (ObservationConsolidator.js:3844), so the
// median is 984 characters, the 90th percentile 2,587, and the longest 10,530.
// `metadata.summary` is no help: it holds a COPY of the same long text, median
// 1,262 characters.
//
// That is the right shape for the insight document someone sits down to read,
// and the wrong shape for a tooltip, a history row, or the first thing you meet
// when you click a node. So this derives a lead sentence and leaves the article
// alone — nothing is rewritten or discarded.
//
// Parsing is the fallback, not the plan: the writer stamps `metadata.headline`
// going forward, and that always wins.

const MAX_LEN = 160

/** Minimal shape — both Entity variants satisfy it. */
export interface HeadlineNode {
  name?: string
  description?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Strip the markdown that reads badly once the text is on one line.
 * Deliberately narrow: inline code stays readable without its backticks, and
 * `copilot-events-tail.mjs` is exactly the kind of token that makes a headline
 * worth reading, so it is unwrapped rather than dropped.
 */
function flatten(md: string): string {
  return md
    // Writer-tag prefixes like "[LLM] " are provenance, not prose.
    .replace(/^\s*\[(?:LLM|AUTO|BATCH)\]\s*/i, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * First sentence, clamped. Abbreviations like `.mjs` inside a filename would
 * fool a naive split on ".", so a sentence end needs the period to be followed
 * by whitespace AND the next word to start capitalised — the common case in
 * this corpus, where sentences run `… before writes occur. Because the counter …`.
 */
function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(?:\s+[A-Z(]|$)/)
  const s = (m ? m[1] : text).trim()
  if (s.length <= MAX_LEN) return s
  // Clamp on a word boundary rather than mid-token.
  const cut = s.slice(0, MAX_LEN)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > MAX_LEN * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/** Lines that are neither headings nor list items, joined; '' when there are none. */
function prosePart(md: string): string {
  return md
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|\|)/.test(l))
    .join(' ')
    .trim()
}

/** The body under a named markdown section, or null when absent. */
function section(md: string, heading: string): string | null {
  const re = new RegExp(`^##+\\s*${heading}\\s*$([\\s\\S]*?)(?=^##+\\s|\\Z)`, 'im')
  const m = md.match(re)
  const body = m?.[1]?.trim()
  return body ? body : null
}

/**
 * Derive a one-line headline.
 *
 * Order: explicit `metadata.headline` → first sentence of `## Purpose` →
 * first sentence of the description → the entity name. Returns '' only when
 * there is genuinely nothing, so callers can test truthiness.
 */
export function headline(node: HeadlineNode | null | undefined): string {
  const meta = (node?.metadata ?? {}) as Record<string, unknown>

  const explicit = meta.headline
  if (typeof explicit === 'string' && explicit.trim()) {
    return firstSentence(flatten(explicit))
  }

  const desc = typeof node?.description === 'string' ? node.description : ''
  if (desc.trim()) {
    // Skip a bullet-only Purpose: a lone "- foo" reads worse on one line than
    // the opening prose that usually follows it.
    const purpose = section(desc, 'Purpose')
    if (purpose && !purpose.startsWith('-')) return firstSentence(flatten(purpose))

    // Prefer prose over structure: drop heading and list lines entirely rather
    // than flattening them into the sentence.
    const prose = prosePart(desc)
    if (prose) return firstSentence(flatten(prose))

    // Nothing but structure — strip the markers so the text at least reads.
    return firstSentence(flatten(desc.replace(/^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s)/gm, '')))
  }

  return typeof node?.name === 'string' ? node.name : ''
}

/**
 * True when the description carries more than the headline already shows —
 * i.e. when a "show the full article" disclosure is worth rendering.
 */
export function hasArticle(node: HeadlineNode | null | undefined): boolean {
  const desc = typeof node?.description === 'string' ? node.description : ''
  return desc.trim().length > headline(node).length + 40
}
