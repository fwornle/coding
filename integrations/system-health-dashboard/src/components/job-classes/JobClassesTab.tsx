/**
 * Token Usage → Classes: what KIND of job each foreground turn was (fix, build,
 * ship, explain, …) and what each kind costs in tokens.
 *
 * The labels come from rapid-llm-proxy's shadow tagger (proxy-bridge/job-class.mjs):
 * every human turn is labelled once, in the background, by a cheap student model
 * against the committed taxonomy (config/job-classes.yaml), and a share of turns
 * is labelled by the teacher as well. Nothing routes on the labels yet
 * (.planning/shared-job-classes.md, P1), so this tab is where they are read:
 * tokens by class from GET /api/job-classes/summary, which joins the labels to
 * token_usage on the turn identity, and the tagger's counters from
 * GET /api/job-classes.
 *
 * The teacher-agreement column is the P1 gate: the student's live precision per
 * class, set against what the offline measurement found on unseen prompts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Tags } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CoverageMap } from './CoverageMap'

/** Student-vs-teacher agreement on 300 prompts nobody read while writing the taxonomy (claude-haiku-5.5, taxonomy v1). */
const OFFLINE_AGREEMENT = 0.803

interface ClassRow {
  jobClass: string
  turns: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  teacherSampled: number
  teacherAgree: number
}
interface RecentTurn {
  conversationKey: string
  turnIndex: number
  agent: string
  project: string
  jobClass: string
  teacherClass: string
  studentModel: string
  studentMs: number | null
  promptPreview?: string
  labelledAt: string
}
interface Summary {
  days: number
  byClass: ClassRow[]
  agreement?: { sampled: number; agree: number | null }
  recent?: RecentTurn[]
  error?: string
}
interface TaggerState {
  enabled: boolean
  config?: { teacherSamplePct: number; studentProcess: string } | null
  observed: number
  labelled: number
  teacherSampled: number
  skipped: Record<string, number>
  dropped: number
  failed: number
  invalid: number
  taxonomy: string | null
  taxonomyError: string | null
}

const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))
const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Turn-count share shown as a bar beside the number. */
function ShareBar({ share }: { share: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{pct(share)}</span>
    </div>
  )
}

/** `hours` is the page's window: a number of hours, or 'all' (the proxy's longest, 90 days). */
export function JobClassesTab({ proxyBase, hours }: { proxyBase: string; hours: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [tagger, setTagger] = useState<TaggerState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        fetch(`${proxyBase}/api/job-classes/summary?${hours === 'all' ? 'days=90' : `hours=${encodeURIComponent(hours)}`}&recent=30`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
        fetch(`${proxyBase}/api/job-classes`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      ])
      setSummary(s)
      setTagger(t)
      setError(s.error ? `The proxy could not read the labels: ${s.error}` : null)
    } catch (e: unknown) {
      setError(`Job classes are not available from this proxy: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [proxyBase, hours])

  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => summary?.byClass ?? [], [summary])
  const totalTurns = useMemo(() => rows.reduce((s, r) => s + r.turns, 0), [rows])
  const agreement = summary?.agreement
  const liveRate = agreement && agreement.sampled > 0 ? (agreement.agree ?? 0) / agreement.sampled : null
  const skipped = tagger ? Object.entries(tagger.skipped).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Tags className="h-4 w-4" /> Job classes</CardTitle>
              <CardDescription>
                What kind of job each turn was, labelled in the background by a cheap model. Shadow only: nothing
                routes on these labels yet.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {error && <div className="text-destructive">{error}</div>}
          {tagger && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={tagger.enabled ? 'default' : 'secondary'}>{tagger.enabled ? 'labelling' : 'off'}</Badge>
              {tagger.taxonomy && <Badge variant="outline">{tagger.taxonomy}</Badge>}
              {tagger.taxonomyError && <span className="text-destructive">taxonomy: {tagger.taxonomyError}</span>}
              <span className="text-muted-foreground">
                Since the proxy started: {tagger.labelled} labelled, {tagger.teacherSampled} checked by the teacher
                {tagger.failed > 0 && `, ${tagger.failed} failed`}{tagger.dropped > 0 && `, ${tagger.dropped} dropped (busy)`}
                {tagger.invalid > 0 && `, ${tagger.invalid} unreadable answers`}.
                {skipped.length > 0 && ` Not labelled: ${skipped.map(([k, v]) => `${v} ${k}`).join(', ')}.`}
              </span>
            </div>
          )}
          <div className="text-muted-foreground">
            Teacher check:{' '}
            {liveRate === null
              ? 'no turn has been checked by the teacher in this window yet.'
              : <>the student agreed with the teacher on <span className="text-foreground font-medium">{agreement!.agree} of {agreement!.sampled}</span> sampled turns ({pct(liveRate)}).</>}
            {' '}Measured offline on unseen prompts: {pct(OFFLINE_AGREEMENT)}.
            {liveRate !== null && agreement!.sampled < 100 && ' Too few checked turns to read much into yet.'}
          </div>
        </CardContent>
      </Card>

      <CoverageMap proxyBase={proxyBase} hours={hours} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By class</CardTitle>
          <CardDescription>
            A class's tokens are every call of the turns labelled with it, tool loops included. "none" is a turn the
            student could not place in any class.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No labelled turns in this window.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Turns</TableHead>
                  <TableHead>Share of turns</TableHead>
                  <TableHead className="text-right">Calls per turn</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Cache read</TableHead>
                  <TableHead className="text-right">Tokens per turn</TableHead>
                  <TableHead className="text-right">Teacher agrees</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const tokens = r.inputTokens + r.outputTokens + r.cacheReadTokens
                  return (
                    <TableRow key={r.jobClass}>
                      <TableCell className="font-medium">{r.jobClass}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.turns}</TableCell>
                      <TableCell><ShareBar share={totalTurns ? r.turns / totalTurns : 0} /></TableCell>
                      <TableCell className="text-right tabular-nums">{r.turns ? (r.calls / r.turns).toFixed(1) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.inputTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.outputTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.cacheReadTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.turns ? fmt(Math.round(tokens / r.turns)) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.teacherSampled ? `${r.teacherAgree} / ${r.teacherSampled}` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recently labelled turns</CardTitle>
          <CardDescription>The opening of what the student was given, after redaction.</CardDescription>
        </CardHeader>
        <CardContent>
          {(summary?.recent ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Nothing labelled yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Prompt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(summary?.recent ?? []).map(t => (
                  <TableRow key={`${t.conversationKey}:${t.turnIndex}`}>
                    <TableCell className="whitespace-nowrap text-xs">{time(t.labelledAt)}</TableCell>
                    <TableCell className="text-xs">{t.agent || '—'}</TableCell>
                    <TableCell className="text-xs">{t.project || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{t.jobClass}</Badge></TableCell>
                    <TableCell>
                      {t.teacherClass
                        ? <Badge variant={t.teacherClass === t.jobClass ? 'secondary' : 'destructive'}>{t.teacherClass}</Badge>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[28rem] truncate" title={t.promptPreview || ''}>
                      {t.promptPreview || <span className="italic">not kept for this label</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
