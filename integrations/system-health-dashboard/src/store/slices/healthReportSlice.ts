import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface HealthCheck {
  category: string
  check: string
  status: string
  severity: string
  message: string
  timestamp: string
  /**
   * The producing check's own explanation, carried verbatim from the health
   * coordinator (server.js maps `state.processes[].detail` onto this).
   *
   * Distinct from `details`, the free-form object. This is the one-line human
   * sentence — "Active consolidation (PID 81604)". Until it existed the only
   * thing a tile could render was the template `"<name> <status>"`, and one
   * tile filled that gap with a hardcoded string that contradicted its own
   * status badge for as long as it was wrong.
   */
  detail?: string
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
