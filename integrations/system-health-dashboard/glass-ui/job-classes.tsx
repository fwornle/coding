import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

/**
 * glass's job-class labelling, from the Classes tab: the daemon's
 * /api/job-classes/settings (lib/glass/job-classes.mjs).
 *
 * Off by default. On, the user's own Copilot account labels each human turn: the
 * student every turn, the teacher a share of them. The card says what leaves the
 * machine, lets the account be tried before anything is labelled, and binds a
 * team's taxonomy from its learning repo.
 */

interface JobClassConfig {
  enabled: boolean
  studentModel: string
  teacherModel: string
  teacherSamplePct: number
  team: { url: string; dir: string } | null
}
interface JobClassView {
  config: JobClassConfig
  host: string
  copilotApi: string
  taxonomy: string
  shipped: string
}
type TestResult = { ok: true; label: string; model: string; ms: number } | { ok: false; error: string }

const call = async <T,>(method: string, route: string, body?: unknown): Promise<T> => {
  const r = await fetch(route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-glass-ui': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => { throw new Error('glass is not running — `glass ui` starts it') })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j as T
}

export function JobClassSettings() {
  const [view, setView] = useState<JobClassView | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [tested, setTested] = useState<TestResult | null>(null)
  const [teamUrl, setTeamUrl] = useState('')
  const [pct, setPct] = useState('')

  const load = useCallback(async () => {
    try {
      const v = await call<JobClassView>('GET', '/api/job-classes/settings')
      setView(v); setPct(String(Math.round(v.config.teacherSamplePct * 100))); setErr('')
    } catch (e) { setErr(String((e as Error).message)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const act = async (what: string, fn: () => Promise<JobClassView | void>) => {
    setBusy(what); setErr('')
    try { const v = await fn(); if (v) { setView(v); setPct(String(Math.round(v.config.teacherSamplePct * 100))) } } catch (e) { setErr(String((e as Error).message)) } finally { setBusy('') }
  }
  const patch = (p: Partial<JobClassConfig>) => act('save', () => call<JobClassView>('PATCH', '/api/job-classes/settings', p))

  if (!view) return err ? <div className="text-sm text-destructive">{err}</div> : null
  const c = view.config
  const team = c.team

  return (
    <Card data-testid="job-class-settings">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Labelling on this machine</CardTitle>
        <CardDescription>
          Off by default: glass then only measures. On, each prompt you give an agent is sent, after redaction, to
          your own GitHub Copilot account{view.host ? <> on <span className="font-mono">{view.host}</span></> : ''}:
          the student model labels every turn, the teacher re-checks a share of them. It uses your Copilot quota, a
          little per turn, and never touches the turn itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {err && <div className="text-destructive">{err}</div>}
        <label className="flex items-center gap-3 rounded-md border p-3">
          <Checkbox checked={c.enabled} disabled={busy !== ''} onCheckedChange={(on) => void patch({ enabled: on === true })} data-testid="job-class-enabled" />
          <span className="font-medium">Label my turns</span>
          <span className="ml-auto text-xs text-muted-foreground">applies to the next turn — no restart</span>
        </label>

        <div className="grid grid-cols-[150px_1fr] items-center gap-2">
          <span className="text-muted-foreground">Copilot account</span>
          <span className="font-mono text-xs">{view.copilotApi || 'none: gh is not logged in to a host with Copilot'}</span>
          <span className="text-muted-foreground">Student · teacher</span>
          <span className="font-mono text-xs">{c.studentModel} · {c.teacherModel}</span>
          <span className="text-muted-foreground">Teacher re-checks</span>
          <span className="flex items-center gap-2">
            <Input className="h-8 w-20" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
            <span className="text-xs text-muted-foreground">% of turns — the gate needs these; 0 switches the teacher off</span>
            {Number(pct) / 100 !== c.teacherSamplePct && Number.isFinite(Number(pct)) && (
              <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => void patch({ teacherSamplePct: Number(pct) / 100 })}>Save</Button>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => void act('test', async () => setTested(await call<TestResult>('POST', '/api/job-classes/test', {})))}>
            {busy === 'test' ? 'Trying…' : 'Try the account'}
          </Button>
          {tested && (tested.ok
            ? <span className="text-xs text-muted-foreground">{tested.model} labelled a test prompt <span className="font-mono">{tested.label}</span> in {(tested.ms / 1000).toFixed(1)} s</span>
            : <span className="text-xs text-destructive">{tested.error}</span>)}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Taxonomy</div>
          {team ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Your team's, from <span className="font-mono text-xs">{team.url}</span></span>
              <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => void act('pull', () => call<JobClassView>('POST', '/api/job-classes/team/pull', {}))}>Update</Button>
              <Button size="sm" variant="ghost" disabled={busy !== ''} onClick={() => void act('leave', () => call<JobClassView>('DELETE', '/api/job-classes/team', {}))}>Use the default</Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                The default classes ship with glass. A team that shares its own (in a member's learning repo, under
                <span className="font-mono"> job-classes/</span>) is joined with the repo's git URL.
              </p>
              <div className="flex items-center gap-2">
                <Input className="h-8" placeholder="https://<host>/<owner>/<repo>.git" value={teamUrl} onChange={(e) => setTeamUrl(e.target.value)} />
                <Button size="sm" variant="outline" disabled={busy !== '' || !teamUrl.trim()} onClick={() => void act('join', () => call<JobClassView>('PUT', '/api/job-classes/team', { url: teamUrl.trim() }))}>
                  {busy === 'join' ? 'Joining…' : 'Join'}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
