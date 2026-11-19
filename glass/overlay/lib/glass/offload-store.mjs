// lib/glass/offload-store.mjs — the opt-in offload's settings, owner-only, in GLASS_HOME.
//
//   offload.json   what the UI / `glass offload` set (normalizeOffloadConfig shape)
//   offload.key    the endpoint's API key, alone, so no read of the settings can carry it
//
// One secret, one file: when the target is a gateway of the cluster in cluster.json
// (a node's host on its gatewayPort), the key is cluster.key — the Cluster page's
// key for the same gateways — and offload.key is not used. A leftover offload.key
// is folded into it: moved when cluster.key is missing, removed when it holds the
// same secret, and left in place (and reported) when it holds another.
//
// Read per call through an mtime check: the UI's PATCH and a hand edit of the file
// both apply to the next model call — no daemon restart, no agent relaunch. Nothing
// here knows any endpoint; with no file, offload is off.
import fs from 'node:fs';
import path from 'node:path';

import { normalizeOffloadConfig } from '../../proxy/proxy-bridge/offload.mjs';

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
  const keyFile = path.join(home, 'offload.key');
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

  const readOwn = () => { try { return fs.readFileSync(keyFile, 'utf8').trim(); } catch { return ''; } };
  const removeOwn = () => { try { fs.rmSync(keyFile); } catch { /* none */ } };

  /** 'cluster' when the target is one of cluster.json's gateways, else 'offload'. */
  const keySource = () => (cluster && isClusterGateway(getConfig().target.url, cluster.getConfig()) ? 'cluster' : 'offload');

  /** A leftover offload.key for a cluster target: moved into cluster.key, or dropped as a copy. */
  function fold() {
    const own = readOwn();
    if (!own) return '';
    const c = cluster.readKey('gateway');
    if (c.problem) return '';
    if (!c.key) { cluster.writeKey('gateway', own); removeOwn(); return ''; }
    if (c.key === own) { removeOwn(); return ''; }
    return 'offload.key holds another key than cluster.key and is not used for a cluster gateway — remove it';
  }

  /** The key the target is called with, which file holds it, and why it cannot be used. */
  function keyState() {
    if (keySource() === 'offload') return { key: readOwn(), file: 'offload.key', problem: '' };
    const leftover = fold();
    const c = cluster.readKey('gateway');
    return { key: c.key, file: 'cluster.key', problem: c.problem || leftover };
  }

  const getKey = () => keyState().key;

  /** '' removes the key — from the file the target's key lives in. */
  function setKey(key) {
    const k = String(key || '').trim();
    if (keySource() === 'cluster') return cluster.writeKey('gateway', k);
    if (!k) { removeOwn(); return false; }
    write(keyFile, `${k}\n`);
    return true;
  }

  return { getConfig, update, getKey, setKey, keyState, hasKey: () => Boolean(getKey()), file, keyFile };
}
