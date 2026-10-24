import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { accountLabel, getProviderColor, normalizeProvider } from '@/lib/providers'
import { SITE_LOCAL_PROVIDERS } from '@/lib/provider-site'
import type { AccountSelection, SourcesControl } from './account-selection'

// Offered even before they have rows, so an account can be switched off ahead of
// its first call. The local ones are this installation's (provider-site.ts);
// glass's build ships none and learns its own from the data.
const KNOWN_ACCOUNTS = ['claude-code-max', 'gh-copilot', ...SITE_LOCAL_PROVIDERS]

export function AccountsDialog({ open, onOpenChange, proxyBase, selection, onSaved, sources, writeHeaders }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  proxyBase: string
  selection: AccountSelection | null
  onSaved: (next: AccountSelection | null) => void
  /** Other tools' figures to add (glass: coding's); absent → no Sources section. */
  sources?: SourcesControl
  /** Extra headers on the write (glass's daemon accepts settings writes only from its UI). */
  writeHeaders?: Record<string, string>
}) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setExcluded(new Set(selection?.excluded ?? []))
    setIncluded(Object.fromEntries((sources?.items ?? []).map(x => [x.id, x.included])))
    setError(null)
  }, [open, selection, sources])

  const calls = new Map((selection?.accounts ?? []).map(a => [normalizeProvider(a.account), a.calls]))
  const ids = [...new Set([...calls.keys(), ...KNOWN_ACCOUNTS])]
    .sort((a, b) => (calls.get(b) ?? 0) - (calls.get(a) ?? 0) || a.localeCompare(b))
  const writable = selection?.writable ?? false
  const accountsChanged = JSON.stringify([...excluded].sort()) !== JSON.stringify([...(selection?.excluded ?? [])].sort())
  const sourceItems = sources?.items ?? []
  const sourcesChanged = sourceItems.some(x => included[x.id] !== x.included)

  const save = async () => {
    setSaving(true); setError(null)
    try {
      let next = selection
      if (accountsChanged) {
        const res = await fetch(`${proxyBase}/api/token-usage/accounts`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...writeHeaders },
          body: JSON.stringify({ excluded: [...excluded] }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
        next = body as AccountSelection
      }
      if (sourcesChanged && sources) await sources.save(included)
      onSaved(next)
      onOpenChange(false)
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Accounts</DialogTitle>
          <DialogDescription>
            Which accounts count. An unchecked account leaves every view — cards, charts, Cost,
            Recent Calls and the status line's cost field — on this machine.
          </DialogDescription>
        </DialogHeader>
        {!selection && <div className="text-sm text-muted-foreground">This proxy has no account selection; every account counts.</div>}
        <div className="space-y-2">
          {ids.map(id => (
            <label key={id} className="flex items-center justify-between gap-3 text-sm cursor-pointer">
              <span className="flex items-center gap-2">
                <Checkbox
                  checked={!excluded.has(id)}
                  disabled={!writable}
                  onCheckedChange={(v) => setExcluded(prev => {
                    const next = new Set(prev)
                    if (v) next.delete(id); else next.add(id)
                    return next
                  })}
                />
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: getProviderColor(id) }} />
                <span>{accountLabel(id)}</span>
                <span className="font-mono text-xs text-muted-foreground">{id}</span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {calls.get(id) ? `${calls.get(id)!.toLocaleString()} calls` : 'no rows'}
              </span>
            </label>
          ))}
        </div>
        {selection && !writable && <div className="text-xs text-muted-foreground">Read-only here: this host saves no selection.</div>}
        {sourceItems.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground">Sources</div>
            {sourceItems.map(x => (
              <label key={x.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  className="mt-0.5"
                  checked={included[x.id] ?? x.included}
                  onCheckedChange={(v) => setIncluded(prev => ({ ...prev, [x.id]: Boolean(v) }))}
                />
                <span>
                  <span>{x.label}</span>
                  <span className="block text-xs text-muted-foreground">{x.detail}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {error && <div className="text-xs text-red-600">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={(!accountsChanged || !writable) && !sourcesChanged || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
