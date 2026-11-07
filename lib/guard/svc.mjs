/**
 * `coding svc` — the only Docker access an agent in the box has.
 *
 * The box has no Docker socket (raw Docker access = guard off, Decision 2 in
 * .planning/guardrail-hardening.md). Instead the host guard daemon runs a fixed
 * vocabulary of verbs and builds every docker argv itself: no mounts, images,
 * flags or exec commands are ever taken from the caller, and nothing passes
 * through a shell.
 *
 *   status                       containers + supervisor programs
 *   logs <container|program> [n] last n lines (program logs: ~n lines of bytes)
 *   restart <program>            supervisorctl restart, program must exist
 *   graphify <sub> [args…]       read/update verbs of the graphify CLI only
 *   up | rebuild                 GATED: need a signed grant for `svc:<verb>`,
 *                                because they act on the compose file and
 *                                Dockerfile in the (agent-writable) repo
 *
 * svcPlan() is pure — the daemon supplies the live program list — so the
 * whole vocabulary is pinned by tests/guard/svc.test.mjs.
 */

import path from 'node:path';

export const SERVICES_CONTAINER = 'coding-services';
export const CONTAINERS = ['coding-services', 'coding-qdrant', 'coding-redis'];
export const GRAPHIFY_VERBS = ['query', 'path', 'explain', 'update', 'diagnose', 'cluster-only'];
export const GATED_VERBS = ['up', 'rebuild'];
export const VERBS = ['status', 'logs', 'restart', 'graphify', ...GATED_VERBS];

const MAX_ARGS = 20;
const MAX_ARG_LEN = 2000;
const MAX_LINES = 2000;

export class SvcError extends Error {}

/** Full supervisor name for `name` (`graphify` → `backend-services:graphify`). */
export function resolveProgram(name, programs) {
  if (typeof name !== 'string' || !name) throw new SvcError('program name required');
  if (programs.includes(name)) return name;
  const matches = programs.filter((p) => p.split(':').pop() === name);
  if (matches.length === 1) return matches[0];
  throw new SvcError(`unknown program '${name}' (known: ${programs.map((p) => p.split(':').pop()).join(', ')})`);
}

function lineCount(value, fallback = 200) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LINES) throw new SvcError(`lines must be 1..${MAX_LINES}`);
  return n;
}

/**
 * The docker argv list for one verb. Throws SvcError for anything outside the
 * vocabulary. Returns { gated, steps: [argv, …] }.
 */
export function svcPlan(verb, args = [], { programs = [], codingRepo }) {
  if (!VERBS.includes(verb)) throw new SvcError(`unknown verb '${verb}' (one of: ${VERBS.join(', ')})`);
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw new SvcError(`at most ${MAX_ARGS} arguments`);
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG_LEN) throw new SvcError('arguments must be strings');
  }
  const compose = ['compose', '-f', path.join(codingRepo || '.', 'docker', 'docker-compose.yml')];

  switch (verb) {
    case 'status':
      return { gated: false, steps: [
        ['ps', '-a', '--filter', 'name=^coding-', '--format', '{{.Names}}\t{{.Status}}'],
        ['exec', SERVICES_CONTAINER, 'supervisorctl', 'status'],
      ] };
    case 'logs': {
      const [target, n] = args;
      const lines = lineCount(n);
      if (CONTAINERS.includes(target)) return { gated: false, steps: [['logs', '--tail', String(lines), target]] };
      const program = resolveProgram(target, programs);
      return { gated: false, steps: [['exec', SERVICES_CONTAINER, 'supervisorctl', 'tail', `-${lines * 160}`, program]] };
    }
    case 'restart': {
      if (args.length !== 1) throw new SvcError('usage: restart <program>');
      return { gated: false, steps: [['exec', SERVICES_CONTAINER, 'supervisorctl', 'restart', resolveProgram(args[0], programs)]] };
    }
    case 'graphify': {
      const [sub, ...rest] = args;
      if (!GRAPHIFY_VERBS.includes(sub)) {
        throw new SvcError(`graphify verb must be one of: ${GRAPHIFY_VERBS.join(', ')}`);
      }
      return { gated: false, steps: [['exec', SERVICES_CONTAINER, 'graphify', sub, ...rest]] };
    }
    case 'up':
      if (args.length) throw new SvcError('usage: up');
      return { gated: true, steps: [[...compose, 'up', '-d', SERVICES_CONTAINER]] };
    case 'rebuild':
      if (args.length) throw new SvcError('usage: rebuild');
      return { gated: true, steps: [[...compose, 'build', SERVICES_CONTAINER], [...compose, 'up', '-d', SERVICES_CONTAINER]] };
    default:
      throw new SvcError(`unknown verb '${verb}'`);
  }
}

/** Program names out of `supervisorctl status` output. */
export function parsePrograms(statusOutput) {
  return statusOutput.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((n) => /^[A-Za-z0-9_.:-]+$/.test(n || ''));
}
