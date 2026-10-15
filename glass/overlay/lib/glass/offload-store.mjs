// lib/glass/offload-store.mjs — the opt-in offload's settings, owner-only, in GLASS_HOME.
//
//   offload.json   what the UI / `glass offload` set (normalizeOffloadConfig shape)
//   offload.key    the endpoint's API key, alone, so no read of the settings can carry it
//
// Read per call through an mtime check: the UI's PATCH and a hand edit of the file
// both apply to the next model call — no daemon restart, no agent relaunch. Nothing
// here knows any endpoint; with no file, offload is off.
import fs from 'node:fs';
import path from 'node:path';

import { normalizeOffloadConfig } from '../../proxy/proxy-bridge/offload.mjs';

export function createOffloadStore(home) {
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

  function getKey() {
    try { return fs.readFileSync(keyFile, 'utf8').trim(); } catch { return ''; }
  }

  /** '' removes the key. */
  function setKey(key) {
    const k = String(key || '').trim();
    if (!k) { try { fs.rmSync(keyFile); } catch { /* none */ } return false; }
    write(keyFile, `${k}\n`);
    return true;
  }

  return { getConfig, update, getKey, setKey, hasKey: () => Boolean(getKey()), file, keyFile };
}
