import { Link, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { useEffect, useState } from 'react'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

export function NavBar() {
  const location = useLocation()
  const [obsCount, setObsCount] = useState<number | null>(null)

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/observations?limit=0`)
      .then(r => r.json())
      .then(d => setObsCount(d.total ?? null))
      .catch(() => setObsCount(null))
  }, [location.pathname])

  const tabs = [
    { label: 'Health', path: '/' },
    { label: 'Observations', path: '/observations', count: obsCount },
  ]

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
      </div>
    </nav>
  )
}
