---
status: partial
phase: 46-per-system-documentation-onboarding
source: [46-VERIFICATION.md]
started: 2026-06-09T07:10:00Z
updated: 2026-06-09T07:10:00Z
---

## Current Test

[awaiting operator dry-run]

## Tests

### 1. Operator dry-run of `lib/km-core/docs/ONBOARDING.md` against the live obs-api

**expected:** Steps 0–7 each execute successfully end-to-end against `http://localhost:12436` with the documented "Expected output" lines matching real responses; Step 7c post-cleanup verification returns `0`; the cleanup-verifier vitest spec (`lib/km-core/tests/onboarding/cleanup-verifier.spec.ts`) passes after the live run.

**result:** [pending]

**why_human:** SC-3 ("Verifiable onboarding ... each step verifiable") requires actually running the verifiable steps to confirm the commands work as written. Automation can confirm the file structure (8 `## Step` sections, 13 "Expected output" assertions, mandatory cleanup block, `!!! danger` admonition, cleanup-verifier spec exists) but cannot confirm the obs-api response shapes match what the guide claims without a live run. Plan 46-05 Task 4 was the original checkpoint surface for this; the operator deferred it during Phase 46 close-out so that the docs ship without blocking on a one-time exercise.

**how to verify:**

```bash
# Walk Steps 0–7 in order from /Users/Q284340/Agentic/coding/lib/km-core/docs/ONBOARDING.md
# against the running obs-api. After Step 7 cleanup, run:
cd /Users/Q284340/Agentic/coding/lib/km-core
npx vitest run --config tests/onboarding/vitest.config.ts
# Expect: 1 test passed (1) — confirming the LslHeartbeatRotator entity is absent.
```

If any step's actual output diverges from the documented "Expected output", file a gap. The fix path is: edit ONBOARDING.md, push the km-core submodule, bump the outer pointer, mark this test `resolved`.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
