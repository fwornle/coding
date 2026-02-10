/**
 * Abstract Base Provider
 *
 * All LLM providers extend this class.
 */

import type { LLMProvider, LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName, ModelTier } from '../types.js';

export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: ProviderName;
  abstract readonly isLocal: boolean;

  protected config: Partial<ProviderConfig>;
  protected _available = false;

  constructor(config: Partial<ProviderConfig> = {}) {
    this.config = config;
  }

  isAvailable(): boolean {
    return this._available;
  }

  abstract initialize(): Promise<void>;
  abstract complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;

  getModels(): Partial<Record<ModelTier, string>> {
    return this.config.models || {};
  }

  /**
   * Resolve the model to use for a given tier
   */
  protected resolveModel(tier?: ModelTier): string {
    if (tier && this.config.models?.[tier]) {
      return this.config.models[tier]!;
    }
    return this.config.defaultModel || 'unknown';
  }
}
