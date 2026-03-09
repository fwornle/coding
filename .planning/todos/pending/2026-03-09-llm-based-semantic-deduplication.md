---
created: 2026-03-09T12:22:45.169Z
title: LLM-based semantic deduplication
area: pipeline
files:
  - integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts
  - integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts
---

## Problem

Deduplication currently uses deterministic string matching only — exact name match plus Levenshtein-style fuzzy `calculateNameSimilarity()`. This misses semantically equivalent entities like "LLMService" vs "LLM Service Manager" or "PersistenceModule" vs "Persistence Layer" that have different names but represent the same concept.

The trace modal confirms dedup makes 0 LLM calls — it's purely algorithmic. For a knowledge graph that aims to be a canonical source of truth, semantic duplicates degrade quality.

## Solution

Add LLM-based semantic similarity as a dedup strategy in the kg-operators dedup operator:
- After fuzzy string match pass, run an LLM pass on remaining entity pairs with name similarity > 0.5 but < threshold
- LLM judges whether two entities are semantically equivalent given their names, observations, and hierarchy context
- Merge the less-specific entity into the more-specific one
- Also apply in persistence-agent's `findFuzzyMatch()` for incremental dedup during persistence
- Budget: limit LLM dedup calls per wave (e.g., max 10 comparisons) to avoid runaway costs
