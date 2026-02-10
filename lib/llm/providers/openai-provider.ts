/**
 * OpenAI Provider
 *
 * Standard OpenAI API. Skips if OPENAI_BASE_URL is set (that's the custom/corporate provider).
 */

import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import type { ProviderConfig, ProviderName } from '../types.js';

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'openai';
  readonly isLocal = false;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: { fast: 'gpt-4.1-mini', standard: 'gpt-4.1', premium: 'o4-mini' },
      defaultModel: 'gpt-4.1-mini',
      timeout: 30000,
      ...config,
    });
  }

  protected getApiKey(): string | null {
    // Skip if OPENAI_BASE_URL is set — that indicates a custom/corporate endpoint
    if (process.env.OPENAI_BASE_URL) return null;

    const key = process.env.OPENAI_API_KEY;
    if (key && key !== 'your-openai-api-key') return key;
    return null;
  }
}
