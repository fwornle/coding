'use client'

import React, { useEffect, useState } from 'react'
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

export default function CGRReindexModal() {
  const dispatch = useAppDispatch()
  const cgr = useAppSelector((state) => state.cgr)
  const [elapsedTime, setElapsedTime] = useState(0)

  useEffect(() => {
    if (cgr.reindexStatus !== 'running' || !cgr.reindexStartTime) {
      setElapsedTime(0)
      return
    }

    const startTime = new Date(cgr.reindexStartTime).getTime()
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [cgr.reindexStatus, cgr.reindexStartTime])

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

      Logger.info(LogCategories.API, 'CGR re-index started successfully, polling for completion')

      const checkStatus = async () => {
        try {
          const statusRes = await fetch(`${API_BASE_URL}/api/cgr/status`)
          const status = await statusRes.json()

          if (status.indexing === false) {
            Logger.info(LogCategories.API, 'CGR re-index completed')
            dispatch(reindexSuccess())
            return
          }

          Logger.trace(LogCategories.API, 'CGR re-index still in progress')
          setTimeout(checkStatus, 5000)
        } catch (error) {
          Logger.warn(LogCategories.API, 'Error checking CGR status, will retry', error)
          setTimeout(checkStatus, 5000)
        }
      }

      setTimeout(checkStatus, 5000)
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
              <div className="flex items-center justify-center gap-2 text-lg font-mono">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <span>{formatElapsedTime(elapsedTime)}</span>
              </div>
              <div className="text-sm text-center text-muted-foreground">
                Elapsed time. Typical duration: 20-30 minutes.
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: Math.min((elapsedTime / 1800) * 100, 95) + '%' }}
                />
              </div>
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
