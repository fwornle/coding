import { Badge } from '@/components/ui/badge'

const AGENT_COLORS = {
  claude:   { dot: 'bg-blue-500',    badge: 'bg-blue-500/10 text-blue-500' },
  copilot:  { dot: 'bg-green-500',   badge: 'bg-green-500/10 text-green-500' },
  opencode: { dot: 'bg-cyan-500',    badge: 'bg-cyan-500/10 text-cyan-500' },
  mastra:   { dot: 'bg-fuchsia-500', badge: 'bg-fuchsia-500/10 text-fuchsia-500' },
} as const

type AgentType = keyof typeof AGENT_COLORS

export function AgentBadge({ agent }: { agent: string }) {
  const colors = AGENT_COLORS[agent as AgentType] || AGENT_COLORS.claude
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${colors.dot}`} />
      <Badge variant="secondary" className={`text-xs font-normal ${colors.badge} border-0`}>
        {agent}
      </Badge>
    </span>
  )
}
