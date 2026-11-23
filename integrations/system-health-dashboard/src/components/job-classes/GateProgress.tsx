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
 *
 * TEAM (P6): with a team package, the same counts summed over the members who
 * publish theirs (`summary?scope=team`, rapid-llm-proxy gate-pool.mjs) — this
 * machine live, teammates from their `gate/<pseudonym>.json`. Only one pool is
 * added up (same taxonomy version, labeller and checker); a member on other
 * models or an older version is named, not added.
 *
 * GATE SCOPE: where the proxy routes by class (the class floor — coding, not
 * glass), its gate is this machine's checks by default; the switch here sets
 * `job_classes.routing.gate_scope` to `team` (PATCH /api/llm/routing) so the
 * team's pooled verdict decides instead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const GATE_PRECISION = 0.9
const GATE_MIN_CHECKED = 20

interface ClassCount { jobClass: string; turns: number; teacherSampled: number; teacherAgree: number }
interface PoolCounts { labelled: number; checked: number; agree: number }
interface TeamPool { taxonomy: string; labeller: string; checker: string; members: string[]; local: boolean; classes: Record<string, PoolCounts> }
interface TeamMember { member: string; self?: boolean; live?: boolean; publishedAt?: string; stale?: boolean; error?: string }
interface Team { gateDir: string | null; self: string; members: TeamMember[]; pools: TeamPool[] }
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
  // Classes the tagger re-checks on every turn (teacher_sample_by_class: 1.0), e.g. the replay classes.
  const [alwaysChecked, setAlwaysChecked] = useState<string[]>([])
  const [team, setTeam] = useState<Team | null>(null)
  // The floor's gate scope; null where the proxy does not route by class (glass).
  const [scope, setScope] = useState<'local' | 'team' | null>(null)
  const [scopeBusy, setScopeBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const q = `taxonomy=${encodeURIComponent(taxonomy)}`
      const get = (path: string) => fetch(`${proxyBase}${path}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      const [cov, sum, tagger] = await Promise.all([
        get(`/api/job-classes/coverage?days=90&${q}`),
        get(`/api/job-classes/summary?days=90&${q}&scope=team`),
        get('/api/job-classes').catch(() => null),
      ])
      setClasses(((cov?.taxonomy?.classes ?? []) as { id: string }[]).map(c => c.id))
      setCounts(sum?.byClass ?? [])
      setTeam(sum?.team?.gateDir ? sum.team as Team : null)
      setScope(tagger?.routing ? (tagger.routing.gateScope === 'team' ? 'team' : 'local') : null)
      const cfg = tagger?.config
      setSelfCheck(!!cfg?.studentProcess && cfg.studentProcess === cfg.teacherProcess)
      setSamplePct(typeof cfg?.teacherSamplePct === 'number' ? cfg.teacherSamplePct : null)
      setAlwaysChecked(Object.entries((cfg?.teacherSampleByClass ?? {}) as Record<string, number>).filter(([, p]) => p >= 1).map(([id]) => id))
      setError(sum?.error ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [proxyBase, taxonomy])

  useEffect(() => { void load() }, [load])

  const setGateScope = useCallback(async (next: 'local' | 'team') => {
    setScopeBusy(true)
    try {
      const res = await fetch(`${proxyBase}/api/llm/routing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobClasses: { routing: { gateScope: next } } }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || out?.error) throw new Error(out?.error || `save failed (HTTP ${res.status})`)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setScopeBusy(false)
    }
  }, [proxyBase, load])

  const rows = useMemo(() => (classes ?? []).map(id => {
    const c = counts.find(x => x.jobClass === id)
    const checked = c?.teacherSampled ?? 0
    const agree = c?.teacherAgree ?? 0
    return { id, turns: c?.turns ?? 0, checked, agree, verdict: verdictOf(checked, agree) }
  }), [classes, counts])
  // The team's pool: the one this machine labels into most (it may have older,
  // student-era pools too), else — nothing labelled here yet — the one most
  // members share. The others are named below the table, not added.
  const teamPool = useMemo(() => {
    const all = team?.pools ?? []
    const size = (p: TeamPool) => Object.values(p.classes).reduce((n, c) => n + c.labelled, 0)
    const local = all.filter(p => p.local).sort((a, b) => size(b) - size(a))
    return local[0] ?? [...all].sort((a, b) => b.members.length - a.members.length || size(b) - size(a))[0] ?? null
  }, [team])
  const teamRows = useMemo(() => new Map(rows.map(r => {
    const c = teamPool?.classes[r.id]
    return [r.id, { checked: c?.checked ?? 0, agree: c?.agree ?? 0, verdict: verdictOf(c?.checked ?? 0, c?.agree ?? 0) }]
  })), [rows, teamPool])
  const teamPassing = [...teamRows.values()].filter(r => r.verdict === 'passes').length
  const otherPools = (team?.pools ?? []).filter(p => p !== teamPool)
  const ago = (iso?: string) => {
    if (!iso) return ''
    const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
    return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
  }
  const passing = rows.filter(r => r.verdict === 'passes').length
  const below = rows.filter(r => r.verdict === 'below').length
  const label = selfCheck ? SELF_CHECK_LABEL : VERDICT_LABEL
  const base = samplePct === null ? 'a sample of turns' : samplePct >= 1 ? 'every turn' : samplePct > 0 ? `1 turn in ${Math.round(1 / samplePct)}` : 'no turn'
  const sample = alwaysChecked.length > 0 && samplePct !== null && samplePct < 1
    ? `${base} (every turn of ${alwaysChecked.join(', ')})`
    : base

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
              The teacher re-labels {sample}. A class passes when the teacher agrees with at least{' '}
              {pct(GATE_PRECISION)} of the student's labels for it, over at least {GATE_MIN_CHECKED} teacher-checked
              turns. Counted over every label made under{' '}
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
            {teamPool && (
              <> Across the team (<span className="font-medium">{teamPool.members.length}</span>{' '}
                {teamPool.members.length === 1 ? 'member' : 'members'}): <span className="font-medium">{teamPassing} of {rows.length}</span>{' '}
                {selfCheck ? 'consistent' : 'pass'}.</>
            )}
          </div>
        )}
        {scope && (
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="gate-scope">
            <span className="text-muted-foreground">Routing by class trusts the gate of</span>
            <div className="inline-flex rounded-md border">
              <Button size="sm" variant={scope === 'local' ? 'default' : 'ghost'} className="h-7 rounded-r-none" disabled={scopeBusy}
                onClick={() => scope !== 'local' && void setGateScope('local')} data-testid="gate-scope-local">this machine</Button>
              <Button size="sm" variant={scope === 'team' ? 'default' : 'ghost'} className="h-7 rounded-l-none" disabled={scopeBusy || !team}
                title={team ? '' : 'no team package: there is no team gate'}
                onClick={() => scope !== 'team' && void setGateScope('team')} data-testid="gate-scope-team">the team</Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {scope === 'team'
                ? "A class passing on the team's checks may move your calls to a cheaper model."
                : "Teammates' numbers are shown, but only this machine's checks can change which model answers you."}
            </span>
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
                {teamPool && <TableHead className="border-l">Team: checked</TableHead>}
                {teamPool && <TableHead className="text-right">Team agreement</TableHead>}
                {teamPool && <TableHead>Team</TableHead>}
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
                  {teamPool && (() => {
                    const t = teamRows.get(r.id)!
                    return (
                      <>
                        <TableCell className="border-l">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 rounded bg-muted overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${Math.min(1, t.checked / GATE_MIN_CHECKED) * 100}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums">{t.checked} / {GATE_MIN_CHECKED}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{t.checked ? `${t.agree} (${pct(t.agree / t.checked)})` : '—'}</TableCell>
                        <TableCell data-testid={`gate-team-${r.id}`}><Badge variant={VERDICT_BADGE[t.verdict]}>{label[t.verdict]}</Badge></TableCell>
                      </>
                    )
                  })()}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {team && (
          <div className="text-xs text-muted-foreground space-y-1" data-testid="gate-team">
            <div>
              Team counts come from <span className="font-mono">gate/</span> in the team package: each member publishes
              per-class counts, never a prompt (<span className="font-mono">coding job-classes publish</span> /{' '}
              <span className="font-mono">glass job-classes publish</span>).
              {teamPool && <> Added up: {teamPool.labeller}{teamPool.checker && teamPool.checker !== teamPool.labeller ? <> checked by {teamPool.checker}</> : teamPool.checker ? ' (checked by itself)' : ''}, <span className="font-mono">{teamPool.taxonomy}</span>.</>}
            </div>
            <div>
              Members:{' '}
              {team.members.map((m, i) => (
                <span key={m.member} className={m.error || m.stale ? 'line-through' : ''} title={m.error || (m.stale ? 'older than 14 days: not added' : '')}>
                  {i > 0 && ', '}<span className="font-mono">{m.member}</span>
                  {m.self ? ' (this machine, live)' : m.error ? ' (unreadable)' : m.stale ? ` (stale, ${ago(m.publishedAt)})` : ` (${ago(m.publishedAt)})`}
                </span>
              ))}
              {team.members.length === 1 && team.members[0].self && '. No teammate has published yet.'}
            </div>
            {otherPools.map(p => (
              <div key={`${p.taxonomy}|${p.labeller}|${p.checker}`}>
                Not added: {p.members.map(m => m === team.self ? 'this machine' : m).join(', ')} with {p.labeller}
                {p.checker ? ` checked by ${p.checker}` : ''} under <span className="font-mono">{p.taxonomy}</span>
                {' '}({Object.values(p.classes).reduce((n, c) => n + c.checked, 0)} checked turns): a different labeller or taxonomy version measures something else.
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
