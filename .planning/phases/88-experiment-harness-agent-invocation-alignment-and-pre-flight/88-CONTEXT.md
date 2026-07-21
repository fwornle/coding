# Phase 88: Experiment Harness — Agent-Invocation Alignment & Pre-flight Gate - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Source:** Dogfood investigation of `/experiment` run `compare-avenues-help-v1` (claude/opus vs opencode/haiku vs copilot/auto)

<domain>
## Phase Boundary

Cross-agent experiments launched by the `/experiment` skill (via `scripts/experiment-run.mjs` +
`lib/experiments/agent-headless.mjs`) currently degenerate to a one-horse race: only the `claude`
cell executes. `opencode` and `copilot` cells fail for **harness** reasons — not network/CN reasons —
because the headless cell-launch path does NOT replicate the proxy-routing / env / model setup that
the working interactive path (`bin/coding --<agent>` → `scripts/launch-agent-common.sh`
`configure_proxy_routing()`) establishes.

**This phase delivers three P0 fixes** so a multi-agent experiment produces a genuine N-way comparison:

1. **Agent-invocation alignment** — each experiment cell invokes its agent through the SAME
   proxy-routing/env/model seam that `bin/coding --<agent>` uses, so copilot stops 500-ing and
   opencode resolves its model.
2. **Per-agent pre-flight validation gate** — before a cell burns its run, probe that agent's
   routing is viable (proxy reachable + model id resolves against the live catalog + one-token
   round-trip). On failure, record a clean per-variant `skipped: <reason>` UP FRONT (reusing the
   existing RUN-04 recorded-skip mechanism), never a mid-run abort.
3. **Probe / ambient suppression** — the copilot drivability probe and concurrent interactive
   ambient sessions must NOT create rows in the experiment's Runs view during a run.

## Evidence (from the failed run)

- **opencode** (`.logs/experiment-avenues-help.log` line 59):
  `Error: Model not found: rapid-proxy/claude-haiku-4-5. Did you mean: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6?`
  → terminal_state=abort, 0 tokens. opencode reached a provider but that provider's catalog does
  not contain `rapid-proxy/claude-haiku-4-5`; the `rapid-proxy` provider splice was not applied in
  the headless path.
- **copilot** (log line 95): `Failed to get response from the AI model; retried 5 times … Last error: 500 Internal Server Error`
  → +0 −0 changes, 0 tokens. Yet `bin/coding --copilot` works live (Copilot v1.0.73, verified
  interactively). The headless `copilot -p <goal> --allow-all-tools --model auto` invocation bypasses
  the working BYOK seam.
- **claude**: succeeded (43,084 tokens, real edit) — confirms claude routing is fine outside CN.
- **Proxy is healthy**: `POST :12435/api/complete` returns `provider=claude-code, model=claude-sonnet-5`.
  "proxy off" in operator's setup = the CORPORATE proxy (proxydetox) is off (outside CN); the
  rapid-llm-proxy on :12435 is up. So CN/VPN is NOT the cause of the failures.

## Root-cause seam

`lib/experiments/agent-headless.mjs` `argvForAgent(agent, goal, {model})` returns only fixed argv
(e.g. opencode → `['run', goal, '-m', model, '--dangerously-skip-permissions']`; copilot →
`['-p', goal, '--allow-all-tools', '--model', model]`). It sets **no env**. The child is spawned by
the caller (Phase 78-03 in `scripts/experiment-run.mjs` / measurement-start wrapper) with a bare env.

The WORKING env is set only by `scripts/launch-agent-common.sh` `configure_proxy_routing()`:
- opencode → `ANTHROPIC_BASE_URL=${base}/v1/messages` (anthropic path) + provider splice.
- copilot → `COPILOT_PROVIDER_BASE_URL=${base}/v1/copilot/t/${TASK_ID}` (measured) or `/v1/copilot`
  (interactive) + `COPILOT_MODEL` from the **proxy's copilot catalog** (NOT GitHub's, NOT `auto`).
- claude → `ANTHROPIC_BASE_URL=${base}` + unset ANTHROPIC_API_KEY.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Reuse, do not reinvent, the routing setup
- The headless cell-launch MUST establish the SAME per-agent env that
  `scripts/launch-agent-common.sh` `configure_proxy_routing()` produces, scoped to the cell's
  `TASK_ID`. Prefer factoring the routing logic so BOTH paths share ONE source of truth (either the
  cell path sources/calls the shell function, or the shell function's logic is mirrored in a single
  JS/`mjs` helper both consumers use). Do NOT hand-duplicate env strings in a third place.
- copilot cell env: `COPILOT_PROVIDER_BASE_URL=${base}/v1/copilot/t/${TASK_ID}` + `COPILOT_MODEL`
  resolved from the proxy copilot catalog; the spec's `model: auto` maps to the catalog default the
  interactive path uses (see `launch-agent-common.sh:487` "default to the …").
- opencode cell env: same `ANTHROPIC_BASE_URL` + provider splice the interactive path sets, so the
  spec model resolves. The stale `rapid-proxy/claude-haiku-4-5` string is fixed by whichever is
  correct: (a) the splice makes `rapid-proxy/...` resolve, or (b) the spec/model-mapping emits a
  catalog-valid id (e.g. `claude-haiku-4.5`). The pre-flight gate (below) makes the correct answer
  observable rather than guessed.

### Pre-flight validation gate (per agent, before the cell runs)
- Extend the existing probe concept (currently copilot-only, `probeCopilotHeadless`, RUN-04/D-07)
  into a per-agent pre-flight check that validates: proxy reachable, the cell's model id resolves
  against the live catalog, and a one-token round-trip succeeds under the SAME routing env the cell
  will use.
- On failure → record a per-variant `skipped: <reason>` Run via the SAME recorded-skip path the
  copilot drivability skip already uses (a recorded skip is explicitly NOT a matrix failure —
  `experiment-run.mjs:52,338`). It must NOT abort mid-run and must NOT mark a required-agent cell
  as a hard error when the cause is a pre-flight-detectable routing/model problem.
- The gate is fail-soft and bounded (mirror `COPILOT_PROBE_TIMEOUT_MS`), so a hung probe skips that
  variant rather than hanging the matrix.

### Probe / ambient suppression during a run
- The copilot drivability probe (`agent-headless.mjs:161` `COPILOT_PROBE_PROMPT = 'Reply with the
  single word OK and nothing else.'`) must NOT produce a Runs-table row. Mark the probe invocation
  non-measured (e.g. a no-capture task_id sentinel / env flag the proxy + reconciler honor), so
  always-on auto-measurement does not bind it.
- Concurrent interactive ambient sessions (including the operator's own foreground session) should
  not be conflated with the experiment's cells. Acceptable approaches: tag experiment cells so the
  experiment's Runs view / task_hash query excludes ambient rows, OR pause always-on
  auto-measurement binding for the run window. Choose the approach with the smallest blast radius
  that keeps the 3 (or N) cells cleanly identifiable for that task_hash.

### Verification must be real (feedback: e2e-verify)
- Prove the fix by RE-RUNNING a real cross-agent experiment (a fresh spec, or re-run
  `compare-avenues-help-v1`) and showing all three cells either execute with non-zero tokens OR
  record a clean `skipped: <reason>` — not a silent abort. DB-only assertions are insufficient.
- Run the matrix UNATTENDED (ambient-span caveat) — do not drive it from an interactive agent in
  this repo.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Harness (the code to change)
- `lib/experiments/agent-headless.mjs` — `argvForAgent` (fixed argv per agent) + `probeCopilotHeadless` (RUN-04 probe). The per-agent invocation + probe seam.
- `scripts/experiment-run.mjs` — the matrix runner; spawns each cell (env + cwd), records skip-Runs (lines ~52, ~338), copilot probe gating (line ~145).
- `scripts/launch-agent-common.sh` — `configure_proxy_routing()` (the WORKING per-agent env: opencode ~437-443, copilot ~455-487, claude). Source of truth to share.
- `scripts/measurement-stop.mjs` — close/archive + the A1 "no proxy rows / adapter rows" warning; where a distinct skip/failed disposition may be recorded.
- `bin/coding` — the interactive launcher that calls `configure_proxy_routing()` (the reference behavior).

### Behavior / contracts (read, don't change unless required)
- `config/experiments/compare-fizzbuzz.yaml` + `config/experiments/compare-avenues-help-v1.yaml` — spec shape + the stale `rapid-proxy/claude-haiku-4-5` model string.
- CLAUDE.md — km-core LLM proxy endpoint (`:12435 /api/complete`), proxy routing rules, `reference_agent_proxy_routing_launcher`, `reference_uniform_token_capture_agents`, `feedback_copilot_hook_schema` (copilot hook schema), `reference_claude_proxy_capture_routes`.

### Proxy
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — copilot BYOK provider (`/v1/copilot`), catalog, `/api/complete`. For catalog/model resolution + the no-capture sentinel.
</canonical_refs>

<specifics>
## Specific Ideas
- The fastest path to "share one source of truth" may be a small `mjs` helper that returns the
  per-agent env map given `{agent, model, taskId, proxyBase}`, called by the cell launcher, with
  `configure_proxy_routing()` kept as the interactive-shell consumer of the same values (or the
  helper invoked from the shell). Planner to choose based on the actual call sites.
- The pre-flight one-token round-trip can reuse `POST :12435/api/complete` for a provider/model
  liveness check, and for opencode/copilot additionally confirm the model id is in the catalog the
  cell will hit (the opencode error already emits the valid catalog — resolve against it).
- Reuse the existing recorded-skip Run path so skipped variants show consistently (like the copilot
  headless skip) rather than as unmeasured/aborted rows.
</specifics>

<deferred>
## Deferred Ideas (P1/P2 — NOT this phase; capture as follow-up phases)
- **Distinct "failed/aborted" Run state** separate from `unmeasured` and from
  `quarantine (pending/unclassified)`. Today failed cells are classified (`pending=false`) so they
  render as ordinary 0-token "unmeasured" rows and are NOT counted by "Show quarantined (N)"
  (`performance.tsx:104` counts `r.pending===true`).
- **Sandbox `node_modules`** for the `smoke-spec` restore so UI cells can actually build/verify
  (agents currently hit `vite: command not found` and can only structurally review).
- **Reconcile CLI-launched vs UI-launched experiments** — a CLI-launched run surfaces only in the
  Measurement panel (left), leaving the Launch-experiment panel (right) empty/confusing.
- **Per-variant diff viewer** — a UI path to see each cell's modified files (this experiment used
  ephemeral `.data/run-restores/` sandboxes, not persistent avenue branches).

## Scope fence
- IN: harness-side agent-invocation alignment, pre-flight gate, probe/ambient suppression, and a
  real re-run proving all three cells behave (execute or clean-skip).
- OUT: everything under Deferred (dashboard failed-run state, sandbox deps, launch-panel
  reconciliation, per-variant diff UI). No dashboard rebuild required for the core P0 work unless a
  minimal Runs-view exclusion is needed for the ambient-suppression item — keep any UI change
  minimal and bind-mount-aware (frontend `npm run build` + frontend restart, per CLAUDE.md).
</deferred>

---

*Phase: 88-experiment-harness-agent-invocation-alignment-and-pre-flight*
*Context gathered: 2026-07-21 via dogfood investigation (not discuss-phase)*
