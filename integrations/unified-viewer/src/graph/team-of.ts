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
