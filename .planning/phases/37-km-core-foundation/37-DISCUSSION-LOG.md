# Phase 37: KM-Core Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 37-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 37-km-core-foundation
**Areas discussed:** Repo & Package Layout, UUID Scheme & Migration, GraphKMStore API Surface, Export Format & Backwards-Compat

---

## Repo & Package Layout

### Q1: Where should KM-Core physically live so both coding/ and rapid-automations/ can consume it?

| Option | Description | Selected |
|--------|-------------|----------|
| _work/km-core as sibling submodule | Mirrors _work/rapid-llm-proxy pattern; standalone repo consumed via git submodule by both. | |
| coding/lib/km-core as in-repo library | Matches existing lib/llm pattern. Asymmetric: B easy, C requires Phase 43 cross-repo strategy. | |
| Private npm package on a corp registry | Standalone repo + private npm publish. Cleanest dep story but excluded by REQUIREMENTS Out-of-Scope. | |

**User's choice:** Reframed — "standalone lib usable with all projects; coding is public, OKM is corporate, so KM-Core must be publicly available."

**Notes:** This narrowed the design space sharply: standalone PUBLIC repo is the lock, only consumption mechanism remains open.

### Q2: How should coding/ and OKM consume the public KM-Core repo?

| Option | Description | Selected |
|--------|-------------|----------|
| Public npm publish + npm install | KM-Core published to public npm; consumers add as versioned dep in package.json. | |
| Git submodule at consumer side | Each consumer adds km-core as submodule under their own tree. | ✓ |
| Both — publish to npm AND keep working-tree at ~/Agentic/_work/km-core | Dual consumption paths. | |

**User's choice:** Git submodule at consumer side. No npm publish in v7.1.

### Q3: Where should the local working tree live?

| Option | Description | Selected |
|--------|-------------|----------|
| ~/Agentic/_work/km-core/ | Mirrors existing _work/ pattern (rapid-llm-proxy, rapid-automations). | |
| ~/Agentic/km-core/ | Top-level sibling of coding/. Signals KM-Core is a peer project. | ✓ |
| Inside coding/_work/km-core/ | Submodule under coding/. Asymmetric. | |

**User's choice:** ~/Agentic/km-core/ — top-level peer.

### Q4: Where should the KM-Core submodule mount inside coding/?

| Option | Description | Selected |
|--------|-------------|----------|
| coding/lib/km-core/ | Co-located with lib/llm, lib/agent-api, lib/knowledge-api, lib/ukb-unified. New convention: lib/ accepts both in-repo dirs AND submodules. | ✓ |
| coding/integrations/km-core/ | Matches every existing submodule. Semantically odd: KM-Core isn't an integration. | |
| coding/vendor/km-core/ | New top-level dir for vendored external code. | |

**User's choice:** coding/lib/km-core/.

### Q5: Public repo name + URL?

| Option | Description | Selected |
|--------|-------------|----------|
| github.com/fwornle/km-core | Same org as all existing submodules. | ✓ |
| github.com/fwornle/km-core-js | Suffix -js leaves room for sister implementations. | |
| Different org / handle | Pick "Other" for a dedicated org. | |

**User's choice:** github.com/fwornle/km-core.

### Q6: License?

| Option | Description | Selected |
|--------|-------------|----------|
| MIT | Most permissive common OSS license. Compatible with corporate consumers. | ✓ |
| Apache 2.0 | Permissive + explicit patent grant. | |
| Match what coding/ uses | Defer to coding/'s LICENSE. | |

**User's choice:** MIT.

### Q7: Phase 37 v0.1 skeleton — minimal vs full bootstrap?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal | package.json, README, tsconfig, src/ stubs, parity tests. No CI. | |
| Full bootstrap | Above + GitHub Actions, manual npm publish workflow, CONTRIBUTING, ISSUE_TEMPLATE. | ✓ |
| You decide | Pick whichever makes planner's life easier. | |

**User's choice:** Full bootstrap.

### Q8: Package name in package.json (drives import paths)?

| Option | Description | Selected |
|--------|-------------|----------|
| @fwornle/km-core | Scoped under GitHub org; future-proof for npm publish. | ✓ |
| km-core (unscoped) | Bare name. Risk of name collision if/when published. | |
| @coding/km-core | Implies tight coupling to coding/. Misleading. | |

**User's choice:** @fwornle/km-core.

### Q9: Module format the published package emits?

| Option | Description | Selected |
|--------|-------------|----------|
| ESM-only | Matches existing stack (Node 22, type: module). Smallest output. | ✓ |
| Dual ESM + CJS | Max compat. Doubles build matrix. | |
| You decide | Pick based on planner instinct. | |

**User's choice:** ESM-only.

---

## UUID Scheme & Migration

### Q10: UUID variant for KM-Core entity identifiers?

| Option | Description | Selected |
|--------|-------------|----------|
| UUIDv7 — time-ordered | RFC 9562 (2024). k-sortable, better b-tree locality. | ✓ |
| UUIDv4 — fully random | RFC 4122 classic. crypto.randomUUID() native. | |
| UUIDv5 — deterministic from content | Idempotent ingest. Cost: ID changes with content. | |

**User's choice:** UUIDv7.

### Q11: When does an entity get its UUID stamped?

| Option | Description | Selected |
|--------|-------------|----------|
| Writer-side, on first store | GraphKMStore.put stamps if missing; callers may supply. | ✓ |
| Caller must always supply | Strict contract. More boilerplate. | |
| Pre-stamped at extract stage | Pipeline 'extract' stamps first. | |

**User's choice:** Writer-side on first store.

### Q12: How do existing entities migrate?

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot backfill in Phase 39 | Phase 39 owns DATA-01/02 anyway. Single coherent migration. | ✓ |
| Lazy migrate — stamp on next read | Zero downtime. Undefined ordering. | |
| Dual IDs forever | Permanent legacy + UUIDv7. Tech debt. | |

**User's choice:** One-shot backfill in Phase 39.

### Q13: How are UUIDs surfaced in the type system?

| Option | Description | Selected |
|--------|-------------|----------|
| Branded string type | type EntityId = string & { __brand: 'EntityId' }. Zero runtime cost. | ✓ |
| Plain string | Simplest. Nothing prevents mix-ups. | |
| Object wrapper | { uuid, version }. Serialization noise. | |

**User's choice:** Branded string.

### Q14: Shape of the legacyId field?

| Option | Description | Selected |
|--------|-------------|----------|
| Structured { system, id } | Explicit about origin. Useful for debugging. | ✓ |
| Plain string | Verbatim copy. Smaller. Ambiguous. | |
| Drop after backfill | Clean shape. Hard to grep originals. | |

**User's choice:** Structured { system, id }.

### Q15: UUIDv7 library?

| Option | Description | Selected |
|--------|-------------|----------|
| uuidv7 | Standalone, RFC-9562-compliant, ~3KB. | ✓ |
| uuid (with v7 subpath) | Familiar broad-ecosystem package. | |
| Custom implementation | ~30 lines. Maintain ourselves. | |

**User's choice:** uuidv7.

---

## GraphKMStore API Surface

### Q16: Core API shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Repository pattern — typed methods | getEntity, putEntity, findByOntologyClass, addRelation, batch, exportJson. | ✓ |
| Graph-native API — expose Graphology primitives | Max flexibility. Leaks Graphology. | |
| CQRS — separate Reader/Writer | Explicit intent. Overkill. | |

**User's choice:** Repository pattern.

### Q17: Sync vs async surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Async-only | Every method returns Promise. Unifies sync Graphology + async LevelDB. | ✓ |
| Dual sync/async | getEntitySync hot path + async writes. Doubles API. | |
| Sync-only via deasync | Universal but anti-pattern. | |

**User's choice:** Async-only.

### Q18: Event/subscription API?

| Option | Description | Selected |
|--------|-------------|----------|
| Built-in EventEmitter | Store extends EventEmitter; fires entity:put, entity:delete, etc. | ✓ |
| Pluggable event bus interface | Each consumer wires preferred impl. Over-engineered. | |
| No event API in v0.1 | Pure storage. Forces consumers to wrap with decorators. | |

**User's choice:** Built-in EventEmitter.

### Q19: Batch / transaction semantics?

| Option | Description | Selected |
|--------|-------------|----------|
| batch(ops[]) — atomic, all-or-nothing | Maps to LevelDB atomic batches. | ✓ |
| Per-op only | No atomicity. Recovery harder. | |
| Full transaction object | tx.begin/commit. SQL-like. State management heavy. | |

**User's choice:** batch(ops[]) atomic.

### Q20: Query / iteration surface?

| Option | Description | Selected |
|--------|-------------|----------|
| AsyncIterator + filter object | for await ... store.iterate({ filter }). Lazy. | ✓ |
| Cursor object | Explicit, checkpointable. More API surface. | |
| Eager arrays only — no streaming | findAll. Blows up at scale. | |

**User's choice:** AsyncIterator + filter.

### Q21: Write-time validation against ontology?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict by default, opt-out flag | Throws on unknown class; skipOntologyCheck escape. | ✓ |
| Advisory — log warning, store anyway | Matches OKM's current behavior. | |
| No validation at all | Caller's responsibility. | |

**User's choice:** Strict by default, opt-out flag.

---

## Export Format & Backwards-Compat

### Q22: Canonical JSON export shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-domain files, one per ontology lower-domain | .data/exports/{domain}.json. Mirrors C's pattern. | ✓ |
| Single file with domain-keyed top level | One all.json. Git diffs explode. | |
| Pluggable — each system configures own layout | Divergent layouts erode unification. | |

**User's choice:** Per-domain files.

### Q23: Backwards-compat for existing export paths?

| Option | Description | Selected |
|--------|-------------|----------|
| Symlink + alias | Canonical at .data/exports/; legacy paths become symlinks. No breaking changes. | ✓ |
| Write both — canonical + legacy paths | Belt-and-suspenders. 2x writes. | |
| Migrate paths in Phase 42/43 — break and update consumers | Breaks REQUIREMENTS Out-of-Scope. | |

**User's choice:** Symlink + alias.

### Q24: Export write cadence?

| Option | Description | Selected |
|--------|-------------|----------|
| Event-driven + debounced (5s) | Subscribes to own EventEmitter. Matches C's existing debounce. | ✓ |
| On-demand only via store.exportJson() | Caller decides. No automatic durability. | |
| Every mutation (no debounce) | Huge write amplification on bulk writes. | |

**User's choice:** Event-driven + 5s debounce.

### Q25: OKB-baseline guard interaction?

| Option | Description | Selected |
|--------|-------------|----------|
| Existing pre-commit hook stays the source of truth | KM-Core git-policy-unaware; hook enforces split. | ✓ |
| KM-Core writes via a commit-aware adapter | Tighter coupling. Brittle if policy changes. | |
| Drop the two-commit rule | v7.1 chance to retire. Established memory item. | |

**User's choice:** Existing pre-commit hook stays the source of truth.

---

## Claude's Discretion

- **Test framework selection** — Jest established per STACK.md but vitest is a reasonable alternative for an ESM-only TS lib. Planner picks.
- **Specific Graphology / classic-level version pins** — planner reads existing pins in B and C and matches.
- **TSConfig strictness levels** (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes) — planner picks based on what compiles cleanly with the rest of the codebase.

## Deferred Ideas

- npm publish workflow — kept manual in v0.1; reconsider post-v7.1 or when a third consumer arrives.
- Cross-language KM-Core (Python, Rust) — out of v7.1.
- Multi-instance / sharded KM-Core — perf-driven future enhancement.
- Query DSL (Gremlin/Cypher-style) — out of v7.1; AsyncIterator + filter + Graphology primitives sufficient.
- Built-in Qdrant / vector index — sidecar in v7.1 per REQUIREMENTS Future.
- OKM submodule mount point and packaging strategy — explicitly deferred to Phase 43's discuss.
