'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { AggregatedSteps } from '@/store/slices/ukbSlice'
import {
  selectAgentLLMMode,
  selectAgentHasOverride,
  selectGlobalLLMMode,
  selectNodeStatus,
  setAgentLLMMode,
  clearAgentLLMOverride,
} from '@/store/slices/ukbSlice'
import type { RootState } from '@/store'
import { Logger, LogCategories } from '@/utils/logging'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Code,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
  ChevronRight,
  Zap,
  Timer,
  Hash,
  RefreshCw,
  Play,
  StopCircle,
  RotateCcw,
  FlaskConical,
  Server,
  Cloud,
} from 'lucide-react'
import type { StepInfo, ProcessInfo } from './types'
import { STEP_TO_AGENT, WORKFLOW_AGENTS } from './constants'

// Utility: Format duration in milliseconds to human readable format
const formatDurationMs = (ms?: number): string => {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
}

// Batch-phase agent IDs used by the sidebar to determine status source
const SIDEBAR_BATCH_PHASE_AGENTS = [
  'git_history', 'vibe_history', 'semantic_analysis',
  'observation_generation', 'ontology_classification',
  'kg_operators',  // All operator_* steps map to this agent
  'quality_assurance', 'batch_checkpoint_manager'
]

function StepResultSummary({ agentId, outputs: rawOutputs, aggregatedSteps, status }: {
  agentId: string;
  outputs: Record<string, any>;
  aggregatedSteps?: AggregatedSteps | null;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused';
}) {
  const outputs = rawOutputs || {}
  const getSummary = (): string | null => {
    // Handle non-completed states with informative messages
    if (status === 'pending') {
      return '⏳ Waiting to run (depends on prior steps completing)'
    }
    if (status === 'running') {
      return '🔄 Currently processing...'
    }
    if (status === 'paused') {
      return '⏸️ Paused in single-step mode (click Step to continue)'
    }
    if (status === 'skipped') {
      return '⏭️ Skipped (not required for this workflow)'
    }
    if (status === 'failed') {
      return '❌ Step failed - check error details above'
    }

    // Check if outputs only contains metadata fields (no actual results)
    const metadataOnlyFields = ['fieldsPresent', 'totalFields', 'result', 'batchId']
    const meaningfulFields = Object.keys(outputs || {}).filter(
      k => !k.startsWith('_') && !metadataOnlyFields.includes(k)
    )

    // If no meaningful data and step hasn't completed, show waiting message
    if (meaningfulFields.length === 0 && status !== 'completed') {
      return '⏳ Results pending...'
    }

    // If completed but only metadata fields, show completion status
    if (meaningfulFields.length === 0 && status === 'completed') {
      return '✅ Step completed (detailed metrics not available)'
    }

    // For historical workflows, prefer aggregated totals across all batches
    // This provides accurate "final" numbers rather than just batch-001 data
    if (aggregatedSteps) {
      switch (agentId) {
        case 'git_history':
          if (aggregatedSteps.git_history) {
            const { totalCommits, batchesProcessed } = aggregatedSteps.git_history
            return `📊 Total: ${totalCommits.toLocaleString()} commits (across ${batchesProcessed} batches)`
          }
          break
        case 'vibe_history':
          if (aggregatedSteps.vibe_history) {
            const { totalSessions, batchesWithSessions, batchesProcessed } = aggregatedSteps.vibe_history
            const sessionInfo = batchesWithSessions < batchesProcessed
              ? ` (${batchesWithSessions}/${batchesProcessed} batches had sessions)`
              : ` (across ${batchesProcessed} batches)`
            return `📊 Total: ${totalSessions.toLocaleString()} sessions${sessionInfo}`
          }
          break
        case 'semantic_analysis':
          if (aggregatedSteps.semantic_analysis) {
            const { totalEntities, totalRelations, batchesProcessed } = aggregatedSteps.semantic_analysis
            return `📊 Total: ${totalEntities.toLocaleString()} entities, ${totalRelations.toLocaleString()} relations (across ${batchesProcessed} batches)`
          }
          break
        case 'kg_operators':
          if (aggregatedSteps.kg_operators) {
            const { totalProcessed, totalMerged, totalEdgesAdded, totalEmbedded, totalCoreEntities, batchesProcessed } = aggregatedSteps.kg_operators
            const parts = []
            if (totalProcessed > 0) parts.push(`${totalProcessed.toLocaleString()} converted`)
            if (totalEmbedded > 0) parts.push(`${totalEmbedded.toLocaleString()} embedded`)
            if (totalMerged > 0) parts.push(`${totalMerged.toLocaleString()} deduped`)
            if (totalEdgesAdded > 0) parts.push(`${totalEdgesAdded.toLocaleString()} edges predicted`)
            const summary = parts.length > 0 ? parts.join(', ') : 'pipeline completed'
            return `📊 Tree-KG: ${summary} (${batchesProcessed} batches)`
          }
          break
        case 'deduplication':
          if (aggregatedSteps.kg_operators) {
            const { totalMerged } = aggregatedSteps.kg_operators
            return `📊 Total: ${totalMerged.toLocaleString()} duplicate entities merged`
          }
          break
        case 'quality_assurance':
          if (aggregatedSteps.kg_operators) {
            const { totalProcessed, batchesProcessed } = aggregatedSteps.kg_operators
            return `📊 QA validated ${totalProcessed.toLocaleString()} entities across ${batchesProcessed} batches`
          }
          break
        case 'persistence':
          if (aggregatedSteps.kg_operators) {
            const { totalProcessed, totalEdgesAdded } = aggregatedSteps.kg_operators
            return `📊 Total: ${totalProcessed.toLocaleString()} entities, ${totalEdgesAdded.toLocaleString()} edges persisted`
          }
          break
        case 'content_validation':
          if (aggregatedSteps.content_validation) {
            const { entitiesValidated, relationsValidated } = aggregatedSteps.content_validation
            return `📊 Validated ${entitiesValidated} entities and ${relationsValidated} relations against codebase`
          }
          break
      }
    }

    // Per-step outputs (for active workflows or if no aggregated data)
    switch (agentId) {
      case 'git_history':
        // Check all possible property names: commitsCount (coordinator summary), commitsAnalyzed (agent), commits array
        const commits = outputs.commitsCount || outputs.commitsAnalyzed || outputs.commits?.length || 0
        const files = outputs.filesCount || outputs.filesAnalyzed || outputs.files?.length || 0
        return `Analyzed ${commits} commits affecting ${files} files`

      case 'vibe_history':
        // Check all possible property names: sessionsCount (coordinator summary), sessionsAnalyzed (agent), sessions array
        const sessions = outputs.sessionsCount || outputs.sessionsAnalyzed || outputs.sessions?.length || 0
        // LLM-extracted task/solution pairs (new semantic analysis)
        const taskSolutions = outputs.problemSolutionPairsCount || outputs.problemSolutionPairs?.length || 0
        // LLM-extracted key topics (semantic analysis)
        const keyTopics = outputs.keyTopicsCount || outputs.keyTopics?.length || 0
        // Build result string with both metrics
        const vibeParts = [`Processed ${sessions} sessions`]
        if (taskSolutions > 0) vibeParts.push(`${taskSolutions} task/solutions`)
        if (keyTopics > 0) vibeParts.push(`${keyTopics} key topics`)
        if (taskSolutions === 0 && keyTopics === 0 && sessions > 0) vibeParts.push('analyzing...')
        return vibeParts.join(', ')

      case 'semantic_analysis':
        // Check for LLM error first - show actual error message instead of just "llmUsed: false"
        if (outputs.llmError) {
          const truncatedError = outputs.llmError.length > 80
            ? outputs.llmError.slice(0, 80) + '...'
            : outputs.llmError
          return `⚠️ LLM Error: ${truncatedError}`
        }

        // Check for batch workflow format (from summarizeStepResult): { batchEntities, batchRelations, batchId }
        const batchEntities = outputs.batchEntities || outputs.result?.entities || 0
        const batchRelations = outputs.batchRelations || outputs.result?.relations || 0
        if (batchEntities > 0 || batchRelations > 0) {
          return `Processed ${batchEntities} entities, ${batchRelations} relations`
        }

        // Legacy format checks
        const keyPatterns = outputs.keyPatternsCount || outputs.patternsFound || outputs.patterns?.length || 0
        const learnings = outputs.learningsCount || 0
        const archDecisions = outputs.architecturalDecisionsCount || 0
        const semConfidence = outputs.confidence ? `${Math.round(outputs.confidence * 100)}%` : ''
        const filesAnalyzed = outputs.filesAnalyzed || 0
        const totalSemantic = keyPatterns + learnings + archDecisions
        if (totalSemantic > 0) {
          const confStr = semConfidence ? ` (${semConfidence} confidence)` : ''
          return `Found ${keyPatterns} patterns, ${learnings} learnings, ${archDecisions} arch decisions${confStr}`
        }
        if (filesAnalyzed > 0) {
          return `Semantic analysis completed (${filesAnalyzed} files analyzed)`
        }
        // No meaningful data - will be handled by metadata check in getSummary
        return null

      case 'insight_generation':
        // Check all possible pattern count fields: totalPatterns (number), patterns (array), patternsGenerated
        const patternCount = outputs.totalPatterns || outputs.patterns?.length || outputs.patternsGenerated || 0
        // Check all possible insight count fields: totalInsights (number), insightDocuments (array)
        const insightCount = outputs.totalInsights || outputs.insightDocuments?.length || 0
        const diagrams = outputs.diagramsGenerated || outputs.diagrams?.length || 0
        return `Generated ${insightCount} insights from ${patternCount} patterns and ${diagrams} diagrams`

      case 'observation_generation':
        // Check all possible property names: entitiesCount (summary), entitiesCreated (agent)
        const entities = outputs.entitiesCount || outputs.entitiesCreated || outputs.entities?.length || 0
        // Check all possible property names: observationsCount (summary), observationsCreated (agent)
        const observations = outputs.observationsCount || outputs.observationsCreated || outputs.totalObservations || 0
        const filtered = outputs.filteredBySemanticValue || 0
        return filtered > 0
          ? `Created ${entities} entities (${filtered} low-value removed), ${observations} observations`
          : `Created ${entities} entities with ${observations} observations`

      case 'kg_operators':
        // Tree-KG operators: conv, aggr, embed, dedup, pred, merge
        const kgConv = outputs.conv?.processed || outputs.entitiesProcessed || 0
        const kgEmbed = outputs.embed?.embedded || outputs.entitiesEmbedded || 0
        const kgDedup = outputs.dedup?.merged || outputs.mergedCount || 0
        const kgPred = outputs.pred?.edgesAdded || outputs.edgesAdded || 0
        const kgMerge = outputs.merge?.entitiesAdded || outputs.entitiesAdded || 0
        const kgParts = []
        if (kgConv > 0) kgParts.push(`${kgConv} converted`)
        if (kgEmbed > 0) kgParts.push(`${kgEmbed} embedded`)
        if (kgDedup > 0) kgParts.push(`${kgDedup} deduped`)
        if (kgPred > 0) kgParts.push(`${kgPred} edges`)
        if (kgMerge > 0) kgParts.push(`${kgMerge} merged`)
        return kgParts.length > 0
          ? `Tree-KG ops: ${kgParts.join(', ')}`
          : `Tree-KG pipeline completed`

      case 'quality_assurance':
        // Check for batch workflow format (from summarizeStepResult): { validated, entitiesCreated, relationsAdded, ... }
        if (outputs.validated !== undefined) {
          const entities = outputs.entitiesCreated || 0
          const relations = outputs.relationsAdded || 0
          const commits = outputs.commitsProcessed || 0
          const sessions = outputs.sessionsProcessed || 0
          const parts = []
          if (commits > 0) parts.push(`${commits} commits`)
          if (sessions > 0) parts.push(`${sessions} sessions`)
          if (entities > 0) parts.push(`${entities} entities`)
          if (relations > 0) parts.push(`${relations} relations`)
          const status = outputs.validated ? '✅ Validated' : '⚠️ Validation issues'
          return parts.length > 0 ? `${status}: ${parts.join(', ')}` : status
        }

        // Legacy format
        const passed = outputs.passed || outputs.validationsPassed || 0
        const failed = outputs.failed || outputs.validationsFailed || 0
        const qaIterations = outputs.qaIterations || 1
        if (passed > 0 || failed > 0) {
          return qaIterations > 1
            ? `QA: ${passed} passed, ${failed} failed (after ${qaIterations} iterations)`
            : `QA: ${passed} passed, ${failed} failed`
        }
        // No meaningful data
        return null

      case 'persistence':
        const persisted = outputs.entitiesPersisted || outputs.entities?.length || 0
        const updated = outputs.entitiesUpdated || 0
        return `Persisted ${persisted} entities, updated ${updated}`

      case 'deduplication':
        const duplicates = outputs.duplicatesFound || outputs.duplicates?.length || 0
        const merged = outputs.entitiesMerged || 0
        return `Found ${duplicates} duplicates, merged ${merged} entities`

      case 'code_graph':
        // Check for codeGraphStats first - this has the actual Memgraph data
        const codeGraphStats = outputs.codeGraphStats || {}
        const graphTotalEntities = codeGraphStats.totalEntities || 0
        const graphTotalRelationships = codeGraphStats.totalRelationships || 0
        const graphFunctions = codeGraphStats.entityTypeDistribution?.function || 0
        const graphClasses = codeGraphStats.entityTypeDistribution?.class || 0
        const graphMethods = codeGraphStats.entityTypeDistribution?.method || 0

        // If we have valid codeGraphStats, show those (even if there's a "using existing" warning)
        if (graphTotalEntities > 0) {
          const usedExisting = outputs.warning?.includes('existing') || outputs.warning?.includes('no re-indexing')
          const prefix = usedExisting ? '📊 ' : ''
          const suffix = usedExisting ? ' (cached)' : ''
          return `${prefix}${graphTotalEntities.toLocaleString()} entities (${graphFunctions.toLocaleString()} functions, ${graphClasses.toLocaleString()} classes), ${graphTotalRelationships.toLocaleString()} relationships${suffix}`
        }

        // Check for actual failure/skip conditions
        if (outputs.skipped || outputs.skipReason) {
          const reason = outputs.skipReason || outputs.warning || 'Unknown reason'
          const shortReason = reason.includes('code 143') ? 'Timeout (SIGTERM)' :
                              reason.includes('failed') ? 'Indexing failed' :
                              reason.slice(0, 50) + (reason.length > 50 ? '...' : '')
          return `⚠️ Skipped: ${shortReason}`
        }
        // Check for incremental mode (used existing data)
        if (outputs.incrementalMode && !outputs.reindexed) {
          const existingNodes = outputs.statistics?.totalEntities || 0
          const changedFiles = outputs.changedFilesCount || 0
          if (changedFiles > 0) {
            return `📊 Used existing graph (${existingNodes} nodes), ${changedFiles} files changed`
          }
          return `📊 Used existing graph (${existingNodes} nodes), no changes detected`
        }
        // Code graph indexing results from code-graph-rag
        const functions = outputs.functionsIndexed || outputs.functions?.length || outputs.nodeStats?.functions || outputs.statistics?.entityTypeDistribution?.Function || 0
        const classes = outputs.classesIndexed || outputs.classes?.length || outputs.nodeStats?.classes || outputs.statistics?.entityTypeDistribution?.Class || 0
        const modules = outputs.modulesIndexed || outputs.modules?.length || outputs.nodeStats?.modules || outputs.statistics?.entityTypeDistribution?.Module || 0
        const relationships = outputs.relationshipsIndexed || outputs.relationships?.length || outputs.edgeStats?.total || outputs.statistics?.totalRelationships || 0
        const totalNodes = outputs.totalNodesIndexed || outputs.nodesCreated || outputs.totalNodes || outputs.statistics?.totalEntities || (functions + classes + modules)
        if (totalNodes > 0 || functions > 0 || classes > 0) {
          const reindexNote = outputs.reindexed ? ' (re-indexed)' : ''
          return `Indexed ${totalNodes} nodes (${functions} functions, ${classes} classes), ${relationships} relationships${reindexNote}`
        }
        // Fallback for incremental indexing
        const filesScanned = outputs.filesScanned || outputs.filesProcessed || 0
        if (filesScanned > 0) {
          return `Scanned ${filesScanned} files for code graph updates`
        }
        return `Code graph indexing completed`

      case 'code_intelligence':
        const queriesGenerated = outputs.queriesGenerated || outputs.queries?.length || 0
        const patternsDiscovered = outputs.patternsDiscovered || outputs.patterns?.length || 0
        const hotspots = outputs.hotspots?.length || 0
        if (queriesGenerated > 0 || patternsDiscovered > 0) {
          return `Generated ${queriesGenerated} queries, discovered ${patternsDiscovered} patterns${hotspots > 0 ? `, ${hotspots} hotspots` : ''}`
        }
        return `Code intelligence analysis completed`

      case 'documentation_linker':
        const totalDocs = outputs.totalDocuments || outputs.documentsCount || outputs.documents?.length || 0
        const totalLinks = outputs.totalLinks || outputs.linksCount || outputs.documentsLinked || 0
        const unresolvedRefs = outputs.unresolvedReferences || 0
        if (totalDocs > 0 || totalLinks > 0) {
          const unresolvedStr = unresolvedRefs > 0 ? ` (${unresolvedRefs} unresolved)` : ''
          return `Found ${totalDocs} documents with ${totalLinks} code references${unresolvedStr}`
        }
        return `Documentation analysis completed`

      case 'documentation_semantics':
        const docstringsAnalyzed = outputs.docstringsAnalyzed || outputs.docstrings?.length || 0
        const semanticEntities = outputs.entitiesEnriched || outputs.entities?.length || 0
        return `Analyzed ${docstringsAnalyzed} docstrings, enriched ${semanticEntities} entities`

      case 'ontology_classification':
        // Handle both number (new format) and array (legacy format) for classified count
        const entitiesClassified = outputs.entitiesClassified ||
          (typeof outputs.classified === 'number' ? outputs.classified : outputs.classified?.length) || 0
        const avgConfidence = outputs.averageConfidence ? `${(outputs.averageConfidence * 100).toFixed(0)}%` : ''
        const classesUsed = outputs.ontologyClassesUsed || 0
        return avgConfidence
          ? `Classified ${entitiesClassified} entities (${avgConfidence} avg confidence) into ${classesUsed} classes`
          : `Classified ${entitiesClassified} entities into ontology taxonomy`

      case 'web_search':
        const searchesPerformed = outputs.searchesPerformed || outputs.searches?.length || 0
        const resultsFound = outputs.resultsFound || outputs.results?.length || 0
        return `Performed ${searchesPerformed} searches, found ${resultsFound} relevant results`

      case 'content_validation':
        const entitiesValidated = outputs.entitiesValidated || outputs.validated?.length || 0
        const staleDetected = outputs.staleEntitiesDetected || outputs.stale?.length || 0
        const refreshed = outputs.entitiesRefreshed || 0
        return staleDetected > 0
          ? `Validated ${entitiesValidated} entities, detected ${staleDetected} stale (${refreshed} refreshed)`
          : `Validated ${entitiesValidated} entities against current codebase`

      default:
        return null
    }
  }

  const summary = getSummary()
  if (!summary) return null

  return (
    <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 text-blue-800">
      {summary}
    </div>
  )
}

/**
 * Expandable details view for step outputs.
 * Shows arrays with expandable item lists and handles nested objects.
 */
function StepResultDetails({ outputs: rawOutputs }: { outputs: Record<string, any> }) {
  const outputs = rawOutputs || {}
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())

  const toggleExpand = (key: string) => {
    const newExpanded = new Set(expandedKeys)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    setExpandedKeys(newExpanded)
  }

  const renderValue = (key: string, value: any, depth: number = 0): React.ReactNode => {
    // For nested keys like "parent.child.grandchild", display only the last part
    const displayKey = key.includes('.') ? key.split('.').pop()! : key
    // Format key: commitsAnalyzed -> Commits Analyzed
    const formattedKey = displayKey
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim()

    if (typeof value === 'number') {
      return (
        <div key={key} className="flex justify-between items-center">
          <span className="text-muted-foreground">{formattedKey}</span>
          <span className="font-medium tabular-nums">{value.toLocaleString()}</span>
        </div>
      )
    }

    if (typeof value === 'boolean') {
      return (
        <div key={key} className="flex justify-between items-center">
          <span className="text-muted-foreground">{formattedKey}</span>
          <span className={value ? 'text-green-600' : 'text-red-600'}>{value ? 'Yes' : 'No'}</span>
        </div>
      )
    }

    if (typeof value === 'string') {
      if (value.length > 60) {
        const isExpanded = expandedKeys.has(key)
        return (
          <div key={key} className="space-y-1">
            <div
              className="flex justify-between items-center cursor-pointer hover:bg-slate-100 rounded px-1"
              onClick={() => toggleExpand(key)}
            >
              <span className="text-muted-foreground">{formattedKey}</span>
              <ChevronRight className={`h-3 w-3 text-blue-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            {isExpanded && (
              <div className="text-xs bg-slate-100 rounded p-2 break-words ml-2">
                {value}
              </div>
            )}
          </div>
        )
      }
      return (
        <div key={key} className="flex justify-between items-center">
          <span className="text-muted-foreground">{formattedKey}</span>
          <span className="font-medium">{value}</span>
        </div>
      )
    }

    if (Array.isArray(value)) {
      const isExpanded = expandedKeys.has(key)
      const displayItems = value.slice(0, 10)  // Show up to 10 items when expanded

      return (
        <div key={key} className="space-y-1">
          <div
            className="flex justify-between items-center cursor-pointer hover:bg-slate-100 rounded px-1"
            onClick={() => toggleExpand(key)}
          >
            <span className="text-muted-foreground">{formattedKey}</span>
            <span className="font-medium tabular-nums flex items-center gap-1">
              {value.length} items
              <ChevronRight className={`h-3 w-3 text-blue-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </span>
          </div>
          {isExpanded && (
            <div className="text-xs bg-slate-100 rounded p-2 ml-2 space-y-1 max-h-40 overflow-y-auto">
              {displayItems.map((item, idx) => {
                if (typeof item === 'object' && item !== null) {
                  // For objects, show name or first property
                  const displayText = item.name || item.pattern || item.entityName ||
                    Object.values(item)[0] || JSON.stringify(item).slice(0, 50)
                  return (
                    <div key={idx} className="flex items-center gap-1 text-slate-700">
                      <span className="text-slate-400">{idx + 1}.</span>
                      <span className="truncate">{String(displayText)}</span>
                    </div>
                  )
                }
                return (
                  <div key={idx} className="flex items-center gap-1 text-slate-700">
                    <span className="text-slate-400">{idx + 1}.</span>
                    <span className="truncate">{String(item)}</span>
                  </div>
                )
              })}
              {value.length > 10 && (
                <div className="text-slate-400 italic">...and {value.length - 10} more</div>
              )}
            </div>
          )}
        </div>
      )
    }

    if (typeof value === 'object' && value !== null) {
      const isExpanded = expandedKeys.has(key)
      const entries = Object.entries(value).filter(([k]) => !k.startsWith('_'))

      return (
        <div key={key} className="space-y-1">
          <div
            className="flex justify-between items-center cursor-pointer hover:bg-slate-100 rounded px-1"
            onClick={() => toggleExpand(key)}
          >
            <span className="text-muted-foreground">{formattedKey}</span>
            <span className="font-medium tabular-nums flex items-center gap-1">
              {entries.length} props
              <ChevronRight className={`h-3 w-3 text-blue-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </span>
          </div>
          {isExpanded && (
            <div className="text-xs bg-slate-100 rounded p-2 ml-2 space-y-1">
              {entries.slice(0, 8).map(([k, v]) => {
                const nestedKey = `${key}.${k}`
                return renderValue(nestedKey, v, depth + 1)
              })}
            </div>
          )}
        </div>
      )
    }

    return (
      <div key={key} className="flex justify-between items-center">
        <span className="text-muted-foreground">{formattedKey}</span>
        <span className="font-medium">{String(value)}</span>
      </div>
    )
  }

  // Smart filtering: hide misleading top-level keys when better nested data exists
  const entries = Object.entries(outputs).filter(([key, value]) => {
    // Always hide underscore-prefixed internal keys
    if (key.startsWith('_')) return false

    // Hide 'entitiesCount' if codeGraphStats has actual entity data
    // (entitiesCount: 0 is misleading when codeGraphStats.totalEntities > 0)
    if (key === 'entitiesCount' && outputs.codeGraphStats?.totalEntities > 0) {
      return false
    }

    // Hide empty codeGraphStats objects (they add no value)
    if (key === 'codeGraphStats' && typeof value === 'object' && value !== null) {
      const stats = value as Record<string, any>
      if (Object.keys(stats).length === 0 || stats.totalEntities === 0) {
        return false
      }
    }

    return true
  })

  return (
    <div className="text-xs bg-slate-50 border rounded p-2 space-y-1.5">
      {entries.slice(0, 12).map(([key, value]) => renderValue(key, value))}
      {entries.length > 12 && (
        <div className="text-muted-foreground italic pt-1">
          ...and {entries.length - 12} more properties
        </div>
      )}
    </div>
  )
}

function OrchestratorDetailsSidebar({
  process,
  onClose,
  edges,
  agents
}: {
  process: ProcessInfo
  onClose: () => void
  edges: Array<{ from: string; to: string; type?: string; label?: string }>
  agents: typeof WORKFLOW_AGENTS
}) {
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelResult, setCancelResult] = useState<{ success: boolean; message: string } | null>(null)

  // Log when orchestrator sidebar is displayed
  useEffect(() => {
    Logger.info(LogCategories.AGENT, 'Orchestrator sidebar opened', {
      workflowName: process.workflowName,
      status: process.status,
      health: (process as any).health,
      completedSteps: process.completedSteps,
      totalSteps: process.totalSteps,
      batchProgress: (process as any).batchProgress,
      stepsCount: process.steps?.length || 0,
      runningSteps: process.steps?.filter(s => s.status === 'running').length || 0,
      failedSteps: process.steps?.filter(s => s.status === 'failed').length || 0,
    })
  }, [process])

  const handleCancelWorkflow = async (killProcesses: boolean = false) => {
    Logger.info(LogCategories.AGENT, 'Cancel workflow requested', {
      workflowName: process.workflowName,
      killProcesses,
      currentStatus: process.status,
    })
    setIsCancelling(true)
    setCancelResult(null)
    try {
      const apiPort = 3033
      const response = await fetch(`http://localhost:${apiPort}/api/ukb/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ killProcesses })
      })

      const data = await response.json()

      if (data.status === 'success') {
        Logger.info(LogCategories.AGENT, 'Workflow cancelled successfully', {
          previousWorkflow: data.data.previousWorkflow,
          previousStatus: data.data.previousStatus,
        })
        setCancelResult({
          success: true,
          message: `Cancelled ${data.data.previousWorkflow || 'workflow'} (was ${data.data.previousStatus})`
        })
        // Refresh the page after a short delay to show updated state
        setTimeout(() => window.location.reload(), 1500)
      } else {
        Logger.warn(LogCategories.AGENT, 'Workflow cancel failed', { message: data.message })
        setCancelResult({ success: false, message: data.message || 'Failed to cancel' })
      }
    } catch (error) {
      Logger.error(LogCategories.AGENT, 'Workflow cancel error', { error })
      setCancelResult({ success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown'}` })
    } finally {
      setIsCancelling(false)
    }
  }

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-500">Running</Badge>
      case 'paused':
        return <Badge className="bg-amber-500 animate-pulse">Paused</Badge>
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      default:
        return <Badge variant="outline">Pending</Badge>
    }
  }

  // Calculate progress based on actual work distribution:
  // - Batch phase (initialization + batch steps, running N times) = ~85% of total work
  // - Finalization phase (remaining steps, running once) = ~15% of total work
  // Derive batch step count from workflow config instead of hardcoding
  const BATCH_STEP_COUNT = process.batchPhaseStepCount || 14
  const BATCH_WEIGHT = 0.85    // Batch phase is ~85% of total work

  const progressPercent = useMemo(() => {
    if (process.totalSteps === 0) return 0

    const batchProgress = (process as any).batchProgress
    // During batch phase: use batch progress as primary indicator
    if (batchProgress && batchProgress.totalBatches > 0) {
      const batchPhaseProgress = (batchProgress.currentBatch / batchProgress.totalBatches) * BATCH_WEIGHT
      return Math.round(batchPhaseProgress * 100)
    }

    // In finalization phase (after all batches): batch phase done + finalization progress
    if (process.completedSteps > BATCH_STEP_COUNT) {
      const finalizationSteps = process.completedSteps - BATCH_STEP_COUNT
      const totalFinalizationSteps = process.totalSteps - BATCH_STEP_COUNT
      const finalizationProgress = totalFinalizationSteps > 0
        ? (finalizationSteps / totalFinalizationSteps) * (1 - BATCH_WEIGHT)
        : 0
      return Math.round((BATCH_WEIGHT + finalizationProgress) * 100)
    }

    // Fallback for non-batch workflows or early stages
    return Math.round((process.completedSteps / process.totalSteps) * 100)
  }, [process.completedSteps, process.totalSteps, (process as any).batchProgress])

  // Calculate total duration from steps
  const totalDuration = process.steps?.reduce((acc, step) => acc + (step.duration || 0), 0) || 0

  // Group steps by status
  const completedSteps = process.steps?.filter(s => s.status === 'completed') || []
  const failedSteps = process.steps?.filter(s => s.status === 'failed') || []
  const runningSteps = process.steps?.filter(s => s.status === 'running') || []
  const pendingSteps = process.steps?.filter(s => s.status === 'pending') || []
  const skippedSteps = process.steps?.filter(s => s.status === 'skipped') || []

  // Determine if workflow can be cancelled - any active workflow can be cancelled
  const health = (process as any).health
  const canCancel = process.status === 'running' || process.status === 'pending' || health === 'stale' || health === 'frozen'
  const isFrozenOrStale = health === 'stale' || health === 'frozen'

  const batchProgress = (process as any).batchProgress
  const batchIterations = (process as any).batchIterations

  return (
    <Card className="w-80 h-full overflow-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            <CardTitle className="text-lg">Wave Controller</CardTitle>
          </div>
          {getStatusBadge(process.status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-sm text-muted-foreground mb-2">
            Multi-agent workflow coordinator. Manages parallel execution with max 3 concurrent steps,
            handles dependencies, retries failed steps, and aggregates results.
          </div>
        </div>

        <Separator />

        {/* Workflow Info */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Workflow Details</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{process.workflowName || 'Unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Team</span>
              <span>{(process as any).team || 'Unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Repository</span>
              <span className="text-xs truncate max-w-[180px]" title={(process as any).repositoryPath}>
                {(process as any).repositoryPath?.split('/').slice(-2).join('/') || 'Unknown'}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Progress */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Progress</h4>
          <div className="space-y-2">
            <Progress value={progressPercent} className="h-2" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Steps</span>
              <span className="font-medium">{process.completedSteps} / {process.totalSteps}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            {batchProgress && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Batch</span>
                <span className="font-medium text-blue-600">
                  {batchProgress.currentBatch} / {batchProgress.totalBatches}
                </span>
              </div>
            )}
            {totalDuration > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  Total Duration
                </span>
                <span>{(totalDuration / 1000).toFixed(1)}s</span>
              </div>
            )}
            {process.currentStep && runningSteps.length <= 1 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Step</span>
                <span className="text-blue-600 font-medium text-xs">{process.currentStep}</span>
              </div>
            )}
          </div>
        </div>

        {/* Kill Workflow Button - shown when workflow is running, stale, or frozen */}
        {canCancel && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium text-sm text-red-600 flex items-center gap-1">
                <StopCircle className="h-4 w-4" />
                Workflow Control
              </h4>
              <div className="space-y-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => handleCancelWorkflow(false)}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <StopCircle className="h-4 w-4 mr-2" />
                      Kill Workflow
                    </>
                  )}
                </Button>
                {isFrozenOrStale && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => handleCancelWorkflow(true)}
                    disabled={isCancelling}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Kill + Cleanup Processes
                  </Button>
                )}
                {cancelResult && (
                  <div className={`text-xs p-2 rounded ${cancelResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {cancelResult.message}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {isFrozenOrStale
                    ? 'Workflow appears frozen/stale. Kill to reset state and optionally cleanup processes.'
                    : 'Cancel the running workflow and reset state.'}
                </p>
              </div>
            </div>
          </>
        )}

        {/* Active Steps - Parallel Execution */}
        {runningSteps.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                  Active Steps {runningSteps.length > 1 && <Badge variant="secondary" className="text-[10px] ml-1">{runningSteps.length} parallel</Badge>}
                </h4>
              </div>
              <div className="space-y-2">
                {runningSteps.map((step: any) => {
                  const agentDef = agents.find(a =>
                    a.id === step.name.replace('analyze_', '').replace('_history', '_history').replace('index_', '').replace('link_', '') ||
                    step.name.includes(a.id.replace('_', ''))
                  )
                  const AgentIcon = agentDef?.icon || Code
                  return (
                    <div key={step.name} className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                      <AgentIcon className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                      <span className="font-medium text-blue-800 truncate">{step.name}</span>
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500 ml-auto flex-shrink-0" />
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Step Status Summary */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Step Status Summary</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>Completed: {completedSteps.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span>Running: {runningSteps.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span>Failed: {failedSteps.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-300" />
              <span>Pending: {pendingSteps.length}</span>
            </div>
            {skippedSteps.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <span>Skipped: {skippedSteps.length}</span>
              </div>
            )}
          </div>
        </div>

        {/* Executed Steps List */}
        {process.steps && process.steps.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium text-sm">All Steps</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {process.steps.map((step, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between text-xs p-1.5 rounded ${
                      step.status === 'completed' ? 'bg-green-50' :
                      step.status === 'failed' ? 'bg-red-50' :
                      step.status === 'running' ? 'bg-blue-50' :
                      step.status === 'skipped' ? 'bg-yellow-50' :
                      'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {step.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-green-600" />}
                      {step.status === 'failed' && <XCircle className="h-3 w-3 text-red-600" />}
                      {step.status === 'running' && <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />}
                      {step.status === 'pending' && <Clock className="h-3 w-3 text-gray-400" />}
                      {step.status === 'skipped' && <RefreshCw className="h-3 w-3 text-yellow-600" />}
                      <span className="truncate max-w-[140px]">{step.name}</span>
                    </div>
                    {step.duration !== undefined && step.duration > 0 && (
                      <span className="text-muted-foreground tabular-nums">
                        {(step.duration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Batch Iterations History */}
        {batchIterations && batchIterations.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-1">
                <Hash className="h-4 w-4" />
                Batch Iterations ({batchIterations.length})
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {batchIterations.map((batch: any, batchIdx: number) => {
                  const batchDuration = batch.endTime
                    ? new Date(batch.endTime).getTime() - new Date(batch.startTime).getTime()
                    : Date.now() - new Date(batch.startTime).getTime()
                  const isCurrentBatch = !batch.endTime
                  return (
                    <details
                      key={batch.batchId}
                      className={`text-xs border rounded p-2 ${isCurrentBatch ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}
                      open={isCurrentBatch || batchIdx === batchIterations.length - 1}
                    >
                      <summary className="cursor-pointer flex items-center justify-between font-medium">
                        <span className="flex items-center gap-1">
                          {isCurrentBatch ? (
                            <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3 text-green-600" />
                          )}
                          Batch {batch.batchNumber}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {(batchDuration / 1000).toFixed(1)}s
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1 pl-4 border-l-2 border-gray-200">
                        {batch.steps.map((step: any, stepIdx: number) => (
                          <div
                            key={stepIdx}
                            className={`flex items-center justify-between py-0.5 ${
                              step.status === 'completed' ? 'text-green-700' :
                              step.status === 'failed' ? 'text-red-700' :
                              step.status === 'running' ? 'text-blue-700' :
                              step.status === 'skipped' ? 'text-yellow-700' :
                              'text-gray-500'
                            }`}
                          >
                            <span className="flex items-center gap-1">
                              {step.status === 'completed' && <CheckCircle2 className="h-2.5 w-2.5" />}
                              {step.status === 'failed' && <XCircle className="h-2.5 w-2.5" />}
                              {step.status === 'running' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                              {step.status === 'skipped' && <RefreshCw className="h-2.5 w-2.5" />}
                              <span className="truncate max-w-[120px]">{step.name.replace(/_/g, ' ')}</span>
                            </span>
                            {step.duration !== undefined && (
                              <span className="text-muted-foreground tabular-nums">
                                {step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s`}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* Failed Steps Details */}
        {failedSteps.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Failed Steps
              </h4>
              {failedSteps.map((step, idx) => (
                <div key={idx} className="text-xs bg-red-50 border border-red-200 rounded p-2 space-y-1">
                  <div className="font-medium text-red-800">{step.name}</div>
                  {step.error && (
                    <div className="text-red-700 break-words">{step.error}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Technology */}
        <Separator />
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Technology</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Executor</span>
              <span className="text-xs">Multi-Agent</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Concurrent</span>
              <span>3 steps</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Retry Policy</span>
              <span className="text-xs">Progressive backoff</span>
            </div>
          </div>
        </div>

        {/* Data Flow - Entry Points */}
        <Separator />
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Dispatches To</h4>
          <div className="flex flex-wrap gap-1">
            {edges
              .filter(e => e.from === 'orchestrator')
              .map(e => {
                const toAgent = agents.find(a => a.id === e.to)
                return (
                  <Badge key={e.to} variant="outline" className="text-[10px]">
                    {toAgent?.shortName || e.to}
                  </Badge>
                )
              })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Sidebar component for detailed node information
export function UKBNodeDetailsSidebar({
  agentId,
  process,
  onClose,
  aggregatedSteps,
  edges = [],
  agents = WORKFLOW_AGENTS,
  apiBaseUrl,
}: {
  agentId: string
  process: ProcessInfo
  onClose: () => void
  aggregatedSteps?: AggregatedSteps | null
  edges?: Array<{ from: string; to: string; type?: string; label?: string }>
  agents?: typeof WORKFLOW_AGENTS
  apiBaseUrl?: string
}) {
  const dispatch = useDispatch()

  // Compute all values unconditionally to ensure hooks are called consistently
  const agent = agents.find(a => a.id === agentId)

  // LLM Mode state for this agent
  const agentLLMMode = useSelector((state: RootState) => selectAgentLLMMode(state, agentId))
  const hasOverride = useSelector((state: RootState) => selectAgentHasOverride(state, agentId))
  const globalLLMMode = useSelector(selectGlobalLLMMode)

  const currentBatch = (process as any).batchIterations?.length
    ? (process as any).batchIterations[(process as any).batchIterations.length - 1]
    : null
  const isBatchWorkflow = currentBatch !== null

  // Get step info from the correct source based on step type
  const stepInfo = useMemo((): StepInfo | undefined => {
    // For batch-phase agents in a batch workflow, prefer current batch status
    if (isBatchWorkflow && SIDEBAR_BATCH_PHASE_AGENTS.includes(agentId)) {
      const batchStep = currentBatch?.steps?.find(
        (s: any) => STEP_TO_AGENT[s.name] === agentId || s.name === agentId
      )
      if (batchStep) {
        // Cast batch step to StepInfo (it may have fewer fields, which is fine)
        return batchStep as StepInfo
      }
    }
    // Fall back to top-level steps for non-batch steps or if batch step not found
    // When multiple steps map to the same agent (e.g., wave1_analyze, wave2_analyze -> semantic_analysis),
    // pick the most relevant: running > failed > completed > pending
    const STATUS_PRIORITY: Record<string, number> = { running: 4, failed: 3, completed: 2, pending: 1, skipped: 0 }
    const agentSteps = (process.steps || []).filter(s => STEP_TO_AGENT[s.name] === agentId || s.name === agentId)
    if (agentSteps.length === 0) return undefined
    return agentSteps.reduce((best, step) =>
      (STATUS_PRIORITY[step.status] || 0) > (STATUS_PRIORITY[best.status] || 0) ? step : best
    )
  }, [agentId, isBatchWorkflow, currentBatch, process.steps])

  // Phase 18: Use selectNodeStatus selector for status (no inference/guessing)
  const { status: nodeStatus } = useSelector((state: RootState) => selectNodeStatus(state, agentId, false))

  // Determine display status: check for paused state, then use derived status, then stepInfo
  type DisplayStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused'
  const resolvedStatus: DisplayStatus = (() => {
    // Check if this agent's step is currently paused in single-step mode
    if ((process as any).stepPaused && (process as any).pausedAtStep) {
      const pausedAgentId = STEP_TO_AGENT[(process as any).pausedAtStep] || (process as any).pausedAtStep
      if (pausedAgentId === agentId) {
        return 'paused'
      }
    }
    // Use derived status from state machine when available
    if (nodeStatus && nodeStatus !== 'pending') return nodeStatus as DisplayStatus
    // Use stepInfo status (for polling-only mode before WorkflowState arrives)
    if (stepInfo?.status) return stepInfo.status as DisplayStatus
    return (nodeStatus || 'pending') as DisplayStatus
  })()

  // Log when agent sidebar is displayed - useEffect must be called unconditionally (Rules of Hooks)
  useEffect(() => {
    // Only log for non-orchestrator agents that exist
    if (agentId === 'orchestrator' || !agent) return
    Logger.info(LogCategories.AGENT, `Agent sidebar opened: ${agent.name} (${agentId})`, {
      agentId,
      agentName: agent.name,
      status: resolvedStatus,
      hasStepInfo: !!stepInfo,
      stepDuration: stepInfo?.duration ? `${stepInfo.duration}ms` : '-',
      tokensUsed: stepInfo?.tokensUsed || 0,
      llmModel: agent.llmModel || 'none',
      techStack: agent.techStack || 'N/A',
      hasOutputs: stepInfo?.outputs ? Object.keys(stepInfo.outputs).length > 0 : false,
      hasError: !!stepInfo?.error,
      workflowName: process.workflowName,
    })

    // Log detailed step outputs at debug level
    if (stepInfo?.outputs) {
      Logger.debug(LogCategories.AGENT, `Agent ${agentId} outputs`, {
        outputKeys: Object.keys(stepInfo.outputs),
        outputs: stepInfo.outputs,
      })
    }

    // Log error details at warn level
    if (stepInfo?.error) {
      Logger.warn(LogCategories.AGENT, `Agent ${agentId} has error`, {
        error: stepInfo.error,
      })
    }
  }, [agentId, agent?.name, resolvedStatus, stepInfo, agent?.llmModel, agent?.techStack, process.workflowName])

  // Handle orchestrator node specially - after hooks
  if (agentId === 'orchestrator') {
    return <OrchestratorDetailsSidebar process={process} onClose={onClose} edges={edges} agents={agents} />
  }

  // Return null for unknown agents - after hooks
  if (!agent) return null

  const Icon = agent.icon

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-500">Running</Badge>
      case 'paused':
        return <Badge className="bg-amber-500 animate-pulse">Paused</Badge>
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'skipped':
        return <Badge variant="outline">Skipped</Badge>
      default:
        return <Badge variant="outline">Pending</Badge>
    }
  }

  return (
    <Card className="w-80 h-full overflow-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            <CardTitle className="text-lg">{agent.name}</CardTitle>
          </div>
          {getStatusBadge(resolvedStatus)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-sm text-muted-foreground mb-2">{agent.description}</div>
        </div>

        <Separator />

        {/* Agent Properties */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Technology</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3" />
                LLM
              </span>
              <span className="text-right max-w-[160px] text-xs">
                {agent.llmModel || 'none'}
              </span>
            </div>

            {agent.techStack && (
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Stack</span>
                <span className="text-xs text-right max-w-[160px]">{agent.techStack}</span>
              </div>
            )}
          </div>
        </div>

        {/* LLM Mode Control - Only show for agents that use LLM */}
        {agent.usesLLM && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                LLM Mode
                {hasOverride && (
                  <span className="text-xs text-yellow-600 font-normal">(override)</span>
                )}
              </h4>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md overflow-hidden border border-gray-200 flex-1" title="Set LLM mode for this agent">
                  <button
                    onClick={async () => {
                      dispatch(setAgentLLMMode({ agentId, mode: 'mock' }))
                      if (apiBaseUrl) {
                        try {
                          await fetch(`${apiBaseUrl}/api/ukb/llm-mode/agent`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ agentId, mode: 'mock' })
                          })
                        } catch (e) { /* ignore */ }
                      }
                    }}
                    className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors flex-1 justify-center ${
                      agentLLMMode === 'mock'
                        ? 'bg-orange-500 text-white'
                        : 'bg-white text-gray-600 hover:bg-orange-50'
                    }`}
                    title="Mock: Use fake LLM responses"
                  >
                    <FlaskConical className="h-3 w-3" />
                    M
                  </button>
                  <button
                    onClick={async () => {
                      dispatch(setAgentLLMMode({ agentId, mode: 'local' }))
                      if (apiBaseUrl) {
                        try {
                          await fetch(`${apiBaseUrl}/api/ukb/llm-mode/agent`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ agentId, mode: 'local' })
                          })
                        } catch (e) { /* ignore */ }
                      }
                    }}
                    className={`flex items-center gap-1 px-2 py-1 text-xs border-l border-r border-gray-200 transition-colors flex-1 justify-center ${
                      agentLLMMode === 'local'
                        ? 'bg-purple-500 text-white'
                        : 'bg-white text-gray-600 hover:bg-purple-50'
                    }`}
                    title="Local: Use Docker Model Runner"
                  >
                    <Server className="h-3 w-3" />
                    L
                  </button>
                  <button
                    onClick={async () => {
                      dispatch(setAgentLLMMode({ agentId, mode: 'public' }))
                      if (apiBaseUrl) {
                        try {
                          await fetch(`${apiBaseUrl}/api/ukb/llm-mode/agent`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ agentId, mode: 'public' })
                          })
                        } catch (e) { /* ignore */ }
                      }
                    }}
                    className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors flex-1 justify-center ${
                      agentLLMMode === 'public'
                        ? 'bg-green-500 text-white'
                        : 'bg-white text-gray-600 hover:bg-green-50'
                    }`}
                    title="Public: Use Groq/Anthropic/OpenAI"
                  >
                    <Cloud className="h-3 w-3" />
                    P
                  </button>
                </div>
                {hasOverride && (
                  <button
                    onClick={async () => {
                      dispatch(clearAgentLLMOverride(agentId))
                      if (apiBaseUrl) {
                        try {
                          await fetch(`${apiBaseUrl}/api/ukb/llm-mode/agent/${agentId}`, {
                            method: 'DELETE'
                          })
                        } catch (e) { /* ignore */ }
                      }
                    }}
                    className="p-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    title={`Reset to global (${globalLLMMode})`}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Global: {globalLLMMode.charAt(0).toUpperCase() + globalLLMMode.slice(1)}
              </div>
            </div>
          </>
        )}

        {/* Step Execution Details - Always show with available data */}
        <Separator />
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Execution Details</h4>
          <div className="space-y-2 text-sm">
            {/* Status */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={
                resolvedStatus === 'completed' ? 'text-green-600 font-medium' :
                resolvedStatus === 'failed' ? 'text-red-600 font-medium' :
                resolvedStatus === 'running' ? 'text-blue-600 font-medium' :
                resolvedStatus === 'paused' ? 'text-amber-600 font-medium animate-pulse' :
                'text-muted-foreground'
              }>
                {(resolvedStatus || 'pending').charAt(0).toUpperCase() + (resolvedStatus || 'pending').slice(1)}
              </span>
            </div>

            {/* Duration - only show if we have it */}
            {stepInfo?.duration !== undefined && stepInfo.duration > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  Duration
                </span>
                <span>{formatDurationMs(stepInfo.duration)}</span>
              </div>
            )}

            {/* Tokens - only show if we have it */}
            {stepInfo?.tokensUsed !== undefined && stepInfo.tokensUsed > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  Tokens Used
                </span>
                <span>{stepInfo.tokensUsed.toLocaleString()}</span>
              </div>
            )}

            {/* LLM Usage Details - show model by provider and token breakdown */}
            {stepInfo?.outputs?.llmUsage && (() => {
              const llmUsage = stepInfo.outputs.llmUsage as Record<string, any>
              return (
              <div className="space-y-1 pt-1 border-t border-dashed mt-1">
                {/* Combined LLM display: model by provider */}
                {(llmUsage.modelsUsed?.length > 0 || llmUsage.providersUsed?.length > 0) && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">LLM</span>
                    <span className="font-mono text-[10px] text-right max-w-[180px]">
                      {(() => {
                        const models = llmUsage.modelsUsed || []
                        const providers = llmUsage.providersUsed || []
                        if (models.length > 0 && providers.length > 0) {
                          // Format: model by provider (e.g., "llama-3.3-70b by groq")
                          return models.map((m: string, i: number) =>
                            `${m}${providers[i] ? ` by ${providers[i]}` : ''}`
                          ).join(', ')
                        } else if (models.length > 0) {
                          return models.join(', ')
                        } else if (providers.length > 0) {
                          return providers.join(', ')
                        }
                        return 'unknown'
                      })()}
                    </span>
                  </div>
                )}
                {llmUsage.totalTokens > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Tokens</span>
                    <span>
                      <span className="text-green-600">{(llmUsage.totalPromptTokens || 0).toLocaleString()}</span>
                      <span className="text-muted-foreground mx-0.5">{'->'}</span>
                      <span className="text-blue-600">{(llmUsage.totalCompletionTokens || 0).toLocaleString()}</span>
                      <span className="text-muted-foreground ml-1">({llmUsage.totalTokens.toLocaleString()} total)</span>
                    </span>
                  </div>
                )}
              </div>
              )
            })()}

            {/* Show message if no timing data yet */}
            {!stepInfo?.duration && resolvedStatus === 'completed' && (
              <div className="text-xs text-muted-foreground italic">
                Timing data will be available in next workflow run
              </div>
            )}
          </div>
        </div>

        {/* Error Information */}
        {stepInfo?.error && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Error
              </h4>
              <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-800 break-words">
                {stepInfo.error}
              </div>
            </div>
          </>
        )}

        {/* LLM Error Warning - show when LLM failed but step continued with fallback */}
        {stepInfo?.outputs?.llmError && !stepInfo?.error && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                LLM Call Failed
              </h4>
              <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 text-amber-800 break-words">
                <div>{String(stepInfo.outputs.llmError)}</div>
                <div className="text-amber-500 text-[10px] mt-1 italic">Using rule-based fallback</div>
              </div>
            </div>
          </>
        )}

        {/* Results Summary - show stats and key outcomes */}
        {stepInfo?.outputs && Object.keys(stepInfo.outputs).filter(k => !k.startsWith('_')).length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-1">
                <Zap className="h-3 w-3" />
                Results
              </h4>
              {/* Semantic Summary based on agent type - uses aggregated totals for historical workflows */}
              <StepResultSummary agentId={agentId} outputs={stepInfo.outputs} aggregatedSteps={aggregatedSteps} status={resolvedStatus} />
              {/* Only show detailed results if we DON'T have aggregated data (which would contradict it) */}
              {!aggregatedSteps && <StepResultDetails outputs={stepInfo.outputs} />}
            </div>
          </>
        )}

        {/* Data Flow */}
        <Separator />
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Data Flow</h4>
          <div className="text-xs space-y-1">
            <div className="text-muted-foreground">Receives from:</div>
            <div className="flex flex-wrap gap-1">
              {edges
                .filter(e => e.to === agentId)
                .map(e => {
                  const fromAgent = agents.find(a => a.id === e.from)
                  return (
                    <Badge key={e.from} variant="outline" className="text-[10px]">
                      {fromAgent?.shortName || e.from}
                    </Badge>
                  )
                })}
              {edges.filter(e => e.to === agentId).length === 0 && (
                <span className="text-muted-foreground italic">None (entry point)</span>
              )}
            </div>
            <div className="text-muted-foreground mt-2">Sends to:</div>
            <div className="flex flex-wrap gap-1">
              {edges
                .filter(e => e.from === agentId)
                .map(e => {
                  const toAgent = agents.find(a => a.id === e.to)
                  return (
                    <Badge key={e.to} variant="outline" className="text-[10px]">
                      {toAgent?.shortName || e.to}
                    </Badge>
                  )
                })}
              {edges.filter(e => e.from === agentId).length === 0 && (
                <span className="text-muted-foreground italic">None (final step)</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
