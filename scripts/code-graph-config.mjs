#!/usr/bin/env node
/**
 * CLI over lib/code-graph/registry.mjs, so bash callers never parse JSON themselves.
 *
 *   code-graph-config.mjs active [--agent claude]
 *   code-graph-config.mjs list [--enabled] [--json]
 *   code-graph-config.mjs get <id> [--field mcp.url]
 *   code-graph-config.mjs mcp-entry [<id>] [--agent claude] [--flavor claude|opencode|copilot] [--named]
 *   code-graph-config.mjs allowed-tools [<id>] [--agent claude]
 *   code-graph-config.mjs artifact [<id>] [--container]
 *   code-graph-config.mjs runtime-env [<id>] [--export]
 *   code-graph-config.mjs has-capability <id> <capability>   # exit 0 = yes, 1 = no
 *   code-graph-config.mjs validate
 *
 * Exit codes: 0 ok, 1 predicate false, 2 usage/registry error.
 *
 * stdout is this program's return value (callers capture it), which is why it writes
 * with console.log rather than the Logger — see the no-console-log whitelist note in
 * .constraint-monitor.yaml.
 */

import {
  loadRegistry, validate, assertValid, resolveBackendId, getBackend, listEnabled,
  mcpEntryFor, mcpServerMapFor, allowedToolsFor, artifactPathFor, runtimeEnvFor,
  hasCapability, RegistryError,
} from '../lib/code-graph/registry.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];

// Flags that consume the following argument. Needed so their VALUE is not mistaken
// for a positional — `mcp-entry --flavor claude` must not read "claude" as a backend id.
const VALUE_FLAGS = new Set(['agent', 'flavor', 'field']);

const positional = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (VALUE_FLAGS.has(a.slice(2))) i++;
    continue;
  }
  positional.push(a);
}

const out = (s) => console.log(s);

function flag(name) { return argv.includes(`--${name}`); }
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
function dig(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function die(msg) { console.error(`code-graph-config: ${msg}`); process.exit(2); }

let registry;
try {
  registry = loadRegistry();
} catch (err) {
  die(err.message);
}

// `validate` runs before assertValid so it reports every problem instead of throwing on the first.
if (cmd === 'validate') {
  const { ok, errors } = validate(registry);
  if (ok) { out('code-graph registry OK'); process.exit(0); }
  console.error('code-graph registry INVALID:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(2);
}

try {
  assertValid(registry);

  // Most subcommands take an explicit id, else resolve one for --agent.
  const resolve = () => positional[0] || resolveBackendId(registry, { agent: opt('agent', undefined) });

  switch (cmd) {
    case 'active':
      out(resolveBackendId(registry, { agent: opt('agent', undefined) }));
      break;

    case 'list': {
      const ids = flag('enabled') ? listEnabled(registry) : Object.keys(registry.backends);
      if (flag('json')) {
        out(JSON.stringify(ids.map((id) => getBackend(registry, id)), null, 2));
      } else {
        for (const id of ids) {
          const b = getBackend(registry, id);
          out(`${b.enabled ? '*' : ' '} ${id.padEnd(16)} ${b.mcp.transport.padEnd(6)} ${b.summary ?? ''}`);
        }
      }
      break;
    }

    case 'get': {
      const b = getBackend(registry, resolve());
      const field = opt('field', null);
      const value = field ? dig(b, field) : b;
      if (value === undefined) die(`no such field: ${field}`);
      out(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      break;
    }

    case 'mcp-entry': {
      const id = resolve();
      const flavor = opt('flavor', 'claude');
      // --named wraps it as {serverName: entry} for splicing into a server map.
      const value = flag('named')
        ? mcpServerMapFor(registry, id, { flavor })
        : mcpEntryFor(registry, id, { flavor });
      out(JSON.stringify(value, null, 2));
      break;
    }

    case 'allowed-tools':
      out(allowedToolsFor(registry, resolve()).join(','));
      break;

    case 'artifact':
      out(artifactPathFor(registry, resolve(), { inContainer: flag('container') }));
      break;

    case 'runtime-env': {
      const env = runtimeEnvFor(registry, resolve());
      for (const [k, v] of Object.entries(env)) {
        out(flag('export') ? `export ${k}=${JSON.stringify(v)}` : `${k}=${v}`);
      }
      break;
    }

    case 'has-capability': {
      const [id, capability] = positional;
      if (!id || !capability) die('usage: has-capability <id> <capability>');
      process.exit(hasCapability(registry, id, capability) ? 0 : 1);
      break;
    }

    default:
      die(`unknown command ${JSON.stringify(cmd)}. See the header of this file for usage.`);
  }
} catch (err) {
  die(err instanceof RegistryError ? err.message : (err.stack ?? String(err)));
}
