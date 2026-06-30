/**
 * Theme controller for the dashboard.
 *
 * Tailwind is configured with `darkMode: ['class']`, so dark mode activates only
 * when the `dark` class is present on <html>. Nothing was ever applying it — the
 * board stayed light even under an OS dark preference. This module:
 *   - resolves the effective theme ('system' follows `prefers-color-scheme`),
 *   - toggles the `dark` class + `color-scheme` on <html>,
 *   - persists an explicit user choice in localStorage,
 *   - live-updates when the OS preference changes while 'system' is selected.
 *
 * initTheme() is called from main.tsx BEFORE React renders to avoid a flash of
 * the wrong theme.
 */

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'dashboard-theme'

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* localStorage may be unavailable */ }
  return 'system'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Resolve a Theme to the concrete mode ('system' → OS preference). */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
}

/** Apply the resolved mode to <html> (the `dark` class + native color-scheme). */
function applyResolved(mode: 'light' | 'dark'): void {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
}

/** Persist + apply an explicit user choice. */
export function setTheme(theme: Theme): void {
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
  applyResolved(resolveTheme(theme))
}

/** Cycle light → dark → system → light (for a header toggle). */
export function cycleTheme(current: Theme): Theme {
  const next: Theme = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'
  setTheme(next)
  return next
}

/**
 * Initialize on boot: apply the stored (or system) theme and keep it in sync
 * with the OS while 'system' is selected. Safe to call once at startup.
 */
export function initTheme(): void {
  applyResolved(resolveTheme(getStoredTheme()))
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getStoredTheme() === 'system') applyResolved(systemPrefersDark() ? 'dark' : 'light')
    }
    // addEventListener is the modern API; older Safari used addListener.
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else if ((mq as MediaQueryList & { addListener?: (cb: () => void) => void }).addListener) {
      ;(mq as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(onChange)
    }
  }
}
