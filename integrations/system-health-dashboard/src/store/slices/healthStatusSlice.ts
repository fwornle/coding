import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface HealthStatusState {
  overallStatus: 'healthy' | 'degraded' | 'unhealthy' | 'offline'
  violationCount: number
  criticalCount: number
  lastUpdate: string | null
  lastFetch: string | null  // When we last fetched data from the API
  autoHealingActive: boolean
  status: 'operational' | 'stale' | 'error' | 'offline'
  ageMs: number
  loading: boolean
  error: string | null
}

const initialState: HealthStatusState = {
  overallStatus: 'offline',
  violationCount: 0,
  criticalCount: 0,
  lastUpdate: null,
  lastFetch: null,
  autoHealingActive: false,
  status: 'offline',
  ageMs: 0,
  loading: false,
  error: null,
}

const healthStatusSlice = createSlice({
  name: 'healthStatus',
  initialState,
  reducers: {
    fetchHealthStatusStart(state) {
      state.loading = true
      state.error = null
    },
    fetchHealthStatusSuccess(state, action: PayloadAction<Partial<Omit<HealthStatusState, 'loading' | 'error' | 'lastFetch'>>>) {
      state.overallStatus = action.payload.overallStatus || state.overallStatus || 'offline'
      state.violationCount = action.payload.violationCount ?? state.violationCount
      state.criticalCount = action.payload.criticalCount ?? state.criticalCount
      state.lastUpdate = action.payload.lastUpdate ?? state.lastUpdate
      state.lastFetch = new Date().toISOString()  // Track when we fetched
      state.autoHealingActive = action.payload.autoHealingActive ?? state.autoHealingActive
      state.status = action.payload.status || state.status || 'offline'
      state.ageMs = action.payload.ageMs ?? state.ageMs
      state.loading = false
      state.error = null
    },
    fetchHealthStatusFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
      state.status = 'error'
    },
  },
})

export const {
  fetchHealthStatusStart,
  fetchHealthStatusSuccess,
  fetchHealthStatusFailure,
} = healthStatusSlice.actions

export default healthStatusSlice.reducer
