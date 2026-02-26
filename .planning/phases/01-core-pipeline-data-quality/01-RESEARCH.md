# Phase 1: Core Pipeline Data Quality - Research

**Researched:** 2026-02-26
**Domain:** TypeScript multi-agent pipeline: pattern parsing, entity naming, LLM observation synthesis
**Confidence:** HIGH (all findings from direct codebase inspection + trace log analysis)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Pattern Parsing**: Multi-format parser: handle markdown lists, JSON, plain text. On parse failure: retry with explicit format hints. Keep all extracted patterns across batches. Let the codebase determine what is significant.
- **Entity Naming**: PascalCase descriptive names (target: MVIReduxArchitecturePattern, BatchSchedulerComponent). Hybrid naming: actual code identifiers when available, LLM-generated for abstract patterns. Include type suffix when it adds clarity.
- **Observation Content**: Observations must contain analysis + evidence (what the pattern IS, WHY it matters). No file/line-number references. LLM-synthesized, never template strings or commit-message paraphrases.
- **Analysis Depth**: Switch from 'surface' to 'deep'. Include full file contents in LLM prompts. Include broader context: imports, dependencies, callers. Cross-batch pattern synthesis in finalization pass.
- **Error Visibility**: On step failure: log error clearly and continue pipeline. End-of-run summary: X entities created, Y patterns extracted, Z errors encountered.
- **Batch Boundaries**: Merge batches that touch same files/modules for richer context.
- **Quality Threshold**: Target 30-50 significant entities. Dual-signal: LLM assigns significance (1-10, filter below 5) AND evidence frequency (multiple commits or multiple files). Merge intelligently with existing entities.

### Claude's Discretion
- Model tier selection for pattern extraction
- Retry count on parse failures
- Observation count per entity
- Whether to include pattern evolution from git history
- Handling large files that exceed context windows
- Repo structure context level
- Batch window size optimization
- Logging approach (existing vs structured)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Summary

Phase 1 fixes four concrete bugs in the UKB pipeline, all within `integrations/mcp-server-semantic-analysis/src/`. The bugs are confirmed by direct inspection of source code and the existing `coding.json` knowledge export (57 entities, all at significance 0.5, with identical template observations).

**Bug 1 (PTRN-01/PTRN-02):** `parseArchitecturalPatternsFromLLM()` in `insight-generation-agent.ts` (line 4755) matches only `^(Pattern|Architecture|Design):\s*` prefixes. The LLM consistently returns numbered markdown lists (`1. **KnowledgeGraphPersistencePattern**`) or section headers (`### 1. KnowledgeGraphManagementPattern`) -- neither matches the regex. Confirmed by trace logs in `/logs/pattern-extraction-result-*.json`. Result: zero patterns extracted on every run.

**Bug 2 (NAME-01/NAME-02):** Both `generateCleanEntityName()` (line 1144) in `observation-generation-agent.ts` and `formatPatternName()` (line 4829) in `insight-generation-agent.ts` use `word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()`. This lowercases sub-words in already-PascalCase inputs: `PathAnalyzer` becomes `Pathanalyzer`, `KnowledgeGraph` becomes `Knowledgegraph`. The same flaw exists in `toPascalCase()` at line 1697 of `observation-generation-agent.ts`. Confirmed via Python simulation against actual entity names in `coding.json`.

**Bug 3 (OBSV-01/OBSV-02):** `createArchitecturalDecisionObservation()` (line ~294) and `createCodeEvolutionObservation()` (line ~368) in `observation-generation-agent.ts` use template strings like `"When working with ${decision.type} in this codebase, changes often span multiple modules. Key files: X, Y"`. These produce identical boilerplate for every entity. Working LLM synthesis pattern already exists in `createEntityObservation()` (line 799) -- same pattern needs to be applied to the two broken methods.

**Bug 4 (DATA-03):** `coordinator.ts` line 2637 hard-codes `analysisDepth: 'surface'` for batch semantic analysis. The `semantic-analysis-agent.ts` already defaults to `'deep'` when the option is omitted -- only the caller needs updating.

**Primary recommendation:** Four surgical fixes in three files within `src/agents/`. No architectural changes. No new dependencies.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PTRN-01 | Parser handles markdown-formatted LLM responses (numbered lists, bold markers) | Bug confirmed: `parseArchitecturalPatternsFromLLM()` at line 4755 only matches `Pattern:` prefix. Trace logs show LLM returns `1. **Name**` format. Fix: add regex branches for bold numbered lists and section headers. |
| PTRN-02 | Parser handles JSON-formatted LLM responses as fallback | Same function -- add `JSON.parse()` attempt before line-by-line parsing, looking for `patterns` array or top-level array. |
| PTRN-03 | Pattern extraction produces non-zero patterns from real codebase | Follows from PTRN-01 fix. Trace logs show LLM returns 10+ meaningful patterns per run; parser just fails to extract them. |
| NAME-01 | Entity names use correct PascalCase (PathAnalyzerPattern not Pathanalyzerpattern) | Bug in `formatPatternName()` (insight-generation-agent.ts:4829), `generateCleanEntityName()` (observation-generation-agent.ts:1144), and `toPascalCase()` (observation-generation-agent.ts:1697) -- all use `word.slice(1).toLowerCase()` which destroys sub-word capitalization. Fix: remove the `.toLowerCase()` call. |
| NAME-02 | Entity names are semantically meaningful (not concatenated type + description fragments) | `generateEntityName()` at line 1657 of `observation-generation-agent.ts` prepends type prefix to description words, producing `ProblemSolutionImplementingPathAnalysis`. For LLM-synthesized observations, have the LLM return the entity name directly. |
| OBSV-01 | Observations are LLM-synthesized from actual code analysis, not hardcoded template strings | `createArchitecturalDecisionObservation()` (line ~294) and `createCodeEvolutionObservation()` (line ~368) use slot-filled templates. Replace with LLM synthesis following the working pattern in `createEntityObservation()` (line 799). |
| OBSV-02 | Observations capture architectural patterns and design decisions -- not commit message paraphrases | Same fix as OBSV-01. Template strings reference commit filenames. LLM synthesis produces architectural content when given commit context. |
| DATA-03 | Semantic analysis uses `analysisDepth: 'deep'` instead of `'surface'` | Single line fix in `coordinator.ts` line 2637: `{ analysisDepth: 'surface' }` to `{ analysisDepth: 'deep' }`. The `semantic-analysis-agent.ts` already handles deep mode correctly (line 295: `options.analysisDepth || 'deep'`). |
</phase_requirements>

## Standard Stack

### Core -- No New Dependencies Needed

All fixes are in existing TypeScript source. The codebase already has:
- LLM call infrastructure via `this.semanticAnalyzer.analyzeContent(prompt, options)`
- Working LLM synthesis in `createEntityObservation()` and `createSemanticInsightObservation()`
- `log(message, level, data?)` for all logging
- `async/await` + `Promise.all()` for parallel calls

| Component | Location | Current State |
|-----------|----------|---------------|
| `insight-generation-agent.ts` | `src/agents/` | Bug in `parseArchitecturalPatternsFromLLM()` line 4755 and `formatPatternName()` line 4829 |
| `observation-generation-agent.ts` | `src/agents/` | Bug in `generateCleanEntityName()` line 1144, `toPascalCase()` line 1697, `createArchitecturalDecisionObservation()` line ~294, `createCodeEvolutionObservation()` line ~368 |
| `coordinator.ts` | `src/agents/` | `analysisDepth: 'surface'` hard-coded at line 2637 |
| `semantic-analysis-agent.ts` | `src/agents/` | Already supports 'deep' correctly -- no changes needed |

## Architecture Patterns

### Pattern 1: Multi-Format LLM Response Parser (for PTRN-01/PTRN-02)

Observed LLM output formats from trace logs:

Format A (Groq, numbered bold): `1. **KnowledgeGraphPersistencePattern**: description`
Format B (Claude, section headers): `### 1. KnowledgeGraphManagementPattern\nDescription: ...`
Format C (JSON): `{"patterns": [{"name": "...", "description": "...", "significance": 8}]}`
Format D (current expectation, never observed): `Pattern: KnowledgeGraphPersistencePattern\nDescription: ...`

The fix: try formats in reliability order (JSON first, then markdown numbered, then headers, then original labeled fields).

```typescript
// Replacement for parseArchitecturalPatternsFromLLM() in insight-generation-agent.ts
// Strategy 1: JSON parse (most reliable when LLM complies)
try {
  const cleaned = llmInsights.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
  const parsed = JSON.parse(cleaned);
  const arr = Array.isArray(parsed) ? parsed : (parsed.patterns || []);
  if (arr.length > 0) {
    return arr.map(p => this.finalizePattern({
      name: this.formatPatternName(p.name || p.pattern || 'UnknownPattern'),
      description: p.description || '',
      significance: p.significance || 7,
      category: 'Architecture', evidence: [], relatedComponents: [],
      implementation: { language: 'TypeScript', usageNotes: [] }
    }, commits));
  }
} catch { /* not JSON, continue to line-based strategies */ }

// Strategy 2: Numbered list with bold: "1. **PatternName**: description"
const boldM = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*[:\s]*(.*)/);

// Strategy 3: Section header: "### 1. PatternName"
const headerM = trimmed.match(/^#{1,3}\s+(?:\d+\.\s+)?([A-Z][A-Za-z]+(?:[A-Z][A-Za-z]+)*)/);

// Strategy 4: Original "Pattern: Name" (keep as final fallback)
const labelM = trimmed.match(/^(Pattern|Architecture|Design):\s*(.+)/i);
```

### Pattern 2: Correct PascalCase Preservation (for NAME-01)

The bug is in three places: all use `word.slice(1).toLowerCase()` which destroys existing capitalization.

```typescript
// BUG (current) -- destroys "Analyzer" sub-word in "PathAnalyzer"
words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
// "PathAnalyzer" splits on camelCase boundary to ["Path","Analyzer"]
// then "Analyzer" -> "Analyzer" (ok because charAt(0).toUpperCase() + "nalyzer".toLowerCase() = "Analyzer")
// Wait: slice(1) of "Analyzer" is "nalyzer", .toLowerCase() = "nalyzer", so "A" + "nalyzer" = "Analyzer" -- this IS correct!
// The real bug: for single-word concatenated inputs like "pathanalyzer":
// No camelCase boundary found, stays as one word "pathanalyzer"
// charAt(0).toUpperCase() + slice(1).toLowerCase() = "Pathanalyzer" -- BROKEN

// FIX: Split on camelCase boundary BEFORE any case transformation
private formatPatternName(rawName: string): string {
  const words = rawName
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // "pathAnalyzer" -> "path Analyzer"
    .split(/\s+/)
    .filter(w => w.length > 0);

  const pascalCase = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // Preserves existing case
    .join('');

  return pascalCase.endsWith('Pattern') ? pascalCase : pascalCase + 'Pattern';
}
```

Note: The bug is specifically harmful when the input is a concatenated LLM name like `"pathanalyzerimplementation"` -- the split happens but produces only one token (all lowercase), so `charAt(0).toUpperCase() + slice(1)` gives `"Pathanalyzerimplementation"`. The fix: split on camelCase boundaries (added `replace(/([a-z])([A-Z])/, '$1 $2')`) so `"PathAnalyzer"` splits to `["Path", "Analyzer"]` which then maps correctly.

### Pattern 3: LLM Synthesis for Architectural Decision Observations (for OBSV-01/OBSV-02)

Existing working pattern from `createEntityObservation()` at line 799:

```typescript
const prompt = `Synthesize a concise, actionable observation from this entity data:
Entity: ${entity.name}
Type: ${entity.type}
Raw Observations: ${rawContent}

Provide JSON: { "synthesizedContent": string, "keyPattern": string|null,
                "actionableGuidance": string, "confidence": number }`;

const result = await this.semanticAnalyzer.analyzeContent(prompt, {
  analysisType: "general", provider: "auto", taskType: "observation_generation"
});
synthesizedObservation = JSON.parse(result.insights);
```

Apply same pattern to `createArchitecturalDecisionObservation()`:

```typescript
const relatedCommits = (gitAnalysis.commits || [])
  .filter((c: any) => c.files?.some((f: any) => (decision.files || []).includes(f.path)))
  .slice(0, 5)
  .map((c: any) => `- ${c.message}`)
  .join('\n') || '(no specific commits identified)';

const prompt = `Analyze this architectural decision and synthesize a meaningful insight.

Decision Type: ${decision.type}
Description: ${decision.description}
Impact: ${decision.impact}
Related commits:
${relatedCommits}

Respond with JSON:
{
  "entityName": string,
  "whatItIs": string,
  "whyItMatters": string,
  "guidance": string
}`;

const result = await this.semanticAnalyzer.analyzeContent(prompt, {
  analysisType: 'patterns', provider: 'auto', taskType: 'observation_generation'
});

const synthesized = JSON.parse(
  result.insights.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim()
);
```

### Anti-Patterns to Avoid

- **Generating entity names from raw description strings with `.toLowerCase()`:** Creates `Pathanalyzer` not `PathAnalyzer`. Always split on camelCase boundaries BEFORE applying case transformation.
- **Assuming LLM format compliance:** The prompt says "use this format" but the LLM ignores it. Parser must accept multiple formats.
- **Throwing on parse failure:** Context says log and continue. Partial results are better than nothing.
- **Template strings for observations:** Any observation that does not come from LLM synthesis of actual code will be useless boilerplate.
- **`JSON.parse()` without try/catch:** LLMs frequently wrap JSON in markdown code fences. Strip them before parsing.
- **Using `RegExp.$1` / `RegExp.$2` for capture groups:** These are global state. Use destructured match object instead: `const m = str.match(regex); if (m) { const captured = m[2]; ... }`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PascalCase conversion | New custom parser | Fix existing `toPascalCase()` and `formatPatternName()` | Three instances of same bug -- fix all three consistently |
| LLM response format enforcement | Custom schema validator | Multi-strategy parser + prompt engineering | LLM won't follow strict schemas reliably |
| Parallel LLM calls | New parallel infrastructure | `Promise.all()` already used in `createSemanticInsightObservation()` | Pattern already in codebase |
| New observation data structures | New types | Existing `ObservationTemplate` with `type` field | Type system already supports all needed obs types |

**Key insight:** All infrastructure for correct behavior already exists in the codebase. `createEntityObservation()` does LLM synthesis correctly. `semantic-analysis-agent.ts` supports `'deep'` mode. The fixes are surgical -- calling the right things in the right order with the right arguments.

## Common Pitfalls

### Pitfall 1: RegExp.$N Global State
**What goes wrong:** `RegExp.$1` and `RegExp.$2` are global state set by the last successful regex match. Current code does `trimmed.match(regex)` then uses `RegExp.$2` -- works but fragile.
**How to avoid:** Use `const m = trimmed.match(regex); if (m) { const name = m[2]; }`.
**Warning signs:** Correct regex matches but wrong data captured.

### Pitfall 2: Redundant Type Prefix in generateEntityName()
**What goes wrong:** `generateEntityName('ProblemSolution', 'Implementing Path Analysis')` produces `ProblemSolutionImplementingPathAnalysis`. Type is prepended even when description implies the type.
**How to avoid:** When the LLM returns an entity name directly (via synthesis), use it. Only use `generateEntityName()` as fallback.
**Warning signs:** Entity names starting with `ProblemSolution`, `ArchitecturalDecision`, `CodeEvolution` followed by description words.

### Pitfall 3: Silent JSON Parse Failures from Markdown-Wrapped JSON
**What goes wrong:** `JSON.parse(result.insights)` fails when LLM wraps JSON in code fences.
**How to avoid:** Strip code fences before parsing: `insights.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim()`.
**Warning signs:** "LLM synthesis failed for entity, using raw content" warnings even when LLM is healthy.

### Pitfall 4: 'deep' Analysis Token Budget
**What goes wrong:** Switching from 'surface' to 'deep' reads full file contents for every file in a commit. Large commits may produce very long prompts.
**How to avoid:** The existing 1MB file size guard in `analyzeCodeFiles()` already protects against the worst cases. Monitor first run. Claude's discretion on adding additional truncation.
**Warning signs:** LLM errors about context length.

### Pitfall 5: Section Header Filter in Parser
**What goes wrong:** The section header regex `^#{1,3}\s+(?:\d+\.\s+)?([A-Z][A-Za-z]+...)` may match section titles like `### Pattern Identification` or `### Pattern Descriptions` which are not actual pattern names.
**How to avoid:** Add exclusion list: skip headers that contain generic section titles (`Pattern Identification`, `Pattern Descriptions`, `Architectural Patterns`, `Design Patterns`).
**Warning signs:** Entity named `PatternIdentification` or `ArchitecturalPatterns` in the output.

## Key File Reference

Exact locations for each fix:

| Fix | File | Line | Change |
|-----|------|------|--------|
| PTRN-01/02: Multi-format parser | `src/agents/insight-generation-agent.ts` | 4755 | Replace `parseArchitecturalPatternsFromLLM()` body |
| NAME-01: formatPatternName | `src/agents/insight-generation-agent.ts` | 4829 | Remove `.toLowerCase()` on `word.slice(1)`, add camelCase split |
| NAME-01: toPascalCase | `src/agents/observation-generation-agent.ts` | 1697 | Remove `.toLowerCase()` on `word.slice(1)`, add camelCase split |
| NAME-01: generateCleanEntityName | `src/agents/observation-generation-agent.ts` | 1144 | Remove `.toLowerCase()` on `word.slice(1)` |
| OBSV-01/02: LLM synthesis decisions | `src/agents/observation-generation-agent.ts` | ~294 | Replace `createArchitecturalDecisionObservation()` body |
| OBSV-01/02: LLM synthesis evolution | `src/agents/observation-generation-agent.ts` | ~368 | Replace `createCodeEvolutionObservation()` body |
| DATA-03: analysisDepth | `src/agents/coordinator.ts` | 2637 | `'surface'` to `'deep'` |

## Open Questions

1. **Should `createCodeEvolutionObservation()` also use LLM synthesis?**
   - What we know: It uses the same template pattern as `createArchitecturalDecisionObservation()`, producing `"DO: Follow the {pattern.pattern} approach. DON'T: Deviate without team discussion"`. Equally useless as template content.
   - Recommendation: Yes, apply LLM synthesis to both for consistency. The template output is useless for both.

2. **Pattern deduplication after format fix produces many patterns per run**
   - What we know: CONTEXT.md says "Keep all extracted patterns across batches -- downstream dedup handles merging."
   - What is unclear: Whether `deduplication.ts` actually runs on patterns from `extractArchitecturalPatternsFromCommits()` in the finalization pass.
   - Recommendation: Log pattern count before and after dedup in finalization step. If dedup is not running on patterns, note for Phase 2 scope.

3. **The `analysisDepth: 'deep'` change will increase LLM token consumption per batch**
   - Recommendation: Claude's discretion. Existing 1MB file guard handles the worst case. Monitor first production run and adjust if needed.

## Sources

### Primary (HIGH confidence)
- Direct source code inspection:
  - `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts` lines 3730-3860, 4755-4870
  - `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts` lines 294-430, 761-900, 1144-1300, 1657-1720
  - `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` lines 2625-2760
  - `integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts` lines 85-200, 292-310, 1285-1300
- Trace logs confirming actual LLM output format: `/logs/pattern-extraction-result-1769757330593.json` and `/logs/pattern-extraction-result-1769753191542.json`
- Knowledge export analysis: `/data/knowledge-export/coding.json` -- 57 entities with identical template observations

### Secondary (MEDIUM confidence)
- Python simulation of `toPascalCase()`, `formatPatternName()`, and `generateCleanEntityName()` -- confirmed NAME-01 bug for concatenated PascalCase inputs
- Python simulation of current parser against actual LLM output -- confirmed returns 0 patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all within existing TypeScript codebase
- Architecture: HIGH -- bugs confirmed by trace logs and coding.json, not hypothetical
- Pitfalls: HIGH -- confirmed by direct code inspection and simulation

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable codebase, no fast-moving external dependencies)
