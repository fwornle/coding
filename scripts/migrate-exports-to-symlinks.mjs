#!/usr/bin/env node
/**
 * One-shot migration: turn .data/knowledge-export/coding.json into a symlink
 * pointing at canonical .data/exports/coding.json per CONTEXT D-21 + RESEARCH section Pattern 7.
 *
 * SCOPE: Phase 37 - only coding.json (B's path). The .data/observation-export/*.json
 * symlinks are Phase 41 work (when A's adapter ships).
 *
 * IDEMPOTENT: if the symlink is already in place pointing to the correct target,
 * exit 0 with no-op. Pitfall 3 defense.
 *
 * SECURITY: refuses to follow existing symlinks at the source path OR overwrite
 * real files outside .data/ (T-37-05-02 symlink-traversal mitigation).
 *
 * OKB-GUARD: the generated changes (delete legacy file, write canonical file, create symlink)
 * MUST land in a commit that does NOT mix in .data/observation-export/*.json files. The
 * pre-commit hook (scripts/hooks/pre-commit-okb-guard.sh) treats ANY staged file matching
 * the regex `\.data/(knowledge-export|exports)/.*\.json$` as a knowledge-baseline change and
 * BLOCKS the commit unconditionally; the documented escape hatch (per the hook's own header
 * lines 8-11) is `git commit --no-verify` for intentional KB updates. This migration is
 * exactly such an intentional commit. This script does NOT auto-commit; the operator stages
 * and commits the result.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env.CODING_REPO || process.cwd();
const LEGACY = path.join(REPO_ROOT, '.data/knowledge-export/coding.json');
const CANONICAL = path.join(REPO_ROOT, '.data/exports/coding.json');
const CANONICAL_DIR = path.dirname(CANONICAL);
const RELATIVE_TARGET = '../exports/coding.json';

function log(msg) {
  process.stderr.write(`[migrate] ${msg}\n`);
}

function ensureRepoRootSafe() {
  // T-37-05-02: refuse to operate outside the coding repo
  const expected = path.resolve('/Users/Q284340/Agentic/coding');
  const actual = path.resolve(REPO_ROOT);
  if (!actual.startsWith(expected) && !process.env.ALLOW_NONSTANDARD_REPO) {
    throw new Error(`Refusing to operate outside coding repo: ${actual}`);
  }
}

function isAlreadyMigrated() {
  if (!fs.existsSync(LEGACY)) return false;
  const stat = fs.lstatSync(LEGACY);
  if (!stat.isSymbolicLink()) return false;
  const target = fs.readlinkSync(LEGACY);
  return target === RELATIVE_TARGET;
}

async function main() {
  ensureRepoRootSafe();

  if (isAlreadyMigrated()) {
    log('symlink already in place; no-op');
    process.exit(0);
  }

  // Step 0: ensure canonical dir exists
  fs.mkdirSync(CANONICAL_DIR, { recursive: true });

  // Step 1: read legacy content (if exists, and not already a symlink)
  const legacyExists = fs.existsSync(LEGACY) && !fs.lstatSync(LEGACY).isSymbolicLink();
  const canonicalExists = fs.existsSync(CANONICAL);

  if (legacyExists && canonicalExists) {
    // Both exist - backup canonical (in case content differs) and use legacy as authoritative
    const backup = `${CANONICAL}.bak.${Date.now()}`;
    log(`both legacy and canonical exist; backing up canonical to ${backup}`);
    fs.copyFileSync(CANONICAL, backup);
  }

  if (legacyExists) {
    log(`copying legacy ${LEGACY} -> canonical ${CANONICAL}`);
    // Atomic temp+rename for canonical write (Pattern 3)
    const tmp = `${CANONICAL}.tmp.${process.pid}.${Date.now()}`;
    fs.copyFileSync(LEGACY, tmp);
    fs.renameSync(tmp, CANONICAL);
    // Step 2: remove legacy file (we'll replace with symlink)
    fs.unlinkSync(LEGACY);
  } else if (!canonicalExists) {
    // Neither exists - create empty canonical (so the symlink target is valid)
    log('neither legacy nor canonical exists; creating empty canonical');
    fs.writeFileSync(CANONICAL, '{"nodes":[],"edges":[]}\n', 'utf-8');
  }

  // Step 3: create symlink at legacy path -> relative canonical path
  log(`creating symlink ${LEGACY} -> ${RELATIVE_TARGET}`);
  fs.symlinkSync(RELATIVE_TARGET, LEGACY);

  // Step 4: verify
  const verifyTarget = fs.readlinkSync(LEGACY);
  if (verifyTarget !== RELATIVE_TARGET) {
    throw new Error(`Symlink verification failed: ${verifyTarget} != ${RELATIVE_TARGET}`);
  }
  log('migration complete; reminder: commit only .data/exports/coding.json + .data/knowledge-export/coding.json — do NOT mix in .data/observation-export/*.json. OKB-baseline guard will block the commit either way; --no-verify is the documented escape hatch for intentional KB updates.');
}

main().catch(err => {
  process.stderr.write(`[migrate] FATAL: ${err.message}\n`);
  process.exit(1);
});
