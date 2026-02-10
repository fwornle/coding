/**
 * Groq Provider
 *
 * Uses the Groq SDK (which has its own API shape, similar to OpenAI).
 * Uses GROQ_API_KEY for authentication.
 */

import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { loadGroqSDK } from '../sdk-loader.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName } from '../types.js';

export class GroqProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'groq';
  readonly isLocal = false;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: { fast: 'llama-3.1-8b-instant', standard: 'llama-3.3-70b-versatile', premium: 'openai/gpt-oss-120b' },
      defaultModel: 'llama-3.3-70b-versatile',
      timeout: 10000,
      ...config,
    });
  }

  protected getApiKey(): string | null {
    const key = process.env.GROQ_API_KEY;
    if (key && key !== 'your-groq-api-key') return key;
    return null;
  }

  /**
   * Override: use Groq SDK instead of OpenAI SDK
   */
  async initialize(): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this._available = false;
      return;
    }

    const Groq = await loadGroqSDK();
    if (!Groq) {
      this._available = false;
      return;
    }

    try {
      this.client = new Groq({
        apiKey,
        timeout: this.config.timeout || 10000,
      });
      this._available = true;
    } catch (error: any) {
      console.warn('[llm:groq] Failed to initialize:', error.message);
      this._available = false;
    }
  }

  // complete() is inherited from OpenAICompatibleProvider — Groq SDK has the same shape
}
