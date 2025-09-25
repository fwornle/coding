# LSL Parallel Versions Inventory

## Analysis Date: 2024-09-24

### 🔴 CRITICAL DUPLICATIONS (Multiple implementations of same functionality)

#### 1. SESSION COORDINATION
- **live-logging-coordinator.js** (ES6, 1110 lines) - Complex coordinator with 15+ methods
- **global-lsl-coordinator.cjs** (CommonJS) - Alternative implementation
- **Verdict**: Keep `live-logging-coordinator.js`, archive `global-lsl-coordinator.cjs`

#### 2. BATCH PROCESSING  
- **post-session-logger.js** - Main post-session processor
- **generate-lsl-from-transcripts.js** - Batch from transcripts
- **retroactive-lsl-regenerator.js** - Historical regeneration
- **recover-lsl-from-transcript.js** - Single transcript recovery
- **rebuild-missing-lsl.js** - Missing file rebuilding
- **Verdict**: Consolidate into single `batch-lsl-processor.js`

#### 3. CLASSIFICATION ENGINES
- **exchange-classifier.js** (JavaScript)
- **llm-content-classifier.js** (JavaScript, LLM-based)
- **adaptive-embedding-classifier.cjs** (CommonJS, embedding)
- **embedding-classifier.py** (Python)
- **adaptive_classifier.py** (Python, adaptive)
- **Verdict**: Keep JavaScript-based, archive Python versions

#### 4. DEPLOYMENT SCRIPTS
- **deploy-enhanced-lsl.sh** - Enhanced deployment
- **deploy-multi-user-lsl.js** - Multi-user deployment
- **Verdict**: Keep enhanced version, archive multi-user

### 🟡 MODERATE DUPLICATIONS (Similar functionality, different approaches)

#### 5. SESSION DISCOVERY
- **find-latest-session.js** (JavaScript utility)
- **get-latest-sessions.sh** (Shell script)
- **Verdict**: Keep JavaScript version for consistency

#### 6. TRANSCRIPT PROCESSING
- **claude-conversation-extractor.js** - Extract conversations
- **claude-transcript-reader.js** - Read transcripts  
- **Verdict**: Keep both (different purposes)

#### 7. LOGGING SYSTEMS
- **enhanced-operational-logger.js** - Operational logging
- **event-logger.js** - Event-specific logging
- **Verdict**: Keep both (different scopes)

### 🟢 SUPPORTING UTILITIES (Keep all)

#### 8. UTILITIES (No duplication)
- **lsl-file-manager.js** - File lifecycle management ✅
- **timezone-utils.js** - Time zone handling ✅
- **conversation-capture.js** - Real-time capture ✅
- **user-hash-generator.js** - User identification ✅

### 📋 CONSOLIDATION ACTIONS REQUIRED

#### Phase 1: Archive Duplicates
```bash
mkdir -p scripts/archive/parallel-versions-$(date +%Y%m%d)
mv scripts/global-lsl-coordinator.cjs scripts/archive/parallel-versions-*/
mv scripts/embedding-classifier.py scripts/archive/parallel-versions-*/
mv scripts/adaptive_classifier.py scripts/archive/parallel-versions-*/
mv scripts/deploy-multi-user-lsl.js scripts/archive/parallel-versions-*/
mv scripts/get-latest-sessions.sh scripts/archive/parallel-versions-*/
```

#### Phase 2: Create Consolidated Scripts
1. **batch-lsl-processor.js** - Unify all batch processing
2. **reliable-classifier.js** - Single classification engine  
3. **lsl-system-coordinator.js** - Master system coordinator
4. **lsl-health-monitor.js** - Health monitoring service

#### Phase 3: Update References
- Find all scripts importing duplicated modules
- Update to use consolidated versions
- Test functionality

### 🚨 HIGH-RISK CONSOLIDATIONS (Requires careful testing)

1. **Classification System**: 5 different engines with different APIs
2. **Batch Processing**: 5 different approaches with different capabilities
3. **Coordination**: Live vs Global coordinators may have different behaviors

### 📊 ESTIMATED EFFORT
- **Archive Phase**: 2 hours
- **Consolidation**: 8-12 hours  
- **Testing**: 4-6 hours
- **Total**: 14-20 hours

### 🎯 SUCCESS CRITERIA
- [ ] Only one implementation per core function
- [ ] All existing functionality preserved  
- [ ] Consistent API across all modules
- [ ] No broken imports or references
- [ ] Comprehensive test coverage