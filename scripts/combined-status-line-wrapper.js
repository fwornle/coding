#!/usr/bin/env node

/**
 * Fast-path wrapper for combined-status-line.js
 * 
 * Reads cached rendered output first (<30s old). Only falls back to full
 * generation when cache is stale. This avoids the 18+s ES module resolution
 * penalty under system load that causes tmux status bar to blank.
 *
 * The cache is keyed per-project so each tmux window gets its own underline.
 * TMUX_PANE_PATH is set by tmux via #{pane_current_path} expansion in .tmux.conf.
 */

import { readFileSync, statSync, existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRepo = process.env.CODING_REPO || join(__dirname, '..');

// Determine which project this tmux window belongs to.
// TMUX_PANE_PATH is expanded per-window by tmux before running this command.
const panePath = process.env.TMUX_PANE_PATH || '';
const paneProject = panePath ? basename(panePath) : '';
const cacheSuffix = paneProject ? `-${paneProject}` : '';
const cacheFile = join(codingRepo, '.logs', `combined-status-line-cache${cacheSuffix}.txt`);

// Fast path: serve from cache if fresh (<30s)
try {
  if (existsSync(cacheFile)) {
    const stat = statSync(cacheFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30000) {
      const cached = readFileSync(cacheFile, 'utf8').trim();
      if (cached) {
        process.stdout.write(cached + '\n');
        process.exit(0);
      }
    }
  }
} catch {
  // Cache read failed — fall through to full generation
}

// Slow path: run full combined-status-line.js
const { spawn } = await import('child_process');
const env = { ...process.env, CODING_REPO: codingRepo };

const child = spawn('node', [join(__dirname, 'combined-status-line.js')], {
  env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});