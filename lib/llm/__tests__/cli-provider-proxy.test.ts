/**
 * CLI Provider Proxy Methods - Unit Tests
 *
 * Tests checkProxyAvailable() and completeViaProxy() on CLIProviderBase.
 * Uses a local HTTP server to simulate the proxy bridge.
 *
 * Run: npx tsx --test lib/llm/__tests__/cli-provider-proxy.test.ts
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderName, ModelTier } from '../types.js';
import { CLIProviderBase } from '../providers/cli-provider-base.js';

// --- Mock provider subclass for testing ---

class MockCLIProvider extends CLIProviderBase {
  readonly name: ProviderName = 'claude-code';
  readonly isLocal = false;
  protected readonly cliCommand = 'echo'; // Harmless command

  constructor() {
    super({
      models: { fast: 'sonnet', standard: 'sonnet', premium: 'opus' },
      defaultModel: 'sonnet',
      timeout: 5000,
    });
  }

  async initialize(): Promise<void> {
    this._available = true;
  }

  protected buildArgs(_request: LLMCompletionRequest): string[] {
    return ['test'];
  }

  protected parseResponse(stdout: string): string {
    return stdout.trim();
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (this._useProxy) {
      return this.completeViaProxy(request);
    }
    return {
      content: 'local response',
      provider: this.name,
      model: 'sonnet',
      tokens: { input: 10, output: 5, total: 15 },
      latencyMs: 100,
      cached: false,
      local: false,
      mock: false,
    };
  }

  // Expose protected methods for testing
  public testCheckProxyAvailable(): Promise<boolean> {
    return this.checkProxyAvailable();
  }

  public testCompleteViaProxy(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    return this.completeViaProxy(request);
  }

  public setUseProxy(val: boolean): void {
    this._useProxy = val;
  }
}

// --- Mock proxy server ---

let mockServer: http.Server;
let mockPort: number;
let mockHealthResponse: object;
let mockCompleteResponse: object;
let mockCompleteStatus: number;
let lastCompleteBody: Record<string, unknown> | null;

function createMockServer(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200);
          res.end(JSON.stringify(mockHealthResponse));
          return;
        }

        if (req.url === '/api/complete' && req.method === 'POST') {
          lastCompleteBody = JSON.parse(body);
          res.writeHead(mockCompleteStatus);
          res.end(JSON.stringify(mockCompleteResponse));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    mockServer.listen(0, '127.0.0.1', () => {
      const addr = mockServer.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      }
    });
  });
}

// --- Tests ---

describe('CLIProviderBase proxy methods', () => {
  let provider: MockCLIProvider;

  before(async () => {
    mockPort = await createMockServer();
    process.env.LLM_CLI_PROXY_URL = `http://127.0.0.1:${mockPort}`;
  });

  after(() => {
    delete process.env.LLM_CLI_PROXY_URL;
    mockServer.close();
  });

  beforeEach(() => {
    provider = new MockCLIProvider();
    lastCompleteBody = null;
    mockCompleteStatus = 200;
  });

  describe('checkProxyAvailable()', () => {
    it('should return true when proxy reports provider available', async () => {
      mockHealthResponse = {
        status: 'ok',
        providers: {
          'claude-code': { available: true, version: '2.1.50' },
          'copilot': { available: false },
        },
      };

      const result = await provider.testCheckProxyAvailable();
      assert.equal(result, true);
    });

    it('should return false when proxy reports provider unavailable', async () => {
      mockHealthResponse = {
        status: 'ok',
        providers: {
          'claude-code': { available: false },
        },
      };

      const result = await provider.testCheckProxyAvailable();
      assert.equal(result, false);
    });

    it('should return false when proxy has no providers field', async () => {
      mockHealthResponse = { status: 'ok' };

      const result = await provider.testCheckProxyAvailable();
      assert.equal(result, false);
    });

    it('should return false when LLM_CLI_PROXY_URL is not set', async () => {
      const saved = process.env.LLM_CLI_PROXY_URL;
      delete process.env.LLM_CLI_PROXY_URL;

      const result = await provider.testCheckProxyAvailable();
      assert.equal(result, false);

      process.env.LLM_CLI_PROXY_URL = saved;
    });

    it('should return false when proxy is unreachable', async () => {
      const saved = process.env.LLM_CLI_PROXY_URL;
      process.env.LLM_CLI_PROXY_URL = 'http://127.0.0.1:1'; // Invalid port

      const result = await provider.testCheckProxyAvailable();
      assert.equal(result, false);

      process.env.LLM_CLI_PROXY_URL = saved;
    });
  });

  describe('completeViaProxy()', () => {
    const testRequest: LLMCompletionRequest = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say hello' },
      ],
      maxTokens: 100,
      temperature: 0.5,
      tier: 'standard' as ModelTier,
    };

    it('should return completion result on success', async () => {
      mockCompleteStatus = 200;
      mockCompleteResponse = {
        content: 'Hello! How can I help?',
        provider: 'claude-code',
        model: 'sonnet',
        tokens: { input: 20, output: 8, total: 28 },
        latencyMs: 1500,
      };

      const result = await provider.testCompleteViaProxy(testRequest);

      assert.equal(result.content, 'Hello! How can I help?');
      assert.equal(result.provider, 'claude-code');
      assert.equal(result.model, 'sonnet');
      assert.equal(result.tokens.total, 28);
      assert.equal(result.cached, false);
      assert.equal(result.mock, false);
    });

    it('should send correct request body', async () => {
      mockCompleteStatus = 200;
      mockCompleteResponse = {
        content: 'test',
        provider: 'claude-code',
        model: 'sonnet',
        tokens: { input: 1, output: 1, total: 2 },
        latencyMs: 100,
      };

      await provider.testCompleteViaProxy(testRequest);

      assert.ok(lastCompleteBody, 'should have sent a request body');
      assert.equal(lastCompleteBody!.provider, 'claude-code');
      assert.equal(lastCompleteBody!.model, 'sonnet');
      assert.equal(lastCompleteBody!.maxTokens, 100);
      assert.equal(lastCompleteBody!.temperature, 0.5);
      assert.equal(lastCompleteBody!.tier, 'standard');
      assert.ok(Array.isArray(lastCompleteBody!.messages));
    });

    it('should throw QUOTA_EXHAUSTED on 429', async () => {
      mockCompleteStatus = 429;
      mockCompleteResponse = {
        error: 'Monthly limit reached',
        type: 'QUOTA_EXHAUSTED',
      };

      await assert.rejects(
        () => provider.testCompleteViaProxy(testRequest),
        (error: Error) => {
          assert.ok(error.message.includes('QUOTA_EXHAUSTED'));
          return true;
        }
      );
    });

    it('should throw AUTH_ERROR on 401', async () => {
      mockCompleteStatus = 401;
      mockCompleteResponse = {
        error: 'Not authenticated',
        type: 'AUTH_ERROR',
      };

      await assert.rejects(
        () => provider.testCompleteViaProxy(testRequest),
        (error: Error) => {
          assert.ok(error.message.includes('AUTH_ERROR'));
          return true;
        }
      );
    });

    it('should throw generic error on 500', async () => {
      mockCompleteStatus = 500;
      mockCompleteResponse = {
        error: 'CLI crashed',
        type: 'CLI_ERROR',
      };

      await assert.rejects(
        () => provider.testCompleteViaProxy(testRequest),
        (error: Error) => {
          assert.ok(error.message.includes('Proxy error'));
          return true;
        }
      );
    });

    it('should throw when LLM_CLI_PROXY_URL is not set', async () => {
      const saved = process.env.LLM_CLI_PROXY_URL;
      delete process.env.LLM_CLI_PROXY_URL;

      await assert.rejects(
        () => provider.testCompleteViaProxy(testRequest),
        (error: Error) => {
          assert.ok(error.message.includes('LLM_CLI_PROXY_URL not configured'));
          return true;
        }
      );

      process.env.LLM_CLI_PROXY_URL = saved;
    });
  });

  describe('complete() proxy delegation', () => {
    it('should use local logic when _useProxy is false', async () => {
      provider.setUseProxy(false);
      await provider.initialize();

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'test' }],
      });

      assert.equal(result.content, 'local response');
    });

    it('should delegate to proxy when _useProxy is true', async () => {
      mockCompleteStatus = 200;
      mockCompleteResponse = {
        content: 'proxy response',
        provider: 'claude-code',
        model: 'sonnet',
        tokens: { input: 5, output: 3, total: 8 },
        latencyMs: 500,
      };

      provider.setUseProxy(true);
      await provider.initialize();

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'test' }],
      });

      assert.equal(result.content, 'proxy response');
    });
  });
});
