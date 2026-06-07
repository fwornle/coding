// PATTERN SOURCE: 45-UI-SPEC.md § Design System theming — `localStorage('viewer-theme')`
// + `.dark` class on `<html>` (per 45-PATTERNS.md § No Analog Found — derived from UI-SPEC).
//
// Lightweight theme hook. Reads the persisted choice, applies the `.dark` class
// on document.documentElement, exposes a toggle. Side-effect-free at module
// import (only the hook touches DOM / localStorage).
import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'viewer-theme'
export type Theme = 'light' | 'dark'

function readPersistedTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'dark' ? 'dark' : 'light'
  } catch {
    // localStorage can throw in some browsers when disabled
    return 'light'
  }
}

function applyThemeToDom(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => readPersistedTheme())

  useEffect(() => {
    applyThemeToDom(theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore quota / disabled
    }
  }, [theme])

  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const toggle = useCallback(
    () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light')),
    [],
  )

  return { theme, toggle, setTheme }
}
