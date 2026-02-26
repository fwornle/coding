# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- PascalCase for class files: `KnowledgeExtractor.js`, `GraphDatabaseService.js`, `OntologyManager.js`
- camelCase for utility/service files: `knowledge-paths.js`, `git-analyzer.js`, `logging.js`
- kebab-case for configuration and test files: `live-logging-config.json`, `full-system-validation.test.js`

**Functions & Methods:**
- camelCase for all function and method names: `extractObservations()`, `initialize()`, `queryByEntityClass()`
- Private methods prefixed with underscore: `_log()`, `_createLogEntry()`, `_logToConsole()`
- Async functions use async/await pattern consistently

**Variables:**
- camelCase for all variables and constants: `databaseManager`, `sessionId`, `minConfidence`
- UPPER_SNAKE_CASE for configuration constants and enums
  - Example from `KnowledgeExtractor.js`: `KNOWLEDGE_TYPES`, `CONFIDENCE_THRESHOLDS`
  - Example from `Logger.js`: `LEVELS` static constant

**Types:**
- PascalCase for class names: `Logger`, `EntityManager`, `OntologyClassifier`
- camelCase for type properties and generic type names
- Interface types prefixed with `I` when using TypeScript interfaces (observed in `.test.ts` files)

## Code Style

**Formatting:**
- No formatter explicitly configured (no .prettierrc found)
- Consistent 2-space indentation throughout codebase
- Line length: Generally kept under 100-120 characters
- Semicolons: Always present (semicolon-required style)

**Linting:**
- ESLint configured in `package.json` with `eslint` v8.55.0
- Run with: `npm run lint` (lints `lib/` directory)
- No visible `.eslintrc` file in root (may use ESM export defaults in config if present)

**Structure:**
- Single class per file (one public export per module)
- Related utilities grouped in directory structure (`src/knowledge-management/`, `src/live-logging/`, `lib/knowledge-api/`)
- Barrel exports pattern: Index files export multiple modules

## Import Organization

**Order:**
1. Node.js built-in modules: `import fs from 'fs'`, `import path from 'path'`, `import crypto from 'crypto'`
2. Third-party dependencies: `import { EventEmitter } from 'events'`, `import Graph from 'graphology'`, `import { Level } from 'level'`
3. Local modules: `import { OntologyQueryEngine } from '../ontology/OntologyQueryEngine.js'`

**Path Aliases:**
- Relative imports using `./` and `../` patterns consistently
- File extensions included: `import Something from './module.js'` (required for ESM)
- Use of `fileURLToPath` and `import.meta.url` for __dirname compatibility in ESM

**Export Style:**
- Named exports preferred: `export class EntityManager { }`
- Default exports used for single-class modules or barrel exports
- Mixed CommonJS/ESM: Some files use `require()`, others use `import` (gradual migration)

## Error Handling

**Patterns:**
- Always validate required parameters at class construction:
  ```javascript
  if (!this.databaseManager || !this.inferenceEngine) {
    throw new Error('KnowledgeExtractor requires databaseManager and inferenceEngine');
  }
  ```
- Throw descriptive errors for invalid states: `throw new Error('Entity name is required')`
- Try-catch blocks used for async operations and external service calls
- Catch blocks log errors and continue with fallbacks when appropriate
- Error messages include context: What was being attempted and why it failed

**Validation:**
- Input validation occurs at method entry points
- Parameter existence checks: `if (!filePath)` patterns used
- Type validation via JSDoc comments rather than runtime type checking

## Logging

**Framework:** console methods (console.log, console.error) with custom Logger class in `lib/knowledge-api/utils/logging.js`

**Patterns:**
- Console logging prefixed with class name in brackets: `console.log('[KnowledgeRetractor] Initializing...')`
- Structured logging via Logger utility supporting multiple levels: error, warn, info, debug, trace
- Logger provides factory methods: `Logger.createConsoleLogger()`, `Logger.createFileLogger()`, `Logger.createCombinedLogger()`
- Timing utilities: `logger.time('label')` returns timer with `.end()` method
- API call logging: `logger.logApiCall(method, endpoint, status, duration, meta)`
- Operation logging: `logger.logOperation(operation, status, metadata)`

**Use cases:**
- Initialization messages logged at start of constructors
- Significant operations logged with result counts: `console.log('[KnowledgeExtractor] Extracted ${knowledgeItems.length} knowledge items')`
- Performance metrics logged via logger.debug with duration metadata
- Memory profiling available via `logger.logMemoryUsage()`

## Comments

**When to Comment:**
- Class-level JSDoc block describing purpose, features, and usage: Always present for major classes
- JSDoc comments for public methods documenting parameters, returns, and throws
- Inline comments explain WHY, not WHAT (code should be self-documenting)
- Comments include example usage in JSDoc: Common pattern showing instantiation and method calls

**JSDoc/TSDoc:**
- Full JSDoc format used for public APIs:
  ```javascript
  /**
   * Create a new entity
   * @param {Object} entityData - Entity data object
   * @returns {Promise<Entity>} Created entity with generated ID
   * @throws {Error} If entity data is invalid or duplicate exists
   */
  ```
- Parameters documented with type and description
- Return types documented with descriptions
- Throws clause documents error conditions
- Example usage sections provided for complex classes

## Function Design

**Size:**
- Methods typically 20-50 lines, aim for single responsibility
- Long methods broken into private helper methods
- Complex logic extracted into separate private methods: `_createLogEntry()`, `_logToConsole()`, `_validateEntity()`

**Parameters:**
- Configuration passed as object parameter for flexibility:
  ```javascript
  constructor(config = {}) {
    this.databaseManager = config.databaseManager;
    this.vectorSize = config.vectorSize || 1536;
  }
  ```
- Validate all required config values in constructor
- Default values provided for optional config properties

**Return Values:**
- Async methods always return Promise
- Methods return meaningful objects with metadata when appropriate
- Errors thrown rather than returning error codes
- Null/empty returns documented in JSDoc

## Module Design

**Exports:**
- Classes exported as named exports: `export class ClassName { }`
- Utility functions exported individually or grouped
- Constants exported alongside implementation

**Barrel Files:**
- `index.js` files aggregate related modules for convenient imports
- Example: `lib/knowledge-api/index.js` re-exports all core modules
- Barrel files make top-level directory imports possible

**Class Structure:**
- Public methods documented with JSDoc
- Private methods prefixed with `_` and used for internal operations
- Static factory methods provided: `Logger.createConsoleLogger()`
- EventEmitter pattern used for observable state changes in some classes

## Special Patterns

**EventEmitter Usage:**
- Knowledge classes extend EventEmitter for state notifications
- Allows consumers to subscribe to extraction/update events
- Pattern seen in: `KnowledgeRetriever`, `KnowledgeExtractor`, `TrajectoryAnalyzer`

**Configuration Objects:**
- Prefer configuration object parameters over multiple parameters
- Store config properties on instance for later use
- Configuration validation on construction

**Async/Await:**
- All async operations use async/await (no .then() chains)
- Error handling via try/catch, not .catch() handlers
- Promise.all() used for concurrent operations when safe

---

*Convention analysis: 2026-02-26*
