#!/usr/bin/env node
/**
 * DAG Real-Time Update Debug Script
 *
 * Enhanced test script to debug the DAG modal real-time update issue.
 * This script:
 * 1. Simulates workflow progress updates
 * 2. Verifies the API returns updated data after each change
 * 3. Logs timestamps and refresh keys for debugging
 * 4. Highlights potential issues in the update chain
 *
 * Usage:
 *   node scripts/test-dag-realtime-debug.js [mode] [speed]
 *
 *   mode: simulate (default), verify-only, single-step
 *   speed: fast (1s), medium (3s), slow (5s) - default: medium
 *
 * Example:
 *   node scripts/test-dag-realtime-debug.js
 *   node scripts/test-dag-realtime-debug.js verify-only
 *   node scripts/test-dag-realtime-debug.js single-step fast
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PROGRESS_FILE = path.join(projectRoot, '.data/workflow-progress.json');
const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033';
const API_URL = `http://localhost:${API_PORT}/api/ukb/processes`;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Workflow steps (simplified for testing)
const TEST_STEPS = [
  { name: 'index_codebase', agent: 'code_graph' },
  { name: 'analyze_git_history', agent: 'git_history' },
  { name: 'semantic_analysis', agent: 'semantic_analysis' },
  { name: 'generate_insights', agent: 'insight_generation' },
  { name: 'quality_assurance', agent: 'quality_assurance' },
  { name: 'persist_results', agent: 'persistence' },
];

const SPEED_MAP = {
  fast: 1000,
  medium: 3000,
  slow: 5000
};

function log(message, color = colors.reset) {
  const timestamp = new Date().toISOString().substr(11, 12);
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${message}${colors.reset}`);
}

function logHeader(message) {
  console.log(`\n${colors.bright}${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ${message}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeProgressFile(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
  log(`Wrote progress file`, colors.dim);
}

function readProgressFile() {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
}

async function fetchAPIData() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    log(`API fetch failed: ${error.message}`, colors.red);
    return null;
  }
}

function createInitialProgress() {
  const executionId = `debug-simulation-${Date.now()}`;
  return {
    workflowName: 'debug-analysis',
    executionId,
    status: 'running',
    team: 'coding',
    repositoryPath: projectRoot,
    startTime: new Date().toISOString(),
    currentStep: TEST_STEPS[0].name,
    totalSteps: TEST_STEPS.length,
    completedSteps: 0,
    failedSteps: 0,
    skippedSteps: 0,
    runningSteps: 1,
    stepsCompleted: [],
    stepsFailed: [],
    stepsSkipped: [],
    stepsRunning: [TEST_STEPS[0].name],
    stepsDetail: [],
    summary: {
      totalCommits: 50,
      totalFiles: 100,
      totalSessions: 20,
    },
    lastUpdate: new Date().toISOString(),
    elapsedSeconds: 0
  };
}

function updateProgress(progress, stepIndex, stepDelay) {
  const currentStep = TEST_STEPS[stepIndex];

  // Add step detail
  progress.stepsDetail.push({
    name: currentStep.name,
    status: 'completed',
    duration: stepDelay,
    outputs: { timing: { duration: stepDelay } }
  });

  // Update counters
  progress.stepsCompleted = [...progress.stepsCompleted, currentStep.name];
  progress.completedSteps = progress.stepsCompleted.length;

  // Update running steps
  if (stepIndex + 1 < TEST_STEPS.length) {
    const nextStep = TEST_STEPS[stepIndex + 1];
    progress.currentStep = nextStep.name;
    progress.stepsRunning = [nextStep.name];
    progress.runningSteps = 1;
  } else {
    progress.currentStep = null;
    progress.stepsRunning = [];
    progress.runningSteps = 0;
    progress.status = 'completed';
  }

  progress.lastUpdate = new Date().toISOString();
  progress.elapsedSeconds = Math.floor((Date.now() - new Date(progress.startTime).getTime()) / 1000);

  return progress;
}

async function verifyAPIResponse(expectedCompletedSteps, expectedCurrentStep) {
  const apiData = await fetchAPIData();

  if (!apiData) {
    log(`❌ API returned no data`, colors.red);
    return false;
  }

  const processes = apiData.processes || [];
  const inlineProcess = processes.find(p => p.isInlineMCP || p.pid === 'mcp-inline');

  if (!inlineProcess) {
    log(`❌ No inline MCP process found in API response`, colors.red);
    log(`   Found ${processes.length} processes: ${processes.map(p => p.pid).join(', ')}`, colors.dim);
    return false;
  }

  const refreshKey = inlineProcess._refreshKey || 'none';
  const actualCompleted = inlineProcess.completedSteps;
  const actualCurrent = inlineProcess.currentStep;
  const actualSteps = inlineProcess.steps?.length || 0;

  log(`API Response:`, colors.blue);
  log(`   _refreshKey: ${refreshKey}`, colors.dim);
  log(`   completedSteps: ${actualCompleted} (expected: ${expectedCompletedSteps})`,
      actualCompleted === expectedCompletedSteps ? colors.green : colors.red);
  log(`   currentStep: ${actualCurrent} (expected: ${expectedCurrentStep || 'null'})`,
      actualCurrent === expectedCurrentStep ? colors.green : colors.red);
  log(`   steps array: ${actualSteps} items`, colors.dim);

  if (inlineProcess.steps && inlineProcess.steps.length > 0) {
    const stepStatuses = inlineProcess.steps.map(s => `${s.name.split('_')[0]}:${s.status[0]}`).join(', ');
    log(`   step statuses: ${stepStatuses}`, colors.dim);
  }

  const match = actualCompleted === expectedCompletedSteps && actualCurrent === expectedCurrentStep;
  if (!match) {
    log(`⚠️  API data doesn't match expected state!`, colors.yellow);
  }

  return match;
}

async function runSimulation(speed) {
  const stepDelay = SPEED_MAP[speed] || SPEED_MAP.medium;

  logHeader('DAG Real-Time Update Debug Simulation');
  log(`Steps: ${TEST_STEPS.length}`);
  log(`Speed: ${speed} (${stepDelay}ms per step)`);
  log(`Progress file: ${PROGRESS_FILE}`);
  log(`API URL: ${API_URL}`);
  log(`\n📊 Open the DAG modal in the dashboard and watch for real-time updates\n`);

  // Initial state
  let progress = createInitialProgress();
  writeProgressFile(progress);

  log(`Starting workflow simulation...`, colors.green);
  log(`[0/${TEST_STEPS.length}] ⏳ Running: ${TEST_STEPS[0].name}`, colors.yellow);

  // Wait for initial API sync
  await sleep(500);
  await verifyAPIResponse(0, TEST_STEPS[0].name);

  // Step through workflow
  for (let i = 0; i < TEST_STEPS.length; i++) {
    await sleep(stepDelay);

    progress = updateProgress(progress, i, stepDelay);
    writeProgressFile(progress);

    const step = TEST_STEPS[i];
    log(`[${i + 1}/${TEST_STEPS.length}] ✅ ${step.name} (${step.agent})`, colors.green);

    if (i + 1 < TEST_STEPS.length) {
      log(`  ⏳ Next: ${TEST_STEPS[i + 1].name}`, colors.yellow);
    }

    // Verify API after each step
    await sleep(500); // Give server time to read file
    const expectedCurrent = i + 1 < TEST_STEPS.length ? TEST_STEPS[i + 1].name : null;
    const apiMatch = await verifyAPIResponse(i + 1, expectedCurrent);

    if (!apiMatch) {
      log(`\n⚠️  API state mismatch detected! The dashboard may not be updating.`, colors.yellow);
      log(`   Check if the dashboard is polling and the component is re-rendering.`, colors.dim);
    }
  }

  logHeader('Simulation Complete');
  log(`Total time: ${progress.elapsedSeconds}s`);
  log(`Steps completed: ${progress.completedSteps}/${TEST_STEPS.length}`);

  return progress;
}

async function verifySingleStep() {
  logHeader('Single Step Verification Test');

  // Read current state
  const currentProgress = readProgressFile();
  if (!currentProgress) {
    log(`No progress file found. Run simulation first.`, colors.yellow);
    return;
  }

  log(`Current state from file:`, colors.blue);
  log(`   completedSteps: ${currentProgress.completedSteps}`, colors.dim);
  log(`   currentStep: ${currentProgress.currentStep}`, colors.dim);
  log(`   lastUpdate: ${currentProgress.lastUpdate}`, colors.dim);

  // Fetch API
  log(`\nFetching API data...`, colors.blue);
  await verifyAPIResponse(
    currentProgress.completedSteps,
    currentProgress.currentStep
  );

  // Modify progress and verify API updates
  log(`\nModifying progress file (incrementing completedSteps)...`, colors.yellow);
  currentProgress.completedSteps++;
  currentProgress.lastUpdate = new Date().toISOString();
  writeProgressFile(currentProgress);

  // Wait and verify
  log(`Waiting for API to reflect change...`, colors.dim);
  await sleep(1000);

  await verifyAPIResponse(
    currentProgress.completedSteps,
    currentProgress.currentStep
  );
}

async function verifyOnly() {
  logHeader('API Verification Only');

  log(`Fetching current API state...`, colors.blue);
  const apiData = await fetchAPIData();

  if (!apiData) {
    log(`Failed to fetch API data`, colors.red);
    return;
  }

  log(`Summary:`, colors.green);
  log(`   running: ${apiData.summary?.running || 0}`, colors.dim);
  log(`   total: ${apiData.summary?.total || 0}`, colors.dim);
  log(`   processes: ${apiData.processes?.length || 0}`, colors.dim);

  if (apiData.processes && apiData.processes.length > 0) {
    log(`\nProcesses:`, colors.blue);
    for (const proc of apiData.processes) {
      const icon = proc.status === 'running' ? '🟢' : proc.status === 'completed' ? '✅' : '⚪';
      log(`   ${icon} ${proc.workflowName} (${proc.pid})`, colors.dim);
      log(`      status: ${proc.status}, completedSteps: ${proc.completedSteps}/${proc.totalSteps}`, colors.dim);
      log(`      _refreshKey: ${proc._refreshKey || 'none'}`, colors.dim);
      log(`      currentStep: ${proc.currentStep || 'none'}`, colors.dim);
    }
  }
}

// Main
const args = process.argv.slice(2);
const mode = args[0] || 'simulate';
const speed = args[1] || args[0] || 'medium';

switch (mode) {
  case 'verify-only':
    verifyOnly();
    break;
  case 'single-step':
    verifySingleStep();
    break;
  case 'simulate':
  default:
    if (!['fast', 'medium', 'slow'].includes(mode)) {
      runSimulation(mode).catch(err => {
        log(`Simulation failed: ${err.message}`, colors.red);
        process.exit(1);
      });
    } else {
      runSimulation(speed).catch(err => {
        log(`Simulation failed: ${err.message}`, colors.red);
        process.exit(1);
      });
    }
}
