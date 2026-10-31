// managed by coding/config/agents/pi.sh
/**
 * Name the coding session on every call pi sends through the coding proxy.
 *
 * The proxy files a call under the project and task it is told about
 * (x-project, x-task-id). pi can read header values from its env with `$VAR`
 * in models.json, but a reference to an unset variable is an error there: the
 * provider refuses to resolve and pi cannot send a single turn. Under
 * CODING_AGENT_SCOPE=global that file is ~/.pi/agent/models.json, which every
 * `pi` reads — also one started from a shell coding never set up, where
 * CODING_PROJECT_ID and TASK_ID do not exist.
 *
 * So models.json names only the agent, and this extension adds the rest from
 * pi's own env at start, for the variables that are set. Outside a coding
 * launch nothing is set and it does nothing.
 *
 * pi merges a later registration of the same provider field by field, so this
 * keeps the baseUrl, key and models from models.json, and another extension
 * that moves the baseUrl (glass's relay) keeps these headers.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const PROVIDER = 'rapid-proxy-pi'

export default function codingProxyHeaders(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env) {
  const headers: Record<string, string> = { 'x-agent': 'pi' }
  if (env.CODING_PROJECT_ID) headers['x-project'] = env.CODING_PROJECT_ID
  if (env.TASK_ID) headers['x-task-id'] = env.TASK_ID
  if (Object.keys(headers).length === 1) return
  try {
    pi.registerProvider(PROVIDER, { headers })
  } catch {
    // The provider was removed from models.json: nothing to name.
  }
}
