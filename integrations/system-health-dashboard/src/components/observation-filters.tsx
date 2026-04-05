import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

const ALL_AGENTS = ['claude', 'copilot', 'opencode', 'mastra'] as const

export interface FilterState {
  agents: string[]
  from: string
  to: string
  project: string
  q: string
}

interface ObservationFiltersProps {
  filters: FilterState
  onApply: (filters: FilterState) => void
}

function getDefaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

function getDefaultTo(): string {
  return new Date().toISOString().split('T')[0]
}

export function getDefaultFilters(): FilterState {
  return {
    agents: [...ALL_AGENTS],
    from: getDefaultFrom(),
    to: getDefaultTo(),
    project: '',
    q: '',
  }
}

export function ObservationFilters({ filters, onApply }: ObservationFiltersProps) {
  const [local, setLocal] = useState<FilterState>(filters)
  const [projects, setProjects] = useState<string[]>([])

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/observations/projects`)
      .then(r => r.json())
      .then((data: string[]) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    setLocal(filters)
  }, [filters])

  const toggleAgent = (agent: string) => {
    setLocal(prev => ({
      ...prev,
      agents: prev.agents.includes(agent)
        ? prev.agents.filter(a => a !== agent)
        : [...prev.agents, agent],
    }))
  }

  const handleApply = () => {
    onApply(local)
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <Input
          placeholder="Search observations..."
          value={local.q}
          onChange={e => setLocal(prev => ({ ...prev, q: e.target.value }))}
        />
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Agents</h3>
        {ALL_AGENTS.map(agent => (
          <div key={agent} className="flex items-center gap-2">
            <Checkbox
              id={`agent-${agent}`}
              checked={local.agents.includes(agent)}
              onCheckedChange={() => toggleAgent(agent)}
            />
            <label htmlFor={`agent-${agent}`} className="text-sm cursor-pointer">
              {agent}
            </label>
          </div>
        ))}
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Time Range</h3>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">From</label>
          <Input
            type="date"
            value={local.from}
            onChange={e => setLocal(prev => ({ ...prev, from: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">To</label>
          <Input
            type="date"
            value={local.to}
            onChange={e => setLocal(prev => ({ ...prev, to: e.target.value }))}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Project</h3>
        <Select
          value={local.project || '__all__'}
          onValueChange={val => setLocal(prev => ({ ...prev, project: val === '__all__' ? '' : val }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All projects</SelectItem>
            {projects.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <Button className="w-full" onClick={handleApply}>
        Apply Filters
      </Button>
    </div>
  )
}
