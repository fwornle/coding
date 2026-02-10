/**
 * Unified LLM Support Layer
 *
 * Single import point for all LLM functionality.
 *
 * Usage:
 *   import { LLMService } from '@coding/llm';
 *   const llm = new LLMService();
 *   await llm.initialize();
 *   const result = await llm.complete({ messages: [{ role: 'user', content: 'Hello' }] });
 */

// Main service
export { LLMService } from './llm-service.js';

// Types
export type {
  ProviderName,
  ModelTier,
  LLMMode,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResult,
  LLMProvider,
  ProviderConfig,
  DMRConfig,
  LLMServiceConfig,
  BudgetTrackerInterface,
  SensitivityClassifierInterface,
  MockServiceInterface,
  LLMCallMetrics,
  LLMMetrics,
  CircuitBreakerState,
} from './types.js';

// Infrastructure (for advanced use)
export { CircuitBreaker } from './circuit-breaker.js';
export { LLMCache } from './cache.js';
export { MetricsTracker } from './metrics.js';
export { ProviderRegistry } from './provider-registry.js';
export { loadConfig, getDefaultConfig } from './config.js';

// Providers (for direct construction if needed)
export { GroqProvider } from './providers/groq-provider.js';
export { OpenAIProvider } from './providers/openai-provider.js';
export { AnthropicProvider } from './providers/anthropic-provider.js';
export { GeminiProvider } from './providers/gemini-provider.js';
export { GitHubModelsProvider } from './providers/github-models-provider.js';
export { DMRProvider } from './providers/dmr-provider.js';
export { OllamaProvider } from './providers/ollama-provider.js';
export { MockProvider } from './providers/mock-provider.js';
