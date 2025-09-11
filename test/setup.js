// Jest setup file for ReliableCodingClassifier tests
// This file runs before each test suite

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console.log/warn/error to reduce test output noise
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

beforeAll(() => {
  // Only show console output in verbose mode
  if (!process.env.VERBOSE_TESTS) {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  if (!process.env.VERBOSE_TESTS) {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
});

// Global test utilities
global.createMockExchange = (userMessage, assistantResponse, metadata = {}) => ({
  userMessage: userMessage || 'Test user message',
  assistantResponse: assistantResponse || 'Test assistant response',
  metadata: {
    timestamp: Date.now(),
    sessionId: 'test-session',
    ...metadata
  }
});

// Performance testing utilities
global.measurePerformance = async (fn, iterations = 1) => {
  const times = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1000000); // Convert to milliseconds
  }
  
  return {
    times,
    average: times.reduce((sum, time) => sum + time, 0) / times.length,
    min: Math.min(...times),
    max: Math.max(...times)
  };
};