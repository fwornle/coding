---
phase: 88-experiment-harness-agent-invocation-alignment-and-pre-flight
plan: 01
subsystem: experiments-harness
tags: [agent-routing, model-resolution, proxy-routing, single-source-of-truth, opencode, copilot]
requires:
  - lib/experiments/experiment-runner.mjs (configureProxyRoutingEnv, runCell)
  - lib/experiments/agent-headless.mjs (argvForAgent)
  - scripts/launch-agent-common.sh (configure_proxy_routing)
provides:
  - lib/experiments/agent-routing.mjs (resolveCellModel, buildAgentRoutingEnv, COPILOT_MEASURED_DEFAULT_MODEL)
  - "single source of truth: per-agent launch-model resolution + canonical proxy-routing env map"
affects:
  - experiment cell launch path (opencode + copilot cells now resolve catalog-valid models)
  - interactive shell launcher (copilot measured default sourced from the JS helper)
tech-stack:
  added: []
  patterns:
    - "pure side-effect-free resolver module with an optional isMain CLI block"
    - "delegate-not-duplicate: configureProxyRoutingEnv keeps gating, delegates env map"
key-files:
  created:
    - lib/experiments/agent-routing.mjs
    - tests/experiments/agent-routing.test.mjs
  modified:
    - lib/experiments/experiment-runner.mjs
    - scripts/launch-agent-common.sh
    - config/experiments/compare-avenues-help-v1.yaml
    - config/experiments/compare-fizzbuzz.yaml
decisions:
  - "opencode dash→dot is a version-suffix regex keeping the rapid-proxy/ provider prefix (real provider, not a swap)"
  - "copilot COPILOT_MEASURED_DEFAULT_MODEL='claude-haiku-4-5' lives in ONE place; the proxy maps the dash alias → 4.5 on the send path"
  - "launch model resolved once in runCell; identity fields (task_id/variant/start --model) stay on the ORIGINAL cell.model (D-05 comparability)"
metrics:
  tasks: 3
  files_created: 2
  files_modified: 4
  tests: 53
  completed: 2026-07-22
---

# Phase 88 Plan 01: Agent-Invocation Routing Alignment Summary

Converged experiment-cell launch model + proxy-routing env onto ONE source of truth
(`lib/experiments/agent-routing.mjs`), fixing the opencode dash-vs-dot model typo and the copilot
`auto` → measured-default resolution that made a 3-way experiment degenerate to a one-horse race.

## What shipped

- **`lib/experiments/agent-routing.mjs`** (new, pure/side-effect-free):
  - `resolveCellModel(agent, specModel)` — opencode normalizes ONLY the trailing dash-version to a
    dot-version (`/-(\d+)-(\d+)$/` → `-$1.$2`) while KEEPING the full `rapid-proxy/` provider prefix
    (`rapid-proxy/claude-haiku-4-5` → `rapid-proxy/claude-haiku-4.5`); copilot `auto`/empty →
    `COPILOT_MEASURED_DEFAULT_MODEL`; claude/mastracode passthrough.
  - `buildAgentRoutingEnv(agent, baseEnv, {taskId, model, port})` — the per-agent env map lifted
    VERBATIM from `configureProxyRoutingEnv`'s former inline switch (opencode both-wire
    `OPENCODE_CONFIG_CONTENT` splice, claude `ANTHROPIC_CUSTOM_HEADERS`, copilot BYOK). Returns a
    copy; no health/route gating; no model resolution.
  - `COPILOT_MEASURED_DEFAULT_MODEL = 'claude-haiku-4-5'` — the ONE home for the copilot default.
  - `isMain` CLI: `node lib/experiments/agent-routing.mjs default copilot` prints the default;
    unknown args exit 2 (consumed by the shell launcher).
- **`experiment-runner.mjs`** — `configureProxyRoutingEnv` keeps its `CODING_PROXY_ROUTE` opt-out +
  `/health` fail-soft gating and DELEGATES the routed env map to `buildAgentRoutingEnv` (the inline
  switch is gone — no third copy). `runCell` resolves `launchModel = resolveCellModel(cell.agent,
  cell.model)` ONCE and passes it to BOTH `argvForAgent` and `configureRouting`;
  `composeTaskId`/`cellName`/`--variant`/measurement-start `--model` stay on the ORIGINAL
  `cell.model` so `task_hash` + variant identity are byte-unchanged.
- **`scripts/launch-agent-common.sh`** — the copilot measured-span default now sources the helper
  fail-soft: `${COPILOT_MODEL:-$(node "${CODING_REPO}/lib/experiments/agent-routing.mjs" default copilot 2>/dev/null || echo claude-haiku-4-5)}`. The ambient branch (`claude-opus-4.8`, now line 495)
  is untouched.
- **Both shipped specs** — opencode model dash-typo `rapid-proxy/claude-haiku-4-5` →
  `rapid-proxy/claude-haiku-4.5` (live-catalog id, `rapid-proxy/` prefix kept); copilot kept as
  `auto` with a resolver comment so the alias path stays exercised.

## Verification (all green)

- `node --test tests/experiments/agent-routing.test.mjs tests/experiments/experiment-runner.test.mjs tests/experiments/agent-headless.test.mjs` → 53 pass / 0 fail (all prior `configureProxyRoutingEnv` assertions preserved after the delegation refactor).
- Resolved opencode id `rapid-proxy/claude-haiku-4.5` present verbatim in live `~/.opencode/bin/opencode models` output (not just a unit assertion).
- `resolveCellModel('opencode','rapid-proxy/claude-haiku-4-5').startsWith('rapid-proxy/')` → true (no `anthropic/` swap).
- `node lib/experiments/agent-routing.mjs default copilot` → `claude-haiku-4-5` (exit 0); unknown args exit 2.
- `bash -n scripts/launch-agent-common.sh` clean; both specs parse with the dotted opencode id; zero dash-typos remain.
- Delegation grep: `grep -vE '^\s*//' experiment-runner.mjs | grep -c "case 'copilot'"` → 0.

## Commits

- `c4bc43c45` test(88-01): failing model-resolution + env-map contract (RED)
- `51acb49b0` feat(88-01): agent-routing.mjs single source of truth (GREEN)
- `e842bb395` feat(88-01): wire cell path to agent-routing single source of truth
- `16b6831b7` fix(88-01): close shell↔cell drift + correct shipped spec model ids

## Deviations from Plan

None affecting behavior. Note: `lib/experiments/agent-headless.mjs` was listed in the plan's
`files_modified` but required NO change — the plan's Task 2 explicitly states "argvForAgent itself
needs no change beyond receiving launchModel from runCell." The resolved model is supplied by the
caller (`runCell`), so `argvForAgent` is unchanged. This is a planned-superset file list, not a
deviation. Tests for both Task 1 and Task 2 live in the single sanctioned test file
`tests/experiments/agent-routing.test.mjs` (in `files_modified`); `experiment-runner.test.mjs` was
run as a regression gate but not modified.

## Notes for downstream (Plans 88-02 / 88-03)

- The pre-flight validation gate (88-02) can reuse `resolveCellModel` to compute the id it validates
  against the live catalog + the `POST :12435/api/complete` one-token round-trip, and
  `buildAgentRoutingEnv` to build the SAME routing env the cell will use for the probe.
- The real re-run proof (CONTEXT "Verification must be real") is a phase-level gate, not this plan's
  scope — this plan makes the model resolution correct and single-sourced; 88-02/88-03 add the gate
  + suppression + the unattended re-run.

## Self-Check: PASSED
