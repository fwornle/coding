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

/**
 * MOST OF THIS SUITE READS THE SUBMODULE, WHICH CI DOES NOT HAVE.
 *
 * The three pieces this file pins live in integrations/semantic-analysis, and
 * .github/workflows/cross-platform-lite.yml checks out with `submodules: false`
 * on purpose — "private submodules aren't reachable here". Reading them at
 * module load therefore threw ENOENT before a single assertion ran, and took
 * the whole file down with it: `not ok 122 - tests/ukb/wave-analysis-single-owner`,
 * red on every run since the suite was added.
 *
 * A test that cannot pass where it runs is worse than no test, because it
 * trains everyone to ignore a red check — and there were two other long-standing
 * failures on that job for it to hide behind.
 *
 * So the submodule-dependent groups SKIP when the submodule is absent, and the
 * obs-api group (which reads this repo) runs everywhere. Locally, where the
 * submodule IS checked out, every assertion runs exactly as before — the
 * coverage is not weakened, it is made honest about where it applies.
 *
 * A skipped `describe` does NOT enumerate its children, so node --test reports
 * `skipped 0` and the summary looks identical to a run where nothing was
 * missing. That is silent degradation of exactly the kind this file exists to
 * catch, so the sentinel test below is skipped in its own right — it is the one
 * thing that makes the count non-zero and prints the reason.
 */
function readOrNull(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

const waveController = readOrNull(path.join(SA, 'agents', 'wave-controller.ts'));
const waveTypes = readOrNull(path.join(SA, 'types', 'wave-types.ts'));
const runWave = readOrNull(path.join(SA, 'run-wave-analysis.ts'));
const runner = readOrNull(path.join(SA, 'workflow-runner.ts'));
const tools = readOrNull(path.join(SA, 'tools.ts'));
const runCoord = readOrNull(path.join(SA, 'run-coordinator-workflow.ts'));
const runConfig = readOrNull(path.join(SA, 'run-config.ts'));
const coordinator = readOrNull(path.join(SA, 'agents', 'coordinator.ts'));
const semanticAnalyzer = readOrNull(path.join(SA, 'agents', 'semantic-analyzer.ts'));
// This one is in THIS repo, so it is always present and never gates a skip.
const obsApi = readFileSync(path.join(REPO_ROOT, 'scripts', 'observations-api-server.mjs'), 'utf8');

const HAVE_SUBMODULE = [waveController, waveTypes, runWave, runner, tools, runCoord, runConfig, coordinator, semanticAnalyzer].every(Boolean);
const SKIP_NO_SUBMODULE = HAVE_SUBMODULE
  ? false
  : 'integrations/semantic-analysis is not checked out (CI uses submodules: false)';

/**
 * The sentinel. Its only job is to move the `skipped` counter off zero and put
 * the reason in the output, so a run that checked five of six groups cannot be
 * mistaken for a run that checked all six.
 */
test('the submodule-dependent groups are running', { skip: SKIP_NO_SUBMODULE }, () => {
  assert.ok(HAVE_SUBMODULE);
});

/**
 * Strip comments so "does not contain X" assertions test CODE, not prose.
 * Both of these files explain the very constructs they must not call, so a
 * naive source match reads the explanation as a violation.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('WaveController can borrow the owner\'s store', { skip: SKIP_NO_SUBMODULE }, () => {
  test('the config accepts an already-open store', () => {
    assert.match(waveTypes, /kmStore\?: KmStoreHandle/);
  });

  test('an injected store is forwarded rather than a private one being opened', () => {
    // The branch used to live here as `if (this.injectedKmStore) { ... } else {
    // new km.GraphKMStore ... }`. It moved to storage/km-store-host.ts so that
    // tools.ts and coordinator.ts — which had three copies of the WRONG version,
    // pointed at a directory that exists nowhere — share this one. The invariant
    // is unchanged: an already-open store is forwarded, never re-opened.
    const flat = code(waveController).replace(/\s+/g, ' ');
    assert.match(flat, /acquireKmStore\(\{/);
    assert.match(flat, /injected: this\.injectedKmStore/);
  });

  test('WaveController itself no longer opens or closes any store', () => {
    // Stronger than the assertion this replaces, which only checked the injected
    // BRANCH. Opening a second handle is the original bug, and closing the
    // owner's would take obs-api's store out from under it — km-core's close()
    // persists the whole graph and drops the LevelDB handle.
    const src = code(waveController);
    assert.doesNotMatch(src, /new km\.GraphKMStore/);
    assert.doesNotMatch(src, /\bstore\.open\(\)/);
    assert.doesNotMatch(src, /adapter\.close\(\)/);
  });

  test('the private-store path still exists, in the one place that owns it', () => {
    // A fresh checkout or CI has no obs-api holding the lock, so the path must
    // still be reachable — just not duplicated per caller. Ownership is explicit
    // now (`owned`), and release() is the only route to a close.
    const host = readOrNull(path.join(SA, 'storage', 'km-store-host.ts'));
    assert.ok(host, 'storage/km-store-host.ts must exist');
    assert.match(host, /new km\.GraphKMStore\(/);
    assert.match(host, /owned: true/);
    assert.match(host, /owned: false/);
    // And the three-state provider contract that makes borrowing safe: a host
    // that is still hydrating must throw rather than open a second handle.
    assert.match(host, /KmStoreNotReadyError/);
  });
});

describe('one shared run implementation', { skip: SKIP_NO_SUBMODULE }, () => {
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
    assert.match(flat, /const runConfig = \{ singleStepMode: presetConfig\.singleStepMode/);
    assert.equal((code(runner).match(/config: runConfig/g) || []).length, 2, 'both branches get it');
    assert.match(runWave, /opts\.config\?\.singleStepMode \?\? false/);
    assert.match(runWave, /opts\.config\?\.mockLLM \?\? false/);
  });

  test('the runner keeps no progress subscriber of its own', () => {
    // Two writers racing on the terminal state is what the single-writer
    // guarantee (Phase 42 Plan 07 SC#4) exists to prevent. Both run functions
    // own the state machine and the file, so the runner must not subscribe at
    // all (it used to subscribe and then stand down for the wave branch only).
    assert.doesNotMatch(code(runner), /subscribe\(/);
  });

  test('every run writes its debug config itself, explicitly', () => {
    // The progress subscriber lets the FILE's debug fields win over the start
    // event, so a stale `mockLLM: true` from an earlier `ukb debug` would turn a
    // production run into a mock one unless each field is written — false too.
    for (const [name, src] of [['run-wave-analysis', runWave], ['run-coordinator-workflow', runCoord]]) {
      const c = code(src);
      const write = c.indexOf('writeRunConfig(progressFile, opts.config)');
      const sub = c.indexOf('subscribe(createProgressFileSubscriber');
      assert.ok(write > -1 && write < sub, `${name}: config written before subscribing`);
    }
    assert.match(runConfig, /mockLLM,\n/);
    assert.match(runConfig, /singleStepMode: !!config\.singleStepMode/);
  });
});

describe('the coordinator workflows share one run implementation too', { skip: SKIP_NO_SUBMODULE }, () => {
  test('CoordinatorAgent forwards an injected store instead of opening its own', () => {
    // Raw source, not code(): coordinator.ts holds glob strings like `**/*.ts`
    // that the comment stripper reads as a comment opener and eats code with.
    const flat = coordinator.replace(/\s+/g, ' ');
    assert.match(flat, /constructor\(repositoryPath: string = '\.', team\?: string, opts: \{ kmStore\?: object \} = \{\}\)/);
    assert.match(flat, /injected: this\.injectedKmStore/);
  });

  test('run-coordinator-workflow passes the store and never exits the process', () => {
    const c = code(runCoord);
    assert.match(c, /new CoordinatorAgent\(repositoryPath, opts\.team, \{ kmStore: opts\.kmStore \}\)/);
    assert.doesNotMatch(c, /process\.exit\(/);
  });

  test('a thrown run lands a terminal state rather than propagating', () => {
    const flat = code(runCoord).replace(/\s+/g, ' ');
    assert.match(flat, /writeTerminalState\(progressFile, 'failed', undefined, \{ error: message/);
    assert.match(flat, /return \{ success: false, status: 'failed', error: message \}/);
  });

  test('the run\'s own repository wins over a path the caller sent', () => {
    // A request relayed from the container carries `/coding`, which on the host
    // names nothing — and the coordinator prefers parameters.repositoryPath.
    const flat = code(runCoord).replace(/\s+/g, ' ');
    assert.match(flat, /\.\.\.callerParameters, repositoryPath, \}/);
  });

  test('the runner delegates rather than keeping a second copy', () => {
    const c = code(runner);
    assert.match(c, /await runCoordinatorWorkflow\(\{/);
    assert.doesNotMatch(c, /new CoordinatorAgent\(/);
    assert.doesNotMatch(c, /executeBatchWorkflow\(/);
  });
});

describe('obs-api exposes the in-process run', () => {
  test('the run endpoints exist and return 202 like their consolidation sibling', () => {
    assert.match(obsApi, /app\.post\(`\/api\/workflows\/\$\{workflow\}\/run`/);
    assert.match(obsApi, /res\.status\(202\)\.json\(\{/);
  });

  test('the runnable workflows are an explicit list, not whatever the submodule defines', () => {
    const flat = obsApi.replace(/\s+/g, ' ');
    for (const w of ['wave-analysis', 'batch-analysis', 'incremental-analysis', 'complete-analysis']) {
      assert.match(flat, new RegExp(`'${w}': `), `${w} is registered`);
    }
    assert.match(flat, /for \(const workflow of Object\.keys\(WORKFLOW_RUNNERS\)\)/);
  });

  test('it passes its OWN store into the run', () => {
    const flat = obsApi.replace(/\s+/g, ' ');
    assert.match(flat, /const store = await ensureKMStore\(\)/);
    assert.match(flat, /kmStore: store/);
  });

  test('one lock across every workflow: same one attaches, a different one gets 409', () => {
    // The state machine is module-level singleton state and the progress file
    // has one writer; two runs at once would corrupt both. Attaching a request
    // to a DIFFERENT workflow would report success for a run nobody started.
    const flat = obsApi.replace(/\s+/g, ' ');
    assert.match(flat, /outcome: _workflowRun\.workflow === workflow \? 'attached' : 'conflict'/);
    assert.match(flat, /if \(outcome === 'conflict'\) \{ return res\.status\(409\)/);
    // The lock is released only when the run settles, never by a timer.
    assert.match(flat, /\.finally\(\(\) => \{ _workflowRun = null; \}\)/);
  });

  test('a status endpoint reports this process\'s view, including who holds the lock', () => {
    assert.match(obsApi, /app\.get\(`\/api\/workflows\/\$\{workflow\}\/status`/);
    assert.match(obsApi, /activeWorkflow: describeRun\(_workflowRun\)/);
  });

  test('the imports are lazy so an unbuilt dist cannot stop obs-api booting', () => {
    const flat = obsApi.replace(/\s+/g, ' ');
    assert.match(flat, /await import\(`\$\{SA_DIST\}\/run-wave-analysis\.js`\)/);
    assert.match(flat, /await import\(`\$\{SA_DIST\}\/run-coordinator-workflow\.js`\)/);
    assert.doesNotMatch(obsApi, /^import .*semantic-analysis\/dist/m);
  });
});

describe('an in-process run can be cancelled', { skip: SKIP_NO_SUBMODULE }, () => {
  // There is no runner PID to kill once a run lives inside obs-api, and the run
  // reads the state machine in that process, not the files the dashboard
  // rewrites. Before these, a cancelled batch run kept going to the end, and a
  // cancelled single-step wave run ADVANCED (the rewrite cleared stepPaused).
  test('obs-api cancels by dispatching into its own state machine', () => {
    const flat = obsApi.replace(/\s+/g, ' ');
    assert.match(flat, /app\.post\('\/api\/workflows\/cancel'/);
    assert.match(flat, /await import\(`\$\{SA_DIST\}\/workflow-state-machine\.js`\)/);
    assert.match(flat, /dispatch\(\{ type: 'cancel'/);
  });

  test('the dashboard cancel reaches obs-api before rewriting files', () => {
    const dash = readFileSync(path.join(REPO_ROOT, 'integrations', 'system-health-dashboard', 'server.js'), 'utf8');
    const handler = dash.slice(dash.indexOf('async handleCancelWorkflow('));
    const call = handler.indexOf('/api/workflows/cancel');
    const reset = handler.indexOf('writeFileSync(progressPath');
    assert.ok(call > -1 && call < reset, 'obs-api is asked first');
  });

  test('the coordinator checks the state machine, not only its own legacy file', () => {
    // isWorkflowCancelled() read workflow-progress-legacy.json, which nothing
    // ever writes 'cancelled' into — its eight checkpoints could not fire.
    const fn = coordinator.slice(coordinator.indexOf('private isWorkflowCancelled(): boolean {'));
    assert.match(fn.slice(0, 1200), /getWorkflowState\(\)\.status === 'cancelled'/);
  });

  test('a paused wave run stops waiting when cancelled', () => {
    const loop = waveController.slice(waveController.indexOf('// Poll for resume signal'));
    const cancel = loop.indexOf("getState().status === 'cancelled'");
    const advance = loop.indexOf('if (!currentProgress.stepPaused)');
    assert.ok(cancel > -1 && cancel < advance, 'cancel is checked before the Step check');
  });

  test('both run functions end a cancelled run as cancelled, not failed', () => {
    assert.match(runWave, /writeTerminalState\(progressFile, 'cancelled'\)/);
    assert.match(runCoord, /writeTerminalState\(progressFile, 'cancelled'\)/);
  });
});

describe('`ukb debug` mock mode makes no real LLM calls', { skip: SKIP_NO_SUBMODULE }, () => {
  // Measured 2026-10-01: a debug run logged "LLM mode fallback: intended=mock,
  // actual=public" and spent ~9s per entity on real, metered calls. Two holes.
  // Both holes were in the vendored SDK's provider wiring. The SDK is gone:
  // SemanticAnalyzer now has ONE exit point, `complete()`, which answers mock
  // mode itself before anything can dial out. Behavioural coverage of the same
  // invariant: src/agents/llm-with-process.test.ts in the submodule.
  test('the one exit point answers mock mode before it can reach the proxy', () => {
    const c = code(semanticAnalyzer);
    const fn = c.slice(c.indexOf('private async complete(request: {'));
    const mock = fn.indexOf("getLLMModeForAgent() === 'mock'");
    const dial = fn.indexOf('llmWithProcessComplete(');
    assert.ok(mock > -1 && dial > -1 && mock < dial, 'mock is checked before the proxy call');
  });

  test('nothing else in SemanticAnalyzer dials the proxy', () => {
    // A second call site would be a path that skips the mock check — which is
    // exactly what a process-tagged call used to be.
    const c = code(semanticAnalyzer);
    assert.equal((c.match(/llmWithProcessComplete\(/g) || []).length, 1);
    assert.doesNotMatch(c, /LLMService/);
  });

  test("Wave 1's observation top-up skips its LLM retry in mock mode", () => {
    // Measured 2026-10-03, after the two holes above were closed: a debug run
    // still made 4 real calls, all `wave-analysis-wave1-l1emit` observation
    // retries. ensureMinimumObservations runs for every L1 entity, mock or
    // not, and the mock analysis rarely yields 3 specific observations.
    const wave1 = readOrNull(path.join(SA, 'agents', 'wave1-project-agent.ts'));
    const c = code(wave1);
    const fn = c.slice(c.indexOf('private async ensureMinimumObservations('));
    const guard = fn.indexOf('if (!isMockLLMEnabled(this.repositoryPath)) {');
    const retry = fn.indexOf('this.llmWithProcess.complete(');
    assert.ok(guard > -1 && retry > -1 && guard < retry, 'mock is checked before the retry call');
  });
});

describe('tools.ts routes the UKB workflows to the owner', { skip: SKIP_NO_SUBMODULE }, () => {
  const branchStart = () => tools.indexOf('if (OBS_API_WORKFLOWS.has(workflow_name)) {');
  const branch = () => tools.slice(branchStart(), tools.indexOf('// CRITICAL: Clean up any existing running workflows'));

  test('it dispatches over HTTP instead of spawning a child', () => {
    assert.ok(branchStart() > -1);
    assert.match(branch(), /\/api\/workflows\/\$\{workflow_name\}\/run/);
  });

  test('it routes exactly the workflows obs-api runs', () => {
    // Drift either way is a bug: a name only tools.ts routes gets a 404, a name
    // only obs-api runs is still spawned into a child that cannot open the store.
    const routed = tools.match(/const OBS_API_WORKFLOWS = new Set\(\[([^\]]*)\]\)/);
    assert.ok(routed, 'OBS_API_WORKFLOWS literal');
    const names = (s) => [...s.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    const runnersBlock = obsApi.slice(obsApi.indexOf('const WORKFLOW_RUNNERS = {'), obsApi.indexOf('let _workflowRun'));
    const served = [...runnersBlock.matchAll(/^  '([a-z-]+)': /gm)].map((m) => m[1]).sort();
    assert.deepEqual(names(routed[1]), served);
  });

  test('a refused or failed handoff touches nothing local first', () => {
    // obs-api may answer 409 for a run it is protecting; cancelling that run,
    // killing runner PIDs or rewriting its debug flags before asking would
    // wreck exactly what the 409 exists to protect.
    assert.ok(branchStart() < tools.indexOf('const cleanup = await cleanupExistingWorkflows('));
    assert.ok(branchStart() < tools.indexOf("dispatch({\n        type: 'start',"));
    assert.match(branch(), /resp\.status === 409/);
  });

  test('an unreachable obs-api fails loudly instead of falling back to the spawn', () => {
    // Falling back would reproduce the original failure with an error naming
    // the database rather than the daemon — the reason this went unnoticed.
    const b = branch();
    assert.match(b, /isError: true/);
    assert.match(b, /com\.coding\.obs-api/);
    assert.doesNotMatch(b, /spawn\(/);
  });
});

describe('the host run sees the host filesystem', { skip: SKIP_NO_SUBMODULE }, () => {
  test('obs-api fills CODING_REPO from its own location when unset', () => {
    // launchd inherits no shell environment. Without this, every module that
    // resolves the repo from CODING_REPO/CODING_TOOLS_PATH/CODING_ROOT falls
    // back to the CONTAINER path /coding, which does not exist on the host —
    // GraphifyGraph then reported "graph.json not found at /coding/..." and
    // the run silently continued without the code graph.
    const flat = obsApi.replace(/\s+/g, ' ');
    assert.match(flat, /if \(!process\.env\.CODING_REPO\) \{ process\.env\.CODING_REPO = REPO_ROOT; \}/);
  });

});

describe('both callers get trace history', { skip: SKIP_NO_SUBMODULE }, () => {
  test('run-wave-analysis owns saveTraceHistory', () => {
    assert.match(runWave, /export function saveTraceHistory\(/);
    assert.match(runWave, /saveTraceHistory\(repositoryPath, progressSnapshot, 'wave-analysis', logLine/);
  });

  test('the runner no longer keeps its own copy', () => {
    // A second copy is how the obs-api path ended up writing a workflow report
    // with no trace beside it.
    assert.doesNotMatch(code(runner), /saveTraceHistory/);
  });

  test('the trace is snapshotted BEFORE the terminal write', () => {
    // writeTerminalState() rebuilds the progress file from a field allowlist
    // that excludes stepsDetail, so a snapshot taken afterwards records a run
    // with no steps in it.
    const snapshot = runWave.indexOf('readProgressSnapshot(progressFile)');
    const terminal = runWave.indexOf("writeTerminalState(progressFile, 'completed'");
    const save = runWave.indexOf('saveTraceHistory(repositoryPath, progressSnapshot');
    assert.ok(snapshot > -1 && terminal > -1 && save > -1);
    assert.ok(snapshot < terminal, 'snapshot must precede the terminal write');
    assert.ok(terminal < save, 'the trace is written after the terminal state, from the snapshot');
  });

  test('the trace records the TERMINAL status, not the snapshot\'s', () => {
    // The snapshot is taken while the run is still 'running' — recording that
    // would label every completed run as unfinished in the History tab.
    assert.match(runWave, /terminalStatus: string = 'completed'/);
    assert.match(runWave, /status: terminalStatus,/);
    assert.match(runWave, /'wave-analysis', logLine, 'completed'\)/);
  });

  test('only a successful run is recorded', () => {
    const flat = runWave.replace(/\s+/g, ' ');
    assert.match(flat, /if \(result\.success\) \{ saveTraceHistory\(/);
  });
});
