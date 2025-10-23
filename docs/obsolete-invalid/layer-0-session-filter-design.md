# Layer 0: Session Filter Design - Conversation Bias Tracking

## Overview

Layer 0 implements conversation bias tracking to improve classification accuracy by considering recent conversation context. Unlike Layers 1-4 which analyze individual prompt sets in isolation, Layer 0 maintains a moving window of recent classifications to establish conversational momentum.

## Core Concept

**Key Insight**: If a user makes a coding-related change, the next prompt set is likely also coding-related, as topics often span multiple prompt sets.

**Solution**: Track the last N prompt sets and apply conversation bias to neutral prompt sets (those without strong indicators).

## Architecture

### 1. Moving Window Tracking

**Component**: `ConversationBiasTracker`

**Responsibilities**:
- Maintain a sliding window of the last N prompt set classifications
- Calculate current conversation bias (CODING vs LOCAL)
- Provide bias strength/confidence scores
- Consider current working directory as a weak indicator

**Data Structure**:
```javascript
{
  windowSize: 5,              // Configurable in config
  recentClassifications: [    // Sliding window
    { target: 'CODING_INFRASTRUCTURE', confidence: 0.95, timestamp: ... },
    { target: 'LOCAL', confidence: 0.60, timestamp: ... },
    // ... up to windowSize entries
  ],
  currentBias: 'CODING_INFRASTRUCTURE', // or 'LOCAL'
  biasStrength: 0.75,         // 0.0-1.0
  currentWorkingDir: '/path/to/project'
}
```

### 2. Bias Calculation Algorithm

**Inputs**:
1. Recent classifications (from moving window)
2. Current working directory (weak signal)

**Algorithm**:
```
1. Count CODING vs LOCAL in recent window
2. Weight by confidence scores
3. Apply temporal decay (more recent = higher weight)
4. Consider working directory:
   - If in CODING repo: +0.1 to CODING bias
   - If in other project: +0.1 to LOCAL bias
5. Calculate bias strength based on consensus

Bias Strength Formula:
  strength = (majority_count / window_size) * avg_confidence

Example:
  Window: [CODING(0.95), CODING(0.85), LOCAL(0.60), CODING(0.90), CODING(0.88)]
  CODING count: 4/5 = 0.8
  Avg CODING confidence: (0.95 + 0.85 + 0.90 + 0.88) / 4 = 0.895
  Bias strength: 0.8 * 0.895 = 0.716
```

### 3. Layer 0 Decision Logic

**When Layer 0 Applies**:
- Only when there IS conversation bias (window has at least 2 entries)
- Only when bias strength exceeds threshold (default: 0.65)
- Acts as a pre-filter before Layers 1-4

**Decision Flow**:
```
1. Check if window has sufficient history (>= 2 entries)
2. Calculate current bias and strength
3. IF bias strength >= threshold (0.65):
   a. Check if current prompt set is "neutral":
      - Path analysis: no strong file signals
      - Keyword analysis: low score (<0.3)
      - Embedding analysis: similarity difference <0.15
   b. IF neutral:
      - Apply conversation bias
      - Return classification with Layer 0
      - confidence = bias_strength * 0.8 (discounted)
   c. ELSE:
      - Pass to Layers 1-4 (strong signals override bias)
4. ELSE:
   - Pass to Layers 1-4 (insufficient bias)
```

### 4. Integration with Classification Flow

**Current Flow** (Layers 1-4):
```
classify() → Layer 1 (Path) → Layer 2 (Keyword) → Layer 3 (Embedding) → Layer 4 (Semantic)
```

**New Flow** (Layer 0 + Layers 1-4):
```
classify() → Layer 0 (Session Filter) → [if not decided] → Layer 1 → Layer 2 → Layer 3 → Layer 4
```

**Key Points**:
- Layer 0 only decides for neutral prompt sets with strong bias
- Strong signals in Layers 1-4 always override Layer 0
- Layer 0 never overrides explicit file operations or keywords

### 5. Neutrality Detection

A prompt set is "neutral" if ALL of these are true:

1. **Path Analysis**: `pathResult.confidence < 0.5` (weak or no file signals)
2. **Keyword Analysis**: `keywordResult.score < 0.3` (few matching keywords)
3. **Embedding Analysis**:
   - Top similarity scores are close (difference < 0.15)
   - OR all scores are below threshold (< 0.7)

**Example Neutral Prompts**:
- "explain how this works"
- "what's the status?"
- "continue with the next step"
- "looks good"
- "yes, proceed"

**Example Non-Neutral Prompts**:
- "edit src/foo.js" (Path signal)
- "fix the MCP server" (Keyword signal)
- "update the embedding classifier" (Both keyword and embedding signals)

## Configuration

**New Section in `config/live-logging-config.json`**:

```json
{
  "session_filter": {
    "enabled": true,
    "window_size": 5,
    "bias_strength_threshold": 0.65,
    "working_dir_weight": 0.1,
    "temporal_decay": 0.9,
    "neutrality_thresholds": {
      "path_confidence": 0.5,
      "keyword_score": 0.3,
      "embedding_similarity_diff": 0.15,
      "embedding_threshold": 0.7
    },
    "bias_confidence_discount": 0.8
  }
}
```

## Implementation Plan

### Phase 1: ConversationBiasTracker Class
- File: `src/live-logging/ConversationBiasTracker.js`
- Sliding window management
- Bias calculation
- Working directory detection

### Phase 2: Neutrality Detector
- Add to `ReliableCodingClassifier.js`
- Method: `isNeutralPromptSet(pathResult, keywordResult, embeddingResult)`
- Returns boolean + neutrality score

### Phase 3: Layer 0 Integration
- Update `classify()` method
- Add Layer 0 decision logic before Layer 1
- Update window after each classification

### Phase 4: Logging Integration
- Update `classification-logger.js` to show Layer 0 decisions
- Display window state in logs
- Show bias strength and direction

## Example Scenarios

### Scenario 1: Coding Conversation
```
Window: [CODING(0.95), CODING(0.90), CODING(0.85)]
Bias: CODING, strength: 0.90
User: "looks good, continue"
Analysis: Neutral prompt (no keywords/files)
Layer 0 Decision: CODING_INFRASTRUCTURE (confidence: 0.72)
```

### Scenario 2: Mixed Conversation
```
Window: [LOCAL(0.70), CODING(0.60), LOCAL(0.65)]
Bias: LOCAL, strength: 0.65
User: "fix the tests"
Analysis: Keyword "tests" present (not neutral)
Layer 0: Pass to Layer 2 (keyword match overrides bias)
Layer 2 Decision: CODING_INFRASTRUCTURE (confidence: 0.85)
```

### Scenario 3: No Bias Yet
```
Window: [CODING(0.95)] (only 1 entry)
Bias: None (insufficient history)
User: "continue"
Analysis: Neutral prompt, but no bias established
Layer 0: Pass to Layers 1-4
Layer 3 Decision: LOCAL (default for neutral)
```

## Benefits

1. **Better Neutral Prompt Handling**: Conversation context guides classification
2. **Reduced Misclassifications**: Topics spanning multiple prompts classified consistently
3. **Maintains Accuracy**: Strong signals still override bias
4. **Configurable**: Window size and thresholds tunable per deployment

## Testing Strategy

1. **Unit Tests**: ConversationBiasTracker with various window scenarios
2. **Integration Tests**: Full classification flow with bias
3. **Real Transcript Tests**: Process actual conversations and verify improvements
4. **Edge Cases**:
   - Empty window
   - Single entry window
   - All-neutral conversation
   - Rapid topic switching

## Migration

- **Backward Compatible**: Layer 0 can be disabled via config
- **Existing Logs**: Will show 0 Layer 0 decisions initially (as expected)
- **No Breaking Changes**: Layers 1-4 unchanged

---

*Design Document Version 1.0*
*Created: 2025-10-17*
