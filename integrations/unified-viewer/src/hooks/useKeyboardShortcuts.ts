// PATTERN SOURCE: 45-PATTERNS.md § useKeyboardShortcuts.ts
//   + 55-11-PLAN.md Task 1 (registerSequence extension — closes W-6)
// CONTRACT: 45-UI-SPEC.md § Keyboard table — `/` `Esc` `?` `f`
//   + 55-UI-SPEC.md §10 — `g h` two-key sequence (hierarchy focus search)
//
// Single document-level keydown listener. Reads the Zustand store
// imperatively so the handlers always see fresh state without re-renders.
//
// Skip-when-input-focused discipline (T-45-03-04 mitigation):
//   `/` `?` `f` are SKIPPED when an <input> or <textarea> has focus, so
//   the user can type slashes / question marks / 'f' into the search box.
//   `Esc` ALWAYS fires (it's the user's escape hatch — see UI-SPEC).
//
// The hook exposes a `registerSearchInputRef(ref)` so FilterRail can
// hand us the search input ref; `/` calls preventDefault() then
// `searchInputRef.current?.focus()` so the slash never enters the input.
//
// Phase 55-11 extension:
//   `registerSequence(key1, key2, handler, opts?)` registers a two-key
//   sequence. When the user presses `key1` then `key2` within `windowMs`
//   (default 800ms) AND no <input>/<textarea>/contenteditable is focused,
//   the handler fires. A third key in between cancels the sequence.
//   Returns an `unregister()` function for useEffect cleanup. The
//   single document keydown listener owns all sequence state — components
//   never wire ad-hoc per-instance state machines (closes plan-checker W-6).

import { useEffect, useRef } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Logger } from '@/lib/logging'

export interface KeyboardShortcutBindings {
  /**
   * Called when the `?` key is pressed (no input focused). Consumers wire
   * this to whatever mechanism opens the Keyboard Help Dialog (typically
   * a `useState` flag at the App root or a Zustand store flag).
   */
  onOpenHelpDialog: () => void
  /**
   * Called when `Esc` is pressed AND a Dialog is open. Returns true if
   * the consumer handled the dialog-close (so the hook skips the
   * deselect-node fallback step).
   */
  onCloseHelpDialog: () => boolean
}

interface SequenceRegistration {
  key2: string
  handler: () => void
  windowMs: number
}

export interface KeyboardShortcutHandle {
  /** FilterRail registers its search <input> here so `/` can focus it. */
  registerSearchInputRef: (input: HTMLInputElement | null) => void
  /**
   * Register a two-key sequence (e.g., 'g h'). The handler fires when the
   * user presses key1 then key2 within `windowMs` (default 800ms). The
   * sequence is SKIPPED when an <input>/<textarea>/contenteditable has
   * focus, so typing 'github' or 'graph' into the search box does NOT
   * trigger `g h`. Returns an unregister function suitable for useEffect
   * cleanup.
   */
  registerSequence: (
    key1: string,
    key2: string,
    handler: () => void,
    opts?: { windowMs?: number },
  ) => () => void
}

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true
}

// Module-level sequence registry. We keep this at module scope (not inside
// the hook) so multiple `useKeyboardShortcuts` callers within the same
// page can each register without re-installing the document listener — the
// hook itself still installs/uninstalls its own document listener per call
// site; the registry is just a shared lookup.
const sequenceRegistry: Map<string, SequenceRegistration[]> = new Map()

function registerSequenceImpl(
  key1: string,
  key2: string,
  handler: () => void,
  opts?: { windowMs?: number },
): () => void {
  const windowMs = opts?.windowMs ?? 800
  const reg: SequenceRegistration = { key2, handler, windowMs }
  const list = sequenceRegistry.get(key1) ?? []
  list.push(reg)
  sequenceRegistry.set(key1, list)
  return () => {
    const current = sequenceRegistry.get(key1) ?? []
    const next = current.filter((r) => r !== reg)
    if (next.length === 0) sequenceRegistry.delete(key1)
    else sequenceRegistry.set(key1, next)
  }
}

/**
 * Test-only helper: clear all sequence registrations. Component test suites
 * that register sequences via `onReady` harnesses should call this in
 * `beforeEach` to guarantee isolation across tests — since the registry is
 * module-level (shared across the page) any leaked registrations would
 * accumulate across the file's test bodies.
 */
export function _resetSequenceRegistryForTests(): void {
  sequenceRegistry.clear()
}

/**
 * Global keyboard shortcut handler. Mount ONCE per route (typically inside
 * ViewerCore). The hook returns a handle exposing `registerSearchInputRef`
 * which FilterRail uses to hand over its search input ref, and
 * `registerSequence` for two-key shortcuts (Phase 55-11).
 *
 * Each call to the hook installs/uninstalls its own listener — calling it
 * twice on the same page would double-fire handlers.
 */
export function useKeyboardShortcuts(
  bindings: KeyboardShortcutBindings,
): KeyboardShortcutHandle {
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Capture latest bindings without re-installing the listener on every
  // render — useRef pattern (same as React's docs for stable effect bodies).
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  // Pending sequence state — lives in a ref so the listener doesn't have
  // to re-bind every time a key fires.
  const pendingSequenceRef = useRef<{
    key1: string
    expiresAt: number
  } | null>(null)
  const sequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function clearPendingSequence() {
      pendingSequenceRef.current = null
      if (sequenceTimerRef.current !== null) {
        clearTimeout(sequenceTimerRef.current)
        sequenceTimerRef.current = null
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      // Esc fires regardless of focus (UI-SPEC override)
      if (event.key === 'Escape') {
        const searchEl = searchInputRef.current
        if (searchEl && document.activeElement === searchEl) {
          // Blur the search input first — leaves search query intact per UI-SPEC.
          searchEl.blur()
          event.preventDefault()
          Logger.debug(Logger.Categories.PANELS, 'Esc: blurred search input')
          return
        }
        // Then try to close any open dialog
        if (bindingsRef.current.onCloseHelpDialog()) {
          event.preventDefault()
          Logger.debug(Logger.Categories.PANELS, 'Esc: closed help dialog')
          return
        }
        // Finally fall back to deselecting the current node. Phase 56:
        // route through the store-level `clearSelection()` so the LSL
        // session filter + the cross-pane selection slice (selectionSource,
        // highlightedRowKey, selectedSessionId) all clear in one atomic
        // snapshot. CR-03 (review fix): the guard must cover ANY active
        // selection field — not just `selectedNodeId` — so the Phase 56-04
        // round-4 "sidebar-only mode" (a tick whose entities have no
        // graph-visible ancestor, leaving `selectedNodeId === null` but
        // `selectedSessionId` / `lslFilterEntityIds` / `lslSessionFilter`
        // populated) also responds to Esc. The no-op-when-fully-cleared
        // semantic from Phase 45 is preserved: if every field is null/empty,
        // Esc does nothing (no preventDefault, no Logger spam).
        const state = useViewerStore.getState()
        const hasSelection =
          state.selectedNodeId !== null ||
          state.selectedSessionId !== null ||
          state.selectedEdgeId !== null ||
          state.lslSessionFilter.length > 0 ||
          state.lslFilterEntityIds !== null
        if (hasSelection) {
          state.clearSelection()
          event.preventDefault()
          Logger.debug(Logger.Categories.STORE, 'Esc: cleared selection (all panes)')
        }
        return
      }

      // The remaining shortcuts (`/` `?` `f` + registered sequences) skip
      // when an input/textarea has focus, so the user can type these
      // characters normally.
      if (isInputFocused()) {
        // Also clear any pending sequence — leaving focused-input typing
        // mid-sequence would otherwise risk a spurious match when focus
        // returns to document.body.
        clearPendingSequence()
        return
      }

      // Allow modifier-combined keys (Cmd-/, Ctrl-/, etc.) to fall through
      // to the browser — only the unmodified key triggers the shortcut.
      if (event.metaKey || event.ctrlKey || event.altKey) {
        // Also clear pending sequence on modifier — modifier combos are
        // not part of any sequence binding.
        clearPendingSequence()
        return
      }

      // ---- Two-key sequence handling (Phase 55-11) ----

      // If a sequence is pending, check whether the current key matches
      // any registered second key for that prefix.
      if (pendingSequenceRef.current !== null) {
        const { key1, expiresAt } = pendingSequenceRef.current
        if (Date.now() <= expiresAt) {
          const regs = sequenceRegistry.get(key1) ?? []
          const match = regs.find((r) => r.key2 === event.key)
          if (match) {
            event.preventDefault()
            clearPendingSequence()
            try {
              match.handler()
            } catch (err) {
              Logger.error(
                Logger.Categories.PANELS,
                `Sequence handler '${key1} ${event.key}' threw: ${(err as Error).message}`,
              )
            }
            Logger.debug(Logger.Categories.PANELS, `Sequence fired: ${key1} ${event.key}`)
            return
          }
        }
        // Either expired or the second key doesn't match — clear and fall
        // through. The new key might be a fresh sequence prefix below.
        clearPendingSequence()
      }

      // If the new key registers as a sequence prefix, start a pending
      // window. Note: this also runs for the single-character shortcuts
      // (`/`, `?`, `f`) since those don't appear in the registry by
      // default.
      const startRegs = sequenceRegistry.get(event.key)
      if (startRegs && startRegs.length > 0) {
        // Use the longest windowMs across registrations for this prefix.
        const windowMs = startRegs.reduce((max, r) => Math.max(max, r.windowMs), 0)
        pendingSequenceRef.current = {
          key1: event.key,
          expiresAt: Date.now() + windowMs,
        }
        if (sequenceTimerRef.current !== null) {
          clearTimeout(sequenceTimerRef.current)
        }
        sequenceTimerRef.current = setTimeout(clearPendingSequence, windowMs)
        // Do NOT preventDefault here — the user may also be using `g` as a
        // regular keypress; we only commit the sequence on the second key.
        // BUT: if this same key is also a registered single-char shortcut
        // (below), let the switch run.
      }

      switch (event.key) {
        case '/':
          if (searchInputRef.current) {
            event.preventDefault()
            searchInputRef.current.focus()
            Logger.debug(Logger.Categories.FILTERS, '/: focused search input')
          }
          break
        case '?':
          event.preventDefault()
          bindingsRef.current.onOpenHelpDialog()
          Logger.debug(Logger.Categories.PANELS, '?: opened keyboard help')
          break
        case 'f':
        case 'F': {
          event.preventDefault()
          const { filterRailCollapsed, setFilterRailCollapsed } = useViewerStore.getState()
          setFilterRailCollapsed(!filterRailCollapsed)
          Logger.debug(
            Logger.Categories.FILTERS,
            `f: filter rail ${filterRailCollapsed ? 'expanded' : 'collapsed'}`,
          )
          break
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (sequenceTimerRef.current !== null) {
        clearTimeout(sequenceTimerRef.current)
        sequenceTimerRef.current = null
      }
      pendingSequenceRef.current = null
    }
  }, [])

  return {
    registerSearchInputRef: (input: HTMLInputElement | null) => {
      searchInputRef.current = input
    },
    registerSequence: registerSequenceImpl,
  }
}
