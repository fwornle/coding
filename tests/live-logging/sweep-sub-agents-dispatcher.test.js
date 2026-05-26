/**
 * tests/live-logging/sweep-sub-agents-dispatcher.test.js
 *
 * Phase 51 Plan 01 Task 2: agent-agnostic sweep dispatcher CLI.
 *
 * 7 tests covering:
 *  1. --help exits 0 and prints all 5 flag names
 *  2. With four fake adapters, calls discover() then convertToObservations()
 *     on each agent in AGENTS order
 *  3. --agent claude filters to ONE agent (skips other three)
 *  4. --dry-run calls discover() but NOT convertToObservations(); stderr
 *     reports dry-run + nonzero discovered count
 *  5. Missing adapter → stderr 'no adapter' + exit 0 if any other succeeded,
 *     exit 2 if ALL four are missing/failed
 *  6. Idempotency — second invocation against the same fixture state does
 *     not increase the convert-call count beyond the dispatcher's first pass
 *  7. --project coding forwards to adapter.discover({project:'coding'})
 *
 * Strategy: spawn the CLI as a subprocess (matches Plan 50-03 pattern);
 * use fixture adapter files at a tmpdir-overridden LSL_ADAPTERS_DIR that
 * write argv + a small "discovered rows" set into a sidecar JSON file the
 * test reads back.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(REPO_ROOT, 'scripts/sweep-sub-agents.mjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-dispatcher-'));
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Spawn the CLI. Returns { code, stdout, stderr }.
 */
function runCLI(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, ...args], {
      env: { ...process.env, ...env },
      cwd: REPO_ROOT,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

/**
 * Write a fake adapter file that records its calls into a sidecar JSON.
 * Each adapter discovers `discoveredCount` rows; convertToObservations
 * returns one result per row with `observationsWritten = 1`.
 */
function writeFakeAdapter(adaptersDir, sidecarDir, agentId, { discoveredCount = 1, throwOnDiscover = false } = {}) {
  const sidecarFile = path.join(sidecarDir, `${agentId}-sidecar.json`);
  // Initialize the sidecar with an empty call list so even
  // "loaded but never called" cases produce a parseable file.
  fs.writeFileSync(sidecarFile, JSON.stringify({ calls: [] }), 'utf-8');
  const adapterFile = path.join(adaptersDir, `${agentId}-fake.mjs`);
  // The adapter records each call by appending to the sidecar JSON.
  // Uses fs.readFileSync/writeFileSync so each call is atomic-ish at the
  // process level; tests run dispatcher invocations sequentially so this
  // is safe.
  const body = `
import fs from 'node:fs';

const SIDECAR = ${JSON.stringify(sidecarFile)};
const DISCOVERED_COUNT = ${discoveredCount};
const THROW_ON_DISCOVER = ${throwOnDiscover ? 'true' : 'false'};

function record(call) {
  const data = JSON.parse(fs.readFileSync(SIDECAR, 'utf-8'));
  data.calls.push(call);
  fs.writeFileSync(SIDECAR, JSON.stringify(data, null, 2));
}

export const adapter = {
  agentId: ${JSON.stringify(agentId)},
  storageType: 'fixture',
  async discover(opts) {
    record({ method: 'discover', opts });
    if (THROW_ON_DISCOVER) throw new Error('fixture: discover failed');
    const rows = [];
    for (let i = 1; i <= DISCOVERED_COUNT; i++) {
      rows.push({
        agent: ${JSON.stringify(agentId)},
        sub_hash: \`fake\${i.toString().padStart(3, '0')}\`,
        parent_session_id: \`parent-\${${JSON.stringify(agentId)}}-\${i}\`,
        sub_index: i,
        transcript_path: \`/tmp/fixture/\${${JSON.stringify(agentId)}}/\${i}.jsonl\`,
        project: opts.project || 'coding',
        agent_metadata: { fixture: true },
      });
    }
    return rows;
  },
  async convertToObservations(rows, opts) {
    record({ method: 'convertToObservations', rowCount: rows.length, opts });
    return rows.map((r) => ({
      sub_hash: r.sub_hash,
      observations_written: 1,
      skipped: 0,
      error: null,
    }));
  },
};
`;
  fs.writeFileSync(adapterFile, body, 'utf-8');
  return sidecarFile;
}

function readSidecar(sidecarFile) {
  return JSON.parse(fs.readFileSync(sidecarFile, 'utf-8'));
}

function setupAllFour(tmpDir, opts = {}) {
  const adaptersDir = path.join(tmpDir, 'adapters');
  const sidecarDir = path.join(tmpDir, 'sidecars');
  fs.mkdirSync(adaptersDir, { recursive: true });
  fs.mkdirSync(sidecarDir, { recursive: true });
  const sidecars = {};
  for (const a of ['claude', 'opencode', 'copilot', 'mastra']) {
    sidecars[a] = writeFakeAdapter(adaptersDir, sidecarDir, a, opts);
  }
  return { adaptersDir, sidecarDir, sidecars };
}

describe('scripts/sweep-sub-agents.mjs CLI', () => {
  test('Test 1: --help exits 0 and prints usage with all five flags', async () => {
    const { code, stdout, stderr } = await runCLI(['--help']);
    expect(code).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/--agent/);
    expect(combined).toMatch(/--since/);
    expect(combined).toMatch(/--dry-run/);
    expect(combined).toMatch(/--project/);
    expect(combined).toMatch(/--limit/);
  });

  test('Test 2: with all four fake adapters, calls discover then convertToObservations on each in AGENTS order', async () => {
    const { adaptersDir, sidecars } = setupAllFour(tmpDir);
    const { code, stderr } = await runCLI(['--project', 'coding'], {
      LSL_ADAPTERS_DIR: adaptersDir,
    });
    expect(code).toBe(0);
    // Each adapter must have BOTH calls recorded.
    for (const a of ['claude', 'opencode', 'copilot', 'mastra']) {
      const data = readSidecar(sidecars[a]);
      const methods = data.calls.map((c) => c.method);
      expect(methods).toEqual(['discover', 'convertToObservations']);
    }
    // Aggregate stderr line should mention each agent.
    expect(stderr).toMatch(/agent=claude/);
    expect(stderr).toMatch(/agent=opencode/);
    expect(stderr).toMatch(/agent=copilot/);
    expect(stderr).toMatch(/agent=mastra/);
    expect(stderr).toMatch(/aggregate/);
  });

  test('Test 3: --agent claude filters to ONE agent (skips other three)', async () => {
    const { adaptersDir, sidecars } = setupAllFour(tmpDir);
    const { code } = await runCLI(['--agent', 'claude', '--project', 'coding'], {
      LSL_ADAPTERS_DIR: adaptersDir,
    });
    expect(code).toBe(0);
    const claudeData = readSidecar(sidecars.claude);
    const claudeMethods = claudeData.calls.map((c) => c.method);
    expect(claudeMethods).toEqual(['discover', 'convertToObservations']);
    for (const a of ['opencode', 'copilot', 'mastra']) {
      const data = readSidecar(sidecars[a]);
      expect(data.calls).toEqual([]);
    }
  });

  test('Test 4: --dry-run calls discover() but NOT convertToObservations; stderr reports dry-run + nonzero discovered count', async () => {
    const { adaptersDir, sidecars } = setupAllFour(tmpDir, { discoveredCount: 2 });
    const { code, stderr } = await runCLI(['--dry-run', '--project', 'coding'], {
      LSL_ADAPTERS_DIR: adaptersDir,
    });
    expect(code).toBe(0);
    for (const a of ['claude', 'opencode', 'copilot', 'mastra']) {
      const data = readSidecar(sidecars[a]);
      const methods = data.calls.map((c) => c.method);
      expect(methods).toEqual(['discover']);
    }
    expect(stderr).toMatch(/dry-run/i);
    // Aggregate discovered = 4 agents * 2 rows = 8
    expect(stderr).toMatch(/discovered=[1-9]/);
  });

  test('Test 5: missing adapter → stderr "no adapter" + exit 0 when others succeed; exit 2 when all four missing', async () => {
    // Scenario A: claude+opencode present, copilot+mastra missing → exit 0
    const adaptersDir = path.join(tmpDir, 'adapters-partial');
    const sidecarDir = path.join(tmpDir, 'sidecars-partial');
    fs.mkdirSync(adaptersDir, { recursive: true });
    fs.mkdirSync(sidecarDir, { recursive: true });
    writeFakeAdapter(adaptersDir, sidecarDir, 'claude');
    writeFakeAdapter(adaptersDir, sidecarDir, 'opencode');
    const a = await runCLI(['--project', 'coding'], {
      LSL_ADAPTERS_DIR: adaptersDir,
    });
    expect(a.code).toBe(0);
    expect(a.stderr).toMatch(/no adapter/);
    expect(a.stderr).toMatch(/copilot|mastra/);

    // Scenario B: no adapter files at all → exit 2
    const emptyDir = path.join(tmpDir, 'empty-adapters');
    fs.mkdirSync(emptyDir, { recursive: true });
    const b = await runCLI(['--project', 'coding'], {
      LSL_ADAPTERS_DIR: emptyDir,
    });
    expect(b.code).toBe(2);
    expect(b.stderr).toMatch(/no adapter/);
  });

  test('Test 6: idempotency — invoking twice does not duplicate adapter calls beyond the deterministic per-run shape', async () => {
    const { adaptersDir, sidecars } = setupAllFour(tmpDir);
    const r1 = await runCLI(['--project', 'coding'], { LSL_ADAPTERS_DIR: adaptersDir });
    expect(r1.code).toBe(0);
    const r2 = await runCLI(['--project', 'coding'], { LSL_ADAPTERS_DIR: adaptersDir });
    expect(r2.code).toBe(0);
    // Each adapter's sidecar should now have exactly 4 entries (2 runs × 2 methods).
    // The point of the test: the dispatcher invokes adapters predictably; the
    // adapter+writer's own content_hash gate is what makes observation writes
    // idempotent — verified via Plan 50's race-guard + content-hash test path.
    // Here we assert the dispatcher does NOT call adapters more than 1 pair per run.
    for (const a of ['claude', 'opencode', 'copilot', 'mastra']) {
      const data = readSidecar(sidecars[a]);
      expect(data.calls).toHaveLength(4);
      const methods = data.calls.map((c) => c.method);
      expect(methods).toEqual(['discover', 'convertToObservations', 'discover', 'convertToObservations']);
    }
  });

  test('Test 7: --project coding flag forwards to adapter.discover({project:"coding"})', async () => {
    const { adaptersDir, sidecars } = setupAllFour(tmpDir);
    const { code } = await runCLI(['--project', 'coding'], {
      LSL_ADAPTERS_DIR: adaptersDir,
    });
    expect(code).toBe(0);
    for (const a of ['claude', 'opencode', 'copilot', 'mastra']) {
      const data = readSidecar(sidecars[a]);
      const discoverCall = data.calls.find((c) => c.method === 'discover');
      expect(discoverCall).toBeDefined();
      expect(discoverCall.opts.project).toBe('coding');
    }
  });
});
