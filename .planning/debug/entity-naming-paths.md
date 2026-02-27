# Entity Naming Paths — Root Cause Investigation

**Date:** 2026-02-27
**Status:** Research complete (no code changes made)
**Scope:** Why mangled lowercase-concatenated entity names persist after Phase 01 fixes

---

## Summary

Phase 01 fixed `toPascalCase()`, `generateCleanEntityName()`, and `generateEntityName()` in
`observation-generation-agent.ts`. However, broken names persist because:

1. The fixed functions still fail on all-lowercase concatenated input tokens
2. Multiple entity-naming code paths BYPASS the fixed functions entirely
3. `insight-generation-agent.ts` has entirely separate naming functions with their own bugs

---

## Question 1: What code paths produce broken names?

### Fixed functions (Phase 01) — still have one edge-case bug

File: `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts`

```typescript
private toPascalCase(input: string): string {
  const words = input
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // splits camelCase
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0);
  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // preserves rest of word
    .join('');
}
```

**Residual bug**: Splits on hyphens, underscores, camelCase, and spaces — but NOT on all-lowercase
concatenated strings. If a token like `"pathanalyzerimplementation"` arrives as a single word
(no separators, no camelCase), `.slice(1)` preserves the lowercase body:
`"Pathanalyzerimplementation"` — the full string in lowercase with only the first letter capitalized.

Same bug exists in `generateCleanEntityName()` — the `.map(word => word.charAt(0).toUpperCase() + word.slice(1))` line.

### Unfixed bypass paths in observation-generation-agent.ts

**Path A — `createEntityObservation()` (line ~971)**

Uses `entity.name` with NO normalization whatsoever:

```typescript
private async createEntityObservation(entity: any): Promise<StructuredObservation | null> {
  if (!entity.name) return null;
  return {
    id: `entity-${entity.name}-${Date.now()}`,
    name: entity.name,          // RAW - no toPascalCase called
    entityType: entity.type || entity.entityType || 'Unclassified',
    // ...
  };
}
```

Source data: entities from `SemanticAnalysisAgent` (code graph entities, batch entities).
If the upstream semantic analysis produced a bad name, it is stored verbatim.

**Path B — `createSessionObservation()` (lines ~663-671)**

Has its own inline naming logic with the SAME all-lowercase-word bug:

```typescript
const entityName = summary
  .substring(0, 60)
  .replace(/[^a-zA-Z0-9\s]/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')   // splits camelCase only
  .trim()
  .split(/\s+/)
  .slice(0, 5)
  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))  // SAME BUG: preserves lowercase body
  .join('');
```

This inline code was NOT touched in Phase 01. Same root failure as the fixed functions.

**Path C — `createPatternObservation()` (line ~1180)**

Uses `pattern.name` directly:

```typescript
const patternName = pattern.name || 'UnknownPattern';
return {
  name: patternName,   // RAW - no normalization
  // ...
};
```

Source data: patterns produced by `InsightGenerationAgent`. If that agent produced a broken
pattern name, it passes through unchanged.

**Path D — `createInsightDocumentObservation()` (line ~1042)**

Uses `insightDoc.name` directly:

```typescript
const cleanName = insightDoc.name || 'UnknownInsight';
return {
  name: cleanName,   // RAW - no normalization
  // ...
};
```

Source data: insight documents from `InsightGenerationAgent`.

### Callers that DO use the fixed generateEntityName (WORKING paths)

- `createArchitecturalDecisionObservation()` — with LLM entityName fallback
- `createCodeEvolutionObservation()` — with LLM entityName fallback
- `createProblemSolutionObservation()` — always calls `generateEntityName('ProblemSolution', pair.problem.description)`
- `createContextGroupObservation()` — always calls `generateEntityName('DevelopmentContext', type)`

These paths use the fixed function but still fail when the input description contains
all-lowercase concatenated tokens (see residual bug above).

---

## Question 2: Are broken entities coming from a different agent?

YES — broken entity names originate from multiple agents:

### observation-generation-agent.ts (3 sub-paths)

1. `createEntityObservation()` — no normalization, takes raw name from SemanticAnalysisAgent output
2. `createSessionObservation()` — own inline logic with all-lowercase-word bug
3. `createProblemSolutionObservation()` / `createContextGroupObservation()` — uses fixed
   `generateEntityName()` which still fails on all-lowercase concatenated input

### insight-generation-agent.ts (3 separate naming functions)

File: `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts`

These functions are entirely independent of the Phase 01 fixes.

**`generateMeaningfulPatternName()` (line ~4503)**

```typescript
private generateMeaningfulPatternName(rawPattern: string): string {
  const words = rawPattern.trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .filter(word => word.length > 0);
  if (words.length === 1) return `${words[0]}Pattern`;
  const camelCase = words[0] + words.slice(1).join('');  // BUG: no uppercase on subsequent words
  // ...
}
```

Bug: `words.slice(1).join('')` does NOT capitalize subsequent words — each subsequent word had
`.toLowerCase()` applied and is then joined with no capitalization. Result:
`"Code Refactoring"` → words = `["Code", "refactoring"]` → `"Code" + "refactoring"` = `"Coderefactoring"` → `"CoderefactoringPattern"`

Called from: `createImplementationPattern()`

**`generateMeaningfulNameAndTitle()` (line ~1478)**

```typescript
filename = topPattern.name.replace(/\s+/g, '');   // just removes spaces, no PascalCase
```

Works when input has spaces (`"Polyglot Codebase Architecture"` → `"PolyglotCodebaseArchitecture"`
— correct by accident because each word already starts uppercase). Fails when input is
all-lowercase: `"pathanalyzerimplementation"` → `"pathanalyzerimplementation"` unchanged.

**`formatPatternName()` (line ~4982)**

Used in `parseArchitecturalPatternsFromLLM()`:

```typescript
private formatPatternName(rawName: string): string {
  const words = rawName
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')    // only splits camelCase
    .split(/\s+/)
    .filter(w => w.length > 0);
  const pascalCase = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // preserves lowercase body
    .join('');
  return pascalCase.endsWith('Pattern') ? pascalCase : pascalCase + 'Pattern';
}
```

Same root bug as `toPascalCase()` — all-lowercase concatenated tokens are not split.

---

## Question 3: What pattern creates names like "PathanalyzerimplementationProblemImplementingPath"?

### Dissecting the specific bad names

**"PathanalyzerimplementationProblemImplementingPath"**

Structure: `[AllLowercaseToken][TypeWord][DescWords]`

Produced by `generateEntityName('ProblemSolution', description)`:
```
typeFormatted = toPascalCase("ProblemSolution") = "ProblemSolution"
cleaned = toPascalCase("path analyzer implementation problem implementing path")
```

BUT if the description arrived as a single concatenated string
`"pathanalyzerimplementation problem implementing path"`, then:
- `split(/\s+/)` gives: `["pathanalyzerimplementation", "problem", "implementing", "path"]`
- `.map(word => word.charAt(0).toUpperCase() + word.slice(1))` gives:
  `["Pathanalyzerimplementation", "Problem", "Implementing", "Path"]`
- slice(0, 4) then join: `"PathanalyzerimplementationProblemImplementingPath"`

The first token was already a concatenated lowercase string in the input data. `toPascalCase`
only capitalizes the first letter of each space-separated token — it does not know where word
boundaries are within `"pathanalyzerimplementation"`.

**"ComprehensiveknowledgegraphDecisionImplementComprehensive"**

Same mechanism. The description or type field contained `"comprehensiveknowledgegraph"` as a
single space-separated token (all lowercase, no camelCase boundaries). `toPascalCase` produced
`"Comprehensiveknowledgegraph"`.

**"SemanticanalysisrefactoringProblemTightCoupling"**

Same — `"semanticanalysisrefactoring"` was a single token in the source description, producing
`"Semanticanalysisrefactoring"`.

### Why the input tokens arrive all-lowercase and concatenated

The LLM (GitHistoryAgent, VibeHistoryAgent) produces description strings where, apparently,
multi-word concepts are sometimes run together without spaces in the raw JSON output. For example,
instead of `"path analyzer implementation"`, the model emits `"pathanalyzerimplementation"`.
The `generateEntityName` pipeline receives this pre-concatenated token and cannot recover word
boundaries.

---

## Question 4: Are broken-name entities pre-existing or newly created?

### Direct answer: Cannot confirm with certainty

The knowledge graph export at `.data/knowledge-export/coding.json` was blocked by the
`knowledge-base-direct-manipulation` constraint and could not be read. Without timestamp
inspection of individual entities, we cannot definitively distinguish pre-existing entities
from post-fix entities.

### Analysis-based inference

**Pre-existing entities (before Phase 01 fix)**: All entities created before the fix would
have broken names from the old, unfixed `toPascalCase`. This is a baseline of broken names
that persists in the graph unless explicitly purged and regenerated.

**Post-fix entities that are still broken**: Any entity created AFTER Phase 01 through:
- `createEntityObservation()` — no normalization path, any source
- `createSessionObservation()` — own inline logic (not fixed in Phase 01)
- `createPatternObservation()` — raw pattern.name from InsightGenerationAgent
- `createInsightDocumentObservation()` — raw insightDoc.name from InsightGenerationAgent
- Any of the `insight-generation-agent.ts` naming functions (not touched in Phase 01)
- `generateEntityName()` called with all-lowercase concatenated input tokens (residual bug)

**Implication**: Even if all pre-existing entities are purged, new UKB runs will continue
producing broken names through the unfixed paths.

---

## File Map: All Entity Naming Functions

| File | Function | Bug Type | Used By |
|------|----------|----------|---------|
| observation-generation-agent.ts | `toPascalCase()` | All-lowercase token not split | generateEntityName, generateCleanEntityName |
| observation-generation-agent.ts | `generateCleanEntityName()` | Same as toPascalCase | createSemanticInsightObservation |
| observation-generation-agent.ts | `generateEntityName()` | Delegates to toPascalCase (residual bug) | createProblemSolution, createContextGroup, createArchitecturalDecision, createCodeEvolution |
| observation-generation-agent.ts | `createEntityObservation()` | NO normalization — raw entity.name | Entities from SemanticAnalysisAgent |
| observation-generation-agent.ts | `createSessionObservation()` (inline) | All-lowercase token not split | Entities from VibeHistoryAgent sessions |
| observation-generation-agent.ts | `createPatternObservation()` | NO normalization — raw pattern.name | Patterns from InsightGenerationAgent |
| observation-generation-agent.ts | `createInsightDocumentObservation()` | NO normalization — raw insightDoc.name | Docs from InsightGenerationAgent |
| insight-generation-agent.ts | `generateMeaningfulPatternName()` | Subsequent words not capitalized (camelCase bug) | createImplementationPattern |
| insight-generation-agent.ts | `formatPatternName()` | All-lowercase token not split | parseArchitecturalPatternsFromLLM |
| insight-generation-agent.ts | `generateMeaningfulNameAndTitle()` | Space-removal only, no PascalCase | Insight document naming |

---

## Root Cause Summary

The Phase 01 fix was incomplete in three ways:

1. **Residual bug in fixed functions**: `toPascalCase` and `generateCleanEntityName` still fail
   when input contains single all-lowercase concatenated tokens (no boundaries to split on).
   The `.map(word => first.toUpper + rest)` preserves lowercase body of each split token.

2. **Bypass paths not addressed**: Four paths in `observation-generation-agent.ts` use raw names
   from upstream agents with zero normalization (`createEntityObservation`, `createPatternObservation`,
   `createInsightDocumentObservation`, `createSessionObservation` inline logic).

3. **insight-generation-agent.ts not addressed**: Three separate naming functions in this file
   were not modified in Phase 01 and independently produce broken names before the names even
   reach `observation-generation-agent.ts`.

The broken names appearing in the knowledge graph are produced by a combination of all three
failure modes — some pre-existing from before Phase 01, others generated fresh on each UKB run
through the unfixed paths.
