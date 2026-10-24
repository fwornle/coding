/**
 * Which billed accounts count — the machine's saved selection
 * (`/api/token-usage/accounts`; coding: the proxy's cost settings, glass:
 * ~/.glass/cost.json). The proxy applies it to every token-usage read, so the
 * cards, charts, tables and the status line all describe the same rows.
 */
export interface AccountSelection {
  accounts: Array<{ account: string; calls: number }>
  excluded: string[]
  writable: boolean
}

/** The selection, or null on a proxy that predates it (then nothing is filtered). */
export async function fetchAccountSelection(proxyBase: string): Promise<AccountSelection | null> {
  try {
    const res = await fetch(`${proxyBase}/api/token-usage/accounts`)
    if (!res.ok) return null
    return await res.json() as AccountSelection
  } catch {
    return null
  }
}
