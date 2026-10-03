// Which team (tenant) a node belongs to — one rule, used everywhere.
//
// The viewer had THREE answers to this question and they disagreed:
//
//   - the Teams rail counted rows by `metadata.team`, falling back to 'coding'
//   - the Sigma canvas filtered by `metadata.project ?? metadata.team`
//   - the D3 canvas filtered by `metadata.team`, falling back to 'coding'
//
// So the rail's counts were not what a click on it showed. Measured on the
// live coding KB (2,938 entities, 2026-10-02): 623 carry `project` and no
// `team`, so the rail filed all of them under 'coding' while the Sigma filter
// matched them by project — the a2a-xpr row read 98 and selected 244. Ten more
// carry both, with `team: 'general'` and a real project.
//
// `project` wins because it is the newer, typeguarded stamp (km-core
// isProject); `team` is the legacy field it was added next to. An entity with
// neither belongs to the INSTALLATION's tenant — served by obs-api as
// `/api/teams .scope` — and not to 'coding', which was only ever true on the
// developer's own machine. Without a scope (OKB backend, registry unreachable,
// unconfigured install) it is UNTAGGED_TEAM, which says what is known instead
// of guessing a tenant.

/** Minimal shape — anything with metadata. Both Entity variants satisfy it. */
export interface TeamedNode {
  metadata?: Record<string, unknown> | null
}

/** The row an entity with no team, no project and no known scope lands in. */
export const UNTAGGED_TEAM = 'untagged'

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * The team id an entity is counted and filtered under.
 *
 * @param scope the installation's tenant (`/api/teams .scope`), or null when
 *   unknown — then an untagged entity is UNTAGGED_TEAM.
 */
export function teamOf(e: TeamedNode, scope: string | null): string {
  const meta = e.metadata ?? undefined
  return nonEmpty(meta?.project) ?? nonEmpty(meta?.team) ?? scope ?? UNTAGGED_TEAM
}

/** Per team id, the project ids it covers (`/api/teams .teams[].projects`). */
export type TeamProjects = Readonly<Record<string, readonly string[]>>

let lastSel: ReadonlySet<string> | null = null
let lastMap: TeamProjects | null | undefined = null
let lastOut: ReadonlySet<string> = new Set()

/**
 * The selection as the set of (lowercased) team values it admits: every
 * selected id, plus — for a selected registry team — the projects it covers.
 * A team is a set of repos (T5/T6), so selecting `raas` must admit entities
 * learned in `raas-api`; the server's `?teams=` filter expands the same way
 * (lib/teams/scope.mjs). Memoised on identity: the predicates call this per
 * entity with the same two objects.
 */
export function expandTeamSelection(
  selected: ReadonlySet<string>,
  teamProjects: TeamProjects | null | undefined,
): ReadonlySet<string> {
  if (selected === lastSel && teamProjects === lastMap) return lastOut
  const out = new Set<string>()
  for (const id of selected) {
    out.add(id.toLowerCase())
    for (const p of teamProjects?.[id] ?? []) out.add(p.toLowerCase())
  }
  lastSel = selected
  lastMap = teamProjects
  lastOut = out
  return out
}

/** Whether an entity's team value passes a (non-empty, non-`__none__`) selection. */
export function teamSelected(
  team: string,
  selected: ReadonlySet<string>,
  teamProjects: TeamProjects | null | undefined,
): boolean {
  return expandTeamSelection(selected, teamProjects).has(team.toLowerCase())
}
