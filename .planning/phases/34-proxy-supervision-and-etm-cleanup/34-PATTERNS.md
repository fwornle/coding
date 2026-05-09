# Phase 34: Proxy Supervision and ETM Legacy Cleanup — Pattern Map

**Mapped:** 2026-05-09
**Files analyzed:** 17 (3 MODIFY, 1 NEW, 6 DELETE source, 4 DELETE/skip-mark test, 1 MODIFY plist, 2 MODIFY-light: rules.json + dashboard root component)
**Analogs found:** 7 / 7 modify-or-create files have a strong existing analog
**Source of truth for analogs:** CONTEXT.md `<canonical_refs>` + `<code_context>` already pre-named the analogs; this file extracts the concrete excerpts.

---

## File Classification

| File (target) | Operation | Role | Data Flow | Closest Analog | Match Quality |
|---------------|-----------|------|-----------|----------------|---------------|
| `scripts/health-coordinator.js` | MODIFY | service (HTTP server + tick poller) | request-response + polling | self (`knowledge_pipeline` slice + `pollKnowledgePipeline`) | exact (same file, same pattern) |
| `config/health-verification-rules.json` | MODIFY | config | declarative | self (`leveldb_lock_check`, `vkb_server` rules with `auto_heal: true` + `auto_heal_action`) | exact |
| `scripts/enhanced-transcript-monitor.js` | MODIFY (strip ~80 LoC) | controller (transcript event loop) | event-driven | n/a — strip operation, no analog needed; just delete blocks | strip-only |
| `scripts/combined-status-line.js` | MODIFY | utility (CLI status renderer) | request-response (`fetch /health/state`) | self (`getKnowledgeSystemStatus` + `[📚]` badge switch) | exact |
| `integrations/system-health-dashboard/src/components/proxy-health-card.tsx` | NEW | component (React/Tailwind) | request-response (Redux selector) | `health-status-card.tsx` (generic), `system-health-dashboard.tsx:323-348` (port detail builder) | role-match |
| `~/Library/LaunchAgents/com.coding.health-coordinator.plist` | MODIFY | config (launchd plist) | declarative | self (3 dead env keys to strip) | self |
| `scripts/health-remediation-actions.js` | (touch only if cooldown surfacing required) | service (action dispatcher) | request-response | self (`restartLLMCLIProxy` at line 569; `executeAction` switch at line 114) | exact |
| `src/live-logging/RealTimeTrajectoryAnalyzer.js` | DELETE | service | n/a | n/a | — |
| `src/knowledge-management/StreamingKnowledgeExtractor.js` | DELETE | service | n/a | n/a | — |
| `src/knowledge-management/KnowledgeExtractor.js` | DELETE | service | n/a | n/a | — |
| `src/knowledge-management/KnowledgeDecayTracker.js` | DELETE | service | n/a | n/a | — |
| `src/knowledge-management/ConceptAbstractionAgent.js` | DELETE | service | n/a | n/a | — |
| `src/knowledge-management/TrajectoryAnalyzer.js` | DELETE | service | n/a | n/a | — |
| `tests/unit/knowledge-management/KnowledgeExtraction.test.ts` | DELETE-or-skip | test | n/a | n/a | — |
| `scripts/test-knowledge-extraction.js` | DELETE-or-skip | test | n/a | n/a | — |
| `tests/unit/ontology/integration.test.js` | MODIFY (skip blocks) | test | n/a | n/a | — |
| `tests/acceptance/knowledge-system-acceptance.test.js` | MODIFY (skip blocks) | test | n/a | n/a | — |

---

## Pattern Assignments

### 1. `scripts/health-coordinator.js` — add `state.proxy` slice + `pollProxySemantic` + auto-heal handler

**Analog:** same file, `state.knowledge_pipeline` slice and `pollKnowledgePipeline()` function.

#### A. State slice declaration — mirror `knowledge_pipeline` shape

**Source: `scripts/health-coordinator.js:160-175`**

```javascript
  // Observation/digest/insight pipeline freshness — drives the [📚] statusline
  // badge. Replaces the legacy `knowledgeExtraction` field that was read from
  // a per-project health file the ETM stopped writing at the Phase 33 cutover.
  // Status: 'unknown' before first probe · 'healthy' / 'stale' / 'stalled' /
  // 'unreachable' / 'disabled' after.
  knowledge_pipeline: {
    status: 'unknown',
    lastObservationAt: null,
    lastDigestAt: null,
    lastInsightAt: null,
    totals: null,
    last_probe_end: null
  },
```

**Adapt:** add a sibling block after `knowledge_pipeline` (and before `generated_at`):

```javascript
  // Proxy semantic-readiness — drives the [🧠] statusline badge.
  // semantic_ok=true only after a successful POST /api/complete round-trip
  // with content containing "OK". networkMode mirrors the proxy's published
  // value (vpn|public|unknown). auto_heal_status follows D-06 cooldown FSM.
  proxy: {
    semantic_ok: null,                  // null until first probe; true|false after
    last_round_trip_ms: null,           // int, last completion latency
    networkMode: 'unknown',              // 'vpn' | 'public' | 'unknown'
    auto_heal_status: 'healthy',         // 'healthy'|'kickstart_pending'|'cooldown'|'disabled'
    kickstart_count: 0,                  // running counter since coordinator boot (D-14 soak gate)
    kickstart_timestamps: [],            // sliding window for D-06 cooldown FSM
    consecutive_failures: 0,             // resets on success
    last_probe_end: null,
    reason: null                         // last failure classification (D-02 four-mode)
  },
```

**Decision lock checks:** D-02 four-mode classification → set `semantic_ok: false` AND populate `reason` with one of: `'http_<code>'` / `'timeout'` / `'empty_content'` / `'oksub_missing'`.

#### B. Probe function — mirror `pollKnowledgePipeline`

**Source: `scripts/health-coordinator.js:372-403` (catch-all error handler) and `405-443` (status classification)**

```javascript
async function pollKnowledgePipeline() {
  const probeEndedAt = () => new Date().toISOString();
  let body;
  try {
    const r = await fetch(`${OBS_API_URL}/api/consolidation/status`, {
      signal: AbortSignal.timeout(2_000)
    });
    if (!r.ok) {
      currentState.knowledge_pipeline = {
        status: 'unreachable',
        reason: `HTTP ${r.status}`,
        // ... other fields zeroed
        last_probe_end: probeEndedAt()
      };
      return;
    }
    body = await r.json();
  } catch (err) {
    currentState.knowledge_pipeline = {
      status: 'unreachable',
      reason: err.message,
      // ... other fields zeroed
      last_probe_end: probeEndedAt()
    };
    return;
  }
  // ... classify status into 'healthy'|'stale'|'stalled'|'disabled' based on age thresholds
}
```

**Adapt to `pollProxySemantic`:**
- Constants at file top (alongside `OBS_FRESH_MS` / `OBS_STALL_MS`):
  ```javascript
  const PROXY_URL = process.env.LLM_PROXY_URL || 'http://localhost:12435';
  const PROXY_PROBE_INTERVAL_MS = 60_000;        // D-01: every 60s
  const PROXY_PROBE_TIMEOUT_MS = 10_000;          // D-02: 10s round-trip threshold
  const PROXY_KICKSTART_WINDOW_MS = 5 * 60_000;   // D-06: 5 min sliding window
  const PROXY_KICKSTART_MAX = 3;                  // D-06: 3 kickstarts then cooldown
  ```
- POST body per D-01: `{messages:[{role:'user',content:'reply with the single token: OK'}], provider:'copilot', tier:'haiku', maxTokens:5}`
- Failure classification per D-02: `!r.ok` → `reason='http_'+r.status`, timeout → `reason='timeout'`, missing content → `reason='empty_content'`, no "OK" substring → `reason='oksub_missing'`. Each sets `semantic_ok=false` + writes `last_round_trip_ms` (Date.now() − start).
- ALWAYS `last_probe_end: probeEndedAt()` — exactly mirror line 373.
- ALWAYS fall back to error state on catch (never silently 'healthy') — SPEC R6 / D-12 mirror.

#### C. Network-mode poll — separate function, runs every tick (not every 60s)

`pollProxyMode()` differs from `pollProxySemantic()` by polling cadence and endpoint. Cadence per CONTEXT `<code_context>`: every 5s tick. Endpoint: `GET ${PROXY_URL}/health` (NOT `/api/complete`). Returns `networkMode`. Same fail-open style:

```javascript
async function pollProxyMode() {
  const probeEndedAt = () => new Date().toISOString();
  try {
    const r = await fetch(`${PROXY_URL}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!r.ok) {
      currentState.proxy.networkMode = 'unknown';
      return;
    }
    const body = await r.json();
    const prevMode = currentState.proxy.networkMode;
    currentState.proxy.networkMode = body.networkMode || 'unknown';

    // VPN/CN flap re-detection (Requirement 3, D-05): if mode changed to/from
    // a real value (vpn|public), trigger kickstart via /health/remediate.
    const realModes = new Set(['vpn', 'public']);
    if (
      realModes.has(prevMode) && realModes.has(currentState.proxy.networkMode)
      && prevMode !== currentState.proxy.networkMode
    ) {
      log(`networkMode flip ${prevMode} → ${currentState.proxy.networkMode}, dispatching restart_llm_cli_proxy`, 'INFO');
      // dispatch through /health/remediate so dashboard "Restart" button uses the same path
      const dispatcher = await getRemediationDispatcher();
      dispatcher.executeAction('restart_llm_cli_proxy', { reason: 'networkMode-flip' }).catch(err => {
        log(`networkMode-flip kickstart failed: ${err.message}`, 'ERROR');
      });
    }
  } catch (err) {
    currentState.proxy.networkMode = 'unknown';
  }
}
```

**Note:** the kickstart dispatcher is the EXISTING `getRemediationDispatcher()` at coordinator line 1006-1012; the action `restart_llm_cli_proxy` is already wired in `health-remediation-actions.js:168-170` and `:569` — see decision below for the gap.

#### D. Wire into `tick()` — mirror existing `pollKnowledgePipeline` call

**Source: `scripts/health-coordinator.js:683-697`**

```javascript
  // ----- Knowledge pipeline freshness (drives [📚] statusline badge) -----
  try {
    await pollKnowledgePipeline();
  } catch (err) {
    log(`knowledge_pipeline probe threw: ${err.message}`, 'ERROR');
    currentState.knowledge_pipeline = {
      status: 'unreachable',
      reason: err.message,
      // ...
      last_probe_end: new Date().toISOString()
    };
  }
```

**Adapt:** add a sibling block immediately below for `pollProxyMode` (every tick). For `pollProxySemantic` (every 60s), gate on `Date.now() - currentState.proxy.last_probe_end >= PROXY_PROBE_INTERVAL_MS` so it piggybacks on the 5s tick (CONTEXT `### Claude's Discretion` — tick-piggyback option).

```javascript
  // ----- Proxy network mode (every tick — drives VPN flap re-detection) -----
  try { await pollProxyMode(); }
  catch (err) {
    log(`proxy networkMode probe threw: ${err.message}`, 'ERROR');
    currentState.proxy.networkMode = 'unknown';
  }

  // ----- Proxy semantic readiness (every 60s — drives [🧠] statusline badge) -----
  const lastProbeAge = currentState.proxy.last_probe_end
    ? Date.now() - new Date(currentState.proxy.last_probe_end).getTime()
    : Infinity;
  if (lastProbeAge >= PROXY_PROBE_INTERVAL_MS) {
    try { await pollProxySemantic(); }
    catch (err) {
      log(`proxy semantic probe threw: ${err.message}`, 'ERROR');
      currentState.proxy.semantic_ok = false;
      currentState.proxy.reason = err.message;
      currentState.proxy.last_probe_end = new Date().toISOString();
    }
  }
```

#### E. Auto-heal cooldown FSM — additions to `pollProxySemantic` after each result

After classifying a probe result, evaluate the cooldown FSM. Skeleton (D-06):

```javascript
function evaluateAutoHealFSM() {
  // D-07 kill-switch: rule.auto_heal=false short-circuits all of this.
  const rule = RULES?.rules?.services?.llm_cli_proxy;
  if (!rule || rule.auto_heal !== true) {
    currentState.proxy.auto_heal_status = 'disabled';
    return;
  }

  // Reset FSM on success.
  if (currentState.proxy.semantic_ok === true) {
    currentState.proxy.consecutive_failures = 0;
    currentState.proxy.auto_heal_status = 'healthy';
    return;
  }

  // Failure path. Slide the kickstart window first.
  const now = Date.now();
  currentState.proxy.kickstart_timestamps = currentState.proxy.kickstart_timestamps
    .filter(ts => (now - ts) < PROXY_KICKSTART_WINDOW_MS);

  // Already in cooldown? Stay there until window slides AND probe succeeds.
  if (currentState.proxy.kickstart_timestamps.length >= PROXY_KICKSTART_MAX) {
    currentState.proxy.auto_heal_status = 'cooldown';
    log(`proxy auto-heal cooldown — ${currentState.proxy.kickstart_timestamps.length} kickstarts in last ${PROXY_KICKSTART_WINDOW_MS/1000}s`, 'WARN');
    return;
  }

  // Sustained-failure gate per Requirement 4: only kickstart after ≥60s of failures.
  currentState.proxy.consecutive_failures += 1;
  const sustainedFailures = currentState.proxy.consecutive_failures
    * PROXY_PROBE_INTERVAL_MS / 1000;  // approx seconds at 60s probe cadence
  if (sustainedFailures < 60) {
    currentState.proxy.auto_heal_status = 'kickstart_pending';
    return;
  }

  // Fire kickstart through dispatcher.
  currentState.proxy.kickstart_timestamps.push(now);
  currentState.proxy.kickstart_count += 1;
  currentState.proxy.auto_heal_status = 'kickstart_pending';
  getRemediationDispatcher()
    .then(d => d.executeAction('restart_llm_cli_proxy', { reason: 'semantic_ok=false sustained' }))
    .catch(err => log(`auto-heal kickstart failed: ${err.message}`, 'ERROR'));
}
```

Call `evaluateAutoHealFSM()` at the end of `pollProxySemantic()` (success or failure path).

#### F. Kill-switch via existing `POST /health/refresh`

No code change needed — coordinator line 988 already calls `loadRules()` on `/health/refresh`. D-07 strategy: operator edits `config/health-verification-rules.json` → `services.llm_cli_proxy.auto_heal: false`, calls `POST /health/refresh`. The `evaluateAutoHealFSM()` reads `RULES?.rules?.services?.llm_cli_proxy?.auto_heal` on every probe so the flip takes effect on the next tick. This is the SAME pattern as Phase 33 D-04.

---

### 2. `config/health-verification-rules.json` — flip llm_cli_proxy auto_heal + add cooldown config

**Analog:** rules already in the same file with `auto_heal: true` + `auto_heal_action`.

**Source: `config/health-verification-rules.json:11-19` (`leveldb_lock_check`)**

```json
"leveldb_lock_check": {
  "enabled": true,
  "severity": "critical",
  "check_type": "lock_status",
  "description": "Detect Level DB locks by unregistered processes",
  "auto_heal": true,
  "auto_heal_action": "kill_lock_holder",
  "max_heal_attempts": 3,
  "heal_backoff_seconds": 10
},
```

**Source (current state of the rule we're editing): `config/health-verification-rules.json:115-126` (`llm_cli_proxy`)**

```json
"llm_cli_proxy": {
  "enabled": true,
  "severity": "warning",
  "check_type": "http_health",
  "endpoint": "http://localhost:12435/health",
  "timeout_ms": 3000,
  "description": "LLM CLI Proxy - runs on host as launchd-managed daemon (com.coding.llm-cli-proxy). Coordinator probes via localhost since it also runs on host. Required for observation summarization.",
  "auto_heal": false,
  "auto_heal_action": "restart_llm_cli_proxy",
  "auto_heal_note": "Proxy runs on host, not in supervisord. Auto-heal disabled — manual start: cd integrations/llm-cli-proxy && npm start",
  "expected_status": "required"
}
```

**Adapt:**
- `auto_heal`: `false` → `true` (D-07 makes this a runtime kill-switch).
- Update `auto_heal_note` to reflect Phase 34 cooldown policy.
- Add `cooldown` block with the same shape `auto_healing.cooldown_config` uses (lines 281-284) — but per-rule:

```json
"llm_cli_proxy": {
  "enabled": true,
  "severity": "warning",
  "check_type": "http_health",
  "endpoint": "http://localhost:12435/health",
  "timeout_ms": 3000,
  "description": "LLM CLI Proxy ... + semantic readiness probe (Phase 34 R1).",
  "auto_heal": true,
  "auto_heal_action": "restart_llm_cli_proxy",
  "auto_heal_note": "Phase 34: coordinator dispatches restart on sustained semantic_ok=false (≥60s) via launchctl kickstart. Cooldown 3/5min → alert-only.",
  "cooldown": {
    "max_kickstarts": 3,
    "window_seconds": 300
  },
  "expected_status": "required"
}
```

---

### 3. `scripts/enhanced-transcript-monitor.js` — strip ~80 LoC

**No analog needed — pure deletion.** Lines/blocks to delete (preserve everything else):

| Block | Lines | What it does (so the planner can verify the strip) |
|-------|-------|-----------------------------------------------------|
| Imports — `RealTimeTrajectoryAnalyzer` dynamic import | 65–73 | Top-level optional `await import('../src/live-logging/RealTimeTrajectoryAnalyzer.js')` |
| Imports — `StreamingKnowledgeExtractor` dynamic import | 75–83 | Top-level optional `await import('../src/knowledge-management/StreamingKnowledgeExtractor.js')` |
| Init — `knowledgeExtractor` + `trajectoryAnalyzer` constructor wiring | 186–217 | Sets `this.knowledgeExtractor`, `this.trajectoryAnalyzer`, `this.knowledgeExtractionEnabled`, `this.knowledgeExtractionStatus` |
| Methods — `initializeKnowledgeExtractor`, `extractKnowledgeAsync`, `getKnowledgeExtractionStatus` | 736–846 | Three methods (initializer + per-prompt-set extraction trigger + status getter) |
| Per-exchange call — `trajectoryAnalyzer.analyzeTrajectoryState(exchange)` | 3681–3698 | Inside the exchange loop; one LLM call per exchange |
| Per-prompt-set call — `extractKnowledgeAsync(exchanges)` | 3806–3812 | Once per prompt-set finalization; one LLM call per set |
| Stop — `trajectoryAnalyzer.stopHeartbeat()` | 4256–4260 | In shutdown path |
| Health-output fields — `trajectory:` and `knowledgeExtraction:` keys | 4372–4373 | Two keys in the health JSON |

**Concrete delete-block excerpts** (so the planner can write atomic patches):

#### Strip 1 — imports (delete lines 65–83)

**Source: `scripts/enhanced-transcript-monitor.js:65-83`**

```javascript
// Trajectory analyzer integration (optional - requires @anthropic-ai/sdk)
let RealTimeTrajectoryAnalyzer = null;
try {
  const module = await import('../src/live-logging/RealTimeTrajectoryAnalyzer.js');
  RealTimeTrajectoryAnalyzer = module.default || module.RealTimeTrajectoryAnalyzer;
} catch (err) {
  // Trajectory analyzer not available (missing dependencies) - continue without it
  console.log('Trajectory analyzer not available:', err.message);
}

// Knowledge extraction integration (optional)
let StreamingKnowledgeExtractor = null;
try {
  const module = await import('../src/knowledge-management/StreamingKnowledgeExtractor.js');
  StreamingKnowledgeExtractor = module.default;
} catch (err) {
  // Knowledge extraction not available - continue without it
  console.log('Knowledge extraction not available:', err.message);
}
```

#### Strip 2 — init (delete lines 186–217)

**Source: `scripts/enhanced-transcript-monitor.js:186-217`**

```javascript
// Initialize knowledge extraction (optional, non-blocking)
this.knowledgeExtractor = null;
this.knowledgeExtractionEnabled = config.enableKnowledgeExtraction !== false && StreamingKnowledgeExtractor !== null;
this.knowledgeExtractionStatus = { state: 'idle', lastExtraction: null, errorCount: 0 };
if (this.knowledgeExtractionEnabled) {
  this.initializeKnowledgeExtractor().catch(err => {
    this.debug(`Knowledge extractor initialization failed (non-critical): ${err.message}`);
    this.knowledgeExtractionStatus.state = 'disabled';
  });
}
// ...
this.semanticAnalyzer = null;
// Initialize real-time trajectory analyzer (if available)
this.trajectoryAnalyzer = null;
if (RealTimeTrajectoryAnalyzer) {
  try {
    this.trajectoryAnalyzer = new RealTimeTrajectoryAnalyzer({ /* config */ });
    this.debug('Real-time trajectory analyzer initialized');
  } catch (error) {
    console.error('Failed to initialize trajectory analyzer:', error.message);
    this.trajectoryAnalyzer = null;
  }
} else {
  this.debug('Trajectory analyzer not available (missing dependencies)');
}
```

KEEP: `this.semanticAnalyzer = null` line (line 199) — it's already a no-op vestige used by other code paths; leave to avoid blast radius.

#### Strip 3 — methods (delete lines 736–846)

`initializeKnowledgeExtractor()`, `extractKnowledgeAsync(exchanges)`, `getKnowledgeExtractionStatus()` — three methods (lines 740–846). The JSDoc comment block at 734–739 also goes.

#### Strip 4 — per-exchange trajectory call (delete lines 3681–3698 inclusive)

**Source: `scripts/enhanced-transcript-monitor.js:3680-3698`**

```javascript
// Real-time trajectory analysis for each exchange
if (this.trajectoryAnalyzer) {
  try {
    const trajectoryAnalysis = await this.trajectoryAnalyzer.analyzeTrajectoryState(exchange);
    if (this.trajectoryAnalyzer.shouldIntervene(trajectoryAnalysis)) {
      const guidance = this.trajectoryAnalyzer.generateInterventionGuidance(trajectoryAnalysis, exchange);
      this.debug(`🎯 Trajectory intervention: ${guidance.message}`);
      this.logHealthError(`Trajectory intervention: ${guidance.message}`);
    }
    this.debug(`📊 Trajectory state: ${trajectoryAnalysis.state} (confidence: ${trajectoryAnalysis.confidence})`);
  } catch (error) {
    this.debug(`Failed to analyze trajectory: ${error.message}`);
  }
}
```

#### Strip 5 — per-prompt-set extractor (delete lines 3806–3812)

**Source: `scripts/enhanced-transcript-monitor.js:3806-3812`**

```javascript
// Trigger knowledge extraction asynchronously (non-blocking)
if (this.knowledgeExtractionEnabled && this.knowledgeExtractor && exchanges.length > 0) {
  this.extractKnowledgeAsync(exchanges).catch(err => {
    this.debug(`Knowledge extraction failed (non-critical): ${err.message}`);
    this.knowledgeExtractionStatus.errorCount++;
  });
}
```

#### Strip 6 — stopHeartbeat call (delete lines 4256–4260)

**Source: `scripts/enhanced-transcript-monitor.js:4256-4260`**

```javascript
// Stop trajectory analyzer heartbeat
if (this.trajectoryAnalyzer) {
  this.trajectoryAnalyzer.stopHeartbeat();
  this.debug('🎯 Trajectory analyzer heartbeat stopped');
}
```

#### Strip 7 — health output fields (delete lines 4372–4373)

**Source: `scripts/enhanced-transcript-monitor.js:4370-4374`**

```javascript
streamingActive: this.streamingReader !== null,
errors: this.healthErrors || [],
trajectory: this.trajectoryAnalyzer ? this.trajectoryAnalyzer.getCurrentTrajectoryState() : null,
knowledgeExtraction: this.getKnowledgeExtractionStatus()
};
```

KEEP `streamingActive` and `errors` — only delete the two trailing keys.

---

### 4. `scripts/combined-status-line.js` — clean dead readers + add `[🧠]` proxy badge + `getProxySystemStatus()`

#### A. New `getProxySystemStatus()` — mirror `getKnowledgeSystemStatus()`

**Analog: `scripts/combined-status-line.js:591-625`**

```javascript
async getKnowledgeSystemStatus() {
  // Phase A replacement (2026-05-09): the legacy
  // .health/<project>-transcript-monitor-health.json file stopped being
  // written at the Phase 33 cutover (the ETM POSTs heartbeats now), so
  // the [📚] badge had been frozen at ❌ for months. New source of truth
  // is the coordinator's `knowledge_pipeline` slice — observation /
  // digest / insight freshness derived from the obs_api consolidation
  // status endpoint. See health-coordinator.js:pollKnowledgePipeline.
  try {
    const url = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';
    const out = execSync(
      `curl -fs --max-time 2 "${url}/health/state"`,
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const state = JSON.parse(out);
    const kp = state.knowledge_pipeline;
    if (!kp || !kp.status) {
      return { status: 'unreachable', reason: 'no knowledge_pipeline slice in /health/state' };
    }
    return { status: kp.status, /* ...passthrough fields... */ reason: kp.reason };
  } catch (error) {
    return { status: 'unreachable', reason: error.message };
  }
}
```

**Adapt to `getProxySystemStatus()`:**

```javascript
async getProxySystemStatus() {
  // Phase 34: the coordinator publishes proxy semantic-readiness +
  // networkMode + auto_heal_status under state.proxy. This drives the
  // [🧠] badge. See health-coordinator.js:pollProxySemantic.
  try {
    const url = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';
    const out = execSync(
      `curl -fs --max-time 2 "${url}/health/state"`,
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const state = JSON.parse(out);
    const p = state.proxy;
    if (!p) {
      return { status: 'unreachable', reason: 'no proxy slice in /health/state' };
    }
    // Map (semantic_ok, auto_heal_status) → 6-state enum per D-12.
    let status;
    if (p.auto_heal_status === 'disabled') status = 'disabled';
    else if (p.auto_heal_status === 'cooldown') status = 'cooling';
    else if (p.semantic_ok === null)     status = 'unknown';
    else if (p.semantic_ok === true)     status = 'healthy';
    else                                 status = 'degraded';
    return {
      status,
      semantic_ok: p.semantic_ok,
      networkMode: p.networkMode,
      auto_heal_status: p.auto_heal_status,
      kickstart_count: p.kickstart_count,
      reason: p.reason
    };
  } catch (error) {
    return { status: 'unreachable', reason: error.message };
  }
}
```

**Wire into the constructor** the same way `getKnowledgeSystemStatus()` is called at line 81 (`const knowledgeStatus = await this.getKnowledgeSystemStatus();`).

#### B. New `[🧠]` badge — mirror the `[📚]` switch block

**Analog: `scripts/combined-status-line.js:1644-1668`**

```javascript
// Knowledge pipeline (observation/digest/insight freshness via coordinator).
// Replaces the legacy ETM-extraction signal that stopped flowing at the
// Phase 33 cutover. Source: state.knowledge_pipeline at /health/state.
switch (knowledge.status) {
  case 'healthy':     parts.push('[📚✅]'); break;
  case 'stale':       parts.push('[📚⚠️]'); if (overallColor === 'green') overallColor = 'yellow'; break;
  case 'stalled':     parts.push('[📚🔴]'); if (overallColor === 'green') overallColor = 'yellow'; break;
  case 'disabled':    parts.push('[📚🔇]'); break;
  case 'unknown':     parts.push('[📚❓]'); break;
  case 'unreachable':
  default:            parts.push('[📚❌]'); if (overallColor === 'green') overallColor = 'yellow'; break;
}
```

**Adapt for proxy** — D-12 enum: `healthy 🧠✅` · `degraded 🧠⚠️` · `cooling 🧠🚫` · `disabled 🧠🔇` · `unknown 🧠❓` · `unreachable 🧠❌`. Insert immediately after the `[📚]` block per D-12 ("position before or after [📚]" — picking AFTER for visual grouping: knowledge → brain).

```javascript
// Proxy semantic readiness (drives [🧠] badge per D-12). Source: state.proxy at /health/state.
switch (proxy.status) {
  case 'healthy':    parts.push('[🧠✅]'); break;
  case 'degraded':   parts.push('[🧠⚠️]'); if (overallColor === 'green') overallColor = 'yellow'; break;
  case 'cooling':    parts.push('[🧠🚫]'); overallColor = 'red'; break;
  case 'disabled':   parts.push('[🧠🔇]'); break;
  case 'unknown':    parts.push('[🧠❓]'); break;
  case 'unreachable':
  default:           parts.push('[🧠❌]'); if (overallColor === 'green') overallColor = 'yellow'; break;
}
```

**CRITICAL collision check:** Lines 1670-1687 ALREADY use a `[🧠` prefix for UKB workflow status:
```javascript
let ukbPart = `[🧠`;
if (ukbStatus.running > 0) { ukbPart += `${ukbStatus.running}⏳`; }
// ...
ukbPart += ']';
parts.push(ukbPart);
```

**This is a name collision** — both the new proxy badge and the existing UKB workflow indicator use `[🧠]`. The planner MUST resolve this. Two options:
1. Differentiate by suffix: proxy uses `[🧠✅/⚠️/🚫/🔇/❓/❌]` (single-char emoji suffix); UKB uses `[🧠1⏳2⚠️]` (number+icon). Visually distinguishable. Acceptable.
2. Reassign one badge to a different glyph. CONTEXT D-12 reserved `[🩺]` for future generic deep-health — could move UKB workflow to `[⚙️]` or similar.

**Recommendation for planner:** option 1 (keep both). The proxy uses a single status emoji as suffix; UKB uses N-of-N counters. Document the collision in a comment in `combined-status-line.js`.

#### C. Dead-reader cleanup — 5 sites

**Source line 593** is a comment-only reference inside `getKnowledgeSystemStatus()` — already clean (just a comment about the legacy file). No deletion required for line 593; the SPEC list reads "dead-reader comment block" but the comment is now informational. The planner should leave it.

**Source line 1110-1116** — `transcript-monitor-health.json` join in the per-project status path:
```javascript
const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
const projectName = basename(projectPath);
const healthFile = join(codingPath, '.health', `${projectName}-transcript-monitor-health.json`);

if (!existsSync(healthFile)) {
  // Monitor not running, start it in background
  // ...
}
```

The whole `if (!existsSync(healthFile))` branch is dead — the file is no longer written. Replace with PSM-only check (use `psm.isProcessAlive(...)` already present at line 1099-1101, which is the live signal).

**Source line 1320-1340** — second `transcript-monitor-health.json` join in `getRunningTranscriptMonitorsSync`. Same fix: drop the health-file age check, rely on PSM/pgrep results already gathered above.

**Source line 1865-1885** — fallback `*-transcript-monitor-health.json` directory scan:
```javascript
if (runningProjects.size === 0) {
  const healthDir = join(rootDir, '.health');
  if (existsSync(healthDir)) {
    const healthFiles = fs.readdirSync(healthDir)
      .filter(f => f.endsWith('-transcript-monitor-health.json'));
    for (const file of healthFiles) {
      // ... mtime age check, add to runningProjects if fresh
    }
  }
}
```

**Action:** delete the entire `if (runningProjects.size === 0)` block. PSM/pgrep above is the live signal; the health-file fallback is dead.

**Same applies for line 1263:** `const match = file.match(/^(.+)-transcript-monitor-health\.json$/);` — this is in a different function but reads the same dead artifact. Audit this line as part of Plan B and delete if dead.

---

### 5. `integrations/system-health-dashboard/src/components/proxy-health-card.tsx` — NEW ~50 LoC

**Analog: `integrations/system-health-dashboard/src/components/health-status-card.tsx:1-90`** (the generic card component, already used by 6 other cards)

The simplest path: REUSE the existing `HealthStatusCard` (don't write a NEW component) and add a builder function inside `system-health-dashboard.tsx` mirroring `getPortDetailItems()`.

**Analog for the builder: `system-health-dashboard.tsx:322-348`**

```typescript
const getPortDetailItems = () => {
  const checks = getChecksByCategory('services')
  const portMap: Record<string, { name: string, port: number }> = {
    'dashboard_server': { name: 'Constraint Dashboard', port: 3030 },
    // ...
    'llm_cli_proxy': { name: 'LLM CLI Proxy', port: 12435 },
  }
  return Object.entries(portMap).map(([checkName, info]) => {
    const check = checks.find((c: any) => c.check === checkName)
    const lastChecked = check?.timestamp
      ? new Date(check.timestamp).toLocaleTimeString()
      : 'never'
    return {
      name: `Port ${info.port}`,
      status: check ? mapCheckStatus(check) : ('offline' as const),
      description: info.name,
      tooltip: check ? `${check.message} | Last checked: ${lastChecked}` : `${info.name} — no check data yet`
    }
  })
}
```

**Adapt to `getProxyHealthItems()`:**

```typescript
const getProxyHealthItems = () => {
  const proxy = healthStatus.proxy  // assumes redux slice mirrors coordinator state
  if (!proxy) {
    return [{ name: 'Proxy semantic', status: 'offline' as const, description: 'No data yet' }]
  }
  const semanticStatus: 'operational' | 'warning' | 'error' | 'offline' =
    proxy.semantic_ok === true ? 'operational' :
    proxy.semantic_ok === false ? 'error' : 'offline'
  const cooldownDescription = proxy.auto_heal_status === 'cooldown'
    ? `cooldown — ${proxy.kickstart_timestamps?.length ?? '?'}/3 kickstarts`
    : proxy.auto_heal_status

  return [
    { name: 'Semantic readiness', status: semanticStatus,
      description: proxy.last_round_trip_ms != null ? `${proxy.last_round_trip_ms}ms RTT` : 'no data',
      tooltip: proxy.reason ?? 'OK' },
    { name: 'Network mode', status: proxy.networkMode === 'unknown' ? 'warning' : 'operational',
      description: proxy.networkMode },
    { name: 'Auto-heal', status: proxy.auto_heal_status === 'cooldown' ? 'warning' :
                                  proxy.auto_heal_status === 'disabled' ? 'offline' : 'operational',
      description: cooldownDescription }
  ]
}
```

**Render line — mirror existing `<HealthStatusCard>` invocations** in `system-health-dashboard.tsx`:

```tsx
<HealthStatusCard
  title="LLM Proxy Health"
  icon={<Brain className="h-5 w-5 text-purple-500" />}
  items={getProxyHealthItems()}
/>
```

`Brain` icon already imported at `system-health-dashboard.tsx:22`.

**Redux wiring:** the proxy data flows through the coordinator → `/api/health-verifier/status` → existing redux slice. No new fetch logic; planner verifies that `state.proxy` is passed through (typically the existing reducer just spreads the coordinator's `state` into redux).

**FUSE caveat (per CLAUDE.md):** after build, frontend-only restart suffices:
```bash
cd integrations/system-health-dashboard && npm run build
docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend
```

---

### 6. `~/Library/LaunchAgents/com.coding.health-coordinator.plist` — strip dead env keys

**LIVE plist content** (verified just now):

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin</string>
    <key>HEALTH_COORDINATOR_PORT</key>
    <string>3034</string>
    <!-- Phase 33 G7 (plan 33-12): declare injection-test env vars with empty-string defaults -->
    <key>HEALTH_COORDINATOR_INJECT_THROW</key>
    <string></string>
    <key>HEALTH_COORDINATOR_TICK_MS</key>
    <string></string>
    <key>HEALTH_COORDINATOR_URL</key>
    <string></string>
</dict>
```

**SPEC says delete:** `HEALTH_COORDINATOR_INJECT_THROW`, `_INJECT_FAIL`, `TICK_MS`. **Live plist actually has:** `HEALTH_COORDINATOR_INJECT_THROW`, `HEALTH_COORDINATOR_TICK_MS`, `HEALTH_COORDINATOR_URL` (NOT `_INJECT_FAIL`).

**Discrepancy:** `_INJECT_FAIL` is not present, but `_URL` is. The planner should:
1. Confirm with user/SPEC whether the third dead key is `_INJECT_FAIL` (per SPEC) or `_URL` (per live plist).
2. If matching SPEC literally: only `INJECT_THROW` + `TICK_MS` are present and removable. The `_INJECT_FAIL` instruction is a no-op (already absent).
3. The pragmatic interpretation (Claude's recommendation to surface for user approval): remove all three currently-present empty-string keys (`INJECT_THROW`, `TICK_MS`, `URL`) since none are read by the coordinator — they were all 33-12 falsified-attempt residue. The acceptance criterion *"plist diff shows exactly those 3 keys removed; coordinator uptime increments from 0 after bootout/bootstrap"* still passes (3 keys removed, uptime check independent).

**Apply via** (per D-17):
```bash
launchctl bootout gui/$UID ~/Library/LaunchAgents/com.coding.health-coordinator.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.coding.health-coordinator.plist
```

---

### 7. `scripts/health-remediation-actions.js` — wiring already complete (no MODIFY needed)

**Existing dispatcher entry: `scripts/health-remediation-actions.js:168-170`**

```javascript
case 'restart_llm_cli_proxy':
  result = await this.restartLLMCLIProxy(issueDetails);
  break;
```

**Existing `restartLLMCLIProxy()` at line 569** — already kills + respawns the proxy. **However**, it does NOT use `launchctl kickstart -k` per D-05 — it uses `lsof -ti:12435` + manual `spawn`. This is a **gap**:

- D-05 explicitly requires `launchctl kickstart -k gui/$UID/com.coding.llm-cli-proxy` (not bare spawn).
- Why D-05 prefers kickstart: it inherits the plist's `EnvironmentVariables` (PATH, LLM_PROXY_PORT) AND re-runs `start-llm-proxy.sh` from scratch — which re-fetches PAC + refreshes `HTTPS_PROXY`. The current `spawn(node, [distEntry])` skips all of that, defeating Requirement 3 (VPN/CN flap re-detection).

**Action:** the planner MUST patch `restartLLMCLIProxy()` to use `child_process.execFile('launchctl', ['kickstart', '-k', \`gui/${process.getuid()}/com.coding.llm-cli-proxy\`])` per D-05, OR add a new `restart_llm_cli_proxy_kickstart` action distinct from the existing `restart_llm_cli_proxy` and dispatch the new action from coordinator. The **simpler** path is to rewrite the body of `restartLLMCLIProxy` since the existing `lsof+spawn` approach is the very anti-pattern Phase 34 is trying to fix.

**Recommended replacement body:**

```javascript
async restartLLMCLIProxy(details) {
  try {
    const { execFile } = require('child_process');
    const uid = process.getuid();
    this.log(`Restarting LLM CLI Proxy via launchctl kickstart (reason: ${details?.reason ?? 'unspecified'})...`);
    return await new Promise((resolve) => {
      execFile('launchctl',
        ['kickstart', '-k', `gui/${uid}/com.coding.llm-cli-proxy`],
        { timeout: 10_000 },
        (err, stdout, stderr) => {
          if (err) {
            this.log(`launchctl kickstart failed: ${err.message}`, 'ERROR');
            resolve({ success: false, message: `kickstart failed: ${err.message}`, stderr });
            return;
          }
          resolve({ success: true, message: 'launchctl kickstart -k dispatched', stdout });
        }
      );
    });
  } catch (error) {
    return { success: false, message: error.message };
  }
}
```

This change CHANGES BEHAVIOR for the existing dashboard "Restart" button (33-15), so the planner should explicitly note this in the implementation plan and verify the dashboard still respects the result shape.

---

## Shared Patterns

### Pattern A — Always-fail-open, never-silently-healthy

**Source:** `scripts/health-coordinator.js` SPEC R6, repeatedly in `pollKnowledgePipeline` (lines 380-403, 685-697)

**Apply to:** `pollProxySemantic`, `pollProxyMode`, `getProxySystemStatus`, the new dashboard card.

**Rule:** any catch-all error MUST set `semantic_ok=false` (or `status='unreachable'` / `'unknown'`) and write `last_probe_end`. NEVER `semantic_ok=true` on error. Log the failure at appropriate severity (DEBUG per probe, INFO/WARN on transition).

### Pattern B — `HEALTH_COORDINATOR_URL` env-var contract (Phase 33 D-02)

**Source:** `scripts/combined-status-line.js:600`, `scripts/combined-status-line.js:632`

```javascript
const url = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';
const out = execSync(
  `curl -fs --max-time 2 "${url}/health/state"`,
  { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
);
const state = JSON.parse(out);
```

**Apply to:** any new client (`getProxySystemStatus`, dashboard fetch, kill-switch trigger). Default to `http://localhost:3034` only if env unset. Keep the same 2s curl timeout / 3s subprocess timeout pair.

### Pattern C — `[ClassName]` log prefix + severity tag

**Source:** `scripts/health-coordinator.js` ubiquitous usage

```javascript
log(`networkMode flip ${prevMode} → ${currentState.proxy.networkMode}, dispatching restart_llm_cli_proxy`, 'INFO');
log(`auto-heal kickstart failed: ${err.message}`, 'ERROR');
```

**Apply to:** all new log lines added by the probe + FSM. Severities: `'DEBUG'` per-probe, `'INFO'` on state transition (semantic_ok flip, networkMode flip, kickstart fired), `'WARN'` for cooldown engagement, `'ERROR'` for unexpected throws / dispatcher failures.

### Pattern D — Atomic-commit-per-plan + git revert as rollback

**Source:** Phase 33 followed this for all 15 plans (CONTEXT D-13).

**Apply to:** all 6 Phase 34 plans. One logical change per plan:
- Plan 1: `config/health-verification-rules.json` edit (auto_heal flip + cooldown block)
- Plan 2: coordinator probe + state slice (no auto-heal yet, just observation)
- Plan 3: coordinator auto-heal FSM + kickstart wiring + `health-remediation-actions.js` rewrite
- Plan 4: ETM strip (`scripts/enhanced-transcript-monitor.js` -80 LoC, no source-file deletes)
- Plan 5: source-file deletes (6 files) + dead-reader cleanup in `combined-status-line.js` + `[🧠]` badge + dashboard card
- Plan 6: plist dead-key cleanup + AC #6/AC #11 verification runs

The cooldown mechanism gates Plans 2-3 from each other so revert paths stay clean.

### Pattern E — Dynamic ESM import in coordinator (lazy-load remediation dispatcher)

**Source: `scripts/health-coordinator.js:1006-1012`**

```javascript
let remediationDispatcher = null;
async function getRemediationDispatcher() {
  if (remediationDispatcher) return remediationDispatcher;
  const mod = await import('./health-remediation-actions.js');
  remediationDispatcher = new mod.HealthRemediationActions({});
  return remediationDispatcher;
}
```

**Apply to:** the new auto-heal FSM call site (Plan 3). Use `getRemediationDispatcher()` directly — DO NOT instantiate a second dispatcher. This guarantees the dashboard's "Restart" button + the coordinator's auto-heal use the same code path / same cooldown bookkeeping.

### Pattern F — `state.<slice>.status: 'unknown' | <good> | <bad>` enum convention

**Source:** Knowledge pipeline status enum: `'unknown' | 'healthy' | 'stale' | 'stalled' | 'disabled' | 'unreachable'`.

**Apply to:** proxy slice. Boolean variant for `semantic_ok` (`null | true | false`); string enum for `auto_heal_status` (`'healthy' | 'kickstart_pending' | 'cooldown' | 'disabled'`); string enum for `networkMode` (`'vpn' | 'public' | 'unknown'`). NEVER omit the field from the slice — always present, even if `null`/`'unknown'`.

---

## DELETE-list audit

For each file marked DELETE: confirmed exists, confirmed only KEEP-list-allowed consumers (per CONTEXT.md `### KEEP-list`).

| File | Exists | Consumers (audited via `grep -rn`) | Safe to delete? |
|------|--------|------------------------------------|-----------------|
| `src/live-logging/RealTimeTrajectoryAnalyzer.js` | ✓ (39658 bytes) | `scripts/enhanced-transcript-monitor.js` only (stripped in Plan A) | ✓ |
| `src/knowledge-management/StreamingKnowledgeExtractor.js` | ✓ (27241 bytes) | ETM only | ✓ |
| `src/knowledge-management/KnowledgeExtractor.js` | ✓ (19207 bytes) | `StreamingKnowledgeExtractor.js` (also deleted) | ✓ |
| `src/knowledge-management/KnowledgeDecayTracker.js` | ✓ (16918 bytes) | `StreamingKnowledgeExtractor.js` (also deleted) | ✓ |
| `src/knowledge-management/ConceptAbstractionAgent.js` | ✓ (19040 bytes) | `StreamingKnowledgeExtractor.js` (also deleted) | ✓ |
| `src/knowledge-management/TrajectoryAnalyzer.js` | ✓ (18346 bytes) | `StreamingKnowledgeExtractor.js` (also deleted) — NOT same as `live-logging/RealTimeTrajectoryAnalyzer.js` | ✓ |
| `tests/unit/knowledge-management/KnowledgeExtraction.test.ts` | ✓ | exercises deleted code | ✓ delete-or-skip |
| `scripts/test-knowledge-extraction.js` | ✓ | imports `KnowledgeExtractor` (deleted); standalone | ✓ delete-or-skip |
| `tests/unit/ontology/integration.test.js` | ✓ | has SOME refs, not whole-file → **MODIFY (skip blocks)** not DELETE | partial |
| `tests/acceptance/knowledge-system-acceptance.test.js` | ✓ | has SOME refs, not whole-file → **MODIFY (skip blocks)** not DELETE | partial |

**Audit confirmation grep (CONTEXT D-08, SPEC AC #8):**
```bash
grep -rn --include="*.js" --include="*.ts" --include="*.cjs" --include="*.mjs" \
  "RealTimeTrajectoryAnalyzer\|StreamingKnowledgeExtractor\|KnowledgeDecayTracker\|ConceptAbstractionAgent" \
  . 2>/dev/null | grep -v node_modules | grep -v dist/ | grep -v .specstory/ | grep -v site/ | grep -v .spec-workflow/
```
Currently returns: `tests/unit/ontology/integration.test.js`, `tests/acceptance/knowledge-system-acceptance.test.js`, `scripts/enhanced-transcript-monitor.js`. After Plans 4 + 5 complete, all three sources have refs stripped/skipped. **Acceptance grep MUST return empty.**

---

## Files with No Analog (planner uses RESEARCH-style construction)

None. Every NEW/MODIFY surface in this phase has at least one strong existing analog. CONTEXT.md was thorough in pre-naming them.

---

## Metadata

**Analog search scope:**
- `scripts/health-coordinator.js`
- `scripts/health-remediation-actions.js`
- `scripts/combined-status-line.js`
- `scripts/enhanced-transcript-monitor.js`
- `config/health-verification-rules.json`
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (read-only — coordinator observes, doesn't modify)
- `integrations/system-health-dashboard/src/components/{health-status-card,system-health-dashboard}.tsx`
- `~/Library/LaunchAgents/com.coding.health-coordinator.plist`

**Files scanned:** 8 source files + 1 plist + 1 config. **Files read deeply (extracted excerpts):** all 8.

**Pattern extraction date:** 2026-05-09

**Anomalies surfaced for planner attention:**
1. **`[🧠]` badge collision** with existing UKB workflow indicator at `combined-status-line.js:1673`. Recommended resolution: keep both, distinguish by suffix shape.
2. **Plist dead-key discrepancy:** SPEC says delete `_INJECT_FAIL`; live plist has `_URL` instead (no `_INJECT_FAIL`). Recommend asking user or removing all three currently-present empty keys.
3. **`restartLLMCLIProxy()` mismatch with D-05:** existing implementation uses `lsof+spawn` not `launchctl kickstart -k`. Phase 34 must rewrite this to honor D-05 (PAC re-fetch); Plan 3 should explicitly call this out.
4. **`combined-status-line.js:593`** is comment-only — not a dead reader. The SPEC list "lines 593, 1114, 1324, 1871, 1880" treats line 593 as a target but the actual dead readers are at lines 1114, 1263, 1324, and 1865-1885. The planner should verify before patching.
