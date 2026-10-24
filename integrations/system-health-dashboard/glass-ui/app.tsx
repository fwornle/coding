import { useEffect, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Moon, Sun, Monitor } from 'lucide-react'
import { TokenUsagePage } from '@/pages/token-usage'
import { cycleTheme, getStoredTheme, setTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { SessionsPage } from './sessions'
import { ModelsPage } from './models'
import { OffloadPill, OffloadProvider, useOffload } from './offload'

// glass records only the sessions it launched. GitHub's Copilot budget counts the
// whole login — the VS Code plugin, other tools, other machines — so the two
// figures differ by design, and the page says so rather than look wrong.
const GLASS_COVERAGE = {
  short: 'glass sessions only',
  long: 'These figures cover calls made by agents launched with glass. A GitHub Copilot budget counts every use of the account — IDE plugins, other tools and machines — so GitHub shows more.',
}

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

// "glass" links to the online docs' presentation once the daemon names it (/health docs).
function Brand() {
  const [h, setH] = useState<{ glass?: string; docs?: string | null }>({})
  useEffect(() => {
    fetch('/health').then((r) => r.json()).then((x) => setH(x ?? {})).catch(() => setH({}))
  }, [])
  const name = <span className="font-semibold tracking-tight">glass</span>
  return (
    <>
      {h.docs
        ? <a href={h.docs} target="_blank" rel="noopener noreferrer" title="glass documentation" className="hover:underline underline-offset-4">{name}</a>
        : name}
      {h.glass ? <span className="text-xs text-muted-foreground">v{h.glass}</span> : null}
    </>
  )
}

const tab = ({ isActive }: { isActive: boolean }) =>
  cn('px-3 py-1.5 text-sm rounded-md', isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')

function TokenUsage() {
  const { openSettings } = useOffload()
  return <TokenUsagePage proxyBase="" tabs={['overview', 'evolution', 'cost', 'recent']} settings={false} onSettings={openSettings} coverage={GLASS_COVERAGE} />
}

export function GlassApp() {
  return (
    <OffloadProvider>
      <HashRouter>
        <div className="min-h-screen bg-background text-foreground">
          <header className="flex items-center gap-4 border-b px-6 h-12">
            <Brand />
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
