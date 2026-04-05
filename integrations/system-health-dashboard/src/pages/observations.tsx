import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Eye, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ObservationCard } from '@/components/observation-card'
import { ObservationFilters, getDefaultFilters } from '@/components/observation-filters'
import type { FilterState } from '@/components/observation-filters'
import { PaginationBar } from '@/components/pagination-bar'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`
const PAGE_SIZE = 50
const REFRESH_INTERVAL = 30_000

interface Observation {
  id: string
  content: string
  agent: 'claude' | 'copilot' | 'opencode' | 'mastra'
  project: string
  sessionId: string
  timestamp: string
  source: string
}

interface ObservationResponse {
  data: Observation[]
  total: number
  limit: number
  offset: number
}

function buildQueryString(filters: FilterState, page: number): string {
  const params = new URLSearchParams()
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String((page - 1) * PAGE_SIZE))

  if (filters.agents.length > 0 && filters.agents.length < 4) {
    filters.agents.forEach(a => params.append('agent', a))
  }
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to.includes('T') ? filters.to : `${filters.to}T23:59:59.999Z`)
  if (filters.project) params.set('project', filters.project)
  if (filters.q) params.set('q', filters.q)

  return params.toString()
}

function hasActiveFilters(filters: FilterState): boolean {
  const defaults = getDefaultFilters()
  return (
    filters.agents.length !== defaults.agents.length ||
    filters.project !== '' ||
    filters.q !== ''
  )
}

export function ObservationsPage() {
  const [filters, setFilters] = useState<FilterState>(getDefaultFilters())
  const [observations, setObservations] = useState<Observation[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchObservations = useCallback(async (f: FilterState, p: number, isAutoRefresh = false) => {
    if (!isAutoRefresh) setLoading(true)
    setFetching(true)
    setError(null)

    try {
      const qs = buildQueryString(f, p)
      const res = await fetch(`${API_BASE_URL}/api/observations?${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ObservationResponse = await res.json()
      setObservations(data.data || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError('Failed to load observations. Check that the health API is running on port 3033.')
      if (!isAutoRefresh) {
        setObservations([])
        setTotal(0)
      }
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchObservations(filters, page)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh polling
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchObservations(filters, page, true)
    }, REFRESH_INTERVAL)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [filters, page, fetchObservations])

  const handleApplyFilters = (newFilters: FilterState) => {
    setPage(1)
    setFilters(newFilters)
    setSidebarOpen(false)
    fetchObservations(newFilters, 1)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    setExpandedId(null)
    fetchObservations(filters, newPage)
  }

  const handleRefresh = () => {
    fetchObservations(filters, page)
  }

  const handleToggle = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const isFiltered = hasActiveFilters(filters)

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h1 className="text-xl font-semibold">Observations</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRefresh} aria-label="Refresh observations">
            <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin text-muted-foreground' : ''}`} />
          </Button>
          {/* Mobile filter toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - desktop always visible, mobile toggleable */}
        <aside
          className={`w-[280px] shrink-0 border-r border-border overflow-y-auto ${
            sidebarOpen ? 'block' : 'hidden'
          } lg:block`}
        >
          <ObservationFilters filters={filters} onApply={handleApplyFilters} />
        </aside>

        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ marginLeft: '0' }}>
          {/* Error state */}
          {error && (
            <div className="px-6 pt-4">
              <Alert variant="destructive">
                <AlertDescription>
                  {error}
                  <Button variant="ghost" size="sm" className="ml-2" onClick={handleRefresh}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Loading state */}
          {loading && !error && (
            <div className="px-6 py-4 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 w-full rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && observations.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <Eye className="h-12 w-12 text-muted-foreground mx-auto" />
                <h2 className="text-lg font-medium">
                  {isFiltered ? 'No matching observations' : 'No observations yet'}
                </h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {isFiltered
                    ? 'Try adjusting the filters or search terms to find what you are looking for.'
                    : 'Observations will appear here as coding sessions generate them. Start a session with `coding --claude` to begin.'}
                </p>
              </div>
            </div>
          )}

          {/* Observation list */}
          {!loading && !error && observations.length > 0 && (
            <>
              <ScrollArea className="flex-1">
                <div className="px-6 py-4 space-y-2">
                  {observations.map(obs => (
                    <ObservationCard
                      key={obs.id}
                      observation={obs}
                      isExpanded={expandedId === obs.id}
                      onToggle={() => handleToggle(obs.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
              <div className="border-t border-border px-6">
                <PaginationBar
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
