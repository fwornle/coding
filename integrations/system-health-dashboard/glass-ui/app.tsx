import { useCallback, useEffect, useMemo, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Moon, Sun, Monitor } from 'lucide-react'
import { TokenUsagePage } from '@/pages/token-usage'
import type { SourcesControl } from '@/components/cost/account-selection'
import { cycleTheme, getStoredTheme, setTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { SessionsPage } from './sessions'
import { ModelsPage } from './models'
import { OffloadPill, OffloadProvider, useOffload } from './offload'

// glass records only the sessions it launched — plus, where coding is installed
// and the Accounts dialog includes it, the calls coding's proxy records on this
// machine. GitHub's Copilot budget counts the whole login — the VS Code plugin,
// other tools, other machines — so the figures differ by design, and the page
// says so rather than look wrong.
const BUDGET_NOTE = 'GitHub counts every use of the account — github.com, other tools and machines too — so its own figure on the Copilot tile is the whole of it.'

// What the figures cover, from the sources the Accounts dialog includes.
function coverage(coding: boolean, vscode: boolean): { short: string; long: string } {
  const short = ['glass', coding && 'coding', vscode && 'VS Code chat'].filter(Boolean)
  const long = [
    'calls made by agents launched with glass',
    coding && 'the calls coding records on this machine',
    vscode && "VS Code's Copilot Chat here (estimated from its chat history)",
  ].filter(Boolean) as string[]
  const listed = long.length > 1 ? `${long.slice(0, -1).join(', ')} and ${long[long.length - 1]}` : long[0]
  return {
    short: short.length === 1 ? 'glass sessions' : short.join(' + '),
    long: `These figures cover ${listed}${coding ? ', each counted once' : ''}. ${BUDGET_NOTE}`,
  }
}

interface SourcesView {
  coding?: { found: boolean; included: boolean }
  vscode?: { found: boolean; included: boolean }
}

const WRITE_HEADERS = { 'x-glass-ui': '1' }

// The other figures the views can add, each offered only where it exists on this
// machine: coding's token DB, and VS Code's Copilot Chat once glass has read it.
function useSources(): { control: SourcesControl; coding: boolean; vscode: boolean } {
  const [view, setView] = useState<SourcesView>({})
  useEffect(() => {
    fetch('/api/glass/sources').then((r) => (r.ok ? r.json() : {})).then(setView).catch(() => setView({}))
  }, [])
  const save = useCallback(async (included: Record<string, boolean>) => {
    const body = Object.fromEntries(['coding', 'vscode'].filter((k) => k in included).map((k) => [k, Boolean(included[k])]))
    const r = await fetch('/api/glass/sources', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...WRITE_HEADERS },
      body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
    setView(j ?? {})
  }, [])
  const { coding, vscode } = view
  const control = useMemo<SourcesControl>(() => ({
    items: [
      ...(coding?.found
        ? [{ id: 'coding', label: "coding's figures", detail: "Calls coding's proxy records on this machine — its own work and agents started without glass. Calls both record count once.", included: coding.included }]
        : []),
      ...(vscode?.found
        ? [{ id: 'vscode', label: "VS Code's Copilot Chat", detail: "Requests read from VS Code's chat history on this machine — estimated, since it keeps no cache split (it read 21% low against Copilot's charge).", included: vscode.included }]
        : []),
    ],
    save,
  }), [coding, vscode, save])
  return { control, coding: Boolean(coding?.included), vscode: Boolean(vscode?.included) }
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
  const sources = useSources()
  return (
    <TokenUsagePage
      proxyBase="" tabs={['overview', 'evolution', 'cost', 'recent']} settings={false} onSettings={openSettings}
      coverage={coverage(sources.coding, sources.vscode)}
      sources={sources.control} writeHeaders={WRITE_HEADERS}
    />
  )
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
