# Phase 29: Retrieval Service - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 5 new/modified files
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `integrations/system-health-dashboard/server.js` | controller (modify) | request-response | self (existing patterns) | exact |
| `src/retrieval/retrieval-service.js` | service | request-response | `src/knowledge-management/KnowledgeQueryService.js` | role-match |
| `src/retrieval/rrf-fusion.js` | utility | transform | `src/inference/BudgetTracker.js` | partial |
| `src/retrieval/token-budget.js` | utility | transform | `src/inference/BudgetTracker.js` | role-match |
| `src/retrieval/keyword-search.js` | utility | CRUD | `integrations/system-health-dashboard/server.js` (handleGetObservations, line 3901) | exact (pattern lifted directly) |

---

## Pattern Assignments

### `integrations/system-health-dashboard/server.js` (modify — add route + handler)

**Analog:** self — follow existing patterns verbatim.

**Route registration pattern** (lines 105–174 — setupRoutes):
```javascript
// In setupRoutes(), after the consolidation routes (line 174):
this.app.post('/api/retrieve', this.handleRetrieve.bind(this));
```

**POST handler with body validation pattern** — closest analog is `handleRestartService` (lines 477–472) and `handleRunConsolidation` (lines 4191–4218):
```javascript
// handleRunConsolidation (lines 4191-4218) — best POST analog in this file
async handleRunConsolidation(req, res) {
    try {
        // ... dynamic import of service class
        // ... call service method
        // ... build result
        res.json({ success: true, ...result });
    } catch (err) {
        process.stderr.write(`[ConsolidationAPI] Run error: ${err.message}\n`);
        res.status(500).json({ error: `Consolidation failed: ${err.message}` });
    }
}
```

**Input validation pattern** — closest analog is `handleRestartService` (lines 477–490):
```javascript
async handleRestartService(req, res) {
    try {
        const { serviceName, action } = req.body;
        if (!serviceName) {
            return res.status(400).json({
                status: 'error',
                message: 'Service name is required'
            });
        }
        // ...
    }
}
```

**Logging constraint** — all new code uses `process.stderr.write()`, NEVER `console.log`. Pattern from `handleGetObservations` (line 3990):
```javascript
process.stderr.write(`[ObservationsAPI] Query error: ${err.message}\n`);
```

**New `handleRetrieve` handler to write:**
```javascript
async handleRetrieve(req, res) {
    const startMs = Date.now();
    const { query, budget = 1000, threshold = 0.75 } = req.body;
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'query (string) is required' });
    }
    try {
        // retrievalService initialized eagerly in constructor (see Pitfall 1 in RESEARCH.md)
        const result = await this.retrievalService.retrieve(query, { budget, threshold });
        result.meta.latency_ms = Date.now() - startMs;
        res.json(result);
    } catch (err) {
        process.stderr.write(`[RetrievalAPI] Error: ${err.message}\n`);
        res.status(500).json({ error: 'Retrieval failed' });
    }
}
```

**SQLite DB helper pattern** (lines 3855–3882) — `_getObservationsDb()` — reuse directly; do NOT open a new connection:
```javascript
_getObservationsDb() {
    const now = Date.now();
    const REOPEN_INTERVAL_MS = 30_000;
    if (this._obsDb && this._obsDbOpenedAt && (now - this._obsDbOpenedAt) < REOPEN_INTERVAL_MS) {
        return this._obsDb;
    }
    if (this._obsDb) {
        try { this._obsDb.close(); } catch { /* ignore */ }
        this._obsDb = null;
    }
    try {
        const Database = require_cjs('better-sqlite3');
        const dbPath = join(codingRoot, '.observations', 'observations.db');
        if (!existsSync(dbPath)) return null;
        this._obsDb = new Database(dbPath, { readonly: true });
        this._obsDbOpenedAt = now;
        return this._obsDb;
    } catch (err) {
        process.stderr.write(`[ObservationsAPI] DB init failed: ${err.message}\n`);
        return null;
    }
}
```
Pass `this._getObservationsDb()` into `RetrievalService` or into `KeywordSearch` directly — do NOT instantiate a separate SQLite connection.

**Import pattern for Phase 28 modules** — server.js uses dynamic `import()` for host-only code (see `handleRunConsolidation` line 4195). For retrieval service, use top-level static import since it must be ready at startup:
```javascript
// Add near top of server.js, after existing imports:
import { RetrievalService } from '../../src/retrieval/retrieval-service.js';
```
Then in constructor, after `this.setupMiddleware(); this.setupRoutes();`:
```javascript
// Eagerly initialize retrieval service (avoids fastembed cold start on first request)
this.retrievalService = new RetrievalService({
    dbPath: join(codingRoot, '.observations', 'observations.db'),
});
this.retrievalService.initialize().catch(err => {
    process.stderr.write(`[RetrievalService] Eager init failed: ${err.message}\n`);
});
```

---

### `src/retrieval/retrieval-service.js` (service, request-response)

**Analog:** `src/knowledge-management/KnowledgeQueryService.js` (lines 1–80 read; plain class, no EventEmitter, no mandatory deps in constructor, options object pattern).

**Module structure pattern** (KnowledgeQueryService.js lines 13–18):
```javascript
export class KnowledgeQueryService {
  constructor(databaseManager, graphDatabase = null, options = {}) {
    this.databaseManager = databaseManager;
    this.graphDatabase = graphDatabase;
    this.debug = options.debug || false;
  }
```
Apply to retrieval-service.js as:
```javascript
// src/retrieval/retrieval-service.js
import { getEmbeddingService } from '../../src/embedding/embedding-service.js';
import { getQdrantClient } from '../../src/embedding/qdrant-collections.js';
import { KeywordSearch } from './keyword-search.js';
import { rrfFuse } from './rrf-fusion.js';
import { assembleBudgetedMarkdown } from './token-budget.js';

export class RetrievalService {
  constructor(options = {}) {
    this.dbPath = options.dbPath;
    this.scoreThreshold = options.scoreThreshold ?? 0.75;
    this.defaultBudget = options.defaultBudget ?? 1000;
    this.embeddingService = getEmbeddingService();
    this.qdrantClient = getQdrantClient();
    this.keywordSearch = new KeywordSearch({ dbPath: this.dbPath });
  }
```

**Initialization (warm fastembed) pattern** — from `src/embedding/embedding-service.ts` lines 41–59:
```javascript
// EmbeddingService.initialize() — guard pattern: safe to call many times
async initialize() {
    if (this.model) return;
    if (this.initPromise) {
        await this.initPromise;
        return;
    }
    this.initPromise = (async () => { /* model load */ })();
    await this.initPromise;
}
```
Call `this.embeddingService.initialize()` in `RetrievalService.initialize()` to warm the model.

**Parallel Qdrant search pattern** — from RESEARCH.md Pattern 1 (verified against `src/embedding/qdrant-collections.ts`):
```javascript
const COLLECTIONS = ['insights', 'digests', 'kg_entities', 'observations'];
const TIER_WEIGHTS = { insights: 1.5, digests: 1.2, kg_entities: 1.0, observations: 0.8 };

async _semanticSearch(queryVector, limit = 20, threshold = 0.75) {
    const results = await Promise.all(
        COLLECTIONS.map(collection =>
            this.qdrantClient.search(collection, {
                vector: queryVector,
                limit,
                score_threshold: threshold,
                with_payload: true,
                with_vector: false,
            }).then(points => points.map(p => ({
                ...p,
                tier: collection,
                tierWeight: TIER_WEIGHTS[collection],
            }))).catch(err => {
                process.stderr.write(`[RetrievalService] Qdrant search failed (${collection}): ${err.message}\n`);
                return []; // graceful degradation per RESEARCH.md open question 3
            })
        )
    );
    return results.flat();
}
```

**Error handling / logging** — copy exactly from server.js pattern:
```javascript
process.stderr.write(`[RetrievalService] ${message}\n`);
```
Never `console.log`.

**Main retrieve() method returns D-06 shape:**
```javascript
async retrieve(query, options = {}) {
    const { budget = this.defaultBudget, threshold = this.scoreThreshold } = options;
    const vector = await this.embeddingService.embedOne(query);
    const [semanticResults, keywordResults] = await Promise.all([
        this._semanticSearch(vector, 20, threshold),
        this.keywordSearch.search(query),
    ]);
    const recencyResults = this._buildRecencyList([...semanticResults, ...keywordResults]);
    const fused = rrfFuse([semanticResults, keywordResults, recencyResults]);
    const { markdown, tokensUsed } = assembleBudgetedMarkdown(fused, budget);
    return {
        markdown,
        meta: {
            query,
            budget,
            results_count: fused.length,
            latency_ms: 0, // set by handler after return
        },
    };
}
```

---

### `src/retrieval/rrf-fusion.js` (utility, transform)

**Analog:** No direct analog for RRF in codebase. Use RESEARCH.md Pattern 2 as the canonical implementation.

**Module pattern** — match other `src/` utility JS files: named exports, no class needed (pure functions):
```javascript
// src/retrieval/rrf-fusion.js
const TIER_WEIGHTS = { insights: 1.5, digests: 1.2, kg_entities: 1.0, observations: 0.8 };

/**
 * Reciprocal Rank Fusion (Cormack et al., 2009).
 * k=60 is the standard default from the paper.
 * Tier weights applied after fusion per D-03.
 *
 * @param {Array<Array<{id, tier, tierWeight, ...}>>} rankedLists - One list per retrieval source
 * @param {number} k - RRF damping constant (default 60)
 * @returns {Array} Fused and sorted results, each decorated with rrfScore
 */
export function rrfFuse(rankedLists, k = 60) {
    const scores = new Map(); // id -> { score, item }

    for (const list of rankedLists) {
        list.forEach((item, rank) => {
            const existing = scores.get(item.id) || { score: 0, item };
            existing.score += 1 / (k + rank + 1);
            scores.set(item.id, existing);
        });
    }

    // Apply tier weights after fusion (D-03)
    for (const [, entry] of scores) {
        entry.score *= TIER_WEIGHTS[entry.item.tier] ?? 1.0;
    }

    return [...scores.values()]
        .sort((a, b) => b.score - a.score)
        .map(e => ({ ...e.item, rrfScore: e.score }));
}

/**
 * Exponential decay recency score.
 * Half-life of 14 days is the default (assumption A2 in RESEARCH.md).
 *
 * @param {string|null} dateStr - ISO date string from payload
 * @param {number} halfLifeDays
 * @returns {number} Score in [0, 1]
 */
export function recencyScore(dateStr, halfLifeDays = 14) {
    if (!dateStr) return 0.5;
    const ageMs = Date.now() - new Date(dateStr).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Build a recency-ranked list from a combined item set (deduped by id).
 * Used as the third input list to rrfFuse() with half-weight contribution.
 */
export function buildRecencyList(items) {
    const seen = new Set();
    const deduped = items.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
    return deduped
        .map(item => ({ ...item, _recency: recencyScore(item.payload?.date) }))
        .sort((a, b) => b._recency - a._recency);
}
```

---

### `src/retrieval/token-budget.js` (utility, transform)

**Analog:** No direct codebase analog. Use RESEARCH.md Pattern 3 and the `gpt-tokenizer` API from RESEARCH.md Code Examples.

**Module pattern** — named exports, pure functions (no class):
```javascript
// src/retrieval/token-budget.js
import { countTokens } from 'gpt-tokenizer';

const TIER_ORDER = ['insights', 'digests', 'kg_entities', 'observations'];

/**
 * Format a single result as a markdown block with source attribution.
 * Payload structure per tier (from RESEARCH.md / backfill.ts):
 *   insights: { topic, confidence, summary_preview }
 *   digests: { date, theme, agents, quality, summary_preview }
 *   kg_entities: { entityType, hierarchyLevel, parentId, summary_preview }
 *   observations: { agent, project, date, quality, summary_preview }
 */
export function formatResult(item) {
    const p = item.payload || {};
    switch (item.tier) {
        case 'insights':
            return `**${p.topic || 'Insight'}** (confidence: ${p.confidence ?? '?'})\n${p.summary_preview || ''}\n`;
        case 'digests':
            return `**${p.theme || 'Digest'}** (${p.date || ''}, agents: ${p.agents || '?'})\n${p.summary_preview || ''}\n`;
        case 'kg_entities':
            return `**${p.entityType || 'Entity'}** (level: ${p.hierarchyLevel || '?'})\n${p.summary_preview || ''}\n`;
        case 'observations':
        default:
            return `*${p.agent || 'agent'}* (${p.date || ''}, ${p.project || ''})\n${p.summary_preview || ''}\n`;
    }
}

/**
 * Truncate summary_preview in a result so the formatted output fits within tokenBudget.
 * Returns a new item with truncated payload (does not mutate original).
 */
export function truncateResult(item, tokenBudget) {
    const header = formatResult({ ...item, payload: { ...item.payload, summary_preview: '' } });
    const headerTokens = countTokens(header);
    const available = tokenBudget - headerTokens - 5; // 5-token safety margin
    if (available <= 0) return null;
    // Binary-search or simple slice to fit available tokens
    const preview = (item.payload?.summary_preview || '').slice(0, available * 4); // ~4 chars/token approx for trimming
    return { ...item, payload: { ...item.payload, summary_preview: preview } };
}

/**
 * Assemble token-budgeted markdown from a fused, sorted result list.
 * Fill order: insights first, then digests, kg_entities, observations (D-08).
 *
 * @param {Array} sortedResults - RRF-fused results sorted by score descending
 * @param {number} budget - Token budget (default 1000 per D-08)
 * @returns {{ markdown: string, tokensUsed: number }}
 */
export function assembleBudgetedMarkdown(sortedResults, budget = 1000) {
    // Bucket by tier in fill order
    const buckets = Object.fromEntries(TIER_ORDER.map(t => [t, []]));
    let tokensUsed = 0;

    for (const result of sortedResults) {
        const formatted = formatResult(result);
        const tokens = countTokens(formatted);

        if (tokensUsed + tokens > budget) {
            const remaining = budget - tokensUsed;
            if (remaining > 50) {
                const truncated = truncateResult(result, remaining);
                if (truncated) {
                    const tf = formatResult(truncated);
                    buckets[result.tier]?.push(tf);
                    tokensUsed += countTokens(tf);
                }
            }
            break;
        }

        buckets[result.tier]?.push(formatted);
        tokensUsed += tokens;
    }

    // Build final markdown with tier headers (D-05)
    const sections = [];
    const TIER_HEADERS = {
        insights: '## Insights',
        digests: '## Digests',
        kg_entities: '## Entities',
        observations: '## Observations',
    };
    for (const tier of TIER_ORDER) {
        if (buckets[tier].length > 0) {
            sections.push(`${TIER_HEADERS[tier]}\n\n${buckets[tier].join('\n')}`);
        }
    }

    return { markdown: sections.join('\n\n'), tokensUsed };
}
```

---

### `src/retrieval/keyword-search.js` (utility, CRUD)

**Analog:** `integrations/system-health-dashboard/server.js` — `handleGetObservations` (lines 3901–3997) and `handleGetInsights` (lines 4097–4143).

**FTS5 probe-and-fallback pattern** — exact pattern from server.js lines 3941–3951:
```javascript
// FTS5 full-text search — fall back to LIKE if FTS table doesn't exist
try {
    db.prepare('SELECT 1 FROM observations_fts LIMIT 0').get();
    where.push('observations.rowid IN (SELECT rowid FROM observations_fts WHERE observations_fts MATCH @q)');
} catch {
    where.push('summary LIKE @q');
    q = `%${q}%`;
}
params.q = q;
```

**SQLite require pattern** (server.js line 22, 3870):
```javascript
// CJS require for better-sqlite3 in ESM context
const require_cjs = createRequire(import.meta.url);
// ... later:
const Database = require_cjs('better-sqlite3');
```
For `keyword-search.js` as a standalone module, accept the db instance from the caller (injected by `RetrievalService`) rather than opening its own connection — this avoids conflicting with server.js's cached `_obsDb`.

**Module structure:**
```javascript
// src/retrieval/keyword-search.js
// Accepts an already-open better-sqlite3 db instance (readonly)
// to share the server's _obsDb connection.

export class KeywordSearch {
    constructor(options = {}) {
        // db injected per call (not stored) to avoid holding a stale reference
        this.limit = options.limit ?? 20;
    }

    /**
     * Run keyword search across observations (FTS5), digests (LIKE), insights (LIKE).
     * @param {import('better-sqlite3').Database} db
     * @param {string} query
     * @returns {{ observations: Array, digests: Array, insights: Array }}
     */
    search(db, query) {
        return {
            observations: this._searchObservations(db, query),
            digests: this._searchDigests(db, query),
            insights: this._searchInsights(db, query),
        };
    }

    _searchObservations(db, query) {
        // FTS5 probe pattern from server.js lines 3941-3951
        try {
            db.prepare('SELECT 1 FROM observations_fts LIMIT 0').get();
            return db.prepare(`
                SELECT id, summary as summary_preview, agent,
                       created_at as date, quality, 'observations' as tier
                FROM observations
                WHERE rowid IN (SELECT rowid FROM observations_fts WHERE observations_fts MATCH ?)
                ORDER BY created_at DESC LIMIT ?
            `).all(query, this.limit);
        } catch {
            return db.prepare(`
                SELECT id, summary as summary_preview, agent,
                       created_at as date, quality, 'observations' as tier
                FROM observations WHERE summary LIKE ?
                ORDER BY created_at DESC LIMIT ?
            `).all(`%${query}%`, this.limit);
        }
    }

    _searchDigests(db, query) {
        // LIKE fallback — no FTS table for digests (RESEARCH.md Pitfall 2)
        try {
            return db.prepare(`
                SELECT id, summary as summary_preview, theme, date, agents, quality, 'digests' as tier
                FROM digests WHERE summary LIKE ? OR theme LIKE ?
                ORDER BY date DESC LIMIT ?
            `).all(`%${query}%`, `%${query}%`, this.limit);
        } catch { return []; }
    }

    _searchInsights(db, query) {
        // LIKE fallback — no FTS table for insights (RESEARCH.md Pitfall 2)
        try {
            return db.prepare(`
                SELECT id, summary as summary_preview, topic, confidence, 'insights' as tier
                FROM insights WHERE summary LIKE ? OR topic LIKE ?
                ORDER BY confidence DESC LIMIT ?
            `).all(`%${query}%`, `%${query}%`, Math.floor(this.limit / 2));
        } catch { return []; }
    }
}
```

**Error handling** — wrap each query in try/catch returning `[]` (same approach server.js uses for optional tables like `digests`/`insights`; see lines 4172–4175):
```javascript
let totalDigests = 0;
try { totalDigests = db.prepare('SELECT COUNT(*) as cnt FROM digests').get().cnt; } catch { /* table may not exist */ }
```

---

## Shared Patterns

### Logging (CRITICAL — no-console-log constraint)
**Source:** `integrations/system-health-dashboard/server.js` lines 3990, 4013, 4138, 4179, 4215
**Apply to:** All new files in `src/retrieval/`
```javascript
// ALL logging must use this form — never console.log, never console.error
process.stderr.write(`[ServiceName] Message: ${details}\n`);
```

### SQLite DB Access (readonly, cached, no new connections)
**Source:** `integrations/system-health-dashboard/server.js` lines 3855–3882
**Apply to:** `retrieval-service.js`, `keyword-search.js`
- Reuse `this._getObservationsDb()` from server.js — pass the `db` handle into `KeywordSearch.search(db, query)`
- Do NOT create a new `Database` instance in any retrieval module; `{ readonly: true }` is enforced by the server's helper

### CJS require in ESM context
**Source:** `integrations/system-health-dashboard/server.js` lines 19, 22, 3870
```javascript
import { createRequire } from 'node:module';
const require_cjs = createRequire(import.meta.url);
// ...
const Database = require_cjs('better-sqlite3');
```
**Apply to:** Only if any new JS module needs `better-sqlite3` directly. Prefer passing the db handle from server.js instead.

### Singleton service with lazy/eager init
**Source:** `src/embedding/embedding-service.ts` lines 97–108
```typescript
let instance: EmbeddingService | null = null;
export function getEmbeddingService(): EmbeddingService {
  if (!instance) instance = new EmbeddingService();
  return instance;
}
```
**Apply to:** `retrieval-service.js` — expose `getRetrievalService()` factory so server.js can hold one instance across requests.

### Guard against missing optional table
**Source:** `server.js` lines 4106–4108, 4172–4175
```javascript
try { db.prepare('SELECT 1 FROM insights LIMIT 0').get(); } catch {
    return res.json({ data: [], total: 0 });
}
```
**Apply to:** `keyword-search.js` — wrap each tier search in try/catch returning `[]`.

### ESM import path convention
**Source:** `integrations/system-health-dashboard/server.js` line 18
```javascript
import { runIfMain } from '../../lib/utils/esm-cli.js';
```
**Apply to:** All `src/retrieval/*.js` files — use relative paths with `.js` extension (ESM requires explicit extensions). Imports from `src/embedding/` use `../../src/embedding/embedding-service.js` (two directories up from `src/retrieval/`).

---

## No Analog Found

All files have close analogs. No fallback to RESEARCH.md-only patterns needed.

| File | Role | Data Flow | Analog Quality |
|------|------|-----------|----------------|
| `src/retrieval/rrf-fusion.js` | utility | transform | No RRF in codebase — implement from RESEARCH.md Pattern 2 (standard algorithm, low risk) |

---

## Metadata

**Analog search scope:** `integrations/system-health-dashboard/`, `src/knowledge-management/`, `src/embedding/`, `src/inference/`
**Files scanned:** 7 (server.js, embedding-service.ts, qdrant-collections.ts, KnowledgeQueryService.js, KnowledgeRetriever.js, QdrantSyncService.js, BudgetTracker.js)
**Pattern extraction date:** 2026-04-24
