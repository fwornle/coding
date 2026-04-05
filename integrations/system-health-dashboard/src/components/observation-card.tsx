import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { AgentBadge } from '@/components/agent-badge'

const AGENT_BORDER_COLORS: Record<string, string> = {
  claude: 'border-l-blue-500',
  copilot: 'border-l-green-500',
  opencode: 'border-l-cyan-500',
  mastra: 'border-l-fuchsia-500',
}

interface Observation {
  id: string
  content: string
  agent: string
  project: string
  sessionId: string
  timestamp: string
  source: string
}

interface ObservationCardProps {
  observation: Observation
  isExpanded: boolean
  onToggle: () => void
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function getSummary(content: string, maxLen = 120): string {
  const firstLine = content.split('\n')[0]
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen) + '...'
}

export function ObservationCard({ observation, isExpanded, onToggle }: ObservationCardProps) {
  const borderColor = AGENT_BORDER_COLORS[observation.agent] || 'border-l-blue-500'

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <Card
        className={`transition-colors ${
          isExpanded
            ? `bg-accent border-l-[3px] ${borderColor}`
            : 'hover:bg-accent/50'
        }`}
      >
        <CollapsibleTrigger asChild>
          <div className="px-4 py-3 cursor-pointer">
            <div className="flex items-center gap-3 mb-1">
              <AgentBadge agent={observation.agent} />
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(observation.timestamp)}
              </span>
              <span className="text-xs text-muted-foreground">
                {observation.project}
              </span>
            </div>
            {!isExpanded && (
              <p className="text-sm text-foreground/80 truncate">
                {getSummary(observation.content)}
              </p>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="whitespace-pre-wrap text-sm">
              {observation.content}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
