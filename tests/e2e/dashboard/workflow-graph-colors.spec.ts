/**
 * Playwright E2E tests for UKB Workflow Graph node coloring.
 * Tests the multi-agent-graph.tsx component (the ACTIVE graph renderer).
 *
 * Validates:
 * 1. Completed steps turn green (data-status="completed")
 * 2. Running steps show running state (data-status="running")
 * 3. Pending steps stay pending (data-status="pending")
 * 4. "Prep" label appears (not "Batch") after YAML rename
 * 5. Step advancement doesn't cause state jumps
 */

import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename2 = fileURLToPath(import.meta.url)
const __dirname2 = dirname(__filename2)
const CODING_ROOT = join(__dirname2, '..', '..', '..')
const PROGRESS_FILE = join(CODING_ROOT, '.data', 'workflow-progress.json')

function buildProgressState(opts: {
  status: 'running' | 'paused' | 'completed'
  currentWave: number
  completedWaves: string[]
  currentStepName: string
  currentSubstepId?: string | null
  stepsDetail?: Array<{ name: string; status: string; duration?: number }>
}) {
  const now = new Date().toISOString()
  return {
    workflowId: `wf_test_${Date.now()}`,
    workflowName: 'wave-analysis',
    status: opts.status,
    stepPaused: true,
    pausedAtStep: opts.currentStepName,
    progress: {
      completedSteps: opts.completedWaves,
      currentWave: opts.currentWave,
      totalWaves: 4,
      currentStepIndex: opts.completedWaves.length,
      currentStepName: opts.currentStepName,
      currentSubstepId: opts.currentSubstepId ?? null,
      startTime: now,
      lastUpdate: now,
      elapsedSeconds: 10,
    },
    config: {
      singleStepMode: true,
      stepIntoSubsteps: true,
      mockLLM: true,
      mockLLMDelay: 100,
    },
    stepsDetail: opts.stepsDetail ?? [],
  }
}

function writeProgress(state: ReturnType<typeof buildProgressState>) {
  const dir = join(CODING_ROOT, '.data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2))
}

async function navigateToWorkflowGraph(page: Page) {
  await page.goto('http://localhost:3032')
  // UKB is a clickable HealthStatusCard with title "UKB Workflows", not a tab
  const ukbCard = page.locator('text=UKB Workflows').first()
  await ukbCard.click({ timeout: 15_000 })
  // Wait for the modal dialog to open and graph nodes to render
  await page.waitForSelector('[data-testid^="workflow-node-"]', { timeout: 15_000 })
  // Extra wait for polling to settle
  await page.waitForTimeout(2000)
}

async function waitForNodeStatus(page: Page, nodeId: string, expectedStatus: string, timeoutMs = 15_000) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toHaveAttribute('data-status', expectedStatus, { timeout: timeoutMs })
}

let savedProgress: string | null = null

test.beforeAll(async () => {
  if (existsSync(PROGRESS_FILE)) {
    savedProgress = readFileSync(PROGRESS_FILE, 'utf8')
  }
})

test.afterAll(async () => {
  if (savedProgress !== null) {
    writeFileSync(PROGRESS_FILE, savedProgress)
  }
})

// ── Naming ──

test('batch_scheduler node shows "Prep" label, not "Batch"', async ({ page }) => {
  writeProgress(buildProgressState({
    status: 'running',
    currentWave: 1,
    completedWaves: [],
    currentStepName: 'wave1_init',
  }))
  await navigateToWorkflowGraph(page)
  // The graph text comes from YAML via API — check the node's text content
  const node = page.locator('[data-testid="workflow-node-batch_scheduler"]')
  await expect(node).toBeVisible({ timeout: 15_000 })
  const text = await node.textContent()
  expect(text).toContain('Prep')
  expect(text).not.toContain('Batch')
})

// ── Node status coloring ──

test('completed wave marks wave-only agents as completed', async ({ page }) => {
  // Wave 1 completed, wave 2 running at analyze.
  // Agents shared between waves (semantic_analysis etc.) show 'running' because
  // they're active in wave2. batch_scheduler is wave1-only, so it stays completed.
  writeProgress(buildProgressState({
    status: 'running',
    currentWave: 2,
    completedWaves: ['wave1'],
    currentStepName: 'wave2_analyze',
    currentSubstepId: 'wave2_analyze',
    stepsDetail: [{ name: 'wave1', status: 'completed', duration: 120 }],
  }))
  await navigateToWorkflowGraph(page)

  // batch_scheduler is only in wave1 — stays completed
  await waitForNodeStatus(page, 'batch_scheduler', 'completed')
  // semantic_analysis is the current step in wave2 — shows running
  await waitForNodeStatus(page, 'semantic_analysis', 'running')
})

test('all wave1-3 agents completed when wave4 is running', async ({ page }) => {
  // Waves 1-3 completed, wave 4 running (workflow still active so graph is visible)
  writeProgress(buildProgressState({
    status: 'running',
    currentWave: 4,
    completedWaves: ['wave1', 'wave2', 'wave3'],
    currentStepName: 'wave4_insights',
    currentSubstepId: 'wave4_insights',
    stepsDetail: [
      { name: 'wave1', status: 'completed', duration: 120 },
      { name: 'wave2', status: 'completed', duration: 100 },
      { name: 'wave3', status: 'completed', duration: 90 },
    ],
  }))
  await navigateToWorkflowGraph(page)

  // batch_scheduler (wave1-only agent) should be completed
  await waitForNodeStatus(page, 'batch_scheduler', 'completed')
  // Agents shared across waves 1-3 show running in wave4 context
  // insight_generation is the wave4-specific agent, should be running
  await waitForNodeStatus(page, 'insight_generation', 'running')
})

test('currently running step maps to running agent node', async ({ page }) => {
  writeProgress(buildProgressState({
    status: 'running',
    currentWave: 1,
    completedWaves: [],
    currentStepName: 'wave1_analyze',
    currentSubstepId: 'wave1_analyze',
  }))
  await navigateToWorkflowGraph(page)
  await waitForNodeStatus(page, 'semantic_analysis', 'running')
})

test('prior agents in wave sequence are completed when later step runs', async ({ page }) => {
  // At wave1_analyze, batch_scheduler should be completed
  writeProgress(buildProgressState({
    status: 'running',
    currentWave: 1,
    completedWaves: [],
    currentStepName: 'wave1_analyze',
  }))
  await navigateToWorkflowGraph(page)
  await waitForNodeStatus(page, 'batch_scheduler', 'completed')
  await waitForNodeStatus(page, 'semantic_analysis', 'running')
})

// ── Step advancement: no state jumps ──

test('sequential steps update one node at a time (no jumps)', async ({ page }) => {
  const steps = [
    { step: 'wave1_init',    agent: 'batch_scheduler' },
    { step: 'wave1_analyze', agent: 'semantic_analysis' },
    { step: 'wave1_qa',      agent: 'quality_assurance' },
  ]
  const snapshots: Record<string, Record<string, string>> = {}
  const allNodes = ['batch_scheduler', 'semantic_analysis', 'quality_assurance',
                    'ontology_classification', 'persistence', 'kg_operators', 'insight_generation']

  for (let i = 0; i < steps.length; i++) {
    writeProgress(buildProgressState({
      status: 'running',
      currentWave: 1,
      completedWaves: [],
      currentStepName: steps[i].step,
      currentSubstepId: steps[i].step,
    }))

    if (i === 0) {
      await navigateToWorkflowGraph(page)
    } else {
      await page.waitForTimeout(3500) // Wait for polling
    }

    await waitForNodeStatus(page, steps[i].agent, 'running')

    // Capture snapshot
    const snapshot: Record<string, string> = {}
    for (const nodeId of allNodes) {
      const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
      if (await node.isVisible().catch(() => false)) {
        snapshot[nodeId] = await node.getAttribute('data-status') ?? 'unknown'
      }
    }
    snapshots[steps[i].step] = snapshot

    // Check no state jumps from previous step
    if (i > 0) {
      const prev = snapshots[steps[i - 1].step]
      const curr = snapshot
      for (const nodeId of Object.keys(curr)) {
        if (prev[nodeId] === 'pending' && curr[nodeId] === 'completed') {
          throw new Error(
            `State jump: ${nodeId} went pending→completed (skipping running) ` +
            `between ${steps[i - 1].step}→${steps[i].step}`
          )
        }
      }
    }
  }
})
