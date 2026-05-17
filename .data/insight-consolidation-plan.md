# Insight Consolidation Plan

_Source data: `.data/observation-export/insights.json` (70 insights, 2026-05-17)_
_Audit input: `.data/knowledge-audit-report.md` (Jaccard ≥ 0.3 on identifier-tokenised topics)_

## Cluster classification

Two actions:
- **MERGE** — collapse into one canonical insight. Older/lower-confidence members are absorbed; their `digestIds` and `summary` content fold into the canonical entry.
- **FACET** — keep both insights, mark them as related sub-topics of a shared parent concept via `metadata.relatedInsightIds`.

### Cluster 1 — Knowledge Context Injection (4 insights) — **MIXED**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `df7d4f50` | Knowledge Context Injection — Embedding Pipeline | 0.90 | 60 | **keep as canonical** for "Embedding Pipeline" facet |
| `6f29d110` | Knowledge Context Injection — Hook and Agent Adapters | 0.90 | 30 | **keep** as "Hook and Agent Adapters" facet |
| `37043e75` | Knowledge Context Injection — Retrieval Relevance and Deduplication | 0.85 | 30 | **keep** as "Retrieval Relevance and Deduplication" facet |
| `0cbb482a` | Embedding Pipeline (Phase 28) | 0.50 | 4 | **MERGE into `df7d4f50`** — weak, partial, narrower scope |

→ Result: 4 → 3 insights. Link the 3 survivors via `metadata.relatedInsightIds` to form a "Knowledge Context Injection" facet group.

### Cluster 2 — Enhanced Transcript Monitor (3 insights) — **MERGE**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `e843400b` | Enhanced Transcript Monitor (ETM) | 0.90 | 90 | **canonical** (highest digest count) |
| `b4710bf3` | Enhanced Transcript Monitor (ETM) | 0.90 | 30 | merge — identical topic, different angle |
| `4bf35389` | Transcript Monitor / ETM Stability | 0.85 | 30 | merge — same daemon, "stability" angle |

→ Result: 3 → 1 insight.

### Cluster 3 — LLM CLI Proxy (2 insights, but really 3) — **MERGE + extend cluster**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `dec1c5e6` | LLM CLI Proxy — VPN/Corporate Network Detection | 0.95 | 101 | **canonical** |
| `722fb941` | LLM CLI Proxy | 0.75 | 7 | merge |
| _(missed by audit)_ "LLM Proxy and Network Detection" | _0.9_ | _?_ | should also merge here — algorithm recall miss |

→ Result: 3 → 1 insight. The audit's Jaccard missed the third because token order diverged; consolidation algo needs embeddings (see Algorithm Design below).

### Cluster 4 — System Health Dashboard Frontend (2 insights) — **FACET**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `59be9148` | System Health Dashboard — Frontend Pages and Service Architecture | 0.92 | 151 | **keep** as "architecture" facet |
| `5871c5a8` | System Health Dashboard — Frontend Build, Deployment, and Visualization Components | 0.75 | 3 | **keep** as "build/deploy" facet |

→ Result: 2 → 2 (link as facets). They cover different concerns; merging would lose structure.

### Cluster 5 — Observations API Server (2 insights) — **MERGE**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `baca2d4b` | Observations API Server — Host-API Pattern | 0.90 | 67 | **canonical** |
| `c8e5cc24` | Observations API Server — Host-Side HTTP Wrapper and Process Lifecycle | 0.85 | 28 | merge |

→ Result: 2 → 1 insight.

### Cluster 6 — Observation Pipeline (2 insights) — **MERGE**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `82a5d333` | Observation Pipeline — ObservationWriter and Deduplication | 0.90 | 164 | **canonical** |
| `3110b272` | Observations Pipeline — SQLite Database and ObservationWriter | 0.90 | 30 | merge |

→ Result: 2 → 1 insight.

### Cluster 7 — MCP Server Configuration (2 insights) — **MERGE**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `b19446bf` | MCP Server Configuration | 0.85 | 30 | **canonical** |
| `11c6af1b` | MCP Server Configuration for AI Coding Agents | 0.70 | 30 | merge |

→ Result: 2 → 1 insight.

### Cluster 8 — Observations Dashboard (2 insights) — **MERGE**

| id | topic | conf | digests | verdict |
|---|---|---|---|---|
| `7861723a` | Observations Dashboard | 0.80 | 30 | **canonical** |
| `c3c65d92` | Observations Dashboard Auto-Refresh | 0.50 | 4 | merge — auto-refresh is a feature, not a separate concept |

→ Result: 2 → 1 insight.

## Net effect

| | Before | After |
|---|---|---|
| Insights count | 70 | 70 − 11 = **59** |
| MERGE collapses | — | 6 clusters, 13→6 |
| FACET groups | — | 2 (Knowledge Context Injection facet ×3, Dashboard Frontend facet ×2) |
| Recall miss | — | LLM Proxy cluster algorithm missed 1 sibling |

## Recall miss → algorithm design implications

The audit caught 19/70 in clusters using identifier-tokenised Jaccard. But manual inspection revealed:

- **LLM CLI Proxy** cluster should include ≥ 3 insights, audit only caught 2. Sibling "LLM Proxy and Network Detection" used divergent tokens.
- Likely there are 2–3 more silently missed clusters at this scale.

A production consolidation algorithm cannot rely on token-Jaccard alone. It must use **embedding cosine** (the project already runs MiniLM/Qdrant for retrieval) to catch paraphrases.

---

## Consolidation pipeline as it stands today

`ObservationConsolidator.synthesizeInsights()` already does **two** dedup checks per new insight, but both are too strict:

1. **Embedding cosine** via `_findSimilarInsightId()` at `INSIGHT_DEDUP_THRESHOLD = 0.93` (`ObservationConsolidator.js:31`). The threshold is set so high it only catches near-identical paraphrases. MiniLM cosine for genuinely related insight topics ("ETM" vs "Transcript Monitor / ETM Stability") lands in the 0.75–0.90 band — well under the gate.

2. **Exact topic match** scoped by project (`ObservationConsolidator.js:1186`). Misses any topic where the LLM rephrased the heading.

The LLM prompt (`_buildInsightPrompt` line 1507) instructs *"Topic names should be stable across updates (don't rename topics)"* — but the LLM regenerates topics from scratch each chunk, so this is aspirational. Once a topic drifts, both dedup checks miss it forever.

### What the code does NOT do

- **No re-consolidation pass.** `synthesizeInsights()` only runs over *unsynthesized* digests (LEFT JOIN insights ON digest_ids). Once insights are created, they never re-enter the dedup pipeline — even if a sibling appears in a later run.
- **No facet/sibling concept.** The only outcome is "merge into existing" or "insert new". There is no way to express "these N insights are related sub-topics of one parent concept."
- **No cluster-aware LLM prompting.** When the LLM emits 3 sibling insights in the same chunk, nothing groups them after the fact.

## Required consolidation changes

### 1. Loosen the dedup gates (small change, high impact)

In `ObservationConsolidator.js`:

- Drop `INSIGHT_DEDUP_THRESHOLD` from **0.93 → 0.82** (still conservative; catches paraphrases without false-merging unrelated topics).
- After the embedding check, add a **topic-Jaccard secondary band**: tokenise both topic strings with camelCase splitting (as in `scripts/audit-knowledge-overlap.mjs`), and merge if Jaccard ≥ 0.6. This catches identifier-style splits that embeddings miss on short strings.

### 2. Add a `metadata.relatedInsightIds` field (schema-compatible)

The `metadata` column is already a JSON blob — no DDL needed. Two write paths add or update this list:

- During `synthesizeInsights`: when the new dedup check finds a *borderline* match (cosine 0.70–0.82, or Jaccard 0.3–0.6), don't merge; emit both as siblings with cross-links.
- During the new compaction pass (below): explicit sibling links are written.

### 3. Add `compactInsights()` pass (new method)

Periodic (weekly) job that re-examines **all existing insights**, not just freshly-synthesized ones:

```
for project in projects:
  embed all insight topics
  cluster by cosine ≥ 0.75
  for each multi-member cluster:
    prompt LLM with the cluster + this rubric:
      - "MERGE if these all describe the same subsystem"
      - "FACET if they describe distinct sub-topics of one concept"
      - "SEPARATE if false-positive cluster (just shared vocabulary)"
    apply the verdict: UPDATE+absorb, or write relatedInsightIds, or no-op
```

The compaction pass is what makes the system *self-healing*: today's `synthesizeInsights` is one-shot per digest set; `compactInsights` runs over the whole corpus on a cadence.

### 4. One-shot migration now (this script)

Apply the 8 classified clusters above against the live SQLite DB. This catches up the existing 70 insights to the state the new pipeline will maintain going forward.

## Migration order

1. Apply the one-shot consolidation to fix today's data (`scripts/consolidate-insight-clusters.mjs`).
2. Lower thresholds and add Jaccard band (`ObservationConsolidator.js` constants + `_findSimilarInsightId`).
3. Add `relatedInsightIds` writes during normal synthesis (borderline-match handling).
4. Add the periodic `compactInsights()` pass + wire it into the consolidation runner.

Steps 1–2 are hours of work each. Step 3 is half a day. Step 4 is the bigger lift — ~1–2 days including the LLM prompt design and a dry-run mode.

