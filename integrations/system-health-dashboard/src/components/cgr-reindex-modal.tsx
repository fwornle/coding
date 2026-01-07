'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  closeConfirmModal,
  reindexStart,
  reindexSuccess,
  reindexFailure,
  reindexReset,
} from '@/store/slices/cgrSlice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react'
import { Logger, LogCategories } from '@/utils/logging'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

interface ReindexProgress {
  status: 'running' | 'completed' | 'failed' | 'idle'
  phase: string | null
  step: number
  totalSteps: number
  message: string
  elapsedSeconds?: number
  stats?: {
    functions?: number
    relationships?: number
    commitShort?: string
  }
}

export default function CGRReindexModal() {
  const dispatch = useAppDispatch()
  const cgr = useAppSelector((state) => state.cgr)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [progress, setProgress] = useState<ReindexProgress | null>(null)

  // Poll for progress during reindexing
  const pollProgress = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cgr/progress`)
      const data = await res.json()

      if (data.status === 'success' && data.data) {
        setProgress(data.data)

        // Check if completed or failed
        if (data.data.status === 'completed') {
          Logger.info(LogCategories.API, 'CGR re-index completed', data.data.stats)
          dispatch(reindexSuccess())
          return true // Stop polling
        }
        if (data.data.status === 'failed') {
          Logger.error(LogCategories.API, 'CGR re-index failed', { message: data.data.message })
          dispatch(reindexFailure(data.data.message || 'Reindex failed'))
          return true // Stop polling
        }
      }
      return false // Continue polling
    } catch (error) {
      Logger.warn(LogCategories.API, 'Error polling CGR progress', error)
      return false // Continue polling
    }
  }, [dispatch])

  useEffect(() => {
    if (cgr.reindexStatus !== 'running' || !cgr.reindexStartTime) {
      setElapsedTime(0)
      setProgress(null)
      return
    }

    const startTime = new Date(cgr.reindexStartTime).getTime()

    // Timer for elapsed time
    const timerInterval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    // Poll for progress every 3 seconds
    const pollInterval = setInterval(async () => {
      const shouldStop = await pollProgress()
      if (shouldStop) {
        clearInterval(pollInterval)
      }
    }, 3000)

    // Initial poll
    pollProgress()

    return () => {
      clearInterval(timerInterval)
      clearInterval(pollInterval)
    }
  }, [cgr.reindexStatus, cgr.reindexStartTime, pollProgress])

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins + ':' + String(secs).padStart(2, '0')
  }

  const handleConfirm = async () => {
    Logger.info(LogCategories.API, 'Starting CGR re-index')
    dispatch(reindexStart())

    try {
      const response = await fetch(`${API_BASE_URL}/api/cgr/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.json()
        Logger.error(LogCategories.API, 'Failed to start CGR re-index', { message: error.message })
        throw new Error(error.message || 'Failed to start re-index')
      }

      Logger.info(LogCategories.API, 'CGR re-index started successfully')
      // Progress polling will be handled by the useEffect
    } catch (error) {
      Logger.error(LogCategories.API, 'CGR re-index failed', error)
      dispatch(reindexFailure(error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleClose = () => {
    Logger.debug(LogCategories.MODAL, `CGR modal closing with status: ${cgr.reindexStatus}`)
    dispatch(closeConfirmModal())
    // Only reset if completed/failed - running operations continue in background
    if (cgr.reindexStatus === 'completed' || cgr.reindexStatus === 'failed') {
      dispatch(reindexReset())
    }
  }

  // Calculate progress percentage
  const progressPercent = progress?.totalSteps && progress.totalSteps > 0
    ? Math.round((progress.step / progress.totalSteps) * 100)
    : Math.min((elapsedTime / 1800) * 100, 95) // Fallback to time-based

  // Modal is only open when explicitly requested - user can close it even during running
  const isOpen = cgr.showConfirmModal

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {cgr.reindexStatus === 'idle' && (
              <>
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Re-index Code Graph?
              </>
            )}
            {cgr.reindexStatus === 'running' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                Re-indexing...
              </>
            )}
            {cgr.reindexStatus === 'completed' && (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Re-index Complete
              </>
            )}
            {cgr.reindexStatus === 'failed' && (
              <>
                <XCircle className="h-5 w-5 text-red-500" />
                Re-index Failed
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {cgr.reindexStatus === 'idle' && (
              'This will rebuild the code graph index for the coding repository.'
            )}
            {cgr.reindexStatus === 'running' && (
              'The code graph for coding is being rebuilt. This runs in the background.'
            )}
            {cgr.reindexStatus === 'completed' && (
              'The code graph index for coding has been successfully rebuilt.'
            )}
            {cgr.reindexStatus === 'failed' && (
              'The re-index operation failed. Please check the logs.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {cgr.reindexStatus === 'idle' && (
            <div className="space-y-3">
              <Alert>
                <Clock className="h-4 w-4" />
                <AlertDescription>
                  <strong>Warning:</strong> This operation typically takes <strong>20-30 minutes</strong> to complete.
                  The process runs asynchronously and you can continue using the dashboard.
                </AlertDescription>
              </Alert>
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                <strong>Scope:</strong> Re-indexes the <code className="bg-background px-1 rounded">coding</code> repository
                including all integrations (code-graph-rag, semantic-analysis, etc.). This covers ~33k functions across
                the entire monorepo. Other repositories indexed via UKB remain in Memgraph but aren&apos;t cache-tracked.
              </div>
            </div>
          )}

          {cgr.reindexStatus === 'running' && (
            <div className="space-y-3">
              {/* Timer and progress */}
              <div className="flex items-center justify-center gap-2 text-lg font-mono">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <span>{formatElapsedTime(progress?.elapsedSeconds ?? elapsedTime)}</span>
              </div>

              {/* Current phase/message */}
              {progress?.message && (
                <div className="text-sm text-center font-medium text-blue-600 dark:text-blue-400">
                  {progress.message}
                </div>
              )}

              {/* Step indicator */}
              {progress?.totalSteps && progress.totalSteps > 0 && (
                <div className="text-sm text-center text-muted-foreground">
                  Step {progress.step} of {progress.totalSteps}
                </div>
              )}

              {/* Progress bar */}
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: progressPercent + '%' }}
                />
              </div>

              {/* Phase indicator chips */}
              {progress?.phase && (
                <div className="flex justify-center">
                  <span className="px-2 py-1 text-xs rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                    {progress.phase}
                  </span>
                </div>
              )}

              {!progress && (
                <div className="text-sm text-center text-muted-foreground">
                  Typical duration: 20-30 minutes
                </div>
              )}
            </div>
          )}

          {cgr.reindexStatus === 'completed' && progress?.stats && (
            <div className="text-sm space-y-1 bg-green-50 dark:bg-green-900/20 p-3 rounded-md">
              <div><strong>Functions indexed:</strong> {progress.stats.functions?.toLocaleString()}</div>
              <div><strong>Relationships:</strong> {progress.stats.relationships?.toLocaleString()}</div>
              {progress.stats.commitShort && (
                <div><strong>Commit:</strong> {progress.stats.commitShort}</div>
              )}
            </div>
          )}

          {cgr.reindexStatus === 'failed' && cgr.reindexError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{cgr.reindexError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          {cgr.reindexStatus === 'idle' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleConfirm}>
                Start Re-index
              </Button>
            </>
          )}
          {cgr.reindexStatus === 'running' && (
            <Button variant="outline" onClick={handleClose}>
              Close (continues in background)
            </Button>
          )}
          {(cgr.reindexStatus === 'completed' || cgr.reindexStatus === 'failed') && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
