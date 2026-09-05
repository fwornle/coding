import { Link } from 'react-router-dom'
import { PowerOff } from 'lucide-react'
import { useAppSelector } from '@/store'
import type { FeatureId } from '@/store/slices/featuresSlice'

/**
 * What a route renders when its feature is off.
 *
 * The nav tab is omitted in that case, so the only way here is a bookmark, a
 * deep link, or a browser history entry. Rendering the page's normal empty
 * state would be a lie — there is no data because nothing is collecting it, not
 * because nothing has happened yet — so this says which feature is off, why,
 * and where to change it.
 */
export function FeatureDisabled({ feature, what }: { feature: FeatureId; what: string }) {
  const f = useAppSelector(state => state.features.features[feature])

  return (
    <div className="p-6 max-w-2xl" data-testid={`feature-disabled-${feature}`}>
      <div className="rounded-md border border-border p-6">
        <div className="flex items-start gap-3">
          <PowerOff className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-base font-medium">{f?.label ?? feature} is switched off</h2>
            <p className="text-sm text-muted-foreground mt-1">{what}</p>
            {f?.reason && (
              <p className="text-sm text-muted-foreground mt-2">
                <span className="text-foreground">Why:</span> {f.reason}
              </p>
            )}
            <Link
              to="/features"
              className="inline-block mt-4 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Open Features
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Wrap a page so it renders FeatureDisabled instead when its feature is off.
 * Keeps the gate next to the route rather than scattered through each page.
 */
export function gated(
  feature: FeatureId,
  what: string,
  // Some pages legitimately render nothing while they load, so the return type
  // has to admit null — pinning it to JSX.Element would exclude them.
  Page: () => JSX.Element | null,
) {
  return function GatedPage(): JSX.Element | null {
    // Unknown / not-yet-loaded reads as enabled — the dashboard fails open, so a
    // slow first fetch never flashes "switched off" at a working install.
    const enabled = useAppSelector(
      state => state.features.features[feature]?.enabled ?? true,
    )
    return enabled ? <Page /> : <FeatureDisabled feature={feature} what={what} />
  }
}
