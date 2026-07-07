# Phase 84: Per-Turn Context Revelation - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 15 (new + modified, across two repos: `coding` + `_work/rapid-llm-proxy`)
**Analogs found:** 14 / 15 (1 net-new config surface, no code analog)

All analog file:line anchors below were re-verified against live code this session. Two repos are in play:
- **PROXY repo** = `/Users/Q284340/Agentic/_work/rapid-llm-proxy` (runtime is `proxy-bridge/server.mjs` — **runtime JS, NO `npm run build`**; deploy via `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`).
- **CODING repo** = `/Users/Q284340/Agentic/coding` (this repo).

## File Classification

| New/Modified File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `proxy-bridge/server.mjs` — `logContextTurn()` + 2 call sites (MODIFY) | proxy | write-hook / instrumentation | event-driven / append | `logTokenCall` call sites @ 2201, 2676 + `logErr` never-throw wrap @ 2224-2226 | exact |
| `proxy-bridge/server.mjs` — `GET /api/context-turns` (MODIFY) | proxy | route | request-response / read | `GET /api/context-breakdown` @ 1880-1892 | exact |
| `proxy-bridge/server.mjs` — context-turns path helper (MODIFY) | proxy | utility | file-path | `perRunBreakdownPath` / `safeSanitizeTaskId` @ 1599-1612 | exact |
| `proxy-bridge/server.mjs` — raw-body redaction applier (NEW, proxy-side) | proxy | utility / security | transform | `loadRedactionPatterns` core (RESEARCH) + `EnhancedRedactionSystem.redact` shape | role-match |
| `scripts/measurement-stop.mjs` — gzip-at-close + obs enrich (MODIFY) | coding | span-close pipeline | batch / file-I/O | reconciliation.json write block @ 471-483 | exact |
| `scripts/enhanced-redaction-system.js` — config-loader rewire (MODIFY) | coding | utility / security | transform | current `redact()` + return shape @ 21-64 | exact (self) |
| `scripts/lsl-file-manager.js` — caller (READ-ONLY contract) | coding | caller | transform | `.redact()` consumption @ 125-155 | contract-only |
| `launchd/com.coding.context-turns-sweeper.plist` (NEW) | coding | config / launchd | scheduled | `launchd/com.coding.lsl-lock-sweeper.plist` | exact |
| `scripts/context-turns-sweeper-job.sh` (NEW) | coding | utility / sweeper | batch / file-I/O | `scripts/lsl-lock-sweeper-job.sh` | exact |
| `scripts/install-context-turns-sweeper-launchd.sh` (NEW) | coding | config / installer | one-shot | `scripts/install-lsl-lock-sweeper-launchd.sh` | exact |
| `lib/vkb-server/api-routes.js` — `handleContextTurns` + registration (MODIFY) | coding | route | request-response / read | `handleReconciliation` @ 605-633 + registration @ 90 | exact |
| `integrations/system-health-dashboard/server.js` — proxy mirror line (MODIFY) | coding | route / proxy | request-response | `/api/context-breakdown` proxy @ 294-304 | exact |
| `.../store/slices/performanceSlice.ts` — `fetchContextTurns` thunk + selector + reducers (MODIFY) | coding | store | request-response / read | `fetchTimeline` @ 345-360, `selectTimelineFor` @ 881, reducers @ 708-720, state @ 198/257 | exact |
| `.../components/performance/context-cache-explainer.tsx` — wire data + honest copy (MODIFY) | coding | component | request-response | self @ 117-134, 290-304, 520-531 | exact (self) |
| `.planning/config.json` — retention config key (NEW key) | coding | config | — | none (net-new key) | no-analog |

---

## Pattern Assignments

### `proxy-bridge/server.mjs` — `logContextTurn()` + 2 call sites (write-hook, event-driven append)

**Analog:** the two existing `logTokenCall` sites, cloned best-effort. New `logContextTurn(dir, line)` is called immediately after each `logTokenCall`, reusing the SAME already-resolved `taskId` / `agent` variables in scope (F: never re-resolve, never call `resolveLiveTaskId()` afresh).

**Never-throw wrap to clone** (`server.mjs:2224-2226`, VERIFIED):
```javascript
} catch (err) {
  logErr(`/v1/messages token log failed (non-fatal): ${err?.message || err}`);
}
```

**Call-site A — `/v1/messages` (Anthropic wire), insert after logTokenCall @ 2222** (`server.mjs:2198-2226`, VERIFIED). In scope at this site: `reqJson` (full request body), `model`, `taskId`, `agent`, `proc`, `requestId`, `uIn`/`uOut`, `cacheRead`/`cacheWrite`, `sawUsage`, and `analyzeAnthropicRequest(reqJson)` (already computed for the breakdown snapshot ~2069):
```javascript
if (_tokenDb && isCompletion && sawUsage) {
  const total = uIn + uOut;
  try {
    logTokenCall(_tokenDb, {
      timestamp: new Date().toISOString(),
      provider: 'anthropic',
      model, ...
      cache_read_tokens: cacheRead,   // WIRE-02: surfaced separately from total
      cache_write_tokens: cacheWrite,
      tool_call_id: requestId,        // = transcript requestId → dedups with Route 2
      task_id: taskId,
    });
    // ── NEW (best-effort, sibling try): logContextTurn(...) here ──
  } catch (err) {
    logErr(`/v1/messages token log failed (non-fatal): ${err?.message || err}`);
  }
}
```

**Call-site B — `/api/complete` (OpenAI wire), insert after logTokenCall block @ 2766** (`server.mjs:2674-2767`, VERIFIED). In scope: `body` (=internalBody, carries `messages`/`tools`/`agent`/`task_id`/`tool_call_id`), `result` (`.content`, `.tokens` with `cache_read_tokens`/`cache_write_tokens`), `providerName`, `latencyMs`. `task_id` here is the already-resolved precedence expression (`body.task_id || (isBackgroundProcess ? '' : resolveLiveTaskId())`) — REUSE the resolved value, do not recompute. `oaBody`/`analyzeOpenAIRequest` are only in scope in the shim block (~2344); stash on `req._ctxSnapshot` there or recompute from `body`:
```javascript
if (_tokenDb) {
  const tokensEstimated = (result.tokens?.total ?? 0) === 0 ? 1 : 0;
  logTokenCall(_tokenDb, {
    ...
    cache_read_tokens: result.tokens?.cache_read_tokens ?? 0,
    cache_write_tokens: result.tokens?.cache_write_tokens ?? 0,   // ALWAYS 0 on OpenAI wire → 'N/A' at UI (D-12)
    task_id: typeof body.task_id === 'string' && body.task_id
      ? body.task_id
      : (isBackgroundProcess(procName) ? '' : resolveLiveTaskId()),
  });
  // ── NEW: logContextTurn(...) wrapped in its OWN try/catch → logErr ──
}
```

**Illustrative line shape** (field names are Claude's Discretion per D-03; carry a `wire: 'anthropic'|'openai'` discriminator so the explainer can branch N/A per D-12):
```javascript
function logContextTurn(dir, line) {
  try {
    fs.mkdir(dir, { recursive: true }, () => {
      fs.appendFile(path.join(dir, 'context-turns.jsonl'), JSON.stringify(line) + '\n', () => {});
    });
  } catch (err) { logErr(`context-turn write failed (non-fatal): ${err?.message || err}`); }
}
// line: { ts, task_id, agent, wire, request_id, model,
//   usage:{ input, output, cache_read, cache_write },   // D-09: never folded into a total
//   cache_breakpoints:[msgIdx…], categories: <analyze*().categories>,  // D-08 reuse
//   messages:[{ i, role, bytes, tool?:{name,size}, preview:shortPreview(m,120) }],  // D-07 fallback
//   observation_ref: null }   // enriched at span close, NEVER in the hot path (Pitfall 1)
```

---

### `proxy-bridge/server.mjs` — path helper (utility, file-path)

**Analog:** `perRunBreakdownPath` + `safeSanitizeTaskId` (`server.mjs:1591-1612`, VERIFIED). Clone the per-task path build; reuse `safeSanitizeTaskId` (returns `''` on empty/throw — never crashes the async handler):
```javascript
const perRunBreakdownPath = (taskId) =>
  path.join(CTX_BREAKDOWN_DIR, 'context-breakdown', `${sanitizeTaskId(taskId)}.json`);
function safeSanitizeTaskId(rawId) {
  if (!rawId) return '';
  try { return sanitizeTaskId(rawId); }
  catch { return ''; }
}
```
Context-turns dir = `.data/measurements/<safeSanitizeTaskId(task_id)>/` (D-04 — co-located with reconciliation.json, NOT under `llm-proxy/`). Note `CTX_BREAKDOWN_DIR` uses `CODING_ROOT` (@ 1591-1594) — resolve the measurements dir under the same `CODING_ROOT`, since the proxy is a different repo writing into coding's `.data/`.

---

### `proxy-bridge/server.mjs` — `GET /api/context-turns` (route, request-response read)

**Analog:** `GET /api/context-breakdown` (`server.mjs:1880-1892`, VERIFIED). Same `?task_id=` param + per-run path + try/catch → 200 verbatim / 404 on miss. Difference: gunzip the `.gz` (D-03) and return the per-turn array:
```javascript
if (req.method === 'GET' && (req.url === '/api/context-breakdown' || req.url?.startsWith('/api/context-breakdown?'))) {
  try {
    const u = new URL(req.url, 'http://localhost');
    const tid = u.searchParams.get('task_id');
    const file = tid ? perRunBreakdownPath(tid) : CTX_BREAKDOWN_PATH;
    const txt = fs.readFileSync(file, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(txt);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'no context breakdown captured for this run yet', detail: err.message }));
  }
}
```
For `/api/context-turns`: read `context-turns.jsonl.gz` (or plaintext `.jsonl` if span not yet closed), `zlib.gunzipSync`, split into lines → `JSON.parse` each → return array. Best-effort; ENOENT → graceful.

---

### `scripts/measurement-stop.mjs` — gzip-at-close + observation enrichment (span-close, batch)

**Analog:** the reconciliation.json write block (`measurement-stop.mjs:441-483`, VERIFIED). Slot the new steps beside it, reusing the SAME `sanitizeTaskId(span.task_id)` + `path.join(REPO_ROOT, '.data', 'measurements', id)` build and the SAME best-effort try/catch → stderr:
```javascript
const reconcileDirId = sanitizeTaskId(span.task_id);
const reconcileDir = path.join(REPO_ROOT, '.data', 'measurements', reconcileDirId);
fs.mkdirSync(reconcileDir, { recursive: true });
fs.writeFileSync(
  path.join(reconcileDir, 'reconciliation.json'),
  JSON.stringify(reconciliation, null, 2),
);
// ── NEW beside this (own try/catch → process.stderr.write): ──
//   1. correlate each turn → nearest observation (span window + agent) — see Shared Pattern below
//   2. gzip context-turns.jsonl → context-turns.jsonl.gz; fs.unlink plaintext  (D-03)
//   3. gzip raw-bodies.jsonl → .gz when present
```
Never-throw wrap to clone (`measurement-stop.mjs:478-481`, VERIFIED):
```javascript
} catch (err) {
  process.stderr.write(
    `[measurement-stop] reconciliation sink failed (non-fatal): ${err.message}\n`,
  );
}
```
Span window for correlation: `span.started_at`..`span.ended_at`. Scope to `span.task_id` — `resolveLiveTaskId()` is GONE at close (MEMORY `reference_claude_proxy_capture_routes`). gzip via `node:zlib` (`zlib.gzipSync`), the same lib `lsl-file-manager.js` imports (`const zlib = require('zlib')` @ 12).

---

### `scripts/enhanced-redaction-system.js` — config-loader rewire (utility/security, transform)

**Analog:** self — extend `redact()` (`enhanced-redaction-system.js:21-64`, VERIFIED) additively. The rewire MUST preserve the exact return shape `{ content, redactionCount, securityLevel }` and the fail-closed catch, or it breaks the LSL caller.

**Return-shape contract to preserve** (lines 48-63):
```javascript
return {
  content: redactedContent,
  redactionCount,
  securityLevel: redactionCount > 0 ? 'HIGH' : 'CLEAN'
};
// ...on error (fail-closed on CONTENT, never the daemon):
return {
  content: '[REDACTION_ERROR_CONTENT_BLOCKED]',
  redactionCount: 1,
  error: error.message,
  securityLevel: 'MAXIMUM'
};
```
**Rewire:** load `.specstory/config/redaction-patterns.json` (27 patterns), compile once, apply in order (RESEARCH-verified core):
```javascript
function loadRedactionPatterns(configPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (cfg.enabled === false) return [];
  return cfg.patterns.filter(p => p.enabled).map(p => {
    try { return { id: p.id, re: new RegExp(p.pattern, p.flags), replacement: p.replacement }; }
    catch (e) { process.stderr.write(`[redaction] bad pattern ${p.id}: ${e.message}\n`); return null; }
  }).filter(Boolean);
}
// redact(content): compiled.forEach(({re, replacement}) => content = content.replace(re, replacement));
```
Pattern object fields (VERIFIED): `id`, `name`, `pattern` (string regex), `flags`, `replacementType`, `replacement` (supports `$1` capture refs), `enabled`, `severity`. Compile-guard each pattern (a bad regex must skip + stderr, never crash). Keep the 4 hardcoded PII regexes as an appended safety net (strictly additive → zero LSL regression risk). Export `loadRedactionPatterns` so the proxy-side applier consumes the identical config.

⚠ CLAUDE.md `no-console-log`: the CLI-test block (lines 55, 95-102) uses `console.error`/`console.log`. Leave it untouched (safest); if you must touch those lines, use `process.stderr.write` — do NOT dodge the constraint.

⚠ Constraint-monitor note: `EnhancedRedactionSystem` (line 8) is an EXISTING API class name, NOT evolutionary naming. Do not rename it. In new docs, refer to it as "the redaction applier module" to avoid a `no-evolutionary-names` false-positive on `class <Name>` adjacency.

---

### `scripts/lsl-file-manager.js` — caller (contract only, DO NOT modify behavior)

**Analog / contract:** the caller (`lsl-file-manager.js:125-155`, VERIFIED) constructs `new EnhancedRedactionSystem(...)` (@ 31) and consumes `result.content` / `result.redactionCount` / `result.securityLevel` (and optionally `result.redactionLog` @ 133, currently never produced). The rewire above must keep every one of these fields present:
```javascript
const result = this.enhancedRedaction.redact(value, { includeLog: this.debug });
this.stats.redactionApplied += result.redactionCount;
this.stats.securityEvents += result.securityLevel === 'MAXIMUM' ? 1 : 0;
return result.content;
```

---

### launchd sweeper trio — retention (D-01)

Clone all three verbatim, s/lsl-lock-sweeper/context-turns-sweeper/, and change cadence + the sweep target.

**`launchd/com.coding.context-turns-sweeper.plist`** — Analog `com.coding.lsl-lock-sweeper.plist` (VERIFIED). Change `Label`, `ProgramArguments[1]`, log paths, and **StartInterval → 3600** (hourly is ample for a 14-day age policy; drop the 30s `ThrottleInterval` — no lock-race):
```xml
<key>Label</key><string>com.coding.lsl-lock-sweeper</string>
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>/Users/Q284340/Agentic/coding/scripts/lsl-lock-sweeper-job.sh</string>
</array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
<key>StandardErrorPath</key><string>/Users/Q284340/Agentic/coding/.data/lsl-lock-sweeper.log</string>
<key>StandardOutPath</key><string>/Users/Q284340/Agentic/coding/.data/lsl-lock-sweeper.log</string>
<key>EnvironmentVariables</key>
<dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin</string></dict>
```

**`scripts/context-turns-sweeper-job.sh`** — Analog `lsl-lock-sweeper-job.sh` (VERIFIED). Reuse the portable `file_mtime` BSD/GNU dual-form helper and the age-gate loop verbatim; walk `.data/measurements/*/context-turns.jsonl(.gz)` + `raw-bodies.jsonl.gz`, delete files older than `CONTEXT_TURNS_RETENTION_DAYS` (default 14, per-file mtime → Open-Q #3). Best-effort, never-throw (`set -uo pipefail`, `exit 0`):
```bash
# Portable mtime — clone verbatim (BSD/GNU dual-form, numeric-only accept):
file_mtime() {
  local m
  m="$(stat -c %Y "$1" 2>/dev/null)"        # GNU / coreutils
  if [[ "${m}" =~ ^[0-9]+$ ]]; then echo "${m}"; return; fi
  m="$(stat -f %m "$1" 2>/dev/null)"        # BSD
  if [[ "${m}" =~ ^[0-9]+$ ]]; then echo "${m}"; return; fi
  echo 0
}
NOW="$(date -u +%s)"
# age gate: (( age < STALE_SECS )) → skip; else rm -f + log
```

**`scripts/install-context-turns-sweeper-launchd.sh`** — Analog `install-lsl-lock-sweeper-launchd.sh` (VERIFIED). Clone the plutil-lint → copy-with-backup → bootout → bootstrap → `launchctl list | grep -qF` verify sequence verbatim:
```bash
if ! /usr/bin/plutil -lint "${SRC_PLIST}" >/dev/null; then log "ERROR: ... plutil -lint"; exit 1; fi
# copy (backup on diff) ...
launchctl bootout "gui/${UID_VAL}/${LABEL}" 2>/dev/null || true
if ! launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}"; then log "ERROR: bootstrap failed"; exit 1; fi
if launchctl list | grep -qF "${LABEL}"; then log "OK: ${LABEL} loaded"; else log "FAIL"; exit 1; fi
```
⚠ Pitfall 4: the plan MUST include a task that RUNS this installer — a plist in `launchd/` alone does nothing until `launchctl bootstrap`.

---

### `lib/vkb-server/api-routes.js` — `handleContextTurns` + registration (route, read)

**Analog:** `handleReconciliation` (`api-routes.js:605-633`, VERIFIED) — clone verbatim, swap the filename and gunzip the `.gz`. Reuse the `_validTaskId` traversal guard (@ 608) and `_dataDir()` (@ 771). ENOENT → 200 graceful-empty (NOT 500); 500 only on unexpected error:
```javascript
async handleReconciliation(req, res) {
  try {
    const { taskId } = req.params;
    if (!this._validTaskId(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId', message: 'taskId is required' });
    }
    const filePath = path.join(this._dataDir(), 'measurements', taskId, 'reconciliation.json');
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return res.status(200).json(JSON.parse(raw));   // VERBATIM — no re-shaping (D-13)
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(200).json({ reconciliation: null });  // graceful
      throw e;
    }
  } catch (error) {
    logger.error('Reconciliation read failed', { error: error.message });
    return res.status(500).json({ error: 'Reconciliation read failed', message: error.message });
  }
}
```
For context-turns: read `measurements/<taskId>/context-turns.jsonl.gz`, `zlib.gunzip` → split lines → `JSON.parse` each → `res.status(200).json({ contextTurns: [...] })`; ENOENT → `{ contextTurns: [] }`.

**Registration** — Analog (`api-routes.js:90`, VERIFIED), add parallel to reconciliation:
```javascript
app.get('/api/experiments/runs/:taskId/reconciliation', (req, res) => this.handleReconciliation(req, res));
// NEW:
app.get('/api/experiments/runs/:taskId/context-turns', (req, res) => this.handleContextTurns(req, res));
```

---

### `integrations/system-health-dashboard/server.js` — proxy mirror line (route/proxy)

**Analog:** the `/api/context-breakdown` same-origin proxy (`server.js:294-304`, VERIFIED). Add one mirror line proxying `/api/context-turns` → `:12435` (proxy same-origin surface). The vkb `/api/experiments/runs/:taskId/context-turns` rides the existing experiments reverse-proxy (@ ~320):
```javascript
this.app.get('/api/context-breakdown', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const url = `http://host.docker.internal:12435/api/context-breakdown${qs ? '?' + qs : ''}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'LLM proxy unreachable', details: err.message });
  }
});
```
⚠ Pitfall 5 (VirtioFS): after editing `server.js` you MUST `cd docker && docker-compose restart coding-services` — a supervisor-only restart re-reads the STALE cached file (truncated-file SyntaxError).

---

### `performanceSlice.ts` — `fetchContextTurns` thunk + selector + reducers + state (store, read)

**Analog:** `fetchTimeline` (`performanceSlice.ts:345-360`) + `selectTimelineFor` (@ 881) + extraReducers (@ 708-720) + state field (@ 198, 257), all VERIFIED. Mirror each seam:

**Thunk** (@ 345-360):
```javascript
export const fetchTimeline = createAsyncThunk(
  'performance/fetchTimeline',
  async (taskId: string, { rejectWithValue }) => {
    try {
      const response = await fetch(`/api/experiments/runs/${encodeURIComponent(taskId)}/timeline`)
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const data = await response.json()
      const timeline: TimelineRow[] = (data?.timeline ?? []) as TimelineRow[]
      return { taskId, timeline }
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)
```
→ `fetchContextTurns(taskId)` fetches `/api/experiments/runs/${taskId}/context-turns`, returns `{ taskId, contextTurns }`.

**State field** (@ 198 type, @ 257 init): `timelineByTaskId: Record<string, TimelineRow[]>` / `timelineByTaskId: {}` → add `contextTurnsByTaskId`.

**ExtraReducers** (@ 708-720):
```javascript
.addCase(fetchTimeline.fulfilled, (state, action) => {
  state.timelineByTaskId[action.payload.taskId] = action.payload.timeline
  state.timelineLoading = false
  state.timelineError = null
})
```
→ mirror `contextTurnsByTaskId[action.payload.taskId] = action.payload.contextTurns`.

**Selector** (@ 881):
```javascript
export const selectTimelineFor = (taskId: string | null) => (state: RootState): TimelineRow[] =>
  taskId ? (state.performance.timelineByTaskId[taskId] ?? []) : []
```
→ `selectContextTurnsFor`.

---

### `context-cache-explainer.tsx` — wire data + honest copy (component, D-11/D-12)

**Analog:** self (VERIFIED). Three seams:

1. **Dispatch** — mirror the timeline effect (@ 302-304):
```javascript
useEffect(() => {
  if (taskId && timeline.length === 0) dispatch(fetchTimeline(taskId))
}, [taskId])
```
→ add `dispatch(fetchContextTurns(taskId))` + `const contextTurns = useAppSelector(selectContextTurnsFor(taskId))`.

2. **Honest per-turn numbers** — `summarize()` (@ 117-134) currently flattens `cache_read_tokens`/`cache_write_tokens` off the timeline. Feed real wire values from context-turns; branch cache-write on the line's `wire` discriminator → OpenAI-wire renders `"N/A (provider reports no cache-creation)"`, NOT `0` (D-12):
```javascript
const data: TurnDatum[] = turns.map((t, i) => ({
  turn: `T${i + 1}`,
  read: num(t.cache_read_tokens),
  write: num(t.cache_write_tokens),   // ← branch: OpenAI wire → N/A, not 0
  input: num(t.input_tokens),
  output: num(t.output_tokens),
}))
```

3. **Correct the estimate copy** (@ 520-531) — the current honesty note says "token figures are a ~bytes/4 estimate"; replace with real wire values where context-turns now supplies them, and add the "how prompt caching actually works" copy explaining the Anthropic-wire (has cache-write counter) vs OpenAI-wire (none) asymmetry:
```javascript
Sizes above are <span className="font-medium text-foreground">exact UTF-8 bytes</span> from the real
<span className="font-mono"> /v1/messages</span> buffer (token figures are a ~bytes/4 estimate); ...
```
**No new components** (D-11) — richer per-turn views deferred to Phase 86. Deploy: `npm run build` in the submodule then `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` (bind-mounted; no docker-compose build).

---

## Shared Patterns

### Best-effort never-throw (the load-bearing contract)
**Source:** `server.mjs:2224-2226` (proxy) / `measurement-stop.mjs:478-481` (coding).
**Apply to:** ALL new writes — both proxy write sites, span-close gzip+enrich, the sweeper, the read routes.
```javascript
} catch (err) { logErr(`... (non-fatal): ${err?.message || err}`); }          // proxy
} catch (err) { process.stderr.write(`[...] ... (non-fatal): ${err.message}\n`); } // coding
```
A failure lands on stderr and NEVER blocks request forwarding, span close, or the daemon.

### Per-task file isolation + traversal guard
**Source:** `safeSanitizeTaskId` / `perRunBreakdownPath` (proxy `server.mjs:1599-1612`); `_validTaskId` (vkb `api-routes.js:608`); `sanitizeTaskId(span.task_id)` (coding `measurement-stop.mjs:471`).
**Apply to:** every place a `task_id` becomes a path — proxy write, span close, vkb read. Files stay under `.data/measurements/<sanitized>/`; the read route rejects traversal via `_validTaskId` (`[A-Za-z0-9._-]`, ≤80).

### Observation correlation (D-07) — time-window + agent join, NEVER in the hot path
**Source:** `fetchRunNarrative` (`performanceSlice.ts:362-394`, VERIFIED) — the authoritative production pattern.
**Apply to:** span close (`measurement-stop.mjs`) and/or vkb read time — NOT the proxy. Observations carry NO `task_id`; join by `[from,to]` window + `agent`:
```javascript
const qs = new URLSearchParams({ from, to, limit: '200' })
if (agent) qs.set('agent', agent)
const response = await fetch(`/api/observations?${qs.toString()}`)   // obs-api :12436; createdAt = ISO ts
```
Many turns → ONE nearest-by-`createdAt` observation (coarse reference, not a 1:1 join). Proxy always writes `observation_ref: null` + `preview`; enrich later. Fallback: null ref + preview stands (Pitfall 1). obs-api can be mid-restart → fall back to exported `.data/observation-export/*.json` snapshot.

### Redaction (D-06) — one config, shared compile helper
**Source:** `.specstory/config/redaction-patterns.json` (27 patterns) via the rewired applier `scripts/enhanced-redaction-system.js`.
**Apply to:** raw-body capture at the proxy write site. Do NOT add a second redaction implementation — export `loadRedactionPatterns(configPath)`; the proxy-side applier reads `<CODING_ROOT>/.specstory/config/redaction-patterns.json` at startup (proxy already resolves `CODING_ROOT` — `CTX_BREAKDOWN_DIR` @ server.mjs:1591). Fail-closed on the content, never the daemon.

### gzip via node:zlib
**Source:** `lsl-file-manager.js:12` (`const zlib = require('zlib')`).
**Apply to:** span-close compression (`zlib.gzipSync`) and read-route decompression (`zlib.gunzip`). No new compression code.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/config.json` — retention key (`CONTEXT_TURNS_RETENTION_DAYS` or nested key) | config | — | Net-new config key. D-02 says ".planning/config.json OR an env var"; the bash sweeper reads `CONTEXT_TURNS_RETENTION_DAYS` env (default 14) most simply. No structural analog needed — a single documented key with a shipped default. |

Raw-body **flag** (`capture_raw_bodies`, D-05) is NOT a no-analog item: it rides `span.meta` read via `getActiveMeasurement()`, precedent `meta.record` / `meta.replay_from` (Assumption A1).

---

## Metadata

**Analog search scope:**
- proxy: `_work/rapid-llm-proxy/proxy-bridge/server.mjs`, `src/usage-cache.ts`
- coding: `scripts/{measurement-stop.mjs,enhanced-redaction-system.js,lsl-file-manager.js,lsl-lock-sweeper-job.sh,install-lsl-lock-sweeper-launchd.sh}`, `launchd/com.coding.lsl-lock-sweeper.plist`, `lib/vkb-server/api-routes.js`, `integrations/system-health-dashboard/{server.js,src/store/slices/performanceSlice.ts,src/components/performance/context-cache-explainer.tsx}`

**Files scanned:** 12 analog sources (all read directly this session; every file:line anchor from RESEARCH re-verified).
**Pattern extraction date:** 2026-07-07
