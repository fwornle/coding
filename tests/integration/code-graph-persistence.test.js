/**
 * Persistence contract for code-graph backends.
 *
 * The requirement: rebuilding the container must lose nothing. That already holds,
 * but only because of two compose mounts and a tracked empty directory — all three
 * of which are easy to delete while "tidying". These tests pin them.
 *
 * The complementary requirement is that the INDEXES stay out of git. They are derived
 * caches (codegraph rebuilds in ~36s) rewritten on every reindex, and git stores a
 * full copy of each version forever. On a repo whose .git is already gigabytes, that
 * degrades clone and fetch for everyone and cannot be undone without rewriting
 * history. So: provenance in the repo, caches on disk.
 *
 * Static — reads config and compose, runs no Docker, so it works in lite CI.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const compose = readFileSync(path.join(REPO, 'docker/docker-compose.yml'), 'utf8');
const registry = JSON.parse(readFileSync(path.join(REPO, 'config/code-graph.json'), 'utf8'));

/** git's own answer, so the test agrees with reality rather than re-implementing globs. */
const isIgnored = (rel) => {
  try {
    execFileSync('git', ['-C', REPO, 'check-ignore', '-q', rel]);
    return true;
  } catch {
    return false;
  }
};

describe('rebuild safety', () => {
  it('.data is bind-mounted from the host repo, so an image rebuild cannot destroy it', () => {
    expect(compose).toMatch(/\$\{CODING_REPO:-\.\}\/\.data:\/coding\/\.data/);
  });

  it('every backend writes its artifact under .data', () => {
    for (const [id, b] of Object.entries(registry.backends)) {
      expect(`${id}:${b.artifact.hostDir}`).toMatch(/:\.data\//);
      expect(b.artifact.containerDir.startsWith('/coding/.data/')).toBe(true);
    }
  });

  it("codegraph's index is redirected off the read-only workspace mount", () => {
    // CODEGRAPH_DIR rejects absolute paths, so this bind is the ONLY thing keeping
    // the index out of the read-only repo mount. Without it the container fails to start.
    expect(compose).toMatch(/\.data\/codegraph:\/workspace\/coding\/\.codegraph/);
  });

  it('the .codegraph mountpoint exists and is tracked — Docker cannot create it', () => {
    // Docker refuses to mkdir a mountpoint under a :ro parent, so this directory must
    // pre-exist in a fresh clone. That is what .gitkeep is for.
    expect(existsSync(path.join(REPO, '.codegraph/.gitkeep'))).toBe(true);
    expect(isIgnored('.codegraph/.gitkeep')).toBe(false);
  });

  it('install.sh recreates both host-side paths on a fresh clone', () => {
    const sh = readFileSync(path.join(REPO, 'install.sh'), 'utf8');
    expect(sh).toContain('_install_codegraph_support');
    expect(sh).toMatch(/mkdir -p "\$CODING_REPO\/\.codegraph" "\$CODING_REPO\/\.data\/codegraph"/);
  });
});

describe('what is committed, and what is not', () => {
  it('indexes are NOT tracked — they are derived caches, rewritten every reindex', () => {
    for (const b of Object.values(registry.backends)) {
      const rel = path.join(b.artifact.hostDir, b.artifact.primary);
      expect(`${rel}: ${isIgnored(rel)}`).toBe(`${rel}: true`);
    }
  });

  it('raw kgbench results are NOT tracked — full answers, megabytes per run', () => {
    expect(isIgnored('.data/kgbench/runs/anyrun/results.jsonl')).toBe(true);
  });

  it('gate results and freshness sidecars ARE tracked — small, non-regenerable provenance', () => {
    // These record what was measured and at which commit. Regenerating them means
    // re-running the gate, which is not the same evidence.
    expect(isIgnored('.data/code-graph-meta/codegraph/smoke.json')).toBe(false);
    expect(isIgnored('.data/code-graph-meta/codegraph/metadata.json')).toBe(false);
  });

  it('per-run kgbench summaries ARE tracked', () => {
    expect(isIgnored('.data/kgbench/runs/anyrun/run.json')).toBe(false);
  });

  it('sidecars live outside tool-managed data dirs', () => {
    // codegraph writes its own .gitignore containing `*` into .data/codegraph, which
    // silently overrides any root-level negation. Keeping sidecars in a directory no
    // backend manages is what makes them trackable at all.
    const smoke = readFileSync(path.join(REPO, 'scripts/backend-smoke.sh'), 'utf8');
    expect(smoke).toContain('.data/code-graph-meta/$BACKEND');
  });
});
