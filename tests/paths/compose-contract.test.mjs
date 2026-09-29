/**
 * The two facts the container cannot derive for itself.
 *
 * `~/.coding/scope` is a per-machine file that does not exist in the image, and
 * the data root is computed from it. So the container is TOLD both — the data
 * root as a mount, the scope as an environment variable — and compose refuses
 * to interpolate without either (`:?`).
 *
 * Fail-closed on purpose, and the asymmetry is the point: a compose run that
 * quietly defaulted would mount an empty graph and tag entities under a tenant
 * nobody owns, and BOTH failures are invisible from the dashboard — an empty
 * knowledge base looks exactly like one that lost its content, and a
 * wrong-tenant entity looks exactly like a right one until somebody queries by
 * team. An error at startup is the only version of this that anyone notices.
 *
 * Asserted against the compose file's text rather than `docker compose config`,
 * because a unit test that needs a running Docker daemon is a test that gets
 * skipped on the machine where it matters.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const compose = readFileSync(join(REPO, 'docker/docker-compose.yml'), 'utf8');

describe('docker-compose fails closed on the two per-machine facts', () => {
  test('the data-root mount is required', () => {
    assert.match(
      compose,
      /\$\{CODING_DATA_HOME:\?[^}]*\}:\/coding\/data/,
      'the data root must use `:?` — a default would mount an EMPTY graph',
    );
  });

  test('the scope is required', () => {
    assert.match(
      compose,
      /CODING_SCOPE=\$\{CODING_SCOPE:\?[^}]*\}/,
      'the scope must use `:?` — a default would resolve the placeholder tenant',
    );
  });

  test('both error messages name the command that fixes them', () => {
    // A fail-closed variable whose message does not say how to set it turns a
    // deliberate guard into a dead end.
    for (const m of compose.matchAll(/\$\{(CODING_DATA_HOME|CODING_SCOPE):\?([^}]*)\}/g)) {
      assert.match(
        m[2],
        /coding-data-home/,
        `${m[1]}: the error must point at bin/coding-data-home`,
      );
    }
  });

  test('the resolvers are mounted, so the container computes the layout with host code', () => {
    // Without these the container would need its own copy of the layout, which
    // is the drift lib/paths and lib/scope exist to remove.
    assert.match(compose, /\/lib\/paths:\/coding\/lib\/paths:ro/);
    assert.match(compose, /\/lib\/scope:\/coding\/lib\/scope:ro/);
  });
});

describe('every launcher that reaches compose states both facts', () => {
  // compose interpolates the WHOLE file on EVERY subcommand — `build`, `stop`
  // and `ps` included, not just `up`. install.sh's image build did not export
  // them and died on interpolation, reporting it as "Docker build had issues":
  // a warning that named the wrong cause and left no image behind.

  const statesBoth = (rel) => {
    const src = readFileSync(join(REPO, rel), 'utf8');
    return {
      dataHome: src.includes('CODING_DATA_HOME'),
      scope: src.includes('CODING_SCOPE'),
    };
  };

  test('launch-agent-common exports both', () => {
    const s = statesBoth('scripts/launch-agent-common.sh');
    assert.ok(s.dataHome && s.scope, 'the launcher is what every agent start goes through');
  });

  test('install.sh exports both before building the image', () => {
    const s = statesBoth('install.sh');
    assert.ok(s.dataHome && s.scope, 'a fresh install builds the image before any launcher has run');
  });

  test('migrate-data-home prints both in the commands it tells you to run', () => {
    const s = statesBoth('scripts/migrate-data-home.mjs');
    assert.ok(s.dataHome && s.scope, 'a copy-pasteable hint that fails on paste is worse than none');
  });
});
