import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// A newer glass release, offered in the header: one click runs `glass update` in
// the daemon's name (update.mjs). The daemon is replaced by the new version, so
// the page waits for /health to answer with it, then reloads itself.

interface UpdateView {
  enabled: boolean
  current: string
  available: string | null
  error: string | null
  install: { running: boolean; target: string; exit: number | null; output: string } | null
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'installing'; target: string }
  | { kind: 'kept'; target: string; output: string } // installed; the old daemon keeps its sessions
  | { kind: 'failed'; output: string }

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-glass-ui': '1' }
const CHECK_MS = 10 * 60_000
const POLL_MS = 2000
const GIVE_UP_MS = 5 * 60_000

const lastLines = (s: string, n = 6) => s.trim().split('\n').slice(-n).join('\n')

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null // the daemon is restarting
  }
}

export function UpdatePill() {
  const [view, setView] = useState<UpdateView | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const read = () => getJson<UpdateView>('/api/glass/update').then((v) => v && setView(v))
    read()
    const t = setInterval(read, CHECK_MS)
    return () => { clearInterval(t); if (timer.current) clearTimeout(timer.current) }
  }, [])

  const watch = useCallback((from: string, target: string, since: number) => {
    timer.current = setTimeout(async () => {
      const h = await getJson<{ glass?: string }>('/health')
      if (h?.glass && h.glass !== from) { window.location.reload(); return }
      const v = await getJson<UpdateView>('/api/glass/update')
      const inst = v?.install
      if (inst && !inst.running && inst.exit !== 0) { setPhase({ kind: 'failed', output: inst.output }); return }
      if (inst && !inst.running && inst.exit === 0 && h?.glass === from) {
        setPhase({ kind: 'kept', target, output: inst.output })
        return
      }
      if (Date.now() - since > GIVE_UP_MS) {
        setPhase({ kind: 'failed', output: 'glass did not come back — run glass update in a terminal, or glass doctor' })
        return
      }
      watch(from, target, since)
    }, POLL_MS)
  }, [])

  const start = useCallback(async () => {
    if (!view?.available) return
    const target = view.available
    setPhase({ kind: 'installing', target })
    try {
      const r = await fetch('/api/glass/update', { method: 'POST', headers: WRITE_HEADERS, body: '{}' })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setPhase({ kind: 'failed', output: j?.error || `HTTP ${r.status}` }); return }
    } catch (e) {
      setPhase({ kind: 'failed', output: String(e) })
      return
    }
    watch(view.current, target, Date.now())
  }, [view, watch])

  if (phase.kind === 'idle' && !view?.available) return null

  const base = 'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs'
  if (phase.kind === 'installing') {
    return (
      <span data-testid="update-pill" className={cn(base, 'text-muted-foreground')}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating to {phase.target}…
      </span>
    )
  }
  if (phase.kind === 'kept') {
    return (
      <span data-testid="update-pill" className={cn(base, 'text-muted-foreground')} title={lastLines(phase.output)}>
        glass {phase.target} installed — it takes over when the running sessions end
      </span>
    )
  }
  if (phase.kind === 'failed') {
    return (
      <button
        data-testid="update-pill" onClick={start}
        title={`${lastLines(phase.output)}\n\nClick to try again, or run glass update in a terminal.`}
        className={cn(base, 'border-red-500/50 text-red-600 hover:bg-muted dark:text-red-400')}
      >
        Update failed — retry
      </button>
    )
  }
  return (
    <button
      data-testid="update-pill" onClick={start}
      title={`glass ${view!.available} is out (this is ${view!.current}). Click to install it; running sessions carry on.`}
      className={cn(base, 'border-amber-500/50 text-amber-700 hover:bg-muted dark:text-amber-400')}
    >
      <ArrowUpCircle className="h-3.5 w-3.5" /> Update to {view!.available}
    </button>
  )
}
