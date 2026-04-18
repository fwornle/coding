#!/usr/bin/env node
/**
 * LLM Proxy Bridge — thin wrapper
 *
 * Delegates to @rapid/llm-proxy proxy-bridge server.
 * All provider management, SDK loading, circuit breaking, and caching
 * handled by the standalone package.
 *
 * Usage:
 *   node src/llm-proxy/llm-proxy.mjs                  # default port 8089
 *   LLM_PROXY_PORT=9000 node src/llm-proxy/llm-proxy.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgRoot = dirname(require.resolve('@rapid/llm-proxy/package.json'));

// Import and start the canonical proxy bridge from the standalone package
await import(resolve(pkgRoot, 'proxy-bridge', 'server.mjs'));
