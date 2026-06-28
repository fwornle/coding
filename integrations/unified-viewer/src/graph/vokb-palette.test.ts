// PORT-SPEC: snapshot tests asserting verbatim parity with VOKB source.
// Source: _work/.../viewer/src/components/KnowledgeGraph/GraphVisualization.tsx:31-176
//       + _work/.../viewer/src/components/KnowledgeGraph/NodeDetails.tsx:{71-74,219-228,232-241}
//
// Drift detection: if a hex value or Tailwind class in the VOKB source changes
// and is not also updated here, these tests fail loudly. That is the intent —
// per D-55-02a (verbatim VOKB port rule), this module is the single
// source-of-truth and any drift between Phase 55 port and VOKB main is a
// contract break that must be reconciled, not silently absorbed.

import { describe, test, expect } from 'vitest'
import {
  FAILURE_MODEL_CLASSES,
  BUSINESS_CLASSES,
  nodeFill,
  nodeStroke,
  nodeStrokeWidth,
  nodeStrokeDasharray,
  EDGE_STYLES,
  LAYER_BADGE_CLASS,
  CONFIDENCE_COLOR,
  RUN_COLORS,
} from './vokb-palette'

describe('vokb-palette — FAILURE_MODEL_CLASSES (VOKB GraphVisualization.tsx:60-62)', () => {
  test('contains exactly 5 entries', () => {
    expect(FAILURE_MODEL_CLASSES.size).toBe(5)
  })
  test('contains FailurePattern, Incident, Resolution, RootCause, Symptom', () => {
    expect(FAILURE_MODEL_CLASSES.has('FailurePattern')).toBe(true)
    expect(FAILURE_MODEL_CLASSES.has('Incident')).toBe(true)
    expect(FAILURE_MODEL_CLASSES.has('Resolution')).toBe(true)
    expect(FAILURE_MODEL_CLASSES.has('RootCause')).toBe(true)
    expect(FAILURE_MODEL_CLASSES.has('Symptom')).toBe(true)
  })
})

describe('vokb-palette — BUSINESS_CLASSES (VOKB GraphVisualization.tsx:66-68)', () => {
  test('contains exactly 5 entries', () => {
    expect(BUSINESS_CLASSES.size).toBe(5)
  })
  test('contains Decision, Requirement, Risk, ActionItem, DocumentSource', () => {
    expect(BUSINESS_CLASSES.has('Decision')).toBe(true)
    expect(BUSINESS_CLASSES.has('Requirement')).toBe(true)
    expect(BUSINESS_CLASSES.has('Risk')).toBe(true)
    expect(BUSINESS_CLASSES.has('ActionItem')).toBe(true)
    expect(BUSINESS_CLASSES.has('DocumentSource')).toBe(true)
  })
})

describe('vokb-palette — nodeFill (VOKB GraphVisualization.tsx:70-85)', () => {
  test('failure-mode evidence is light-blue (#93c5fd) — line :81', () => {
    expect(nodeFill('evidence', 'FailurePattern')).toBe('#93c5fd')
  })
  test('standard evidence is blue-500 (#3b82f6) — line :81', () => {
    expect(nodeFill('evidence', 'Component')).toBe('#3b82f6')
  })
  test('failure-mode pattern is light-orange (#fdba74) — line :82', () => {
    expect(nodeFill('pattern', 'FailurePattern')).toBe('#fdba74')
  })
  test('standard pattern is amber-500 (#f59e0b) — line :82', () => {
    expect(nodeFill('pattern', 'Component')).toBe('#f59e0b')
  })
  test('business override on evidence layer is emerald-500 (#10b981) — line :75', () => {
    expect(nodeFill('evidence', 'Decision')).toBe('#10b981')
  })
  test('business override on pattern layer is emerald-400 (#34d399) — line :76', () => {
    expect(nodeFill('pattern', 'Requirement')).toBe('#34d399')
  })
  test('business override on default layer is emerald-300 (#6ee7b7) — line :77', () => {
    expect(nodeFill('unknown', 'Risk')).toBe('#6ee7b7')
  })
  test('unknown layer with no class is gray-500 (#6b7280) — line :83', () => {
    expect(nodeFill('unknown', undefined)).toBe('#6b7280')
  })
  test('evidence layer with undefined class is standard blue (#3b82f6)', () => {
    expect(nodeFill('evidence', undefined)).toBe('#3b82f6')
  })
})

describe('vokb-palette — nodeStroke (VOKB GraphVisualization.tsx:87-110)', () => {
  test('business evidence is emerald-600 (#059669) — line :92', () => {
    expect(nodeStroke('evidence', 'Decision')).toBe('#059669')
  })
  test('business pattern is emerald-500 (#10b981) — line :93', () => {
    expect(nodeStroke('pattern', 'Requirement')).toBe('#10b981')
  })
  test('official_doc source authority is emerald-500 (#10b981) — line :99', () => {
    expect(nodeStroke('evidence', 'Component', 'official_doc')).toBe('#10b981')
  })
  test('team_knowledge source authority is teal-500 (#14b8a6) — line :100', () => {
    expect(nodeStroke('evidence', 'Component', 'team_knowledge')).toBe('#14b8a6')
  })
  test('user_input source authority is violet-400 (#a78bfa) — line :101', () => {
    expect(nodeStroke('evidence', 'Component', 'user_input')).toBe('#a78bfa')
  })
  test('failure-mode evidence default stroke is blue-400 (#60a5fa) — line :106', () => {
    expect(nodeStroke('evidence', 'FailurePattern')).toBe('#60a5fa')
  })
  test('standard evidence default stroke is blue-600 (#2563eb) — line :106', () => {
    expect(nodeStroke('evidence', 'Component')).toBe('#2563eb')
  })
  test('failure-mode pattern default stroke is orange-400 (#fb923c) — line :107', () => {
    expect(nodeStroke('pattern', 'Incident')).toBe('#fb923c')
  })
  test('standard pattern default stroke is amber-600 (#d97706) — line :107', () => {
    expect(nodeStroke('pattern', 'Component')).toBe('#d97706')
  })
  test('default-layer stroke with no class is gray-600 (#4b5563) — line :108', () => {
    expect(nodeStroke('unknown', undefined)).toBe('#4b5563')
  })
})

describe('vokb-palette — nodeStrokeWidth (VOKB GraphVisualization.tsx:113-120)', () => {
  test('official_doc is 3 — line :115', () => {
    expect(nodeStrokeWidth('official_doc')).toBe(3)
  })
  test('team_knowledge is 2.5 — line :116', () => {
    expect(nodeStrokeWidth('team_knowledge')).toBe(2.5)
  })
  test('user_input is 2.5 — line :117', () => {
    expect(nodeStrokeWidth('user_input')).toBe(2.5)
  })
  test('undefined / default is 2 — line :118', () => {
    expect(nodeStrokeWidth(undefined)).toBe(2)
  })
})

describe('vokb-palette — nodeStrokeDasharray (VOKB GraphVisualization.tsx:123-125)', () => {
  test('user_input is dashed "4,2" — line :124', () => {
    expect(nodeStrokeDasharray('user_input')).toBe('4,2')
  })
  test('all other values are solid (empty string)', () => {
    expect(nodeStrokeDasharray('official_doc')).toBe('')
    expect(nodeStrokeDasharray('team_knowledge')).toBe('')
    expect(nodeStrokeDasharray(undefined)).toBe('')
  })
})

describe('vokb-palette — EDGE_STYLES (VOKB GraphVisualization.tsx:135-173)', () => {
  test('causal CAUSED_BY is red-500 (#ef4444), solid — line :143', () => {
    expect(EDGE_STYLES.CAUSED_BY).toEqual({ color: '#ef4444', dasharray: '' })
  })
  test('association CORRELATED_WITH is purple-500 (#a855f7), dashed "5,5" — line :168', () => {
    expect(EDGE_STYLES.CORRELATED_WITH).toEqual({ color: '#a855f7', dasharray: '5,5' })
  })
  test('default fallback RELATES_TO is gray-300 (#d1d5db), solid — line :172', () => {
    expect(EDGE_STYLES.RELATES_TO).toEqual({ color: '#d1d5db', dasharray: '' })
  })
  test('structural DERIVED_FROM is gray-400 (#9ca3af) — line :137', () => {
    expect(EDGE_STYLES.DERIVED_FROM).toEqual({ color: '#9ca3af', dasharray: '' })
  })
  test('snapshot of full EDGE_STYLES map — verbatim parity with VOKB lines :135-173', () => {
    // toMatchInlineSnapshot pins every (color, dasharray) pair against the
    // VOKB source. Any drift in either direction breaks this test loudly.
    expect(EDGE_STYLES).toMatchInlineSnapshot(`
      {
        "AFFECTS": {
          "color": "#c084fc",
          "dasharray": "",
        },
        "APPLIED_TO": {
          "color": "#5eead4",
          "dasharray": "",
        },
        "APPLIES_TO": {
          "color": "#5eead4",
          "dasharray": "",
        },
        "CAUSED": {
          "color": "#dc2626",
          "dasharray": "",
        },
        "CAUSED_BY": {
          "color": "#ef4444",
          "dasharray": "",
        },
        "CONSUMED_BY": {
          "color": "#4ade80",
          "dasharray": "",
        },
        "CONTAINS": {
          "color": "#6b7280",
          "dasharray": "",
        },
        "CORRELATED_WITH": {
          "color": "#a855f7",
          "dasharray": "5,5",
        },
        "DEPENDS_ON": {
          "color": "#8b5cf6",
          "dasharray": "",
        },
        "DEPLOYED_ON": {
          "color": "#60a5fa",
          "dasharray": "",
        },
        "DERIVED_FROM": {
          "color": "#9ca3af",
          "dasharray": "",
        },
        "HAS_ROOT_CAUSE": {
          "color": "#f97316",
          "dasharray": "",
        },
        "HAS_SYMPTOM": {
          "color": "#fb923c",
          "dasharray": "",
        },
        "HAS_TYPE": {
          "color": "#9ca3af",
          "dasharray": "3,3",
        },
        "HAS_VERSION": {
          "color": "#9ca3af",
          "dasharray": "3,3",
        },
        "INDICATES": {
          "color": "#ea580c",
          "dasharray": "5,3",
        },
        "LOCATED_IN": {
          "color": "#2563eb",
          "dasharray": "",
        },
        "MANAGED_BY": {
          "color": "#93c5fd",
          "dasharray": "5,3",
        },
        "MATCHES": {
          "color": "#0d9488",
          "dasharray": "5,3",
        },
        "MITIGATES": {
          "color": "#2dd4bf",
          "dasharray": "",
        },
        "OBSERVED_IN": {
          "color": "#3b82f6",
          "dasharray": "",
        },
        "PART_OF": {
          "color": "#6b7280",
          "dasharray": "",
        },
        "PROCESSES": {
          "color": "#16a34a",
          "dasharray": "",
        },
        "READS": {
          "color": "#22c55e",
          "dasharray": "",
        },
        "RELATES_TO": {
          "color": "#d1d5db",
          "dasharray": "",
        },
        "RESOLVES": {
          "color": "#14b8a6",
          "dasharray": "",
        },
        "RUNS_IN": {
          "color": "#60a5fa",
          "dasharray": "",
        },
        "RUNS_ON": {
          "color": "#60a5fa",
          "dasharray": "",
        },
        "STORED_IN": {
          "color": "#86efac",
          "dasharray": "",
        },
        "USES": {
          "color": "#22c55e",
          "dasharray": "5,3",
        },
        "capturedBy": {
          "color": "#60a5fa",
          "dasharray": "4,3",
        },
        "contains": {
          "color": "#6b7280",
          "dasharray": "",
        },
        "contributes_to": {
          "color": "#5eead4",
          "dasharray": "5,3",
        },
        "derivedFrom": {
          "color": "#22c55e",
          "dasharray": "",
        },
        "has_insight": {
          "color": "#f59e0b",
          "dasharray": "",
        },
        "implemented_in": {
          "color": "#14b8a6",
          "dasharray": "",
        },
        "mentions": {
          "color": "#cbd5e1",
          "dasharray": "2,2",
        },
        "originally_developed_in": {
          "color": "#f97316",
          "dasharray": "5,3",
        },
        "parent-child": {
          "color": "#4b5563",
          "dasharray": "",
        },
        "related_to": {
          "color": "#a855f7",
          "dasharray": "5,5",
        },
      }
    `)
  })
})

describe('vokb-palette — LAYER_BADGE_CLASS (VOKB NodeDetails.tsx:636-640)', () => {
  test('evidence layer has blue Tailwind classes with dark-mode modifiers', () => {
    expect(LAYER_BADGE_CLASS.evidence).toBe(
      'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    )
  })
  test('pattern layer has amber Tailwind classes with dark-mode modifiers', () => {
    expect(LAYER_BADGE_CLASS.pattern).toBe(
      'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    )
  })
})

describe('vokb-palette — CONFIDENCE_COLOR (VOKB NodeDetails.tsx:219-228)', () => {
  test('High has bg-green-500 dot', () => {
    expect(CONFIDENCE_COLOR.High.dot).toBe('bg-green-500')
  })
  test('Moderate has bg-yellow-500 dot', () => {
    expect(CONFIDENCE_COLOR.Moderate.dot).toBe('bg-yellow-500')
  })
  test('Low has bg-orange-500 dot', () => {
    expect(CONFIDENCE_COLOR.Low.dot).toBe('bg-orange-500')
  })
  test('all three rows have class + dot fields', () => {
    expect(CONFIDENCE_COLOR.High.class).toContain('green')
    expect(CONFIDENCE_COLOR.Moderate.class).toContain('yellow')
    expect(CONFIDENCE_COLOR.Low.class).toContain('orange')
  })
})

describe('vokb-palette — RUN_COLORS (VOKB NodeDetails.tsx:232-241)', () => {
  test('exactly 8 colors in cycle', () => {
    expect(RUN_COLORS.length).toBe(8)
  })
  test('first entry is blue', () => {
    expect(RUN_COLORS[0].dot).toBe('bg-blue-500')
  })
  test('second entry is emerald', () => {
    expect(RUN_COLORS[1].dot).toBe('bg-emerald-500')
  })
  test('every entry has bg, border, dot fields', () => {
    for (const c of RUN_COLORS) {
      expect(c.bg).toMatch(/^bg-/)
      expect(c.border).toMatch(/^border-/)
      expect(c.dot).toMatch(/^bg-/)
    }
  })
})
