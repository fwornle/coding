import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  fetchTeamsConfig, saveTeamsConfig, rescanRepos, syncSharedRepos,
  type DiscoveredRepo, type RepoRef, type TeamEntry,
} from '@/store/slices/teamsConfigSlice'
import { Badge } from '@/components/ui/badge'

/**
 * Teams — a team is a set of repos.
 *
 * Shows the repos discovery found on this machine, which teams each belongs to,
 * and the active selection that filters the knowledge viewer and insight
 * injection. Writes ~/.coding/teams.yaml through the health coordinator; the
 * shipped config/teams.yaml and config/teams/<id>.json are never edited here.
 *
 * See lib/teams/config.cjs for the layering and the membership rules.
 */

const USER_LAYER = '~/.coding/teams.yaml'

/** `/Users/me/x` → `~/x`, for display and for portable YAML. */
function tilde(p: string, home: string) {
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p
}

/** The home dir, inferred from the scan roots (the default root is $HOME). */
function homeOf(roots: string[] | undefined) {
  const r = (roots ?? []).find(x => /^\/(Users|home)\/[^/]+$/.test(x))
  return r ?? ''
}

export function TeamsPage() {
  const dispatch = useAppDispatch()
  const {
    teams, active, activeSource, discovery, repos, shared, warnings,
    loaded, loading, saving, error, lastSyncLog,
  } = useAppSelector(s => s.teamsConfig)
  const [newId, setNewId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newKind, setNewKind] = useState<'team' | 'project'>('team')

  useEffect(() => { dispatch(fetchTeamsConfig()) }, [dispatch])

  const home = homeOf(discovery?.roots)
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  const toggleActive = (id: string) => {
    const next = active.includes(id) ? active.filter(a => a !== id) : [...active, id]
    dispatch(saveTeamsConfig({ active: next }))
  }

  /**
   * Add or remove one repo from one team.
   *
   * A team with neither `repos` nor `include` contains its same-named repo
   * implicitly. The first explicit edit has to carry today's members along,
   * or adding one repo would silently drop the implicit one.
   */
  const toggleMember = (team: TeamEntry, repo: DiscoveredRepo) => {
    const implicit = !team.repos.length && !team.include.length
    let refs: RepoRef[] = implicit
      ? team.members.map(p => ({ path: tilde(p, home) }))
      : team.repos.map(r => ({ ...r, ...(r.path ? { path: tilde(r.path, home) } : {}) }))
    const isMember = repo.teams.includes(team.id)
    const samePath = (r: RepoRef) => r.path && (r.path === tilde(repo.path, home) || r.path === repo.path)
    const sameRemote = (r: RepoRef) => !r.path && r.remote && repo.learningRemote && r.remote === repo.learningRemote
    if (isMember) refs = refs.filter(r => !samePath(r) && !sameRemote(r))
    else refs = [...refs, { path: tilde(repo.path, home) }]
    dispatch(saveTeamsConfig({ teams: { [team.id]: { repos: refs } } }))
  }

  const createTeam = () => {
    const id = newId.trim().toLowerCase()
    if (!id) return
    dispatch(saveTeamsConfig({ teams: { [id]: { label: newLabel.trim() || id, kind: newKind, repos: [] } } }))
    setNewId(''); setNewLabel('')
  }

  const missingShared = shared.filter(s => s.state === 'missing').length

  return (
    <div className="max-w-5xl mx-auto px-6 py-6" data-testid="teams-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Teams</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A team is a set of repos. The active teams filter the knowledge viewer and insight
            injection. Saved to <code className="text-xs">{USER_LAYER}</code> on this machine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(loading || saving) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <button
            type="button"
            data-testid="teams-rescan"
            disabled={saving}
            onClick={() => dispatch(rescanRepos())}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent"
            title={discovery ? `Scans ${discovery.roots.map(r => tilde(r, home)).join(', ')} to depth ${discovery.depth}` : ''}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Rescan
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <div>
            <div className="font-medium">Teams configuration unavailable</div>
            <div className="text-muted-foreground">{error}</div>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="teams-warnings">
          {warnings.map(w => <div key={w}>{w}</div>)}
        </div>
      )}

      {/* Active selection */}
      <section className="mt-6">
        <div className="text-sm font-medium mb-2">Active teams</div>
        <div className="flex flex-wrap gap-2">
          {teams.map(t => (
            <button
              key={t.id}
              type="button"
              data-testid={`teams-active-${t.id}`}
              aria-pressed={active.includes(t.id)}
              disabled={saving}
              onClick={() => toggleActive(t.id)}
              className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${active.includes(t.id)
                ? 'border-primary text-foreground bg-primary/10'
                : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2" data-testid="teams-active-summary">
          {active.length ? `Showing ${active.join(', ')} · from ${activeSource}` : 'None selected — all teams are shown'}
        </p>
      </section>

      {/* Repo × team matrix */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium">Repos on this machine ({repos.length})</div>
          {discovery?.scannedAt && (
            <div className="text-xs text-muted-foreground">scanned {new Date(discovery.scannedAt).toLocaleString()}</div>
          )}
        </div>
        <div className="mt-2 rounded-md border border-border overflow-x-auto">
          <table className="w-full text-sm" data-testid="teams-matrix">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-2 font-normal">Repo</th>
                <th className="p-2 font-normal">Learning repo</th>
                {teams.map(t => <th key={t.id} className="p-2 font-normal text-center">{t.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {repos.map(r => (
                <tr key={r.path} className="border-b border-border last:border-0" data-testid={`teams-repo-${r.name}`}>
                  <td className="p-2">
                    <div className="font-medium">{r.name}{r.projectId !== r.name && <span className="text-muted-foreground"> → {r.projectId}</span>}</div>
                    <div className="text-xs text-muted-foreground">{tilde(r.path, home)}</div>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {r.learningRepo ? (r.learningRemote ? r.learningRemote.replace(/^https?:\/\//, '') : 'local only') : (r.learningRemote ? 'legacy layout' : '—')}
                  </td>
                  {teams.map(t => {
                    const on = r.teams.includes(t.id)
                    const viaInclude = on && t.include.some(g => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(r.name))
                    return (
                      <td key={t.id} className="p-2 text-center">
                        <input
                          type="checkbox"
                          data-testid={`teams-assign-${t.id}-${r.name}`}
                          checked={on}
                          disabled={saving || viaInclude}
                          title={viaInclude ? `matched by an include pattern of ${t.label}` : ''}
                          onChange={() => toggleMember(t, r)}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Teams */}
      <section className="mt-6">
        <div className="text-sm font-medium mb-2">Teams</div>
        <div className="rounded-md border border-border divide-y divide-border">
          {teams.map(t => {
            const userOwned = t.sources.includes(USER_LAYER) && !t.sources.some(s => s !== USER_LAYER)
            const remotes = t.repos.filter(r => r.remote && !r.path)
            return (
              <div key={t.id} className="p-3" data-testid={`teams-team-${t.id}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.label}</span>
                  <code className="text-xs text-muted-foreground">{t.id}</code>
                  <Badge variant="secondary" className="text-xs">{t.kind}</Badge>
                  {t.active && <Badge className="text-xs">active</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{t.members.length} repo(s)</span>
                  {userOwned && (
                    <button
                      type="button"
                      data-testid={`teams-delete-${t.id}`}
                      title="Delete this team (yours only)"
                      disabled={saving}
                      onClick={() => dispatch(saveTeamsConfig({ teams: { [t.id]: null } }))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {t.description && <div className="text-xs text-muted-foreground mt-1">{t.description}</div>}
                <div className="text-xs text-muted-foreground mt-1">
                  {!t.repos.length && !t.include.length
                    ? `Implicit: the repo named "${t.id}".`
                    : [
                        t.include.length ? `include ${t.include.join(', ')}` : '',
                        remotes.length ? `${remotes.length} shared learning repo(s)` : '',
                      ].filter(Boolean).join(' · ') || `${t.repos.length} repo(s) listed`}
                </div>
                <div className="text-xs mt-1 flex flex-wrap gap-1">
                  {t.members.map(m => (
                    <span key={m} className="px-1.5 py-0.5 rounded bg-muted">{m.split('/').pop()}</span>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="p-3 flex flex-wrap items-center gap-2">
            <input
              data-testid="teams-new-id"
              value={newId}
              onChange={e => setNewId(e.target.value)}
              placeholder="id (e.g. raas)"
              className="text-sm px-2 py-1 rounded-md border border-border bg-background w-36"
            />
            <input
              data-testid="teams-new-label"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="label"
              className="text-sm px-2 py-1 rounded-md border border-border bg-background w-44"
            />
            <select
              value={newKind}
              onChange={e => setNewKind(e.target.value as 'team' | 'project')}
              className="text-sm px-2 py-1 rounded-md border border-border bg-background"
            >
              <option value="team">team</option>
              <option value="project">project</option>
            </select>
            <button
              type="button"
              data-testid="teams-create"
              disabled={saving || !/^[a-z0-9][a-z0-9._-]*$/i.test(newId.trim())}
              onClick={createTeam}
              className="flex items-center gap-1 text-sm px-3 py-1 rounded-md border border-border hover:bg-accent disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Add team
            </button>
          </div>
        </div>
      </section>

      {/* Shared learning repos */}
      {shared.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Shared learning repos</div>
            <button
              type="button"
              data-testid="teams-sync"
              disabled={saving || missingShared === 0}
              onClick={() => dispatch(syncSharedRepos())}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> Clone {missingShared || ''} missing
            </button>
          </div>
          <div className="mt-2 rounded-md border border-border divide-y divide-border text-sm">
            {shared.map(s => (
              <div key={s.remote} className="p-2 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">{s.state}</Badge>
                <span>{s.remote}</span>
                <span className="ml-auto text-xs text-muted-foreground">{byId.get(s.team)?.label ?? s.team} · {tilde(s.path, home)}</span>
              </div>
            ))}
          </div>
          {lastSyncLog.length > 0 && (
            <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{lastSyncLog.join('\n')}</pre>
          )}
        </section>
      )}

      {!loaded && !error && <div className="mt-6 text-sm text-muted-foreground">Loading…</div>}
    </div>
  )
}
