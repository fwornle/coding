import { Provider } from 'react-redux'
import { store } from './store'
import SystemHealthDashboard from './components/system-health-dashboard'
import { useEffect } from 'react'
import { healthRefreshManager } from './store/middleware/healthRefreshMiddleware'

function App() {
  useEffect(() => {
    // Start/restart health refresh manager when app mounts
    // This handles React StrictMode double-mount and HMR
    healthRefreshManager.startAutoRefresh()

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
