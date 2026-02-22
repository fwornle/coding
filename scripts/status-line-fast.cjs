#!/usr/bin/env node
// Ultra-fast status line reader — CommonJS, no ESM overhead.
// Reads the pre-rendered cache file. Falls back to the full CSL only if stale.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const codingRepo = process.env.CODING_REPO || path.join(__dirname, '..');
const cacheFile = path.join(codingRepo, '.logs', 'combined-status-line-cache.txt');
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

let cacheAgeMs = Infinity;
try {
  const stat = fs.statSync(cacheFile);
  cacheAgeMs = Date.now() - stat.mtimeMs;
  if (cacheAgeMs < 60000) {
    const cached = fs.readFileSync(cacheFile, 'utf8').trim();
    if (cached) {
      process.stdout.write(cached + '\n');
      // If cache is aging (>20s), trigger background refresh — but don't wait
      if (cacheAgeMs > 20000) {
        const bg = spawn('node', [cslScript], {
          env, stdio: 'ignore', detached: true
        });
        bg.unref();
      }
      process.exit(0);
    }
  }
} catch { /* fall through */ }

// Cache stale (>60s) or missing — must run full CSL synchronously
const child = spawn('node', [cslScript], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code || 0));
