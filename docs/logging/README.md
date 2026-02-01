# Unified Logging System

The coding infrastructure uses a unified logging system to ensure consistent, structured, and configurable logging across all components.

## Quick Start

### Backend (Node.js)

```javascript
import { createLogger } from '../lib/logging/Logger.js';

const logger = createLogger('my-component');

logger.info('Starting up');
logger.warn('Something might be wrong', { detail: 'context' });
logger.error('Operation failed', { error: err.message });
logger.debug('Debug info', { data });
```

### Frontend (React)

```typescript
import { Logger } from '../utils/logging/Logger';

Logger.info('category', 'Message here');
Logger.warn('category', 'Warning message');
Logger.error('category', 'Error occurred', { error });
```

## Architecture

| Component | Location | Features |
|-----------|----------|----------|
| **Backend Logger** | `lib/logging/Logger.js` | File output (JSON lines), console with colors, category-based levels, Express middleware, performance timing |
| **Frontend Logger** | `utils/logging/Logger.ts` | LocalStorage persistence, category filtering, performance timing, error boundary support |
| **Backend Config** | `config/logging-config.json` | Global and per-category log levels, environment overrides |
| **Frontend Config** | Per-app configuration | App-specific logging settings |

## Configuration

### Backend Configuration (`config/logging-config.json`)

```json
{
  "level": "info",
  "console": true,
  "file": false,
  "filePath": "logs/app.log",
  "colors": true,
  "timestamp": true,
  "categories": {
    "health": { "level": "info" },
    "billing": { "level": "info" },
    "workflow": { "level": "info" },
    "database": { "level": "warn" }
  },
  "environments": {
    "development": { "level": "debug", "file": true },
    "production": { "level": "info", "colors": false }
  }
}
```

### Log Levels

| Level | Priority | Use Case |
|-------|----------|----------|
| error | 0 | Critical failures, unrecoverable errors |
| warn | 1 | Potential issues, degraded operation |
| info | 2 | Normal operation milestones |
| debug | 3 | Detailed diagnostic information |
| trace | 4 | Very detailed tracing |

### Categories

Predefined categories for the coding infrastructure:

| Category | Description |
|----------|-------------|
| health | Health monitoring and status line |
| billing | API quota and billing tracking |
| transcript | Live session logging and transcript monitoring |
| knowledge | Knowledge management and UKB operations |
| workflow | Workflow execution and agent coordination |
| database | Database operations (GraphDB, LevelDB, Qdrant) |
| api | API endpoints and HTTP servers |
| mcp | MCP server operations |

## API Reference

### Backend Logger

```javascript
import { Logger, createLogger, getLogger, log } from '../lib/logging/Logger.js';

// Factory function (recommended)
const logger = createLogger('my-category');

// Singleton pattern (cached)
const logger = getLogger('my-category');

// Quick logging (default category)
log.info('Quick message');

// Methods
logger.info(message, meta);
logger.warn(message, meta);
logger.error(message, meta);
logger.debug(message, meta);
logger.trace(message, meta);

// Child logger with context
const childLogger = logger.child({ requestId: '123' });

// Performance timing
const timer = logger.time('operation');
// ... do work ...
timer.end('Operation completed');

// Express middleware
app.use(logger.createMiddleware());
```

### Frontend Logger

```typescript
import { Logger, LogLevels } from '../utils/logging/Logger';

Logger.log(LogLevels.INFO, 'category', 'message');
Logger.info('category', 'message', optionalData);
Logger.warn('category', 'message');
Logger.error('category', 'message', { error });
Logger.debug('category', 'message');
```

## Constraint Enforcement

The constraint monitoring system enforces Logger usage via three constraints:

| Constraint | Blocked Pattern | Required Action |
|------------|-----------------|-----------------|
| no-console-log | Direct stdout logging | Use `logger.info()` or `Logger.info()` |
| no-console-error | Direct stderr error output | Use `logger.error()` or `Logger.error()` |
| no-console-warn | Direct stderr warning output | Use `logger.warn()` or `Logger.warn()` |

**Exceptions:**
- CLI tools may use `process.stdout.write()` / `process.stderr.write()` for direct output
- Test files may use direct console methods when testing console output

## Migration Guide

### Migrating from Direct Console Methods

**Before (problematic):**
```javascript
// These will be blocked by constraints
// Direct stdout/stderr usage without Logger
```

**After (Backend):**
```javascript
import { createLogger } from '../lib/logging/Logger.js';
const logger = createLogger('my-component');

logger.info('Starting process');
logger.error('Failed', { error: error.message });
logger.warn('Deprecated usage');
```

**After (Frontend):**
```typescript
import { Logger } from '../utils/logging/Logger';

Logger.info('component', 'Starting process');
Logger.error('component', 'Failed', { error });
Logger.warn('component', 'Deprecated usage');
```

## Migration Priority

Files requiring Logger migration are prioritized as follows:

### Phase 1: Core Infrastructure (High Priority)
- `lib/` - Core libraries
- `integrations/system-health-dashboard/server.js` - Dashboard backend
- `scripts/statusline-health-monitor.js` - Health monitoring
- `scripts/process-state-manager.js` - PSM

### Phase 2: MCP Servers
- `integrations/mcp-server-semantic-analysis/` - Semantic analysis
- `integrations/mcp-constraint-monitor/` - Constraint system
- `integrations/browser-access/` - Browser automation

### Phase 3: Knowledge Management
- `src/knowledge-management/` - UKB services
- `src/databases/` - Database managers
- `lib/vkb-server/` - VKB API

### Phase 4: Live Logging
- `src/live-logging/` - LSL system
- `scripts/batch-lsl-processor.js` - Batch processing
- `scripts/enhanced-transcript-monitor.js` - Transcript monitoring

### Phase 5: Utilities and Tests
- `scripts/` - Remaining utility scripts
- `tests/` - Test files (lower priority, may keep direct console for testing output)

## Related Documentation

- [Constraint Monitoring System](../constraints/README.md)
- [Health Monitoring](../health-system/monitoring-system.md)
