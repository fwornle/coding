---
created: 2026-07-09T02:00:00.000Z
title: Phase 85 deferred code-review findings (8 lower-severity)
area: experiments
source: .planning/phases/85-experiment-control-center/85-REVIEW.md
files:
  - lib/experiments/experiment-executor.mjs
  - lib/experiments/run-launch.mjs
  - lib/vkb-server/api-routes.js
  - scripts/health-coordinator.js
  - lib/experiments/agent-headless.mjs
---

## Problem

Phase 85's code review (85-REVIEW.md) produced 13 findings. The 3 criticals
(CR-01 host-coordinator path traversal, CR-02 unchecked pid group-kill, CR-03
timeout 1000× unit) plus WR-01 (rerun_of dropped) and WR-03 (undefined-argv
crash) were fixed and live-verified during phase close (commits 9615aacf0,
4eb9884a6, f7d907376, b7be5b2fa). The remaining 8 are lower-severity hardening,
deferred by decision — none block the 12 verified D-decisions.

## Deferred findings

- **WR-02 / WR-04 / WR-05 / WR-06** — warnings (WR-04's own mitigation is now
  partly true via the CR-01/CR-02 fixes; WR-05/06 = container-vs-host pid-probe
  disagreement that weakens but no longer breaks the D-02 single-slot guard).
- **4 INFO findings** — see 85-REVIEW.md for specifics.

## Solution

Run `/gsd-code-review 85 --fix` (or a targeted pass) against the remaining
WR-02/04/05/06 + info findings when convenient. Re-verify the D-02 slot guard
end-to-end after WR-05/06.
