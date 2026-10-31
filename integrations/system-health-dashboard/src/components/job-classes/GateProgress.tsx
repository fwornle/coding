/**
 * Token Usage → Classes → Gate: how far each class is from the gate that lets
 * it drive anything (.planning/shared-job-classes.md, P1).
 *
 * The gate is the student's live PRECISION per class: of the teacher-checked
 * turns the student put in a class, the share the teacher put there too. It is
 * the band classifier's gate (precision >= 0.90), read per class, over at least
 * GATE_MIN_CHECKED checked turns, so a class is not passed on two lucky turns.
 *
 * Counted over every label made under the selected taxonomy (the proxy's longest
 * window, 90 days), not the page's window: the gate is a property of the
 * taxonomy version, which a new version starts from zero. "none" is no class
 * and has no gate.
 *
 * When the live labeller IS the teacher (student_process == teacher_process —
 * coding since 2026-10-30, after no cheap student cleared the gate offline),
 * there is no student to gate. The same counts then measure the teacher's
 * consistency: a second teacher pass on a sample of turns, agreeing with the
 * first. The panel says so rather than calling that "the student's precision".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const GATE_PRECISION = 0.9
const GATE_MIN_CHECKED = 20

interface ClassCount { jobClass: string; turns: number; teacherSampled: number; teacherAgree: number }
type Verdict = 'passes' | 'below' | 'collecting'

const pct = (x: number) => `${(x * 100).toFixed(0)}%`

function verdictOf(checked: number, agree: number): Verdict {
  if (checked < GATE_MIN_CHECKED) return 'collecting'
  return agree / checked >= GATE_PRECISION ? 'passes' : 'below'
}

const VERDICT_LABEL: Record<Verdict, string> = { passes: 'passes', below: 'below the gate', collecting: 'collecting' }
const SELF_CHECK_LABEL: Record<Verdict, string> = { passes: 'consistent', below: 'inconsistent', collecting: 'collecting' }
const VERDICT_BADGE: Record<Verdict, 'default' | 'destructive' | 'secondary'> = { passes: 'default', below: 'destructive', collecting: 'secondary' }

export function GateProgress({ proxyBase, taxonomy }: { proxyBase: string; taxonomy: string }) {
  const [classes, setClasses] = useState<string[] | null>(null)
  const [counts, setCounts] = useState<ClassCount[]>([])
  const [error, setError] = useState<string | null>(null)
  // The teacher labels live turns itself; its second pass is a consistency check.
  const [selfCheck, setSelfCheck] = useState(false)
  const [samplePct, setSamplePct] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const q = `taxonomy=${encodeURIComponent(taxonomy)}`
      const get = (path: string) => fetch(`${proxyBase}${path}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      const [cov, sum, tagger] = await Promise.all([
        get(`/api/job-classes/coverage?days=90&${q}`),
        get(`/api/job-classes/summary?days=90&${q}`),
        get('/api/job-classes').catch(() => null),
      ])
      setClasses(((cov?.taxonomy?.classes ?? []) as { id: string }[]).map(c => c.id))
      setCounts(sum?.byClass ?? [])
      const cfg = tagger?.config
      setSelfCheck(!!cfg?.studentProcess && cfg.studentProcess === cfg.teacherProcess)
      setSamplePct(typeof cfg?.teacherSamplePct === 'number' ? cfg.teacherSamplePct : null)
      setError(sum?.error ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [proxyBase, taxonomy])

  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => (classes ?? []).map(id => {
    const c = counts.find(x => x.jobClass === id)
    const checked = c?.teacherSampled ?? 0
    const agree = c?.teacherAgree ?? 0
    return { id, turns: c?.turns ?? 0, checked, agree, verdict: verdictOf(checked, agree) }
  }), [classes, counts])
  const passing = rows.filter(r => r.verdict === 'passes').length
  const below = rows.filter(r => r.verdict === 'below').length
  const label = selfCheck ? SELF_CHECK_LABEL : VERDICT_LABEL
  const sample = samplePct !== null ? `1 turn in ${Math.round(1 / samplePct)}` : 'a sample of turns'

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Gate</CardTitle>
        <CardDescription>
          {selfCheck ? (
            <>
              Live labels come from the teacher itself, so there is no student to gate. Instead the teacher labels{' '}
              {sample} a second time: a class is consistent when the second pass agrees with the first on at least{' '}
              {pct(GATE_PRECISION)}, over at least {GATE_MIN_CHECKED} re-checked turns. Counted over every label made under{' '}
              <span className="font-mono">{taxonomy}</span>, whatever the page's window, including any a student made
              before the teacher took over.
            </>
          ) : (
            <>
              A class passes when the teacher agrees with at least {pct(GATE_PRECISION)} of the student's labels for it,
              over at least {GATE_MIN_CHECKED} teacher-checked turns. Counted over every label made under{' '}
              <span className="font-mono">{taxonomy}</span>, whatever the page's window.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <div className="text-sm text-destructive">{error}</div>}
        {classes && (
          <div className="text-sm" data-testid="gate-headline">
            <span className="font-medium">{passing} of {rows.length}</span> classes {selfCheck ? 'consistent' : 'pass'}
            {below > 0 && <>, <span className="font-medium">{below}</span> {label.below}</>}
            , {rows.length - passing - below} still collecting.
          </div>
        )}
        {classes && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Labelled</TableHead>
                <TableHead>{selfCheck ? 'Re-checked by the teacher' : 'Checked by the teacher'}</TableHead>
                <TableHead className="text-right">{selfCheck ? 'Second pass agrees' : 'Teacher agrees'}</TableHead>
                <TableHead className="text-right">{selfCheck ? 'Agreement' : 'Precision'}</TableHead>
                <TableHead>{selfCheck ? 'Consistency' : 'Gate'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} data-testid={`gate-row-${r.id}`}>
                  <TableCell className="font-medium">{r.id}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.turns}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(1, r.checked / GATE_MIN_CHECKED) * 100}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">{r.checked} / {GATE_MIN_CHECKED}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.checked ? r.agree : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.checked ? pct(r.agree / r.checked) : '—'}</TableCell>
                  <TableCell><Badge variant={VERDICT_BADGE[r.verdict]}>{label[r.verdict]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
