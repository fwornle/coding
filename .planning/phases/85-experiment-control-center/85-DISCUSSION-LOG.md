# Phase 85: Experiment Control Center - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 85-experiment-control-center
**Areas discussed:** Detached-run architecture, Progress contract, Re-run & cancel semantics, Launcher UI scope, Difference viewer (user-added)

---

## Detached-run architecture

| Option | Description | Selected |
|--------|-------------|----------|
| vkb-server detached spawn | Host-side :8080 spawns experiment-run.mjs detached+unref; run-dir with pid; survives vkb restart | ✓ |
| Request-marker + launchd daemon | API writes run-request.json; new com.coding.experiment-runner daemon polls and executes | |
| launchctl kickstart per run | One-shot launchd job templated per run | |

**User's choice:** vkb-server detached spawn (recommended option)

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse with 409 | Mirror measurement/start guard; response names the slot holder; no force, no queue | ✓ |
| 409 + explicit force override | Same guard with ?force=true escape hatch | |
| Queue until free | Hold launch pending until the span slot frees | |

**User's choice:** Refuse with 409 (recommended option)
**Notes:** Driven by the single-span-slot token mis-attribution hazard documented in experiment-run.mjs.

---

## Progress contract

| Option | Description | Selected |
|--------|-------------|----------|
| Native emitter in runMatrix | Best-effort never-throw progress.json writer at each cell state transition | ✓ |
| Wrapper parses runner stderr | vkb-server tails child stderr, regex-parses into progress.json | |

**User's choice:** Native emitter in runMatrix (recommended option)

| Option | Description | Selected |
|--------|-------------|----------|
| Full per-cell matrix | Per-cell state/timestamps/task_id/reason + run-level header | ✓ |
| Run-level summary only | Overall state + current cell + counters | |
| Per-cell + live agent tail | Full matrix plus last N lines of agent output | |

**User's choice:** Full per-cell matrix (recommended option)

---

## Re-run & cancel semantics

| Option | Description | Selected |
|--------|-------------|----------|
| New run identity, all cells re-execute | New run_id salts composite task_id; rerun_of on Run records; resume stays distinct | ✓ |
| Rerun = resume + extend | Same identity, only missing cells run | |
| Rerun only with param overrides | Require at least one override | |

**User's choice:** New run identity, all cells re-execute (recommended option)

| Option | Description | Selected |
|--------|-------------|----------|
| CLI-narrowing set only | repeats, timeout, variant subset (recommended) | |
| + per-variant model/agent overrides | Also mutate a variant's model/agent on re-run | ✓ |
| Full spec override | Replacement spec body with rerun_of linkage | |

**User's choice:** + per-variant model/agent overrides — user wants quick what-ifs from a finished run. Follow-up asked to protect comparison honesty (below).

| Option | Description | Selected |
|--------|-------------|----------|
| Derived name, auto-suffixed | A → A@opus-4.8, base_variant preserved | ✓ |
| Same name + override marker | Keep 'A', set variant_overridden on the Run | |
| Require a new name at re-run time | UI forces typing a new variant name | |

**User's choice:** Derived name, auto-suffixed (recommended option)

| Option | Description | Selected |
|--------|-------------|----------|
| Hard kill, abort recorded, resumable | SIGTERM→SIGKILL process group; in-flight cell = abort; run resumable | ✓ |
| Graceful: finish current cell first | Stop flag; exit after in-flight cell scores | |
| Both: graceful default + force-now | Two cancel modes | |

**User's choice:** Hard kill, abort recorded, resumable (recommended option)

---

## Launcher UI scope

| Option | Description | Selected |
|--------|-------------|----------|
| Spec picker + overrides | Dropdown of config/experiments/*.yaml + resolved-matrix preview + override fields | ✓ |
| Full spec-builder form | Build variants in the UI, POST the whole spec | |
| Picker + inline YAML editor | Pick a spec, tweak YAML in a textarea | |

**User's choice:** Spec picker + overrides (recommended option)

| Option | Description | Selected |
|--------|-------------|----------|
| Cell grid + header | Render of progress.json: header + variant×repeat state chips; 5s polling | ✓ |
| Header + current cell only | Compact progress bar + counters | |
| Grid + live log tail | Grid plus streaming stderr tail | |

**User's choice:** Cell grid + header (recommended option)

| Option | Description | Selected |
|--------|-------------|----------|
| From a finished run's context | Re-run button on run header / runs-table row, opens pre-filled launcher | ✓ |
| In the launcher only | Base-run dropdown in the launcher | |
| Both entry points | Button + dropdown | |

**User's choice:** From a finished run's context (recommended option)

---

## Difference viewer (user-added area)

User's original ask (verbatim intent): "I want to be able to see where two runs differ and how the different decisions lead to more or fewer tokens, more or fewer loops, etc."

| Option | Description | Selected |
|--------|-------------|----------|
| Divergence-point trajectory diff | Align per-turn sequences, find first divergence, side-by-side trajectories with cumulative token deltas + loop flags | ✓ |
| Segment-level cost diff | Bucket runs into explore/edit/test phases, compare per segment | |
| Enhanced run-compare deltas | Per-turn sparklines on the existing aggregate compare | |

**User's choice:** Divergence-point trajectory diff

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 86 + data hooks in 85 | Viewer joins Timeline v2; Phase 85 guarantees rerun_of / base_variant pairing foundation | ✓ |
| Expand Phase 85 to include it | Roadmap edit to grow this phase | |
| Its own phase after 86 | Dedicated phase consuming 85+86+87 outputs | |

**User's choice:** Phase 86 + data hooks in 85 (recommended option)

---

## Claude's Discretion

- run_id format, run-dir path, task_id salting scheme (respecting slug truncation)
- progress.json field names, API envelope, stale-pid handling
- Spec-list endpoint shape, matrix-preview computation
- Derived variant suffix rendering convention
- Redux slice layout (extend performanceSlice vs new slice)

## Deferred Ideas

- Difference viewer (divergence-point trajectory diff) → Phase 86; fold into its scope line when planning
- Launch queueing when span slot busy — rejected
- Live agent-output tail in monitor — rejected
- Graceful cancel-after-cell mode — rejected
- In-dashboard spec builder/editor — rejected
