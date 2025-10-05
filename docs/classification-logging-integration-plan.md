# Classification Logging Integration Plan

## Problem Analysis

Today's batch LSL regeneration created both LOCAL and FOREIGN files when all content should have been classified as CODING. Need comprehensive logging to understand why the 4-layer classifier made these decisions.

## Current Classification Architecture

Per `docs/live-session-logging.md`, the ReliableCodingClassifier uses a 4-layer approach:

1. **Layer 1: PathAnalyzer** - File operation pattern matching (<1ms)
2. **Layer 2: KeywordMatcher** - Fast keyword-based classification (<10ms)
3. **Layer 3: EmbeddingClassifier** - Semantic vector similarity (<3ms)
4. **Layer 4: SemanticAnalyzer** - LLM-powered deep understanding (<10ms)

## Current Status

### What Exists
- ✅ `ReliableCodingClassifier` returns `decisionPath` array with all layer decisions
- ✅ Classification happens in `enhanced-transcript-monitor.js:992`
- ✅ Batch processing in `batch-lsl-processor.js`
- ✅ Created `classification-logger.js` with comprehensive logging capability

### What's Missing
- ❌ Integration of logger into live enhanced-transcript-monitor
- ❌ Integration of logger into batch processor
- ❌ Mapping from LSL file content back to prompt sets
- ❌ Line number tracking for prompt sets in LSL files

## Integration Points

### 1. Enhanced Transcript Monitor (Live Classification)

**File**: `scripts/enhanced-transcript-monitor.js`
**Method**: `isCodingRelated()` at line 992

**Current code**:
```javascript
const result = await this.reliableCodingClassifier.classify(exchange);
return result.isCoding;
```

**Required changes**:
1. Initialize ClassificationLogger in constructor
2. After classification, log the decision with:
   - Exchange ID and timestamp
   - Classification result (isCoding, confidence, layer)
   - Complete decisionPath with all 4 layers
   - Target file (will be determined later)
3. Track line numbers when writing to LSL files
4. Associate prompt sets with LSL file locations

### 2. Batch LSL Processor (Batch Classification)

**File**: `scripts/batch-lsl-processor.js`
**Method**: `classifyPromptSet()` at line 557

**Current code**:
```javascript
const classification = await this.classifier.classify(classificationInput, {
  threshold: 4
});
console.log(`📋 Classified prompt set ${promptSet.id}: ${classification.isCoding ? 'CODING' : 'LOCAL'}`);
```

**Required changes**:
1. Initialize ClassificationLogger in BatchLSLProcessor constructor
2. After classification, log complete decision details
3. Track which LSL file and line range each prompt set maps to
4. Generate comprehensive report at end of batch run

## Detailed Logging Requirements

For each classified prompt set, log:

```javascript
{
  promptSetId: "ps_2025-10-05T08:00:00.000Z",
  timeRange: {
    start: "2025-10-05T08:00:00.000Z",
    end: "2025-10-05T08:15:00.000Z"
  },
  lslFile: "/path/to/.specstory/history/2025-10-05_0800-0900_g9b30a.md",
  lslLineRange: {
    start: 45,
    end: 123
  },
  classification: {
    isCoding: false,
    confidence: 0.39,
    finalLayer: "keyword"
  },
  layerDecisions: [
    {
      layer: "path",
      decision: "inconclusive",
      confidence: 0.02,
      reasoning: "No file operations detected",
      processingTimeMs: 0.5
    },
    {
      layer: "keyword",
      decision: "local",
      confidence: 0.39,
      reasoning: "Keyword analysis: 2 matches, score: 3/4",
      processingTimeMs: 2.1
    }
    // Layers 3 & 4 not reached due to Layer 2 confidence
  ],
  sourceProject: "curriculum-alignment",
  targetFile: "local"
}
```

## Implementation Steps

### Step 1: Enhance ReliableClassifier to expose full decision details
Currently `buildResult()` returns decisionPath, but need to verify it includes all necessary info.

### Step 2: Integrate into Enhanced Transcript Monitor
1. Import ClassificationLogger
2. Initialize in constructor with project name
3. Modify `isCodingRelated()` to log after classification
4. Track LSL file line numbers during `formatExchangeForLogging()`
5. Store mapping of exchange ID → LSL location

### Step 3: Integrate into Batch LSL Processor
1. Import ClassificationLogger
2. Initialize in constructor
3. Modify `classifyPromptSet()` to log decisions
4. Track LSL file locations in `createPromptSetFile()`
5. Call `logger.finalize()` at end to generate report

### Step 4: Add LSL File Location Tracking
Need to track where each prompt set is written in the LSL file:
- Before writing content, record current line number
- After writing content, record ending line number
- Store in classification log entry

### Step 5: Generate Human-Readable Reports
The logger already includes `generateSummaryReport()` which creates:
- Statistics (coding vs local percentages, layer usage)
- Individual prompt set decisions with full layer trace
- Markdown format for easy reading

## Expected Output

### JSONL Log File
`.specstory/logs/classification/classification-curriculum-alignment-2025-10-05T10-00-00.jsonl`

Each line is a JSON object:
- Session metadata
- Individual classification decisions
- Layer-by-layer decisions
- Session end summary

### Markdown Summary Report
`.specstory/logs/classification/classification-curriculum-alignment-2025-10-05T10-00-00-summary.md`

Human-readable report showing:
- Overall statistics
- Each prompt set with full decision trace
- Easy identification of why content was classified as LOCAL vs CODING

## Analysis Workflow

Once logs are generated:

1. **Review Summary Report**: Quickly see which prompt sets were misclassified
2. **Examine Layer Decisions**: See why each layer made its decision
3. **Identify Patterns**: Are certain types of content consistently misclassified?
4. **Adjust Keywords/Thresholds**: Update configuration based on findings
5. **Verify Improvements**: Re-run batch mode and compare results

## Timeline

- [ ] Step 1: Verify ReliableClassifier decision structure (5 min)
- [ ] Step 2: Integrate into Enhanced Transcript Monitor (30 min)
- [ ] Step 3: Integrate into Batch LSL Processor (30 min)
- [ ] Step 4: Add LSL location tracking (20 min)
- [ ] Step 5: Test and generate first report (15 min)

Total: ~2 hours for full integration

## Success Criteria

✅ Every classification decision is logged with complete 4-layer trace
✅ LSL file locations are tracked for each prompt set
✅ Summary report clearly shows why content was classified as LOCAL vs CODING
✅ Can identify specific keyword/threshold adjustments needed
✅ Works in both live and batch modes
