/**
 * The team view's shapes (rapid-llm-proxy gate-pool.mjs teamPool, as `summary?scope=team`
 * returns it) and how a member is named. Shared by GateProgress and TeamContributions.
 */
export interface PoolCounts { labelled: number; checked: number; agree: number }
export interface MemberPool { taxonomy: string; labeller: string; checker: string; classes: Record<string, PoolCounts> }
export interface TeamMember {
  member: string
  self?: boolean
  live?: boolean
  publishedAt?: string
  stale?: boolean
  error?: string
  source?: string
  thisMachine?: boolean
  excluded?: boolean
  totals?: PoolCounts
  detail?: MemberPool[]
}
export interface TeamPoolSum { taxonomy: string; labeller: string; checker: string; members: string[]; local: boolean; classes: Record<string, PoolCounts> }
export interface Team { gateDir: string | null; self: string; name?: string; members: TeamMember[]; pools: TeamPoolSum[] }

/** Who a member file is, in words: this machine's installs are named. */
export function memberName(m: TeamMember) {
  if (m.thisMachine) return `This machine · ${m.source || (m.self ? 'this install' : 'other install')}`
  return 'Teammate'
}
