import { Provider } from 'react-redux'
import { store } from './store'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SystemHealthDashboard from './components/system-health-dashboard'
import { LslSessionsPage } from './pages/lsl-sessions'
import { ObservationsPage } from './pages/observations'
import { DigestsPage } from './pages/digests'
import { InsightsPage } from './pages/insights'
import { CoveragePage } from './pages/coverage'
import { TokenUsagePage } from './pages/token-usage'
import { PerformancePage } from './pages/performance'
import { TimelineFullscreen } from './components/performance/timeline-fullscreen'
import { NavBar } from './components/nav-bar'
import { useEffect } from 'react'
import { healthRefreshManager } from './store/middleware/healthRefreshMiddleware'
import { initializeWorkflowConfig } from './store/slices/workflowConfigSlice'
import { fetchFeatures } from './store/slices/featuresSlice'
import { FeaturesPage } from './pages/features'
import { gated } from './components/feature-disabled'

const GatedSessions = gated('lsl', 'Verbatim session transcripts are not being recorded, so there are no sessions to list.', LslSessionsPage)
const GatedObservations = gated('observations', 'The observation pipeline is not running, so nothing is being captured.', ObservationsPage)
const GatedDigests = gated('observations', 'Digests are produced by the observation pipeline, which is not running.', DigestsPage)
const GatedInsights = gated('observations', 'Insights are produced by the observation pipeline, which is not running.', InsightsPage)
const GatedCoverage = gated('knowledge', 'Coverage is computed from the knowledge base, which is not running.', CoveragePage)
const GatedTokenUsage = gated('llm-proxy', 'Token accounting comes from the LLM proxy, which is not running.', TokenUsagePage)
const GatedPerformance = gated('performance', 'Measurement, experiments and benchmarks are not running.', PerformancePage)

function AppContent() {
  useEffect(() => {
    healthRefreshManager.startAutoRefresh()
    store.dispatch(initializeWorkflowConfig())
    // Which tabs and tiles exist at all. Fetched once at mount; the editor
    // refreshes it after every save.
    store.dispatch(fetchFeatures())
    return () => { healthRefreshManager.stopAutoRefresh() }
  }, [])

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<SystemHealthDashboard />} />
        {/* Routes stay registered when their feature is off — the nav tab is
            gone, but a bookmark or a history entry must land on an explanation
            rather than an empty page that looks broken. */}
        <Route path="/sessions" element={<GatedSessions />} />
        <Route path="/observations" element={<GatedObservations />} />
        <Route path="/digests" element={<GatedDigests />} />
        <Route path="/insights" element={<GatedInsights />} />
        <Route path="/coverage" element={<GatedCoverage />} />
        <Route path="/token-usage" element={<GatedTokenUsage />} />
        <Route path="/performance" element={<GatedPerformance />} />
        <Route path="/features" element={<FeaturesPage />} />
        {/* Fullscreen whole-run timeline (D-02) — routed child of Performance. */}
        <Route path="/performance/timeline/:taskId" element={<TimelineFullscreen />} />
      </Routes>
    </>
  )
}

function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </Provider>
  )
}

export default App
