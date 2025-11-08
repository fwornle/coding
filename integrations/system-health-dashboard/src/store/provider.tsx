'use client'

import React, { useEffect } from 'react'
import { Provider } from 'react-redux'
import { store } from './index'
import { healthRefreshManager } from './middleware/healthRefreshMiddleware'

interface ReduxProviderProps {
  children: React.ReactNode
}

export function ReduxProvider({ children }: ReduxProviderProps) {
  useEffect(() => {
    // Initialize health refresh manager when provider mounts
    console.log('🚀 Redux Provider mounted, initializing health refresh manager')

    // Set up error boundary for Redux errors
    const handleReduxError = (error: ErrorEvent) => {
      console.error('Redux Error:', error)
      // Could dispatch error action here if needed
    }

    window.addEventListener('error', handleReduxError)

    // Cleanup on unmount
    return () => {
      console.log('🛑 Redux Provider unmounting, cleaning up')
      healthRefreshManager.stopAutoRefresh()
      window.removeEventListener('error', handleReduxError)
    }
  }, [])

  return <Provider store={store}>{children}</Provider>
}

// Hook to access the store instance (useful for debugging)
export const useReduxStore = () => store

// Development helper to expose store globally in dev mode
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  ;(window as any).__REDUX_STORE__ = store
}
