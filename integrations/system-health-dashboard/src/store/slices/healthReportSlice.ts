import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface HealthCheck {
  category: string
  check: string
  status: string
  severity: string
  message: string
  timestamp: string
  details?: any
  recommendation?: string
  auto_heal?: boolean
  auto_heal_action?: string
}

interface HealthViolation {
  category: string
  check: string
  status: string
  severity: string
  message: string
  timestamp: string
  details?: any
  recommendation?: string
  auto_heal?: boolean
  auto_heal_action?: string
}

interface HealthReport {
  version: string
  timestamp: string
  overallStatus: string
  summary: {
    total_checks: number
    passed: number
    violations: number
    by_severity: {
      info: number
      warning: number
      error: number
      critical: number
    }
  }
  checks: HealthCheck[]
  violations: HealthViolation[]
  recommendations: string[]
  metadata: {
    verification_duration_ms: number
    rules_version: string
    last_verification: string | null
  }
}

interface HealthReportState {
  report: HealthReport | null
  loading: boolean
  error: string | null
}

const initialState: HealthReportState = {
  report: null,
  loading: false,
  error: null,
}

const healthReportSlice = createSlice({
  name: 'healthReport',
  initialState,
  reducers: {
    fetchHealthReportStart(state) {
      state.loading = true
      state.error = null
    },
    fetchHealthReportSuccess(state, action: PayloadAction<HealthReport>) {
      state.report = action.payload
      state.loading = false
      state.error = null
    },
    fetchHealthReportFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
    },
  },
})

export const {
  fetchHealthReportStart,
  fetchHealthReportSuccess,
  fetchHealthReportFailure,
} = healthReportSlice.actions

export default healthReportSlice.reducer
