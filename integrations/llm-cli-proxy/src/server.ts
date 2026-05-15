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
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
  process?: string;         // cognitive process identifier (e.g. 'observation-writer', 'consolidator')
  subscription?: string;    // subscription context (e.g. 'copilot-subscription', 'max-subscription')
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
  recentFailures: number;
  lastFailureTime: number;
  consecutiveFailures: number;
}

interface HealthResponse {
  status: string;
  providers: Record<string, ProviderStatus>;
  uptime: number;
  inFlightRequests: number;
  networkMode: NetworkMode;
}

type NetworkMode = 'public' | 'corporate' | 'unknown';

// --- Configuration ---

const PORT = parseInt(process.env.LLM_CLI_PROXY_PORT || '12435', 10);
const HOST = '127.0.0.1';
const PROVIDER_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const PER_PROVIDER_TIMEOUT_MS = 15_000; // Per-provider timeout during fallback — reduced from 30s to avoid burning the caller's budget on a hung provider
const MAX_CLI_ARG_LENGTH = 200_000; // Use stdin for prompts exceeding this

// --- Network mode detection (backported from rapid-llm-proxy) ---
//
// On VPN/corporate, the claude-code CLI cannot reach Anthropic's endpoints
// directly and times out before falling back. Filtering it out of auto-select
// avoids a per-provider-timeout slowdown (15s) on every request. Explicit
// `provider: 'claude-code'` is still honored — the caller asked for it.
//
// Source of truth: health-coordinator's /health/state.network.location. We
// cache for 30s to match the coordinator's own poll cadence, and default to
// 'public' on probe failure (no harm — claude-code is tried first on public
// anyway, and the cooldown FSM handles the unlikely case where it's wedged).

const COORDINATOR_URL = process.env.HEALTH_COORDINATOR_URL || 'http://127.0.0.1:3034';
const NETWORK_CACHE_TTL_MS = 30_000;

let _cachedNetworkMode: NetworkMode = 'unknown';
let _networkModeCheckedAt = 0;

async function detectNetworkMode(): Promise<NetworkMode> {
  const now = Date.now();
  if (_cachedNetworkMode !== 'unknown' && (now - _networkModeCheckedAt) < NETWORK_CACHE_TTL_MS) {
    return _cachedNetworkMode;
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1000);
    const r = await fetch(`${COORDINATOR_URL}/health/state`, { signal: controller.signal });
    clearTimeout(t);
    if (r.ok) {
      const state = await r.json() as { network?: { location?: string } };
      const loc = state?.network?.location;
      _cachedNetworkMode = (loc === 'corporate' || loc === 'vpn') ? 'corporate' : 'public';
      _networkModeCheckedAt = now;
      return _cachedNetworkMode;
    }
  } catch { /* coordinator unreachable — fall through to default */ }
  _cachedNetworkMode = 'public';
  _networkModeCheckedAt = now;
  return _cachedNetworkMode;
}

function networkModeSync(): NetworkMode {
  // Cheap synchronous read of the cached value for /health and routing.
  // The async detectNetworkMode() refresh runs out-of-band on a timer.
  return _cachedNetworkMode === 'unknown' ? 'public' : _cachedNetworkMode;
}

// --- State ---

const providerStatuses: Record<string, ProviderStatus> = {};
const inFlightProcesses = new Set<ChildProcess>();
let startTime = Date.now();

// Provider health tracking: cooldown period after consecutive failures
const FAILURE_COOLDOWN_MS = 120_000; // 2 min cooldown after failures (increased from 1 min)
const MAX_CONSECUTIVE_BEFORE_COOLDOWN = 3; // After 3 consecutive failures, enter cooldown
const FAILURE_CAP = 50; // Cap consecutive failures — prevents counter from growing indefinitely

function recordProviderSuccess(providerName: string): void {
  const status = providerStatuses[providerName];
  if (status) {
    status.consecutiveFailures = 0;
    // Also decay recentFailures on success so healthy providers have better stats
    status.recentFailures = Math.max(0, status.recentFailures - 1);
  }
}

function recordProviderFailure(providerName: string): void {
  const status = providerStatuses[providerName];
  if (status) {
    status.recentFailures++;
    status.consecutiveFailures = Math.min(status.consecutiveFailures + 1, FAILURE_CAP);
    status.lastFailureTime = Date.now();
  }
}

function isProviderHealthy(providerName: string): boolean {
  const status = providerStatuses[providerName];
  if (!status?.available) return false;
  // If too many consecutive failures, require cooldown before retrying
  if (status.consecutiveFailures >= MAX_CONSECUTIVE_BEFORE_COOLDOWN) {
    const elapsed = Date.now() - status.lastFailureTime;
    if (elapsed < FAILURE_COOLDOWN_MS) {
      return false; // Still in cooldown
    }
    // Cooldown expired — reset consecutive failures to give it a fair chance
    // (one retry at a time; if it fails again, it re-enters cooldown from 1)
    status.consecutiveFailures = 0;
    log(`[health] ${providerName} cooldown expired, resetting failure counter for retry`);
  }
  return true;
}

function selectBestProvider(): string | null {
  // First pass: find a healthy provider
  for (const p of Object.keys(CLI_CONFIGS)) {
    if (isProviderHealthy(p)) return p;
  }
  // Second pass: any available provider (cooldown expired or not) — but only if
  // cooldown has actually expired. This prevents retrying a provider that just
  // failed 3 times in the last 2 minutes.
  for (const p of Object.keys(CLI_CONFIGS)) {
    const status = providerStatuses[p];
    if (!status?.available) continue;
    const elapsed = Date.now() - (status.lastFailureTime || 0);
    if (elapsed >= FAILURE_COOLDOWN_MS) return p;
  }
  return null;
}

function getOrderedProviders(preferredProvider?: string): string[] {
  const all = Object.keys(CLI_CONFIGS);
  // On corporate/VPN networks, claude-code CLI can't reach Anthropic and just
  // burns the per-provider timeout (15s) before falling back. Filter it out
  // of auto-select entirely. Explicit preferredProvider='claude-code' is still
  // honored below — the caller asked for it, so let them eat the timeout.
  const onCorporate = networkModeSync() === 'corporate';
  if (!preferredProvider) {
    // Sort: healthy first, then by fewer consecutive failures
    // Filter out providers in cooldown entirely — don't waste time on them
    return all
      .filter(p => {
        if (onCorporate && p === 'claude-code') return false;
        const status = providerStatuses[p];
        if (!status?.available) return false;
        // Skip providers deep in cooldown (failed recently with many consecutive failures)
        if (status.consecutiveFailures >= MAX_CONSECUTIVE_BEFORE_COOLDOWN) {
          const elapsed = Date.now() - status.lastFailureTime;
          if (elapsed < FAILURE_COOLDOWN_MS) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aHealthy = isProviderHealthy(a) ? 0 : 1;
        const bHealthy = isProviderHealthy(b) ? 0 : 1;
        if (aHealthy !== bHealthy) return aHealthy - bHealthy;
        return (providerStatuses[a]?.consecutiveFailures || 0) - (providerStatuses[b]?.consecutiveFailures || 0);
      });
  }
  // Put preferred first, filter out providers in cooldown (except the preferred one)
  return [preferredProvider, ...all.filter(p => {
    if (p === preferredProvider) return false;
    const status = providerStatuses[p];
    if (!status?.available) return false;
    if (status.consecutiveFailures >= MAX_CONSECUTIVE_BEFORE_COOLDOWN) {
      const elapsed = Date.now() - status.lastFailureTime;
      if (elapsed < FAILURE_COOLDOWN_MS) return false;
    }
    return true;
  })];
}

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

// --- Token Usage SQLite Persistence ---

const CODING_ROOT = process.env.CODING_ROOT || path.resolve(import.meta.dirname, '../../..');
const TOKEN_DB_PATH = path.join(CODING_ROOT, '.observations', 'token-usage.db');

let tokenDb: Database.Database | null = null;
let insertStmt: Database.Statement | null = null;

function initTokenDb(): void {
  try {
    fs.mkdirSync(path.dirname(TOKEN_DB_PATH), { recursive: true });
    tokenDb = new Database(TOKEN_DB_PATH);
    tokenDb.pragma('journal_mode = WAL');
    tokenDb.pragma('synchronous = NORMAL');
    tokenDb.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        process TEXT NOT NULL DEFAULT 'unknown',
        subscription TEXT NOT NULL DEFAULT 'unknown',
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        prompt_preview TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
      CREATE INDEX IF NOT EXISTS idx_token_usage_process ON token_usage(process);
      CREATE INDEX IF NOT EXISTS idx_token_usage_provider ON token_usage(provider);
    `);
    insertStmt = tokenDb.prepare(`
      INSERT INTO token_usage (timestamp, provider, model, process, subscription, input_tokens, output_tokens, total_tokens, latency_ms, prompt_preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    log('[TOKEN-DB] Initialized at ' + TOKEN_DB_PATH);
  } catch (err) {
    logError('[TOKEN-DB] Failed to initialize: ' + (err as Error).message);
  }
}

function logTokenUsage(
  provider: string, model: string, process: string, subscription: string,
  inputTokens: number, outputTokens: number, latencyMs: number, promptPreview: string
): void {
  try {
    insertStmt?.run(
      new Date().toISOString(), provider, model, process, subscription,
      inputTokens, outputTokens, inputTokens + outputTokens,
      latencyMs, promptPreview.slice(0, 200)
    );
  } catch (err) {
    logError('[TOKEN-DB] Insert failed: ' + (err as Error).message);
  }
}

// Initialize on import
initTokenDb();

async function checkProviderAvailable(providerName: string): Promise<ProviderStatus> {
  const config = CLI_CONFIGS[providerName];
  if (!config) {
    return { available: false, lastChecked: Date.now(), recentFailures: 0, lastFailureTime: 0, consecutiveFailures: 0 };
  }

  try {
    const result = await spawnCLIWithTimeout(
      config.command,
      config.versionArgs,
      undefined,
      5000
    );
    const version = result.stdout.trim().split('\n')[0] || undefined;
    // Preserve failure tracking across version checks
    const existing = providerStatuses[providerName];
    return {
      available: result.exitCode === 0,
      version,
      lastChecked: Date.now(),
      recentFailures: existing?.recentFailures || 0,
      lastFailureTime: existing?.lastFailureTime || 0,
      consecutiveFailures: existing?.consecutiveFailures || 0,
    };
  } catch {
    return { available: false, lastChecked: Date.now(), recentFailures: 0, lastFailureTime: 0, consecutiveFailures: 0 };
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
    networkMode: networkModeSync(),
  };
  res.json(response);
});

// Token usage query endpoints
app.get('/api/token-usage/summary', (_req, res) => {
  if (!tokenDb) return res.json({ error: 'Token DB not initialized' });
  try {
    const hours = parseInt((_req.query.hours as string) || '24', 10);
    const since = new Date(Date.now() - hours * 3600000).toISOString();

    const totals = tokenDb.prepare(`
      SELECT COUNT(*) as calls,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(ROUND(AVG(latency_ms)), 0) as avg_latency_ms
      FROM token_usage WHERE timestamp >= ?
    `).get(since) as Record<string, number>;

    const by_process = tokenDb.prepare(`
      SELECT process,
        COUNT(*) as calls,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        ROUND(AVG(latency_ms)) as avg_latency
      FROM token_usage WHERE timestamp >= ?
      GROUP BY process ORDER BY total_tokens DESC
    `).all(since);

    const by_provider = tokenDb.prepare(`
      SELECT provider,
        COUNT(*) as calls,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens
      FROM token_usage WHERE timestamp >= ?
      GROUP BY provider ORDER BY total_tokens DESC
    `).all(since);

    const by_model = tokenDb.prepare(`
      SELECT model,
        COUNT(*) as calls,
        SUM(total_tokens) as total_tokens
      FROM token_usage WHERE timestamp >= ?
      GROUP BY model ORDER BY total_tokens DESC
    `).all(since);

    const by_subscription = tokenDb.prepare(`
      SELECT subscription,
        COUNT(*) as calls,
        SUM(total_tokens) as total_tokens
      FROM token_usage WHERE timestamp >= ?
      GROUP BY subscription ORDER BY total_tokens DESC
    `).all(since);

    // Bucket size in minutes (default 2, clamped 1..60). Series is generated
    // via recursive CTE from `since` (floored to bucket boundary) to `now` so
    // empty buckets render as 0 instead of being interpolated across — which
    // was hiding multi-hour silence gaps in the proxy-routed traffic.
    const bucketMinutes = Math.max(1, Math.min(60, parseInt((_req.query.bucketMinutes as string) || '2', 10)));
    const bucketSeconds = bucketMinutes * 60;
    const by_hour = tokenDb.prepare(`
      WITH RECURSIVE series(bucket) AS (
        SELECT (strftime('%s', ?) / ${bucketSeconds}) * ${bucketSeconds}
        UNION ALL
        SELECT bucket + ${bucketSeconds} FROM series
        WHERE bucket + ${bucketSeconds} <= strftime('%s', 'now')
      )
      SELECT
        strftime('%Y-%m-%dT%H:%M:%S', series.bucket, 'unixepoch') as hour,
        COALESCE(SUM(t.input_tokens), 0) as input_tokens,
        COALESCE(SUM(t.output_tokens), 0) as output_tokens,
        COUNT(t.id) as calls
      FROM series
      LEFT JOIN token_usage t
        ON (strftime('%s', t.timestamp) / ${bucketSeconds}) * ${bucketSeconds} = series.bucket
        AND t.timestamp >= ?
      GROUP BY series.bucket
      ORDER BY series.bucket
    `).all(since, since);

    res.json({
      total_calls: totals.calls,
      total_input: totals.input_tokens,
      total_output: totals.output_tokens,
      total_tokens: totals.total_tokens,
      avg_latency_ms: totals.avg_latency_ms,
      by_process, by_provider, by_model, by_subscription, by_hour,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/token-usage/recent', (_req, res) => {
  if (!tokenDb) return res.json({ error: 'Token DB not initialized' });
  try {
    const limit = Math.min(parseInt((_req.query.limit as string) || '50', 10), 500);
    const rows = tokenDb.prepare(`
      SELECT * FROM token_usage ORDER BY timestamp DESC LIMIT ?
    `).all(limit);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Completion endpoint
app.post('/api/complete', async (req, res) => {
  const body = req.body as CompletionRequest;
  const { messages, model, maxTokens = 4096, temperature, tier } = body;
  const requestedProvider = body.provider;

  // Validate request
  if (!messages?.length) {
    res.status(400).json({ error: 'Missing required field: messages' });
    return;
  }

  // Build ordered list of providers to try
  const providersToTry = requestedProvider
    ? getOrderedProviders(requestedProvider)
    : getOrderedProviders();

  // Filter to only available providers
  const availableProviders = providersToTry.filter(p => providerStatuses[p]?.available);
  if (availableProviders.length === 0) {
    // If all providers are in cooldown, try any available one as last resort
    const anyAvailable = Object.keys(CLI_CONFIGS).filter(p => providerStatuses[p]?.available);
    if (anyAvailable.length === 0) {
      res.status(503).json({ error: 'No providers available' });
      return;
    }
    log(`[fallback] All providers in cooldown, trying ${anyAvailable[0]} as last resort`);
    availableProviders.push(anyAvailable[0]);
  }

  if (!requestedProvider) {
    log(`[auto-select] Trying providers in order: ${availableProviders.join(' → ')}`);
  }

  let lastError: { status: number; body: Record<string, unknown> } | null = null;

  for (const provider of availableProviders) {
    const config = CLI_CONFIGS[provider];
    if (!config) continue;

    // Resolve model from tier or use explicit model
    const resolvedModel = model || (tier ? config.tierModels[tier] : undefined) || config.defaultModel;
    const prompt = formatPrompt(messages);
    const requestStartTime = Date.now();

    try {
      let cliResult: { stdout: string; stderr: string; exitCode: number };
      // When falling back across providers, use shorter per-provider timeout
      // so we don't burn all time on a hung provider
      const totalTimeout = body.timeout || DEFAULT_TIMEOUT_MS;
      const timeoutMs = availableProviders.length > 1
        ? Math.min(PER_PROVIDER_TIMEOUT_MS, totalTimeout)
        : totalTimeout;

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
        recordProviderFailure(provider);
        log(`[fallback] ${provider} failed (exit ${cliResult.exitCode}, type=${type}), ${availableProviders.indexOf(provider) < availableProviders.length - 1 ? 'trying next provider...' : 'no more providers'}`);
        lastError = {
          status: httpStatus,
          body: { error: errorOutput || `CLI exited with code ${cliResult.exitCode}`, type, provider, exitCode: cliResult.exitCode },
        };
        // If explicitly requested, or retryable error on last provider → try next
        continue;
      }

      const content = cliResult.stdout.trim();
      const latencyMs = Date.now() - requestStartTime;
      const inputTokens = estimateTokens(prompt);
      const outputTokens = estimateTokens(content);

      recordProviderSuccess(provider);

      const response: CompletionResponse = {
        content,
        provider,
        model: resolvedModel,
        tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
        latencyMs,
      };

      // Persist token usage
      const processName = body.process || 'unknown';
      const subscription = body.subscription || (provider === 'copilot' ? 'copilot-subscription' : provider === 'claude-code' ? 'max-subscription' : 'api-key');
      const firstUserMsg = body.messages?.find(m => m.role === 'user')?.content || '';
      logTokenUsage(provider, resolvedModel, processName, subscription, inputTokens, outputTokens, latencyMs, firstUserMsg);

      res.json(response);
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      recordProviderFailure(provider);
      log(`[fallback] ${provider} threw: ${message}, ${availableProviders.indexOf(provider) < availableProviders.length - 1 ? 'trying next provider...' : 'no more providers'}`);

      if (message.includes('timed out')) {
        lastError = { status: 504, body: { error: message, type: 'TIMEOUT', provider } };
      } else {
        lastError = { status: 500, body: { error: message, type: 'INTERNAL_ERROR', provider } };
      }
      continue;
    }
  }

  // All providers failed — return the last error
  if (lastError) {
    res.status(lastError.status).json(lastError.body);
  } else {
    res.status(503).json({ error: 'No providers could handle the request' });
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
  // Warm the network-mode cache so the first /api/complete request doesn't
  // pay the coordinator round-trip; cache TTL (30s) keeps subsequent calls
  // synchronous via networkModeSync().
  detectNetworkMode().then(mode => log(`[llm-cli-proxy] Network mode: ${mode}`)).catch(() => { /* default 'public' kicks in */ });
});

// Re-check provider availability periodically
setInterval(refreshProviderStatuses, PROVIDER_CHECK_INTERVAL_MS);
// Refresh network-mode cache from the coordinator at the same cadence as its
// own polling — keeps VPN/corporate detection responsive without spamming.
setInterval(() => { detectNetworkMode().catch(() => { /* default kicks in */ }); }, NETWORK_CACHE_TTL_MS);

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
