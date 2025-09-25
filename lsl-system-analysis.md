# LSL System Analysis and Consolidation Plan

## Current State Analysis (Generated: 2024-09-24)

### Core LSL Scripts Inventory

#### 1. Live Session Monitoring
- **enhanced-transcript-monitor.js** - Primary live monitoring system
- **live-logging-coordinator.js** - Session coordination and routing
- **global-lsl-coordinator.cjs** - Alternative coordinator (CommonJS)
- **live-logging-status.js** - Status checking for live sessions

**Overlap Issue**: Multiple coordinators with unclear precedence

#### 2. Batch/Post-Session Processing  
- **post-session-logger.js** - Main batch processor after sessions
- **generate-lsl-from-transcripts.js** - Batch generation from transcript files
- **retroactive-lsl-regenerator.js** - Regenerate historical LSL files
- **recover-lsl-from-transcript.js** - Recovery from specific transcripts
- **rebuild-missing-lsl.js** - Rebuild missing LSL files

**Overlap Issue**: 5 different batch processing approaches

#### 3. Classification System
- **exchange-classifier.js** - Main classification logic
- **llm-content-classifier.js** - LLM-based classification
- **adaptive-embedding-classifier.cjs** - Embedding-based approach
- **embedding-classifier.py** - Python embedding classifier
- **adaptive_classifier.py** - Python adaptive classifier

**Overlap Issue**: Multiple classification engines with different APIs

#### 4. Session Management
- **lsl-file-manager.js** - File lifecycle management
- **find-latest-session.js** - Session discovery utilities
- **get-latest-sessions.sh** - Shell-based session finding

#### 5. Deployment & Operations
- **deploy-enhanced-lsl.sh** - Enhanced LSL deployment
- **deploy-multi-user-lsl.js** - Multi-user deployment
- **start-auto-logger.sh** - Auto-start services

#### 6. Support & Utilities
- **claude-conversation-extractor.js** - Transcript parsing
- **claude-transcript-reader.js** - Transcript reading utilities
- **timezone-utils.js** - Time zone handling
- **conversation-capture.js** - Real-time capture
- **event-logger.js** - Event logging system

## Key Problems Identified

### 1. Multiple Single-Purpose Solutions
Instead of one flexible system, we have:
- 5+ batch processing scripts
- 3+ coordinators
- 5+ classification engines
- Multiple deployment scripts

### 2. API Inconsistencies
- Some scripts use CommonJS (`.cjs`)
- Some use ES modules (`.js`) 
- Some use Python
- Different parameter formats across scripts

### 3. Configuration Scattered
- Some scripts hardcode paths
- Others use different config files
- No central configuration management

### 4. Process Management Issues
- No health monitoring
- No automatic restart capability
- No conflict prevention between live/batch modes

## Consolidation Strategy

### Phase 1: Core Consolidation
1. **Single Live Monitor**: `enhanced-transcript-monitor.js` (keep, enhance)
2. **Single Batch Processor**: Create new `batch-lsl-processor.js`
3. **Single Classifier**: Create unified `reliable-classifier.js`
4. **Single Coordinator**: Create new `lsl-system-coordinator.js`

### Phase 2: Archive/Remove
- Archive all duplicate scripts to `scripts/archive/`
- Keep only the consolidated versions
- Update all references

### Phase 3: Health Monitoring
- Add `lsl-health-monitor.js`
- Implement automatic restart
- Add status reporting

## Next Steps
1. Create consolidated scripts
2. Test functionality
3. Archive duplicates
4. Update calling code
5. Comprehensive testing