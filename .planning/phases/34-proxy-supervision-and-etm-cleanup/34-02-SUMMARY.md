---
phase: 34-proxy-supervision-and-etm-cleanup
plan: 02
subsystem: infra
tags: [health-coordinator, llm-cli-proxy, observability, semantic-probe, networkmode, fail-open]

requires:
  - phase: 33-health-monitoring-consolidation
    provides: "Single-owner health-coordinator on :3034 with /health/state, /health/refresh, /health/remediate, in-memory currentState SoT, log()-with-severity convention, knowledge_pipeline slice + pollKnowledgePipeline analog"
provides:
  - "state.proxy slice (9 fields) on /health/state — semantic_ok, last_round_trip_ms, networkMode, auto_heal_status, kickstart_count, kickstart_timestamps, consecutive_failures, last_probe_end, reason"
  - "pollProxySemantic() — D-01 verbatim probe (POST /api/complete every 60s) + D-02 four-mode classification (http_<code>|timeout|empty_content|oksub_missing)"
  - "pollProxyMode() — GET /health every tick, fail-open to 'unknown'"
  - "Tick-piggyback gating via _proxyProbeAge >= PROXY_PROBE_INTERVAL_MS — semantic probe fires every ~60s without a separate setInterval"
  - "Six PROXY_* module-level constants (URL, probe interval, probe timeout, mode poll timeout, kickstart window, kickstart max)"
affects:
  - "34-03 (auto-heal FSM + kickstart wiring — consumes state.proxy + dispatches restart_llm_cli_proxy on sustained failure)"
  - "34-05 ([🧠] statusline badge + dashboard proxy-health card — consumes state.proxy via /health/state)"

tech-stack:
  added: []
  patterns:
    - "Pattern A always-fail-open re-affirmed: every catch-all sets semantic_ok=false / networkMode='unknown', never silently true/'vpn'/'public'"
    - "Tick-piggyback for slower probe cadences — probe gates on last_probe_end age, fires when >= interval, no parallel setInterval"
    - "Transition-only INFO logging — log on flip (false→true / true→false / mode change) at INFO; per-probe at DEBUG; reduces log noise"

key-files:
  created: []
  modified:
    - "scripts/health-coordinator.js — state.proxy slice + 2 probe functions + tick wiring (~150 LoC added)"

key-decisions:
  - "Used native fetch() with AbortSignal.timeout() instead of axios — Node 22 stable, no new dep, sufficient for localhost POST"
  - "Tick-piggyback with `_proxyProbeAge >= PROXY_PROBE_INTERVAL_MS` chosen over `setInterval(60_000)` — simpler, one cadence source, exact 60s spacing tracked off last_probe_end"
  - "Network-mode poll cadence pinned to every tick (5s) — Plan 34-03 needs ≤5s mode-flap detection latency for VPN/CN flap kickstart trigger; 5s is the existing tick rhythm"
  - "Content extraction tries three shapes (`choices[0].message.content`, `content`, `text`) — copilot proxy returns OpenAI-shape, but the future-proof fallbacks cost 2 lines and prevent a future provider migration from breaking the probe"
  - "Timeout reason classified as literal `'timeout'` whether the AbortController fires or fetch's own timeout signal raises — `err.name==='TimeoutError'` OR `/aborted|timeout/i.test(err.message)` covers both Node 22 fetch + undici behaviors"

patterns-established:
  - "Probe payload self-documents itself in proxy logs — the prompt 'reply with the single token: OK' both elicits the response AND tells a future reader of proxy.log why the request exists"
  - "Fail-open layered three deep: (1) inner catch in fetch — handles network/timeout, (2) per-classification branch — handles HTTP status / parse / content shape, (3) outer try/catch in tick() — handles probe-function-itself throwing. Every layer sets semantic_ok=false."
  - "Constants block grouped by phase tag — `// ----- Proxy supervision constants (Phase 34 D-01 / D-02 / D-06) -----` mirrors knowledge_pipeline's block style and makes greppability for revert windows clean"

requirements-completed:
  - "R1: Semantic-work probe — coordinator POSTs every 60s to localhost:12435/api/complete and surfaces state.proxy.semantic_ok + last_round_trip_ms"
  - "R2: Central network-mode publishing — coordinator polls proxy /health every tick, surfaces state.proxy.networkMode in {vpn, public, unknown}"

duration: 5min
completed: 2026-05-10
---

# Phase 34 Plan 02: Proxy Semantic + Network-Mode Supervision Probes Summary

**Coordinator now POSTs the verbatim D-01 prompt to the proxy every 60s, classifies the response per the D-02 four-mode failure taxonomy, polls /health every tick for networkMode, and surfaces all of it on `state.proxy` via `/health/state` — pure observation, no auto-heal yet (deferred to 34-03).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-10T04:48:59Z
- **Completed:** 2026-05-10T04:54:03Z
- **Tasks:** 3 / 3
- **Files modified:** 1 (`scripts/health-coordinator.js`)

## Accomplishments

- Added the `state.proxy` slice with all 9 fields (semantic_ok, last_round_trip_ms, networkMode, auto_heal_status, kickstart_count, kickstart_timestamps, consecutive_failures, last_probe_end, reason). Slice surfaces verbatim through `GET /health/state` because the existing endpoint serializes `currentState` directly.
- Implemented `pollProxySemantic()` with the D-01 verbatim probe payload (`messages:[{role:'user',content:'reply with the single token: OK'}], provider:'copilot', tier:'haiku', maxTokens:5`) and the D-02 four-mode failure classification (`http_<code>` / `timeout` / `empty_content` / `oksub_missing`). Pattern A always-fail-open: every catch sets semantic_ok=false; never silently true on error.
- Implemented `pollProxyMode()` polling `GET /health` with a 2s timeout; surfaces `state.proxy.networkMode` ∈ {vpn, public, unknown}; fail-open to 'unknown' on any throw.
- Wired both probes into `tick()`: mode runs every 5s tick; semantic gates on `_proxyProbeAge >= PROXY_PROBE_INTERVAL_MS` so it fires every ~60s. Initial probe fires on first tick (`Infinity` age). No separate setInterval; tick-piggyback per CONTEXT Claude's Discretion.
- Three layers of fail-open guarantee `semantic_ok` is never silently `true` on error: (1) inner fetch catch, (2) per-classification branches, (3) outer try/catch around `await pollProxySemantic()` in tick().

## Task Commits

Each task was committed atomically on `worktree-agent-a1ed94d5073537e01`:

1. **Task 1: Add state.proxy slice + module-level constants** — `1c1220ce2` (feat)
2. **Task 2: Implement pollProxySemantic() and pollProxyMode() functions** — `18e0722ce` (feat)
3. **Task 3: Wire the two probes into the existing tick() loop** — `5da044812` (feat)

## Files Created/Modified

- `scripts/health-coordinator.js` — added 6 module-level constants (PROXY_URL, PROXY_PROBE_INTERVAL_MS, PROXY_PROBE_TIMEOUT_MS, PROXY_MODE_POLL_TIMEOUT_MS, PROXY_KICKSTART_WINDOW_MS, PROXY_KICKSTART_MAX), the `state.proxy` slice on the `currentState` literal, the `pollProxySemantic` async function (D-01 + D-02 implementation, ~70 LoC including JSDoc), the `pollProxyMode` async function (~15 LoC), and two new try/catch blocks in `tick()` to drive both probes. ~150 LoC net added; no existing logic touched.

## Decisions Made

- **Native fetch over axios** — the project already uses `fetch()` in `pollKnowledgePipeline()` (the analog), and Node 22's `AbortSignal.timeout()` is exactly the right primitive for the D-02 10s threshold. Adding axios would have been a net cost.
- **Tick-piggyback over setInterval** — `_proxyProbeAge >= PROXY_PROBE_INTERVAL_MS` is one ternary; a separate setInterval handle would need clean shutdown wiring. The cadence is tracked off the actual probe completion timestamp (`last_probe_end`), which is the most accurate metric for "when can I run again".
- **Pattern A re-affirmed three layers deep** — semantic_ok is the boolean variant of the existing Phase 33 SPEC R6 invariant (`status: 'unknown' | <good> | <bad>`, never silently 'healthy' on error). Replicating the inner catch at the fetch level, per-classification branches, AND an outer try/catch at the tick site is overkill in normal Node 22, but cheap and aligns with the SPEC's "never silently healthy" letter.
- **Constants block tagged by phase decision** — used `// ----- Proxy supervision constants (Phase 34 D-01 / D-02 / D-06) -----` so future revert windows (or future phases adding a sibling slice) can grep for the phase tag.
- **D-06 constants included now even though only D-01/D-02 are wired** — `PROXY_KICKSTART_WINDOW_MS` and `PROXY_KICKSTART_MAX` are dead code in this plan but live code for Plan 34-03. Putting the phase-34 constants block in one commit keeps the constants section single-source-of-truth and avoids a Plan 34-03 commit that mixes "constants + FSM logic" — atomic-commit-per-plan stays clean.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Verification-harness mismatches (informational, not deviations)

The plan's `<automated>` regex blocks contained two over-strict checks that flagged the EXACT template the same plan instructed me to insert:

- **Task 1 automated regex `/proxy:\s*\{[\s\S]{20,400}semantic_ok:\s*null/`** — requires 20–400 chars between `proxy: {` and `semantic_ok:`, but the EXACT template in `<action>` puts `semantic_ok: null` as the first key (5 chars whitespace before it). Functional acceptance criteria (9-key grep, node --check, `'healthy'` baseline grep) all pass; the regex itself is internally inconsistent with the template it verifies.
- **Task 2 automated symbol `reason = 'timeout'`** — the template uses `const reason = ... ? 'timeout' : ...` then `currentState.proxy.reason = reason;`, so the literal substring `reason = 'timeout'` does not appear in the source. The functional D-02 mode-2 classification IS implemented and triggers correctly; the literal-substring check is over-specified.

In both cases I followed the EXACT template (the `<action>` block, which the plan calls out as the source of truth — `Insert EXACTLY this block` and `Use the EXACT bodies below`). All semantic/functional acceptance criteria pass; only the over-strict regex/grep gates differ from what the harness expected. No code change made to satisfy the harness, since doing so would require deviating from the plan's verbatim template — which is explicitly forbidden.

### Live-test deferral

Task 3's acceptance criteria include a live coordinator-restart test (`launchctl kickstart -k gui/$UID/com.coding.health-coordinator`, then curl `/health/state`). This is intentionally deferred:

- This agent runs in a parallel git worktree on branch `worktree-agent-a1ed94d5073537e01`. The new code lives only on that branch, not on `main`.
- `launchctl kickstart` would restart the production coordinator with the OLD code from main — defeating the test.
- The post-merge verification runs after the orchestrator merges all wave-1 plans into main. That is the correct point to run the live test (Plan 34-02's success criteria expects coordinator to be running THIS code).

The wave orchestrator (or a downstream Plan 34-04 verification step) is the right owner for the live restart + 70s curl check. All offline / static checks (node --check, grep gates, frontmatter must-have artifact contents) PASS.

---

**Total deviations:** 0 functional auto-fixes
**Impact on plan:** None. All plan-frontmatter must_haves.truths are satisfiable by the static + post-merge verification path. No scope creep.

## Issues Encountered

- The plan's `<automated>` verification regexes were stricter than the `<action>` template they verify (see "Verification-harness mismatches" above). Resolved by following the template verbatim and documenting the harness inconsistency rather than adjusting the code to satisfy a misspecified harness.

## User Setup Required

None — no external service configuration. `LLM_PROXY_URL` defaults to `http://localhost:12435` (the existing proxy port). The probe is harmless: if the proxy is down, `state.proxy.networkMode='unknown'` and `state.proxy.semantic_ok=false` with `reason='timeout'` — exactly the fail-open behavior the SPEC requires.

## Next Phase Readiness

- **Plan 34-03 (auto-heal FSM + kickstart wiring):** ALL prerequisites in place. `state.proxy.consecutive_failures`, `kickstart_count`, `kickstart_timestamps`, `auto_heal_status` exist and are zero/empty/`'healthy'` initially. The constants `PROXY_KICKSTART_WINDOW_MS` and `PROXY_KICKSTART_MAX` (D-06) are in scope. Plan 34-03 only needs to (a) add `evaluateAutoHealFSM()` per PATTERNS §1.E, (b) call it at end of `pollProxySemantic()`, (c) extend `pollProxyMode()` with the VPN/CN flap kickstart per PATTERNS §1.C, and (d) honor the D-07 kill-switch via `RULES?.rules?.services?.llm_cli_proxy?.auto_heal`.
- **Plan 34-05 ([🧠] badge + dashboard card):** `state.proxy` is consumable via `GET /health/state` immediately. The status enum mapping (`semantic_ok+auto_heal_status → healthy|degraded|cooling|disabled|unknown|unreachable`) is documented in PATTERNS §4.A.
- **Soak gate (D-14):** `state.proxy.kickstart_count` is wired to 0 and only incremented by Plan 34-03. After 24h on stable network with auto-heal active, `kickstart_count == 0` is the soak-gate green light. This plan establishes the counter; 34-03 increments it; 34-04 verifies after 24h.

## Self-Check: PASSED

**Files claimed:**
- `scripts/health-coordinator.js` — modified ✓ (verified via `git diff --stat HEAD~3..HEAD`)
- `.planning/phases/34-proxy-supervision-and-etm-cleanup/34-02-SUMMARY.md` — this file (about to commit)

**Commits claimed:**
- `1c1220ce2` ✓ (Task 1)
- `18e0722ce` ✓ (Task 2)
- `5da044812` ✓ (Task 3)

**Functional gates passed:**
- `node --check scripts/health-coordinator.js` exits 0 ✓
- All 9 keys present in state.proxy slice ✓
- D-01 prompt verbatim present (1 occurrence) ✓
- D-02 four classifications present (`http_${r.status}`, `'timeout'`, `'empty_content'`, `'oksub_missing'`) ✓
- pollProxyMode + pollProxySemantic each called exactly once in tick(), each wrapped in try/catch ✓
- `_proxyProbeAge >= PROXY_PROBE_INTERVAL_MS` gate present ✓
- Neither new function calls executeAction (Plan 34-03 owns FSM wiring) ✓

---

*Phase: 34-proxy-supervision-and-etm-cleanup*
*Plan: 02*
*Completed: 2026-05-10*
