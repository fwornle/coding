# Phase 59: Digest / Insight Writer-Edge Repair & Orphan-Floor Maintenance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 59-digest-insight-writer-edge-repair
**Areas discussed:** Folded-todo decision, Edge vocabulary, Atomicity strategy, `has_insight` follower hardening, ORPHAN-FLOOR measurement contract

---

## Folded-todo decision

| Option | Description | Selected |
|--------|-------------|----------|
| Fold — repair script handles both | Phase 59's one-shot repair script (ORPHAN-DIG-02) ALSO cleans up the 8 historic dangling refs in `.data/observation-export/digests.json` documented in `2026-05-23-orphan-digest-observation-refs.md`. Same class of bug, different layer. | ✓ |
| Defer — out of Phase 59 scope | Keep Phase 59 focused on km-core GRAPH edges only. Different layer + different root cause. | |

**User's choice:** Fold — repair script handles both
**Notes:** Captured as D-05.1; the repair script becomes two-layer (graph + cold-store JSON scrub).

---

## Edge vocabulary

| Option | Description | Selected |
|--------|-------------|----------|
| `derivedFrom` + `synthesizedFrom` (Recommended) | Two new edge types: `Digest -[derivedFrom]-> Observation` (matches existing `observation-generation-agent.ts:1396` usage + `metadata.observation_ids` semantics); `Insight -[synthesizedFrom]-> Digest` (matches `metadata.digest_ids` synthesis semantics). | ✓ |
| Reuse `derivedFrom` for both directions | Single type for all lineage. Simpler but loses synthesis-vs-summary distinction. | |
| Reuse Phase 58's `mentions` | Smallest vocabulary surface, but conflates content references with lineage. | |
| You decide — planner picks during research | Defer to gsd-phase-researcher based on km-core's edge-type registry. | |

**User's choice:** `derivedFrom` + `synthesizedFrom`
**Notes:** Two distinct types let viewer filters separate lineage from content (Phase 58's `mentions`). `derivedFrom` literal already exists at `observation-generation-agent.ts:1396` — no new vocabulary churn.

---

## Atomicity strategy for Digest writer

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Phase 58 D-04 — log-and-continue, lives within 5s debounce (Recommended) | Synchronous `for` loop of `addRelation` calls after `putEntity`, same microtask, no awaits. Failures logged, loop continues. 5s JSON-export debounce captures node + landed edges. | ✓ |
| Fail-fast — if any addRelation throws, delete the Digest | Wrap putEntity+addRelation loop in try-catch, rollback via `kmStore.deleteEntity` on failure. Requires verifying delete primitive exists. | |
| Pre-flight — verify all observations exist BEFORE putEntity | Walk `row.observation_ids` first, skip Digest if any observation missing. Stronger guarantee but adds N lookups per insert. | |
| You decide — planner picks based on km-core surface | Capture only SC#1; planner picks based on actual failure modes. | |

**User's choice:** Mirror Phase 58 D-04
**Notes:** Inheriting Phase 58's atomicity pattern verbatim — same microtask `putEntity` + `addRelation*N`, same 5s debounce. Captured as D-02. Implied D-02.1: writer path does NOT probe (upstream dedup at OC.js:1198-1245); repair script DOES probe. D-02.2 added for observation-id resolution via `findByLegacyId`.

---

## `has_insight` follower hardening (the 1-in-100 orphan Insight)

| Option | Description | Selected |
|--------|-------------|----------|
| Refactor `writeInsight` to return the minted km-core id (Recommended) | Change return shape to `{legacyId, mintedId}`. Eliminates the `findByLegacyId` race at OC.js:660-661 at its root. Writer already has the minted id in scope. | ✓ |
| Bounded retry on `findByLegacyId` | Wrap lookup in 3× retry with backoff. Treats symptom, doesn't eliminate race. | |
| Audit-and-repair extension to `bridgeRemainingOrphans` | Periodic recovery sweep per Phase 58 D-06.2. Doesn't prevent race but bounds the window. | |
| Combo — refactor return signature + audit-and-repair sweep | Belt-and-suspenders. | |

**User's choice:** Refactor `writeInsight` to return the minted km-core id
**Notes:** Root-cause fix preferred over symptom-treatment or compensating sweep. Captured as D-03. D-03.1 specifies call-site update is mechanical (grep `writeInsight(` → expect 2-3 sites). D-03.2 keeps the existing `has_insight` probe-then-write block as belt-and-suspenders for re-runs (its role shifts from race-safe lookup to idempotent re-write protection).

---

## ORPHAN-FLOOR measurement contract

| Option | Description | Selected |
|--------|-------------|----------|
| Ad-hoc polling script + operator runs it once (Recommended) | `scripts/poll-orphan-floor-soak.mjs` curls `/api/v1/stats` hourly for 24h, writes samples to `.data/orphan-floor-soak-<ts>.json`, asserts max ≤ 10 on exit. Self-contained, no permanent infra. | ✓ |
| Permanent launchd-managed hourly check | `com.coding.orphan-floor-check` daemon. Long-term observability but adds maintenance surface. | |
| Dashboard widget on system-health page | Visual confirmation + long-term surface, but pulls in frontend work. | |
| Operator manually checks at start + end | Cheapest but only catches start/end, misses sustained-window failures (spike at hour-12 that recovers by hour-24 would slip through). | |

**User's choice:** Ad-hoc polling script + operator runs it once
**Notes:** Captured as D-04 + D-04.1. One-shot harness, log retained as SC#4 evidence, script deleted after milestone close. Long-term observability deferred to a future phase (probably alongside Phase 60's dashboard work).

---

## Claude's Discretion

- Exact LLM-free implementation of D-05's resolution loop — repair script doesn't need an LLM; planner decides batch vs sequential `findByLegacyId` lookups based on whether km-core has a batch primitive.
- Writer-side `derivedFrom` edge metadata payload shape — planner mirrors the `has_insight` payload at `OC.js:694-698`.
- Soak-script transport — `curl` via `child_process.execSync` or native `fetch`. Either acceptable.
- Test surface — minimums specified; planner refines.
- Whether to strip `metadata.observation_ids` / `metadata.digest_ids` once edges land — keep as denormalized cache; don't strip.

## Deferred Ideas

- `Digest -[has_digest]-> Project` anchor edges — defer until viewer/traversal consumer surfaces.
- `Digest -[capturedBy]-> LiveLoggingSystem` provenance edges — same deferral logic.
- Permanent orphan-count observability (launchd daemon / dashboard widget / alert thresholds).
- Renaming `metadata.observation_ids` → `metadata.derivedFromIds` (vocabulary harmonization).
- Stripping `metadata.*_ids` denormalized cache once edges land.
- Extending `bridgeRemainingOrphans` further (Phase 58 D-06.2 already extended it; D-03 eliminates the race upstream).
- LLM-based content classification for Digests (Digests have explicit structured input, no classification needed).
- Re-running Phase 58's `mentions` classifier on historic Insights (Phase 58 already backfilled).
