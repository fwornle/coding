// glass's stand-in for src/lib/provider-site.ts (aliased in vite.config.ts): glass
// has no routing config of its own, so no site providers. A user's offload
// endpoint is named in their settings, never in the build.

export const SITE_PROVIDER_COLORS: Record<string, string> = {}

export const SITE_PROVIDER_LABELS: Record<string, string> = {}

// glass's own hardware is whatever its offload target is called — learned from
// the proxy's `local_providers`, never named in the build.
export const SITE_LOCAL_PROVIDERS: string[] = []
