# Phase 84: Per-Turn Context Revelation - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Persist **every measured LLM request** as one `context-turns` JSONL line and expose it honestly to the operator. Per line: category analysis, cache-breakpoint positions, per-message digests (incl. `tool_use` names + sizes), and paired response usage. Files are gzipped at span close under a retention policy, with optional flag-gated full raw bodies. Read APIs land on the proxy (`/api/context-turns`) and vkb-server (pass-through). The existing cache explainer is upgraded to show **honest per-turn sent/cached/fresh** numbers for all four agents, with "how prompt caching actually works" copy.

**Depends on:** Phase 82 (wire measurement — cache columns, per-request `x-task-id`/`x-agent` binding, `request_id`/`tool_call_id` as the stable per-request key).

**Out of scope (belongs elsewhere):**
- Richer per-turn UI (per-turn detail panel, tool-arg drill-down, stacked context band) → **Phase 86 (Timeline v2)**.
- Any change to interactive (non-measured) capture — this phase is measured-span-only (Phase 83 D-01).
- Reconciliation/discrepancy semantics — owned by Phase 83.
</domain>

<decisions>
## Implementation Decisions

### Retention & Lifecycle
- **D-01: Age-based retention, dedicated launchd sweeper.** Keep context-turns files for a configurable window (default **14 days**), delete older. Sweeping runs in a **dedicated launchd job** (StartInterval + RunAtLoad, mirroring `com.coding.lsl-lock-sweeper`), **decoupled from span close** so an abandoned/never-closed span still gets cleaned by age.
- **D-02: Configurable + never-throw.** Retention window (and any size knob) live in `.planning/config.json` (or an env var) with the shipped default. The sweep and the per-request write hook are **best-effort**: errors go to stderr and never block span close or crash the proxy daemon — honors the Phase-82 D-06 / Phase-83 D-08 never-throw contract.
- **D-03: Write timing — append plaintext during span, gzip at close (Claude's discretion, user-confirmed default).** The per-request line is appended to a plaintext `context-turns.jsonl` in the request hot path (append-only, never-throw); at span close the file is gzipped to `context-turns.jsonl.gz` and the plaintext removed. A crashed/never-closed span leaves a still-readable uncompressed `.jsonl` that the age-sweeper (D-01) reclaims. Rationale: crash-durable (data survives even if the span never closes), keeps the hot path a cheap append, and defers compression to the one-time close.

### Storage Layout
- **D-04: Co-locate under the measurements dir.** Files live in `.data/measurements/<sanitizeTaskId(task_id)>/` alongside Phase-83's `reconciliation.json` (same per-task isolation pattern, same `safeSanitizeTaskId` guard). Files: `context-turns.jsonl(.gz)` always; `raw-bodies.jsonl.gz` only when raw capture is enabled.

### Raw Bodies & Privacy
- **D-05: Per-experiment flag, default OFF, sibling file.** Full raw request/response bodies are gated by a **per-experiment/per-span config flag** (e.g. `capture_raw_bodies: true` in the experiment YAML), **default OFF**. When on, raw bodies go to a **separate `raw-bodies.jsonl.gz`** sibling file — keeps the always-on context-turns line lean and lets retention drop raw bodies independently of digests.
- **D-06: Reuse the configured LSL redaction — do NOT reinvent.** Raw-body capture redacts via the project's existing **configured** redaction pattern set at `.specstory/config/redaction-patterns.json` (27 patterns: Anthropic/`sk-`/XAI/Groq/AWS keys, Bearer tokens, JWT, Authorization, env-var secrets, plus PII). **Known gap for the planner:** the current applier `scripts/enhanced-redaction-system.js` (used via `scripts/lsl-file-manager.js`) only applies **4 hardcoded PII regexes** (email/SSN/CC/phone) and does **not** load the 27-pattern config. Phase-84 raw-body redaction MUST consume the full `redaction-patterns.json` config (extend/rewire the applier to load it), not the stub's hardcoded set. Redaction is applied before write; a redaction error blocks that body's content (fail-closed on the content, never the daemon).

### Per-Turn JSONL Schema
- **D-07: Semantic-first digest with graceful fallback.** Per message, always record `role`, byte size, and for `tool_use`/`tool_result` the **tool name + arg/result size** ("the tools"). For the turn's *meaning*, **prefer a reference to the ETM live observation / digest** that already describes what that turn is doing (intent/approach) rather than storing content. **Fallback:** when no observation correlates to a turn, store a short (**~120-char**) content preview so there is always *something* rather than nothing. Order of preference: ETM observation/digest reference → preview fallback.
- **D-08: Cache-breakpoints as message indices; reuse the existing category taxonomy.** Cache-breakpoint positions are encoded as **message indices** (which messages carry `cache_control`). "Category analysis" **reuses the existing context-breakdown taxonomy** (system / tools / history / …) already computed at the proxy's `perRunBreakdownPath` — one taxonomy across both surfaces, no divergence from what the explainer already renders.
- **D-09: Cache split stays separate.** `input` (fresh sent) / `cache_read` (cached) / `cache_write` / `output` are carried separately per turn, never folded into a total (inherits Phase-82 D-02).

### Read APIs
- **D-10: Mirror the Phase-83 D-13 read-API pattern.** Proxy serves `/api/context-turns` (gunzip + return the per-turn array for a task); vkb-server (`lib/vkb-server/api-routes.js`) adds a thin pass-through mirroring `handleReconciliation` (verbatim, graceful-empty on ENOENT → not 500). The dashboard backend proxy (`integrations/system-health-dashboard/server.js`) gets a mirror line, as it already has for `/api/context-breakdown`.

### Cache Explainer UI
- **D-11: Wire data + honest copy, no new components.** Feed the new context-turns data (sent/cached/fresh per turn) into the **existing** `integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx`, correct any estimated/dishonest figures to real wire values, and add the "how prompt caching actually works" copy. **No new components** — richer per-turn views are deferred to Phase 86. New Redux surface: a `fetchContextTurns(taskId)` thunk + `selectContextTurnsFor` selector mirroring the existing `fetchTimeline` pattern in `performanceSlice.ts`.
- **D-12: Honest all-agents cache display — N/A over inference.** OpenAI-wire agents (copilot/opencode) carry `cached_tokens` but **no cache-creation counter** (Phase-83 D-09). The explainer renders cache-write as **"N/A (provider reports no cache-creation)"** for those agents rather than `0` or an inferred value. The explainer copy states why Anthropic-wire (claude) has a write counter and OpenAI-wire agents don't. **Never infer a measurement** — inference-as-measurement conflicts with the project's honest-measurement stance.

### Claude's Discretion
- Exact JSONL field names/ordering, gzip level, and the append/flush mechanics (D-03) — planner may finalize against the real proxy write sites.
- The precise config key names/paths for retention (D-02) and the raw-body flag (D-05).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Redaction (D-06 — reuse, do not reinvent)
- `.specstory/config/redaction-patterns.json` — the 27-pattern configured redaction set (credentials + PII) that raw-body capture MUST use.
- `.specstory/config/redaction-schema.json` — schema for the pattern config.
- `scripts/enhanced-redaction-system.js` — current applier (⚠ only applies 4 hardcoded PII regexes today; must be rewired to load the config above).
- `scripts/lsl-file-manager.js` — how the redactor is currently invoked (rotation + compression + redaction integration reference).
- `scripts/validate-lsl-config.js` §`redaction-config.yaml` — the config-validation contract for redaction.

### Prior locked decisions this phase inherits
- `.planning/phases/83-token-reconciliation-layer/83-CONTEXT.md` — D-01 (measured-span-only), D-06 (advisory-only), D-08 (ambient-leak / never-throw), D-09 (OpenAI-wire cache parse), D-12/D-13 (per-span file + thin read API pattern that D-10 mirrors).
- `.planning/phases/82-wire-measurement-foundation/82-CONTEXT.md` — cache split separate from total (D-02), per-request `x-task-id`/`x-agent` binding + `request_id`/`tool_call_id` key (D-03), never-throw contracts.

### Proxy write & read sites (Phase-84 hooks)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — `/v1/messages` tap (~1992–2228; `logTokenCall` ~2201; write-hook site ~2226–2227) and `/api/complete` (~2410–2750; `logTokenCall` ~2676; write-hook site ~2730–2745); existing `perRunBreakdownPath`/`CTX_BREAKDOWN_PATH` (~1595–1600), context-breakdown write (~2070–2090, ~2348–2355), and `GET /api/context-breakdown` read route (~1880–1888); `safeSanitizeTaskId` (~1608–1612).
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts` — `parseUsageCache` (~42–59, Anthropic) + `parseOpenAICache` (~88–100, OpenAI); pure/never-throw cache-split source (D-09).

### Span close & read API (coding repo)
- `scripts/measurement-stop.mjs` — span-close pipeline; reconciliation.json write (~419–480); the gzip-at-close (D-03) and retention-trigger hook site.
- `lib/lsl/token/stop-adapter-registry.mjs` — `captureForegroundTokens` reconcile-mode dispatch at close.
- `lib/vkb-server/api-routes.js` — `handleReconciliation` route (~90, ~605–633) — the exact template for the D-10 `/api/context-turns` pass-through.
- `integrations/system-health-dashboard/server.js` — dashboard backend proxy (`/api/context-breakdown` ~294) — add the mirror line for context-turns.

### ETM observation/digest source (D-07 semantic layer)
- ETM live observations + digests (the semantic "what is this turn doing" layer). Correlation to a proxy request is a **research hand-off** (see below) — the store is queried at span close by task_id + timestamp window.

### UI
- `integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx` — the existing explainer to extend (D-11).
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — `fetchTimeline` thunk + selectors; template for `fetchContextTurns`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`perRunBreakdownPath` + `safeSanitizeTaskId`** (proxy `server.mjs`): per-task file-isolation naming + never-throw task-id guard — reuse for the context-turns file path.
- **`parseUsageCache` / `parseOpenAICache`** (`src/usage-cache.ts`): pure cache-split helpers — the sent/cached/fresh numbers already flow through here; Phase 84 inherits them, no new parsing.
- **`handleReconciliation`** (`api-routes.js`): the verbatim-serve + graceful-ENOENT read-API pattern to copy for `/api/context-turns`.
- **`context-cache-explainer.tsx`**: already renders per-turn cache splits + a context-window anatomy band + biggest-turn billing breakdown from the timeline — extend rather than replace.
- **gzip helpers** in `scripts/live-logging-coordinator.js` / `scripts/lsl-file-manager.js` — reuse for the span-close gzip (D-03).
- **`.data/measurements/<task_id>/`** directory convention (Phase 83) — the context-turns files co-locate here.

### Established Patterns
- **Never-throw / best-effort** on all write hooks and sweeps (D-06/D-08 lineage). Any failure → stderr, never blocks a span or the daemon.
- **Thin read API serves a per-task file verbatim** (D-13) — no re-shaping in vkb-server; the dashboard just proxies.
- **launchd sweeper for retention** — the project already runs several `com.coding.*` StartInterval sweepers; the context-turns sweeper follows that install/convention (`scripts/install-*-launchd.sh`).
- **Redux thunk+selector per read surface** (`fetchTimeline`/`selectTimelineFor`) — mirror for context-turns.

### Integration Points
- New `logContextTurn(...)` call sites: proxy `server.mjs` right after `logTokenCall` on both `/v1/messages` (~2226) and `/api/complete` (~2730).
- Gzip + retention-trigger at span close in `measurement-stop.mjs` (~419–480), beside the reconciliation write.
- New route in `api-routes.js` + mirror proxy line in dashboard `server.js`.
- ETM observation/digest lookup at span close (or at read time) for the D-07 semantic reference.
</code_context>

<specifics>
## Specific Ideas

- **"Use live observations to explain what a turn is doing."** The operator explicitly wants the per-turn explanation sourced from the ETM semantic layer (observations/digests) rather than raw content, with the short preview only as a last-resort fallback "before we have nothing at all." This is the distinctive ask of the phase — the schema should treat the observation reference as the primary explanation field.
- **"Don't reinvent the wheel"** on redaction — reuse the configured LSL redaction that already keeps session logs clean (`.specstory/config/redaction-patterns.json`).
- **Honest measurement is a hard value** — for OpenAI-wire agents, show "N/A (provider limitation)" rather than a fabricated cache-write number.
</specifics>

<deferred>
## Deferred Ideas

- **Richer per-turn UI** (per-turn detail panel with tool-arg drill-down, stacked context-window band, cache-breakpoint visualization) — **Phase 86 (Timeline v2)**.
- **Line-size ceiling / pagination on the read API** for very large spans — not decided this phase; spans are typically tens of requests so the file stays small. Revisit if a span's context-turns file grows unwieldy.

**Research hand-offs (for gsd-phase-researcher, not user decisions):**
- **Turn → ETM observation correlation rule.** ETM observations are keyed per **prompt-set/session + time**, not per **request_id/tool_call_id** — so the turn→observation link is a time+task_id correlation (one observation may span several proxy requests), not a hard join. Research must pin the correlation rule and confirm the ETM store is queryable at span-close time; the D-07 preview fallback covers turns where no observation lands.
- **Cache-write inference explicitly rejected (D-12)** — researcher should not resurface it.

### Reviewed Todos (not folded)
The `todo.match-phase` scan surfaced 15 low-score (0.2–0.6) todos, all VKB / observability / km-core items (e.g. obs-api SIGTERM crash, VKB legend/ontology bleed, LSL timeline truncation). None are about per-turn context persistence or the cache explainer — reviewed and **not folded**; they belong to their own VKB/observability workstream, not Phase 84.

</deferred>

---

*Phase: 84-per-turn-context-revelation*
*Context gathered: 2026-07-07*
