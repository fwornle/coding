// PATTERN SOURCE: integrations/system-health-dashboard/src/lib/config.ts:10-19
//   (env-var-with-fallback idiom — shifted from process.env to import.meta.env per Vite-canonical)
// CONTRACT SOURCE: D-45-02 (45-CONTEXT.md lines 51-67), AMENDED by D-55-01a/b (55-CONTEXT.md lines 76-84)
//
// Phase 45 multi-base-URL routing — Phase 55 amendments:
//   - D-55-01a: `okb` retargeted from semantic-analysis (:3848, coding KG)
//     to OKM Express (:8090, OKM data). Phase 45's mapping silently showed
//     the coding KG when the user clicked the OKB tab.
//   - D-55-01b: `cap` removed entirely (URL was hallucinated; the unified
//     viewer is now a 2-system viewer).
//
// Each system slug maps to the backend ApiClient should hit. Dev override
// via Vite env vars: VITE_BACKEND_CODING_URL / VITE_BACKEND_OKB_URL.
//
// NOTE on env-access: Vite expects `import.meta.env.VITE_*` at build time;
// `process.env.*` would silently be undefined in the browser bundle (Pitfall 4).

export type System = 'coding' | 'okb'

export const VALID_SYSTEMS: readonly System[] = ['coding', 'okb'] as const

export const SYSTEM_ENDPOINTS: Record<System, string> = {
  coding: import.meta.env.VITE_BACKEND_CODING_URL ?? 'http://localhost:12436',
  okb:    import.meta.env.VITE_BACKEND_OKB_URL    ?? 'http://localhost:8090',
} as const

export const SYSTEM_LABELS: Record<System, string> = {
  coding: 'Coding',
  okb: 'OKB',
} as const

/** Type guard — narrows a string to `System` if it matches one of the two slugs. */
export function isValidSystem(s: string | undefined): s is System {
  return s === 'coding' || s === 'okb'
}
