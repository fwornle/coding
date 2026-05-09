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
// Cache key includes pane_width because every-render content varies (LSL
// counts, time, badge states), and we want each pane to read a freshly-
// rendered cache that matches its own width even when two panes share the
// same project. Without the width suffix, two same-project panes share a
// cache and an older render from a wider pane can leak into a narrower
// pane's display.
const paneWidth = process.env.TMUX_PANE_WIDTH || '';
const cacheSuffix = paneProject
  ? `-${paneProject}${paneWidth ? `-w${paneWidth}` : ''}`
  : '';
const cacheFile = join(codingRepo, '.logs', `combined-status-line-cache${cacheSuffix}.txt`);

// Fast path: serve from cache if fresh (<30s)
try {
  if (existsSync(cacheFile)) {
    const stat = statSync(cacheFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30000) {
      // CRITICAL: do NOT .trim() here — the producer pads to a fixed visual
      // cell count so tmux always renders the same width. Trimming the
      // trailing spaces re-introduces the cell-drift residue that motivated
      // the padding in the first place ("12:411" leftover chars). Strip the
      // line terminator only.
      const cached = readFileSync(cacheFile, 'utf8').replace(/\r?\n$/, '');
      if (cached.trimEnd()) {
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