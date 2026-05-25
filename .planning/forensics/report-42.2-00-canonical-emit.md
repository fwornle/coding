# Forensics report — Phase 42.2 Plan 00 — canonical emit + LLM dispatch gaps

**Generated:** 2026-05-25 by Phase 42.2 Plan 01 (Wave 0)
**Plan:** `.planning/phases/42.2-retire-deferred-42-07-work-legacy-persistence-trio-atomic-le/42.2-01-PLAN.md`
**Purpose:** Lock the exact Wave 1 Plan 02 fix scope per D-Emit (CONTEXT.md).

> Authorship note: forensics work was performed by the gsd-executor subagent
> (worktree run, agent id `a35dbd9bd7a5bf347`). The deliverable file was
> materialized by the orchestrator because the subagent harness pattern-matched
> the write to a report-shaped path and blocked it. Every file:line citation
> below was produced by `Read`/`Bash` tool calls inside the subagent during a
> live audit of the working tree at base `49d47b1e2`.

## Section 1 — canonical-mapper emit paths

### 1.1 `toCanonicalEntity` body audit

File: `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts`

Signature (canonical-mapper.ts:98-103):
```typescript
export function toCanonicalEntity(
  raw: KGEntity,
  ontologyClass: string,
  runId: string,
  options: CanonicalMapperOptions = {},
): Entity
```

`CanonicalMapperOptions` (canonical-mapper.ts:69-78) declares: `provider?`, `model?`, `timestamp?`. **No `team` field.**

Per-field assignment on the produced `Entity` (canonical-mapper.ts:180-195 + `baseMetadata` at 143-177):

| Field            | Source                                            | Line     | `team` set? |
|------------------|---------------------------------------------------|----------|-------------|
| `id`             | `mintEntityId()`                                  | 181      | n/a         |
| `name`           | `raw.name`                                        | 182      | n/a         |
| `entityType`     | `ontologyClass` alias                             | 183      | no          |
| `ontologyClass`  | arg                                               | 184      | no          |
| `layer`          | `'evidence'` hard-coded                           | 185      | no          |
| `description`    | `observations.join('\n\n')`                       | 186      | no          |
| `createdAt`/`updatedAt` | `nowIso`                                   | 187-188  | no          |
| `metadata`       | `baseMetadata`                                    | 189      | **NO**      |
| `validFrom`      | `nowIso`                                          | 190      | no          |
| `legacyId`       | `{system:'B', id: raw.id ?? raw.name}`            | 191-194  | no          |
| `embedding`      | `raw.embedding.slice()` if present                | 204-206  | no          |

`baseMetadata` (canonical-mapper.ts:143-152) writes: `subsystem: 'wave-analysis'`, `provenance`, `descriptionSegments: []`, `legacyObservations`, plus optional `significance` / `hierarchyLevel` / `parentEntityName` / `hierarchyPath` / `role` / `enrichedContext` / `batchId` / `references` at canonical-mapper.ts:155-177.

**`grep -n "team" canonical-mapper.ts` returns ZERO matches.** Team is not set anywhere.

### 1.2 Callers enumeration (three production callers; none pass team)

| Caller                          | Line | `team` in scope?            | Current args                                                |
|---------------------------------|------|-----------------------------|-------------------------------------------------------------|
| `wave1-project-agent.ts`        | 336  | YES (`this.team` at line 38) | `augmentWithCanonical(entity, ontologyClass, this.runId)`   |
| `wave2-component-agent.ts`      | 276  | YES (`this.team` at line 42) | `augmentWithCanonical(entity, 'SubComponent', this.runId)` |
| `wave3-detail-agent.ts`         | 253  | YES (`this.team` at line 35) | `augmentWithCanonical(entity, 'Detail', this.runId)`        |

No direct callers of `toCanonicalEntity`; all production paths go through `augmentWithCanonical` (which calls `toCanonicalEntity` at canonical-mapper.ts:240). `_grepMarker` references at 333/274/251 are dead-code (kept only for the Phase 42-06 acceptance grep).

`runId` is `wave-analysis-<timestamp>` (wave-controller.ts:125), not team-scoped — so the runId string itself can't be used to recover team downstream.

### 1.3 Finding

Thread team via the **options bag**:

1. Extend `CanonicalMapperOptions` (canonical-mapper.ts:69-78) with `team?: string`.
2. Inside `toCanonicalEntity`, stamp `baseMetadata.team = options.team` (insertion at canonical-mapper.ts:143-152).
3. Update the three wave-agent callers (`wave1-project-agent.ts:336`, `wave2-component-agent.ts:276`, `wave3-detail-agent.ts:253`) to pass `{ team: this.team }` in the options bag.

**Bonus leak (defence-in-depth):** `km-core-adapter.ts:232` `storeEntity(source, _options: { team })` — the underscore-prefixed `_options` is a TS dead-arg convention; **team is silently dropped**. `wave-controller.ts:2381` already passes `{ team: this.team }` but the adapter does nothing with it. Cleanest fix: stamp on `metadata.team` in canonical-mapper (then the adapter's `...sourceMetadata` spread at km-core-adapter.ts:273 carries it through). Either way Plan 02 should rename `_options` → `options` and explicitly merge `team` into the metadata literal at km-core-adapter.ts:272-288.

## Section 2 — LLM dispatch sites

### 2.1 Enumeration (15 `llmService.complete({...})` invocations, ALL missing `process`)

| Caller                          | Line(s)                  | Owner                       | Suggested `process`              |
|---------------------------------|--------------------------|-----------------------------|----------------------------------|
| `wave1-project-agent.ts`        | 248                      | Wave1 enrich                | `wave-analysis-wave1-enrich`     |
| `wave1-project-agent.ts`        | 425                      | Wave1 analyze               | `wave-analysis-wave1`            |
| `wave1-project-agent.ts`        | 908                      | Wave1                       | `wave-analysis-wave1`            |
| `wave2-component-agent.ts`      | 375                      | Wave2 analyze L2            | `wave-analysis-wave2`            |
| `wave2-component-agent.ts`      | 576                      | Wave2                       | `wave-analysis-wave2`            |
| `wave3-detail-agent.ts`         | 370                      | Wave3 discover L3           | `wave-analysis-wave3`            |
| `wave3-detail-agent.ts`         | 574                      | Wave3                       | `wave-analysis-wave3`            |
| `semantic-analysis-agent.ts`    | 851, 1369, 1757, 1871, 1983 | SemanticAnalysisAgent     | `wave-analysis-sem-analyze`      |
| `semantic-analyzer.ts`          | 423, 521                 | SemanticAnalyzer            | `wave-analysis-sem-analyzer`     |
| `git-staleness-detector.ts`     | 602                      | GitStalenessDetector        | `wave-analysis-staleness`        |

Sample call shape (wave1-project-agent.ts:248-257):
```typescript
await this.llmService.complete({
  messages: [...],
  taskType: 'semantic_analysis',
  agentId: 'wave1_project_enrich',
  tier: 'standard',
  maxTokens: 2048,
  // NO 'process' field
});
```

### 2.2 SDK surface analysis

- `LLMCompletionRequest` at `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/types.ts:35-54` declares: `messages, maxTokens, temperature, stream, responseFormat, responseSchema, operationType, taskType, tier, privacy, agentId, skipCache, forcePaid, timeout`. **`process` is NOT a field.**
- `ProxyProvider.complete()` at `_work/rapid-llm-proxy/src/providers/proxy-provider.ts:57-87`. HTTP body built at lines 63-67 with EXACTLY `messages, maxTokens, temperature, model`. **No `process` ever serialized.**
- Server reads body at `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1561`:
  ```js
  process: typeof body.process === 'string' && body.process ? body.process : 'unknown'
  ```
  **Defaults to `'unknown'`** — exactly the Phase 42-06 symptom recorded in CONTEXT.md.
- Existing setter precedent: `LLMService.setModeResolver` / `setMockService` / `setRepositoryPath` at `_work/rapid-llm-proxy/src/llm-service.ts:75-95`. Could add `setProcess()` symmetrically.

### 2.3 Finding — pick ONE option

**Option A** (cross-repo, cleaner long-term): Add `process?: string` to `LLMCompletionRequest` (types.ts:54), thread `body.process = request.process` in proxy-provider.ts:67, optionally add `LLMService.setProcess()` (llm-service.ts:75-95). Requires `_work/rapid-llm-proxy` release.

**Option B (RECOMMENDED — single-repo, Phase 42.2-scope)**: Create `integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts` — a thin direct-fetch wrapper mirroring the `scripts/backfill-raw-observations.mjs:63,95` pattern. Replace the 7 wave-agent call sites (wave1 ×3, wave2 ×2, wave3 ×2) with it. Each wrapper invocation sets the request body explicitly, e.g.:
```js
fetch('http://localhost:3033/api/complete', {
  method: 'POST',
  body: JSON.stringify({ process: 'wave-analysis-wave1', messages, taskType: 'semantic_analysis' }),
});
```
Per-wave callers thread their value: `process='wave-analysis-wave1'` for wave1 enrich/analyze, `process='wave-analysis-wave2'` for wave2 dispatch, `process='wave-analysis-wave3'` for wave3 dispatch. Keep `LLMService` for metrics (used at wave1-project-agent.ts:79-88, wave2-component-agent.ts:82-93, wave3-detail-agent.ts:74-85).

**wave-controller.ts has NO direct LLM dispatch** — confirmed `grep -n "llmService\|\.complete(" wave-controller.ts` returns zero invocation hits. `convertLLMMetricsToCalls` at wave-controller.ts:333 is a pure metric-shape converter. **Plan 02 must NOT edit `wave-controller.ts` for this gap.**

## Section 3 — 802-entity team-field audit

### 3.1 Sampling methodology

Source: `.data/knowledge-graph-migrated/exports/general.json` (the JSON export from `GraphKMStore.persistGraph`). `coding.json` is empty (`nodes:[], edges:[]`) — every migrated entity lives in `general.json`. Total nodes: **908** (the 802 figure in the Phase 42-07 SUMMARY is the initial migration cohort; subsequent partial runs added ~106; all share `legacyId.system === 'B'`).

Method: `python3` + `random.seed(42)` + `random.sample(nodes, 10)`. For each sampled entity, checked `attributes.team` (top-level) AND `attributes.metadata.team` (nested).

### 3.2 Per-entity result table

| #  | Key (UUIDv7)                                | Name                              | entityType   | top-level `team` | `metadata.team` | `legacyId.system` |
|----|---------------------------------------------|-----------------------------------|--------------|------------------|-----------------|-------------------|
| 1  | 019e5559-69fb-75a1-8307-29a8980b3227        | DecoratorAddsBehaviorToObjects    | Detail       | **missing**      | **missing**     | B                 |
| 2  | 019e5559-69d4-7754-bd17-016c9720ffe1        | ContentValidationModule           | SubComponent | **missing**      | **missing**     | B                 |
| 3  | 019e5559-69d0-7411-8ed5-aeaab0b0a136        | APIService                        | SubComponent | **missing**      | **missing**     | B                 |
| 4  | 019e5559-6a06-7188-8b21-37052a5f3532        | OKB Core                          | Container    | **missing**      | **missing**     | B                 |
| 5  | 019e5559-69d8-7dfb-b906-f63dad1fc3c1        | CodeGraphConstructionService      | SubComponent | **missing**      | **missing**     | B                 |
| 6  | 019e5559-69d8-7dfb-b906-f61eb021bba2        | CodeGraph                         | SubComponent | **missing**      | **missing**     | B                 |
| 7  | 019e5559-69d8-7dfb-b906-f6084389987f        | TranscriptNormalizer              | Detail       | **missing**      | **missing**     | B                 |
| 8  | 019e5559-69d4-7754-bd17-01885891a791        | CodingConventionEnforcer          | SubComponent | **missing**      | **missing**     | B                 |
| 9  | 019e5559-6a06-7188-8b21-3700c23177d0        | LSL Infrastructure                | Service      | **missing**      | **missing**     | B                 |
| 10 | 019e5559-69d4-7754-bd17-0162d96332c1        | EnvironmentManager                | SubComponent | **missing**      | **missing**     | B                 |

**Tally: 0/10 entities have team present anywhere.**

Unique top-level attribute keys observed across the sample: `createdAt, description, entityType, id, layer, legacyId, metadata, name, ontologyClass, updatedAt, validFrom, validUntil` — team absent.
Unique `metadata.*` keys observed: `childEntityNames, descriptionSegments, hierarchyLevel, isScaffoldNode, legacyObservations, parentEntityName, provenance, significance, source, subsystem` — team absent.

**Corroborating evidence:** `grep -ic "team" integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs` returns `0`. The Phase 42-05 migration script has ZERO references to team — the entities could not have carried team because the script never set it.

### 3.3 Finding — team augmentation needed

The 802 (now 908) entities need a team-field augmentation pass. See §4.1 for the binary verdict string. Without it, future queries like `kmCoreAdapter.queryEntities({ team: 'coding' })` won't match them, breaking the multi-tenant attribution model Phase 42.1's `ensureProjectAnchor` assumed.

### 3.4 Recommendation

Plan 02 ships a one-shot field-augmentation script modeled on `migrate-leveldb-to-kmcore.mjs`:

1. Open `GraphKMStore` at `.data/knowledge-graph-migrated/` with `ontologyDir` (CLAUDE.md mandate).
2. Iterate via `store.iterate()` (Phase 42-05 pattern).
3. For each entity where `legacyId?.system === 'B'` AND `metadata?.team` is missing: `store.mergeAttributes(id, { metadata: { ...existing, team: 'coding' } })`.
4. Idempotent (skip if `metadata.team` present).
5. Fail-loud 5% error budget.
6. Acceptance greps: `ontologyDir`, `legacyId?.system === 'B'`, `metadata.team`.

## Section 4 — Actionable gap list for Wave 1 Plan 02

### Gap 1 — canonical-mapper `team` propagation (6 edits)

1. `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts:69-78` — extend `CanonicalMapperOptions` with `team?: string`.
2. `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts:143-152` — stamp `team: options.team ?? 'coding'` (or fail-loud) into `baseMetadata`.
3. `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts:234-249` — `augmentWithCanonical` already forwards options; doc-comment update only.
4. `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts:336` — pass `{ team: this.team }` as 4th arg.
5. `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts:276` — same.
6. `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts:253` — same.

### Gap 2 — LLM `process` attribution (Option B from §2.3)

7. Create `integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts` — direct-fetch wrapper, pattern from `scripts/backfill-raw-observations.mjs:63,95`.
8. Replace 7 wave-agent `llmService.complete({...})` sites with `llmWithProcess.complete({..., process})` (wave1 ×3 at lines 248/425/908, wave2 ×2 at 375/576, wave3 ×2 at 370/574).
9. (Optional deferral) 8 non-wave sites (`semantic-analysis-agent` ×5, `semantic-analyzer` ×2, `git-staleness-detector` ×1) — same pattern, lower priority. Plan 02 may either fold them in or defer per planner judgement.

### Gap 3 — one-shot team-augmentation script

10. Create `integrations/mcp-server-semantic-analysis/scripts/42.2-augment-team-field.mjs` per §3.4 (re-migration required per §3.3).

### Gap 4 — km-core-adapter silent drop (defence-in-depth)

11. `integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts:232-295` — rename `_options` → `options`; explicitly merge `team: options.team` into the metadata literal at km-core-adapter.ts:272-288.

### 4.1 RE-MIGRATION REQUIRED

(Per §3.3: 0/10 sampled entities carry team; per §3.4: migration script grep confirms zero team handling. The verdict is binary and unambiguous.)

### 4.2 Plan 02 file-budget estimate

- **Submodule:** ~6 edited (`canonical-mapper.ts`, `wave1-project-agent.ts`, `wave2-component-agent.ts`, `wave3-detail-agent.ts`, `km-core-adapter.ts`, `canonical-mapper.test.ts`) + 2 created (`llm-with-process.ts`, augmentation script under `scripts/`) + N test files ≈ **8–10 files**.
- **Outer-repo:** 0 files.

Sits at the upper end of the CONTEXT.md two-edit floor; the expansion (Gap 3 re-migration + Gap 4 cleanup) was surfaced by this forensics pass — not speculative.
