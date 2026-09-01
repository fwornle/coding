import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { normalizeProvider } from '@/lib/providers'
import { localClock } from '@/lib/utils'
import { OffloadDecision } from '@/components/llm-routing/offload-decision'
import { groupIntoTurns, describeBandSource } from '@/components/llm-routing/turn-grouping'
import type { Turn } from '@/components/llm-routing/turn-grouping'
import type { RecentCall } from '@/components/llm-routing/recent-call'
import { usePolledFetch } from '@/hooks/usePolledFetch'
import type { ProviderInfo } from './token-usage-flow-tab'

/**
 * Routing — how the system is configured, and what it actually did.
 *
 * ── Why this tab exists ──────────────────────────────────────────────────────
 * The routing config lived behind a Settings gear, and the only view of
 * behaviour was the Flow diagram's edge thickness, derived from per-provider
 * token totals. That could show WHERE traffic landed but never WHY: a total
 * cannot distinguish a fallback from a route change, cannot attribute a call to
 * the route that produced it, and cannot tell "the config never offered this
 * provider" from "it was offered and unreachable". The diagram's own caption
 * conceded the gap — "a thick dashed edge means work is landing somewhere the
 * config never sent it" is an inference, not a record.
 *
 * The proxy now records the decision on every row (route, band, lookup step,
 * offloaded-from, which chain position served, and a trail of what failed or
 * was skipped first). This tab reads that back. Everything below is a recorded
 * fact except where it is explicitly badged as reconstructed.
 *
 * ── Read-only, with one deliberate exception ─────────────────────────────────
 * Editing stays in the Settings dialog: this is where you find out what the
 * system is doing, that is where you change it, and mixing the two is how you
 * end up reading a number and a draft edit off the same screen without knowing
 * which one is live.
 *
 * The offload policy is the exception, and only because the alternative is
 * worse. Its whole question is counterfactual — "would this work move if the
 * laptop target were on?" — and answering it through the Settings dialog means
 * switching the target on for real, on this machine, for every caller, and then
 * coming back here to look. So the Decision card below edits it in place and
 * pays the cost the rule exists to prevent by making it loud: an unsaved policy
 * badges every number it produced `preview · unsaved`, and says in words that
 * the proxy is still running the saved one.
 */

// ── Server shapes ────────────────────────────────────────────────────────────

interface PerRoute {
  route_key: string
  route_band: string
  route_step: number
  provider: string
  model: string
  calls: number
  tokens: number
  fallback_calls: number
  offloaded_calls: number
  reconstructed_calls: number
}

interface FallbackEdge {
  from: string
  to: string
  count: number
  errors: Record<string, number>
}

interface Behaviour {
  window: { hours: number; since: string }
  totals: {
    calls: number
    fallback_calls: number
    offloaded_calls: number
    reconstructed_calls: number
    unrecorded_calls: number
  }
  perRoute: PerRoute[]
  fallbackEdges: FallbackEdge[]
  skipReasons: Array<{ provider: string; reason: string; kind: string; count: number }>
  offloadSkips: Array<{ reason: string; count: number }>
}

/** Trimmed from GET /api/llm/routing — the config half. */
interface RoutingConfig {
  paths: { routing: string; fallback: string }
  /**
   * The full provider payload, as the flow diagram declares it. This used to be
   * a four-field subset, which is why every FlowTab call site cast the config to
   * `any` — the endpoint has always returned the rest. `fgCapable` in particular
   * (`!!fg_transport`) is the one fact the offload ladder's last gate cannot
   * derive from the policy.
   */
  providers: ProviderInfo[]
  /**
   * `offload: false` pins a route to its declared provider, for the cases where
   * the model that answers IS the measurement (the kgbench judge, the kb-ab
   * probes). Also already on the wire.
   */
  routes: Record<string, { provider: string; complexity: string; offload?: boolean }>
  defaults: Record<string, { provider: string; complexity: string; offload?: boolean }>
  semanticRouting: {
    enabled: boolean
    /**
     * Ordered; the first ENABLED entry whose requireNetwork matches the live
     * network serves the offload. A target defaults to disabled — declaring one
     * says where an offload could go, `enabled` says send work there.
     */
    /**
     * `scope` is which KIND of work the target may serve — foreground
     * conversation, background service, or both. Optional on the wire: a proxy
     * that predates the field sends none, and the reader below treats that as
     * both, exactly as the loader does.
     */
    targets: Array<{ provider: string; requireNetwork: string | null; enabled: boolean; scope?: string[] }>
    offloadBands: string[]
  } | null
  /** Shaped as the flow diagram declares it; the `unknown` here needed a cast. */
  fallback: { chains: Record<string, Array<{ provider: string; when: { network?: string[] } | null }>> }
  runtime: { network: string; availableImpls: string[] }
  warnings?: string[]
}

interface RecentRow {
  timestamp: string
  process: string
  agent: string
  provider: string
  model: string
  total_tokens: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  route_key: string
  route_band: string
  route_step: number
  offloaded_from: string
  chain_position: number
  attempt_trail: string
  routing_source: string
  /** Upstream request id. The row's identity, and so the table's React key. */
  tool_call_id?: string
  /** Opening user message of the conversation — what the turn header shows. */
  prompt_preview?: string
  /** Turn identity; '' / 0 mean not recorded. See turn-grouping.ts. */
  conversation_key?: string
  turn_index?: number
  /** Who decided route_band: caller | classifier | route <key> | defaults.<cls> */
  band_source?: string
}

interface Props {
  proxyBase: string
  /** Traffic window; mirrors the page selector so every number shares one span. */
  hours: string
}

/** Matches token-usage.tsx's REFRESH_INTERVAL so every tab on the page agrees. */
const REFRESH_INTERVAL_MS = 30_000

const fmt = (n: number): string => (
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K`
      : String(n)
)

const pct = (num: number, den: number): string => (den > 0 ? `${Math.round((num / den) * 100)}%` : '—')

export function TokenUsageRoutingTab({ proxyBase, hours }: Props) {
  const [behaviour, setBehaviour] = useState<Behaviour | null>(null)
  const [config, setConfig] = useState<RoutingConfig | null>(null)
  const [recent, setRecent] = useState<RecentRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 'call' is the original flat tail; 'turn' groups by the proxy's recorded
  // turn identity. Not a filter — the same rows, read at the altitude the
  // question is actually asked at ("why did half my question run locally?").
  const [view, setView] = useState<'call' | 'turn'>('call')
  const [openTurn, setOpenTurn] = useState<string | null>(null)
  // Bumped when the offload policy is saved. Every figure on this tab is
  // downstream of the routing config, so a policy write invalidates all of them,
  // not just the card that made it.
  const [reloadNonce, setReloadNonce] = useState(0)

  // Whether the offload-policy card below is holding an unsaved edit. Lifted out
  // of OffloadDecision purely so the poll can leave the CONFIG alone while a
  // draft is open — see the fetch below.
  const [draftDirty, setDraftDirty] = useState(false)

  const load = useCallback(async (isAuto: boolean) => {
    setError(null)
    try {
      // Traffic always refreshes; the config is skipped while a draft is
      // unsaved. useOffloadPolicyDraft owns its own copy and only re-reads it
      // on mount or save, so this cannot clobber the draft directly — but the
      // routes/providers this tab passes DOWN to that card would shift beneath
      // an operator mid-edit, and a policy preview computed against
      // half-swapped config is a number nobody can account for.
      const skipConfig = isAuto && draftDirty
      const [b, c, rec] = await Promise.all([
        fetch(`${proxyBase}/api/llm/routing/behaviour?hours=${encodeURIComponent(hours)}`).then(r => r.json()),
        skipConfig ? Promise.resolve(null) : fetch(`${proxyBase}/api/llm/routing`).then(r => r.json()),
        fetch(`${proxyBase}/api/token-usage/recent?limit=500`).then(r => r.json()),
      ])
        if (b.error) throw new Error(b.error)
        setBehaviour(b)
        if (c) setConfig(c)
        // Only rows that carry a decision — the rest have nothing to show here.
        //
        // The provider is folded onto its ACCOUNT id on the way in. History holds
        // several spellings for one account (`claude-code` and `claude-code-max`
        // are the same Max subscription), and rendering them side by side makes a
        // route look as though it served two providers — which this view would
        // then present as a divergence, i.e. a fallback that never happened. The
        // behaviour endpoint folds the same way, so both halves of the tab agree.
      setRecent((rec.data ?? [])
        .filter((r: RecentRow) => r.routing_source)
        .map((r: RecentRow) => ({ ...r, provider: normalizeProvider(r.provider) })))
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }, [proxyBase, hours, draftDirty])

  // Mount + whenever the window or a policy save invalidates everything.
  useEffect(() => { void load(false) }, [proxyBase, hours, reloadNonce])

  // ...and on a timer thereafter. Everything on this tab is a record of what the
  // router just did, so a tab left open on a once-fetched frame is the one
  // failure mode it cannot afford. Paused while a policy draft is unsaved so an
  // edit is never interrupted, and while the browser tab is hidden.
  const { countdown, refreshNow } = usePolledFetch(load, {
    intervalMs: REFRESH_INTERVAL_MS,
    enabled: !draftDirty,
  })

  // Routes whose traffic did NOT all land on the provider the config names.
  // This is the list the old dashboard could not produce at all.
  const divergent = useMemo(() => {
    if (!behaviour || !config) return []
    const byRoute = new Map<string, PerRoute[]>()
    for (const r of behaviour.perRoute) {
      if (!byRoute.has(r.route_key)) byRoute.set(r.route_key, [])
      byRoute.get(r.route_key)!.push(r)
    }
    return [...byRoute.entries()]
      .map(([key, rows]) => {
        const declared = key.startsWith('defaults.')
          ? config.defaults[key.slice('defaults.'.length)]?.provider
          : config.routes[key]?.provider
        const total = rows.reduce((s, r) => s + r.calls, 0)
        const offPlan = rows.filter(r => declared && r.provider !== declared)
          .reduce((s, r) => s + r.calls, 0)

        // An offload has two possible endings and the raw `offloaded_calls`
        // total cannot tell them apart — a route that moved 6 calls to the
        // local box and one that tried 6 and got all 6 back both read "6".
        // Which happened is decided by WHERE the offloaded call was finally
        // served: on a provider the route does not declare, it landed; back on
        // the declared one, it bounced.
        const moved = rows.filter(r => declared && r.provider !== declared)
          .reduce((s, r) => s + r.offloaded_calls, 0)
        const bounced = rows.filter(r => !declared || r.provider === declared)
          .reduce((s, r) => s + r.offloaded_calls, 0)
        // Fallbacks a bounced offload does not account for: a provider that
        // simply failed. Zero across the board today, which is worth being able
        // to SEE rather than infer — it is what makes `moved + bounced` equal
        // the old Offload column, and that identity is a coincidence of the
        // window, not a property of the columns.
        const fellBack = Math.max(0, rows.reduce((s, r) => s + r.fallback_calls, 0) - bounced)

        return {
          key,
          declared: declared ?? '—',
          total,
          offPlan,
          rows: rows.sort((a, b) => b.calls - a.calls),
          tokens: rows.reduce((s, r) => s + r.tokens, 0),
          moved,
          bounced,
          fellBack,
          // Where the moved calls went. One target in practice, but the shape
          // allows more and naming it beats making the reader scan the
          // provider list to find out which local box answered.
          movedTo: [...new Set(rows.filter(r => declared && r.provider !== declared && r.offloaded_calls > 0)
            .map(r => r.provider))],
          reconstructed: rows.reduce((s, r) => s + r.reconstructed_calls, 0),
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
  }, [behaviour, config])

  const turns = useMemo(
    () => groupIntoTurns(recent as unknown as RecentCall[]),
    [recent]
  )

  if (error) {
    return (
      <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
        Could not load routing behaviour: {error}
      </div>
    )
  }
  if (!behaviour || !config) {
    return <div className="text-sm text-muted-foreground py-8">Loading routing data…</div>
  }

  const t = behaviour.totals
  const sr = config.semanticRouting
  // Which target actually serves this machine right now. Same first-match rule
  // the proxy applies (pickOffloadTarget in routing-config.mjs) — an unguarded
  // entry matches every network. Showing the whole list without saying which one
  // is live is how "the offload is on" and "the offload can fire here" get read
  // as the same statement; off-VPN with a corporate-only target they are not.
  const activeTarget = sr?.enabled
    ? (sr.targets.find(x => x.enabled !== false
        && (!x.requireNetwork || x.requireNetwork === config.runtime.network)) ?? null)
    : null

  return (
    <div className="space-y-4">
      {/* ── Headline: the four numbers that describe the window ── */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Routed calls" value={fmt(t.calls)} sub={`last ${behaviour.window.hours}h`} />
        <Stat
          label="Served by fallback"
          value={`${fmt(t.fallback_calls)} · ${pct(t.fallback_calls, t.calls)}`}
          sub={t.fallback_calls > 0 ? 'the route’s own provider did not answer' : 'every call took its declared route'}
          tone={t.fallback_calls > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Offloaded"
          value={`${fmt(t.offloaded_calls)} · ${pct(t.offloaded_calls, t.calls)}`}
          sub={sr?.enabled
            ? (activeTarget
              ? `policy on → ${activeTarget.provider}`
              : `policy on · no target for ${config.runtime.network}`)
            : 'policy off'}
        />
        <Stat
          label="Reconstructed"
          value={`${fmt(t.reconstructed_calls)} · ${pct(t.reconstructed_calls, t.calls)}`}
          sub="resolved against today’s config, not observed"
          tone={t.reconstructed_calls > 0 ? 'muted' : 'ok'}
        />
      </div>

      {/* Honesty about the denominator. A window that is mostly pre-instrumentation
          rows makes every percentage above a statement about a slice, and saying so
          costs one line. */}
      {t.unrecorded_calls > 0 && (
        <div className="text-[11px] text-muted-foreground border-l-2 border-muted pl-2">
          {fmt(t.unrecorded_calls)} further call{t.unrecorded_calls === 1 ? '' : 's'} in this window carry no
          routing decision at all (written before it was recorded, and not reachable by the backfill).
          They are excluded from every figure above rather than counted as “went to plan”.
        </div>
      )}

      {/* ── Configured ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            Configured
            <Badge variant="outline" className="text-[10px] font-normal">read-only · edit in Settings</Badge>
            <Badge variant="outline" className="text-[10px] font-mono font-normal">network: {config.runtime.network}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span><span className="text-muted-foreground">Routes:</span> {Object.keys(config.routes).length}</span>
            <span><span className="text-muted-foreground">Defaults:</span>{' '}
              {Object.entries(config.defaults).map(([c, v]) => `${c} → ${v.provider}/${v.complexity}`).join(' · ')}
            </span>
            <span><span className="text-muted-foreground">Fallback chains:</span> {Object.keys(config.fallback.chains).length}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Semantic offload: </span>
            {sr?.enabled ? (
              <>
                band{sr.offloadBands.length === 1 ? ' ' : 's '}
                <span className="font-mono">{sr.offloadBands.join(', ')}</span>
                {' → '}
                {sr.targets.length === 0
                  ? <span className="text-muted-foreground">no targets declared</span>
                  : sr.targets.map((tgt, i) => (
                    <span
                      key={tgt.provider}
                      className={tgt === activeTarget ? '' : 'text-muted-foreground'}
                      title={tgt.enabled === false
                        ? `${tgt.provider} is declared but switched off, so no work goes to it. Turn it on in Settings → Routing.`
                        : undefined}
                    >
                      {i > 0 && ' · '}
                      <span className={tgt.enabled === false ? 'font-mono line-through' : 'font-mono'}>{tgt.provider}</span>
                      {tgt.requireNetwork ? ` (${tgt.requireNetwork}` : ' (any network'}
                      {/* Scope is shown only when it NARROWS, because the default
                          is both and printing "fg+bg" beside every target would
                          bury the one that is restricted. The laptop endpoint is
                          fg-only, and a reader who cannot see that reads "off" as
                          the only thing standing between it and the background
                          services it swamped on 2026-08-29. */}
                      {tgt.scope && tgt.scope.length === 1 ? `, ${tgt.scope[0]} only)` : ')'}
                      {/* An off target reads as a target unless it says otherwise —
                          which is how the laptop endpoint served a day of traffic
                          nobody had asked it to serve. */}
                      {tgt.enabled === false && ' — off'}
                      {tgt === activeTarget && ' ← live'}
                    </span>
                  ))}
                {!activeTarget && (
                  <span className="text-amber-600 dark:text-amber-500">
                    {' '}— {sr.targets.some(x => x.enabled !== false
                      && (!x.requireNetwork || x.requireNetwork === config.runtime.network))
                      ? `no target serves ${config.runtime.network}`
                      : sr.targets.some(x => !x.requireNetwork || x.requireNetwork === config.runtime.network)
                        ? `the ${config.runtime.network} target is switched off`
                        : `no target serves ${config.runtime.network}`}, so nothing offloads here
                  </span>
                )}
              </>
            ) : <span className="text-muted-foreground">off</span>}
          </div>
          {!!config.warnings?.length && config.warnings.map((w, i) => (
            <div key={i} className="text-amber-600 dark:text-amber-500">⚠ {w}</div>
          ))}
          <div className="font-mono text-[10px] text-muted-foreground pt-1">{config.paths.routing}</div>
        </CardContent>
      </Card>

      {/* ── The decision ──
          Sits above the picture because it answers the question the picture
          only ever implied: the flow diagram draws one box labelled
          `rapid-llm-proxy` between the callers and the accounts, and every gate
          worth asking about happens inside it. */}
      <OffloadDecision
        proxyBase={proxyBase}
        onDirtyChange={setDraftDirty}
        hours={hours}
        routes={config.routes}
        defaults={config.defaults}
        providers={config.providers}
        flowProviders={config.providers}
        fallback={config.fallback}
        runtime={config.runtime}
        offloadSkips={behaviour.offloadSkips}
        perRoute={behaviour.perRoute}
        offloadedCalls={behaviour.totals.offloaded_calls}
        windowHours={behaviour.window.hours}
        recent={recent}
        onSaved={() => setReloadNonce(n => n + 1)}
      />

      {/* ── Observed per route ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Observed — what each route actually did
            <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
              “Declared” is the provider the config names. <b>Moved</b> — the offload placed the
              call on a local box and it answered there. <b>Bounced</b> — it tried, the local box
              failed, and the work came back to the declared account: the round-trip was spent and
              nothing changed. <b>Fell back</b> — a provider failed for some other reason.
              Recorded, not inferred.
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Route</th>
                  <th className="text-left px-3 py-1.5 font-medium">Declared</th>
                  <th className="text-left px-3 py-1.5 font-medium">Actually served by</th>
                  <th className="text-right px-3 py-1.5 font-medium">Calls</th>
                  <th className="text-right px-3 py-1.5 font-medium">Tokens</th>
                  <th className="text-right px-3 py-1.5 font-medium">Moved</th>
                  <th className="text-right px-3 py-1.5 font-medium">Bounced</th>
                  <th className="text-right px-3 py-1.5 font-medium">Fell back</th>
                </tr>
              </thead>
              <tbody>
                {divergent.map(r => (
                  <tr key={r.key} className={`border-b last:border-b-0 ${r.offPlan > 0 ? 'bg-amber-500/5' : ''}`}>
                    <td className="px-3 py-1.5 font-mono">
                      {r.key}
                      {r.reconstructed === r.total && r.total > 0 && (
                        <Badge variant="outline" className="ml-1.5 text-[9px] py-0">reconstructed</Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.declared}</td>
                    <td className="px-3 py-1.5">
                      {r.rows.map(x => (
                        <span
                          key={x.provider + x.model}
                          className={`inline-block mr-2 font-mono ${x.provider !== r.declared ? 'text-amber-600 dark:text-amber-500' : ''}`}
                        >
                          {x.provider}/{x.model}
                          <span className="text-muted-foreground"> ×{fmt(x.calls)}</span>
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.total)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.tokens)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {r.moved ? (
                        <span className="text-emerald-600 dark:text-emerald-500">
                          {fmt(r.moved)}
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            → {r.movedTo.join(', ')}
                          </span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.bounced ? <span className="text-amber-600 dark:text-amber-500">{fmt(r.bounced)}</span> : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.fellBack ? <span className="text-amber-600 dark:text-amber-500">{fmt(r.fellBack)}</span> : '—'}
                    </td>
                  </tr>
                ))}
                {divergent.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No routed calls recorded in this window.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Fallbacks and skips ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Fallbacks taken
              <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                Which provider failed, what it failed with, and who picked the work up.
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1.5">
            {behaviour.fallbackEdges.length === 0 && (
              <div className="text-muted-foreground py-2">No fallback was taken in this window.</div>
            )}
            {behaviour.fallbackEdges.map(e => (
              <div key={`${e.from}>${e.to}`} className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-amber-600 dark:text-amber-500">{e.from}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono">{e.to}</span>
                <span className="tabular-nums text-muted-foreground">×{fmt(e.count)}</span>
                {Object.entries(e.errors).map(([cls, n]) => (
                  <Badge key={cls} variant="outline" className="text-[9px] py-0">{cls} ×{n}</Badge>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Candidates never tried
              <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                <span className="font-mono">config</span> is fixed by editing a YAML file;{' '}
                <span className="font-mono">runtime</span> by a login or a VPN. Different problems.
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1.5">
            {behaviour.skipReasons.length === 0 && behaviour.offloadSkips.length === 0 && (
              <div className="text-muted-foreground py-2">Nothing was skipped in this window.</div>
            )}
            {behaviour.skipReasons.map(s => (
              <div key={`${s.provider}${s.reason}${s.kind}`} className="flex items-baseline gap-2">
                <Badge variant="outline" className="text-[9px] py-0">{s.kind}</Badge>
                <span className="font-mono">{s.provider}</span>
                <span className="text-muted-foreground">{s.reason}</span>
                <span className="tabular-nums text-muted-foreground ml-auto">×{fmt(s.count)}</span>
              </div>
            ))}
            {behaviour.offloadSkips.map(s => (
              <div key={s.reason} className="flex items-baseline gap-2 pt-1 border-t first:border-t-0">
                <Badge variant="outline" className="text-[9px] py-0">offload</Badge>
                <span className="text-muted-foreground">{s.reason}</span>
                <span className="tabular-nums text-muted-foreground ml-auto">×{fmt(s.count)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Individual calls ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-sm">
              Recent decisions
              <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                {view === 'call'
                  ? 'One row per call. Click a row that took a fallback or skipped a candidate to see the trail.'
                  : 'One row per TURN. An agentic turn is several calls, and they do not all route the same way — expand one to see each call, which band applied, and who decided it.'}
              </span>
            </CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              {/* The countdown is the same promise the health dashboard makes.
                  It reads "paused" rather than counting while a policy draft is
                  open, because silently not refreshing is the failure this
                  whole block exists to remove. */}
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {countdown === null
                  ? (draftDirty ? 'paused — unsaved policy' : 'paused')
                  : `Refreshing in ${countdown}s`}
              </span>
              <button
                onClick={refreshNow}
                className="text-[10px] px-2 py-0.5 rounded border hover:bg-muted/60"
              >Refresh</button>
              <div className="flex rounded border overflow-hidden">
                {(['call', 'turn'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`text-[10px] px-2 py-0.5 ${
                      view === v ? 'bg-muted font-medium' : 'hover:bg-muted/60'
                    }`}
                  >{v === 'call' ? 'By call' : 'By turn'}</button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Time</th>
                  <th className="text-left px-3 py-1.5 font-medium">Route</th>
                  <th className="text-left px-3 py-1.5 font-medium">Band</th>
                  <th className="text-left px-3 py-1.5 font-medium">Served by</th>
                  <th className="text-left px-3 py-1.5 font-medium">Decision</th>
                  <th className="text-right px-3 py-1.5 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {view === 'turn' && (
                  <TurnRows
                    turns={turns}
                    open={openTurn}
                    onToggle={id => setOpenTurn(openTurn === id ? null : id)}
                  />
                )}
                {view === 'call' && recent.map((r) => {
                  // Identity, NOT position. The index-based key this used to
                  // carry was harmless while the table was fetched once; under
                  // polling it re-binds the expanded row to whatever call lands
                  // in that slot next, so an open trail silently becomes a
                  // different call's trail.
                  const id = `${r.timestamp}-${r.tool_call_id || r.route_key}`
                  const trail = r.attempt_trail ? safeParse(r.attempt_trail) : null
                  const clickable = !!trail
                  return (
                    <tr
                      key={id}
                      onClick={() => clickable && setExpanded(expanded === id ? null : id)}
                      className={`border-b last:border-b-0 align-top ${clickable ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                    >
                      <td className="px-3 py-1.5 font-mono text-muted-foreground whitespace-nowrap">
                        {localClock(r.timestamp)}
                      </td>
                      <td className="px-3 py-1.5 font-mono">
                        {r.route_key || <span className="text-muted-foreground">—</span>}
                        {r.routing_source === 'backfill' && (
                          <Badge variant="outline" className="ml-1.5 text-[9px] py-0">reconstructed</Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.route_band || '—'}</td>
                      <td className="px-3 py-1.5 font-mono">{r.provider}/{r.model}</td>
                      <td className="px-3 py-1.5">
                        {r.chain_position > 0 && (
                          <Badge variant="outline" className="text-[9px] py-0 mr-1 text-amber-600 dark:text-amber-500 border-amber-500/40">
                            fallback +{r.chain_position}
                          </Badge>
                        )}
                        {r.offloaded_from && (
                          <Badge variant="outline" className="text-[9px] py-0 mr-1">offloaded from {r.offloaded_from}</Badge>
                        )}
                        {r.chain_position === 0 && !r.offloaded_from && (
                          <span className="text-muted-foreground">as routed</span>
                        )}
                        {expanded === id && trail && (
                          <div className="mt-1.5 space-y-1 font-mono text-[10px] border-l-2 border-muted pl-2">
                            {(trail.attempts ?? []).map((a: any, j: number) => (
                              <div key={j} className="text-amber-600 dark:text-amber-500">
                                tried {a.provider}/{a.model} → {a.error} ({a.ms}ms)
                              </div>
                            ))}
                            {(trail.skipped ?? []).map((s: any, j: number) => (
                              <div key={j} className="text-muted-foreground">
                                skipped {s.provider} — {s.reason} [{s.kind}]
                              </div>
                            ))}
                            {trail.offloadSkipped && (
                              <div className="text-muted-foreground">offload declined — {trail.offloadSkipped}</div>
                            )}
                          </div>
                        )}
                      </td>
                      {/* Consumption, cache included — a per-call figure of
                          ~800 for a turn that sent ~470K is not the number a
                          reader scanning this column is looking for. */}
                      <td
                        className="px-3 py-1.5 text-right tabular-nums"
                        title={r.cache_read_tokens
                          ? `${fmt(r.total_tokens)} fresh + ${fmt((r.cache_read_tokens || 0) + (r.cache_write_tokens || 0))} prompt cache`
                          : undefined}
                      >{fmt(r.total_tokens + (r.cache_read_tokens || 0) + (r.cache_write_tokens || 0))}</td>
                    </tr>
                  )
                })}
                {recent.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No calls with a recorded decision yet.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}

/**
 * The By-turn body: one row per turn, expanding to the calls that made it up.
 *
 * ── What this view is for ───────────────────────────────────────────────────
 * A turn is not a call. Asking pi "what is this repo about?" produced two calls
 * six seconds apart, on two different providers, and the flat tail shows them
 * as two unrelated decisions between other processes' rows. The question people
 * actually ask — "why did half of my question run on the local box?" — is a
 * question about the turn, and could not be asked of this tab at all.
 *
 * ── Why the unrecorded bucket is rendered so differently ────────────────────
 * Rows written before the proxy recorded turn identity have no turn, and there
 * is no honest way to invent one — two calls sharing a preview may be one turn
 * or two identical prompts an hour apart, and nothing on a legacy row tells
 * them apart. They are shown as a labelled bucket, collapsed, and explicitly
 * not called a turn — the same rule the rest of this tab follows for
 * reconstructed data.
 */
function TurnRows({ turns, open, onToggle }: {
  turns: Turn[]
  open: string | null
  onToggle: (id: string) => void
}) {
  if (turns.length === 0) {
    return (
      <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
        No calls with a recorded decision yet.
      </td></tr>
    )
  }
  return (
    <>
      {turns.map(turn => {
        const isOpen = open === turn.id
        return (
          <Fragment key={turn.id || 'unrecorded'}>
            <tr
              onClick={() => onToggle(turn.id)}
              className="border-b cursor-pointer hover:bg-muted/40 align-top"
            >
              <td className="px-3 py-1.5 font-mono text-muted-foreground whitespace-nowrap">
                <span className="inline-block w-3">{isOpen ? '▾' : '▸'}</span>{' '}
                {turn.recorded ? localClock(turn.startedAt) : '—'}
              </td>
              <td className="px-3 py-1.5 font-mono">
                {turn.recorded
                  ? (turn.routeKey || <span className="text-muted-foreground">mixed</span>)
                  : <span className="text-muted-foreground">no turn recorded</span>}
                {turn.recorded && (
                  <span className="text-muted-foreground"> · turn {turn.turnIndex}</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground" colSpan={2}>
                {turn.recorded
                  ? <span className="italic">{turn.prompt || '(no prompt recorded)'}</span>
                  : 'background services and rows written before turn identity was recorded — shown ungrouped, not guessed at'}
              </td>
              <td className="px-3 py-1.5">
                <span className="text-muted-foreground">
                  {turn.calls.length} call{turn.calls.length === 1 ? '' : 's'}
                </span>
                {turn.recorded && turn.servedBy.map(sb => (
                  <Badge key={sb.provider} variant="outline" className="ml-1 text-[9px] py-0">
                    {sb.provider} ×{sb.calls}
                  </Badge>
                ))}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(turn.totalTokens)}</td>
            </tr>

            {isOpen && turn.calls.map((c, i) => {
              const why = describeBandSource(c)
              const trail = c.attempt_trail ? safeParse(c.attempt_trail) : null
              return (
                <tr key={`${turn.id}-${c.timestamp}-${i}`} className="border-b bg-muted/20 align-top">
                  <td className="px-3 py-1 pl-8 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    #{i + 1} {localClock(c.timestamp)}
                  </td>
                  <td className="px-3 py-1 font-mono text-[11px]">{c.route_key || '—'}</td>
                  {/* Band AND who decided it. The band alone is what made this
                      whole thing unanswerable: `small` and `medium` on two calls
                      of one turn look like a measurement of the work, when in
                      fact the caller declared `medium` both times and only the
                      first was eligible for the classifier to look at. */}
                  <td className="px-3 py-1 font-mono text-[11px]">
                    {c.route_band || '—'}
                    {why && <span className="block text-[10px] text-muted-foreground">{why}</span>}
                  </td>
                  <td className="px-3 py-1 font-mono text-[11px]">{c.provider}/{c.model}</td>
                  <td className="px-3 py-1 text-[11px]">
                    {c.offloaded_from
                      ? <Badge variant="outline" className="text-[9px] py-0 text-emerald-600 dark:text-emerald-400 border-emerald-500/40">
                          offloaded from {c.offloaded_from}
                        </Badge>
                      : trail?.offloadSkipped
                        ? <span className="text-muted-foreground">✗ {trail.offloadSkipped}</span>
                        : <span className="text-muted-foreground">as routed</span>}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums text-[11px]">
                    {fmt(c.total_tokens + (c.cache_read_tokens || 0) + (c.cache_write_tokens || 0))}
                  </td>
                </tr>
              )
            })}
          </Fragment>
        )
      })}
    </>
  )
}

/** Tolerant parse — one malformed trail must not blank the whole table. */
function safeParse(raw: string): any | null {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

function Stat({ label, value, sub, tone }: {
  label: string
  value: string
  sub?: string
  tone?: 'ok' | 'warn' | 'muted'
}) {
  const valueClass = tone === 'warn'
    ? 'text-amber-600 dark:text-amber-500'
    : tone === 'muted' ? 'text-muted-foreground' : ''
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}
