import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// Phase 34 (D-11): proxy slice forwarded from health-coordinator's
// state.proxy via the dashboard's /api/health-verifier/status reverse-
// proxy. Typed loosely (any) here on purpose — the slice's internal
// shape evolves with the coordinator's pollProxySemantic / FSM and we
// don't want a dashboard-side type sync to gate every coordinator-side
// schema tweak. Consumers narrow at usage site (see getProxyHealthItems
// in system-health-dashboard.tsx).
interface ProxyHealth {
  semantic_ok?: boolean | null
  last_round_trip_ms?: number | null
  networkMode?: 'vpn' | 'corporate' | 'public' | 'unknown' | null
  auto_heal_status?: 'healthy' | 'kickstart_pending' | 'cooldown' | 'disabled' | null
  kickstart_count?: number
  kickstart_timestamps?: number[]
  consecutive_failures?: number
  reason?: string | null
}

interface NetworkHealth {
  internet_reachable?: boolean | null
  proxy_running?: boolean | null
  proxy_functional?: boolean | null
  location?: 'corporate' | 'vpn' | 'public' | 'unknown' | null
}

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
  proxy: ProxyHealth | null
  network: NetworkHealth | null
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
  proxy: null,
  network: null,
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
      // Phase 34 (D-11): replace, don't merge — when coordinator marks the
      // slice null (e.g. proxy unreachable), we want the dashboard card to
      // see null too, not the previous successful read.
      state.proxy = action.payload.proxy ?? null
      state.network = action.payload.network ?? null
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
