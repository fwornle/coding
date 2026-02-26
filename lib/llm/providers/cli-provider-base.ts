/**
 * CLI Provider Base
 *
 * Abstract base class for providers that invoke external CLI tools
 * (claude, gh copilot, etc.) via child process spawning.
 *
 * Subscription-based providers that wrap CLI commands.
 */

import { spawn } from 'child_process';
import { BaseProvider } from './base-provider.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, LLMMessage } from '../types.js';

export abstract class CLIProviderBase extends BaseProvider {
  /**
   * The CLI command to execute (e.g., 'claude', 'gh')
   */
  protected abstract readonly cliCommand: string;

  /**
   * Optional subcommand (e.g., 'copilot' for gh CLI)
   */
  protected readonly cliSubcommand?: string;

  /**
   * Whether this provider is using the HTTP proxy bridge instead of local CLI
   */
  protected _useProxy = false;

  /**
   * Build command-line arguments for the request
   */
  protected abstract buildArgs(request: LLMCompletionRequest): string[];

  /**
   * Parse CLI stdout to extract completion text
   */
  protected abstract parseResponse(stdout: string): string;

  /**
   * Check if CLI is installed and available
   */
  protected async checkCLIAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await this.spawnCLI(['--version'], undefined, 5000);
      return exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if CLI is authenticated
   */
  protected async checkCLIAuthenticated(): Promise<boolean> {
    try {
      // Subclasses can override this
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Spawn CLI process with timeout and error handling
   */
  protected async spawnCLI(
    args: string[],
    input?: string,
    timeoutMs?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs || this.config.timeout || 60000;
      const command = this.cliSubcommand
        ? [this.cliCommand, this.cliSubcommand, ...args]
        : [this.cliCommand, ...args];

      const proc = spawn(command[0], command.slice(1), {
        stdio: input ? 'pipe' : 'inherit',
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      }, timeout);

      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      proc.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn CLI: ${error.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);

        if (timedOut) {
          reject(new Error(`CLI command timed out after ${timeout}ms`));
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });

      // Write input if provided
      if (input && proc.stdin) {
        proc.stdin.write(input);
        proc.stdin.end();
      }
    });
  }

  /**
   * Estimate token count from text (rough: ~4 chars per token)
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Detect quota exhaustion from stderr
   */
  protected isQuotaError(stderr: string): boolean {
    const lowerStderr = stderr.toLowerCase();
    return (
      lowerStderr.includes('rate limit') ||
      lowerStderr.includes('quota exceeded') ||
      lowerStderr.includes('monthly limit') ||
      lowerStderr.includes('usage limit') ||
      lowerStderr.includes('too many requests')
    );
  }

  /**
   * Detect authentication failures from stderr
   */
  protected isAuthError(stderr: string): boolean {
    const lowerStderr = stderr.toLowerCase();
    return (
      lowerStderr.includes('not authenticated') ||
      lowerStderr.includes('login required') ||
      lowerStderr.includes('invalid token') ||
      lowerStderr.includes('authentication failed') ||
      lowerStderr.includes('unauthorized')
    );
  }

  /**
   * Format messages array into a single prompt string
   */
  protected formatPrompt(messages: LLMMessage[]): string {
    // Simple concatenation with role prefixes
    return messages
      .map((m) => {
        if (m.role === 'system') return `System: ${m.content}`;
        if (m.role === 'assistant') return `Assistant: ${m.content}`;
        return m.content; // User messages without prefix
      })
      .join('\n\n');
  }

  /**
   * Check if the HTTP proxy bridge is available for this provider.
   * Uses native fetch() (Node 22+). Returns true if proxy reports
   * this provider as available.
   */
  protected async checkProxyAvailable(): Promise<boolean> {
    const proxyUrl = process.env.LLM_CLI_PROXY_URL;
    if (!proxyUrl) {
      console.info(`[llm:proxy] ${this.name}: no LLM_CLI_PROXY_URL configured`);
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.info(`[llm:proxy] ${this.name}: proxy health check failed (HTTP ${response.status}) at ${proxyUrl}/health`);
        return false;
      }

      const data = (await response.json()) as {
        providers?: Record<string, { available?: boolean }>;
      };
      const isAvailable = data.providers?.[this.name]?.available === true;
      const allProviders = data.providers ? Object.keys(data.providers).filter(k => data.providers![k]?.available) : [];
      console.info(`[llm:proxy] ${this.name}: proxy=${proxyUrl} available=${isAvailable} (proxy providers: ${allProviders.join(', ') || 'none'})`);
      return isAvailable;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.info(`[llm:proxy] ${this.name}: proxy check failed at ${proxyUrl}/health — ${msg}`);
      return false;
    }
  }

  /**
   * Complete a request via the HTTP proxy bridge.
   * POSTs to LLM_CLI_PROXY_URL/api/complete and maps HTTP errors
   * back to error types the circuit breaker understands.
   */
  protected async completeViaProxy(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const proxyUrl = process.env.LLM_CLI_PROXY_URL;
    if (!proxyUrl) {
      throw new Error('LLM_CLI_PROXY_URL not configured');
    }

    const startTime = Date.now();
    const timeoutMs = this.config.timeout || 60000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${proxyUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.name,
          messages: request.messages,
          model: this.resolveModel(request.tier),
          maxTokens: request.maxTokens || 4096,
          temperature: request.temperature,
          tier: request.tier,
          timeout: timeoutMs,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
          type?: string;
        };
        const errorType = errorData.type || 'UNKNOWN';
        const errorMsg = errorData.error || `HTTP ${response.status}`;

        if (response.status === 429 || errorType === 'QUOTA_EXHAUSTED') {
          throw new Error(`QUOTA_EXHAUSTED: ${errorMsg}`);
        }
        if (response.status === 401 || errorType === 'AUTH_ERROR') {
          throw new Error(`AUTH_ERROR: ${errorMsg}`);
        }
        throw new Error(`Proxy error (${response.status}): ${errorMsg}`);
      }

      const data = (await response.json()) as {
        content: string;
        provider: string;
        model: string;
        tokens: { input: number; output: number; total: number };
        latencyMs: number;
      };

      return {
        content: data.content,
        provider: this.name,
        model: data.model,
        tokens: data.tokens,
        latencyMs: data.latencyMs || (Date.now() - startTime),
        cached: false,
        local: false,
        mock: false,
      };
    } catch (error: unknown) {
      clearTimeout(timeout);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Proxy request timed out after ${timeoutMs}ms`);
        }
        throw error;
      }
      throw new Error(`Proxy request failed: ${String(error)}`);
    }
  }

  /**
   * Abstract complete method - subclasses implement the full flow
   */
  abstract complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
}
