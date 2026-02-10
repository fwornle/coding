/**
 * GitHub Models Provider
 *
 * Uses GITHUB_TOKEN with the GitHub Models inference endpoint.
 * OpenAI-compatible API at https://models.github.ai/inference/v1
 */

import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import type { ProviderConfig, ProviderName } from '../types.js';

export class GitHubModelsProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'github-models';
  readonly isLocal = false;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      baseUrl: 'https://models.github.ai/inference/v1',
      models: { fast: 'gpt-4.1-mini', standard: 'gpt-4.1', premium: 'o4-mini' },
      defaultModel: 'gpt-4.1-mini',
      timeout: 30000,
      ...config,
    });
  }

  protected getApiKey(): string | null {
    return process.env.GITHUB_TOKEN || null;
  }

  protected getClientOptions(): Record<string, any> {
    return {
      apiKey: this.getApiKey(),
      baseURL: this.config.baseUrl || 'https://models.github.ai/inference/v1',
      timeout: this.config.timeout || 30000,
    };
  }
}
