#!/usr/bin/env node
/**
 * The constraint rules as a gate on a pushed commit range — the check that
 * runs off-machine (CI), so neither `--no-verify` nor anything inside the
 * agent box can skip it.
 *
 *   node scripts/guard-check-diff.mjs <base> <head> [--json]
 *
 * Every file the range adds or changes is judged exactly like the result check
 * in the box (integrations/constraint-monitor/src/hooks/result-check.js): the
 * rules a Write of the whole file would trip, counting only matches the range
 * ADDED over the base version, with the rules' own whitelists and file
 * patterns. Deleted, binary, oversized and submodule (gitlink) entries are not
 * judged, nor are the skill-required rules (they judge a session, see below).
 * Exit 1 when any blocking rule was added.
 *
 * Override: a commit in the range whose message carries the trailer
 *   Constraint-Override: <rule-id> <path>
 * lets that rule through for that path (repo-relative, or `*` for every path).
 * The box cannot push (no credentials are mounted), so a range reaches CI only
 * when the user pushes it, and the trailer is part of what they push.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 2).
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = path.join(REPO, 'integrations', 'constraint-monitor', 'src', 'hooks');
const MAX_FILE_BYTES = 1_000_000;
const ZERO = /^0+$/;
/**
 * The skill-required rules judge the SESSION (was the documentation-style
 * skill invoked before writing a diagram?), not the file, and a commit carries
 * no session. They are enforced where the session is known: the per-call
 * check and the result check in the box.
 */
const PROCESS_RULES_OFF = { activeSkills: { 'documentation-style': true } };

const gitIn = (repo) => (args, opts = {}) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 512 * 1024 * 1024, ...opts });

/** Files the range changed: [{ path, oldSha, newSha, newMode, status }]. */
export function rangeChanges(base, head, repo = REPO) {
  const out = gitIn(repo)(['diff-tree', '-r', '-z', '--no-renames', base, head], { encoding: 'utf8' });
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) (\w)/.exec(parts[i]);
    if (m) files.push({ newMode: m[2], oldSha: m[3], newSha: m[4], status: m[5], path: parts[i + 1] });
  }
  return files;
}

/** `Constraint-Override:` trailers in the range → [{ rule, path }]. */
export function overridesIn(base, head, repo = REPO) {
  const log = gitIn(repo)(['log', '--format=%B%x00', `${base}..${head}`], { encoding: 'utf8' });
  const out = [];
  for (const m of log.matchAll(/^Constraint-Override:\s*(\S+)\s+(\S+)\s*$/gim)) out.push({ rule: m[1], path: m[2] });
  return out;
}

const overridden = (overrides, rule, rel) => overrides.some((o) => o.rule === rule && (o.path === '*' || o.path === rel));
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

export async function checkRange(base, head, repo = REPO) {
  const git = gitIn(repo);
  process.env.CLAUDE_CODE_HOOK = 'true'; // the engine's logger stays off stdout
  const { rulesAddedBy } = await import(path.join(HOOKS, 'result-check.js'));
  const { getEnforcer } = await import(path.join(HOOKS, 'real-time-constraint-hook.js'));
  const enforcer = getEnforcer();
  const overrides = overridesIn(base, head, repo);
  const findings = [];
  for (const c of rangeChanges(base, head, repo)) {
    if (c.status === 'D' || !c.newMode.startsWith('100')) continue;
    if (Number(git(['cat-file', '-s', c.newSha], { encoding: 'utf8' }).trim()) > MAX_FILE_BYTES) continue;
    const after = git(['cat-file', 'blob', c.newSha]);
    if (isBinary(after)) continue;
    const beforeBuf = ZERO.test(c.oldSha) ? null : git(['cat-file', 'blob', c.oldSha]);
    const before = beforeBuf && !isBinary(beforeBuf) ? beforeBuf.toString('utf8') : null;
    const violations = await rulesAddedBy({ enforcer, absPath: path.join(repo, c.path), before, after: after.toString('utf8'), context: PROCESS_RULES_OFF });
    for (const v of violations) {
      findings.push({ path: c.path, rule: v.constraint_id, severity: v.severity, message: v.message, overridden: overridden(overrides, v.constraint_id, c.path) });
    }
  }
  return findings;
}

async function main() {
  const [base, head, flag] = process.argv.slice(2);
  if (!base || !head) {
    process.stderr.write('usage: guard-check-diff.mjs <base> <head> [--json]\n');
    process.exit(2);
  }
  const findings = await checkRange(base, head);
  const blocking = findings.filter((f) => !f.overridden);
  if (flag === '--json') {
    process.stdout.write(`${JSON.stringify({ base, head, findings }, null, 2)}\n`);
  } else {
    for (const f of findings) {
      process.stdout.write(`${f.overridden ? 'override' : 'VIOLATION'}  ${f.path}  [${f.rule}] ${f.severity}: ${f.message}\n`);
    }
    process.stdout.write(blocking.length
      ? `\n${blocking.length} constraint violation(s) added in ${base.slice(0, 10)}..${head.slice(0, 10)}. Fix them, or (user decision) add a commit trailer: Constraint-Override: <rule-id> <path>\n`
      : `constraint gate: ${findings.length ? `${findings.length} overridden, ` : ''}no violations added in ${base.slice(0, 10)}..${head.slice(0, 10)}\n`);
  }
  process.exit(blocking.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`guard-check-diff: ${err.stack || err.message}\n`);
    process.exit(2);
  });
}
