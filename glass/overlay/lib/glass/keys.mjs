// lib/glass/keys.mjs — glass's secrets, in one owner-only file: GLASS_HOME/.env.
//
//   CLUSTER_OPS_KEY   the cluster's gateway key: model lists on the Cluster page, and
//                     offload to a cluster gateway
//   CLUSTER_MON_KEY   the cluster's status services' key (read-only node status)
//   OFFLOAD_KEY       an offload endpoint's key when it is not a cluster gateway
//
// `NAME=value` lines; comments, blank lines and any other variable are kept as they
// are when glass writes one of its own. A file other users can read is refused (POSIX
// only; Windows has no such mode bits). Re-read on every call: a hand edit applies to
// the next request.
//
// The single-key files of earlier set-ups (cluster.key, cluster-status.key,
// offload.key) are moved into .env once: a file whose variable is not set yet becomes
// that variable; one holding the same value as the variable is removed; one holding
// another value is left in place and reported, since glass cannot tell which is right.
import fs from 'node:fs';
import path from 'node:path';

export const KEY_NAMES = { ops: 'CLUSTER_OPS_KEY', mon: 'CLUSTER_MON_KEY', offload: 'OFFLOAD_KEY' };
const LEGACY = { ops: 'cluster.key', mon: 'cluster-status.key', offload: 'offload.key' };
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** `NAME=value` pairs of a .env text; quotes around a value are dropped. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** `text` with `name` set to `value` in place, appended when absent, removed when value is ''. */
export function setEnvLine(text, name, value) {
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const at = lines.findIndex((l) => !/^\s*#/.test(l) && LINE.exec(l)?.[1] === name);
  if (!value) { if (at >= 0) lines.splice(at, 1); } else if (at >= 0) lines[at] = `${name}=${value}`; else lines.push(`${name}=${value}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function createKeyStore(home, { platform = process.platform } = {}) {
  const file = path.join(home, '.env');
  const stat = (f) => { try { return fs.statSync(f); } catch { return null; } };
  const openToOthers = (s) => platform !== 'win32' && Boolean(s.mode & 0o077);

  function readFile() {
    const s = stat(file);
    if (!s) return { vars: {}, problem: '' };
    if (openToOthers(s)) return { vars: {}, problem: '.env is readable by other users — make it owner-only (chmod 600)' };
    try { return { vars: parseEnv(fs.readFileSync(file, 'utf8')), problem: '' }; } catch { return { vars: {}, problem: '.env cannot be read' }; }
  }

  function writeVar(name, value) {
    fs.mkdirSync(home, { recursive: true });
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, setEnvLine(text, name, value), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  }

  /** Moves the earlier key file of `which` into .env; a problem when it holds another value. */
  function migrate(which) {
    const f = path.join(home, LEGACY[which]);
    const s = stat(f);
    if (!s) return '';
    const name = KEY_NAMES[which];
    if (openToOthers(s)) return `${LEGACY[which]} is readable by other users — make it owner-only (chmod 600), then glass moves it into .env as ${name}`;
    let legacy = '';
    try { legacy = fs.readFileSync(f, 'utf8').trim(); } catch { return `${LEGACY[which]} cannot be read`; }
    const { vars, problem } = readFile();
    if (problem) return '';
    if (legacy && !vars[name]) writeVar(name, legacy);
    else if (legacy && vars[name] !== legacy) return `${LEGACY[which]} holds another key than ${name} in .env — remove the one that is wrong`;
    try { fs.rmSync(f); } catch { /* gone */ }
    return '';
  }

  /** { key, name, problem } for 'ops' | 'mon' | 'offload'. */
  function read(which) {
    const name = KEY_NAMES[which];
    const leftover = migrate(which);
    const { vars, problem } = readFile();
    return { key: problem ? '' : String(vars[name] || '').trim(), name, problem: problem || leftover };
  }

  /** Sets (or with '' removes) `which` in .env; true when one is set. */
  function write(which, key) {
    const k = String(key || '').trim();
    writeVar(KEY_NAMES[which], k);
    return Boolean(k);
  }

  return { read, write, file };
}
