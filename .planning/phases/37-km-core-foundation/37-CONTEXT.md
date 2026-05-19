# Phase 37: KM-Core Foundation - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the shared `km-core` package — canonical TypeScript entity/relation types, the `GraphKMStore` adapter (Graphology in-memory + LevelDB durable + git-tracked JSON cold-store), and a UUIDv7-based identifier scheme — as a standalone public repository (`github.com/fwornle/km-core`) consumed via git submodule by both `coding/` (B) and `~/Agentic/_work/rapid-automations/` (C, in Phase 43).

In scope: the package skeleton, the type exports, the storage adapter, the event emitter, the JSON exporter, the UUID stamping. **Out of scope** for this phase: per-system migrations (Phases 42/43), entity-shape provenance/temporal fields (Phase 39), pipeline framework (Phase 40), npm publishing (deferred, submodule-only in v7.1).

</domain>

<decisions>
## Implementation Decisions

### Repo & Package Layout
- **D-01:** KM-Core lives as a **standalone public repository** at `github.com/fwornle/km-core`. Public because `coding/` is public and OKM (C) consumes it from `rapid-automations/`; private npm was explicitly excluded by REQUIREMENTS Out-of-Scope. Future projects can adopt the lib.
- **D-02:** Local working tree at `~/Agentic/km-core/` (sibling of `coding/`, peer to `_work/`). This is the developer-facing edit location.
- **D-03:** Consumed via **git submodule**, not npm. No npm publish in v7.1 — the package.json `name` is set to `@fwornle/km-core` to keep the publish door open without committing to the workflow.
- **D-04:** Submodule mounts inside coding at `coding/lib/km-core/`. **New convention:** `lib/` now accepts both in-repo directories (existing: `lib/llm`, `lib/agent-api`, `lib/knowledge-api`, `lib/ukb-unified`) AND submodules. Mild break from the prior "all submodules go under `integrations/`" rule. OKM's mount point is decided in Phase 43's discuss.
- **D-05:** License: **MIT**. Permissive, OSS-standard, compatible with corporate OKM consumer.
- **D-06:** Module format: **ESM-only** (`type: module`). Matches existing stack (`STACK.md`: Node 22, ESM throughout). No dual ESM+CJS in v0.1.
- **D-07:** v0.1 skeleton scope: **full bootstrap** — package.json, README, tsconfig, src/ with stubs, GitHub Actions for test/lint/build, manual-trigger npm publish workflow (not auto-fired in v7.1), CONTRIBUTING.md, ISSUE_TEMPLATE/.

### UUID Scheme & Migration
- **D-08:** UUID variant: **UUIDv7** (RFC 9562, 2024). Time-ordered, k-sortable, gives LevelDB/Graphology iteration roughly chronological order — better b-tree locality and debuggability than v4.
- **D-09:** Library: **`uuidv7` npm package** (~3KB, standalone, RFC-9562-compliant). Not the broader `uuid` package — keeps the dep tree minimal.
- **D-10:** Stamping: **writer-side on first store**. `GraphKMStore.putEntity` stamps a UUID if the entity doesn't already have one. Callers may supply their own (for idempotency / dedup short-circuit).
- **D-11:** Type representation: **branded string** — `type EntityId = string & { readonly __brand: 'EntityId' }`. Zero runtime cost, compiler catches mix-ups. Factory: `mintEntityId()`.
- **D-12:** Migration: **one-shot backfill in Phase 39** (which owns DATA-01/02 anyway). Phase 37 just defines the UUID contract; Phase 39 stamps legacy entities and preserves their original IDs.
- **D-13:** Legacy-ID shape: structured `legacyId: { system: 'A' | 'B' | 'C', id: string }`. Explicit about origin (debugging) at a small payload cost.

### GraphKMStore API Surface
- **D-14:** API shape: **repository pattern with typed methods**. `getEntity(id)`, `putEntity(e)`, `deleteEntity(id)`, `findByOntologyClass(cls)`, `addRelation(r)`, `findRelations(filter)`, `batch(ops)`, `exportJson()`. Refactor-friendly, IDE-friendly, matches B's and C's existing adapter shapes.
- **D-15:** **Async-only** — every method returns a Promise. Graphology is sync in-memory but LevelDB is async; the adapter unifies via async. No sync escape hatches in v0.1.
- **D-16:** Event/subscription API: **built-in EventEmitter**. The store extends Node's EventEmitter and fires `entity:put`, `entity:delete`, `relation:added`, `relation:removed`. Coding's existing Redis pub/sub bridge subscribes to these and republishes; no inversion of control imposed on KM-Core.
- **D-17:** Transactions: **`batch(ops[])` — atomic, all-or-nothing**. Maps cleanly to LevelDB's atomic batches and Graphology's transactional mutations. No full transaction-object API.
- **D-18:** Iteration: **AsyncIterator + filter object**. `for await (const e of store.iterate({ ontologyClass: 'Component' }))`. Lazy by default, handles large graphs without OOM.
- **D-19:** Ontology validation on write: **strict by default with opt-out flag**. `putEntity({ ontologyClass: 'NotAClass' })` throws; consumers can pass `{ skipOntologyCheck: true }` for entities targeting an unregistered ontology. Tightens OKM's current advisory-only behavior.

### Export Format & Backwards-Compat
- **D-20:** Canonical export layout: **per-domain files** at `.data/exports/{domain}.json`, one per ontology lower-domain (e.g., `coding.json`, `raas.json`, `kpifw.json`, `business.json`). Mirrors C's existing pattern; B's current single-file `.data/knowledge-export/coding.json` becomes one such file.
- **D-21:** Existing-path BC: **symlink + alias**. KM-Core writes the canonical layout; legacy paths (`.data/knowledge-export/coding.json`, `.data/observation-export/*.json`) become symlinks/aliases that point to the canonical files. OKB-baseline guard sees unchanged paths; dashboards, hooks, and the prompt-injection retrieval client keep working unchanged.
- **D-22:** Write cadence: **event-driven + 5-second debounced**. Subscribes to its own EventEmitter; flushes 5s after the last mutation. Atomic writes via temp-file + rename. Matches C's existing 5s debounce.
- **D-23:** OKB-baseline guard: **existing pre-commit hook stays the source of truth**. KM-Core is git-policy-unaware; it just writes files. The pre-commit hook continues to enforce the knowledge-vs-observation two-commit split. The hook may need a minor path update once `.data/exports/` is added — handled at execute time, not planning.

### Claude's Discretion
- Test framework selection (Jest is established per STACK.md, but vitest is a reasonable alternative for an ESM-only TS lib) — planner picks.
- Specific Graphology version pin in package.json — planner reads the existing pin in B/C and matches.
- TSConfig strictness levels (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes) — planner picks based on what compiles cleanly with the rest of the codebase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/REQUIREMENTS.md` §"Core types & storage (CORE)" — CORE-01, CORE-02, CORE-03 in their precise form
- `.planning/ROADMAP.md` §"Phase 37: KM-Core Foundation" — goal + 4 success criteria
- `.planning/research/v7.1-km-unification.md` — full 3-system comparison; the **architectural source of truth** for the whole milestone

### Existing storage code (B, C) — adapter to extract from
- `coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` — B's current `GraphDatabaseAdapter` (Graphology + LevelDB + JSON), the closest existing analog to GraphKMStore
- `coding/integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` §`KGEntity` (line ~31) — B's current entity shape (the `type` half of the `type`/`entityType` split that Phase 39 kills)
- `coding/integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` §`SharedMemoryEntity` (line ~45) + line ~583 — the `entityType` half of the split; the migration target
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/store/persistence.ts` — C's persistence-layer reference impl (LevelDB-first, JSON-export fallback)
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/package.json` — version pins for `graphology`, `classic-level`, etc.

### Conventions to honor
- `coding/.gitmodules` — existing submodule patterns (all currently mount under `integrations/<name>` against `github.com/fwornle/<name>`)
- `coding/CLAUDE.md` §"Rebuilding After Code Changes" — submodule build pipeline; applies if KM-Core is consumed at coding/lib/km-core/ via submodule (TS compile + Docker rebuild path)
- `coding/.planning/codebase/STACK.md` — Node 22+, TS 5.8+, ESM (`type: module`), Jest
- Existing two-commit pattern enforced by pre-commit hook (`OKB BASELINE GUARD`) — knowledge-export vs observation-export must be separate commits

### Out-of-scope guardrails
- `.planning/REQUIREMENTS.md` §"Out of Scope" bullets 3 and 4 — backwards-compat for `.data/observation-export/*.json` and `.data/knowledge-export/coding.json` paths; OKM packaging strategy deferred to Phase 43

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`GraphDatabaseAdapter` (B)** — Already wraps Graphology + LevelDB + JSON export with the right async surface. KM-Core's `GraphKMStore` is essentially this class extracted, generalized, and given a typed repository API. Read this file first; do not reimplement from scratch.
- **`store/persistence.ts` (C)** — Same stack, slightly different shape. Read for the LevelDB-first / JSON-fallback startup logic and the 5s debounce pattern.
- **`crypto.randomUUID()` (Node 19+)** — Available natively, but produces v4. Use the `uuidv7` package for v7.
- **Existing `_work/` submodule pattern** — `_work/rapid-llm-proxy`, `_work/rapid-automations` are precedent for sibling-submodule layout, though KM-Core ends up at `~/Agentic/km-core/` (peer of coding/, not under _work/).

### Established Patterns
- **ESM `type: module`** — package.json must declare this; all imports use ESM syntax.
- **Node EventEmitter for hot-write hooks** — already used implicitly via Redis pub/sub bridge; KM-Core's EventEmitter is the in-process source the bridge subscribes to.
- **Temp-file + atomic rename for JSON exports** — C does this; KM-Core inherits.
- **Strict TypeScript** — CLAUDE.md mandate; KM-Core's `tsconfig.json` must enable `strict`.

### Integration Points
- B's `GraphDatabaseAdapter` consumers (workflow-runner.ts, wave-controller.ts, persistence-agent.ts) — these become the parity-test workload for Phase 37 success criterion 2.
- A's `ObservationWriter` / `ObservationExporter` — not touched in Phase 37, but the KM-Core entity model must be expressive enough that A's adapter (Phase 41 / INT-01) can map observations/digests/insights onto it without lossy translation.
- The pre-commit hook `OKB BASELINE GUARD` — must continue to fire correctly on `.data/exports/` paths.

</code_context>

<specifics>
## Specific Ideas

- Repo URL convention: `github.com/fwornle/<name>` (same org as all existing submodules — mcp-constraint-monitor, memory-visualizer, mcp-server-semantic-analysis, etc.). KM-Core is `github.com/fwornle/km-core`.
- Package name in package.json: `@fwornle/km-core` (scoped under the GitHub org, future-proof for npm publish).
- Workdir at `~/Agentic/km-core/` is a **top-level peer** to `coding/`, not under `_work/`. This deliberately signals that KM-Core is a first-class project, not a coding-internal vendored dep.

</specifics>

<deferred>
## Deferred Ideas

- **npm publish workflow** — kept manual in v0.1 (not auto-fired in v7.1). Reconsider after the package matures, likely in a post-v7.1 milestone or when the first third consumer (beyond B and C) shows up.
- **Cross-language KM-Core (Python, Rust)** — out of v7.1. If demand arises, the `@fwornle/km-core` JS impl becomes the reference; sister packages would be e.g. `km-core-py` repos.
- **Multi-instance / sharded KM-Core** — single-instance per consumer in v7.1. Sharding (e.g., one LevelDB per ontology domain) is a perf-driven future enhancement.
- **Query DSL beyond filter objects** — graph-traversal DSL (Gremlin/Cypher-style) is out of scope; the `iterate({ filter })` AsyncIterator + Graphology primitives (re-exportable as a separate API if needed) cover v7.1 query needs.
- **Built-in Qdrant / vector index** — REQUIREMENTS Future calls this out. KM-Core stays storage-only; embedding/Qdrant remains a sidecar in v7.1.
- **OKM submodule mount point and packaging strategy** — explicitly deferred to Phase 43's discuss (REQUIREMENTS Out-of-Scope).

</deferred>

---

*Phase: 37-km-core-foundation*
*Context gathered: 2026-05-19*
