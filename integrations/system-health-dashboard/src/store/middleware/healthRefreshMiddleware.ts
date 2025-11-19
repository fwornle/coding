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

const API_PORT = process.env.NEXT_PUBLIC_SYSTEM_HEALTH_API_PORT || process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}/api/health-verifier`

// Singleton manager for auto-refresh
class HealthRefreshManager {
  private refreshInterval: NodeJS.Timeout | null = null
  private store: any = null

  initialize(store: any) {
    this.store = store
    this.startAutoRefresh()
  }

  startAutoRefresh() {
    if (this.refreshInterval) return

    // Initial fetch
    this.fetchAllData()

    // Auto-refresh every 5 seconds
    this.refreshInterval = setInterval(() => {
      this.fetchAllData()
    }, 5000)

    console.log('🔄 Health refresh manager started (5s interval)')
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
      console.log('🛑 Health refresh manager stopped')
    }
  }

  async fetchAllData() {
    if (!this.store) return

    // Fetch health status
    await this.fetchHealthStatus()
    // Fetch health report
    await this.fetchHealthReport()
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
}

export const healthRefreshManager = new HealthRefreshManager()

export const healthRefreshMiddleware: Middleware = (store) => {
  // Initialize the manager with the store
  healthRefreshManager.initialize(store)

  return (next) => (action) => {
    return next(action)
  }
}
