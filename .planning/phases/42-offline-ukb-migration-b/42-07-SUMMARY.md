---
phase: 42-offline-ukb-migration-b
plan: 07
status: partial
plan_status: partial
completed: false
date_started: 2026-05-23
date_paused: 2026-05-24
follow_up_required: true
follow_up_route: forensics
follow_up_target: integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts
deferred_to_next_phase: true
---

# Plan 42-07 — PARTIAL

Plan 42-07 (final cleanup + E2E SC verification gate) is **PARTIAL**. Phase A, reduced Phase B (Option B1), the SC#4 single-writer fix, and Surprise #5 ESM regression fix all landed. Phase C (production wave-analysis + `syncQdrantFromStore` + SC#1–5 verifier + operator gate) was **not executed to completion** — first blocked by a Claude API daily usage limit, then stopped by the user after dashboard observations exposed deliverable gaps in Plan 42-06.

## Why this is PARTIAL

The plan's `must_haves.truths` assumed prior plans had migrated *all* persistence consumers to km-core. They had not. Pre-execution triage uncovered six architectural surprises that progressively narrowed scope:

| # | Surprise | User decision | Result |
|---|----------|---------------|--------|
| 1 | `persistence-agent.ts` has 30+ live consumers in `coordinator.ts` / `tools.ts` / `content-validation-agent.ts` — not "all migrated by Plan 6". | Option 1 — re-scope: defer legacy trio | Persistence trio survives Plan 42-07 |
| 2 | `GraphDatabaseService.js` is imported by `graph-database-adapter.ts` as the live fallback when VKB API is unreachable. | Option B1 — delete only truly-dead `.js` | Only `KnowledgeStorageService.js` deleted |
| 3 | Legacy `GraphDatabaseService` expects `.ldb` files at `.data/knowledge-graph/` root; km-core uses `.data/knowledge-graph-migrated/{exports/, leveldb/}` subdirs. Atomic dir-swap would break the legacy fallback. | Option A — skip swap; rewire km-core to read migrated dir | Two LevelDB dirs coexist; will drift after each `ukb full` |
| 4 | `QdrantSyncService.js` has live superproject consumers (`src/databases/DatabaseManager.js`, `scripts/sync-graph-to-qdrant.js`) that RESEARCH §3's submodule-only grep missed. | Defer QdrantSync | QdrantSync survives Plan 42-07 |
| 5 | Pre-existing ESM regression: `src/agents/semantic-analyzer.ts:283` uses CommonJS `require()` in an ESM-compiled module. Introduced by submodule commit `12fc1f5` BEFORE Phase 42 even started; masked by an Error-log payload bug in `main().catch` that swallowed the stack trace. | Option α — fix in scope + extend SC#4 belt-and-braces | Fix landed; Phase C unblocked but never run |
| 6 (operator observation, post-quota-hit overnight `ukb` run) | Wave-analysis entities are emitted without `team`/project metadata; LLM dispatch calls land in token-usage tracking as `unknown` process. | (none) — Plan 42-07 stopped; routed to forensics | Plan 42-06 deliverable gap: canonical emit + wave-controller LLM dispatch are missing project linkage and process attribution |

## What landed in Plan 42-07

### Phase A — wave-controller km-core bootstrap rewired (no atomic swap)
- Production migration ran via `scripts/migrate-leveldb-to-kmcore.mjs` (Plan 5 deliverable) — 802 entities, 0 errors, output at `/Users/Q284340/Agentic/coding/.data/knowledge-graph-migrated/`. Plan 5's dry-run was promoted to the real migration.
- `.data/exports/coding.json.pre-42-backup` created.
- `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts:507` — km-core `dbPath` rewired from `.data/knowledge-graph` to `.data/knowledge-graph-migrated`.
- **Atomic dir-swap NOT done** (Surprise #3) — `.data/knowledge-graph/` still holds the legacy GraphDatabaseService store; `.data/knowledge-graph-migrated/` holds the km-core canonical store.
- Commits: submodule `73313e7`, superproject `a7033ec0c`.

### Phase B1 — reduced cleanup (Option B1)
- **Deleted:** `integrations/mcp-server-semantic-analysis/src/knowledge-management/KnowledgeStorageService.js` (truly dead — only a docstring reference in `KnowledgeExportService.js:16`, which was updated in the same commit).
- **Deleted:** `integrations/mcp-server-semantic-analysis/src/config/persistence-flag.ts` (after collapsing all readers).
- **Collapsed:** `KM_CORE_PERSISTENCE` flag in `wave-controller.ts` — km-core is now the **unconditional** persistence path. The legacy `else`-branch in `persistWaveResult` (the `persistenceAgent.persistEntities` call) was removed. Test files `km-core-adapter.test.ts` (Tests 1–3 persistence-flag describe-block) and `wave-controller-canonical-emit.test.ts` (test 8 grep assertion) updated accordingly.
- Commits: submodule `9411822`, superproject `bdb48f8f2` + `6caba5cfd`.

### SC#4 single-writer fix
Plan 42-02 (race-condition fix) had verified SC#3 (no race-condition log spam) but discovered that the workflow runner exited silently after ~1s, leaving `.data/workflow-progress.json` stuck at `status: "running"` forever (SC#4). Plan 02 escalated this to Plan 7 with diagnostic `42-02-VERIFY-FAIL.md`.

What landed:
- `integrations/mcp-server-semantic-analysis/src/workflow-runner-terminal-write.ts` — new helper that writes a terminal status (`success` / `error`) to the progress JSON; the single allowed terminal-state writer per RESEARCH §2 fix #1.
- Wired into `workflow-runner.ts` wave-analysis branch (success, failure, and inner-catch paths).
- **Belt-and-braces extension (Surprise #5 mitigation):** also wired into `main().catch` outer handler so that pre-wave-branch fatal errors (WaveController constructor failures, semantic-analyzer crashes, etc.) still flip progress from `running` to terminal. The original SC#4 wiring only covered the wave branch, which is why Surprise #5 escaped detection until the user prompted for SC#4 investigation.
- `src/workflow-runner-terminal-write.test.ts` — 7 unit tests; RED→GREEN pair committed atomically.
- `src/workflow-runner.ts` `main().catch` — unwraps `Error` objects properly (was logging `Data:{}` for empty enumerable keys before).
- Commits: submodule `f5d0857` (RED), `92d8057` (GREEN), `f25298f` (error-log unwrap), `6aec6e8` (belt-and-braces); superproject `6caba5cfd` + `2983fed9f` + `7dbca98df`.

### Surprise #5 ESM fix
- `integrations/mcp-server-semantic-analysis/src/agents/semantic-analyzer.ts:283` — replaced CommonJS `require('../utils/token-usage-logger')` with a static ESM `import` at the top of the file.
- Submodule commit `85f496a`. The crash chain `WaveController → QualityAssuranceAgent → SemanticAnalyzer (constructor)` no longer throws `ReferenceError: require is not defined`.
- This regression was introduced by submodule commit `12fc1f5 feat: inclusion of token usage logger` and predates ALL Phase 42 work. It silently broke `ukb full` for any code path that constructed a `WaveController` after that commit; the failure was masked by the `main().catch` error-log payload bug fixed in `f25298f`.

### SC#1–5 verification script
- `integrations/mcp-server-semantic-analysis/scripts/42-07-end-to-end-verify.mjs` — created but **never run to completion against a freshly-migrated production wave**.
- Commit: submodule `dba65bb` (bundled in superproject `6caba5cfd`).

## What is DEFERRED — follow-up phase required

The following Plan 42-07 ambitions remain unmet. All deferred work belongs together in a single follow-up phase (proposed: Phase 42.1 — "Legacy persistence trio retirement + canonical emit completion"):

1. **Legacy persistence trio deletion** — `persistence-agent.ts`, `graph-database-adapter.ts`, `GraphDatabaseService.js`, `QdrantSyncService.js`, and the rewire of `content-validation-agent.ts`. Requires migrating ~30+ consumer call sites in `coordinator.ts` (`saveSuccessfulWorkflowCompletion`, `linkInsightDocuments`, `removeEntity`, JSON export, registered-agent path), `tools.ts`, and `content-validation-agent.ts` to km-core equivalents. Also requires either (a) no-op'ing `QdrantSyncService` in `src/databases/DatabaseManager.js` + rewriting `scripts/sync-graph-to-qdrant.js` to call km-core's `syncQdrantFromStore`, OR (b) keeping the QdrantSync code as the operational bidirectional-sync entry point and only removing the `.js` shim when km-core has feature parity.
2. **Atomic LevelDB dir-swap** — collapse `.data/knowledge-graph/` and `.data/knowledge-graph-migrated/` into one canonical location once the legacy trio is gone. The two stores will drift after each `ukb full` until this happens, because Phase A's rewire sends only the km-core path to the migrated dir; legacy `GraphDatabaseService` keeps writing the original location through `graph-database-adapter.ts`.
3. **Plan 42-06 canonical emit gaps (newly discovered, blocking SC verification):**
   - **(a) LLM workload attribution.** The wave-controller's LLM dispatch path (and downstream agent dispatchers) emits LLM calls to the rapid-llm-proxy without a `process` field. Dashboard token-usage shows the entire Phase 42 / overnight `ukb` workload as `unknown` (operator confirmation). Fix probably belongs in `wave-controller.ts` or the canonical-mapper's LLM client wiring — wherever `POST /api/complete` is called, ensure `process: 'wave-analysis'` (or a more specific identifier) is in the request body. CLAUDE.md documents the `/api/complete` request shape — `{process, messages, taskType?}`. The `process` field exists; we're not setting it.
   - **(b) Entity project linkage.** Plan 42-06 `toCanonicalEntity` (or equivalent emit path) is producing km-core Entities without a `team` / project identifier. Without this, km-core's dedup/merge can't group entities and operator observation (b) confirms new wave nodes are unconnected and unmerged. Fix probably belongs in `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts` — every emit should set `team: 'coding'` (or read it from the workflow parameters where the team is already specified). May also affect Plan 42-05's migration script — verify the 802 migrated entities carry team metadata.
4. **Phase C end-to-end SC verification gate** — once (1)–(3) are addressed, run the SC#1–5 verifier script. SC#2 (every Detail entity has `embedding.length === 384`) and SC#5 (km-core OntologyRegistry adoption end-to-end) cannot be validated meaningfully until (3) is fixed because dedup/merge being a no-op contaminates the entity count and per-class coverage.

## Recommended next action

**`/gsd-forensics` on the Plan 42-06 canonical emit + LLM dispatch paths**, focused specifically on:
- `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts` — verify `team` / project fields are set on every emitted Entity
- `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts` and any agent that calls the LLM proxy — verify `process` is set on every `POST /api/complete` body
- Inspect the 802 migrated entities in `.data/knowledge-graph-migrated/` for `team` presence

Once forensics identifies the missing fields, plan **Phase 42.1** with two concerns:
- Block 1: fix Plan 42-06 canonical emit gaps (project linkage + LLM attribution) → re-run a small `ukb full` → verify dedup fires
- Block 2: retire the legacy persistence trio (the deferred work from this plan's surprises 1–4)
- Block 3: atomic LevelDB dir-swap once Block 2 is done
- Block 4: Phase C SC#1–5 verification gate (using `42-07-end-to-end-verify.mjs` already committed in submodule `dba65bb`)

## What did NOT happen in Plan 42-07
- ❌ Production-mode `ukb full` was attempted overnight but never returned a verified terminal state to this orchestrator. Artifacts (PUMLs, observation exports) exist in the working tree but their correctness is in question per operator observations (a) and (b).
- ❌ `syncQdrantFromStore` rebuild — never run.
- ❌ SC#1–5 verifier script — never run to completion.
- ❌ Human-verify operator gate — not reached.
- ❌ Atomic LevelDB dir-swap — deferred (Surprise #3).
- ❌ Container-side `/tmp/42-07-source-snapshot/` cleanup — never performed (operator should remove manually if it still exists).
- ❌ Deletion of `persistence-agent.ts`, `graph-database-adapter.ts`, `GraphDatabaseService.js`, `QdrantSyncService.js` — deferred.

## All commits attributable to Plan 42-07

Superproject:
- `a7033ec0c` feat(42-07): bump semantic-analysis submodule for Phase A path rewire
- `bdb48f8f2` feat(42-07): delete KnowledgeStorageService.js + update KnowledgeExportService docstring (Phase B1)
- `6caba5cfd` feat(42-07): bump semantic-analysis submodule for Phase B1 + SC#4 fix + verify script
- `2983fed9f` fix(42-07): bump semantic-analysis submodule for improved error logging in workflow-runner
- `523507b01` docs(state): record Phase 42-07 Phase B1+SC#4 complete; Phase C halted on Architectural Surprise #5
- `7dbca98df` fix(42-07): bump semantic-analysis submodule for Surprise #5 ESM fix + SC#4 belt-and-braces

Submodule (`integrations/mcp-server-semantic-analysis`):
- `73313e7` feat(42-07): rewire wave-controller km-core bootstrap to migrated dir (Phase A)
- `9411822` feat(42-07): collapse KM_CORE_PERSISTENCE flag — km-core is the unconditional persist path (Phase B1)
- `f5d0857` test(42-07): add failing tests for SC#4 single-writer terminal-state guarantee
- `92d8057` feat(42-07): land SC#4 single-writer terminal-state guarantee in workflow-runner
- `dba65bb` feat(42-07): add SC#1-5 end-to-end verification script
- `f25298f` fix(42-07): unwrap Error objects in workflow-runner main().catch handler
- `85f496a` fix(42-07): replace CommonJS require with ESM import for token-usage-logger (Surprise #5)
- `6aec6e8` fix(42-07): SC#4 belt-and-braces — writeTerminalState in main().catch (Surprise #5 mitigation)

Final submodule pointer: `6aec6e8`.

## Test counts

- Submodule unit tests (post-Surprise-#5 fix): 33/33 pass (`km-core-adapter` 5 + `wave-controller-canonical-emit` 12 + `coordinator-progress-merge` 9 + `workflow-runner-terminal-write` 7).
- SC#1–5 verifier script: present, not run.
- Pre-existing tests outside Plan 42 work: unchanged.

## Operator notes

- The 802 migrated entities in `.data/knowledge-graph-migrated/` may need re-verification once the Plan 42-06 emit-shape gaps (project linkage) are fixed. If the migration script also dropped `team`, those 802 entities will need to be re-migrated; if it preserved `team` from the legacy LevelDB blob, they're fine and only future wave emissions need the fix.
- If `/tmp/42-07-source-snapshot/` still exists in `coding-services`, remove it manually: `docker exec coding-services rm -rf /tmp/42-07-source-snapshot/`.
- The overnight `ukb` run's PUML artifacts and observation exports remain uncommitted in the working tree. Inspect for correctness before committing — their entity references depend on the canonical emit-shape fix.
- `KM_CORE_PERSISTENCE` env var is **no longer read** anywhere. The flag is gone; the km-core path is unconditional. Operators no longer need to set this.
