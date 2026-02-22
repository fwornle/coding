/**
 * Configuration Loader
 *
 * Loads and merges LLM provider config from YAML, with env var expansion.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LLMServiceConfig, ModelTier, ProviderName } from './types.js';

// Dynamic import for yaml (ES module)
let yamlModule: any = null;
async function loadYaml(): Promise<any> {
  if (!yamlModule) {
    try {
      yamlModule = await import('yaml');
    } catch {
      // Fallback: try js-yaml (may be available in parent project)
      try {
        // @ts-ignore — js-yaml may not have type declarations
        yamlModule = await import('js-yaml');
      } catch {
        console.warn('[llm] No YAML parser available');
      }
    }
  }
  return yamlModule;
}

/**
 * Expand environment variables in a string: ${VAR} or ${VAR:-default}
 */
function expandEnvVars(str: string): string {
  return str.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, varName, defaultVal) => {
    return process.env[varName] || defaultVal || '';
  });
}

/**
 * Recursively expand env vars in all string values of an object
 */
function expandEnvVarsDeep(obj: any): any {
  if (typeof obj === 'string') return expandEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(expandEnvVarsDeep);
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load LLM service config from YAML file, searching multiple paths
 */
export async function loadConfig(customPath?: string): Promise<LLMServiceConfig> {
  const yaml = await loadYaml();
  if (!yaml) return getDefaultConfig();

  const searchPaths = customPath
    ? [customPath]
    : [
        path.join(process.cwd(), 'config', 'llm-providers.yaml'),
        path.join(process.cwd(), 'lib', 'llm', 'config', 'llm-providers.yaml'),
        // Fallback: look relative to this file for Docker contexts
        path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'config', 'llm-providers.yaml'),
      ];

  for (const configPath of searchPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const parse = yaml.parse || yaml.load;
        const parsed = parse(content);
        const expanded = expandEnvVarsDeep(parsed);
        console.info(`[llm] Loaded config from ${configPath}`);
        return normalizeConfig(expanded);
      } catch (error: any) {
        console.warn(`[llm] Failed to parse config at ${configPath}:`, error.message);
      }
    }
  }

  console.info('[llm] No llm-providers.yaml found, using defaults');
  return getDefaultConfig();
}

/**
 * Normalize YAML snake_case keys to camelCase config
 */
function normalizeConfig(raw: any): LLMServiceConfig {
  return {
    providers: raw.providers,
    providerPriority: raw.provider_priority || raw.providerPriority,
    taskTiers: raw.task_tiers || raw.taskTiers,
    agentOverrides: raw.agent_overrides || raw.agentOverrides,
    operatorTiers: raw.operator_tiers || raw.operatorTiers,
    batchTaskTiers: raw.batch_task_tiers || raw.batchTaskTiers,
    modelRouting: raw.model_routing || raw.modelRouting,
    dmr: raw.dmr,
    costLimits: raw.cost_limits || raw.costLimits,
    cache: raw.cache,
    circuitBreaker: raw.circuit_breaker || raw.circuitBreaker,
  };
}

/**
 * Get default config matching existing model-tiers.yaml
 */
export function getDefaultConfig(): LLMServiceConfig {
  return {
    providers: {
      groq: {
        name: 'groq' as ProviderName,
        apiKeyEnvVar: 'GROQ_API_KEY',
        models: { fast: 'llama-3.1-8b-instant', standard: 'llama-3.3-70b-versatile', premium: 'openai/gpt-oss-120b' },
        defaultModel: 'llama-3.3-70b-versatile',
      },
      anthropic: {
        name: 'anthropic' as ProviderName,
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        models: { fast: 'claude-haiku-4-5', standard: 'claude-sonnet-4-5', premium: 'claude-opus-4-6' },
        defaultModel: 'claude-sonnet-4-5',
      },
      openai: {
        name: 'openai' as ProviderName,
        apiKeyEnvVar: 'OPENAI_API_KEY',
        models: { fast: 'gpt-4.1-mini', standard: 'gpt-4.1', premium: 'o4-mini' },
        defaultModel: 'gpt-4.1-mini',
      },
      gemini: {
        name: 'gemini' as ProviderName,
        apiKeyEnvVar: 'GOOGLE_API_KEY',
        models: { fast: 'gemini-2.5-flash', standard: 'gemini-2.5-flash', premium: 'gemini-2.5-pro' },
        defaultModel: 'gemini-2.5-flash',
      },
      'github-models': {
        name: 'github-models' as ProviderName,
        apiKeyEnvVar: 'GITHUB_TOKEN',
        baseUrl: 'https://models.github.ai/inference/v1',
        models: { fast: 'gpt-4.1-mini', standard: 'gpt-4.1', premium: 'o4-mini' },
        defaultModel: 'gpt-4.1-mini',
      },
    },
    providerPriority: {
      fast: ['claude-code', 'copilot', 'groq'] as ProviderName[],
      standard: ['claude-code', 'copilot', 'groq', 'anthropic', 'openai'] as ProviderName[],
      premium: ['claude-code', 'copilot', 'anthropic', 'openai', 'groq'] as ProviderName[],
    },
    taskTiers: {
      fast: [
        'git_file_extraction', 'commit_message_parsing', 'file_pattern_matching',
        'basic_classification', 'documentation_file_scanning',
      ],
      standard: [
        'git_history_analysis', 'vibe_history_analysis', 'semantic_code_analysis',
        'documentation_linking', 'web_search_summarization', 'ontology_classification',
        'content_validation', 'deduplication_similarity',
      ],
      premium: [
        'insight_generation', 'observation_generation', 'pattern_recognition',
        'quality_assurance_review', 'deep_code_analysis', 'entity_significance_scoring',
      ],
    },
    agentOverrides: {
      insight_generation: 'premium' as ModelTier,
      observation_generation: 'premium' as ModelTier,
      quality_assurance: 'premium' as ModelTier,
      semantic_analysis: 'standard' as ModelTier,
      git_history: 'standard' as ModelTier,
      vibe_history: 'standard' as ModelTier,
      ontology_classification: 'standard' as ModelTier,
      content_validation: 'standard' as ModelTier,
      batch_scheduler: 'fast' as ModelTier,
      batch_checkpoint_manager: 'fast' as ModelTier,
      kg_operators: 'standard' as ModelTier,
    },
    dmr: {
      host: process.env.DMR_HOST || 'localhost',
      port: parseInt(process.env.DMR_PORT || '12434', 10),
      baseUrl: `http://${process.env.DMR_HOST || 'localhost'}:${process.env.DMR_PORT || '12434'}/engines/v1`,
      defaultModel: 'ai/llama3.2',
      modelOverrides: {
        git_history: 'ai/llama3.2:3B-Q4_K_M',
        vibe_history: 'ai/llama3.2:3B-Q4_K_M',
        web_search: 'ai/llama3.2:3B-Q4_K_M',
        documentation_linker: 'ai/llama3.2:3B-Q4_K_M',
        semantic_analysis: 'ai/qwen2.5-coder:7B-Q4_K_M',
        ontology_classification: 'ai/qwen2.5-coder:7B-Q4_K_M',
        content_validation: 'ai/qwen2.5-coder:7B-Q4_K_M',
        insight_generation: 'ai/llama3.2',
        observation_generation: 'ai/llama3.2',
        quality_assurance: 'ai/llama3.2',
        kg_operators: 'ai/qwen2.5-coder:7B-Q4_K_M',
      },
      timeout: 120000,
      maxTokens: 4096,
      temperature: 0.7,
      connection: {
        maxRetries: 3,
        retryDelay: 1000,
        healthCheckInterval: 30000,
      },
    },
    costLimits: {
      budgetMode: 0.05,
      standardMode: 0.50,
      qualityMode: 2.00,
    },
    cache: { maxSize: 1000, ttlMs: 3600000 },
    circuitBreaker: { threshold: 5, resetTimeoutMs: 60000 },
  };
}
