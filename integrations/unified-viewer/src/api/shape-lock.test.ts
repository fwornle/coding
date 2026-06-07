// PATTERN SOURCE: tests/integration/typed-views.test.js:35-63 (verbatim key lists)
//
// Phase 45 wire-shape lock test — re-asserts Plan 44-16 contract at the viewer boundary.
// If a key shifts, BOTH this test AND tests/integration/typed-views.test.js must update together.
//
// Three ratification sites for camelCase pin:
//   1. tests/integration/typed-views.test.js (Jest, server-side)
//   2. THIS FILE (Vitest mirror, viewer-side)
//   3. .planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md (the lock doc)
import { describe, test, expect } from 'vitest'
import { DigestSchema, InsightSchema, ObservationSchema } from './schemas'

// Verbatim lists from tests/integration/typed-views.test.js:35-63
const REQUIRED_OBS_KEYS = [
  'id',
  'agent',
  'project',
  'content',
  'artifacts',
  'timestamp',
]
const REQUIRED_DIGEST_KEYS = [
  'id',
  'date',
  'theme',
  'summary',
  'observationIds',
  'agents',
  'filesTouched',
  'project',
]
const REQUIRED_INSIGHT_KEYS = [
  'id',
  'topic',
  'summary',
  'confidence',
  'digestIds',
  'lastUpdated',
  'project',
]

describe('Phase 45 wire-shape lock — Plan 44-16 mirror', () => {
  test('DigestSchema accepts camelCase keys', () => {
    const valid = {
      id: 'x',
      date: '2026-06-07',
      theme: 't',
      summary: 's',
      observationIds: ['a'],
      agents: ['claude'],
      filesTouched: ['f'],
      project: 'coding',
    }
    const parsed = DigestSchema.parse(valid)
    expect(parsed).toBeTruthy()
    // Confirm every required key surfaces on the parsed object
    for (const key of REQUIRED_DIGEST_KEYS) {
      expect(key in parsed).toBe(true)
    }
  })

  test('DigestSchema rejects snake_case regression (observation_ids)', () => {
    const snakeRow = {
      id: 'x',
      date: '2026-06-07',
      theme: 't',
      summary: 's',
      // The snake_case shape MUST throw — camelCase is the wire contract.
      observation_ids: ['a'],
      observationIds: undefined,
      agents: ['claude'],
      filesTouched: ['f'],
      project: 'coding',
    } as unknown as Parameters<typeof DigestSchema.parse>[0]
    expect(() => DigestSchema.parse(snakeRow)).toThrow()
  })

  test('InsightSchema accepts camelCase keys (digestIds + lastUpdated)', () => {
    const valid = {
      id: 'a',
      topic: 'topic',
      summary: 's',
      confidence: 0.9,
      digestIds: ['d1'],
      lastUpdated: '2026-06-07',
      project: null,
    }
    const parsed = InsightSchema.parse(valid)
    expect(parsed).toBeTruthy()
    for (const key of REQUIRED_INSIGHT_KEYS) {
      // project is nullable+optional; only require its presence among the required keys we send
      if (key === 'project') continue
      expect(key in parsed).toBe(true)
    }
  })

  test('InsightSchema rejects snake_case regression (digest_ids + last_updated)', () => {
    const snakeRow = {
      id: 'a',
      topic: 'topic',
      summary: 's',
      confidence: 0.9,
      digest_ids: ['d1'],
      last_updated: '2026-06-07',
      digestIds: undefined,
      lastUpdated: undefined,
      project: null,
    } as unknown as Parameters<typeof InsightSchema.parse>[0]
    expect(() => InsightSchema.parse(snakeRow)).toThrow()
  })

  test('ObservationSchema accepts snake_case session_id (per amendment-4 exception)', () => {
    const valid = {
      id: 'o1',
      agent: 'claude',
      project: 'coding',
      content: 'hello',
      artifacts: [],
      timestamp: '2026-06-07T00:00:00Z',
      session_id: 'sid-123',
    }
    const parsed = ObservationSchema.parse(valid)
    expect(parsed).toBeTruthy()
    expect(parsed.session_id).toBe('sid-123')
    for (const key of REQUIRED_OBS_KEYS) {
      expect(key in parsed).toBe(true)
    }
  })
})
