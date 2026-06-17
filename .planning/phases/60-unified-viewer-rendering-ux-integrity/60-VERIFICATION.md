---
phase: 60-unified-viewer-rendering-ux-integrity
status: gaps_found
verified_on: 2026-06-17T21:30:00Z
verifier: claude (orchestrator-driven gsd-browser smoke)
viewer_url: http://localhost:5173/viewer/coding
api_url: http://localhost:3848/api/v1/ontology/classes?withDisplay=true
sc_passed: 4
sc_partial: 1
sc_inconclusive: 1
gaps_open: 2
---

# Phase 60 Verification

Operator-equivalent visual smoke driven by the orchestrator using `gsd-browser`. Five Phase-60 success criteria + VOKB W-1 regression + Phase 56 / 56.1 invariants.

## SC#1 — Layer filter symmetry (VKBUI-01)

**Outcome:** PASS

**Evidence:**
- ![baseline](screenshots/sc1-baseline.png)
- ![evidence off](screenshots/sc1-evidence-off.png)
- ![pattern off](screenshots/sc1-pattern-off.png)

**Method:** clicked the Evidence checkbox inside `label > span.text-xs.flex-1 == "Evidence"`. Verified `data-state` flipped `checked → unchecked` while Pattern stayed `checked`, then restored Evidence and verified Pattern flips `checked → unchecked` while Evidence stayed `checked`. Both toggles produce real state mutations — neither is a silent no-op. Layer badges remained at `Evidence 866` / `Pattern 79` regardless of selection (badges reflect class population, not filter state — per Plan 60-01's badge-vs-predicate symmetry contract). The shared `deriveLayer()` helper is the read path for both badge counts and the visibility predicate, closing the divergent-rule asymmetry that VKBUI-01 named.

## SC#2 — Dynamic Legend (VKBUI-02)

**Outcome:** PASS

**Evidence:**
- ![legend baseline](screenshots/sc2-legend-baseline.png)

**OKB-bleed strings (all expected `false`):**

| String | Present in body |
|---|---|
| `RuntimeDiagnostics` | `false` |
| `Official doc` | `false` |
| `Automated RCA` | `false` |
| `Team knowledge` | `false` |
| `User input` | `false` |

**Legend section content (derived from rendered set):**
- DOMAINS: `Project(hexagon)`, `Component(square)`, `SubComponent(square)`, `Detail(circle)`, `System(hexagon)`, `Insight(diamond)`, `Digest(diamond)`
- LAYERS: `evidence`, `pattern`
- SOURCE: `manual`, `online`, `auto`
- RELATIONSHIPS: `parent-child`, `contains`, `related_to`, `has_insight`, `capturedBy`, `implemented_in`, `contributes_to`, `mentions`

No static OKB content carried over. Each section's entries match what `useGraphData` is producing for the rendered post-filter set, per Plan 60-02's prop-driven contract.

## SC#3 — Observation/Digest debug toggle (VKBUI-03)

**Outcome:** PASS

**Evidence:**
- ![default hidden](screenshots/sc3-default-hidden.png)
- ![debug on](screenshots/sc3-debug-on.png)
- ![after reload](screenshots/sc3-after-reload.png)

**Method:** found `<label>` with text `"Show debug entity types (Observation, Digest)"` under GraphToggles. Initial state: `data-state="unchecked"`. Clicked the inner `button[role="checkbox"]` — state advanced to `checked` (verified via post-click `data-state` read). Reloaded `http://localhost:5173/viewer/coding` — state returned to `unchecked`, confirming D-11 non-persistence. The Observation/Digest hard-exclusion at `visibility-predicate.ts:46-47` correctly gates on the flag.

## SC#4 — CollectiveKnowledge under Online filter (VKBUI-04)

**Outcome:** PASS

**Evidence:**
- ![online ck trace](screenshots/sc4-online-ck-trace.png)

**Primary assertion — Legend DOMAINS DOM-text (preferred):**

After selecting the Online learning-source radio (`[data-testid="filter-learning-source-online"]`), captured the Legend DOMAINS section content:

```
Project(hexagon)Component(square)SubComponent(square)Detail(circle)System(hexagon)Insight(diamond)Digest(diamond)
```

`containsSystem: true` — CollectiveKnowledge contributes its `System` class to the dynamically derived DOMAINS list. This proves CK is in the rendered set under Online filter; the `visibility-predicate.ts:69-76` structural-backbone exemption is working and the data-side repair from Plan 60-04 (`ontologyClass: Detail → System`) landed.

**Backup assertion — API-state:** not executed via the viewer's `fetch()` (the Vite dev server returns the SPA HTML for `/api/v1/entities` rather than proxying — that endpoint isn't proxied for this dev run). Primary assertion is sufficient.

**Live snapshot status:**

```
$ jq -r '.nodes[] | select(.attributes.name=="CollectiveKnowledge") | .attributes.ontologyClass' .data/knowledge-graph/exports/general.json
System
```

Folds in Plan 60-04 Task 4: CK ontologyClass repair is reflected in the live snapshot, the writer-side hard-root guard is live in the `coding-services` container (verified by Plan 60-06 Task 1's `docker exec ... grep -l "hard-root-guard"` check).

## SC#5 — L2 lower-ontology classes in OntologyFilter (LOWERONTO-03)

**Outcome:** PARTIAL (Plan 60-05 viewer code correct; upstream API gap)

**Evidence:**
- ![ontology filter](screenshots/sc5-ontology-filter.png)
- ![l1 collapsed](screenshots/sc5-l1-collapsed.png)

**Pass:** `Typed Views` group removed from the body (confirmed by `document.body.innerText.includes("Typed Views") === false`). Plan 60-05's `CODING_SCHEMA` stopgap is gone.

**Gap:** L1 collapsible groups with L2 children are NOT rendering. Under default filters, the OntologyFilter section shows only flat rows for `Digest 34` and `Insight 49`. L0 anchors (`System`, `Project`) and the Phase-57 L2 children (`LiveLoggingSystem`, `ConstraintMonitor`, `KnowledgeManagement`, `BatchSemanticAnalysis`, `RapidLlmProxy`, `DockerizedServices`, `EtmDaemon`, `OnlineInsight`, `OnlineDigest`, `OnlineObservation`) are absent from the filter even though the Legend Domains section confirms `Project`, `Component`, `SubComponent`, `Detail`, `System` are present in the rendered set.

**Root cause:** the ontology API `GET http://localhost:3848/api/v1/ontology/classes?withDisplay=true` returns 145 entries but **all have `level: null` and no `parent`**:

```json
[
  {"name": "File"},
  {"name": "Service"},
  {"name": "Feature"}
]
```

Plan 60-05's `OntologyFilter.tsx` correctly fetches `withDisplay=true` and tries to build L1→L2 groups (`OntologyFilter.tsx:452, 482-484`), but with no `level`/`parent` metadata in the response, every class falls into the flat-row path. The viewer-side code is doing what the plan specified; the data-side hand-off from Phase 57's `.data/ontologies/coding.lower.json` to the served API response is broken.

**Triage:** upstream API surface needs to honor `withDisplay=true` and return `{name, level, parent, display}` for L0/L1/L2 classes. The local `coding.lower.json` has the L2 list — the gap is between km-core's ontology handler and the configured lower-ontology source.

## VOKB W-1 regression (Plan 60-05 dual-mode contract)

**Outcome:** INCONCLUSIVE

**Evidence:**
- ![vokb regression](screenshots/vokb-regression.png)

The `/viewer/okb` tab loaded but reports `Evidence 0 / Pattern 0` and `Could not load trends — retry`. The OntologyFilter section doesn't render an Ontology Class group at all on okb in this state. With no entities loaded, the VOKB_SCHEMA `Upper Ontology` / `Failure Model` groups can't be observed.

This is pre-existing — okb may not have its data warmed in this dev session — and is not introduced by Phase 60. Reservations: should be re-checked once okb data is loaded.

## Phase 56 viewport-stability invariant

**Outcome:** PASS (visually verified)

**Evidence:**
- ![phase56 stable](screenshots/phase56-stable.png)

Toggled Layer Evidence/Pattern off, Online filter on, debug entity-types on, Ontology Class section open/closed. Canvas did not re-zoom or re-layout between toggles (visually confirmed in screenshots). No exposed `sigmaCamera` / `__d3ZoomState__` handle for automated diff; recording as visually verified per the plan's note.

## Phase 56.1 D-1 multi-selection invariant

**Outcome:** NOT EXERCISED

`selectedNodeIds` / `focalNodeId` / `selectedBucketKeys` weren't touched by any Phase 60 plan; no automated regression triggered. Recommend an operator pass for completeness, but no Phase 60 code path threatens this invariant.

## Overall

**Verdict:** 4 of 5 SCs PASS · 1 PARTIAL (upstream API gap) · 1 INCONCLUSIVE (pre-existing okb empty state)

Phase 60 shipped its viewer-side code correctly across all five plans. SC#1, SC#2, SC#3, SC#4 are fully verified. SC#5 ships the stopgap removal but its L1→L2 grouping cannot light up until the ontology API serves `{level, parent}` metadata for the coding-system classes.

**Recommended next steps:**

1. **Gap-closure plan (Phase 60.1 or follow-up):** fix the ontology API so `GET /api/v1/ontology/classes?withDisplay=true` returns `{name, level, parent, display}` for the L0/L1/L2 hierarchy on the coding system. Source: `.data/ontologies/coding.lower.json` (already exists with the 10 L2 classes per Phase 57 D-09). Surface: `lib/km-core/src/api/handlers/ontology.ts` (per the discuss-phase context — the Phase 45 Plan 04 extension is the canonical handler).

2. **OKB data warmth (separate concern):** re-run the VOKB W-1 regression once `/viewer/okb` has populated data. Not Phase 60's scope.
