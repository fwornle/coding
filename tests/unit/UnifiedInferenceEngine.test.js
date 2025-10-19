/**
 * UnifiedInferenceEngine Unit Tests
 *
 * Tests all FR-1 requirements:
 * 1. Provider routing logic (Groq/OpenRouter/local)
 * 2. Circuit breaker behavior
 * 3. Caching functionality
 * 4. Budget enforcement
 * 5. Sensitivity routing
 * 6. Streaming response handling
 * 7. Error handling and recovery
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedInferenceEngine } from '../../src/inference/UnifiedInferenceEngine.js';
import { BudgetTracker } from '../../src/budget/BudgetTracker.js';
import { AgentAgnosticCache } from '../../src/caching/AgentAgnosticCache.js';

describe('UnifiedInferenceEngine', () => {
  let engine;
  let mockBudgetTracker;
  let mockCache;
  let mockProviders;

  beforeEach(() => {
    // Mock budget tracker
    mockBudgetTracker = {
      checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
      trackCost: vi.fn().mockResolvedValue(true),
      getCurrentUsage: vi.fn().mockResolvedValue({ used: 1.0, limit: 8.33, percentage: 12 })
    };

    // Mock cache
    mockCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(true)
    };

    // Mock providers
    mockProviders = {
      groq: {
        name: 'groq',
        available: true,
        infer: vi.fn().mockResolvedValue({
          content: 'Groq response',
          provider: 'groq',
          model: 'llama-3.3-70b',
          tokens: { input: 100, output: 50 },
          cost: 0.001
        })
      },
      openrouter: {
        name: 'openrouter',
        available: true,
        infer: vi.fn().mockResolvedValue({
          content: 'OpenRouter response',
          provider: 'openrouter',
          model: 'anthropic/claude-3.5-sonnet',
          tokens: { input: 100, output: 50 },
          cost: 0.005
        })
      },
      local: {
        name: 'local',
        available: true,
        infer: vi.fn().mockResolvedValue({
          content: 'Local model response',
          provider: 'local',
          model: 'llama-3.2-3b',
          tokens: { input: 100, output: 50 },
          cost: 0.0
        })
      }
    };
  });

  afterEach(() => {
    if (engine) {
      engine.close();
    }
  });

  describe('FR-1.1: Provider Routing Logic', () => {

    it('should route to Groq by default for non-sensitive content', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      const result = await engine.infer('What is caching?');

      expect(mockProviders.groq.infer).toHaveBeenCalledWith(
        'What is caching?',
        expect.any(Object)
      );
      expect(result.provider).toBe('groq');
      expect(result.content).toBe('Groq response');
    });

    it('should route to OpenRouter when explicitly specified', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      const result = await engine.infer('Complex reasoning task', {
        provider: 'openrouter'
      });

      expect(mockProviders.openrouter.infer).toHaveBeenCalled();
      expect(result.provider).toBe('openrouter');
    });

    it('should route to local model when offline mode enabled', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        offlineMode: true
      });

      const result = await engine.infer('Simple classification');

      expect(mockProviders.local.infer).toHaveBeenCalled();
      expect(result.provider).toBe('local');
      expect(result.cost).toBe(0.0);
    });

    it('should fallback to next available provider when primary fails', async () => {
      // Make Groq fail
      mockProviders.groq.infer.mockRejectedValueOnce(new Error('Provider unavailable'));

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'openrouter', 'local']
      });

      const result = await engine.infer('Test prompt');

      expect(mockProviders.groq.infer).toHaveBeenCalled();
      expect(mockProviders.openrouter.infer).toHaveBeenCalled();
      expect(result.provider).toBe('openrouter');
      expect(result.fallback).toBe(true);
    });

    it('should respect provider availability flags', async () => {
      mockProviders.groq.available = false;

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'openrouter', 'local']
      });

      const result = await engine.infer('Test');

      expect(mockProviders.groq.infer).not.toHaveBeenCalled();
      expect(mockProviders.openrouter.infer).toHaveBeenCalled();
    });
  });

  describe('FR-1.2: Circuit Breaker Behavior', () => {

    it('should open circuit breaker after consecutive failures', async () => {
      const failureThreshold = 3;

      // Make provider fail consistently
      mockProviders.groq.infer.mockRejectedValue(new Error('Service error'));

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        circuitBreaker: {
          failureThreshold,
          resetTimeout: 60000
        }
      });

      // Trigger failures
      for (let i = 0; i < failureThreshold; i++) {
        try {
          await engine.infer('Test');
        } catch (error) {
          // Expected to fail - circuit breaker will open
          expect(error).toBeDefined();
        }
      }

      // Circuit should now be open
      const status = engine.getCircuitBreakerStatus('groq');
      expect(status.state).toBe('open');
      expect(status.failures).toBe(failureThreshold);
    });

    it('should bypass circuit breaker and fail immediately when open', async () => {
      const failureThreshold = 2;
      mockProviders.groq.infer.mockRejectedValue(new Error('Service error'));

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'local'],
        circuitBreaker: {
          failureThreshold,
          resetTimeout: 1000
        }
      });

      // Trigger circuit breaker
      for (let i = 0; i < failureThreshold; i++) {
        try {
          await engine.infer('Test');
        } catch (error) {
          // Expected failure
          expect(error).toBeDefined();
        }
      }

      // Next request should bypass Groq entirely
      const callCountBefore = mockProviders.groq.infer.mock.calls.length;
      const result = await engine.infer('Test');
      const callCountAfter = mockProviders.groq.infer.mock.calls.length;

      expect(callCountAfter).toBe(callCountBefore); // No new calls to Groq
      expect(result.provider).toBe('local'); // Fell back to local
    });

    it('should reset circuit breaker after timeout', async () => {
      const resetTimeout = 100; // Short timeout for testing
      mockProviders.groq.infer
        .mockRejectedValueOnce(new Error('Error'))
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce({
          content: 'Success after reset',
          provider: 'groq',
          cost: 0.001
        });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout
        }
      });

      // Trigger failures
      try {
        await engine.infer('Test');
      } catch (error) {
        expect(error).toBeDefined();
      }
      try {
        await engine.infer('Test');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Circuit is open
      expect(engine.getCircuitBreakerStatus('groq').state).toBe('open');

      // Wait for reset
      await new Promise(resolve => setTimeout(resolve, resetTimeout + 50));

      // Should try again after reset
      const result = await engine.infer('Test');
      expect(result.content).toBe('Success after reset');
      expect(engine.getCircuitBreakerStatus('groq').state).toBe('closed');
    });

    it('should track circuit breaker state independently per provider', async () => {
      mockProviders.groq.infer.mockRejectedValue(new Error('Groq error'));
      mockProviders.openrouter.infer.mockResolvedValue({
        content: 'OpenRouter works',
        provider: 'openrouter',
        cost: 0.005
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 60000
        }
      });

      // Break Groq circuit
      try {
        await engine.infer('Test', { provider: 'groq' });
      } catch (error) {
        expect(error).toBeDefined();
      }
      try {
        await engine.infer('Test', { provider: 'groq' });
      } catch (error) {
        expect(error).toBeDefined();
      }

      const groqStatus = engine.getCircuitBreakerStatus('groq');
      const openrouterStatus = engine.getCircuitBreakerStatus('openrouter');

      expect(groqStatus.state).toBe('open');
      expect(openrouterStatus.state).toBe('closed');
    });
  });

  describe('FR-1.3: Caching Functionality', () => {

    it('should cache successful inference results', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      const prompt = 'What is caching?';
      await engine.infer(prompt);

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining(prompt.substring(0, 20)),
        expect.objectContaining({
          content: 'Groq response',
          provider: 'groq'
        })
      );
    });

    it('should return cached results when available', async () => {
      const cachedResult = {
        content: 'Cached response',
        provider: 'groq',
        cached: true,
        timestamp: Date.now()
      };

      mockCache.get.mockResolvedValueOnce(cachedResult);

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      const result = await engine.infer('What is caching?');

      expect(result.cached).toBe(true);
      expect(result.content).toBe('Cached response');
      expect(mockProviders.groq.infer).not.toHaveBeenCalled();
    });

    it('should skip cache when disabled', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: false
      });

      await engine.infer('Test');

      expect(mockCache.get).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
      expect(mockProviders.groq.infer).toHaveBeenCalled();
    });

    it('should bypass cache when skipCache option is true', async () => {
      mockCache.get.mockResolvedValue({ content: 'Cached', cached: true });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      const result = await engine.infer('Test', { skipCache: true });

      expect(mockCache.get).not.toHaveBeenCalled();
      expect(mockProviders.groq.infer).toHaveBeenCalled();
      expect(result.cached).toBeUndefined();
    });

    it('should generate consistent cache keys for identical prompts', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      const prompt = 'What is a cache?';

      await engine.infer(prompt);
      await engine.infer(prompt);

      const firstCallKey = mockCache.set.mock.calls[0][0];
      const secondCallKey = mockCache.set.mock.calls[1][0];

      expect(firstCallKey).toBe(secondCallKey);
    });

    it('should not cache errors', async () => {
      mockProviders.groq.infer.mockRejectedValue(new Error('Inference failed'));
      mockProviders.local.infer.mockResolvedValue({
        content: 'Fallback',
        provider: 'local',
        cost: 0.0
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'local'],
        enableCache: true
      });

      try {
        await engine.infer('Test');
      } catch (error) {
        // Error may be thrown if all providers fail
        expect(error).toBeDefined();
      }

      // Should not cache the error
      expect(mockCache.set).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ error: expect.anything() })
      );
    });
  });

  describe('FR-1.4: Budget Enforcement', () => {

    it('should check budget before inference', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      await engine.infer('Test', { estimatedCost: 0.01 });

      expect(mockBudgetTracker.checkBudget).toHaveBeenCalledWith({
        estimatedCost: 0.01
      });
    });

    it('should reject inference when budget exceeded', async () => {
      mockBudgetTracker.checkBudget.mockResolvedValue({
        allowed: false,
        reason: 'Monthly budget exceeded'
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      await expect(engine.infer('Test')).rejects.toThrow('Budget exceeded');
      expect(mockProviders.groq.infer).not.toHaveBeenCalled();
    });

    it('should track actual cost after successful inference', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      await engine.infer('Test');

      expect(mockBudgetTracker.trackCost).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'groq',
          cost: 0.001,
          tokens: { input: 100, output: 50 }
        })
      );
    });

    it('should not track cost for cached responses', async () => {
      mockCache.get.mockResolvedValue({
        content: 'Cached',
        cached: true,
        provider: 'groq'
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      await engine.infer('Test');

      expect(mockBudgetTracker.trackCost).not.toHaveBeenCalled();
    });

    it('should prefer cheaper provider when budget is tight', async () => {
      mockBudgetTracker.getCurrentUsage.mockResolvedValue({
        used: 7.5,
        limit: 8.33,
        percentage: 90
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'openrouter',
        budgetAwareRouting: true
      });

      const result = await engine.infer('Test');

      // Should route to Groq (cheaper) instead of OpenRouter
      expect(result.provider).toBe('groq');
      expect(mockProviders.openrouter.infer).not.toHaveBeenCalled();
    });

    it('should track zero cost for local model inference', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'local'
      });

      await engine.infer('Test');

      expect(mockBudgetTracker.trackCost).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'local',
          cost: 0.0
        })
      );
    });
  });

  describe('FR-1.5: Sensitivity Routing', () => {

    it('should route sensitive content to local model by default', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        sensitivityRouting: true
      });

      const result = await engine.infer('API key: sk_test_abc123', {
        sensitivity: 'high'
      });

      expect(mockProviders.local.infer).toHaveBeenCalled();
      expect(mockProviders.groq.infer).not.toHaveBeenCalled();
      expect(result.provider).toBe('local');
    });

    it('should auto-detect sensitive content patterns', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        sensitivityRouting: true,
        autoDetectSensitivity: true
      });

      // Test various sensitive patterns
      const sensitivePrompts = [
        'My password is abc123',
        'Connect to mongodb://user:pass@localhost',
        'SSH key: ssh-rsa AAAAB3...',
        'Bearer token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      ];

      for (const prompt of sensitivePrompts) {
        await engine.infer(prompt);
      }

      // All should route to local
      expect(mockProviders.local.infer).toHaveBeenCalledTimes(sensitivePrompts.length);
      expect(mockProviders.groq.infer).not.toHaveBeenCalled();
    });

    it('should respect explicit sensitivity override', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        sensitivityRouting: true,
        autoDetectSensitivity: true
      });

      // Force sensitive content to remote (user explicitly allows)
      const result = await engine.infer('My API key is xyz', {
        sensitivity: 'none',
        allowRemote: true
      });

      expect(mockProviders.groq.infer).toHaveBeenCalled();
      expect(result.provider).toBe('groq');
    });

    it('should not cache sensitive content', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true,
        sensitivityRouting: true
      });

      await engine.infer('Password: secret123', { sensitivity: 'high' });

      expect(mockCache.set).not.toHaveBeenCalled();
    });
  });

  describe('FR-1.6: Streaming Response Handling', () => {

    it('should support streaming responses from providers', async () => {
      const mockStreamProvider = {
        name: 'groq',
        available: true,
        inferStream: vi.fn().mockImplementation(async function* (prompt) {
          yield { delta: 'Hello', done: false };
          yield { delta: ' ', done: false };
          yield { delta: 'world', done: false };
          yield { delta: '', done: true, cost: 0.001 };
        })
      };

      engine = new UnifiedInferenceEngine({
        providers: { groq: mockStreamProvider },
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      const chunks = [];
      for await (const chunk of engine.inferStream('Test')) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(4);
      expect(chunks[0].delta).toBe('Hello');
      expect(chunks[3].done).toBe(true);
    });

    it('should accumulate full response from stream', async () => {
      const mockStreamProvider = {
        name: 'groq',
        available: true,
        inferStream: vi.fn().mockImplementation(async function* (prompt) {
          yield { delta: 'Part1', done: false };
          yield { delta: 'Part2', done: false };
          yield { delta: '', done: true, fullContent: 'Part1Part2', cost: 0.001 };
        })
      };

      engine = new UnifiedInferenceEngine({
        providers: { groq: mockStreamProvider },
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      let fullContent = '';
      for await (const chunk of engine.inferStream('Test')) {
        if (!chunk.done) {
          fullContent += chunk.delta;
        }
      }

      expect(fullContent).toBe('Part1Part2');
    });

    it('should fallback to non-streaming when stream unavailable', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders, // No streaming support
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      const chunks = [];
      for await (const chunk of engine.inferStream('Test')) {
        chunks.push(chunk);
      }

      // Should return single chunk with full content
      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe('Groq response');
      expect(chunks[0].done).toBe(true);
    });

    it('should not cache streaming responses', async () => {
      const mockStreamProvider = {
        name: 'groq',
        available: true,
        inferStream: vi.fn().mockImplementation(async function* (prompt) {
          yield { delta: 'Test', done: false };
          yield { delta: '', done: true, cost: 0.001 };
        })
      };

      engine = new UnifiedInferenceEngine({
        providers: { groq: mockStreamProvider },
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      for await (const chunk of engine.inferStream('Test')) {
        // Consume stream
      }

      expect(mockCache.set).not.toHaveBeenCalled();
    });
  });

  describe('FR-1.7: Error Handling and Recovery', () => {

    it('should handle provider timeout gracefully', async () => {
      mockProviders.groq.infer.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return { content: 'Too slow', provider: 'groq' };
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'local'],
        timeout: 100
      });

      const result = await engine.infer('Test');

      // Should fallback to local after timeout
      expect(result.provider).toBe('local');
      expect(result.fallback).toBe(true);
    });

    it('should retry failed requests with exponential backoff', async () => {
      let attempts = 0;
      mockProviders.groq.infer.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient error');
        }
        return { content: 'Success', provider: 'groq', cost: 0.001 };
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        retry: {
          maxAttempts: 3,
          backoff: 'exponential',
          initialDelay: 10
        }
      });

      const result = await engine.infer('Test');

      expect(attempts).toBe(3);
      expect(result.content).toBe('Success');
    });

    it('should handle malformed provider responses', async () => {
      mockProviders.groq.infer.mockResolvedValue({
        // Missing required fields
        provider: 'groq'
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'local']
      });

      const result = await engine.infer('Test');

      // Should validate response and fallback
      expect(result.provider).toBe('local');
      expect(result.fallback).toBe(true);
    });

    it('should provide detailed error information', async () => {
      mockProviders.groq.infer.mockRejectedValue(new Error('Rate limit exceeded'));
      mockProviders.local.available = false;

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'local']
      });

      try {
        await engine.infer('Test');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Rate limit exceeded');
        expect(error.provider).toBe('groq');
        expect(error.attemptedFallbacks).toContain('local');
      }
    });

    it('should recover from provider failure and continue', async () => {
      mockProviders.groq.infer
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce({ content: 'Second success', provider: 'groq', cost: 0.001 });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'local']
      });

      // First call should fallback
      const result1 = await engine.infer('Test1');
      expect(result1.provider).toBe('local');

      // Second call should succeed with Groq (circuit not broken)
      const result2 = await engine.infer('Test2');
      expect(result2.provider).toBe('groq');
    });

    it('should handle concurrent requests safely', async () => {
      mockProviders.groq.infer.mockImplementation(async (prompt) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          content: `Response for: ${prompt}`,
          provider: 'groq',
          cost: 0.001
        };
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      // Make 10 concurrent requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(engine.infer(`Prompt ${i}`));
      }

      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
      expect(mockProviders.groq.infer).toHaveBeenCalledTimes(10);

      // Each should have unique response
      const uniqueContents = new Set(results.map(r => r.content));
      expect(uniqueContents.size).toBe(10);
    });

    it('should cleanup resources on close', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq'
      });

      await engine.close();

      expect(mockCache.close).toHaveBeenCalled();
    });
  });

  describe('Integration: Combined Features', () => {

    it('should handle cached result with budget check skipped', async () => {
      mockCache.get.mockResolvedValue({
        content: 'Cached',
        cached: true,
        provider: 'groq'
      });

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      const result = await engine.infer('Test');

      expect(result.cached).toBe(true);
      expect(mockBudgetTracker.checkBudget).not.toHaveBeenCalled();
      expect(mockBudgetTracker.trackCost).not.toHaveBeenCalled();
    });

    it('should respect all constraints: budget + sensitivity + circuit breaker', async () => {
      // Set up: budget tight, Groq circuit open, sensitive content
      mockBudgetTracker.getCurrentUsage.mockResolvedValue({
        used: 7.9,
        limit: 8.33,
        percentage: 95
      });

      mockProviders.groq.infer.mockRejectedValue(new Error('Circuit open'));

      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        fallbackChain: ['groq', 'openrouter', 'local'],
        budgetAwareRouting: true,
        sensitivityRouting: true,
        circuitBreaker: { failureThreshold: 1, resetTimeout: 60000 }
      });

      // Break Groq circuit
      try {
        await engine.infer('Test');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Now make sensitive request with tight budget
      const result = await engine.infer('API key: xyz', { sensitivity: 'high' });

      // Should route to local (free, no circuit breaker, handles sensitive)
      expect(result.provider).toBe('local');
      expect(mockProviders.openrouter.infer).not.toHaveBeenCalled();
    });

    it('should provide comprehensive statistics', async () => {
      engine = new UnifiedInferenceEngine({
        providers: mockProviders,
        budgetTracker: mockBudgetTracker,
        cache: mockCache,
        defaultProvider: 'groq',
        enableCache: true
      });

      // Mix of cached and uncached
      await engine.infer('Query 1');
      mockCache.get.mockResolvedValueOnce({ content: 'Cached', cached: true });
      await engine.infer('Query 2');
      await engine.infer('Query 3');

      const stats = engine.getStatistics();

      expect(stats.totalRequests).toBe(3);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(2);
      expect(stats.providerUsage.groq).toBe(2);
      expect(stats.totalCost).toBeCloseTo(0.002);
    });
  });
});
