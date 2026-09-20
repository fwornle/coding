// PATTERN SOURCE: 55-01-PLAN.md Task 1 <behavior>
//
// Phase 55: `cap` is removed from the System union and `okb` is retargeted
// to OKM Express on :8090. This file replaces the Phase 45 tests that
// asserted `cap` membership with negative-case assertions that `cap` is
// rejected end-to-end.
import { describe, test, expect } from 'vitest'
import { isValidSystem, SYSTEM_ENDPOINTS, SYSTEM_LABELS, VALID_SYSTEMS } from './system-endpoints'

describe('isValidSystem type-guard (Phase 55)', () => {
  test('accepts "coding"', () => {
    expect(isValidSystem('coding')).toBe(true)
  })

  test('accepts "okb"', () => {
    expect(isValidSystem('okb')).toBe(true)
  })

  test('rejects "cap" (Phase 55 D-55-01b — CAP tab dropped)', () => {
    expect(isValidSystem('cap')).toBe(false)
  })

  test('rejects unknown slugs', () => {
    expect(isValidSystem('foo')).toBe(false)
    expect(isValidSystem('CODING')).toBe(false)
    expect(isValidSystem('')).toBe(false)
    expect(isValidSystem(undefined)).toBe(false)
  })
})

describe('VALID_SYSTEMS (Phase 55)', () => {
  test('contains exactly 2 systems', () => {
    expect(VALID_SYSTEMS.length).toBe(2)
  })

  test('contains "coding" and "okb" only', () => {
    expect([...VALID_SYSTEMS].sort()).toEqual(['coding', 'okb'])
  })
})

describe('SYSTEM_ENDPOINTS (Phase 55)', () => {
  test('has an entry for each valid system', () => {
    for (const slug of VALID_SYSTEMS) {
      expect(SYSTEM_ENDPOINTS[slug]).toMatch(/^https?:\/\//)
    }
  })

  test('okb endpoint falls back to http://127.0.0.1:8090 (OKM Express, D-55-01a)', () => {
    // The fallback applies when VITE_BACKEND_OKB_URL is not set.
    // Under vitest the env var is unset by default, so we read the live value.
    expect(SYSTEM_ENDPOINTS.okb).toBe('http://127.0.0.1:8090')
  })

  test('coding endpoint falls back to http://127.0.0.1:12436 (obs-api)', () => {
    expect(SYSTEM_ENDPOINTS.coding).toBe('http://127.0.0.1:12436')
  })

  // Both defaults are literal loopback addresses on purpose. `localhost` put a
  // name-resolution and proxy-policy step in front of a socket that never
  // leaves the machine, and on 2026-09-20 that step hung Chrome indefinitely
  // against obs-api — the viewer showed "Showing 0 of 0 nodes" with no error
  // and no failed request, because the requests were never issued. Keep these
  // numeric; a hostname here is a regression, not a cleanup.
  test('loopback defaults are literal addresses, never a hostname', () => {
    for (const slug of VALID_SYSTEMS) {
      expect(SYSTEM_ENDPOINTS[slug]).toMatch(/^https?:\/\/(?:127\.0\.0\.1|\[::1\]):\d+$/)
    }
  })

  test('SYSTEM_ENDPOINTS has exactly 2 keys (no cap)', () => {
    expect(Object.keys(SYSTEM_ENDPOINTS).sort()).toEqual(['coding', 'okb'])
  })
})

describe('SYSTEM_LABELS (Phase 55)', () => {
  test('has labels for coding and okb only', () => {
    // 2026-06-11 rename: tab labels switched from 'Coding'/'OKB' to 'VKB'/'VOKB'
    // (system-endpoints.ts SYSTEM_LABELS). Route slugs stay 'coding'/'okb'.
    expect(SYSTEM_LABELS.coding).toBe('VKB')
    expect(SYSTEM_LABELS.okb).toBe('VOKB')
  })

  test('SYSTEM_LABELS has exactly 2 keys (no cap)', () => {
    expect(Object.keys(SYSTEM_LABELS).sort()).toEqual(['coding', 'okb'])
  })
})

describe('System union type (Phase 55, negative type-test)', () => {
  test('rejects "cap" as a System literal at the type level', () => {
    // @ts-expect-error — 'cap' is no longer a member of System (D-55-01b).
    const _x: import('./system-endpoints').System = 'cap'
    // Runtime confirmation — the @ts-expect-error above is the load-bearing check.
    expect(_x).toBe('cap')
  })
})
