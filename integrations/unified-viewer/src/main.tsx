// PATTERN SOURCE: integrations/system-health-dashboard/src/main.tsx:1-10
// + 45-PATTERNS.md § main.tsx (QueryClient defaults)
//
// React.StrictMode + QueryClientProvider (staleTime 30s, refetchOnWindowFocus true).
// No Redux Provider — Zustand stores are provider-less.

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
