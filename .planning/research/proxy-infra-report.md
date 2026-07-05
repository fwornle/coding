# LLM Measurement Proxy & Per-Agent Routing Infrastructure Report

## 1. PROXY ENDPOINTS + TAPS

### HTTP Server (proxy-bridge/server.mjs)

The proxy listens on `http://127.0.0.1:{LLM_PROXY_PORT:-12435}` (default 8089 in some tests) and serves these endpoints:

#### Route 1: /v1/messages (Anthropic Passthrough - Line 1913-2095)
- **HTTP Method**: POST
- **Purpose**: Transparent passthrough to api.anthropic.com/v1/messages for Claude Code sessions
- **Agent(s) using**: claude (when ANTHROPIC_BASE_URL set via proxy routing)
- **Wire format**: Verbatim Anthropic v1/messages JSON
- **Tap type**: Real-time streaming tap on the response SSE stream + non-streaming fallback
- **Token Capture**:
  - Captures: input_tokens, output_tokens (from usage block)
  - Records: cache_read_input_tokens, cache_creation_input_tokens (from usage)
  - Stamps: user_hash='cladpt' (FOREGROUND classification), task_id from active span
  - Dedup key: (user_hash, tool_call_id) where tool_call_id = request-id header
  - Process: 'token-adapter-claude' (main) or 'token-adapter-claude-subagent' (for Task sub-agents)
  - Granularity: per-turn (per /v1/messages call)
- **Database**: logs to token_usage (line 2071-2089)
- **Also captures**: Context-breakdown snapshot at line 1943-1967 (per-run analysis of request buffer)

#### Route 2: /v1/chat/completions (OpenAI Shim - Line 2099-2217)
- **HTTP Method**: POST
- **Purpose**: OpenAI-compatible wrapper for opencode/mastra agents
- **Agent(s) using**: opencode (via ANTHROPIC_BASE_URL), mastra (via self-routed config)
- **Wire format**: OpenAI chat/completions JSON → normalized to internal /api/complete envelope
- **Shim behavior**:
  - Normalizes body into /api/complete shape (model, messages, agent, granularity_tier, task_id)
  - Carries X-Agent header precedence (overrides path-derived default)
  - Sets granularity_tier='per-llm-call'
  - Stashes normalized body on req._shimBody + req._shimOpenAI flag
  - Falls through to /api/complete pipeline (single-pipeline design, D-02)
- **Token capture**: Delegated to /api/complete (see below)
- **Context-breakdown**: Captures at line 2155-2180 for opencode/mastra per-run buffers

#### Route 3: /v1/mastra/chat/completions (Mastra-specific Shim - Line 2127)
- **HTTP Method**: POST
- **Purpose**: Mastra self-routed path (distinct from opencode)
- **Agent(s) using**: mastra exclusively
- **Wire format**: Same as /v1/chat/completions OpenAI format
- **Difference**: Path-derived default agent='mastra' (not 'opencode')
- **Token capture**: Same as /v1/chat/completions (delegated to /api/complete)

#### Route 4: /api/complete (Internal Orchestration - Line 2220-2630)
- **HTTP Method**: POST
- **Purpose**: Unified provider-chain orchestration (claude CLI, copilot HTTP, or proxy provider lookup)
- **Agent(s) using**: 
  - claude (direct, unshimmed)
  - opencode, mastra (via /v1/chat/completions shim)
- **Wire format**: Internal envelope {model, messages, agent, provider, subscription, task_id, granularity_tier, ...}
- **Tap types**:
  - Phase 67-06 (REPRO-02): LLM replay/record fixture taps (inert unless span arms them via meta.replay_from/meta.record)
  - Provider dispatch to configured LLM (claude CLI, copilot HTTP, or fallback)
- **Token capture**: Per-request, agent-specific process naming
- **Replay/Record**: When span.meta has replay_from/record, acts as gateway (hard-fail 409 REPLAY_MISS if no match)

#### Read APIs: Token Usage

**GET /api/token-usage/summary** (Line 1765-1791)
- Query params: hours (default 24, 'all' = 10 years), bucketMinutes (optional, auto-scaled)
- Returns: { timeline: [{timestamp, by_process, by_model, total_tokens, ...}], ... }
- Fields returned per bucket: input_tokens, output_tokens, total_tokens, p50_latency_ms, p50_overhead_ms
- Database source: SQLite at .data/llm-proxy/token-usage.db
- Scope: Trailing N hours, bucketed for dashboard rendering

**GET /api/token-usage/recent** (Line 1846-1874)
- Query params: limit (default 50), process (optional filter)
- Returns: { data: [{timestamp, provider, model, process, input_tokens, output_tokens, ...}], ... }
- Database source: Same token_usage.db
- Scope: Most recent N rows (optionally filtered by process)

#### Read APIs: Context Breakdown

**GET /api/context-breakdown** (Line 1801-1813)
- Query params: task_id (optional; if absent, returns latest live session)
- Returns: JSON snapshot of context-window analysis (categories, bytes, cache info)
- File source: 
  - Latest live: .data/llm-proxy/context-breakdown.json (throttled, main-session only)
  - Per-run: .data/llm-proxy/context-breakdown/{sanitized_task_id}.json
- Fields: total_bytes, est_tokens, cacheable_prefix_bytes, fresh_input_bytes, cache_breakpoints, message_count, tool_count, knowledge_text (excerpt), knowledge_occurrences, categories array

#### Admin APIs

**GET /api/llm/settings** (Line 1815-1829)
- Returns: { settings, processes, availableProviders, allProviders }
- Lists distinct processes seen in token_usage, available LLM providers, etc.

**PUT /api/llm/settings** (Line 1832-1843)
- Accepts JSON body with overrides for provider settings
- Persists to disk

**GET /health** (Line 1876-1895)
- Returns: { status, mode, networkMode, build, providers: {<name>: {available, method}} }
- Provider availability: copilot re-checked each call; claude cached from init

---

## 2. PER-AGENT ROUTING TODAY

### Router: configure_proxy_routing() in scripts/launch-agent-common.sh (lines 370-441)

**Claude Code**
- **Status**: Proxy-routed (for interactive session capture only, NOT for cells)
- **Env vars set**: ANTHROPIC_BASE_URL=http://127.0.0.1:{LLM_PROXY_PORT}
- **Credentials**: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN unset (forces Max-OAuth)
- **Token capture**: Via transcript adapter cladpt at measurement-stop (lines 87-92 stop-adapter-registry.mjs)
- **Granularity**: per-turn (one row per /v1/messages call)
- **Cache tokens**: Captured via cladpt (cache_read_input_tokens, cache_creation_input_tokens from transcript)
- **Reason NOT routed in cells**: experiment-runner.mjs line 161-169 deliberately DELETES ANTHROPIC_BASE_URL for claude cells to prevent cache-token miscount (proxy route records cache-EXCLUDED passthrough rows that beat accurate transcript rows via dedup key collision)

**OpenCode**
- **Status**: Proxy-routed (via ANTHROPIC_BASE_URL for anthropic path)
- **Env vars set**: ANTHROPIC_BASE_URL=http://127.0.0.1:{LLM_PROXY_PORT}
- **Credentials**: ANTHROPIC_API_KEY kept (opencode uses own creds)
- **Entry point**: Routes via /v1/messages (anthropic provider in AI-SDK)
- **Token capture**: Via proxy passthrough (Route 1 tap), stamped with agent='opencode'
- **Granularity**: per-llm-call (one row per completion)
- **Cache tokens**: NOT captured (OpenAI endpoint has no cache-token fields; opencode's path is un-cached)
- **Stamp-only adapter**: opencode registered as stamp-only (no build function) in stop-adapter-registry.mjs line 103 (D-04 no-double-count rule)

**Mastra**
- **Status**: Self-routed via /v1/mastra/chat/completions
- **Entry point**: Custom provider seam (MASTRACODE_MODEL_ID=rapid-proxy-mastra)
- **Token capture**: Via proxy passthrough (Route 3 tap), stamped with agent='mastra'
- **Granularity**: per-llm-call
- **Cache tokens**: NOT captured (OpenAI format endpoint)
- **Stamp-only adapter**: mastra registered as stamp-only in stop-adapter-registry.mjs line 104
- **Cell routing**: configureProxyRoutingEnv in experiment-runner.mjs line 157 sets ANTHROPIC_BASE_URL for opencode cells; mastra self-routed (no env change)

**Copilot CLI**
- **Status**: NOT proxy-routed (no base-URL override — GitHub-Enterprise OAuth)
- **Token capture**: Via transcript adapter copadt from ~/.copilot/session-state/{sid}/events.jsonl at measurement-stop (lines 96-101 stop-adapter-registry.mjs)
- **Granularity**: per-turn (one row per copilot.complete call)
- **Cache tokens**: Captured via copadt (copilot's usage block format)
- **Why not routed**: Copilot CLI has no ANTHROPIC_BASE_URL override (uses GitHub-Enterprise OAuth to bmw.ghe); the bypass is permanent, so copadt is the only option
- **Health gate**: launch-agent-common.sh line 435 explicitly logs warning that copilot foreground traffic is unmeasured

### Health Gate Logic

Both scripts check `{base}/health` before routing:
- **launch-agent-common.sh line 400**: curl -sf --max-time 2 check; if unreachable, launches unrouted (fail-soft)
- **experiment-runner.mjs line 150-154**: probe via probeHttpHealth with 2s timeout; if not 'running', returns baseEnv unchanged

---

## 3. TOKEN CAPTURE ADAPTERS

### stop-adapter-registry.mjs (lib/lsl/token/stop-adapter-registry.mjs)

**Registry: STOP_ADAPTERS (lines 86-105)**

| Agent | Mode | User Hash | Build Function | Locate Function | Subagents | File Source |
|-------|------|-----------|-----------------|-----------------|-----------|------------|
| claude | transcript | cladpt | buildClaudeTokenRows | locateMainSessionJsonl | true | ~/.claude/projects/{encoded-cwd}/*.jsonl |
| copilot | transcript | copadt | buildCopilotTokenRows | locateCopilotSessionForSpan | false | ~/.copilot/session-state/{sid}/events.jsonl |
| opencode | stamp-only | — | — | — | — | (no transcript work) |
| mastra | stamp-only | — | — | — | — | (no transcript work) |

**Key Invariant (D-04 no-double-count)**:
- ONLY agents with `mode: 'transcript'` and a `build` function perform transcript work
- Agents with `mode: 'stamp-only'` return immediately (line 337-338) — their tokens are already in proxy token_usage
- Adding a build function to opencode/mastra would DOUBLE-COUNT proxy rows

**Capture at measurement-stop (captureForegroundTokens, lines 330-417)**:

1. **Dispatch** (line 332-339): Check adapter by span.agent or opts.agent
2. **Task ID resolution** (line 348-350): Use span.task_id (primary) → resolveLiveTaskIdSafe() fallback
3. **File locate** (line 356-363): Call adapter.locate(span) by mtime window [started_at - 1min, ended_at + 5min]
4. **Build rows** (line 368): Call adapter.build(jsonlPath) → TokenUsageRow[]
5. **Subagent capture** (line 377-382): If adapter.subagents=true, locate subagent JSONL paths and build them separately, stamping process=SUBAGENT_PROCESS
6. **Window filter** (line 392-394): Keep only rows within span window (same grace: 1min before started_at, 5min after ended_at)
7. **Stamp and insert** (line 398-404): Insert via insertTokenRowDeduped with user_hash=adapter.userHash, task_id from step 2, all in a single DB handle

**Claude Adapter Details (buildClaudeTokenRows, claude-token-rows.mjs lines 82-244)**:

- **Uid-check gate**: st.uid === process.getuid() (line 93-100) — non-owned files yield []
- **Subagent detection**: SUBAGENT_PATH_RE test + parent linkage via parentSessionFromClaudeSubagentPath() (line 114-117)
- **Extracted fields** (per-turn row, lines 175-198):
  - timestamp, agent='claude', provider='claude-code'
  - input_tokens, output_tokens, total_tokens (from usage)
  - **cache_read_tokens** (from usage.cache_read_input_tokens) — CRITICAL: this is what makes claude's cached runs measurable
  - **cache_write_tokens** (from usage.cache_creation_input_tokens)
  - model, latency_ms=0, overhead_ms=null
  - tokens_estimated=0, reasoning_tokens=0
  - granularity_tier='per-turn'
  - task_id='' (stamped by caller)
- **Reasoning capture** (lines 200-240): One per-reasoning-step row per thinking block
  - reasoning_tokens: estimated via estimateReasoningTokens(text) = ceil(chars/4)
  - tokens_estimated=1 (flagged as derived, NOT from usage)
  - granularity_tier='per-reasoning-step'
- **Dedup key**: (user_hash='cladpt', tool_call_id=requestId)

**Copilot Adapter Details (buildCopilotTokenRows)**:
- Similar structure to claude, reads from ~/.copilot/session-state/{sid}/events.jsonl
- user_hash='copadt'
- Parses copilot's session.shutdown event (contains modelMetrics)
- subagents=false (copilot has no sub-agents)

**Locators (location by mtime window)**:

- **locateMainSessionJsonl** (line 143-191): Scan ~/.claude/projects/{encoded-cwd}/ for .jsonl files whose mtime falls in [started_at, ended_at + 5min grace]; return most-recent match
- **locateSubagentJsonls** (line 251-282): Derive subagents dir from located main JSONL (parent-dir/uuid/subagents/), filter to SUBAGENT_PATH_RE, apply same time window
- **locateCopilotSessionForSpan** (line 206-235): Scan ~/.copilot/session-state/ for events.jsonl files in time window; return most-recent match

---

## 4. CONTEXT-BREAKDOWN CAPTURE

### Phase 78 Analysis (server.mjs lines 1516-1748)

**What's captured**:

Two functions analyze the REAL per-category size of the context window:

**analyzeAnthropicRequest (line 1580-1680)**: For /v1/messages requests
- **Categories** (6 buckets):
  1. **sys**: system instruction blocks (or single string)
  2. **tools**: tool definition blocks (function schemas)
  3. **know**: retrieved knowledge blocks (detected via KB_RE: "## Working Memory\n**Project:**")
  4. **hist**: conversation history (earlier user/assistant turns)
  5. **tout**: tool outputs (content blocks from role:tool messages, NOT input)
  6. **user**: fresh user input (LAST user message only)
- **Fields**:
  - total_bytes (exact UTF-8)
  - est_tokens: total_bytes / 4 (~4-chars-per-token heuristic)
  - cacheable_prefix_bytes: total - user_bytes (reused cache prefix, post-fresh-input)
  - fresh_input_bytes: user_bytes only
  - cache_breakpoints: count of cache_control markers (from Anthropic prompt-cache API)
  - message_count, tool_count
  - knowledge_text: excerpt (up to 8000 chars) of most-recent injected knowledge block
  - knowledge_occurrences: count of knowledge blocks still in buffer (per-prompt injection cadence)
  - knowledge_cadence: "per-prompt (UserPromptSubmit hook)"
- **Cache control parsing** (line 1593-1596): Detects cache_control markers on blocks; counts breakpoints + tracks cursor position for cacheable_prefix_bytes

**analyzeOpenAIRequest (line 1690-1748)**: For /v1/chat/completions requests (opencode/mastra)
- Same 6 categories, similar logic
- **Difference**: No native cache_control markers (OpenAI format), so cache_breakpoints=0
- **System prompt location**: OpenAI uses role:'system' message (not separate system field)
- **Tool results**: role:'tool' messages (not role:'assistant' with type:'tool_result')

### Capture Writes

**Live-session snapshot** (lines 1950-1954):
- File: .data/llm-proxy/context-breakdown.json
- Throttled to 8s minimum between writes (line 1950: _lastCtxBreakdownAt)
- Main-session only (line 1950: !isSubagent gate)
- Scope: Current live session's fullest context

**Per-run snapshot** (lines 1956-1962):
- File: .data/llm-proxy/context-breakdown/{sanitized_task_id}.json
- **Condition**: When a measured span is active (taskId set) AND captureBelongsToRun() returns true
- **Keep-largest rule** (line 1957): Persists the LARGEST total_bytes seen for that run
- **Agent-correct**: Each agent (claude, opencode) gets its OWN file because they route through different endpoints (/v1/messages vs /v1/chat/completions)
- **Per-run choice (D-78)**: Allows dashboard to show real sizes per agent without mixing main-session leak

### Span-Leakage Guard (captureBelongsToRun, lines 1539-1577)

Prevents main-session requests from corrupting cell captures via composite task_id encoding:
- Task ID format: `{exp}--{agent}-{model}-{framework}-{env}--r{n}`
- Check: endpoint (anthropic for /v1/messages → claude; openai for shim → non-claude) + model family (opus/sonnet/haiku vs gpt/etc)
- Non-experiment task_ids (live sessions, no `--`) bypass all gates

### Read API: /api/context-breakdown

(See Route 5 in section 1)

---

## 5. MEASUREMENT SPANS

### Ambient Span Mechanism

**File**: .data/active-measurement.json (singleton per proxy instance)

**Lifecycle**:
- **Open**: measurement-start.mjs creates/writes span
- **Read**: proxy-bridge/server.mjs (resolveLiveTaskId via getActiveMeasurement)
- **Close**: measurement-stop.mjs (measurement-stop --headless for cells, or interactive for foreground)
- **Archive**: Moved to .data/measurements/{YYYY}/{MM}/{DD}/ after close

**Span Shape** (from span meta):
```json
{
  "task_id": "exp123--claude-opus-gsd-prod--r0",
  "started_at": "2026-07-05T12:34:56.789Z",
  "ended_at": "2026-07-05T12:45:00.000Z",
  "agent": "claude",
  "model": "claude-opus-4-20250514",
  "framework": "gsd",
  "env": "prod",
  "test_command": "bash test.sh",
  "variant": "claude-opus-gsd-prod",
  "repeat": 0,
  "meta": {
    "cwd": "/path/to/sandbox/worktree",  // for cells (Phase 77)
    "record": "/path/to/fixtures",     // if recording LLM replay fixtures (Phase 67)
    "replay_from": "/path/to/fixtures" // if replaying (Phase 67)
  }
}
```

### Task ID Resolution (resolveLiveTaskId, imported from ../dist/measurement-span.js, line 49)

- Reads .data/active-measurement.json from LLM_PROXY_DATA_DIR (the SAME dir the proxy uses)
- Never throws (best-effort); returns '' on any error
- Called at every /v1/messages, /v1/chat/completions, /api/complete request (line 1930, 2153, etc.)
- Stamps row.task_id in logTokenCall (line 2088)

### Measurement Start (scripts/measurement-start.mjs)

**CLI**: `node scripts/measurement-start.mjs --task-id <id> [--goal "<sentence>"] [--spec <file>] [--variant <name>]`

Key functions:
- **buildVariantMeta (line 90)**: Resolve agent/model/framework/test_command from CLI flags or spec matrix
- **captureSnapshot (line 41)**: Phase 67 pre-mutation baseline snapshot
- **Span creation**: Writes .data/active-measurement.json with started_at=now, metadata

### Measurement Stop (scripts/measurement-stop.mjs)

**CLI**: `node scripts/measurement-stop.mjs [--headless]`

Key functions:
- **captureForegroundTokens(span)** (line 330-417): Capture claude/copilot transcript tokens at close
- **archiveSpan()**: Move .data/active-measurement.json to .data/measurements/
- **Headless mode** (--headless for cells): Inline scoring via test_command judge (D-05)
- **Finally block** (line 407-408): DB close ALWAYS runs, even if capture fails

### Known Span-Leakage Problem

**Description** (comment line 1539-1546):
- Proxy shares ONE ambient active-measurement slot between interactive main session and measured cell
- Main-session request can resolve cell's task_id and clobber its context-breakdown via keep-largest rule
- Solution: captureBelongsToRun() gate checks endpoint + model family + agent against composite task_id

**Impact**: Without the gate, a Sonnet main session could overwrite a Haiku cell's per-run context-breakdown file (both would have same sanitized task_id key)

---

## 6. TOKEN USAGE STORAGE

### Database Location & Initialization

**Path**: .data/llm-proxy/token-usage.db (SQLite, WAL mode)

**Resolution** (token-usage.js lines 84-92):
1. LLM_PROXY_TOKEN_DB_PATH env override (if set)
2. LLM_PROXY_DATA_DIR + /llm-proxy/token-usage.db
3. cwd/.data/llm-proxy/token-usage.db (fallback)

**Init** (initTokenDb, lines 310-541):
- Creates directory if missing
- Ensures schema + indices exist
- Runs Phase 36 composite PRIMARY KEY migration (idempotent)
- Adds Phase 36-06 model_raw column (idempotent)
- Adds Phase 66-03 overhead_ms column (idempotent)
- Adds Phase 68-01 attribution columns (idempotent)
- Hydrates from per-(window, user_hash) JSON exports in .data/llm-proxy-export/

### Schema (lines 320-340)

```sql
CREATE TABLE token_usage (
  id              INTEGER NOT NULL,
  timestamp       TEXT    NOT NULL,
  provider        TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  process         TEXT    NOT NULL DEFAULT 'unknown',
  subscription    TEXT    NOT NULL DEFAULT 'unknown',
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  prompt_preview  TEXT    NOT NULL DEFAULT '',
  tokens_estimated INTEGER NOT NULL DEFAULT 0,
  user_hash       TEXT    NOT NULL DEFAULT 'unknown',
  model_raw       TEXT,
  overhead_ms     INTEGER,
  
  -- Phase 68-01 (TELEM-01): cross-agent attribution columns
  agent           TEXT    NOT NULL DEFAULT '',
  task_id         TEXT    NOT NULL DEFAULT '',
  tool_call_id    TEXT    NOT NULL DEFAULT '',
  parent_call_id  TEXT    NOT NULL DEFAULT '',
  granularity_tier TEXT   NOT NULL DEFAULT '',
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  
  PRIMARY KEY (user_hash, id)
);

CREATE INDEX idx_token_usage_timestamp ON token_usage(timestamp);
CREATE INDEX idx_token_usage_process   ON token_usage(process);
CREATE INDEX idx_token_usage_provider  ON token_usage(provider);
```

**Key points**:
- Composite PRIMARY KEY (user_hash, id) allows cross-user merge via git
- No native cache token columns in token_usage (see below)

### Cache Token Capture

**NOT stored in proxy token_usage** — instead captured separately:

- **Claude (cladpt adapter)**: Reads from transcript at measurement-stop
  - Fields: cache_read_tokens, cache_write_tokens (lines 191-192 in claude-token-rows.mjs)
  - These are bundled in the TokenUsageRow object built by buildClaudeTokenRows
  - Inserted into token_usage via insertTokenRowDeduped (stop-adapter-registry.mjs line 398-404)
  - **Important**: Full cache token accountability — the ~500× cost of cached runs IS recorded

- **Copilot (copadt adapter)**: Reads from ~/.copilot/session-state/{sid}/events.jsonl
  - Parses session.shutdown event's modelMetrics for cache counts

- **OpenCode/Mastra (proxy route)**: No cache token capture
  - OpenAI format endpoint used (no cache markers)
  - Unrouted path (opencode uses own creds, not proxy-routed) means tokens may not reach DB

### Per-Request Granularity

**Proxy records per-llm-call granularity** (per /v1/messages or /v1/chat/completions call):

- granularity_tier='per-turn' for /v1/messages passthrough (line 2087, granularity_tier not set defaults to '')
- granularity_tier='per-llm-call' for /v1/chat/completions shim (line 2190 in experiment-runner)
- **Exception**: Claude's per-reasoning-step rows (granularity_tier='per-reasoning-step', estimated tokens)

**Adapter records at stop-time**:
- Claude: Per-turn (one row per assistant usage) + per-reasoning-step (one per thinking block)
- Copilot: Per-turn (one per copilot.complete call)

### logCall Binding (lines 716-737)

All fields inserted by logCall:
```javascript
handle.insertStmt.run(
  handle.nextLocalId(),              // id (assigned JS-side)
  row.timestamp,                     // ISO-8601
  row.provider,                      // 'anthropic', 'openai', etc.
  row.model,                         // canonicalized model name
  row.process,                       // 'token-adapter-claude', 'observation-writer', etc.
  row.subscription,                  // 'max-oauth-passthrough', 'api-key', etc.
  row.input_tokens,                  // from usage
  row.output_tokens,                 // from usage
  row.total_tokens,                  // input + output
  row.latency_ms,                    // wall-clock for proxy round trip
  row.prompt_preview,                // first ~120 chars
  row.tokens_estimated,              // 0 if from usage, 1 if estimated
  row.user_hash ?? USER_HASH,        // 'cladpt', 'copadt', or machine hash
  row.model_raw ?? row.model,        // raw model name before canonicalization
  row.overhead_ms ?? null,           // worker-pool spawn/queue overhead
  
  // Phase 68-01 attribution
  row.agent ?? '',                   // 'claude', 'opencode', 'mastra', 'copilot'
  row.task_id ?? '',                 // composite experiment task_id or ''
  row.tool_call_id ?? '',            // request-id or transcript requestId
  row.parent_call_id ?? '',          // for sub-agents, parent call ID
  row.granularity_tier ?? '',        // 'per-turn', 'per-llm-call', 'per-reasoning-step'
  row.reasoning_tokens ?? 0          // for thinking blocks
);
```

### Read APIs

**getSummary (line 767-...)**:
- Aggregates by time bucket (auto-scaled: 2min for ≤24h, 10min/30min/2h/6h for wider windows)
- Pivots into by_process_hour / by_model_hour stacked series (for dashboard charts)
- Returns: timeline[], by_process[], by_model[] with per-bucket token sums, latencies

**getRecent (line 846-...)**:
- Returns last N rows ordered by id DESC
- Optional process filter (in-memory after query)
- Returns: { data: [{...}], ... }

**Exported Snapshots** (Phase 36, lines 245-301):
- Per-(window, user_hash) JSON files: .data/llm-proxy-export/YYYY/MM/YYYY-MM-DD_HHMM-HHMM_{hash}.json
- Debounced async export from DB (scheduleExport, line 700)
- Git-trackable; enables cross-user hydrate via ON CONFLICT(user_hash, id) DO NOTHING

---

## Summary Table: Agents × Measurement Methods

| Agent | Route | Token Source | Granularity | Cache Tokens | Per-Call Uniqueness |
|-------|-------|--------------|-------------|--------------|-------------------|
| **claude** | Direct transcript (cladpt) | Transcript @ stop | per-turn + per-reasoning | ✓ (cache_read, cache_write) | requestId + :reason:idx |
| **copilot** | Direct transcript (copadt) | Transcript @ stop | per-turn | ✓ (from session.shutdown) | — |
| **opencode** | Proxy /v1/messages + route | Proxy passthrough tap | per-llm-call | ✗ (unrouted, or no cache) | request-id |
| **mastra** | Proxy /v1/mastra (self-routed) | Proxy passthrough tap | per-llm-call | ✗ (no cache) | request-id |

---

## Known Gaps (Highlighted in Code Comments)

1. **Copilot headless routing** (launch-agent-common.sh line 435): No base-URL override available → foreground traffic is permanently unmeasured
2. **OpenCode proxy routing validation** (line 424): "best-effort — validate live" — actual honoring of ANTHROPIC_BASE_URL not verified
3. **Cache token loss in proxy passthrough** (experiment-runner.mjs line 162-165): Claude cells deliberately NOT routed to preserve cache-token accounting via transcript adapter
4. **Span-leakage window** (line 1539-1546): Active span shared between main session and cells; captureBelongsToRun() is the sole guard

