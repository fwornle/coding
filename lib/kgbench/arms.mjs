/**
 * Arm loading and resolution for kgbench.
 *
 * The important job here is expanding $backendTools / $allBackendTools from
 * config/code-graph.json rather than letting an arm hand-write MCP tool names.
 * If an arm could list its own tools, the benchmark would drift from what agents
 * actually get, and every number would silently stop describing production.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { armIsFaithful } from './agents.mjs';
import {
  loadRegistry, getBackend, allowedToolsFor, mcpServerMapFor, artifactPathFor, listEnabled,
} from '../code-graph/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export class ArmError extends Error {}

const expandEnv = (s, env = process.env) =>
  typeof s === 'string'
    ? s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, n, d) => env[n] || d || '')
    : s;

export function loadArms(repoRoot = REPO_ROOT) {
  const file = path.join(repoRoot, 'config/kgbench/arms.json');
  if (!existsSync(file)) throw new ArmError(`arms config not found: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadQuestions(setName, repoRoot = REPO_ROOT) {
  const file = path.join(repoRoot, 'config/kgbench/questions', `${setName}.json`);
  if (!existsSync(file)) throw new ArmError(`question set not found: ${file}`);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const all = doc.questions ?? doc;
  // A retired question keeps `enabled: false` and a `retired` block rather than being
  // deleted, so the reason it stopped being gradeable stays in the repository next to
  // the question that had the defect.
  const questions = all.filter((q) => q.enabled !== false);
  const ids = new Set();
  for (const q of questions) {
    if (!q.id) throw new ArmError(`question missing id in ${file}`);
    if (ids.has(q.id)) throw new ArmError(`duplicate question id "${q.id}" in ${file}`);
    ids.add(q.id);
    if (!q.prompt) throw new ArmError(`question ${q.id} has no prompt`);
    if (!q.cls) throw new ArmError(`question ${q.id} has no class`);
  }
  return { set: doc.set ?? setName, questions };
}

/**
 * Resolve one arm into everything the runner needs:
 * {id, kind, label, model, allowedTools[], mcpConfig{}, promptPrefix, preflight[]}
 */
export function resolveArm(armsDoc, id, { repoRoot = REPO_ROOT, env = process.env } = {}) {
  const raw = armsDoc.arms?.[id];
  if (!raw) throw new ArmError(`unknown arm "${id}"`);
  const defaults = armsDoc.defaults ?? {};
  const registry = loadRegistry(repoRoot);

  // Tool list, with backend tokens expanded from the code-graph registry.
  // `granted` records which backends the tokens actually pulled tools from, so the MCP
  // config can be derived from the same expansion instead of being restated by hand.
  const tools = [];
  const granted = [];
  for (const t of raw.allowedTools ?? []) {
    if (t === '$backendTools') {
      if (!raw.backend) throw new ArmError(`arm "${id}" uses $backendTools but declares no backend`);
      granted.push(raw.backend);
      tools.push(...allowedToolsFor(registry, raw.backend, { env }));
    } else if (t === '$allBackendTools') {
      for (const b of listEnabled(registry)) {
        granted.push(b);
        tools.push(...allowedToolsFor(registry, b, { env }));
      }
    } else {
      tools.push(t);
    }
  }

  // MCP config: explicit, or assembled from the arm's backend(s).
  //
  // The default follows the TOOL EXPANSION, not just `backend`. An arm granting
  // $allBackendTools while naming one backend in mcpFrom is the shape this defaulting
  // exists to prevent: it yields tool names for a server that was never configured, so
  // those tools simply do not exist at runtime and the arm quietly measures a narrower
  // strategy than its label claims.
  let mcpConfig = raw.mcp;
  if (!mcpConfig) {
    const backends = raw.mcpFrom ?? (granted.length ? [...new Set(granted)] : (raw.backend ? [raw.backend] : []));
    const servers = {};
    for (const b of backends) Object.assign(servers, mcpServerMapFor(registry, b, { flavor: 'claude', env }));
    mcpConfig = { mcpServers: servers };
  }

  // Guarantee, not convention: every granted MCP tool must have its server configured.
  // --strict-mcp-config means an unconfigured server's tools are absent rather than
  // refused, so the arm neither errors nor escapes — it just silently loses a retrieval
  // strategy, and the run still produces a full table of plausible numbers.
  const configured = new Set(Object.keys(mcpConfig.mcpServers ?? {}));
  const orphaned = [...new Set(tools.filter((t) => t.startsWith('mcp__') && !configured.has(t.split('__')[1])))];
  if (orphaned.length) {
    throw new ArmError(
      `arm "${id}" grants MCP tool(s) whose server is not configured: ${orphaned.join(', ')}\n`
      + `  configured servers: ${[...configured].join(', ') || '(none)'}\n`
      + '  Add the backend to this arm\'s `mcpFrom`, or drop the tool grant.',
    );
  }

  return {
    id,
    kind: raw.kind ?? 'agent',
    enabled: raw.enabled !== false,
    label: raw.label ?? id,
    note: raw.note ?? null,
    backend: raw.backend ?? null,
    model: raw.model ?? defaults.model ?? 'claude-sonnet-5',
    // The AGENT and MODEL axes. `model` above stays the single-agent default so every
    // existing caller and every r6/r7 cell is unaffected; these two only widen the matrix
    // when a config or a flag asks for it.
    //
    // Defaulting `agents` to ['claude'] rather than to every known agent is deliberate.
    // Only claude can be confined to an arm's tool surface, so silently fanning out would
    // turn a controlled comparison into an uncontrolled one and fill the table with cells
    // whose labels overstate what was enforced.
    agents: raw.agents ?? defaults.agents ?? ['claude'],
    models: raw.models ?? defaults.models ?? [raw.model ?? defaults.model ?? 'claude-sonnet-5'],
    timeoutMs: raw.timeoutMs ?? defaults.timeoutMs ?? 300000,
    maxAttempts: raw.maxAttempts ?? defaults.maxAttempts ?? 2,
    allowedTools: [...new Set(tools)],
    mcpConfig,
    promptPrefix: raw.promptPrefix ?? null,
    preflight: (raw.preflight ?? []).map((p) => ({ ...p, url: expandEnv(p.url, env) })),
    index: raw.index ?? null,
  };
}

export function resolveArms(armsDoc, ids, opts = {}) {
  return ids.map((id) => resolveArm(armsDoc, id, opts));
}

/**
 * Expand resolved arms into the (arm, agent, model) cells a run will execute.
 *
 * The faithfulness gate is applied HERE, where cells come into existence, rather than left
 * to each caller. An arm whose identity depends on withholding built-in search cannot be
 * reproduced on an agent that has no way to withhold them, and a cell like that is not a
 * weaker measurement — it is a differently-labelled one. Skipped combinations are RETURNED,
 * never silently dropped: a matrix that quietly shrinks reads as "we measured everything".
 *
 * @returns {{cells: Array<{arm, agent: string, modelRef: string}>, skipped: Array<{arm: string, agent: string, reason: string}>}}
 */
export function expandArmCells(arms, { agents = null, models = null } = {}) {
  const cells = [];
  const skipped = [];
  for (const arm of arms) {
    for (const agent of agents ?? arm.agents ?? ['claude']) {
      const verdict = armIsFaithful(arm, agent);
      if (!verdict.faithful) {
        skipped.push({ arm: arm.id, agent, reason: verdict.reason });
        continue;
      }
      for (const modelRef of models ?? arm.models ?? [arm.model]) {
        cells.push({ arm, agent, modelRef });
      }
    }
  }
  return { cells, skipped };
}

export function enabledArmIds(armsDoc) {
  return Object.entries(armsDoc.arms ?? {})
    .filter(([, a]) => a.enabled !== false)
    .map(([id]) => id);
}

/**
 * How to build a backend's index, for the fresh-install case where none exists.
 * Both scripts live inside the coding-services container, so the host-side answer is
 * the shim / docker exec form rather than the container path in config/code-graph.json.
 */
function indexHintFor(backend) {
  const hints = {
    graphify: './bin/graphify update',
    codegraph: 'docker exec -i coding-services /usr/local/bin/codegraph-index.sh update < /dev/null',
  };
  return hints[backend] ?? `see config/code-graph.json -> backends.${backend}.index`;
}

/**
 * Availability check. Runs before ANY question executes: a down MCP server would
 * otherwise be indistinguishable from a backend that simply answers badly, and the
 * whole run would be quietly worthless.
 */
export async function preflightArm(arm, { repoRoot = REPO_ROOT } = {}) {
  const problems = [];
  for (const check of arm.preflight ?? []) {
    if (check.type === 'http') {
      try {
        const ctl = AbortSignal.timeout(check.timeoutMs ?? 5000);
        const res = await fetch(check.url, { method: 'GET', signal: ctl });
        // Any HTTP response proves the listener is up; MCP endpoints legitimately
        // reject a bare GET, so status is not the signal here.
        if (!res) problems.push(`no response from ${check.url}`);
      } catch (err) {
        problems.push(`${check.url} unreachable (${err.message})`);
      }
    } else if (check.type === 'artifact') {
      const registry = loadRegistry(repoRoot);
      const p = artifactPathFor(registry, check.backend, { inContainer: false });
      // On a fresh install no index has been built yet, and "artifact missing: <path>"
      // alone leaves the reader to work out which of several reindex entrypoints
      // produces that file. Name the command.
      if (!existsSync(p)) problems.push(`index not built for "${check.backend}" (missing ${p}) — run: ${indexHintFor(check.backend)}`);
    } else if (check.type === 'file') {
      if (!existsSync(expandEnv(check.path))) problems.push(`file missing: ${check.path}`);
    }
  }
  return { arm: arm.id, ok: problems.length === 0, problems };
}

export { getBackend };
