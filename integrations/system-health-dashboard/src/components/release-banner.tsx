/**
 * "coding X is available" — the dashboard half of the release notification
 * (.planning/coding-releases.md P5). The state comes from the health
 * coordinator's release check (/api/release → :3034/release); the update runs on
 * the host through the coordinator, because it restarts host daemons.
 *
 * Display only, and it fails open: no coordinator, no network or a dev checkout
 * render nothing at all — never an error banner on every page.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpCircle, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { MarkdownText } from '@/components/markdown-text'

interface ReleaseState {
  ok: boolean
  enabled?: boolean
  channel?: 'release' | 'dev' | null
  current?: string | null
  available?: string | null
  pageUrl?: string
  update?: UpdateStatus
}
interface UpdateStatus {
  running: boolean
  exit: number | null
  log: string
}

const POLL_RELEASE_MS = 15 * 60_000
const POLL_UPDATE_MS = 3_000
const DISMISS_KEY = 'coding.release-banner.dismissed'

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init)
    if (!r.ok && r.status !== 409) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

export function ReleaseBanner() {
  const [state, setState] = useState<ReleaseState | null>(null)
  const [notes, setNotes] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  const timer = useRef<number | null>(null)

  const loadState = useCallback(async (refresh = false) => {
    const s = await getJson<ReleaseState>(refresh ? '/api/release?refresh=1' : '/api/release')
    if (s?.ok) {
      setState(s)
      if (s.update && typeof s.update.running === 'boolean' && (s.update.running || typeof s.update.exit === 'number')) setUpdate(s.update)
    }
  }, [])

  useEffect(() => {
    loadState()
    const id = window.setInterval(() => loadState(), POLL_RELEASE_MS)
    return () => window.clearInterval(id)
  }, [loadState])

  // While an update runs, follow its log. The coordinator restarts mid-update,
  // so failed polls are expected and simply retried.
  useEffect(() => {
    if (!update?.running) return
    timer.current = window.setInterval(async () => {
      const u = await getJson<UpdateStatus & { ok: boolean }>('/api/release/update')
      // Only a well-formed status counts: mid-update the coordinator restarts,
      // and anything else (an error page, a proxy answer) is a retry, not an outcome.
      if (u && typeof u.running === 'boolean' && (u.exit === null || typeof u.exit === 'number')) {
        setUpdate(u)
        if (!u.running) loadState(true) // the version that is running now
      }
    }, POLL_UPDATE_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [update?.running, loadState])

  const toggleNotes = async () => {
    if (!showNotes && notes === null) {
      try {
        const r = await fetch('/api/release/notes')
        setNotes(r.status === 200 ? await r.text() : '')
      } catch {
        setNotes('')
      }
    }
    setShowNotes((v) => !v)
  }

  const startUpdate = async () => {
    setError(null)
    const r = await getJson<{ ok: boolean; error?: string; running?: boolean }>('/api/release/update', { method: 'POST' })
    if (!r) setError('the health coordinator did not answer')
    else if (!r.ok) setError(r.error ?? 'the update did not start')
    else setUpdate({ running: true, exit: null, log: '' })
  }

  const finished = !!update && !update.running && typeof update.exit === 'number'
  const available = state?.available
  if (!finished && !update?.running && (!available || state?.enabled === false || dismissed === available)) return null

  return (
    <div className="px-4 pt-3" data-testid="release-banner">
      <Alert className="border-blue-300 dark:border-blue-800 text-left">
        {/* The icon sits in the title, not as the Alert's first child: the
            shared Alert sizes its icon column with var(--spacing), which this
            dashboard's Tailwind does not define (the column came out 801px). */}
        <AlertTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ArrowUpCircle className="h-4 w-4 shrink-0" />
            {update?.running
              ? `Updating coding to ${available ?? 'the latest release'}…`
              : finished
                ? update.exit === 0
                  ? `coding ${state?.current ?? ''} is installed — reload to use it`
                  : `The update failed (exit ${update.exit})`
                : `coding ${available} is available (this is ${state?.current})`}
          </span>
          {!update?.running && available && !finished && (
            <button
              aria-label="Dismiss until the next release"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                try {
                  localStorage.setItem(DISMISS_KEY, available)
                } catch {
                  /* per-viewer convenience only */
                }
                setDismissed(available)
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </AlertTitle>
        <AlertDescription>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {!update?.running && !finished && (
              <Button size="sm" onClick={startUpdate} data-testid="release-update-button">
                Update
              </Button>
            )}
            {update?.running && <Loader2 className="h-4 w-4 animate-spin" />}
            {finished && update.exit === 0 && (
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
            {available && !finished && (
              <Button size="sm" variant="ghost" onClick={toggleNotes}>
                {showNotes ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Release notes
              </Button>
            )}
            {state?.pageUrl && (
              <a className="text-sm underline" href={state.pageUrl} target="_blank" rel="noreferrer">
                on GitHub
              </a>
            )}
          </div>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          {showNotes && (
            <div className="mt-2 max-h-80 overflow-auto text-sm">
              {notes ? <MarkdownText text={notes} /> : <p className="text-muted-foreground">No release notes were published for this release.</p>}
            </div>
          )}
          {update && (update.running || update.exit !== 0) && update.log && (
            <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{update.log}</pre>
          )}
        </AlertDescription>
      </Alert>
    </div>
  )
}
