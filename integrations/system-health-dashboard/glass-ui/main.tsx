// glass-ui/main.tsx — the reduced dashboard entry glass's daemon serves.
//
// Token Usage and the per-session context view, built from the dashboard's own
// components (see .planning/glass.md, G4). Built into the generated glass tree
// by scripts/glass/extract.mjs; never served by coding.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import performanceReducer from '@/store/slices/performanceSlice'
import { initTheme } from '@/lib/theme'
import '@/index.css'
import { GlassApp } from './app'

initTheme()

// A tab left open across `glass update` still runs the old build, whose lazy
// chunks (the Cost tab) have hashed names the new daemon no longer serves: the
// import fails and the page goes blank. Reload into the new build instead — once
// per minute at most, so a chunk that is really missing cannot loop the page.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'glass-reloaded-for-update'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* storage blocked */ }
  event.preventDefault()
  window.location.reload()
})

// Only the slice the reused components read — none of coding's health / ukb
// polling middleware, whose endpoints glass does not have.
const store = configureStore({ reducer: { performance: performanceReducer } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <GlassApp />
    </Provider>
  </React.StrictMode>,
)
