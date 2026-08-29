import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { normalizeProvider } from '@/lib/providers'
import { FlowTab } from './token-usage-flow-tab'

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
 * ── Read-only on purpose ─────────────────────────────────────────────────────
 * Editing stays in the Settings dialog. This is where you find out what the
 * system is doing; that is where you change it. Mixing the two is how you end
 * up reading a number and a draft edit off the same screen and not knowing
 * which one is live.
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
  providers: Array<{ id: string; account: string; enabled: boolean; tools: boolean }>
  routes: Record<string, { provider: string; complexity: string }>
  defaults: Record<string, { provider: string; complexity: string }>
  semanticRouting: {
    enabled: boolean
    /**
     * Ordered; the first ENABLED entry whose requireNetwork matches the live
     * network serves the offload. A target defaults to disabled — declaring one
     * says where an offload could go, `enabled` says send work there.
     */
    targets: Array<{ provider: string; requireNetwork: string | null; enabled: boolean }>
    offloadBands: string[]
  } | null
  fallback: { chains: Record<string, Array<{ provider: string; when: unknown }>> }
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
  route_key: string
  route_band: string
  route_step: number
  offloaded_from: string
  chain_position: number
  attempt_trail: string
  routing_source: string
}

interface Props {
  proxyBase: string
  /** Traffic window; mirrors the page selector so every number shares one span. */
  hours: string
}

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

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      fetch(`${proxyBase}/api/llm/routing/behaviour?hours=${encodeURIComponent(hours)}`).then(r => r.json()),
      fetch(`${proxyBase}/api/llm/routing`).then(r => r.json()),
      fetch(`${proxyBase}/api/token-usage/recent?limit=200`).then(r => r.json()),
    ])
      .then(([b, c, rec]) => {
        if (cancelled) return
        if (b.error) throw new Error(b.error)
        setBehaviour(b)
        setConfig(c)
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
      })
      .catch(e => { if (!cancelled) setError(String(e.message || e)) })
    return () => { cancelled = true }
  }, [proxyBase, hours])

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
        return {
          key,
          declared: declared ?? '—',
          total,
          offPlan,
          rows: rows.sort((a, b) => b.calls - a.calls),
          tokens: rows.reduce((s, r) => s + r.tokens, 0),
          fallbacks: rows.reduce((s, r) => s + r.fallback_calls, 0),
          offloaded: rows.reduce((s, r) => s + r.offloaded_calls, 0),
          reconstructed: rows.reduce((s, r) => s + r.reconstructed_calls, 0),
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
  }, [behaviour, config])

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
                      {tgt.requireNetwork ? ` (${tgt.requireNetwork})` : ' (any network)'}
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

      {/* ── The config as a picture ──
          Sits directly under the Configured summary, so the shape of the routing
          is the first thing you see and everything below it is observed data.
          Same component the Settings dialog uses, so the diagram cannot drift
          between the two places it appears. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Configured flow</CardTitle>
        </CardHeader>
        <CardContent>
          <FlowTab data={config as any} proxyBase={proxyBase} hours={Number(hours) || 24} />
        </CardContent>
      </Card>

      {/* ── Observed per route ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Observed — what each route actually did
            <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
              “Declared” is the provider the config names. A route with traffic on any other
              provider took a fallback or an offload — recorded, not inferred.
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
                  <th className="text-right px-3 py-1.5 font-medium">Fallback</th>
                  <th className="text-right px-3 py-1.5 font-medium">Offload</th>
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
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.fallbacks ? <span className="text-amber-600 dark:text-amber-500">{fmt(r.fallbacks)}</span> : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.offloaded ? fmt(r.offloaded) : '—'}</td>
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
          <CardTitle className="text-sm">
            Recent decisions
            <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
              One row per call. Click a row that took a fallback or skipped a candidate to see the trail.
            </span>
          </CardTitle>
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
                {recent.map((r, i) => {
                  const id = `${r.timestamp}-${i}`
                  const trail = r.attempt_trail ? safeParse(r.attempt_trail) : null
                  const clickable = !!trail
                  return (
                    <tr
                      key={id}
                      onClick={() => clickable && setExpanded(expanded === id ? null : id)}
                      className={`border-b last:border-b-0 align-top ${clickable ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                    >
                      <td className="px-3 py-1.5 font-mono text-muted-foreground whitespace-nowrap">
                        {r.timestamp.slice(11, 19)}
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
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.total_tokens)}</td>
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
