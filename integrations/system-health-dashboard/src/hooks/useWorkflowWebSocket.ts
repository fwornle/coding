/**
 * WebSocket Hook for Workflow Events
 *
 * Connects to the server's WebSocket endpoint to receive real-time workflow events
 * and dispatch commands back to the coordinator.
 *
 * Phase 18 rewrite: Handles STATE_SNAPSHOT events from the server and dispatches
 * a single setWorkflowState action to Redux. No granular event reconstruction.
 *
 * Usage:
 *   const { sendCommand, isConnected, error } = useWorkflowWebSocket()
 *
 * Events received from server are automatically dispatched to Redux.
 * Use sendCommand() to send commands back to the coordinator.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Logger, LogCategories } from '@/utils/logging'
import type { WorkflowState } from '@/shared/workflow-types/state'
import {
  setWorkflowState,
  handlePreferencesUpdated,
  resetExecutionState,
} from '@/store/slices/ukbSlice'

// Message types from the server WebSocket
// STATE_SNAPSHOT carries the full WorkflowState (from SSE event pipeline)
// PREFERENCES_UPDATED carries LLM mode sync (not state machine related)
// HEARTBEAT is a connection keepalive (no-op)
type ServerMessageType =
  | 'STATE_SNAPSHOT'
  | 'PREFERENCES_UPDATED'
  | 'HEARTBEAT'

interface StateSnapshotMessage {
  type: 'STATE_SNAPSHOT'
  payload: {
    state: WorkflowState
    transition?: string
  }
}

interface PreferencesUpdatedMessage {
  type: 'PREFERENCES_UPDATED'
  payload: Record<string, unknown>
}

interface HeartbeatMessage {
  type: 'HEARTBEAT'
  payload?: Record<string, unknown>
}

type ServerMessage = StateSnapshotMessage | PreferencesUpdatedMessage | HeartbeatMessage

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

  // Handle incoming messages and dispatch to Redux
  const handleMessage = useCallback((message: { type: string; payload?: unknown }) => {
    const { type } = message

    switch (type) {
      case 'STATE_SNAPSHOT': {
        // Primary event: full WorkflowState snapshot from SSE pipeline
        const payload = (message as StateSnapshotMessage).payload
        if (payload?.state) {
          dispatch(setWorkflowState({
            state: payload.state,
            transition: payload.transition,
          }))
        }
        break
      }

      case 'PREFERENCES_UPDATED':
        // LLM mode sync from coordinator (not state machine related)
        dispatch(handlePreferencesUpdated((message as PreferencesUpdatedMessage).payload as any))
        break

      case 'HEARTBEAT':
        // Connection keepalive -- no Redux dispatch needed
        break

      default:
        Logger.warn(LogCategories.UKB, 'Unknown WebSocket message type:', type)
    }
  }, [dispatch])

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return // Already connected
    }

    const url = serverUrl || getWebSocketUrl()
    Logger.info(LogCategories.UKB, 'WebSocket connecting to:', url)

    try {
      const ws = new WebSocket(url)

      ws.onopen = () => {
        Logger.info(LogCategories.UKB, 'WebSocket connected')
        setIsConnected(true)
        setError(null)
        setReconnectAttempts(0)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data && typeof data.type === 'string') {
            handleMessage(data)
          }
        } catch (parseError) {
          Logger.warn(LogCategories.UKB, 'Failed to parse WebSocket message:', event.data)
        }
      }

      ws.onerror = (event) => {
        Logger.error(LogCategories.UKB, 'WebSocket error:', event)
        setError('WebSocket connection error')
      }

      ws.onclose = (event) => {
        Logger.info(LogCategories.UKB, 'WebSocket disconnected:', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null

        // Auto-reconnect if enabled and not a clean close
        if (autoReconnect && event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
          setReconnectAttempts((prev) => prev + 1)
          reconnectTimeoutRef.current = setTimeout(() => {
            Logger.info(LogCategories.UKB, 'Attempting WebSocket reconnect...')
            connect()
          }, reconnectDelay)
        }
      }

      wsRef.current = ws
    } catch (connectError) {
      Logger.error(LogCategories.UKB, 'Failed to create WebSocket:', connectError)
      setError('Failed to create WebSocket connection')
    }
  }, [serverUrl, autoReconnect, reconnectDelay, maxReconnectAttempts, reconnectAttempts, handleMessage])

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
      Logger.warn(LogCategories.UKB, 'Cannot send command: WebSocket not connected')
      return false
    }

    try {
      wsRef.current.send(JSON.stringify(command))
      Logger.debug(LogCategories.UKB, 'Sent WebSocket command:', command.type)
      return true
    } catch (sendError) {
      Logger.error(LogCategories.UKB, 'Failed to send WebSocket command:', sendError)
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
