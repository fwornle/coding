# Multi-Collection Classification Architecture

## Overview
The LSL classification system uses multi-collection relative scoring with high-quality embeddings to improve accuracy when distinguishing between coding infrastructure work and project-specific work that mentions coding tools.

**Current Model**: Xenova/nomic-embed-text-v1 (768 dimensions)
**Collections**: 4 indexed projects (coding_infrastructure, coding_lsl, curriculum_alignment, nano_degree)
**Classification Method**: Semantic similarity comparison across all collections

## Problem Statement
Previously, the classifier used only the `coding_infrastructure` collection. This caused false positives when:
- Working on curriculum-alignment project while discussing deployment, status lines, or other coding tools
- LSL sessions mentioned technical infrastructure but were focused on project content
- Example: Oct 11 curriculum-alignment sessions were misclassified as `coding` because they mentioned AWS deployment

## Solution: Multi-Collection Relative Scoring

### Architecture
1. **Multiple Collections**: Each project has its own Qdrant collection
   - `coding_infrastructure`: Coding repo files (src, scripts, docs)
   - `coding_lsl`: Historical coding LSL sessions
   - `curriculum_alignment`: Curriculum project files and LSL sessions
   - `nano_degree`: Nano degree project files
   - (Additional projects can add their own collections)

2. **High-Quality Embeddings**: nomic-embed-text-v1 model
   - 768-dimensional embeddings (upgraded from 384-dim all-MiniLM-L6-v2)
   - Superior semantic understanding and classification accuracy
   - Local inference via Transformers.js (no API costs)
   - Cosine similarity distance metric

3. **Parallel Queries**: Query all collections simultaneously with the same embedding vector

4. **Relative Scoring**: Compare similarity scores across collections
   ```javascript
   maxCodingScore = max(...codingCollections.map(c => c.maxScore))
   maxProjectScore = max(...projectCollections.map(c => c.maxScore))
   isCoding = maxCodingScore > maxProjectScore && maxCodingScore >= threshold
   ```

   Example output:
   ```
   Classification: Semantic similarity favors project content
   (curriculum_alignment=0.566, nano_degree=0.559, coding_lsl=0.525,
    coding_infrastructure=0.475)
   ```

5. **Confidence Calculation**: Factor in score difference
   ```javascript
   scoreDifference = |maxCodingScore - maxProjectScore|
   confidence = min(baseConfidence + (scoreDifference * 0.5), 0.95)
   ```

## Implementation

### 1. Indexer Enhancement (`simple-reindex.js`)
```bash
# Index coding repository
node simple-reindex.js

# Index LSL sessions for a project
node simple-reindex.js --lsl /path/to/project project_collection_name
```

**Features:**
- Parses LSL filename format: `YYYY-MM-DD_HHMM-HHMM_<user-hash>[_from-<project>].md`
- Extracts metadata: date, start/end time, user hash, origin project
- Uses free local Transformers.js embeddings (768 dimensions, nomic-embed-text-v1)
- Stores in project-specific Qdrant collection

### 2. Classifier Enhancement (`ReliableCodingClassifier.js`)
```javascript
const collections = [
  { name: 'coding_infrastructure', type: 'coding' },
  { name: 'coding_lsl', type: 'coding' },
  { name: 'curriculum_alignment', type: 'project' },
  { name: 'nano_degree', type: 'project' }
];
```

**Changes:**
- Queries all 4 collections in parallel (Promise.all)
- Groups collections by type (coding vs project)
- Calculates max scores per type
- Returns detailed scoring information for debugging
- Compares scores across all collections for relative classification

### 3. Classification Results

**Real Example from Production:**
```
Classification: Semantic similarity favors project content
(curriculum_alignment=0.566, nano_degree=0.559, coding_lsl=0.525,
 coding_infrastructure=0.475)
→ Result: LOCAL (curriculum-alignment project work)
```

**4-Collection Scoring Logic:**
- Query generates 768-dimensional embedding
- All 4 collections queried in parallel
- Scores compared to determine classification:
  - `curriculum_alignment=0.566` (highest) → project work
  - `nano_degree=0.559` (also project) → supports classification
  - `coding_lsl=0.525` (coding) → lower similarity
  - `coding_infrastructure=0.475` (coding) → lower similarity

**Classification Decision:**
- Max project score: 0.566 (curriculum_alignment)
- Max coding score: 0.525 (coding_lsl)
- Decision: `0.566 > 0.525` → LOCAL (project work)
- Confidence: Based on score difference (0.041)

## Usage

### Indexing New Project LSL Sessions
```bash
cd /Users/q284340/Agentic/coding/scripts
node simple-reindex.js --lsl /path/to/project project_name
```

### Adding New Collections to Classifier
Edit `ReliableCodingClassifier.js` collections array:
```javascript
const collections = options.collections || [
  { name: 'coding_infrastructure', type: 'coding' },
  { name: 'coding_lsl', type: 'coding' },
  { name: 'curriculum_alignment', type: 'project' },
  { name: 'nano_degree', type: 'project' },
  { name: 'new_project', type: 'project' }  // Add new collection
];
```

**Note:** All collections must use 768-dimensional vectors (nomic-embed-text-v1 model).

## Benefits

1. **Superior Semantic Understanding**: 768-dim nomic-embed-text-v1 embeddings (state-of-the-art quality)
2. **Reduced False Positives**: Project work mentioning coding tools no longer misclassified
3. **Multi-Project Context**: Classification considers all 4 project collections
4. **Context-Aware**: Classification considers project-specific context
5. **Scalable**: Easy to add new projects/collections
6. **Transparent**: Detailed scoring info helps debug classification decisions (shows all 4 scores)
7. **Free**: Uses local Transformers.js embeddings (no API costs)

## Performance

- **Embedding Generation**: ~70ms (one-time model load), then ~10-15ms per query (768-dim vectors)
- **Multi-Collection Query**: ~150ms for 4 collections (parallel queries)
- **Total Classification**: ~165ms (including path/keyword analysis)
- **Model Size**: nomic-embed-text-v1 (~50MB ONNX model, cached locally)

## Maintenance

### Re-indexing After LSL Changes
```bash
# Delete existing collection (optional)
curl -X DELETE http://localhost:6333/collections/curriculum_alignment

# Re-index
node simple-reindex.js --lsl /Users/q284340/Agentic/curriculum-alignment curriculum_alignment
```

### Verifying Collection Contents
```bash
# Check collection stats
curl http://localhost:6333/collections/curriculum_alignment

# Search for specific content
# (Use Qdrant API or dashboard)
```

## Embedding Model Upgrade History

### Oct 2025: Upgrade to nomic-embed-text-v1

**Reason for Upgrade:**
- User identified classification failures: "almost all classifications are wrong"
- Examples: `/sl` commands, constraint system work, classification system work all misclassified
- Needed superior semantic understanding to reliably distinguish coding from non-coding content

**Changes Made:**
1. **Model Update** (`fast-embedding-generator.js`):
   - Changed from `Xenova/all-MiniLM-L6-v2` (384 dims) to `Xenova/nomic-embed-text-v1` (768 dims)
   - Updated `getDimensions()` method to return 768
   - Updated JSDoc comments

2. **Collection Recreation** (`simple-reindex.js`):
   - Dropped all 4 existing Qdrant collections
   - Created new collections with 768-dimensional vector configuration
   - Updated `size: 768` in collection creation

3. **Full Reindexing**:
   - coding_infrastructure: 123 files
   - coding_lsl: 569 files
   - curriculum_alignment: 211 files
   - nano_degree: 304 files

4. **Parallel Version Cleanup**:
   - Removed outdated `scripts/reliable-classifier.js` (876 lines)
   - Removed `scripts/llm-content-classifier.js` (compatibility stub)
   - Removed `scripts/test-multi-collection-classifier.js` (test file)
   - Ensured only `src/live-logging/ReliableCodingClassifier.js` remains as single source of truth

**Results:**
- 71 LOCAL LSL files generated
- 142 FOREIGN LSL files generated
- 227 JSONL classification logs
- True multi-collection classification working: shows scores for all 4 collections
- Classification accuracy dramatically improved

**Example Output:**
```
Classification: Semantic similarity favors project content
(curriculum_alignment=0.566, nano_degree=0.559, coding_lsl=0.525,
 coding_infrastructure=0.475)
```

## Future Enhancements

1. **Dynamic Collection Discovery**: Auto-detect available collections
2. **Weighted Scoring**: Give more weight to recent sessions
3. **Temporal Analysis**: Consider session date in classification
4. **Cross-Project Patterns**: Learn common patterns across projects
5. **Collection Health Monitoring**: Track collection quality metrics
