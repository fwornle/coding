# Phase 10: KG Operations Restoration - Research

**Researched:** 2026-03-07
**Domain:** Knowledge Graph operator pipeline (conv, aggr, embed, dedup, pred, merge)
**Confidence:** HIGH

## Summary

Phase 10 restores the six KG operators into the wave pipeline. The operators already exist in `kg-operators.ts` with a working `applyAll()` method -- the core work is (1) wiring them into `wave-controller.ts` between wave 3 persistence and insight finalization, (2) replacing the mock `generateEmbedding()` in `semantic-analyzer.ts` with real sentence-transformers via Python subprocess, (3) making dedup hierarchy-aware with a parentId-scoped key, and (4) fixing `mergeEntities()` so incoming hierarchy fields (parentId, level, hierarchyPath) are not silently overwritten by spread.

The existing operator code is fully functional and tested in the old coordinator pipeline (coordinator.ts:3327-3422). The wave-controller currently has 8 progress steps; this phase adds 6 operator steps between wave3_persist and wave4_insights. The Docker image needs sentence-transformers + the all-MiniLM-L6-v2 model baked in at build time.

**Primary recommendation:** Wire KGOperators.applyAll() into wave-controller.execute() after wave 3 persistence completes, wrapping each operator in try/catch for graceful degradation. Replace mock embeddings with a Python subprocess calling sentence-transformers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- All 6 operators run post-pipeline: AFTER all 3 waves complete but BEFORE insight finalization (Wave 4)
- Operators get the full entity set from all waves, enabling cross-hierarchy dedup/merge/pred
- All 6 operators enabled: conv adapts to wave mode using run metadata instead of batch dates
- Each operator gets its own dashboard progress step (operator_conv, operator_aggr, etc.) matching old pipeline behavior
- Operator failures are graceful: each operator wrapped in try/catch, failure logs warning and skips that operator, pipeline continues
- Use KGOperators.applyAll() to sequence operators internally -- less code in wave-controller
- Local sentence-transformers via Python subprocess (NOT mock, NOT LLM API)
- Model: all-MiniLM-L6-v2 (384-dim, ~80MB) -- matches existing mock dimension
- Downloaded at Docker build time (baked into image, no lazy download)
- Batch all entities in one subprocess call -- sentence-transformers handles internal batching
- Embeddings persisted on entities in the knowledge graph (stored on KGEntity.embedding)
- Hierarchy-aware dedup: dedup key includes parentId, same-name entities under different parents are NOT merged
- Two-pass dedup: first pass is exact normalized name match, second pass uses embedding cosine similarity
- Semantic dedup auto-merges above threshold (cosine > 0.9 AND same hierarchy level AND same parent)
- mergeEntities() parentId fix (KGOP-06): incoming hierarchy fields win -- `parentId: incoming.parentId ?? existing.parentId`, same for level and hierarchyPath
- Cross-wave accumulation: all 3 waves' entities form the complete set for post-pipeline operators
- Edge prediction (pred): cross-branch only -- compare entities in different L1 branches, skip same-branch pairs
- Conv context: build BatchContext from run metadata (run timestamp, recent git commits from repo, session count)

### Claude's Discretion
- Embedding subprocess fallback strategy (skip embed+pred or TF-IDF)
- Exact cosine similarity threshold for semantic dedup (starting point: 0.9)
- How to collect recent git commits and sessions for conv's BatchContext
- Dashboard progress integration details for individual operator steps
- Whether applyAll() needs modification to emit per-operator progress events or if wave-controller wraps it

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KGOP-01 | Conversion operator (conv) enabled in wave persistence | Conv operator exists in kg-operators.ts:188-236. Needs BatchContext adapted from run metadata instead of batch dates. Wave-controller must build context from git log + session files. |
| KGOP-02 | Aggregation operator (aggr) enabled in wave persistence | Aggr operator exists in kg-operators.ts:242-289. No modifications needed -- significance-based core/non-core classification works as-is on wave entities. |
| KGOP-03 | Embedding operator (embed) enabled in wave persistence | Embed operator exists in kg-operators.ts:295-336. Calls semanticAnalyzer.generateEmbedding() which is currently mock (random 384-dim). Must replace with real sentence-transformers subprocess. EmbeddingCache exists for disk persistence. |
| KGOP-04 | Dedup operator enabled with fuzzy name matching | Dedup operator exists in kg-operators.ts:342-394. Current key is just normalized name -- must add parentId to key for hierarchy-aware dedup. Second pass needs embedding cosine similarity check. |
| KGOP-05 | Prediction operator (pred) enabled in wave persistence | Pred operator exists in kg-operators.ts:457-522. Decision: cross-branch only (skip same-branch pairs). Needs parentId/hierarchyPath check to determine L1 branch membership. |
| KGOP-06 | Merge operator enabled with null-coalesce fix for parentId | Merge operator exists in kg-operators.ts:608-675 + mergeEntities at line 400. Current spread `{...existing}` overwrites hierarchy fields. Fix: explicit parentId/level/hierarchyPath with incoming-wins null-coalesce. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| sentence-transformers | latest | Generate 384-dim embeddings via all-MiniLM-L6-v2 | Standard Python embedding library, wraps HuggingFace transformers |
| all-MiniLM-L6-v2 | - | Embedding model (384 dimensions, ~80MB) | Matches existing mock dimension (384), fast, small footprint |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| EmbeddingCache | (existing) | Disk-backed embedding cache with TTL + content-hash invalidation | Already exists at src/utils/embedding-cache.ts. Use to avoid re-computing embeddings for unchanged entities |
| KGOperators | (existing) | All 6 operators with applyAll() sequencing | Already exists at src/agents/kg-operators.ts. Primary class being wired into wave pipeline |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sentence-transformers subprocess | Node.js ONNX runtime | Avoids Python subprocess but requires ONNX model conversion, more complex Docker setup |
| all-MiniLM-L6-v2 | Existing code-graph-rag UnixCoder (768-dim) | Already in Docker image but 768-dim doesn't match existing 384-dim mock, and UnixCoder is code-focused not general text |

**Installation (Docker build additions):**
```dockerfile
# In python-deps stage or a new embedding stage:
RUN uv pip install sentence-transformers numpy
# Pre-download model at build time:
RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
```

## Architecture Patterns

### Operator Placement in Wave Pipeline
```
wave-controller.ts execute():
  Wave 1 -> classify -> persist
  Wave 2 -> classify -> persist
  Wave 3 -> classify -> persist
  Manifest write-back
  ---- NEW: KG Operators Phase ----
  operator_conv  (context convolution)
  operator_aggr  (entity aggregation)
  operator_embed (node embedding via subprocess)
  operator_dedup (hierarchy-aware dedup)
  operator_pred  (cross-branch edge prediction)
  operator_merge (structure fusion)
  ---- END NEW ----
  Insight finalization (wave 4)
```

### Pattern 1: Operator Integration via applyAll() with Graceful Degradation
**What:** Call KGOperators.applyAll() from wave-controller, wrapped in per-operator try/catch
**When to use:** Always -- this is the locked decision
**Example:**
```typescript
// In wave-controller.ts execute(), after wave 3 persistence:
import { createKGOperators, type BatchContext } from './kg-operators.js';
import { SemanticAnalyzer } from './semantic-analyzer.js';

// Collect all entities from all waves
const allEntities: KGEntity[] = waveResults.flatMap(wr =>
  wr.agentOutputs.flatMap(ao => ao.entities)
);
const allRelations: KGRelation[] = waveResults.flatMap(wr =>
  wr.agentOutputs.flatMap(ao => ao.relationships)
);

// Build BatchContext from run metadata
const batchContext: BatchContext = {
  batchId: `wave-run-${Date.now()}`,
  startDate: new Date(startTime),
  endDate: new Date(),
  commits: await this.getRecentGitCommits(30), // last 30 days
  sessions: this.getRecentSessions(30),
};

// accumulatedKG is empty for full-replace mode (Phase 7 decision)
const accumulatedKG = { entities: [], relations: [] };

const semanticAnalyzer = new SemanticAnalyzer(/* config */);
const kgOperators = createKGOperators(semanticAnalyzer);

try {
  const result = await kgOperators.applyAll(
    allEntities, allRelations, batchContext, accumulatedKG
  );
  // result.entities and result.relations are the refined set
} catch (error) {
  log('[WaveController] KG operators failed (non-fatal)', 'warning', { error });
}
```

### Pattern 2: Python Subprocess for Embeddings
**What:** Replace mock `generateEmbedding()` with real sentence-transformers call via child_process
**When to use:** For KGOP-03 embedding operator
**Example:**
```typescript
// In semantic-analyzer.ts, replace generateEmbedding():
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

async generateEmbedding(text: string): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('python3', [
      path.join(__dirname, '../../src/utils/embedding_generator.py'),
      '--text', text,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    log('Embedding generation failed, returning empty', 'warning', { error });
    return []; // Graceful fallback
  }
}
```

**Batch variant (preferred -- locked decision):**
```typescript
// Batch all entities in one subprocess call
async generateEmbeddings(texts: string[]): Promise<number[][]> {
  const input = JSON.stringify(texts);
  const { stdout } = await execFileAsync('python3', [
    path.join(__dirname, '../../src/utils/embedding_generator.py'),
  ], {
    input, // Pass via stdin
    timeout: 120000, // 2 min for large batches
    maxBuffer: 50 * 1024 * 1024, // 50MB for embeddings
  });
  return JSON.parse(stdout);
}
```

**Python script (embedding_generator.py):**
```python
#!/usr/bin/env python3
"""Generate embeddings using sentence-transformers all-MiniLM-L6-v2."""
import sys
import json
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

texts = json.loads(sys.stdin.read())
embeddings = model.encode(texts, show_progress_bar=False)
print(json.dumps(embeddings.tolist()))
```

### Pattern 3: Hierarchy-Aware Dedup Key
**What:** Include parentId in dedup normalization key to prevent cross-parent merging
**Example:**
```typescript
// Current (broken for hierarchy):
const normalizedName = entity.name.toLowerCase().replace(/[^a-z0-9]/g, '');
seen.set(normalizedName, entity);

// Fixed (hierarchy-aware):
const normalizedName = entity.name.toLowerCase().replace(/[^a-z0-9]/g, '');
const dedupKey = `${entity.parentId || 'root'}::${normalizedName}`;
seen.set(dedupKey, entity);
```

### Pattern 4: Progress Step Registration
**What:** Add operator steps to WAVE_STEP_SEQUENCE for dashboard visibility
**Example:**
```typescript
// In wave-controller.ts, extend WAVE_STEP_SEQUENCE:
private static readonly WAVE_STEP_SEQUENCE = [
  { name: 'wave1_init',      wave: 1, phase: 'init' as const },
  { name: 'wave1_analyze',   wave: 1, phase: 'analyze' as const },
  { name: 'wave1_persist',   wave: 1, phase: 'persist' as const },
  { name: 'wave2_analyze',   wave: 2, phase: 'analyze' as const },
  { name: 'wave2_persist',   wave: 2, phase: 'persist' as const },
  { name: 'wave3_analyze',   wave: 3, phase: 'analyze' as const },
  { name: 'wave3_persist',   wave: 3, phase: 'persist' as const },
  // NEW: operator steps
  { name: 'operator_conv',   wave: 3, phase: 'operators' as const },
  { name: 'operator_aggr',   wave: 3, phase: 'operators' as const },
  { name: 'operator_embed',  wave: 3, phase: 'operators' as const },
  { name: 'operator_dedup',  wave: 3, phase: 'operators' as const },
  { name: 'operator_pred',   wave: 3, phase: 'operators' as const },
  { name: 'operator_merge',  wave: 3, phase: 'operators' as const },
  // Insight finalization
  { name: 'wave4_insights',  wave: 4, phase: 'insights' as const },
];
// totalWaves stays 4, totalSteps becomes 14
```

### Anti-Patterns to Avoid
- **Running operators per-wave instead of post-pipeline:** Operators need the FULL entity set to do cross-hierarchy dedup and cross-branch prediction. Running per-wave gives partial data.
- **Lazy model download in generateEmbedding():** First run would hang for minutes downloading 80MB model. Must bake into Docker image.
- **Using applyAll() without modification for progress:** applyAll() is a black box -- wave-controller needs to either (a) call operators individually with progress updates between them, or (b) modify applyAll() to accept a progress callback. Recommendation: call operators individually in wave-controller for dashboard visibility, using applyAll()'s code as a template.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector embeddings | Custom word2vec or TF-IDF | sentence-transformers all-MiniLM-L6-v2 | Produces proper 384-dim semantic embeddings. TF-IDF would require building vocabulary, handling OOV, producing sparse vectors unsuitable for cosine similarity |
| Cosine similarity | N/A | Already in kg-operators.ts:527-544 | Existing implementation is correct and handles edge cases (empty, zero-norm) |
| Embedding caching | Custom file cache | Existing EmbeddingCache (embedding-cache.ts) | Already has TTL, content-hash invalidation, debounced disk writes, LRU eviction |
| Operator sequencing | Custom pipeline coordinator | KGOperators class (kg-operators.ts) | Already has correct operator ordering, result threading, error counting |

**Key insight:** Almost everything is already implemented. This phase is primarily integration/wiring work plus replacing the mock embedding function.

## Common Pitfalls

### Pitfall 1: mergeEntities() Spread Overwrites Hierarchy Fields
**What goes wrong:** `{...existing}` in the return statement copies existing.parentId, then incoming.parentId (if undefined) silently doesn't override. But the REAL problem is that the explicit fields listed after the spread (observations, references, role, significance, embedding, enrichedContext, timestamp) do NOT include parentId, level, or hierarchyPath -- so these always come from `existing` via spread, even when incoming has better values.
**Why it happens:** Original merge was written before hierarchy fields existed.
**How to avoid:** Add explicit hierarchy field handling: `parentId: incoming.parentId ?? existing.parentId`, `level: incoming.level ?? existing.level`, `hierarchyPath: incoming.hierarchyPath ?? existing.hierarchyPath`.
**Warning signs:** After a second `ukb full` run, entities lose their parentId or get reassigned to wrong parents.

### Pitfall 2: Dedup Merges Across Hierarchy Branches
**What goes wrong:** Two entities named "Configuration" under different L1 parents get merged into one because dedup key is just the normalized name.
**Why it happens:** Current dedup uses `entity.name.toLowerCase().replace(/[^a-z0-9]/g, '')` as the sole key.
**How to avoid:** Include parentId in dedup key: `${parentId}::${normalizedName}`.
**Warning signs:** Entity count drops unexpectedly after dedup; entities disappear from one branch.

### Pitfall 3: Python Subprocess Path Resolution in Docker
**What goes wrong:** `python3` or the embedding script path doesn't resolve correctly inside the Docker container.
**Why it happens:** The container has Python via uv with a virtual environment at `/coding/integrations/code-graph-rag/.venv`. The `python3` on PATH may not have sentence-transformers installed.
**How to avoid:** Use the venv Python explicitly OR install sentence-transformers in a separate venv. Alternatively, create a standalone Python script with a shebang that uses the correct venv, or install sentence-transformers globally via uv.
**Warning signs:** "ModuleNotFoundError: No module named 'sentence_transformers'" in Docker logs.

### Pitfall 4: Embedding Subprocess Timeout / Memory
**What goes wrong:** With ~160+ entities, the embedding subprocess takes too long or runs out of memory.
**Why it happens:** all-MiniLM-L6-v2 loads ~80MB model + processes all texts. On first load it takes a few seconds.
**How to avoid:** Set generous timeout (120s). Batch all entities in one call (locked decision). The model processes batches efficiently internally. Monitor Docker container memory limits.
**Warning signs:** "ETIMEOUT" or "killed" in subprocess error output.

### Pitfall 5: accumulatedKG Should Be Empty in Full-Replace Mode
**What goes wrong:** Passing existing KG entities as accumulatedKG causes dedup to merge new entities with stale ones from previous runs.
**Why it happens:** Phase 7 decision established full-replace-per-run mode. Each run produces a complete entity set; operators should treat THIS run's entities as the full set.
**How to avoid:** Pass `{ entities: [], relations: [] }` as accumulatedKG to applyAll(). The "accumulated" entities are all entities from waves 1-3 of THIS run, which are the `entities` parameter. Dedup compares within the run's own entity set.
**Warning signs:** Entity count grows unboundedly across runs instead of being replaced.

### Pitfall 6: Operator Progress vs applyAll() Black Box
**What goes wrong:** Dashboard shows no progress during the operator phase because applyAll() runs all 6 operators without emitting progress.
**Why it happens:** applyAll() doesn't have progress callback support.
**How to avoid:** Don't use applyAll() directly -- call each operator individually from wave-controller with progress updates between them. Use applyAll()'s implementation as the template for operator sequencing.
**Warning signs:** Dashboard stalls at "wave3_persist" for a long time, then jumps to "wave4_insights".

## Code Examples

### Collecting Recent Git Commits for BatchContext
```typescript
// In wave-controller.ts
private async getRecentGitCommits(days: number): Promise<Array<{ hash: string; message: string; date: Date }>> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { stdout } = await execFileAsync('git', [
      'log', `--since=${since}`, '--format=%H|%s|%aI', '--max-count=50',
    ], { cwd: this.repositoryPath, timeout: 10000 });

    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, message, dateStr] = line.split('|');
      return { hash, message, date: new Date(dateStr) };
    });
  } catch {
    return []; // Git not available or no commits -- non-fatal
  }
}
```

### Collecting Recent Sessions for BatchContext
```typescript
private getRecentSessions(days: number): Array<{ filename: string; timestamp: Date }> {
  try {
    const sessionsDir = path.join(this.repositoryPath, '.specstory', 'history');
    if (!fs.existsSync(sessionsDir)) return [];

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const dateStr = f.substring(0, 10); // YYYY-MM-DD prefix
        return { filename: f, timestamp: new Date(dateStr) };
      })
      .filter(s => s.timestamp.getTime() >= cutoff);
  } catch {
    return [];
  }
}
```

### Cross-Branch Edge Prediction Filter
```typescript
// Modification to edgePrediction() in kg-operators.ts
// Skip same-branch pairs: entities sharing the same L1 ancestor
private getL1Ancestor(entity: KGEntity): string | null {
  if (!entity.hierarchyPath) return null;
  const parts = entity.hierarchyPath.split('/');
  return parts.length >= 2 ? parts[1] : null; // parts[0] is Project, parts[1] is L1
}

// In the prediction loop:
for (const entityA of entities) {
  for (const entityB of entities) {
    if (entityA.id === entityB.id) continue;
    const l1A = this.getL1Ancestor(entityA);
    const l1B = this.getL1Ancestor(entityB);
    if (l1A && l1B && l1A === l1B) continue; // Same branch -- skip
    // ... proceed with scoring
  }
}
```

### EmbeddingCache Integration in nodeEmbedding()
```typescript
// In kg-operators.ts nodeEmbedding(), use cache:
import { getSharedEmbeddingCache, EmbeddingCache } from '../utils/embedding-cache.js';

async nodeEmbedding(entities: KGEntity[]): Promise<KGEntity[]> {
  const cache = getSharedEmbeddingCache();
  await cache.initialize();

  const textsToEmbed: string[] = [];
  const entityIndices: number[] = [];
  const results = [...entities];

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity.embedding && entity.embedding.length > 0) continue;

    const text = [entity.name, entity.type, ...entity.observations.slice(0, 3)]
      .join(' ').substring(0, 8000);
    const contentHash = EmbeddingCache.hashContent(text);
    const cached = cache.get(entity.name, contentHash);

    if (cached) {
      results[i] = { ...entity, embedding: cached };
    } else {
      textsToEmbed.push(text);
      entityIndices.push(i);
    }
  }

  if (textsToEmbed.length > 0) {
    // Batch embedding via subprocess
    const embeddings = await this.semanticAnalyzer.generateEmbeddings(textsToEmbed);
    for (let j = 0; j < embeddings.length; j++) {
      const idx = entityIndices[j];
      results[idx] = { ...entities[idx], embedding: embeddings[j] };
      // Cache the new embedding
      const text = textsToEmbed[j];
      cache.set(entities[idx].name, embeddings[j], EmbeddingCache.hashContent(text));
    }
  }

  await cache.flush();
  return results;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Operators run per-batch in coordinator | Operators run post-pipeline in wave-controller | Phase 10 (this phase) | Operators get full entity set from all waves, better dedup/pred quality |
| Mock embeddings (random 384-dim) | Real sentence-transformers embeddings | Phase 10 (this phase) | Enables meaningful semantic dedup and edge prediction |
| Flat dedup key (name only) | Hierarchy-aware dedup key (parentId::name) | Phase 10 (this phase) | Prevents cross-branch entity merging |

## Open Questions

1. **applyAll() vs individual operator calls**
   - What we know: applyAll() sequences all 6 operators but doesn't emit progress. Dashboard needs per-operator progress.
   - What's unclear: Whether to modify applyAll() with a callback or duplicate its logic in wave-controller.
   - Recommendation: Call operators individually in wave-controller (duplicating ~40 lines from applyAll) for dashboard visibility. This is more maintainable than adding callback plumbing to applyAll().

2. **sentence-transformers Docker installation path**
   - What we know: code-graph-rag has its own Python venv. sentence-transformers is NOT in its deps.
   - What's unclear: Whether to add sentence-transformers to code-graph-rag's venv or create a separate Python environment.
   - Recommendation: Create a dedicated embedding venv in the python-deps Dockerfile stage, separate from code-graph-rag. This avoids version conflicts and keeps concerns separate. The embedding_generator.py script uses this venv explicitly.

3. **Embedding subprocess fallback (Claude's discretion)**
   - What we know: User wants local sentence-transformers, not LLM API.
   - Recommendation: If subprocess fails (model not available, Python error), gracefully skip embed + pred operators. Log a warning. Conv, aggr, dedup, merge still provide value without embeddings. TF-IDF fallback adds complexity for marginal benefit -- not worth implementing.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner + manual `ukb full` verification |
| Config file | none -- tests inline in source or manual |
| Quick run command | `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit` |
| Full suite command | `ukb full` (end-to-end pipeline run) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KGOP-01 | Conv operator enriches entities with temporal context | smoke/e2e | `ukb full` then inspect entities for enrichedContext field | N/A - e2e |
| KGOP-02 | Aggr operator assigns core/non-core roles | smoke/e2e | `ukb full` then inspect entities for role field | N/A - e2e |
| KGOP-03 | Embed operator produces 384-dim vectors | smoke/e2e | `ukb full` then inspect entities for embedding field (non-empty, length=384) | N/A - e2e |
| KGOP-04 | Dedup operator merges duplicates without cross-parent merge | smoke/e2e | Run `ukb full` twice, verify entity count stable and no cross-parent merges | N/A - e2e |
| KGOP-05 | Pred operator produces cross-branch predicted edges | smoke/e2e | `ukb full` then inspect relations for source='predicted' | N/A - e2e |
| KGOP-06 | Merge operator preserves parentId during merging | unit | Inline test of mergeEntities() with hierarchy fields | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit`
- **Per wave merge:** Type-check + Docker rebuild + `ukb full`
- **Phase gate:** Full `ukb full` run producing entities with embeddings, no duplicate entities, parentId preserved

### Wave 0 Gaps
- [ ] `integrations/mcp-server-semantic-analysis/src/utils/embedding_generator.py` -- Python embedding script (does not exist yet)
- [ ] Dockerfile changes for sentence-transformers + model download
- [ ] Type additions for `updateProgress` to support 'operators' phase

## Sources

### Primary (HIGH confidence)
- `src/agents/kg-operators.ts` -- Full operator implementation, all 6 operators, applyAll(), mergeEntities()
- `src/agents/wave-controller.ts` -- Current wave pipeline, execute(), WAVE_STEP_SEQUENCE, updateProgress()
- `src/agents/semantic-analyzer.ts:721-725` -- Current mock generateEmbedding()
- `src/utils/embedding-cache.ts` -- Existing embedding cache infrastructure
- `src/agents/coordinator.ts:3327-3422` -- Old operator integration pattern with progress steps
- `docker/Dockerfile.coding-services` -- Current Docker build stages

### Secondary (MEDIUM confidence)
- `src/agents/coordinator.ts:2547-2560` -- BatchContext construction pattern from old batch pipeline
- `integrations/code-graph-rag/pyproject.toml` -- Python dependency structure (torch+transformers available but no sentence-transformers)

### Tertiary (LOW confidence)
- sentence-transformers model size estimate (~80MB for all-MiniLM-L6-v2) -- from training data, not verified against current release

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all code exists, just needs wiring
- Architecture: HIGH - operator placement, progress steps, and sequencing are well-understood from existing coordinator code
- Pitfalls: HIGH - identified from actual code analysis (mergeEntities spread, dedup key, Docker Python paths)

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- all code is internal to this project)
