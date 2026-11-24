/**
 * Token Usage → Classes → Gate → "Team contributions": what is in the team's
 * shared classes repo (`job-classes/gate/` beside `taxonomy.yaml`), one row per
 * published member file — who (a pseudonym; this machine's coding and glass are
 * named), which install published it (`source`), how fresh it is, and its
 * counts — and which of them THIS machine adds up.
 *
 * The checkboxes set this machine's exclude list (rapid-llm-proxy gate-pool.mjs
 * readGateExclude; PUT /api/job-classes/gate-exclude on the proxy, or glass's
 * daemon in glass). Local only: unticking a member changes this machine's Gate
 * panel, its sampling and its class routing, never the repo or a teammate's
 * view. The same component is glass's (glass-ui builds this dashboard source).
 */
import { Fragment, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { memberName, type Team, type TeamMember, type TeamPoolSum } from './team-members'

const pct = (agree: number, checked: number) => (checked ? `${((agree / checked) * 100).toFixed(0)}%` : '—')
const poolKey = (p: { taxonomy: string; labeller: string; checker: string }) => `${p.taxonomy}|${p.labeller}|${p.checker}`

function ago(iso?: string) {
  if (!iso) return ''
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

export function TeamContributions({ team, addedPool, proxyBase, onChanged }: {
  team: Team
  /** The pool the Gate panel adds up (GateProgress teamPool). */
  addedPool: TeamPoolSum | null
  proxyBase: string
  onChanged: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const excluded = useMemo(() => team.members.filter(m => m.excluded).map(m => m.member), [team])
  const addedKey = addedPool ? poolKey(addedPool) : ''
  const counted = team.members.filter(m => !m.excluded && !m.stale && !m.error).length

  const toggle = async (m: TeamMember, include: boolean) => {
    if (!team.name) { setError('this team has no name to store the choice under'); return }
    const next = include ? excluded.filter(id => id !== m.member) : [...excluded, m.member]
    setBusy(m.member)
    setError(null)
    try {
      const res = await fetch(`${proxyBase}/api/job-classes/gate-exclude`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: team.name, exclude: next }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || out?.error) throw new Error(out?.error || `save failed (HTTP ${res.status})`)
      await onChanged()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const flip = (id: string) => setExpanded(prev => {
    const s = new Set(prev)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    return s
  })

  return (
    <>
      <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)} data-testid="team-contributions-open">
        Team contributions ({team.members.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto" data-testid="team-contributions">
          <DialogHeader>
            <DialogTitle>Team contributions{team.name ? <> · <span className="font-mono">{team.name}</span></> : null}</DialogTitle>
            <DialogDescription>
              What the team&apos;s shared classes repo holds: one file per member and install, with per-class counts and never a
              prompt. Members are pseudonyms; this machine&apos;s coding and glass are named. Untick a row to leave it out of{' '}
              <span className="font-medium">this machine&apos;s</span> sums (Gate panel, sampling, class routing). Nothing in the
              repo or in a teammate&apos;s view changes.
            </DialogDescription>
          </DialogHeader>

          <div className="text-xs text-muted-foreground" data-testid="team-contributions-summary">
            {team.gateDir && <div>Files: <span className="font-mono">{team.gateDir}</span></div>}
            <div>
              {counted} of {team.members.length} counted
              {addedPool && <> · added up: {addedPool.labeller}{addedPool.checker ? ` checked by ${addedPool.checker}` : ''}, <span className="font-mono">{addedPool.taxonomy}</span></>}
            </div>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">Counted</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Published</TableHead>
                <TableHead className="text-right">Labelled</TableHead>
                <TableHead className="text-right">Checked</TableHead>
                <TableHead className="text-right">Agreed</TableHead>
                <TableHead>Pools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members.map(m => {
                const t = m.totals ?? { labelled: 0, checked: 0, agree: 0 }
                const open = expanded.has(m.member)
                const pools = m.detail ?? []
                const note = m.error ? 'unreadable: never added' : m.stale ? 'older than 14 days: not added' : ''
                return (
                  <Fragment key={m.member}>
                    <TableRow data-testid={`team-member-${m.member}`} className={m.excluded || m.stale || m.error ? 'opacity-60' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={!m.excluded}
                          disabled={!!m.error || busy !== null || !team.name}
                          onCheckedChange={(v) => void toggle(m, v === true)}
                          aria-label={`count ${m.member}`}
                          data-testid={`team-include-${m.member}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{memberName(m)}</div>
                        <div className="font-mono text-xs text-muted-foreground">{m.member}{m.self ? ' · this view' : ''}</div>
                      </TableCell>
                      <TableCell>
                        {m.source ? <Badge variant="secondary">{m.source}</Badge> : <span className="text-xs text-muted-foreground" title="published before files named their source">unknown</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {m.live ? 'live' : m.error ? '—' : ago(m.publishedAt)}
                        {note && <div className="text-xs text-muted-foreground">{note}</div>}
                        {m.excluded && <div className="text-xs text-muted-foreground">left out on this machine</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.error ? '—' : t.labelled}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.error ? '—' : t.checked}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.error ? '—' : `${t.agree} (${pct(t.agree, t.checked)})`}</TableCell>
                      <TableCell className="text-xs whitespace-normal min-w-[13rem]">
                        {m.error ? <span className="text-destructive" title={m.error}>{m.error.slice(0, 60)}</span> : (
                          <button type="button" className="underline-offset-2 hover:underline text-left" onClick={() => flip(m.member)} data-testid={`team-detail-${m.member}`}>
                            {pools.map(p => (
                              <div key={poolKey(p)}>
                                {p.labeller}{p.checker && p.checker !== p.labeller ? ` → ${p.checker}` : ''}
                                {poolKey(p) === addedKey ? '' : ' · other pool, not added'}
                              </div>
                            ))}
                            <span className="text-muted-foreground">{open ? 'hide classes' : 'per class…'}</span>
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                    {open && pools.map(p => (
                      <TableRow key={`${m.member}|${poolKey(p)}`} className="bg-muted/30" data-testid={`team-classes-${m.member}`}>
                        <TableCell />
                        <TableCell colSpan={7}>
                          <div className="text-xs text-muted-foreground mb-1">
                            {p.labeller}{p.checker ? ` checked by ${p.checker}` : ''} · <span className="font-mono">{p.taxonomy}</span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-0.5 text-xs tabular-nums">
                            {Object.entries(p.classes).map(([id, c]) => (
                              <div key={id} className="flex justify-between gap-2">
                                <span className="font-medium">{id}</span>
                                <span>{c.labelled} · {c.checked} · {c.agree} ({pct(c.agree, c.checked)})</span>
                              </div>
                            ))}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1">labelled · checked · agreed</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  )
}
