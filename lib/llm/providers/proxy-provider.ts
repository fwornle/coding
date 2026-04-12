/**
 * Proxy Provider
 *
 * Routes LLM calls through the local llm-proxy (port from LLM_CLI_PROXY_PORT, default 12435) which handles
 * network detection, provider failover, and has access to all configured
 * providers including subscription-based ones (copilot, claude-code).
 *
 * This provider is essential when the ETM runs in a context where direct
 * API calls are blocked (e.g., corporate VPN) but the llm-proxy has working
 * connections via the proxy chain.
 */

import { BaseProvider } from './base-provider.js';
import type {
  LLMCompletionRequest,
  LLMCompletionResult,
  ProviderConfig,
  ProviderName,
  ModelTier,
} from '../types.js';

export class ProxyProvider extends BaseProvider {
  readonly name: ProviderName = 'proxy';
  readonly isLocal = false;

  private proxyUrl: string;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: { fast: 'auto', standard: 'auto', premium: 'auto' },
      defaultModel: 'auto',
      timeout: 30000,
      ...config,
    });
    const proxyPort = process.env.LLM_CLI_PROXY_PORT || '12435';
    this.proxyUrl = (config as any).baseUrl || process.env.LLM_PROXY_URL || `http://localhost:${proxyPort}`;
  }

  async initialize(): Promise<void> {
    try {
      const resp = await fetch(`${this.proxyUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json() as { status: string; providers?: Record<string, { available: boolean }> };
        this._available = data.status === 'ok';
        if (this._available) {
          console.info(`[llm:proxy] Connected to llm-proxy at ${this.proxyUrl}`);
        }
      }
    } catch {
      this._available = false;
      console.info(`[llm:proxy] Not available at ${this.proxyUrl}`);
    }
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this._available) throw new Error('Proxy provider not available');

    const startTime = Date.now();
    const timeoutMs = request.timeout || (this.config.timeout as number) || 30000;

    const body: Record<string, unknown> = {
      messages: request.messages,
      maxTokens: request.maxTokens || 4096,
      temperature: request.temperature,
    };

    // Let the proxy handle provider selection (it does network-adaptive routing)
    // Only pass a model hint if one was explicitly requested
    const model = this.resolveModel(request.tier);
    if (model && model !== 'auto') {
      body.model = model;
    }

    const response = await fetch(`${this.proxyUrl}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      if (response.status === 429) throw new Error(`QUOTA_EXHAUSTED: ${err.error}`);
      throw new Error(`Proxy error (${response.status}): ${err.error || 'unknown'}`);
    }

    const data = await response.json() as {
      content: string;
      model: string;
      provider: string;
      tokens: { input: number; output: number; total: number };
      latencyMs: number;
    };

    return {
      content: data.content,
      provider: this.name,
      model: `${data.provider}/${data.model}`,
      tokens: data.tokens || { input: 0, output: 0, total: 0 },
      latencyMs: data.latencyMs || (Date.now() - startTime),
    };
  }
}
