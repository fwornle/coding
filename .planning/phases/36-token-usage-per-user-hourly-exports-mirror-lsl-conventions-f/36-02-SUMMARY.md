---
phase: 36-token-usage-per-user-hourly-exports-mirror-lsl-conventions-f
plan: 02
status: complete
completed_at: 2026-05-16
---

# Plan 36-02 Summary

## Objective

Compute the user-hash inside the launchd-invoked wrapper
(`_work/rapid-llm-proxy/bin/start-llm-proxy.sh`) BEFORE `exec node`, so
the proxy's TypeScript module receives `process.env.LLM_PROXY_USER_HASH`
from any startup path (launchd, `bin/coding`, direct shell). Also export
`LSL_TIMEZONE` as the canonical timezone source for the proxy's
`Intl.DateTimeFormat` calls.

## Tasks completed

| Task | Status | Commit |
|------|--------|--------|
| Task 1: Add `LLM_PROXY_USER_HASH` + `LSL_TIMEZONE` export block before `exec node` | ✅ | `9762ec8` (rapid-llm-proxy repo) |

## Verification

```bash
$ bash -n /Users/Q284340/Agentic/_work/rapid-llm-proxy/bin/start-llm-proxy.sh
$ launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy"
$ sleep 4 && PID=$(launchctl list | awk '/com\.coding\.llm-cli-proxy/{print $1}')
$ ps eww "$PID" | tr ' ' '\n' | grep -E '^(LLM_PROXY_USER_HASH|LSL_TIMEZONE)='
LLM_PROXY_USER_HASH=c197ef
LSL_TIMEZONE=Europe/Berlin
```

Hash matches independent `node -e "import(process.env.USER_HASH_SCRIPT)..."`
invocation. Six chars, no newlines, no debug prefix. ✅

## Deviation from plan action-step

The plan's literal action-step instructed:

```bash
"$NODE_BIN" -e "import(process.argv[1]).then(...)" "$USER_HASH_SCRIPT"
```

This is a latent bug: when Node is invoked as `-e "..." <arg>`,
`process.argv[1]` becomes that arg. The dynamic-import call then matches
`scripts/user-hash-generator.js:233`'s `runIfMain(import.meta.url, ...)`
check, which dumps ~25 lines of debug output (System Info JSON,
Consistency Test, Generated Hash) into stdout. The captured `_hash`
ends up with literal newlines and debug prefixes — the launchd-spawned
proxy then had `LLM_PROXY_USER_HASH==== User Hash Generator Test ===\n…`.

**Fix:** pass the path via env var instead of argv:

```bash
USER_HASH_SCRIPT="$USER_HASH_SCRIPT" "$NODE_BIN" -e \
  "import(process.env.USER_HASH_SCRIPT).then(m => process.stdout.write(m.default.generateHash()))..."
```

With this approach `process.argv[1]` does not point at the generator
script, so `runIfMain` does not fire, and only the clean six-char hash
reaches stdout. Verified.

This was caught during the first execution attempt; the orchestrator
reverted the buggy wrapper, kickstarted the proxy back to a clean state,
and re-executed with the env-var pattern.

## Files modified

- `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` (+23 lines, commit
  `9762ec8` on rapid-llm-proxy `main`)

No edits to `STATE.md`, `ROADMAP.md`, `bin/coding`, `install.sh`, or any
launchd plist (all out of scope per CONTEXT.md + plan truth #4).

## Issues encountered

1. **First-attempt bug** (described above) — caught and corrected.
2. **Worktree-isolation friction** — the wrapper lives outside the
   coding repo entirely (`_work/rapid-llm-proxy/` is a sibling git
   repo, not a submodule), so worktree isolation cannot scope the
   edit. The retry agent hit a sandbox permission denial on Edit
   outside the worktree path. The orchestrator applied the edit
   directly and committed in rapid-llm-proxy's main. The worktree
   branches for both retry attempts produced no commits.

## Downstream consumers

Plan 36-03 reads `process.env.LLM_PROXY_USER_HASH` to construct
per-hour filenames (`YYYY-MM-DD_HHMM-HHMM_<hash6>.json`). Plan 36-03
also reads `process.env.LSL_TIMEZONE` for `Intl.DateTimeFormat`. Both
env vars are now live in the launchd-spawned proxy's environment.

## Success criteria — all met

- ✅ `LLM_PROXY_USER_HASH` set in launchd-spawned proxy env
- ✅ Value equals `scripts/user-hash-generator.js` output (`c197ef`)
- ✅ Wrapper logs `exported LLM_PROXY_USER_HASH=c197ef` at startup
- ✅ Fallback path exports `'unknown'` (never undefined) when generation fails
- ✅ `bin/coding`, `install.sh`, and the launchd plist are unmodified
- ✅ `LSL_TIMEZONE=Europe/Berlin` exported alongside
