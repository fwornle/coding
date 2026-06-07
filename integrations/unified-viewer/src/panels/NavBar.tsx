// PATTERN SOURCE: 45-PATTERNS.md § NavBar.tsx
// CONTRACT: 45-UI-SPEC.md § Layout Contract row 1 (sticky top-0 h-16)
//   + § Icon-only controls (Theme toggle, Keyboard help)
//   + § Typography — active NavLink uses font-bold + accent underline
//     (sole display-weight exception per UI-SPEC)

import { Link, useParams } from 'react-router-dom'
import { Keyboard, Moon, Sun } from 'lucide-react'
import { SYSTEM_LABELS, VALID_SYSTEMS, type System } from '@/config/system-endpoints'
import { IconButton } from '@/components/IconButton'
import { useViewerStore } from '@/store/viewer-store'
import { Logger } from '@/lib/logging'

export interface NavBarProps {
  /**
   * Called by the Keyboard-help IconButton click. Wired by ViewerCore to
   * the same setter that the `?` keyboard shortcut uses.
   */
  onOpenHelpDialog: () => void
}

function persistTheme(t: 'light' | 'dark') {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('viewer-theme', t)
  } catch {
    // ignore — quota / restricted contexts
  }
}

export function NavBar({ onOpenHelpDialog }: NavBarProps) {
  const params = useParams<{ system: string }>()
  const currentSystem = params.system as string | undefined
  const theme = useViewerStore((s) => s.theme)
  const setTheme = useViewerStore((s) => s.setTheme)

  const handleThemeToggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    persistTheme(next)
    // Toggle the document root for Tailwind's `dark:` variants
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', next === 'dark')
    }
    Logger.info(Logger.Categories.PANELS, `Theme switched to ${next}`)
  }

  return (
    <nav
      data-testid="viewer-navbar"
      className="sticky top-0 z-20 h-16 bg-secondary border-b border-border flex items-center justify-between px-6"
    >
      <div className="flex items-center gap-6">
        <span data-testid="viewer-wordmark" className="text-2xl font-bold tracking-tight">
          Unified Viewer
        </span>
      </div>

      <div className="flex items-center gap-4" data-testid="viewer-nav-links">
        {VALID_SYSTEMS.map((sys) => {
          const isActive = sys === currentSystem
          return (
            <Link
              key={sys}
              to={`/viewer/${sys}`}
              data-testid={`nav-link-${sys}`}
              data-active={isActive ? 'true' : 'false'}
              aria-current={isActive ? 'page' : undefined}
              className={
                'text-sm transition-colors px-2 py-1 ' +
                (isActive
                  ? 'font-bold text-primary underline underline-offset-4 decoration-2 decoration-primary'
                  : 'text-foreground/80 hover:text-foreground')
              }
              onClick={() => Logger.info(Logger.Categories.ROUTING, `NavBar → ${sys}`)}
            >
              {SYSTEM_LABELS[sys as System]}
            </Link>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          ariaLabel="Toggle theme"
          tooltipText={theme === 'dark' ? 'Light' : 'Dark'}
          onClick={handleThemeToggle}
          data-testid="theme-toggle"
        />
        <IconButton
          icon={Keyboard}
          ariaLabel="Show keyboard shortcuts"
          tooltipText="Keyboard shortcuts (?)"
          onClick={onOpenHelpDialog}
          data-testid="keyboard-help-button"
        />
      </div>
    </nav>
  )
}
