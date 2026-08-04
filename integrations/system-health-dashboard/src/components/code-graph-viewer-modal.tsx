'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Loader2, Network, RotateCcw, AlertTriangle } from 'lucide-react'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Scope {
  scope: string
  slug: string
  codeNodes: number
  nodeLevel: boolean
}

type ViewState = 'loading-scopes' | 'idle' | 'generating' | 'ready' | 'error'

export default function CodeGraphViewerModal({ open, onOpenChange }: Props) {
  const [scopes, setScopes] = useState<Scope[] | null>(null)
  const [scope, setScope] = useState<string>('')
  const [state, setState] = useState<ViewState>('loading-scopes')
  const [phase, setPhase] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [iframeSrc, setIframeSrc] = useState<string>('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const showReady = useCallback((s: string) => {
    stopPoll()
    setIframeSrc(`${API_BASE_URL}/api/cgr/code-graph-html/view?scope=${encodeURIComponent(s)}&t=${Date.now()}`)
    setState('ready')
  }, [])

  const generate = useCallback((s: string) => {
    stopPoll()
    setError(null)
    setState('generating')
    setPhase('starting')
    fetch(`${API_BASE_URL}/api/cgr/code-graph-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: s }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.status !== 'success') throw new Error(json.message || 'generation failed')
        if (json.data.state === 'ready') { showReady(s); return }
        // Poll until done.
        pollRef.current = setInterval(async () => {
          try {
            const p = await fetch(`${API_BASE_URL}/api/cgr/code-graph-html/progress?scope=${encodeURIComponent(s)}`).then((r) => r.json())
            const st = p.data?.status
            setPhase(p.data?.phase || '')
            if (st === 'done') showReady(s)
            else if (st === 'error') { stopPoll(); setError(p.data?.error || 'generation failed'); setState('error') }
          } catch { /* transient — keep polling */ }
        }, 1500)
      })
      .catch((err) => { setError(err?.message || 'generation failed'); setState('error') })
  }, [showReady])

  // Load scopes when the modal opens; auto-select a sensible default.
  useEffect(() => {
    if (!open) { stopPoll(); return }
    if (scopes) return
    setState('loading-scopes')
    fetch(`${API_BASE_URL}/api/cgr/code-scopes`)
      .then((r) => r.json())
      .then((json) => {
        const list: Scope[] = json.data || []
        setScopes(list)
        if (list.length === 0) { setState('idle'); return }
        // Default: the dashboard's own scope if present, else the largest.
        const preferred = list.find((x) => x.scope === 'integrations/system-health-dashboard') || list[0]
        setScope(preferred.scope)
        generate(preferred.scope)
      })
      .catch((err) => { setError(err?.message || 'failed to load scopes'); setState('error') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => stopPoll(), [])

  const onPick = (s: string) => { setScope(s); generate(s) }
  const active = scopes?.find((x) => x.scope === scope)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[94vw] w-[94vw] h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b px-5 py-3 space-y-0">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-primary" />
              Code Graph
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              graphify's native viewer · code symbols (classes / functions / methods) for the selected scope
              {active ? ` · ${active.codeNodes.toLocaleString()} nodes` : ''}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2 pr-8">
            <Select value={scope} onValueChange={onPick}>
              <SelectTrigger className="h-8 w-72 text-xs">
                <SelectValue placeholder="Choose a code scope…" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {(scopes || []).map((s) => (
                  <SelectItem key={s.slug} value={s.scope} className="text-xs">
                    {s.scope} · {s.codeNodes.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!scope || state === 'generating'}
              onClick={() => scope && generate(scope)}
              title="Regenerate this scope"
            >
              <RotateCcw className={`mr-1 h-3 w-3 ${state === 'generating' ? 'animate-spin' : ''}`} /> Regenerate
            </Button>
          </div>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-[#0f0f1a]">
          {state === 'ready' && iframeSrc && (
            <iframe
              key={iframeSrc}
              src={iframeSrc}
              title="Code graph"
              className="h-full w-full border-0"
            />
          )}

          {(state === 'loading-scopes' || state === 'generating') && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-md border bg-background/90 px-4 py-2.5 text-sm shadow">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {state === 'loading-scopes'
                  ? 'Loading code scopes…'
                  : `Generating graphify viewer for ${scope}${phase ? ` · ${phase}` : ''}…`}
              </div>
            </div>
          )}

          {state === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex max-w-md items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive shadow">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            </div>
          )}

          {state === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No code scopes found — run a re-index first.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
