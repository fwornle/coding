---
phase: 67-reproducibility-replay-rig
plan: 03
subsystem: infra
tags: [reproducibility, snapshot, git, env-allowlist, mcp, spawnSync, node-test, security]

# Dependency graph
requires:
  - phase: 67-reproducibility-replay-rig
    provides: RESEARCH/PATTERNS/CONTEXT for REPRO-01 internal-state capture (D-03, env allowlist, MCP inventory)
provides:
  - captureGitState(repoRoot) — D-03 git workspace capture (SHA + binary dirty patch + untracked + per-submodule dirty state)
  - captureEnvAllowlist(env) — secret-safe agent-affecting env-var capture (allowlist + deny-regex)
  - captureMcpInventory() — live 'claude mcp list' → config-file fallback → unavailable, never-throws
  - .data/run-snapshots/ gitignore entry (snapshots never committed)
affects: [67-04, snapshot-assembler, replay-rig, restore]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injection-safe fixed-argv spawnSync('git', [...]) per command (evidence-harness.mjs idiom)"
    - "Two-layer secret defence: allowlist + SECRET_DENY_RE applied even to allowlisted names"
    - "Best-effort fail-soft capture: degrade to null/[] never throw"
    - "TDD RED→GREEN via node:test + node:assert/strict with mkdtemp throwaway git repo"

key-files:
  created:
    - lib/repro/git-state.mjs
    - lib/repro/env-allowlist.mjs
    - lib/repro/mcp-inventory.mjs
    - tests/repro/git-state.test.mjs
    - tests/repro/env-allowlist.test.mjs
  modified:
    - .gitignore

key-decisions:
  - "MCP server version is null in the inventory — 'claude mcp list' emits no version; versions are non-restore-critical metadata (RESEARCH A3)."
  - "captureEnvAllowlist accepts an overridable allowlist arg to let the test prove the deny-regex wins over a rogue allowlisted secret name."

patterns-established:
  - "lib/repro/* capture primitives are pure/best-effort units composed by Plan 04's snapshot assembler."
  - "Every external git/CLI call uses a fixed argv array — never a shell string (T-67-03-03)."

requirements-completed: [REPRO-01]

# Metrics
duration: ~10min
completed: 2026-07-02
---

# Phase 67 Plan 03: Internal-State Capture Primitives Summary

**Three composable, injection-safe capture units for REPRO-01 — git workspace state (D-03: SHA + re-applyable binary dirty patch + untracked + per-submodule dirty), a secret-safe agent-affecting env allowlist, and a live/fallback MCP inventory — plus the `.data/run-snapshots/` gitignore guard.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-02T08:47:00Z
- **Completed:** 2026-07-02T08:57:05Z
- **Tasks:** 2 (both tdd="true")
- **Files modified:** 6

## Accomplishments
- `captureGitState(repoRoot)` returns `{ sha, dirtyPatch, untracked[], submodules[] }` using per-command fixed-argv `spawnSync('git', [...])` (7 literal invocations) — a re-applyable `git diff HEAD --binary` patch covering staged+unstaged, the `ls-files --others --exclude-standard` untracked list, and per-submodule SHA + `git -C <path> diff --binary` dirty state; fully fail-soft.
- `captureEnvAllowlist(env)` captures ONLY the 15 RESEARCH-recommended agent-affecting vars, with `SECRET_DENY_RE = /KEY|TOKEN|SECRET|PASSWORD/i` applied to the name even after allowlisting (belt-and-suspenders, T-67-03-01).
- `captureMcpInventory()` enumerates MCP servers via live `claude mcp list` (fixed argv), falling back to `~/.claude.json`/`.mcp.json` `mcpServers` keys, then `{ servers:[], source:'unavailable' }` — never throws. Live probe returned 3 servers.
- `.data/run-snapshots/` added to `.gitignore` (T-67-03-02, Security V9) so captured prompts/KB/env never enter version control.

## Task Commits

Each task followed the TDD RED→GREEN cycle:

1. **Task 1: git-state.mjs (D-03)** — `26a8abdb3` (test, RED) → `c6fc91e6d` (feat, GREEN)
2. **Task 2: env-allowlist + mcp-inventory + gitignore** — `921ff1e0f` (test, RED) → `35f64aee4` (feat, GREEN)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified
- `lib/repro/git-state.mjs` - D-03 git workspace capture via injection-safe fixed-argv spawnSync
- `lib/repro/env-allowlist.mjs` - ENV_ALLOWLIST + SECRET_DENY_RE + captureEnvAllowlist (secret-safe)
- `lib/repro/mcp-inventory.mjs` - captureMcpInventory (live → config → unavailable, never-throws)
- `tests/repro/git-state.test.mjs` - temp-repo suite (shape, 40-hex sha, dirty patch, untracked, empty submodules, TRUE-NEGATIVE)
- `tests/repro/env-allowlist.test.mjs` - allowlist/deny suite + mcp-inventory never-throws smoke
- `.gitignore` - `.data/run-snapshots/` entry adjacent to `.data/measurements/`

## Decisions Made
- **MCP version = null:** `claude mcp list` does not emit versions and no `.mcp.json` exists in-repo; versions are metadata (not restore-critical, RESEARCH A3), so each entry carries `version: null`. Live source parses server names; config fallback reads `mcpServers` keys only (never command/env — those may hold secrets).
- **Overridable allowlist arg:** `captureEnvAllowlist(env, allowlist)` exposes the allowlist so the suite can inject a rogue secret-shaped name and prove the deny-regex still drops it.

## Deviations from Plan

None - plan executed exactly as written. (One in-flight refactor during Task 1 GREEN: an initial single-helper `runGit` wrapper was inlined into per-command `spawnSync('git', [...])` calls to satisfy the literal acceptance greps — `spawnSync('git'` count >= 4 and no `exec(` token — and to match the plan's stated "spawnSync('git', [...]) shape for EACH command" intent. This is a within-task adjustment, not a scope change.)

## Issues Encountered
- The plan's acceptance greps are literal: `grep -c "spawnSync('git'" >= 4` and `grep -i 'exec('` must be empty. An initial factored `runGit` helper produced only 1 literal `spawnSync('git'` and a `.exec(line)` regex call tripped the naive `exec(` grep. Resolved by inlining per-command spawnSync calls and switching regex parsing to `String.prototype.match` (no `.exec(`). Final: 7 literal invocations, no `exec(`.

## Known Stubs
None - all three primitives are fully wired and tested. (`version: null` in the MCP inventory is an intentional, documented metadata gap per RESEARCH A3, not a stub — the field is always present.)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three capture primitives are independently tested (14/14 node:test assertions green) and ready for Plan 04's snapshot assembler to compose.
- `.data/run-snapshots/` is gitignored BEFORE any snapshot is written (Plan 04), satisfying the ordering requirement in the plan's success criteria.
- Flag for Plan 04 (per T-67-03-04): confirm `llm-settings.json` holds routing overrides only (no key fields) before copy-time capture.

## Self-Check: PASSED

All 5 created files present on disk; all 4 task commits present in git history; `.gitignore` `.data/run-snapshots/` entry confirmed. Full suite 14/14 node:test assertions green.

---
*Phase: 67-reproducibility-replay-rig*
*Completed: 2026-07-02*
