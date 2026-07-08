# Phase 85: Experiment Control Center - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 12 (5 new, 7 modified)
**Analogs found:** 12 / 12 (all have a concrete in-repo analog)

> Every file in this phase copies an existing, battle-tested pattern. This is ~90% wiring
> (RESEARCH "Don't Hand-Roll"): the only net-new mechanisms are the host-executor delegation
> seam (D-01 amended), the atomic `progress.json` emitter (D-03), and the `rerun_of`/
> `base_variant` metadata plumbing (D-05/D-07). Everything else is copy-a-template.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/vkb-server/api-routes.js` (MOD — 4 handlers) | route/controller | request-response | `handleMeasurementStart` (409) + `handleReconciliation` (verbatim read), same file | exact |
| `scripts/health-coordinator.js` (MOD — experiment-executor endpoint) | service (host daemon) | request-response → spawn | `POST /health/remediate` (~2577) + ETM detached spawn (~1596), same file | exact |
| `scripts/health-remediation-actions.js` (MOD, IF extending dispatcher) | service | event-driven (action dispatch) | `executeAction` switch (~114–177), same file | exact |
| `lib/experiments/run-progress.mjs` (NEW) | utility | file-I/O (atomic write + read) | `run-write.mjs` never-throw+null-preserved idiom; `fs.rename` atomic pattern | role-match |
| `lib/experiments/experiment-runner.mjs` (MOD — progress emitter) | service | batch (matrix loop) | its own `runMatrix`/`runCell` loop (D-03 hook points) | exact (self) |
| `lib/experiments/run-launch.mjs` (NEW — host spawn) | utility | file-I/O + process-spawn | `server-manager.js:128–138` detached spawn + `run.json` write | exact |
| `lib/experiments/run-write.mjs` (MOD — rerun_of/base_variant) | model (KB write) | CRUD (entity put) | its own `writeRun` null-preserved metadata block | exact (self) |
| `scripts/experiment-run.mjs` (MOD — new flags + progress init) | config/CLI | request-response (argv) | its own `main()` arg parse + `runMatrix` call | exact (self) |
| `scripts/measurement-start.mjs` (MOD — capture_raw_bodies + base_variant meta) | config/CLI | file-I/O (span meta write) | its own `resolveVariantMeta` → `span.meta` plumbing | exact (self) |
| `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` (MOD) | store (Redux slice) | request-response (thunks) | `fetchActiveMeasurement`/`startMeasurement`/`stopMeasurement` thunks, same file | exact |
| `.../components/performance/experiment-launcher.tsx` (NEW) | component | request-response (form + fetch) | `measurement-control.tsx` (start card) | exact |
| `.../components/performance/run-monitor.tsx` (NEW) | component | request-response (5s poll) | `measurement-control.tsx` (5s-poll `useEffect`) | exact |
| `.../components/performance/runs-table.tsx` (MOD — Re-run button) | component | event-driven (row action) | its own row-action `<Button>` block (~276–304) | exact (self) |
| `integrations/system-health-dashboard/server.js` (VERIFY only) | config (proxy) | request-response (reverse proxy) | `/api/experiments` passthrough (~346) — likely no edit | exact |

---

## Pattern Assignments

### `lib/vkb-server/api-routes.js` — `handleExperimentRun` (route, request-response, D-02)

**Analog:** `handleMeasurementStart` (same file, lines 887–913) — the exact 409 template.

**Route registration pattern** (lines 94–106 — copy the `app.post`/`app.get` binding style):
```javascript
app.post('/api/experiments/measurement/start', (req, res) => this.handleMeasurementStart(req, res));
app.get('/api/experiments/runs/:taskId/reconciliation', (req, res) => this.handleReconciliation(req, res));
// NEW (same shape):
// app.post('/api/experiments/run',        (req, res) => this.handleExperimentRun(req, res));
// app.get ('/api/experiments/run-status/:runId', (req, res) => this.handleRunStatus(req, res));
// app.post('/api/experiments/run-cancel', (req, res) => this.handleRunCancel(req, res));
// app.get ('/api/experiments/specs',      (req, res) => this.handleSpecList(req, res));
```

**409 concurrency guard** (lines 890–908 — copy verbatim, extend with the second contention source):
```javascript
async handleMeasurementStart(req, res) {
  try {
    const { task_id, goal } = req.body || {};
    if (!this._validTaskId(task_id)) {
      return res.status(400).json({ error: 'Invalid task_id', message: 'task_id must match [A-Za-z0-9._-] and be 1–80 chars.' });
    }
    const activePath = path.join(this._dataDir(), 'active-measurement.json');
    try {
      await fs.access(activePath);
      const existing = JSON.parse(await fs.readFile(activePath, 'utf8'));
      return res.status(409).json({ error: 'Measurement already active', message: `A span is already active (task_id=${existing.task_id}). Stop it first.`, span: existing });
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    // ... write span, 201 ...
  } catch (error) {
    logger.error('Measurement start failed', { error: error.message });
    return res.status(500).json({ error: 'Measurement start failed', message: error.message });
  }
}
```
> **D-02 second contention source:** after the `active-measurement.json` check, scan `.data/experiments/runs/*/progress.json` for `overall === 'running'` + a live pid (`process.kill(pid, 0)` via the coordinator seam — see Pitfall 6: do the live-run check from **files + pid liveness, NOT** by opening the LevelDB store) → 409 `{ holder: { kind:'experiment', run_id, pid } }`. Then **delegate the detached spawn host-side** (never spawn in-container — Pitfall 4).

---

### `lib/vkb-server/api-routes.js` — `handleRunStatus` (route, request-response, D-04)

**Analog:** `handleReconciliation` (same file, lines 610–638) — verbatim-serve + graceful ENOENT.

**Verbatim-serve read + traversal guard** (lines 610–638; `_validTaskId` at 855–858):
```javascript
_validTaskId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 80
    && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

async handleReconciliation(req, res) {
  try {
    const { taskId } = req.params;
    if (!this._validTaskId(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId', message: 'taskId is required' });
    }
    const filePath = path.join(this._dataDir(), 'measurements', taskId, 'reconciliation.json');
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return res.status(200).json(JSON.parse(raw));   // VERBATIM — no re-shaping
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(200).json({ reconciliation: null });  // graceful-empty
      throw e;
    }
  } catch (error) {
    logger.error('Reconciliation read failed', { error: error.message });
    return res.status(500).json({ error: 'Reconciliation read failed', message: error.message });
  }
}
```
> For `handleRunStatus`: clone this exactly. Add `_validRunId` (copy `_validTaskId` charset+`..` guard, line 855) so `../` in `:runId` cannot escape `.data/experiments/runs/`. Path: `path.join(this._dataDir(), 'experiments', 'runs', runId, 'progress.json')`. ENOENT → `200 { runId, overall: 'unknown', cells: [] }` (D-04 graceful-empty). Keep it a PURE file read — **never open the experiment store** (Pitfall 6 LevelDB contention during a live run).

---

### `lib/vkb-server/api-routes.js` — `handleSpecList` (route, request-response, D-09)

**Analog:** `resolveExperimentSpec` (`lib/experiments/experiment-spec.mjs:211–266`) reused server-side; `_repoRoot()`/`_dataDir()` helper idiom (line 844–847).

**Spec resolver return shape** (`experiment-spec.mjs:266`) — this is what the preview reads:
```javascript
// resolveExperimentSpec(fileOrObj) → { goal_sentence, repeats, cells }
return { goal_sentence, repeats, cells };   // cells = expanded variant array (agent/model/framework/env)
```
> Matrix preview N = `cells.length × repeats` (D-09). List `config/experiments/*.yaml`, `yaml.load` each, resolve. A malformed spec is LISTED with `{ file, error }`, not fatal (RESEARCH Code Examples §"Reuse resolveExperimentSpec"). `_dataDir()` resolves container-safe via `this.experimentRepoRoot || process.env.CODING_ROOT || process.cwd()` — mirror it as `_repoRoot()` for the `config/experiments` path so the handler-isolation tests (`experimentRepoRoot` injection) work.

---

### `scripts/health-coordinator.js` — experiment-executor endpoint (service, request-response → spawn, D-01 amended)

**Analog:** `POST /health/remediate` (same file, lines 2577–2592) — the dispatch seam; ETM detached spawn (lines 1596–1607) — the spawn mechanism.

**Dispatch seam** (lines 2577–2592):
```javascript
app.post('/health/remediate', async (req, res) => {
  const { action, service, details } = req.body || {};
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, error: 'action required' });
  }
  try {
    const dispatcher = await getRemediationDispatcher();
    const result = await dispatcher.executeAction(action, { service, ...(details || {}) });
    forceTick().catch(() => {});
    return res.status(result.success ? 200 : 500).json({ ok: result.success, ...result });
  } catch (err) {
    log(`remediate ${action} threw: ${err.message}`, 'ERROR');
    return res.status(500).json({ ok: false, error: err.message });
  }
});
```

**Detached spawn** (lines 1596–1607) — copy the `spawn` + `detached:true` + `unref()` shape:
```javascript
const child = spawn('node', [monitorScript, projectPath], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, CODING_REPO: REPO_ROOT, CODING_TOOLS_PATH: REPO_ROOT, /* … */ },
  cwd: REPO_ROOT
});
child.unref();
```
> **D-01 amended target.** Add a new host endpoint (e.g. `POST /experiments/run` and `POST /experiments/cancel`) OR a new `executeAction` case (see next entry). The spawn is `spawn(process.execPath, [scripts/experiment-run.mjs, '--spec', …, '--run-id', …, '--run-dir', …, ...overrideArgv], { cwd: REPO_ROOT, detached: true, stdio:'ignore', env: hostEnv }).unref()` — **fixed-argv, never `shell:true`** (T-78-03-01). `hostEnv` passes `CODING_REPO`, `LLM_PROXY_DATA_DIR`, `LLM_PROXY_PORT`, `CODING_PROXY_ROUTE` from the coordinator's own env (which already has them). Cancel: read `run.json.pid`, `process.kill(-pid, 'SIGTERM')` then SIGKILL after grace (Pattern 4 / Pitfall 2 — negated pid for the GROUP).
> **Loopback gate (V4):** `/health/remediate` is reachable from the container via host-gateway (a NON-loopback IP). The `/test/*` endpoints (line 2618) show the `LOOPBACK_IPS` gate that REJECTS the container — do NOT copy that gate onto the experiment endpoint verbatim, or the container proxy can't reach it. Accept the container/host-gateway origin, reject arbitrary external callers (port not published beyond localhost).

---

### `scripts/health-remediation-actions.js` — new `executeAction` case (service, event-driven) — IF extending the dispatcher

**Analog:** `executeAction` switch (same file, lines 114–177).
```javascript
async executeAction(actionName, issueDetails = {}) {
  // ...
  switch (actionName) {
    case 'kill_lock_holder':        return this.killLockHolder(issueDetails);
    case 'restart_vkb_server':      return this.restartVkbServer(issueDetails);
    case 'restart_transcript_monitor': return this.restartTranscriptMonitor(issueDetails);
    // NEW: case 'experiment_run':  return this.experimentRun(issueDetails);   // { spec, run_id, run_dir, overrideArgv }
    // NEW: case 'experiment_cancel': return this.experimentCancel(issueDetails); // { pid }
    // ...
  }
}
```
> Each case returns `{ success, message, ... }` (the `/health/remediate` handler keys its HTTP status off `result.success`). **Discretion (RESEARCH OQ1 / A1):** extend this dispatcher vs a raw endpoint on the coordinator. Both are host-side and honor "no new daemon." Planner should confirm the seam with the user before locking.

---

### `lib/experiments/run-progress.mjs` (NEW — utility, file-I/O, D-03/D-04)

**Analog:** `run-write.mjs` never-throw + null-preserved idiom; atomic `tmp + fs.rename` (Pitfall 3).

**Never-throw diagnostic idiom** (from `experiment-runner.mjs` — `process.stderr.write` only, no `console.*`):
```javascript
// From run-write.mjs:226 / experiment-runner.mjs throughout — stderr-only, never console.*
process.stderr.write(`[experiments] writeRun task_id=${span.task_id} …\n`);
```
> **NEW file contract:** `writeProgress(runDir, patch)` — merge-into-`progress.json` via write-to-`progress.json.tmp` then `fs.rename` (atomic on same FS — Pitfall 3, a 5s poller must never read a torn file). `readProgress(runDir)`. BOTH never-throw: a write failure → `process.stderr.write('[experiment-runner] progress emit failed (non-fatal): …')`, never aborts a cell (D-03, Phase-84 D-02 never-block lineage). `progress.json` shape (D-04): run-level header `{ spec, snapshot_id, pid, done, total, overall, run_id }` + per-cell array `[{ variant, rep, task_id, state, started_at, ended_at, reason }]` where `state ∈ pending|restoring|running|scoring|complete|timeout|abort|skipped`.

---

### `lib/experiments/experiment-runner.mjs` (MOD — progress emitter, D-03)

**Analog:** its own `runMatrix` cell loop (lines 520–558) + `runCell` transition points (lines 366–414).

**Cell-loop hook points** (lines 522–557 — thread an optional `runDir`/`onProgress` and emit at each transition):
```javascript
for (const cell of cells) {
  const variant = cellName(cell);
  for (let rep = 0; rep < repeats; rep += 1) {
    const taskId = composeTaskId(expId, cell, rep);
    if (doneSet.has(taskId)) {                                   // → emit state 'skipped'/'complete'
      summary.push({ task_id: taskId, variant, rep, status: 'skipped', reason: 'already-complete' });
      continue;
    }
    if (cell.agent === 'copilot' && copilotOk === false) { …     // → emit state 'skipped'
      continue;
    }
    try {
      const res = await runCell({ cell, rep, expId, goal, snapshotId, … });  // runCell emits restoring→running→scoring
      summary.push({ task_id: taskId, variant, rep, status: 'ran', terminal_state: res.terminalState });
    } catch (err) { …                                            // → emit terminal 'abort'
    }
  }
}
```

**`runCell` transition boundaries** (lines 366–414 — emit at each): restore (368) → `restoring`; measurement-start (393) → `running`; `finally` measurement-stop (413) → `scoring` → terminal.

> **CRITICAL — zero behavior change for existing tests.** Thread `runDir` (or `onProgress`) through `runMatrix(spec, opts)` + `runCell(...)` as OPTIONAL. When absent (manual CLI runs, the fake-seam integration test), the emitter is a **no-op** (`if (!runDir) return;`). The existing `experiment-runner.integration.test.mjs` MUST stay green (RESEARCH Test Map). The kill machinery to reuse for D-08 is already here: `launchCell` SIGTERM→SIGKILL grace (lines 252–261, `DEFAULT_GRACE_MS = 5000`).

---

### `lib/experiments/run-launch.mjs` (NEW — utility, host spawn, D-01)

**Analog:** `server-manager.js:128–138` (detached spawn + pid write) + `isProcessRunning` (lines 51–58).

**Detached spawn + pid persist** (`server-manager.js:128–138`):
```javascript
const child = spawn(command[0], command.slice(1), {
  detached: true,
  stdio: ['ignore', logStream, logStream],
  cwd: this.visualizerDir
});
await fs.writeFile(this.pidFile, String(child.pid));   // run.json equivalent
child.unref();                                          // orphan-survives-restart
```

**pid-liveness probe** (`server-manager.js:51–58`) — for D-04 `orphaned`/`unknown`:
```javascript
async isProcessRunning(pid) {
  try { process.kill(pid, 0); return true; }   // signal 0 = liveness probe
  catch { return false; }
}
```
> **NEW (host-side, called by the coordinator seam):** `buildRunArgv(specPath, runId, runDir, overrides)` → fixed-argv array; spawn `process.execPath scripts/experiment-run.mjs` `detached:true` + `unref()`; write `runDir/run.json` = `{ run_id, pid: child.pid, spec, started_at }`. Pitfall 2: the runner is `detached` → group leader (`pid == pgid`), so cancel signals `process.kill(-pid, sig)` (negated). This may live inside `health-coordinator.js`/`health-remediation-actions.js` rather than a standalone module — planner's discretion; the pattern is identical.

---

### `lib/experiments/run-write.mjs` (MOD — rerun_of/base_variant, D-05/D-07)

**Analog:** its own `writeRun` metadata block (lines 94–137) — null-preserved (`?? null`) idiom.

**Metadata tag block** (lines 122–137 — ADD two null-preserved keys):
```javascript
// R2/R3/R4 (Phase 78-01) null-preserved idiom — never `?? 0`, never conditional-omit:
variant:        t.variant ?? null,
repeat:         t.repeat ?? null,
terminal_state: t.terminal_state ?? null,   // D-04 enum
skip_reason:    t.skip_reason ?? null,
// NEW (D-05/D-07) — same idiom:
// rerun_of:     t.rerun_of ?? null,      // <original run_id> or null for a first run
// base_variant: t.base_variant ?? null,  // original variant name when model/agent overridden
```
> Follow the null-not-zero house rule EXACTLY (RESEARCH Anti-Pattern: coercing to `''` is forbidden). A non-rerun Run carries `rerun_of: null`; no migration of existing Runs (they read `null` via `?? null` on next write). The composeTaskId salt carries `run_id`; `task_hash` stays CONSTANT for comparability (D-05).

**Caller wiring** — `scripts/measurement-stop.mjs` `buildRunTags` (lines 153–175): the tags object is assembled here from `span.meta`. Thread `rerun_of: span.meta?.rerun_of ?? null` and `base_variant: span.meta?.base_variant ?? null` the same way `variant`/`repeat` fold from `span.meta` (lines 170–171).

---

### `scripts/experiment-run.mjs` (MOD — new flags + progress init, D-05/D-06/D-08)

**Analog:** its own `main()` arg parse (lines 93–162) + `runMatrix` call (line 162).

**Arg-parse + runMatrix wiring** (existing flags at 95–98, env contract at 127–128):
```javascript
const specPath   = parseStrArg(args, '--spec');
const variant    = parseStrArg(args, '--variant') || undefined;
const repeatsArg = parseStrArg(args, '--repeats');
const timeoutArg = parseStrArg(args, '--timeout');
// ...
const repoRoot = process.env.CODING_REPO || process.cwd();
const dataDir  = process.env.LLM_PROXY_DATA_DIR || path.join(repoRoot, '.data');
// ...
const summary = await runMatrix(specObj, opts);
```
> **ADD flags** (copy the `parseStrArg` idiom + positive-int validation at lines 106–125): `--run-id`, `--run-dir`, `--rerun-of`, per-variant `--model`/`--agent` overrides (D-06). Init `progress.json` before the loop (pending grid from `resolveExperimentSpec` cells) and pass `runDir` into `runMatrix(opts)`. Pitfall 1: keep the run_id salt SHORT + path-safe (6–8 char suffix) so `composeTaskId` doesn't blow the slug/path-key limit and re-break D-10 resume.

---

### `scripts/measurement-start.mjs` (MOD — capture_raw_bodies + base_variant into span.meta, D-12/D-07)

**Analog:** its own `resolveVariantMeta` → `span.meta` plumbing (lines 68–101; `--repeat` presence-check at 98–101).

**Span-meta CLI plumbing** (the `--variant`/`--repeat` → `span.meta` mapping at lines 96–101):
```javascript
const variant = parseStrArg(args, '--variant');
// R2 (D-10): --repeat presence-checked (not truthiness) so index 0 survives:
const flagRepeat = parseStrArg(args, '--repeat');
// … folds into span.meta { agent, model, framework, env, variant, repeat, … }
```
> **D-12:** add an optional `--capture-raw-bodies` flag → `span.meta.capture_raw_bodies = true`. The proxy's `rawBodyCaptureEnabled(span)` gate (in `../_work/rapid-llm-proxy/proxy-bridge/raw-bodies.mjs`, strict `=== true`) already honors it — **NO proxy changes** (D-12 default OFF). **D-07:** add `--base-variant` → `span.meta.base_variant` so `buildRunTags` folds it. Both mirror the `--variant`/`--repeat` presence-checked pattern exactly. Keep the shell-metacharacter guard (lines 105–108) for any new string flag.

---

### `.../store/slices/performanceSlice.ts` (MOD — launcher/monitor thunks, D-09/D-10/D-11)

**Analog:** `fetchActiveMeasurement`/`startMeasurement`/`stopMeasurement` thunks (lines 608–662).

**Thunk pattern** (lines 608–642 — copy the `createAsyncThunk` + `rejectWithValue` shape):
```typescript
export const fetchActiveMeasurement = createAsyncThunk<ActiveMeasurement | null, void | undefined, { rejectValue: string }>(
  'performance/fetchActiveMeasurement',
  async (_arg, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/measurement/active')
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      return data.active ? (data.span as ActiveMeasurement) : null
    } catch (error) { return rejectWithValue(error instanceof Error ? error.message : 'Unknown error') }
  }
)

export const startMeasurement = createAsyncThunk<ActiveMeasurement, { task_id: string; goal: string }, { rejectValue: string }>(
  'performance/startMeasurement',
  async ({ task_id, goal }, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/experiments/measurement/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id, goal }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return rejectWithValue(data?.message || `API returned ${response.status}`)
      return data.span as ActiveMeasurement
    } catch (error) { return rejectWithValue(error instanceof Error ? error.message : 'Unknown error') }
  }
)
```
> **NEW thunks:** `fetchSpecList` (GET `/api/experiments/specs`), `launchExperiment` (POST `/api/experiments/run` — surfaces the 409 holder via the `data?.message` reject path, exactly like `startMeasurement`), `fetchRunStatus` (GET `/api/experiments/run-status/${encodeURIComponent(runId)}`), `cancelRun` (POST `/api/experiments/run-cancel`). Register each in `extraReducers` (`.addCase(...pending/fulfilled/rejected)`, pattern at slice lines 884–912). Add state fields + selectors mirroring `selectActiveMeasurement`/`selectMeasurementLoading`/`selectMeasurementError` (lines 974–975) and `selectRuns` (line 945 — needed for the D-11 re-run pre-fill). **Discretion (D-slice):** RESEARCH recommends EXTENDING `performanceSlice` (reuses `selectRuns` for the re-run pre-fill) over a new slice.

---

### `.../components/performance/experiment-launcher.tsx` (NEW — component, D-09/D-11)

**Analog:** `measurement-control.tsx` (the start-card: `Card`/`Input`/`Button` + thunk dispatch).

**Card + form + thunk-dispatch** (`measurement-control.tsx:54–115`):
```tsx
export function MeasurementControl() {
  const dispatch = useAppDispatch()
  const active = useAppSelector(selectActiveMeasurement)
  const loading = useAppSelector(selectMeasurementLoading)
  const [taskId, setTaskId] = useState('')
  // ...
  const onStart = async () => {
    const result = await dispatch(startMeasurement({ task_id: taskId.trim(), goal: goal.trim() }))
    if (startMeasurement.fulfilled.match(result)) { setTaskId(''); setGoal('') }
  }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">Measurement …</CardTitle></CardHeader>
      <CardContent>
        <Input className="w-72 font-mono" placeholder="task_id …" value={taskId} onChange={(e) => setTaskId(e.target.value)} data-testid="measurement-task-id" />
        <Button onClick={onStart} disabled={loading || taskId.trim() === ''} data-testid="measurement-start">…</Button>
        {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  )
}
```
> **NEW:** spec `<select>` (from `fetchSpecList`), a resolved-matrix preview (`variants × repeats = N cells`) rendered BEFORE launch (D-09), override `<Input>`s (repeats, timeout, variant subset — D-06), and (D-12) a `capture_raw_bodies` checkbox. `data-testid` on every control (the e2e gate reads them). D-11 pre-fill: accept `rerun_of` + spec + `snapshot_id` as props/state when opened from the runs-table Re-run button. No YAML editor (D-09 — launches, never edits). Copy the `TASK_CLASSES` `<select>` idiom (lines 77–85) for the variant subset picker.

---

### `.../components/performance/run-monitor.tsx` (NEW — component, D-10)

**Analog:** `measurement-control.tsx` 5s-poll `useEffect` (lines 35–39).

**5s polling loop** (lines 35–39 — copy exactly):
```tsx
useEffect(() => {
  dispatch(fetchActiveMeasurement())
  const t = setInterval(() => dispatch(fetchActiveMeasurement()), 5000)
  return () => clearInterval(t)
}, [dispatch])
```
> **NEW:** poll `fetchRunStatus(activeRunId)` at 5s (guard `if (!activeRunId) return`). Render the run header (`Card`/`Badge` for overall state, done/total, elapsed) + a variant×repeat grid with per-cell state chips (`Badge`) + abort/skip reasons — a straight render of `progress.json` (D-10, no log-tail). Cancel `<Button>` dispatches `cancelRun` (acts immediately — D-08). Completed cells link to the existing Runs table / timeline (`setSelectedTaskId` — see runs-table row `onClick` at line 225). `data-testid` on every control for the e2e gate.

---

### `.../components/performance/runs-table.tsx` (MOD — Re-run button, D-11)

**Analog:** its own row-action `<Button>` block (lines 276–304 — "Explain"/"Edit scores").

**Row-action button** (lines 291–304 — copy the `variant="ghost"` + `e.stopPropagation()` + `dispatch` idiom):
```tsx
<Button
  variant="ghost" size="sm" data-testid="edit-scores"
  aria-label={`Edit scores for ${run.task_id}`}
  onClick={(e) => {
    e.stopPropagation()          // don't bubble to the row (row drives the timeline)
    dispatch(setOverrideTaskId(run.task_id))
  }}
>
  <Pencil className="size-3.5" /> Edit scores
</Button>
```
> **NEW:** add a "Re-run" `<Button>` in the same `<div className="flex ... gap-1">` action cell (line 275). `onClick` `e.stopPropagation()` then dispatch an action that opens the launcher pre-filled (same spec + `snapshot_id`, `rerun_of = run.task_id`, D-06 override fields — D-11). Use a `lucide-react` icon (imports at line 3: `Pencil, Layers, Trash2` — add e.g. `RotateCcw`). Only render on COMPLETED experiment runs (guard on `run.terminal_state`/experiment provenance). `data-testid="rerun-experiment"`.

---

### `integrations/system-health-dashboard/server.js` (VERIFY only — proxy passthrough)

**Analog:** `/api/experiments` reverse proxy (lines 346–363).
```javascript
this.app.use('/api/experiments', async (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  const url = `http://host.docker.internal:8080/api/experiments${req.path}${qs ? '?' + qs : ''}`;  // req.path passthrough
  const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) init.body = JSON.stringify(req.body);
  const resp = await fetch(url, init);
  res.status(resp.status).json(await resp.json());
});
```
> **A2 / Pitfall 5:** this `req.path` passthrough already forwards ALL `/api/experiments/*` subpaths (`run`, `run-status`, `run-cancel`, `specs`) — the new routes likely ride it **for free**. VERIFY with `curl host:8080/api/experiments/specs` before assuming an edit. IF an edit IS needed: `server.js` is bind-mounted + VirtioFS-cached → a full `cd docker && docker-compose restart coding-services` is REQUIRED (a supervisor-only restart re-reads the stale cache — CLAUDE.md).

---

## Shared Patterns

### Never-throw / best-effort write hooks
**Source:** `run-write.mjs:226` + `experiment-runner.mjs` (throughout) — `process.stderr.write(...)` only, NEVER `console.*` (CLAUDE.md no-console-log).
**Apply to:** `run-progress.mjs` emitter, every progress hook in `experiment-runner.mjs`, all host-executor diagnostics.
```javascript
process.stderr.write(`[experiment-runner] progress emit failed (non-fatal): ${err.message}\n`);
```

### Fixed-argv, no-shell exec (mandatory)
**Source:** `experiment-runner.mjs:246` (launchCell) + `health-coordinator.js:1596` (ETM spawn) + `server-manager.js:128`.
**Apply to:** the detached spawn (run-launch), the cancel kill, `runMeasurementCli`. **NEVER `shell:true` / template-string argv** (T-78-03-01, CLAUDE.md — constraint-dodging forbidden).
```javascript
const child = spawn(bin, argv /* fixed array */, { cwd, env, stdio, detached: true });
```

### null-preserved metadata (never `?? 0`, never `''`)
**Source:** `run-write.mjs:102–137` + `measurement-stop.mjs:157–174` (buildRunTags).
**Apply to:** `rerun_of`/`base_variant` (D-05/D-07), every new progress/Run field. `?? null` keeps a genuine `repeat` index 0 and a first-run `rerun_of: null`.

### Input validation / path-traversal guard (V5)
**Source:** `api-routes.js:855` `_validTaskId` (`[A-Za-z0-9._-]`, ≤80, reject `.`/`..`).
**Apply to:** `_validRunId` (new), spec-name (restrict to server-listed `config/experiments/*.yaml`, never a raw client path), override validation (repeats/timeout positive int, variant ∈ resolved names — mirror `experiment-run.mjs:106–125`).

### Container-never-spawns-host boundary
**Source:** `server.js:346` proxy + `server.js:884–914` coordinator delegation.
**Apply to:** ALL host work goes vkb-server → coordinator `:3034` (D-01 amended). The container only proxies + reads bind-mounted files; it NEVER spawns agent CLIs (Pitfall 4 — the whole reason for the host-executor split).

### Transient single-owner store access (LevelDB)
**Source:** `api-routes.js:489–491, 523–525` (`openExperimentStore` + `experimentRepoRoot`) + `runMatrix` open→build-done-set→close-BEFORE-launch (lines 501–510).
**Apply to:** ONLY `readRuns`-based reads (runs table, re-run pre-fill). The 409 "live run" check + `run-status` MUST be file+pid reads, NOT store opens (Pitfall 6 — lock contention during a live run). km-core rule: pass `ontologyDir`/`repoRoot` (CLAUDE.md).

---

## No Analog Found

None. Every file has a concrete in-repo analog (12/12). The three net-new mechanisms
(host-executor delegation, atomic progress emitter, rerun_of/base_variant plumbing) each
reuse an existing pattern (coordinator `/health/remediate` + ETM spawn; `run-write.mjs`
never-throw + `fs.rename`; the `variant`/`repeat` null-preserved tag fold), so no file
falls back to RESEARCH-only patterns.

## Metadata

**Analog search scope:** `lib/vkb-server/`, `lib/experiments/`, `scripts/`, `integrations/system-health-dashboard/src/{components/performance,store/slices}/`, `integrations/system-health-dashboard/server.js`
**Files scanned/read:** `api-routes.js`, `experiment-runner.mjs`, `run-write.mjs`, `server-manager.js`, `health-coordinator.js`, `health-remediation-actions.js`, `measurement-control.tsx`, `performanceSlice.ts`, `runs-table.tsx`, `experiment-run.mjs`, `experiment-spec.mjs`, `measurement-start.mjs`, `measurement-stop.mjs`, `server.js`
**Pattern extraction date:** 2026-07-08
