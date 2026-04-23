# Phase 24: Port Liveness & Supervisord Checks - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 24-port-liveness-supervisord-checks
**Areas discussed:** Why checks fail, Supervisord visibility, Dashboard truthfulness, Host vs container split

---

## Why Checks Fail

**Finding:** The health verifier already has check rules for most services but they're either disabled or missing:
- Port 3030 check explicitly disabled at health-verifier.js:140-143
- Port 3848 has no check rule at all
- Supervisord status not integrated

No options presented — this was a diagnostic finding, not a choice.

**User response:** Acknowledged root causes

---

## Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Fix and extend | Re-enable disabled checks, add missing rules, add supervisord. Minimal changes. | |
| Audit all rules first | Systematically audit every rule against what runs, fix all gaps in one pass | ✓ |

**User's choice:** Audit all rules first
**Notes:** User wants comprehensive pass, not incremental patching

---

## Supervisord Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Report + auto-restart | Detect FATAL, auto-restart via supervisorctl, log outcome | |
| Report only | Detect and report FATAL/STOPPED as violations, no auto-restart | ✓ |
| Claude decides | Let implementation choose | |

**User's choice:** Report only
**Notes:** Let supervisord's own autorestart policy handle restarts. Verifier's job is detection, not competing restart logic.

---

## Dashboard Display

| Option | Description | Selected |
|--------|-------------|----------|
| Keep grouping, fix data | Same 5 cards with accurate data. Minimal UI change. | |
| Add service detail card | Keep cards + new expandable section with per-port and per-process status | ✓ |
| Claude decides | Choose what best surfaces failures | |

**User's choice:** Add service detail card
**Notes:** Want granular per-service visibility without cluttering the overview

---

## Claude's Discretion

- Supervisord check implementation (exec vs XML-RPC API)
- Config-based vs code-based check rules for new entries
- Health report format for supervisord data

## Deferred Ideas

None
