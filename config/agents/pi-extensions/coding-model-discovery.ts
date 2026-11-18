// managed by coding/config/agents/pi.sh
/**
 * Ask each OpenAI-compatible provider in models.json which models it serves.
 *
 * models.json names a provider's endpoint, key and headers, but a model list
 * written there is a snapshot: Copilot adds and retires models, the on-prem
 * cluster gains and drops them, a llama.cpp server serves whatever was loaded,
 * and pi's picker showed only the ids someone once typed. So for every provider
 * with an `openai-completions` endpoint this registers a `refreshModels` that
 * reads `<baseUrl>/models` when pi starts (and on /reload) and returns those ids.
 * For rapid-proxy-pi that is the proxy's GET /v1/models: every Copilot and
 * cluster model its `honor_model_choice` route will serve as picked.
 *
 * The models.json entries come first and always stay — the proxy's routed
 * `proxy-auto` default is listed by no endpoint, and an endpoint that does not
 * answer leaves exactly them. Each listed id they lack follows, with the
 * settings of the provider's first entry (input, context window, reasoning,
 * thinkingLevelMap).
 *
 * Discovery reads the provider's URL from models.json, not the URL a later
 * registration moves it to: glass's relay forwards chat calls and measures
 * them, a model listing is no call. pi merges registrations field by field, so
 * the relay's baseUrl and the coding-proxy-headers headers both survive this.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const TIMEOUT_MS = 2500
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

type ModelDef = Record<string, unknown> & { id: string }
type ProviderDef = { api?: string, baseUrl?: string, apiKey?: string, headers?: Record<string, string>, models?: ModelDef[] }

/** A models.json value: literal, `$NAME` / `${NAME}` from the env, or `!command` output — pi's own rules. */
export function resolveValue(raw: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof raw !== 'string') return ''
  if (raw.startsWith('!')) {
    try { return execSync(raw.slice(1), { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
  }
  return raw.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => (m === '$$' ? '$' : env[a || b] ?? ''))
}

/** The ids `<baseUrl>/models` lists, or [] when it does not answer with a model list. */
export async function listModelIds(p: ProviderDef, env: NodeJS.ProcessEnv, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(p.headers || {})) headers[k] = resolveValue(v, env)
  const key = resolveValue(p.apiKey, env)
  if (key) headers.authorization = `Bearer ${key}`
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const r = await fetchImpl(`${String(p.baseUrl).replace(/\/+$/, '')}/models`, {
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!r.ok) return []
    const j = await r.json() as { data?: Array<{ id?: unknown }> }
    return Array.isArray(j?.data) ? [...new Set(j.data.map((d) => String(d?.id ?? '')).filter(Boolean))] : []
  } catch {
    return []
  }
}

/** The models pi gets: the configured ones, then each listed id they lack, shaped like the first configured one. */
export function modelsFor(p: ProviderDef, ids: string[]): ModelDef[] {
  const configured = (p.models || []).filter((m) => m && typeof m.id === 'string')
  const shaped = (m: ModelDef): ModelDef => ({ cost: ZERO_COST, maxTokens: 16384, ...m })
  const known = new Set(configured.map((m) => m.id))
  const template = configured[0] || { id: '', input: ['text'], contextWindow: 32768, reasoning: false }
  return [...configured, ...ids.filter((id) => !known.has(id)).map((id) => ({ ...template, id, name: id }))].map(shaped)
}

export default function codingModelDiscovery(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env) {
  const dir = env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')
  let providers: Record<string, ProviderDef> = {}
  try {
    providers = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'))?.providers || {}
  } catch {
    return
  }
  for (const [id, p] of Object.entries(providers)) {
    if (p?.api !== 'openai-completions' || typeof p.baseUrl !== 'string') continue
    try {
      pi.registerProvider(id, {
        async refreshModels({ signal }: { signal?: AbortSignal }) {
          return modelsFor(p, await listModelIds(p, env, signal))
        },
      } as never)
    } catch {
      // pi refused the registration: the models.json list stays.
    }
  }
}
