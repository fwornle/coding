# Phase 77: Experiment Spec & Per-Variant Snapshot Foundation - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the *declaration + validation + per-cell restore* foundation for the v7.5 cross-agent experiment runner. A user declares an experiment as a validated variant matrix (`{goal_sentence, variants[], repeats N}`), every cell resolves to a concrete executable config that is validated **before any run starts**, and the runner restores the identical Phase-67 starting snapshot before each variant × repeat so every run begins from the same git tree + `.data/knowledge-graph/` KB + routing config. Requirements: SPEC-01, SPEC-02, RUN-01.

Explicitly **NOT** in scope (later phases):
- Actually launching an agent autonomously against the goal in a measured span (RUN-02/03) → **Phase 78**.
- The Copilot headless-drivability spike (RUN-04) → **Phase 78** (this phase only *gates* the combination, it does not determine drivability).
- Success gate, N-repeat variance, ranked comparison report (CMP-01/02/03) → **Phase 79**.
- Auto-routing / policy engine that consumes the comparisons → **v7.6**.

This phase **wires** the shipped Phase-67 snapshot/restore rig — it does NOT rebuild it.

</domain>

<decisions>
## Implementation Decisions

### SPEC-01 — Spec format & matrix shape
- **D-01:** The experiment spec is a **YAML file** authored by the user, matching the repo's curated-data precedent (`config/task-taxonomy.yaml` parsed by `lib/experiments/taxonomy.mjs` via `js-yaml`) — NOT the machine-config JSON convention. Rationale: the matrix is human-authored curated data, and YAML keeps a matrix compact.
- **D-02:** The matrix is expressed as **cartesian axes** that auto-expand into the concrete variant list: axes over `{agent[], model[], framework[], env[]}` × `repeats: N`, expanded into `agent × model × framework × env` variant cells. A 3×2 matrix is a few lines, not N stanzas. (A named-explicit-variant escape hatch is Claude's Discretion — see below — but the primary authoring surface is axes.)
- **D-03:** **CLI flags override / select** on top of the file, per SPEC-01's "flags and/or a declarative spec file". The file is the reusable/committable definition; flags let an operator narrow or override a single run without editing the file. Both surfaces must exist.
- **D-04:** The spec carries a per-variant (or top-level, overridable per-variant) **`test_command`** field — the Phase-76 carry-forward. It threads into `span.meta.test_command` so `lib/experiments/evidence-harness.mjs:resolveTestCommand` derives VALID-03 `test_coverage`/`regressions` from a fast, parseable suite instead of the whole-repo jest fallback. Must be a fixed-argv string (validated against `SHELL_META_RE`, tokenized — never a shell string).

### SPEC-02 — Validation & fail-fast policy
- **D-05:** **Loose dimension validation:** only `agent` is enum-validated against the known set `['claude', 'opencode', 'copilot']` (`lib/experiments/route-trace-resolve.mjs:KNOWN_AGENTS`). `model` and `framework/approach` stay **free-form strings** (warn on unrecognized, do not block). No new closed framework enum is introduced in this phase (deferred — see Deferred Ideas).
- **D-06:** **Whole-run fail-fast (all-or-nothing):** the ENTIRE matrix is validated before run 0; **any** invalid cell aborts the whole experiment with an actionable, per-cell message (which cell, which dimension, why, how to fix). Never validate-and-skip — a silently skipped cell biases a comparison.
- **D-07:** **Unsupported-combinations gate (required by SPEC-02's own example):** even under loose dimension validation, the validator ships a minimal **combination** table, seeded with `copilot + headless env → fail fast` with an actionable message pointing at the Phase-78 drivability spike (RUN-04). This satisfies SPEC-02's "unsupported combinations (e.g. Copilot headless) fail fast" without a framework enum. The table is a single named source, extensible as later phases learn more.
- **D-08:** The `test_command` string is validated at spec-resolution time with the harness's existing `SHELL_META_RE` guard (`[|&;$<>\n]` etc.) — reject shell-needing commands up front rather than at run time (fail-fast consistency + the D-10 command-injection posture inherited from Phase 76).

### RUN-01 — Restore isolation model
- **D-09:** **One declare-time baseline snapshot.** When the experiment is declared, capture a single baseline via the Phase-67 `captureSnapshot(task_id, {repoRoot, dataDir, prompt})` (`lib/repro/capture-snapshot.mjs`). Every variant × repeat restores from this one baseline so all cells share an identical starting state by construction.
- **D-10:** **Isolated sandbox per cell (the rig's safe default, D-04 of Phase 67).** Before each variant × repeat, call `restoreSnapshot(snapshotId, {inPlace: false, repoRoot, dataDir})` (`lib/repro/restore-snapshot.mjs`) → fresh isolated git worktree + sandbox `.data/`. Never touch the live checkout/KB; parallelizable; no destructive blast radius. `--in-place` is NOT used by the runner in this phase.

### SC#4 — Repeat-determinism proof
- **D-11:** **Hash-and-assert.** After each restore, compute a digest over the restored **git tree (git_sha) + `.data/knowledge-graph/` KB + routing config**; assert that two repeats of the same variant produce **byte-identical digests**. This turns SC#4 from an assumption into a proof.
- **D-12:** **Divergence aborts the experiment** (hard fail with the divergent digests reported) — if two repeats do not start from identical conditions, the comparison is not trustworthy, so the run must not proceed. (Recording/warn-only was explicitly rejected.)

### Claude's Discretion
- Exact YAML schema key names and nesting (`variants:` vs `matrix:`/`axes:`, where `repeats`, `goal_sentence`, `test_command`, `env` live) — planner/executor choose, keeping it minimal and documented, and matching the `taxonomy.mjs` load+validate idiom.
- Whether to also support a named-explicit-variant list alongside cartesian axes (nice-to-have escape hatch); axes are the required primary surface.
- The digest algorithm and exactly what bytes feed it (e.g. `git_sha` string + `git ls-files`-style KB manifest hash vs a full recursive content hash of the KB dir + routing file) — implementer's call, as long as it deterministically covers tree + KB + routing and is stable across repeats.
- Where the new experiment-spec resolver/validator module lives (e.g. `lib/experiments/experiment-spec.mjs`) and how variant `{agent, model, framework, env, test_command}` threads into `measurement-start.mjs` `meta` (new flags `--agent/--model/--framework/--test-command/--variant` vs a `--spec <file> --variant <name>` mode) — an implementation surface, as long as the fields land in `span.meta` where `measurement-stop.mjs` already reads them (`span.meta.agent/.framework/.test_command`).
- The exact actionable-error wording/format for invalid cells and unsupported combinations.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + goal
- `.planning/REQUIREMENTS.md` — v7.5 block: SPEC-01, SPEC-02 (Experiment Specification) and RUN-01 (Cross-Agent Runner) acceptance text.
- `.planning/ROADMAP.md` — Phase 77 section (goal + 4 success criteria); note RUN-04 (Copilot headless) is a **gated spike in Phase 78**, not a Phase-77 dependency.

### Phase-67 snapshot/restore rig (WIRE, do not rebuild)
- `lib/repro/capture-snapshot.mjs` — `captureSnapshot(task_id, {repoRoot, dataDir, prompt}) → {snapshot_id, dir, clock_base}`. Captures git-sha, dirty.patch, untracked/, kb/, env-allowlist, llm-settings, manifest.json. `sanitizeTaskId()` keeps `[A-Za-z0-9._-]`. Snapshots under `.data/run-snapshots/<task_id>/`.
- `lib/repro/restore-snapshot.mjs` — `restoreSnapshot(snapshotId, {inPlace, confirm, repoRoot, dataDir, restoreRoot, ontologyDir}) → {worktree, sandboxDataDir, replayArmed, inPlace, steps}`. Default (D-04) = isolated worktree + sandbox `.data/`; `--in-place` (D-05) = destructive, requires `confirm===true`. Restore sandboxes under `.data/run-restores/<snapshot-id>-<ts>/`.
- `scripts/repro-restore.mjs` — operator CLI (`--snapshot <id>` sandbox default; `--in-place` requires typed `yes-overwrite-live`).
- `.planning/phases/67-reproducibility-replay-rig/*-SUMMARY.md` — the rig's decisions D-04 (safe default) / D-05 (in-place), channel capability map, clock_base.

### Existing measurement declaration surface (extend)
- `scripts/measurement-start.mjs` — today: `--task-id` (req), `--goal`, `--replay <snapshot-id>`; `meta = {record, replay_from}`. `captureSnapshot` already called at span open (`:125`). Phase-77 hook point for `--agent/--model/--framework/--test-command/--variant`.
- `scripts/measurement-stop.mjs` — reads `span.meta?.agent`, `span.meta?.framework`, `span.meta?.test_command`; writes Run.metadata `{task_hash, agent, model, framework, canonical_model, canonical_agent, background_models, snapshot_id}`. Confirms the fields the spec must set.
- `lib/experiments/evidence-harness.mjs` §242-262 `resolveTestCommand(span, repoRoot)` — precedence `span.meta?.test_command ?? span.test_command ?? package.json "test"`; `SHELL_META_RE` guard; fixed-argv `spawnSync`. The Phase-76 carry-forward target (D-04).

### Legal dimension values + validation precedent
- `lib/experiments/route-trace-resolve.mjs:23` — `KNOWN_AGENTS = ['claude','copilot','opencode']` (the agent enum for D-05).
- `lib/experiments/taxonomy.mjs` — `loadTaxonomy()` / `isValidClass(cls, taxonomy)` closed-enum validation over `config/task-taxonomy.yaml` (YAML SoT). The reuse pattern for D-01 (YAML load) + D-05/06 (enum validate + fail-fast).
- `lib/agent-registry.js` / `lib/agent-detector.js` — agent→adapter mapping and `config/agents/*.sh` discovery (informs which agents are actually launchable — relevant to D-07's combination gate).

### Standing constraints
- `CLAUDE.md` — no-console-log (`process.stderr.write` for diagnostics), TypeScript strict where applicable (`.mjs` ESM here — match surrounding style), constraint-dodging forbidden, fixed-argv exec only (reinforces D-08).
- `.planning/phases/76-*/76-VERIFICATION.md` — the Phase-76 forward note: set a task-scoped `test_command` so coverage/regressions derive from a parseable node:test suite (the origin of D-04).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `captureSnapshot` / `restoreSnapshot` (`lib/repro/*`) — the entire RUN-01 mechanism already exists and is wired into `measurement-start.mjs`; Phase 77 orchestrates calls, adds nothing to the rig.
- `taxonomy.mjs` load+validate idiom (`js-yaml` + `isValidClass` closed-enum + honest error) — the direct template for the experiment-spec YAML loader + agent-enum validator + fail-fast.
- `resolveTestCommand` (`evidence-harness.mjs`) — already reads `span.meta.test_command`; Phase 77 only needs to *set* it (CLI/spec exposure).
- `measurement-start.mjs` / `measurement-stop.mjs` `meta` passthrough — the existing seam for threading per-variant `{agent, model, framework, env, test_command}` into a span.

### Established Patterns
- **YAML SoT + parse-and-validate** (`config/task-taxonomy.yaml` → `taxonomy.mjs`) — the repo's precedent for human-authored curated config (D-01).
- **Closed-enum + honest error** (`isValidClass`) — the fail-fast validation pattern (D-05/06).
- **Fixed-argv, no-shell exec** (`SHELL_META_RE`, `spawnSync`) — mandatory for the `test_command` field (D-08) and any command handling.
- **Safe-by-default snapshot restore** (isolated sandbox unless explicit `--in-place` + confirm) — the rig's D-04/D-05 posture the runner adopts (D-10).

### Integration Points
- Spec → `measurement-start.mjs meta` → `span.meta` → `measurement-stop.mjs` Run.metadata (`agent`/`framework`/`test_command`) and `evidence-harness` (`test_command`).
- Baseline `captureSnapshot` at declare-time → `restoreSnapshot` per cell → sandbox worktree + `.data/` the agent (Phase 78) will run in.
- Determinism digest reads the restored worktree git_sha + sandbox `.data/knowledge-graph/` + routing config.

</code_context>

<specifics>
## Specific Ideas

- The "straight vs GSD/SDD" canonical comparison is a **framework/approach** distinction — kept free-form here (D-05), but it's the reason `framework` is a first-class variant dimension threaded to `span.meta.framework`.
- Copilot + headless is the SPEC-02 poster-child unsupported combination — Phase 77 fails it fast (D-07) with a pointer to the Phase-78 RUN-04 drivability spike, rather than pretending it works.
- SC#4's byte-identical proof pairs naturally with the Phase-67 manifest's recorded `git_sha` + `clock_base` — the digest can lean on those plus a KB/routing content hash.

</specifics>

<deferred>
## Deferred Ideas

- **Closed `framework/approach` enum** (e.g. `straight | gsd | sdd`) with strict validation — deferred; D-05 keeps framework free-form for now. Revisit if the comparison report (Phase 79) needs canonical framework labels.
- **Actual Copilot headless drivability** — Phase 78 RUN-04 gated spike; Phase 77 only gates the combination.
- **Autonomous agent launch in a measured span** (RUN-02/03) — Phase 78.
- **Success gate / variance / ranked report** (CMP-01/02/03) — Phase 79.
- **Auto-routing / policy engine** consuming the comparisons — v7.6 (`seeds/v74-policy-engine.md`).

### Reviewed Todos (not folded)
- `2026-06-10-okm-express-api-contract-bridge.md` (OKM ↔ unified-viewer `/api/entities` contract) — weak keyword match only; unrelated to the experiment-spec/runner scope. Not folded.
- `2026-06-10-sub-agent-dashboard-observability-gap.md` (worktree-isolated sub-agent observations not reaching dashboard) — weak keyword match; an observability concern, not experiment declaration. Not folded. (Note: tangentially relevant to Phase 78's isolated-sandbox agent runs — revisit there if sub-agent runs need dashboard visibility.)

</deferred>

---

*Phase: 77-experiment-spec-per-variant-snapshot-foundation*
*Context gathered: 2026-07-03*
