/**
 * What the "LLM Traffic" health tile says, derived from the proxy's recent-calls
 * feed (`/api/token-usage/recent`). Pure, so tests/dashboard/llm-traffic.test.mjs
 * can pin it.
 *
 * Replaces the "LLM Pool Overhead" tile (Phase 66), which graded `overhead_ms`:
 * the spawn/queue time of the claude-code CLI worker pool. Only that pool's
 * provider ever stamped the field, and current routing (claude-code-max OAuth
 * passthrough, gh-copilot) does not go through it — by 2026-11 every row carried
 * null and the tile showed a permanent "no recent pool calls".
 *
 * It answers three questions instead, each from fields every row carries:
 *   - is the proxy answering, and when did it last? (newest timestamp)
 *   - which accounts carry the load, how many calls and how fast? (provider,
 *     latency_ms — generation included, so shown as information, never graded)
 *   - which configured providers can the proxy not use? (attempt_trail.skipped:
 *     every unusable provider in the call's chain, and why — NOT a fallback
 *     record: it includes providers behind the one that answered)
 */

export interface TrafficCall {
  timestamp: string
  provider?: string | null
  model?: string | null
  latency_ms?: number | null
  attempt_trail?: string | null
}

export type TrafficStatus = 'operational' | 'warning' | 'error' | 'reference'

export interface TrafficItem {
  name: string
  status: TrafficStatus
  description: string
  tooltip: string
  badgeLabel?: string
}

export interface TrafficView {
  items: TrafficItem[]
  /** One line under the rows: what the numbers are based on. */
  basis: string
}

/** No call for this long → the proxy is idle (or not reached); said, not alarmed. */
export const IDLE_AFTER_MS = 15 * 60_000

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code-max': 'Claude Max',
  'claude-code': 'Claude Code',
  'gh-copilot': 'GitHub Copilot',
  'github-copilot': 'GitHub Copilot',
  copilot: 'GitHub Copilot',
  anthropic: 'Anthropic API',
  'anthropic-api': 'Anthropic API',
  groq: 'Groq',
  'qwen-local': 'Local Qwen',
  'qwen-laptop': 'Local Qwen (laptop)',
}

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/** "claude-opus-5-5" → "opus 5.5", "claude-haiku-5.5" → "haiku 5.5"; others unchanged. */
export function shortModel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:[-.](\d+))?/.exec(model)
  return m ? `${m[1]} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : model
}

interface Skip { provider: string; reason: string }

function skippedOf(call: TrafficCall): Skip[] {
  if (!call.attempt_trail) return []
  try {
    const trail = JSON.parse(call.attempt_trail) as { skipped?: Array<Partial<Skip>> }
    return (trail.skipped ?? [])
      .filter((s): s is Skip => typeof s.provider === 'string')
      .map((s) => ({ provider: s.provider, reason: s.reason || 'skipped' }))
  } catch {
    return []
  }
}

export function buildTrafficView(calls: TrafficCall[], now: number, limit: number): TrafficView {
  const dated = calls
    .map((c) => ({ c, t: Date.parse(c.timestamp) }))
    .filter(({ t }) => Number.isFinite(t))
    .sort((a, b) => b.t - a.t)

  if (dated.length === 0) {
    return {
      items: [{
        name: 'No calls recorded',
        status: 'reference',
        description: 'the proxy has logged no LLM calls yet',
        tooltip: 'The recent-calls feed is empty: nothing has gone through the LLM proxy.',
        badgeLabel: 'idle',
      }],
      basis: '',
    }
  }

  const newest = dated[0].t
  const oldest = dated[dated.length - 1].t
  const items: TrafficItem[] = []

  const sinceLast = now - newest
  if (sinceLast > IDLE_AFTER_MS) {
    items.push({
      name: 'Idle',
      status: 'reference',
      description: `last call ${formatDuration(sinceLast)} ago`,
      tooltip: `No LLM call in the last ${formatDuration(IDLE_AFTER_MS)}. Background work (consolidation, observations) only calls when there is something to do, so a quiet proxy is not a fault — LLM Proxy Health shows whether it is reachable.`,
      badgeLabel: 'idle',
    })
  }

  // One row per account that answered, busiest first.
  const byProvider = new Map<string, { n: number; latencies: number[]; models: Map<string, number>; last: number }>()
  for (const { c, t } of dated) {
    const id = c.provider || 'unknown'
    let p = byProvider.get(id)
    if (!p) {
      p = { n: 0, latencies: [], models: new Map(), last: t }
      byProvider.set(id, p)
    }
    p.n++
    if (typeof c.latency_ms === 'number' && Number.isFinite(c.latency_ms)) p.latencies.push(c.latency_ms)
    if (c.model) p.models.set(c.model, (p.models.get(c.model) ?? 0) + 1)
  }
  for (const [id, p] of [...byProvider].sort((a, b) => b[1].n - a[1].n)) {
    const models = [...p.models].sort((a, b) => b[1] - a[1])
    const p50 = p.latencies.length ? median(p.latencies) : null
    items.push({
      name: providerLabel(id),
      status: 'operational',
      description: [
        `${p.n} call${p.n === 1 ? '' : 's'}`,
        p50 === null ? null : `median ${formatDuration(p50)}`,
        models.slice(0, 2).map(([m]) => shortModel(m)).join(', ') || null,
      ].filter(Boolean).join(' · '),
      tooltip: [
        `${providerLabel(id)} (${id}) answered ${p.n} of the last ${dated.length} calls; last one ${formatDuration(now - p.last)} ago.`,
        `Models: ${models.map(([m, n]) => `${m} ×${n}`).join(', ') || 'unknown'}.`,
        'Median is end-to-end latency, generation included — longer answers take longer, so it is shown, not graded.',
      ].join('\n'),
      badgeLabel: `${Math.round((p.n / dated.length) * 100)}%`,
    })
  }

  // Did calls reach their first-choice provider?
  const skippedBy = new Map<string, Map<string, number>>()
  let fellBack = 0
  for (const { c } of dated) {
    const skips = skippedOf(c)
    if (skips.length === 0) continue
    fellBack++
    for (const s of skips) {
      const reasons = skippedBy.get(s.provider) ?? new Map<string, number>()
      reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1)
      skippedBy.set(s.provider, reasons)
    }
  }
  // attempt_trail.skipped lists EVERY provider in the call's chain the proxy
  // could not use — wherever it sits, also BEHIND the one that answered — so
  // it does not mean the call fell back. Say what it does mean: these
  // providers are configured but unavailable, and routes pass over them.
  if (fellBack > 0) {
    const names = [...skippedBy].map(([prov, reasons]) => {
      const top = [...reasons].sort((a, b) => b[1] - a[1])[0][0]
      return `${providerLabel(prov)} (${top})`
    })
    items.push({
      name: 'Unavailable',
      status: 'reference',
      description: `${names.join(', ')} — passed over in ${fellBack} of ${dated.length} calls`,
      tooltip: [
        'Providers listed in these calls\' routes that the proxy could not use. They were passed over — not necessarily before the provider that answered: the proxy records every unusable provider in the chain.',
        ...[...skippedBy].map(([prov, reasons]) =>
          `${providerLabel(prov)} (${prov}): ${[...reasons].map(([r, n]) => `${r} ×${n}`).join(', ')}`),
        'Usually no key or no egress for that provider on this machine; the proxy\'s /health lists which backends are available.',
      ].join('\n'),
      badgeLabel: 'skipped',
    })
  }

  const capped = dated.length >= limit
  return {
    items,
    basis: `${capped ? 'last' : 'all'} ${dated.length} calls · past ${formatDuration(Math.max(now - oldest, 0))}`,
  }
}
