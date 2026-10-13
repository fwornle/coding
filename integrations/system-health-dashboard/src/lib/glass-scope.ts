/**
 * Which parts of coding's LLM flow glass also carries — for the faint "in glass"
 * underlay on Token Usage → Flow.
 *
 * glass (the extract built by scripts/glass/extract.mjs from glass/manifest.yaml)
 * measures the four interactive agents and forwards each call, unchanged, to the
 * host the agent addressed with the agent's own login. So it has the fg-chat
 * callers and the accounts those logins answer from, and none of the rest:
 * no background services, no routing decision, no offload (planned as G8, opt-in;
 * see .planning/glass.md "Data flow per agent — coding vs glass").
 *
 * Declared, not derived: the manifest lists files, not routes or accounts. Keep
 * this in step with that table when glass gains an agent or an offload target.
 */
export const GLASS_AGENTS = ['claude', 'copilot', 'opencode', 'pi'] as const

/** Account ids (normalized, see lib/providers) glass rows are answered by. */
export const GLASS_ACCOUNTS = new Set(['claude-code-max', 'gh-copilot'])

export const GLASS_NOTE =
  'Also in glass: measured and forwarded with the agent\'s own login. glass does not route — the decision column and every background service are coding only.'

/** True for a route key glass carries: fg-chat/<one of its agents>. */
export function inGlassCaller(routeKey: string): boolean {
  const [head, agent] = routeKey.split('/')
  return head === 'fg-chat' && (GLASS_AGENTS as readonly string[]).includes(agent)
}

export function inGlassAccount(providerId: string): boolean {
  return GLASS_ACCOUNTS.has(providerId)
}

/**
 * The underlay's colour: slate, a non-hue. Every hue near the obvious picks
 * (teal, cyan, green) is already an account in PROVIDER_COLORS, and an underlay
 * that reads as qwen-local's colour would say the opposite of what it means.
 */
export const GLASS_TINT = '#64748b'

/** Contiguous index runs [first, last] of the items a predicate holds for. */
export function runsOf<T>(items: readonly T[], pred: (t: T) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = []
  items.forEach((t, i) => {
    if (!pred(t)) return
    const last = out[out.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else out.push([i, i])
  })
  return out
}
