# Phase 43: OKM Cross-Repo Migration (C) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 43-okm-cross-repo-migration-c
**Areas discussed:** Packaging strategy, Migration scope past storage, Legacy cleanup + flag retirement, OKM LevelDB data continuity, REST API stability verification, VOKB viewer scope, Embedding standardisation

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Packaging strategy (SC#2 lock) | How OKM consumes km-core: submodule, tarball, npm, hybrid. STATE.md flagged it as THE open blocker. | ✓ |
| Migration scope past storage | Storage-only vs +ontology vs +maintenance vs full Phase-40 pipeline. | ✓ |
| Legacy cleanup + flag retirement | Mirror Phase 42 final-cleanup vs keep dual paths. | ✓ |
| OKM LevelDB data continuity | In-place rewrite vs JSON-replay vs fresh start vs path-converge. | ✓ |

**User's choice:** all four

---

## Packaging Strategy

### Q1 — How should OKM consume km-core after Phase 43 closes?

| Option | Description | Selected |
|--------|-------------|----------|
| Git submodule (lib/km-core in OKM) | Mirror coding/'s `lib/km-core` pattern. Tracks a specific km-core SHA. | ✓ |
| Vendored tarball (formalized) | Keep current vendor/.tgz pattern but make explicit with a bump script. | |
| Hybrid — submodule for dev, tarball for CI | Submodule for local dev, vendored .tgz for install. | |

**User's choice:** Git submodule (mirrors B)

### Q2 — Submodule location + package.json reference?

| Option | Description | Selected |
|--------|-------------|----------|
| lib/km-core inside OKM — reference via file:lib/km-core | Self-contained; OKM clone + init gives everything. | |
| lib/km-core at rapid-automations root | Shared if other integrations need km-core. Couples OKM to parent layout. | |
| lib/km-core inside OKM + npm-pack into vendor/ at build time | Submodule = dev convenience; vendored .tgz = stable install graph (avoids TS-on-the-fly issues). | ✓ |

**User's choice:** Submodule inside OKM + tarball-in-vendor pipeline at build time

### Q3 — What happens to rapid-automations/package.json's vestigial km-core reference?

| Option | Description | Selected |
|--------|-------------|----------|
| Delete it — nothing in RA root imports km-core | Confirmed by grep: zero RA-root consumers outside OKM. | ✓ |
| Re-point at OKM's vendor tarball for symmetry | Still unused but stops referencing sibling coding/ repo. | |
| Leave it — out of scope for Phase 43 | Dead code but doesn't break CI. | |

**User's choice:** Delete the vestigial reference

### Q4 — Submodule URL scheme + re-pack discipline?

| Option | Description | Selected |
|--------|-------------|----------|
| HTTPS URL + version-tagged bumps | Public km-core repo; zero-auth CI. Bump only on version tags (e.g., v0.2.0). | ✓ |
| HTTPS URL + auto-pack on every km-core SHA change | Faster iteration; tarball binary churns in git. | |
| SSH URL + version-tagged bumps | Requires CI to provision github SSH key. | |

**User's choice:** HTTPS URL + version-tagged bumps. Commit pattern: `chore(deps): bump km-core 0.1.0 → 0.2.0`

**Notes:** Verified km-core repo is `"private": false` on github.com — public, so HTTPS works for any CI environment including bmw.ghe.com.

---

## Migration Scope Past Storage

### Q1 — How deep does Phase 43 migrate beyond storage?

| Option | Description | Selected |
|--------|-------------|----------|
| Full unification (storage + ontology + dedup + maintenance + pipeline) | Mirror Phase 42. Replace OKM's pipeline / dedup with km-core's Phase 40 framework. | |
| Storage + Ontology + Maintenance, keep OKM Pipeline+Dedup | Swap registry + route resolve-entities through km-core; keep OKM's 3-phase dedup + 4-stage pipeline. | ✓ |
| Storage-only — minimal cutover | Just flip OKB_STORE_BACKEND default. INT-03 on a technicality. | |
| Storage + Ontology only | Skip maintenance; OKM's pipeline.resolveEntities stays. | |

**User's choice:** Storage + Ontology + Maintenance (medium depth)

### Q2 — OntologyRegistry swap mechanics?

| Option | Description | Selected |
|--------|-------------|----------|
| Delete OKM's registry; consumers import from @fwornle/km-core/ontology | Clean. Any OKM-specific accessors must exist in km-core or be added there. | ✓ |
| Keep OKM's registry as a thin shim over km-core's | Smaller blast radius but two registry classes coexist. | |
| Delete OKM's registry + relocate ontology JSON files | Option (a) PLUS file moves if discovery convention requires. | |

**User's choice:** Delete OKM's registry entirely; consumers import direct

### Q3 — Maintenance ops convergence (OKM has its own resolveEntities)?

| Option | Description | Selected |
|--------|-------------|----------|
| Route /api/cleanup/resolve-entities to km-core's resolveEntities | Delete OKM's pipeline+dedup resolveEntities. OKM-specific PII / sourceAuthority bits become preprocessing. | ✓ |
| Keep OKM's resolveEntities; only adopt km-core's mergeEntities atomic primitive | Smaller diff, lower risk on the resolve loop. | |
| Keep BOTH — local impl + /api/km parallel | Two paths coexist. Defers convergence to Phase 44. | |

**User's choice:** Route to km-core's resolveEntities (aggressive convergence)

### Q4 — /api/km mount that leaked into OKM (Phase 44 territory)?

| Option | Description | Selected |
|--------|-------------|----------|
| Revert it — out of scope for Phase 43 | Phase 44 lands the unified router properly across A/B/C. | ✓ |
| Keep it — already wired and tested | Conditional on kmStore being available. Phase 44 formalizes later. | |
| Keep it, gate behind OKB_KM_API_PREVIEW env (default off) | Smoke-testable without exposure. | |

**User's choice:** Revert — scope discipline

---

## Legacy Cleanup + Flag Retirement

### Q1 — How does Phase 43 close: clean tree like Phase 42 or dual paths?

| Option | Description | Selected |
|--------|-------------|----------|
| Final cleanup plan deletes everything (mirror Phase 42 D-51) | Phase 43 closes with a clean tree — no dead code. | ✓ |
| Keep OKB_STORE_BACKEND as permanent rollback switch | Phase 42 explicitly rejected this for B. | |
| Two-stage: delete legacy in Phase 43, leave flag for one release cycle | Delete dead code immediately; flag stays as no-op briefly. | |

**User's choice:** Mirror Phase 42 — final cleanup plan deletes everything

### Q2 — Keep IGraphStore interface + adapter, or eliminate the bridge?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep IGraphStore + Adapter — consumers stay sync | Smaller diff, fewer test rewrites, easier review. | |
| Delete IGraphStore — refactor consumers to await km-core directly | Bigger diff (~10 files) but no leaky abstraction; OKM consumers go fully async-native. | ✓ |
| Keep + rename to IKmCoreSyncView | Same as option 1 with explicit naming. | |

**User's choice:** Delete IGraphStore + adapter (aggressive)

---

## OKM LevelDB Data Continuity

### Q1 — How to handle existing OKM data?

| Option | Description | Selected |
|--------|-------------|----------|
| Path-converge: km-core reads .data/leveldb directly | Risk: legacy key shape may not be compatible. | |
| In-place LevelDB rewrite (mirror Phase 42 D-54) | One-shot key migration. Idempotent. | |
| JSON-replay: rebuild km-core graph from .data/exports/*.json | Cleanest. JSON exports are master per OKM CLAUDE.md. | ✓ |
| Fresh start: re-ingest from Confluence/CodeBeamer/MkDocs adapters | Pristine but loses local-only edits; downtime. | |

**User's choice:** JSON-replay from git-tracked exports

### Q2 — Schema conversion (OKM has `layer`, km-core doesn't)?

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot conversion at replay time | Move legacy fields under metadata. | |
| Conversion + preserve legacy fields under metadata.legacy | Lossless. | |
| Extend km-core Entity to include `layer` as first-class field | Most type-safe long-term. Mirrors Phase 42's optional `embedding?` add. | ✓ |

**User's choice:** Extend km-core Entity with `layer?: 'evidence'|'pattern'` (Phase 39-style optional field)

### Q3 — Bootstrap timing for JSON-replay?

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot migration script | Dedicated `npm run migrate:to-km-core`; explicit. | |
| Steady-state cold-start fallback only | Phase 37 D-22 LevelDB-empty → JSON-fallback. Risk: silent failure modes. | |
| Both — one-shot + cold-start safety net | Belt-and-suspenders. | ✓ |

**User's choice:** Both — explicit migration + retained safety net

---

## REST API Stability Verification (SC#3)

### Q1 — How do we prove the REST API shape is unchanged?

| Option | Description | Selected |
|--------|-------------|----------|
| Recorded-fixtures byte-diff | Strictest; catches ordering/casing drift. | |
| Contract tests (Zod schemas) | Locks shape; less brittle. | |
| VOKB viewer smoke only | Lightweight; misses non-UI endpoints. | |
| All three — fixtures + contract + VOKB smoke | Belt-and-suspenders; highest confidence. SC#3 is explicit. | ✓ |

**User's choice:** All three verification gates

---

## VOKB Viewer Scope for Phase 43

### Q1 — What's in scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict no-touch — smoke test only | Cleanest guardrail. | |
| Smoke + minimal bug-fix-only edits | No features; in-place fix if smoke surfaces real breakage. | ✓ |
| Smoke + update viewer to consume /api/km | Incompatible with G2.Q4 revert decision. | |

**User's choice:** Smoke + bug-fix-only

---

## Embedding Standardisation (Phase 42 D-52c carry-forward)

### Q1 — OKM has no embeddings today. What to do?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip — revisit in Phase 44 | OKM clustering works on graph topology; no concrete consumer in Phase 43. | |
| Add embedding field; compute lazily on new ingests | Partial-coverage corpus; Phase 44 inherits a growing set. | |
| Full re-embed during Phase 43 migration | Honors Phase 42 D-52c. Adds fastembed dep. | ✓ |

**User's choice:** Full re-embed (honors D-52c commitment)

### Q2 — Qdrant for OKM?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline only — embeddings in km-core LevelDB; no Qdrant | Works for OKM's scale (<50K entities). | |
| Add Qdrant to OKM — mirror B's setup | Sub-ms vector search; higher ops cost. | |
| Hybrid — inline now, Qdrant when needed | `syncQdrantFromStore` plugs in later without re-embedding. | ✓ |

**User's choice:** Hybrid — inline now, Qdrant deferred until performance demands it

---

## Wrap-up

**User's final choice:** "I'm ready — write CONTEXT.md"

## Claude's Discretion

The following implementation choices were explicitly delegated to planner judgment in CONTEXT.md:
- D-G7.1 fastembed engine choice (Python via Docker container vs TS port) — "planner picks based on what's least painful cross-repo."
- D-G2.2 km-core registry extension (if OKM-specific accessors like `getLoadedDomains()` missing) — pre-req plan against km-core if needed.
- OKM-specific `EntityProvenance` / `ResolutionRecord` mapping granularity — planner picks how much absorbs into km-core canonical fields vs stays on metadata.

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. Highlights:
- Pipeline framework convergence onto Phase 40 — post-v7.1.
- Qdrant deployment for OKM — Phase 44 or later, when sub-ms vector search needed.
- /api/km common REST router exposure — Phase 44.
- VOKB feature work / unified viewer — Phase 45.
- A's parallel-path asymmetry (Phase 41) decision — still deferred from Phase 42; pre-Phase-44.
- Pipeline framework convergence + OKM-specific concerns (PII / governance / sourceAuthority) as configurable hooks in km-core — post-v7.1.

## Reviewed Todos (not folded)

- `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` (score 0.6) — A-system observability; unrelated to C.
- `2026-05-23-orphan-digest-observation-refs.md` (score 0.4) — A-system data-integrity; already deferred from Phase 42.
