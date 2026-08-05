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
  const questions = doc.questions ?? doc;
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
  const tools = [];
  for (const t of raw.allowedTools ?? []) {
    if (t === '$backendTools') {
      if (!raw.backend) throw new ArmError(`arm "${id}" uses $backendTools but declares no backend`);
      tools.push(...allowedToolsFor(registry, raw.backend, { env }));
    } else if (t === '$allBackendTools') {
      for (const b of listEnabled(registry)) tools.push(...allowedToolsFor(registry, b, { env }));
    } else {
      tools.push(t);
    }
  }

  // MCP config: explicit, or assembled from the arm's backend(s).
  let mcpConfig = raw.mcp;
  if (!mcpConfig) {
    const backends = raw.mcpFrom ?? (raw.backend ? [raw.backend] : []);
    const servers = {};
    for (const b of backends) Object.assign(servers, mcpServerMapFor(registry, b, { flavor: 'claude', env }));
    mcpConfig = { mcpServers: servers };
  }

  return {
    id,
    kind: raw.kind ?? 'agent',
    enabled: raw.enabled !== false,
    label: raw.label ?? id,
    note: raw.note ?? null,
    backend: raw.backend ?? null,
    model: raw.model ?? defaults.model ?? 'claude-sonnet-5',
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
