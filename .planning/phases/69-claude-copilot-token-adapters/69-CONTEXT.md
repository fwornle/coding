# Phase 69: Claude + Copilot Token Adapters - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Host-side ingestion of **Claude Code** and **Copilot CLI** token spend into the proxy-owned `token_usage` store (`.data/llm-proxy/token-usage.db`), on the Phase-68 cross-agent row contract, at the best granularity each agent natively surfaces, with sub-agents linked to their parent turn.

**In scope:**
- Claude Code session JSONL `usage` blocks → `per-turn` rows; extended-thinking blocks → separate `per-reasoning-step` rows carrying `reasoning_tokens`.
- Claude sub-agent JSONLs linked to their parent turn via `parent_call_id`.
- Live-tail of in-progress Claude/Copilot sessions + sweep of completed sessions on adapter startup.
- Copilot CLI `events.jsonl` → `per-session-aggregate` rows from `session.shutdown.modelMetrics`; Phase-1 event-vocabulary check with per-turn upgrade path.
- task_id stamping on adapter rows per the Phase-68 resolution rules (live → active span; completed-session → timestamp-join backfill).

**Out of scope (other phases):**
- OpenCode + Mastra adapters → Phase 70 (ADAPT-03/04).
- Experiment KB / Run-write path / task taxonomy → Phase 71.
- Route quality, success scoring, dashboard → Phases 72–74.
- Any change to the Phase-68 `token_usage` schema or the `getActiveMeasurement()` contract (consumed as-is).

</domain>

<decisions>
## Implementation Decisions

### Claude granularity & sub-agent linkage (LOCKED)
- **D-01:** Emit a **per-turn** row PLUS **distinct per-reasoning-step rows** for extended-thinking blocks. Reasoning rows carry `reasoning_tokens` **separate from** input/output, with `granularity_tier = 'per-reasoning-step'` (turn rows use `'per-turn'`). This matches ADAPT-01 literally — do NOT fold reasoning into the turn row.
- **D-02:** Sub-agent rows link to their parent turn via `parent_call_id`, derived from the existing `parent_session_id` linkage already computed by `lib/lsl/adapters/claude-jsonl-tree.mjs` (reuse its tree resolution, including the `isSidechain` first-record gate). Do not re-implement parent resolution.

### task_id stamping (LOCKED — inherited from Phase 68)
- **D-03:** Live-tailed rows stamp `task_id` from the single `getActiveMeasurement()` reader at write time (in-window → span.task_id; out-of-window / no span → `''`). Completed-session sweep backfills `task_id` by timestamp-join against archived `.data/measurements/<task_id>.json` spans — reuse the join logic from `scripts/backfill-task-id-by-timestamp.mjs` rather than writing a second join. Read failures must never break ingestion (best-effort).

### Copilot aggregate fallback (LOCKED guardrail)
- **D-04:** The default/fallback granularity is `per-session-aggregate`, sourced from `session.shutdown.modelMetrics`. Copilot CLI v1.0.48 only persists lifecycle bookends to `events.jsonl` (documented in `lib/lsl/adapters/copilot-events.mjs`), so per-turn rows are an *upgrade*, not the baseline. The adapter MUST enumerate the distinct event `type:` values and confirm whether per-turn usage payloads exist as part of delivering ADAPT-02 (the Phase-1 vocabulary check is a deliverable, not optional).

### Research-driven resolutions (LOCKED 2026-06-22, post-RESEARCH)
- **D-05 (amends D-01 — Claude reasoning tokens):** RESEARCH verified (8 sessions / 999 usage records / 290 thinking blocks) that the Claude session JSONL `usage` block carries **NO native reasoning/thinking token field** — thinking is folded into `output_tokens`. D-01's per-reasoning-step rows are still **first-class and emitted** (one row per extended-thinking block, `granularity_tier='per-reasoning-step'`), but `reasoning_tokens` is **ESTIMATED from thinking-block content length** and every such row stamps **`tokens_estimated=1`** to flag the value as derived, not native. Do NOT claim the value is extracted from `usage`. (Copilot's `reasoningTokens` is real but aggregate-only — no per-reasoning-step row is possible there.)
- **D-06 (id-collision avoidance):** `token_usage` PK is composite `(user_hash, id)` with no AUTOINCREMENT; the proxy allocates ids from an in-memory counter. Adapter-written rows MUST use a **distinct adapter `user_hash`** (separate from the proxy's) so the second writer never collides with the proxy's counter. Dashboard groups adapter rows under that distinct hash — acceptable per user.
- **D-07 (write path — resolves discretion item 1):** Direct `better-sqlite3` INSERT into `.data/llm-proxy/token-usage.db`. RESEARCH ran the mandated WAL concurrency test against the **live** proxy daemon (50 concurrent second-process INSERTs: `ok=50 busy=0 err=0`; DB is `journal_mode=wal`, `busy_timeout=5000`). No new ingest endpoint. Adapters MUST open with `busy_timeout` set. The WAL/concurrency test is a plan acceptance criterion.
- **D-08 (daemon packaging — resolves discretion item 2):** Extend the existing Phase-51 `sub-agent-live-{claude,copilot}` + `sub-agent-sweep` supervisors with additive token-emission hooks on the same JSONL pass (no plist change). Token writes MUST be wrapped in try/catch so an emission failure can never crash the LSL path (failure isolation).
- **D-09 (Copilot probe — resolves discretion item 3):** One-time, version-keyed bake-in (re-probe on CLI version change). Installed CLI is **v1.0.63** (not v1.0.48); newer `assistant.turn_*` / `tool.execution_*` events still carry NO per-turn token usage — only `session.shutdown.modelMetrics.<model>.usage` has totals. `per-session-aggregate` (D-04) confirmed as the only viable tier. The stale v1.0.48 note in `copilot-events.mjs` should be refreshed when touched.

### Claude's Discretion (delegated to research/planning with guardrails — NOW RESOLVED above by D-07/D-08/D-09)
- **Row write path** — direct `better-sqlite3` INSERT into `token-usage.db` (the 68 backfill already opens this DB directly) vs a new proxy ingest endpoint. **Guardrail:** whichever is chosen, research MUST validate the SQLite single-writer/WAL concurrency story against the live proxy daemon (the proxy is the established DB owner; adapters would be a second writer). Capture the WAL/concurrency test as an acceptance criterion.
- **Daemon packaging** — extend the existing Phase-51 `sub-agent-live-{claude,copilot}` + `sub-agent-sweep` launchd supervisors to also emit token rows from the same JSONL pass, vs dedicated token-adapter daemons sharing only the parsing primitives. **Guardrail:** the parsing reuse (`claude-jsonl-tree.mjs`, `copilot-events.mjs`) is locked regardless; only the daemon-packaging/lifecycle choice is open. Note the failure-isolation trade-off in the plan.
- **Copilot probe timing** — one-time investigation that bakes the verdict into the adapter (re-probe on CLI upgrade) vs a runtime per-session capability-probe that auto-upgrades to `per-turn`. **Guardrail:** D-04's aggregate fallback + vocabulary enumeration hold either way.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase-68 TELEM contract (the storage + span surface this phase writes to)
- `.planning/phases/68-foundational-token-attribution-storage/68-VERIFICATION.md` — the verified contract: 6 additive columns, single-reader, resolution rules.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` — `TokenUsageRow` type, `insertStmt`, `logCall`, the PRAGMA-guarded migration (column names + defaults the adapters must populate).
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts` — `getActiveMeasurement()` (the ONLY active-span reader; do not add a second JSON parser) + archive layout.
- `/Users/Q284340/Agentic/coding/scripts/backfill-task-id-by-timestamp.mjs` — the canonical timestamp-join backfill + host-side `better-sqlite3` open pattern for `token-usage.db`.

### Phase-51 reuse (JSONL parsing + live/sweep infrastructure)
- `lib/lsl/adapters/claude-jsonl-tree.mjs` — Claude session/sub-agent JSONL tree, `parent_session_id`, `sub_index`, `isSidechain` gate (parent_call_id source).
- `lib/lsl/adapters/copilot-events.mjs` — Copilot `events.jsonl` parser; documents the v1.0.48 lifecycle-bookend limitation.
- `lib/lsl/adapters/README.md` — adapter contract overview.
- `lib/lsl/live/claude-fs-watch.mjs`, `lib/lsl/live/copilot-events-tail.mjs` — live-tail watchers.
- `scripts/sub-agent-live-claude.mjs`, `scripts/sub-agent-live-copilot.mjs`, `scripts/sub-agent-sweep-job.sh` — existing launchd-managed supervisors (extend-vs-new decision target).

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — ADAPT-01, ADAPT-02 (acceptance source).
- `.planning/ROADMAP.md` — Phase 69 section (goal + 5 success criteria).

### Project conventions
- `CLAUDE.md` — Claude project transcript dir (`~/.claude/projects/-Users-Q284340-Agentic-coding`), launchd daemon conventions (`launchctl kickstart`), `no-console-log` (`process.stderr.write`), submodule build pipeline.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/lsl/adapters/claude-jsonl-tree.mjs`: already resolves the Claude session→sub-agent tree (`parent_session_id`, first-message ordering, `isSidechain` gate) — directly supplies `parent_call_id` for ADAPT-01's sub-agent linkage.
- `lib/lsl/adapters/copilot-events.mjs`: already parses `events.jsonl` and documents that v1.0.48 emits only lifecycle bookends — the starting point for the ADAPT-02 vocabulary check + aggregate fallback.
- `lib/lsl/live/{claude-fs-watch,copilot-events-tail}.mjs` + `scripts/sub-agent-live-{claude,copilot}.mjs` + `scripts/sub-agent-sweep-job.sh`: existing live-tail + sweep daemons over the exact same JSONLs Phase 69 must read.
- `scripts/backfill-task-id-by-timestamp.mjs`: host-side `better-sqlite3` open of `token-usage.db` + the timestamp-join backfill to reuse for completed-session task_id stamping.

### Established Patterns
- Phase 68: proxy is the `token_usage` DB owner; `getActiveMeasurement()` is the single span reader; logging is best-effort (read failure never breaks the write).
- Host-side direct SQLite access to `token-usage.db` is precedented (backfill UPDATEs) — but Phase 69 INSERTs new rows concurrently with the proxy daemon, so WAL/single-writer behavior must be validated, not assumed.
- launchd-managed daemons auto-respawn; trigger via `launchctl kickstart -k gui/$(id -u)/<label>`.

### Integration Points
- Adapter rows must match the Phase-68 `token_usage` column set exactly (`agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `reasoning_tokens` + existing fields), with `agent` set to `claude` / `copilot`.
- task_id resolution flows through Phase-68's `getActiveMeasurement()` (live) and the archived-span timestamp join (sweep).

</code_context>

<specifics>
## Specific Ideas

- Reasoning-step rows are first-class (separate rows), not a folded column — this is the one firm modeling decision the user made; honor it exactly.
- Reuse over rebuild: the Phase-51 JSONL parsers and the Phase-68 backfill/reader are locked reuse targets. New code should be the token-row emission layer on top of them, not a parallel parsing stack.

</specifics>

<deferred>
## Deferred Ideas

- OpenCode proxy-route logging + Mastra instrumentation adapter → Phase 70 (ADAPT-03/04).
- Any per-turn Copilot upgrade work beyond confirming feasibility is bounded by what the installed CLI version actually persists; if v1.0.48 lacks per-turn payloads, per-turn remains a documented upgrade path, not Phase-69 scope.

### Reviewed Todos (not folded)
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — sub-agent observations from worktree-isolated `Agent()` calls don't reach the dashboard. Reviewed; **not folded** — it's an observation-pipeline dashboard gap, not token-row ingestion. (Weak keyword match only.)
- `2026-05-23-orphan-digest-observation-refs.md`, `2026-06-10-okm-express-api-contract-bridge.md`, `2026-06-17-hierarchy-wire-up-and-writer-enforcement.md` — all matched on generic keywords ("phase"/"live"/"per"); none concern Claude/Copilot token adapters. Not folded.

</deferred>

---

*Phase: 69-claude-copilot-token-adapters*
*Context gathered: 2026-06-22*
