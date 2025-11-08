import { Provider } from 'react-redux'
import { store } from './store'
import SystemHealthDashboard from './components/system-health-dashboard'
import { useEffect } from 'react'
import { healthRefreshManager } from './store/middleware/healthRefreshMiddleware'

function App() {
  useEffect(() => {
    // Initialize health refresh manager when app mounts
    console.log('🚀 App mounted, health refresh manager initialized')

    // Cleanup on unmount
    return () => {
      console.log('🛑 App unmounting, cleaning up')
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
