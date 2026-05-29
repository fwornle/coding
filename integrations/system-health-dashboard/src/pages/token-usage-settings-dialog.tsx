import { useEffect, useState, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { PROCESS_TAGS } from '../../../mcp-server-semantic-analysis/dist/agents/process-tags.js'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ProcessOverride {
  provider?: string
  model?: string
}

interface SettingsData {
  processOverrides: Record<string, ProcessOverride>
  providerModels: Record<string, string[]>
}

interface SettingsResponse {
  settings: SettingsData
  processes: string[]
  availableProviders: string[]
  allProviders: string[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  proxyBase: string
}

// Sentinel value for "no override / use auto-route" since the Select primitive
// can't hold an empty string as a value.
const AUTO = '__auto__'

export function TokenUsageSettingsDialog({ open, onOpenChange, proxyBase }: Props) {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [draft, setDraft] = useState<Record<string, ProcessOverride>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    fetch(`${proxyBase}/api/llm/settings`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SettingsResponse>
      })
      .then(d => {
        setData(d)
        // Seed the editable draft from the server's current overrides.
        setDraft({ ...d.settings.processOverrides })
      })
      .catch(e => setError(`Failed to load settings: ${e.message}`))
      .finally(() => setLoading(false))
  }, [open, proxyBase])

  const setOverride = (process: string, override: ProcessOverride | null) => {
    setDraft(d => {
      const next = { ...d }
      if (!override || (!override.provider && !override.model)) {
        delete next[process]
      } else {
        next[process] = override
      }
      return next
    })
  }

  const save = async () => {
    if (!data) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${proxyBase}/api/llm/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processOverrides: draft,
          providerModels: data.settings.providerModels,
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(errBody.error || `HTTP ${res.status}`)
      }
      onOpenChange(false)
    } catch (e: any) {
      setError(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[85vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>LLM Routing Settings</DialogTitle>
          <DialogDescription>
            Optionally pin a service (cognitive process) to a specific provider and model. Unpinned services
            use the auto-route logic — Claude Max for Claude Code sessions, Copilot for OpenCode/corporate
            sessions, falling back to Groq → OpenAI → Anthropic. If a pinned provider is unreachable, the
            proxy falls through to auto-route automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
            {error}
          </div>
        )}

        {!loading && data && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Available providers:</span>
              {data.allProviders.map(p => (
                <Badge
                  key={p}
                  variant={data.availableProviders.includes(p) ? 'default' : 'outline'}
                  className={data.availableProviders.includes(p) ? '' : 'opacity-50'}
                >
                  {p}{data.availableProviders.includes(p) ? '' : ' (offline)'}
                </Badge>
              ))}
            </div>

            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Service (process)</th>
                    <th className="text-left px-3 py-2 font-medium w-[200px]">Provider</th>
                    <th className="text-left px-3 py-2 font-medium w-[220px]">Model</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Registry-driven rows (from PROCESS_TAGS) */}
                  {Object.values(PROCESS_TAGS).map(proc => {
                    const override = draft[proc] || {}
                    const provider = override.provider || AUTO
                    const models = provider !== AUTO ? data.settings.providerModels[provider] || [] : []
                    return (
                      <tr key={proc} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs">{proc}</td>
                        <td className="px-2 py-1">
                          <Select
                            value={provider}
                            onValueChange={v => {
                              if (v === AUTO) {
                                setOverride(proc, null)
                              } else {
                                // Switching provider: reset model to first available for that provider
                                const firstModel = data.settings.providerModels[v]?.[0]
                                setOverride(proc, { provider: v, model: firstModel })
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={AUTO}>(auto-route)</SelectItem>
                              {data.allProviders.map(p => (
                                <SelectItem
                                  key={p}
                                  value={p}
                                  disabled={!data.availableProviders.includes(p)}
                                >
                                  {p}{!data.availableProviders.includes(p) ? ' (offline)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          {provider === AUTO ? (
                            <span className="text-xs text-muted-foreground italic px-2">—</span>
                          ) : (
                            <Select
                              value={override.model || ''}
                              onValueChange={v => setOverride(proc, { provider: override.provider, model: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="(default)" />
                              </SelectTrigger>
                              <SelectContent>
                                {models.map(m => (
                                  <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Legacy rows — processes seen in API but not in PROCESS_TAGS registry */}
                  {data.processes
                    .filter(p => !Object.values(PROCESS_TAGS).includes(p))
                    .map(proc => {
                      const override = draft[proc] || {}
                      const provider = override.provider || AUTO
                      const models = provider !== AUTO ? data.settings.providerModels[provider] || [] : []
                      return (
                        <tr key={proc} className="border-b last:border-b-0 bg-muted/20">
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{proc}</td>
                          <td className="px-2 py-1">
                            <Select
                              value={provider}
                              onValueChange={v => {
                                if (v === AUTO) {
                                  setOverride(proc, null)
                                } else {
                                  const firstModel = data.settings.providerModels[v]?.[0]
                                  setOverride(proc, { provider: v, model: firstModel })
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={AUTO}>(auto-route)</SelectItem>
                                {data.allProviders.map(p => (
                                  <SelectItem key={p} value={p} disabled={!data.availableProviders.includes(p)}>
                                    {p}{!data.availableProviders.includes(p) ? ' (offline)' : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            {provider === AUTO ? (
                              <span className="text-xs text-muted-foreground italic px-2">—</span>
                            ) : (
                              <Select
                                value={override.model || ''}
                                onValueChange={v => setOverride(proc, { provider: override.provider, model: v })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="(default)" />
                                </SelectTrigger>
                                <SelectContent>
                                  {models.map(m => (
                                    <SelectItem key={m} value={m}>{m}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading || !data}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
