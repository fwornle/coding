# AGGRESSIVE Scripts Directory Cleanup Analysis

## CURRENT STATE: 67 SCRIPT FILES (INSANE!)

Let me analyze what we ACTUALLY need vs what can be deleted:

### 🔴 ESSENTIAL SCRIPTS (Keep - Core LSL System)
1. **batch-lsl-processor.js** - NEW consolidated batch processor ✅
2. **enhanced-transcript-monitor.js** - Primary live monitor
3. **live-logging-coordinator.js** - Session coordination  
4. **claude-conversation-extractor.js** - Core transcript parsing
5. **timezone-utils.js** - Time handling utilities
6. **find-latest-session.js** - Session discovery
7. **lsl-file-manager.js** - File lifecycle management

### 🟡 SUPPORTING UTILITIES (Keep - But Review)
8. **user-hash-generator.js** - User identification
9. **conversation-capture.js** - Real-time capture
10. **event-logger.js** - Event logging
11. **enhanced-operational-logger.js** - Operational logging

### 🔵 DEVELOPMENT/TESTING (Keep for now)
12. **test-coding.sh** - Testing utilities
13. **validate-lsl-config.js** - Configuration validation
14. **live-logging-status.js** - Status checking

### 🟠 DEPLOYMENT (Keep minimal set)
15. **deploy-enhanced-lsl.sh** - Deployment script
16. **claude-mcp-launcher.sh** - MCP launcher
17. **launch-claude.sh** - Claude launcher

### 🔴 DELETE IMMEDIATELY (Duplicates/Obsolete)
- **post-session-logger.js** → Replaced by batch-lsl-processor.js
- **generate-lsl-from-transcripts.js** → Replaced by batch-lsl-processor.js
- **retroactive-lsl-regenerator.js** → Replaced by batch-lsl-processor.js
- **recover-lsl-from-transcript.js** → Replaced by batch-lsl-processor.js
- **rebuild-missing-lsl.js** → Replaced by batch-lsl-processor.js
- **exchange-classifier.js** → Replace with unified reliable-classifier.js
- **llm-content-classifier.js** → Replace with unified reliable-classifier.js
- **adaptive-embedding-classifier.cjs** → Replace with unified reliable-classifier.js

### 🔴 DELETE - DEBUG/TESTING CRUFT
- **debug-specific-classification.js**
- **classifier-debug.js**
- **test-classification.js**
- **validate-classifier.js**
- **simple-classifier-test.cjs**
- **debug-classifier-test.cjs**
- **test-deployment.cjs**
- **integration-test.cjs**

### 🔴 DELETE - ONE-OFF SCRIPTS
- **conversation-topic-segmenter.js**
- **semantic-tool-interpreter.js**
- **repository-trajectory-generator.js**
- **insight-orchestrator.js**
- **auto-insight-trigger.js**
- **violation-capture-service.js**
- **constraint-monitor-integration.js**
- **enhanced-constraint-endpoint.js**

### 🔴 DELETE - UTILITY CRUFT  
- **cleanup-aliases.sh**
- **cleanup-shared-memory.js**
- **cleanup-mcp-processes.sh**
- **normalize-specstory-filenames.sh**
- **migrate-to-multi-team.js**
- **cross-platform-bridge.js**

### 🔴 DELETE - BACKUP/OLD FILES
- **test-coding.sh.backup-20250914-163859**
- **coding-keywords-backup.json**

### 🔴 DELETE - DUPLICATED STATUS/UI
- **combined-status-line.js**
- **combined-status-line-wrapper.js**
- **status-line-click-handler.js**
- **diagram-generator.js**
- **generate-plantuml-pngs.sh**
- **generate-all-pngs-correctly.sh**

## AGGRESSIVE CLEANUP PLAN
Target: **FROM 67 → 17 SCRIPTS** (75% reduction)

## ACTION PLAN
1. Create reliable-classifier.js to replace 3 classifiers
2. Move deprecated scripts to archive
3. Test core functionality with minimal set
4. Complete robust LSL system