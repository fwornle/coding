#!/usr/bin/env node

/**
 * Seed Step Timing Statistics
 *
 * Parses historical workflow reports to build initial timing statistics
 * for accurate progress estimation and ETA calculation.
 *
 * Usage: node scripts/seed-step-timing-statistics.js
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRoot = join(__dirname, '..');
const reportsDir = join(codingRoot, '.data/workflow-reports');
const outputFile = join(codingRoot, '.data/step-timing-statistics.json');

// Batch steps (1-14) repeat per batch, finalization steps (15+) run once
const BATCH_STEP_COUNT = 14;

// Steps that are part of batch iteration
const BATCH_STEPS = new Set([
  'plan_batches',
  'extract_batch_commits',
  'extract_batch_sessions',
  'batch_semantic_analysis',
  'generate_batch_observations',
  'classify_with_ontology',
  'operator_conv',
  'operator_aggr',
  'operator_embed',
  'operator_dedup',
  'operator_pred',
  'operator_merge',
  'batch_qa',
  'save_batch_checkpoint'
]);

/**
 * Parse a workflow report markdown file
 */
function parseWorkflowReport(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');

    // Extract workflow name
    const workflowMatch = content.match(/\*\*Workflow:\*\*\s+(\S+)/);
    if (!workflowMatch) return null;
    const workflowName = workflowMatch[1];

    // Extract status - only process completed workflows
    const statusMatch = content.match(/\*\*Status:\*\*.*?(COMPLETED|FAILED|completed|failed)/i);
    if (!statusMatch || statusMatch[1].toLowerCase() !== 'completed') return null;

    // Extract total batches
    const batchesMatch = content.match(/Batches Completed\s*\|\s*(\d+)\/(\d+)/);
    const totalBatches = batchesMatch ? parseInt(batchesMatch[2]) : 1;

    // Extract total duration
    const totalDurationMatch = content.match(/^\*\*Duration:\*\*\s+([\d.]+)s/m);
    const totalDurationS = totalDurationMatch ? parseFloat(totalDurationMatch[1]) : 0;

    // Extract step durations
    const stepPattern = /###\s+\d+\.\s+(\w+)\n(?:.*?\n)*?\*\*Duration:\*\*\s+([\d.]+)s/g;
    const steps = {};
    let match;

    while ((match = stepPattern.exec(content)) !== null) {
      const stepName = match[1];
      const durationS = parseFloat(match[2]);
      const durationMs = Math.round(durationS * 1000);

      // Track each step occurrence (some steps may repeat)
      if (!steps[stepName]) {
        steps[stepName] = {
          durations: [],
          isBatchStep: BATCH_STEPS.has(stepName)
        };
      }
      steps[stepName].durations.push(durationMs);
    }

    return {
      workflowName,
      totalBatches,
      totalDurationMs: Math.round(totalDurationS * 1000),
      steps,
      filePath
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Update statistics with a new sample using EMA
 */
function updateStepStats(existing, newDurationMs) {
  const EMA_ALPHA = 0.2; // Weight for new samples

  if (!existing) {
    return {
      avgDurationMs: newDurationMs,
      minDurationMs: newDurationMs,
      maxDurationMs: newDurationMs,
      sampleCount: 1,
      recentDurations: [newDurationMs]
    };
  }

  // Update using EMA for average
  const newAvg = EMA_ALPHA * newDurationMs + (1 - EMA_ALPHA) * existing.avgDurationMs;

  // Update recent durations (keep last 10)
  const recentDurations = [...(existing.recentDurations || []), newDurationMs].slice(-10);

  return {
    avgDurationMs: Math.round(newAvg),
    minDurationMs: Math.min(existing.minDurationMs, newDurationMs),
    maxDurationMs: Math.max(existing.maxDurationMs, newDurationMs),
    sampleCount: existing.sampleCount + 1,
    recentDurations
  };
}

/**
 * Build statistics from parsed reports
 */
function buildStatistics(reports) {
  const statistics = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    workflowTypes: {}
  };

  // Group reports by workflow type
  const byWorkflow = {};
  for (const report of reports) {
    if (!byWorkflow[report.workflowName]) {
      byWorkflow[report.workflowName] = [];
    }
    byWorkflow[report.workflowName].push(report);
  }

  // Process each workflow type
  for (const [workflowName, workflowReports] of Object.entries(byWorkflow)) {
    const workflowStats = {
      sampleCount: workflowReports.length,
      lastSampleDate: new Date().toISOString(),
      steps: {},
      avgBatchDurationMs: 0,
      avgFinalizationDurationMs: 0,
      avgTotalBatches: 0
    };

    // Accumulate batch durations and finalization durations
    let totalBatchDurations = [];
    let totalFinalizationDurations = [];
    let totalBatchCounts = [];

    for (const report of workflowReports) {
      let batchPhaseDuration = 0;
      let finalizationPhaseDuration = 0;

      for (const [stepName, stepData] of Object.entries(report.steps)) {
        // Sum all durations for this step in this report
        const totalStepDuration = stepData.durations.reduce((a, b) => a + b, 0);

        // Update step-level statistics
        const avgPerOccurrence = Math.round(totalStepDuration / stepData.durations.length);
        workflowStats.steps[stepName] = updateStepStats(
          workflowStats.steps[stepName],
          avgPerOccurrence
        );
        workflowStats.steps[stepName].isBatchStep = stepData.isBatchStep;

        // Accumulate phase durations
        if (stepData.isBatchStep) {
          batchPhaseDuration += totalStepDuration;
        } else {
          finalizationPhaseDuration += totalStepDuration;
        }
      }

      // Calculate per-batch duration for this report
      if (report.totalBatches > 0) {
        const perBatchDuration = batchPhaseDuration / report.totalBatches;
        totalBatchDurations.push(perBatchDuration);
        totalBatchCounts.push(report.totalBatches);
      }
      totalFinalizationDurations.push(finalizationPhaseDuration);
    }

    // Calculate averages
    if (totalBatchDurations.length > 0) {
      workflowStats.avgBatchDurationMs = Math.round(
        totalBatchDurations.reduce((a, b) => a + b, 0) / totalBatchDurations.length
      );
    }

    if (totalFinalizationDurations.length > 0) {
      workflowStats.avgFinalizationDurationMs = Math.round(
        totalFinalizationDurations.reduce((a, b) => a + b, 0) / totalFinalizationDurations.length
      );
    }

    if (totalBatchCounts.length > 0) {
      workflowStats.avgTotalBatches = Math.round(
        totalBatchCounts.reduce((a, b) => a + b, 0) / totalBatchCounts.length
      );
    }

    statistics.workflowTypes[workflowName] = workflowStats;
  }

  return statistics;
}

/**
 * Main function
 */
async function main() {
  console.log('Seeding step timing statistics from historical workflow reports...\n');

  if (!existsSync(reportsDir)) {
    console.error(`Reports directory not found: ${reportsDir}`);
    process.exit(1);
  }

  // Find all markdown reports
  const files = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
  console.log(`Found ${files.length} workflow report files\n`);

  // Parse all reports
  const reports = [];
  let parsed = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = join(reportsDir, file);
    const report = parseWorkflowReport(filePath);

    if (report) {
      reports.push(report);
      parsed++;
    } else {
      skipped++;
    }
  }

  console.log(`Parsed: ${parsed}, Skipped: ${skipped}\n`);

  if (reports.length === 0) {
    console.error('No valid reports found!');
    process.exit(1);
  }

  // Build statistics
  const statistics = buildStatistics(reports);

  // Summary
  console.log('Statistics Summary:');
  console.log('===================\n');

  for (const [workflowName, stats] of Object.entries(statistics.workflowTypes)) {
    console.log(`${workflowName}:`);
    console.log(`  Samples: ${stats.sampleCount}`);
    console.log(`  Avg batch duration: ${(stats.avgBatchDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Avg finalization duration: ${(stats.avgFinalizationDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Avg total batches: ${stats.avgTotalBatches}`);
    console.log(`  Steps tracked: ${Object.keys(stats.steps).length}`);
    console.log();
  }

  // Save statistics
  writeFileSync(outputFile, JSON.stringify(statistics, null, 2));
  console.log(`Statistics saved to: ${outputFile}`);
}

main().catch(console.error);
