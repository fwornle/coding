#!/usr/bin/env node
// Ultra-fast status line reader — CommonJS, no ESM overhead.
// Reads the pre-rendered cache file. Falls back to the full CSL only if stale.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const codingRepo = process.env.CODING_REPO || path.join(__dirname, '..');
// Per-project cache so each tmux session gets its own underline
const projectPath = process.env.TRANSCRIPT_SOURCE_PROJECT || process.env.TMUX_PANE_PATH || '';
const projectName = projectPath ? path.basename(projectPath) : '';
const cacheSuffix = projectName ? `-${projectName}` : '';
const cacheFile = path.join(codingRepo, '.logs', `combined-status-line-cache${cacheSuffix}.txt`);
const cslScript = path.join(__dirname, 'combined-status-line.js');

// Load .env file so admin/management API keys are available
const envFromFile = {};
try {
  const envContent = fs.readFileSync(path.join(codingRepo, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    if (line && !line.startsWith('#') && line.includes('=')) {
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key && !process.env[key]) envFromFile[key] = val;
    }
  }
} catch { /* .env missing — not fatal */ }

const env = { ...process.env, ...envFromFile, CODING_REPO: codingRepo };

// Read cache — used for fresh path and as fallback when CSL times out
let cachedContent = '';
let cacheAgeMs = Infinity;
try {
  const stat = fs.statSync(cacheFile);
  cacheAgeMs = Date.now() - stat.mtimeMs;
  cachedContent = fs.readFileSync(cacheFile, 'utf8').trim();
} catch { /* no cache */ }

// Fresh cache (<60s): use it directly
if (cacheAgeMs < 60000 && cachedContent) {
  process.stdout.write(cachedContent + '\n');
  // If cache is aging (>20s), trigger background refresh — but don't wait
  if (cacheAgeMs > 20000) {
    const bg = spawn('node', [cslScript], {
      env, stdio: 'ignore', detached: true
    });
    bg.unref();
  }
  process.exit(0);
}

// Cache stale (>60s) or missing — run full CSL synchronously,
// but use stale cache as fallback if CSL fails or times out
const child = spawn('node', [cslScript], { env, stdio: 'pipe' });

let output = '';
child.stdout.on('data', (d) => { output += d; });
child.stderr.on('data', () => {}); // discard stderr

// Safety timeout: if CSL hangs beyond 5s, fall back to stale cache
const fallbackTimer = setTimeout(() => {
  child.kill('SIGKILL');
}, 5000);

child.on('exit', (code) => {
  clearTimeout(fallbackTimer);
  const result = output.trim();
  if (code === 0 && result) {
    process.stdout.write(result + '\n');
    process.exit(0);
  }
  // CSL failed — use stale cache rather than showing "Status Offline"
  if (cachedContent) {
    process.stdout.write(cachedContent + '\n');
    // Trigger background refresh for next cycle
    const bg = spawn('node', [cslScript], {
      env, stdio: 'ignore', detached: true
    });
    bg.unref();
    process.exit(0);
  }
  // No cache at all — nothing to show
  process.exit(code || 1);
});
