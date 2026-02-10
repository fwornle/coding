/**
 * Unified LLM Support Layer - Type Definitions
 *
 * Core types shared across all providers and consumers.
 */

// --- Provider & Model Types ---

export type ProviderName =
  | 'groq'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'github-models'
  | 'dmr'
  | 'ollama'
  | 'mock';

export type ModelTier = 'fast' | 'standard' | 'premium';

export type LLMMode = 'mock' | 'local' | 'public';

// --- Request / Response ---

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionRequest {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  responseFormat?: { type: 'json_object' | 'text' };

  // Routing hints
  operationType?: string;
  taskType?: string;
  tier?: ModelTier;
  privacy?: 'local' | 'any';
  agentId?: string;

  // Behavior flags
  skipCache?: boolean;
  forcePaid?: boolean;
}

export interface LLMCompletionResult {
  content: string;
  provider: string;
  model: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  latencyMs?: number;
  cached?: boolean;
  local?: boolean;
  mock?: boolean;
}

// --- Provider Interface ---

export interface LLMProvider {
  readonly name: ProviderName;
  readonly isLocal: boolean;

  isAvailable(): boolean;
  initialize(): Promise<void>;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
  getModels(): Partial<Record<ModelTier, string>>;
}

// --- Configuration ---

export interface ProviderConfig {
  name: ProviderName;
  apiKeyEnvVar: string;
  baseUrl?: string;
  models: Partial<Record<ModelTier, string>>;
  defaultModel: string;
  timeout?: number;
  isLocal?: boolean;
}

export interface DMRConfig {
  host: string;
  port: number;
  baseUrl: string;
  defaultModel: string;
  modelOverrides: Record<string, string>;
  timeout: number;
  maxTokens: number;
  temperature: number;
  connection: {
    maxRetries: number;
    retryDelay: number;
    healthCheckInterval: number;
  };
}

export interface LLMServiceConfig {
  providers?: Record<string, Partial<ProviderConfig>>;
  providerPriority?: Partial<Record<ModelTier, ProviderName[]>>;
  taskTiers?: Record<string, string[]>;
  agentOverrides?: Record<string, ModelTier>;
  operatorTiers?: Record<string, ModelTier>;
  batchTaskTiers?: Record<string, ModelTier>;
  modelRouting?: Record<string, string>;
  dmr?: DMRConfig;
  costLimits?: {
    budgetMode: number;
    standardMode: number;
    qualityMode: number;
  };
  cache?: {
    maxSize?: number;
    ttlMs?: number;
  };
  circuitBreaker?: {
    threshold?: number;
    resetTimeoutMs?: number;
  };
}

// --- Dependency Injection Interfaces ---

export interface BudgetTrackerInterface {
  canAfford(prompt: string, context: Record<string, unknown>): Promise<boolean>;
  recordCost(tokens: number, provider: string, metadata: Record<string, unknown>): Promise<void>;
}

export interface SensitivityClassifierInterface {
  classify(content: string, context: Record<string, unknown>): Promise<{ isSensitive: boolean }>;
}

export interface MockServiceInterface {
  mockLLMCall(
    agentType: string,
    prompt: string,
    repositoryPath: string
  ): Promise<LLMCompletionResult>;
}

// --- Metrics ---

export interface LLMCallMetrics {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  operationType?: string;
  timestamp: number;
}

export interface LLMMetrics {
  totalCalls: number;
  byProvider: Record<string, { count: number; totalLatencyMs: number; totalTokens: number }>;
  byOperation: Record<string, { count: number; totalLatencyMs: number }>;
  cache: {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
}

// --- Circuit Breaker ---

export interface CircuitBreakerState {
  failures: Record<string, number>;
  lastFailure: Record<string, number>;
  threshold: number;
  resetTimeoutMs: number;
}
