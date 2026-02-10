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
   * Abstract complete method - subclasses implement the full flow
   */
  abstract complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
}
