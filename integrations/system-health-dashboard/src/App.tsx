import { Provider } from 'react-redux'
import { store } from './store'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SystemHealthDashboard from './components/system-health-dashboard'
import { ObservationsPage } from './pages/observations'
import { DigestsPage } from './pages/digests'
import { InsightsPage } from './pages/insights'
import { NavBar } from './components/nav-bar'
import { useEffect } from 'react'
import { healthRefreshManager } from './store/middleware/healthRefreshMiddleware'
import { initializeWorkflowConfig } from './store/slices/workflowConfigSlice'

function AppContent() {
  useEffect(() => {
    healthRefreshManager.startAutoRefresh()
    store.dispatch(initializeWorkflowConfig())
    return () => { healthRefreshManager.stopAutoRefresh() }
  }, [])

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<SystemHealthDashboard />} />
        <Route path="/observations" element={<ObservationsPage />} />
        <Route path="/digests" element={<DigestsPage />} />
        <Route path="/insights" element={<InsightsPage />} />
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
