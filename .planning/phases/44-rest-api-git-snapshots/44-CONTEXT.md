# Phase 44: REST API & Git Snapshots - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 44 lands the **common REST contract** (entity CRUD, search, clusters, snapshots, ontology metadata) and the **git-snapshot/restore** pattern over `.data/exports/` so all three systems (A=coding/online-learning, B=mcp-server-semantic-analysis, C=OKM) expose the **same query surface**. Necessary precondition for Phase 45 (Unified Web Viewer).

**Reality check (shapes the work):** The three systems are highly asymmetric today.
- **A** (host-side `scripts/observations-api-server.mjs` on :12436) has rich **domain-specific** endpoints (`/api/observations`, `/api/digests`, `/api/insights`, `/api/projects`, `/api/retrieve`, `/api/consolidation/*`) backed by **SQLite** at `.data/knowledge.db`. NO `/api/entities` endpoint today. A's dual-write to km-core LevelDB (deferred-asymmetry from Phase 42 + Phase 43) is resolved here.
- **B** (`integrations/mcp-server-semantic-analysis/src/sse-server.ts` on :3848) has **no REST CRUD** at all — pure SSE/workflow server (`/health`, `/sse`, `/workflow-events`, `/messages` for stdio bridge). REST surface is new from scratch.
- **C** (OKM, `_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts`, :3002) has a **full ~30-endpoint REST surface** already canonical-shaped after Phase 43. Acts as the de-facto template; Phase 43's fixtures-diff (`tests/fixtures/pre-migration/*.json`) locks the wire format.

**In scope:**
- Land `createKmCoreRouter(store, opts)` factory in km-core/src/api/ with Express as peer-dep (R-1, R-2).
- Mount canonical surface at `/api/v1/` on all three systems (R-3); HARD CUTOVER rewriting OKM consumers (VOKB URLs, Phase 43 fixtures, internal scripts) in-phase — no deprecation period (R-4).
- Define the canonical contract as **OKM CRUD/query/ontology core (~15 endpoints)** codified as Zod schemas in `km-core/src/api/contracts.ts`, response shapes verbatim from OKM (C-1, C-2). Add `/clusters` + `/snapshots/*` on top (C-3).
- Per-system sub-routers (`/api/okm/*`, `/api/coding/*`, `/api/sem/*`) mount alongside `/api/v1/*` for non-canonical operations (C-4).
- **A's full cutover** to km-core entities: `/api/coding/{observations,digests,insights}` become **typed views** that read km-core entities (ontologyClass='Observation|Digest|Insight') and re-shape via `km-core/src/adapters/observation-view.ts` — zero consumer breakage (A-1, A-4).
- **One-shot SQLite→km-core migration script** mirroring Phase 43 D-G4.1; idempotent via `legacyId={system:'A', id:<sqlite-rowid>}` (A-2).
- **Drop `observations`, `digests`, `insights` tables** from `.data/knowledge.db`; keep `budget_events`, `session_metrics`, `embedding_cache` (A-3).
- **Whole-directory snapshots** committed atomically + tagged `snapshot/<label>-<timestamp>`; restore = hard reset (wipe LevelDB + checkout snapshot tag + restart, leveraging Phase 37 D-22 JSON-fallback) (S-1, S-2).
- **OKB-baseline guard whitelist** extended: hook recognizes `chore(snapshot)` + `chore(restore)` prefixes as exempt from the two-commit pairing rule (S-3).
- **Snapshot discovery via git tags** — `GET /api/v1/snapshots` reads `git tag -l 'snapshot/*'`, no parallel metadata index (S-4).
- B gains a REST surface — likely adds an Express server on a new port OR extends the existing SSE server (planner picks based on existing service boundary).

**Out of scope (deferred):**
- The Unified Web Viewer parameterized by ontology config — Phase 45.
- Per-system documentation & onboarding — Phase 46.
- Cluster-detection algorithm changes (use OKM's existing Louvain code path verbatim).
- B's full workflow-execution REST surface — only the canonical CRUD/query/ontology/snapshot endpoints are added; the SSE workflow runner stays separate.
- Auth/AuthN — current internal-only stance preserved; no OAuth/OIDC introduction.
- Migrating A's `budget_events`/`session_metrics`/`embedding_cache` off SQLite (different concern; non-knowledge data).
- Snapshot retention/garbage-collection policy — operator-owned, not enforced in code.
- Soft-deprecation of `/api/entities` (pre-v1 URLs) — explicitly REJECTED via R-4 hard-cutover decision.
- A.parallel-path co-existence — resolved here (A-1) and removed as a perpetual deferred item.

</domain>

<decisions>
## Implementation Decisions

### R — Router Topology

- **R-1 km-core ships `createKmCoreRouter(store, opts)`.** Single source of truth: `km-core/src/api/router.ts` exports a factory; A/B/C each call `app.use('/api/v1', createKmCoreRouter(kmStore, { ontologyRegistry, snapshotDir }))`. Identical behavior by construction — Phase 43 fixtures-diff approach extends naturally.
- **R-2 km-core stays framework-agnostic; consumer passes its own Router.** _Revised 2026-06-03 from research finding._ Original wording said "Express as peerDependency"; mechanically that doesn't work because A/B run Express 4.21 and C runs Express 5.2 (VERIFIED via package.json grep) — a peerDep range broad enough to span both (`^4 || ^5`) is the same as having none. **Final shape:** km-core's `createKmCoreRouter(store, router, opts)` accepts a `RouterLike` object the consumer constructs (`const r = express.Router(); createKmCoreRouter(store, r, opts); app.use('/api/v1', r)`). km-core source does NOT `import express`. Preserves R-2's intent (zero migration tax, no framework lock-in) without forcing a version pin. Matches the existing `lib/km-core/dist/api/router.js` orphan draft's pattern.
- **R-3 Mount path `/api/v1/`.** Versioned from the start. Future schema-breaking changes ship as `/api/v2/`. Note: this is a notable deviation from the recommended `/api/` direct mount — the user explicitly traded zero-migration-tax for future-proofing.
- **R-4 Hard cutover, no deprecation period.** Phase 44 includes sub-plans that rewrite VOKB viewer URL constants, regenerate Phase 43 fixtures under `/api/v1/`, and update internal OKM scripts (`scripts/verify-post-migration.mjs`, etc.) to the new paths. Mirrors Phase 42 D-51 / Phase 43 D-G3.1 strangler-then-delete philosophy: clean end-state over gradual migration.

### C — Canonical Shape

- **C-1 Canonical surface = OKM CRUD/query/ontology core (~15 endpoints).** `/entities` CRUD, `/relations` CRUD, `/query`, `/export`, `/stats`, `/ontology/{classes,entity-types,schema/:className}`, `/graph/{connectivity,orphans}`, `/cleanup/{resolve-entities,deduplicate-edges,orphans,relations-by-type}`. OKM-specific operations (`/cleanup/pii-scan`, `/cleanup/pii-entities`, `/ingest`, `/ingest/batch`, governance) stay OKM-mounted at `/api/okm/*` — NOT part of the canonical contract.
- **C-2 OKM response shapes verbatim, codified as Zod in `km-core/src/api/contracts.ts`.** Take what `/api/entities`, `/api/relations`, etc. return today from OKM, encode as `EntityResponseSchema`/`RelationResponseSchema`/etc. and freeze. A/B implement to match. Phase 43's fixtures-diff already validated this shape works for VOKB.
- **C-3 Add `/clusters` + `/snapshots/*` on top of OKM's surface.** `GET /api/v1/clusters?algorithm=louvain&seed=N&minSize=M` reuses OKM's existing in-memory Louvain code path (`src/intelligence/clustering.ts`) — same code path the unified viewer in Phase 45 will need. Snapshot endpoints: `POST /api/v1/snapshots` + `GET /api/v1/snapshots` + `POST /api/v1/snapshots/:id/restore` — semantics in S-1..S-4.
- **C-4 Per-system sub-routers at `/api/<system>/`.** Clean separation: `/api/v1/*` is the cross-system contract; `/api/okm/*`, `/api/coding/*`, `/api/sem/*` are system-owned. Same Express app, two mounts per system. OKM-specific ops keep their existing semantics under `/api/okm/`; A's typed-view legacy endpoints land under `/api/coding/observations|digests|insights` (A-4).

### A — Parallel-Path Resolution (asymmetry deferred from Phase 42 + 43)

- **A-1 Full cutover.** Observation/Digest/Insight rows become **km-core entities** with `ontologyClass='Observation|Digest|Insight'`. SQLite tables for these record kinds are dropped (A-3). A becomes the third fully-aligned system on km-core; the parallel-path asymmetry that has been deferred since Phase 42 is **closed by Phase 44**.
- **A-2 One-shot migration script** at `scripts/migrate-sqlite-to-kmcore.mjs` (sibling to Phase 43's `scripts/migrate-leveldb-to-kmcore.mjs`). Reads ~800 observations + ~250 digests + ~77 insights from `.data/knowledge.db`, mints km-core entities with `legacyId={system:'A', id:<sqlite-rowid>}`, ontologyClass set per record kind, preserves all fields under `metadata.{agent,project,content,artifacts,...}`. Idempotent via legacyId match. Mirrors Phase 43 D-G4.1 JSON-replay pattern.
- **A-3 SQLite scoping.** Drop tables `observations`, `digests`, `insights` from `.data/knowledge.db`. Tables `budget_events`, `session_metrics`, `embedding_cache` STAY — they are operational/analytics, not knowledge data. Single DB file, narrower scope. Future phase may relocate them to `.data/analytics.db`; out of scope here.
- **A-4 Legacy endpoints become typed views.** `GET /api/coding/observations` internally calls `kmStore.iterate({ ontologyClass: 'Observation' })`, then transforms each entity back into the legacy observation shape (id, agent, project, content, artifacts, timestamp) via `km-core/src/adapters/observation-view.ts`. Same pattern for digests + insights. **Zero consumer breakage** — dashboard at :3032 keeps working, sub-agent capture keeps working, no client updates needed for the legacy paths.

### S — Snapshot/Restore Semantics

- **S-1 Whole-directory atomic snapshot.** `POST /api/v1/snapshots {label}` git-commits the entire `.data/exports/` dir + tags it `snapshot/<label>-<UTC-timestamp>`. Atomic across all domains — no half-restored states possible. Operationally simple. Mirrors how Phase 37 D-21 currently treats exports as one logical unit.
- **S-2 Hard reset on restore; restart is operator-triggered via `restartRequired` signal.** `POST /api/v1/snapshots/:id/restore` performs: `git checkout tag/<snapshot> -- .data/exports/` + `rm -rf .data/leveldb/` (or per-system equivalent), then **returns 200 with `{ restored: true, restartRequired: true, restartCommand: "<per-system cmd>" }`**. The running server is NOT restarted by the handler — it returns the signal so the operator (or a watchdog) issues `launchctl kickstart -k gui/$(id -u) com.coding.obs-api` (A), `docker-compose restart coding-services` (B), or the equivalent for C. On the fresh process boot, Phase 37 D-22 LevelDB-empty → JSON-fallback rebuilds the graph from the restored JSONs. **Why not in-process restart:** Phase 37 D-22 only fires on cold boot — a live process with the old graph in memory + open LevelDB would silently overwrite the restored state on the next mutation. **Why not `process.exit(0)`:** would sever in-flight SSE streams on B and any concurrent requests. **Destructive by design** — any uncommitted live data since the snapshot is lost. Caller is responsible for taking a safety snapshot first if needed.
- **S-3 OKB-baseline guard bypass via `OKB_SNAPSHOT=1` env-var.** _Revised 2026-06-03 from research finding._ Original wording said "hook whitelists `chore(snapshot|restore)` prefixes"; mechanically impossible because `pre-commit` hooks fire before the commit message is finalized — only the staged-file list is available, not the message (VERIFIED via standard git hook semantics). **Final shape:** SnapshotManager wraps every `git commit` it issues with `OKB_SNAPSHOT=1 git commit -m "chore(snapshot): …"`. The hook adds a 4-line bypass at the top: `if [ "${OKB_SNAPSHOT:-0}" = "1" ]; then exit 0; fi`. OKM's hook (`_work/.../okm/scripts/pre-commit-hook.sh`) already implements this pattern; coding-side hook needs the diff applied. Single concrete edit per repo. Intent preserved (snapshot/restore commits exempt from two-commit pairing); mechanism corrected.
- **S-4 Git tags as snapshot IDs.** `GET /api/v1/snapshots` runs `git tag -l 'snapshot/*' --sort=-creatordate` and returns `[{ id: 'snapshot/<label>-<ts>', label, timestamp, commit_sha, domains_present: [...] }]`. Restore takes the tag name. Single source of truth (git); no parallel metadata DB/index to maintain or recover.

### Carrying Forward from Prior Phases (locked, not re-debated)

- **From 37:** Canonical `Entity` / `Relation` / `UUIDv7` types; `GraphKMStore` adapter; **D-21 two-commit pattern + OKB-baseline guard** (extended via S-3); **D-22 LevelDB-empty → JSON-fallback** (the restore mechanism's safety net).
- **From 38:** `OntologyRegistry` powers `/ontology/*` endpoints; auto-discovery + extends chain.
- **From 39:** Entity shape lock — `validFrom`/`validUntil`/`supersedes`/`createdBy`/`lastConfirmedBy`/`confirmationCount` + per-segment provenance + top-level `legacyId` — all exposed in C-2 EntityResponseSchema.
- **From 41:** A's online-learning adapter already produces km-core entities; `resolveEntities` maintenance op (Phase 43 routed OKM through it; same op called from A's pipeline). A-1 closes the dual-write A's been running since Phase 41.
- **From 42:** D-51 strangler-then-delete template (Phase 43 mirrored; A-1 + A-3 mirror again). D-52a `syncQdrantFromStore` available if vector-search performance demands it (still deferred).
- **From 43:** D-G2.4 reverted the `/api/km` mount specifically for Phase 44 to land it properly across A/B/C — landed here as `/api/v1/` (R-3). D-G5.1 three-gate verification template (fixtures-diff + Zod contracts + viewer smoke) — Phase 44 regenerates fixtures under `/api/v1/` and Zod is now the contract, not a check. **D-G5.1 fixtures must be REGENERATED** under `/api/v1/` paths as part of the hard-cutover sub-plan (R-4).

### Folded Todos

None matched Phase 44 substantively. The three keyword matches in cross-reference (`2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` score 0.6 — A obs-api shutdown crash on libc++ mutex; `2026-05-23-orphan-digest-observation-refs.md` score 0.6 — 8 digests reference missing observations; `2026-03-10-replace-console-log-with-proper-logging.md` score 0.2 — tooling) are tangential. The orphan-digest-refs one would be naturally addressed by A-2 migration (entities referenced by non-existent legacyIds get skipped), but it's not the phase goal and remains in pending.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` lines 245, 611–624 — Phase 44 entry + 4 SCs anchored to API-01 + API-02.
- `.planning/REQUIREMENTS.md` lines 38–39 — API-01 (common REST contract) + API-02 (git snapshot + restore identical across systems).
- `.planning/STATE.md` lines 37, 58–59 — Phase 44 is the NEXT v7.1 milestone phase; precondition for Phase 45.

### Prior Phase Contexts (carry-forward — read in order)
- `.planning/phases/43-okm-cross-repo-migration-c/43-CONTEXT.md` — D-G2.4 reverted `/api/km` mount specifically for Phase 44; D-G5.1 fixtures-diff verification template; A.parallel-path asymmetry explicitly deferred to "pre-Phase-44" — closed here.
- `.planning/phases/42-offline-ukb-migration-b/42-CONTEXT.md` — D-51 strangler-then-delete template; D-52a `syncQdrantFromStore` maintenance op.
- `.planning/phases/41-online-learning-adapter-post-hoc-resolution/41-CONTEXT.md` — A's km-core dual-write origin; D-50 `resolveEntities` shared maintenance op.
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` — D-21 two-commit + OKB-baseline guard contract (S-3 extends it); D-22 LevelDB-empty → JSON-fallback (S-2's safety net).

### km-core source (the target dependency — Phase 44 adds `src/api/`)
- `lib/km-core/src/index.ts` — root barrel; gains exports for `createKmCoreRouter` + Zod schemas.
- `lib/km-core/src/store/GraphKMStore.ts` — the store factory consumed.
- `lib/km-core/src/ontology/registry.ts` — drives `/api/v1/ontology/*`.
- `lib/km-core/src/maintenance/{resolveEntities,mergeEntities}.ts` — surfaces `/api/v1/cleanup/resolve-entities` route.
- `lib/km-core/package.json` — gains `express` as peerDependency + `zod` as dependency.
- **NEW:** `lib/km-core/src/api/router.ts` — Phase 44 deliverable: `createKmCoreRouter(store, opts)`.
- **NEW:** `lib/km-core/src/api/contracts.ts` — Phase 44 deliverable: Zod schemas codifying OKM-verbatim response shapes.
- **NEW:** `lib/km-core/src/api/snapshots.ts` — Phase 44 deliverable: git-snapshot/restore implementation backing `/snapshots/*` routes.
- **NEW:** `lib/km-core/src/adapters/observation-view.ts` — A-4 reshape function turning km-core entity → legacy observation/digest/insight shape.

### A surfaces (cutover target — modifications happen here)
- `scripts/observations-api-server.mjs` — A's host-side server on :12436. Lines 376, 397, 436 (write paths), 466, 592, 607, 689, 705, 753, 769, 845, 974, 1017, 1053, 1081 (read + ops). Mounts `createKmCoreRouter(kmStore)` at `/api/v1` + retains legacy paths under `/api/coding/*` as typed views (A-4).
- `.data/knowledge.db` — SQLite. Tables `observations`, `digests`, `insights` DROPPED after A-2 migration (A-3); `budget_events`, `session_metrics`, `embedding_cache` SURVIVE.
- **NEW:** `scripts/migrate-sqlite-to-kmcore.mjs` — A-2 deliverable: one-shot SQLite → km-core migration with `legacyId={system:'A', id:<rowid>}`.
- A's dashboard consumer: `integrations/system-health-dashboard/` — verifies the legacy endpoints still return their existing shape under A-4 typed views (no consumer code change needed but smoke required).

### B surfaces (REST surface introduced)
- `integrations/mcp-server-semantic-analysis/src/sse-server.ts` — current SSE server on :3848 (`/health`, `/sse`, `/workflow-events`, `/messages`). REST mount strategy (same port + new mount vs new port) — **planner decision**, not locked here.
- `integrations/mcp-server-semantic-analysis/src/server.ts` — likely site for `app.use('/api/v1', createKmCoreRouter(kmStore))` mount.
- B's km-core consumer path established in Phase 42 — `kmStore` already constructed in B; just needs the router mount.

### C surfaces (OKM — biggest pre-existing surface; hard-cutover work)
- `_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts` lines 450–488 — OKM's full REST surface today. **Phase 44 sub-plan deletes this file's endpoint definitions** and replaces them with `app.use('/api/v1', createKmCoreRouter(kmStore))` + `app.use('/api/okm', createOkmSpecificRouter(...))` for non-canonical ops (PII scan, ingest).
- `_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts` — `createServer()` signature simplifies after the router mount lands here.
- `_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/rest-contract.test.ts` — Zod schema lock; rewritten in Phase 44 to import schemas from `@fwornle/km-core/api/contracts`.
- `_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/*.json` — **REGENERATED** under `/api/v1/` paths as part of R-4 hard cutover.
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/` — VOKB; URL constants (likely `src/lib/api-client.ts` or similar) rewritten to `/api/v1/` per R-4.
- `_work/rapid-automations/integrations/operational-knowledge-management/scripts/verify-post-migration.mjs` — rewritten to hit `/api/v1/` paths.

### Git hook (S-3 deliverable)
- `.github/hooks/pre-commit` (or wherever the OKB-baseline guard lives in coding repo) — extended whitelist for `chore(snapshot)` + `chore(restore)` prefixes.
- Equivalent hook in `_work/rapid-automations/.github/hooks/` (if present) — same extension.

### Existing patterns to reuse
- Phase 43 D-G4.1 JSON-replay migration script — template for A-2.
- Phase 42 D-51 / Phase 43 D-G3.1 strangler-then-delete final-cleanup pattern — template for the URL-rewrite + legacy-endpoint-handler-deletion sub-plan.
- OKM's `src/intelligence/clustering.ts` Louvain — reused verbatim by `/api/v1/clusters` (C-3).

### User constraints from memory
- `memory/feedback_bmw_ghe_https.md` — bmw.ghe.com requires HTTPS-token auth. OKM lives there; relevant for Phase 44 OKM-side commits + the eventual PR.
- `memory/feedback_worktree_verification.md` — verify "complete" claims against main, not worktree branches. Critical given the cross-repo nature.

### Project root
- `CLAUDE.md` — Submodules & Build Pipeline section. km-core lives at `lib/km-core/` as a submodule; changes to `lib/km-core/src/api/` require `npm run build` in km-core THEN propagate to consumers. Phase 43 lesson — easy to forget.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **OKM `src/api/routes.ts:450+`** — 30+ Express route handlers; the canonical ~15 are EXTRACTED to `km-core/src/api/router.ts` (C-1, C-2), the OKM-specific ~15 stay in OKM at `/api/okm/*` (C-4).
- **OKM `src/intelligence/clustering.ts`** — Louvain implementation; reused verbatim by `/api/v1/clusters` (C-3). The clustering logic is pure (deterministic via seed); fits a stateless REST endpoint cleanly.
- **A's `lib/llm-cli-proxy` Express patterns** — A already runs Express in `scripts/observations-api-server.mjs`; mounting the new router is a one-line `app.use('/api/v1', createKmCoreRouter(...))`.
- **B's `integrations/mcp-server-semantic-analysis/src/sse-server.ts`** — currently Express-based SSE; can host the canonical router on the same port with a different mount path.
- **Phase 43's recorded fixtures `tests/fixtures/pre-migration/*.json`** — the wire format C-2 codifies as Zod. Even though they'll be regenerated under `/api/v1/` (R-4), the SHAPES they validate stay.
- **km-core's GraphKMStore + OntologyRegistry surfaces** — Phase 37/38 deliverables, already async-native; the router calls them directly without adapters.

### Established Patterns
- **Strangler with feature flag → final-cleanup-plan deletes everything (Phase 42 D-51 / Phase 43 D-G3.1).** R-4 hard cutover is the same pattern applied to URL paths instead of storage backends.
- **Optional first-class Entity field extensions (Phase 42 `embedding?`, Phase 43 `layer?`).** If Phase 44 surfaces require any new optional Entity field (none expected from this discussion), the same pattern applies.
- **Per-domain JSON exports debounced from LevelDB (Phase 37 D-21).** S-1 whole-dir snapshot operates over the existing exports; the debounced exports are the snapshot atom.
- **D-22 LevelDB-empty → JSON-fallback (Phase 37).** S-2 restore relies on this — server reconstructs LevelDB from JSONs after the wipe.
- **Two-commit pattern + OKB-baseline guard (Phase 37 D-21).** S-3 extends the hook's whitelist — minimum-viable change to the existing guard.
- **Zod schemas as wire contract (Phase 43 `tests/integration/rest-contract.test.ts`).** C-2 LIFTS this from test-only into shipped km-core artifacts under `km-core/src/api/contracts.ts`.

### Integration Points
- **km-core ⇄ A**: `scripts/observations-api-server.mjs` constructs `GraphKMStore` (already does via Phase 41); Phase 44 mounts the router on the same app.
- **km-core ⇄ B**: `integrations/mcp-server-semantic-analysis/src/sse-server.ts` constructs the store (Phase 42); Phase 44 mounts the router on the SSE server's Express app.
- **km-core ⇄ C/OKM**: OKM already constructs km-core (Phase 43); the entire OKM `src/api/routes.ts` gets replaced by the router mount + the per-system sub-router for OKM-specific ops.
- **A ⇄ A's dashboard at :3032**: legacy paths preserved by A-4 typed views — zero consumer code change required; smoke verification per system.
- **C ⇄ VOKB viewer**: URL constants rewrite ONLY — VOKB lives in `_work/rapid-automations/integrations/operational-knowledge-management/viewer/`; planner identifies the central URL constants file.
- **Phase 43 fixtures regeneration** — recorded responses are deterministic given a fixed seed dataset; regeneration is a script-run, not a manual exercise.

### Known Gotchas
- **OKM lives in a SEPARATE git repo from coding** — Phase 44 has work in both repos. CLAUDE.md Submodules & Build Pipeline rules apply per-repo. Mirrors Phase 43.
- **Phase 43 commit `8457dd56c`** removed hallucinated Phase 43/44 planning docs on OKM. Treat OKM-side `.planning/` as canonical-from-coding; do not re-introduce planning docs there.
- **km-core needs `npm run build` after every source change before Docker picks it up.** Lesson from Phase 42; especially relevant since `lib/km-core/src/api/` is brand new and Docker bind-mounts won't auto-discover it without an explicit volume entry.
- **B's dual server topology (SSE :3848 + REST mount).** Planner picks port strategy: same port new mount (simpler), or new port (cleaner separation, more health-coordinator work).
- **A's dashboard at :3032 reads `/api/observations|digests|insights`.** A-4 typed views MUST preserve EXACT field names and types — the dashboard is brittle to shape changes. Smoke testing required per system before phase close.

</code_context>

<specifics>
## Specific Ideas

- **R-3 `/api/v1/` mount** — chosen over recommended `/api/` direct mount. Explicitly preferred future-proofing version evolution over zero-migration tax. Signals operator's preference for clean end-state + room to evolve.
- **R-4 hard cutover** — chosen over recommended 6-month dual-mount deprecation. Consistent with Phase 42 D-51 / Phase 43 D-G3.1 "delete legacy entirely" pattern the user has set as v7.1's house style.
- **C-1 canonical = OKM CRUD/query/ontology core** — explicitly chose middle option (15 endpoints) over bloat (full 30+) or minimalism (just CRUD + search). The selected boundary aligns with what Phase 45's unified viewer needs: enough surface to render a graph with hierarchy + clusters, no per-system operational bloat.
- **A-1 full cutover** — explicitly closed the parallel-path asymmetry Phase 42 + 43 deferred. Removes a long-standing v7.1 debt.
- **S-1 whole-dir snapshot** — atomic-across-domains preferred over per-domain granularity; user prioritized "no half-restored states" over surgical restore.
- **S-2 hard reset on restore** — destructive-by-design preferred over merge semantics; user accepted the operational sharpness in exchange for predictable end-state.

</specifics>

<deferred>
## Deferred Ideas

- **Soft-deprecation of `/api/entities` (pre-v1)** — explicitly REJECTED by R-4. If post-cutover regret emerges, can be revisited as a bug-fix phase.
- **`/api/v2/`** — versioning escape hatch is reserved by R-3. Future schema-breaking changes use it; out of scope here.
- **Snapshot retention/garbage-collection policy** — operator-owned. Future phase may add `DELETE /api/v1/snapshots/:id` + a retention setting; not enforced in code yet.
- **Snapshot diffing / cross-snapshot queries** — `GET /api/v1/snapshots/:id1/diff/:id2`-style endpoint would be useful for ops but isn't in API-01/API-02.
- **Migrating A's `budget_events` / `session_metrics` / `embedding_cache` off SQLite** — non-knowledge analytics data; doesn't share the entity model. A future phase may move them to `.data/analytics.db` for cleaner separation. Out of scope here.
- **B's full workflow-execution REST surface** — only canonical CRUD/query/ontology/snapshot endpoints get added to B. The SSE workflow runner stays separate; if future work wants `/api/v1/workflows/*` REST, it's a follow-up phase.
- **OKM-specific operations (PII scan, ingest adapters) as canonical Phase 44 endpoints** — explicitly carved out into `/api/okm/*` (C-4). If a future system needs PII scanning, the operation gets re-canonicalized then.
- **Pre-restore safety snapshots** — restore is destructive-by-design (S-2). If recurring data loss happens in practice, a future phase may add auto-snapshot-before-restore semantics.
- **Auth/AuthN introduction** — current internal-only stance preserved; OAuth/OIDC out of scope. If any system gets externally exposed in a future phase, auth gets a phase of its own.

### Reviewed Todos (not folded)
- `.planning/todos/pending/2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` (score 0.6) — A's obs-api libc++ mutex shutdown crash; bug-fix, orthogonal to API surface unification. Stays in pending.
- `.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md` (score 0.6) — 8 digests reference missing observations. A-2's migration naturally drops dangling references (entities with missing legacyId targets get skipped), so this likely resolves as a side effect — but it's not the phase goal. Stays in pending; if A-2 doesn't fix it, it remains a separate bug-fix phase.
- `.planning/todos/pending/2026-03-10-replace-console-log-with-proper-logging.md` (score 0.2) — cross-cutting tooling concern; not Phase 44 scope.

</deferred>

---

*Phase: 44-rest-api-git-snapshots*
*Context gathered: 2026-06-03*
