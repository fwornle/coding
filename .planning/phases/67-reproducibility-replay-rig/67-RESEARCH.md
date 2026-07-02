# Phase 67: Reproducibility & Replay Rig - Research

**Researched:** 2026-07-02
**Domain:** Deterministic run capture/restore + record/replay of external channels (Node.js infra, km-core LevelDB, rapid-llm-proxy, git worktrees)
**Confidence:** HIGH for internal-state capture, LLM tap, and integration surface (all verified against source); MEDIUM-LOW for harness-channel replay (WebSearch/WebFetch/MCP) and byte-exact LevelDB semantics (verified-infeasible-as-written, feasible alternatives identified).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** RunSnapshots live in a per-run directory at `.data/run-snapshots/<task_id>/`.
- **D-02:** KB captured as a full binary copy of the LevelDB directory (`.data/knowledge-graph/`) for byte-exact restore (SC-2) AND the km-core JSON export (`.data/knowledge-graph/exports/*.json`) for portability/inspection.
- **D-03:** Workspace dirty state = git SHA + a git patch of uncommitted changes (not a full working-tree copy). Confirm patch vs stash and binary/untracked handling.
- **D-04:** Restore lands in an isolated git worktree + a sandbox data dir (separate `LLM_PROXY_DATA_DIR`) by default — NEVER touches the live checkout or live KB.
- **D-05:** A `--in-place` flag covers the byte-for-byte-in-live case, gated by automatic backup of current state + explicit confirmation. No unguarded in-place path.
- **D-06:** On a replay miss → hard-fail and surface it. Never silently mix live + recorded responses.
- **D-07:** Request matching = normalized content hash + per-key call ordinal.
- **D-08:** All five channels ship: LLM (via proxy), WebSearch, WebFetch, remote MCP, clock. WebSearch/WebFetch/MCP tap point is the open research question (resolved below).
- **D-09:** Integrate with the Phase 68 measurement span. Snapshot auto-taken at span open (`measurement-start.mjs`), recording ON during the span, fixtures archived at span close alongside the Run. Replay driven by `--replay <snapshot>` flag on `measurement-start.mjs`. Reuses `active-measurement.json` plumbing.

### Claude's Discretion
- Clock virtualization mechanism (freeze-at-snapshot vs monotonic-offset; interception granularity). Must be deterministic on replay.
- env-var allowlist (which vars are "agent-affecting"; capture an allowlist, not the whole env, to avoid leaking secrets).
- MCP inventory capture method (config file read vs live handshake).
- git patch encoding details (binary diffs, untracked files, submodule dirty state).

### Deferred Ideas (OUT OF SCOPE)
- UI for browsing/diffing snapshots (future dashboard phase).
- Cross-machine snapshot portability (LevelDB binary copy is same-host).
- Correcting provider-side non-determinism (temperature/seed drift accepted).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPRO-01 | Snapshot internal state (git SHA + dirty state, `.data/knowledge-graph/` KB, `processOverrides`, MCP inventory + versions, prompt text, `.planning/` state, agent-affecting env vars, agent binary version) and restore byte-for-byte for a repeat run. | Internal-state capture mechanisms verified §"Internal-State Capture", §"Standard Stack". Restore safety §"Restore Safety Mechanics". |
| REPRO-02 | External state (LLM via `rapid-llm-proxy`, WebSearch/WebFetch, remote MCP, clock) recorded during a run and replayable from fixtures; repeated N=1 runs comparable modulo provider non-determinism. | LLM tap fully feasible at proxy §"LLM Channel". Harness channels record-feasible/replay-infeasible §"Harness Channels" — falls back to record-interface-present, replay-hard-fails per channel (honors D-06/D-08). |
</phase_requirements>

## Summary

This phase builds a record/replay rig hooked into the existing Phase 68 measurement span. The research produced three hard conclusions that shape the plan:

1. **The LLM channel is a clean, single chokepoint** — every LLM call flows through the `POST /api/complete` handler at `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1683`. The request shape `{ process, messages, model, taskType?, ... }` and response shape `{ content, provider, model, tokens, latencyMs }` are both buffered single-JSON (non-streaming for the internal contract), giving a textbook record tap (after `result`, before `res.end`, line ~1853-1957) and replay tap (after body parse, before provider chain, line ~1698). D-07 (normalized-hash + ordinal) and D-06 (hard-fail on miss) are directly implementable here. **HIGH confidence.**

2. **The harness channels (WebSearch / WebFetch / remote MCP) cannot be replayed in-process.** These tools execute *inside the Claude Code harness*, which talks directly to Anthropic/remote servers — **not** through `rapid-llm-proxy`. The repo's `WebSearch`/`WebFetch` grep hits are the unrelated in-Docker semantic-analysis `WebSearchAgent` and tool-name string constants, not an interception surface. There is **no in-repo point that can serve a fixture instead of executing a live harness tool.** *Recording* is feasible post-hoc: the Claude transcript JSONL (`~/.claude/projects/-Users-Q284340-Agentic-coding/*.jsonl`) contains `tool_result`/`toolUseResult` blocks (verified: 31 in the current session) and `build-trace.mjs` already reads that directory. So the plan must implement these three channels as **record-interface-present, replay-hard-fails-as-not-yet-captured** exactly per the CONTEXT risk note — do NOT silently drop them (SC-4). **MEDIUM confidence** (record path verified; replay-infeasibility verified structurally).

3. **"Byte-for-byte" KB restore is achievable only as a point-in-time directory copy, not as a reproducible clean-close.** km-core stores the whole graph as a single LevelDB key `graph:state = JSON.stringify(serialized)` (`persistGraph`, persistence.js:65-66), and `persistGraph` only fires on a clean `close()`. LevelDB `.ldb`/`.log`/`MANIFEST` bytes are perturbed by compaction, so two clean-closes of identical logical data are NOT byte-identical. Therefore SC-2 "byte-for-byte" is satisfiable by archiving the directory as-is (tar/`cp -R`) and restoring that same artifact into a sandbox — but taking a *consistent* copy while the single-owner obs-api daemon holds the DB open is the real risk to resolve. **MEDIUM confidence.**

**Primary recommendation:** Build one `lib/repro/` module set (snapshot-capture, snapshot-restore, fixture record/replay) invoked from `measurement-start.mjs` (capture + `--replay`) and `measurement-stop.mjs` (fixture archive + Run linkage via `run-write.mjs`'s already-reserved `snapshot_id` field). Implement the LLM channel fully; ship the four harness/clock channels behind a per-channel capability flag where replay hard-fails when a channel has no viable tap. Default restore into a git worktree + sandbox `LLM_PROXY_DATA_DIR`; gate `--in-place` behind backup+confirm.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Snapshot capture (internal state) | Repo tooling (`lib/repro/` + `scripts/measurement-start.mjs`) | git, filesystem | Reads git/KB/config/env at span open; pure host-side node. |
| KB binary copy + JSON export capture | Storage (km-core LevelDB `.data/knowledge-graph/`) | Repo tooling | The single-owner DB is the source of truth; capture must respect the owner invariant. |
| LLM record/replay | API/Backend (`rapid-llm-proxy` bridge) | Repo tooling (fixture dir) | The proxy is the only LLM chokepoint; record/replay lives at the `/api/complete` boundary. |
| WebSearch/WebFetch/MCP record | Claude Code harness (transcript JSONL) | Repo tooling (transcript scraper) | Tools run in-harness; only observable artifact is the transcript. |
| WebSearch/WebFetch/MCP replay | **No viable tier** | — | Harness cannot be fed synthetic tool results in-repo → interface stub that hard-fails on replay. |
| Clock virtualization | Repo tooling (node processes we control) | — | Can shim `Date` only in node scripts/proxy fixtures; cannot virtualize the harness process clock. |
| Restore into isolated sandbox | git worktree + sandbox data dir | Repo tooling | D-04 safety: never touch live checkout/KB. |
| Fixture archival + Run linkage | KB (`lib/experiments/run-write.mjs`) | Repo tooling | Reuse the `snapshot_id` field already reserved on the Run entity (run-write.mjs:108). |

## Standard Stack

### Core (all Node built-ins + existing repo modules — no new external deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` / `node:fs/promises` | node 20+ | copy dirs (`fs.cpSync`/`cp` with `recursive`), read/write fixtures | Built-in; already the repo idiom (measurement-span.ts, run-write.mjs). |
| `node:child_process` (`execFileSync`) | node 20+ | drive `git` for SHA, patch, worktree, submodule status | Already used across scripts; avoids a git library dependency. |
| `node:crypto` | node 20+ | SHA-256 normalized-request hash (D-07); goal_hash already uses this (measurement-stop.mjs:51,364) | Established pattern in the exact adjacent file. |
| `tar` (system CLI) or `node:zlib`+`fs` | system | archive the LevelDB dir + snapshot bundle | `tar` is present on macOS; a plain `cp -R` dir copy is the simplest byte-exact artifact. |
| `@fwornle/km-core` (`GraphKMStore`, `mintEntityId`) | pinned (lib/km-core submodule `v0.1.0-phase43-...`) | open the experiment store for Run linkage; hydrate a sandbox KB from JSON export | Already the mandated store (store.mjs); MUST pass `ontologyDir` (CLAUDE.md). |
| `_work/rapid-llm-proxy/dist/measurement-span.js` | local dist | `startMeasurement`/`stopMeasurement`/`resolveMeasurementPaths`/`getActiveMeasurement` | The single span reader (measurement-span.ts); measurement-start/stop already import it. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` + `node:assert/strict` | node 20+ | unit tests for capture/record/replay round-trip | **The established `tests/experiments/*.test.mjs` convention** (consequential-events.test.mjs:11-15 explicitly: "node:test + node:assert/strict … NOT jest globals"). |
| `node:readline` | node 20+ | `--in-place` confirmation prompt (D-05) | Reuse the exact `prompt()` helper from measurement-start.mjs:47 / measurement-stop.mjs:135. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `cp -R` dir copy of LevelDB | km-core snapshot API / LevelDB `.getSnapshot()` | km-core exposes no snapshot export; the store is single-owner and can't be opened by a second reader concurrently (Pitfall 5, store.mjs:30). Dir copy is simplest. |
| Hydrate sandbox KB from tar | Hydrate from JSON export via km-core `hydrateFromJsonExports` | JSON-export hydrate is the km-core-native, compaction-independent path (persistence.js hydrate patch prefers JSON) — recommended for the *sandbox restore*; keep the tar as the literal SC-2 artifact. |
| Harness tool replay | Claude Code PreToolUse hook substitution | PreToolUse hooks can *block* but (as of current harness) cannot *inject a synthetic tool result*. `[ASSUMED]` — replay via hooks is not available; record via PostToolUse/transcript is. |

**Installation:** No new external packages. All dependencies are Node built-ins or already-present repo/submodule modules.

## Package Legitimacy Audit

**No external packages are installed by this phase.** All functionality uses Node.js built-in modules (`fs`, `child_process`, `crypto`, `readline`, `zlib`), the system `git`/`tar` CLIs, and already-vendored repo modules (`@fwornle/km-core` via the `lib/km-core` submodule, and the local `rapid-llm-proxy` dist). slopcheck / registry verification is therefore N/A. If the planner later introduces a helper package, run the Package Legitimacy Gate before adding it.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌────────────────────── measurement-start.mjs ──────────────────────┐
                     │  --task-id / --goal / [--replay <snapshot>]                        │
   SPAN OPEN ───────►│  1. startMeasurement()  → .data/active-measurement.json           │
                     │  2. captureSnapshot(task_id) ──┐                                   │
                     │  3. if --replay: arm replay ───┼──► .data/active-measurement.json  │
                     └────────────────────────────────┼──  { ..., replay_from, record }  │
                                                       ▼
        ┌──────────────── captureSnapshot writes .data/run-snapshots/<task_id>/ ─────────┐
        │  git-sha.txt, dirty.patch (+binary), untracked/, submodules.json               │
        │  kb/leveldb.tar (byte-exact) + kb/exports/*.json (portable)                    │
        │  llm-settings.json (processOverrides)  mcp-inventory.json  env-allowlist.json  │
        │  agent-version.txt  planning.tar (.planning/)  prompt.txt  manifest.json       │
        └───────────────────────────────────────────────────────────────────────────────┘

   DURING SPAN (record ON):
        LLM call ─► POST /api/complete (server.mjs:1683)
                     ├─ REPLAY armed? → hash+ordinal lookup in fixtures/llm/
                     │      hit → serve recorded {content,provider,model,tokens} (D-06)
                     │      miss → HTTP 409 hard-fail, surfaced (D-06)
                     └─ RECORD on? → after result (line ~1853): append fixture
                                     {reqHash, ordinal, req(normalized), resp} → fixtures/llm/
        WebSearch/WebFetch/MCP ─► run IN Claude harness (NOT interceptable) ─► transcript JSONL
                     record: scrape ~/.claude/projects/*.jsonl tool_result within span window
                     replay: interface present → HARD-FAIL "not-yet-captured" (no harness tap)
        Clock ─► shim Date in node processes we control (freeze base + monotonic offset)

   SPAN CLOSE ──► measurement-stop.mjs
        1. stopMeasurement() archives span
        2. archive fixtures/ into the snapshot dir (or measurements/)
        3. writeRun(store, {... snapshot_id ...}) → Run.metadata.snapshot_id (run-write.mjs:108)

   RESTORE (separate CLI, D-04 default):
        git worktree add <sandbox> <captured-sha> ; git submodule update --init --recursive
        apply dirty.patch + restore untracked/ + per-submodule patches
        restore kb → sandbox LLM_PROXY_DATA_DIR (hydrate from JSON export, or untar leveldb)
        [--in-place] → backup live state + explicit confirm, THEN write live paths
```

### Recommended Project Structure
```
lib/repro/
├── capture-snapshot.mjs     # captureSnapshot(task_id) → writes .data/run-snapshots/<id>/
├── restore-snapshot.mjs     # restoreSnapshot(id, {inPlace}) → worktree+sandbox (default)
├── git-state.mjs            # SHA + dirty patch + untracked + per-submodule diff/status
├── kb-capture.mjs           # leveldb tar + JSON export copy; sandbox hydrate helper
├── env-allowlist.mjs        # the agent-affecting env-var allowlist (Claude's discretion)
├── mcp-inventory.mjs        # enumerate MCP servers + versions (Claude's discretion)
└── fixtures/
    ├── match-key.mjs        # normalize(request) → sha256 + per-key ordinal (D-07)
    ├── llm-record.mjs       # append fixture on the proxy response path
    ├── llm-replay.mjs       # lookup+serve or hard-fail (D-06)
    ├── harness-record.mjs   # transcript-JSONL scraper (WebSearch/WebFetch/MCP)
    └── clock.mjs            # deterministic Date shim (freeze + monotonic offset)
scripts/
├── measurement-start.mjs    # (edit) call captureSnapshot; add --replay flag
├── measurement-stop.mjs     # (edit) archive fixtures; pass snapshot_id to writeRun
└── repro-restore.mjs        # (new) restore CLI wrapping lib/repro/restore-snapshot.mjs
```
The proxy-side record/replay hook lives in `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (the runtime bridge — NOT src/dist; per `memory/reference_llm_proxy_bridge_flap.md`), reading the same `active-measurement.json` the token logger already reads.

### Pattern 1: LLM record/replay at the proxy chokepoint
**What:** Two taps inside the existing `POST /api/complete` handler.
**When to use:** All LLM traffic (the only channel with a real in-repo chokepoint).
**Where (verified line anchors, server.mjs):**
- Body is parsed at **1683-1698** → `body = { process, messages, model, subscription, provider, ... }`.
- **Replay tap** goes right after 1698, before provider-chain resolution (1754): if replay armed, compute match key from the *normalized* body, look up fixture, `res.end(JSON.stringify(recorded))` on hit or `res.writeHead(409)` hard-fail on miss (mirrors the existing 404/429/500 return style, 1813-2015).
- **Record tap** goes at **1853-1856** where `result` is available (`{ content, model, tokens, provider }`) and before `res.end` at **1957-1969**. The response contract is exactly `{ content, provider, model, tokens, latencyMs }` (1958-1963) — those are the normalized fields for the fixture.
- The active span is read via the already-imported `resolveLiveTaskId()` / `getActiveMeasurement()` (server.mjs:44) — reuse it to know whether record/replay is armed for the current task, keeping ONE reader (measurement-span.ts:112).

```javascript
// Source: derived from _work/rapid-llm-proxy/proxy-bridge/server.mjs:1683-1969 (VERIFIED)
// Replay tap (insert after body parse, ~line 1698):
const span = getActiveMeasurement();            // single reader (measurement-span.ts:112)
if (span?.meta?.replay_from) {
  const key = matchKey(normalizeReq(body));     // sha256(model+messages+params)+ordinal (D-07)
  const hit = replayLookup(span.meta.replay_from, key);
  if (!hit) { res.writeHead(409, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ error:`replay miss: ${key}`, type:'REPLAY_MISS' })); } // D-06
  res.writeHead(200, {'Content-Type':'application/json'});
  return res.end(JSON.stringify(hit));          // { content, provider, model, tokens, latencyMs }
}
// Record tap (insert where result is ready, ~line 1853, guarded by span?.meta?.record):
if (span?.meta?.record) recordFixture(span.task_id, matchKey(normalizeReq(body)),
  { content: result.content, provider: providerName, model: result.model, tokens: result.tokens, latencyMs });
```

### Pattern 2: normalized match key + per-key ordinal (D-07)
**What:** `sha256(JSON.stringify({ model, messages, temperature, max_tokens, ... }))` after dropping volatile fields (task_id, subscription, request id), then an in-memory counter per hash so identical repeated calls (retries) replay in recorded order.
**Why:** Robust to reordering of *distinct* calls; deterministic for *identical* repeats. The proxy already canonicalizes model names (`canonicalizeModelName`, server.mjs:1857) — normalize on the canonical name so record and replay agree.

### Pattern 3: capture-at-open, single writer, sandbox-only restore
**What:** Snapshot is taken by `measurement-start.mjs` *before* the run mutates anything (span-open = pre-mutation baseline). Restore only ever writes a git worktree + a sandbox `LLM_PROXY_DATA_DIR` unless `--in-place` (D-04/D-05).
**Why:** Respects km-core single-owner (store.mjs:30) — the sandbox KB is a separate dir, so the live daemon's exclusive LevelDB lock is never contested.

### Anti-Patterns to Avoid
- **Opening a second `GraphKMStore` on the live `.data/knowledge-graph/` LevelDB to "read for capture."** LevelDB is single-owner; the obs-api daemon holds it. Capture by filesystem copy of the dir + the JSON export, never by a second store handle.
- **Tapping the proxy in `src/` or `dist/`.** The live runtime is `proxy-bridge/server.mjs` (memory/reference_llm_proxy_bridge_flap.md). Edits to src/dist won't affect the running daemon.
- **Treating two clean-closes as byte-equal.** LevelDB compaction perturbs bytes; only a point-in-time dir copy is byte-stable (see Pitfall 1).
- **Capturing the whole `process.env`.** Leaks secrets (proxy keys, OAuth tokens). Capture an allowlist only (D-set: Claude's discretion).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Span lifecycle / active-span parsing | A new span reader | `getActiveMeasurement` / `startMeasurement` / `stopMeasurement` (measurement-span.ts) | It is deliberately the SINGLE parser (SC-4, measurement-span.ts:9); a second reader reintroduces the race Phase 68 killed. |
| Run entity + idempotent write | A new KB store/schema | `openExperimentStore` + `writeRun` (store.mjs, run-write.mjs) — `snapshot_id` field already reserved (run-write.mjs:108) | Idempotency, provenance, ontology validation already solved; just populate `snapshot_id`. |
| Data-dir / proxy env resolution | Ad-hoc env parsing | `resolveMeasurementPaths()` + the `LLM_PROXY_DATA_DIR → cwd/.data` order (measurement-span.ts:57) | The sandbox data dir (D-04) is just a different `LLM_PROXY_DATA_DIR`; reuse the resolver. |
| task_id → filename safety | Manual sanitization | `sanitizeTaskId` (measurement-span.ts:83) | Path-traversal-safe; `.data/run-snapshots/<task_id>/` MUST use it (same threat class as T-68-02-01). |
| Content hashing | Custom hash | `crypto.createHash('sha256')` (as in measurement-stop.mjs:364) | Already the repo idiom for the goal_hash. |
| Git dirty capture | A working-tree copy | `git diff HEAD --binary` + untracked archive + per-submodule diff | Patch is compact, applyable, and handles binary via `--binary` (D-03). |

**Key insight:** ~80% of this phase is *wiring* already-built, deliberately-single-reader surfaces (span, store, run-write, proxy handler). The genuinely new code is: the fixture match/record/replay module, the git+KB capture/restore, and the honest per-channel capability gating.

## Internal-State Capture (REPRO-01 / SC-1) — concrete mechanisms

| Item | Mechanism | Verified anchor / note |
|------|-----------|------------------------|
| git SHA | `git rev-parse HEAD` | trivial; store in manifest. |
| workspace dirty (tracked, incl. binary) | `git diff HEAD --binary` → `dirty.patch` | `--binary` makes it re-applyable; covers staged+unstaged. |
| untracked files | `git ls-files --others --exclude-standard` → archive those paths into `untracked/` | git patch does NOT include untracked; must copy explicitly (D-03). |
| submodule dirty state | `git submodule status` (record SHAs) + per-submodule `git -C <path> diff --binary` | Repo has 5 submodules (`code-graph-rag`, `mcp-constraint-monitor`, `mcp-server-semantic-analysis`, `memory-visualizer`, `lib/km-core`). Each may be dirty independently. |
| `.data/knowledge-graph/` KB | `cp -R`/tar the **`leveldb/`** subdir (the LIVE one — mtime Jul 2, active `000103.log`; NOT the stale `level.db`/`level.db`-dated-Jun-13 or `leveldb.before-*` backups) + copy `exports/general.json` | D-02. See Pitfall 1 for consistency caveat. |
| `processOverrides` routing config | `cp` `.data/llm-proxy/llm-settings.json` | **Verified path** (server.mjs:171-172: `LLM_PROXY_DATA_DIR/llm-proxy/llm-settings.json`; file exists). This is the sole `processOverrides` store (server.mjs:180,198). |
| MCP server inventory + versions | Claude's discretion — recommend `claude mcp list` (live) with a config-file fallback | No `.mcp.json` in repo; MCP configured in `~/.claude` / launcher. Live `claude mcp list` is authoritative-at-snapshot; config read is the fallback. `[ASSUMED]` on exact `claude mcp list` output shape. |
| agent-affecting env vars (allowlist) | Capture allowlist only | Recommend allowlist: `LLM_PROXY_DATA_DIR`, `LLM_PROXY_DIST_DIR`, `LLM_PROXY_SETTINGS_PATH`, `LLM_PROXY_TOKEN_DB_PATH`, `LLM_PROXY_PORT`, `LLM_CLI_PROXY_URL`, `RAPID_LLM_PROXY_URL`, `LLM_PROXY_URL`, `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`, `CODING_REPO`, `CI`, `LSL_CLAUDE_PROJECTS_DIR`, `NODE_OPTIONS`. **Exclude** anything matching `*KEY*`/`*TOKEN*`/`*SECRET*`/`*PASSWORD*` (secrets — Security Domain). |
| agent binary version | `claude --version` → `agent-version.txt` | Also record node version (`process.version`). |
| prompt text | Write the run's prompt to `prompt.txt` | For `/gsd` runs, sourced from the PLAN.md/goal already threaded through measurement-stop (`deriveGoalSentence`, locatePlanMd measurement-stop.mjs:117). Freeform: the `--goal` / prompt captured at start. |
| `.planning/` state | tar `.planning/` → `planning.tar` | Whole-dir; small and text. |

## Harness Channels (D-08: WebSearch / WebFetch / remote MCP) — feasibility verdict

**Record: FEASIBLE (post-hoc, from the transcript).** The Claude Code transcript JSONL at `~/.claude/projects/-Users-Q284340-Agentic-coding/*.jsonl` contains `tool_result`/`toolUseResult` blocks (**verified:** 31 in the current session file). `lib/lsl/route/build-trace.mjs` already reads this directory (`LSL_CLAUDE_PROJECTS_DIR → ~/.claude/projects`, build-trace.mjs:22). A record implementation scrapes tool_use/tool_result pairs for `WebSearch`/`WebFetch`/MCP tools within the span's `[started_at, ended_at]` window and writes them to `fixtures/harness/`.

**Replay: INFEASIBLE in-repo.** These tools run inside the Claude harness process, which:
- does NOT route through `rapid-llm-proxy` (the repo `WebSearch`/`WebFetch` hits are the in-Docker semantic-analysis `WebSearchAgent` — an unrelated LLM relevance-scorer, `integrations/mcp-server-semantic-analysis/src/agents/web-search.ts:42` — and tool-NAME constants in `consequential-events.test.mjs:43`), and
- exposes no in-repo point to substitute a synthetic tool result. Claude Code hooks (`PreToolUse`/`PostToolUse`, configured for constraint-monitor at settings.local.json:605) can *observe* (record) and *block* but, `[ASSUMED]` from harness knowledge, cannot *inject a fixture as the tool result*.

**Plan directive (honors D-06/D-08, per CONTEXT risk note):** ship each of the three harness channels as **record-interface-present, replay-hard-fails-as-not-yet-captured**. Minimal interface stub per channel:
- a `record()` that appends transcript-derived fixtures (real, works today), and
- a `replay()` that, when the channel is armed but has no harness tap, throws/exits with a clear `REPLAY_UNSUPPORTED_CHANNEL: <name>` — never silently degrading (SC-4 comparability). Surface this at span-open so the operator knows replay of those channels is not honored.

## Clock Channel (D-08 + Claude's discretion)

**Scope reality:** `Date.now()`/`new Date()` can be virtualized only in **node processes we control** (the proxy bridge, measurement scripts, `lib/repro`). The Claude harness process's own clock cannot be virtualized from the repo. So clock replay is faithful for fixture timestamps and repo-side logic, NOT for the harness.

**Recommended mechanism (deterministic):** **freeze-at-snapshot base + monotonic offset.** Record `clock_base = Date.now()` at span open into the snapshot. On replay, a small `lib/repro/fixtures/clock.mjs` shim (imported first) overrides `Date.now`/`new Date` to return `clock_base + (performance.now() - replayStart)` — monotonic, deterministic, and never breaks live daemons because it is only loaded by the replay-run's own node entrypoints (NOT injected globally). The proxy fixtures already carry `latencyMs`/`timestamp`, so replayed LLM responses supply their own recorded time without a global clock hijack. **Do NOT** patch Date globally in the long-running daemons (obs-api, proxy) — only in the replay run's controlled entrypoints.

## Restore Safety Mechanics (D-04 / D-05)

**Default (safe, casual) path:**
1. `git worktree add <sandbox-worktree> <captured-sha>` — worktrees are already in heavy use here (`git worktree list` shows 5 active `.claude/worktrees/agent-*`), so the mechanism is proven in this repo.
2. **Submodule caveat (verified concern):** `git worktree add` does NOT populate submodules; run `git -C <sandbox> submodule update --init --recursive`, then apply each captured per-submodule patch + reset each to its captured SHA. This repo has 5 submodules — the plan MUST include this step or the worktree is missing submodule code. `[ASSUMED]` that worktree+submodule needs the explicit init (well-documented git behavior; not re-verified live).
3. Apply `dirty.patch` (`git -C <sandbox> apply --binary dirty.patch`), restore `untracked/`.
4. Restore KB into the **sandbox** `LLM_PROXY_DATA_DIR`: preferred = hydrate a fresh km-core store from the captured `exports/general.json` (compaction-independent, km-core-native); literal-byte option = untar `leveldb.tar` into the sandbox dir. Because it's a sandbox dir, the live single-owner lock is never contested.
5. Point the replay run at the sandbox via `LLM_PROXY_DATA_DIR=<sandbox>/.data` (+ armed replay fixtures).

**`--in-place` path (D-05):** first take an automatic backup of current live state (same capture routine → `.data/run-snapshots/_backup-<ts>/`), then an explicit `readline` confirmation (reuse `prompt()`), only then write live paths. No unguarded in-place write.

**Safe restore ordering:** worktree/SHA → submodules → tracked patch → untracked → KB → env/config → arm replay. (Code before data before config, so a mid-restore failure leaves the sandbox obviously incomplete rather than half-live.)

## Common Pitfalls

### Pitfall 1: "byte-for-byte" LevelDB is only true for a point-in-time copy of a quiescent DB
**What goes wrong:** Expecting that capturing the KB and later re-closing produces identical bytes, or that `cp -R` of a *live* obs-api-owned LevelDB is consistent.
**Why:** km-core writes the whole graph as one key `graph:state = JSON.stringify(serialized)` and only on clean `close()` (persistence.js:65-66,79). LevelDB compaction rewrites `.ldb`/`MANIFEST`, so bytes drift between closes. And the obs-api daemon holds the DB open continuously, so a naive `cp -R` can capture a torn `.log`/`MANIFEST`.
**How to avoid:** (a) Treat the captured *directory artifact* (tar) as the byte-exact SC-2 evidence — restoring that exact artifact into a sandbox is byte-identical to itself. (b) For a *consistent* capture, either take the copy at a known-quiescent moment or prefer the atomically-written `exports/general.json` as the semantic source of truth and hydrate the sandbox from it. **Flag to the operator** that the copy is consistent-at-span-open only.
**Warning signs:** LevelDB `LOG` shows a recent compaction; `CURRENT`/`MANIFEST` mtimes newer than the tar.

### Pitfall 2: editing the wrong proxy file
**What goes wrong:** Record/replay hook added to `_work/rapid-llm-proxy/src/` or `dist/` has no effect on the running daemon.
**Why:** The live runtime is `proxy-bridge/server.mjs` (memory/reference_llm_proxy_bridge_flap.md).
**How to avoid:** Hook `proxy-bridge/server.mjs:1683-1969`. After editing, restart the proxy daemon (`launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`).

### Pitfall 3: assuming harness tools can be replayed
**What goes wrong:** Planning full replay for WebSearch/WebFetch/MCP; runtime silently hits live services, breaking comparability.
**Why:** No in-repo interception surface (see §Harness Channels).
**How to avoid:** record-interface-present + replay-hard-fail per channel (D-06). Surface UNSUPPORTED at arm time.

### Pitfall 4: capturing secrets in the env snapshot
**What goes wrong:** Whole-`process.env` capture writes OAuth tokens / API keys into `.data/run-snapshots/`.
**How to avoid:** allowlist only; deny-regex `*KEY*|*TOKEN*|*SECRET*|*PASSWORD*` (Security Domain, V6/V9).

### Pitfall 5: two km-core stores on the same dir
**What goes wrong:** Opening a store to "read the KB for capture" while obs-api owns it → LevelDB lock error or corruption.
**Why:** single-owner (store.mjs:30).
**How to avoid:** capture via filesystem copy; restore into a *separate* sandbox dir.

### Pitfall 6: `--experimental-vm-modules`/jest confusion for these tests
**What goes wrong:** Writing the round-trip tests as jest specs.
**Why:** The `tests/experiments/*.test.mjs` suite uses **node:test + node:assert/strict**, run via `node --test` (consequential-events.test.mjs:11-15). jest (`NODE_OPTIONS='--experimental-vm-modules'`, package.json:11) targets `*.test.js` under `src/`/`test/` and *ignores* integrations. New repro tests should follow the `.test.mjs`/node:test convention (analogs: `tests/experiments/run-write.test.mjs`, `report-snapshot.test.mjs`).

## Code Examples

### Existing response contract to record (the fixture shape)
```javascript
// Source: _work/rapid-llm-proxy/proxy-bridge/server.mjs:1957-1969 (VERIFIED)
res.writeHead(200, { 'Content-Type': 'application/json' });
return res.end(JSON.stringify({
  content: result.content,
  provider: providerName,
  model: result.model,
  tokens: result.tokens,       // { input, output, total }
  latencyMs,
  ...(typeof result.overheadMs === 'number' ? { overheadMs: result.overheadMs } : {}),
}));
```

### Single-reader span access (reuse, don't reimplement)
```javascript
// Source: measurement-span.ts:112 (VERIFIED) — already imported in server.mjs:44
import { getActiveMeasurement } from '../dist/measurement-span.js';
const span = getActiveMeasurement(); // null-safe, never throws; the ONLY parser
```

### snapshot_id linkage already reserved on the Run
```javascript
// Source: lib/experiments/run-write.mjs:108 (VERIFIED)
snapshot_id: null,   // deferred → Phase 67 (D-13)  ← this phase populates it
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate daemon for run capture | Hook into the existing measurement span start/stop | D-09 (this phase) | One workflow; reuses `active-measurement.json`. |
| Record via bespoke proxy fork | Two taps in the live `proxy-bridge/server.mjs` handler | Phase 62-66 established the bridge as the single dispatch | Minimal surface; single chokepoint. |

**Deprecated/outdated:**
- The `.data/knowledge-graph/level.db` dir and `leveldb.before-*` / `leveldb.broken-*` backups are stale — the LIVE store is `.data/knowledge-graph/leveldb/`. Capture must target the live dir only.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Code hooks cannot inject a synthetic tool result (only observe/block), so harness-channel replay is infeasible. | Harness Channels | If a hook CAN substitute results, replay of WebSearch/WebFetch/MCP becomes feasible and the plan could do more than hard-fail. Re-verify against current Claude Code hook docs before committing the stub-only design. |
| A2 | `git worktree add` + submodules requires explicit `submodule update --init --recursive` in the new worktree. | Restore Safety | If wrong, the extra step is harmless; if the interaction is worse (shared `.git/modules` contention), restore could corrupt a submodule — test on a throwaway worktree first. |
| A3 | `claude mcp list` is the right live enumeration for MCP inventory + versions. | Internal-State Capture | If the command/shape differs, fall back to reading the MCP config file. Low risk (inventory is metadata, not restore-critical). |
| A4 | LevelDB compaction perturbs on-disk bytes across clean-closes (so byte-exact only holds for a point-in-time artifact). | Pitfall 1 | If LevelDB were byte-stable, a stricter SC-2 guarantee is possible; the recommended dir-copy approach is safe either way. |
| A5 | The transcript JSONL reliably contains WebSearch/WebFetch/MCP tool_result content within the span window. | Harness Channels | Verified structurally (31 tool_result blocks) but not that *every* harness tool's full output is present; some large results may be truncated in the transcript. Sample real WebSearch/WebFetch entries during planning. |

## Open Questions (RESOLVED)

1. **Consistent live-KB capture without stopping obs-api.**
   - Known: obs-api is the single LevelDB owner and always running; JSON export is atomically written and 5s-debounced.
   - Unclear: whether a `cp -R` of the live dir at span-open is reliably consistent, or whether a brief writer-quiesce hook (or export-only capture) is required.
   - Recommendation: default to capturing the atomically-written `exports/general.json` as the canonical KB + best-effort `leveldb` tar; document the consistency caveat; consider an optional `POST /api/observations/flush`-style quiesce if km-core/obs-api exposes one.
   - **RESOLVED:** canonical = `exports/general.json`, LevelDB tar best-effort, `kb_caveat` surfaced in the snapshot manifest — implemented in Plan 04 (`kb-capture.mjs` / `capture-snapshot.mjs`).

2. **Exact `--replay` arming channel through `active-measurement.json`.**
   - Known: `startMeasurement` accepts a `meta` object (measurement-span.ts:174,186-191) that is persisted into the span file and readable by `getActiveMeasurement`.
   - Recommendation: thread `--replay <snapshot>` and record-on as `meta: { replay_from, record }` — no schema change needed; the proxy reads them off the span. Confirm `startMeasurement`'s `meta` passthrough is not filtered.
   - **RESOLVED:** armed via the existing `startMeasurement({ meta })` passthrough (no schema change) — implemented in Plan 07 Task 1 (measurement-start.mjs) and read off the span by the proxy tap (Plan 06).

3. **Which prompt text to capture for freeform (non-/gsd) runs.**
   - Recommendation: reuse the start-side `--goal`/prompt captured by measurement-start; for /gsd, the PLAN.md goal already resolved in measurement-stop. Full turn-by-turn prompt capture is out of scope (transcript already holds it).
   - **RESOLVED:** reuse the start-side `--goal`/prompt; full turn-by-turn capture explicitly out of scope (transcript holds it) — reflected in Plans 04/07.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` (worktree, diff --binary, submodule) | D-03/D-04 capture+restore | ✓ (repo is git, worktrees active) | system | — |
| `tar` / `cp -R` | KB + `.planning/` archival | ✓ (macOS) | system | node `fs.cpSync` |
| rapid-llm-proxy daemon (port 12435) | LLM record/replay | ✓ (launchd `com.coding.llm-cli-proxy`) | local dist | proxy fixtures for tests run without daemon |
| `claude` CLI | agent version + `mcp list` | ✓ | `claude --version` | config-file read for MCP |
| `@fwornle/km-core` (lib/km-core submodule) | Run linkage + sandbox hydrate | ✓ | pinned `v0.1.0-phase43-...` | JSON export inspection |
| obs-api daemon (single KB owner) | KB capture consistency | ✓ (launchd `com.coding.obs-api`) | — | export-only capture |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** MCP inventory (live `claude mcp list` → config-file read); byte-exact live-KB copy (→ JSON-export canonical capture).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (the `tests/experiments/*.test.mjs` convention). Main src suite uses jest 29 w/ `NODE_OPTIONS='--experimental-vm-modules'`, but repro tests follow the experiments convention. |
| Config file | none for node:test (jest.config.js governs the *.test.js src suite only) |
| Quick run command | `node --test tests/repro/<file>.test.mjs` |
| Full suite command | `node --test tests/repro/` (+ existing `npm test` for jest src suite) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPRO-02 | normalize+hash+ordinal match key is stable & order-robust (D-07) | unit | `node --test tests/repro/match-key.test.mjs` | ❌ Wave 0 |
| REPRO-02 | record→replay round-trip serves recorded LLM response; miss → hard-fail 409 (D-06) | unit (proxy stubbed, no live daemon) | `node --test tests/repro/llm-record-replay.test.mjs` | ❌ Wave 0 |
| REPRO-02 | harness-channel replay throws `REPLAY_UNSUPPORTED_CHANNEL` (honest stub) | unit | `node --test tests/repro/harness-stub.test.mjs` | ❌ Wave 0 |
| REPRO-02 | clock shim is monotonic & deterministic from a frozen base | unit | `node --test tests/repro/clock.test.mjs` | ❌ Wave 0 |
| REPRO-01 | capture writes all SC-1 items into `.data/run-snapshots/<id>/` (git/env/config/mcp/version) | unit (temp git repo fixture) | `node --test tests/repro/capture-snapshot.test.mjs` | ❌ Wave 0 |
| REPRO-01 | restore into sandbox worktree + sandbox data dir reproduces captured SHA + KB; `--in-place` requires confirm | integration (throwaway worktree) | `node --test tests/repro/restore-snapshot.test.mjs` | ❌ Wave 0 |
| REPRO-01 | `snapshot_id` is populated on the Run via writeRun | unit (in-memory experiment store) | `node --test tests/repro/run-link.test.mjs` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test tests/repro/<changed>.test.mjs`
- **Per wave merge:** `node --test tests/repro/`
- **Phase gate:** full `tests/repro/` green + `npm test` (src jest suite) unaffected, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/repro/_fixtures/` — a synthetic proxy request/response pair + a redacted transcript-JSONL fragment (mirror `tests/experiments/_fixtures/`)
- [ ] `tests/repro/match-key.test.mjs`, `llm-record-replay.test.mjs`, `harness-stub.test.mjs`, `clock.test.mjs`, `capture-snapshot.test.mjs`, `restore-snapshot.test.mjs`, `run-link.test.mjs`
- [ ] A no-daemon proxy record/replay harness: exercise the match/lookup/serve functions directly (unit-test `llm-replay.mjs`/`llm-record.mjs` as pure functions, not the live HTTP server) so tests need no live proxy.
- No new framework install needed (node:test is built-in).

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `sanitizeTaskId` (measurement-span.ts:83) for the `<task_id>` snapshot dir; reject path traversal. |
| V6 Cryptography | partial | SHA-256 for match keys only (`node:crypto`) — no key mgmt; do not hand-roll. |
| V9 / secrets management | **yes (primary)** | env capture is allowlist-only; deny-regex `*KEY*|*TOKEN*|*SECRET*|*PASSWORD*`; `.data/run-snapshots/` is git-ignored and MUST NOT be committed. |
| V12 File handling | yes | restore writes only inside the sandbox worktree/data dir by default; `--in-place` gated by backup + explicit confirm (D-05). |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leakage into snapshot | Information Disclosure | env allowlist + deny-regex; gitignore snapshot dir; do not capture `llm-settings.json` secrets (it holds routing overrides, not keys — verify no key fields before copy). |
| Path traversal via task_id → snapshot dir | Tampering | `sanitizeTaskId` (reused). |
| Destructive `--in-place` restore over live checkout/KB | Denial of Service | auto-backup + explicit confirm; default path never touches live (D-04/D-05). |
| Replay silently mixing live + recorded (false comparability) | Repudiation | hard-fail on miss + UNSUPPORTED-channel throw (D-06). |

## Sources

### Primary (HIGH confidence — read this session)
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (1683-2022) — `/api/complete` handler, request/response shape, token log path, `getActiveMeasurement` reuse (server.mjs:44), settings/`processOverrides` path (171-172).
- `_work/rapid-llm-proxy/src/measurement-span.ts` — span lifecycle, single reader, `resolveMeasurementPaths`, `sanitizeTaskId`, `meta` passthrough.
- `scripts/measurement-start.mjs`, `scripts/measurement-stop.mjs` — integration surface, dist import, prompt helper, writeRun call.
- `lib/experiments/run-write.mjs` (esp. :108 `snapshot_id: null // deferred → Phase 67`), `lib/experiments/store.mjs` (single-owner, ontologyDir).
- `node_modules/@fwornle/km-core/dist/store/persistence.js` (persistGraph:65-66, hydrate:79) — single `graph:state` blob, clean-close-only persist, JSON-export-preferred hydrate patch.
- `tests/experiments/consequential-events.test.mjs` (:11-15,:43) — node:test convention; WebSearch/WebFetch as tool-name constants.
- `lib/lsl/route/build-trace.mjs` (:22) + `~/.claude/projects/-Users-Q284340-Agentic-coding/*.jsonl` (31 tool_result blocks) — transcript record source.
- `git worktree list` / `git submodule status` — 5 active worktrees, 5 submodules.
- `.planning/REQUIREMENTS.md` §REPRO-01/02; `.planning/STATE.md` (v7.4, Phase 68 measurement span); `67-CONTEXT.md`.

### Secondary (MEDIUM confidence)
- `memory/reference_llm_proxy_bridge_flap.md` (referenced) — proxy-bridge/server.mjs is the live runtime, not src/dist.
- CLAUDE.md — proxy port 12435, km-core ontologyDir rule, submodule build pipeline, hydrate patch.

### Tertiary (LOW confidence — needs validation)
- Claude Code hook capability (cannot inject tool results) — training knowledge, flagged A1.
- git worktree + submodule init interaction — well-known behavior, flagged A2.

## Metadata

**Confidence breakdown:**
- Internal-state capture + integration surface: HIGH — every mechanism verified against source with line anchors.
- LLM record/replay tap: HIGH — exact handler lines and request/response contract confirmed.
- Harness channels (record feasible / replay infeasible): MEDIUM — record source verified (transcript); replay-infeasibility verified structurally; hook-injection ruled out from training (A1).
- KB byte-exact semantics: MEDIUM — km-core storage model verified; live-copy consistency is the open risk.
- Clock virtualization: MEDIUM — feasible for controlled node processes; harness clock out of reach (documented).

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (stable infra; re-verify proxy handler line anchors if rapid-llm-proxy is rebuilt, and A1 against current Claude Code hook docs).
