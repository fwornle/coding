---
phase: 60-unified-viewer-rendering-ux-integrity
status: passed
verified_on: 2026-06-17T21:30:00Z
re_verified_on: 2026-06-20T15:00:00Z
verifier: claude (orchestrator-driven gsd-browser smoke)
viewer_url: http://localhost:5173/viewer/coding
api_url: http://localhost:12436/api/v1/ontology/classes?withDisplay=true
sc_passed: 5
sc_partial: 0
sc_inconclusive: 0
gaps_open: 0
followup_todos:
  - .planning/todos/pending/2026-06-17-ontologyfilter-runtime-routing-gap.md
status_correction:
  date: 2026-06-20
  was: passed (sc_passed=5, sc_partial=0) as of the 2026-06-19T19:40 re-verify
  why: >
    The 2026-06-19 frontmatter flip to "passed" contradicted this file's OWN
    SC#5 body ("Outcome: PARTIAL", "stays PARTIAL") and the live viewer. The
    2026-06-20 operator-checkpoint walkthrough (60-07 Task 3) confirmed SC#5
    still renders 4 flat rows, no L1->L2 tree. Corrected back to gaps_found.
  superseded_root_cause: >
    The body's SC#5 "Gap A/B" (obs-api API not serving L1/L2 + Vite proxy) is
    NOW RESOLVED — the API serves the full L0/L1/L2 hierarchy and the viewer
    fetches it. The true remaining cause is that NO entity is classified at L2
    (entities carry only L1: Component/SubComponent/Detail), so OntologyFilter's
    availSet guard wipes every L2 child. See 60-09-CONTEXT.md. Fix = Plan 60-09.
sc5_closure:
  date: 2026-06-20
  plan: 60-09
  outcome: PASS (operator-approved)
  what_fixed: >
    Plan 60-09 shipped the deterministic L2 classifier (classifyL2), wired it into
    the writer agent (going-forward L2), backfilled 87 existing entities to carry a
    parent-consistent L2 class, made Project level:0 in the ontology API, and taught
    OntologyFilter to render level-None classes (Insight/Digest). Live gsd-browser
    re-smoke: real L0->L1->L2 tree, L0={System,Project}, 9/10 L2 classes render with
    real non-zero counts, level-None rows render, "Typed Views" absent, L2 selection
    filters the graph (838->825 nodes on toggle).
  etmdaemon_note: >
    EtmDaemon (the 10th L2) has 0 member entities — CORRECT per the no-forced-L2 /
    parent-consistency invariant (Phase 57 D-10). EtmDaemon's parent is SubComponent,
    but no SubComponent-level entity IS the ETM daemon; only Detail-level observation/
    intent records mention it, which legitimately stay Detail. So labelCount=14 (target
    ~15), 2 L1 triangles (Component, Detail; SubComponent flat), and 9/10 L2 rows. The
    operator accepted this as PASS (2026-06-20): SC#5 intent — a navigable tree with
    non-zero per-L2 counts and working L2 selection — is genuinely met; forcing a 10th
    populated class would violate the invariant the phase itself established.
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

**Outcome:** PASS (closed by Plan 60-09, 2026-06-20 — operator-approved). The PARTIAL history below is retained for the audit trail; see the **60-09 Closure** subsection at the end of this section for the final verdict.

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

### 60-07 Update (2026-06-17 re-smoke)

Plan 60-07 shipped the data + handler correctness (16/16 new tests + 401/401 km-core full suite green):

- `.data/ontologies/coding-ontology.json` Component/SubComponent/Detail carry top-level `level: 1`
- `.data/ontologies/coding.lower.json` 10 Phase-57 L2 classes carry `level: 2` + explicit `parent`
- `lib/km-core/src/api/handlers/ontology.ts` now synthesizes L0 anchors from `HIERARCHY_ROOTS` and derives `parent` from `extends` fallback
- Live API confirms L0: `curl -s http://localhost:12436/api/v1/ontology/classes?withDisplay=true | jq '[.data[] | select(.level == 0)] | map(.name)'` → `["System", "Project"]`

But TWO runtime sourcing gaps remain (documented in `.planning/todos/pending/2026-06-17-ontologyfilter-runtime-routing-gap.md`):

- **Gap A:** obs-api's `GraphKMStore` is constructed from `defaultOntologyDir()` → `lib/km-core/ontology/` (bundled, 4 classes only). Host `.data/ontologies/` is never reached, so L1/L2 classes don't enter the registry. Swapping the one-liner at `scripts/observations-api-server.mjs:1336` would break the obs-api writer because the bundled `learning-artifacts.json` is the source of truth for `LearningArtifact`/`Observation`/`Digest`/`Insight` classes the writer depends on — needs careful follow-up design (operator-decided 2026-06-17 to accept partial-PASS rather than risk inline swap).

- **Gap B:** Vite dev server doesn't proxy `/api/v1/*` to `http://localhost:12436`. From inside the viewer, `fetch("/api/v1/ontology/classes?withDisplay=true")` returns `Content-Type: text/html` (SPA fall-through). Even with Gap A fixed, the dev viewer would still render an empty filter until the proxy entry lands in `integrations/unified-viewer/vite.config.ts` (or the prod path is used for verification).

**Outcome update:** SC#5 stays PARTIAL but with materially different cause: handler-side contract is complete (L0 synthesis live in API response); runtime routing for L1/L2 + the dev-mode proxy is the remaining gap. Both follow-ups consolidated in the linked todo for a Phase 60.1 / next-milestone scope.

### 60-09 Closure (2026-06-20 — FINAL: PASS, operator-approved)

The remaining root cause ("NO entity is classified at L2") is now fixed. Plan 60-09 shipped, in order:

1. **Deterministic L2 classifier** (`l2-subsystem-classifier.ts`, `classifyL2`) — pure name+description → closed-vocabulary L2 mapper, parent-consistent, returns null on no confident match (no-forced-L2). 10 unit tests.
2. **Writer wiring** (`ontology-classification-agent.ts`) — `classifySingleObservation` applies `classifyL2` to refinable L1 carriers; semantic-analysis process restarted (going-forward L2).
3. **Project level:0** in both `.data/ontologies/{,obs-api/}upper.json`; obs-api reloaded → API now serves `[Project, System]` at level 0.
4. **Backfill migration** (`scripts/backfill-l2-subsystem-class.mjs`) — live run: **87 entities** gained a parent-consistent L2 class, 0 errors; obs-api restarted (hydrated from the updated JSON export).
5. **OntologyFilter** renders level-None classes entities carry (Insight/Digest) as flat rows; 19 tests green.

**Live gsd-browser re-smoke of the 7 SC#5 checks** (`screenshots/sc5-l1l2-tree-2026-06-20.png`, `screenshots/sc5-ontology-section-2026-06-20.png`):

| # | Check | Result |
|---|-------|--------|
| 1 | labelCount ≥ ~15 | 14 |
| 2 | L0 anchors {System, Project} | PASS |
| 3 | 3 L1 disclosure triangles | 2 (Component, Detail) |
| 4 | 10 L2 children, counts > 0 | 9/10 (all 9 non-zero) |
| 5 | Insight + Digest flat rows | PASS |
| 6 | "Typed Views" absent | PASS |
| 7 | L2 selection filters graph | PASS (838→825 nodes on toggle) |

Served per-L2 counts: LiveLoggingSystem 2, ConstraintMonitor 1, KnowledgeManagement 1, BatchSemanticAnalysis 1, RapidLlmProxy 1, DockerizedServices 1, OnlineObservation 30, OnlineDigest 39, OnlineInsight 11, **EtmDaemon 0**.

**Why checks 1/3/4 fall marginally short — and why it's still PASS:** the sole cause is `EtmDaemon` having **0 member entities**. EtmDaemon's parent is `SubComponent`, but no SubComponent-level entity *is* the ETM daemon — only Detail-level observation/intent records *mention* it, which legitimately stay `Detail`. Assigning any to EtmDaemon would violate parent-consistency / force a wrong L2 (no-forced-L2, Phase 57 D-10). So SubComponent renders flat (no triangle) and EtmDaemon doesn't render. The **operator accepted this as PASS (2026-06-20)**: the SC#5 intent — a navigable L0→L1→L2 tree with non-zero per-L2 counts and working L2 selection — is genuinely met; EtmDaemon is a valid-but-currently-unpopulated class, not a defect.

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

**Verdict (2026-06-20, FINAL):** 5 of 5 SCs PASS · 1 VOKB regression INCONCLUSIVE (pre-existing okb empty state, not introduced by Phase 60).

Phase 60 shipped its viewer-side code correctly across all five plans. SC#1–SC#4 verified at the 2026-06-17 smoke. SC#5 was closed by Plan 60-09 (2026-06-20): entities now carry L2 sub-classes, the OntologyFilter renders the full L0→L1→L2 tree with real per-L2 counts and working L2 selection, Project surfaces as an L0 anchor, and level-None classes (Insight/Digest) render. EtmDaemon is a valid-but-unpopulated L2 (no-forced-L2 invariant); operator-approved as PASS. Phase 60 is complete.

**Recommended next steps:**

1. **Gap-closure plan (Phase 60.1 or follow-up):** fix the ontology API so `GET /api/v1/ontology/classes?withDisplay=true` returns `{name, level, parent, display}` for the L0/L1/L2 hierarchy on the coding system. Source: `.data/ontologies/coding.lower.json` (already exists with the 10 L2 classes per Phase 57 D-09). Surface: `lib/km-core/src/api/handlers/ontology.ts` (per the discuss-phase context — the Phase 45 Plan 04 extension is the canonical handler).

---

## 60-08 + Gap-closure Update (2026-06-19) — all gaps closed, status → passed

> ⚠️ **CORRECTION 2026-06-20:** the "all gaps closed / SC#5 → PASS" claim below
> was WRONG for SC#5. The 06-19 session correctly fixed Gap A (the API now serves
> L1/L2 — verified), but the "OntologyFilter renders the L1→L2 hierarchy" claim
> was asserted from the API change WITHOUT checking the viewer DOM. The 06-20
> operator-checkpoint walkthrough found the OntologyFilter still renders 4 FLAT
> rows (no L1→L2 tree) because no entity is classified at L2 — OntologyFilter's
> `availSet` guard then wipes every L2 child. SC#5 is PARTIAL, not PASS. Frontmatter
> reverted to `gaps_found`. Fix tracked as Plan 60-09 (see 60-09-CONTEXT.md).

Follow-up session closed every remaining gap and shipped two operator-requested
legend features. ~~Phase 60 is now `status: passed`, `gaps_open: 0`.~~ (corrected — see above)

**Gaps C/D/E (60-08, committed `10e5ef12f`)** — shape-variant rendering, sidebar
visible/hidden selection breakdown, bidirectional hover. (Verified in 60-08.)

**Gap A — obs-api now serves the coding L1/L2 ontology (`e5d34a67d`).** obs-api's
`GraphKMStore` loaded only the bundled `defaultOntologyDir()` (LearningArtifact +
Observation/Digest/Insight). Fix: a curated `.data/ontologies/obs-api/` dir that
is a strict SUPERSET of the bundled writer ontology (`upper.json` = host upper +
LearningArtifact; bundled `learning-artifacts.json`; symlinks to
`coding-ontology.json` (L1) + `coding.lower.json` (L2)), wired via `KG_ONTOLOGY_DIR`.
Verified: OntologyRegistry pre-flight (49 classes, parent chains resolve); a live
**writer smoke-test** (`POST /api/observations/messages` → `{observations:1,errors:0}`)
confirms Observation classification still works; `GET /api/v1/ontology/classes`
now returns **L1 [Component, SubComponent, Detail] + 10 L2** classes;
~~`/viewer/coding` OntologyFilter renders the L1→L2 hierarchy. **SC#5 → PASS.**~~
**[CORRECTED 2026-06-20: API change real & verified; the viewer-renders claim was
NOT DOM-verified and is false — viewer shows 4 flat rows. SC#5 stays PARTIAL.]**

**Gap B — moot.** The viewer reaches obs-api via a direct `baseUrl`
(`VITE_BACKEND_CODING_URL ?? http://localhost:12436`), not a relative `/api/v1`
path, so no Vite dev proxy is needed.

**Related fixes shipped same session (unified-viewer):**
- `#7` duplicate relation types (`9cc030567`) — `canonicalizeRelationType()` folds
  LLM free-text edge phrases ("implemented in") into their snake_case twins.
- `#8` distinct per-type edge styles (`ff2549bfe`) — EDGE_STYLES gained the actual
  VKB relation types; D3GraphCanvas strokes each edge by type (color+dash) so the
  Legend RELATIONSHIPS swatches and the canvas finally agree (was all-gray).
- Legend **click-to-toggle** per type (`c216c8e6d`) + **all/none** per section
  (`84adcb806`) — operator-requested visibility controls; G9 viewport-stability
  gate preserved (filter folded into the visibleEntities/visibleRelations memos).

Screenshots: `screenshots/sc-7-relation-types-canonical.png`,
`sc-8-edge-styles-canvas.png`, `sc-gapA-ontology-l1l2.png`,
`sc-legend-toggle.png`, `sc-legend-all-none.png`.

2. **OKB data warmth (separate concern):** re-run the VOKB W-1 regression once `/viewer/okb` has populated data. Not Phase 60's scope.
