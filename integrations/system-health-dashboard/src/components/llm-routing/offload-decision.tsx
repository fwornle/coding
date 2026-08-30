/**
 * "Does the offload move this call?" — the whole answer, in one card.
 *
 * ── The two modes are the point ─────────────────────────────────────────────
 * Configuration counts ROUTES and answers "what will happen"; Recorded counts
 * CALLS and answers "what did". Same ladder, same geometry, same rung order, so
 * flicking between them diffs intent against behaviour without re-reading a
 * layout. That is the entire value, which is why this is one component with a
 * toggle and not two cards.
 *
 * ── The mirror is checked against the proxy, not trusted ────────────────────
 * `offload-gates.ts` restates the proxy's offload block, and a restatement drifts.
 * So whenever the policy on screen is the SAVED one, every route is also resolved
 * by the proxy itself and the two answers are compared. A disagreement renders as
 * a destructive banner naming the route and both verdicts. The contract test
 * (`tests/agents/offload-gates-contract.test.mjs`) makes the same comparison in
 * CI; this makes it in front of the person who would be misled.
 *
 * Under an unsaved edit there is nothing to compare against — the proxy cannot
 * resolve a policy it has not been given — so the card says so instead of going
 * quiet.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  GATES, RUNG_OFFLOADED, describeTargets, evaluateOffload, jobClassOf, rungOfReason,
} from './offload-gates'
import type { RouteEntry } from './offload-gates'
import { DecisionLadder, ladderHeight } from './decision-ladder'
import type { LadderRung } from './decision-ladder'
import { OffloadHeadline } from './offload-headline'
import { useOffloadPolicyDraft } from './use-offload-policy-draft'
import { CallStrip, stripRows } from './call-strip'
import type { StripFilter } from './call-strip'
import { CallDetail } from './call-detail'
import { rungOfCall } from './recent-call'
import type { RecentCall } from './recent-call'
import { useIsDark } from '@/lib/colors'

const BANDS = ['small', 'medium', 'high'] as const
const LADDER_W = 640

export interface OffloadDecisionProps {
  proxyBase: string
  hours: string
  routes: Record<string, RouteEntry>
  defaults: Record<string, RouteEntry>
  providers: Array<{ id: string; fgCapable?: boolean }>
  /** `behaviour.offloadSkips` — the recorded reason strings and their counts. */
  offloadSkips: Array<{ reason: string; count: number }>
  offloadedCalls: number
  windowHours: number
  /** The raw `/api/token-usage/recent` tail, newest first. Recorded mode only. */
  recent: RecentCall[]
  /** Lets the page refetch its own halves once a save lands. */
  onSaved?: () => void
}

interface Resolved {
  band: string
  provider: string
  offloadSkipped: string | null
}

/**
 * The resolve query for a route key.
 *
 * `fg-chat/<agent>` is a two-part lookup on the wire (job + agent), and the two
 * `defaults.*` pseudo-routes are reached by asking a question no route matches —
 * which is the only way to make step 3 answer.
 */
function queryFor(key: string): string {
  if (key === 'defaults.fg-chat') return 'job=fg-chat'
  if (key === 'defaults.background') return 'job=bg-__unrouted__'
  const slash = key.indexOf('/')
  if (slash > 0) {
    return `job=${encodeURIComponent(key.slice(0, slash))}&agent=${encodeURIComponent(key.slice(slash + 1))}`
  }
  return `job=${encodeURIComponent(key)}`
}

/** Bounded-concurrency map — 39 local requests should not open 39 sockets. */
async function pooled<T, R>(items: T[], width: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }))
  return out
}

export function OffloadDecision({
  proxyBase, routes, defaults, providers, offloadSkips, offloadedCalls, windowHours,
  recent, onSaved,
}: OffloadDecisionProps) {
  const policy = useOffloadPolicyDraft(proxyBase, onSaved)
  const isDark = useIsDark()
  const [mode, setMode] = useState<'config' | 'recorded'>('config')
  const [stripFilter, setStripFilter] = useState<StripFilter>('interesting')
  const [routeFilter, setRouteFilter] = useState('all')
  const [selectedCall, setSelectedCall] = useState<number | null>(null)
  const [resolved, setResolved] = useState<Record<string, Resolved> | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [selectedRung, setSelectedRung] = useState<number | null>(null)

  const fgCapable = useMemo(() => {
    const set = new Set(providers.filter(p => p.fgCapable).map(p => p.id))
    return (id: string) => set.has(id)
  }, [providers])

  // Every route plus the two defaults, which are real destinations for anything
  // that matches no key and are therefore part of the same question.
  const entries = useMemo<Array<[string, RouteEntry]>>(() => ([
    ...Object.entries(routes),
    ...Object.entries(defaults).map(([cls, v]) => [`defaults.${cls}`, v] as [string, RouteEntry]),
  ]), [routes, defaults])

  // Memoised on config identity + network, deliberately NOT on the traffic
  // window: changing `hours` changes counts, never where a route resolves, and
  // refiring 39 requests for it would make the selector feel broken.
  const resolveKey = useMemo(
    () => JSON.stringify([entries.map(([k, v]) => [k, v.provider, v.complexity, v.offload]), policy.network]),
    [entries, policy.network],
  )
  const lastResolveKey = useRef<string>('')

  useEffect(() => {
    if (resolveKey === lastResolveKey.current) return
    lastResolveKey.current = resolveKey
    let cancelled = false
    setResolveError(null)
    pooled(entries, 8, async ([key]) => {
      const r = await fetch(`${proxyBase}/api/llm/routing/resolve?${queryFor(key)}&network=${encodeURIComponent(policy.network)}`)
      const d = await r.json()
      if (d.error) throw new Error(`${key}: ${d.error}`)
      return [key, {
        band: d.route?.complexity ?? '',
        provider: d.route?.provider ?? '',
        offloadSkipped: d.route?.offloadSkipped ?? null,
      }] as [string, Resolved]
    })
      .then(pairs => { if (!cancelled) setResolved(Object.fromEntries(pairs)) })
      .catch(e => { if (!cancelled) setResolveError(String(e?.message || e)) })
    return () => { cancelled = true }
  }, [resolveKey, entries, proxyBase, policy.network])

  /**
   * Where each route falls out under the policy on screen.
   *
   * The BAND comes from the proxy's own answer rather than from the route entry,
   * because `from-caller` routes have no band of their own and the proxy's
   * fallback to the class default is not something worth restating. Reusing it
   * under an edited policy is sound: editing `offload_bands` changes which bands
   * are ELIGIBLE, never which band a route resolves to.
   */
  const configRungs = useMemo(() => {
    if (!resolved || !policy.draft) return null
    const counts = new Array(GATES.length).fill(0)
    const members: string[][] = GATES.map(() => [])
    const disagreements: string[] = []

    for (const [key, entry] of entries) {
      const r = resolved[key]
      if (!r) continue
      const v = evaluateOffload(policy.draft, entry, key, r.band, policy.network, fgCapable)
      counts[v.rung]++
      members[v.rung].push(key)

      // Only meaningful against the saved policy — the proxy resolved that one.
      if (!policy.dirty) {
        if (r.offloadSkipped) {
          const proxyRung = rungOfReason(r.offloadSkipped)
          if (proxyRung !== v.rung) {
            disagreements.push(`${key}: ladder says rung ${v.rung} (${GATES[v.rung].label}), proxy says "${r.offloadSkipped}"`)
          }
        } else if (v.provider !== r.provider) {
          disagreements.push(`${key}: ladder says ${v.provider}, proxy says ${r.provider}`)
        }
      }
    }
    return { counts, members, disagreements }
  }, [resolved, policy.draft, policy.dirty, policy.network, entries, fgCapable])

  /** Recorded: the proxy's own reason strings, bucketed by the rung that emitted them. */
  const recorded = useMemo(() => {
    const counts = new Array(GATES.length).fill(0)
    let unclassified = 0
    for (const s of offloadSkips) {
      const rung = rungOfReason(s.reason)
      if (rung === 'unclassified') unclassified += s.count
      else counts[rung] += s.count
    }
    counts[RUNG_OFFLOADED] = offloadedCalls
    return { counts, unclassified }
  }, [offloadSkips, offloadedCalls])

  const p = policy.draft
  const rungs: LadderRung[] = useMemo(() => {
    const counts = mode === 'config' ? (configRungs?.counts ?? new Array(GATES.length).fill(0)) : recorded.counts
    return GATES.map((_, i) => {
      const count = counts[i]
      let detail: string | undefined
      if (i === 0 && mode === 'recorded') {
        // Finding (b): the proxy records no reason when the route already names
        // the target. Printing 0 here would assert it never happens.
        detail = 'not recorded — the proxy stores no reason at this gate'
      } else if (i === 1 && mode === 'config' && configRungs) {
        detail = configRungs.members[1].length ? configRungs.members[1].join(', ') : 'offload: false'
      } else if (i === 2 && p) {
        detail = `offload_bands: ${p.offloadBands.join(', ') || 'none'}`
      } else if (i === 3 && p) {
        detail = describeTargets(p)
      } else if (i === RUNG_OFFLOADED && p) {
        // Config detail beside a RECORDED count would describe today's policy
        // against yesterday's traffic, and here the two actively contradict:
        // with the laptop target switched off this reads "no target to move it
        // to" next to the calls that already moved, back when it was on. So the
        // recorded unit gets a statement about the calls, not about the config.
        if (mode === 'recorded') {
          detail = count > 0 ? 'moved off the account their route named' : undefined
        } else {
          const t = p.targets.find(x => x.enabled && (!x.requireNetwork || x.requireNetwork === policy.network))
          detail = t ? `→ ${t.provider}` : 'no target to move it to'
        }
      }
      return { count, detail }
    })
  }, [mode, configRungs, recorded, p, policy.network])

  const callsByRung = recorded.counts

  // The rows the strip is showing, in its order, so an index from the slider
  // means the same row here as it does there.
  const shownCalls = useMemo(
    () => stripRows(recent, stripFilter, routeFilter),
    [recent, stripFilter, routeFilter],
  )
  const call = mode === 'recorded' && selectedCall != null ? shownCalls[selectedCall] ?? null : null
  // Null when the row carries no verdict — a backfilled row, or one written
  // before the decision was recorded. The ladder says so rather than lighting a
  // rung it would have to guess.
  const activeRung = call ? rungOfCall(call) : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          Decision — does the offload move it?
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant={mode === 'config' ? 'default' : 'ghost'} className="h-6 text-[11px] px-2"
              onClick={() => setMode('config')}>Configuration</Button>
            <Button size="sm" variant={mode === 'recorded' ? 'default' : 'ghost'} className="h-6 text-[11px] px-2"
              onClick={() => setMode('recorded')}>Recorded · last {windowHours}h</Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <OffloadHeadline
          policy={p}
          network={policy.network}
          callsByRung={callsByRung}
          windowHours={windowHours}
          preview={policy.dirty}
        />

        {policy.error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1">
            {policy.error}
          </div>
        )}
        {resolveError && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1">
            Could not resolve routes against the proxy: {resolveError}
          </div>
        )}

        {/* A drift between the mirror and the authority is the one thing this card
            must never render quietly — the whole ladder would be plausible and wrong. */}
        {!!configRungs?.disagreements.length && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1.5 space-y-0.5">
            <div className="font-medium">
              This diagram disagrees with the proxy on {configRungs.disagreements.length} route
              {configRungs.disagreements.length === 1 ? '' : 's'} — the proxy is right, and{' '}
              <span className="font-mono">offload-gates.ts</span> has drifted from it.
            </div>
            {configRungs.disagreements.slice(0, 5).map(d => (
              <div key={d} className="font-mono text-[10px]">{d}</div>
            ))}
          </div>
        )}

        <svg viewBox={`0 0 ${LADDER_W} ${ladderHeight()}`} width="100%"
          style={{ maxHeight: ladderHeight() }} role="img"
          aria-label="Offload decision gates, in the order the proxy evaluates them">
          <DecisionLadder
            x={0} y={0} width={LADDER_W}
            rungs={rungs}
            unit={mode === 'config' ? 'routes' : 'calls'}
            activeRung={activeRung}
            selectedRung={selectedRung}
            onSelectRung={setSelectedRung}
            unclassified={mode === 'recorded' ? { count: recorded.unclassified } : null}
          />
        </svg>

        {/* Which routes stopped where — full fidelity, on demand, off canvas. */}
        {mode === 'config' && selectedRung !== null && configRungs && (
          <div className="text-[11px] border-l-2 border-muted pl-2 space-y-0.5">
            <div className="text-muted-foreground">
              {GATES[selectedRung].label} — {configRungs.members[selectedRung].length} route
              {configRungs.members[selectedRung].length === 1 ? '' : 's'}
            </div>
            <div className="font-mono text-muted-foreground">
              {configRungs.members[selectedRung].join(', ') || '—'}
            </div>
          </div>
        )}

        {/* ── One call at a time ──
            Recorded only: in Configuration there is no history to scrub, and the
            ladder above is answering a question about routes rather than calls. */}
        {mode === 'recorded' && (
          <div className="border-t pt-2 space-y-2">
            {call && activeRung === null && (
              <div className="text-[11px] text-muted-foreground border-l-2 border-muted pl-2">
                This call records no offload decision, so no rung is highlighted above — it was
                written before the decision was recorded, or reconstructed afterwards. Inferring a
                rung from today's config would describe today rather than the moment it was made.
              </div>
            )}
            <div className="grid grid-cols-[1fr_320px] gap-3 items-start">
              <CallStrip
                rows={recent}
                filter={stripFilter}
                onFilterChange={setStripFilter}
                routeFilter={routeFilter}
                onRouteFilterChange={setRouteFilter}
                selectedIndex={selectedCall}
                onSelect={setSelectedCall}
                isDark={isDark}
                windowHours={windowHours}
              />
              <CallDetail call={call} />
            </div>
          </div>
        )}

        {/* ── The policy, editable in place ──
            Configuration only. In Recorded mode the counts are history, and a
            control that silently reinterprets history is worse than no control. */}
        {mode === 'config' && p && (
          <div className="border-t pt-2 space-y-2 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-primary" checked={p.enabled}
                  onChange={e => policy.setEnabled(e.target.checked)} />
                <span>offload enabled</span>
              </label>

              <span className="text-muted-foreground">bands:</span>
              {BANDS.map(b => (
                <label key={b} className="flex items-center gap-1">
                  <input type="checkbox" className="accent-primary" disabled={!p.enabled}
                    checked={p.offloadBands.includes(b)}
                    onChange={e => policy.setBandEligible(b, e.target.checked)} />
                  <span className={p.enabled ? 'font-mono' : 'font-mono opacity-50'}>{b}</span>
                </label>
              ))}

              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-muted-foreground">network:</span>
                <select
                  className="bg-background border rounded px-1 py-0.5 font-mono text-[11px]"
                  value={policy.networkOverride ?? ''}
                  onChange={e => policy.setNetworkOverride(e.target.value || null)}
                >
                  <option value="">{policy.liveNetwork} (live)</option>
                  <option value="public">public</option>
                  <option value="corporate">corporate</option>
                </select>
              </span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-muted-foreground">targets:</span>
              {p.targets.map(t => (
                <label key={t.provider} className="flex items-center gap-1"
                  title={`serves ${t.requireNetwork ?? 'any network'} · scope ${(t.scope ?? ['fg', 'bg']).join('+')}`}>
                  <input type="checkbox" className="accent-primary" disabled={!p.enabled}
                    checked={t.enabled}
                    onChange={e => policy.setTargetEnabled(t.provider, e.target.checked)} />
                  <span className={p.enabled ? 'font-mono' : 'font-mono opacity-50'}>{t.provider}</span>
                  <span className="text-muted-foreground">
                    [{t.requireNetwork ?? 'any'}/{(t.scope ?? ['fg', 'bg']).join('+')}]
                  </span>
                </label>
              ))}
              {p.targets.length === 0 && <span className="text-muted-foreground">none declared</span>}
            </div>

            {policy.dirty && (
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-500 border-amber-500/40">
                  preview · unsaved
                </Badge>
                <span className="text-muted-foreground">
                  the ladder above is this edit; the proxy is still running the saved policy
                </span>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2"
                    onClick={policy.revert} disabled={policy.saving}>Revert</Button>
                  <Button size="sm" className="h-6 text-[11px] px-2"
                    onClick={policy.save} disabled={policy.saving}>
                    {policy.saving ? 'Saving…' : 'Save to llm-routing.yaml'}
                  </Button>
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
