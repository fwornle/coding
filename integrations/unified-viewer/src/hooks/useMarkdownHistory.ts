// PATTERN SOURCE: 45-04-PLAN.md Task 2 useMarkdownHistory contract
// CONTRACT:
//   - pushHistory(path) — truncates the forward portion of the stack to current
//     cursor, appends new path, advances cursor. Forward stack is cleared on
//     new push (no fork).
//   - back() — decrements cursor if cursor > 0.
//   - forward() — increments cursor if cursor < stack.length - 1.
//   - currentPath — stack[cursor] or null when stack is empty.
//   - canBack / canForward — derived booleans.
//
// Stack-based history; cursor pointing to the current entry. New pushes
// past the cursor truncate the forward portion (browser-history semantics).

import { useState, useCallback } from 'react'

interface HistoryState {
  stack: string[]
  cursor: number
}

export interface MarkdownHistory {
  pushHistory: (path: string) => void
  back: () => void
  forward: () => void
  currentPath: string | null
  canBack: boolean
  canForward: boolean
  stackSize: number
  cursorIndex: number
}

export function useMarkdownHistory(): MarkdownHistory {
  const [state, setState] = useState<HistoryState>({ stack: [], cursor: -1 })

  const pushHistory = useCallback((path: string) => {
    setState((s) => {
      // Truncate the forward portion of the stack at cursor, then append.
      const truncated = s.stack.slice(0, s.cursor + 1)
      const nextStack = [...truncated, path]
      return { stack: nextStack, cursor: nextStack.length - 1 }
    })
  }, [])

  const back = useCallback(() => {
    setState((s) => (s.cursor > 0 ? { ...s, cursor: s.cursor - 1 } : s))
  }, [])

  const forward = useCallback(() => {
    setState((s) =>
      s.cursor < s.stack.length - 1 ? { ...s, cursor: s.cursor + 1 } : s,
    )
  }, [])

  const currentPath = state.cursor >= 0 ? state.stack[state.cursor] ?? null : null
  const canBack = state.cursor > 0
  const canForward = state.cursor >= 0 && state.cursor < state.stack.length - 1

  return {
    pushHistory,
    back,
    forward,
    currentPath,
    canBack,
    canForward,
    stackSize: state.stack.length,
    cursorIndex: state.cursor,
  }
}
