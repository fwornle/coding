/**
 * The semantic-offload decision, as an ordered ladder of gates.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * This is a deliberate, bounded mirror of `resolveRoute()`'s offload block in
 * rapid-llm-proxy `proxy-bridge/routing-config.mjs` (the `// ── Semantic offload ──`
 * section). The proxy is the authority; this exists only because the diagram has
 * to answer "what WOULD happen" for a policy the operator is still editing and
 * has not saved, which `/api/llm/routing/resolve` cannot know about.
 *
 * Two rules keep the duplicate honest:
 *   1. The gate ORDER below is the proxy's order, not a tidier one. The proxy
 *      short-circuits, so the FIRST failing gate is the one whose reason string
 *      lands in `offloadSkipped` — a ladder in a different order would name a
 *      different culprit than the recorded data does.
 *   2. Where the saved policy is in force, the caller cross-checks this against
 *      the proxy's own answer and surfaces any disagreement loudly rather than
 *      letting the two drift.
 *
 * ── A gate ordering that looks wrong and is not ─────────────────────────────
 * `band` is checked BEFORE the target, and "no target declared for this network"
 * is fused with "the target for this network is switched off" into ONE gate —
 * because `pickOffloadTarget()` collapses both into a null return. Splitting
 * them here would read better and would misattribute real calls. The difference
 * survives only inside the reason string, which is why the rung prints the whole
 * target list rather than a verdict.
 */

export type JobClass = 'fg-chat' | 'background'
export type OffloadScope = 'fg' | 'bg'

export interface OffloadTarget {
  provider: string
  requireNetwork: string | null
  enabled: boolean
  scope?: string[]
}

export interface OffloadPolicy {
  enabled: boolean
  offloadBands: string[]
  targets: OffloadTarget[]
}

export interface RouteEntry {
  provider: string
  complexity: string
  /**
   * `offload: false` pins a route to its declared provider — used where the model
   * that answers IS the measurement (the kgbench judge, the kb-ab probes). Present
   * on the wire from `GET /api/llm/routing`; the page types simply never declared it.
   */
  offload?: boolean
}

/** Rungs, in evaluation order. Index IS the rung number. */
export const GATES = [
  {
    id: 'considered',
    label: 'offload is on, and this route is not already the target',
    hint: 'policy enabled · route names a different provider',
  },
  {
    id: 'route-allows',
    label: 'route allows offloading',
    hint: 'offload: false pins the model that answers',
  },
  {
    id: 'band',
    label: 'band is eligible',
    hint: 'offload_bands',
  },
  {
    id: 'target',
    label: 'a target serves this network, and is switched on',
    hint: 'require_network · enabled',
  },
  {
    id: 'scope',
    label: 'that target serves this kind of work',
    hint: 'scope: fg / bg',
  },
  {
    id: 'transport',
    label: 'the wire protocol is compatible',
    hint: 'fg_transport',
  },
  {
    id: 'offloaded',
    label: 'offloaded to the local target',
    hint: 'the account the route named becomes the first fallback',
  },
] as const

/** The PASS rung — reaching it means the call moved. */
export const RUNG_OFFLOADED = GATES.length - 1

export function jobClassOf(routeKey: string): JobClass {
  return routeKey.startsWith('fg-') ? 'fg-chat' : 'background'
}

export function scopeOf(cls: JobClass): OffloadScope {
  return cls === 'fg-chat' ? 'fg' : 'bg'
}

function normalizeNetwork(n: string | null | undefined): string {
  return n === 'corporate' || n === 'vpn' ? 'corporate' : 'public'
}

/**
 * The target that serves this network, or null. Mirrors `pickOffloadTarget()`:
 * first match wins, a target with no `require_network` matches everything, and a
 * switched-off target is skipped rather than removed — so "none declared" and
 * "the one here is off" both arrive as null.
 */
export function pickTarget(policy: OffloadPolicy | null, network: string): OffloadTarget | null {
  const live = normalizeNetwork(network)
  for (const t of policy?.targets ?? []) {
    if (t.enabled === false) continue
    if (!t.requireNetwork || t.requireNetwork === live) return t
  }
  return null
}

/** Human list of the declared targets, as the proxy prints it in its reason strings. */
export function describeTargets(policy: OffloadPolicy | null): string {
  const list = (policy?.targets ?? []).map((t) =>
    `${t.provider}[${t.requireNetwork || 'any'}/${(t.scope ?? ['fg', 'bg']).join('+')}]`
    + `${t.enabled === false ? ' (off)' : ''}`)
  return list.length ? list.join(', ') : 'none declared'
}

export interface GateVerdict {
  /** Index into GATES: where this route stopped, or RUNG_OFFLOADED if it moved. */
  rung: number
  /** The proxy's own words for why it stopped, or null when it did not. */
  reason: string | null
  /** The provider that ends up serving, after any offload. */
  provider: string
  /** The provider the route declared, when the offload moved it off. */
  offloadedFrom: string | null
}

/**
 * Where a route falls out of the offload ladder, under a given policy.
 *
 * @param providerHasFgTransport — the ONE fact this cannot derive from the policy
 *   alone. `fg_transport` lives on the provider catalogue, and a caller that
 *   cannot supply it should pass a function returning false, which is the safe
 *   direction: it can only under-report gate 5, never invent it.
 */
export function evaluateOffload(
  policy: OffloadPolicy | null,
  entry: RouteEntry,
  routeKey: string,
  band: string,
  network: string,
  providerHasFgTransport: (providerId: string) => boolean,
): GateVerdict {
  const stay = (rung: number, reason: string | null): GateVerdict =>
    ({ rung, reason, provider: entry.provider, offloadedFrom: null })

  const target = policy?.enabled ? pickTarget(policy, network) : null

  // Gate 0 — the outer condition. Note it is SILENT in the proxy: when the route
  // already names the target, no reason is recorded, which is indistinguishable
  // from "policy off" unless the ladder says so explicitly. It does.
  if (!policy?.enabled) return stay(0, 'the offload policy is switched off')
  if (target && entry.provider === target.provider) {
    return stay(0, `route already names ${target.provider}`)
  }

  if (entry.offload === false) return stay(1, `route ${routeKey} sets offload: false`)

  if (!policy.offloadBands.includes(band)) {
    return stay(2, `band "${band}" is not in offload_bands [${policy.offloadBands.join(', ')}]`)
  }

  if (!target) {
    return stay(3, `no offload target for network=${normalizeNetwork(network)} (targets: ${describeTargets(policy)})`)
  }

  const cls = jobClassOf(routeKey)
  const scope = target.scope ?? ['fg', 'bg']
  if (!scope.includes(scopeOf(cls))) {
    return stay(4, `target "${target.provider}" serves scope [${scope.join(', ')}] and this is ${scopeOf(cls)} work (${routeKey})`)
  }

  if (providerHasFgTransport(entry.provider) && !providerHasFgTransport(target.provider)) {
    return stay(5, `route provider "${entry.provider}" serves a foreground transport that "${target.provider}" cannot`)
  }

  return { rung: RUNG_OFFLOADED, reason: null, provider: target.provider, offloadedFrom: entry.provider }
}

/**
 * Which rung a RECORDED `offloadSkipped` string belongs to.
 *
 * Matched by shape, never by equality: every one of these interpolates a route
 * key, a band, a target list or a provider name. The `unclassified` fallback is
 * deliberate and is rendered as its own visible row — a newer proxy emitting a
 * reason this does not know must show up as an unexplained bucket, not vanish
 * into the rounding of another rung.
 */
export function rungOfReason(reason: string): number | 'unclassified' {
  if (/^the offload policy is switched off/.test(reason)) return 0
  if (/^route already names/.test(reason)) return 0
  if (/sets offload: false/.test(reason)) return 1
  if (/is not in offload_bands/.test(reason)) return 2
  if (/^no offload target for network=/.test(reason)) return 3
  if (/^require_network=/.test(reason)) return 3          // pre-2026-08-29 spelling
  if (/serves scope \[/.test(reason)) return 4
  if (/serves a foreground transport/.test(reason)) return 5
  return 'unclassified'
}
