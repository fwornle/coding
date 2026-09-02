/**
 * The offload policy the ladder draws: what the proxy has saved, and what the
 * operator is trying.
 *
 * ── Why a working copy exists at all ────────────────────────────────────────
 * `GET /api/llm/routing/resolve` answers "where does this job go" perfectly, and
 * it accepts a `network` override, so almost every counterfactual the diagram
 * wants is already a server round-trip away. Exactly one is not: **a policy that
 * has not been saved**. The proxy resolves against the YAML on disk, so it
 * cannot answer "what would happen if I switched qwen-laptop on" until you have
 * already switched it on for real — on the machine, for every caller.
 *
 * That single gap is the whole reason `offload-gates.ts` exists. Keep the two
 * facts adjacent: if `POST /api/llm/routing/resolve` ever accepts an override
 * policy, this hook keeps its shape, the mirror is deleted, and the ladder asks
 * the proxy instead.
 *
 * ── The rule that keeps a preview from being mistaken for the system ────────
 * `inForce` says which of the two the caller is rendering. It is not derived
 * from `dirty` by the consumer — it is handed over, because every place that
 * draws a number off this hook must also draw the chrome that says which world
 * the number belongs to, and a boolean that has to be recomputed is a boolean
 * that eventually is not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OffloadPolicy } from './offload-gates'

/**
 * The `classifier` half of `GET /api/llm/routing`.
 *
 * Kept beside the offload policy rather than folded into it, because the two
 * answer different questions and the gate ladder must not start depending on
 * this one. The classifier decides WHICH BAND a turn is; the offload decides
 * where a `small` band goes. They share a card because an operator reads them
 * as one story — "cheap work runs on hardware we own" — and share a save
 * because flipping one without the other is almost never what is meant.
 */
export interface ClassifierPolicy {
  enabled: boolean
  /** none | local-llm | http. `none` runs the free stages and downgrades nothing. */
  impl: string
  bands: string[]
}

/** The `semanticRouting` half of `GET /api/llm/routing`, as it arrives. */
interface WireSemanticRouting {
  enabled: boolean
  targets: Array<{
    provider: string; requireNetwork: string | null; enabled: boolean;
    scope?: string[]; offloadBands?: string[] | null;
  }>
  offloadBands: string[]
}

export interface OffloadPolicyDraft {
  /** The policy the proxy is running. Null while loading, or if it has none. */
  saved: OffloadPolicy | null
  /** The policy the ladder should evaluate — saved, or the operator's edit of it. */
  draft: OffloadPolicy | null
  /** True once the working copy diverges from what the proxy has. */
  dirty: boolean
  /**
   * Which world the caller is rendering. `saved` means the numbers describe the
   * running system and may be cross-checked against the proxy; `preview` means
   * they describe an edit that exists only in this browser tab.
   */
  inForce: 'saved' | 'preview'

  /** The network the proxy reports sensing right now. */
  liveNetwork: string
  /** The network being asked about, which is `liveNetwork` unless overridden. */
  network: string
  /** Null while following the sensor. Set to ask the other network's question. */
  networkOverride: string | null
  setNetworkOverride: (n: string | null) => void

  setEnabled: (on: boolean) => void
  setTargetEnabled: (provider: string, on: boolean) => void
  setBandEligible: (band: string, on: boolean) => void

  /** The classifier as the proxy has it, and as the operator is editing it. */
  savedClassifier: ClassifierPolicy | null
  classifier: ClassifierPolicy | null
  setClassifierEnabled: (on: boolean) => void
  setClassifierImpl: (impl: string) => void

  revert: () => void
  save: () => Promise<void>
  saving: boolean
  /** A failed load or a rejected save. Never silently swallowed. */
  error: string | null
}

function toPolicy(sr: WireSemanticRouting | null | undefined): OffloadPolicy | null {
  if (!sr) return null
  return {
    enabled: !!sr.enabled,
    offloadBands: [...(sr.offloadBands ?? [])],
    // `enabled` is normalised to a hard boolean on the way in, the same way the
    // settings dialog does it. A target that arrives without the field is OFF:
    // reachability is not usability, and the safe default is the one that does
    // not silently start sending work somewhere.
    targets: (sr.targets ?? []).map(t => ({
      provider: t.provider,
      requireNetwork: t.requireNetwork ?? null,
      enabled: t.enabled === true,
      scope: t.scope ? [...t.scope] : undefined,
      // Carried through untouched. Nothing in the UI edits a target's band
      // narrowing — it is a statement about what the BOX can do, not a policy
      // knob — but the ladder must see it or it would render the laptop as
      // taking medium work it refuses, and `save()` echoes the working copy
      // back, so dropping it here would delete it from the YAML on the next
      // unrelated toggle.
      offloadBands: t.offloadBands ? [...t.offloadBands] : null,
    })),
  }
}

/**
 * @param proxyBase   the proxy origin, as every other card on the page takes it.
 * @param onSaved     called after a successful PATCH, so the page can refetch the
 *                    halves this hook does not own (behaviour counts, route table).
 */
export function useOffloadPolicyDraft(proxyBase: string, onSaved?: () => void): OffloadPolicyDraft {
  const [saved, setSaved] = useState<OffloadPolicy | null>(null)
  const [working, setWorking] = useState<OffloadPolicy | null>(null)
  const [savedCls, setSavedCls] = useState<ClassifierPolicy | null>(null)
  const [workingCls, setWorkingCls] = useState<ClassifierPolicy | null>(null)
  const [liveNetwork, setLiveNetwork] = useState<string>('public')
  const [networkOverride, setNetworkOverride] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (adoptIntoWorkingCopy: boolean) => {
    const res = await fetch(`${proxyBase}/api/llm/routing`)
    const d = await res.json()
    if (d.error) throw new Error(d.error)
    const policy = toPolicy(d.semanticRouting)
    // A proxy that predates the classifier sends no such key. Treated as "off,
    // no impl" rather than as an error: the card then renders the control
    // disabled with an explanation, which is more use than a blank card.
    const cls: ClassifierPolicy | null = d.classifier
      ? {
        enabled: d.classifier.enabled === true,
        impl: String(d.classifier.impl ?? 'none'),
        bands: [...(d.classifier.bands ?? [])],
      }
      : null
    setSaved(policy)
    setSavedCls(cls)
    setLiveNetwork(d.runtime?.network ?? 'public')
    // A refetch must not throw away an edit in progress. Only the first load,
    // and an explicit revert, adopt the server's answer as the working copy.
    if (adoptIntoWorkingCopy) {
      setWorking(policy ? structuredClone(policy) : null)
      setWorkingCls(cls ? structuredClone(cls) : null)
    }
  }, [proxyBase])

  useEffect(() => {
    let cancelled = false
    setError(null)
    load(true).catch(e => { if (!cancelled) setError(String(e?.message || e)) })
    return () => { cancelled = true }
  }, [load])

  // One `dirty` across both halves, because there is one Save. A classifier
  // edit that did not light up the preview badge would be saved by a button the
  // operator pressed for a different reason.
  const dirty = useMemo(
    () => (!!saved && !!working && JSON.stringify(saved) !== JSON.stringify(working))
      || JSON.stringify(savedCls) !== JSON.stringify(workingCls),
    [saved, working, savedCls, workingCls],
  )

  const edit = useCallback((fn: (p: OffloadPolicy) => OffloadPolicy) => {
    setWorking(w => (w ? fn(structuredClone(w)) : w))
  }, [])

  const setEnabled = useCallback((on: boolean) => {
    edit(p => ({ ...p, enabled: on }))
  }, [edit])

  const setTargetEnabled = useCallback((provider: string, on: boolean) => {
    edit(p => ({ ...p, targets: p.targets.map(t => (t.provider === provider ? { ...t, enabled: on } : t)) }))
  }, [edit])

  const setBandEligible = useCallback((band: string, on: boolean) => {
    edit(p => ({
      ...p,
      // Rebuilt from the union rather than pushed onto, so the set keeps a stable
      // order across toggles. `offload_bands` is written back to YAML verbatim,
      // and a list that reshuffles itself produces a diff on every save.
      offloadBands: ['small', 'medium', 'high']
        .filter(b => (b === band ? on : p.offloadBands.includes(b))),
    }))
  }, [edit])

  const setClassifierEnabled = useCallback((on: boolean) => {
    setWorkingCls(c => (c ? { ...c, enabled: on } : c))
  }, [])

  const setClassifierImpl = useCallback((impl: string) => {
    setWorkingCls(c => (c ? { ...c, impl } : c))
  }, [])

  const revert = useCallback(() => {
    setWorking(saved ? structuredClone(saved) : null)
    setWorkingCls(savedCls ? structuredClone(savedCls) : null)
    setError(null)
  }, [saved, savedCls])

  const save = useCallback(async () => {
    if (!working) return
    setSaving(true)
    setError(null)
    try {
      // Same surgical PATCH the settings dialog sends: one field, so the prose
      // and ordering the rest of llm-routing.yaml carries survives the write.
      const res = await fetch(`${proxyBase}/api/llm/routing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Both halves in one PATCH, so a rejected classifier cannot leave the
        // offload half written: the proxy validates the whole candidate document
        // before either file is touched.
        body: JSON.stringify({ semanticRouting: working, ...(workingCls ? { classifier: workingCls } : {}) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.error) throw new Error(body?.error || `save failed (HTTP ${res.status})`)
      // Re-read rather than assuming the write landed verbatim: the proxy
      // validates and may normalise, and the ladder must draw what it stored.
      await load(true)
      onSaved?.()
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setSaving(false)
    }
  }, [proxyBase, working, workingCls, load, onSaved])

  return {
    saved,
    draft: working,
    dirty,
    inForce: dirty ? 'preview' : 'saved',
    liveNetwork,
    network: networkOverride ?? liveNetwork,
    networkOverride,
    setNetworkOverride,
    setEnabled,
    setTargetEnabled,
    setBandEligible,
    savedClassifier: savedCls,
    classifier: workingCls,
    setClassifierEnabled,
    setClassifierImpl,
    revert,
    save,
    saving,
    error,
  }
}
