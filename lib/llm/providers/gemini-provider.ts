/**
 * Gemini Provider
 *
 * Uses the @google/generative-ai SDK (different API shape from OpenAI).
 * generateContent() with usageMetadata token extraction.
 */

import { BaseProvider } from './base-provider.js';
import { loadGeminiSDK } from '../sdk-loader.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName } from '../types.js';

export class GeminiProvider extends BaseProvider {
  readonly name: ProviderName = 'gemini';
  readonly isLocal = false;

  private client: any = null;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: { fast: 'gemini-2.5-flash', standard: 'gemini-2.5-flash', premium: 'gemini-2.5-pro' },
      defaultModel: 'gemini-2.5-flash',
      ...config,
    });
  }

  async initialize(): Promise<void> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey || apiKey === 'your-google-api-key') {
      this._available = false;
      return;
    }

    const GoogleGenerativeAI = await loadGeminiSDK();
    if (!GoogleGenerativeAI) {
      this._available = false;
      return;
    }

    try {
      this.client = new GoogleGenerativeAI(apiKey);
      this._available = true;
    } catch (error: any) {
      console.warn('[llm:gemini] Failed to initialize:', error.message);
      this._available = false;
    }
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this.client) {
      throw new Error('Gemini provider not initialized');
    }

    const modelName = this.resolveModel(request.tier);
    const startTime = Date.now();

    const generationConfig: Record<string, any> = {
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens || 4096,
    };

    if (request.responseFormat?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

    const model = this.client.getGenerativeModel({
      model: modelName,
      generationConfig,
    });

    // Combine messages into a single prompt (Gemini's generateContent API)
    const prompt = request.messages
      .map(m => m.content)
      .join('\n\n');

    const result = await model.generateContent(prompt);
    const latencyMs = Date.now() - startTime;

    const text = result.response.text();
    const usageMetadata = result.response.usageMetadata;

    return {
      content: text || '',
      provider: 'gemini',
      model: modelName,
      tokens: {
        input: usageMetadata?.promptTokenCount || 0,
        output: usageMetadata?.candidatesTokenCount || 0,
        total: usageMetadata?.totalTokenCount || 0,
      },
      latencyMs,
    };
  }
}
