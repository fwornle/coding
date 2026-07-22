// tests/experiments/route-trace-resolve.test.mjs
//
// Phase 72 gap-closure (inline 72-06): the dominant-agent normalization +
// Claude session-window resolution that wires route heuristics into the close
// orchestrator. Before this, Claude/Copilot runs got ALL-NULL heuristics because
// (1) proxy rows leave `agent` blank so `KNOWN_AGENTS.has('')` failed, and
// (2) build-trace's default Claude locator is a stub awaiting a seam.
//
// Convention: node:test + node:assert/strict, stderr-only (tests/experiments/).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeAgent,
  locateClaudeSessionForSpan,
  locateCopilotSessionForSpan,
  buildTraceSeam,
} from '../../lib/experiments/route-trace-resolve.mjs';

describe('normalizeAgent', () => {
  test('blank agent + claude-* model → claude (the live blocker)', () => {
    assert.equal(normalizeAgent({ agent: '', model: 'claude-sonnet-4.6' }), 'claude');
    assert.equal(normalizeAgent({ agent: '', model: 'claude-opus-4-8' }), 'claude');
  });

  test('explicit agent name wins regardless of model', () => {
    assert.equal(normalizeAgent({ agent: 'opencode', model: 'whatever' }), 'opencode');
    assert.equal(normalizeAgent({ agent: 'claude-code', model: '' }), 'claude');
    assert.equal(normalizeAgent({ agent: 'copilot', model: '' }), 'copilot');
  });

  test('copilot model families (gpt-*/o-series) → copilot', () => {
    assert.equal(normalizeAgent({ agent: '', model: 'gpt-4o' }), 'copilot');
    assert.equal(normalizeAgent({ agent: '', model: 'o3-mini' }), 'copilot');
  });

  test('unclassifiable → null (honest no-classification, never a guess)', () => {
    assert.equal(normalizeAgent({ agent: '', model: '' }), null);
    assert.equal(normalizeAgent({}), null);
    assert.equal(normalizeAgent(undefined), null);
  });
});

describe('locateClaudeSessionForSpan', () => {
  function seedProjects(repoRoot) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-proj-'));
    const encoded = repoRoot.replace(/\//g, '-');
    const projDir = path.join(dir, encoded);
    fs.mkdirSync(projDir, { recursive: true });
    return { dir, projDir };
  }

  test('returns the most-recently-written top-level session overlapping the window', () => {
    const repoRoot = '/Users/me/Agentic/coding';
    const { dir, projDir } = seedProjects(repoRoot);
    const older = path.join(projDir, 'aaaaaaaa-1111-2222-3333-444444444444.jsonl');
    const newer = path.join(projDir, 'bbbbbbbb-5555-6666-7777-888888888888.jsonl');
    fs.writeFileSync(older, '{}\n');
    fs.writeFileSync(newer, '{}\n');
    const base = Date.parse('2026-06-28T12:00:00.000Z');
    fs.utimesSync(older, base / 1000, base / 1000);
    fs.utimesSync(newer, base / 1000 + 60, base / 1000 + 60); // 1 min newer
    const span = { started_at: '2026-06-28T12:00:30.000Z', ended_at: '2026-06-28T12:01:30.000Z' };
    const got = locateClaudeSessionForSpan(span, { projectsDir: dir, repoRoot });
    assert.equal(got, newer);
  });

  test('drops sessions last written well before the run started → null', () => {
    const repoRoot = '/Users/me/Agentic/coding';
    const { dir, projDir } = seedProjects(repoRoot);
    const stale = path.join(projDir, 'cccccccc-9999-0000-1111-222222222222.jsonl');
    fs.writeFileSync(stale, '{}\n');
    const old = Date.parse('2026-06-28T10:00:00.000Z') / 1000;
    fs.utimesSync(stale, old, old);
    // Run started 2h later; default 5-min slack can't bridge that gap.
    const span = { started_at: '2026-06-28T12:00:00.000Z', ended_at: '2026-06-28T12:05:00.000Z' };
    assert.equal(locateClaudeSessionForSpan(span, { projectsDir: dir, repoRoot }), null);
  });

  test('ignores sub-agent files (only top-level <uuid>.jsonl select)', () => {
    const repoRoot = '/Users/me/Agentic/coding';
    const { dir, projDir } = seedProjects(repoRoot);
    const subDir = path.join(projDir, 'dddddddd-3333-4444-5555-666666666666', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = path.join(subDir, 'agent-deadbeef.jsonl');
    fs.writeFileSync(subFile, '{}\n');
    const now = Date.now() / 1000;
    fs.utimesSync(subFile, now, now);
    const span = { started_at: new Date(Date.now() - 1000).toISOString(), ended_at: new Date().toISOString() };
    // Only a sub-agent file exists at top level there is none → null.
    assert.equal(locateClaudeSessionForSpan(span, { projectsDir: dir, repoRoot }), null);
  });

  test('absent project dir → null (honest no-trace)', () => {
    assert.equal(
      locateClaudeSessionForSpan(
        { started_at: '2026-06-28T12:00:00Z', ended_at: '2026-06-28T12:01:00Z' },
        { projectsDir: '/no/such/dir', repoRoot: '/Users/me/x' },
      ),
      null,
    );
  });
});

describe('locateCopilotSessionForSpan', () => {
  // Copilot writes ~/.copilot/session-state/<uuid>/events.jsonl — uuid-keyed dirs,
  // NOT cwd-scoped, so selection is purely by the span time-window.
  function seedState() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cp-state-'));
  }
  function seedSession(stateDir, uuid, mtimeSec) {
    const dir = path.join(stateDir, uuid);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'events.jsonl');
    fs.writeFileSync(p, '{}\n');
    fs.utimesSync(p, mtimeSec, mtimeSec);
    return p;
  }

  test('returns the most-recently-written session overlapping the window', () => {
    const stateDir = seedState();
    const base = Date.parse('2026-06-28T12:00:00.000Z') / 1000;
    const older = seedSession(stateDir, 'aaaaaaaa-1111-2222-3333-444444444444', base);
    const newer = seedSession(stateDir, 'bbbbbbbb-5555-6666-7777-888888888888', base + 60);
    const span = { started_at: '2026-06-28T12:00:30.000Z', ended_at: '2026-06-28T12:01:30.000Z' };
    assert.equal(locateCopilotSessionForSpan(span, { copilotStateDir: stateDir }), newer);
  });

  test('drops sessions written well before the run started → null', () => {
    const stateDir = seedState();
    const old = Date.parse('2026-06-28T10:00:00.000Z') / 1000;
    seedSession(stateDir, 'cccccccc-9999-0000-1111-222222222222', old);
    const span = { started_at: '2026-06-28T12:00:00.000Z', ended_at: '2026-06-28T12:05:00.000Z' };
    assert.equal(locateCopilotSessionForSpan(span, { copilotStateDir: stateDir }), null);
  });

  test('drops sessions written well after the run ended → null', () => {
    const stateDir = seedState();
    const later = Date.parse('2026-06-28T14:00:00.000Z') / 1000;
    seedSession(stateDir, 'dddddddd-3333-4444-5555-666666666666', later);
    const span = { started_at: '2026-06-28T12:00:00.000Z', ended_at: '2026-06-28T12:05:00.000Z' };
    assert.equal(locateCopilotSessionForSpan(span, { copilotStateDir: stateDir }), null);
  });

  test('absent session-state dir → null (honest no-trace)', () => {
    assert.equal(
      locateCopilotSessionForSpan(
        { started_at: '2026-06-28T12:00:00Z', ended_at: '2026-06-28T12:01:00Z' },
        { copilotStateDir: '/no/such/dir' },
      ),
      null,
    );
  });
});

describe('buildTraceSeam', () => {
  test('claude → seam with a locate.claude function', () => {
    const span = { started_at: '2026-06-28T12:00:00Z', ended_at: '2026-06-28T12:01:00Z' };
    const seam = buildTraceSeam('claude', span, { projectsDir: '/no/such', repoRoot: '/x' });
    assert.equal(typeof seam.locate.claude, 'function');
    assert.equal(seam.locate.claude(), null); // resolves through the locator (no dir → null)
  });

  test('copilot → seam with a locate.copilot function', () => {
    const span = { started_at: '2026-06-28T12:00:00Z', ended_at: '2026-06-28T12:01:00Z' };
    const seam = buildTraceSeam('copilot', span, { copilotStateDir: '/no/such' });
    assert.equal(typeof seam.locate.copilot, 'function');
    assert.equal(seam.locate.copilot(), null); // resolves through the locator (no dir → null)
  });

  test('opencode / null → undefined (default DB locator / no seam)', () => {
    const span = { started_at: '2026-06-28T12:00:00Z', ended_at: '2026-06-28T12:01:00Z' };
    assert.equal(buildTraceSeam('opencode', span), undefined);
    assert.equal(buildTraceSeam(null, span), undefined);
  });
});
