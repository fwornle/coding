// The providers of THIS installation's own routing config: self-hosted model
// servers, named by its llm-routing.yaml. Kept apart from providers.ts so a build
// for other installations (glass: glass-ui/vite.config.ts) swaps this module for
// an empty one and ships none of these names.

export const SITE_PROVIDER_COLORS: Record<string, string> = {
  'qwen-local': '#0891b2',       // on-prem V100 cluster — unmetered
  'qwen-laptop': '#c026d3',      // llama.cpp on this machine — unmetered
}

export const SITE_PROVIDER_LABELS: Record<string, string> = {
  'qwen-local': 'On-prem Qwen',
  'qwen-laptop': 'This laptop',
}

/**
 * The site providers that run on our own hardware — free per token. The cost
 * model also learns them from the proxy (`local_providers`: whoever served an
 * offloaded call); this list covers the ones that served only routed calls.
 */
export const SITE_LOCAL_PROVIDERS: string[] = ['qwen-local', 'qwen-laptop']
