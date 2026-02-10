/**
 * Claude Code Provider
 *
 * Routes LLM requests through the `claude` CLI (Claude Code subscription).
 * Zero per-token cost, automatic quota detection, falls back to API on exhaustion.
 */

import { CLIProviderBase } from './cli-provider-base.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName, ModelTier } from '../types.js';

export class ClaudeCodeProvider extends CLIProviderBase {
  readonly name: ProviderName = 'claude-code';
  readonly isLocal = false;
  protected readonly cliCommand = 'claude';

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: {
        fast: 'sonnet',
        standard: 'sonnet',
        premium: 'opus',
      },
      defaultModel: 'sonnet',
      timeout: 60000, // 60 seconds
      ...config,
    });
  }

  async initialize(): Promise<void> {
    // Check if claude CLI is installed
    const isInstalled = await this.checkCLIAvailable();
    if (!isInstalled) {
      console.info('[llm:claude-code] CLI not installed or not in PATH');
      this._available = false;
      return;
    }

    // Check authentication by running a simple test
    try {
      const { exitCode, stderr } = await this.spawnCLI(['--version'], undefined, 5000);

      if (exitCode !== 0) {
        console.warn('[llm:claude-code] CLI test failed:', stderr);
        this._available = false;
        return;
      }

      this._available = true;
      console.info('[llm:claude-code] Provider initialized successfully');
    } catch (error: any) {
      console.warn('[llm:claude-code] Failed to initialize:', error.message);
      this._available = false;
    }
  }

  /**
   * Build arguments for claude CLI
   */
  protected buildArgs(request: LLMCompletionRequest): string[] {
    const model = this.resolveModel(request.tier);
    const maxTokens = request.maxTokens || 4096;
    const prompt = this.formatPrompt(request.messages);

    const args = [
      '--print',     // Print only the response
      '--silent',    // Suppress informational messages
      '--model', model,
      '--max-tokens', maxTokens.toString(),
      prompt,        // Prompt as final positional argument
    ];

    // Add temperature if specified
    if (request.temperature !== undefined) {
      args.splice(-1, 0, '--temperature', request.temperature.toString());
    }

    return args;
  }

  /**
   * Parse claude CLI response
   */
  protected parseResponse(stdout: string): string {
    // Claude CLI returns plain text response
    return stdout.trim();
  }

  /**
   * Override model resolution to map tier to CLI model names
   */
  protected resolveModel(tier?: ModelTier): string {
    // Map tier to CLI model names
    const tierMap: Record<ModelTier, string> = {
      fast: 'sonnet',
      standard: 'sonnet',
      premium: 'opus',
    };

    if (tier && tierMap[tier]) {
      return tierMap[tier];
    }

    return 'sonnet'; // Default to sonnet
  }

  /**
   * Complete an LLM request via claude CLI
   */
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this._available) {
      throw new Error('Claude Code provider not available');
    }

    const startTime = Date.now();
    const args = this.buildArgs(request);

    try {
      const { stdout, stderr, exitCode } = await this.spawnCLI(args);

      if (exitCode !== 0) {
        // Check for quota exhaustion
        if (this.isQuotaError(stderr)) {
          throw new Error('QUOTA_EXHAUSTED: Claude Code subscription quota exceeded');
        }

        // Check for auth errors
        if (this.isAuthError(stderr)) {
          throw new Error('AUTH_ERROR: Claude Code authentication failed');
        }

        // Generic error
        throw new Error(`Claude CLI failed (exit ${exitCode}): ${stderr}`);
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

      throw new Error(`Claude Code provider failed: ${error.message}`);
    }
  }
}
