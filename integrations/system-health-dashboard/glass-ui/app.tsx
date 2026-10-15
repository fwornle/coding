import { useEffect, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Moon, Sun, Monitor } from 'lucide-react'
import { TokenUsagePage } from '@/pages/token-usage'
import { cycleTheme, getStoredTheme, setTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { SessionsPage } from './sessions'
import { ModelsPage } from './models'
import { OffloadPill, OffloadProvider, useOffload } from './offload'

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor }

function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme())
  const Icon = THEME_ICON[theme]
  return (
    <button
      className="rounded p-1.5 text-muted-foreground hover:bg-muted"
      title={`Theme: ${theme}`}
      onClick={() => { const next = cycleTheme(theme); setTheme(next); setThemeState(next) }}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

function Version() {
  const [v, setV] = useState('')
  useEffect(() => {
    fetch('/health').then((r) => r.json()).then((h) => setV(h?.glass ?? '')).catch(() => setV(''))
  }, [])
  return v ? <span className="text-xs text-muted-foreground">v{v}</span> : null
}

const tab = ({ isActive }: { isActive: boolean }) =>
  cn('px-3 py-1.5 text-sm rounded-md', isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')

function TokenUsage() {
  const { openSettings } = useOffload()
  return <TokenUsagePage proxyBase="" tabs={['overview', 'evolution', 'recent']} settings={false} onSettings={openSettings} />
}

export function GlassApp() {
  return (
    <OffloadProvider>
      <HashRouter>
        <div className="min-h-screen bg-background text-foreground">
          <header className="flex items-center gap-4 border-b px-6 h-12">
            <span className="font-semibold tracking-tight">glass</span>
            <Version />
            <nav className="flex gap-1">
              <NavLink to="/token-usage" className={tab}>Token Usage</NavLink>
              <NavLink to="/models" className={tab}>Models</NavLink>
              <NavLink to="/sessions" className={tab}>Sessions</NavLink>
            </nav>
            <div className="ml-auto flex items-center gap-2"><OffloadPill /><ThemeToggle /></div>
          </header>
          <Routes>
            <Route path="/token-usage" element={<TokenUsage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="*" element={<Navigate to="/token-usage" replace />} />
          </Routes>
        </div>
      </HashRouter>
    </OffloadProvider>
  )
}
