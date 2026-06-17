// Phase 60 Plan 01 (G1) — deriveLayer helper unit tests.
//
// Covers D-01 (single source of truth), D-02 (ontology extends-chain walk —
// L1 'Pattern' / 'Insight' AND Phase 57 L2 like 'OnlineInsight' /
// 'OnlineDigest'), D-03 (explicit `metadata.layer` precedence), and the
// defensive cases listed in 60-01-PLAN.md Task 1 <behavior>.
//
// Test fixtures use plain object literals cast to the loose entity shape
// `deriveLayer` accepts — no ApiClient import (keeps `layer.ts` pure).

import { describe, test, expect } from 'vitest'
import { deriveLayer, type OntologyRegistryClass } from './layer'

describe('deriveLayer — D-03 precedence (explicit metadata.layer wins)', () => {
  test('Test 1: explicit metadata.layer="pattern" overrides ontologyClass="Component" → pattern', () => {
    const entity = {
      ontologyClass: 'Component',
      metadata: { layer: 'pattern' },
    }
    expect(deriveLayer(entity, undefined)).toBe('pattern')
  })

  test('Test 2: explicit metadata.layer="evidence" overrides ontologyClass="Pattern" → evidence', () => {
    const entity = {
      ontologyClass: 'Pattern',
      metadata: { layer: 'evidence' },
    }
    // Even with a registry that would resolve Pattern→pattern, explicit wins.
    const registry: OntologyRegistryClass[] = [{ name: 'Pattern', parent: null }]
    expect(deriveLayer(entity, registry)).toBe('evidence')
  })
})

describe('deriveLayer — D-02 ontology-extends-walk inference', () => {
  test('Test 3: ontologyClass="Pattern" with registry root → pattern', () => {
    const entity = { ontologyClass: 'Pattern' }
    const registry: OntologyRegistryClass[] = [{ name: 'Pattern', parent: null }]
    expect(deriveLayer(entity, registry)).toBe('pattern')
  })

  test('Test 4: ontologyClass="Insight" with registry root → pattern', () => {
    const entity = { ontologyClass: 'Insight' }
    const registry: OntologyRegistryClass[] = [{ name: 'Insight', parent: null }]
    expect(deriveLayer(entity, registry)).toBe('pattern')
  })

  test('Test 5: Phase 57 L2 — ontologyClass="OnlineInsight" extends Insight → pattern', () => {
    const entity = { ontologyClass: 'OnlineInsight' }
    const registry: OntologyRegistryClass[] = [
      { name: 'OnlineInsight', parent: 'Insight' },
      { name: 'Insight', parent: null },
    ]
    expect(deriveLayer(entity, registry)).toBe('pattern')
  })

  test('Test 6: Phase 57 L2 — ontologyClass="OnlineDigest" extends Digest (no Pattern/Insight ancestor) → evidence', () => {
    const entity = { ontologyClass: 'OnlineDigest' }
    const registry: OntologyRegistryClass[] = [
      { name: 'OnlineDigest', parent: 'Digest' },
      { name: 'Digest', parent: null },
    ]
    expect(deriveLayer(entity, registry)).toBe('evidence')
  })

  test('Test 7: ontologyClass="Component" → evidence default', () => {
    const entity = { ontologyClass: 'Component' }
    const registry: OntologyRegistryClass[] = [{ name: 'Component', parent: null }]
    expect(deriveLayer(entity, registry)).toBe('evidence')
  })

  test('Test 8: ontologyClass="Service" → evidence default', () => {
    const entity = { ontologyClass: 'Service' }
    const registry: OntologyRegistryClass[] = [{ name: 'Service', parent: null }]
    expect(deriveLayer(entity, registry)).toBe('evidence')
  })
})

describe('deriveLayer — defensive cases', () => {
  test('Test 9: unknown ontologyClass not in registry → evidence', () => {
    const entity = { ontologyClass: 'SomeNovelClass' }
    const registry: OntologyRegistryClass[] = [{ name: 'Component', parent: null }]
    expect(deriveLayer(entity, registry)).toBe('evidence')
  })

  test('Test 10: entity missing ontologyClass → evidence', () => {
    const entity = {}
    const registry: OntologyRegistryClass[] = [{ name: 'Pattern', parent: null }]
    expect(deriveLayer(entity, registry)).toBe('evidence')
  })

  test('Test 11: registry undefined → graceful direct-class fallback (Pattern/Insight → pattern)', () => {
    expect(deriveLayer({ ontologyClass: 'Pattern' }, undefined)).toBe('pattern')
    expect(deriveLayer({ ontologyClass: 'Insight' }, undefined)).toBe('pattern')
    expect(deriveLayer({ ontologyClass: 'Component' }, undefined)).toBe('evidence')
    expect(deriveLayer({ ontologyClass: 'OnlineInsight' }, undefined)).toBe('evidence')
  })

  test('Test 12: cycle safety — A→B→A does not infinite-loop, returns evidence', () => {
    const entity = { ontologyClass: 'A' }
    const registry: OntologyRegistryClass[] = [
      { name: 'A', parent: 'B' },
      { name: 'B', parent: 'A' },
    ]
    expect(deriveLayer(entity, registry)).toBe('evidence')
  })
})
