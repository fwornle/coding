/**
 * WebSocket Hook for Workflow Events
 *
 * Connects to the server's WebSocket endpoint to receive real-time workflow events
 * and dispatch commands back to the coordinator.
 *
 * Usage:
 *   const { sendCommand, isConnected, error } = useWorkflowWebSocket()
 *
 * Events received from server are automatically dispatched to Redux.
 * Use sendCommand() to send commands back to the coordinator.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { useDispatch } from 'react-redux'
import {
  handleWorkflowStarted,
  handleStepStarted,
  handleStepCompleted,
  handleStepFailed,
  handleSubstepStarted,
  handleSubstepCompleted,
  handleBatchStarted,
  handleBatchCompleted,
  handleWorkflowPaused,
  handleWorkflowResumed,
  handleWorkflowCompleted,
  handleWorkflowFailed,
  handlePreferencesUpdated,
  resetExecutionState,
} from '@/store/slices/ukbSlice'

// Event types (must match coordinator's event types)
type WorkflowEventType =
  | 'WORKFLOW_STARTED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'SUBSTEP_STARTED'
  | 'SUBSTEP_COMPLETED'
  | 'BATCH_STARTED'
  | 'BATCH_COMPLETED'
  | 'WORKFLOW_PAUSED'
  | 'WORKFLOW_RESUMED'
  | 'WORKFLOW_COMPLETED'
  | 'WORKFLOW_FAILED'
  | 'PREFERENCES_UPDATED'
  | 'HEARTBEAT'

interface WorkflowEvent {
  type: WorkflowEventType
  payload: Record<string, unknown>
}

// Command types (must match coordinator's command types)
type WorkflowCommandType =
  | 'STEP_ADVANCE'
  | 'STEP_INTO'
  | 'SET_SINGLE_STEP_MODE'
  | 'SET_STEP_INTO_SUBSTEPS'
  | 'SET_MOCK_LLM'
  | 'CANCEL_WORKFLOW'
  | 'PAUSE_WORKFLOW'
  | 'RESUME_WORKFLOW'

interface WorkflowCommand {
  type: WorkflowCommandType
  payload: Record<string, unknown>
}

interface UseWorkflowWebSocketOptions {
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean
  /** Reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Reconnect delay in ms (default: 2000) */
  reconnectDelay?: number
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number
  /** Server URL (default: derived from window.location) */
  serverUrl?: string
}

interface UseWorkflowWebSocketResult {
  /** Send a command to the coordinator */
  sendCommand: (command: WorkflowCommand) => boolean
  /** Whether WebSocket is connected */
  isConnected: boolean
  /** Current error, if any */
  error: string | null
  /** Manually connect to WebSocket */
  connect: () => void
  /** Manually disconnect from WebSocket */
  disconnect: () => void
  /** Reconnect attempt count */
  reconnectAttempts: number
}

/**
 * Determine the WebSocket URL from the current page location.
 * Falls back to localhost:3033 for development.
 */
function getWebSocketUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://localhost:3033/api/ukb/ws'
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.hostname

  // In development, the API server is on port 3033
  const port = process.env.NODE_ENV === 'development' ? '3033' : window.location.port || '3033'

  return `${protocol}//${host}:${port}/api/ukb/ws`
}

export function useWorkflowWebSocket(
  options: UseWorkflowWebSocketOptions = {}
): UseWorkflowWebSocketResult {
  const {
    autoConnect = true,
    autoReconnect = true,
    reconnectDelay = 2000,
    maxReconnectAttempts = 10,
    serverUrl,
  } = options

  const dispatch = useDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)

  // Handle incoming events and dispatch to Redux
  const handleEvent = useCallback((event: WorkflowEvent) => {
    const { type, payload } = event

    switch (type) {
      case 'WORKFLOW_STARTED':
        dispatch(handleWorkflowStarted(payload as any))
        break
      case 'STEP_STARTED':
        dispatch(handleStepStarted(payload as any))
        break
      case 'STEP_COMPLETED':
        dispatch(handleStepCompleted(payload as any))
        break
      case 'STEP_FAILED':
        dispatch(handleStepFailed(payload as any))
        break
      case 'SUBSTEP_STARTED':
        dispatch(handleSubstepStarted(payload as any))
        break
      case 'SUBSTEP_COMPLETED':
        dispatch(handleSubstepCompleted(payload as any))
        break
      case 'BATCH_STARTED':
        dispatch(handleBatchStarted(payload as any))
        break
      case 'BATCH_COMPLETED':
        dispatch(handleBatchCompleted(payload as any))
        break
      case 'WORKFLOW_PAUSED':
        dispatch(handleWorkflowPaused(payload as any))
        break
      case 'WORKFLOW_RESUMED':
        dispatch(handleWorkflowResumed(payload as any))
        break
      case 'WORKFLOW_COMPLETED':
        dispatch(handleWorkflowCompleted(payload as any))
        break
      case 'WORKFLOW_FAILED':
        dispatch(handleWorkflowFailed(payload as any))
        break
      case 'PREFERENCES_UPDATED':
        dispatch(handlePreferencesUpdated(payload as any))
        break
      case 'HEARTBEAT':
        // Heartbeat events don't need Redux dispatch
        // They just keep the connection alive
        break
      default:
        console.warn('[WorkflowWebSocket] Unknown event type:', type)
    }
  }, [dispatch])

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return // Already connected
    }

    const url = serverUrl || getWebSocketUrl()
    console.log('[WorkflowWebSocket] Connecting to:', url)

    try {
      const ws = new WebSocket(url)

      ws.onopen = () => {
        console.log('[WorkflowWebSocket] Connected')
        setIsConnected(true)
        setError(null)
        setReconnectAttempts(0)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data && typeof data.type === 'string') {
            handleEvent(data as WorkflowEvent)
          }
        } catch (parseError) {
          console.warn('[WorkflowWebSocket] Failed to parse message:', event.data)
        }
      }

      ws.onerror = (event) => {
        console.error('[WorkflowWebSocket] Error:', event)
        setError('WebSocket connection error')
      }

      ws.onclose = (event) => {
        console.log('[WorkflowWebSocket] Disconnected:', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null

        // Auto-reconnect if enabled and not a clean close
        if (autoReconnect && event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
          setReconnectAttempts((prev) => prev + 1)
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[WorkflowWebSocket] Attempting reconnect...')
            connect()
          }, reconnectDelay)
        }
      }

      wsRef.current = ws
    } catch (connectError) {
      console.error('[WorkflowWebSocket] Failed to create WebSocket:', connectError)
      setError('Failed to create WebSocket connection')
    }
  }, [serverUrl, autoReconnect, reconnectDelay, maxReconnectAttempts, reconnectAttempts, handleEvent])

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect')
      wsRef.current = null
    }

    setIsConnected(false)
    dispatch(resetExecutionState())
  }, [dispatch])

  // Send a command to the coordinator
  const sendCommand = useCallback((command: WorkflowCommand): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[WorkflowWebSocket] Cannot send command: not connected')
      return false
    }

    try {
      wsRef.current.send(JSON.stringify(command))
      console.log('[WorkflowWebSocket] Sent command:', command.type)
      return true
    } catch (sendError) {
      console.error('[WorkflowWebSocket] Failed to send command:', sendError)
      return false
    }
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [autoConnect]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    sendCommand,
    isConnected,
    error,
    connect,
    disconnect,
    reconnectAttempts,
  }
}

// Convenience hooks for specific commands
export function useSendStepAdvance() {
  const { sendCommand } = useWorkflowWebSocket({ autoConnect: false })

  return useCallback((workflowId: string) => {
    return sendCommand({
      type: 'STEP_ADVANCE',
      payload: { workflowId },
    })
  }, [sendCommand])
}

export function useSendSetSingleStepMode() {
  const { sendCommand } = useWorkflowWebSocket({ autoConnect: false })

  return useCallback((enabled: boolean) => {
    return sendCommand({
      type: 'SET_SINGLE_STEP_MODE',
      payload: { enabled },
    })
  }, [sendCommand])
}

export function useSendSetMockLLM() {
  const { sendCommand } = useWorkflowWebSocket({ autoConnect: false })

  return useCallback((enabled: boolean, delay?: number) => {
    return sendCommand({
      type: 'SET_MOCK_LLM',
      payload: { enabled, delay },
    })
  }, [sendCommand])
}

export function useSendCancelWorkflow() {
  const { sendCommand } = useWorkflowWebSocket({ autoConnect: false })

  return useCallback((workflowId: string, reason?: string) => {
    return sendCommand({
      type: 'CANCEL_WORKFLOW',
      payload: { workflowId, reason },
    })
  }, [sendCommand])
}

export default useWorkflowWebSocket
