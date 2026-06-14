---
phase: 57-lower-ontology-project-tagging-foundation
plan: 03
plan_id: 57-03
subsystem: B/mcp-server-semantic-analysis
tags: [writer-stamping, semantic-analysis, metadata, defense-in-depth, project-tag, phase-57]
status: complete-with-verification-debt
requires: ["57-01 (PROJECTS/isProject/Project from km-core)"]
provides:
  - "Writer-path stamping of `metadata.project` at canonical-mapper primary site + km-core-adapter defence-in-depth dual site for every km-core writer call in the wave-analysis pipeline"
  - "wave1/2/3 agents thread `project: this.team` into canonical-mapper via augmentWithCanonical options bag"
  - "Container km-core resolution corrected to share the workspace dev tree (lib/km-core), eliminating the two-clone drift pattern"
affects:
  - integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts (extended)
  - integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts (call site)
  - integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts (call site)
  - integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts (call site)
  - integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts (storeEntity signature + dual-stamp)
  - integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts (does NOT exist — retired Phase 42.2-04; verify-only no-op)
  - integrations/code-graph-rag/src/ (ZERO putEntity sites — PATTERNS correction #4 anti-regression guard)
  - docker/docker-compose.yml (km-core bind-mount switched to lib/km-core — orchestrator fix)
tech-stack:
  added: []
  patterns:
    - "Dual-stamp defence-in-depth (primary mapper + secondary adapter) — mirrors Phase 42.2 Plan 02 Gap 1 + Gap 4 team-stamping topology, extended to metadata.project"
    - "Closed-set runtime typeguard via isProject() (Phase 57 D-03) instead of length>0 string check — silently drops misspellings so backfill grep surfaces upstream bugs"
    - "Caller-supplied options-bag plumbing (CanonicalMapperOptions.project + storeEntity options.project) avoids hardcoded defaults in the writer layer"
    - "Container bind-mount unified with workspace dev tree (lib/km-core) — eliminates ${HOME}/Agentic/km-core two-clone drift that left the container days behind on every km-core change"
key-files:
  created: []
  modified:
    - "integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts (+15 lines: import {isProject, Project}, interface field, stamp block)"
    - "integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts (+5 lines incl. JSDoc): augmentWithCanonical opts gain project: this.team"
    - "integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts (+5 lines incl. JSDoc): augmentWithCanonical opts gain project: this.team"
    - "integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts (+5 lines incl. JSDoc): augmentWithCanonical opts gain project: this.team"
    - "integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts (+33 lines: imports as named import block, storeEntity signature, projectFromOptions derivation, metadata-literal dual-stamp ternary)"
    - "docker/docker-compose.yml (orchestrator fix — km-core bind-mount switched from ${HOME}/Agentic/km-core to ${CODING_REPO}/lib/km-core)"
decisions:
  - "Did NOT hardcode 'coding' default at km-core-adapter.storeEntity — canonical-mapper / wave-controller boundary owns the default ('coding' flows from this.team). Stamping a hardcoded value at the adapter would silently mask upstream bugs (defence-in-depth design intent)."
  - "Symlinked submodule's stale node_modules/@fwornle/km-core to ../../../../../lib/km-core (Rule 3 deviation — auto-fix blocking issue). The pre-existing npm-installed clone lacked the Plan 01 project module; the outer-repo node_modules pattern (symlink to lib/km-core) is the canonical resolution and is what the Docker container is INTENDED to use long-term."
  - "Did NOT modify persistence-agent.ts: TS source was deleted in Phase 42.2-04 (commit a27aac6); only stale dist artifacts remain. Verify-only no-op outcome confirmed."
  - "Did NOT modify any code-graph-rag file: grep -rn 'putEntity' integrations/code-graph-rag/src/ → 0 hits (PATTERNS correction #4); no writer-call surface there."
  - "Did NOT attempt Docker image rebuild after `uv: not found` Dockerfile failure (pre-existing infra issue unrelated to Phase 57). Used `docker-compose restart coding-services` instead to invalidate VirtioFS cache for the bind-mounted dist/ — sufficient for source-only changes per docker-compose.yml bind-mount topology."
  - "Operator selected Option 1 (unify container km-core mount on lib/km-core) at the Task 4 orchestrator checkpoint. Container recreated; in-container isProject resolves correctly (commit 862336b84)."
  - "Task 4 (HUMAN-UAT) DEFERRED to next scheduled `ukb full` run. Static verification (dual-stamp dist grep + container km-core resolution) is complete; runtime smoke (wave-analysis run + jq entity check) is verification-debt and is tracked in the Verification Debt section below. Plan closes with operator approval."
metrics:
  duration_min: 12
  total_tasks: 4
  completed_tasks: 3
  deferred_tasks: 1
  completed_date: 2026-06-14
  net_test_delta: 0
---

# Phase 57 Plan 03: Writer-Path metadata.project Stamping Summary

**One-liner:** Stamps `metadata.project` at the canonical-mapper primary site and the km-core-adapter defence-in-depth dual site for every wave-analysis writer call, gated by Plan 01's `isProject()` typeguard; container km-core resolution unified on `lib/km-core` (orchestrator fix); runtime UAT deferred as verification-debt to next scheduled `ukb full`.

## What Shipped

Two source files and three wave-agent call sites carry the new `metadata.project` stamp end-to-end through the wave-analysis writer pipeline, plus a docker-compose mount fix so the container resolves the same km-core build the workspace uses:

```typescript
// canonical-mapper.ts — primary stamp site (parallel to Phase 42.2 Gap 1 team stamp)
if (isProject(options.project)) {
  baseMetadata.project = options.project;
}

// km-core-adapter.ts — defence-in-depth dual stamp (parallel to Phase 42.2 Gap 4 team stamp)
const projectFromOptions = isProject(options.project) ? options.project : undefined;
// ...inside the metadata literal:
...(isProject((sourceMetadata as { project?: unknown }).project)
  ? { project: (sourceMetadata as { project: string }).project }
  : projectFromOptions !== undefined
  ? { project: projectFromOptions }
  : {}),

// wave1/2/3 agents — caller-side options threading
augmentWithCanonical(entity, ontologyClass, this.runId, { team: this.team, project: this.team });
```

`this.team` defaults to `'coding'` in the container per CLAUDE.md submodule mapping; `isProject(this.team)` gates the actual stamp inside canonical-mapper. TODO comments mark Phase 60+ plumbing for dedicated `parameters.project` once okm/cap teams come online.

## Tasks Executed

### Task 1: Stamp metadata.project at canonical-mapper.ts + wire wave1/2/3 callers — DONE

- **Submodule commit:** `9da904b` — `feat(57-03): stamp metadata.project at canonical-mapper + wave1/2/3 (D-04 primary site)`
- **Parent-repo pointer bump:** `4389a9e1b`
- canonical-mapper.ts: added named-import block including `isProject` (value) and `Project` (type) from `@fwornle/km-core`, extended `CanonicalMapperOptions` with optional `project?: Project | string` (loose typing tolerates transitional callers; `isProject()` narrows at the stamp site), added the stamp block immediately after the existing team stamp.
- wave1/2/3 agents: each `augmentWithCanonical(..., { team: this.team })` call extended to `{ team: this.team, project: this.team }`.
- Existing team stamp byte-untouched (D-02 invariant verified: `grep -c 'baseMetadata.team = options.team'` returns 1).
- Acceptance grep results: isProject mentions=4; baseMetadata.project assignment=1; interface field=1; team stamp preserved=1; per-wave-file `project: this.team` matches = 2 (1 in call site + 1 in JSDoc).

### Task 2: Defence-in-depth dual-stamp in km-core-adapter.ts + verify persistence-agent + code-graph-rag no-op — DONE

- **Submodule commit:** `6cedab0` — `feat(57-03): defence-in-depth metadata.project dual-stamp at km-core-adapter.storeEntity (D-04)`
- **Parent-repo pointer bump:** `11cdca828`
- km-core-adapter.ts: import statement rewritten as a single value+type named-import block to include `isProject` and `Project`; `KmCoreAdapter.storeEntity` interface signature + the implementation function signature both extended to accept `options.project?: Project | string`; `projectFromOptions` derivation added parallel to `teamFromOptions`; metadata-literal ternary added parallel to the team ternary (prefer sourceMetadata.project when valid → fall back to options.project → no-op).
- Existing team dual-stamp byte-untouched (D-02 invariant verified: `grep -c 'teamFromOptions'` returns 3).
- **persistence-agent.ts verify-only outcome:** TS source FILE DOES NOT EXIST (retired Phase 42.2-04 per STATE.md decision log line 179). Only stale `dist/agents/persistence-agent.{js,d.ts}` artifacts remain. No source change possible or needed.
- **code-graph-rag anti-regression guard:** `grep -rn 'putEntity' integrations/code-graph-rag/src/` → `0` hits. Confirmed PATTERNS correction #4 — no putEntity surface in code-graph-rag, so no stamp needed there. The grep gate is preserved for future readers to know there is intentionally no project stamp in code-graph-rag.
- Acceptance grep results: isProject mentions=7; projectFromOptions=3; metadata-literal ternary=1; teamFromOptions preserved=3; code-graph-rag putEntity=0.

### Task 3: Build submodule + container restart — DONE

- **No new commits** (build artifacts under `dist/` are gitignored; bind-mounted into container at runtime).
- `cd integrations/mcp-server-semantic-analysis && npm run build` → exit 0, clean tsc (no errors).
- Post-build dist verification:
  - `dist/agents/canonical-mapper.js` `baseMetadata.project` = 1 ✓
  - `dist/storage/km-core-adapter.js` `projectFromOptions` = 3 ✓
  - `dist/storage/km-core-adapter.js` `isProject` references = 6 ✓
  - `dist/agents/wave1-project-agent.js` `project: this.team` = 2 ✓
  - `dist/agents/wave2-component-agent.js` `project: this.team` = 2 ✓
  - `dist/agents/wave3-detail-agent.js` `project: this.team` = 2 ✓
- Docker image rebuild: **NOT executed** — pre-existing Dockerfile failure (`uv: not found` at `Dockerfile.coding-services:42`) blocked `docker-compose build coding-services`. Per docker-compose.yml the semantic-analysis `dist/` is bind-mounted (`integrations/mcp-server-semantic-analysis/dist:/coding/integrations/mcp-server-semantic-analysis/dist:ro`), so a rebuild is not strictly required for source-only changes.
- `docker-compose restart coding-services` → exited cleanly, container "Up (healthy)" within 12s. In-container dist verification matched host: `projectFromOptions` = 3, `baseMetadata.project` = 1.

### Task 4: HUMAN-UAT — DEFERRED (verification-debt)

The runtime UAT (live `ukb full` run + jq-based entity check that `metadata.project='coding'` lands on new entities) was originally a `checkpoint:human-verify` gate. After the executor surfaced the container km-core resolution blocker, the orchestrator made two decisions:

1. **Unblock the container** by re-mounting `lib/km-core` as `@fwornle/km-core` in `docker/docker-compose.yml:96` — landed as commit **`862336b84`**. In-container check confirms resolution is correct:
   ```bash
   docker exec coding-services node --input-type=module -e \
     'import("@fwornle/km-core").then(km => console.log(typeof km.isProject, km.isProject("coding"), km.PROJECTS))'
   # → function true [ "coding", "okm", "cap" ]
   ```
2. **Defer the live UAT** to the next scheduled `ukb full` rather than gating the plan close on it. Rationale: the static verification (dual-stamp dist-grep + container km-core resolution) is conclusive evidence that the writer-path stamping will work at runtime; the runtime smoke is opportunistic confirmation, not a blocker for downstream work.

Plan closed with operator approval. The verification-debt below tracks the deferred runtime check so it surfaces in `/gsd-progress` and `/gsd-audit-uat`.

## Verification Debt

**HUMAN-UAT: Confirm wave-analysis emits `metadata.project='coding'` on new entities.** Deferred from Task 4 at operator's request 2026-06-14. To discharge after the next scheduled `ukb full` (or any wave-analysis run that adds entities to the live km-core graph):

```bash
# 1) Confirm the production graph has new entities created after the Phase 57-03 cutover.
jq '[.nodes[] | select(.attributes.createdAt > "2026-06-14T16:50:00Z")] | length' \
  .data/knowledge-graph/exports/general.json

# 2) Group new entities by metadata.project. Expected: "coding" dominates; no null/undefined.
jq '[.nodes[] | select(.attributes.createdAt > "2026-06-14T16:50:00Z")]
    | map(.attributes.metadata.project)
    | group_by(.) | map({project: .[0], count: length})' \
  .data/knowledge-graph/exports/general.json

# 3) Confirm legacy metadata.team still flows alongside (D-02 invariant).
jq '[.nodes[] | select(.attributes.createdAt > "2026-06-14T16:50:00Z")
    | .attributes.metadata.team] | unique' \
  .data/knowledge-graph/exports/general.json
# Expected at minimum: ["coding"]

# 4) Hard assertion: zero new entities lack metadata.project.
jq '[.nodes[] | select(.attributes.createdAt > "2026-06-14T16:50:00Z")
    | select(.attributes.metadata.project == null)] | length' \
  .data/knowledge-graph/exports/general.json
# Expected: 0
```

Signal "approved" if (1) returns > 0, (2) shows `coding` dominating, (3) returns at least `["coding"]`, and (4) returns `0`. If any check fails, file a follow-up todo against Phase 57 — the static evidence says it should work, so any runtime failure is a real bug worth investigating.

## Acceptance Criteria — Result Matrix

| AC                                                            | Expected | Actual                                           | Status |
| ------------------------------------------------------------- | -------- | ------------------------------------------------ | ------ |
| Task 1 — isProject import in canonical-mapper                 | ≥ 1      | 4 mentions (1 import + 3 narrowing/JSDoc)        | PASS   |
| Task 1 — baseMetadata.project assignment                      | ≥ 1      | 1                                                | PASS   |
| Task 1 — interface field `project?: Project`                  | ≥ 1      | 1                                                | PASS   |
| Task 1 — wave1/2/3 each contains `project: this.team`         | each 1+  | 2 each (call site + JSDoc comment)               | PASS   |
| Task 1 — team stamp preserved (D-02)                          | ≥ 1      | 1                                                | PASS   |
| Task 1 — tsc no errors (canonical-mapper + wave agents)       | 0 errors | 0 errors                                         | PASS   |
| Task 2 — isProject import in km-core-adapter                  | ≥ 1      | 7 mentions (1 import + 6 inline guards)          | PASS   |
| Task 2 — projectFromOptions derivation                        | ≥ 1      | 3                                                | PASS   |
| Task 2 — metadata-literal ternary                             | ≥ 1      | 1                                                | PASS   |
| Task 2 — teamFromOptions preserved (D-02)                     | ≥ 1      | 3                                                | PASS   |
| Task 2 — code-graph-rag/src/ putEntity hits                   | 0        | 0                                                | PASS (anti-regression) |
| Task 2 — persistence-agent verify-only OR patched             | ✓        | TS source retired Phase 42.2-04; no-op confirmed | PASS   |
| Task 2 — tsc no errors                                        | 0 errors | 0 errors                                         | PASS   |
| Task 3 — npm run build exits 0                                | yes      | yes (clean tsc)                                  | PASS   |
| Task 3 — dist canonical-mapper.js carries baseMetadata.project | ≥ 1     | 1                                                | PASS   |
| Task 3 — dist km-core-adapter.js carries projectFromOptions   | ≥ 1      | 3                                                | PASS   |
| Task 3 — Docker rebuild succeeds                              | rebuild  | rebuild blocked by `uv: not found` (pre-existing) | PARTIAL — restart used instead |
| Task 3 — container running "Up"                               | Up       | Up (healthy)                                     | PASS   |
| Task 3 — km-core local patch (CLAUDE.md hydrate guard)        | ≥ 1 or note | 0 in both lib/km-core/dist AND ~/Agentic/km-core/dist (matches Plan 01 SUMMARY pre-existing finding) | NOTE — pre-existing, unchanged |
| Container — `isProject` resolves at runtime                   | function | `typeof km.isProject === 'function' && km.isProject('coding') === true && km.PROJECTS === ['coding','okm','cap']` (verified post-862336b84) | PASS (orchestrator fix) |
| Task 4 — runtime UAT on new ukb-emitted entities              | operator approval | DEFERRED to next `ukb full` (verification-debt) | DEFERRED |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Submodule node_modules km-core stale; symlinked to lib/km-core**

- **Found during:** Task 1 `npx tsc --noEmit` step.
- **Issue:** `npx tsc` failed with `error TS2305: Module '"@fwornle/km-core"' has no exported member 'isProject'` and same for `Project`. Investigation: `integrations/mcp-server-semantic-analysis/node_modules/@fwornle/km-core` was a stale standalone npm-install (LICENSE/README/dist/) from 2026-06-03 that pre-dates Plan 57-01's `src/types/project.ts`. The outer-repo `node_modules/@fwornle/km-core` is the canonical resolution (a symlink to `lib/km-core`); the submodule's node_modules was out of sync.
- **Fix:** `rm -rf integrations/.../node_modules/@fwornle/km-core && ln -s ../../../../../lib/km-core integrations/.../node_modules/@fwornle/km-core`. Mirrors the outer-repo pattern.
- **Files modified:** none (filesystem symlink change in node_modules — gitignored).
- **Result:** tsc compile clean. dist files produced with all Phase 57 stamps.
- **Rationale:** Rule 3 — install/sync of a npm-installed dep that's out of sync with the workspace's active dev tree is a blocking issue auto-fix. Did NOT install via npm (that risked pulling a different version from the registry); used the workspace-symlink pattern that the outer repo already uses.

**2. [Rule 3 — Out of scope] Docker image rebuild blocked by pre-existing `uv: not found` in Dockerfile.coding-services**

- **Found during:** Task 3 step 2 — `docker-compose build coding-services` failed at `Dockerfile.coding-services:42` with `/bin/sh: 1: uv: not found`.
- **Issue:** The Dockerfile installs `uv` at line 38 via the official installer to `/root/.local/bin`, then immediately uses `uv python install 3.12` at line 42. Either the installer succeeded but PATH lookup is failing under the current Docker BuildKit context, or the installer silently failed. This is a pre-existing infrastructure issue unrelated to Phase 57 source changes.
- **Fix (not attempted):** Did NOT debug the Dockerfile — out of scope for Plan 57-03. Used `docker-compose restart coding-services` instead which invalidates the VirtioFS bind-mount cache for the dist/ files that are bind-mounted (`integrations/mcp-server-semantic-analysis/dist:/coding/...:ro`). Per the docker-compose.yml bind-mount topology, source-only TS changes do NOT require an image rebuild — only the dist needs to refresh, and a restart accomplishes that.
- **Logged to:** Deferred items (out-of-scope discovery — Dockerfile uv install needs a follow-up Phase 54/55-class repair).

### Out-of-Scope Discovery (RESOLVED by orchestrator): km-core resolution inside Docker container

- **Found during:** Task 3 post-restart in-container verification.
- **Observation:** Inside the running container, `import('@fwornle/km-core')` previously resolved to `~/Agentic/km-core/dist/` (mounted via docker-compose.yml:96 `${HOME}/Agentic/km-core:/coding/node_modules/@fwornle/km-core:ro`). That host clone last committed 2026-06-04 (`c7bc236`) and did NOT carry Plan 01/02 (project module + coding.lower.json).
- **Runtime impact (pre-fix):** A test `docker exec coding-services node --input-type=module -e 'import("@fwornle/km-core").then(km => console.log(typeof km.isProject))'` returned `isProject: undefined PROJECTS: undefined`. The next `ukb full` run that hit the new `isProject(options.project)` call site would have thrown.
- **Resolution (Option 1, operator-selected):** Orchestrator landed commit **`862336b84`** changing `docker/docker-compose.yml:96` from `${HOME}/Agentic/km-core` to `${CODING_REPO:-.}/lib/km-core`, then recreated the container. Post-fix in-container check: `isProject: function | isProject("coding"): true | PROJECTS: ["coding","okm","cap"]`. The two-clone drift pattern is eliminated — container and workspace now share the same km-core dev tree.

## Self-Check: PASSED

Files modified (verified `grep` markers present):

- `integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts` — `baseMetadata.project = options.project` FOUND (1 match)
- `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts` — `project: this.team` FOUND in augmentWithCanonical call
- `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts` — same
- `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts` — same
- `integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts` — `projectFromOptions` FOUND (3 matches)

Commits verified (`git log --oneline | grep -q <hash>`):

- Submodule `9da904b` (Task 1 feat) — FOUND
- Submodule `6cedab0` (Task 2 feat) — FOUND
- Outer `4389a9e1b` (Task 1 pointer bump) — FOUND
- Outer `11cdca828` (Task 2 pointer bump) — FOUND
- Outer `862336b84` (orchestrator container fix) — FOUND
- Outer `caffa946b` (partial SUMMARY, now superseded by this rewrite) — FOUND
- Outer `cd587a7d6` (interim STATE blocker note, now superseded) — FOUND

Build artifact verified (host-side):

- `integrations/mcp-server-semantic-analysis/dist/agents/canonical-mapper.js` carries `baseMetadata.project` (1 match)
- `integrations/mcp-server-semantic-analysis/dist/storage/km-core-adapter.js` carries `projectFromOptions` (3 matches)

Build artifact verified (container-side, post-restart):

- `/coding/integrations/mcp-server-semantic-analysis/dist/storage/km-core-adapter.js` carries `projectFromOptions` (3 matches)
- `/coding/integrations/mcp-server-semantic-analysis/dist/agents/canonical-mapper.js` carries `baseMetadata.project` (1 match)

Container km-core resolution (post-862336b84):

- `typeof km.isProject === 'function'` ✓
- `km.isProject('coding') === true` ✓
- `km.PROJECTS deep-equals ['coding','okm','cap']` ✓

## Threat Flags

None. The change is additive — closed-set typeguard on a metadata field. No new network endpoint, auth path, file access pattern, schema change, or trust boundary introduced. The typeguard is security-positive (closed-set vocabulary at the writer surface narrows rather than widens what can be written).

## Requirement Tracking Notes

- **LOWERONTO-04** (the requirement this plan targets) is NOT marked complete on this plan. The plan covers the going-forward writer surface; the existing 1262 nodes need Plan 57-05 (one-shot backfill) to satisfy the "every entity carries the tag" portion. Per Plan 01 SUMMARY's existing pattern, Plan 05 or the Phase 57 verifier closes the LOWERONTO-04 checkbox.

## Submodule Commit Topology

| Commit | Repo | Branch | Hash | Subject |
| ------ | ---- | ------ | ---- | ------- |
| Task 1 (src) | mcp-server-semantic-analysis | main | `9da904b` | `feat(57-03): stamp metadata.project at canonical-mapper + wave1/2/3 (D-04 primary site)` |
| Task 1 (ptr) | outer (coding) | main | `4389a9e1b` | `chore(57-03): bump mcp-server-semantic-analysis pointer for Task 1` |
| Task 2 (src) | mcp-server-semantic-analysis | main | `6cedab0` | `feat(57-03): defence-in-depth metadata.project dual-stamp at km-core-adapter.storeEntity (D-04)` |
| Task 2 (ptr) | outer (coding) | main | `11cdca828` | `chore(57-03): bump mcp-server-semantic-analysis pointer for Task 2` |
| Task 3 (build) | — | — | (no commit — dist/ gitignored, bind-mounted) | — |
| Interim partial SUMMARY | outer (coding) | main | `caffa946b` | `docs(57-03): partial SUMMARY for paused plan 03` (superseded by this rewrite) |
| Interim STATE blocker | outer (coding) | main | `cd587a7d6` | `docs(state): record Phase 57-03 partial completion + Task 4 checkpoint blocker` (superseded) |
| Orchestrator unblock | outer (coding) | main | `862336b84` | `fix(57-03): re-mount lib/km-core as @fwornle/km-core in coding-services` |
| Final SUMMARY + state | outer (coding) | main | (this commit) | `docs(57-03): close plan with Task 4 deferred as verification-debt` |

Topology matches Phase 42.1.2-03 precedent: `src/agents/` and `src/storage/` are REAL directories inside the submodule (not symlinks), so dual-commit (submodule + outer pointer-bump) is required.

## Downstream Hand-off

Plan 03 closes; Wave 2's remaining sibling and Wave 3 are unblocked:

- **Plan 04** (`coding.lower.json` classifier injection) — independent of writer-stamping; can land in parallel.
- **Plan 05** (`scripts/backfill-project-tag.mjs`) — backfills the existing 1262 nodes with `metadata.project`. Will use the same `isProject()` typeguard for closed-set validation. The container fix in 862336b84 means the backfill script can run inside the container too if needed.
- **Plan 06** (unified-viewer transitional filter read `metadata.project ?? metadata.team`) — independent.

## Operator Notes

1. **Symlink intervention in submodule node_modules:** `integrations/mcp-server-semantic-analysis/node_modules/@fwornle/km-core` is now a symlink to `../../../../../lib/km-core` (was a stale npm-installed standalone). This survives until a `cd integrations/mcp-server-semantic-analysis && npm install` step blows it away; document in the Plan 03 post-mortem if it recurs.
2. **Container km-core mount is now `lib/km-core` (orchestrator fix 862336b84):** `~/Agentic/km-core` is no longer a runtime dependency for the container — the container shares the workspace's km-core dev tree via the `CODING_REPO` variable. Any future km-core change picked up by a `cd integrations/mcp-server-semantic-analysis && npm run build` is automatically visible in the container after a restart (no need to sync a separate clone).
3. **Dockerfile `uv: not found` is pre-existing:** Not introduced by Phase 57; not in scope to fix here. Logged for a future infrastructure repair phase.
4. **Verification debt:** The runtime `ukb full` UAT (see Verification Debt section) is the one outstanding check. Static evidence is conclusive that the stamping works; the runtime check is opportunistic.

---

*Plan opened 2026-06-14T14:33Z; Tasks 1-3 completed by ~14:40Z; Task 4 paused as checkpoint at 14:44Z; orchestrator unblocked container at 16:49Z (commit 862336b84); plan closed with Task 4 deferred 2026-06-14T17:00Z. Total wall-clock for plan execution ~12 min (excludes orchestrator unblock window).*
