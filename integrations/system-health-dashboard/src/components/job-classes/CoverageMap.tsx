/**
 * Token Usage → Classes → Coverage map: which job classes exist, and how they
 * cover the prompts of each project (or of one team's projects).
 *
 * One row per class of the committed taxonomy, one column per project; a cell is
 * the share of that project's prompts the class holds, so a column reads as "what
 * kind of work happens here". Two rows below the line are where the taxonomy has
 * gaps: `none` (no class fits the prompt) and `unclear` (the models disagree on
 * which class it is). Clicking a class shows its definition next to real prompts
 * it was given.
 *
 * Two sources, from GET /api/job-classes/coverage on rapid-llm-proxy:
 *   - reference: the offline reference set (coding scripts/measure-job-classes.mjs,
 *     <data home>/var/job-classes/<scope>/reference-<taxonomy>.jsonl), where
 *     `unclear` = the teacher labelled the prompt two ways in two passes;
 *   - live: the tagger's labels of your turns, where `unclear` = the student and
 *     the teacher disagreed on a sampled turn (so its share is of checked turns).
 * Teams come from /api/teams-config: a project is in a team when one of the
 * team's repos has that directory name.
 */
import { useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Cell { project: string; jobClass: string; n: number }
interface Unclear { project: string; n: number; sampled?: number }
interface Example { project: string; text: string; teacher?: string }
interface Source { n: number; sampled?: number; cells: Cell[]; unclear: Unclear[]; examples: Record<string, Example[]>; files?: string[]; error?: string | null }
interface Coverage {
  days: number
  taxonomy?: { tag: string; none: string; classes: { id: string; test: string; examples: string[] }[] }
  live?: Source
  reference?: Source
  error?: string
}
interface Team { id: string; label?: string; members?: string[] }

type SourceKey = 'reference' | 'live'
const UNCLEAR = '(unclear)'
/** Projects shown as their own column; the rest fold into "other". */
const MAX_COLUMNS = 9
/** A column with fewer prompts than this is drawn faded: its shares are a handful of prompts. */
const FEW = 10

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop()?.toLowerCase() || ''
const pct = (x: number) => (x >= 0.995 ? '100%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`)

/** One sequential hue (the theme's primary), light → dark with the share; text flips to stay readable. */
function shade(share: number) {
  if (share <= 0) return {}
  const a = 0.08 + 0.82 * Math.min(1, Math.sqrt(share / 0.5))
  return { backgroundColor: `hsl(var(--primary) / ${a.toFixed(2)})`, color: a > 0.55 ? 'hsl(var(--primary-foreground))' : undefined }
}

export function CoverageMap({ proxyBase, hours }: { proxyBase: string; hours: string }) {
  const [data, setData] = useState<Coverage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [source, setSource] = useState<SourceKey>('reference')
  const [team, setTeam] = useState<string>('')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const q = hours === 'all' ? 'days=90' : `hours=${encodeURIComponent(hours)}`
    fetch(`${proxyBase}/api/job-classes/coverage?${q}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: Coverage) => { if (!cancelled) { setData(d); setError(d.error ? `The proxy could not build the coverage map: ${d.error}` : null) } })
      .catch((e: unknown) => { if (!cancelled) setError(`Coverage is not available from this proxy: ${e instanceof Error ? e.message : String(e)}`) })
    // Teams are optional: without them the map shows every project.
    fetch('/api/teams-config').then(r => (r.ok ? r.json() : null)).then(d => { if (!cancelled && d?.teams) setTeams(d.teams) }).catch(() => {})
    return () => { cancelled = true }
  }, [proxyBase, hours])

  const src = data?.[source]
  const teamProjects = useMemo(() => {
    const t = teams.find(x => x.id === team)
    return t ? new Set((t.members || []).map(base)) : null
  }, [teams, team])

  const view = useMemo(() => {
    if (!src || !data?.taxonomy) return null
    const inScope = (p: string) => !teamProjects || teamProjects.has(p.toLowerCase())
    const cells = src.cells.filter(c => inScope(c.project))
    const unclear = src.unclear.filter(u => inScope(u.project))
    const totals = new Map<string, number>()
    for (const c of cells) totals.set(c.project, (totals.get(c.project) || 0) + c.n)
    // The reference set's unclear prompts are prompts of that project too.
    if (source === 'reference') for (const u of unclear) totals.set(u.project, (totals.get(u.project) || 0) + u.n)
    const ranked = [...totals].sort((a, b) => b[1] - a[1]).map(([p]) => p)
    const shown = ranked.slice(0, ranked.length > MAX_COLUMNS ? MAX_COLUMNS - 1 : MAX_COLUMNS)
    const folded = new Set(ranked.slice(shown.length))
    const columns = [...shown, ...(folded.size ? ['other'] : [])]
    const col = (p: string) => (folded.has(p) ? 'other' : p)
    const colTotal = new Map<string, number>()
    for (const [p, n] of totals) colTotal.set(col(p), (colTotal.get(col(p)) || 0) + n)
    const all = [...totals.values()].reduce((s, n) => s + n, 0)

    const count = new Map<string, number>() // `${class}\0${column}` and `${class}\0` for the total
    const add = (cls: string, column: string, n: number) => {
      count.set(`${cls}\u0000${column}`, (count.get(`${cls}\u0000${column}`) || 0) + n)
      count.set(`${cls}\u0000`, (count.get(`${cls}\u0000`) || 0) + n)
    }
    for (const c of cells) add(c.jobClass, col(c.project), c.n)
    // Live: unclear is a rate among teacher-checked turns, not a share of all turns.
    const checked = new Map<string, number>()
    for (const u of unclear) {
      add(UNCLEAR, col(u.project), u.n)
      checked.set(col(u.project), (checked.get(col(u.project)) || 0) + (u.sampled || 0))
      checked.set('', (checked.get('') || 0) + (u.sampled || 0))
    }
    const value = (cls: string, column: string) => {
      const n = count.get(`${cls}\u0000${column}`) || 0
      const denom = source === 'live' && cls === UNCLEAR ? checked.get(column) || 0 : column ? colTotal.get(column) || 0 : all
      return { n, share: denom ? n / denom : 0, denom }
    }
    const classes = data.taxonomy.classes.map(c => c.id)
      .sort((a, b) => (count.get(`${b}\u0000`) || 0) - (count.get(`${a}\u0000`) || 0))
    return { columns, classes, value, all, folded: [...folded], colTotal }
  }, [src, data, teamProjects, source])

  const presentTeams = useMemo(() => {
    const projects = new Set((src?.cells || []).map(c => c.project.toLowerCase()))
    return teams.filter(t => (t.members || []).some(m => projects.has(base(m))))
  }, [teams, src])

  const placed = view ? view.all - (view.value('none', '').n) - (source === 'reference' ? view.value(UNCLEAR, '').n : 0) : 0
  const sel = selected && data?.taxonomy?.classes.find(c => c.id === selected)
  const selExamples = (selected && src?.examples[selected] || []).filter(e => !teamProjects || teamProjects.has(e.project.toLowerCase()))

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Coverage map</CardTitle>
            <CardDescription>
              What share of each project's prompts each class holds. The rows under the line are the gaps: prompts no
              class fits, and prompts the models could not agree on. Click a class to see what it holds.
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {(['reference', 'live'] as const).map(k => (
              <Button key={k} size="sm" variant={source === k ? 'default' : 'outline'} onClick={() => { setSource(k); setSelected(null) }}>
                {k === 'reference' ? 'Reference set' : 'Live turns'}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <div className="text-destructive">{error}</div>}
        {presentTeams.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground mr-1">Team:</span>
            <Button size="sm" variant={team === '' ? 'secondary' : 'ghost'} className="h-7" onClick={() => setTeam('')}>all projects</Button>
            {presentTeams.map(t => (
              <Button key={t.id} size="sm" variant={team === t.id ? 'secondary' : 'ghost'} className="h-7" onClick={() => setTeam(t.id)}>{t.label || t.id}</Button>
            ))}
          </div>
        )}
        {src && view && (
          <div className="text-muted-foreground">
            {source === 'reference'
              ? <>{view.all} prompts from your history, labelled twice by the teacher ({data?.taxonomy?.tag}). </>
              : <>{view.all} live turns in this window ({data?.taxonomy?.tag}), {src.sampled || 0} checked by the teacher. </>}
            {view.all > 0 && <><span className="text-foreground font-medium">{pct(placed / view.all)}</span> placed in a class{source === 'reference' ? ' both teacher passes agree on' : ''}.</>}
            {source === 'live' && view.all < 50 && ' Too few turns to read much into yet; the reference set is the fuller picture.'}
          </div>
        )}
        {view && view.all === 0 && (
          <div className="py-6 text-center text-muted-foreground">
            {source === 'reference'
              ? 'No reference set yet. Run scripts/measure-job-classes.mjs --taxonomy=config/job-classes.yaml to make one.'
              : 'No labelled turns in this window.'}
          </div>
        )}
        {view && view.all > 0 && (
          <div className="overflow-x-auto">
            <table className="border-separate" style={{ borderSpacing: 2 }}>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left font-medium pr-4 min-w-[7rem]">Class</th>
                  <th className="font-medium px-1">all</th>
                  {view.columns.map(p => (
                    <th key={p} className="font-medium px-1 whitespace-nowrap" title={p === 'other' ? view.folded.join(', ') : p}>{p}</th>
                  ))}
                </tr>
                <tr className="text-[11px] text-muted-foreground">
                  <th className="text-left font-normal pr-2">prompts</th>
                  <th className="font-normal tabular-nums">{view.all}</th>
                  {view.columns.map(p => {
                    const n = view.classes.concat('none').reduce((s, c) => s + view.value(c, p).n, 0) + (source === 'reference' ? view.value(UNCLEAR, p).n : 0)
                    return <th key={p} className="font-normal tabular-nums">{n}</th>
                  })}
                </tr>
              </thead>
              <tbody>
                {[...view.classes, '__gap__', 'none', UNCLEAR].map(cls => {
                  if (cls === '__gap__') return (
                    <tr key={cls}><td colSpan={view.columns.length + 2} className="pt-2 text-[11px] uppercase tracking-wide text-muted-foreground border-t">gaps</td></tr>
                  )
                  const label = cls === UNCLEAR ? 'unclear' : cls
                  return (
                    <tr key={cls}>
                      <td className="pr-2">
                        <button className={`text-left hover:underline ${selected === cls ? 'font-semibold' : ''}`} onClick={() => setSelected(selected === cls ? null : cls)}>{label}</button>
                      </td>
                      {['', ...view.columns].map(p => {
                        const v = view.value(cls, p)
                        const what = cls === UNCLEAR
                          ? (source === 'live' ? `${v.n} of ${v.denom} teacher-checked turns disagreed` : `${v.n} of ${v.denom} prompts the teacher labelled two ways`)
                          : `${v.n} of ${v.denom} prompts`
                        return (
                          <td key={p || 'all'} title={`${label} · ${p || 'all projects'}: ${what}`}
                            className={`text-center tabular-nums text-xs rounded px-1.5 py-1 min-w-[4.5rem] ${p === '' ? 'font-medium' : ''} ${v.n ? '' : 'text-muted-foreground/40'}`}
                            style={{ ...shade(v.share), ...(p && (view.colTotal.get(p) || 0) < FEW ? { opacity: 0.45 } : {}) }}>
                            {v.n ? pct(v.share) : '·'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {selected && (
          <div className="rounded border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{selected === UNCLEAR ? 'unclear' : selected}</Badge>
              <span className="text-muted-foreground">
                {sel ? sel.test
                  : selected === 'none' ? data?.taxonomy?.none
                    : source === 'live' ? 'Sampled turns where the teacher chose a different class than the student.'
                      : 'Prompts the teacher labelled differently in its two passes: the class boundary is not clear for them.'}
              </span>
            </div>
            {sel && sel.examples.length > 0 && (
              <div className="text-xs text-muted-foreground">Written examples: {sel.examples.map(e => `“${e}”`).join(' · ')}</div>
            )}
            <div className="text-xs font-medium pt-1">{source === 'reference' ? 'From your history' : 'From your recent turns'}</div>
            {selExamples.length === 0
              ? <div className="text-xs text-muted-foreground">No prompts of this class{team ? ' in this team' : ''}.</div>
              : (
                <ul className="space-y-1">
                  {selExamples.map((e, i) => (
                    <li key={i} className="text-xs">
                      <span className="text-muted-foreground">{e.project}{e.teacher ? ` · teacher: ${e.teacher}` : ''} — </span>{e.text}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
