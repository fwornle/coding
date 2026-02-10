/**
 * GitHub Copilot Provider
 *
 * Routes LLM requests through the `copilot-cli` command (GitHub Copilot subscription).
 * Zero per-token cost, automatic quota detection, falls back to API on exhaustion.
 */

import { CLIProviderBase } from './cli-provider-base.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName, ModelTier } from '../types.js';

export class CopilotProvider extends CLIProviderBase {
  readonly name: ProviderName = 'copilot';
  readonly isLocal = false;
  protected readonly cliCommand = 'copilot-cli';

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: {
        fast: 'gpt-4o-mini',
        standard: 'gpt-4o',
        premium: 'gpt-4o', // Copilot may support claude-opus-4, fallback to gpt-4o
      },
      defaultModel: 'gpt-4o',
      timeout: 60000, // 60 seconds
      ...config,
    });
  }

  async initialize(): Promise<void> {
    // Check if copilot-cli is installed
    const isInstalled = await this.checkCLIAvailable();
    if (!isInstalled) {
      console.info('[llm:copilot] copilot-cli not installed or not in PATH');
      this._available = false;
      return;
    }

    // Test authentication
    try {
      const { exitCode, stderr } = await this.spawnCLI(['--version'], undefined, 5000);

      if (exitCode !== 0) {
        console.warn('[llm:copilot] CLI test failed:', stderr);
        this._available = false;
        return;
      }

      this._available = true;
      console.info('[llm:copilot] Provider initialized successfully');
    } catch (error: any) {
      console.warn('[llm:copilot] Failed to initialize:', error.message);
      this._available = false;
    }
  }

  /**
   * Build arguments for copilot-cli
   */
  protected buildArgs(request: LLMCompletionRequest): string[] {
    const model = this.resolveModel(request.tier);
    const maxTokens = request.maxTokens || 4096;
    const prompt = this.formatPrompt(request.messages);

    const args = [
      '--prompt', prompt,
      '--model', model,
      '--max-tokens', maxTokens.toString(),
      '--silent',  // Suppress extra output
    ];

    // Add temperature if specified
    if (request.temperature !== undefined) {
      args.push('--temperature', request.temperature.toString());
    }

    return args;
  }

  /**
   * Parse copilot-cli response
   */
  protected parseResponse(stdout: string): string {
    // copilot-cli returns plain text response
    // May need adjustment based on actual CLI output format
    return stdout.trim();
  }

  /**
   * Override model resolution for copilot models
   */
  protected resolveModel(tier?: ModelTier): string {
    const tierMap: Record<ModelTier, string> = {
      fast: 'gpt-4o-mini',
      standard: 'gpt-4o',
      premium: 'gpt-4o', // Could be 'claude-opus-4' if available
    };

    if (tier && tierMap[tier]) {
      return tierMap[tier];
    }

    return 'gpt-4o'; // Default
  }

  /**
   * Complete an LLM request via copilot-cli
   */
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this._available) {
      throw new Error('GitHub Copilot provider not available');
    }

    const startTime = Date.now();
    const args = this.buildArgs(request);

    try {
      const { stdout, stderr, exitCode } = await this.spawnCLI(args);

      if (exitCode !== 0) {
        // Check for quota exhaustion
        if (this.isQuotaError(stderr)) {
          throw new Error('QUOTA_EXHAUSTED: GitHub Copilot subscription quota exceeded');
        }

        // Check for auth errors
        if (this.isAuthError(stderr)) {
          throw new Error('AUTH_ERROR: GitHub Copilot authentication failed');
        }

        // Generic error
        throw new Error(`copilot-cli failed (exit ${exitCode}): ${stderr}`);
      }

      const content = this.parseResponse(stdout);
      const latencyMs = Date.now() - startTime;

      // Estimate tokens (CLI doesn't provide exact counts)
      const promptText = this.formatPrompt(request.messages);
      const promptTokens = this.estimateTokens(promptText);
      const completionTokens = this.estimateTokens(content);
      const totalTokens = promptTokens + completionTokens;

      return {
        content,
        provider: this.name,
        model: this.resolveModel(request.tier),
        tokens: {
          input: promptTokens,
          output: completionTokens,
          total: totalTokens,
        },
        latencyMs,
        cached: false,
        local: false,
        mock: false,
      };
    } catch (error: any) {
      // Re-throw with context
      if (error.message.includes('QUOTA_EXHAUSTED')) {
        throw error; // Propagate quota errors for circuit breaker
      }

      throw new Error(`GitHub Copilot provider failed: ${error.message}`);
    }
  }
}
