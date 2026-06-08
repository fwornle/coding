---
phase: 46
phase_name: Per-System Documentation & Onboarding
captured: 2026-06-08
requirement: DOC-01
milestone: v7.1 Knowledge Management Unification — Phases 37-46
---

# Phase 46 Context — Per-System Documentation & Onboarding

## Phase Goal (from ROADMAP)

Each of A (coding repo / obs-api), B (mcp-server-semantic-analysis), C (rapid-automations OKM), and KM-Core ships documentation that lets a new contributor locate within 5 minutes where to edit a new ontology class, LLM provider, or ingest source — without reading source. KM-Core also ships an architecture diagram and an onboarding guide.

## Success Criteria (locked, from ROADMAP)

1. **5-minute discoverability.** A new contributor reading A's, B's, or C's README can locate within five minutes the exact config file(s) they would edit to add a new ontology class or LLM provider for that system.
2. **Architecture clarity.** KM-Core's architecture diagram clearly distinguishes shared core (types, store, registry, pipeline, dedup, REST, viewer) from per-system configuration (ontology files, LLM config, ingest adapters, domain eval).
3. **Verifiable onboarding.** The onboarding guide walks a new developer from clone → run KM-Core tests → register a new lower ontology → ingest a sample entity, with each step verifiable.
4. **Cross-references.** Each system's README cross-references the others and KM-Core, so a contributor entering through any of the four doors can navigate to the others.

## Existing Doc Inventory (baseline)

| System | Current README | State |
|---|---|---|
| A (coding) | `README.md` (project root) | Marketing intro + Quick Start; no "Configurations Owned" section |
| B (mcp-server-semantic-analysis) | `integrations/mcp-server-semantic-analysis/README.md` | Large, agent-focused; doesn't call out config ownership clearly |
| C (OKM) | `_work/rapid-automations/integrations/operational-knowledge-management/README.md` | Exists (external repo) |
| KM-Core | `lib/km-core/README.md` | Has install + a Mermaid architecture diagram; no per-system config map; no onboarding guide |

## Decisions (locked)

### D-46-01: A's documentation lives in the project-root README

**Decision:** A's "Configurations Owned" section is added to the existing `README.md` at the coding repo root. No new dedicated A README file.

**Why:** The root README is where `./install.sh` lands new contributors. Splitting A docs into a deep nested path (e.g. `docs-content/systems/coding/README.md`) would hurt SC1 (5-min discoverability) — contributors don't know where to look.

**Implementation:** Restructure root README to add a top-level `## A: coding system — Configurations Owned` section near the top (under Quick Start). Keep marketing intro, but section it out. Cross-reference KM-Core / B / C READMEs per SC4.

### D-46-02: Standardized README template across all four systems

**Decision:** A / B / C / KM-Core all conform to the same README skeleton:

1. `# {System Name}` + 1-sentence role in KM
2. `## Configurations Owned` — bullet list of config domains (ontology, LLM, ingest, domain eval)
3. `## Architecture` — embedded diagram + brief box summary
4. `## Where to Edit` — table mapping "what you want to add" → "files you touch" (covers SC1)
5. `## Related Systems` — link to KM-Core + the other two systems (covers SC4)
6. `## Tests / Verify` — for KM-Core only, includes onboarding guide link

**Why:** SC1 (5-min discoverability) and SC4 (cross-refs) both reward consistency. A standardized skeleton lets a contributor reading B's README and then jumping to C's find the same section names in the same place.

**Implementation:** Define the template skeleton in `lib/km-core/docs/README-TEMPLATE.md` (or similar). Each system's README rewrite follows it. Section order is fixed; subsection content is system-specific.

### D-46-03: PlantUML for all new diagrams; migrate KM-Core's Mermaid

**Decision:** All architecture diagrams use PlantUML (`plantuml` CLI). KM-Core's existing inline Mermaid block (the flowchart TB) is migrated to a PUML source. Generated PNGs are checked in.

**Why:** Project-wide CLAUDE.md mandate. Consistency across documentation reduces tooling overhead and matches the existing convention in `docs/puml/` → `docs/images/`.

**Implementation:**
- PUML sources land in `docs/puml/` (per existing convention).
- Generated PNGs land in both `docs/images/` AND `docs-content/images/` (MkDocs two-dir gotcha — see memory note `feedback_mkdocs_two_image_dirs.md`).
- Each system README references the PNG inline via relative path.
- Plan must include a one-shot step to render PUML → PNG (via `plantuml` CLI, NEVER `java -jar`) and commit both.

### D-46-04: Onboarding exercise = add a fictional `LslHeartbeatRotator` SubComponent

**Decision:** The KM-Core onboarding guide walks the contributor through registering and ingesting a fictional new `LslHeartbeatRotator` entity under the existing `LiveLoggingSystem` Component in the coding KG.

**Why:** Real-system grounding beats synthetic placeholders for learning value. LSL is a well-established subsystem in the project, with active development through Phase 51 — new contributors arriving in 2026 will encounter it. The exercise touches every relevant moving part:
1. **Ontology registration** — adding the `SubComponent` class entry under LiveLoggingSystem.
2. **Ingest path** — writing an observation via `ObservationWriter` that mentions the entity.
3. **Persistence** — observing how the wave-analysis pipeline materializes it.
4. **Verification** — querying via `/api/v1/entities?ontologyClass=SubComponent` and seeing the entity surface in the unified viewer at `/viewer/coding`.

**Why fictional, not real:** Avoids polluting the live KG with a "tutorial entity" that subsequent runs would dedupe or merge. The plan must specify a cleanup step. **NOTE (post plan-checker correction):** the `scripts/purge-knowledge-entities.js` script filters by date+team only, NOT by entity name — running it for cleanup would catastrophically sweep ALL same-day entities. The corrected cleanup uses the km-core REST DELETE endpoint directly: `curl -X DELETE http://localhost:12436/api/v1/entities/{id}` against the entity's UUIDv7 captured at ingest time. See Plan 46-05 Step 7.

**Verifiable steps** (per SC3, each step has a command + expected output):
- `git clone ...` → working tree at repo root
- `cd lib/km-core && npm install && npm test` → all unit tests GREEN
- `cd /Users/Q284340/Agentic/coding && cat .data/ontologies/coding-ontology.json | jq '.classes.LiveLoggingSystem'` → existing class shown
- (Edit) add `LslHeartbeatRotator` SubComponent entry
- `(via ObservationWriter)` ingest a tutorial observation → entity persisted
- `curl http://localhost:12436/api/v1/entities | jq '.data[] | select(.name == "LslHeartbeatRotator")'` → entity surfaces
- (Cleanup) `curl -X DELETE http://localhost:12436/api/v1/entities/{id}` (id captured from ingest response) → entity removed; re-query returns empty

## Scope Boundaries (locked)

**In scope:**
- Restructuring README.md (root) for A
- Restructuring `integrations/mcp-server-semantic-analysis/README.md` for B
- Restructuring `_work/rapid-automations/integrations/operational-knowledge-management/README.md` for C (external repo — coordinate via submodule pointer bump; respect OKM's own commit conventions)
- Restructuring `lib/km-core/README.md` for KM-Core
- Writing a new `lib/km-core/docs/ONBOARDING.md` (the verifiable guide per SC3)
- Migrating KM-Core's Mermaid diagram to PlantUML
- Adding PlantUML source for the per-system architecture diagram (KM-Core gets at least 2 diagrams: high-level + ingest sequence)
- Defining the README-TEMPLATE.md skeleton

**Out of scope (deferred):**
- New end-user / operator documentation (e.g., "how to deploy", "how to use the viewer") — Phase 46 is contributor-focused per SC3.
- Per-system architecture diagrams for A/B/C (KM-Core gets the diagram per SC2; A/B/C can use a smaller context diagram or text only — plan to recommend a single context diagram per system).
- CI doc-rot detection / link-check automation — could be a v7.3 milestone.
- API reference docs auto-generated from JSDoc — separate phase.

## Cross-Phase Dependencies

- **Depends on:** Phase 45 (unified web viewer) — onboarding exercise references `/viewer/coding` as the verification step for SC3.
- **Required artifact:** Phase 45's `.data/ontologies/coding.display.json` defines display hints used by the viewer; the onboarding guide references this overlay.

## Open Questions for Researcher

1. **OKM repo coordination.** The C README lives in an external repo (`_work/rapid-automations`). What's the merge / coordination protocol for changes there? Submodule pointer bump? PR against OKM upstream? Researcher: read `_work/rapid-automations/integrations/operational-knowledge-management/AGENT-WORKING.md` or equivalent.
2. **Existing KM-Core README content reuse.** What parts of the current KM-Core README (install + types overview) are still accurate? Which need updates for Phase 44 / 45 changes (Plan 44-16 wire-shape lock, Phase 45 display-overlay handler)?
3. **B README — keep agent catalog or move it.** The current 14-agent catalog is the README's bulk. Should it stay or move to a separate `AGENTS.md` so the "Configurations Owned" section can dominate?
4. **MkDocs integration.** docs-content/ is MkDocs-managed (per memory note `feedback_mkdocs_two_image_dirs.md`). Does Phase 46 deliverables also need to land in MkDocs nav, or are READMEs sufficient?

## Discussion Log

- 2026-06-08: Initial discuss-phase. Four gray areas presented (A README location, structure standardization, diagram tooling, onboarding exercise). User selected all four. All four recommendations accepted.
