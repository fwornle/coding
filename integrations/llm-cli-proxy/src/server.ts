/**
 * LLM CLI Proxy Bridge
 *
 * HTTP server on the host that forwards LLM requests to local CLI tools
 * (claude, copilot-cli). Docker containers connect via host.docker.internal:12435.
 *
 * Same pattern as DMR on port 12434 — host-side LLM service accessible from Docker.
 */

import express from 'express';
import cors from 'cors';
import { spawn, type ChildProcess } from 'child_process';

// --- Logging (uses stdout/stderr directly per project conventions) ---

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`${message}\n`);
}

// --- Types ---

interface CompletionRequest {
  provider: 'claude-code' | 'copilot';
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tier?: 'fast' | 'standard' | 'premium';
  timeout?: number;
}

interface CompletionResponse {
  content: string;
  provider: string;
  model: string;
  tokens: { input: number; output: number; total: number };
  latencyMs: number;
}

interface ProviderStatus {
  available: boolean;
  version?: string;
  lastChecked: number;
}

interface HealthResponse {
  status: string;
  providers: Record<string, ProviderStatus>;
  uptime: number;
  inFlightRequests: number;
}

// --- Configuration ---

const PORT = parseInt(process.env.LLM_CLI_PROXY_PORT || '12435', 10);
const HOST = '127.0.0.1';
const PROVIDER_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CLI_ARG_LENGTH = 200_000; // Use stdin for prompts exceeding this

// --- State ---

const providerStatuses: Record<string, ProviderStatus> = {};
const inFlightProcesses = new Set<ChildProcess>();
let startTime = Date.now();

// --- Provider CLI Mapping ---

interface CLIConfig {
  command: string;
  versionArgs: string[];
  tierModels: Record<string, string>;
  defaultModel: string;
  buildArgs: (prompt: string, model: string, maxTokens: number, temperature?: number) => string[];
  useStdinForPrompt: (prompt: string) => boolean;
  buildArgsWithStdin: (model: string, maxTokens: number, temperature?: number) => string[];
}

const CLI_CONFIGS: Record<string, CLIConfig> = {
  'claude-code': {
    command: 'claude',
    versionArgs: ['--version'],
    tierModels: {
      fast: 'sonnet',
      standard: 'sonnet',
      premium: 'opus',
    },
    defaultModel: 'sonnet',
    buildArgs: (prompt, model, _maxTokens, _temperature) => {
      // claude CLI supports: --print, --model, --output-format
      // It does NOT support: --silent, --max-tokens, --temperature
      const args = ['--print', '--model', model, '--output-format', 'text'];
      args.push(prompt);
      return args;
    },
    useStdinForPrompt: (prompt) => Buffer.byteLength(prompt, 'utf8') > MAX_CLI_ARG_LENGTH,
    buildArgsWithStdin: (model, _maxTokens, _temperature) => {
      const args = ['--print', '--model', model, '--output-format', 'text'];
      // claude reads from stdin when no positional prompt argument is given
      return args;
    },
  },
  'copilot': {
    command: 'copilot',
    versionArgs: ['--version'],
    tierModels: {
      fast: 'claude-haiku-4.5',
      standard: 'claude-sonnet-4.5',
      premium: 'claude-opus-4.6',
    },
    defaultModel: 'claude-sonnet-4.5',
    buildArgs: (prompt, model, _maxTokens, _temperature) => {
      // copilot CLI supports: -p/--prompt, --model, -s/--silent, --allow-all-tools
      // It does NOT support: --max-tokens, --temperature
      return ['--prompt', prompt, '--model', model, '--silent'];
    },
    useStdinForPrompt: (prompt) => Buffer.byteLength(prompt, 'utf8') > MAX_CLI_ARG_LENGTH,
    buildArgsWithStdin: (model, _maxTokens, _temperature) => {
      // copilot reads prompt from -p flag, not stdin; for large prompts
      // we still pass via -p but the caller should be aware of OS limits
      return ['--prompt', '-', '--model', model, '--silent'];
    },
  },
};

// --- Helper Functions ---

function formatPrompt(messages: CompletionRequest['messages']): string {
  return messages
    .map((m) => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return m.content;
    })
    .join('\n\n');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function checkProviderAvailable(providerName: string): Promise<ProviderStatus> {
  const config = CLI_CONFIGS[providerName];
  if (!config) {
    return { available: false, lastChecked: Date.now() };
  }

  try {
    const result = await spawnCLIWithTimeout(
      config.command,
      config.versionArgs,
      undefined,
      5000
    );
    const version = result.stdout.trim().split('\n')[0] || undefined;
    return { available: result.exitCode === 0, version, lastChecked: Date.now() };
  } catch {
    return { available: false, lastChecked: Date.now() };
  }
}

function spawnCLIWithTimeout(
  command: string,
  args: string[],
  input: string | undefined,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // Build clean environment for CLI tools:
    // - Remove ANTHROPIC_API_KEY so claude CLI uses Max subscription (OAuth)
    //   instead of depleted pay-as-you-go API credits
    // - Remove CLAUDECODE to avoid nested session detection
    const cliEnv = { ...process.env };
    delete cliEnv.ANTHROPIC_API_KEY;
    delete cliEnv.CLAUDECODE;

    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cliEnv,
    });

    inFlightProcesses.add(proc);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000);
    }, timeoutMs);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      clearTimeout(timer);
      inFlightProcesses.delete(proc);
      reject(new Error(`Failed to spawn ${command}: ${error.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      inFlightProcesses.delete(proc);

      if (timedOut) {
        reject(new Error(`CLI command timed out after ${timeoutMs}ms`));
        return;
      }

      resolve({ stdout, stderr, exitCode: code || 0 });
    });

    if (input && proc.stdin) {
      proc.stdin.write(input);
      proc.stdin.end();
    } else if (proc.stdin) {
      proc.stdin.end();
    }
  });
}

function mapErrorToStatus(stderr: string): { status: number; type: string } {
  const lower = stderr.toLowerCase();
  if (
    lower.includes('rate limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('monthly limit') ||
    lower.includes('usage limit') ||
    lower.includes('too many requests') ||
    lower.includes('credit balance') ||
    lower.includes('balance is too low')
  ) {
    return { status: 429, type: 'QUOTA_EXHAUSTED' };
  }
  if (
    lower.includes('not authenticated') ||
    lower.includes('login required') ||
    lower.includes('invalid token') ||
    lower.includes('authentication failed') ||
    lower.includes('unauthorized')
  ) {
    return { status: 401, type: 'AUTH_ERROR' };
  }
  return { status: 500, type: 'CLI_ERROR' };
}

// --- Express App ---

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health endpoint
app.get('/health', (_req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    providers: { ...providerStatuses },
    uptime: Math.floor((Date.now() - startTime) / 1000),
    inFlightRequests: inFlightProcesses.size,
  };
  res.json(response);
});

// Completion endpoint
app.post('/api/complete', async (req, res) => {
  const body = req.body as CompletionRequest;
  const { provider, messages, model, maxTokens = 4096, temperature, tier } = body;

  // Validate request
  if (!provider || !messages?.length) {
    res.status(400).json({ error: 'Missing required fields: provider, messages' });
    return;
  }

  const config = CLI_CONFIGS[provider];
  if (!config) {
    res.status(400).json({ error: `Unknown provider: ${provider}. Supported: ${Object.keys(CLI_CONFIGS).join(', ')}` });
    return;
  }

  const status = providerStatuses[provider];
  if (!status?.available) {
    res.status(503).json({ error: `Provider ${provider} not available`, type: 'PROVIDER_UNAVAILABLE' });
    return;
  }

  // Resolve model from tier or use explicit model
  const resolvedModel = model || (tier ? config.tierModels[tier] : undefined) || config.defaultModel;
  const prompt = formatPrompt(messages);
  const requestStartTime = Date.now();

  try {
    let cliResult: { stdout: string; stderr: string; exitCode: number };
    const timeoutMs = body.timeout || DEFAULT_TIMEOUT_MS;

    // Choose between arg-based or stdin-based invocation
    if (config.useStdinForPrompt(prompt)) {
      const args = config.buildArgsWithStdin(resolvedModel, maxTokens, temperature);
      cliResult = await spawnCLIWithTimeout(config.command, args, prompt, timeoutMs);
    } else {
      const args = config.buildArgs(prompt, resolvedModel, maxTokens, temperature);
      cliResult = await spawnCLIWithTimeout(config.command, args, undefined, timeoutMs);
    }

    if (cliResult.exitCode !== 0) {
      // Some CLIs write errors to stdout (e.g. claude CLI), so check both
      const errorOutput = cliResult.stderr.trim() || cliResult.stdout.trim();
      const { status: httpStatus, type } = mapErrorToStatus(errorOutput);
      res.status(httpStatus).json({
        error: errorOutput || `CLI exited with code ${cliResult.exitCode}`,
        type,
        provider,
        exitCode: cliResult.exitCode,
      });
      return;
    }

    const content = cliResult.stdout.trim();
    const latencyMs = Date.now() - requestStartTime;
    const inputTokens = estimateTokens(prompt);
    const outputTokens = estimateTokens(content);

    const response: CompletionResponse = {
      content,
      provider,
      model: resolvedModel,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      latencyMs,
    };

    res.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('timed out')) {
      res.status(504).json({ error: message, type: 'TIMEOUT', provider });
      return;
    }

    res.status(500).json({ error: message, type: 'INTERNAL_ERROR', provider });
  }
});

// --- Provider Availability Checker ---

async function refreshProviderStatuses(): Promise<void> {
  for (const providerName of Object.keys(CLI_CONFIGS)) {
    providerStatuses[providerName] = await checkProviderAvailable(providerName);
    const status = providerStatuses[providerName];
    const label = status.available
      ? `available${status.version ? ` (${status.version})` : ''}`
      : 'not available';
    log(`[llm-cli-proxy] ${providerName}: ${label}`);
  }
}

// --- Graceful Shutdown ---

function gracefulShutdown(signal: string): void {
  log(`\n[llm-cli-proxy] Received ${signal}, shutting down...`);

  // Kill all in-flight CLI processes
  for (const proc of inFlightProcesses) {
    proc.kill('SIGTERM');
  }

  // Give processes 5s to terminate, then force kill
  setTimeout(() => {
    for (const proc of inFlightProcesses) {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }
    process.exit(0);
  }, 5000);

  // Close server
  server.close(() => {
    log('[llm-cli-proxy] Server closed');
    if (inFlightProcesses.size === 0) {
      process.exit(0);
    }
  });
}

// --- Start Server ---

const server = app.listen(PORT, HOST, async () => {
  startTime = Date.now();
  log(`[llm-cli-proxy] Server listening on http://${HOST}:${PORT}`);
  log(`[llm-cli-proxy] Docker access: http://host.docker.internal:${PORT}`);
  log('[llm-cli-proxy] Checking CLI availability...');
  await refreshProviderStatuses();
});

// Re-check provider availability periodically
setInterval(refreshProviderStatuses, PROVIDER_CHECK_INTERVAL_MS);

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
