/**
 * Token Usage → Classes → Coverage map: which job classes exist, and how they
 * cover the prompts of each project (or of one team's projects).
 *
 * One row per class of the committed taxonomy, one column per project; a cell is
 * the share of that project's prompts the class holds, so a column reads as "what
 * kind of work happens here". Two rows below the line are where the taxonomy has
 * gaps: `none` (no class fits the prompt) and `unclear` (the models disagree on
 * which class it is). Classes are folded into the taxonomy's groups
 * (programming, operating, communicating): a group row is the sum of its
 * classes and opens to show them. Clicking a class shows its definition next to
 * real prompts it was given.
 *
 * Two layouts over the same numbers: a TREE (all prompts → groups → classes,
 * plus the gaps, each with its share: the taxonomy at a glance) and the MAP
 * (classes × projects). Team filter, source and the selected class are shared.
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
import { ChevronDown, ChevronRight } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Cell { project: string; jobClass: string; n: number }
interface Unclear { project: string; n: number; sampled?: number }
interface Example { project: string; text: string; teacher?: string }
interface Source { n: number; sampled?: number; cells: Cell[]; unclear: Unclear[]; examples: Record<string, Example[]>; files?: string[]; error?: string | null }
interface Coverage {
  days: number
  taxonomy?: {
    tag: string; none: string
    groups?: { id: string; label: string; description: string }[]
    classes: { id: string; test: string; examples: string[]; group?: string }[]
  }
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
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [layout, setLayout] = useState<'tree' | 'map'>('tree')
  const toggle = (g: string) => setOpen(prev => { const next = new Set(prev); if (next.has(g)) next.delete(g); else next.add(g); return next })

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
    // Groups in the taxonomy's declared order (a fixed order reads the same in
    // every project); a class with no group stays a top-level row after them.
    const groupOf = new Map(data.taxonomy.classes.map(c => [c.id, c.group || '']))
    const groups = (data.taxonomy.groups || []).map(g => ({ ...g, classes: classes.filter(c => groupOf.get(c) === g.id) }))
      .filter(g => g.classes.length)
    const ungrouped = classes.filter(c => !groups.some(g => g.classes.includes(c)))
    const groupValue = (members: string[], column: string) => {
      const n = members.reduce((s, c) => s + value(c, column).n, 0)
      const denom = column ? colTotal.get(column) || 0 : all
      return { n, share: denom ? n / denom : 0, denom }
    }
    return { columns, classes, groups, ungrouped, value, groupValue, all, folded: [...folded], colTotal }
  }, [src, data, teamProjects, source])

  const presentTeams = useMemo(() => {
    const projects = new Set((src?.cells || []).map(c => c.project.toLowerCase()))
    return teams.filter(t => (t.members || []).some(m => projects.has(base(m))))
  }, [teams, src])

  const placed = view ? view.all - (view.value('none', '').n) - (source === 'reference' ? view.value(UNCLEAR, '').n : 0) : 0
  const sel = selected && data?.taxonomy?.classes.find(c => c.id === selected)
  const selGroup = selected?.startsWith('group:') ? view?.groups.find(g => `group:${g.id}` === selected) : undefined
  const selExamples = (selected && src?.examples[selected] || []).filter(e => !teamProjects || teamProjects.has(e.project.toLowerCase()))

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Taxonomy and coverage</CardTitle>
            <CardDescription>
              The classes, grouped, and what share of your prompts each one holds; the map splits that by project. The
              gaps are prompts no class fits and prompts the models could not agree on. Click a class to see what it
              holds.
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {(['tree', 'map'] as const).map(k => (
              <Button key={k} size="sm" variant={layout === k ? 'secondary' : 'ghost'} onClick={() => setLayout(k)}>{k === 'tree' ? 'Tree' : 'Map'}</Button>
            ))}
            <span className="w-2" />
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
        {view && view.all > 0 && layout === 'tree' && (
          <TaxonomyTree view={view} source={source} selected={selected} onSelect={setSelected} />
        )}
        {view && view.all > 0 && layout === 'map' && (
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
                {[
                  ...view.groups.flatMap(g => [{ kind: 'group' as const, id: g.id, label: g.label, members: g.classes },
                    ...(open.has(g.id) ? g.classes.map(c => ({ kind: 'class' as const, id: c, label: c, members: [c], nested: true })) : [])]),
                  ...view.ungrouped.map(c => ({ kind: 'class' as const, id: c, label: c, members: [c], nested: false })),
                  { kind: 'gap' as const, id: '__gap__', label: '', members: [] },
                  { kind: 'class' as const, id: 'none', label: 'none', members: ['none'], nested: false },
                  { kind: 'class' as const, id: UNCLEAR, label: 'unclear', members: [UNCLEAR], nested: false },
                ].map(row => {
                  if (row.kind === 'gap') return (
                    <tr key={row.id}><td colSpan={view.columns.length + 2} className="pt-2 text-[11px] uppercase tracking-wide text-muted-foreground border-t">gaps</td></tr>
                  )
                  const cls = row.id
                  const label = row.label
                  const isGroup = row.kind === 'group'
                  return (
                    <tr key={`${row.kind}:${cls}`}>
                      <td className={`pr-2 ${'nested' in row && row.nested ? 'pl-5' : ''}`}>
                        {isGroup ? (
                          <button className={`flex items-center gap-1 text-left font-medium hover:underline ${selected === `group:${cls}` ? 'underline' : ''}`}
                            onClick={() => { toggle(cls); setSelected(`group:${cls}`) }} aria-expanded={open.has(cls)}>
                            {open.has(cls) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{label}
                          </button>
                        ) : (
                          <button className={`text-left hover:underline ${'nested' in row && row.nested ? 'text-muted-foreground' : ''} ${selected === cls ? 'font-semibold text-foreground' : ''}`}
                            onClick={() => setSelected(selected === cls ? null : cls)}>{label}</button>
                        )}
                      </td>
                      {['', ...view.columns].map(p => {
                        const v = isGroup ? view.groupValue(row.members, p) : view.value(cls, p)
                        const what = isGroup
                          ? `${v.n} of ${v.denom} prompts (${row.members.join(', ')})`
                          : cls === UNCLEAR
                          ? (source === 'live' ? `${v.n} of ${v.denom} teacher-checked turns disagreed` : `${v.n} of ${v.denom} prompts the teacher labelled two ways`)
                          : `${v.n} of ${v.denom} prompts`
                        return (
                          <td key={p || 'all'} title={`${label} · ${p || 'all projects'}: ${what}`}
                            className={`text-center tabular-nums text-xs rounded px-1.5 py-1 min-w-[4.5rem] ${p === '' || isGroup ? 'font-medium' : ''} ${v.n ? '' : 'text-muted-foreground/40'}`}
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
        {selGroup && (
          <div className="rounded border p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{selGroup.label}</Badge>
              <span className="text-muted-foreground">{selGroup.description}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Classes: {selGroup.classes.map(c => `${c} (${pct(view!.value(c, '').share)})`).join(' · ')}. Open a class for its definition and prompts.
            </div>
          </div>
        )}
        {selected && !selGroup && (
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

interface Share { n: number; share: number; denom: number }
interface TreeView {
  all: number
  groups: { id: string; label: string; description: string; classes: string[] }[]
  ungrouped: string[]
  value: (cls: string, column: string) => Share
  groupValue: (members: string[], column: string) => Share
}

/** A share as a bar on one scale (100% = the whole row), so siblings compare by length. */
function Bar({ share, strong }: { share: number; strong?: boolean }) {
  return (
    <div className="h-2.5 w-40 rounded-sm bg-muted overflow-hidden shrink-0">
      <div className="h-full rounded-sm" style={{ width: `${Math.max(share > 0 ? 1.5 : 0, share * 100)}%`, backgroundColor: `hsl(var(--primary) / ${strong ? 0.85 : 0.5})` }} />
    </div>
  )
}

/**
 * The taxonomy as a tree: all prompts → groups → classes, then the gaps. Every
 * share is of all prompts in view (a class's share of its group is in the
 * tooltip), so a class bar and a group bar are on the same scale. Rows are flat,
 * with the tree drawn as connector glyphs in a fixed-width label, so bars and
 * percentages line up at every depth.
 */
function TaxonomyTree({ view, source, selected, onSelect }: { view: TreeView; source: SourceKey; selected: string | null; onSelect: (s: string | null) => void }) {
  type Row = { id: string; label: string; v: Share; prefix: string; strong?: boolean; muted?: boolean; title?: string; heading?: boolean }
  const rows: Row[] = [{ id: 'all', label: 'all prompts', v: { n: view.all, share: 1, denom: view.all }, prefix: '', strong: true }]
  const tops: { label: string; id: string; v: Share; title?: string; children: Row[]; heading?: boolean }[] = [
    ...view.groups.map(g => {
      const gv = view.groupValue(g.classes, '')
      return { id: `group:${g.id}`, label: g.label, v: gv, title: g.description,
        children: g.classes.map(c => { const v = view.value(c, ''); return { id: c, label: c, v, prefix: '', title: `${pct(gv.n ? v.n / gv.n : 0)} of ${g.label}` } }) }
    }),
    ...view.ungrouped.map(c => ({ id: c, label: c, v: view.value(c, ''), children: [] })),
  ]
  const unclear = view.value(UNCLEAR, '')
  tops.push({ id: '__gaps__', label: 'gaps', v: { n: 0, share: 0, denom: 0 }, heading: true, children: [
    { id: 'none', label: 'none', v: view.value('none', ''), prefix: '', muted: true, title: 'No class fits the prompt' },
    { id: UNCLEAR, label: 'unclear', v: unclear, prefix: '', muted: true,
      title: source === 'live' ? `of ${unclear.denom} teacher-checked turns, the teacher chose otherwise` : 'the teacher labelled these two ways' },
  ] })
  tops.forEach((t, i) => {
    const last = i === tops.length - 1
    rows.push({ id: t.id, label: t.label, v: t.v, prefix: last ? '└─ ' : '├─ ', strong: !t.heading, title: t.title, heading: t.heading })
    t.children.forEach((c, j) => rows.push({ ...c, prefix: `${last ? '\u00a0\u00a0\u00a0' : '│\u00a0\u00a0'}${j === t.children.length - 1 ? '└─ ' : '├─ '}` }))
  })
  return (
    <div className="text-sm">
      {rows.map(r => {
        const clickable = r.id !== 'all' && !r.heading
        const body = (
          <>
            <span className={`w-56 shrink-0 truncate whitespace-pre ${r.strong ? 'font-medium' : ''} ${r.muted || r.heading ? 'text-muted-foreground' : ''} ${r.heading ? 'text-[11px] uppercase tracking-wide' : ''}`}>
              <span className="font-mono text-muted-foreground/60">{r.prefix}</span>{r.label}
            </span>
            {!r.heading && <>
              <Bar share={r.v.share} strong={r.strong} />
              <span className={`w-12 text-right tabular-nums ${r.strong ? 'font-medium' : ''}`}>{pct(r.v.share)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{r.v.n}</span>
            </>}
          </>
        )
        return clickable
          ? <button key={r.id} title={r.title} onClick={() => onSelect(selected === r.id ? null : r.id)}
              className={`flex w-full items-center gap-3 rounded px-1.5 py-0.5 text-left hover:bg-muted/60 ${selected === r.id ? 'bg-muted' : ''}`}>{body}</button>
          : <div key={r.id} className="flex items-center gap-3 px-1.5 py-0.5">{body}</div>
      })}
      {source === 'live' && <div className="mt-2 text-xs text-muted-foreground">Live: "unclear" is a share of the teacher-checked turns, not of all turns.</div>}
    </div>
  )
}
