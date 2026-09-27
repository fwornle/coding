/**
 * The shape `/api/token-usage/recent` actually returns, and the only place the
 * dashboard is allowed to unwrap it.
 *
 * rapid-llm-proxy answers `{ data: RecentCall[], scope }`. Every other reader in
 * this repo says `body?.data || []` (llm-latency-tile, token-usage.tsx,
 * health-coordinator). One reader instead said `json.calls ?? json ?? []`, and
 * `calls` has never been a key the proxy emits — so the `?? json` arm handed the
 * WHOLE RESPONSE OBJECT to a consumer that called `.filter` on it. That is not a
 * missing badge, it is `TypeError: s.filter is not a function` thrown during
 * render, which React escalates to unmounting the tree: the entire dashboard went
 * white the moment a workflow opened the node sidebar.
 *
 * So the contract is enforced by TYPE, not by convention: this returns an array
 * or it returns an empty array. A future rename on the proxy side costs a quiet
 * empty badge, never a blank page.
 */

export interface RecentCall {
  id: number
  timestamp: string
  provider: string
  model: string
  process: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  latency_ms: number
  subscription: string
  prompt_preview: string
}

/**
 * `data` is the live key; `calls` is accepted because a caller in this repo
 * believed in it, and accepting both costs nothing. Anything else — a bare
 * array, an error envelope, null, a string — resolves to [].
 */
export function rowsFromRecentResponse(json: unknown): RecentCall[] {
  if (Array.isArray(json)) return json as RecentCall[]
  if (json && typeof json === 'object') {
    const body = json as Record<string, unknown>
    if (Array.isArray(body.data)) return body.data as RecentCall[]
    if (Array.isArray(body.calls)) return body.calls as RecentCall[]
  }
  return []
}
