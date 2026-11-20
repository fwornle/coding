// lib/glass/offload-store.mjs — the opt-in offload's settings, owner-only, in GLASS_HOME.
//
//   offload.json   what the UI / `glass offload` set (normalizeOffloadConfig shape)
//   .env           the endpoint's key (keys.mjs), apart from the settings so no read
//                  of them can carry it
//
// One secret, one name: when the target is a gateway of the cluster in cluster.json
// (a node's host on its gatewayPort), the key is CLUSTER_OPS_KEY — the Cluster page's
// key for the same gateways — and OFFLOAD_KEY, which is for any other endpoint, is not
// used. A leftover OFFLOAD_KEY is folded into it: moved when CLUSTER_OPS_KEY is unset,
// removed when it holds the same secret, and left in place (and reported) when it
// holds another.
//
// Read per call through an mtime check: the UI's PATCH and a hand edit of the file
// both apply to the next model call — no daemon restart, no agent relaunch. Nothing
// here knows any endpoint; with no file, offload is off.
import fs from 'node:fs';
import path from 'node:path';

import { normalizeOffloadConfig } from '../../proxy/proxy-bridge/offload.mjs';
import { createKeyStore, KEY_NAMES } from './keys.mjs';

/** Whether `url` is a gateway of the cluster `c` (createClusterStore().getConfig()). */
export function isClusterGateway(url, c) {
  if (!c?.configured || !url) return false;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`); } catch { return false; }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return port === c.gatewayPort && c.nodes.some((n) => String(n.host).toLowerCase() === host);
}

/** @param {{ cluster?: ReturnType<import('./cluster.mjs').createClusterStore> }} [o] */
export function createOffloadStore(home, { cluster = null } = {}) {
  const file = path.join(home, 'offload.json');
  const keys = cluster?.keys ?? createKeyStore(home);
  let cached = null;
  let cachedMtime = -1;

  const mtimeOf = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const write = (f, text) => {
    fs.mkdirSync(home, { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, f);
  };

  function getConfig() {
    const m = mtimeOf(file);
    if (cached && m === cachedMtime) return cached;
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none or unreadable → off */ }
    cached = normalizeOffloadConfig(raw);
    cachedMtime = m;
    return cached;
  }

  /** Merge a partial change (the UI sends only what it edits) and persist it. */
  function update(patch) {
    const cur = getConfig();
    const p = patch && typeof patch === 'object' ? patch : {};
    const next = normalizeOffloadConfig({
      ...cur,
      ...p,
      agents: { ...cur.agents, ...(p.agents || {}) },
      target: { ...cur.target, ...(p.target || {}), models: { ...cur.target.models, ...(p.target?.models || {}) } },
    });
    write(file, `${JSON.stringify(next, null, 2)}\n`);
    cached = next;
    cachedMtime = mtimeOf(file);
    return next;
  }

  /** 'ops' when the target is one of cluster.json's gateways, else 'offload'. */
  const keySource = () => (cluster && isClusterGateway(getConfig().target.url, cluster.getConfig()) ? 'ops' : 'offload');

  /** A leftover OFFLOAD_KEY for a cluster target: moved into CLUSTER_OPS_KEY, or dropped as a copy. */
  function fold() {
    const own = keys.read('offload');
    if (!own.key) return '';
    const c = keys.read('ops');
    if (c.problem) return '';
    if (!c.key) { keys.write('ops', own.key); keys.write('offload', ''); return ''; }
    if (c.key === own.key) { keys.write('offload', ''); return ''; }
    return `${KEY_NAMES.offload} holds another key than ${KEY_NAMES.ops} and is not used for a cluster gateway — remove it`;
  }

  /** The key the target is called with, the variable that holds it, and why it cannot be used. */
  function keyState() {
    const source = keySource();
    const leftover = source === 'ops' ? fold() : '';
    const k = keys.read(source);
    return { key: k.key, file: k.name, problem: k.problem || leftover };
  }

  const getKey = () => keyState().key;

  /** '' removes the key — from the variable the target's key lives in. */
  const setKey = (key) => keys.write(keySource(), key);

  return { getConfig, update, getKey, setKey, keyState, hasKey: () => Boolean(getKey()), file, keyFile: keys.file };
}
