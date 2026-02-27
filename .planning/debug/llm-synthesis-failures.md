---
status: diagnosed
trigger: "Investigate why LLM synthesis is failing at scale during pipeline runs: 293 entity synthesis failures + 63 template fallbacks"
created: 2026-02-27T08:00:00.000Z
updated: 2026-02-27T08:00:00.000Z
---

## Current Focus

hypothesis: All five investigation questions have been answered through log + source analysis
test: complete
expecting: findings written to this file
next_action: none - research complete

## Symptoms

expected: LLM synthesis produces enriched entity observations and insight documents with content
actual: 293 synthesis failures, 63 insight enhancement failures, insight trace shows empty materials and qualityScore 0
errors:
  - "LLM synthesis failed for entity, using raw content" (293 times)
  - "LLM insight enhancement failed, using template-based approach" (63 times)
  - "Failed to create code evolution observation" (3 per batch x many batches)
  - "No structured patterns could be extracted from LLM insights"
reproduction: run ukb pipeline against this repo
started: 2026-02-27 run wf_1772172222264_7gb7sy

---

## Q1: What errors are the LLM calls actually returning?

### Finding: LLM calls SUCCEED - JSON.parse() is what fails

The WARNING logs fire IMMEDIATELY after a successful `[llm] used=copilot/claude-opus-4.6` log line:

```
[llm] used=copilot/claude-opus-4.6 tier=premium  14909ms
[2026-02-27T06:04:46.730Z] WARNING: LLM synthesis failed for entity, using raw content
[llm] used=copilot/claude-opus-4.6 tier=premium  14934ms
[2026-02-27T06:04:46.757Z] WARNING: LLM synthesis failed for entity, using raw content
```

The LLM is NOT failing. The `JSON.parse(result.insights)` call on line 948 of
`observation-generation-agent.ts` throws a `SyntaxError` because the LLM returns
markdown-wrapped JSON like:

```
```json
{
  "synthesizedContent": "...",
  ...
}
```
```

The error message (which IS logged via the second arg to `log()`) does not appear
in the workflow log output - the logger does not emit the extra data field for
WARNING level. However, we can confirm the cause by comparing the two code paths.

**Evidence**: LLM response trace files (e.g. `semantic-analysis-response-1769582218718.txt`)
confirm the LLM wraps responses in ` ```json ... ``` ` markdown fences.

---

## Q2: Is this rate limiting, a prompt issue, or an LLM provider issue?

### Finding: It is a prompt/parsing mismatch, not a provider issue

- 292 out of 293 failures use `copilot/claude-opus-4.6` which DID return a response
- Only 1 failure used `groq/openai/gpt-oss-120b` after copilot timed out (504 at line 7082)
- The single copilot 504 timeout occurred at `06:16:40` after 120s and was a rate/load issue
  at that specific moment, not a systemic provider failure

**Root cause**: `createEntityObservation()` (line 948) and `createSemanticInsightObservation()`
(line 1337) in `observation-generation-agent.ts` call `JSON.parse(result.insights)` without
stripping markdown fences.

The two functions that work correctly (`createArchitecturalDecisionObservation` and
`createCodeEvolutionObservation`) DO strip markdown before parsing:

```typescript
// WORKS (lines 339-341 in createArchitecturalDecisionObservation):
const cleaned = result.insights
  .replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
synthesizedContent = JSON.parse(cleaned);

// WORKS (lines 461-463 in createCodeEvolutionObservation):
const cleaned = result.insights
  .replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
synthesizedContent = JSON.parse(cleaned);

// BROKEN (line 948 in createEntityObservation):
synthesizedObservation = JSON.parse(result.insights);   // No stripping!

// BROKEN (line 1337 in createSemanticInsightObservation):
enhancedInsights = JSON.parse(result.insights);         // No stripping!
```

This affects 293 entity observations + 63 insight enhancements = 356 total failures.

---

## Q3: Why do insight documents have empty materials?

### Finding: Hardcoded empty arrays in traceInsightGeneration() - a reporting bug, not a data bug

The `materialsUsed` fields (`observations: [], commits: [], sessions: [], codeSnippets: [], patterns: []`)
are HARDCODED to empty in the UKB trace report, not sourced from actual data:

**File**: `integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts`
**Lines 554-560**:
```typescript
traceInsightGeneration(insightResult: any): void {
  const insights = insightResult?.insightDocuments || [];

  this.report.finalization!.insightGeneration = insights.map((i: any) => ({
    entityName: i.name || 'unknown',
    materialsUsed: {
      observations: [],  // HARDCODED empty - never populated from InsightDocument
      commits: [],       // HARDCODED empty
      sessions: [],      // HARDCODED empty
      codeSnippets: [],  // HARDCODED empty
      patterns: []       // HARDCODED empty
    },
    insightDocument: {
      title: i.title || '',
      filePath: i.filePath || '',
      sections: [],      // HARDCODED empty
      diagramsGenerated: []  // HARDCODED empty
    },
    significance: i.significance || 5,
    qualityScore: i.qualityScore || 0
  }));
```

The `InsightDocument` interface does not carry `observations`, `commits`, `sessions`, or
`codeSnippets` fields - they're not part of the data model at all. The trace schema was
defined with these fields but the implementation never wired up actual data.

`qualityScore: 0` is also a direct consequence: `i.qualityScore || 0` falls back to 0
because `InsightDocument.qualityScore` is never set in `generateInsightDocument()` -
the document is returned without this field. The `qualityScore` IS calculated by
`calculateQualityScore()` in `generateComprehensiveInsights()` (line 928) but it's
tracked in `generationMetrics.qualityScore`, not in each individual `InsightDocument`.

---

## Q4: Why does ApiHandlesExternalCommunication.md contain mock data?

### Finding: The file is from a previous debug run (Jan 31). Feb 27 run writes inside Docker only.

The file on the host machine:
```
/Users/Q284340/Agentic/coding/knowledge-management/insights/ApiHandlesExternalCommunication.md
Modified: 2026-01-31 17:53:38  (692 bytes)
```

The Docker-compose volume mounts (in `docker/docker-compose.yml`) only bind-mount:
- `.data/`
- `.specstory/`
- `.git/` (read-only)

The `knowledge-management/insights/` directory is NOT in the Docker bind-mounts. The Feb 27
workflow DID write new insight files (5817-11330 chars each) but they went to the Docker
container's internal filesystem at `/coding/knowledge-management/insights/`, not the host.

The Jan 31 mock data was written during a debug run that presumably had a different
Docker configuration, or was run directly on the host, and used `mockLLM: true` which
produces "Mock: Code structure analyzed" content.

The Feb 27 insight documents are real LLM-generated content (copilot/claude-opus-4.6)
but permanently lost when the container is stopped/removed.

---

## Q5: LLM provider chain - which provider is used and which fails?

### Finding: copilot/claude-opus-4.6 handles 99% of observation_generation calls; groq handles semantic_code_analysis; one timeout at batch 18

**Provider chain registered**: `copilot → groq → claude-code → anthropic → openai → dmr`
(confirmed at log lines 157, 161)

**Actual provider usage** (from `[llm] used=` log lines):
- `groq/llama-3.3-70b-versatile`: first batch's semantic_code_analysis (standard tier, ~2.8s)
- `copilot/claude-opus-4.6`: all 292 observation_generation calls (premium tier, 14-23s each)
- `copilot/claude-sonnet-4.5`: finalization pattern_extraction (standard/default tier, 34-109s)
- `groq/openai/gpt-oss-120b`: ONE fallback in batch 18 after copilot 504 timeout (147s)

**The single actual provider failure** (log line 7082):
```
[llm] Provider copilot failed: Proxy error (504): CLI command timed out after 120000ms
[llm] used=groq/openai/gpt-oss-120b tier=premium  147197ms
```
This was a one-off timeout in the copilot proxy after 2 hours of continuous use.

**The finalization pattern extraction issue** (log lines 13016, 17954):
```
WARNING: No structured patterns could be extracted from LLM insights
```
The LLM (copilot/claude-sonnet-4.5, 109s for 1115 commits) DID return content but
`parseArchitecturalPatternsFromLLM()` found 0 patterns. All 3 parsing strategies
(JSON, bold markdown, labeled format) failed against the LLM's response format.
This is a format mismatch issue with the pattern extraction prompt (in
`insight-generation-agent.ts` lines 3784-3806) - the LLM likely returned prose
analysis rather than the structured format expected.

In the second finalization call (line 17954), the batch processing returns
immediately (0ms) with 0 patterns because the LLM response is cached/same context,
then `extractPatternsFromObservations()` fills in 1778 patterns from accumulated
observations instead.

---

## Evidence

- timestamp: 2026-02-27T08:00:00Z
  checked: workflow log wf_1772172222264_7gb7sy.log lines 220-231
  found: LLM call succeeds (used=copilot) followed immediately by WARNING
  implication: parse failure, not LLM failure

- timestamp: 2026-02-27T08:00:00Z
  checked: observation-generation-agent.ts lines 339-341 vs 948
  found: createArchitecturalDecisionObservation strips markdown; createEntityObservation does not
  implication: inconsistent JSON parse approach causes 293 failures in createEntityObservation

- timestamp: 2026-02-27T08:00:00Z
  checked: observation-generation-agent.ts line 1337 vs 461-463
  found: createSemanticInsightObservation also lacks markdown stripping
  implication: causes the 63 "LLM insight enhancement failed" warnings

- timestamp: 2026-02-27T08:00:00Z
  checked: ukb-trace-report.ts lines 554-569
  found: materialsUsed hardcoded to empty arrays, qualityScore always 0
  implication: trace report is structurally incomplete, not a data gathering failure

- timestamp: 2026-02-27T08:00:00Z
  checked: docker-compose.yml volume mounts
  found: knowledge-management/insights/ is NOT bind-mounted to host
  implication: insight files written in Docker are lost on container stop; host files are stale

- timestamp: 2026-02-27T08:00:00Z
  checked: log line 7082
  found: Proxy error (504): CLI command timed out after 120000ms
  implication: only 1 true provider failure across the entire run (not systemic)

- timestamp: 2026-02-27T08:00:00Z
  checked: log lines 13016 and 17954
  found: parseArchitecturalPatternsFromLLM returned 0 patterns from copilot/claude-sonnet-4.5
  implication: pattern extraction prompt format doesn't match what sonnet-4.5 returns; separate fix needed

---

## Resolution

root_cause: |
  THREE separate bugs, not one:

  BUG 1 (293 failures - "LLM synthesis failed for entity"):
  createEntityObservation() at line 948 of observation-generation-agent.ts calls
  JSON.parse(result.insights) without stripping markdown fences. The LLM wraps
  responses in ```json ... ``` which causes SyntaxError. Fix: add the same markdown
  stripping that createArchitecturalDecisionObservation() uses on lines 339-341.

  BUG 2 (63 failures - "LLM insight enhancement failed"):
  createSemanticInsightObservation() at line 1337 has the same issue.
  Fix: same markdown stripping before JSON.parse.

  BUG 3 (empty materials / qualityScore 0):
  ukb-trace-report.ts traceInsightGeneration() hardcodes all materialsUsed arrays
  to empty and qualityScore to 0 because InsightDocument doesn't carry these fields.
  This is a reporting gap - the actual insight generation IS working (5817-11330 chars
  of content written per entity), but the trace report doesn't capture it.
  This is cosmetic for the trace report, not a functional failure.

  SEPARATE ISSUE (insight files lost):
  knowledge-management/insights/ not in Docker bind-mounts means generated files
  are written to container filesystem and lost on container stop.

fix: not applied (research-only mode)
verification: not performed
files_changed: []

## Suggested Fix Directions

### Fix 1: Add markdown stripping to createEntityObservation() (HIGH PRIORITY)
File: `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts`
Line 948 - change:
```typescript
synthesizedObservation = JSON.parse(result.insights);
```
to:
```typescript
const cleaned = result.insights
  .replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
synthesizedObservation = JSON.parse(cleaned);
```

### Fix 2: Same fix for createSemanticInsightObservation()
Line 1337 - same pattern.

### Fix 3: Add knowledge-management bind-mount to Docker
In `docker/docker-compose.yml`, add:
```yaml
- ${CODING_REPO:-.}/knowledge-management:/coding/knowledge-management
```
This ensures insight files written inside Docker persist to the host.

### Fix 4 (optional): Populate materialsUsed in traceInsightGeneration
This requires InsightDocument to carry these fields, which is a larger data model change.
Low priority since it's cosmetic for the trace report.
