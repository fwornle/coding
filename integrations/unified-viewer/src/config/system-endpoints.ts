// PATTERN SOURCE: integrations/system-health-dashboard/src/lib/config.ts:10-19
//   (env-var-with-fallback idiom — shifted from process.env to import.meta.env per Vite-canonical)
// CONTRACT SOURCE: D-45-02 (45-CONTEXT.md lines 51-67)
//
// Phase 45 multi-base-URL routing. Each system slug maps to the backend
// ApiClient should hit. Dev override via Vite env vars:
//   VITE_BACKEND_CODING_URL / VITE_BACKEND_OKB_URL / VITE_BACKEND_CAP_URL
//
// NOTE on env-access: Vite expects `import.meta.env.VITE_*` at build time;
// `process.env.*` would silently be undefined in the browser bundle (Pitfall 4).

export type System = 'coding' | 'okb' | 'cap'

export const VALID_SYSTEMS: readonly System[] = ['coding', 'okb', 'cap'] as const

export const SYSTEM_ENDPOINTS: Record<System, string> = {
  coding: import.meta.env.VITE_BACKEND_CODING_URL ?? 'http://localhost:12436',
  okb:    import.meta.env.VITE_BACKEND_OKB_URL    ?? 'http://localhost:3848',
  cap:    import.meta.env.VITE_BACKEND_CAP_URL    ?? 'https://okm.cc.bmwgroup.net',
} as const

export const SYSTEM_LABELS: Record<System, string> = {
  coding: 'Coding',
  okb: 'OKB',
  cap: 'CAP',
} as const

/** Type guard — narrows a string to `System` if it matches one of the three slugs. */
export function isValidSystem(s: string | undefined): s is System {
  return s === 'coding' || s === 'okb' || s === 'cap'
}
