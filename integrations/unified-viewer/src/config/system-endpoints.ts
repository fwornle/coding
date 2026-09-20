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

// 127.0.0.1, not `localhost`. These are loopback-only services, and naming
// them by hostname puts a name-resolution and proxy-policy step in front of a
// socket that never leaves the machine. On this machine that step failed:
// Chrome hung forever on http://localhost:12436 while reaching BOTH
// http://127.0.0.1:12436 and http://[::1]:12436 in ~2ms, so the viewer's
// graph queries were never issued and it sat on "Loading coding graph… ·
// Showing 0 of 0 nodes" with no console error and no failed request — the
// requests did not exist. curl was unaffected, which is why the server always
// looked healthy. Adjacent port 12435 resolved fine over `localhost`, so this
// is not simply DNS or the corporate PAC; the literal address sidesteps the
// whole question.
//
// It is also the convention the rest of the stack already follows for
// loopback (the proxy pin, opencode's BYOK baseURL, qwen-laptop).
export const SYSTEM_ENDPOINTS: Record<System, string> = {
  coding: import.meta.env.VITE_BACKEND_CODING_URL ?? 'http://127.0.0.1:12436',
  okb:    import.meta.env.VITE_BACKEND_OKB_URL    ?? 'http://127.0.0.1:8090',
} as const

// 2026-06-11: tab labels switched from 'Coding'/'OKB' to 'VKB'/'VOKB' per
// user request — the underlying systems have always been the *V*isual
// Knowledge Base (km-core graph store) and the *V*isual *O*perational
// *K*nowledge *B*ase (OKM Express). The route slugs `/viewer/coding` and
// `/viewer/okb` stay as-is for URL back-compat; only the visible label
// changes.
export const SYSTEM_LABELS: Record<System, string> = {
  coding: 'VKB',
  okb: 'VOKB',
} as const

/** Type guard — narrows a string to `System` if it matches one of the two slugs. */
export function isValidSystem(s: string | undefined): s is System {
  return s === 'coding' || s === 'okb'
}
