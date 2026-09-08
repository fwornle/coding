// Grouping for the "Teams / Views" rail.
//
// The rail used to be one checkbox per distinct `metadata.team` value. That is
// an unbounded list: every kgbench run mints a fresh `kgbench-tree-<id>` team
// (one per sandbox worktree), and any agent session run somewhere new adds
// another. Twenty-five rows and climbing, with the five teams that actually
// matter buried among them.
//
// So the rows are grouped three ways:
//
//   Projects — registry entries with kind 'project' (bodies of work)
//   Teams    — registry entries with kind 'team' (owners)
//   Views    — everything else: created by whoever wrote observations there
//
// The Projects/Teams split is not cosmetic. src/knowledge-management/types.ts
// states the contract on TeamOntologyConfig: teams are owners, projects are
// bodies of work, and the viewer must not present them as though they were the
// same thing.
//
// Registry entries render even at count 0 — RaaS has no entities yet, and a
// registry that hides its own members until data arrives is not a registry.
// Views are count-driven by definition: a view with no entities does not exist.
//
// Pure and dependency-free so the shape is unit-testable without a DOM.

import type { TeamRegistry, ViewGroupRule } from '@/api/ApiClient'

/** Group ids are stable — tests and e2e specs address rows through them. */
export const PROJECTS_GROUP = 'projects'
export const TEAMS_GROUP = 'teams'
export const VIEWS_GROUP = 'views'

export interface TeamRow {
  /** The `metadata.team` value; what goes into the store's selectedTeams set. */
  id: string
  /** Display name — the registry's spelling when there is one, else the raw id. */
  label: string
  count: number
}

export interface TeamGroup {
  id: string
  label: string
  rows: TeamRow[]
  /** Nested clusters (only Views has these today, e.g. Kgbench). */
  subgroups: TeamGroup[]
  /** Entity count across this group's own rows AND every subgroup's. */
  total: number
  /** Team ids in this group and everything below it — drives group all/none. */
  memberIds: string[]
}

function byLabel(a: { label: string }, b: { label: string }) {
  return a.label.localeCompare(b.label)
}

function finish(id: string, label: string, rows: TeamRow[], subgroups: TeamGroup[]): TeamGroup {
  rows.sort(byLabel)
  subgroups.sort(byLabel)
  const total =
    rows.reduce((n, r) => n + r.count, 0) + subgroups.reduce((n, g) => n + g.total, 0)
  const memberIds = [...rows.map((r) => r.id), ...subgroups.flatMap((g) => g.memberIds)]
  return { id, label, rows, subgroups, total, memberIds }
}

/**
 * Compile a view-group rule, dropping any whose regex will not build.
 *
 * The server already rejects those, but the rail must not blank out if an older
 * obs-api serves a rule this build cannot compile — same fail-open reasoning as
 * the loader itself.
 */
function compileRules(rules: readonly ViewGroupRule[]): Array<{ rule: ViewGroupRule; re: RegExp }> {
  const out: Array<{ rule: ViewGroupRule; re: RegExp }> = []
  for (const rule of rules) {
    try {
      out.push({ rule, re: new RegExp(rule.match, 'i') })
    } catch {
      // Unusable rule — its members fall through to ungrouped view rows.
    }
  }
  return out
}

/**
 * Build the three-group tree.
 *
 * @param counts entity count per `metadata.team`, as found in the loaded graph
 * @param registry the config-driven predefined entries + view-grouping rules
 * @returns Projects, Teams, Views — in that order. A group with no rows and no
 *   subgroups is omitted, so an empty registry yields Views alone (the
 *   historical flat behaviour, just wrapped in one node).
 */
export function buildTeamGroups(
  counts: ReadonlyMap<string, number>,
  registry: TeamRegistry,
): TeamGroup[] {
  const registered = new Map(registry.teams.map((t) => [t.id, t]))

  const projectRows: TeamRow[] = []
  const teamRows: TeamRow[] = []
  for (const entry of registry.teams) {
    const row: TeamRow = { id: entry.id, label: entry.label, count: counts.get(entry.id) ?? 0 }
    ;(entry.kind === 'project' ? projectRows : teamRows).push(row)
  }

  // Views: every counted team with no registry entry.
  const rules = compileRules(registry.viewGroups)
  const subRows = new Map<string, TeamRow[]>()
  const looseRows: TeamRow[] = []

  for (const [id, count] of counts) {
    if (registered.has(id)) continue
    const row: TeamRow = { id, label: id, count }
    // First matching rule wins — rules are an ordered list, not a set.
    const hit = rules.find(({ re }) => re.test(id))
    if (hit) {
      const bucket = subRows.get(hit.rule.id)
      if (bucket) bucket.push(row)
      else subRows.set(hit.rule.id, [row])
    } else {
      looseRows.push(row)
    }
  }

  // Preserve rule order for the subgroups themselves, so a config reorder is
  // visible. `finish` sorts subgroups by label, so build them pre-sorted only
  // for determinism of the rows inside.
  const subgroups: TeamGroup[] = []
  for (const { rule } of rules) {
    const rows = subRows.get(rule.id)
    if (rows && rows.length > 0) subgroups.push(finish(rule.id, rule.label, rows, []))
  }

  const groups: TeamGroup[] = []
  if (projectRows.length > 0) groups.push(finish(PROJECTS_GROUP, 'Projects', projectRows, []))
  if (teamRows.length > 0) groups.push(finish(TEAMS_GROUP, 'Teams', teamRows, []))
  if (looseRows.length > 0 || subgroups.length > 0) {
    groups.push(finish(VIEWS_GROUP, 'Views', looseRows, subgroups))
  }
  return groups
}

/** Every team id the rail can show — the "all" set for the sentinel dance. */
export function allTeamIds(groups: readonly TeamGroup[]): string[] {
  return groups.flatMap((g) => g.memberIds)
}
