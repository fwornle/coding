// learningSourceOf — the one rule the canvas, Legend, filter and History
// sidebar share.
//
// The cases that matter are the ones the two previous rules each got wrong:
// entities with NO `source` at all. `source ∈ {auto,online}` called all of them
// batch; `!== 'manual'` called all of them auto. In the live graph they split
// 56 batch / 82 online.

import { describe, test, expect } from 'vitest'
import { learningSourceOf, isOnlineLearned, LEARNING_SOURCE_LABEL } from './learning-source'

const node = (metadata: Record<string, unknown>) => ({ metadata })

describe('learningSourceOf — explicit sources', () => {
  test('manual', () => {
    expect(learningSourceOf(node({ source: 'manual' }))).toBe('manual')
  })

  test('both online spellings', () => {
    // The writers stamp 'online' far more often than 'auto'.
    expect(learningSourceOf(node({ source: 'auto' }))).toBe('online')
    expect(learningSourceOf(node({ source: 'online' }))).toBe('online')
  })

  test('wave-analysis is batch — this is the badge the UKB runs were missing', () => {
    expect(learningSourceOf(node({ source: 'wave-analysis' }))).toBe('batch')
  })
})

describe('learningSourceOf — no source stamped', () => {
  test('subsystem wave-analysis is batch', () => {
    // 56 of the 138 unstamped entities. The old sidebar rule called these auto.
    expect(learningSourceOf(node({ subsystem: 'wave-analysis' }))).toBe('batch')
  })

  test('digest shape is online', () => {
    // 82 of the 138. The canvas rule called these batch.
    expect(learningSourceOf(node({ observation_ids: ['a'] }))).toBe('online')
    expect(learningSourceOf(node({ sourceCount: 3 }))).toBe('online')
    expect(learningSourceOf(node({ agents: ['claude'] }))).toBe('online')
  })

  test('an explicit source beats the shape sniff', () => {
    // A wave-analysis entity that happens to carry agents[] must stay batch.
    expect(learningSourceOf(node({ source: 'wave-analysis', agents: ['x'] }))).toBe('batch')
    expect(learningSourceOf(node({ subsystem: 'wave-analysis', agents: ['x'] }))).toBe('batch')
  })

  test('nothing at all defaults to batch, not online', () => {
    // An unrecognised or absent source is more likely a named batch writer (a
    // repair script, an importer) than ETM output, which always stamps
    // auto/online or carries the digest shape.
    expect(learningSourceOf(node({}))).toBe('batch')
    expect(learningSourceOf(node({ source: 'group-kgbench-run-anchors' }))).toBe('batch')
    expect(learningSourceOf(null)).toBe('batch')
    expect(learningSourceOf(undefined)).toBe('batch')
  })

  test('a non-string source is ignored rather than coerced', () => {
    expect(learningSourceOf(node({ source: 42 }))).toBe('batch')
  })
})

describe('isOnlineLearned', () => {
  test('true only for the online class', () => {
    expect(isOnlineLearned(node({ source: 'online' }))).toBe(true)
    // The KEY's presence is the shape marker, not its contents — a digest that
    // aggregated nothing is still a digest.
    expect(isOnlineLearned(node({ observation_ids: [] }))).toBe(true)
    expect(isOnlineLearned(node({ observation_ids: ['x'] }))).toBe(true)
    expect(isOnlineLearned(node({ source: 'wave-analysis' }))).toBe(false)
    expect(isOnlineLearned(node({ source: 'manual' }))).toBe(false)
  })
})

describe('LEARNING_SOURCE_LABEL', () => {
  test('matches the LearningSourceFilter vocabulary', () => {
    // The rail offers Batch / Online; the badge says Batch / Auto for the same
    // two populations. Keep them recognisably paired.
    expect(LEARNING_SOURCE_LABEL.batch).toBe('Batch')
    expect(LEARNING_SOURCE_LABEL.online).toBe('Auto')
    expect(LEARNING_SOURCE_LABEL.manual).toBe('Manual')
  })
})
