#!/usr/bin/env node

/**
 * Session State Writer
 *
 * Called from _cleanup_session in launch-agent-common.sh on agent exit.
 * Writes a session-state.json file with agent identity, project context,
 * recent files, and key decisions for cross-agent continuity (D-07, PROF-02).
 *
 * Fail-open: always exits 0, even on errors. Agent exit must never be
 * blocked by session state failures (D-08).
 *
 * Usage: write-session-state.js <agentName> <projectDir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';

try {
  const agentName = process.argv[2] || process.env.CODING_AGENT || 'unknown';
  const projectDir = process.argv[3] || process.env.TARGET_PROJECT_DIR || process.env.CODING_PROJECT_DIR || process.cwd();
  const projectName = basename(projectDir);

  // Gather recent files from git (fail silently)
  let recentFiles = [];
  try {
    const output = execSync('git diff --name-only HEAD~5 2>/dev/null', {
      cwd: projectDir,
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    recentFiles = output
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    // fail-open: no git history is fine
  }

  // Gather key decisions from recent commits (fail silently)
  let keyDecisions = [];
  try {
    const output = execSync('git log --oneline -5 2>/dev/null', {
      cwd: projectDir,
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    keyDecisions = output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // fail-open: no git log is fine
  }

  const sessionState = {
    agent: agentName,
    project: projectName,
    timestamp: new Date().toISOString(),
    summary: `${agentName} session in ${projectName} — ${recentFiles.length} files touched`,
    recent_files: recentFiles,
    key_decisions: keyDecisions,
  };

  const codingDir = `${projectDir}/.coding`;
  mkdirSync(codingDir, { recursive: true });
  writeFileSync(`${codingDir}/session-state.json`, JSON.stringify(sessionState, null, 2), 'utf8');

  process.stderr.write(`[write-session-state] Wrote session state for ${agentName} in ${projectName}\n`);
} catch (err) {
  process.stderr.write(`[write-session-state] Failed (non-fatal): ${err.message}\n`);
}

// Always exit 0 (fail-open per D-08)
process.exit(0);
