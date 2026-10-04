/**
 * Team selection → projects (lib/teams/scope.mjs), the mapping every T6
 * filter goes through.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTeams, projectOf, projectsOfTeams, teamPredicate, defaultTeamsFor } from '../../lib/teams/scope.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'team-scope-')));
const repo = (name) => {
  const p = join(root, name);
  mkdirSync(join(p, '.git'), { recursive: true });
  return { path: p, name, learningRemote: '' };
};
const repos = [repo('raas-api'), repo('raas-ui'), repo('coding'), repo('balance')];
const teamsDoc = {
  active: [],
  teams: {
    raas: { id: 'raas', repos: [{ remote: 'https://ghe/acme/raas-docs-history.git' }], include: ['raas-*'] },
    coding: { id: 'coding', repos: [], include: [] },
    ops: { id: 'ops', repos: [{ path: join(root, 'balance'), id: 'ledger' }], include: [] },
  },
};

test.after(() => rmSync(root, { recursive: true, force: true }));

test('parseTeams: comma list or array, trimmed, lowercased, unique', () => {
  assert.deepEqual(parseTeams(' RaaS, coding ,,raas'), ['coding', 'raas']);
  assert.deepEqual(parseTeams(['b', 'a']), ['a', 'b']);
  assert.deepEqual(parseTeams(undefined), []);
});

test('projectOf: project, else legacy team', () => {
  assert.equal(projectOf({ project: 'x', team: 'y' }), 'x');
  assert.equal(projectOf({ team: 'y' }), 'y');
  assert.equal(projectOf({}), null);
});

test('a team covers its include matches, explicit ids and remote-only repos', () => {
  const r = projectsOfTeams(['raas'], { teamsDoc, repos });
  assert.deepEqual([...r.projects].sort(), ['raas-api', 'raas-docs', 'raas-ui']);
  assert.deepEqual([...projectsOfTeams(['ops'], { teamsDoc, repos }).projects], ['ledger']);
  assert.deepEqual([...projectsOfTeams(['coding'], { teamsDoc, repos }).projects], ['coding']);
});

test('an id that is no team is a project id (a viewer "view")', () => {
  const r = projectsOfTeams(['kgbench-tree-1'], { teamsDoc, repos });
  assert.deepEqual([...r.projects], ['kgbench-tree-1']);
  assert.deepEqual(r.unknown, ['kgbench-tree-1']);
});

test('teamPredicate: null without a selection; never leaks across teams', () => {
  assert.equal(teamPredicate([], { teamsDoc, repos }), null);
  const raas = teamPredicate(['raas'], { teamsDoc, repos });
  assert.equal(raas({ project: 'raas-api' }), true);
  assert.equal(raas({ team: 'RAAS-UI' }), true, 'case-insensitive');
  assert.equal(raas({ project: 'coding' }), false);
  assert.equal(raas({}), false, 'no project = in no team');
});

test('defaultTeamsFor: the teams of the cwd\'s repo, else its own project — never the active selection', () => {
  mkdirSync(join(root, 'raas-api', 'src'), { recursive: true });
  assert.deepEqual(defaultTeamsFor(join(root, 'raas-api', 'src'), { teamsDoc }), ['raas']);
  assert.deepEqual(defaultTeamsFor(join(root, 'balance'), { teamsDoc }), ['ops'], 'a listed path');
  mkdirSync(join(root, 'loose', '.git'), { recursive: true });
  assert.deepEqual(defaultTeamsFor(join(root, 'loose'), { teamsDoc }), ['loose'], 'in no team: its own project');
  const own = projectsOfTeams(defaultTeamsFor(join(root, 'loose'), { teamsDoc }), { teamsDoc, repos });
  assert.deepEqual([...own.projects], ['loose'], 'resolves to that project only');
  assert.deepEqual(defaultTeamsFor(tmpdir(), { teamsDoc }), [], 'in no repo: no filter');
  const selecting = { ...teamsDoc, active: ['ops'] };
  assert.deepEqual(defaultTeamsFor(join(root, 'coding'), { teamsDoc: selecting }), ['coding'], 'the viewer selection is not the session\'s repo');
  assert.deepEqual(defaultTeamsFor(join(root, 'loose'), { teamsDoc: selecting }), ['loose']);
});
