# Pitfalls Research

**Domain:** UKB Multi-Agent Analysis Pipeline (mcp-server-semantic-analysis)
**Researched:** 2026-02-26
**Confidence:** HIGH — all findings traced to specific code paths, log files, and git history

---

## Critical Pitfalls

### Pitfall 1: LLM Output Format Mismatch in Pattern Extraction

**What goes wrong:**
The `extractArchitecturalPatternsFromCommits` method sends a prompt asking the LLM to format output as plain text (`Pattern: [Name]` / `Description: [text]` / `Significance: [1-10]`). The LLM (Groq llama-3.3-70b) consistently returns markdown-numbered-list format. The parser never matches. Result: 0 patterns extracted, 0 insight documents generated.

**Why it happens:**
The prompt in `insight-generation-agent.ts` ~line 3800 specifies:
```
OUTPUT FORMAT:
For each pattern found, use this format:
Pattern: [Specific Descriptive Name]
Description: [...]
Significance: [1-10]
```
But Groq returns:
```markdown
#### 1. KnowledgeBaseUpdatePattern
- **Description**: ...
- **Significance**: 8/10
```
The parser regex `^(Pattern|Architecture|Design):\s*(.+)` (line 4818) does NOT match `1. **Pattern: KnowledgeBaseUpdatePattern**`.

**Evidence:**
- `/Users/Q284340/Agentic/coding/logs/pattern-extraction-result-1769877223136.json`: `totalPatterns: 0` despite 10 valid patterns in LLM response
- `/Users/Q284340/Agentic/coding/logs/pattern-extraction-result-1769877208698.json`: Shows LLM returned `"1. **Pattern: KnowledgeGraphUpdatePattern**"` — parser could not match it
- Code: `src/agents/insight-generation-agent.ts`, `parseArchitecturalPatternsFromLLM()`, line pattern match

**How to avoid:**
Change the prompt to request JSON output with a schema, then parse JSON. Alternatively, extend the regex to handle markdown formats: `^\d+\.\s+\*{0,2}(Pattern|Architecture):\s*\*{0,2}(.+)`.

**Warning signs:**
- `pattern-extraction-result-*.json` in `logs/` shows `totalPatterns: 0` with non-empty LLM response
- Workflow completes but `generate_insights.insights_generated === 0`

**Phase to address:** Phase 1 (core pipeline fix)

---

### Pitfall 2: toPascalCase Destroys Interior Capitals in Entity Names

**What goes wrong:**
Entities get mangled names like `PathanalyzerpatternProblemHowConsider` instead of `PathAnalyzerPatternProblemHowConsider`.

**Why it happens:**
Commit `ee72322` (Feb 15, 2026) introduced `toPascalCase()` in `observation-generation-agent.ts`:
```typescript
return words
  .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  .join('');
```
When splitting "PathAnalyzerPattern" on camelCase boundaries → ["Path", "Analyzer", "Pattern"] → lowercasing each tail → "Pathanalyzerpattern". Additionally, type and description are concatenated: `${typeFormatted}${descriptionFirst4Words}` where description = "Problem: How to consider both" → first 4 words = "Problem How Consider Both" → "PathanalyzerpatternProblemHowConsider".

**Evidence:**
- `coding.json` entities: `PathanalyzerpatternProblemHowConsider`, `RealtimetrajectoryanalyzerpatternProblemHowKeep`, `ConstraintmonitorimplementationProblemImplementingConstraint`
- Code: `src/agents/observation-generation-agent.ts`, `toPascalCase()` method, line ~1680; `generateEntityName()` method, line ~1657

**How to avoid:**
Fix `toPascalCase` to use `.slice(1)` without `.toLowerCase()`:
```typescript
.map(word => word.charAt(0).toUpperCase() + word.slice(1))
```
Also reconsider concatenating `type + description`: the type prefix often adds noise (e.g., "ProblemSolution") — use description words only.

**Warning signs:**
- Entity names contain consecutive lowercase letters where PascalCase words should be: `Pathanalyzerpattern` vs `PathAnalyzerPattern`
- Entity names contain generic English words in the middle: `ProblemHowConsider`

**Phase to address:** Phase 1 (core pipeline fix)

---

### Pitfall 3: Observations Are Template-Filled Commit-Message Paraphrases

**What goes wrong:**
Observations read like: "When working with api in this codebase, changes often span multiple modules. Key files: `enhanced-transcript-monitor.js`..." This is a slot-filled template using file names from commit diffs, not semantic analysis.

**Why it happens:**
`observation-generation-agent.ts`, `createArchitecturalDecisionObservation()` generates hardcoded templates:
```typescript
content: `When working with ${decision.type} in this codebase, changes often span multiple modules. Key files: ${keyFiles}`
content: `This ${decision.type} pattern is applicable when building ${techList} systems...`
```
Where `techList` is derived from file extensions via `extractTechnologiesFromFiles()` — returning `"JSON, JavaScript, Markdown"` from commit file paths.

The upstream `git-history-agent.ts`, `identifyArchitecturalDecisions()` uses keyword matching to produce:
```typescript
description: `Pattern implementation: ${commit.message}` // verbatim commit message
```
So the pipeline: commit message → architectural decision description → template observation.

**Evidence:**
- `/Users/Q284340/Agentic/coding/logs/persist-trace-1769877196254.json`: Entity `ApiHandlesExternalCommunication` observations contain `"When working with api in this codebase..."` and `"This api pattern is applicable when building JSON, JavaScript, Markdown systems..."`
- `src/agents/observation-generation-agent.ts`, `createArchitecturalDecisionObservation()`: hardcoded template strings at lines ~303-322
- `src/agents/git-history-agent.ts`, `identifyArchitecturalDecisions()` lines ~574-610: commit message prefix templates

**How to avoid:**
Replace template generation with LLM-synthesized observations. The `createEntityObservation()` method already does LLM synthesis correctly. Apply the same pattern to `createArchitecturalDecisionObservation()`. The `analyzeGitAndVibeData()` LLM call in `semantic-analysis-agent.ts` already extracts real patterns — ensure those flow to observation generation rather than the keyword-matched decisions.

**Warning signs:**
- Observations contain the phrase "When working with X in this codebase, changes often span multiple modules"
- "This X pattern is applicable when building Y, Z systems"
- Technologies listed are file extensions (JSON, JavaScript, Markdown) not actual frameworks

**Phase to address:** Phase 1 (critical fix) and Phase 2 (LLM-based quality)

---

### Pitfall 4: code_synthesis_results Is Passed as Empty Timing Wrapper Object

**What goes wrong:**
When Memgraph is unavailable, `synthesizeInsights` returns `[]`. After `wrapWithTiming`, the coordinator stores `{_timing: {...}}`. The insight generation agent receives `code_synthesis_results: {_parameters: {...}, _timing: {...}}` and `Array.isArray(result)` returns false — synthesis patterns are never extracted.

**Why it happens:**
`src/agents/code-graph-agent.ts`, `synthesizeInsights()`: when `!connectionCheck.connected`, returns `[]`. An empty array spread with timing info `{...[], _timing: {...}}` produces `{_timing: {...}}` — no synthesis data. The insight agent checks `Array.isArray(codeSynthesisResults)` which is false for the wrapped object.

**Evidence:**
- `/Users/Q284340/Agentic/coding/logs/insight-generation-input-1769877218503.json`:
  ```json
  "code_synthesis_results": {"_parameters": {...}, "_timing": {...}}
  ```
  Only metadata keys, no synthesis array.
- `src/agents/insight-generation-agent.ts` line ~1042: `if (codeSynthesisResults && Array.isArray(codeSynthesisResults) && codeSynthesisResults.length > 0)` — this correctly guards but receives a wrapped object not an array.

**How to avoid:**
`synthesizeInsights` should return a structured skip object when Memgraph is unavailable:
```typescript
return { synthesisResults: [], skipped: true, reason: 'Memgraph unavailable' };
```
OR: unwrap the timing wrapper before passing to insight generation — pass `execution.results['synthesize_code_insights']?.synthesisResults` or similar.

**Warning signs:**
- `insight-generation-input-*.json` shows `code_synthesis_results` with only `_parameters` and `_timing` keys
- Code synthesis log shows "Memgraph not connected, skipping synthesis"

**Phase to address:** Phase 1 (defensive coding)

---

### Pitfall 5: Silent Skip of Insight Generation With No User Visibility

**What goes wrong:**
When `generateComprehensiveInsights` finds 0 significant patterns after filtering, it returns `{skipped: true, insights_generated: 0}`. The workflow reports "completed" with no indication that insight documents were not generated.

**Why it happens:**
The filter chain in `generateComprehensiveInsights`:
1. `significance < 3` filter (removes all patterns if extraction returned 0)
2. `THIN_PATTERN_NAMES` filter (removes statistical-only patterns from code-graph)
3. Statistical-only evidence filter

All three can combine to remove all patterns. The resulting skip is silent from the user's perspective.

**Evidence:**
- `src/agents/insight-generation-agent.ts` lines ~800-824: returns `{skipped: true, skip_reason: '...', insights_generated: 0}` with no error
- The coordinator stores this as a success: `execution.results['generate_insights'] = this.wrapWithTiming(insightResult, ...)`

**How to avoid:**
Fix the root cause (Pitfall 1 — pattern extraction). Additionally, surface the skip reason in the workflow progress file and the workflow report summary so it appears in the dashboard.

**Warning signs:**
- Workflow dashboard shows `generate_insights: completed` with 0 documents
- `workflow-progress.json` shows step completed with `insights_generated: 0`

**Phase to address:** Phase 1 (root cause fix) + Phase 3 (observability)

---

## Moderate Pitfalls

### Pitfall 6: generateEntityName Type Prefix Makes Names Opaque

**What goes wrong:**
`generateEntityName('ProblemSolution', "PathAnalyzerPattern - Problem: How to consider both")` produces `ProblemhowconsiderBoth` — the meaningful part (PathAnalyzer) is buried.

**Why it happens:**
The function takes first 4 words of description after removing special chars: "PathAnalyzerPattern Problem How Consider" → first 4 = "PathAnalyzerPattern Problem How Consider" → with toPascalCase bug → "Pathanalyzerpattermproblemhowconsider".

**How to avoid:**
Use `generateCleanEntityName` (which filters filler words and rejects garbage) instead of `generateEntityName` for all observation creation paths. Or: extract the entity's main subject from the description using LLM, not just first 4 words.

**Phase to address:** Phase 1 or Phase 2

---

### Pitfall 7: Significance Values Stored as Fractions in Knowledge Export

**What goes wrong:**
All entities in `coding.json` show `significance: 0.5` or `significance: 0.7` instead of integer values 1-10.

**Why it happens:**
`UKBDatabaseWriter.storeEntity` converts: `confidence: (significance || 5) / 10`. `GraphDatabaseService.getEntities` reads: `significance: attributes.significance || attributes.confidence`. Since the stored key is `confidence` (not `significance`), it reads the fraction. The export passes it through unchanged.

**How to avoid:**
`GraphDatabaseService.getEntities()` should normalize: `significance: attributes.significance ? attributes.significance : Math.round((attributes.confidence || 0.5) * 10)`.

**Phase to address:** Phase 3 (data quality cleanup)

---

### Pitfall 8: 50-Observation Cap Retains Low-Quality Template Observations

**What goes wrong:**
`kg-operators.ts` `mergeEntities()` caps observations at 50 (FIFO, keeping most recent). Entities that were created with template-based observations early in the batch accumulate 50 low-quality observations, blocking higher-quality later observations.

**How to avoid:**
Apply quality ranking before the cap: prefer observations with code references (backtick-enclosed identifiers), specific file paths, or longer/more detailed text. Short template strings should rank lowest.

**Phase to address:** Phase 2 (quality improvement)

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Pattern extraction LLM prompt | Groq returning markdown instead of plain text | Request JSON output with schema; parse JSON not line-by-line |
| Entity naming | toPascalCase bug destroys capitals | Fix `.toLowerCase()` → `.slice(1)` in toPascalCase |
| Observation template removal | Template strings still present in generateFromGitAnalysis | Replace with LLM-synthesized content |
| Memgraph integration | synthesizeInsights returns empty array | Return structured skip object; guard with Array.isArray after unwrapping |
| Significance normalization | Fraction values in export | Normalize in GraphDatabaseService read path |
| Observation quality ranking | FIFO merge drops good observations | Quality-rank before cap |

---

## Sources

- Code inspection: `integrations/mcp-server-semantic-analysis/src/agents/` — all agent files
- Runtime logs: `/Users/Q284340/Agentic/coding/logs/` — pattern extraction, insight generation, persist traces
- Knowledge export: `.data/knowledge-export/coding.json` (57 entities, all significance 0.5-0.7, 0 insight documents)
- Git history: `git show ee72322` — `toPascalCase` bug introduced Feb 15, 2026
- Workflow definition: `config/workflows/batch-analysis.yaml`
- Insight trace: `logs/insight-generation-input-1769877218503.json`

---
*Pitfalls research for: UKB pipeline — zero insights and trivial observations diagnosis*
*Researched: 2026-02-26*
