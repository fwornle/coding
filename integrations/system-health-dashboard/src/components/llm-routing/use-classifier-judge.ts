/**
 * The judge — who decides how hard a request is, and whether they are answering.
 *
 * ── Why this is a second hook and not more state in use-offload-policy-draft ──
 * They render in one card because an operator reads them as one story, but they
 * write DIFFERENT FILES on different machines' schedules: the offload policy
 * lives in rapid-llm-proxy's `llm-routing.yaml`, the judge's backends and rubric
 * in this repo's `config/prompt-classifier.yaml`. One `save()` across both would
 * mean a rubric typo could roll back an unrelated target toggle, and a rejected
 * band could refuse a rubric edit that was fine. Two hooks, two saves, two
 * failure domains — and the buttons say which file they write.
 *
 * ── What this exists to make visible ────────────────────────────────────────
 * On 2026-09-02 every classified turn recorded `classifier error: classifier
 * HTTP 502` and pi's turns ran on gh-copilot/claude-sonnet-5. The judge's model
 * endpoint had not been running for about a day. Nothing on any board said so:
 * the classifier was `enabled: true`, the impl was named, the offload policy was
 * correct, and the only trace was a per-row string. `reachable` is the field
 * that was missing, and it is deliberately kept apart from `enabled` — "switched
 * off" and "not answering" look identical as one red dot and have opposite fixes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

/** One row of `GET /api/llm/classifier` → `judge.backends[]`. */
export interface JudgeBackend {
  id: string
  model: string
  baseUrl: string
  /** 'corporate' | 'public' | null (any network). */
  requireNetwork: string | null
  /** CONFIG: what the file says. Edited here. */
  enabled: boolean
  /** Whether this is the one that serves the live network right now. */
  selected: boolean
  /** RUNTIME: whether it last answered. `null` = never asked on this network. */
  reachable: boolean | null
  lastLatencyMs: number | null
  lastError: string | null
  idleMs: number | null
}

/** The judge service's own report, or null when it could not be reached. */
export interface Judge {
  network: string
  backends: JudgeBackend[]
  /** The literal prompt the judge is sent. Editable. */
  rubric: string
  /** Present only when the config file on disk is currently unusable. */
  configError?: string
  configSource: string
  counts: { asked: number; answered: number; failed: number; byBand: Record<string, number> }
}

export interface ClassifierJudgeState {
  /** As the service has it. Null while loading, or when it cannot be reached. */
  judge: Judge | null
  /** Why the judge could not be reached. The single most important field here. */
  judgeError: string | null
  /** Where the proxy sends verdict requests, so a mismatch is visible not inferred. */
  judgeUrl: string | null
  /** The operator's edit of the rubric, or null when untouched. */
  draftRubric: string | null
  setDraftRubric: (v: string | null) => void
  setBackendEnabled: (id: string, on: boolean) => void
  dirty: boolean
  saving: boolean
  error: string | null
  save: () => Promise<void>
  revert: () => void
  reload: () => void
}

export function useClassifierJudge(proxyBase: string, pollMs = 30_000): ClassifierJudgeState {
  const [judge, setJudge] = useState<Judge | null>(null)
  const [judgeError, setJudgeError] = useState<string | null>(null)
  const [judgeUrl, setJudgeUrl] = useState<string | null>(null)
  const [draftRubric, setDraftRubric] = useState<string | null>(null)
  const [draftEnabled, setDraftEnabled] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(`${proxyBase}/api/llm/classifier`)
        const d = await r.json()
        if (cancelled) return
        setJudge(d.judge ?? null)
        setJudgeError(d.judgeError ?? null)
        setJudgeUrl(d.judgeUrl ?? null)
      } catch (e) {
        if (!cancelled) setJudgeError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    // A plain interval rather than usePolledFetch: this one must keep polling
    // while the rubric draft is open. The reason is the whole point of the
    // panel — a judge can go unreachable WHILE someone is editing it, and
    // freezing the health readout during an edit would hide exactly that.
    // Nothing here is clobbered by a poll: the draft lives in separate state.
    const h = setInterval(load, pollMs)
    return () => { cancelled = true; clearInterval(h) }
  }, [proxyBase, pollMs, tick])

  const setBackendEnabled = useCallback((id: string, on: boolean) => {
    setDraftEnabled(prev => ({ ...prev, [id]: on }))
  }, [])

  /** Config as it will be saved: the file, with the operator's edits over it. */
  const effectiveEnabled = useCallback(
    (b: JudgeBackend) => (b.id in draftEnabled ? draftEnabled[b.id] : b.enabled),
    [draftEnabled],
  )

  const dirty = useMemo(() => {
    if (!judge) return false
    if (draftRubric !== null && draftRubric !== judge.rubric) return true
    return judge.backends.some(b => b.id in draftEnabled && draftEnabled[b.id] !== b.enabled)
  }, [judge, draftRubric, draftEnabled])

  const revert = useCallback(() => {
    setDraftRubric(null)
    setDraftEnabled({})
    setError(null)
  }, [])

  const save = useCallback(async () => {
    if (!judge) return
    setSaving(true)
    setError(null)
    try {
      // Only what CHANGED. Sending the whole file back would make an unrelated
      // poll-vs-edit race able to rewrite a field nobody touched.
      const backends = judge.backends
        .filter(b => b.id in draftEnabled && draftEnabled[b.id] !== b.enabled)
        .map(b => ({ id: b.id, enabled: draftEnabled[b.id] }))
      const body: Record<string, unknown> = {}
      if (backends.length) body.backends = backends
      if (draftRubric !== null && draftRubric !== judge.rubric) body.rubric = draftRubric

      const res = await fetch(`${proxyBase}/api/llm/classifier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || out?.error) throw new Error(out?.error || `save failed (HTTP ${res.status})`)
      setDraftRubric(null)
      setDraftEnabled({})
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [judge, draftEnabled, draftRubric, proxyBase, reload])

  // The backends as the panel should draw them: file config with pending edits
  // applied, runtime facts untouched. Merging the two is what this whole hook
  // exists to avoid, so `enabled` is overlaid and `reachable` never is.
  const merged = useMemo(() => {
    if (!judge) return null
    return { ...judge, backends: judge.backends.map(b => ({ ...b, enabled: effectiveEnabled(b) })) }
  }, [judge, effectiveEnabled])

  return {
    judge: merged,
    judgeError,
    judgeUrl,
    draftRubric,
    setDraftRubric,
    setBackendEnabled,
    dirty,
    saving,
    error,
    save,
    revert,
    reload,
  }
}
