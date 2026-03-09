/**
 * Trace History API route handler
 *
 * Serves historical trace files for the history comparison UI.
 * Designed as a route handler module for the Express API server (server.js).
 *
 * GET /api/trace-history       - List available trace summaries
 * GET /api/trace-history?file=X - Return full trace detail for one file
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

// Trace history summary returned in the list endpoint
export interface TraceHistorySummary {
  filename: string
  workflowName: string
  startTime: string
  endTime: string
  status: string
  totalLLMCalls: number
  totalTokens: number
  entityCounts: { produced: number; persisted: number }
}

// Validated filename pattern: alphanumeric, hyphens, underscores, colons, dots + .json
const SAFE_FILENAME = /^[\w\-:.]+\.json$/

/**
 * Resolve the trace history directory.
 * Uses CODING_ROOT env var if available, otherwise resolves relative to cwd.
 */
function getTraceHistoryDir(): string {
  const codingRoot = process.env.CODING_ROOT || process.env.CODING_REPO || resolve(process.cwd(), '../../..')
  return join(codingRoot, '.data', 'trace-history')
}

/**
 * Extract summary fields from a full trace JSON object.
 */
function extractSummary(data: Record<string, unknown>, filename: string): TraceHistorySummary {
  const stepsDetail = (data.stepsDetail || data.steps || []) as Array<Record<string, unknown>>

  let totalLLMCalls = 0
  let totalTokens = 0
  let produced = 0
  let persisted = 0

  for (const step of stepsDetail) {
    totalLLMCalls += (step.llmCalls as number) || 0
    totalTokens += (step.tokensUsed as number) || 0
    const ef = step.entityFlow as Record<string, number> | undefined
    if (ef) {
      produced += ef.produced || 0
      persisted += ef.persisted || 0
    }
  }

  return {
    filename,
    workflowName: (data.workflowName as string) || 'unknown',
    startTime: (data.startTime as string) || '',
    endTime: (data.endTime as string) || '',
    status: (data.status as string) || 'unknown',
    totalLLMCalls,
    totalTokens,
    entityCounts: { produced, persisted },
  }
}

/**
 * Handle GET /api/trace-history
 * Express-compatible request handler.
 */
export function handleTraceHistory(
  req: { query: Record<string, string | undefined> },
  res: {
    json: (body: unknown) => void
    status: (code: number) => { json: (body: unknown) => void }
  }
): void {
  try {
    const traceDir = getTraceHistoryDir()

    if (!existsSync(traceDir)) {
      res.status(404).json({ error: 'No trace history directory found', traces: [] })
      return
    }

    const fileParam = req.query.file

    // Single file detail request
    if (fileParam) {
      if (!SAFE_FILENAME.test(fileParam)) {
        res.status(400).json({ error: 'Invalid filename' })
        return
      }

      const filePath = join(traceDir, fileParam)
      if (!existsSync(filePath)) {
        res.status(404).json({ error: 'Trace file not found' })
        return
      }

      const content = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      res.json(data)
      return
    }

    // List all traces
    const files = readdirSync(traceDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse() // newest first (filenames include timestamps)

    const traces: TraceHistorySummary[] = []
    for (const file of files) {
      try {
        const content = readFileSync(join(traceDir, file), 'utf-8')
        const data = JSON.parse(content)
        traces.push(extractSummary(data, file))
      } catch {
        // Skip malformed files
      }
    }

    res.json({ traces })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
}
