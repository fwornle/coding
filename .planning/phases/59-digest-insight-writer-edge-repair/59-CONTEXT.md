# Phase 59: Digest / Insight Writer-Edge Repair & Orphan-Floor Maintenance — Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Newly-inserted `Digest` entities land in the live km-core graph as **zero-degree nodes** because the consolidator writes the entity (`ObservationConsolidator.js:1293-1296`) but never follows with `kmStore.addRelation` calls — `metadata.observation_ids` is recorded as a JSON array but no graph edges materialize. The same class of bug occasionally affects `Insight` entities via a `findByLegacyId`-after-`writeInsight` race at OC.js:660-661 (1-in-100 orphan rate observed on 2026-06-15).

Phase 59 closes both writer paths plus a one-shot repair for the 7 baseline orphan Digests + 1 orphan Insight observed at 2026-06-15 21:46. The repair script ALSO sweeps the 8 historic dangling Digest→Observation refs in `.data/observation-export/digests.json` (folded from `2026-05-23-orphan-digest-observation-refs.md`).

**Two related delivery surfaces:**

1. **Writer-path emission** — `ObservationConsolidator._executeDigestStage` emits N `derivedFrom` edges per Digest in the same microtask as `putEntity`; `ObservationWriter.writeInsight` returns the minted km-core id directly so the consolidator's downstream `has_insight` follower can never miss it.
2. **One-shot repair** — `scripts/repair-orphan-digest-insight-edges.mjs` walks `/api/v1/graph/orphans`, reads `metadata.observation_ids` / `metadata.digest_ids`, emits the missing `derivedFrom` / `synthesizedFrom` / `has_insight` edges. Idempotent. Same pass cleans `.data/observation-export/digests.json` of the 8 dangling refs.

**Out of scope for Phase 59 (deliberately deferred):**
- Adding `Digest -[has_digest]-> Project` anchor edges or `Digest -[capturedBy]-> LiveLoggingSystem` provenance edges. The minimum needed to close orphan status is one `derivedFrom` edge per Digest; UI/hierarchy edges for Digests are a separate scope question.
- Re-classifying historic Digests/Insights through the LLM `mentions` classifier (that's Phase 58's territory and already ran).
- Refactoring the `derivedFrom` semantics elsewhere in the codebase — `observation-generation-agent.ts:1396` already uses `derivedFrom`; Phase 59 reuses that vocabulary as-is.
- ORPHAN-01..04 from the original Phase 59 scope — closed-upstream / met-upstream per `59-DOWNSCOPE-MEMO.md` (committed 8bd33814d on 2026-06-15).
- Subsystem tagging (`metadata.subsystem='online-consolidator'`) on Digest/Insight inserts — Phase 61 (LSLTIME-03) consumer.

</domain>

<decisions>
## Implementation Decisions

### G1 — Edge vocabulary

- **D-01:** Two new edge types ship in Phase 59:
  - `Digest -[derivedFrom]-> Observation` — one per id in `row.observation_ids` at `OC.js:1279`. Reuses the existing `derivedFrom` vocabulary at `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts:1396` so km-core's edge-type registry stays consistent.
  - `Insight -[synthesizedFrom]-> Digest` — one per id in `metadata.digest_ids` at `OC.js:1414`. Distinct from `derivedFrom` because the semantic relationship differs (a Digest summarizes its source observations; an Insight synthesizes across many Digests — different rhetorical operation, different traversal semantics for any future viewer filter).
- **D-01.1:** Both types are **distinct from Phase 58's `mentions`**. `mentions` is reserved for Insight→Component/SubComponent/Detail content edges. Lineage and content edges share neither vocabulary nor traversal semantics.

### G2 — Atomicity contract for Digest writer

- **D-02:** **Mirror Phase 58 D-04 verbatim** for the Digest writer at `OC.js:1293-1296`:
  1. `kmStore.putEntity(digestEntity, {skipOntologyCheck: true})` — existing call.
  2. **NEW:** Synchronous `for (const obsId of row.observation_ids) await kmStore.addRelation({from: digestId, to: <resolved obsEntityId>, type: 'derivedFrom', metadata: {...}})`. Same microtask as `putEntity`, no awaits between calls beyond what km-core requires.
  3. On any `addRelation` failure: log via `process.stderr.write` and continue the loop. The km-core JSON-export tick (5s debounce) captures node + whichever edges landed. Acceptable because Digest lineage is best-effort — a missing edge is the bug we're closing, not data loss.
- **D-02.1:** **Writer path does NOT probe-before-write.** Digest stage 1 dedupes upstream at `OC.js:1198-1245` (`_buildDigestMergePlan` returns `{action: 'merge', targetId: ...}` for already-seen digests), so `_executeDigestStage` only runs the `putEntity`+`addRelation*N` block for genuinely new Digests. No double-insert risk on the normal path. The **repair script (D-05)** DOES probe before each `addRelation` for idempotency.
- **D-02.2:** **Observation id resolution** — `row.observation_ids` carries legacy uuid strings. The writer must `kmStore.findByLegacyId({system:'A', id: obsId})` to recover the minted Observation km-core id BEFORE calling `addRelation` (km-core ids are not the legacy uuids). If an Observation is not yet persisted at consolidation time, that single edge is skipped (logged), but the Digest still lands with its remaining edges — the missing edge is picked up by the next repair-script run.

### G3 — Insight `has_insight` follower hardening

- **D-03:** **Refactor `ObservationWriter.writeInsight` to return `{legacyId, mintedId}`.** Current signature returns only `row.id` (the legacyId). The consolidator at `OC.js:660-661` then has to re-derive the minted km-core id via `kmStore.findByLegacyId` — that lookup races against km-core's in-memory hydration and can return null, which silently disables the entire `has_insight` block at `:679-705`. Returning the minted id from the writer (which already has it in scope as the return of its internal `kmStore.putEntity`) eliminates the race at its root.
- **D-03.1:** **Call-site update is mechanical.** `grep -rn "writeInsight(" src/ scripts/ integrations/` to enumerate (expect 2–3 sites: ObservationConsolidator + any test harness). All sites either ignore the return value (no change needed) or use `row.id` (rename to `result.legacyId`).
- **D-03.2:** **The `has_insight` block at OC.js:679-705 stays as-is** (probe-then-write). Its purpose changes from "race-safe lookup" to "idempotent re-write protection" — the probe is now belt-and-suspenders against re-running the consolidator on the same Insight, not the primary correctness mechanism.

### G4 — ORPHAN-FLOOR measurement (sustained 24h)

- **D-04:** **Ad-hoc polling script + operator runs once at milestone close.** New `scripts/poll-orphan-floor-soak.mjs`:
  - Curls `http://localhost:3848/api/v1/stats` hourly for 24 samples.
  - Writes each sample's `{timestamp, orphanCount, nodeCount, connectivity}` to `.data/orphan-floor-soak-<ISO-ts>.json`.
  - Asserts `max(orphanCount) ≤ 10` across all samples; exits non-zero on any sample exceeding the threshold.
  - Operator runs at milestone close, log retained in `.data/` as SC#4 evidence, then the script is deleted (one-shot, not permanent infra).
- **D-04.1:** **No permanent launchd daemon, no dashboard widget.** Out of scope for an orphan-fix phase. If long-term observability becomes a requirement, file a separate phase (probably alongside Phase 60's dashboard work).

### G5 — One-shot repair script

- **D-05:** **`scripts/repair-orphan-digest-insight-edges.mjs` is two-layer** (graph + cold-store):
  - **Layer 1 (km-core graph):** GET `http://localhost:3848/api/v1/graph/orphans`. For each orphan entity:
    - If `entityType === 'Digest'`: read `metadata.observation_ids`, `findByLegacyId` each, `addRelation('derivedFrom')` with **probe-before-write** (`findRelations({from, to, type})` returns empty → emit; else skip).
    - If `entityType === 'Insight'`: read `metadata.digest_ids`, `addRelation('synthesizedFrom')` with probe-before-write; ALSO re-emit `has_insight` from the team's Project anchor with the existing probe pattern at `OC.js:684-690`.
    - If `entityType === 'Observation'` or anything else: skip (out of scope for this script — log a warning).
  - **Layer 2 (cold-store JSON):** read `.data/observation-export/digests.json`, identify entries whose `obs_ids[]` contains uuids not present in `.data/observation-export/observations.json`, drop the dangling refs, re-write the digests.json atomically (tmp-then-rename). Idempotent (a second run sees zero dangling refs).
  - Single CLI: `node scripts/repair-orphan-digest-insight-edges.mjs [--dry-run] [--layer=graph|cold-store|both]`. Default both.
  - Output: per-entity `{layer, entityId, edgesAdded, dangling_refs_dropped, errors[]}` + aggregate counts to stdout. Operator spot-checks.
- **D-05.1:** **Folded todo** `2026-05-23-orphan-digest-observation-refs.md` is closed by Layer 2 of this script (drops the 8 documented dangling refs + any others that accumulated since 2026-05-23). Per the todo's "Remediation options" §, the chosen flavor is option 3 (export-time scrub), one-shot rather than continuous, applied as a phase-execution side effect rather than a permanent retention hook.
- **D-05.2:** **The script does NOT add `capturedBy` edges as belt-and-suspenders.** `writeInsight`'s existing `_anchorEntity` call (post-Phase 58, post-commit 955617a1a retry fix) handles `capturedBy`. If the repair script encounters an Insight without `capturedBy`, it logs a warning but does NOT emit the edge — that's a writer-side concern and adding belt-and-suspenders here invites drift between the two paths.

### Claude's Discretion

- **Exact LLM-free implementation of D-05's resolution loop** — the repair script doesn't need an LLM (it's reading existing metadata). Planner decides whether to batch the `findByLegacyId` lookups (km-core may not have a batch primitive — verify against `lib/km-core/src/api/handlers/query.ts` surface) or run them sequentially.
- **Writer-side `derivedFrom` edge metadata payload** — planner picks the shape (probably `{source: 'observation-consolidator', confidence: 1.0, addedAt: now}` mirroring the `has_insight` shape at `OC.js:694-698`).
- **Soak-script transport** — planner picks `curl` via `child_process.execSync` or native `fetch`. Either acceptable. Lean fetch (km-core server is on localhost, no proxy concerns).
- **Test surface** — at minimum: 1 unit test for the Digest writer's `addRelation` loop given a fixture observation set; 1 integration test that the repair script is idempotent; 1 integration test for the writer-signature change. Planner refines.
- **Whether to keep `metadata.observation_ids` / `metadata.digest_ids` as denormalized cache** after edges land — keep them (no migration risk, they're already in the entity payloads, future readers may rely on them). Planner does NOT strip them.

### Folded Todos

- **`2026-05-23-orphan-digest-observation-refs.md`** (`area: observability / data-integrity`). The original problem: 8 Digests reference Observations missing from both `.data/observation-export/observations.json` and `.observations/observations.db`, surfaced by `reprojectFromOnlineStore` on the cold-store. Phase 58 explicitly deferred per its CONTEXT.md `<deferred>`. Folded into Phase 59 as **D-05 Layer 2**: the same repair script that fixes km-core graph orphans also scrubs `.data/observation-export/digests.json` of dangling `obs_ids[]` refs. Single tool, two layers. Resolution flavor: option 3 from the todo (export-time scrub), applied one-shot rather than as a permanent retention hook.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase boundary + scope

- `.planning/ROADMAP.md` (Phase 59 entry, line 1087) — downscoped 2026-06-15 to Digest/Insight writer-edge repair. Goal, depends-on, success criteria.
- `.planning/REQUIREMENTS.md` (§"Digest/Insight writer-edge repair (ORPHAN-DIG / ORPHAN-INS / ORPHAN-FLOOR)") — exact acceptance language for ORPHAN-DIG-01, ORPHAN-DIG-02, ORPHAN-INS-01, ORPHAN-FLOOR. ORPHAN-01..04 marked Closed-upstream / Met-upstream with on-disk evidence.
- `.planning/phases/59-digest-insight-writer-edge-repair/59-DOWNSCOPE-MEMO.md` — the full reality-check evidence (live `/api/v1/stats`, 7-orphan inventory, root-cause probe at OC.js:1293-1296 and :677-694), explains WHY this phase looks the way it does.

### Prior phases this depends on

- `.planning/phases/58-online-pipeline-semantic-edges-on-insights/58-CONTEXT.md` — Phase 58 established the writer-path refactor (D-06: route Insights through `ObservationWriter.writeInsight`), the atomicity contract (D-04: same-microtask `putEntity` + `addRelation*N`), and ships the `mentions` edge type that Phase 59's vocabulary (`derivedFrom`, `synthesizedFrom`) is deliberately distinct from. **MUST read before planning** — most of Phase 59's atomicity decision (D-02) is "do what Phase 58 already locked in, but for Digests."
- `.planning/phases/57-lower-ontology-project-tagging-foundation/57-CONTEXT.md` — Phase 57 introduced `metadata.project='coding'` stamping on all entities and the per-team Project anchors that the `has_insight` follower at OC.js:679-705 reads. Phase 59 doesn't change this surface but the repair script's `has_insight` re-emission reads it.
- `.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md` — folded as D-05 Layer 2. The 8 sample dangling refs in its table are the seed set the repair script's Layer 2 must close.

### Code surfaces in scope

- `src/live-logging/ObservationConsolidator.js` (~174 KB) — the consolidator hot path. Relevant sections:
  - `_executeDigestStage` (~line 1149-1320) — Digest stage 1 (parsing → insert). **Writer-fix target** per D-02: add the `addRelation('derivedFrom')` loop at line ~1294-1296.
  - `_buildDigestMergePlan` (~line 945-1000) — upstream dedup; informs D-02.1 (no probe-before-write needed on the normal path).
  - `_pushInsightToKG` (~line 577-706) — Insight write path; consumer of `writeInsight`'s new return signature per D-03.
  - `has_insight` follower (~line 679-705) — stays as-is, but its role shifts from "race-safe lookup" to "idempotent re-write protection" per D-03.2.
  - `bridgeRemainingOrphans` (~line 1903-1925) — Phase 58 D-06.2 extension target; Phase 59 does NOT extend it further (D-03 eliminates the race at the writer; bridge stays narrowly scoped to legacy paths).
- `src/live-logging/ObservationWriter.js` (~70 KB) — the durable writer.
  - `writeInsight` (~line 1165) — **signature-refactor target** per D-03. Currently returns `row.id` (legacyId); change to `{legacyId, mintedId}`. The mintedId is already in scope inside the function (return of internal `kmStore.putEntity`).
  - `_resolveAnchorId` (line 380) — patched 2026-06-15 (commit 955617a1a) to retry on every call. **Not modified by Phase 59**, but the repair script's D-05.2 explicitly defers `capturedBy` belt-and-suspenders to this writer-side fix.
  - `_anchorEntity` (line 412) — the existing `addRelation('capturedBy')` writer; the new `derivedFrom` writer at OC.js follows the same `addRelation` shape (metadata payload pattern).
- `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts:1396-1397` — existing `relationType: 'derivedFrom'` usage. D-01 reuses this exact string literal.

### km-core surfaces

- `lib/km-core/src/api/handlers/query.ts:222-288` — `/stats` handler defining `orphanCount` as `graph.degree(id) === 0`. SC#4's measurement reads this endpoint.
- `lib/km-core/src/api/handlers/query.ts:403+` — `/graph/orphans` handler. The repair script's Layer 1 input.
- `lib/km-core/src/store/persistence.ts` — the 2026-06-15 hydrate-prefer-JSON patch (commit e8312e35e + submodule 76ffd18) is load-bearing. The Phase 59 repair script AND the 24h soak BOTH require the patch in place; obs-api restarts during execution will trip the same regression otherwise.
- `lib/km-core/src/store/GraphKMStore.ts` — `putEntity`, `addRelation`, `findRelations`, `findByLegacyId` APIs. Planner verifies whether `addRelation` is idempotent on `(from, to, type)` or whether the repair script must dedup in-process (D-05's probe-before-write is the defensive answer either way).
- `integrations/mcp-server-semantic-analysis/src/sse-server.ts:46-103` — km-core REST mount at port 3848 (the endpoint the repair script + soak harness curl).

### Operational invariants (CLAUDE.md)

- `./CLAUDE.md` — full project rules. Especially:
  - **km-core node_modules patch** — same hydrate-prefer-JSON note as above; reapply manually after `npm install` until upstream km-core fixes `persistGraph` to debounce on every mutation.
  - **launchd-managed daemons** — `com.coding.obs-api` runs the consolidator. The repair script and soak harness both read from `:3848/api/v1` while obs-api is live — no daemon stops needed (unlike Phase 57's backfill which needed `launchctl bootout` to release the LevelDB lock).
  - **Constraint violations** — `no-console-log` applies to .js edits. Writer edits at OC.js use `process.stderr.write` for the existing failure logs; Phase 59's new logging follows suit.
  - **Submodule rebuild rule** — Phase 59 touches `src/live-logging/` (host-side, not bind-mounted, no docker rebuild). `lib/km-core` is NOT modified by Phase 59 (D-03's writer-signature change is in the host-side wrapper, not km-core itself).

### Cold-store surfaces (folded D-05.1)

- `.data/observation-export/digests.json` — cold-store Digest JSON. D-05 Layer 2's scrub target.
- `.data/observation-export/observations.json` — cold-store Observation JSON. The reference set the scrub validates against.
- `docs/puml/obs-retention-flow.puml` — documents that `.data/observation-export/*.json` IS the cold-store (no separate retention tier). Confirms the 8 dangling refs are genuinely gone from both tiers and the scrub doesn't have to look elsewhere.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`has_insight` probe pattern at `OC.js:684-690`** — the repair script (D-05 Layer 1) reuses this `findRelations({from, to, type})` → conditional `addRelation` shape for every edge it emits. The pattern is correct under km-core's "addRelation is NOT idempotent on `(from, to, type)`" constraint per Phase 58 D-04 note + the comment at `OC.js:677-678`.
- **`writeInsight`'s internal `_anchorEntity` call** — already lands `capturedBy` in the same microtask as `putEntity`. D-02 applies the exact same pattern (sync `addRelation` after `putEntity`) to Digests — no new infrastructure, just one more loop.
- **Phase 57-05's backfill script convention** — per-entity log to `.data/backfill-*.json` with `{entityId, name, edgesAdded, errors[]}`. D-05 reuses this convention for the repair script output.
- **`scripts/backfill-raw-observations.mjs:40,95`** — canonical host-side LLM proxy client. Phase 59 does NOT need LLM calls (this is metadata-only repair), but the file's `node`-style HTTP client + log format are reusable patterns for the repair script and soak harness.

### Established Patterns

- **Atomicity = same-microtask `putEntity` + `addRelation*N`** (Phase 58 D-04). km-core's 5s JSON-export debounce captures node + edges together. NOT a transaction primitive — relies on JS microtask scheduling. Phase 59 inherits this pattern verbatim for Digests.
- **Probe-before-write for repair scripts, not for writer paths** (D-02.1) — writer paths dedup upstream (Digest stage 1 at OC.js:1198-1245 / Insight write-once semantics); repair scripts re-run by definition and must be idempotent against the existing graph state.
- **Repair-script side effect over permanent retention hook** (D-05.1 vs the todo's option 3 vs option 1/2) — one-shot scripts that the operator runs are preferred over continuous janitors in this codebase. Lower failure surface; cleaner archaeology.
- **No belt-and-suspenders across writer paths** (D-05.2) — if `capturedBy` is broken, fix `_resolveAnchorId`; don't have the repair script paper over it. Each surface owns its correctness.

### Integration Points

- **`/api/v1/graph/orphans` endpoint** — the repair script's single source of truth for "what needs repair." If the endpoint's definition (currently `graph.degree(id) === 0`) ever expands to "nodes missing expected edge types," the repair script must adapt.
- **`/api/v1/stats` endpoint** — the soak harness's single source of truth for SC#4. Same definition.
- **`row.observation_ids` JSON field** — the writer + repair script both read this. Stays as a denormalized cache after edges land (per Claude's Discretion above) — readers can choose to traverse edges or read metadata; both produce the same answer once edges are wired.
- **Project-anchor lookup at OC.js:681-682** — repair script reads `findByOntologyClass('Project')` and matches by `name === projectName` for the `has_insight` re-emission. Stays consistent with the writer path.

</code_context>

<specifics>
## Specific Ideas

- **The reality-check evidence in `59-DOWNSCOPE-MEMO.md` is the seed dataset** — the 7 orphans listed there (6 Digests + 1 Insight, all timestamped 2026-06-15) are exactly what the repair script's first run must clean up. SC#2's acceptance is "those 7 → 0 after one repair-script run."
- **The 1-in-100 orphan Insight pattern** — the orphan `Live Backfill Pre-flight Procedure and Wave-Analysis Routing` is the smoking gun for D-03. After the `writeInsight` signature change, a deliberate test that triggers the race (mock `findByLegacyId` to return null) must produce zero orphans — proves D-03 closes the path at the root.
- **`derivedFrom` is reused, not renamed** — `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts:1396` already uses this exact string. Phase 59's writer + repair script use the same literal. Future renaming (e.g., to `summarizes`) is a vocabulary-harmonization phase, not Phase 59.

</specifics>

<deferred>
## Deferred Ideas

- **`Digest -[has_digest]-> Project` anchor edges** — would give Digests hierarchy alongside Insights' `has_insight`. Not needed for the orphan fix (one `derivedFrom` is enough). Add when a viewer filter or traversal query needs to walk Project→Digest directly. Probably Phase 60+.
- **`Digest -[capturedBy]-> LiveLoggingSystem` provenance edges** — same shape as Insights' `capturedBy`. Same deferral logic: not needed for orphan-fix, would belt-and-suspenders the same anchor LiveLoggingSystem already provides at the Insight level.
- **Permanent orphan-count observability** — launchd daemon, dashboard widget, alert thresholds. D-04 ships a one-shot soak harness; long-term observability is Phase 60+ if a consumer surfaces.
- **Renaming `metadata.observation_ids` → `metadata.derivedFromIds`** (or similar vocabulary harmonization between metadata field names and edge types). Drift between the two is real but acceptable for now; harmonization is its own phase.
- **Stripping `metadata.observation_ids` / `metadata.digest_ids` once edges land** — the denormalized cache is harmless and may have consumers that haven't been audited. Don't strip in Phase 59; revisit if a future schema audit identifies them as dead.
- **Extending `bridgeRemainingOrphans`** further (Phase 58 D-06.2 already extended it). D-03 eliminates the writer-side race so `bridgeRemainingOrphans` doesn't need a new sweep dimension. If a future writer regression introduces new orphan classes, extend then.
- **LLM-based content classification for Digests** (mirroring Phase 58 D-02 for Insights). Out of scope — Digests have explicit `observation_ids` references in their structured input, no semantic-classification needed.
- **Re-classifying historic Digests/Insights through Phase 58's `mentions` classifier on a per-edge basis** — Phase 58 already ran the backfill across all 96 Insights. New Insights pick up `mentions` at write-time via Phase 58's path. Phase 59 doesn't re-run this.

### Reviewed Todos (not folded)

- **`2026-03-10-replace-console-log-with-proper-logging.md`** — keyword match (`logging`, `scripts`), not semantic. Phase 59's new log lines follow the existing `process.stderr.write` convention; the broader logging-refactor todo is its own scope.
- **`2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md`** — keyword match. Phase 59's repair script + soak harness read from a live obs-api, but don't restart it; the SIGTERM crash is orthogonal. Stays open.
- **OKM Express ↔ unified-viewer API contract mismatch** — Phase 61 (OKBROUTE-01/02). Not Phase 59.
- **Sub-agent observations from worktree-isolated `Agent()` calls don't reach dashboard** — Phase 51 territory.
- **LSL timeline strip silently truncates history** — Phase 61 (LSLTIME-01/02).
- **Online learning-source filter hides CollectiveKnowledge** — Phase 60.
- **VKB Evidence/Pattern filter asymmetry + ontology cross-domain bleed** — Phase 60.
- **VKB sidebar LEGEND is static** — Phase 60.
- **VKB graph displays Observation + Digest entities (architecture bleed)** — Phase 60 (VKBUI-03). Note: Phase 60 hiding Observation/Digest by default does NOT eliminate Phase 59's writer-edge requirement; the entities still exist in km-core and still need their lineage edges regardless of viewer visibility.

</deferred>

---

*Phase: 59-digest-insight-writer-edge-repair*
*Context gathered: 2026-06-15*
