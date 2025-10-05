# Archived Parallel LSL Scripts

## Archive Date: 2024-09-24

These files were archived during LSL system consolidation to eliminate duplicate functionality.

### Archived Files:

1. **global-lsl-coordinator.cjs** - Alternative coordinator (CommonJS)
   - Replaced by: live-logging-coordinator.js (ES6)
   - Reason: Duplicate coordination functionality

2. **embedding-classifier.py** - Python embedding classifier
   - Replaced by: JavaScript-based classification
   - Reason: Language consistency (keep JS ecosystem)

3. **adaptive_classifier.py** - Python adaptive classifier
   - Replaced by: JavaScript-based classification
   - Reason: Language consistency (keep JS ecosystem)

4. **deploy-multi-user-lsl.js** - Multi-user deployment
   - Replaced by: deploy-enhanced-lsl.sh
   - Reason: Enhanced version covers multi-user capabilities

5. **get-latest-sessions.sh** - Shell-based session discovery
   - Replaced by: find-latest-session.js
   - Reason: Language consistency (keep JS ecosystem)

### Restoration Instructions:

If any archived functionality is needed:

1. Copy specific file back to scripts/
2. Check for API compatibility
3. Update imports in dependent code
4. Test thoroughly before deployment

### Dependencies Check:

Before permanent deletion, verify no active code imports these modules:
```bash
grep -r "global-lsl-coordinator.cjs" /Users/q284340/Agentic/coding/
grep -r "embedding-classifier.py" /Users/q284340/Agentic/coding/
grep -r "adaptive_classifier.py" /Users/q284340/Agentic/coding/
grep -r "deploy-multi-user-lsl.js" /Users/q284340/Agentic/coding/
grep -r "get-latest-sessions.sh" /Users/q284340/Agentic/coding/
```