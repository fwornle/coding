import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface UKBProcess {
  pid: number
  workflowName: string
  team: string
  repositoryPath: string
  startTime: string
  lastHeartbeat: string
  status: string
  completedSteps: number
  totalSteps: number
  currentStep: string | null
  logFile: string | null
  isAlive: boolean
  health: 'healthy' | 'stale' | 'frozen' | 'dead'
  heartbeatAgeSeconds: number
  progressPercent: number
}

interface UKBState {
  loading: boolean
  error: string | null
  running: number
  stale: number
  frozen: number
  total: number
  processes: UKBProcess[]
  config: {
    staleThresholdSeconds: number
    frozenThresholdSeconds: number
    maxConcurrent: number
  }
  lastUpdate: string | null
}

const initialState: UKBState = {
  loading: false,
  error: null,
  running: 0,
  stale: 0,
  frozen: 0,
  total: 0,
  processes: [],
  config: {
    staleThresholdSeconds: 120,
    frozenThresholdSeconds: 300,
    maxConcurrent: 3,
  },
  lastUpdate: null,
}

const ukbSlice = createSlice({
  name: 'ukb',
  initialState,
  reducers: {
    fetchUKBStatusStart(state) {
      state.loading = true
      state.error = null
    },
    fetchUKBStatusSuccess(state, action: PayloadAction<any>) {
      state.loading = false
      state.error = null
      state.running = action.payload.summary?.running || action.payload.running || 0
      state.stale = action.payload.summary?.stale || action.payload.stale || 0
      state.frozen = action.payload.summary?.frozen || action.payload.frozen || 0
      state.total = action.payload.summary?.total || action.payload.total || 0
      state.processes = action.payload.processes || []
      if (action.payload.config) {
        state.config = action.payload.config
      }
      state.lastUpdate = action.payload.lastUpdate || new Date().toISOString()
    },
    fetchUKBStatusFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
    },
  },
})

export const {
  fetchUKBStatusStart,
  fetchUKBStatusSuccess,
  fetchUKBStatusFailure,
} = ukbSlice.actions

export default ukbSlice.reducer
