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

/**
 * Human name for an ACCOUNT id.
 *
 * The `subscription` column in token_usage is NOT a reliable second identity:
 * it holds four spellings for the Claude Max account alone
 * (`max-oauth-passthrough`, `max-subscription`, `anthropic-subscription`, and
 * empty) and its mapping to provider is many-to-many in both directions. A
 * surface that groups by it shows one account as several rows — which is the
 * same double-counting the provider aliases above exist to prevent, in a column
 * nobody thought to alias.
 *
 * So: group by normalizeProvider(row.provider), label with this. One identity
 * system, not two.
 */
export const PROVIDER_ACCOUNT_LABEL: Record<string, string> = {
  'gh-copilot': 'GitHub Copilot',
  'claude-code-max': 'Claude Max',
  'anthropic-api': 'Anthropic API (metered)',
  'qwen-local': 'On-prem Qwen',
  'qwen-laptop': 'This laptop',
  'groq': 'Groq',
  'openai': 'OpenAI',
  'gaia': 'Gaia',
}

export function accountLabel(provider: string | null | undefined): string {
  const id = normalizeProvider(provider)
  return PROVIDER_ACCOUNT_LABEL[id] || id || 'unknown'
}
