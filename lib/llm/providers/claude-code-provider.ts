/**
 * Claude Code Provider (CLI-based, Claude Max OAuth)
 *
 * Shells out to the `claude` CLI in non-interactive mode (-p) to get completions.
 * This uses the user's Claude Max subscription (personal OAuth) rather than the
 * company's GitHub Copilot Enterprise quota.
 *
 * Previous design used CLIProviderBase with generic CLI spawning — no JSON output
 * parsing, no env cleaning, only token estimation. The new implementation gets
 * exact token counts from the CLI's JSON output and strips ANTHROPIC_API_KEY to
 * force subscription usage.
 *
 * CRITICAL: ANTHROPIC_API_KEY must NOT be in the env when spawning the CLI,
 * otherwise it uses the (depleted) API key instead of the Max OAuth subscription.
 *
 * Model mapping: short names (sonnet, opus, haiku) → CLI model aliases.
 * Auth: Claude Max OAuth token from macOS keychain (managed by claude CLI).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseProvider } from './base-provider.js';
import type { LLMCompletionRequest, LLMCompletionResult, ProviderConfig, ProviderName, LLMMessage } from '../types.js';

const execFileAsync = promisify(execFile);

/** Map tier names to CLI model aliases */
const MODEL_MAP: Record<string, string> = {
  'sonnet': 'sonnet',
  'haiku': 'haiku',
  'opus': 'opus',
};

/** Default CLI path */
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || '/opt/homebrew/bin/claude';

interface ClaudeJsonOutput {
  type: string;
  subtype: string;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  stop_reason: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
  }>;
}

export class ClaudeCodeProvider extends BaseProvider {
  readonly name: ProviderName = 'claude-code';
  readonly isLocal = false;

  private useProxy = false;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      models: {
        fast: 'haiku',
        standard: 'sonnet',
        premium: 'opus',
      },
      defaultModel: 'sonnet',
      timeout: 120000,
      ...config,
    });
  }

  /**
   * Build a clean env for the claude CLI subprocess.
   * CRITICAL: removes ANTHROPIC_API_KEY to force OAuth/Max subscription usage.
   */
  private buildCleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return env;
  }

  /**
   * Resolve model name from tier
   */
  private resolveCliModel(tier?: string): string {
    const shortName = this.resolveModel(tier as any);
    return MODEL_MAP[shortName] || shortName;
  }

  /**
   * Extract system prompt and user prompt from messages array.
   * - system messages → joined as system prompt
   * - user/assistant messages → concatenated as the prompt
   */
  private extractPrompts(messages: LLMMessage[]): { systemPrompt: string | null; userPrompt: string } {
    const systemParts: string[] = [];
    const userParts: string[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else if (m.role === 'assistant') {
        userParts.push(`Assistant: ${m.content}`);
      } else {
        userParts.push(m.content);
      }
    }

    return {
      systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : null,
      userPrompt: userParts.join('\n\n'),
    };
  }

  async initialize(): Promise<void> {
    // In Docker, use proxy (host has the CLI + keychain)
    const inDocker = !!process.env.LLM_CLI_PROXY_URL;

    if (!inDocker) {
      // Running on host — check if claude CLI is available and authenticated
      try {
        const { stdout } = await execFileAsync(CLAUDE_CLI, ['auth', 'status'], {
          timeout: 10_000,
          env: this.buildCleanEnv(),
        });

        const authStatus = JSON.parse(stdout);
        if (authStatus.loggedIn && authStatus.authMethod === 'claude.ai') {
          this._available = true;
          this.useProxy = false;
          process.stderr.write('[llm:claude-code] Provider initialized (CLI → Claude Max OAuth)\n');
          return;
        }

        // Logged in but not via claude.ai OAuth — might still work
        if (authStatus.loggedIn) {
          this._available = true;
          this.useProxy = false;
          process.stderr.write(`[llm:claude-code] Provider initialized (CLI → ${authStatus.authMethod})\n`);
          return;
        }

        process.stderr.write(`[llm:claude-code] CLI not authenticated: ${JSON.stringify(authStatus)}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[llm:claude-code] CLI check failed: ${msg}\n`);
      }
    }

    // Proxy bridge (for Docker containers)
    const proxyAvailable = await this.checkProxyAvailable();
    if (proxyAvailable) {
      this._available = true;
      this.useProxy = true;
      process.stderr.write('[llm:claude-code] Provider initialized (HTTP proxy → CLI on host)\n');
      return;
    }

    process.stderr.write('[llm:claude-code] Neither CLI nor proxy available\n');
    this._available = false;
  }

  private async checkProxyAvailable(): Promise<boolean> {
    const proxyUrl = process.env.LLM_CLI_PROXY_URL;
    if (!proxyUrl) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = (await response.json()) as { providers?: Record<string, { available?: boolean }> };
      return data.providers?.['claude-code']?.available === true;
    } catch {
      return false;
    }
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this._available) {
      throw new Error('Claude Code provider not available');
    }

    if (this.useProxy) {
      return this.completeViaProxy(request);
    }

    return this.completeViaCLI(request);
  }

  /**
   * Complete via the claude CLI in non-interactive mode.
   * Spawns: claude -p <prompt> --output-format json --model <model> --tools "" [--system-prompt <sp>]
   */
  private async completeViaCLI(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const model = this.resolveCliModel(request.tier);
    const { systemPrompt, userPrompt } = this.extractPrompts(request.messages);
    const timeoutMs = request.timeout || this.config.timeout || 120000;

    const args: string[] = [
      '-p', userPrompt,
      '--output-format', 'json',
      '--model', model,
      '--tools', '',          // Disable tools — we just want a completion
      '--no-session-persistence', // Don't save ingestion sessions
    ];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(CLAUDE_CLI, args, {
        timeout: timeoutMs,
        env: this.buildCleanEnv(),
        maxBuffer: 10 * 1024 * 1024, // 10MB for large responses
      });

      if (stderr) {
        process.stderr.write(`[llm:claude-code] stderr: ${stderr.trim().slice(0, 200)}\n`);
      }

      const output: ClaudeJsonOutput = JSON.parse(stdout);

      if (output.is_error) {
        const errMsg = output.result || 'Unknown CLI error';
        if (errMsg.toLowerCase().includes('credit balance') || errMsg.toLowerCase().includes('rate limit')) {
          throw new Error(`QUOTA_EXHAUSTED: ${errMsg}`);
        }
        if (errMsg.toLowerCase().includes('not logged in') || errMsg.toLowerCase().includes('login')) {
          throw new Error(`AUTH_ERROR: ${errMsg}`);
        }
        throw new Error(`Claude CLI error: ${errMsg}`);
      }

      // Extract token usage from modelUsage (more accurate) or top-level usage
      let inputTokens = output.usage?.input_tokens || 0;
      let outputTokens = output.usage?.output_tokens || 0;

      if (output.modelUsage) {
        const modelEntry = Object.values(output.modelUsage)[0];
        if (modelEntry) {
          inputTokens = modelEntry.inputTokens + (modelEntry.cacheReadInputTokens || 0) + (modelEntry.cacheCreationInputTokens || 0);
          outputTokens = modelEntry.outputTokens;
        }
      }

      const latencyMs = Date.now() - startTime;

      return {
        content: output.result,
        provider: this.name,
        model: Object.keys(output.modelUsage || {})[0] || model,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        },
        latencyMs,
        cached: false,
        local: false,
        mock: false,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      // execFile timeout manifests as ETIMEDOUT or killed
      if (msg.includes('ETIMEDOUT') || msg.includes('killed') || msg.includes('SIGTERM')) {
        throw new Error(`Claude CLI timed out after ${timeoutMs}ms`);
      }

      // Re-throw typed errors as-is
      if (msg.includes('QUOTA_EXHAUSTED') || msg.includes('AUTH_ERROR')) {
        throw error instanceof Error ? error : new Error(msg);
      }

      throw new Error(`Claude CLI failed: ${msg}`);
    }
  }

  /**
   * Complete via the host-side HTTP proxy bridge (for Docker containers).
   */
  private async completeViaProxy(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const proxyUrl = process.env.LLM_CLI_PROXY_URL;
    if (!proxyUrl) throw new Error('LLM_CLI_PROXY_URL not configured');

    const startTime = Date.now();
    const timeoutMs = request.timeout || this.config.timeout || 120000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${proxyUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.name,
          messages: request.messages,
          model: this.resolveCliModel(request.tier),
          maxTokens: request.maxTokens || 4096,
          temperature: request.temperature,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string; type?: string };
        if (response.status === 429 || err.type === 'QUOTA_EXHAUSTED') throw new Error(`QUOTA_EXHAUSTED: ${err.error}`);
        if (response.status === 401 || err.type === 'AUTH_ERROR') throw new Error(`AUTH_ERROR: ${err.error}`);
        throw new Error(`Proxy error (${response.status}): ${err.error}`);
      }

      const data = (await response.json()) as {
        content: string; model: string;
        tokens: { input: number; output: number; total: number };
        latencyMs: number;
      };
      return {
        content: data.content, provider: this.name, model: data.model,
        tokens: data.tokens, latencyMs: data.latencyMs || (Date.now() - startTime),
        cached: false, local: false, mock: false,
      };
    } catch (error: unknown) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') throw new Error(`Proxy timed out after ${timeoutMs}ms`);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
