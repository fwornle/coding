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
import {
  DigestSchema,
  InsightSchema,
  ObservationSchema,
  ConfidencePayloadSchema,
  classifyConfidence,
} from './schemas'

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

// ---------------------------------------------------------------------------
// Confidence — the fourth ratification site, added 2026-09-25
// ---------------------------------------------------------------------------
//
// This endpoint had no lock, and that is the whole story of the "· NaN%" bug:
// `ApiClient.getEntityConfidence` was a bare cast to a hand-written interface
// that had never matched the wire. The server test
// (tests/integration/obs-api.v1-confidence.test.js:147) asserted
// `typeof data.overall === 'number'`; the client type said
// `overall: {score, label}`. Both suites were green for months.
//
// The fixture below is the server's documented response, verbatim. If the
// handler changes shape, this fails on the viewer side too — which is the
// property every other payload in this file already had.
describe('Confidence wire-shape lock (obs-api /api/v1/entities/:id/confidence)', () => {
  const SERVER_RESPONSE = {
    overall: 0.7,
    bands: { high: 0, moderate: 1, low: 0 },
    segments: [{ segmentId: 'seg-0', confidence: 0.9, source: 'run-A' }],
  }

  test('parses the shape the server actually sends', () => {
    const parsed = ConfidencePayloadSchema.parse(SERVER_RESPONSE)
    expect(parsed.overall).toBe(0.7)
    expect(typeof parsed.overall).toBe('number')
    expect(parsed.segments[0].segmentId).toBe('seg-0')
    expect(parsed.segments[0].confidence).toBe(0.9)
  })

  test('segments may omit `source` — the handler only sets it when known', () => {
    expect(() =>
      ConfidencePayloadSchema.parse({ ...SERVER_RESPONSE, segments: [{ segmentId: 's', confidence: 0.5 }] }),
    ).not.toThrow()
  })

  test('REJECTS the shape the client used to assume', () => {
    // The exact literal the old ConfidencePayload declared. Parsing it must
    // fail — if this ever passes again, the cast is back.
    expect(() =>
      ConfidencePayloadSchema.parse({
        overall: { score: 0.82, label: 'High' },
        segments: [{ runId: 'run-A', score: 0.9, label: 'High' }],
      }),
    ).toThrow()
  })

  test('rejects an out-of-range overall', () => {
    // The handler clamps to [0,1]; a value outside it means the clamp is gone.
    expect(() => ConfidencePayloadSchema.parse({ ...SERVER_RESPONSE, overall: 1.4 })).toThrow()
  })

  // Thresholds are duplicated between classifyConfidence() here and
  // classifyConfidence() at observations-api-server.mjs:2940, because the
  // client must label a scalar the server sends unlabelled. Pin the
  // BOUNDARIES, which is where a silent drift would show up first.
  test.each([
    [1, 'High'], [0.8, 'High'], [0.7999, 'Moderate'],
    [0.6, 'Moderate'], [0.5999, 'Low'], [0, 'Low'],
  ] as const)('classifyConfidence(%s) === %s — mirrors the server', (score, label) => {
    expect(classifyConfidence(score)).toBe(label)
  })

  test('a non-finite score reads Low rather than throwing', () => {
    // It feeds a colour lookup and a label; an unusable score should read as
    // untrustworthy, not take the panel down.
    expect(classifyConfidence(NaN)).toBe('Low')
  })
})
