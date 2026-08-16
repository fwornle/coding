// Account identity for LLM providers.
//
// A provider id names an ACCOUNT, not a company: `claude-code-max` (personal Max
// subscription) and `anthropic-api` (metered key) both serve Claude models but
// are entirely different money. Every surface that groups usage or draws a route
// must agree on that identity, or the same call gets counted twice under two
// spellings.
//
// Historical token_usage rows written before the account-id change still carry
// the old labels, so they are mapped forward here rather than left to render as
// their own slices. `anthropic` is the ambiguous one: on the /v1/messages tap it
// meant Max, which is what the overwhelming majority of those rows are, so it
// maps to claude-code-max. Direct API-key traffic now writes `anthropic-api`
// explicitly.
export const PROVIDER_ALIASES: Record<string, string> = {
  'copilot': 'gh-copilot',
  'github-copilot': 'gh-copilot',
  'github': 'gh-copilot',
  'claude-code': 'claude-code-max',
  'anthropic': 'claude-code-max',
  'max-subscription': 'claude-code-max',
}

export function normalizeProvider(provider: string | null | undefined): string {
  if (!provider) return provider ?? ''
  const key = provider.trim().toLowerCase()
  return PROVIDER_ALIASES[key] ?? key
}

// Keyed by ACCOUNT — the thing that gets billed, not the company that owns the
// model. getProviderColor() normalizes its argument first, so historical wire
// labels (`copilot`, `claude-code`, `anthropic`) resolve here too.
export const PROVIDER_COLORS: Record<string, string> = {
  'gh-copilot': '#2563eb',       // corporate GitHub Copilot contract
  'claude-code-max': '#d97706',  // personal Claude Max subscription
  'anthropic-api': '#b45309',    // metered Anthropic key — deliberately distinct from Max
  'groq': '#7c3aed',
  'openai': '#059669',
  'gaia': '#64748b',
}

export function getProviderColor(provider: string | null | undefined): string {
  return PROVIDER_COLORS[normalizeProvider(provider)] || '#6b7280'
}
