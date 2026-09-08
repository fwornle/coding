/**
 * The team / view registry loader (lib/teams/registry.mjs).
 *
 * Two things are worth locking. First, the real config/teams/ tree — these
 * files are the contract the viewer's rail renders, so a rename or a dropped
 * `kind` should fail here rather than quietly reshuffle the sidebar. Second,
 * the fail-open behaviour on malformed input: this feeds a display surface, and
 * one bad file must cost its own entry and nothing else.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadTeamRegistry, loadViewGroups, loadRegistry } from '../../lib/teams/registry.mjs';

const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');

/** Build a throwaway repo root with the given config/teams/ contents. */
function sandbox(files) {
  const root = mkdtempSync(join(tmpdir(), 'coding-teams-'));
  mkdirSync(join(root, 'config', 'teams'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'config', 'teams', name), body);
  }
  return root;
}

describe('loadTeamRegistry — the committed config/teams/ tree', () => {
  test('serves the five predefined entries, split by kind', () => {
    const teams = loadTeamRegistry(REPO);
    assert.deepEqual(
      teams.map((t) => t.label),
      ['Coding', 'Normalisa', 'RaaS', 'ReSi', 'UI'],
      'label set + sort order',
    );
    assert.deepEqual(
      teams.filter((t) => t.kind === 'project').map((t) => t.label),
      ['Coding', 'UI'],
      'Coding and UI are bodies of work, not owners',
    );
    assert.deepEqual(
      teams.filter((t) => t.kind === 'team').map((t) => t.label),
      ['Normalisa', 'RaaS', 'ReSi'],
    );
  });

  test('id is lowercased so it joins against entity metadata.team', () => {
    const byLabel = new Map(loadTeamRegistry(REPO).map((t) => [t.label, t.id]));
    // The graph spells this 'resi'; matching on the config's 'ReSi' finds nothing.
    assert.equal(byLabel.get('ReSi'), 'resi');
    assert.equal(byLabel.get('RaaS'), 'raas');
    assert.equal(byLabel.get('UI'), 'ui');
  });

  test('every entry carries a description', () => {
    for (const t of loadTeamRegistry(REPO)) {
      assert.ok(t.description.length > 0, `${t.label} has no description`);
    }
  });

  test('view-groups.json is not mistaken for a team', () => {
    const ids = loadTeamRegistry(REPO).map((t) => t.id);
    assert.equal(ids.includes('view-groups'), false);
    assert.equal(ids.length, 5);
  });
});

describe('loadTeamRegistry — fail-open on bad input', () => {
  test('one unparseable file costs its own entry only', () => {
    const root = sandbox({
      'good.json': JSON.stringify({ team: 'Good', kind: 'project', description: 'd' }),
      'broken.json': '{ not json',
    });
    try {
      assert.deepEqual(loadTeamRegistry(root).map((t) => t.id), ['good']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a file with no "team" field is skipped', () => {
    const root = sandbox({
      'nameless.json': JSON.stringify({ kind: 'team', description: 'd' }),
      'good.json': JSON.stringify({ team: 'Good' }),
    });
    try {
      assert.deepEqual(loadTeamRegistry(root).map((t) => t.id), ['good']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unknown kind falls back to "team", never to "project"', () => {
    // Defaulting the other way would promote a malformed entry into the
    // Projects group — the one distinction this registry exists to keep.
    const root = sandbox({ 'x.json': JSON.stringify({ team: 'X', kind: 'squad' }) });
    try {
      assert.equal(loadTeamRegistry(root)[0].kind, 'team');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing config/teams/ directory yields an empty list, not a throw', () => {
    const root = mkdtempSync(join(tmpdir(), 'coding-teams-empty-'));
    try {
      assert.deepEqual(loadTeamRegistry(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('loadViewGroups', () => {
  test('the committed rule folds both kgbench spellings into one group', () => {
    const groups = loadViewGroups(REPO);
    const kg = groups.find((g) => g.id === 'kgbench');
    assert.ok(kg, 'kgbench group present');
    assert.equal(kg.label, 'Kgbench');
    const re = new RegExp(kg.match, 'i');
    assert.equal(re.test('kgbench'), true, 'the anchor node itself');
    assert.equal(re.test('kgbench-tree-hOMRUf'), true, 'a run tree');
    assert.equal(re.test('coding'), false);
    assert.equal(re.test('a2a-xpr'), false);
  });

  test('a rule with an uncompilable regex is dropped, not thrown', () => {
    const root = sandbox({
      'view-groups.json': JSON.stringify({
        groups: [
          { id: 'bad', label: 'Bad', match: '^[unclosed' },
          { id: 'ok', label: 'Ok', match: '^ok-' },
        ],
      }),
    });
    try {
      assert.deepEqual(loadViewGroups(root).map((g) => g.id), ['ok']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a rule missing id or match is dropped', () => {
    const root = sandbox({
      'view-groups.json': JSON.stringify({
        groups: [{ label: 'No id', match: '^x' }, { id: 'no-match' }, { id: 'ok', match: '^ok' }],
      }),
    });
    try {
      assert.deepEqual(loadViewGroups(root).map((g) => g.id), ['ok']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an absent view-groups.json yields an empty list', () => {
    const root = sandbox({ 'coding.json': JSON.stringify({ team: 'Coding' }) });
    try {
      assert.deepEqual(loadViewGroups(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('loadRegistry', () => {
  test('returns both halves in the shape GET /api/teams serves', () => {
    const reg = loadRegistry(REPO);
    assert.deepEqual(Object.keys(reg).sort(), ['teams', 'viewGroups']);
    assert.equal(reg.teams.length, 5);
    assert.ok(reg.viewGroups.length >= 1);
  });
});
