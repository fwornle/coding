import { Middleware } from '@reduxjs/toolkit'
import {
  triggerVerificationStart,
  triggerVerificationSuccess,
  triggerVerificationFailure,
} from '../slices/autoHealingSlice'

const API_PORT = process.env.NEXT_PUBLIC_SYSTEM_HEALTH_API_PORT || process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}/api/health-verifier`

export const apiMiddleware: Middleware = (store) => (next) => (action) => {
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
          store.dispatch(triggerVerificationSuccess())
          console.log('✅ Health verification triggered successfully')
        } else {
          throw new Error(responseData.message || 'Verification trigger failed')
        }
      } catch (error: any) {
        store.dispatch(triggerVerificationFailure(error.message))
        console.error('❌ Failed to trigger verification:', error)
      }
    })()
  }

  return result
}
