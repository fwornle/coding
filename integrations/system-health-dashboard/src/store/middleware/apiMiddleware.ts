import { Middleware } from '@reduxjs/toolkit'
import {
  triggerVerificationStart,
  triggerVerificationSuccess,
  triggerVerificationFailure,
} from '../slices/autoHealingSlice'
import { healthRefreshManager } from './healthRefreshMiddleware'
import { Logger, LogCategories } from '@/utils/logging'

const API_PORT = process.env.NEXT_PUBLIC_SYSTEM_HEALTH_API_PORT || process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}/api/health-verifier`

export const apiMiddleware: Middleware = (store) => (next) => (action: any) => {
  // Pass the action through first
  const result = next(action)

  // Handle trigger verification action asynchronously
  if (action.type === triggerVerificationStart.type) {
    // Execute async operation without blocking
    ;(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const responseData = await response.json()
        if (responseData.status === 'success') {
          Logger.info(LogCategories.HEALTH, 'Health verification triggered successfully')

          // Wait for verification to complete before fetching updated data
          // Health verification typically takes 2-5 seconds to run all checks
          Logger.debug(LogCategories.HEALTH, 'Waiting for verification to complete (3 seconds)...')
          await new Promise(resolve => setTimeout(resolve, 3000))

          // Now fetch updated health data
          Logger.debug(LogCategories.HEALTH, 'Fetching updated health data...')
          await healthRefreshManager.fetchAllData()
          Logger.info(LogCategories.HEALTH, 'Health data refreshed')

          store.dispatch(triggerVerificationSuccess())
        } else {
          throw new Error(responseData.message || 'Verification trigger failed')
        }
      } catch (error: any) {
        store.dispatch(triggerVerificationFailure(error.message))
        Logger.error(LogCategories.HEALTH, 'Failed to trigger verification:', error)
      }
    })()
  }

  return result
}
