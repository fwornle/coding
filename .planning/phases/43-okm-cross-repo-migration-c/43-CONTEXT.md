# Phase 43: OKM Cross-Repo Migration (C) - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 43 completes the cross-repo migration of **C** (OKM — `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management`, hosted on `bmw.ghe.com/adpnext-apps/operational-knowledge-management.git`) onto KM-Core. INT-03 / SC#1-4 close out the v7.1 chain that 42 completed for B.

**Reality check (changes the shape):** OKM has already done a partial strangler migration on its own `main` (commit `d9fae27` "feat(okb): migrate to km-core via IGraphStore + GraphKMStoreAdapter"). `GraphKMStoreAdapter` (`src/store/km-store-adapter.ts`) bridges async km-core → sync `IGraphStore`, gated by `OKB_STORE_BACKEND=default|km-core` (default still `default`). km-core is consumed via a vendored 40KB tarball (`vendor/fwornle-km-core-0.1.0.tgz`). Phase 43's job is **finishing** the migration, not starting it.

**In scope:**
- Land the agreed packaging strategy (D-G1.*) — submodule + tarball-in-vendor pipeline; mirrors B's `lib/km-core` pattern.
- Storage cutover: flip `OKB_STORE_BACKEND` default to `km-core`, then **delete** the legacy backend entirely (D-G3.*).
- OntologyRegistry unification: delete OKM's `src/ontology/registry.ts`; consumers import from `@fwornle/km-core/ontology` (D-G2.2).
- Route `/api/cleanup/resolve-entities` to km-core's `resolveEntities` (Phase 41 D-50); delete OKM's `pipeline.resolveEntities` + `deduplicator.resolveEntities` (D-G2.3).
- Revert the `/api/km` mount that leaked into `src/api/server.ts:55` from Phase 44 (D-G2.4).
- Delete `IGraphStore` interface + `GraphKMStoreAdapter`; refactor OKM consumers (pipeline/deduplicator/extractor/intelligence/api routes) to await km-core's async API directly (D-G3.2).
- Data continuity: JSON-replay one-shot migration from `.data/exports/{general,kpifw,raas}.json` into km-core, stamping `legacyId={system:'C',id:<existing>}`; cold-start JSON fallback retained as the steady-state safety net (D-G4.1, D-G4.3).
- **km-core schema extension:** add `layer?: 'evidence' | 'pattern'` as a first-class optional field on the canonical Entity (A/B no-op; mirrors Phase 42's `embedding?` add) (D-G4.2). Pre-requisite for everything else.
- Full re-embed of the post-migration corpus with `fastembed/all-MiniLM-L6-v2` (384-dim) — matches Phase 42 D-52c; honors the milestone embedding standard (D-G7.1). Embeddings stored **inline** on the entity in km-core LevelDB (D-G7.2).
- SC#3 REST API stability verification: three gates — recorded-fixtures byte-diff + Zod contract tests + VOKB viewer smoke (D-G5.1).
- VOKB viewer: smoke + bug-fix-only edits if smoke surfaces real regression (D-G6.1).
- Final cleanup plan deletes everything legacy + the `OKB_STORE_BACKEND` flag — Phase 43 closes with a clean tree (D-G3.1, mirrors Phase 42 D-51).

**Out of scope (deferred):**
- The km-core common REST router contract — Phase 44.
- Unified web viewer / VOKB feature parity with VKB — Phase 45.
- Per-system documentation + onboarding — Phase 46.
- Qdrant deployment for OKM — deferred until cross-system vector search performance demands it (D-G7.2).
- Migration of OKM's `IngestionPipeline` / `EntityDeduplicator` / `EntityExtractor` onto Phase 40's 4-stage framework — OKM already implements `extract → dedup → store → synthesize` with PII filter / governance / sourceAuthority / learn-parser concerns that don't trivially translate; convergence deferred (D-G2.1).
- The 5 ingest adapters (Confluence / CodeBeamer / MkDocs / ServiceNow / markdown) — they stay OKM-owned (D-G2.1).
- A.parallel-path asymmetry decision from Phase 42 — still deferred to pre-Phase-44.
- The two todos that matched on noise keywords (`api`, `phase`) — both A-system (observability/data-integrity); not relevant to C.

</domain>

<decisions>
## Implementation Decisions

### G1 — Packaging Strategy (locks SC#2)

- **D-G1.1 Git submodule strategy.** Mirrors B's `lib/km-core` pattern. The submodule pins km-core at a specific SHA; tracked-version commits make the dependency relationship reviewable.
- **D-G1.2 Submodule location + tarball pipeline.** Submodule lives at `integrations/operational-knowledge-management/lib/km-core/` (inside OKM, not at the rapid-automations root — keeps the migration self-contained to OKM). The actual `package.json` dependency stays `"@fwornle/km-core": "file:vendor/fwornle-km-core-X.Y.Z.tgz"`. A prebuild/bump script runs `npm pack` inside `lib/km-core/`, drops the resulting `.tgz` into `vendor/`, and bumps the version in `package.json` atomically. **Rationale:** submodule = dev convenience (km-core edits testable in OKM immediately); vendored tarball = stable install graph (avoids TS-on-the-fly compilation issues with `file:./lib/km-core` pointing at a directory containing TS sources).
- **D-G1.3 Delete vestigial RA-root km-core dep.** Remove `"@fwornle/km-core": "file:../../coding/lib/km-core/fwornle-km-core-0.1.0.tgz"` from `rapid-automations/package.json`. Nothing in rapid-automations code outside OKM imports km-core (grep-verified). One-line PR against rapid-automations root.
- **D-G1.4 Submodule URL + bump discipline.** `.gitmodules` URL: `https://github.com/fwornle/km-core.git` (public, zero-auth CI on any platform including bmw.ghe.com). Re-pack into `vendor/` ONLY on km-core version-tag bumps (e.g., `v0.2.0`). Commit pattern: `chore(deps): bump km-core 0.1.0 → 0.2.0`. Vendor tarball name carries the version. Predictable diffs; tarball binary doesn't churn between version bumps.

### G2 — Migration Scope Past Storage

- **D-G2.1 Storage + Ontology + Maintenance migration; keep OKM Pipeline + Dedup + adapters.** Phase 43 swaps the storage layer, unifies the OntologyRegistry, and routes the post-hoc resolve maintenance op through km-core. OKM's `IngestionPipeline` (already 4-stage: extract → dedup → store → synthesize), `EntityDeduplicator` (3-phase: within-batch exact → cross-graph exact → per-class LLM semantic), `EntityExtractor` (LLM-driven with sourceAuthority weighting), and the 5 ingest adapters all stay OKM-owned — they encode OKM-specific domain logic (PII filter, governance, learn-parser, sourceAuthority) that doesn't trivially translate onto Phase 40's framework. Pipeline-framework convergence deferred (likely Phase 46 or later).
- **D-G2.2 Delete OKM's OntologyRegistry.** `src/ontology/registry.ts` and `src/ontology/loader.ts` are deleted. Consumers (`api/routes.ts` `/api/ontology/*` endpoints, `ingestion/extractor.ts`, `ingestion/deduplicator.ts`) import `OntologyRegistry` directly from `@fwornle/km-core/ontology`. Any OKM-specific accessors required (e.g., `getLoadedDomains()`, `getAllClassNames()`) must already exist in km-core's registry or be added there (pre-req plan against km-core if missing).
- **D-G2.3 Route /api/cleanup/resolve-entities to km-core's resolveEntities.** Delete OKM's `pipeline.resolveEntities` (`pipeline.ts:361`) and `deduplicator.resolveEntities` (`deduplicator.ts:620`). The API route calls km-core's `resolveEntities` directly, passing an OKM LLM client + ontology classes. Phase 41 D-50 was modeled on OKM's impl — they should be near-identical. Any OKM-specific bits (PII pre-scan, sourceAuthority hints) get applied as **preprocessing before the call**, not woven into the resolve loop.
- **D-G2.4 Revert /api/km mount.** `src/api/server.ts:55` currently mounts km-core's common REST router under `/api/km/` with a "Phase 44 Plan 03" comment. That's Phase 44 territory. Remove the mount + the `kmStore` parameter from `createServer()`. Phase 44 lands the unified router properly across A/B/C.

### G3 — Legacy Cleanup + Flag Retirement

- **D-G3.1 Mirror Phase 42 D-51 — final cleanup plan deletes everything.** Phase 43 closes with a clean tree. The final plan deletes: `src/store/graph-store.ts` (default GraphStore), `src/store/sync-manager.ts`, `src/store/persistence.ts`, `src/ontology/registry.ts` + `src/ontology/loader.ts`, the `OKB_STORE_BACKEND` flag + every conditional branch in `src/index.ts` referencing it. No dead code carried into Phase 44+.
- **D-G3.2 Delete IGraphStore + GraphKMStoreAdapter.** After legacy GraphStore is gone, `GraphKMStoreAdapter` is the only `IGraphStore` impl. Eliminate the leaky abstraction: delete `src/types/graph-store.ts` (the `IGraphStore` interface) AND `src/store/km-store-adapter.ts` (the bridge). Refactor every consumer (pipeline, deduplicator, extractor, intelligence/{clustering,confidence,connectivity,correlation,rca-lookup,search,temporal}, api/routes.ts) to await km-core's async API directly — `await kmStore.iterate()`, `await kmStore.findRelations({...})`, `await kmStore.putEntity(...)`. Bigger diff (~10 files) but no bridge code, no leaky abstraction, and OKM consumers speak km-core natively.

### G4 — OKM LevelDB Data Continuity

- **D-G4.1 JSON-replay bootstrap from .data/exports/*.json.** The legacy LevelDB at `.data/leveldb/` is **deleted**. The new km-core LevelDB starts empty. A one-shot migration script reads the git-tracked `.data/exports/{general,kpifw,raas}.json`, ingests every entity through km-core (which persists to its LevelDB + emits new exports on the standard 5s debounce). Aligns with OKM's existing "JSON exports are master for fresh environments" pattern (per OKM CLAUDE.md). Authoritative source = the git-tracked JSON, not the local LevelDB.
- **D-G4.2 km-core Entity schema extension: `layer?: 'evidence' | 'pattern'`.** Add `layer?: 'evidence' | 'pattern'` as a first-class optional field on the canonical km-core Entity. A and B no-op on this field. Mirrors how Phase 42 added optional `embedding?: number[]` for B. **This is a precondition** for D-G4.1's JSON-replay (consumers depending on `layer` — `intelligence/clustering.ts`, `/api/entities?layer=evidence` filter — keep working without metadata gymnastics). Small km-core PR; lives in the canonical Entity type module (`~/Agentic/km-core/src/types/entity.ts`).
- **D-G4.3 Belt-and-suspenders: one-shot migration script + cold-start JSON-fallback retained.** D-G4.1's migration script runs once at cutover (a dedicated plan, e.g., `npm run migrate:okm-to-km-core`). km-core's Phase 37 D-22 LevelDB-empty → JSON-fallback semantics ALSO stay in place as the perpetual safety net for fresh environments and colleague checkouts. Both paths converge on the same outcome — defense in depth.

### G5 — REST API Stability Verification (SC#3)

- **D-G5.1 Three-gate verification: recorded-fixtures byte diff + Zod contract tests + VOKB viewer smoke.** All three required to pass before phase close.
  - **Fixtures-diff (strictest):** Pre-cutover, hit `/api/entities`, `/api/relations`, `/api/search?q=test`, `/api/clusters`, `/api/rca-lookup`, `/api/stats`, `/api/export`, `/api/ontology/*` with a fixed seed dataset. Snapshot the JSON responses to `tests/fixtures/pre-migration/*.json`. Post-cutover, same requests, byte-diff against fixtures. ZERO diff = pass. Catches ordering, casing, formatting drift.
  - **Contract tests:** `tests/integration/rest-contract.test.ts` asserts each endpoint returns objects matching a frozen Zod schema (field names, types, required-ness, enum values). Locks shape independently of fixture data.
  - **VOKB viewer smoke:** Visual smoke test — load VOKB, render the graph, click an entity, run RCA lookup. Catches real consumer breakage the byte-diff might miss.

### G6 — VOKB Viewer Scope

- **D-G6.1 Smoke + bug-fix-only edits.** Phase 43 makes **zero feature changes** to `integrations/operational-knowledge-management/viewer/`. The G5 VOKB smoke is the gate. **If** the smoke reveals real bugs (e.g., a hardcoded `layer === 'evidence'` filter that no longer matches the new field placement post-migration), in-place fix is allowed — don't let a small fixup block phase close. No refactor. No feature work. Phase 45 owns unified viewer work.

### G7 — Embedding Standardisation

- **D-G7.1 Full re-embed during Phase 43 migration.** Honors Phase 42 D-52c's commitment that "C's migration (Phase 43) re-embeds its corpus once to match" the fastembed/all-MiniLM-L6-v2/384-dim standard. After D-G4.1's JSON-replay completes, a one-shot re-embed pass walks every km-core entity, computes the embedding via fastembed (same engine B uses — likely `src/utils/embedding_generator.py` mounted via the coding-services Docker container, OR a TS port; planner picks based on what's least painful cross-repo). Embeddings persisted via D-G7.2.
- **D-G7.2 Hybrid embedding store — inline now, Qdrant when needed.** Every entity gets `embedding: number[]` stored inline in km-core LevelDB (and in the git-tracked exports). NO Qdrant deployment for OKM in Phase 43. Cross-system vector search in Phase 44+45 reads embeddings via `km-core.findByOntologyClass(...)` + in-memory cosine, which works for OKM's current scale (well below 50K entities). When sub-ms latency at higher scale is needed, Phase 42's `syncQdrantFromStore` op plugs in a Qdrant index without re-embedding. Defers ops cost.

### Carrying Forward from Phase 37 + 38 + 39 + 40 + 41 + 42 (locked, not re-debated)

- **From 37:** Canonical `Entity` / `Relation` / `UUIDv7` types; `GraphKMStore` adapter (Graphology + LevelDB + git-tracked JSON export with 5s debounce per-domain bucketing); CORE-01/02/03 satisfied. **D-22 LevelDB-empty → JSON-fallback semantics** are explicitly leveraged here (D-G4.3).
- **From 38:** `OntologyRegistry` auto-discovers upper + N lower ontologies with `extends` chain resolution; ONTO-01/02 satisfied. **Replaces OKM's OntologyRegistry** (D-G2.2).
- **From 39:** `Entity` shape locks: top-level `legacyId`, `ontologyClass`, `descriptionSegments`, segment provenance, `validFrom` / `validUntil` / `supersedes` / `createdBy` / `lastConfirmedBy` / `confirmationCount`. **Phase 43 extends Entity with `layer?: 'evidence'|'pattern'`** (D-G4.2) — Phase 39-style add, A/B no-op.
- **From 40:** 4-stage `extract → dedup → store → synthesize` pipeline; layered dedup (`ExactNameLayer` + `EmbeddingLayer` + `LLMSemanticLayer`); `EmbeddingClient` interface. **Used at the Phase 41 maintenance ops level (resolveEntities); NOT at OKM's inline ingest path** — OKM keeps its own pipeline + dedup (D-G2.1).
- **From 41:** `/maintenance` sub-path (`resolveEntities`, `mergeEntities` atomic primitive), `defaultOntologyDir()` helper, `km-core-graphkmstore-needs-ontology-dir` constraint warn. **`resolveEntities` IS the maintenance entry point in Phase 43** (D-G2.3).
- **From 42:** **D-51 strangler pattern with final-cleanup plan that deletes legacy + feature flag is the template** Phase 43 mirrors (D-G3.1). **D-52c embedding model pinned (fastembed/all-MiniLM-L6-v2/384-dim)** — Phase 43 honors the commitment to re-embed C's corpus (D-G7.1). D-54 in-place LevelDB rewrite was the alternative Phase 42 chose; Phase 43 picks JSON-replay instead (D-G4.1) because OKM's git-tracked exports are already the canonical source per OKM CLAUDE.md.

### Folded Todos
None matched Phase 43 substantively. The two keyword matches (`2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` score 0.6, `2026-05-23-orphan-digest-observation-refs.md` score 0.4) are A-system observability/data-integrity — irrelevant to C.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` lines 244, 561–574 — Phase 43 entry, SC#1–4 anchors. Phase 43 depends on Phase 40 (per ROADMAP); v7.1 close-out chain is 43 → 44 → 45 → 46.
- `.planning/REQUIREMENTS.md` line 49 — INT-03 ("C migrated to KM-Core via cross-repo refactor; rapid-automations CI remains green"). Line 68 — "OKM consumes KM-Core via the agreed packaging strategy (decided in INT-03's discuss phase)" — closed here.
- `.planning/STATE.md` — current-position: "Phase 43 directory does not exist on disk (OpenCode's prior PLAN/DISCUSS docs were reverted in commit 8457dd56c on 2026-05-29)"; OKM packaging strategy was the open blocker — resolved here.

### Prior Phase Contexts (carry-forward)
- `.planning/phases/42-offline-ukb-migration-b/42-CONTEXT.md` — D-51 strangler + final-cleanup template (Phase 43 mirrors), D-52c embedding model + cross-system commitment, D-54 in-place LevelDB rewrite alternative.
- `.planning/phases/41-online-learning-adapter-post-hoc-resolution/41-CONTEXT.md` — D-50 `resolveEntities` (modeled on OKM's impl) + D-50a `mergeEntities` atomic primitive — Phase 43 closes the loop by routing OKM's `/api/cleanup/resolve-entities` through km-core's surface.
- `.planning/phases/40-ingest-pipeline-layered-dedup/` Plans 01–12 — 4-stage pipeline + layered dedup interfaces. Phase 43 uses these AT the maintenance-ops level, NOT at OKM's inline ingest path.
- `.planning/phases/39-entity-data-model/39-CONTEXT.md` — Entity shape lock (CF-D37 top-level `legacyId`, D-39 `descriptionSegments`). Phase 43 extends this with `layer?`.
- `.planning/phases/38-ontology-registry/38-CONTEXT.md` — `OntologyRegistry` contract (auto-discover + `extends` chain). Phase 43 deletes OKM's parallel impl in favor of this.
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` — D-17 atomic batch contract; D-22 LevelDB-empty → JSON-fallback semantics (leveraged in D-G4.3).

### Research seed
- `.planning/research/v7.1-km-unification.md` — stage-by-stage A/B/C comparison; identifies C (OKM) as the canonical source of the ontology + pipeline shape the other systems migrate TOWARD.

### km-core source (the target dependency)
- `~/Agentic/km-core/src/types/entity.ts` — canonical Entity type. **Phase 43 adds `layer?` here** (D-G4.2).
- `~/Agentic/km-core/src/store/GraphKMStore.ts` — adapter target consumed by OKM after cutover.
- `~/Agentic/km-core/src/maintenance/{resolveEntities,mergeEntities}.ts` — Phase 41 maintenance surfaces OKM routes through (D-G2.3).
- `~/Agentic/km-core/src/ontology/{registry,defaultDir}.ts` — registry contract OKM consumers import from after the OKM-side registry is deleted (D-G2.2).
- `~/Agentic/km-core/package.json` — version-tag discipline for D-G1.4 bumps.

### OKM source (migration target — modifications happen here)
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/index.ts` — entry point; `OKB_STORE_BACKEND` flag at line 32, conditional branches lines 37–66, `kmStoreAdapter` lines 35, 63–65, 132–133. All deleted in the final cleanup plan (D-G3.1).
- `…/src/store/km-store-adapter.ts` — DELETED in the final cleanup plan (D-G3.2).
- `…/src/store/graph-store.ts` — DELETED.
- `…/src/store/sync-manager.ts` — DELETED.
- `…/src/store/persistence.ts` — DELETED.
- `…/src/store/source-document-store.ts` — survives (OKM-specific evidence traceability; not a km-core concern).
- `…/src/ontology/registry.ts` — DELETED (D-G2.2).
- `…/src/ontology/loader.ts` — DELETED.
- `…/src/types/graph-store.ts` — DELETED (`IGraphStore` interface gone; D-G3.2).
- `…/src/types/entity.ts` — entity type stays OKM-side initially; eventually OKM-specific extras (e.g., `ResolutionRecord[]` in metadata, OKM-shape `EntityProvenance`) collapse onto km-core's canonical shape via metadata enrichment. Planner picks granularity.
- `…/src/ingestion/pipeline.ts` line 361 (`pipeline.resolveEntities`) — DELETED (D-G2.3).
- `…/src/ingestion/deduplicator.ts` line 620 (`deduplicator.resolveEntities`) — DELETED.
- `…/src/ingestion/{extractor.ts,deduplicator.ts,pipeline.ts,governance.ts,pii-filter.ts,learn-parser.ts,schemas.ts}` — SURVIVE; refactored to await km-core async API (D-G3.2).
- `…/src/ingestion/adapters/{codebeamer-adapter,confluence-adapter,markdown-cleaner,mkdocs-adapter,servicenow-adapter,types}.ts` — SURVIVE unchanged (OKM-specific Stage-1 inputs).
- `…/src/intelligence/{clustering,confidence,connectivity,correlation,rca-lookup,search,temporal}.ts` — SURVIVE; refactored to await km-core (D-G3.2).
- `…/src/api/server.ts` — `/api/km` mount at line 55 REVERTED (D-G2.4); `kmStore` parameter removed from `createServer()`. After cleanup, `createServer` signature simplifies.
- `…/src/api/routes.ts` — refactored to await km-core (D-G3.2); all endpoint shapes locked by D-G5.1 fixtures.
- `…/src/api/health.ts` — survives.
- `…/package.json` — D-G1.2 vendor tarball reference; D-G1.3 (root counterpart) deleted.
- `…/vendor/fwornle-km-core-X.Y.Z.tgz` — produced by the D-G1.2 prebuild step; version-bumped per D-G1.4.
- `…/CLAUDE.md` — "Git-synced JSON exports are master for fresh environments" pattern that D-G4.1's JSON-replay aligns with.

### OKM tests (the verification gate for SC#1)
- `…/tests/integration/km-core-backend.test.ts` — already exists; renames to `…/tests/integration/storage-backend.test.ts` (or similar) post-cutover since "km-core" is no longer a non-default backend.
- `…/tests/integration/{api-entities,api-export,api-health,api-ingest,api-intelligence,api-query,api-relations,sync,ingestion-failover,ingestion-pipeline,cli-smoke,data-directory}.test.ts` — must all pass post-migration.
- `…/tests/unit/km-store-adapter.test.ts` — DELETED with the adapter.
- `…/tests/unit/{graph-store,sync-manager,persistence,ontology-loader}.test.ts` — DELETED with the modules.
- **NEW**: `…/tests/integration/rest-contract.test.ts` — Zod schema lock per D-G5.1.
- **NEW**: `…/tests/fixtures/pre-migration/*.json` — recorded responses per D-G5.1.

### Data state (input to D-G4.1 JSON-replay)
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/general.json`
- `…/integrations/operational-knowledge-management/.data/exports/kpifw.json`
- `…/integrations/operational-knowledge-management/.data/exports/raas.json`
- `…/integrations/operational-knowledge-management/.data/leveldb/` — legacy LevelDB (17MB); DELETED at cutover.

### rapid-automations root
- `~/Agentic/_work/rapid-automations/.github/workflows/ci.yml` — root CI; excludes `integrations/*` from lint+conflict-marker checks. SC#1 ("rapid-automations CI green") is the trivial gate at root; the real bar is OKM's own vitest suite.
- `~/Agentic/_work/rapid-automations/package.json` — `@fwornle/km-core` line DELETED in D-G1.3.
- `~/Agentic/_work/rapid-automations/.gitmodules` — adds the `lib/km-core` submodule inside the OKM path per D-G1.2 (note: `.gitmodules` for the OKM submodule lives inside OKM itself, not the rapid-automations root).

### User constraints from memory
- `memory/feedback_bmw_ghe_https.md` — bmw.ghe.com requires HTTPS-token auth; SSH fails. Affects D-G1.4 URL scheme decision (chose HTTPS for the submodule; OKM itself is bmw.ghe.com HTTPS).
- `memory/feedback_worktree_verification.md` — verify "complete" claims against main, not worktree branches. Critical given OKM already has `d9fae27` "Phase 43" commit on `main` from a prior attempt — DO NOT trust that commit's claim; verify each SC explicitly.

### Project root
- `CLAUDE.md` (coding repo) — Submodules & Build Pipeline section. OKM is in a SEPARATE repo from coding; the Docker rebuild rules do NOT apply directly. OKM has its own build/test cycle (`npm run build` + `npm test` in the OKM dir).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`@fwornle/km-core` package (already published as `lib/km-core` submodule of coding/)** — entire surface: types, GraphKMStore, OntologyRegistry, maintenance ops, dedup framework. Phase 43 consumes everything OKM-side.
- **OKM's `GraphKMStoreAdapter` (`src/store/km-store-adapter.ts`)** — the strangler bridge, currently the ONLY non-legacy storage path. Phase 43 DELETES this after refactoring consumers to call km-core async APIs directly — but until then, it's the working migration anchor.
- **OKM's `IngestionPipeline` 4-stage shape (`src/ingestion/pipeline.ts:1-7`)** — already implements extract → dedup → store → synthesize per the docstring. Phase 43 leaves this in place; it's not on Phase 40's framework but it IS the framework spiritually.
- **OKM's git-tracked JSON exports (`.data/exports/*.json`)** — authoritative source per OKM CLAUDE.md; canonical input to D-G4.1 JSON-replay.
- **B's `lib/km-core` submodule pattern (`coding/.gitmodules` for the coding repo)** — the template for D-G1.1, D-G1.2.

### Established Patterns
- **Strangler with feature flag → final-cleanup-plan deletes everything (Phase 42 D-51).** OKM's `OKB_STORE_BACKEND` strangler is already half-implemented; Phase 43 finishes it and removes the flag. This is the exact pattern.
- **Optional first-class Entity field extensions (Phase 42's `embedding?`).** D-G4.2 adds `layer?` the same way — A/B no-op semantics. Pre-req plan against km-core.
- **JSON-exports-as-master with LevelDB as runtime cache (OKM CLAUDE.md "KB Persistence Rules").** D-G4.1 leverages this. Combined with km-core's Phase 37 D-22 LevelDB-empty → JSON-fallback, the migration becomes "delete LevelDB, restart server" once the JSON-replay script lands.
- **Cross-repo dev workflow (coding's `lib/km-core` submodule).** D-G1.2 mirrors this for OKM; D-G1.4's HTTPS URL avoids the bmw.ghe.com SSH-vs-HTTPS gotcha entirely.
- **Atomic version-tagged dep bumps (Phase 41 `chore(deps): bump @fwornle/km-core` style).** D-G1.4 commit pattern.

### Integration Points
- **OKM ⇄ km-core boundary**: After Phase 43, every storage/ontology/maintenance call from OKM goes through `@fwornle/km-core` imports. The boundary becomes the entry to km-core's public exports.
- **OKM ⇄ rapid-automations root**: minimal — D-G1.3 deletes the only coupling.
- **OKM ⇄ bmw.ghe.com CI**: OKM's own vitest suite runs there (presumably). SC#1 verified by green build on the migration branch + on main after merge.
- **OKM ⇄ VOKB viewer**: REST contract only. D-G5.1 fixtures-diff + Zod contract lock the boundary. VOKB smoke is the integration canary.

### Known Gotchas (encoded in memory or recent history)
- **Commit `d9fae27` ("feat(okb): migrate to km-core via IGraphStore + GraphKMStoreAdapter (Phase 43)") on OKM main is HALF-DONE.** It introduced the strangler but defaults to legacy. DO NOT trust its "Phase 43" labeling — Phase 43 is what we plan now, building on what `d9fae27` started.
- **Commit `8457dd56c` ("chore: remove hallucinated Phase 43/44 planning docs") on OKM main reverted prior AI-generated plans.** Confirms: Phase 43 starts from a clean planning slate.
- **`.gitmodules` for the OKM-internal submodule lives INSIDE the OKM repo (bmw.ghe.com), not the rapid-automations root.** D-G1.2 modifies OKM's `.gitmodules`. The rapid-automations root `.gitmodules` (already has `operational-knowledge-management` as a submodule of itself) is untouched.
- **km-core repo at github.com/fwornle/km-core is PUBLIC (`"private": false`).** That's what makes D-G1.4's HTTPS URL work without auth from any CI environment, including bmw.ghe.com.

</code_context>

<specifics>
## Specific Ideas

- D-G1 packaging: explicitly preferred submodule mirror of B's `lib/km-core` over alternative packaging schemes; chose tarball-from-submodule layer to avoid TS-on-the-fly compilation pitfalls.
- D-G3.2: explicitly chose the AGGRESSIVE option — delete `IGraphStore` interface AND the adapter, not just the legacy backend. OKM consumers go fully async-native against km-core. Bigger diff, no leaky abstraction.
- D-G4.1: explicitly chose JSON-replay over in-place LevelDB rewrite — leans on OKM's existing "JSON exports are master" pattern (per OKM CLAUDE.md) rather than building a custom Phase 42 D-54-style key-shape rewriter.
- D-G5.1: explicitly chose ALL THREE verification gates (fixtures byte-diff + Zod contract tests + VOKB smoke) — SC#3 is the explicit roadmap commitment and warrants the highest verification rigor.
- D-G7.1: explicitly chose full re-embed during Phase 43 — honors Phase 42 D-52c's cross-system commitment rather than deferring.

</specifics>

<deferred>
## Deferred Ideas

- **Migration of OKM's `IngestionPipeline` / `EntityDeduplicator` / `EntityExtractor` onto Phase 40's 4-stage framework.** OKM already implements the 4-stage shape but with OKM-specific PII/governance/sourceAuthority/learn-parser concerns. Convergence (or absorbing the OKM-specific concerns into km-core as configurable hooks) is its own initiative. Likely post-v7.1 or as part of Phase 46's documentation-driven convergence.
- **Qdrant deployment for OKM.** Inline embedding storage in km-core LevelDB (D-G7.2) suffices for OKM's current scale. `syncQdrantFromStore` (Phase 42 D-52a) plugs in later without re-embedding when sub-ms vector search is required.
- **`/api/km` common REST router exposure.** Reverted in Phase 43 (D-G2.4); Phase 44 owns the unified REST contract across A/B/C.
- **VOKB feature work / unified viewer.** Phase 45 owns it. Phase 43 strictly bug-fix-only on VOKB.
- **rapid-automations CI integration tests for OKM at the RA-root level.** Today RA root's CI excludes `integrations/*`. Considered adding a workflow that triggers OKM's vitest from RA root — defer; it's a CI infrastructure concern orthogonal to the migration.
- **A's parallel-path asymmetry (still deferred from Phase 42).** After Phase 43 closes, B and C are both 100% on km-core while A still runs co-exist. The decision (accept co-exist / read-side cutover / full writer+reader cutover) was deferred to pre-Phase-44 per Phase 42's deferred section. Phase 43 does not re-open it.
- **OKM-specific `EntityProvenance` / `ResolutionRecord[]` shapes vs km-core canonical Entity.** Phase 43 keeps OKM's extras on `metadata` rather than absorbing into km-core's shape. Future refinement: pick which OKM-specific concepts (e.g., `confirmationCount`, `lastConfirmedBy`) should become first-class on km-core's Entity (some may already exist from Phase 39 D-37).
- **Pipeline framework convergence + OKM-specific concerns (PII, governance, sourceAuthority) as configurable hooks in km-core.** Not Phase 43.

### Reviewed Todos (not folded)
- `.planning/todos/pending/2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` (score 0.6) — keyword match on "api"; A-system observability concern, unrelated to C migration. Stays in pending.
- `.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md` (score 0.4) — keyword match on "phase"; A-system data-integrity (8 digests reference missing observations). Already deferred from Phase 42; remains post-v7.1 backlog.

</deferred>

---

*Phase: 43-okm-cross-repo-migration-c*
*Context gathered: 2026-05-31*
