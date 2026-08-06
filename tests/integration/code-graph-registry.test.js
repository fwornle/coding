/**
 * Code-graph backend registry contract.
 *
 * The registry is what lets a backend be swapped by config instead of by editing
 * five call sites. These tests pin the properties everything downstream relies on:
 * resolution precedence, per-flavor MCP shapes (the thing install.sh's converters
 * got wrong), and the tools list that kgbench derives its --allowedTools from.
 *
 * Pure/static — no services, no Docker — so it runs in lite CI.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRegistry, validate, resolveBackendId, getBackend, listEnabled, hasCapability,
  mcpEntryFor, mcpServerMapFor, allowedToolsFor, artifactPathFor, runtimeEnvFor,
  expandVars, RegistryError,
} from '../../lib/code-graph/registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const registry = loadRegistry(REPO);

describe('shipped registry', () => {
  it('validates clean', () => {
    const { ok, errors } = validate(registry);
    if (!ok) throw new Error(`registry invalid:\n  - ${errors.join('\n  - ')}`);
    expect(ok).toBe(true);
  });

  it('active backend exists and is enabled', () => {
    expect(registry.backends[registry.active]).toBeDefined();
    expect(registry.backends[registry.active].enabled).toBe(true);
    expect(listEnabled(registry)).toContain(registry.active);
  });

  it('every backend declares the fields consumers dereference', () => {
    for (const [id, b] of Object.entries(registry.backends)) {
      expect(typeof b.enabled).toBe(`boolean`);
      expect(b.mcp.serverName).toBeTruthy();
      expect(b.mcp.toolPrefix).toBeTruthy();
      expect(Array.isArray(b.mcp.tools) && b.mcp.tools.length).toBeTruthy();
      expect(b.artifact.hostDir).toBeTruthy();
      expect(b.artifact.primary).toBeTruthy();
      expect(['http', 'stdio']).toContain(b.mcp.transport);
      if (b.mcp.transport === 'stdio') expect(Array.isArray(b.mcp.args)).toBe(true);
      expect(id).toBeTruthy();
    }
  });
});

describe('validate() rejects the failure modes worth catching', () => {
  const mutate = (fn) => {
    const clone = JSON.parse(JSON.stringify(registry));
    fn(clone);
    return validate(clone);
  };

  it('active naming an undefined backend', () => {
    expect(mutate((r) => { r.active = 'nope'; }).ok).toBe(false);
  });

  it('active pointing at a disabled backend', () => {
    // The nastiest case: structurally valid, but agents get a server nothing starts.
    expect(mutate((r) => { r.backends[r.active].enabled = false; }).ok).toBe(false);
  });

  it('two backends claiming the same MCP server name', () => {
    expect(mutate((r) => {
      const [a, b] = Object.keys(r.backends);
      r.backends[b].mcp.serverName = r.backends[a].mcp.serverName;
    }).ok).toBe(false);
  });

  it('two backends claiming the same port', () => {
    expect(mutate((r) => {
      const [a, b] = Object.keys(r.backends);
      r.backends[b].runtime = { ...r.backends[b].runtime, port: r.backends[a].runtime.port };
    }).ok).toBe(false);
  });

  it('an agent pinned to an undefined backend', () => {
    expect(mutate((r) => { r.agents.claude = { backend: 'ghost' }; }).ok).toBe(false);
  });

  it('an http backend with no url', () => {
    expect(mutate((r) => {
      const id = Object.keys(r.backends).find((k) => r.backends[k].mcp.transport === 'http');
      delete r.backends[id].mcp.url;
    }).ok).toBe(false);
  });
});

describe('resolution precedence', () => {
  it('falls back to active when the agent inherits', () => {
    expect(resolveBackendId(registry, { agent: 'claude', env: {} })).toBe(registry.active);
  });

  it('honours a per-agent pin over active', () => {
    const other = Object.keys(registry.backends).find((id) => id !== registry.active);
    const pinned = JSON.parse(JSON.stringify(registry));
    pinned.agents.copilot = { backend: other };
    expect(resolveBackendId(pinned, { agent: 'copilot', env: {} })).toBe(other);
    // ...without disturbing the agents that still inherit.
    expect(resolveBackendId(pinned, { agent: 'claude', env: {} })).toBe(registry.active);
  });

  it('CODE_GRAPH_BACKEND outranks both', () => {
    const other = Object.keys(registry.backends).find((id) => id !== registry.active);
    const pinned = JSON.parse(JSON.stringify(registry));
    pinned.agents.claude = { backend: registry.active };
    expect(resolveBackendId(pinned, { agent: 'claude', env: { CODE_GRAPH_BACKEND: other } })).toBe(other);
  });

  it('rejects an unknown CODE_GRAPH_BACKEND instead of silently ignoring it', () => {
    expect(() => resolveBackendId(registry, { env: { CODE_GRAPH_BACKEND: 'ghost' } })).toThrow(RegistryError);
  });
});

describe('${VAR:-default} expansion', () => {
  it('uses the default when unset and the env value when set', () => {
    expect(expandVars('http://localhost:${P:-3851}/mcp', {})).toBe('http://localhost:3851/mcp');
    expect(expandVars('http://localhost:${P:-3851}/mcp', { P: '9999' })).toBe('http://localhost:9999/mcp');
    // Empty string must not beat the default — an unset-but-exported var is common.
    expect(expandVars('${P:-3851}', { P: '' })).toBe('3851');
  });

  it('expands inside a resolved descriptor', () => {
    const b = getBackend(registry, 'graphify', { env: { GRAPHIFY_MCP_PORT: '4242' } });
    expect(b.mcp.url).toContain('4242');
    expect(b.mcp.url).not.toContain('${');
  });
});

describe('per-flavor MCP entries', () => {
  // These three shapes differ, and emitting the wrong one is precisely how Copilot
  // ended up with an unusable code-graph server.
  const http = Object.keys(registry.backends).find((id) => registry.backends[id].mcp.transport === 'http');
  const stdio = Object.keys(registry.backends).find((id) => registry.backends[id].mcp.transport === 'stdio');

  it('http renders per flavor', () => {
    expect(mcpEntryFor(registry, http, { flavor: 'claude' })).toMatchObject({ type: 'http' });
    expect(mcpEntryFor(registry, http, { flavor: 'copilot' })).toMatchObject({ type: 'http' });
    expect(mcpEntryFor(registry, http, { flavor: 'opencode' })).toMatchObject({ type: 'remote', enabled: true });
    for (const flavor of ['claude', 'copilot', 'opencode']) {
      const e = mcpEntryFor(registry, http, { flavor });
      expect(e.url).toBeTruthy();
      expect(e.command).toBeUndefined(); // an http server has nothing to exec
    }
  });

  it('stdio renders per flavor', () => {
    if (!stdio) return;
    expect(mcpEntryFor(registry, stdio, { flavor: 'claude' })).toMatchObject({ command: expect.any(String) });
    expect(mcpEntryFor(registry, stdio, { flavor: 'copilot' })).toMatchObject({ type: 'stdio' });
    const oc = mcpEntryFor(registry, stdio, { flavor: 'opencode' });
    expect(oc.type).toBe('local');
    // OpenCode wants one flattened array, not command + args.
    expect(Array.isArray(oc.command)).toBe(true);
    expect(oc.command.length).toBeGreaterThan(1);
  });

  it('--named wraps the entry under the declared serverName', () => {
    const map = mcpServerMapFor(registry, http, { flavor: 'claude' });
    expect(Object.keys(map)).toEqual([registry.backends[http].mcp.serverName]);
  });

  it('rejects an unknown flavor rather than emitting a wrong shape', () => {
    expect(() => mcpEntryFor(registry, http, { flavor: 'nope' })).toThrow(RegistryError);
  });
});

describe('derived values', () => {
  it('allowed-tools are fully qualified with the backend prefix', () => {
    for (const id of Object.keys(registry.backends)) {
      const tools = allowedToolsFor(registry, id);
      const { toolPrefix } = registry.backends[id].mcp;
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) expect(t.startsWith(toolPrefix)).toBe(true);
    }
  });

  it('artifact paths resolve for host and container', () => {
    const id = registry.active;
    expect(artifactPathFor(registry, id, { inContainer: true }).startsWith('/coding/')).toBe(true);
    expect(artifactPathFor(registry, id, { inContainer: false }).startsWith(REPO)).toBe(true);
  });

  it('runtime env includes the artifact dir var when declared', () => {
    for (const [id, b] of Object.entries(registry.backends)) {
      const env = runtimeEnvFor(registry, id);
      if (b.artifact.dirEnv) expect(env[b.artifact.dirEnv]).toBeTruthy();
    }
  });

  it('capability lookup gates optional features', () => {
    // The dashboard's Code Graph viewer shells out to graphify's own HTML exporter,
    // so it must stay hidden for any backend without that capability.
    const withHtml = Object.keys(registry.backends).filter((id) => hasCapability(registry, id, 'html-export'));
    expect(withHtml).toContain('graphify');
    expect(hasCapability(registry, registry.active, 'no-such-capability')).toBe(false);
  });

  it('unknown backend ids throw', () => {
    expect(() => getBackend(registry, 'ghost')).toThrow(RegistryError);
  });
});
