# Phase 83: Token Reconciliation Layer - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire rows (proxy `token_usage`, live since Phase 82) become the **primary** token source for claude/copilot foreground tokens inside measured spans. The transcript adapters (cladpt/copadt in `lib/lsl/token/stop-adapter-registry.mjs`) gain a new `reconcile` mode that **verifies and enriches** wire rows instead of double-inserting: transcript rows match wire rows by request-id (time+model fuzzy fallback for retry mismatches); per-span discrepancies land in `.data/measurements/<span>/reconciliation.json` written by `scripts/measurement-stop.mjs`; transcript fallback is preserved for proxy-down windows; copilot's cache split merges from session-state into wire rows. Zero double-counting.

Also folds in the reconciliation-adjacent Phase-82 review findings (CR-01, WR-01, WR-06, IN-05, duplicate-id constraint) — see decisions.

Out of scope: per-turn context-turns persistence (Phase 84), dashboard-triggered runs (Phase 85), dashboard reconciliation badge + timeline (Phase 86), avenues (Phase 87), making reconcile mode the interactive-path default (later phase).

</domain>

<decisions>
## Implementation Decisions

### Rollout scope
- **D-01: Reconcile mode applies to measured spans only.** `measurement-stop` invokes the adapters in reconcile mode; the interactive Stop/sweep path keeps today's transcript+dedup-merge behavior unchanged. The per-span sink has a natural home; interactive double-count remains prevented by the Phase-82 dedup-merge.
- **D-02: Proxy-down fallback is match-outcome driven, with provenance.** Any transcript row with no wire match (request-id, then fuzzy time+model) inserts as fallback, tagged with fallback provenance and counted in reconciliation.json. No health-infrastructure gating — a matching bug shows up loudly as a high fallback count rather than silently double-counting. `:reason:` rows always insert (wire never carries reasoning-step splits).
- **D-03: Copilot BYOK env is gated to measured launches only.** `COPILOT_PROVIDER_*` exports move out of the unconditional `copilot.sh` path into measured-launch wiring (experiment cells / active span). Interactive copilot returns to copadt-only capture — kills the WR-02 interactive double-writer AND fixes WR-05's dead-URL fail-soft break in one move.

### Discrepancy policy & tolerance
- **D-04: Fill gaps only.** Wire values are authoritative and never overwritten. Transcript enriches only fields the wire row lacks (`reasoning_tokens`, `granularity_tier`, `parent_call_id`, cache split when wire has 0 and transcript has data). Count disagreements are recorded, never applied. Mirrors the Phase-82 dedup-merge philosophy.
- **D-05: Record all deltas, flag beyond tolerance.** Every nonzero per-field delta on a matched pair is recorded per-request; deltas beyond a tolerance (suggested: >2% or >50 tokens per field, whichever is larger — planner may calibrate against real Phase-82 matched-pair data) get `flagged: true` and roll up into the span summary.
- **D-06: Discrepancies are advisory only.** A flagged discrepancy never fails or invalidates a run; it is recorded and surfaced later (Phase 86 badge). No run-taint marker this phase.

### 82-REVIEW fold-ins (all confirmed in scope)
- **D-07: CR-01** — guard both unguarded `sanitizeTaskId` call sites in the proxy HTTP handler (tap header path ~server.mjs:1999, shim task-path segment ~:2243-2244). Malformed `x-task-id` must never crash the proxy daemon.
- **D-08: WR-01** — kill the interactive-session ambient-span leak on the `/v1/messages` tap path, so interactive rows no longer inherit a concurrent cell's task_id. Prerequisite for a meaningful golden comparison under concurrency.
- **D-09: IN-05** — parse OpenAI-wire cache fields (`prompt_tokens_details.cached_tokens` etc.) on the shim path so copilot/opencode wire rows carry real cache splits; the copadt session-state merge then covers only what the wire genuinely lacks.
- **D-10: WR-06** — unify task-id sanitization across the three binding seams (raw DB task_id / raw in-memory `_ctxMaxByTask` key / sanitized breakdown filename) so the same logical id keys identically everywhere; restores the DB↔breakdown-file join reconciliation depends on.
- **D-11: Duplicate-id fix folds in** — add the missing PK/unique constraint (or coordinated id allocation) across the tap and adapter writers in `token_usage`. The matcher makes row identity load-bearing.
- WR-02 (copilot double-writer) is discharged by the phase core (copadt reconcile + D-03). NOT folded: WR-03 (SSE `delta.tool_calls` index field), WR-04 (`supportsFunctionCalling` unconditional claim) — deferred.

### reconciliation.json shape & access
- **D-12: Summary + per-request detail.** Top-level span summary (matched / unmatched_wire / unmatched_transcript / fallback-inserted counts, per-field aggregate deltas, flagged count) PLUS a per-request array with match method (request-id vs fuzzy), per-field deltas, and flags. Self-contained for debugging; spans are tens of requests so the file stays small.
- **D-13: File + thin read API.** `GET /api/experiments/runs/:taskId/reconciliation` in `lib/vkb-server/api-routes.js` serves the file verbatim (the dossier already lists api-routes.js as a Phase-83 surface). Phase 86's badge then needs zero backend work.

### Claude's Discretion
- Exact tolerance values for D-05 (calibrate against real matched-pair deltas, e.g. the Phase-82 82-06 verification data).
- Fuzzy-match window width and tie-breaking for the time+model secondary matcher.
- reconciliation.json exact field names / schema versioning.
- copadt session-state cache-split merge mechanics (time-window width, provenance field shape).
- Implementation approach for the duplicate-id constraint (SQLite migration mechanics, collision-repair of existing rows if needed).
- Whether the D-03 BYOK gating lives in `launch-agent-common.sh` `configure_proxy_routing()` or `experiment-runner.mjs` (or both).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Program research (the WHY and verified facts)
- `.planning/research/uniform-measurement-dossier.md` — program plan; § "Phase 81 — Reconciliation layer" (dossier numbering = ROADMAP Phase 83) is the authoritative sketch: reconcile mode, request-id + fuzzy matching, copadt cache merge, sink, golden-comparison verification
- `.planning/research/proxy-infra-report.md` — proxy endpoints/taps, schema, adapters, span mechanism (file:line map)
- `.planning/phases/82-wire-measurement-foundation/82-CONTEXT.md` — Phase-82 decisions this phase builds on (dedup-merge semantics, header binding, BYOK env shape)
- `.planning/phases/82-wire-measurement-foundation/82-REVIEW.md` — CR-01 / WR-01 / WR-02 / WR-05 / WR-06 / IN-05 findings folded into or discharged by this phase (exact repro + suggested fixes inline)

### Code surfaces
- `lib/lsl/token/stop-adapter-registry.mjs` — STOP_ADAPTERS (claude/copilot `mode: 'transcript'`, opencode/mastra `stamp-only`), `captureForegroundTokens` (:330) — the reconcile mode lands here; the no-double-count invariant docblock (:80-85) is the contract to preserve
- `lib/lsl/token/token-db.mjs` — `insertTokenRowDeduped` (:205, Phase-82 merge-on-cache semantics), dedup natural key `(user_hash, tool_call_id)` (:177-198), `ensureCacheColumns` (:71,111)
- `scripts/measurement-stop.mjs` — invokes the adapters at span close; writes the reconciliation sink
- `scripts/launch-agent-common.sh` — `configure_proxy_routing()` + the copilot BYOK exports to gate (D-03)
- `bin/agents/copilot.sh` (or equivalent) — unconditional BYOK exports to remove per WR-05/D-03
- `lib/experiments/experiment-runner.mjs` — `configureProxyRoutingEnv` (cell-side BYOK wiring stays)
- `lib/vkb-server/api-routes.js` — D-13 read API home
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — CR-01 guard sites (~:1999, ~:2243-2244), WR-06 seams (~:2276, :2293, :2315, :1592), IN-05 shim usage parse, WR-01 tap ambient-span logic
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` — D-11 constraint home (compiled to dist/ via `npm run build`)

### Project rules
- `CLAUDE.md` § km-core LLM proxy endpoint (port 12435 contract), § launchd daemons (`launchctl kickstart com.coding.llm-cli-proxy`)
- Memory `reference_llm_proxy_override_fallback` — confirm coordinator :3034 location=open BEFORE kickstart after proxy edits

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase-82 dedup-merge (`insertTokenRowDeduped` UPDATE-in-place on richer incoming rows) — the reconcile matcher generalizes this; same fields, same authority direction (D-04)
- `captureForegroundTokens` dispatch on `STOP_ADAPTERS[agent].mode` — `reconcile` slots in as a third mode next to `transcript`/`stamp-only`
- Phase-82 wire-verify experiment specs (claude + opencode 2-cell concurrent) — template for the golden-comparison acceptance run
- `sanitizeTaskId` (proxy `dist/measurement-span.js:83-99`) — existing validator; D-07/D-10 wrap it, don't replace it

### Established Patterns
- Additive, PRAGMA-guarded idempotent SQLite migrations (token-db.mjs / token-usage.ts must stay mutually idempotent)
- Provenance via `process` / `user_hash` stamping conventions (`cladpt`, `copadt`, `token-adapter-<agent>`)
- Proxy deploy loop: edit → `npm run build` in rapid-llm-proxy → `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`
- Live-gate acceptance with human checkpoints (Phase-82 house style; golden comparison is this phase's gate)

### Integration Points
- `measurement-stop.mjs` → adapter invocation → reconciliation.json write (same span-close path that writes run/score artifacts)
- vkb api-routes.js already proxies experiment run artifacts — reconciliation route follows the same pass-through pattern
- Dedup natural key `(user_hash, tool_call_id)`: wire rows and transcript rows carry DIFFERENT user_hash values by design — the reconcile matcher must join on request-id across user_hash boundaries, not reuse the dedup probe

</code_context>

<specifics>
## Specific Ideas

- Golden comparison (dossier, verbatim): routed claude cell totals == pre-change transcript-only totals; proxy-down cell → full transcript fallback; healthy span shows `unmatched_wire=0`.
- 82-06 follow-up evidence for calibration: claude cache_read wire-vs-cladpt matched within 47946–72264 range on the v2 verify run — real matched-pair data exists for D-05 tolerance calibration.
- Known duplicate-id evidence: duplicate `id` values between the `/v1/messages` tap writer and adapter writers (82-06 follow-up #1) — repair/constraint per D-11.
- WR-05 fix shape (from 82-REVIEW): move BYOK exports out of `agent_pre_launch` into the health-gated `configure_proxy_routing` copilot branch, or have the unhealthy branch explicitly `unset COPILOT_PROVIDER_*`.

</specifics>

<deferred>
## Deferred Ideas

- WR-03 (SSE reframe emits `delta.tool_calls` without OpenAI-required `index`) — tool-passthrough correctness, not reconciliation; backlog
- WR-04 (SDK `CopilotProvider.supportsFunctionCalling` unconditionally true while proxy-bridge path drops tools) — backlog
- Reconcile mode for the interactive Stop/sweep path (uniform rollout) — later phase, after measured-span soak
- Dashboard reconciliation badge — Phase 86 (read API from D-13 is ready for it)
- Re-validating past shim-routed opencode experiment results (v7–v9) — carried from 82-CONTEXT, still backlog

### Reviewed Todos (not folded)
- Todo scan for this phase returned only keyword-noise matches (OKM API contract bridge, VKB filter asymmetry, hierarchy wire-up, console.log cleanup, orphan digest refs, LSL timeline cap) — none relate to token reconciliation; none folded.

</deferred>

---

*Phase: 83-token-reconciliation-layer*
*Context gathered: 2026-07-06*
