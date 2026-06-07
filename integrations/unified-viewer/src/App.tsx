// PATTERN SOURCE: integrations/system-health-dashboard/src/App.tsx:37-45
// + 45-PATTERNS.md § App.tsx (route map per D-45-02)
//
// React Router 7 shell:
//   /                 -> Navigate to /viewer/coding
//   /viewer/:system   -> UnifiedViewer (validates :system, mounts ViewerCore key={system})
//   *                 -> UnknownSystem 404 page
//
// NO Provider wrap (Zustand is provider-less; QueryClientProvider already wraps in main.tsx).

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { UnifiedViewer } from './routes/UnifiedViewer'
import { UnknownSystem } from './routes/UnknownSystem'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/viewer/coding" replace />} />
        <Route path="/viewer/:system" element={<UnifiedViewer />} />
        <Route path="*" element={<UnknownSystem />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
