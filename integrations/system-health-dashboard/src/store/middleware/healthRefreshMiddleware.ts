import { Middleware } from '@reduxjs/toolkit'
import {
  fetchHealthStatusStart,
  fetchHealthStatusSuccess,
  fetchHealthStatusFailure,
} from '../slices/healthStatusSlice'
import {
  fetchHealthReportStart,
  fetchHealthReportSuccess,
  fetchHealthReportFailure,
} from '../slices/healthReportSlice'
import {
  fetchAPIQuotaStart,
  fetchAPIQuotaSuccess,
  fetchAPIQuotaFailure,
} from '../slices/apiQuotaSlice'
import {
  fetchUKBStatusStart,
  fetchUKBStatusSuccess,
  fetchUKBStatusFailure,
} from '../slices/ukbSlice'
import { Logger, LogCategories } from '../../utils/logging'

const API_PORT = process.env.NEXT_PUBLIC_SYSTEM_HEALTH_API_PORT || process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}/api/health-verifier`
const UKB_API_URL = `http://localhost:${API_PORT}/api/ukb`

// Singleton manager for auto-refresh
class HealthRefreshManager {
  private refreshInterval: NodeJS.Timeout | null = null
  private store: any = null
  private refreshCount = 0

  initialize(store: any) {
    this.store = store
    Logger.info(LogCategories.REFRESH, 'HealthRefreshManager initialized')
    this.startAutoRefresh()
  }

  startAutoRefresh() {
    if (this.refreshInterval) return

    Logger.info(LogCategories.REFRESH, 'Starting auto-refresh cycle (5s interval)')

    // Initial fetch
    this.fetchAllData()

    // Auto-refresh every 5 seconds
    this.refreshInterval = setInterval(() => {
      this.fetchAllData()
    }, 5000)
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
      Logger.info(LogCategories.REFRESH, 'Auto-refresh stopped')
    }
  }

  async fetchAllData() {
    if (!this.store) return

    this.refreshCount++
    Logger.debug(LogCategories.REFRESH, `Refresh cycle #${this.refreshCount} started`)

    // Fetch health status
    await this.fetchHealthStatus()
    // Fetch health report
    await this.fetchHealthReport()
    // Fetch API quota data
    await this.fetchAPIQuota()
    // Fetch UKB process status
    await this.fetchUKBStatus()

    Logger.debug(LogCategories.REFRESH, `Refresh cycle #${this.refreshCount} completed`)
  }

  private async fetchHealthStatus() {
    if (!this.store) return

    try {
      const response = await fetch(`${API_BASE_URL}/status`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data) {
        // Use getState/dispatch from store API
        this.store.dispatch(fetchHealthStatusSuccess(result.data))
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      this.store.dispatch(fetchHealthStatusFailure(error.message))
      console.error('Failed to fetch health status:', error)
    }
  }

  private async fetchHealthReport() {
    if (!this.store) return

    try {
      const response = await fetch(`${API_BASE_URL}/report`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data) {
        this.store.dispatch(fetchHealthReportSuccess(result.data))
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      this.store.dispatch(fetchHealthReportFailure(error.message))
      console.error('Failed to fetch health report:', error)
    }
  }

  private async fetchAPIQuota() {
    if (!this.store) return

    try {
      const response = await fetch(`${API_BASE_URL}/api-quota`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data) {
        this.store.dispatch(fetchAPIQuotaSuccess(result.data))
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      this.store.dispatch(fetchAPIQuotaFailure(error.message))
      console.error('Failed to fetch API quota:', error)
    }
  }

  private async fetchUKBStatus() {
    if (!this.store) return

    try {
      const response = await fetch(`${UKB_API_URL}/processes`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data) {
        const processes = result.data.processes || []

        // Log UKB process details for debugging
        if (processes.length > 0) {
          processes.forEach((p: any) => {
            const hasValidData = p.workflowName && p.totalSteps > 0
            Logger.debug(
              LogCategories.UKB,
              `Process ${p.pid}: ${p.workflowName || '(no name)'} ` +
              `[${p.completedSteps || 0}/${p.totalSteps || 0}] ` +
              `status=${p.status} valid=${hasValidData}`
            )
          })
        }

        this.store.dispatch(fetchUKBStatusSuccess(result.data))
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      Logger.warn(LogCategories.UKB, 'Failed to fetch UKB status:', error.message)
      this.store.dispatch(fetchUKBStatusFailure(error.message))
    }
  }
}

export const healthRefreshManager = new HealthRefreshManager()

export const healthRefreshMiddleware: Middleware = (store) => {
  // Initialize the manager with the store
  healthRefreshManager.initialize(store)

  return (next) => (action) => {
    return next(action)
  }
}
