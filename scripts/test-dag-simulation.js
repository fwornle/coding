#!/usr/bin/env node
/**
 * DAG Workflow Simulation Test Script
 *
 * Simulates a running workflow to test the DAG modal real-time updates.
 * This allows testing that:
 * 1. Each step turns green (completed) in real-time
 * 2. Running steps show with correct animation
 * 3. Step count updates correctly
 * 4. No page refresh needed
 *
 * Usage:
 *   node scripts/test-dag-simulation.js [speed] [workflow]
 *
 *   speed: fast (1s), medium (3s), slow (5s) - default: medium
 *   workflow: complete-analysis, incremental-analysis - default: complete-analysis
 *
 * Example:
 *   node scripts/test-dag-simulation.js fast
 *   node scripts/test-dag-simulation.js slow incremental-analysis
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PROGRESS_FILE = path.join(projectRoot, '.data/workflow-progress.json');

// Complete-analysis workflow steps (15 steps)
const COMPLETE_ANALYSIS_STEPS = [
  { name: 'index_codebase', agent: 'code_graph' },
  { name: 'link_documentation', agent: 'documentation_linker' },
  { name: 'analyze_git_history', agent: 'git_history' },
  { name: 'analyze_vibe_history', agent: 'vibe_history' },
  { name: 'transform_code_entities', agent: 'code_graph' },
  { name: 'semantic_analysis', agent: 'semantic_analysis' },
  { name: 'web_search', agent: 'web_search' },
  { name: 'generate_insights', agent: 'insight_generation' },
  { name: 'generate_observations', agent: 'observation_generation' },
  { name: 'classify_with_ontology', agent: 'ontology_classification' },
  { name: 'analyze_documentation_semantics', agent: 'documentation_semantics' },
  { name: 'quality_assurance', agent: 'quality_assurance' },
  { name: 'persist_results', agent: 'persistence' },
  { name: 'deduplicate_insights', agent: 'deduplication' },
  { name: 'validate_content', agent: 'content_validation' }
];

// Incremental-analysis workflow steps (12 steps)
const INCREMENTAL_ANALYSIS_STEPS = [
  { name: 'analyze_recent_changes', agent: 'git_history' },
  { name: 'analyze_recent_vibes', agent: 'vibe_history' },
  { name: 'index_recent_code', agent: 'code_graph' },
  { name: 'query_code_intelligence', agent: 'code_intelligence' },
  { name: 'transform_doc_links', agent: 'documentation_linker' },
  { name: 'analyze_semantics', agent: 'semantic_analysis' },
  { name: 'generate_pattern_insights', agent: 'insight_generation' },
  { name: 'generate_observations', agent: 'observation_generation' },
  { name: 'classify_with_ontology', agent: 'ontology_classification' },
  { name: 'validate_incremental_qa', agent: 'quality_assurance' },
  { name: 'persist_incremental', agent: 'persistence' },
  { name: 'validate_content_incremental', agent: 'content_validation' }
];

const SPEED_MAP = {
  fast: 1000,
  medium: 3000,
  slow: 5000
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeProgressFile(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

function createInitialProgress(workflowName, steps) {
  const executionId = `${workflowName}-simulation-${Date.now()}`;
  return {
    workflowName,
    executionId,
    status: 'running',
    team: 'coding',
    repositoryPath: projectRoot,
    startTime: new Date().toISOString(),
    currentStep: steps[0].name,
    totalSteps: steps.length,
    completedSteps: 0,
    failedSteps: 0,
    skippedSteps: 0,
    runningSteps: 1,
    stepsCompleted: [],
    stepsFailed: [],
    stepsSkipped: [],
    stepsRunning: [steps[0].name],
    stepsDetail: [],
    summary: {
      totalCommits: 100,
      totalFiles: 500,
      totalSessions: 50,
      totalKeyTopics: 10,
      totalObservations: 0,
      totalInsights: 0,
      totalPatterns: 0,
      keyTopics: [],
      insightsGenerated: [],
      patternsFound: [],
      codeGraphStats: { languages: [] },
      skippedReasons: {}
    },
    lastUpdate: new Date().toISOString(),
    elapsedSeconds: 0
  };
}

function updateProgress(progress, stepIndex, steps, stepDelay) {
  const currentStep = steps[stepIndex];
  const prevCompleted = progress.stepsCompleted;

  // Mark current step as completed
  const stepDetail = {
    name: currentStep.name,
    status: 'completed',
    duration: stepDelay,
    outputs: {
      timing: { duration: stepDelay, timeout: 60 }
    }
  };

  progress.stepsDetail.push(stepDetail);
  progress.stepsCompleted = [...prevCompleted, currentStep.name];
  progress.completedSteps = progress.stepsCompleted.length;

  // Update running steps
  if (stepIndex + 1 < steps.length) {
    const nextStep = steps[stepIndex + 1];
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

async function runSimulation(workflowName, speed) {
  const steps = workflowName === 'incremental-analysis'
    ? INCREMENTAL_ANALYSIS_STEPS
    : COMPLETE_ANALYSIS_STEPS;

  const stepDelay = SPEED_MAP[speed] || SPEED_MAP.medium;

  console.log(`\n🚀 Starting DAG Workflow Simulation`);
  console.log(`   Workflow: ${workflowName}`);
  console.log(`   Steps: ${steps.length}`);
  console.log(`   Speed: ${speed} (${stepDelay}ms per step)`);
  console.log(`   Progress file: ${PROGRESS_FILE}\n`);
  console.log(`📊 Open the DAG modal in the dashboard to watch real-time updates\n`);

  let progress = createInitialProgress(workflowName, steps);
  writeProgressFile(progress);

  console.log(`[0/${steps.length}] Starting workflow...`);
  console.log(`  ⏳ Running: ${steps[0].name}`);

  for (let i = 0; i < steps.length; i++) {
    await sleep(stepDelay);

    progress = updateProgress(progress, i, steps, stepDelay);
    writeProgressFile(progress);

    const step = steps[i];
    console.log(`[${i + 1}/${steps.length}] ✅ ${step.name} (${step.agent})`);

    if (i + 1 < steps.length) {
      console.log(`  ⏳ Running: ${steps[i + 1].name}`);
    }
  }

  console.log(`\n✨ Workflow simulation completed!`);
  console.log(`   Total time: ${progress.elapsedSeconds}s`);
  console.log(`   Steps: ${progress.completedSteps}/${steps.length}`);

  return progress;
}

// Parse command line arguments
const args = process.argv.slice(2);
const speed = ['fast', 'medium', 'slow'].includes(args[0]) ? args[0] : 'medium';
const workflow = args[1] || args[0];
const workflowName = workflow === 'incremental-analysis' ? 'incremental-analysis' : 'complete-analysis';

// Run the simulation
runSimulation(workflowName, speed).catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
