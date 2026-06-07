// PATTERN SOURCE: 45-UI-SPEC.md § Routing row 5 (404 page lists the three valid system slugs as links).
//
// Renders when React Router matches `*` (no other route matched). Lists the
// three valid system links so the user can recover with a single click.

import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { VALID_SYSTEMS, SYSTEM_LABELS } from '@/config/system-endpoints'

export function UnknownSystem() {
  return (
    <div
      className="min-h-screen bg-background text-foreground flex items-center justify-center p-8"
      data-testid="unknown-system"
    >
      <div className="max-w-md w-full space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Unknown system</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The URL doesn’t match one of the three configured systems. Pick one:
          </p>
        </header>
        <ul className="space-y-2" data-testid="unknown-system-links">
          {VALID_SYSTEMS.map((slug) => (
            <li key={slug}>
              <Button asChild variant="outline" className="w-full justify-start">
                <Link to={`/viewer/${slug}`}>{SYSTEM_LABELS[slug]}</Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
