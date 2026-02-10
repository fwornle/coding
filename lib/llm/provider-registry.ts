/**
 * Provider Registry
 *
 * Auto-registers providers, resolves provider chains for requests,
 * and handles tier-based routing.
 */

import type {
  LLMProvider, LLMCompletionRequest, LLMServiceConfig,
  ProviderName, ModelTier, DMRConfig,
} from './types.js';

import { GroqProvider } from './providers/groq-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { GeminiProvider } from './providers/gemini-provider.js';
import { GitHubModelsProvider } from './providers/github-models-provider.js';
import { DMRProvider } from './providers/dmr-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { MockProvider } from './providers/mock-provider.js';
import { ClaudeCodeProvider } from './providers/claude-code-provider.js';
import { CopilotProvider } from './providers/copilot-provider.js';

export interface ProviderSelection {
  provider: LLMProvider;
  model: string;
}

export class ProviderRegistry {
  private providers = new Map<ProviderName, LLMProvider>();
  private config: LLMServiceConfig;

  constructor(config: LLMServiceConfig) {
    this.config = config;
  }

  /**
   * Create and initialize all providers. Only registers those that are available.
   */
  async initializeAll(): Promise<void> {
    const providerInstances: Array<{ name: ProviderName; instance: LLMProvider }> = [
      { name: 'claude-code', instance: new ClaudeCodeProvider(this.config.providers?.['claude-code']) },
      { name: 'copilot', instance: new CopilotProvider(this.config.providers?.copilot) },
      { name: 'groq', instance: new GroqProvider(this.config.providers?.groq) },
      { name: 'openai', instance: new OpenAIProvider(this.config.providers?.openai) },
      { name: 'anthropic', instance: new AnthropicProvider(this.config.providers?.anthropic) },
      { name: 'gemini', instance: new GeminiProvider(this.config.providers?.gemini) },
      { name: 'github-models', instance: new GitHubModelsProvider(this.config.providers?.['github-models']) },
      { name: 'dmr', instance: new DMRProvider(this.config.providers?.dmr as any, this.config.dmr) },
      { name: 'ollama', instance: new OllamaProvider(this.config.providers?.ollama as any) },
      { name: 'mock', instance: new MockProvider() },
    ];

    // Initialize all providers (they check their own env vars)
    await Promise.allSettled(
      providerInstances.map(async ({ name, instance }) => {
        try {
          await instance.initialize();
          if (instance.isAvailable()) {
            this.providers.set(name, instance);
            console.info(`[llm] Provider ${name} initialized`);
          }
        } catch (error: any) {
          console.warn(`[llm] Provider ${name} failed to initialize:`, error.message);
        }
      })
    );

    // Always register mock provider (it becomes available when mock service is injected)
    const mockInstance = providerInstances.find(p => p.name === 'mock')?.instance;
    if (mockInstance) {
      this.providers.set('mock', mockInstance);
    }

    console.info(`[llm] ${this.providers.size} providers registered: ${Array.from(this.providers.keys()).join(', ')}`);
  }

  /**
   * Get a specific provider
   */
  getProvider(name: ProviderName): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get the mock provider for configuration
   */
  getMockProvider(): MockProvider | undefined {
    return this.providers.get('mock') as MockProvider | undefined;
  }

  /**
   * Get all available provider names
   */
  getAvailableProviders(): ProviderName[] {
    return Array.from(this.providers.entries())
      .filter(([_, p]) => p.isAvailable())
      .map(([name]) => name);
  }

  /**
   * Get local providers (DMR, Ollama)
   */
  getLocalProviders(): LLMProvider[] {
    return Array.from(this.providers.values())
      .filter(p => p.isLocal && p.isAvailable() && p.name !== 'mock');
  }

  /**
   * Resolve an ordered list of (provider, model) to try for a request
   */
  resolveProviderChain(request: LLMCompletionRequest): ProviderSelection[] {
    const chain: ProviderSelection[] = [];

    // 1. Check explicit model routing by operationType
    if (request.operationType && this.config.modelRouting) {
      const routingSpec = this.config.modelRouting[request.operationType];
      if (routingSpec) {
        const [providerName, model] = routingSpec.split('/');
        const provider = this.providers.get(providerName as ProviderName);
        if (provider?.isAvailable()) {
          chain.push({ provider, model });
          return chain;
        }
      }
    }

    // 2. Determine tier
    const tier = this.resolveTier(request);

    // 3. Walk provider priority for that tier
    const priority = this.config.providerPriority?.[tier] || ['groq', 'anthropic', 'openai'];

    for (const providerName of priority) {
      const provider = this.providers.get(providerName as ProviderName);
      if (!provider?.isAvailable()) continue;

      const models = provider.getModels();
      const model = models[tier] || models.standard || Object.values(models)[0];
      if (model) {
        chain.push({ provider, model });
      }
    }

    // 4. Append local providers as fallback (if not already in chain)
    const localProviders = this.getLocalProviders();
    for (const local of localProviders) {
      if (!chain.find(c => c.provider.name === local.name)) {
        const models = local.getModels();
        const model = models[tier] || models.standard || Object.values(models)[0];
        if (model) {
          chain.push({ provider: local, model });
        }
      }
    }

    return chain;
  }

  /**
   * Resolve the effective tier for a request
   */
  private resolveTier(request: LLMCompletionRequest): ModelTier {
    // Explicit tier
    if (request.tier) return request.tier;

    // Environment override
    const envTier = process.env.SEMANTIC_ANALYSIS_TIER?.toLowerCase() as ModelTier;
    if (envTier && ['fast', 'standard', 'premium'].includes(envTier)) {
      return envTier;
    }

    // Task-specific env override
    if (request.taskType) {
      const taskEnvKey = `${request.taskType.toUpperCase()}_TIER`;
      const taskEnvTier = process.env[taskEnvKey]?.toLowerCase() as ModelTier;
      if (taskEnvTier && ['fast', 'standard', 'premium'].includes(taskEnvTier)) {
        return taskEnvTier;
      }
    }

    // Agent override
    if (request.agentId && this.config.agentOverrides?.[request.agentId]) {
      return this.config.agentOverrides[request.agentId];
    }

    // Task type lookup
    if (request.taskType && this.config.taskTiers) {
      for (const [tier, tasks] of Object.entries(this.config.taskTiers)) {
        if (tasks.includes(request.taskType)) {
          return tier as ModelTier;
        }
      }
    }

    return 'standard';
  }

  /**
   * Get tier for a task type (public method for consumers)
   */
  getTierForTask(taskType: string): ModelTier {
    return this.resolveTier({ messages: [], taskType });
  }
}
