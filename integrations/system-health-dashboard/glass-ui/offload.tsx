import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * glass's opt-in offload, from the UI: the daemon's /api/offload (see
 * lib/glass/daemon.mjs, proxy-bridge/offload.mjs).
 *
 * Taken from coding's LLM Routing dialog is only what glass has: one optional
 * endpoint, the bands it takes, the agents it serves. Not taken: per-route
 * provider tables, background routes, fallback chains, provider chips — glass
 * never picks a paid provider; the agent's own is always the fallback.
 *
 * One dialog, opened from three places: the header pill (always visible), Token
 * Usage → Settings, and the endpoint's node in Models → Flow.
 */

export type Band = 'small' | 'medium' | 'high'
export const BANDS: Band[] = ['small', 'medium', 'high']
export const OFFLOAD_AGENTS = ['opencode', 'pi', 'copilot'] as const
type Agent = typeof OFFLOAD_AGENTS[number]

export interface OffloadConfig {
  enabled: boolean
  agents: Record<Agent, boolean>
  target: { name: string; url: string; models: Record<Band, string> }
  bands: Band[]
  classifier: boolean
  maxInputTokens: number
  maxInFlight: number
  timeoutMs: number
}

export interface OffloadView {
  config: OffloadConfig
  keySet: boolean
  health: { url: string; reachable: boolean; checkedAt: number; latencyMs: number; models: string[]; error: string; current: boolean }
  counters: { offloaded: number; fellBack: number; classified: number; downgraded: number }
  inFlight: number
}

/** The row's provider id for the endpoint — offload.mjs targetProviderId. */
export function targetProviderId(name: string): string {
  const id = String(name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return id || 'local'
}

const write = async (method: string, route: string, body: unknown): Promise<OffloadView> => {
  const r = await fetch(route, {
    method, headers: { 'content-type': 'application/json', 'x-glass-ui': '1' }, body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j as OffloadView
}

interface Ctx {
  view: OffloadView | null
  error: string
  openSettings: () => void
  patch: (p: Partial<OffloadConfig> | Record<string, unknown>) => Promise<void>
  /** Is this row provider the endpoint? */
  isTarget: (provider: string) => boolean
}

const OffloadContext = createContext<Ctx>({
  view: null, error: '', openSettings: () => {}, patch: async () => {}, isTarget: () => false,
})
export const useOffload = () => useContext(OffloadContext)

/** "on · reachable" etc. — one wording for the pill, the dialog and the flow. */
export function offloadStatus(v: OffloadView | null): { label: string; tone: 'off' | 'ok' | 'warn' } {
  if (!v) return { label: 'unknown', tone: 'warn' }
  const c = v.config
  if (!c.enabled) return { label: 'off', tone: 'off' }
  if (!c.target.url) return { label: 'on · no endpoint set', tone: 'warn' }
  if (!OFFLOAD_AGENTS.some((a) => c.agents[a])) return { label: 'on · no agent chosen', tone: 'warn' }
  if (!v.health.current || !v.health.checkedAt) return { label: 'on · checking…', tone: 'warn' }
  return v.health.reachable ? { label: `on · ${c.target.name} reachable`, tone: 'ok' } : { label: `on · ${c.target.name} unreachable`, tone: 'warn' }
}

export const TONE_DOT = { off: 'bg-muted-foreground/40', ok: 'bg-emerald-500', warn: 'bg-amber-500' }

export function OffloadProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<OffloadView | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    fetch('/api/offload').then((r) => r.json()).then((v) => { setView(v); setError('') }).catch((e) => setError(String(e?.message || e)))
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  const patch = useCallback(async (p: Record<string, unknown>) => { setView(await write('PATCH', '/api/offload', p)) }, [])
  const ctx = useMemo<Ctx>(() => ({
    view,
    error,
    openSettings: () => setOpen(true),
    patch,
    isTarget: (provider: string) => Boolean(view?.config.target.url) && provider === targetProviderId(view?.config.target.name || ''),
  }), [view, error, patch])

  return (
    <OffloadContext.Provider value={ctx}>
      {children}
      <OffloadDialog open={open} onOpenChange={setOpen} view={view} onSaved={setView} />
    </OffloadContext.Provider>
  )
}

/** The endpoint's display name for its rows' provider id, else null. */
export function useTargetLabel(): (provider: string) => string | null {
  const { view, isTarget } = useOffload()
  const name = view?.config.target.name || ''
  return useCallback((provider: string) => (isTarget(provider) ? name : null), [isTarget, name])
}

/** Header: where the switch is, visible on every tab. */
export function OffloadPill() {
  const { view, openSettings } = useOffload()
  const s = offloadStatus(view)
  return (
    <button
      onClick={openSettings}
      data-testid="offload-pill"
      title="Offload easy calls to your own endpoint — click to change"
      className="flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
    >
      <span className={cn('h-2 w-2 rounded-full', TONE_DOT[s.tone])} />
      Offload: <span className="text-foreground">{s.label}</span>
    </button>
  )
}

const AGENT_NOTE: Record<Agent, string> = {
  opencode: 'reaches glass by its configuration (relay)',
  pi: 'intercepted: glass answers in place of the provider',
  copilot: 'intercepted: glass answers in place of the provider',
}
const BAND_NOTE: Record<Band, string> = {
  small: 'titles, summaries, one-line questions — the agent picked a mini / haiku-class model',
  medium: 'an ordinary turn on a sonnet-class model',
  high: 'an opus-class model or high reasoning effort',
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  )
}

function OffloadDialog({ open, onOpenChange, view, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  view: OffloadView | null
  onSaved: (v: OffloadView) => void
}) {
  const [draft, setDraft] = useState<OffloadConfig | null>(null)
  const [key, setKey] = useState('')
  const [keyClear, setKeyClear] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [tested, setTested] = useState<OffloadView['health'] | null>(null)

  // A fresh draft each time the dialog opens; polling does not overwrite edits.
  useEffect(() => {
    if (open && view) { setDraft(structuredClone(view.config)); setKey(''); setKeyClear(false); setErr(''); setTested(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!draft || !view) return null
  // Functional updates: two edits in one tick must not overwrite each other.
  const set = (p: Partial<OffloadConfig> | ((d: OffloadConfig) => Partial<OffloadConfig>)) =>
    setDraft((d) => (d ? { ...d, ...(typeof p === 'function' ? p(d) : p) } : d))
  const setTarget = (p: Partial<OffloadConfig['target']>) => set((d) => ({ target: { ...d.target, ...p } }))
  const setModel = (b: Band, m: string) => set((d) => ({ target: { ...d.target, models: { ...d.target.models, [b]: m } } }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.config) || key !== '' || keyClear
  // Only a verdict about the URL in the field: none before a URL is typed or checked.
  const health = (() => {
    const h = tested ?? view.health
    return draft.target.url && h.checkedAt && h.url === draft.target.url.trim().replace(/\/+$/, '') ? h : null
  })()
  const models = health?.reachable ? health.models : []

  const save = async () => {
    setBusy('save'); setErr('')
    try {
      let v = await write('PATCH', '/api/offload', draft)
      if (key || keyClear) v = await write('PUT', '/api/offload/key', { key: keyClear ? '' : key })
      onSaved(v)
      onOpenChange(false)
    } catch (e) { setErr(String((e as Error).message)) } finally { setBusy('') }
  }
  // Test what is typed: save the endpoint fields first (offload stays as it is).
  const test = async () => {
    setBusy('test'); setErr('')
    try {
      await write('PATCH', '/api/offload', { target: { name: draft.target.name, url: draft.target.url } })
      if (key || keyClear) await write('PUT', '/api/offload/key', { key: keyClear ? '' : key })
      const v = await write('POST', '/api/offload/test', {})
      setTested(v.health); onSaved(v); setKey(''); setKeyClear(false)
    } catch (e) { setErr(String((e as Error).message)) } finally { setBusy('') }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="offload-dialog">
        <DialogHeader>
          <DialogTitle>Offload easy calls</DialogTitle>
          <DialogDescription>
            By default glass only measures: every call goes, unchanged, to the provider your agent chose. With offload
            on, easy chat calls of the agents you pick are answered by an OpenAI-compatible endpoint you name — a model
            server on this machine or one on your network. Whenever that endpoint is unreachable, busy, too slow or
            fails before answering, the call goes to its own provider exactly as before.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-3 rounded-md border p-3">
          <Checkbox checked={draft.enabled} onCheckedChange={(c) => set({ enabled: c })} data-testid="offload-enabled" />
          <span className="text-sm font-medium">Offload easy calls</span>
          <span className="ml-auto text-xs text-muted-foreground">applies to the next call — no restart</span>
        </label>

        <Section title="Endpoint">
          <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-sm">
            <span className="text-muted-foreground">Name</span>
            <Input value={draft.target.name} onChange={(e) => setTarget({ name: e.target.value })} placeholder="local" />
            <span className="text-muted-foreground">URL</span>
            <Input value={draft.target.url} onChange={(e) => setTarget({ url: e.target.value })}
              placeholder="http://host:8000/v1" data-testid="offload-url" />
            <span className="text-muted-foreground">API key</span>
            <div className="flex items-center gap-2">
              <Input type="password" value={key} onChange={(e) => { setKey(e.target.value); setKeyClear(false) }}
                placeholder={view.keySet && !keyClear ? 'set — type to replace' : 'none'} autoComplete="off" />
              {view.keySet && !keyClear && <Button variant="outline" size="sm" onClick={() => { setKeyClear(true); setKey('') }}>Clear</Button>}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Button variant="outline" size="sm" onClick={test} disabled={!draft.target.url || busy !== ''}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </Button>
            {health && (
              <span className={health.reachable ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {health.reachable
                  ? `reachable · ${health.latencyMs} ms · ${health.models.length} model${health.models.length === 1 ? '' : 's'}`
                  : `not reachable — ${health.error}`}
              </span>
            )}
            <span className="ml-auto text-muted-foreground">the key is kept in your glass home, owner-only, never shown again</span>
          </div>
        </Section>

        <Section title="Which calls" note="A call is offloaded only if its band is ticked and the endpoint has a model for it. Turns that carry tool results stay with the agent's provider.">
          {BANDS.map((b) => (
            <div key={b} className="grid grid-cols-[22px_64px_220px_1fr] items-center gap-2 text-sm">
              <Checkbox checked={draft.bands.includes(b)}
                onCheckedChange={(c) => set((d) => ({ bands: BANDS.filter((x) => (x === b ? c : d.bands.includes(x))) }))} />
              <span className="font-mono text-xs">{b}</span>
              {models.length ? (
                <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={draft.target.models[b]}
                  onChange={(e) => setModel(b, e.target.value)}>
                  <option value="">— no model —</option>
                  {[...new Set([draft.target.models[b], ...models].filter(Boolean))].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <Input className="h-8 text-xs" value={draft.target.models[b]} placeholder="model id (Test lists them)"
                  onChange={(e) => setModel(b, e.target.value)} />
              )}
              <span className="text-xs text-muted-foreground">{BAND_NOTE[b]}</span>
            </div>
          ))}
          <label className="flex items-start gap-2 pt-1 text-sm">
            <Checkbox checked={draft.classifier} onCheckedChange={(c) => set({ classifier: c })} />
            <span>
              Ask the endpoint whether a first turn is easier than its model suggests
              <span className="block text-xs text-muted-foreground">downgrade only, never up; counted as [D:n] in the status line</span>
            </span>
          </label>
        </Section>

        <Section title="Agents">
          {OFFLOAD_AGENTS.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.agents[a]} onCheckedChange={(c) => set((d) => ({ agents: { ...d.agents, [a]: c } }))} data-testid={`offload-agent-${a}`} />
              <span className="w-20">{a}</span>
              <span className="text-xs text-muted-foreground">{AGENT_NOTE[a]}</span>
            </label>
          ))}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={false} disabled />
            <span className="w-20">claude</span>
            <span className="text-xs">not offloaded — Claude Code speaks the Anthropic wire</span>
          </div>
        </Section>

        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">Limits</summary>
          <div className="mt-2 grid grid-cols-[200px_120px_1fr] items-center gap-2">
            <span>Largest call</span>
            <Input type="number" className="h-8" value={draft.maxInputTokens} onChange={(e) => set({ maxInputTokens: Number(e.target.value) })} />
            <span className="text-xs text-muted-foreground">input tokens; larger calls are slow to start on a shared server</span>
            <span>Answer within</span>
            <Input type="number" className="h-8" value={draft.timeoutMs / 1000} onChange={(e) => set({ timeoutMs: Number(e.target.value) * 1000 })} />
            <span className="text-xs text-muted-foreground">seconds, else the agent&apos;s provider answers</span>
            <span>Calls at once</span>
            <Input type="number" className="h-8" value={draft.maxInFlight} onChange={(e) => set({ maxInFlight: Number(e.target.value) })} />
            <span className="text-xs text-muted-foreground">more go to the agent&apos;s provider instead of queueing</span>
          </div>
        </details>

        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 items-center gap-2 border-t bg-background px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            since the daemon started: {view.counters.offloaded} offloaded · {view.counters.fellBack} fell back · {view.counters.downgraded} demoted
            {err && <span className="block text-destructive">{err}</span>}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={!dirty || busy !== ''} data-testid="offload-save">{busy === 'save' ? 'Saving…' : 'Save'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
