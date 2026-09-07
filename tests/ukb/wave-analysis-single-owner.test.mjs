/**
 * Contract for running wave-analysis on the single-owner km-core store.
 *
 * ── The bug ────────────────────────────────────────────────────────────────
 * km-core's LevelDB is single-owner-rw. obs-api opens it at startup and holds
 * the lock for the life of the process — the documented design, stated at the
 * top of scripts/observations-api-server.mjs, and the reason the standalone
 * LSL-resolver job was retired in favour of running in-process there.
 *
 * workflow-runner never got the same treatment: tools.ts spawned it as a
 * separate process and WaveController opened its own GraphKMStore. From the
 * Plan 44-12 cutover (2026-06-04) onward every wave-analysis run died one
 * second in with "Database failed to open" — .data/workflow-exit.log shows
 * exit 1 on 2026-07-01, twice on 2026-08-27 and again on 2026-09-07. The last
 * green run (2026-06-10) was the one that started while nothing held the lock.
 * Nothing surfaced the cause: the error named the database, not the daemon.
 *
 * These assertions pin the three pieces that keep it fixed — the store can be
 * injected, obs-api exposes the in-process run, and tools.ts routes to it
 * instead of spawning.
 *
 * Runner: node --test tests/ukb/wave-analysis-single-owner.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SA = path.join(REPO_ROOT, 'integrations', 'semantic-analysis', 'src');

const waveController = readFileSync(path.join(SA, 'agents', 'wave-controller.ts'), 'utf8');
const waveTypes = readFileSync(path.join(SA, 'types', 'wave-types.ts'), 'utf8');
const runWave = readFileSync(path.join(SA, 'run-wave-analysis.ts'), 'utf8');
const runner = readFileSync(path.join(SA, 'workflow-runner.ts'), 'utf8');
const tools = readFileSync(path.join(SA, 'tools.ts'), 'utf8');
const obsApi = readFileSync(path.join(REPO_ROOT, 'scripts', 'observations-api-server.mjs'), 'utf8');

/**
 * Strip comments so "does not contain X" assertions test CODE, not prose.
 * Both of these files explain the very constructs they must not call, so a
 * naive source match reads the explanation as a violation.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('WaveController can borrow the owner\'s store', () => {
  test('the config accepts an already-open store', () => {
    assert.match(waveTypes, /kmStore\?: KmStoreHandle/);
  });

  test('an injected store is used instead of opening a private one', () => {
    const flat = waveController.replace(/\s+/g, ' ');
    assert.match(flat, /if \(this\.injectedKmStore\) \{/);
    assert.match(flat, /createKmCoreAdapter\(\{ store: this\.injectedKmStore as never/);
  });

  test('an injected store is never opened or closed by WaveController', () => {
    // The owner's lifecycle wins; opening a second handle is the original bug
    // and closing the owner's would take obs-api's store out from under it.
    const injectedBranch = waveController.slice(
      waveController.indexOf('if (this.injectedKmStore)'),
      waveController.indexOf('} else {', waveController.indexOf('if (this.injectedKmStore)')),
    );
    assert.doesNotMatch(injectedBranch, /\.open\(\)/);
    assert.doesNotMatch(injectedBranch, /\.close\(\)/);
    assert.doesNotMatch(injectedBranch, /new km\.GraphKMStore/);
  });

  test('the private-store path still exists for callers that own nothing', () => {
    // A fresh checkout or CI has no obs-api holding the lock.
    assert.match(waveController, /new km\.GraphKMStore\(/);
    assert.match(waveController, /km-core adapter initialized \(private store\)/);
  });
});

describe('one shared run implementation', () => {
  test('run-wave-analysis owns the state machine and the terminal write', () => {
    assert.match(runWave, /export async function runWaveAnalysis/);
    assert.match(runWave, /writeTerminalState\(progressFile, 'completed', summary\)/);
    assert.match(runWave, /writeTerminalState\(progressFile, 'failed'/);
  });

  test('it never exits the process — obs-api must survive a failed run', () => {
    assert.doesNotMatch(code(runWave), /process\.exit\(/);
  });

  test('a thrown run still lands a terminal state rather than propagating', () => {
    const flat = runWave.replace(/\s+/g, ' ');
    assert.match(flat, /catch \(error\) \{ const message = error instanceof Error/);
    assert.match(flat, /return \{ success: false, totalEntities: 0, waves: 0, error: message \}/);
  });

  test('the runner delegates rather than keeping a second copy', () => {
    assert.match(runner, /const \{ runWaveAnalysis \} = await import\('\.\/run-wave-analysis\.js'\)/);
    // The old inline construction must be gone from the runner.
    assert.doesNotMatch(code(runner), /new WaveController\(/);
  });

  test('the runner hands its resolved debug config over, so `ukb debug` survives', () => {
    const flat = runner.replace(/\s+/g, ' ');
    assert.match(flat, /config: \{ singleStepMode: presetConfig\.singleStepMode/);
    assert.match(runWave, /opts\.config\?\.singleStepMode \?\? false/);
    assert.match(runWave, /opts\.config\?\.mockLLM \?\? false/);
  });

  test('the runner stands its own progress subscriber down first', () => {
    // Two writers racing on the terminal state is what the single-writer
    // guarantee (Phase 42 Plan 07 SC#4) exists to prevent.
    const waveBranch = runner.slice(runner.indexOf("if (workflowName === 'wave-analysis')"));
    const unsub = waveBranch.indexOf('unsubscribeProgressFile()');
    const call = waveBranch.indexOf('await runWaveAnalysis(');
    assert.ok(unsub > -1 && unsub < call, 'unsubscribe must precede the run');
  });
});

describe('obs-api exposes the in-process run', () => {
  test('the run endpoint exists and returns 202 like its consolidation sibling', () => {
    assert.match(obsApi, /app\.post\('\/api\/workflows\/wave-analysis\/run'/);
    assert.match(obsApi, /res\.status\(202\)\.json\(\{/);
  });

  test('it passes its OWN store into the run', () => {
    const flat = obsApi.replace(/\s+/g, ' ');
    assert.match(flat, /const store = await ensureKMStore\(\)/);
    assert.match(flat, /kmStore: store/);
  });

  test('concurrent triggers attach rather than starting a competing run', () => {
    // The state machine is module-level singleton state and the progress file
    // has one writer; two runs at once would corrupt both.
    assert.match(obsApi, /if \(_waveRunPromise\) return _waveRunPromise/);
  });

  test('a status endpoint reports this process\'s view', () => {
    assert.match(obsApi, /app\.get\('\/api\/workflows\/wave-analysis\/status'/);
  });

  test('the import is lazy so an unbuilt dist cannot stop obs-api booting', () => {
    const flat = obsApi.replace(/\s+/g, ' ');
    assert.match(flat, /await import\( '\.\.\/integrations\/semantic-analysis\/dist\/run-wave-analysis\.js' \)/);
  });
});

describe('tools.ts routes wave-analysis to the owner', () => {
  test('it dispatches over HTTP instead of spawning a child', () => {
    assert.match(tools, /if \(resolvedWorkflowName === 'wave-analysis'\) \{/);
    assert.match(tools, /\/api\/workflows\/wave-analysis\/run/);
  });

  test('an unreachable obs-api fails loudly instead of falling back to the spawn', () => {
    // Falling back would reproduce the original failure with an error naming
    // the database rather than the daemon — the reason this went unnoticed.
    const branch = tools.slice(
      tools.indexOf("if (resolvedWorkflowName === 'wave-analysis') {"),
      tools.indexOf('// Store workflow info locally'),
    );
    assert.match(branch, /isError: true/);
    assert.match(branch, /com\.coding\.obs-api/);
    assert.doesNotMatch(branch, /spawn\(/);
  });
});
