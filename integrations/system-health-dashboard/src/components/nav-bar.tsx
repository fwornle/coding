import { Link, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor, SlidersHorizontal } from 'lucide-react'
import { type Theme, getStoredTheme, cycleTheme } from '@/lib/theme'
import { useAppSelector } from '@/store'
import type { FeatureId } from '@/store/slices/featuresSlice'

function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme())
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'
  return (
    <button
      type="button"
      onClick={() => setThemeState(cycleTheme(theme))}
      title={`Theme: ${label} (click to change)`}
      aria-label={`Theme: ${label}. Click to change.`}
      className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

// Same-origin /api/* — matches the performanceSlice thunks (WR-05). The dashboard's
// static-server reverse-proxies /api/* to the Health API, so badge counts survive
// behind a reverse proxy / non-local host instead of hardcoding http://localhost:3033.

export function NavBar() {
  const location = useLocation()
  const [obsCount, setObsCount] = useState<number | null>(null)
  const [digestCount, setDigestCount] = useState<number | null>(null)
  const [insightCount, setInsightCount] = useState<number | null>(null)
  const features = useAppSelector(state => state.features.features)

  useEffect(() => {
    fetch(`/api/observations?limit=0`)
      .then(r => r.json())
      .then(d => setObsCount(d.total ?? null))
      .catch(() => setObsCount(null))

    fetch(`/api/consolidation/status`)
      .then(r => r.json())
      .then(d => {
        setDigestCount(d.totalDigests ?? null)
        setInsightCount(d.totalInsights ?? null)
      })
      .catch(() => { setDigestCount(null); setInsightCount(null) })
  }, [location.pathname])

  // Tabs for disabled features are OMITTED, not greyed. A greyed nav item that
  // routes nowhere is worse than no item: it invites a click that goes to a
  // dead page. The route still resolves (see App.tsx) and renders an
  // explanation, so a bookmarked URL is not a mystery either — and the Features
  // tab below is always present, so there is always a way back.
  const allTabs: Array<{
    label: string; path: string; testId?: string; count?: number | null; feature?: FeatureId
  }> = [
    { label: 'Health', path: '/', feature: 'health' },
    { label: 'Sessions', path: '/sessions', testId: 'sessions-tab', feature: 'lsl' },
    { label: 'Observations', path: '/observations', count: obsCount, feature: 'observations' },
    { label: 'Digests', path: '/digests', count: digestCount, feature: 'observations' },
    { label: 'Insights', path: '/insights', count: insightCount, feature: 'observations' },
    { label: 'Coverage', path: '/coverage', feature: 'knowledge' },
    { label: 'Token Usage', path: '/token-usage', feature: 'llm-proxy' },
    { label: 'Performance', path: '/performance', testId: 'performance-tab', feature: 'performance' },
  ]

  const tabs = allTabs.filter(tab => !tab.feature || features[tab.feature]?.enabled !== false)

  return (
    <nav className="border-b border-border px-6">
      <div className="flex items-center gap-6 h-12">
        {tabs.map(tab => {
          const isActive = location.pathname === tab.path ||
            (tab.path !== '/' && location.pathname.startsWith(tab.path))
          return (
            <Link
              key={tab.path}
              to={tab.path}
              data-testid={tab.testId}
              className={`relative h-full flex items-center gap-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count != null && (
                <Badge variant="secondary" className="text-xs">
                  {tab.count}
                </Badge>
              )}
            </Link>
          )
        })}
        <div className="ml-auto flex items-center gap-1">
          <Link
            to="/features"
            data-testid="features-tab"
            title="Choose which parts of coding are active"
            aria-label="Features"
            className={`flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
              location.pathname === '/features'
                ? 'text-foreground bg-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}
