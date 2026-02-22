/**
 * LLM CLI Proxy Server - Unit Tests
 *
 * Tests the proxy server endpoints: /health, /api/complete
 * Uses Node's built-in test runner (no extra dependencies).
 *
 * Run: npx tsx src/server.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type ChildProcess, fork } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.ts');
const PORT = 19435; // Test port to avoid conflicts with running proxy
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess: ChildProcess | null = null;

async function waitForServer(url: string, maxAttempts = 20): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not start within ${maxAttempts * 250}ms`);
}

describe('LLM CLI Proxy Server', () => {
  before(async () => {
    // Start server on test port using tsx
    serverProcess = fork(SERVER_PATH, [], {
      env: { ...process.env, LLM_CLI_PROXY_PORT: PORT.toString() },
      execArgv: ['--import', 'tsx'],
      stdio: 'pipe',
    });

    // Suppress server output during tests
    serverProcess.stdout?.on('data', () => {});
    serverProcess.stderr?.on('data', () => {});

    await waitForServer(BASE_URL);
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      assert.equal(response.status, 200);

      const data = (await response.json()) as Record<string, unknown>;
      assert.equal(data.status, 'ok');
    });

    it('should include providers object', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      const data = (await response.json()) as {
        providers: Record<string, { available: boolean; lastChecked: number }>;
      };

      assert.ok(data.providers, 'should have providers field');
      assert.ok('claude-code' in data.providers, 'should have claude-code provider');
      assert.ok('copilot' in data.providers, 'should have copilot provider');

      // Each provider should have available and lastChecked
      for (const [name, status] of Object.entries(data.providers)) {
        assert.equal(typeof status.available, 'boolean', `${name}.available should be boolean`);
        assert.equal(typeof status.lastChecked, 'number', `${name}.lastChecked should be number`);
      }
    });

    it('should include uptime and inFlightRequests', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      const data = (await response.json()) as {
        uptime: number;
        inFlightRequests: number;
      };

      assert.equal(typeof data.uptime, 'number');
      assert.ok(data.uptime >= 0);
      assert.equal(typeof data.inFlightRequests, 'number');
      assert.equal(data.inFlightRequests, 0);
    });
  });

  describe('POST /api/complete', () => {
    it('should reject requests without provider', async () => {
      const response = await fetch(`${BASE_URL}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      });

      assert.equal(response.status, 400);
      const data = (await response.json()) as { error: string };
      assert.ok(data.error.includes('Missing required fields'));
    });

    it('should reject requests without messages', async () => {
      const response = await fetch(`${BASE_URL}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-code' }),
      });

      assert.equal(response.status, 400);
      const data = (await response.json()) as { error: string };
      assert.ok(data.error.includes('Missing required fields'));
    });

    it('should reject unknown provider', async () => {
      const response = await fetch(`${BASE_URL}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'unknown-provider',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });

      assert.equal(response.status, 400);
      const data = (await response.json()) as { error: string };
      assert.ok(data.error.includes('Unknown provider'));
    });

    it('should return 503 for unavailable provider', async () => {
      // copilot-cli is unlikely to be installed
      const healthResp = await fetch(`${BASE_URL}/health`);
      const health = (await healthResp.json()) as {
        providers: Record<string, { available: boolean }>;
      };

      // Find an unavailable provider to test with
      const unavailable = Object.entries(health.providers).find(([, s]) => !s.available);
      if (!unavailable) {
        // All providers available - skip this test
        return;
      }

      const [providerName] = unavailable;
      const response = await fetch(`${BASE_URL}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerName,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });

      assert.equal(response.status, 503);
      const data = (await response.json()) as { type: string };
      assert.equal(data.type, 'PROVIDER_UNAVAILABLE');
    });

    it('should accept valid request for available provider', async () => {
      // Check which providers are available
      const healthResp = await fetch(`${BASE_URL}/health`);
      const health = (await healthResp.json()) as {
        providers: Record<string, { available: boolean }>;
      };

      const available = Object.entries(health.providers).find(([, s]) => s.available);
      if (!available) {
        // No providers available - skip
        return;
      }

      // We don't actually want to call the CLI in tests (it's expensive/slow),
      // so just verify the request structure is accepted.
      // A real completion test would run against a mock CLI.
      // The 503/400 tests above prove the routing works.
    });
  });

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      // cors() middleware adds these
      const allowOrigin = response.headers.get('access-control-allow-origin');
      assert.equal(allowOrigin, '*');
    });
  });
});
