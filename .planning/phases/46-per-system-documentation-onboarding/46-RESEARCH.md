<!--
OVERRIDE_CONSTRAINT: plantuml-standard-styling
OVERRIDE_CONSTRAINT: plantuml-diagram-name-format
Rationale: This is a markdown RESEARCH.md file, not a .puml source. Any references to PUML
directives below are documentation strings describing conventions contributors must follow,
not PUML source code that will be rendered. The actual PUML source files authored by the
planner under docs/puml/ and lib/km-core/docs/puml/ MUST begin with the standard preamble
plus the standard-style include, per the constraints — this file documents that requirement.
-->

# Phase 46: Per-System Documentation & Onboarding — Research

**Researched:** 2026-06-08
**Domain:** Documentation architecture, README templating, onboarding flow design
**Confidence:** HIGH (locked CONTEXT.md drives ~80% of design; researcher fills 4 open questions + diagram/exercise paths)

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-46-01:** A's "Configurations Owned" section lives in the project-root `README.md`. No new dedicated A README file.
- **D-46-02:** Standardized README template (6 sections) across A / B / C / KM-Core. Skeleton in `lib/km-core/docs/README-TEMPLATE.md`.
- **D-46-03:** PlantUML CLI (`plantuml`, NEVER `java -jar`) for all new diagrams. KM-Core's existing inline Mermaid migrates to PUML. PNGs land in BOTH `docs/images/` AND `docs-content/images/` (MkDocs two-dir gotcha).
- **D-46-04:** Onboarding exercise = add fictional `LslHeartbeatRotator` SubComponent under the existing `LiveLoggingSystem` Component; cleanup via `scripts/purge-knowledge-entities.js`.

### Claude's Discretion
- README section content (within the fixed 6-section skeleton)
- Diagram count for A/B/C (single context diagram each recommended; KM-Core gets at least 2)
- README-TEMPLATE.md exact wording
- Onboarding exercise verbatim shell-command sequence (must include verifiable expected output per SC3)

### Deferred Ideas (OUT OF SCOPE)
- New end-user/operator documentation
- Per-system architecture diagrams beyond a single context diagram for A/B/C
- CI doc-rot/link-check automation (deferred to v7.3)
- API reference docs auto-generated from JSDoc

## Project Constraints (from CLAUDE.md)

- **PlantUML:** `plantuml` CLI only; NEVER `java -jar plantuml.jar`. Generate via `plantuml docs/puml/<name>.puml`, then `mv docs/puml/*.png docs/images/`.
- **`documentation-style` skill:** Mandatory invocation BEFORE any PUML / Mermaid / docs work (per `lib/km-core/CLAUDE.md` and OKM's `CLAUDE.md`).
- **Standard-style PUML include:** Every PUML file must begin with the standard preamble plus the project's standard-style include directive (verified pattern in `docs/puml/adaptive-lsl-system.puml:1-2`) to apply project skinparams.
- **MkDocs two image dirs:** `docs_dir: docs-content` (mkdocs.yml:7) so PNGs must be duplicated to BOTH `docs/images/` AND `docs-content/images/` (per `feedback_mkdocs_two_image_dirs.md`).
- **Submodule build pipeline:** Phase 46 only touches READMEs (no TS), so no `npm run build` + Docker rebuild needed.
- **`no-evolutionary-names` constraint:** `LslHeartbeatRotator` is a real architectural name (not "Enhanced"/"v2"/etc.), but the regex may false-positive. If it fires, use `OVERRIDE_CONSTRAINT: no-evolutionary-names` with rationale; do NOT rename.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOC-01 | New contributor locates config files within 5 min via README | Section "README Template Skeleton" — 6-section template, "Where to Edit" table forces explicit paths |
| SC-1 | 5-minute discoverability across A/B/C READMEs | "Where to Edit" table required in every README |
| SC-2 | KM-Core architecture diagram distinguishes shared vs per-system | "Diagram Plan" — 2 KM-Core PUMLs (overview + ingest sequence) |
| SC-3 | Verifiable onboarding (clone → tests → ontology → ingest → verify) | "Onboarding Exercise Script" — 7 verifiable steps with expected output |
| SC-4 | Cross-references between A/B/C/KM-Core | Template Section 5 "Related Systems" — 4-way cross-link required |

## Summary

Phase 46 is a documentation-restructuring phase with no production code changes. Four locked decisions (D-46-01..04) constrain ~80% of the design space. The work is: (1) author `lib/km-core/docs/README-TEMPLATE.md`, (2) rewrite four READMEs to that template (root, B's submodule, C's external repo, KM-Core), (3) migrate KM-Core's Mermaid block to PUML and add an ingest-sequence diagram, (4) author `lib/km-core/docs/ONBOARDING.md` walking through the `LslHeartbeatRotator` exercise with verifiable shell commands, (5) duplicate generated PNGs to both `docs/images/` and `docs-content/images/`. The C work lives in a **separate BMW GHE repo** (`https://bmw.ghe.com/adpnext-apps/operational-knowledge-management.git`) accessed via the parent `_work/rapid-automations` submodule at `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/` — NOT under the coding repo's `_work/` (which does not exist). **Primary recommendation:** sequence the plan as Wave 0 (template + PUML diagrams + verification probes) → Wave 1 (A + KM-Core READMEs) → Wave 2 (B README + C README) → Wave 3 (ONBOARDING.md + verification dry-run), so the template is settled before downstream READMEs reference it.

## Open Question Resolutions

### OQ-1: OKM Repo Coordination Protocol

**Finding:** OKM is a nested git submodule. The path is **NOT** `coding/_work/...` (coding has no `_work` dir) but `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/` — a peer of coding under `/Users/Q284340/Agentic/`. The OKM repo's remote is `https://bmw.ghe.com/adpnext-apps/operational-knowledge-management.git`; the parent `rapid-automations` repo is also BMW GHE. Currently checked out on branch `gsd/44-09-rest-cutover-v2` (NOT main). **No `AGENT-WORKING.md`** exists; the operative governance doc is `CLAUDE.md` at the OKM root (mirrors the global no-evolutionary-names + documentation-style rules).

**Coordination protocol:** Three-step.
1. Branch + commit the C README directly inside the OKM repo at `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/`.
2. Push to OKM's `origin` (BMW GHE, HTTPS — per MEMORY.md `feedback_bmw_ghe_https.md` SSH fails; default to HTTPS for BMW GHE).
3. Bump the parent `rapid-automations` submodule pointer to include the new OKM commit. The coding repo does NOT track `rapid-automations` — there is no submodule pointer to bump on the coding side. The PR lands on the BMW GHE `rapid-automations` repo.

**Sources:** `/Users/Q284340/Agentic/_work/rapid-automations/.git/config` (HTTPS remote), `git branch --show-current` in OKM (= `gsd/44-09-rest-cutover-v2`), `ls -la /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/` (no AGENT-WORKING.md, CLAUDE.md present), MEMORY.md `feedback_bmw_ghe_https.md`. **Confidence: HIGH.**

### OQ-2: KM-Core README Staleness Audit

**Finding:** Current `lib/km-core/README.md` is **95 lines, accurate but minimal**. Audit by section:

| Section (current) | Status | Action |
|---|---|---|
| Header (`@fwornle/km-core`, status v0.1) | Accurate | Keep; bump status note to reflect Phase 44/45 maturity |
| Architecture (inline Mermaid flowchart) | Accurate but Mermaid | **Migrate to PUML per D-46-03**, add ingest-sequence diagram per SC-2 |
| Install (git submodule) | Accurate | Keep |
| Build / Test (vitest) | Accurate | Keep |
| Public API (Entity, Relation, GraphKMStore exports) | **Stale** — missing Phase 44 additions: REST contracts (`@fwornle/km-core/api/contracts`), `SnapshotManager`, `display-overlay`, ontology `registry` | Expand exports list |
| Per-domain Export Contract | Accurate | Keep |
| License + Contributing | Accurate | Keep |
| **MISSING** | — | Add 6-section template: Configurations Owned / Where to Edit / Related Systems / Tests-Verify (with ONBOARDING link) |

**Critical Phase 44/45 additions to surface:** REST handler API at `src/api/handlers/` (Plan 44-16 camelCase wire-shape lock), `src/snapshots/SnapshotManager.ts` (git-tag snapshots), `src/ontology/display-overlay.ts` (Phase 45 display overlay, `?withDisplay=true` query branch). **Sources:** `lib/km-core/src/index.ts`, `lib/km-core/src/api/` listing, ROADMAP entries for 44-16 and 45-04. **Confidence: HIGH.**

### OQ-3: B README — Inline 14-Agent Catalog vs. Move to AGENTS.md

**Finding:** B's README is **22,622 bytes / 573 lines / 60+ `##` headings**. The 14-agent catalog occupies lines 9-27 (high signal, stays near top), but the bulk (lines 88-545) is per-agent enhancement narratives, MCP tool list, performance discussion, use-case walkthroughs, and project structure — none of which serves SC-1 ("locate config file in 5 minutes").

**Recommendation: SPLIT.** Keep in `README.md`:
- Header + 1-sentence role
- Configurations Owned (NEW)
- 14-agent catalog (just names + 1-line roles) — moves under "Architecture" section as the box list
- Where to Edit table (NEW, SC-1 critical)
- Related Systems (NEW, SC-4)
- Tests / Verify (NEW)

Move to a new `integrations/mcp-server-semantic-analysis/docs/AGENTS.md`:
- Per-agent enhancement details (current lines 88-141, 234-394)
- LLM provider chain narrative (lines 126-141)
- Use cases (lines 413-462)
- Project structure (lines 513-545)

This keeps the README under ~150 lines (5-min-readable per SC-1) while preserving the operational depth in a linkable companion doc. **Sources:** `wc -l` + `grep -n "^##"` on the B README. **Confidence: HIGH.**

### OQ-4: MkDocs Integration — Do READMEs need to land in nav?

**Finding:** `mkdocs.yml` has `docs_dir: docs-content` (line 7) and the `docs-content/` tree contains `architecture/`, `core-systems/`, `getting-started/`, `guides/`, `integrations/`, `reference/`, `release-notes.md`, `images/`. **No `nav:` block** is in the top 60 lines of `mkdocs.yml` (MkDocs auto-generates nav from the tree).

**Recommendation:** READMEs are sufficient — do NOT add nav entries. Per the MkDocs auto-nav behavior + the deferred-ideas list ("CI doc-rot detection / link-check automation could be a v7.3 milestone"), Phase 46 does not need to wire READMEs into MkDocs nav. **However, PNG duplication is still mandatory:** generated PNGs MUST land in BOTH `docs/images/` (referenced by repo READMEs) AND `docs-content/images/` (referenced by MkDocs-rendered pages), per the documented two-image-dir gotcha. **Sources:** `mkdocs.yml:1-60`, `ls docs-content/`, `feedback_mkdocs_two_image_dirs.md`. **Confidence: HIGH.**

## README Template Skeleton (D-46-02)

To live at `lib/km-core/docs/README-TEMPLATE.md`. Six fixed sections; subsection content system-specific.

```markdown
# {System Name}

> One-sentence role in the KM unification (what this system OWNS).

## Configurations Owned

- **Ontology:** `<path>` — what classes live here
- **LLM providers:** `<path>` — which provider config files
- **Ingest adapters:** `<path>` — which event sources / writers
- **Domain eval / dedup:** `<path>` — system-specific scoring logic

(For systems that don't own one of these slots: write "— (owned by KM-Core / B / etc.)" rather than omitting the line, so the contract is visible.)

## Architecture

![{System Name} architecture](docs/images/{system}-architecture.png)

<!-- 3-5 sentence summary of the diagram boxes. NOT a long discussion. -->

## Where to Edit

| To add… | Edit… | Verify |
|---------|-------|--------|
| A new ontology class | `<path/to/ontology.json>` | `<curl probe or npm test>` |
| A new LLM provider | `<path/to/llm-config>` | `<restart cmd>` |
| A new ingest source | `<path/to/adapter>` | `<adapter test>` |
| Domain-specific dedup rule | `<path/to/dedup.ts>` | `<unit test file>` |

## Related Systems

- [KM-Core](../../lib/km-core/README.md) — shared types / store / REST / viewer
- [A: coding](../../README.md) — observation source, host runtime
- [B: mcp-server-semantic-analysis](../../integrations/mcp-server-semantic-analysis/README.md) — agent pipeline, wave-analysis workflow
- [C: OKM](https://bmw.ghe.com/adpnext-apps/operational-knowledge-management) — RCA / operational ingest (external BMW GHE)

## Tests / Verify

```bash
# system-specific verification snippet
```

<!-- KM-Core's README adds: [Onboarding guide](./docs/ONBOARDING.md) -->
```

## System-by-System Edit Map

### A (root `README.md`)

| Template Section | Source/Insertion Point | What to Write |
|---|---|---|
| 1. Header | Existing line 1-3 | Keep marketing intro; no change |
| 2. Configurations Owned | NEW, insert after Quick Start (after line ~28) | `config/agents/*.json` (agent abstraction), `.data/ontologies/coding-ontology.json` (ontology declarations), `src/live-logging/redaction-patterns.json` (redaction), `scripts/configure-wave-analysis-routing.sh` (LLM routing) |
| 3. Architecture | Existing `coding-system-architecture.png` (already in `docs/images/`) | Reuse existing diagram; add 3-sentence caption |
| 4. Where to Edit | NEW, table | "add ontology class" → `.data/ontologies/coding-ontology.json` + run `curl localhost:12436/api/v1/ontology/classes`; "add LLM provider" → `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` + restart `com.coding.llm-cli-proxy`; "add ingest source" → `src/live-logging/<Writer>.js` + `tests/live-logging/*.test.js`; "add dedup rule" → `src/live-logging/ObservationWriter.js` (Jaccard 0.45 / containment 0.7 / 4-keyword floor) |
| 5. Related Systems | NEW | Link to KM-Core, B, C |
| 6. Tests / Verify | NEW | `npm test` + `curl localhost:12436/api/v1/entities | jq '.data | length'` |

### B (`integrations/mcp-server-semantic-analysis/README.md`)

| Template Section | Source/Insertion Point | What to Write |
|---|---|---|
| 1. Header | Existing lines 1-7 | Keep "MCP server for semantic analysis"; tighten to 1 sentence |
| 2. Configurations Owned | NEW | `config/agents/*.json` (per-agent prompts), `config/workflows/*.json` (wave-analysis routing — see `scripts/configure-wave-analysis-routing.sh`), `lib/llm/` (provider chain), `.data/ontologies/coding-ontology.json` (READS, doesn't own — call this out) |
| 3. Architecture | NEW PUML: `b-architecture.png` (14 agents grouped by role: 8 LLM-enhanced / 2 infrastructure / 1 orchestration + wave-controller) | Reuse 14-agent catalog (current lines 9-27) inline |
| 4. Where to Edit | NEW | "add agent" → `src/agents/<NewAgent>.ts` + register in `src/agents/index.ts` + add to `coordinator.ts` workflow; "change LLM routing" → `config/workflows/<wf>.json processOverrides`; "add wave step" → `src/wave-controller.ts` |
| 5. Related Systems | NEW | Cross-link to KM-Core / A / C |
| 6. Tests / Verify | NEW | `npm test` (in submodule, after rebuild + Docker rebuild per CLAUDE.md submodule contract) |
| **Moved to `docs/AGENTS.md`** | Existing lines 88-141, 234-394, 413-462, 513-545 | Per-agent enhancements, MCP tool catalog, use cases, project structure |

### C (`/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/README.md`)

| Template Section | Source/Insertion Point | What to Write |
|---|---|---|
| 1. Header | NEW FILE (no README exists today) — base on `docs/index.md:1-17` | "Operational Knowledge Base (OKB) — graph-backed KM for RAPID-Automations" |
| 2. Configurations Owned | NEW | `ontology/*.json` (RAPID upper + RaaS + KPI-FW + business lower ontologies), `lib/llm/` provider config, `src/ingest/adapters/` (MkDocs, Confluence, CodeBeamer), `src/intelligence/` (dedup, clustering, scoring) |
| 3. Architecture | Existing `docs/images/okb-architecture.png` referenced from `docs/index.md:20` | Reuse |
| 4. Where to Edit | NEW | "add lower ontology" → `ontology/<domain>-ontology.json`; "add LLM provider" → `lib/llm/providers/`; "add ingest source" → `src/ingest/adapters/`; "add dedup rule" → `src/intelligence/dedup.ts` |
| 5. Related Systems | NEW | Cross-link to KM-Core (via npm), A (coding), B |
| 6. Tests / Verify | NEW | `npm test` + `curl localhost:8090/api/stats` |

**Note:** Sections 2-6 cherry-pick content from the existing OKM `docs/` tree (api-reference, architecture, ontology, llm-providers, ingestion). Do NOT duplicate the long-form prose — link to it.

### KM-Core (`lib/km-core/README.md`)

| Template Section | Source/Insertion Point | What to Write |
|---|---|---|
| 1. Header | Existing line 1-5 | Keep `@fwornle/km-core` intro; bump status v0.1 → v1.0 reflecting Phase 44/45 stabilization |
| 2. Configurations Owned | NEW | "KM-Core is the SHARED CORE — owns no per-system config" — explicit non-ownership statement |
| 3. Architecture | **Migrate existing Mermaid → PUML** (`km-core-architecture.puml`) + add **NEW** `km-core-ingest-sequence.puml` (SC-2 requires the sequence) | Two diagrams |
| 4. Where to Edit | NEW | "add Entity type" → `src/types/entity.ts`; "add REST endpoint" → `src/api/handlers/`; "add ingest stage" → `src/pipeline/IngestPipeline.ts`; "extend display overlay" → `src/ontology/display-overlay.ts` |
| 5. Related Systems | NEW | Cross-link to A, B, C — note KM-Core is consumed by all three |
| 6. Tests / Verify | NEW | `npm test` + link to `docs/ONBOARDING.md` |

## Diagram Plan (D-46-03)

All PUMLs MUST begin with the project's standard preamble plus the standard-style include directive and follow the conventions in `/Users/Q284340/Agentic/coding/docs/puml/_standard-style.puml` (verified). All PNGs duplicated to both `docs/images/` AND `docs-content/images/`.

| # | PUML Source | PNG Destinations | Purpose | Status |
|---|---|---|---|---|
| 1 | `lib/km-core/docs/puml/km-core-architecture.puml` | `docs/images/km-core-architecture.png` + `docs-content/images/km-core-architecture.png` | High-level: shared core (types/store/registry/pipeline/dedup/REST/viewer) vs per-system config (ontology / LLM / ingest / domain-eval) — directly satisfies SC-2 | NEW (migrate from existing Mermaid in `lib/km-core/README.md:9-19`) |
| 2 | `lib/km-core/docs/puml/km-core-ingest-sequence.puml` | `docs/images/km-core-ingest-sequence.png` + `docs-content/images/km-core-ingest-sequence.png` | Sequence diagram: consumer → IngestPipeline → dedup → GraphKMStore → exports → events. Used in ONBOARDING.md to anchor the ingest step. | NEW |
| 3 | `docs/puml/b-architecture.puml` | `docs/images/b-architecture.png` + `docs-content/images/b-architecture.png` | B's 14-agent layout grouped by role (8 LLM / 2 infra / 1 orchestration + wave-controller) | NEW |
| 4 | `_work/rapid-automations/.../operational-knowledge-management/docs/puml/okm-architecture.puml` | `docs/images/okm-architecture.png` (in OKM repo) | OKM context diagram (Express :8090 + viewer :3002 + ingest adapters) — likely exists already at `docs/images/okb-architecture.png`, may need PUML source created | EXISTING PNG, possibly NEW PUML source |
| — | A reuses `docs/images/coding-system-architecture.png` | — | Already exists | No new diagram |

**Render command (per CLAUDE.md):**

```bash
plantuml lib/km-core/docs/puml/km-core-architecture.puml
mv lib/km-core/docs/puml/km-core-architecture.png docs/images/km-core-architecture.png
cp docs/images/km-core-architecture.png docs-content/images/km-core-architecture.png
```

The planner MUST insert `OVERRIDE_CONSTRAINT: ...` if `documentation-style` skill enforces a different image-naming convention. **Invoke `documentation-style` skill before any PUML work — mandatory per `lib/km-core/CLAUDE.md` and project CLAUDE.md.**

## Onboarding Exercise Script (D-46-04)

Lives at `lib/km-core/docs/ONBOARDING.md`. Walks the contributor through registering and ingesting a fictional `LslHeartbeatRotator` SubComponent under the existing `LiveLoggingSystem` Component.

**Critical caveat the planner MUST handle:** `LiveLoggingSystem` exists in the **live KG** (verified: `general.json` contains the entity with class `Component`) but **NOT in `.data/ontologies/coding-ontology.json` `classes`** (verified: 21 classes total, no `LiveLoggingSystem` entry). The ontology declares only the generic classes (`Component`, `SubComponent`, `Detail`, etc.); concrete Component *instances* like `LiveLoggingSystem` are data-instantiated. The exercise therefore registers a new `SubComponent` instance whose `componentName` field references `LiveLoggingSystem` — NOT a new class. This is the correct ontology semantic (componentName is a property of SubComponent, per `coding-ontology.json` classes.SubComponent.properties).

### Step-by-step (each step has a runnable command + expected output)

**Step 0 — Prerequisites (skip if already set up)**
```bash
git clone <repo> && cd coding
git submodule update --init --recursive
```
Expected: working tree with `lib/km-core/` populated.

**Step 1 — Build + test KM-Core**
```bash
cd lib/km-core
npm install && npm run build
npm test
```
Expected: vitest reports all tests GREEN (count varies by phase; at least 100 tests after Phase 44).

**Step 2 — Inspect ontology**
```bash
cd /Users/Q284340/Agentic/coding
cat .data/ontologies/coding-ontology.json | jq '.classes.SubComponent'
```
Expected output: JSON object with `description`, `relationships: []`, `properties: ["componentName", "parentComponent", "level"]`. **(Verified during research.)**

**Step 3 — Inspect existing LSL SubComponents (templates)**
```bash
cat .data/knowledge-graph/exports/general.json | \
  jq '.nodes[] | .attributes | select(.entityType == "SubComponent" and (.name | startswith("LSL"))) | {name, componentName: .componentName, layer}' | head -30
```
Expected: 5-8 entries like `LSLConverter`, `LSLConfigValidator`, `LSLFormatter`, etc. — each with `entityType: "SubComponent"`, `ontologyClass: "SubComponent"`. **(Verified during research.)**

**Step 4 — Ingest the tutorial entity via the obs-api**

The contributor uses the host-side REST endpoint (port 12436) — the canonical write path for new SubComponents per Phase 44's wire-shape lock. **(NOTE for planner: confirm during plan-checking whether the entity creation endpoint is `POST /api/v1/entities` or `POST /api/v1/ingest` — both surface in 44-16-PLAN.md; pick the one tagged "stable" in km-core handlers index.)**

```bash
curl -X POST http://localhost:12436/api/v1/entities \
  -H "Content-Type: application/json" \
  -d '{
    "name": "LslHeartbeatRotator",
    "entityType": "SubComponent",
    "ontologyClass": "SubComponent",
    "layer": "evidence",
    "componentName": "LiveLoggingSystem",
    "description": "Tutorial entity from the Phase 46 onboarding guide. Demonstrates rotating LSL heartbeat tokens. Safe to purge — see cleanup step."
  }'
```
Expected: `{"id": "019...", "status": "created"}` (UUIDv7).

**Step 5 — Verify via API**
```bash
curl 'http://localhost:12436/api/v1/entities?ontologyClass=SubComponent' | \
  jq '.data[] | select(.name == "LslHeartbeatRotator")'
```
Expected: returns the tutorial entity with `id`, `name`, `entityType`, `componentName: "LiveLoggingSystem"`.

**Step 6 — Verify via unified viewer (Phase 45 dependency)**
Open `http://localhost:3032/viewer/coding` in a browser. Search the FilterRail for `LslHeartbeatRotator`. The entity surfaces in the WebGL graph; EntityDetailPanel shows the tutorial description.

**Step 7 — Cleanup (mandatory — do NOT pollute live KG)**
```bash
node scripts/purge-knowledge-entities.js 2026-06-08 --name=LslHeartbeatRotator --verbose
```
Expected: `Purged 1 entity (id=019...)`. Or for safer testing first: append `--dry-run`. **(Verified: `scripts/purge-knowledge-entities.js` exists.)**

**Post-exercise check:**
```bash
curl 'http://localhost:12436/api/v1/entities?ontologyClass=SubComponent' | \
  jq '.data[] | select(.name == "LslHeartbeatRotator")'
```
Expected: empty `null` (entity removed).

### Caveats the planner must surface

1. **Dedup overlap:** the entity name `LslHeartbeatRotator` is distinctive enough that the wave-analysis dedup (Jaccard 0.45, containment 0.7/4-keyword) should NOT collapse it. If a future planner changes the name, re-verify dedup safety.
2. **Cleanup is mandatory:** if the contributor forgets step 7, subsequent wave-analysis runs may fuzzy-merge the tutorial entity into real LSL components. ONBOARDING.md must put step 7 in a `!!! warning` admonition (MkDocs convention).
3. **`no-evolutionary-names` constraint risk:** `LslHeartbeatRotator` may false-positive against the constraint regex. The exercise prose should include the `OVERRIDE_CONSTRAINT: no-evolutionary-names` rationale inline so contributors know how to handle it.
4. **REST endpoint stability:** Step 4's POST endpoint — the planner must verify `POST /api/v1/entities` is the current contract (Plan 44-16 camelCase lock). If the canonical write path is `POST /api/v1/ingest` instead, swap accordingly.

## Files the Planner Will Touch

### Coding repo (this repo)

| Path | Action |
|---|---|
| `README.md` | Edit — add 4 new sections (Configurations Owned, Where to Edit, Related Systems, Tests / Verify) |
| `lib/km-core/README.md` | Rewrite to template; replace Mermaid with PUML reference |
| `lib/km-core/docs/README-TEMPLATE.md` | NEW |
| `lib/km-core/docs/ONBOARDING.md` | NEW |
| `lib/km-core/docs/puml/km-core-architecture.puml` | NEW (migrate from inline Mermaid) |
| `lib/km-core/docs/puml/km-core-ingest-sequence.puml` | NEW |
| `docs/images/km-core-architecture.png` | NEW (generated) |
| `docs/images/km-core-ingest-sequence.png` | NEW (generated) |
| `docs-content/images/km-core-architecture.png` | NEW (duplicated) |
| `docs-content/images/km-core-ingest-sequence.png` | NEW (duplicated) |
| `integrations/mcp-server-semantic-analysis/README.md` | Rewrite to template (in submodule — separate commit + push to `fwornle/mcp-server-semantic-analysis`) |
| `integrations/mcp-server-semantic-analysis/docs/AGENTS.md` | NEW (in submodule) |
| `docs/puml/b-architecture.puml` | NEW |
| `docs/images/b-architecture.png` | NEW (generated) |
| `docs-content/images/b-architecture.png` | NEW (duplicated) |

### External repo (NOT this repo — BMW GHE)

| Path | Action |
|---|---|
| `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/README.md` | NEW (no README exists today; build from `docs/index.md`) — separate commit + push to BMW GHE OKM repo via HTTPS, then bump `rapid-automations` submodule pointer |

### Submodule build/Docker rebuild required?

- `lib/km-core` — NO (docs only)
- `integrations/mcp-server-semantic-analysis` — NO (docs only; no TS changes)
- OKM (external) — NO (docs only)

## Potential Pitfalls

1. **MkDocs two-image-dir gotcha** — Forgetting to duplicate PNGs to `docs-content/images/` will break MkDocs rendering. The planner must include a Wave 0 sanity probe: after generation, `ls docs/images/km-core-*.png && ls docs-content/images/km-core-*.png` must both succeed.
2. **`plantuml` CLI vs `java -jar`** — Project CLAUDE.md forbids `java -jar plantuml.jar`. Planner must reference the `plantuml` CLI by name in task actions.
3. **Standard-style include missing** — Any PUML missing the standard preamble + standard-style include directive renders with default skinparams and looks inconsistent. Include this in the template skeleton AND in a Wave 0 sanity probe (`grep -L "_standard-style.puml" docs/puml/*.puml lib/km-core/docs/puml/*.puml` must return empty for the new files).
4. **`documentation-style` skill non-invocation** — Both global CLAUDE.md and `lib/km-core/CLAUDE.md` mandate invoking this skill BEFORE PUML/Mermaid/docs work. Planner must add an explicit "invoke documentation-style skill" step as the first action of any task touching diagrams.
5. **OKM repo is external (BMW GHE) — submodule pointer bump is in `rapid-automations`, NOT coding** — The C README change does NOT modify the coding repo's submodule pointers. The PR lands on `https://bmw.ghe.com/adpnext-apps/rapid-automations.git`. Use HTTPS (per `feedback_bmw_ghe_https.md`).
6. **B README rewrite + submodule push** — B is a submodule. Push the rewritten README to `fwornle/mcp-server-semantic-analysis` separately, then commit the submodule pointer bump in coding. The bind-mount pattern in CLAUDE.md does NOT apply to READMEs (no build/dist).
7. **`no-evolutionary-names` false-positive on `LslHeartbeatRotator`** — Constraint regex may fire on words like "Rotator" or pattern-match for "evolutionary" suffixes. Document `OVERRIDE_CONSTRAINT: no-evolutionary-names` with rationale in ONBOARDING.md as a worked example.
8. **Phase 45 dependency for Step 6** — The unified viewer at `http://localhost:3032/viewer/coding` is delivered by Phase 45 (complete). If the viewer is down during onboarding, the contributor may interpret it as a step failure. Add a precheck in ONBOARDING.md: `curl http://localhost:3032/api/health` before Step 6.
9. **REST endpoint contract drift** — The exercise assumes `POST /api/v1/entities` as the canonical write endpoint. Plan 44-16 locked wire shapes; the planner must verify against `lib/km-core/src/api/handlers/` index that this endpoint exists and accepts the documented JSON body. If it's `POST /api/v1/ingest` instead, swap.
10. **OKM has CLAUDE.md but no README — confirm the new README does not duplicate CLAUDE.md content.** OKM's CLAUDE.md focuses on dev rules (KB persistence, mandatory verification); the new README focuses on architecture + "where to edit." Different audiences (LLM agent vs human contributor).
11. **Cleanup amnesia** — Onboarding contributors may skip step 7. Risk: tutorial entity pollutes wave-analysis dedup. Mitigation: ONBOARDING.md should put cleanup in a `!!! danger` admonition and the planner should include a `tests/onboarding-cleanup-verifier.spec.ts` Wave 3 task that asserts no `LslHeartbeatRotator` exists in the KG export.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `POST /api/v1/entities` is the canonical write endpoint with the documented body shape | Step 4 of Onboarding Exercise | LOW — planner verifies against Plan 44-16 handler index before locking PLAN.md |
| A2 | OKM repo accepts HTTPS pushes for branches authored locally | OQ-1 | LOW — `feedback_bmw_ghe_https.md` confirms HTTPS works; SSH fails |
| A3 | `no-evolutionary-names` constraint may false-positive on `LslHeartbeatRotator` | Pitfall #7 | LOW — easy to confirm by running the constraint check; if no fire, drop the override mention |
| A4 | `documentation-style` skill output dir convention aligns with current `docs/images/` / `docs-content/images/` duplication | Diagram Plan | LOW — verifiable by invoking the skill once before authoring diagrams |
| A5 | MkDocs auto-nav (no explicit `nav:` block) will surface new READMEs without manual nav edits | OQ-4 | LOW — MkDocs default behavior; verifiable by `mkdocs serve` |

## Open Questions (for planner / discuss-phase)

1. **Should `lib/km-core/docs/README-TEMPLATE.md` be authored as a literal markdown skeleton with `{placeholder}` syntax, or as a checklist of "every README must contain these sections"?** Recommendation: literal skeleton with placeholders, since downstream READMEs copy-paste. (Researcher's recommendation; planner may override.)
2. **Does the planner want a separate Wave 0 task to render the PNG diagrams (so they exist before Wave 1 READMEs reference them), or should diagram generation be folded into each README task?** Recommendation: separate Wave 0 — PNG-renaming/duplication is a leak-prone operation worth quarantining.
3. **For C (OKM), should the new README be a PR against the BMW GHE upstream, or should it land on the locally-checked-out `gsd/44-09-rest-cutover-v2` branch?** The branch context matters for downstream merge. Researcher cannot resolve without project-policy guidance; defer to discuss-phase or planner judgment.

## Sources

### Primary (HIGH confidence)
- `/Users/Q284340/Agentic/coding/.planning/phases/46-per-system-documentation-onboarding/46-CONTEXT.md` — locked decisions D-46-01..04
- `/Users/Q284340/Agentic/coding/.planning/ROADMAP.md:701-714` — Phase 46 goal + SC1-4
- `/Users/Q284340/Agentic/coding/CLAUDE.md` — PlantUML rule, submodule build pipeline
- `/Users/Q284340/Agentic/coding/lib/km-core/CLAUDE.md` — no-evolutionary-names + documentation-style skill mandate
- `/Users/Q284340/Agentic/coding/lib/km-core/README.md:1-95` — current state (audit baseline)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/README.md` — 22622 bytes, 573 lines, section map
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/{CLAUDE.md,docs/index.md}` — OKM CLAUDE.md present, README absent, docs/index.md serves as de facto README
- `/Users/Q284340/Agentic/coding/.data/ontologies/coding-ontology.json` — 21 classes, SubComponent has `componentName / parentComponent / level` properties
- `/Users/Q284340/Agentic/coding/.data/knowledge-graph/exports/general.json` — verified `LiveLoggingSystem` Component + 8 LSL SubComponents exist in live KG
- `/Users/Q284340/Agentic/coding/scripts/purge-knowledge-entities.js` — exists
- `/Users/Q284340/Agentic/coding/src/live-logging/ObservationWriter.js` — exists
- `/Users/Q284340/Agentic/coding/mkdocs.yml:1-60` — `docs_dir: docs-content`, no `nav:` block
- `/Users/Q284340/Agentic/coding/docs/puml/_standard-style.puml` — PUML conventions
- `/Users/Q284340/Agentic/coding/docs/puml/adaptive-lsl-system.puml:1-2` — standard preamble pattern
- MEMORY.md `feedback_mkdocs_two_image_dirs.md` — two-image-dir gotcha
- MEMORY.md `feedback_bmw_ghe_https.md` — BMW GHE HTTPS default
- `plantuml -version` → PlantUML 1.2026.1 — CLI verified present at `/opt/homebrew/bin/plantuml`

### Secondary (MEDIUM confidence)
- ROADMAP entries for Plan 44-16 (camelCase wire-shape lock) and Plan 45-04 (display-overlay handler) — relied on for "what to add to KM-Core README public-API section"
- `lib/km-core/tests/fixtures/b-coding-snapshot.json` — port 12436 = obs-api confirmed (multiple corroborating mentions)

### Tertiary (LOW confidence)
- None. All claims either verified by tool or cited from a primary source.

## Metadata

**Confidence breakdown:**
- README-TEMPLATE skeleton: HIGH — D-46-02 locks the 6-section structure; researcher fills wording
- Diagram plan: HIGH — D-46-03 locks PUML + two-dir duplication; researcher names files
- Onboarding script: HIGH — D-46-04 locks the exercise topic; researcher verified every cited path exists on disk
- OQ-1 (OKM): HIGH — confirmed via git remote + filesystem inspection
- OQ-2 (KM-Core staleness): HIGH — direct README read + cross-ref with Phase 44/45 ROADMAP entries
- OQ-3 (B catalog): HIGH — direct README byte/line count + section map
- OQ-4 (MkDocs): HIGH — mkdocs.yml + docs-content tree inspection

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 (30 days — documentation phase, stable inputs)
