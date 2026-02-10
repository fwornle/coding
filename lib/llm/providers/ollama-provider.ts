/**
 * Ollama Provider
 *
 * Local LLM via Ollama's OpenAI-compatible API.
 * Verifies connection before marking as available.
 */

import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import type { ProviderConfig, ProviderName } from '../types.js';

export class OllamaProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'ollama';
  readonly isLocal = true;

  private baseUrl: string;

  constructor(config: Partial<ProviderConfig> = {}) {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.2:latest';

    super({
      baseUrl: `${baseUrl}/v1`,
      models: { fast: model, standard: model, premium: model },
      defaultModel: model,
      timeout: 30000,
      isLocal: true,
      ...config,
    });

    this.baseUrl = baseUrl;
  }

  protected getApiKey(): string | null {
    return 'ollama'; // Ollama doesn't need a real API key
  }

  protected getClientOptions(): Record<string, any> {
    return {
      apiKey: 'ollama',
      baseURL: this.config.baseUrl || `${this.baseUrl}/v1`,
      timeout: this.config.timeout || 30000,
    };
  }

  async initialize(): Promise<void> {
    // First try to verify Ollama is running
    const reachable = await this.verifyConnection();
    if (!reachable) {
      this._available = false;
      return;
    }

    await super.initialize();
  }

  /**
   * Verify Ollama is running by checking /api/tags
   */
  private async verifyConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        const models = data.models || [];
        console.info(`[llm:ollama] Available with ${models.length} models`);
        return true;
      }
      return false;
    } catch {
      console.info('[llm:ollama] Not available');
      return false;
    }
  }
}
