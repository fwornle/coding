#!/usr/bin/env node
/**
 * LLM Proxy Bridge
 *
 * Thin HTTP wrapper around the existing lib/llm/LLMService that provides
 * LLM completions to Docker containers and plugins via a REST API.
 *
 * - Delegates ALL provider management, SDK loading, circuit breaking, and
 *   caching to lib/llm/LLMService (no provider duplication)
 * - Network-adaptive provider priority: VPN -> copilot first, outside -> claude-code first
 * - HTTP interface: GET /health, POST /api/complete
 *
 * Usage:
 *   node src/llm-proxy/llm-proxy.mjs                  # default port 8089
 *   LLM_PROXY_PORT=9000 node src/llm-proxy/llm-proxy.mjs
 */

import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = parseInt(process.env.LLM_PROXY_PORT || '8089', 10);

const log = (msg) => process.stderr.write(`[llm-proxy] ${msg}\n`);
const logErr = (msg) => process.stderr.write(`[llm-proxy] ERROR: ${msg}\n`);

// --- Network Detection (matches config/agents/opencode.sh pattern) ---

function detectNetwork() {
  const envOverride = process.env.INSIDE_CN;
  if (envOverride !== undefined) {
    return envOverride === 'true';
  }
  // Heuristic: check if corporate proxy or VPN indicators are set
  const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
  for (const v of proxyVars) {
    if (process.env[v] && process.env[v].includes('.corp')) {
      return true;
    }
  }
  // Try to detect VPN via network interface (best-effort)
  try {
    const ifaces = execSync('ifconfig 2>/dev/null || ip addr 2>/dev/null', {
      encoding: 'utf8', timeout: 2000,
    });
    if (ifaces.includes('utun') || ifaces.includes('tun0') || ifaces.includes('gpd0')) {
      return true;
    }
  } catch {
    // Ignore — default to outside VPN
  }
  return false;
}

// --- LLMService Integration ---

let llmService = null;
let insideVPN = false;

async function initLLMService() {
  insideVPN = detectNetwork();
  log(`Network: ${insideVPN ? 'VPN/Corporate' : 'Public'}`);

  // Resolve path to compiled lib/llm relative to this file
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(thisDir, '..', '..');
  const llmDistPath = path.join(projectRoot, 'lib', 'llm', 'dist', 'index.js');

  try {
    const { LLMService } = await import(llmDistPath);
    llmService = new LLMService();

    // Initialize with the project's config/llm-providers.yaml
    const configPath = path.join(projectRoot, 'config', 'llm-providers.yaml');
    await llmService.initialize(configPath);

    const providers = llmService.getAvailableProviders();
    log(`LLMService initialized. Available providers: [${providers.join(', ')}]`);
  } catch (err) {
    logErr(`Failed to initialize LLMService: ${err.message}`);
    logErr('The proxy will start but all completions will fail.');
    logErr('Ensure lib/llm/ is compiled: cd lib/llm && npm run build');
  }
}

/**
 * Determine default provider based on network and request
 */
function resolveDefaultProvider() {
  if (insideVPN) {
    return 'copilot';  // Corporate subscription, free inside VPN
  }
  return 'claude-code';  // Claude Max subscription outside VPN
}

// --- HTTP Server ---

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // GET /health — provider status
  if (req.method === 'GET' && req.url === '/health') {
    const providers = llmService ? llmService.getAvailableProviders() : [];
    const providerStatus = {};
    for (const name of providers) {
      providerStatus[name] = { available: true };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: llmService ? 'ok' : 'degraded',
      network: insideVPN ? 'vpn' : 'public',
      defaultProvider: resolveDefaultProvider(),
      providers: providerStatus,
    }));
  }

  // POST /api/complete — LLM completion
  if (req.method === 'POST' && req.url === '/api/complete') {
    if (!llmService) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'LLMService not initialized',
        type: 'SERVICE_UNAVAILABLE',
      }));
    }

    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'messages array required' }));
    }

    const startTime = Date.now();
    const provider = body.provider || resolveDefaultProvider();

    try {
      log(`${provider}: model=${body.model || 'default'} messages=${body.messages.length}`);

      // Build LLMService request — delegate everything to lib/llm
      const request = {
        messages: body.messages,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        tier: body.tier,
        operationType: body.operationType || 'proxy-completion',
        // If caller specified a provider, try to route to it
        // LLMService uses provider chain; we hint via taskType
        taskType: body.taskType,
      };

      // If specific provider requested, we can try to force it
      // by placing it first in priority (LLMService will still fallback)
      if (body.provider) {
        request.taskType = request.taskType || `proxy_${body.provider}`;
      }

      const result = await llmService.complete(request);
      const latencyMs = Date.now() - startTime;

      log(`${result.provider}: completed in ${latencyMs}ms (${result.tokens?.output || 0} output tokens)`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        content: result.content,
        provider: result.provider,
        model: result.model,
        tokens: result.tokens || { input: 0, output: 0, total: 0 },
        latencyMs,
      }));
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const msg = err.message || String(err);
      logErr(`${provider}: error after ${latencyMs}ms: ${msg}`);

      // Map errors to appropriate HTTP status codes
      const msgLower = msg.toLowerCase();
      if (msgLower.includes('rate limit') || msgLower.includes('quota') || msgLower.includes('credit balance')) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: msg, type: 'QUOTA_EXHAUSTED' }));
      }
      if (msgLower.includes('not authenticated') || msgLower.includes('unauthorized') || msgLower.includes('not logged in')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: msg, type: 'AUTH_ERROR' }));
      }

      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: msg, type: 'COMPLETION_ERROR' }));
    }
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// --- Startup ---

async function main() {
  log('Initializing LLM proxy bridge...');
  await initLLMService();

  server.listen(PORT, '0.0.0.0', () => {
    log(`Listening on http://0.0.0.0:${PORT}`);
    log(`Docker: LLM_CLI_PROXY_URL=http://host.docker.internal:${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Shutting down...');
  server.close();
  process.exit(0);
});

main().catch(err => {
  logErr(`Fatal: ${err.message}`);
  process.exit(1);
});
