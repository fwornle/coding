# Phase 70: OpenCode + Mastra Token Adapters - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Land **OpenCode** and **Mastra** LLM token spend in the proxy-owned `token_usage` store (`.data/llm-proxy/token-usage.db`) on the Phase-68 cross-agent row contract, stamped with the active `task_id` — completing the all-four-agent reach (Claude + Copilot shipped in Phase 69).

**The chosen mechanism for both agents is proxy-route, not store-scraping.** OpenCode (and Mastra, if redirectable) are configured to send their LLM calls through the rapid-llm-proxy, which already logs every call via `logTokenCall` (`server.mjs:1666`). This yields the finest `per-llm-call` granularity for free — superior to scraping OpenCode's SQLite `session.tokens_*` aggregate columns (which exist but are session-level only).

**In scope:**
- An **OpenAI-compatible shim endpoint** on rapid-llm-proxy (`/v1/chat/completions` → existing `/api/complete` pipeline), so OpenCode can use it as a custom provider (ADAPT-03 SC-1).
- The shim stamps `agent='opencode'`, `granularity_tier='per-llm-call'`, and the active `task_id` onto the logged row (ADAPT-03 SC-2).
- **OpenCode config change**: a custom OpenAI-compatible provider pointing at the proxy (`http://localhost:12435/v1`).
- **Mastra capture**: route Mastra's model calls (`.opencode/mastra.json`) through the proxy shim if its endpoint is redirectable (agent=`mastra`, per-llm-call); else a framework-instrumentation adapter at the identified surface (ADAPT-04 SC-3/SC-4).
- Identifying Mastra's instrumentation surface and granularity tier (ADAPT-04 SC-3) is a deliverable, whichever path is taken.

**Out of scope (other phases / deferred):**
- Streaming (SSE) support on the OpenCode shim → documented later upgrade.
- Experiment KB / Run-write path / task taxonomy → Phase 71.
- Route quality, success scoring, dashboard → Phases 72–74.
- Any change to the Phase-68 `token_usage` schema or the `getActiveMeasurement()` contract (consumed as-is).
- Claude / Copilot adapters → done in Phase 69.

</domain>

<decisions>
## Implementation Decisions

### OpenCode → proxy routing (ADAPT-03 SC-1)
- **D-01 (LOCKED):** Route OpenCode through the proxy via a new **OpenAI-compatible shim endpoint** (`POST /v1/chat/completions`) on rapid-llm-proxy that maps to the existing `/api/complete` pipeline (provider chain, processOverrides, token logging all reused). OpenCode is configured with a custom OpenAI-compatible provider pointing at the shim. **NOT** a store-scrape of OpenCode's SQLite, and **NOT** an OpenCode-plugin approach — the shim keeps OpenCode on its native provider-config path while reusing the proxy's existing logging.
- **D-02 (LOCKED):** The shim is **non-streaming first** — it returns a single buffered `chat/completions` response wrapping `/api/complete`'s JSON. Prioritizes accurate per-call token logging over live token-by-token UX. Streaming (SSE) is an explicit deferred upgrade, not Phase-70 scope.
- **D-03 (LOCKED):** OpenCode runs **host-side**; provider `baseURL = http://localhost:12435/v1`. The ROADMAP SC-1 wording `host.docker.internal:12435` is the container-perspective alias for the same proxy — `localhost` is canonical for the host-side `~/.config/opencode/opencode.json`. (Research should confirm whether the existing `github-copilot` provider is replaced or a second provider is added — see Claude's Discretion.)

### task_id + agent stamping on proxy rows (ADAPT-03 SC-2)
- **D-04 (LOCKED):** task_id reaches the row **via the envelope, winning if present, else `resolveLiveTaskId()` fallback.** Backward-compatible: existing `/api/complete` callers that omit the field keep current behavior.
- **D-05 (LOCKED):** Since OpenCode cannot natively inject a dynamic per-request value, the **shim resolves it server-side**: when building the internal `/api/complete` call it sets `agent='opencode'`, `granularity_tier='per-llm-call'`, and `task_id=resolveLiveTaskId()` (the Phase-68 active span = OpenCode's active task while it runs). "Envelope" here = the proxy's internal `/api/complete` body. The shim also accepts an **optional client override** (e.g. `X-Task-Id` header / body field) that wins if present — future-proofing for when OpenCode can supply it. No OpenCode-side code needed now.
- **D-06 (LOCKED):** `agent` stamping is a **generic envelope passthrough** — the `logTokenCall` path stamps `row.agent` from the envelope `agent` field (same way it already passes `body.process`/`body.subscription` through), rather than hardcoding `'opencode'` in one branch. This makes the same mechanism serve Mastra (`agent='mastra'`) and any future agent. (Claude's Discretion on exact field plumbing; the generic-passthrough intent is locked.)
- **D-07 (INHERITED, Phase-68):** No new backfill path for OpenCode. Rows are live-stamped by the shim; any logged with `task_id=''` (call made while no span active) are re-attributed for free by the existing `scripts/backfill-task-id-by-timestamp.mjs` timestamp-join sweep over all `token_usage` rows.

### Mastra capture (ADAPT-04 SC-3/SC-4)
- **D-08 (LOCKED):** **Route Mastra through the proxy if its model endpoint is redirectable.** First check whether the `.opencode/mastra.json` model (`anthropic/claude-haiku-4-5`) can be pointed at the proxy shim like OpenCode — if so, its calls are logged as `per-llm-call` rows with `agent='mastra'` for free, no separate adapter. Framework instrumentation is the **fallback**, used only if the endpoint can't be redirected.
- **D-09 (LOCKED):** Identifying Mastra's instrumentation surface (per-step middleware vs observer hooks vs framework callbacks) and its granularity tier (SC-3) is a **research deliverable regardless of path** — even the proxy-route path must document what surface exists, to justify why proxy-route is sufficient or why the fallback is needed.
- **D-10 (LOCKED, mirrors Phase-69 D-04):** If the framework-instrumentation fallback is needed, emit the **best-available tier** the surface exposes (per-step if per-call usage is available) with **per-session-aggregate as the guaranteed floor**. The adapter stamps the actual tier achieved on each row (`granularity_tier`).

### Mastra fallback adapter write path & packaging
- **D-11 (LOCKED, only if fallback triggers):** The framework-instrumentation fallback adapter **reuses Phase-69's locked write path verbatim**: distinct adapter `user_hash` (Phase-69 D-06), direct `better-sqlite3` INSERT into `token-usage.db` with `busy_timeout` set + a WAL concurrency test as an acceptance criterion (Phase-69 D-07), and task_id resolution via `getActiveMeasurement()` live + timestamp-join backfill (Phase-69 D-03). Packaged as a **try/catch-isolated emission hook on the existing `sub-agent-live-opencode` supervisor** (Phase-69 D-08) — no new launchd plist; an emission failure can never crash the LSL path.

### Claude's Discretion (delegated to research/planning with guardrails)
- **Shim model mapping** — how OpenCode's requested model id maps onto the proxy's provider chain / processOverrides. Guardrail: pass `body.model` through and let the existing chain resolve; the shim adds no new routing logic.
- **Replace vs add OpenCode provider** — whether to replace the existing `github-copilot` default in `~/.config/opencode/opencode.json` or add the proxy as a second/selectable provider. Guardrail: do not break the existing OpenCode setup; prefer additive + a documented switch.
- **Exact envelope field name** for the optional client task_id override (`X-Task-Id` header vs `body.task_id`). Guardrail: D-04/D-05 precedence holds either way.
- **Whether Mastra's endpoint is redirectable** — the proxy-route-vs-fallback fork (D-08) is resolved by research inspecting `@opencode-ai/plugin@1.3.17` / Mastra config.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase-68 TELEM contract (the storage + span surface this phase writes to)
- `.planning/phases/68-foundational-token-attribution-storage/68-VERIFICATION.md` — the verified contract: 6 additive columns, single-reader, resolution rules.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` — `TokenUsageRow` type, `insertStmt`, `logCall` bindings, PRAGMA-guarded migration (column set the rows must populate).
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts` — `getActiveMeasurement()` / `resolveLiveTaskId()` (the ONLY active-span reader; do not add a second JSON parser) + archive layout.

### The proxy request pipeline (where the shim + stamping land)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — `/api/complete` handler (`:1518`), provider-chain resolution (`:1577-1626`), and the existing `logTokenCall` row build (`:1666-1698`) where `agent`/`granularity_tier`/`task_id` are stamped. The new shim endpoint and generic `agent`-passthrough live here.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/index.ts` — barrel re-exports of the measurement-span SDK surface.

### Phase-69 precedent (locked patterns reused by the Mastra fallback adapter)
- `.planning/phases/69-claude-copilot-token-adapters/69-CONTEXT.md` — D-03 (task_id resolution), D-04 (aggregate fallback), D-06 (distinct adapter user_hash), D-07 (direct better-sqlite3 + WAL test), D-08 (extend supervisor + failure isolation).
- `scripts/backfill-task-id-by-timestamp.mjs` — canonical timestamp-join backfill + host-side `better-sqlite3` open pattern for `token-usage.db`.

### Phase-51 OpenCode infrastructure (reuse target for fallback packaging)
- `lib/lsl/adapters/opencode-sqlite.mjs` — existing OpenCode SQLite reader (session/sub-agent tree); documents the OpenCode DB landmines (readonly, busy_timeout, schema drift, ms timestamps).
- `scripts/sub-agent-live-opencode.mjs` — the existing launchd-managed supervisor to extend with a try/catch-isolated emission hook (D-11).

### Config surfaces this phase touches
- `~/.config/opencode/opencode.json` — OpenCode provider config (currently `github-copilot/claude-opus-4.6`); target of the custom-provider change (D-01/D-03).
- `.opencode/mastra.json` — Mastra config (`@opencode-ai/plugin@1.3.17`, model `anthropic/claude-haiku-4-5`, observation/reflection token budgets); the SC-3 instrumentation-surface investigation target.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — ADAPT-03, ADAPT-04 (acceptance source).
- `.planning/ROADMAP.md` — Phase 70 section (goal + 4 success criteria).

### Project conventions
- `CLAUDE.md` — rapid-llm-proxy endpoint/port notes (`/api/complete` on 12435; do NOT confuse with the 3033 Health API), `no-console-log` (use `process.stderr.write`), launchd daemon conventions, submodule build pipeline.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Proxy `logTokenCall` (`server.mjs:1666`)** — already logs every `/api/complete` call with provider/model/tokens/task_id; the shim reuses this path so OpenCode/Mastra rows need no separate writer. `agent`/`granularity_tier` are currently left at defaults — the only gap to fill.
- **`resolveLiveTaskId()` / `getActiveMeasurement()`** — the single Phase-68 active-span reader; the shim calls it server-side for the envelope task_id.
- **`scripts/backfill-task-id-by-timestamp.mjs`** — re-attributes any `task_id=''` rows by timestamp-join; covers OpenCode rows logged outside a span automatically.
- **`opencode-sqlite.mjs` + `sub-agent-live-opencode.mjs`** — Phase-51 OpenCode infra; only relevant if the Mastra framework-instrumentation fallback is built (packaging host).

### Established Patterns
- Proxy is the `token_usage` DB owner; proxy-route writes happen *inside* the proxy (no second writer, no WAL concern for the OpenCode path). The WAL/concurrency concern from Phase 69 (D-07) only applies to the host-side Mastra *fallback* adapter.
- Best-effort logging: a DB hiccup must never fail the LLM call (the existing `if (_tokenDb)` guard at `server.mjs:1666`).
- Envelope passthrough: the proxy already carries `body.process` / `body.subscription` onto the row — `agent` and the optional `task_id` override follow the same pattern.

### Integration Points
- New shim endpoint slots beside the existing `req.url === '/api/complete'` branch in `server.mjs`.
- OpenCode's `~/.config/opencode/opencode.json` gains a custom OpenAI-compatible provider entry pointing at `http://localhost:12435/v1`.
- Mastra rows enter via the same shim (if redirectable) or via the Phase-69-style host-side adapter (fallback).

</code_context>

<specifics>
## Specific Ideas

- Proxy-route over store-scrape is the firm modeling choice: it gives `per-llm-call` granularity (the finest tier) for both OpenCode and Mastra, and reuses the proxy's existing logging rather than building a parallel ingestion stack. OpenCode's SQLite `session.tokens_*` aggregate columns exist but are deliberately NOT the source.
- The `agent` field on proxy rows should be set via generic envelope passthrough (D-06), so the same code serves `opencode`, `mastra`, and any future proxy-routed agent without per-agent branches.
- A live gate (mirroring Phase 69's blocking human-verify) is expected at verification time: prove an OpenCode call through the shim lands a `token_usage` row with `agent='opencode'`, `granularity_tier='per-llm-call'`, and the active `task_id`.

</specifics>

<deferred>
## Deferred Ideas

- **Streaming (SSE) on the OpenCode shim** — non-streaming ships first (D-02); SSE is a documented upgrade, not Phase-70 scope.

### Reviewed Todos (not folded)
All four phase-matched todos are weak generic-keyword matches (score 0.4–0.6 on "phase"/"agent"/"via"/"per") and none concern OpenCode/Mastra token ingestion — same assessment Phase 69 made:
- `2026-06-10-okm-express-api-contract-bridge.md` — OKM Express ↔ unified-viewer API contract mismatch. Cross-system API gap, not token ingestion.
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — worktree-isolated sub-agent observations don't reach dashboard. Observation-pipeline gap, not token rows.
- `2026-06-17-hierarchy-wire-up-and-writer-enforcement.md` — knowledge-hierarchy wiring; unrelated.
- `2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md` — LSL timeline truncation; dashboard/LSL concern, not token ingestion.

</deferred>

---

*Phase: 70-opencode-mastra-token-adapters*
*Context gathered: 2026-06-22*
