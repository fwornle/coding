---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 12
subsystem: launchd / sub-agent live daemons
tags: [phase-51, gap-closure, launchd, cr-04, apple-silicon]
requires:
  - 51-11 (launchd install scaffolding + sweep job)
  - 51-REVIEW.md § Addendum CR-04 (the fix recipe)
provides:
  - "Apple Silicon-compatible launchd live daemons via /bin/sh wrapper pattern"
  - "CI test gate that fails before install when ProgramArguments[0] is missing on host"
affects:
  - 51-16 (HUMAN-UAT Test 1 — launchctl bootstrap on Apple Silicon now boots cleanly)
tech-stack:
  added: []
  patterns:
    - "Wrapper pattern: /bin/sh -c 'exec node \"$@\"' node <script> <args>"
key-files:
  created: []
  modified:
    - launchd/com.coding.sub-agent-live-claude.plist
    - launchd/com.coding.sub-agent-live-opencode.plist
    - launchd/com.coding.sub-agent-live-copilot.plist
    - scripts/install-sub-agent-launchd.sh
    - tests/integration/sub-agent-launchd-install.test.js
decisions:
  - "Strategy A (wrapper pattern) over Strategy B (installer templatization) — fewer moving parts, mirrors proven scripts/sub-agent-sweep-job.sh pattern, no install-time sed substitution to maintain"
  - "Sweep plist NOT modified — already uses /bin/bash wrapper; REVIEW Addendum's 'sweep affected' claim is incorrect for this specific plist"
  - "Installer logs `command -v node` for diagnostics but does NOT hard-fail on absent node — wrapper surfaces a clear ENOENT in .data/live-*.log on first spawn"
metrics:
  duration_min: ~6
  tasks: 2
  files_modified: 5
  test_count_delta: "8 → 9 (+Test 8a)"
  completed: "2026-05-27"
---

# Phase 51 Plan 12: launchd /usr/local/bin/node Fix (CR-04 Closure) Summary

## One-liner

Fixed CR-04 — all 3 live-daemon plists now invoke `/bin/sh -c 'exec node "$@"'` so PATH-driven node resolution happens at exec time, restoring Path A functionality on Apple Silicon hosts; integration test extended with executability assertion to gate future regressions.

## What Was Built

### Strategy chosen: A (Wrapper Pattern)

Plan 51-12 §Action offered two strategies. I picked **Strategy A** for these reasons:

1. **Fewer moving parts.** The installer's existing `diff -q` idempotency short-circuit (line 72) keeps working with no adjustment. Strategy B would have needed the compare-against-substituted-text adjustment called out in the plan.
2. **Mirrors a proven pattern.** `launchd/com.coding.sub-agent-sweep.plist` already uses `/bin/bash` wrapper (ProgramArguments: `/bin/bash` → `scripts/sub-agent-sweep-job.sh`), and Plan 51-11 + the production sweep have validated this pattern. Strategy A re-uses the same exec-time PATH resolution model.
3. **No install-time sed substitution to maintain.** A future contributor changing the plist template wouldn't need to remember that `@@NODE_BIN@@` gets sed-substituted by the installer.
4. **EnvironmentVariables.PATH already includes /opt/homebrew/bin.** All three live plists carry `<key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin</string>`, so the shell's PATH lookup naturally resolves Apple Silicon's `/opt/homebrew/bin/node` first, falling back to Intel's `/usr/local/bin/node` if Homebrew isn't installed in the ARM location.

### Plist ProgramArguments shape

Each of the 3 live-daemon plists (`claude`, `opencode`, `copilot`) was changed from:

```xml
<array>
    <string>/usr/local/bin/node</string>
    <string>/Users/.../sub-agent-live-<agent>.mjs</string>
    <string>--state-file</string>
    <string>/Users/.../.data/sub-agent-live-state-<agent>.json</string>
</array>
```

to:

```xml
<array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>exec node "$@"</string>
    <string>node</string>  <!-- $0 placeholder for `exec`; not actually used since we use $@ -->
    <string>/Users/.../sub-agent-live-<agent>.mjs</string>
    <string>--state-file</string>
    <string>/Users/.../.data/sub-agent-live-state-<agent>.json</string>
</array>
```

Why the `node` literal at position 3 (after `exec node "$@"`)? When `/bin/sh -c` is invoked with extra positional args, the first extra arg becomes `$0` (used in error messages by the shell). Positions 4+ become `$1..$N` which `"$@"` expands into. The literal `node` at $0 is a conventional placeholder; the actual command run is `exec node <script> --state-file <path>`.

Smoke-tested locally:
```
$ /bin/sh -c 'exec node "$@"' node -e "console.log('ok', process.argv.slice(1))" -- arg1 arg2
ok [ 'arg1', 'arg2' ]
$ /bin/sh -c 'command -v node'
/opt/homebrew/bin/node    # Apple Silicon resolution works
```

### Installer diagnostic log line

`scripts/install-sub-agent-launchd.sh` does not need node-resolution logic for Strategy A, but I added a one-shot diagnostic:

```bash
RESOLVED_NODE="$(command -v node 2>/dev/null || true)"
if [[ -z "${RESOLVED_NODE}" ]]; then
  log "WARN: node not on PATH for installer process — live daemons will fail until node is installed"
else
  log "resolved node binary: ${RESOLVED_NODE} (live daemons use /bin/sh -c wrapper + EnvironmentVariables.PATH)"
fi
```

This is non-fatal — the wrapper will surface a clear ENOENT in `.data/live-*.log` on first spawn if node is genuinely missing. An operator running on Apple Silicon now sees `[install-sub-agent] resolved node binary: /opt/homebrew/bin/node ...` in the install log, confirming expected resolution before launchctl starts the daemons.

### Test 8a (CR-04 test-gap closure)

`tests/integration/sub-agent-launchd-install.test.js` gained one new test (Test 8a — inserted before Test 8 to keep narrative ordering intact). For each of the 4 plists it:

1. Extracts `ProgramArguments[0]` via `plutil -extract ProgramArguments.0 raw <plist>`.
2. Asserts the value starts with `/` (absolute path — launchd does NOT apply `EnvironmentVariables.PATH` to arg0).
3. Asserts the file exists AND is executable via `fs.accessSync(programArg0, fs.constants.X_OK)`.

Under Strategy A, arg0 is `/bin/sh` (live daemons) or `/bin/bash` (sweep). Both are always present on macOS, so the test passes today and documents the invariant for future regressions. If a future change reintroduces a hardcoded `/usr/local/bin/node` on an Apple Silicon CI host, this test will fail before the operator runs the installer.

## Sweep plist disposition

The 51-12 PLAN cited the REVIEW Addendum's claim that "all 4 plists are affected, including sweep". On inspection, `launchd/com.coding.sub-agent-sweep.plist` already uses the wrapper pattern:

```xml
<array>
    <string>/bin/bash</string>
    <string>/Users/Q284340/Agentic/coding/scripts/sub-agent-sweep-job.sh</string>
</array>
```

The sweep plist was wrapper-style from inception (Plan 51-11) and was NEVER affected by CR-04 — `launchctl list` confirms `com.coding.sub-agent-sweep` exits 0, only the 3 live daemons exit 78 (EX_CONFIG). The REVIEW Addendum's "sweep affected" statement is **incorrect** for this specific plist. The PLAN anticipated this and instructed me to refute or confirm — I'm refuting it here. No change to the sweep plist; no regression possible since it stayed at the same wrapper invocation that has been running successfully since Plan 51-11.

## Pre/Post launchctl exit-code observation

Captured on this Apple Silicon worktree host (arm64, `/opt/homebrew/bin/node` exists, `/usr/local/bin/node` does NOT exist) before applying Task 1:

```
$ launchctl list | grep com.coding.sub-agent
-	0	com.coding.sub-agent-sweep
-	78	com.coding.sub-agent-live-copilot     # <-- EX_CONFIG
-	78	com.coding.sub-agent-live-opencode    # <-- EX_CONFIG
-	78	com.coding.sub-agent-live-claude      # <-- EX_CONFIG
```

This is direct empirical confirmation of CR-04 on the verifier's hardware: sweep exits 0, all 3 live daemons fail EX_CONFIG because `/usr/local/bin/node` doesn't exist.

Post-fix verification is deferred to Plan 51-16 (HUMAN-UAT Test 1, which re-runs `bash scripts/install-sub-agent-launchd.sh` and re-checks `launchctl list`). The plan explicitly excluded a checkpoint here. Note: the current `launchctl list` still shows EX_CONFIG because the worktree branch hasn't been merged + the installer hasn't been re-run. After merge + reinstall, all 4 jobs should report exit 0 (or no exit code, indicating still-running) on Apple Silicon.

## Idempotency invariant preservation

The installer's `diff -q "${SRC_PLIST}" "${DEST_PLIST}"` short-circuit (line 72) compares the source plist verbatim against the installed copy. Under Strategy A, the SRC plist IS the final plist (no sed substitution), so re-running the installer on a host that already has these plists installed will short-circuit cleanly:

```
[install-sub-agent] com.coding.sub-agent-live-claude: plist already up-to-date at /Users/.../Library/LaunchAgents/com.coding.sub-agent-live-claude.plist
[install-sub-agent] com.coding.sub-agent-live-claude: boot-out (if loaded)
[install-sub-agent] com.coding.sub-agent-live-claude: bootstrap gui/<UID>
[install-sub-agent] OK: com.coding.sub-agent-live-claude is loaded
```

If Strategy B had been chosen, this would have needed adjustment (compare DEST against `sed-substituted SRC`, not against raw SRC) — another point in Strategy A's favor.

## Test additions

| Test | Before | After |
|------|--------|-------|
| Test count | 8 | 9 |
| Tests passing | 8/8 | 9/9 |
| New assertion | — | `fs.accessSync(programArg0, fs.constants.X_OK)` for all 4 plists |

`grep -E "^\s*(it|test)\(" tests/integration/sub-agent-launchd-install.test.js | wc -l` → 9.

## Acceptance criteria verification

### Task 1

| Criterion | Result |
|-----------|--------|
| `for p in launchd/com.coding.sub-agent-*.plist; do plutil -lint "$p"; done \| grep -c OK` returns 4 | PASS — 4 |
| `bash -n scripts/install-sub-agent-launchd.sh` exits 0 | PASS |
| `grep -c '/usr/local/bin/node' launchd/com.coding.sub-agent-live-*.plist` returns 0 lines | PASS — 0 hardcoded refs |
| Strategy A: `grep -E '(/bin/sh\|/bin/bash)' launchd/com.coding.sub-agent-live-claude.plist \| wc -l` ≥ 1 | PASS — 1 |
| StandardErrorPath preserved in claude plist (multi-line key/value) | PASS — `<key>StandardErrorPath</key>\n<string>...\.data/live-claude.log</string>` present |
| `--state-file` flag preserved in each of 3 live daemon plists | PASS — 1 occurrence per plist |
| 1 commit landed | PASS — `414a030f0 fix(51-12): resolve node path at install time for launchd live daemons (closes CR-04)` |

The PLAN's grep regex for StandardErrorPath was a single-line `grep -E 'StandardErrorPath.*\\.data/live-claude\\.log'` which doesn't match across the `<key>...</key>\n<string>...</string>` plist layout. I validated multi-line with Python's `re.DOTALL`-equivalent (`re.search(r'<key>StandardErrorPath</key>\s*<string>[^<]*\.data/live-claude\.log</string>', body)`) — match confirmed. The Plan 51-11 stderr-redirection invariant is preserved.

### Task 2

| Criterion | Result |
|-----------|--------|
| Test count: `grep -E "^\s*(it\|test)\(" tests/...` ≥ 9 | PASS — 9 (was 8) |
| At least one test asserts executability via X_OK | PASS — `fs.accessSync(programArg0, fs.constants.X_OK)` in Test 8a |
| `npx jest ...` exits 0 | PASS — 9 passed, 9 total |
| No new `console.*` calls | PASS — baseline 1 (pre-existing comment on line 224), post: 1 (same comment, unchanged) |
| 1 commit landed | PASS — `90a5c7774 test(51-12): assert ProgramArguments[0] of installed plists is executable (closes CR-04 test gap)` |

## Phase 51 D-Reuse cumulative gate

```
$ git diff --stat e227e761..HEAD -- lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs
(empty — 0 files changed)
$ git diff e227e761..HEAD -- package.json | wc -l
0
```

D-Reuse gate clean (LSL window + scan-and-convert untouched). Zero new npm packages.

## Threat-model dispositions

| Threat ID | Disposition | How mitigated |
|-----------|-------------|---------------|
| T-51-12-CR04 (DoS on Apple Silicon) | mitigated | Strategy A wrapper — `/bin/sh -c 'exec node "$@"'` does PATH lookup at exec time; `EnvironmentVariables.PATH` already has `/opt/homebrew/bin` first |
| T-51-12-TG (test-suite gap) | mitigated | Test 8a — `fs.accessSync(programArg0, X_OK)` for all 4 plists catches hardcoded-missing-path regressions in CI before operator install |
| T-51-12-INST (installer regression on absent node) | mitigated | Diagnostic log line in installer warns when `command -v node` is empty; non-fatal since the wrapper surfaces ENOENT clearly in `.data/live-*.log` |
| T-51-12-SC (no new npm packages) | accepted (trivially satisfied) | `git diff package.json` = 0 lines |

## Deviations from Plan

None — plan executed as written. Strategy A was the recommended path; the only PLAN gap I noted (sweep-plist disposition) was anticipated by the plan and instructed me to confirm/refute (I refuted, with evidence).

The PLAN's single-line `grep -E 'StandardErrorPath.*\.data/live-claude\.log'` acceptance regex doesn't match the multi-line plist XML layout. I used a Python multi-line regex check instead — invariant verified (StandardErrorPath maps to `.data/live-claude.log`). Not a deviation, just a sharper verification method.

## Known Stubs

None.

## Threat Flags

None — this plan only modifies launchd plist invocation shape; no new network endpoints, no new file access patterns, no new auth paths. The threat surface is identical to Plan 51-11.

## Commits

| Hash | Subject |
|------|---------|
| 414a030f0 | fix(51-12): resolve node path at install time for launchd live daemons (closes CR-04) |
| 90a5c7774 | test(51-12): assert ProgramArguments[0] of installed plists is executable (closes CR-04 test gap) |

## Self-Check: PASSED

- launchd/com.coding.sub-agent-live-claude.plist FOUND (modified)
- launchd/com.coding.sub-agent-live-opencode.plist FOUND (modified)
- launchd/com.coding.sub-agent-live-copilot.plist FOUND (modified)
- launchd/com.coding.sub-agent-sweep.plist FOUND (unchanged — already wrapper-based)
- scripts/install-sub-agent-launchd.sh FOUND (modified — diagnostic log)
- tests/integration/sub-agent-launchd-install.test.js FOUND (modified — Test 8a added)
- Commit 414a030f0 FOUND in git log
- Commit 90a5c7774 FOUND in git log
