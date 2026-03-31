/**
 * GitHub Copilot Provider (Direct HTTP)
 *
 * Uses the GitHub Copilot API directly via OpenAI-compatible HTTP endpoint.
 * Auth: reads OAuth tokens from ~/.local/share/opencode/auth.json (written by OpenCode).
 *
 * Previous design used CLIProviderBase which spawns a copilot-cli subprocess
 * via JSON-RPC — a full agent framework with 30s+ overhead per request.
 * Direct HTTP: single POST to copilot-api, ~2-5s per call.
 *
 * Network: works inside corporate network/VPN via enterprise endpoint.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseProvider } from './base-provider.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName } from '../types.js';

const AUTH_FILE = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');

interface AuthState {
  token: string | null;
  apiBaseUrl: string | null;
  lastLoaded: number;
}

export class CopilotProvider extends BaseProvider {
  readonly name: ProviderName = 'copilot';
  readonly isLocal = false;

  private auth: AuthState = { token: null, apiBaseUrl: null, lastLoaded: 0 };
  private useProxy = false;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: {
        fast: 'claude-haiku-4.5',
        standard: 'claude-sonnet-4.6',
        premium: 'claude-opus-4.6',
      },
      defaultModel: 'claude-sonnet-4.6',
      timeout: 120000,
      ...config,
    });
  }

  /**
   * Load OAuth token from OpenCode's auth.json.
   * Re-reads at most every 60 seconds.
   */
  private loadAuth(): AuthState {
    const now = Date.now();
    if (this.auth.token && (now - this.auth.lastLoaded) < 60_000) {
      return this.auth;
    }

    try {
      const raw = fs.readFileSync(AUTH_FILE, 'utf8');
      const authData = JSON.parse(raw);
      const enterprise = authData['github-copilot-enterprise'];
      const public_ = authData['github-copilot'];
      const entry = enterprise || public_;

      if (!entry?.refresh) {
        return this.auth;
      }

      const enterpriseUrl = entry.enterpriseUrl;
      this.auth = {
        token: entry.refresh,
        apiBaseUrl: enterpriseUrl
          ? `https://copilot-api.${enterpriseUrl}`
          : 'https://api.githubcopilot.com',
        lastLoaded: now,
      };
    } catch {
      // File not found or parse error — keep existing state
    }
    return this.auth;
  }

  async initialize(): Promise<void> {
    // In Docker, prefer proxy (host has the auth tokens)
    const inDocker = !!process.env.LLM_CLI_PROXY_URL;

    if (!inDocker) {
      // Running on host — try direct HTTP with local auth token
      const auth = this.loadAuth();
      if (auth.token) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          const response = await fetch(`${auth.apiBaseUrl}/models`, {
            headers: {
              'Authorization': `Bearer ${auth.token}`,
              'User-Agent': 'opencode/1.0',
              'Openai-Intent': 'conversation-edits',
            },
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (response.ok) {
            this._available = true;
            this.useProxy = false;
            process.stderr.write(`[llm:copilot] Provider initialized (direct HTTP → ${auth.apiBaseUrl})\n`);
            return;
          }
        } catch {
          // Direct HTTP failed — try proxy
        }
      }
    }

    // Proxy bridge (for Docker containers)
    const proxyAvailable = await this.checkProxyAvailable();
    if (proxyAvailable) {
      this._available = true;
      this.useProxy = true;
      process.stderr.write('[llm:copilot] Provider initialized (HTTP proxy → direct HTTP on host)\n');
      return;
    }

    process.stderr.write('[llm:copilot] Neither direct HTTP nor proxy available\n');
    this._available = false;
  }

  private async checkProxyAvailable(): Promise<boolean> {
    const proxyUrl = process.env.LLM_CLI_PROXY_URL;
    if (!proxyUrl) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = (await response.json()) as { providers?: Record<string, { available?: boolean }> };
      return data.providers?.copilot?.available === true;
    } catch {
      return false;
    }
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this._available) {
      throw new Error('GitHub Copilot provider not available');
    }

    if (this.useProxy) {
      return this.completeViaProxy(request);
    }

    return this.completeDirectHTTP(request);
  }

  /**
   * Direct HTTP call to Copilot API (OpenAI-compatible endpoint).
   * Single POST, no SDK, no subprocess, no agent overhead.
   */
  private async completeDirectHTTP(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const auth = this.loadAuth();
    if (!auth.token || !auth.apiBaseUrl) {
      throw new Error('AUTH_ERROR: No Copilot OAuth token available');
    }

    const model = this.resolveModel(request.tier);
    const timeoutMs = request.timeout || this.config.timeout || 120000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: request.maxTokens || 4096,
      stream: false,
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.responseFormat?.type === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    try {
      const startTime = Date.now();
      const response = await fetch(`${auth.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'opencode/1.0',
          'Openai-Intent': 'conversation-edits',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) {
          this.auth.lastLoaded = 0; // Force re-read
          throw new Error(`AUTH_ERROR: Copilot API returned ${response.status}: ${errBody}`);
        }
        if (response.status === 429) {
          throw new Error(`QUOTA_EXHAUSTED: Copilot API rate limited: ${errBody}`);
        }
        throw new Error(`Copilot API error (${response.status}): ${errBody}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        model?: string;
      };

      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage;

      return {
        content,
        provider: this.name,
        model: data.model || model,
        tokens: {
          input: usage?.prompt_tokens || 0,
          output: usage?.completion_tokens || 0,
          total: usage?.total_tokens || 0,
        },
        latencyMs: Date.now() - startTime,
        cached: false,
        local: false,
        mock: false,
      };
    } catch (error: unknown) {
      clearTimeout(timer);
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('AbortError') || (error instanceof Error && error.name === 'AbortError')) {
        throw new Error(`Copilot API timed out after ${timeoutMs}ms`);
      }
      throw error instanceof Error ? error : new Error(msg);
    }
  }

  /**
   * Complete via the host-side HTTP proxy bridge (for Docker containers).
   */
  private async completeViaProxy(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const proxyUrl = process.env.LLM_CLI_PROXY_URL;
    if (!proxyUrl) throw new Error('LLM_CLI_PROXY_URL not configured');

    const startTime = Date.now();
    const timeoutMs = request.timeout || this.config.timeout || 120000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${proxyUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.name,
          messages: request.messages,
          model: this.resolveModel(request.tier),
          maxTokens: request.maxTokens || 4096,
          temperature: request.temperature,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string; type?: string };
        if (response.status === 429 || err.type === 'QUOTA_EXHAUSTED') throw new Error(`QUOTA_EXHAUSTED: ${err.error}`);
        if (response.status === 401 || err.type === 'AUTH_ERROR') throw new Error(`AUTH_ERROR: ${err.error}`);
        throw new Error(`Proxy error (${response.status}): ${err.error}`);
      }

      const data = (await response.json()) as {
        content: string; model: string;
        tokens: { input: number; output: number; total: number };
        latencyMs: number;
      };
      return {
        content: data.content, provider: this.name, model: data.model,
        tokens: data.tokens, latencyMs: data.latencyMs || (Date.now() - startTime),
        cached: false, local: false, mock: false,
      };
    } catch (error: unknown) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') throw new Error(`Proxy timed out after ${timeoutMs}ms`);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
