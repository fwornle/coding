// PATTERN SOURCE: 45-PATTERNS.md § useKeyboardShortcuts.ts
// CONTRACT: 45-UI-SPEC.md § Keyboard table — `/` `Esc` `?` `f`
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

export interface KeyboardShortcutHandle {
  /** FilterRail registers its search <input> here so `/` can focus it. */
  registerSearchInputRef: (input: HTMLInputElement | null) => void
}

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true
}

/**
 * Global keyboard shortcut handler. Mount ONCE per route (typically inside
 * ViewerCore). The hook returns a handle exposing `registerSearchInputRef`
 * which FilterRail uses to hand over its search input ref.
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

  useEffect(() => {
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
        // Finally fall back to deselecting the current node
        const { selectedNodeId, setSelectedNode } = useViewerStore.getState()
        if (selectedNodeId !== null) {
          setSelectedNode(null)
          event.preventDefault()
          Logger.debug(Logger.Categories.STORE, 'Esc: deselected node')
        }
        return
      }

      // The remaining shortcuts (`/` `?` `f`) skip when an input/textarea
      // has focus, so the user can type these characters normally.
      if (isInputFocused()) return

      // Allow modifier-combined keys (Cmd-/, Ctrl-/, etc.) to fall through
      // to the browser — only the unmodified key triggers the shortcut.
      if (event.metaKey || event.ctrlKey || event.altKey) return

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
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return {
    registerSearchInputRef: (input: HTMLInputElement | null) => {
      searchInputRef.current = input
    },
  }
}
