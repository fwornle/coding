// Empirical A3/OQ1 granularity check (Phase 86-01 Task 0).
//
// PROVES against a REAL Phase-84-captured run that a `context-turns.jsonl` line is
// one-per-LLM-request carrying the ContextTurnRow field set (request_id / usage /
// messages / categories) and NO per-reasoning-step / granularity_tier / parent_call_id /
// reasoning / thinking field — i.e. reasoning steps are NOT emitted as separate
// context-turn lines (they live only as timeline `children` sub-bands). This is the
// assumption `alignRuns` (86-01 Task 1) rests on: alignment operates on the request
// sequence = the parent-turn-equivalent stream, with NO pre-flatten.
//
// If zero captured runs exist on a fresh checkout, the suite skips-with-reason so it
// stays green rather than failing on absent fixtures.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const MEASUREMENTS_DIR = path.join(REPO_ROOT, '.data', 'measurements')

// Fields that, if present on a context-turn line, would mean reasoning sub-steps are
// emitted as their own lines — which would REQUIRE pre-flattening before signature
// computation. Their ABSENCE is what confirms the parent-turn-equivalent granularity.
const PER_REASONING_STEP_FIELDS = ['granularity_tier', 'parent_call_id', 'reasoning', 'thinking']

/** Find the first real captured `context-turns.jsonl(.gz)` on disk (skip-with-reason if none). */
function findFirstContextTurnsFile() {
  if (!fs.existsSync(MEASUREMENTS_DIR)) return null
  const entries = fs.readdirSync(MEASUREMENTS_DIR, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(MEASUREMENTS_DIR, e.name)
    const gz = path.join(dir, 'context-turns.jsonl.gz')
    const plain = path.join(dir, 'context-turns.jsonl')
    if (fs.existsSync(gz)) return gz
    if (fs.existsSync(plain)) return plain
  }
  return null
}

/** Load + parse every JSON line from a `.jsonl` or `.jsonl.gz` file. */
function loadJsonlLines(file) {
  const raw = fs.readFileSync(file)
  const text = file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8')
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l))
}

const CONTEXT_TURNS_FILE = findFirstContextTurnsFile()

const describeOrSkip = CONTEXT_TURNS_FILE ? describe : describe.skip

describeOrSkip('context-turns.jsonl granularity (A3/OQ1 empirical check)', () => {
  if (!CONTEXT_TURNS_FILE) {
    // Emitted only when the whole block is skipped (no captured runs on a fresh checkout).
    // eslint-disable-next-line no-console
    console.warn('SKIP context-turns-granularity: no .data/measurements/*/context-turns.jsonl(.gz) present')
    return
  }

  const lines = loadJsonlLines(CONTEXT_TURNS_FILE)

  test('the captured file has at least one measured line', () => {
    expect(lines.length).toBeGreaterThan(0)
  })

  test('(a) every line is a single measured LLM request carrying the ContextTurnRow field set', () => {
    for (const line of lines) {
      // request_id present (one measured request per line)
      expect(typeof line.request_id === 'string' && line.request_id.length > 0).toBe(true)
      // usage carries the un-folded cache split (never a single total)
      expect(line.usage && typeof line.usage.input === 'number').toBe(true)
      // per-request message digest + category breakdown
      expect(Array.isArray(line.messages)).toBe(true)
      expect(Array.isArray(line.categories)).toBe(true)
    }
  })

  test('(b) NO line carries a per-reasoning-step / granularity_tier / parent_call_id / reasoning field', () => {
    for (const line of lines) {
      for (const field of PER_REASONING_STEP_FIELDS) {
        expect(Object.prototype.hasOwnProperty.call(line, field)).toBe(false)
      }
    }
  })

  test('confirms alignment granularity: line-per-request = parent-turn-equivalent, no pre-flatten needed', () => {
    // The alignment sequence IS the line sequence (each line = one parent-turn-equivalent
    // request). Since no line is a per-reasoning-step sub-request, alignRuns can consume the
    // ContextTurnRow[] as-is. This assertion documents the resolved contract.
    const hasAnyReasoningLine = lines.some((line) =>
      PER_REASONING_STEP_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(line, f)),
    )
    expect(hasAnyReasoningLine).toBe(false)
  })
})
