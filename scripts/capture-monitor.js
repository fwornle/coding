#!/usr/bin/env node

/**
 * Capture Monitor — polls a tmux pipe-pane capture file for prompt detection and hook firing.
 *
 * Extracted from integrations/copi/src/index.ts for shared use across agents.
 *
 * Environment variables:
 *   CAPTURE_FILE        — path to the capture file (required)
 *   AGENT_PROMPT_REGEX  — regex pattern for detecting submitted prompts (required)
 *   CODING_REPO         — path to the coding repository
 *   SESSION_ID          — current agent session ID
 *   COPI_LOG_DIR        — directory for session logs
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const CAPTURE_FILE = process.env.CAPTURE_FILE;
const PROMPT_REGEX_STR = process.env.AGENT_PROMPT_REGEX;
const CODING_REPO = process.env.CODING_REPO;
const SESSION_ID = process.env.SESSION_ID || `capture-${process.pid}`;
const LOG_DIR = process.env.COPI_LOG_DIR || (CODING_REPO ? path.join(CODING_REPO, '.logs', 'capture') : null);

if (!CAPTURE_FILE) {
  process.stderr.write('[capture-monitor] Error: CAPTURE_FILE not set\n');
  process.exit(1);
}

if (!PROMPT_REGEX_STR) {
  process.stderr.write('[capture-monitor] Error: AGENT_PROMPT_REGEX not set\n');
  process.exit(1);
}

// Build the prompt regex from the env string
const PROMPT_REGEX = new RegExp(PROMPT_REGEX_STR, 'g');

// State
let lastCapturePosition = 0;
let inputBuffer = '';
let lastProcessedPrompt = '';
let promptInProgress = false;

// Simple JSON-line logger
const logFile = LOG_DIR ? path.join(LOG_DIR, `session-${SESSION_ID}.log`) : null;

function logEntry(type, data) {
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      sessionId: SESSION_ID,
      data
    };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  } catch { /* non-fatal */ }
}

// Fire hooks via the copilot bridge script
function fireHook(event, context = {}) {
  if (!CODING_REPO) return;

  const bridgePath = path.join(CODING_REPO, 'lib', 'agent-api', 'hooks', 'copilot-bridge.sh');
  if (!fs.existsSync(bridgePath)) return;

  const eventMap = {
    'startup': 'sessionStart',
    'shutdown': 'sessionEnd',
    'prompt': 'userPromptSubmitted',
    'error': 'errorOccurred'
  };
  const nativeEvent = eventMap[event] || event;

  try {
    const child = spawn(bridgePath, [nativeEvent], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, CODING_REPO }
    });
    child.stdin?.write(JSON.stringify(context));
    child.stdin?.end();
    child.unref();
  } catch { /* non-fatal */ }
}

// Process new captured content for prompts
function processCapture(content) {
  inputBuffer += content;

  // Reset regex lastIndex for fresh global search
  PROMPT_REGEX.lastIndex = 0;
  let match;

  while ((match = PROMPT_REGEX.exec(inputBuffer)) !== null) {
    const userInput = match[1]?.trim();
    if (!userInput) continue;

    // Deduplicate
    if (userInput === lastProcessedPrompt) continue;

    // Filter UI noise
    if (userInput.length <= 2 ||
        userInput.startsWith('Type @') ||
        userInput.startsWith('shift+tab') ||
        userInput.includes('⎇') ||
        userInput.includes('GitHub Copilot') ||
        userInput.includes('claude-sonnet')) {
      continue;
    }

    lastProcessedPrompt = userInput;
    handlePrompt(userInput);
  }

  // Keep rolling buffer (last 10000 chars)
  if (inputBuffer.length > 10000) {
    inputBuffer = inputBuffer.slice(-10000);
  }
}

function handlePrompt(prompt) {
  if (promptInProgress) return;
  promptInProgress = true;

  logEntry('USER_INPUT', { input: prompt });
  fireHook('prompt', { prompt, sessionId: SESSION_ID });

  setTimeout(() => { promptInProgress = false; }, 1000);
}

// Poll the capture file every 200ms
const pollInterval = setInterval(() => {
  try {
    if (!fs.existsSync(CAPTURE_FILE)) return;

    const stats = fs.statSync(CAPTURE_FILE);
    if (stats.size <= lastCapturePosition) return;

    const fd = fs.openSync(CAPTURE_FILE, 'r');
    const bufferSize = stats.size - lastCapturePosition;
    const buffer = Buffer.alloc(bufferSize);
    fs.readSync(fd, buffer, 0, bufferSize, lastCapturePosition);
    fs.closeSync(fd);

    lastCapturePosition = stats.size;
    processCapture(buffer.toString('utf-8'));
  } catch { /* silently ignore errors during monitoring */ }
}, 200);

// Fire startup hook
logEntry('STARTUP', { captureFile: CAPTURE_FILE, sessionId: SESSION_ID });
fireHook('startup', { sessionId: SESSION_ID });

// Graceful shutdown
function shutdown() {
  clearInterval(pollInterval);
  logEntry('SHUTDOWN', { sessionId: SESSION_ID });
  fireHook('shutdown', { sessionId: SESSION_ID });
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
