#!/usr/bin/env node
/**
 * `coding guard …` and `coding svc …` — client of the host guard daemon
 * (scripts/coding-guard-daemon.mjs).
 *
 *   coding guard status                   daemon up? key fingerprint, pending count
 *   coding guard pending [--all]          override requests
 *   coding guard approve <id> [--call | --minutes N | --session]
 *   coding guard deny <id>
 *   coding guard audit [--limit N]        tail + hash-chain check
 *   coding guard note <event> [k=v …]     record a host event (launcher uses it)
 *   coding svc <verb> [args…]             status | logs | restart | graphify | up | rebuild
 *
 * approve / deny / audit / note need the approver token, which only exists on
 * the host (~/.coding/guard/approver.token). Inside the agent box they fail by
 * design; `svc` and requests work from both sides.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { guardPaths, guardPort, readToken } from '../lib/guard/home.mjs';
import { appendAudit, readAudit, verifyAudit } from '../lib/guard/audit.mjs';

export function guardUrl(env = process.env) {
  return (env.CODING_GUARD_URL || `http://127.0.0.1:${guardPort(env)}`).replace(/\/$/, '');
}

export function boxSession(env = process.env) {
  return env.CODING_GUARD_SESSION || `host-${os.userInfo().username}`;
}

function token() {
  try {
    return readToken(guardPaths());
  } catch {
    throw new Error('approver token not available here — approve from a host shell, not from inside the agent box');
  }
}

async function call(method, route, { body, auth = false, timeout = 30_000 } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${token()}`;
  const res = await fetch(`${guardUrl()}${route}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** `--minutes 30` / `--session` / `--call` → { scope, minutes } */
export function parseScope(args) {
  if (args.includes('--session')) return { scope: 'session' };
  const i = args.indexOf('--minutes');
  if (i !== -1) return { scope: 'minutes', minutes: Number(args[i + 1]) };
  return { scope: 'call' };
}

function fmtRequest(r) {
  const when = new Date(r.created).toISOString().replace('T', ' ').slice(0, 19);
  return `${r.id}  ${r.status.padEnd(8)} ${when}  ${r.rule}  [${r.agent || '?'} ${r.session}]` +
    (r.file ? `\n    file:   ${r.file}` : '') +
    (r.reason ? `\n    reason: ${r.reason}` : '') +
    (r.excerpt ? `\n    excerpt: ${r.excerpt.split('\n').slice(0, 6).join('\n             ')}` : '');
}

const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

async function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'status': {
      try {
        const { data } = await call('GET', '/health', { timeout: 3000 });
        const { data: p } = await call('GET', '/requests?status=pending', { timeout: 3000 });
        out(`coding-guard up at ${guardUrl()} — key ${data.fingerprint}, ${p.requests.length} pending request(s)`);
        return 0;
      } catch {
        out(`coding-guard NOT reachable at ${guardUrl()}`);
        return 1;
      }
    }
    case 'pending': {
      const { data } = await call('GET', args.includes('--all') ? '/requests' : '/requests?status=pending');
      if (!data.requests.length) out('no requests');
      for (const r of data.requests) out(fmtRequest(r));
      return 0;
    }
    case 'approve':
    case 'deny': {
      const id = args[0];
      if (!id) { err(`usage: coding guard ${cmd} <id>`); return 64; }
      const body = cmd === 'approve' ? parseScope(args.slice(1)) : {};
      const { status, data } = await call('POST', `/requests/${encodeURIComponent(id)}/${cmd}`, { body, auth: true });
      if (status !== 200) { err(`coding guard: ${data.error || status}`); return 1; }
      if (cmd === 'deny') out(`denied ${id}`);
      else out(`approved ${id}: ${data.grant.payload.rule} for ${data.grant.payload.session}, ${data.grant.payload.scope}, until ${new Date(data.grant.payload.exp).toISOString()}`);
      return 0;
    }
    case 'audit': {
      const i = args.indexOf('--limit');
      const limit = i === -1 ? 30 : Number(args[i + 1]);
      let chain;
      let entries;
      try {
        ({ data: { chain, entries } } = await call('GET', `/audit?limit=${limit}`, { auth: true, timeout: 3000 }));
      } catch (e) {
        if (/approver token/.test(e.message)) throw e;
        const file = guardPaths().audit; // daemon down: read the file directly
        chain = verifyAudit(file);
        entries = readAudit(file, { limit });
      }
      for (const e of entries) {
        const { ts, event, prev: _prev, hash: _hash, ...rest } = e;
        out(`${ts}  ${event}  ${JSON.stringify(rest)}`);
      }
      out(chain.ok ? `chain intact (${chain.entries} entries)` : `CHAIN BROKEN at line ${chain.brokenAt} of ${chain.entries}`);
      return chain.ok ? 0 : 2;
    }
    case 'note': {
      const [event, ...pairs] = args;
      const body = { event };
      for (const p of pairs) {
        const eq = p.indexOf('=');
        if (eq > 0) body[p.slice(0, eq)] = p.slice(eq + 1);
      }
      try {
        const { status, data } = await call('POST', '/note', { body, auth: true, timeout: 3000 });
        if (status !== 200) { err(`coding guard: ${data.error || status}`); return 1; }
      } catch (e) {
        if (/approver token/.test(e.message)) throw e;
        // Daemon not running: it is then not writing either, so appending here
        // cannot interleave with it.
        const paths = guardPaths();
        fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
        const { event: ev, ...fields } = body;
        appendAudit(paths.audit, { ...fields, event: `host.${ev}`, via: 'cli' });
      }
      return 0;
    }
    case 'svc': {
      const [verb, ...rest] = args;
      if (!verb) { err('usage: coding svc <status|logs|restart|graphify|up|rebuild> [args…]'); return 64; }
      const { status, data } = await call('POST', '/svc', {
        body: { verb, args: rest, session: boxSession(), agent: process.env.CODING_AGENT || null },
        timeout: verb === 'rebuild' ? 16 * 60_000 : 90_000,
      });
      if (status !== 200) { err(`coding svc: ${data.error || status}`); return status === 403 ? 3 : 1; }
      for (const r of data.results) {
        if (r.stdout) process.stdout.write(r.stdout);
        if (r.stderr) process.stderr.write(r.stderr);
      }
      return data.code;
    }
    default:
      err('usage: coding guard <status|pending|approve|deny|audit|note> …   |   coding svc <verb> …');
      return 64;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    err(`coding guard: ${e.cause?.code === 'ECONNREFUSED' ? `daemon not reachable at ${guardUrl()}` : e.message}`);
    process.exit(1);
  });
}
