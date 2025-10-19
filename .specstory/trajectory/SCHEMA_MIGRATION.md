# Trajectory State Schema Migration Guide

## Overview

The trajectory state schema has been enhanced from v1 to v2 to support:
- Intent classification (learning, debugging, feature-dev, etc.)
- Session goal extraction
- Active concept tracking
- Confidence scoring
- Intent transition history

## Schema Versions

### Version 1.0 (Original)
```json
{
  "currentState": "exploring",
  "lastUpdate": 1234567890,
  "projectPath": "/path/to/project",
  "stateHistory": [],
  "interventionCount": 0,
  "sessionInfo": {
    "startTime": 1234567890,
    "totalTransitions": 0
  }
}
```

### Version 2.0 (Enhanced)
```json
{
  "schemaVersion": "2.0.0",
  "currentState": "exploring",
  "intent": "exploration",
  "goal": "Understanding the codebase structure",
  "concepts": [
    {
      "name": "React",
      "category": "technology",
      "isLearning": false,
      "knowledgeId": "knowledge_abc123"
    }
  ],
  "confidence": 0.85,
  "intentHistory": [
    {
      "intent": "exploration",
      "timestamp": 1234567890,
      "confidence": 0.85,
      "trigger": "session-start"
    }
  ],
  "lastUpdate": 1234567890,
  "projectPath": "/path/to/project",
  "stateHistory": [
    {
      "state": "exploring",
      "timestamp": 1234567890,
      "duration": 60000,
      "intent": "exploration"
    }
  ],
  "interventionCount": 0,
  "sessionInfo": {
    "startTime": 1234567890,
    "totalTransitions": 0,
    "intentTransitions": 0,
    "conceptsLearned": 0,
    "conceptsApplied": 1
  }
}
```

## Backward Compatibility

### Reading v1 States
When reading a v1 state file, the system will:
1. Check for `schemaVersion` field
2. If missing or "1.0.0", apply default values:
   - `intent`: "exploration"
   - `goal`: null
   - `concepts`: []
   - `confidence`: 0.5
   - `intentHistory`: []

### Gradual Migration
The system supports gradual migration:
- v1 files remain valid and readable
- New fields are optional
- Old tools continue to work with v1 format
- New tools write v2 format

## Migration Path

### Automatic Migration
When `RealTimeTrajectoryAnalyzer` loads a v1 state:
```javascript
function migrateV1ToV2(v1State) {
  return {
    ...v1State,
    schemaVersion: "2.0.0",
    intent: v1State.intent || "exploration",
    goal: v1State.goal || null,
    concepts: v1State.concepts || [],
    confidence: v1State.confidence || 0.5,
    intentHistory: v1State.intentHistory || [],
    sessionInfo: {
      ...v1State.sessionInfo,
      intentTransitions: 0,
      conceptsLearned: 0,
      conceptsApplied: 0
    }
  };
}
```

### Manual Migration
To manually migrate all v1 states:
```bash
node scripts/migrate-trajectory-schema.js
```

## New Fields Explained

### `intent`
The current session intent (what the user is trying to accomplish):
- `learning`: Understanding new concepts or technologies
- `debugging`: Fixing bugs or issues
- `feature-dev`: Implementing new features
- `refactoring`: Improving code structure
- `testing`: Writing or running tests
- `optimization`: Improving performance
- `documentation`: Writing docs
- `exploration`: Understanding existing code

### `goal`
A natural language description of the session objective, extracted from conversation:
- Example: "Implement user authentication with JWT"
- Example: "Debug the memory leak in the data processing pipeline"
- Max 500 characters

### `concepts`
Array of active concepts being used or learned:
```json
{
  "name": "React Hooks",
  "category": "technology",
  "isLearning": true,
  "knowledgeId": "knowledge_abc123"
}
```

Categories:
- `design_pattern`: MVC, Repository, Factory, etc.
- `technology`: React, Node.js, PostgreSQL, etc.
- `architecture`: Microservices, REST, Event-driven, etc.
- `practice`: TDD, CI/CD, Code review, etc.
- `tool`: Git, Docker, Kubernetes, etc.
- `algorithm`: Binary search, QuickSort, etc.
- `principle`: SOLID, DRY, KISS, etc.

### `confidence`
Confidence score (0.0-1.0) for the current trajectory classification:
- > 0.8: High confidence
- 0.6-0.8: Medium confidence
- < 0.6: Low confidence (may need intervention)

### `intentHistory`
History of intent transitions during the session:
```json
{
  "intent": "debugging",
  "timestamp": 1234567890,
  "confidence": 0.75,
  "trigger": "error-message-detected"
}
```

Common triggers:
- `session-start`: Initial intent
- `error-message-detected`: Switched to debugging
- `question-asked`: Switched to learning
- `implementation-started`: Switched to feature-dev
- `user-explicit`: User explicitly stated intent

## Tools Compatibility

### Compatible with v1 and v2
- `RealTimeTrajectoryAnalyzer`: Reads v1, writes v2
- `TrajectoryConceptExtractor`: Works with v2
- Basic trajectory visualization: Works with both

### Requires v2
- Intent-based knowledge retrieval
- Concept-aware trajectory analysis
- Cross-session learning patterns

## Data Loss Prevention

### Validation
All writes are validated against the schema:
```javascript
import Ajv from 'ajv';
import schema from './schema-v2.json';

const ajv = new Ajv();
const validate = ajv.compile(schema);

function validateState(state) {
  const valid = validate(state);
  if (!valid) {
    console.error('Schema validation errors:', validate.errors);
    throw new Error('Invalid trajectory state');
  }
  return true;
}
```

### Rollback
If migration fails, the original v1 file is preserved as `.backup`:
```
live-state.json         # New v2 format
live-state.json.backup  # Original v1 format
```

## Testing

### Test v1 → v2 Migration
```javascript
const v1State = {
  currentState: "exploring",
  lastUpdate: Date.now(),
  projectPath: "/test/project",
  stateHistory: [],
  interventionCount: 0,
  sessionInfo: { startTime: Date.now(), totalTransitions: 0 }
};

const v2State = migrateV1ToV2(v1State);
assert(v2State.schemaVersion === "2.0.0");
assert(v2State.intent === "exploration");
assert(Array.isArray(v2State.concepts));
```

### Test Backward Compatibility
```javascript
// Old tools can still read core fields
const state = JSON.parse(fs.readFileSync('live-state.json'));
assert(state.currentState);  // ✓ Works with both v1 and v2
assert(state.projectPath);   // ✓ Works with both v1 and v2
```

## Rollout Strategy

### Phase 1: Gradual Adoption (Current)
- New fields are optional
- Old tools continue working
- New tools write v2 format

### Phase 2: Migration Period (1-2 weeks)
- Automatic migration on read
- Backups created automatically
- Monitor for issues

### Phase 3: Full v2 (After validation)
- All states migrated to v2
- Remove v1 compatibility code
- Update all tools to require v2

## Support

For issues or questions:
1. Check schema validation errors
2. Verify backup files exist
3. Test migration on sample data
4. Report issues with schema version details
