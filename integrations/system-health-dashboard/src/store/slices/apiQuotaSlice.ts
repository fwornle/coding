import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface ProviderQuota {
  provider: string
  name: string
  abbrev: string
  status: 'healthy' | 'moderate' | 'low' | 'critical' | 'degraded'
  quota: {
    remaining: number | string
    remainingCredits?: number | null
    used: string
    limit: string
    unit: string
  }
  cost?: {
    total: number | string
    currency: string
    note?: string
  } | null
  rateLimit?: {
    requestsPerMinute?: number
    tokensPerDay?: number
  } | null
  lastChecked: string
  cacheStrategy: 'real-time' | 'estimated' | 'free-tier'
}

interface APIQuotaState {
  providers: ProviderQuota[]
  lastUpdate: string | null
  loading: boolean
  error: string | null
  status: 'operational' | 'degraded' | 'unhealthy' | 'offline'
}

const initialState: APIQuotaState = {
  providers: [],
  lastUpdate: null,
  loading: false,
  error: null,
  status: 'offline',
}

const apiQuotaSlice = createSlice({
  name: 'apiQuota',
  initialState,
  reducers: {
    fetchAPIQuotaStart(state) {
      state.loading = true
      state.error = null
    },
    fetchAPIQuotaSuccess(state, action: PayloadAction<{ providers: ProviderQuota[], lastUpdate: string }>) {
      state.providers = action.payload.providers
      state.lastUpdate = action.payload.lastUpdate
      state.loading = false
      state.error = null

      // Determine overall status based on provider statuses
      if (action.payload.providers.length === 0) {
        state.status = 'offline'
      } else {
        const hasCritical = action.payload.providers.some(p => p.status === 'critical')
        const hasLow = action.payload.providers.some(p => p.status === 'low' || p.status === 'degraded')

        if (hasCritical) {
          state.status = 'unhealthy'
        } else if (hasLow) {
          state.status = 'degraded'
        } else {
          state.status = 'operational'
        }
      }
    },
    fetchAPIQuotaFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
      state.status = 'offline'
    },
  },
})

export const {
  fetchAPIQuotaStart,
  fetchAPIQuotaSuccess,
  fetchAPIQuotaFailure,
} = apiQuotaSlice.actions

export default apiQuotaSlice.reducer
