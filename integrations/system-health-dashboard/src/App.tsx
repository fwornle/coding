import { Provider } from 'react-redux'
import { store } from './store'
import SystemHealthDashboard from './components/system-health-dashboard'
import { useEffect } from 'react'
import { healthRefreshManager } from './store/middleware/healthRefreshMiddleware'
import { initializeWorkflowConfig } from './store/slices/workflowConfigSlice'

function App() {
  useEffect(() => {
    // Start/restart health refresh manager when app mounts
    // This handles React StrictMode double-mount and HMR
    healthRefreshManager.startAutoRefresh()

    // Initialize workflow config from API (with fallback to constants)
    store.dispatch(initializeWorkflowConfig())

    return () => {
      healthRefreshManager.stopAutoRefresh()
    }
  }, [])

  return (
    <Provider store={store}>
      <SystemHealthDashboard />
    </Provider>
  )
}

export default App
