import { useEffect, useState, useMemo, useCallback } from 'react'
import { RefreshCw, ArrowDown, Info } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FlowTab } from './token-usage-flow-tab'

/**
 * LLM Routing settings — the front end for rapid-llm-proxy's two config files:
 *
 *   config/llm-routing.yaml    which provider and model serves a piece of work
 *   config/llm-fallback.yaml   what happens when that provider cannot
 *
 * This dialog used to edit `processOverrides` in the proxy's runtime JSON, and
 * described the behaviour as "auto-route logic — Claude Max for Claude Code
 * sessions, Copilot for OpenCode/corporate sessions, falling back to Groq →
 * OpenAI → Anthropic". That sentence described a hardcoded ternary in
 * server.mjs which no longer exists, and which in any case silently overruled
 * the pins this dialog set. There is no auto-route any more: every decision
 * comes from the two files, and this UI edits them directly.
 *
 * Edits are sent as a PATCH of changed fields, not a whole-document rewrite,
 * because those files are mostly explanatory prose and a JSON round-trip would
 * delete every comment on the first Save.
 */

// ── Server shapes (proxy GET /api/llm/routing) ───────────────────────────────

interface ProviderInfo {
  id: string
  account: string
  description: string
  enabled: boolean
  tools: boolean
  fgCapable: boolean
  /** Everything this account can serve. The band table is a choice out of it. */
  availableModels?: string[]
  models: Partial<Record<'small' | 'medium' | 'high', string>>
}

interface RouteEntry {
  provider: string
  complexity: string
}

interface FallbackCandidate {
  provider: string
  when: { network?: string[] } | null
}

/**
 * The offload policy. When enabled, work whose resolved band is in offloadBands
 * is served by a local endpoint instead of the provider its route names — so it
 * silently changes which provider answers a large share of calls, which is
 * exactly why it needs to be visible and switchable here rather than only in
 * the YAML.
 *
 * `targets` is a LIST because "the local model" is not one machine: the on-prem
 * cluster answers only on the corporate network, the laptop server only off it.
 * Ordered, first ENABLED network match wins, an entry with no requireNetwork
 * matches everywhere.
 *
 * Each target carries its own `enabled`, defaulting to off in the loader. That
 * is the switch this dialog exists to offer: an unmetered endpoint is not
 * therefore a cheap one, and the cost it does carry — latency — is invisible to
 * the reachability probe that gates it. The laptop target ships off for exactly
 * that reason and is turned on per session, here.
 */
interface SemanticRouting {
  enabled: boolean
  /**
   * `scope` — which KIND of work this target may serve (`fg`, `bg`, or both).
   * Declared in the type so the draft carries it through a save: the PATCH's
   * reorder path rebuilds each entry from what it is sent, and a field missing
   * from the body would be replaced by the loader's default (both). Optional,
   * because a proxy that predates the field sends none.
   */
  targets: Array<{ provider: string; requireNetwork: string | null; enabled: boolean; scope?: string[] }>
  offloadBands: string[]
}

interface RoutingData {
  paths: { routing: string; fallback: string }
  providers: ProviderInfo[]
  routes: Record<string, RouteEntry>
  defaults: Record<string, RouteEntry>
  semanticRouting: SemanticRouting
  fallback: {
    chains: Record<string, FallbackCandidate[]>
    retryOn: string[]
    sameProviderRetries: number
    enforceCapabilities: boolean
  }
  runtime: { network: string; availableImpls: string[]; allImpls: string[] }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  proxyBase: string
  /** Traffic window the Flow tab weights its edges by. Mirrors the page selector. */
  hours: number
}

const BANDS = ['small', 'medium', 'high'] as const
const FROM_CALLER = 'from-caller'
const RETRY_CLASSES = ['quota_exhausted', 'provider_unavailable', 'network_error', 'gateway_5xx']

/** Resolve the model a (provider, band) pair produces — mirrors resolveRoute(). */
function modelFor(providers: ProviderInfo[], providerId: string, band: string): string {
  const p = providers.find(x => x.id === providerId)
  if (!p) return '—'
  if (band === FROM_CALLER) return 'per call'
  return p.models[band as 'small' | 'medium' | 'high']
    || BANDS.map(b => p.models[b]).find(Boolean)
    || '—'
}

export function TokenUsageSettingsDialog({ open, onOpenChange, proxyBase, hours }: Props) {
  const [data, setData] = useState<RoutingData | null>(null)
  const [tab, setTab] = useState<'routing' | 'fallback' | 'flow'>('routing')
  const [routeDraft, setRouteDraft] = useState<Record<string, RouteEntry>>({})
  const [defaultDraft, setDefaultDraft] = useState<Record<string, RouteEntry>>({})
  const [fallbackDraft, setFallbackDraft] = useState<RoutingData['fallback'] | null>(null)
  const [semanticDraft, setSemanticDraft] = useState<SemanticRouting | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`${proxyBase}/api/llm/routing`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<RoutingData>
      })
      .then(d => {
        setData(d)
        setRouteDraft({ ...d.routes })
        setDefaultDraft({ ...d.defaults })
        setFallbackDraft(JSON.parse(JSON.stringify(d.fallback)))
        // Tolerate a proxy that predates the semanticRouting field rather than
        // rendering an empty panel from `undefined`. A target from a proxy that
        // predates per-target `enabled` normalises to OFF, matching the loader's
        // default: showing an unknown state as on is the direction that costs
        // latency, and one that is wrongly off is one visible click from right.
        setSemanticDraft(d.semanticRouting
          ? {
            ...d.semanticRouting,
            targets: (d.semanticRouting.targets ?? []).map(t => ({ ...t, enabled: t.enabled === true })),
          }
          : { enabled: false, targets: [], offloadBands: [] })
      })
      .catch(e => setError(`Failed to load routing config: ${e.message}`))
      .finally(() => setLoading(false))
  }, [proxyBase])

  useEffect(() => { if (open) load() }, [open, load])

  const setRoute = (key: string, patch: Partial<RouteEntry>) =>
    setRouteDraft(d => ({ ...d, [key]: { ...d[key], ...patch } }))

  const setDefault = (cls: string, patch: Partial<RouteEntry>) =>
    setDefaultDraft(d => ({ ...d, [cls]: { ...d[cls], ...patch } }))

  // Only send what actually changed — a PATCH of the whole table would rewrite
  // (and so reflow) nodes the operator never touched.
  const changedRoutes = useMemo(() => {
    if (!data) return {}
    const out: Record<string, RouteEntry> = {}
    for (const [k, v] of Object.entries(routeDraft)) {
      const orig = data.routes[k]
      if (!orig || orig.provider !== v.provider || orig.complexity !== v.complexity) out[k] = v
    }
    return out
  }, [data, routeDraft])

  const changedDefaults = useMemo(() => {
    if (!data) return {}
    const out: Record<string, RouteEntry> = {}
    for (const [k, v] of Object.entries(defaultDraft)) {
      const orig = data.defaults[k]
      if (!orig || orig.provider !== v.provider || orig.complexity !== v.complexity) out[k] = v
    }
    return out
  }, [data, defaultDraft])

  const fallbackChanged = useMemo(
    () => !!data && !!fallbackDraft && JSON.stringify(data.fallback) !== JSON.stringify(fallbackDraft),
    [data, fallbackDraft],
  )

  const semanticChanged = useMemo(
    () => !!data && !!semanticDraft
      && JSON.stringify(data.semanticRouting ?? null) !== JSON.stringify(semanticDraft),
    [data, semanticDraft],
  )

  // The target that would actually serve this machine, under the DRAFT policy.
  // Same first-match rule the proxy applies (pickOffloadTarget in
  // routing-config.mjs): an entry with no requireNetwork matches every network.
  // Editing the policy without seeing which target is live is how "offload is
  // enabled" gets read as "offload can fire here" — off-VPN, with only a
  // corporate target declared, those are different statements.
  const activeTarget = useMemo(
    () => (data && semanticDraft?.enabled
      ? (semanticDraft.targets.find(t => t.enabled !== false
          && (!t.requireNetwork || t.requireNetwork === data.runtime.network)) ?? null)
      : null),
    [data, semanticDraft],
  )

  const dirty = Object.keys(changedRoutes).length > 0
    || Object.keys(changedDefaults).length > 0
    || fallbackChanged
    || semanticChanged

  const save = async () => {
    if (!data || !fallbackDraft) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${proxyBase}/api/llm/routing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(Object.keys(changedRoutes).length ? { routes: changedRoutes } : {}),
          ...(Object.keys(changedDefaults).length ? { defaults: changedDefaults } : {}),
          ...(fallbackChanged ? { fallback: fallbackDraft } : {}),
          ...(semanticChanged ? { semanticRouting: semanticDraft } : {}),
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        // The proxy validates before writing, so a rejection means nothing on
        // disk changed. Show its message verbatim — it names the offending key.
        throw new Error(errBody.error || `HTTP ${res.status}`)
      }
      onOpenChange(false)
    } catch (e: any) {
      setError(`Rejected — nothing was written. ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const providers = data?.providers ?? []
  const routable = providers.filter(p => p.enabled)

  /** One editable route row, shared by the foreground, background and defaults tables. */
  const renderRouteRow = (
    key: string,
    entry: RouteEntry,
    onChange: (patch: Partial<RouteEntry>) => void,
    opts: { allowFromCaller?: boolean; note?: string } = {},
  ) => {
    const changed = !!changedRoutes[key] || !!changedDefaults[key]
    const provider = providers.find(p => p.id === entry.provider)
    return (
      <tr key={key} className={`border-b last:border-b-0 ${changed ? 'bg-amber-500/10' : ''}`}>
        <td className="px-3 py-2 font-mono text-xs align-middle">
          {key}
          {opts.note && (
            <span className="block text-[10px] text-muted-foreground font-sans italic">{opts.note}</span>
          )}
        </td>
        <td className="px-2 py-1">
          <Select value={entry.provider} onValueChange={v => onChange({ provider: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {routable.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.id}{p.tools ? '' : ' · no tools'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className="px-2 py-1">
          <Select value={entry.complexity} onValueChange={v => onChange({ complexity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BANDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              {opts.allowFromCaller && (
                <SelectItem value={FROM_CALLER}>from-caller</SelectItem>
              )}
            </SelectContent>
          </Select>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground align-middle">
          {/* provider/model — the naming used everywhere: logs, telemetry, docs */}
          {entry.provider}/{modelFor(providers, entry.provider, entry.complexity)}
          {provider && !provider.enabled && (
            <span className="ml-1 text-destructive">(disabled)</span>
          )}
        </td>
      </tr>
    )
  }

  const fgKeys = Object.keys(routeDraft).filter(k => k.startsWith('fg-')).sort()
  const bgKeys = Object.keys(routeDraft).filter(k => !k.startsWith('fg-')).sort()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wide enough that the Flow tab's 1030-unit canvas fits without a
          horizontal scrollbar; the two table tabs simply get more air. */}
      <DialogContent className="max-w-6xl flex flex-col max-h-[88vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>LLM Routing</DialogTitle>
          <DialogDescription>
            Every LLM call from coding — your conversation with a coding agent, and every background
            cognitive service — is routed by two config files. A route picks the <em>provider</em>
            {' '}(the account that gets billed); the <em>complexity</em> band picks the model from that
            provider's own table, so a fallback always lands on a model that provider actually serves.
            {data && (
              <span className="block mt-1 font-mono text-[10px] opacity-70">{data.paths.routing}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {!loading && data && (
          <div className="flex items-center gap-2 flex-shrink-0 border-b -mx-6 px-6 pb-2">
            <Button
              size="sm"
              variant={tab === 'routing' ? 'default' : 'ghost'}
              onClick={() => setTab('routing')}
            >Routing</Button>
            <Button
              size="sm"
              variant={tab === 'fallback' ? 'default' : 'ghost'}
              onClick={() => setTab('fallback')}
            >Fallback</Button>
            <Button
              size="sm"
              variant={tab === 'flow' ? 'default' : 'ghost'}
              onClick={() => setTab('flow')}
            >Flow</Button>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              network: <Badge variant="outline">{data.runtime.network}</Badge>
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 pt-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2 mb-3">
              {error}
            </div>
          )}

          {!loading && data && tab === 'routing' && (
            <div className="space-y-4">
              {/* Provider catalogue. Availability is a RUNTIME fact and is shown
                  separately from the config — a provider being logged out is not
                  a routing decision. */}
              <div className="flex items-start gap-2 text-xs text-muted-foreground flex-wrap">
                <span className="pt-0.5">Providers:</span>
                {providers.map(p => {
                  const reachable = data.runtime.availableImpls.some(i => modelImplMatches(p, i))
                  return (
                    <Badge
                      key={p.id}
                      variant={p.enabled && reachable ? 'default' : 'outline'}
                      className={p.enabled ? '' : 'opacity-50'}
                      title={`${p.account}${p.description ? ' — ' + p.description : ''}`}
                    >
                      {p.id}
                      {!p.enabled && ' (disabled)'}
                      {p.enabled && !reachable && ' (unreachable)'}
                    </Badge>
                  )
                })}
              </div>

              {/* Semantic offload. Placed ABOVE the route tables because it
                  overrides them: when it is on, the provider column below is not
                  what answers a small-band call. Reading the tables without
                  knowing this switch's state gives you the wrong answer. */}
              {semanticDraft && (
                <div className={`rounded border px-3 py-2.5 space-y-2 ${semanticChanged ? 'bg-amber-500/10 border-amber-500/40' : 'bg-muted/30'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={semanticDraft.enabled}
                        onChange={e => setSemanticDraft(s => s && ({ ...s, enabled: e.target.checked }))}
                      />
                      Semantic offload
                    </label>
                    {/* Per-target on/off. The badges these replace were
                        read-only, which made a target's mere presence the thing
                        that decided whether work went to it — and adding one was
                        then enough to start serving from it. Each target now
                        needs saying yes to, and says so on the wire. */}
                    {semanticDraft.targets.map((tgt, idx) => {
                      const serves = !tgt.requireNetwork || tgt.requireNetwork === data.runtime.network
                      const on = tgt.enabled !== false
                      return (
                        <label
                          key={tgt.provider}
                          className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-mono cursor-pointer ${
                            on && serves
                              ? 'border-primary/50 bg-primary/10'
                              : 'border-border bg-transparent text-muted-foreground'
                          }`}
                          title={[
                            on ? 'Switched on: work in the selected bands can go here.'
                               : 'Switched off: declared, but nothing is sent to it.',
                            serves
                              ? `The live network sensor reads ${data.runtime.network}, which this target serves.`
                              : `Only on the ${tgt.requireNetwork} network; the sensor currently reads ${data.runtime.network}.`,
                            // Scope decides what switching this ON actually
                            // turns on, so it belongs in the same tooltip as the
                            // switch rather than somewhere the operator has to
                            // go and look for it.
                            tgt.scope && tgt.scope.length === 1
                              ? tgt.scope[0] === 'fg'
                                ? 'Foreground only: interactive turns can go here, background services cannot.'
                                : 'Background only: services can go here, interactive turns cannot.'
                              : 'Serves both foreground turns and background services.',
                          ].join(' ')}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={on}
                            disabled={!semanticDraft.enabled}
                            onChange={e => setSemanticDraft(sd => sd && ({
                              ...sd,
                              targets: sd.targets.map((t, i) => (
                                i === idx ? { ...t, enabled: e.target.checked } : t)),
                            }))}
                          />
                          → {tgt.provider} ({tgt.requireNetwork || 'any'}
                          {tgt.scope && tgt.scope.length === 1 ? `, ${tgt.scope[0]} only` : ''})
                          {on && serves && ' ← live'}
                        </label>
                      )
                    })}
                    {semanticDraft.enabled && !activeTarget && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-500">
                        {semanticDraft.targets.some(t => !t.requireNetwork || t.requireNetwork === data.runtime.network)
                          ? `the ${data.runtime.network} target is switched off — nothing offloads here`
                          : `no target for ${data.runtime.network} — nothing offloads here`}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Serves work in the selected bands from{' '}
                    <span className="font-mono">{activeTarget?.provider || 'a local endpoint'}</span>{' '}
                    instead of the provider each route names below, inserting that route's own
                    provider as the first fallback. Targets are network-scoped and tried in order —
                    the on-prem cluster answers only on corporate, the laptop server only off it —
                    so which one is live depends on where this machine is, and on which of them you
                    have switched on above. Each target is off until you say otherwise: an unmetered
                    endpoint still costs latency, and these bands carry the highest-volume
                    background services, not just interactive turns. Routes marked{' '}
                    <span className="font-mono">offload: false</span>{' '}
                    — where the model that answers <em>is</em> the measurement — never move.
                  </p>
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span className="text-muted-foreground">Bands:</span>
                    {BANDS.map(b => (
                      <label key={b} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={semanticDraft.offloadBands.includes(b)}
                          disabled={!semanticDraft.enabled}
                          onChange={e => setSemanticDraft(s => s && ({
                            ...s,
                            offloadBands: e.target.checked
                              ? [...s.offloadBands, b]
                              // Keep the file's own order rather than click order,
                              // so toggling a band twice is a no-op in the diff.
                              : s.offloadBands.filter(x => x !== b),
                          }))}
                        />
                        <span className={semanticDraft.enabled ? 'font-mono' : 'font-mono opacity-50'}>{b}</span>
                        <span className="text-muted-foreground">
                          {/* The model the LIVE target would serve for this band.
                              Naming a band's model from a target that cannot be
                              reached from here would describe a call that cannot
                              happen. */}
                          ({modelFor(providers, activeTarget?.provider || '', b)})
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <RouteTable
                title="Foreground — your conversation with a coding agent"
                head={['Route (job/agent)', 'Provider', 'Complexity', 'Resolves to']}
              >
                {fgKeys.map(k => renderRouteRow(
                  k,
                  routeDraft[k],
                  patch => setRoute(k, patch),
                  {
                    allowFromCaller: true,
                    note: k === 'fg-chat/claude'
                      ? 'Claude Code speaks the Anthropic wire protocol — only a provider with fg_transport can serve it; anything else is refused with 501.'
                      : k === 'fg-chat/opencode'
                        ? 'from-caller: opencode picks its own band per call (sonnet for the loop, haiku for titles).'
                        : undefined,
                  },
                ))}
              </RouteTable>

              <RouteTable
                title="Background — cognitive services"
                head={['Route (job)', 'Provider', 'Complexity', 'Resolves to']}
              >
                {bgKeys.map(k => renderRouteRow(k, routeDraft[k], patch => setRoute(k, patch)))}
              </RouteTable>

              <RouteTable
                title="Defaults — anything not named above"
                head={['Class', 'Provider', 'Complexity', 'Resolves to']}
              >
                {Object.keys(defaultDraft).sort().map(cls => renderRouteRow(
                  cls,
                  defaultDraft[cls],
                  patch => setDefault(cls, patch),
                ))}
              </RouteTable>
            </div>
          )}

          {/* The Flow tab reads the DRAFTS, not the saved payload, so the graph
              is a live preview of an unsaved edit — change a provider on the
              Routing tab and the edge moves before you press Save. */}
          {!loading && data && fallbackDraft && tab === 'flow' && (
            <FlowTab
              proxyBase={proxyBase}
              hours={hours}
              data={{
                providers: data.providers,
                routes: routeDraft,
                defaults: defaultDraft,
                fallback: { chains: fallbackDraft.chains },
                runtime: data.runtime,
              }}
            />
          )}

          {!loading && data && fallbackDraft && tab === 'fallback' && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                When a routed provider cannot serve a call, these chains say where it goes next — in
                order, top to bottom. A candidate with a guard is skipped when the guard does not hold;
                that is not an error and the chain continues. Chains are flat: falling back from A to B
                does not then consult B's own chain.
              </p>

              {Object.entries(fallbackDraft.chains).map(([head, list]) => (
                <div key={head} className="border rounded-md overflow-hidden">
                  <div className="bg-muted/40 px-3 py-1.5 text-xs font-mono border-b">
                    {head}
                    <span className="text-muted-foreground font-sans"> — when this fails, try:</span>
                  </div>
                  <div className="divide-y">
                    {list.map((c, i) => (
                      <div key={`${head}-${i}`} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <ArrowDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="font-mono">{c.provider}</span>
                        {c.when?.network && (
                          <Badge variant="outline" className="text-[10px]">
                            only on {c.when.network.join(' / ')}
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-6 text-[11px]"
                          onClick={() => setFallbackDraft(f => f && ({
                            ...f,
                            chains: { ...f.chains, [head]: f.chains[head].filter((_, j) => j !== i) },
                          }))}
                        >remove</Button>
                      </div>
                    ))}
                    {list.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground italic">
                        no fallback — a failure here surfaces to the caller
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div className="border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-medium w-52">Same-provider retries</span>
                  <Select
                    value={String(fallbackDraft.sameProviderRetries)}
                    onValueChange={v => setFallbackDraft(f => f && ({ ...f, sameProviderRetries: Number(v) }))}
                  >
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">
                    a fresh connection usually fixes a transient network error, and is far cheaper than
                    advancing to a slower provider
                  </span>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <span className="font-medium w-52 pt-1">Advance the chain on</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {RETRY_CLASSES.map(cls => {
                      const on = fallbackDraft.retryOn.includes(cls)
                      return (
                        <Badge
                          key={cls}
                          variant={on ? 'default' : 'outline'}
                          className={`cursor-pointer ${on ? '' : 'opacity-50'}`}
                          onClick={() => setFallbackDraft(f => f && ({
                            ...f,
                            retryOn: on ? f.retryOn.filter(x => x !== cls) : [...f.retryOn, cls],
                          }))}
                        >{cls}</Badge>
                      )
                    })}
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <span className="font-medium w-52 pt-1">Enforce tool capability</span>
                  <Badge
                    variant={fallbackDraft.enforceCapabilities ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setFallbackDraft(f => f && ({ ...f, enforceCapabilities: !f.enforceCapabilities }))}
                  >{fallbackDraft.enforceCapabilities ? 'on' : 'off'}</Badge>
                  <span className="text-muted-foreground">
                    a request carrying tools[] may only land on a tools-capable provider. Keep this on —
                    silently stripping tools returns prose where the agent expected a tool call. Note this
                    is also what made one exhausted quota stop every agent back when only a single
                    provider was capable; the fix is a second capable provider, not turning this off.
                  </span>
                </div>
              </div>

              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                Editing a chain rewrites that list, so any inline notes inside it are not preserved.
                Comments elsewhere in the file — including on other chains — are kept.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 sm:justify-between items-center">
          <span className="text-xs text-muted-foreground">
            {dirty
              ? `${Object.keys(changedRoutes).length + Object.keys(changedDefaults).length} route change(s)${fallbackChanged ? ' + fallback' : ''} — validated before anything is written`
              : 'No changes'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || loading || !data || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A provider's runtime reachability is reported by its impl name, not its id. */
function modelImplMatches(p: ProviderInfo, impl: string): boolean {
  // The server reports availability keyed by impl (copilot, claude-code, …);
  // the catalogue is keyed by account id (gh-copilot, claude-code-max, …).
  // A provider with no impl is declared-but-not-implemented and never reachable.
  const IMPL_OF: Record<string, string> = {
    'claude-code-max': 'claude-code',
    'gh-copilot': 'copilot',
    'anthropic-api': 'anthropic',
    groq: 'groq',
    openai: 'openai',
  }
  return IMPL_OF[p.id] === impl
}

function RouteTable(
  { title, head, children }: { title: string; head: string[]; children: React.ReactNode },
) {
  return (
    <div className="border rounded-md overflow-hidden">
      <div className="bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b">
        {title}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/20 border-b">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium">{head[0]}</th>
            <th className="text-left px-3 py-1.5 font-medium w-[190px]">{head[1]}</th>
            <th className="text-left px-3 py-1.5 font-medium w-[150px]">{head[2]}</th>
            <th className="text-left px-3 py-1.5 font-medium w-[240px]">{head[3]}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
