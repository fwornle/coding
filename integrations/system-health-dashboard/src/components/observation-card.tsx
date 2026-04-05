import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { AgentBadge } from '@/components/agent-badge'

const AGENT_BORDER_COLORS: Record<string, string> = {
  claude: 'border-l-blue-500',
  copilot: 'border-l-green-500',
  opencode: 'border-l-cyan-500',
  mastra: 'border-l-fuchsia-500',
}

interface LlmTokens {
  input: number
  output: number
  total: number
}

export interface Observation {
  id: string
  content: string
  agent: string
  project: string
  sessionId: string
  timestamp: string
  source: string
  llmModel?: string
  llmProvider?: string
  llmTokens?: string | LlmTokens | null
  llmLatencyMs?: number | null
}

interface ObservationCardProps {
  observation: Observation
  isExpanded: boolean
  onToggle: () => void
  compact?: boolean
}

function formatTimestamp(iso: string, short = false): string {
  try {
    const d = new Date(iso)
    if (short) {
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
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
  // Strip markdown formatting for preview
  const clean = content.replace(/^#{1,3}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1')
  const firstLine = clean.split('\n').find(l => l.trim().length > 0) || ''
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen) + '...'
}

/** Render basic markdown to HTML (bold, headers, inline code, backtick blocks) */
function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<strong class="text-sm">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong class="text-base">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong class="text-lg">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">$1</code>')
    .replace(/^- /gm, '• ')
}

function formatLlmTag(obs: Observation): string | null {
  if (!obs.llmModel && !obs.llmProvider) return null
  const model = obs.llmModel || '?'
  const provider = obs.llmProvider || '?'
  return `${model}@${provider}`
}

function parseTokens(raw: string | LlmTokens | null | undefined): LlmTokens | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw
}

export function ObservationCard({ observation, isExpanded, onToggle, compact }: ObservationCardProps) {
  const borderColor = AGENT_BORDER_COLORS[observation.agent] || 'border-l-blue-500'
  const llmTag = formatLlmTag(observation)
  const tokens = parseTokens(observation.llmTokens)

  if (compact && !isExpanded) {
    // Single-line compact row
    return (
      <div
        className={`flex items-center gap-2 px-3 py-1 cursor-pointer rounded hover:bg-accent/50 border-l-2 ${borderColor}`}
        onClick={onToggle}
      >
        <AgentBadge agent={observation.agent} />
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {formatTimestamp(observation.timestamp, true)}
        </span>
        {observation.project && (
          <span className="text-[11px] text-muted-foreground/60 whitespace-nowrap">
            {observation.project}
          </span>
        )}
        <span className="text-[11px] text-foreground/70 truncate flex-1 min-w-0">
          {getSummary(observation.content, 200)}
        </span>
        {llmTag && (
          <span className="text-[10px] text-muted-foreground/40 font-mono whitespace-nowrap">
            {llmTag}
          </span>
        )}
      </div>
    )
  }

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
            <div className="flex items-center gap-3 mb-0.5">
              <AgentBadge agent={observation.agent} />
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(observation.timestamp)}
              </span>
              {observation.project && (
                <span className="text-xs text-muted-foreground">
                  {observation.project}
                </span>
              )}
              {llmTag && (
                <span className="text-[10px] text-muted-foreground/60 font-mono ml-auto">
                  {llmTag}
                </span>
              )}
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
            <div
              className="whitespace-pre-wrap text-sm [&_strong]:font-semibold [&_code]:text-xs"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(observation.content) }}
            />
            {/* LLM details footer */}
            {(llmTag || tokens) && (
              <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-4 text-[11px] text-muted-foreground/60 font-mono">
                {llmTag && <span>{llmTag}</span>}
                {tokens && (
                  <>
                    <span>{tokens.input} in</span>
                    <span>{tokens.output} out</span>
                    <span>{tokens.total} total</span>
                  </>
                )}
                {observation.llmLatencyMs && (
                  <span>{observation.llmLatencyMs}ms</span>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
