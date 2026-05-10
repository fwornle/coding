---
phase: 34-proxy-supervision-and-etm-cleanup
plan: 01
subsystem: infra
tags: [health-coordinator, llm-cli-proxy, launchd, auto-heal, config]

# Dependency graph
requires:
  - phase: 33-health-coordinator
    provides: "rules-schema validation (AC #10) + loadRules() reload via POST /health/refresh"
provides:
  - "auto_heal=true on services.llm_cli_proxy in config/health-verification-rules.json"
  - "cooldown.{max_kickstarts:3, window_seconds:300} block on the llm_cli_proxy rule"
  - "operator-driven kill-switch (D-07): toggle auto_heal=false + POST /health/refresh"
affects:
  - 34-03-auto-heal-fsm
  - 34-04-action-rewrite

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "config-driven kill-switch: operator flips a boolean and reloads via existing /health/refresh"
    - "per-rule cooldown spec colocated with the rule (vs global auto_healing.cooldown_config)"

key-files:
  created: []
  modified:
    - "config/health-verification-rules.json — llm_cli_proxy rule: auto_heal flipped + cooldown block added + description/note refreshed"

key-decisions:
  - "D-06 numbers: 3 kickstarts / 300s window — encoded directly on the rule (Plan 34-03 reads cooldown.max_kickstarts / cooldown.window_seconds)"
  - "D-07 kill-switch: rely on existing loadRules() + POST /health/refresh — no new endpoint, no coordinator restart"
  - "Per-rule cooldown shape (cooldown.{max_kickstarts, window_seconds}) — distinct from the global auto_healing.cooldown_config block; the FSM in Plan 34-03 reads the per-rule shape"

patterns-established:
  - "Pattern: per-rule cooldown spec — co-locate cooldown numbers with the rule that uses them; Plan 34-03 evaluateAutoHealFSM() reads cooldown.max_kickstarts/window_seconds straight off the rule object"
  - "Pattern: config-driven kill-switch — flip auto_heal=false in config + POST /health/refresh disables auto-heal at runtime without a coordinator restart"

requirements-completed:
  - "R4-partial"

# Metrics
duration: ~5min
completed: 2026-05-10
---

# Phase 34 Plan 01: llm_cli_proxy auto-heal kill-switch + cooldown spec

**Flipped `services.llm_cli_proxy.auto_heal` to true and added the per-rule `cooldown.{max_kickstarts:3, window_seconds:300}` block in `config/health-verification-rules.json` so Plan 34-03's auto-heal FSM has a config-driven kill-switch (D-07) and the cooldown numbers (D-06) it will read at runtime.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-10T04:45:00Z
- **Completed:** 2026-05-10T04:50:19Z
- **Tasks:** 1/1
- **Files modified:** 1

## Accomplishments
- `services.llm_cli_proxy.auto_heal`: `false` -> `true` (the D-07 runtime kill-switch is now armed; operator can flip it back to `false` and `POST http://localhost:3034/health/refresh` to disable auto-heal without bouncing the coordinator)
- Added `services.llm_cli_proxy.cooldown` block with `max_kickstarts: 3` and `window_seconds: 300` (the D-06 numbers Plan 34-03 `evaluateAutoHealFSM()` will read off the rule)
- Refreshed the `description` to document the upcoming tier-pinned semantic probe (POST `/api/complete` with `provider:'copilot', tier:'haiku'`, single-token `'OK'` prompt every 60s)
- Refreshed the `auto_heal_note` to document the Phase 34 launchctl path (`launchctl kickstart -k gui/$UID/com.coding.llm-cli-proxy`) and the kill-switch usage
- Schema unchanged — Phase 33 AC #10 `rules-schema.test.mjs` still passes (3/3)

## Task Commits

1. **Task 1: Flip auto_heal to true and add cooldown block under services.llm_cli_proxy** — `a6397bd22` (feat)

## Files Created/Modified
- `config/health-verification-rules.json` — `services.llm_cli_proxy` rule body replaced (auto_heal flipped, cooldown block added, description + auto_heal_note refreshed). No other rule touched; rule schema unchanged.

## Decisions Made
None new — the plan codified existing decisions D-06 (cooldown numbers) and D-07 (config-driven kill-switch). This commit just lands them in the config file.

## Verification Performed

All acceptance criteria from the plan were verified:

- `node -e "...JSON.parse..."` assertion script printed `OK` and exited 0 (auto_heal=true, cooldown.max_kickstarts=3, cooldown.window_seconds=300, auto_heal_action='restart_llm_cli_proxy')
- `node -e "...console.log(JSON.stringify(...cooldown))"` printed exactly `{"max_kickstarts":3,"window_seconds":300}`
- `grep -c '"auto_heal": true' config/health-verification-rules.json` increased by 1 (12 -> 13)
- `grep -A8 '"llm_cli_proxy":' ... | grep -c '"auto_heal": true'` returned 1 (precision check; the `-A2` window from the plan was tight to the OLD rule layout — under the NEW layout the `auto_heal` key sits 7 lines below the rule key because `description` is on its own line, so a wider `-A8` window is needed; the substantive precision claim — only the llm_cli_proxy rule was flipped — holds, as `git diff` confirms)
- `node --test scripts/__tests__/health-coordinator/rules-schema.test.mjs` exited 0 (3 tests pass: SPEC R8 top-level structure preserved, D-06 bind_mount_freshness deletion preserved, D-08 supervisord_status deletion preserved)
- `git diff --stat` shows only `config/health-verification-rules.json` changed (7 insertions, 3 deletions, all confined to the llm_cli_proxy block)
- The Phase 33 AC #10 test file is `rules-schema.test.mjs` (not `.js` as the plan text wrote); both spellings refer to the same test — no functional impact, but worth noting for future plan editors.

## Deviations from Plan

None — plan executed exactly as written. The `.js` vs `.mjs` extension typo in the plan's verification snippet is a documentation typo, not a deviation in behavior; the test ran clean.

## Issues Encountered
None.

## User Setup Required

None. The kill-switch operates entirely on a checked-in config file. To exercise it manually:

```bash
# Disable auto-heal at runtime (kill-switch):
# 1. Edit config/health-verification-rules.json -> set services.llm_cli_proxy.auto_heal: false
# 2. Reload rules:
curl -fs -X POST http://localhost:3034/health/refresh
```

(The reload endpoint is the existing Phase 33 surface — no new endpoint added in this plan.)

## Next Phase Readiness
- Plan 34-02 (semantic probe in coordinator): independent of this change; can proceed in parallel.
- Plan 34-03 (auto-heal FSM): unblocked — the FSM will read `services.llm_cli_proxy.cooldown.{max_kickstarts, window_seconds}` directly off the rule object, and the `auto_heal === true` gate now lets it dispatch.
- Plan 34-04 (rewrite `restart_llm_cli_proxy` action body): unblocked — the rule still references `auto_heal_action: "restart_llm_cli_proxy"`, so the action handler key Plan 34-04 rewrites is in place.

## Self-Check: PASSED

- File exists: `config/health-verification-rules.json` (FOUND)
- Commit exists: `a6397bd22` (FOUND in `git log --oneline`)
- All plan acceptance criteria verified above

---
*Phase: 34-proxy-supervision-and-etm-cleanup*
*Plan: 01*
*Completed: 2026-05-10*
