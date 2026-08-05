/**
 * Code-graph backend registry.
 *
 * Single source of truth for which retrieval backend an agent talks to. Everything
 * that needs to know — the MCP config generators, the reindex dispatcher, the
 * dashboard's capability gates, and kgbench's arm definitions — reads it from here
 * rather than hardcoding a tool name.
 *
 * Deliberately dependency-free (node: builtins only) so bash callers can shell out
 * to scripts/code-graph-config.mjs without a node_modules install existing yet.
 *
 * Resolution precedence, highest first:
 *   1. CODE_GRAPH_BACKEND env var        — one-off override, used by kgbench and debugging
 *   2. agents.<agent>.backend            — per-agent pin, when not "inherit"
 *   3. active                            — the project default
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(HERE, '..', '..');
export const CONFIG_RELPATH = 'config/code-graph.json';

/** Thrown for any registry problem so callers can distinguish it from an I/O error. */
export class RegistryError extends Error {}

/**
 * Expand `${VAR}` and `${VAR:-default}` against an environment.
 * Used for port/URL fields so a descriptor can defer to .env.ports without
 * duplicating the number.
 */
export function expandVars(value, env = process.env) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name, fallback) => {
    const v = env[name];
    return v !== undefined && v !== '' ? v : (fallback ?? '');
  });
}

function expandDeep(node, env) {
  if (Array.isArray(node)) return node.map((v) => expandDeep(v, env));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expandDeep(v, env)]));
  }
  return expandVars(node, env);
}

export function loadRegistry(repoRoot = DEFAULT_REPO_ROOT) {
  const file = path.join(repoRoot, CONFIG_RELPATH);
  if (!existsSync(file)) throw new RegistryError(`registry not found: ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new RegistryError(`registry is not valid JSON (${file}): ${err.message}`);
  }
  parsed._repoRoot = repoRoot;
  return parsed;
}

/**
 * Structural validation. Returns {ok, errors[]} rather than throwing so CI can
 * print every problem at once instead of one per run.
 */
export function validate(registry) {
  const errors = [];
  const backends = registry?.backends ?? {};
  const ids = Object.keys(backends);

  if (registry?.version !== 1) errors.push(`version must be 1, got ${JSON.stringify(registry?.version)}`);
  if (!ids.length) errors.push('no backends defined');
  if (!registry?.active) errors.push('`active` is required');
  else if (!backends[registry.active]) errors.push(`active="${registry.active}" is not a defined backend`);
  else if (backends[registry.active].enabled !== true) {
    errors.push(`active="${registry.active}" is defined but enabled=false`);
  }

  for (const [agent, cfg] of Object.entries(registry?.agents ?? {})) {
    const b = cfg?.backend;
    if (b && b !== 'inherit' && !backends[b]) {
      errors.push(`agents.${agent}.backend="${b}" is not a defined backend`);
    }
  }

  const seenServerNames = new Map();
  const seenPorts = new Map();

  for (const id of ids) {
    const b = backends[id];
    const at = (f) => `backends.${id}.${f}`;
    if (typeof b.enabled !== 'boolean') errors.push(`${at('enabled')} must be a boolean`);
    if (!Array.isArray(b.capabilities)) errors.push(`${at('capabilities')} must be an array`);

    const mcp = b.mcp ?? {};
    if (!mcp.serverName) errors.push(`${at('mcp.serverName')} is required`);
    else {
      if (seenServerNames.has(mcp.serverName)) {
        errors.push(`duplicate mcp.serverName "${mcp.serverName}" in ${id} and ${seenServerNames.get(mcp.serverName)}`);
      }
      seenServerNames.set(mcp.serverName, id);
    }
    if (!Array.isArray(mcp.tools) || !mcp.tools.length) errors.push(`${at('mcp.tools')} must be a non-empty array`);
    if (!mcp.toolPrefix) errors.push(`${at('mcp.toolPrefix')} is required`);

    if (mcp.transport === 'http') {
      if (!mcp.url) errors.push(`${at('mcp.url')} is required for transport=http`);
    } else if (mcp.transport === 'stdio') {
      if (!mcp.command) errors.push(`${at('mcp.command')} is required for transport=stdio`);
      if (!Array.isArray(mcp.args)) errors.push(`${at('mcp.args')} must be an array for transport=stdio`);
    } else {
      errors.push(`${at('mcp.transport')} must be "http" or "stdio", got ${JSON.stringify(mcp.transport)}`);
    }

    const port = b.runtime?.port;
    if (port != null) {
      if (seenPorts.has(port)) errors.push(`port ${port} claimed by both ${id} and ${seenPorts.get(port)}`);
      seenPorts.set(port, id);
    }

    if (!b.artifact?.hostDir) errors.push(`${at('artifact.hostDir')} is required`);
    if (!b.artifact?.primary) errors.push(`${at('artifact.primary')} is required`);
  }

  return { ok: errors.length === 0, errors };
}

/** Throwing wrapper for callers that cannot proceed on a bad registry. */
export function assertValid(registry) {
  const { ok, errors } = validate(registry);
  if (!ok) throw new RegistryError(`invalid code-graph registry:\n  - ${errors.join('\n  - ')}`);
  return registry;
}

export function resolveBackendId(registry, { agent, env = process.env } = {}) {
  const override = env.CODE_GRAPH_BACKEND;
  if (override) {
    if (!registry.backends?.[override]) {
      throw new RegistryError(`CODE_GRAPH_BACKEND="${override}" is not a defined backend`);
    }
    return override;
  }
  const pinned = agent ? registry.agents?.[agent]?.backend : undefined;
  if (pinned && pinned !== 'inherit') return pinned;
  return registry.active;
}

export function getBackend(registry, id, { env = process.env } = {}) {
  const raw = registry.backends?.[id];
  if (!raw) throw new RegistryError(`unknown backend "${id}"`);
  return { id, ...expandDeep(raw, env) };
}

export function listEnabled(registry) {
  return Object.entries(registry.backends ?? {})
    .filter(([, b]) => b.enabled === true)
    .map(([id]) => id);
}

export function hasCapability(registry, id, capability, opts = {}) {
  return (getBackend(registry, id, opts).capabilities ?? []).includes(capability);
}

/**
 * MCP entry for one backend, in the shape the target agent expects.
 *
 * The three flavors genuinely differ — this is the knowledge that used to be
 * duplicated (and drift) across install.sh's converters:
 *   claude:   {type:"http",url} | {command,args,env}
 *   opencode: {type:"remote",url,enabled} | {type:"local",command:[cmd,...args],enabled}
 *   copilot:  {type:"http",url} | {type:"stdio",command,args}
 */
export function mcpEntryFor(registry, id, { flavor = 'claude', env = process.env } = {}) {
  const { mcp } = getBackend(registry, id, { env });
  const http = mcp.transport === 'http';

  if (flavor === 'opencode') {
    return http
      ? { type: 'remote', url: mcp.url, enabled: true }
      : { type: 'local', command: [mcp.command, ...(mcp.args ?? [])], enabled: true };
  }
  if (flavor === 'copilot') {
    return http
      ? { type: 'http', url: mcp.url }
      : { type: 'stdio', command: mcp.command, args: mcp.args ?? [] };
  }
  if (flavor === 'claude') {
    return http ? { type: 'http', url: mcp.url } : { command: mcp.command, args: mcp.args ?? [] };
  }
  throw new RegistryError(`unknown flavor "${flavor}"`);
}

/** `{serverName: entry}`, ready to splice into an mcpServers/servers/mcp map. */
export function mcpServerMapFor(registry, id, opts = {}) {
  const { mcp } = getBackend(registry, id, opts);
  return { [mcp.serverName]: mcpEntryFor(registry, id, opts) };
}

/**
 * Fully-qualified tool names, e.g. "mcp__graphify__query_graph,...".
 * kgbench builds its --allowedTools from this so an arm provably exercises the
 * same tool surface production exposes.
 */
export function allowedToolsFor(registry, id, opts = {}) {
  const { mcp } = getBackend(registry, id, opts);
  return (mcp.tools ?? []).map((t) => `${mcp.toolPrefix}${t}`);
}

export function artifactPathFor(registry, id, { inContainer = false, env = process.env } = {}) {
  const b = getBackend(registry, id, { env });
  const base = inContainer
    ? b.artifact.containerDir
    : path.join(registry._repoRoot ?? DEFAULT_REPO_ROOT, b.artifact.hostDir);
  return path.join(base, b.artifact.primary);
}

/** Env pairs a container process needs for this backend (artifact dir + runtime knobs). */
export function runtimeEnvFor(registry, id, opts = {}) {
  const b = getBackend(registry, id, opts);
  const out = { ...(b.runtime?.env ?? {}) };
  if (b.artifact?.dirEnv) out[b.artifact.dirEnv] = b.artifact.dirEnvValue ?? b.artifact.containerDir;
  return out;
}
