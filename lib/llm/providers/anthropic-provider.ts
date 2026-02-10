/**
 * Anthropic Provider
 *
 * Uses the Anthropic SDK (different API shape from OpenAI).
 * messages.create() with separate content extraction.
 */

import { BaseProvider } from './base-provider.js';
import { loadAnthropicSDK } from '../sdk-loader.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName } from '../types.js';

export class AnthropicProvider extends BaseProvider {
  readonly name: ProviderName = 'anthropic';
  readonly isLocal = false;

  private client: any = null;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: { fast: 'claude-haiku-4-5', standard: 'claude-sonnet-4-5', premium: 'claude-opus-4-6' },
      defaultModel: 'claude-sonnet-4-5',
      timeout: 30000,
      ...config,
    });
  }

  async initialize(): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'your-anthropic-api-key') {
      this._available = false;
      return;
    }

    const Anthropic = await loadAnthropicSDK();
    if (!Anthropic) {
      this._available = false;
      return;
    }

    try {
      this.client = new Anthropic({
        apiKey,
        timeout: this.config.timeout || 30000,
      });
      this._available = true;
    } catch (error: any) {
      console.warn('[llm:anthropic] Failed to initialize:', error.message);
      this._available = false;
    }
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this.client) {
      throw new Error('Anthropic provider not initialized');
    }

    const model = this.resolveModel(request.tier);
    const startTime = Date.now();

    // Anthropic uses messages.create() with a different shape
    const params: Record<string, any> = {
      model,
      max_tokens: request.maxTokens || 4096,
      messages: request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content })),
    };

    // Anthropic handles temperature differently — only set if non-default
    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    // Extract system message if present
    const systemMessage = request.messages.find(m => m.role === 'system');
    if (systemMessage) {
      params.system = systemMessage.content;
    }

    const response = await this.client.messages.create(params);
    const latencyMs = Date.now() - startTime;

    // Extract content from Anthropic response shape
    const content = response.content[0]?.type === 'text'
      ? response.content[0].text
      : '';

    const usage = response.usage;

    return {
      content,
      provider: 'anthropic',
      model,
      tokens: {
        input: usage?.input_tokens || 0,
        output: usage?.output_tokens || 0,
        total: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
      },
      latencyMs,
    };
  }
}
