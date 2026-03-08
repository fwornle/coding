---
phase: 10-kg-operations-restoration
verified: 2026-03-07T16:00:00Z
status: gaps_found
score: 1/4 must-haves verified at runtime
human_verification:
  - test: "Run ukb full and verify entities have 384-dim embeddings"
    expected: "Most entities have embedding arrays of length 384 (not zeros or random)"
    why_human: "Requires Docker rebuild, sentence-transformers install, and live pipeline execution"
  - test: "Run ukb full twice and verify no duplicate entities created"
    expected: "Entity count stable between runs; dedup merges same-name entities under same parent"
    why_human: "Requires two full pipeline executions and comparing entity counts"
  - test: "Verify dashboard shows 6 operator progress steps"
    expected: "operator_conv through operator_merge appear sequentially on dashboard between wave3_persist and wave4_insights"
    why_human: "Requires live dashboard observation during pipeline run"
---

# Phase 10: KG Operations Restoration Verification Report

**Phase Goal:** Persisted entities are refined through the full KG operator pipeline -- converted, aggregated, embedded, deduplicated, scored, and merged -- producing a clean, enriched knowledge graph
**Verified:** 2026-03-07T16:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After ukb full, entities have embedding vectors enabling semantic similarity queries | VERIFIED (code) | `nodeEmbedding()` batches texts via `generateEmbeddings()` which spawns Python subprocess using `SentenceTransformer('all-MiniLM-L6-v2')` producing 384-dim vectors. Dockerfile bakes in sentence-transformers + model. No mock `Math.random()` remains. |
| 2 | Running pipeline twice does not create duplicate entities -- dedup merges them | VERIFIED (code) | `deduplication()` uses two-pass strategy: Pass 1 uses `parentId::normalizedName` key for exact match; Pass 2 uses cosine similarity > 0.9 with same parent+level constraint. Both passes call `mergeEntities()`. |
| 3 | Merge operator preserves parentId during entity merging | VERIFIED (code) | `mergeEntities()` at line 521-523 explicitly sets `parentId: incoming.parentId ?? existing.parentId`, `level: incoming.level ?? existing.level`, `hierarchyPath: incoming.hierarchyPath ?? existing.hierarchyPath`. |
| 4 | Aggregation and prediction operators produce derived metadata visible on entities | VERIFIED (code) | `entityAggregation()` assigns `role: 'core' | 'non-core'` based on multi-factor scoring (significance threshold, observations count, references, documentation quality). `edgePrediction()` produces predicted edges with weighted scoring (cosine + Adamic-Adar + common ancestors) and cross-branch filter via `getL1Ancestor()`. |

**Score:** 4/4 truths verified at code level

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `integrations/mcp-server-semantic-analysis/src/utils/embedding_generator.py` | Python embedding script using sentence-transformers | VERIFIED | 37 lines, uses `SentenceTransformer('all-MiniLM-L6-v2')`, reads JSON from stdin, outputs JSON arrays, handles empty input and errors gracefully |
| `integrations/mcp-server-semantic-analysis/src/agents/semantic-analyzer.ts` | Batch `generateEmbeddings()` method using Python subprocess | VERIFIED | `generateEmbeddings(texts)` uses `spawn` with stdin pipe to Python, 120s timeout. Single `generateEmbedding(text)` delegates to batch version. No mock random code remains. |
| `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` | All 6 operators with hierarchy awareness | VERIFIED | 784 lines. conv (contextConvolution), aggr (entityAggregation), embed (nodeEmbedding), dedup (deduplication with 2-pass), pred (edgePrediction with cross-branch filter), merge (structureMerge). `mergeEntities()` preserves hierarchy fields. `getL1Ancestor()` helper present. |
| `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts` | KG operators wired post-wave-3 with per-operator progress | VERIFIED | Lines 200-299: all 6 operators called individually with try/catch, `updateProgress()` called before each operator, re-persistence of refined entities after operators complete. |
| `docker/Dockerfile.coding-services` | sentence-transformers + all-MiniLM-L6-v2 baked into Docker image | VERIFIED | `.embedding-venv` created with `uv`, `sentence-transformers numpy` installed, model pre-downloaded at build time. Venv copied to final stage. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `wave-controller.ts execute()` | `kg-operators.ts KGOperators` | `createKGOperators` import and call | WIRED | Line 29: `import { createKGOperators }`, Line 221: `createKGOperators(new SemanticAnalyzer())`, Lines 230-276: all 6 operators called individually |
| `kg-operators.ts nodeEmbedding()` | `semantic-analyzer.ts generateEmbeddings()` | batch embedding call | WIRED | Line 325: `this.semanticAnalyzer.generateEmbeddings(texts)` -- batch call, not per-entity |
| `semantic-analyzer.ts generateEmbeddings()` | `embedding_generator.py` | child_process spawn | WIRED | Line 735: `pythonPath` resolved from env or `.embedding-venv/bin/python3`, Line 739: `spawn(pythonPath, [scriptPath])` |
| `Dockerfile.coding-services` | `all-MiniLM-L6-v2` | pip install + model download | WIRED | Lines 70-73: venv created, sentence-transformers installed, model downloaded. Line 122: venv copied to final image. |
| `deduplication()` | `mergeEntities()` | hierarchy-scoped dedup key | WIRED | Line 374/381: `${entity.parentId || 'root'}::${normalizedName}` key used in both accumulated and batch entity loops |
| `edgePrediction()` | `getL1Ancestor()` | cross-branch filter | WIRED | Lines 573-578: `getL1Ancestor()` called for both entities; same-branch pairs skipped with `continue` |
| `wave-controller.ts updateProgress()` | Operator step names | operator message-to-step mapping | WIRED | Lines 1154-1161: opMap translates "Context Convolution" to "operator_conv" etc. WAVE_STEP_SEQUENCE includes all 6 operator steps (lines 1110-1115). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| KGOP-01 | 10-02, 10-03 | Conversion operator (conv) enabled in wave persistence | SATISFIED | `contextConvolution()` implemented (lines 188-236) and wired in wave-controller (line 230) |
| KGOP-02 | 10-03 | Aggregation operator (aggr) enabled in wave persistence | SATISFIED | `entityAggregation()` implemented (lines 242-289) with multi-factor core/non-core scoring, wired in wave-controller (line 237) |
| KGOP-03 | 10-01, 10-03 | Embedding operator (embed) enabled in wave persistence | SATISFIED | `nodeEmbedding()` batches via `generateEmbeddings()` using Python subprocess with sentence-transformers. Wired in wave-controller (line 245). Dockerfile includes model. |
| KGOP-04 | 10-02, 10-03 | Dedup operator enabled with fuzzy name matching | SATISFIED | Two-pass dedup: Pass 1 (exact name with parentId scope), Pass 2 (cosine > 0.9 with same parent+level). Wired in wave-controller (line 253). |
| KGOP-05 | 10-02, 10-03 | Prediction operator (pred) enabled in wave persistence | SATISFIED | `edgePrediction()` with weighted scoring (cosine + Adamic-Adar + common ancestors) and cross-branch filter. Wired in wave-controller (line 261). |
| KGOP-06 | 10-01, 10-02 | Merge operator enabled with null-coalesce fix for parentId | SATISFIED | `mergeEntities()` line 521: `parentId: incoming.parentId ?? existing.parentId`. `structureMerge()` implemented (line 711) and wired in wave-controller (line 269). |

No orphaned requirements found -- all 6 KGOP requirements are covered by plans and verified in code.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none found) | - | - | - | - |

No TODOs, FIXMEs, placeholders, mock embeddings, or stub implementations found in any modified files.

### Human Verification Required

### 1. End-to-end Pipeline with Real Embeddings

**Test:** Build Docker image with sentence-transformers, run `ukb full`, check entities for 384-dim embeddings
**Expected:** Most entities have `embedding` arrays of length 384 with non-zero, non-random values. Docker build succeeds with model baked in.
**Why human:** Requires Docker rebuild, sentence-transformers download (~400MB), and full pipeline execution

### 2. Dedup Stability Across Runs

**Test:** Run `ukb full` twice on the same codebase, compare entity counts
**Expected:** Entity count stable or decreasing (dedup merges duplicates). No entity explosion.
**Why human:** Requires two full pipeline runs and comparing results

### 3. Dashboard Operator Progress

**Test:** During `ukb full`, observe dashboard at http://localhost:3032
**Expected:** 6 operator steps (operator_conv through operator_merge) appear sequentially between wave3_persist and wave4_insights
**Why human:** Visual dashboard observation during live pipeline run

### 4. Operator Graceful Degradation

**Test:** If sentence-transformers is unavailable (e.g., embedding venv missing), pipeline should continue
**Expected:** Embed operator logs warning, returns entities unchanged; downstream operators proceed
**Why human:** Requires controlled failure scenario in Docker environment

### Gaps Summary

**3 runtime gaps found during human verification (2026-03-08):**

#### Gap 1: persistEntities() strips operator-enriched fields (CRITICAL)
- **Location:** `wave-controller.ts:599-611` — `persistEntities()` call maps entities to `{name, entityType, observations, significance, metadata, parentId, level}` only
- **Impact:** `embedding`, `role`, `enrichedContext` from operators are ALL dropped during re-persist
- **Fix:** Add `embedding`, `role`, `enrichedContext` to the persist mapping, or use a direct KG update path that preserves these fields

#### Gap 2: Ontology classification lost on operator-refined entities (MEDIUM)
- **Location:** `wave-controller.ts:298` — re-persist calls `persistWaveResult` which runs `mapEntityToSharedMemory` looking for `_ontologyMetadata`
- **Impact:** Operator-refined entities are new objects; `_ontologyMetadata` attached during per-wave classification is lost. VKB shows no ontology classifications.
- **Fix:** Carry `_ontologyMetadata` through operator processing, or re-classify after operators

#### Gap 3: Dashboard operator progress too fast for some steps (LOW)
- **Location:** SSE broadcast interval vs operator execution speed
- **Impact:** Conv, aggr, dedup, pred complete so fast they never get an SSE broadcast tick — dashboard shows jump. Embed and merge are slow enough to appear.
- **Fix:** Either force an SSE flush after each updateProgress() call, or accept this as cosmetic

---

_Verified: 2026-03-07T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
