// Role classification + a plain-English glossary for the processes that appear in
// a run's timeline. The Performance timeline mixes three very different kinds of
// activity under opaque process names; this module turns each process into a
// human-readable label, a role, and a one-line explanation so a reader can follow
// what the run actually did (and compare two runs by role).

import type { Run, TimelineRow } from '@/store/slices/performanceSlice'
import { normalizeModel } from './models'

export type Role = 'foreground' | 'knowledge' | 'infrastructure'

export interface RoleMeta {
  label: string
  blurb: string
  // Tailwind classes for the role's accent stripe, badge, and legend swatch.
  stripe: string
  badge: string
  swatch: string
}

// Ordered so lanes and the story summary render foreground → knowledge → infra.
export const ROLE_ORDER: Role[] = ['foreground', 'knowledge', 'infrastructure']

export const ROLE_META: Record<Role, RoleMeta> = {
  foreground: {
    label: 'Foreground development',
    blurb: 'The run under test — the coding agent’s own turns and the task’s direct model calls.',
    stripe: 'border-l-primary',
    badge: 'border-primary/40 bg-primary/10 text-primary',
    swatch: 'bg-primary',
  },
  knowledge: {
    label: 'Knowledge capture',
    blurb: 'The knowledge-management pipeline recording and consolidating what happened.',
    stripe: 'border-l-violet-500/60',
    badge: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
    swatch: 'bg-violet-500/70',
  },
  infrastructure: {
    label: 'Infrastructure',
    blurb: 'Background plumbing — health probes and housekeeping, not part of the work product.',
    stripe: 'border-l-amber-500/50',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    swatch: 'bg-amber-500/60',
  },
}

// Per-process human labels + explanations. Keys are matched by exact process name
// or by prefix (checked in roleForProcess/processMeta). The task's own process is
// resolved dynamically against the Run, so it is not listed here.
interface ProcessEntry {
  match: RegExp
  role: Role
  label: string
  blurb: string
}

const PROCESS_GLOSSARY: ProcessEntry[] = [
  {
    match: /^token-adapter-/,
    role: 'foreground',
    label: 'Coding agent',
    blurb: 'The foreground coding agent’s own LLM turns, captured from its session transcript.',
  },
  {
    match: /^observation-writer/,
    role: 'knowledge',
    label: 'Observation writer',
    blurb: 'Writes a structured observation summarizing each development turn (intent + files touched).',
  },
  {
    match: /^consolidator-digest/,
    role: 'knowledge',
    label: 'Digest consolidator',
    blurb: 'Summarizes a batch of raw observations into a compact digest.',
  },
  {
    match: /^consolidator-insight/,
    role: 'knowledge',
    label: 'Insight consolidator',
    blurb: 'Extracts higher-level, reusable insights from observations and digests.',
  },
  {
    match: /^consolidator/,
    role: 'knowledge',
    label: 'Consolidator',
    blurb: 'Consolidates observations into higher-level knowledge artifacts.',
  },
  {
    match: /^(wave-analysis|kg-|persistence-)/,
    role: 'knowledge',
    label: 'Knowledge graph',
    blurb: 'Builds and persists the project knowledge graph from analyzed sessions.',
  },
  {
    match: /^health-coordinator/,
    role: 'infrastructure',
    label: 'Health probe',
    blurb: 'Periodic service-health check — a liveness ping, unrelated to the work product.',
  },
  {
    match: /^(llm-proxy|proxy-)/,
    role: 'infrastructure',
    label: 'Proxy housekeeping',
    blurb: 'LLM-proxy internal bookkeeping.',
  },
]

export interface ProcessMeta {
  role: Role
  label: string
  blurb: string
}

// Resolve a process name to its role + human label + explanation, relative to a
// run (so the run's own task process is recognised as foreground).
export function processMeta(process: string | null | undefined, run: Run | null): ProcessMeta {
  const proc = (process ?? '').trim()
  if (!proc) {
    return { role: 'foreground', label: '—', blurb: 'Unlabelled turn.' }
  }
  // The measured task's own direct proxy calls.
  if (run?.task_id && proc === run.task_id) {
    return {
      role: 'foreground',
      label: 'Task calls',
      blurb: 'Direct LLM calls the measured task itself made through the proxy.',
    }
  }
  for (const e of PROCESS_GLOSSARY) {
    if (e.match.test(proc)) return { role: e.role, label: e.label, blurb: e.blurb }
  }
  // The canonical foreground agent, if named differently.
  if (run?.canonical_agent && proc === run.canonical_agent) {
    return { role: 'foreground', label: proc, blurb: 'The foreground chat agent.' }
  }
  // Unknown process → treat as foreground work rather than hiding it.
  return { role: 'foreground', label: proc, blurb: 'Unrecognised process — shown as foreground.' }
}

export function roleForProcess(process: string | null | undefined, run: Run | null): Role {
  return processMeta(process, run).role
}

// Per-role rollup of a run's timeline rows: turn count, total tokens, and the
// distinct (normalized) models used in that role. Shared by the timeline story
// summary and the run-comparison view so both compute roles identically.
export interface RoleStat {
  role: Role
  turns: number
  totalTokens: number
  // Prompt-cache tokens, kept SEPARATE from totalTokens (which is input+output). A heavily
  // cached run (e.g. claude) is dominated by cacheRead/cacheWrite; showing them separately
  // explains why its input+output total looks small.
  cacheRead: number
  cacheWrite: number
  models: string[]
}

const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : 0)

export function summarizeByRole(rows: TimelineRow[], run: Run | null): RoleStat[] {
  const acc: Record<Role, { turns: number; totalTokens: number; cacheRead: number; cacheWrite: number; models: Set<string> }> = {
    foreground: { turns: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, models: new Set() },
    knowledge: { turns: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, models: new Set() },
    infrastructure: { turns: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, models: new Set() },
  }
  for (const r of rows) {
    const role = roleForProcess(r.process, run)
    acc[role].turns += 1
    acc[role].totalTokens += num(r.total_tokens)
    acc[role].cacheRead += num(r.cache_read_tokens)
    acc[role].cacheWrite += num(r.cache_write_tokens)
    const m = normalizeModel(r.model)
    if (m) acc[role].models.add(m)
  }
  return ROLE_ORDER.map((role) => ({
    role,
    turns: acc[role].turns,
    totalTokens: acc[role].totalTokens,
    cacheRead: acc[role].cacheRead,
    cacheWrite: acc[role].cacheWrite,
    models: [...acc[role].models],
  }))
}
