# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:**
- Jest v29.7.0 - Primary test runner
- Vitest - Used alongside Jest for specific test suites
- Config: `jest.config.js` at root
- ESM support enabled via `ts-jest/presets/default-esm`

**Run Commands:**
```bash
npm run test              # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Generate coverage report
NODE_OPTIONS='--experimental-vm-modules --no-warnings' jest  # Manual run with ESM
```

**Test Environment:**
- Node.js test environment (not browser)
- Test timeout: 30 seconds (jest.config.js line 19: `testTimeout: 30000`)
- Setup file: `test/setup.js` runs before all tests (if exists)

**Assertion Library:**
- Jest built-in assertions: `expect().toBe()`, `expect().toEqual()`, `expect().toMatch()`
- Node.js `assert` module used in some tests: `assert.strictEqual()`, `assert.rejects()`
- Vitest assertions with `expect()` pattern

## Test File Organization

**Location Patterns:**
- Co-located with source code in same directory structure
- Primary test directories: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/acceptance/`, `tests/performance/`
- Library tests: `lib/knowledge-api/test/`, `lib/llm/__tests__/`
- Library test pattern uses `test` or `__tests__` folders alongside `core/` and `adapters/`

**File Naming:**
- Pattern: `[FileName].test.js` or `[FileName].test.ts`
- Match pattern in jest.config.js: `**/test/**/*.test.js` and `**/tests/**/*.test.js`
- Example files:
  - `tests/unit/ontology/OntologyQueryEngine.test.js`
  - `tests/integration/full-system-validation.test.js`
  - `tests/unit/knowledge-management/KnowledgeExtraction.test.ts`

**Directory Structure:**
```
tests/
  unit/                   # Unit tests for individual modules
    ontology/
    knowledge-management/
    fixtures/             # Test data and fixtures
  integration/            # Integration tests across modules
  e2e/                   # End-to-end tests
  acceptance/            # Acceptance/user-level tests
  performance/           # Performance and benchmarking tests
  security/              # Security validation tests
  live-logging/          # Live logging specific tests
  data/                  # Test data files
```

## Test Structure

**Suite Organization:**
- Top-level describe block for test suite: `describe('OntologyQueryEngine', () => { })`
- Nested describe blocks for feature grouping: `describe('FR-6.1: Observation Extraction', () => { })`
- Each test is atomic and runnable independently

**Jest Pattern Example:**
```javascript
describe('OntologyQueryEngine', () => {
  let manager;
  let queryEngine;

  beforeEach(async () => {
    // Initialize resources
    manager = new OntologyManager(config);
    await manager.initialize();
    queryEngine = new OntologyQueryEngine(manager);
  });

  test('should find entities by class', async () => {
    const results = await queryEngine.findByEntityClass('RPU');
    expect(results).toHaveLength(2);
    expect(results[0].entityType).toBe('RPU');
  });
});
```

**Vitest Pattern Example (from KnowledgeExtraction.test.ts):**
```typescript
describe('Knowledge Extraction Unit Tests', () => {
  let extractor: MockKnowledgeExtractor;

  beforeEach(() => {
    extractor = new MockKnowledgeExtractor({ bufferSize: 5 });
  });

  describe('FR-6.1: Observation Extraction from Transcripts', () => {
    it('should extract observations from exchanges', async () => {
      const observations = await extractor.extractObservations(exchanges);
      expect(observations).toHaveLength(4);
      expect(observations[0].type).toBe('user_query');
    });
  });
});
```

**Node.js test Pattern (from entities.test.js):**
```javascript
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

describe('EntityManager', () => {
  let entityManager;

  beforeEach(async () => {
    entityManager = new EntityManager(storage, validation, logger);
  });

  test('should create a new entity', async () => {
    const entity = await entityManager.create(entityData);
    assert.strictEqual(entity.name, 'TestEntity');
    assert.ok(entity.id);
  });
});
```

**Setup and Teardown:**
- `beforeEach()` - Runs before each test (setup)
- `afterEach()` - Runs after each test (cleanup)
- Common setup: Initialize database, create test fixtures, mock dependencies
- Common teardown: Delete test files, close connections, reset state

## Mocking

**Framework:**
- Jest: `jest.fn()`, `jest.mock()`, `jest.spyOn()`
- Vitest: `vi.fn()`, `vi.mock()`, `vi.spyOn()`

**Mock Function Patterns:**

Jest mocking:
```javascript
const mockInferenceEngine = {
  generateCompletion: jest.fn().mockResolvedValue({ text: 'result' }),
  getCostEstimate: jest.fn().mockReturnValue({ totalCost: 0.001 })
};
```

Vitest mocking:
```javascript
const mockBudgetManager = {
  checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
  trackCost: vi.fn().mockResolvedValue(true),
  getCurrentUsage: vi.fn().mockResolvedValue({ used: 1.0, limit: 8.33 })
};
```

**What to Mock:**
- External service dependencies: LLM APIs, databases, file systems
- Time-dependent operations: Use fake timers if testing timeout behavior
- Heavy computations: Embeddings, ontology classification
- Async operations that are slow in real tests

**What NOT to Mock:**
- Core business logic of the class under test
- Small utility functions
- Data validation logic
- The actual module being tested (only dependencies)

## Fixtures and Factories

**Test Data Location:**
- `tests/fixtures/` - Shared fixture files across test suites
- `tests/fixtures/ontologies/` - Ontology test data
- `tests/fixtures/integration/` - Integration test fixtures
- Inline fixture creation in test setup blocks for simple data

**Factory/Builder Pattern (from KnowledgeExtraction.test.ts):**
```typescript
class MockKnowledgeExtractor {
  async extractObservations(exchanges: Exchange[]): Promise<Observation[]> {
    const observations: Observation[] = [];
    for (const exchange of exchanges) {
      const userObs = this.createObservation(
        exchange.user,
        'user_query',
        exchange.timestamp
      );
      observations.push(userObs);
    }
    return observations;
  }

  private createObservation(content: string, type: string, timestamp: number): Observation {
    return {
      id: `obs-${Date.now()}`,
      content,
      type,
      timestamp,
      confidence: 0.9
    };
  }
}
```

**Fixture File Pattern:**
```javascript
// tests/fixtures/test-entities.json
[
  {
    id: 'k1',
    content: 'RPU configuration for virtual target',
    ontology: {
      entityClass: 'RPU',
      team: 'ReSi',
      confidence: 0.9,
      properties: { name: 'SensorFusion' }
    }
  }
]
```

## Coverage

**Requirements:** No enforced minimum coverage threshold configured

**View Coverage:**
```bash
npm run test:coverage
# Generates coverage in ./coverage directory
# Reporters: text, lcov, html
```

**Coverage Configuration (jest.config.js):**
- Collects from: `src/**/*.{js,ts}`, `lib/**/*.js`
- Ignores: `node_modules/**`, `coverage/**`, `**/*.d.ts`
- Directory: `coverage/`
- Reporters: text (console), lcov (for CI), html (visual)

## Test Types

**Unit Tests:**
- Location: `tests/unit/`
- Scope: Individual class or function
- Dependencies: Heavily mocked
- Examples: `OntologyQueryEngine.test.js`, `OntologyClassifier.test.js`
- Approach: Test public interface, validate internal logic with mocks

**Integration Tests:**
- Location: `tests/integration/`
- Scope: Multiple components working together
- Dependencies: Some real, some mocked (e.g., real database, mocked LLM)
- Examples: `EmbeddingClassification.test.js`, `http-api.test.js`
- Approach: Test component interactions and data flow

**E2E Tests:**
- Location: `tests/e2e/`
- Scope: Complete user workflows
- Dependencies: Mostly real (requires running services)
- Examples: `knowledge-learning-workflow.test.js`, `real-time-monitoring.test.js`
- Approach: Validate end-to-end flows using actual system components

**Performance Tests:**
- Location: `tests/performance/`
- Scope: Performance benchmarks and optimization validation
- Examples: `semantic-cost-optimization.test.js`, `classification-performance.test.js`
- Approach: Measure timing, throughput, verify performance targets are met

**Acceptance Tests:**
- Location: `tests/acceptance/`
- Scope: User-visible requirements validation
- Examples: `knowledge-system-acceptance.test.js`
- Approach: Black-box testing of system behavior

## Common Patterns

**Async Testing - Jest with async/await:**
```javascript
test('should extract knowledge from session', async () => {
  const result = await extractor.extractFromSession(filePath);
  expect(result).toBeDefined();
  expect(result.length).toBeGreaterThan(0);
});
```

**Async Testing - Node test with async/await:**
```javascript
test('should create entity', async () => {
  const entity = await entityManager.create(entityData);
  assert.strictEqual(entity.name, 'TestEntity');
});
```

**Error Testing - Jest:**
```javascript
test('should throw on invalid entity data', async () => {
  await expect(
    entityManager.create({ name: '', entityType: 'Problem' })
  ).rejects.toThrow('Invalid entity data');
});
```

**Error Testing - Node test:**
```javascript
test('should throw on duplicate entity', async () => {
  await entityManager.create(entityData);

  await assert.rejects(
    () => entityManager.create(entityData),
    Error,
    'Entity with name already exists'
  );
});
```

**Mocking Async Functions - Vitest:**
```javascript
it('should handle cost estimation', async () => {
  mockInferenceEngine.generateCompletion.mockResolvedValue({
    text: 'result',
    tokens: 100,
    cost: 0.001
  });

  const result = await engine.generateCompletion('prompt');
  expect(result.cost).toBe(0.001);
  expect(mockInferenceEngine.generateCompletion).toHaveBeenCalledWith('prompt');
});
```

**Spy on Method Calls - Jest:**
```javascript
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('should log on initialization', async () => {
  await manager.initialize();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Initialized'));
});
```

## Test Execution

**Test Organization:**
- Tests are isolated and can run in any order
- beforeEach/afterEach ensure clean state
- Fixtures created inline or loaded from files
- Temp directories created for file system tests: `path.join(process.cwd(), 'test-db-${Date.now()}.json')`

**Cleanup:**
```javascript
afterEach(async () => {
  try {
    await fs.unlink(testDbPath);
  } catch (error) {
    // Ignore cleanup errors
  }
});
```

**Performance Considerations:**
- Test timeout set to 30 seconds for integration/E2E tests
- Database operations use temporary files rather than persistent storage
- Mock expensive operations (embeddings, LLM calls)
- Use `test.skip()` or `test.only()` for debugging individual tests

---

*Testing analysis: 2026-02-26*
