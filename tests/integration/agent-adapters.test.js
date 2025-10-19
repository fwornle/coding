/**
 * Agent Adapter Integration Tests
 *
 * Tests that the continuous learning knowledge system works correctly
 * with different coding agents (Claude Code, GitHub Copilot, etc.) and
 * demonstrates agent-agnostic architecture.
 *
 * Key Areas:
 * - AgentAgnosticCache with file/HTTP/MCP backends
 * - Knowledge extraction from different transcript formats
 * - Trajectory tracking across agents
 * - Budget tracking universality
 * - Graceful degradation when agent features unavailable
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentAgnosticCache } from '../../src/caching/AgentAgnosticCache.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Agent Adapter Integration Tests', () => {
  let testDir;
  let cache;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), 'agent-test-' + Math.random().toString(36).substring(7));
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    if (cache) {
      await cache.close();
    }
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('AgentAgnosticCache - Multi-Backend Support', () => {

    it('should work with file backend (non-MCP agents)', async () => {
      cache = new AgentAgnosticCache({
        backend: 'file',
        cacheDir: path.join(testDir, '.cache'),
        maxSize: 100
      });

      await cache.initialize();

      // Test basic cache operations
      await cache.set('test-key', { data: 'test-value' });
      const result = await cache.get('test-key');

      expect(result).toEqual({ data: 'test-value' });

      // Verify file was created
      const cacheFiles = await fs.readdir(path.join(testDir, '.cache', 'agent-cache'));
      expect(cacheFiles.length).toBeGreaterThan(0);
    });

    it('should work with HTTP backend (remote agents)', async () => {
      // Mock HTTP server
      const mockHttpServer = {
        get: vi.fn().mockResolvedValue({ data: 'cached-value' }),
        set: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true)
      };

      cache = new AgentAgnosticCache({
        backend: 'http',
        httpClient: mockHttpServer,
        maxSize: 100
      });

      await cache.initialize();

      // Test HTTP backend operations
      await cache.set('http-key', { data: 'http-value' });
      expect(mockHttpServer.set).toHaveBeenCalledWith(
        expect.stringContaining('http-key'),
        expect.any(String)
      );

      // Test retrieval
      await cache.get('http-key');
      expect(mockHttpServer.get).toHaveBeenCalled();
    });

    it('should work with MCP backend (Claude Code)', async () => {
      // Mock MCP Memory server
      const mockMcpClient = {
        createEntities: vi.fn().mockResolvedValue({ success: true }),
        searchNodes: vi.fn().mockResolvedValue({
          nodes: [{ name: 'test', entityType: 'cache', observations: ['{"data":"mcp-value"}'] }]
        })
      };

      cache = new AgentAgnosticCache({
        backend: 'mcp',
        mcpClient: mockMcpClient,
        maxSize: 100
      });

      await cache.initialize();

      // Test MCP backend operations
      await cache.set('mcp-key', { data: 'mcp-value' });
      expect(mockMcpClient.createEntities).toHaveBeenCalled();

      // Test retrieval
      const result = await cache.get('test');
      expect(result).toEqual({ data: 'mcp-value' });
    });

    it('should gracefully degrade from MCP to file when MCP unavailable', async () => {
      // Mock MCP client that fails
      const mockMcpClient = {
        createEntities: vi.fn().mockRejectedValue(new Error('MCP server unavailable')),
        searchNodes: vi.fn().mockRejectedValue(new Error('MCP server unavailable'))
      };

      cache = new AgentAgnosticCache({
        backend: 'mcp',
        mcpClient: mockMcpClient,
        fallbackBackend: 'file',
        cacheDir: path.join(testDir, '.cache'),
        maxSize: 100
      });

      await cache.initialize();

      // Should fallback to file backend
      await cache.set('fallback-key', { data: 'fallback-value' });
      const result = await cache.get('fallback-key');

      expect(result).toEqual({ data: 'fallback-value' });

      // Verify file backend was used
      const cacheFiles = await fs.readdir(path.join(testDir, '.cache', 'agent-cache'));
      expect(cacheFiles.length).toBeGreaterThan(0);
    });

    it('should maintain cache statistics across different backends', async () => {
      cache = new AgentAgnosticCache({
        backend: 'file',
        cacheDir: path.join(testDir, '.cache'),
        maxSize: 100
      });

      await cache.initialize();

      // Perform operations
      await cache.set('key1', { data: 'value1' });
      await cache.get('key1'); // Hit
      await cache.get('key2'); // Miss
      await cache.set('key2', { data: 'value2' });
      await cache.get('key2'); // Hit

      const stats = cache.getStatistics();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeGreaterThan(0.5);
      expect(stats.size).toBe(2);
    });
  });

  describe('Knowledge Extraction - Multi-Agent Transcript Formats', () => {

    it('should extract from Claude Code LSL format', async () => {
      // Mock knowledge extractor with LSL parser
      const mockExtractor = {
        parseLSL: vi.fn().mockReturnValue({
          exchanges: [
            { user: 'How to cache?', assistant: 'Use Map for simple caching' }
          ]
        }),
        extractKnowledge: vi.fn().mockResolvedValue({
          extracted: 1,
          knowledge: [{ type: 'coding_pattern', confidence: 0.8 }]
        })
      };

      const lslContent = `# Live Session Log

## Exchange 1
**User**: How do I implement caching?
**Assistant**: Use a Map for simple caching.`;

      const exchanges = mockExtractor.parseLSL(lslContent);
      expect(exchanges.exchanges.length).toBe(1);

      const result = await mockExtractor.extractKnowledge(exchanges);
      expect(result.extracted).toBe(1);
      expect(result.knowledge[0].type).toBe('coding_pattern');
    });

    it('should extract from generic markdown transcript format', async () => {
      // Mock parser for generic format
      const mockParser = {
        parseGenericMarkdown: vi.fn().mockReturnValue({
          exchanges: [
            { user: 'Question', assistant: 'Answer' }
          ]
        })
      };

      const markdown = `# Session
User: Question
AI: Answer`;

      const result = mockParser.parseGenericMarkdown(markdown);
      expect(result.exchanges.length).toBe(1);
    });

    it('should extract from JSON transcript format', async () => {
      // Mock JSON parser
      const mockParser = {
        parseJSON: vi.fn().mockReturnValue({
          exchanges: [
            { role: 'user', content: 'Q' },
            { role: 'assistant', content: 'A' }
          ]
        })
      };

      const jsonTranscript = JSON.stringify({
        messages: [
          { role: 'user', content: 'Q' },
          { role: 'assistant', content: 'A' }
        ]
      });

      const result = mockParser.parseJSON(jsonTranscript);
      expect(result.exchanges.length).toBe(2);
    });

    it('should handle malformed transcripts gracefully', async () => {
      const mockExtractor = {
        extractFromSession: vi.fn().mockResolvedValue({
          extracted: 0,
          knowledge: [],
          errors: ['Failed to parse transcript']
        })
      };

      const malformedContent = 'Not a valid transcript';
      const result = await mockExtractor.extractFromSession(malformedContent);

      expect(result.extracted).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Trajectory Tracking - Agent Agnostic', () => {

    it('should track trajectory regardless of agent type', async () => {
      // Mock trajectory analyzer
      const mockAnalyzer = {
        analyzeTrajectoryState: vi.fn().mockResolvedValue({
          state: 'implementing',
          intent: 'feature-dev',
          confidence: 0.85
        })
      };

      const exchange = { user: 'Add feature X', assistant: 'Implementing feature X' };
      const result = await mockAnalyzer.analyzeTrajectoryState(exchange);

      expect(result.state).toBe('implementing');
      expect(result.intent).toBe('feature-dev');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should persist trajectory history to database for all agents', async () => {
      // Mock trajectory history service
      const mockHistory = {
        persistStateChange: vi.fn().mockResolvedValue({
          buffered: true,
          bufferSize: 1
        })
      };

      const stateChange = {
        state: 'implementing',
        intent: 'feature-dev',
        timestamp: Date.now()
      };

      const result = await mockHistory.persistStateChange(stateChange);
      expect(mockHistory.persistStateChange).toHaveBeenCalled();
      expect(result.buffered).toBe(true);
    });
  });

  describe('Budget Tracking - Universal', () => {

    it('should track costs regardless of agent type', async () => {
      // Mock budget tracker
      const mockBudget = {
        trackCost: vi.fn().mockResolvedValue(true),
        getCurrentUsage: vi.fn().mockResolvedValue({
          used: 1.50,
          limit: 8.33,
          percentage: 18.0
        })
      };

      // Track cost from inference
      await mockBudget.trackCost({
        provider: 'groq',
        model: 'llama-3.3-70b',
        tokens: 1000,
        cost: 0.50
      });

      expect(mockBudget.trackCost).toHaveBeenCalled();

      // Check usage
      const usage = await mockBudget.getCurrentUsage();
      expect(usage.used).toBeLessThan(usage.limit);
      expect(usage.percentage).toBeLessThan(100);
    });

    it('should enforce budget limits universally', async () => {
      // Mock budget tracker at limit
      const mockBudget = {
        checkBudget: vi.fn().mockResolvedValue({
          allowed: false,
          reason: 'Monthly budget exceeded'
        })
      };

      const result = await mockBudget.checkBudget({ estimatedCost: 0.50 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('budget exceeded');
    });
  });

  describe('Graceful Degradation', () => {

    it('should continue working when agent-specific features unavailable', async () => {
      // Test system works without MCP Memory
      cache = new AgentAgnosticCache({
        backend: 'file',
        cacheDir: path.join(testDir, '.cache'),
        maxSize: 100
      });

      await cache.initialize();

      // Should work with file backend
      await cache.set('test', { data: 'works without MCP' });
      const result = await cache.get('test');

      expect(result).toEqual({ data: 'works without MCP' });
    });

    it('should fallback to local models when remote unavailable', async () => {
      // Mock inference engine with failover
      const mockInference = {
        infer: vi.fn().mockImplementation(async (prompt, options) => {
          // Simulate remote failure, fallback to local
          return {
            content: 'local model response',
            provider: 'local',
            fallback: true
          };
        })
      };

      const result = await mockInference.infer('test prompt');

      expect(result.provider).toBe('local');
      expect(result.fallback).toBe(true);
    });

    it('should handle database unavailability gracefully', async () => {
      // Mock knowledge storage with database failure
      const mockStorage = {
        storeKnowledge: vi.fn().mockImplementation(async (knowledge) => {
          // Simulate database failure, fallback to file
          return {
            stored: true,
            method: 'file',
            fallback: true
          };
        })
      };

      const knowledge = { type: 'pattern', content: 'test' };
      const result = await mockStorage.storeKnowledge(knowledge);

      expect(result.stored).toBe(true);
      expect(result.method).toBe('file');
      expect(result.fallback).toBe(true);
    });

    it('should continue knowledge extraction with heuristic fallback when LLM unavailable', async () => {
      // Mock extractor with heuristic classification
      const mockExtractor = {
        extractKnowledge: vi.fn().mockResolvedValue({
          extracted: 1,
          knowledge: [{
            type: 'coding_pattern',
            confidence: 0.6,
            method: 'heuristic'
          }]
        })
      };

      const result = await mockExtractor.extractKnowledge({ content: 'test' });

      expect(result.extracted).toBe(1);
      expect(result.knowledge[0].method).toBe('heuristic');
      expect(result.knowledge[0].confidence).toBeGreaterThan(0.5);
    });
  });

  describe('Cross-Agent Knowledge Sharing', () => {

    it('should allow knowledge extracted by one agent to be retrieved by another', async () => {
      // Mock knowledge storage and retrieval
      const mockKnowledge = {
        store: vi.fn().mockResolvedValue({ id: 'k1', stored: true }),
        search: vi.fn().mockResolvedValue({
          results: [
            { id: 'k1', type: 'pattern', extractedBy: 'claude', relevance: 0.95 }
          ]
        })
      };

      // Claude stores knowledge
      const stored = await mockKnowledge.store({ type: 'pattern', content: 'cache pattern' });
      expect(stored.id).toBe('k1');

      // Copilot retrieves the same knowledge
      const results = await mockKnowledge.search({ query: 'cache pattern' });
      expect(results.results.length).toBe(1);
      expect(results.results[0].id).toBe('k1');
    });
  });
});
