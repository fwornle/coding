# Phase 44: REST API & Git Snapshots - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 44-rest-api-git-snapshots
**Areas discussed:** Router topology, Canonical shape vs OKM-verbatim, A's parallel-path resolution, Snapshot/restore granularity + protocol

---

## Router topology

### Q1 — Where does the unified REST router live?

| Option | Description | Selected |
|--------|-------------|----------|
| km-core ships `createKmCoreRouter(store, opts)` (recommended) | Single source of truth: km-core exports factory; A/B/C mount it. Identical behavior by construction. | ✓ |
| km-core ships only Zod schemas + handler interfaces | Looser coupling, no framework dep in km-core; identical-behavior becomes test obligation. | |
| Hybrid: schemas in km-core, factory in thin sibling pkg | Keeps km-core framework-free; factory lives where it can depend on Express. | |
| You decide | — | |

**User's choice:** km-core factory (recommended). **R-1.**

### Q2 — Framework binding

| Option | Description | Selected |
|--------|-------------|----------|
| Express as peerDep (recommended) | All three systems use Express today; zero migration tax. | ✓ |
| Framework-agnostic handler array | Portable but A/B/C all on Express — paying for portability nobody needs. | |
| Fastify (replacement) | Faster + better TS but a migration on top of a migration. | |

**User's choice:** Express peer-dep. **R-2.**

### Q3 — Mount path

| Option | Description | Selected |
|--------|-------------|----------|
| `/api/` direct (recommended) | Matches OKM today; Phase 43 fixtures-diff covers it; no URL-rewriting. | |
| `/api/v1/` namespaced | Versioned from start; future-proofs schema-breaking changes. | ✓ |
| `/api/km/` namespaced | What Phase 43 reverted; keeps system-specific endpoints separate. | |

**User's choice:** `/api/v1/`. **R-3.** Notable deviation from the recommended option — user explicitly traded zero-migration-tax for future-proofing.

### Q4 — v1 migration tactic

| Option | Description | Selected |
|--------|-------------|----------|
| Dual-mount + 6-month deprecation (recommended) | Both `/api/` and `/api/v1/` work; RFC 8594 Sunset headers; phased migration. | |
| Hard cutover, all consumers rewritten in 44 | Phase 44 includes URL rewrites for VOKB viewer + fixtures + scripts. Clean end-state. | ✓ |
| 307 redirect from /api/* to /api/v1/* | Transparent for redirect-following clients; breaks proxies that strip Location. | |

**User's choice:** Hard cutover. **R-4.** Consistent with Phase 42 D-51 / Phase 43 D-G3.1 "delete legacy entirely" pattern.

---

## Canonical shape vs OKM-verbatim

### Q1 — Which OKM endpoints become canonical?

| Option | Description | Selected |
|--------|-------------|----------|
| OKM CRUD/query/ontology core only (recommended) | ~15 endpoints; OKM-specific (PII/ingest) stays at `/api/okm/*`. | ✓ |
| Full OKM surface verbatim | All 30+ endpoints become canonical; bloat with OKM-specific ops. | |
| Minimal — entities + relations + search only | Smaller surface; everything else system-specific. | |

**User's choice:** OKM CRUD/query/ontology core. **C-1.**

### Q2 — Response shape

| Option | Description | Selected |
|--------|-------------|----------|
| OKM shape verbatim, codified as Zod (recommended) | Take what OKM returns today, freeze as `EntityResponseSchema` in km-core. | ✓ |
| Define fresh canonical schema | Clean-break first principles; every consumer breaks. | |
| OKM shape + canonical extensions | Hybrid; risk of accreted complexity. | |

**User's choice:** OKM shape verbatim, codified as Zod. **C-2.**

### Q3 — Clusters + snapshots add-ons

| Option | Description | Selected |
|--------|-------------|----------|
| Both clusters + snapshots, OKM-style routes (recommended) | Reuses OKM's Louvain; full snapshot CRUD. | ✓ |
| Clusters as query parameter | Smaller surface; less ergonomic for viewer. | |
| Defer clusters to Phase 45 | Cleaner separation; only snapshots added now. | |

**User's choice:** Both, OKM-style routes. **C-3.**

### Q4 — Where do system-specific ops live?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-system sub-router at `/api/<system>/` (recommended) | `/api/v1/*` is contract; `/api/okm/*`, `/api/coding/*`, `/api/sem/*` are system-owned. | ✓ |
| All under `/api/v1/`, mark non-canonical as optional | Single URL space; 501 responses easy to miss. | |
| Drop them — migrate to CLI | Smallest end-state; behavior change. | |

**User's choice:** Per-system sub-router. **C-4.**

---

## A's parallel-path resolution

### Q1 — Storage source of truth

| Option | Description | Selected |
|--------|-------------|----------|
| Full cutover to km-core entities (recommended) | Obs/Digest/Insight become km-core entities; SQLite tables dropped. Closes Phase 42 deferred asymmetry. | ✓ |
| Read-side cutover only | SQLite stays writer; reads via km-core. Safer, asymmetry persists. | |
| Accept co-existence | Status quo; dual-write continues. | |

**User's choice:** Full cutover. **A-1.**

### Q2 — Migration mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot migration script + JSON-replay (recommended) | Mirrors Phase 43 D-G4.1; idempotent via legacyId. | ✓ |
| Streaming migration during normal operation | No downtime; long tail of partially-migrated state. | |
| Manual export → manual import | Useful for cleanup; overkill for clean data. | |

**User's choice:** One-shot migration script. **A-2.**

### Q3 — SQLite fate

| Option | Description | Selected |
|--------|-------------|----------|
| Drop 3 tables, keep DB for non-migrated (recommended) | observations/digests/insights dropped; budget_events/session_metrics/embedding_cache stay. | ✓ |
| Delete whole SQLite DB | Most aggressive; refactor to move analytics tables. | |
| Keep as read-only fallback | Carries deprecated path indefinitely. | |

**User's choice:** Drop 3 tables, keep DB. **A-3.**

### Q4 — Legacy endpoint shape preservation

| Option | Description | Selected |
|--------|-------------|----------|
| Typed view — reads `/api/v1/entities` + reshapes (recommended) | `/api/coding/observations` internally queries km-core, reshapes via adapter. Zero consumer breakage. | ✓ |
| Endpoints return canonical Entity shape | Honest break; dashboard + sub-agents update. | |
| Keep BOTH legacy + canonical paths | Soft transition; inconsistent with R-4 hard-cutover stance. | |

**User's choice:** Typed view. **A-4.**

---

## Snapshot/restore granularity + protocol

### Q1 — Snapshot unit

| Option | Description | Selected |
|--------|-------------|----------|
| Whole-directory, single git commit + tag (recommended) | Atomic across domains; no half-restored states. | ✓ |
| Per-domain granular | More surgical; cross-domain refs can dangle. | |
| Both — whole-dir default, per-domain via query param | Most flexible; both code paths need tests. | |

**User's choice:** Whole-directory atomic. **S-1.**

### Q2 — Restore semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Hard reset — wipe LevelDB, re-replay from JSON (recommended) | Leverages Phase 37 D-22 fallback; deterministic; destructive by design. | ✓ |
| Merge — new entities preserved | Partial replay; semantically confusing. | |
| Pre-restore safety snapshot, then hard reset | Undo path; tag clutter. | |

**User's choice:** Hard reset. **S-2.**

### Q3 — OKB-baseline guard interaction

| Option | Description | Selected |
|--------|-------------|----------|
| `chore(snapshot)` prefix, hook whitelists (recommended) | Snapshot ops recognized as their own class; normal two-commit pattern continues. | ✓ |
| Snapshot creation respects two-commit pattern | Multi-step API; honors guard literally. | |
| Bypass via --no-verify | Simplest; weakens guard invariant. | |

**User's choice:** Whitelist prefixes. **S-3.**

### Q4 — Snapshot discovery + ID

| Option | Description | Selected |
|--------|-------------|----------|
| Git tags as snapshot IDs (recommended) | Single source of truth; no parallel index to maintain. | ✓ |
| Custom server-side UUIDv7 | Decouples from git; parallel metadata to keep consistent. | |
| User labels as primary key | Human-friendly; collision policy needed. | |

**User's choice:** Git tags. **S-4.**

---

## Claude's Discretion

None — user made explicit choices on every question. Implementation details left to planner (B's REST mount port vs new port; URL constants file location in VOKB viewer; specific Zod schema field-by-field codification; clustering algorithm parameter defaults).

## Deferred Ideas

- Soft-deprecation of pre-v1 `/api/entities` (rejected via R-4)
- `/api/v2/` versioning escape hatch (reserved by R-3)
- Snapshot retention/garbage-collection policy
- Snapshot diffing / cross-snapshot queries
- Migrating A's analytics tables (budget_events, session_metrics, embedding_cache) off SQLite
- B's full workflow-execution REST surface
- Re-canonicalizing OKM-specific operations (PII scan) if another system needs them
- Pre-restore safety snapshots
- Auth/AuthN introduction
