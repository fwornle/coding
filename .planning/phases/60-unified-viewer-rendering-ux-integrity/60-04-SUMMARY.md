---
phase: 60-unified-viewer-rendering-ux-integrity
plan: 04
subsystem: viewer
tags: [hierarchy-roots, ontology-classification, collective-knowledge, km-core, semantic-analysis, online-filter, visibility-predicate]

# Dependency graph
requires:
  - phase: 57-lower-ontology-project-tagging-foundation
    provides: "PROJECTS / Project / isProject pattern in lib/km-core/src/types/project.ts; scripts/backfill-project-tag.mjs ontologyDir resolution template"
  - phase: 43-okm-cross-repo-migration
    provides: "Phase 43 D-G4.1 trusted-path write convention (putEntity with skipOntologyCheck:true)"
  - phase: 41-online-learning-adapter-post-hoc-resolution
    provides: "km-core scripts ontologyDir lesson (commits 87bc2f567 / fd35c5350)"
provides:
  - "lib/km-core/src/types/hierarchy-roots.ts — HIERARCHY_ROOTS / HierarchyRoot / HIERARCHY_ROOT_CLASS / isHierarchyRoot exported from root barrel AND /types sub-barrel"
  - "scripts/repair-ck-ontology-class.mjs — idempotent CK ontologyClass repair via trusted-path putEntity"
  - "Writer-side hard-root guard in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts:classifySingleObservation — short-circuits LLM classification for the 5 hierarchy roots"
  - "OntologyMetadata.classificationMethod union widened with 'hard-root-guard' literal"
affects: [phase-60-unified-viewer-rendering-ux-integrity, future-llm-reclassifier-workflows, lower-onto-04-team-anchor-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Closed-set vocabulary via `as const` tuple + derived literal-union + runtime typeguard (mirrors Phase 57 PROJECTS pattern)"
    - "Writer-side guard reads from a km-core single-source-of-truth constant, sharing the same import with the matching data-repair script"
    - "node:test + node:assert/strict for new agent tests (matches existing project test convention)"

key-files:
  created:
    - lib/km-core/src/types/hierarchy-roots.ts
    - lib/km-core/tests/unit/hierarchy-roots.test.ts
    - scripts/repair-ck-ontology-class.mjs
    - integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.hierarchy-roots.test.ts
  modified:
    - lib/km-core/src/index.ts
    - lib/km-core/src/types/index.ts
    - integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts

key-decisions:
  - "HIERARCHY_ROOTS is the closed-set list narrowed from QA agent's 8-name exemptNodes Set to the 5 Phase-60-scoped roots (CK + 4 project anchors), per D-14. Ui/Resi/Raas excluded as out-of-scope team-anchor remnants (LOWERONTO-04)."
  - "HIERARCHY_ROOT_CLASS is a lookup map (Record), not a per-class constant, so the guard can derive lockedClass = MAP[name] in one expression."
  - "classificationMethod union widened (not cast-asserted) so the new 'hard-root-guard' literal is type-safe end-to-end. Existing consumers continue to compile (additive widening)."
  - "Repair script stays NARROW per D-24 — touches ONLY attributes.ontologyClass on the CK node. Does NOT touch metadata.classification (already 'System') or metadata.team (out-of-scope; LOWERONTO-04). 4 project anchors not touched here (writer-guard keeps them locked from the next workflow forward)."
  - "process.stderr.write for repair-script status text is a deliberate channel choice matching backfill-project-tag.mjs precedent — NOT a constraint-dodge from no-console-log. Documented in the plan §Notes."
  - "Surface witness `void HIERARCHY_ROOTS;` added to the agent file so strict tree-shakers cannot eliminate the import when only HIERARCHY_ROOT_CLASS + isHierarchyRoot are referenced by the runtime guard."

patterns-established:
  - "Hierarchy-root single source of truth: a closed-set tuple + lookup map exported from @fwornle/km-core, consumed by both the writer guard and the data-repair script. Adding a new root = single-file change in lib/km-core/src/types/hierarchy-roots.ts + test update; downstream consumers re-build automatically."
  - "Writer-side hard-root guard at the LLM-classifier seam: any name in the closed set short-circuits to a locked class with classificationMethod='hard-root-guard' for telemetry visibility — bypassing the LLM call cost AND any LLM verdict drift."

requirements-completed: [VKBUI-04]

# Metrics
duration: 13min
completed: 2026-06-17
---

# Phase 60 Plan 04: G4 — CollectiveKnowledge under Online filter Summary

**HIERARCHY_ROOTS registry in km-core + idempotent CK-class repair script + writer-side hard-root guard so the LLM re-classifier can no longer drift CollectiveKnowledge from `'System'` back to `'Detail'`**

## Performance

- **Duration:** ~13 min (source-side implementation, build, regression check)
- **Started:** 2026-06-17T12:52:47Z
- **Completed:** 2026-06-17T13:05:39Z (Tasks 1-3; Task 4 checkpoint awaits operator)
- **Tasks:** 3 of 4 complete; Task 4 is a `type="checkpoint:human-verify"` awaiting operator run of `node scripts/repair-ck-ontology-class.mjs` against the live snapshot + a viewer smoke at `localhost:5173/viewer/coding`
- **Files modified:** 7 (3 new + 1 modified in km-core; 1 new + 1 modified in semantic-analysis; 1 new script in superproject)

## Accomplishments

- **`lib/km-core/src/types/hierarchy-roots.ts` shipped** — closed-set vocabulary of 5 hierarchy-root names (`CollectiveKnowledge` → `System`; `Coding` / `DynArch` / `Timeline` / `Normalisa` → `Project`) with literal-union type, lookup map, and defensive typeguard. Re-exported via both the root barrel `@fwornle/km-core` and the `/types` sub-barrel.
- **27/27 hierarchy-roots vitest tests pass**, covering the 7 behavior cases the plan locks plus extra defensive cases (null/undefined/numeric/array inputs). Full km-core suite: 385/385 — zero regression.
- **`scripts/repair-ck-ontology-class.mjs` shipped** — host-side, idempotent one-shot CK repair via km-core's trusted path (`putEntity({ skipOntologyCheck: true })`). Dry-run against the live snapshot reports the intended flip `"Detail" → "System"` on entity `019eb7c3-e339-7799-9967-664b1a71a3ea`. Logs structured before/after JSON to `.data/repair-ck-ontology-class-<ISO>.json`.
- **Writer-side hard-root guard live in `ontology-classification-agent.ts`** — `classifySingleObservation` short-circuits BEFORE the classifier is invoked when the observation name is in HIERARCHY_ROOTS, returning a `ClassifiedObservation` with `ontologyMetadata.classificationMethod = 'hard-root-guard'` and the locked class. 8/8 hard-root guard tests pass; full agent test suite 46/46 — zero regression.
- **Container-side activation confirmed** — `coding-services` bind-mounts both the km-core `dist/` (via `node_modules/@fwornle/km-core` mount) AND the mcp-server-semantic-analysis `dist/`, so the new code is live in the running container after a `supervisorctl restart mcp-servers:semantic-analysis`. Verified by `docker exec ... grep -l "hard-root-guard"` returning the dist path.

## Task Commits

Each task was committed atomically. Submodule commits live in the respective submodule repos; the superproject commit bumps the submodule pointers:

1. **Task 1 (TDD): HIERARCHY_ROOTS registry**
   - `lib/km-core@e9439d9` — `test(60-04): add failing tests for HIERARCHY_ROOTS registry` (RED, 27 cases)
   - `lib/km-core@ddc4be3` — `feat(60-04): add HIERARCHY_ROOTS registry to km-core types` (GREEN)
2. **Task 2: Repair script** — superproject `4003876c5` — `feat(60-04): add scripts/repair-ck-ontology-class.mjs (one-shot CK repair)`
3. **Task 3 (TDD): Writer-side guard**
   - `integrations/mcp-server-semantic-analysis@fa3f76c` — `test(60-04): add failing tests for hard-root guard` (RED, 8 cases)
   - `integrations/mcp-server-semantic-analysis@bcaf8f2` — `feat(60-04): hard-root guard exempts HIERARCHY_ROOTS from LLM re-classification` (GREEN)
4. **Task 4: Human-verify checkpoint** — pending operator. Plan paused at the structured `checkpoint:human-verify` boundary; orchestrator notified via checkpoint payload (see CHECKPOINT REACHED block returned alongside this SUMMARY).

**Submodule-pointer bump (superproject):** `0936d1d92` — `chore(60-04): bump submodule pointers (km-core + semantic-analysis)`.

**Plan metadata commit:** to be added with SUMMARY.md + STATE.md (final commit at end of plan).

## Files Created/Modified

- `lib/km-core/src/types/hierarchy-roots.ts` — **NEW.** Closed-set registry: `HIERARCHY_ROOTS` tuple, `HierarchyRoot` literal-union, `HIERARCHY_ROOT_CLASS` lookup map, `isHierarchyRoot` typeguard. Documented as the single source of truth for the writer guard + repair script.
- `lib/km-core/src/types/index.ts` — re-exports HIERARCHY_ROOTS surface from the `/types` sub-barrel.
- `lib/km-core/src/index.ts` — re-exports HIERARCHY_ROOTS surface from the root barrel so downstream consumers can `import { isHierarchyRoot } from '@fwornle/km-core'` without diving into the module path.
- `lib/km-core/tests/unit/hierarchy-roots.test.ts` — **NEW.** 27 vitest cases locking the closed-set vocabulary + the typeguard contract + the root-barrel reachability.
- `scripts/repair-ck-ontology-class.mjs` — **NEW.** Host-side, idempotent one-shot CK repair. Imports HIERARCHY_ROOTS + HIERARCHY_ROOT_CLASS from `@fwornle/km-core` so the locked class lives once. `--dry-run`, `--help`, `--source`, `--log-dir` flags. Exits 0 on no-change / successful flip / dry-run; 1 on post-write check failure; 2 on pre-flight failure; 3 on uncaught exception. Uses `process.stderr.write` for status (matching `scripts/backfill-project-tag.mjs` template precedent).
- `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` — guard inserted at the top of `classifySingleObservation` (before the existing `buildClassificationInput` call). `OntologyMetadata.classificationMethod` union widened with `'hard-root-guard'`. `HIERARCHY_ROOTS` / `HIERARCHY_ROOT_CLASS` / `isHierarchyRoot` imported from `@fwornle/km-core`.
- `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.hierarchy-roots.test.ts` — **NEW.** 8 node:test cases covering the 6 plan behaviors (CK + each project anchor + non-root pass-through + null/undefined defense + closed-set surface witness).

## Decisions Made

See the `key-decisions` frontmatter block above for the load-bearing decisions. In summary:

- HIERARCHY_ROOTS narrowed from QA agent's 8-name set to the 5 D-14 roots (Ui/Resi/Raas excluded as out-of-scope team-anchor remnants).
- Union widening over cast-asserting for `classificationMethod: 'hard-root-guard'` — additive type change preserves backward compat.
- Repair script scope kept narrow per D-24 — `attributes.ontologyClass` only.
- `process.stderr.write` channel choice documented in the plan §Notes as deliberate, not constraint-dodging.

## Deviations from Plan

### Deviation 1 — Docker build blocked by pre-existing proxy misconfiguration (Rule 4 surfaced; in-scope downgrade applied)

**Found during:** Task 3 final step (`cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services`).

**Issue:** `docker-compose build coding-services` failed at the `RUN curl -LsSf https://astral.sh/uv/install.sh | sh` step with `Failed to connect to host.docker.internal port 3128 after 1 ms`. The Docker daemon is configured to route all build-step HTTP traffic through a corporate proxy (`host.docker.internal:3128`) that is unreachable on the current network — a pre-existing infra state, NOT introduced by this plan. Per the project's `reference_llm_proxy_corp_wrapper.md` MEMORY entry the operator alternates between BMW CN (proxy needed) and public networks (no proxy); the Docker daemon's proxy config persists from a previous corp-network session.

**Plan resolution applied:** Examined `docker-compose.yml` and confirmed that BOTH:
- `lib/km-core` is bind-mounted into `coding-services` at `node_modules/@fwornle/km-core` (line 110), AND
- `integrations/mcp-server-semantic-analysis/dist/` is bind-mounted at `/coding/integrations/mcp-server-semantic-analysis/dist` (line 115)

That means the `npm run build` step on the host emits a dist that the container reads live via bind-mount — Docker rebuild is NOT required to activate the new code. The plan's mandate to rebuild Docker is a defensive instruction inherited from the CLAUDE.md submodule-build rule; in this specific bind-mount topology a `supervisorctl restart mcp-servers:semantic-analysis` is sufficient.

**Verification:**
- `docker exec coding-services grep -l "hard-root-guard" /coding/integrations/mcp-server-semantic-analysis/dist/agents/ontology-classification-agent.js` returns the dist path (proves the new guard code is live in the container).
- `docker exec coding-services ls /coding/integrations/mcp-server-semantic-analysis/node_modules/@fwornle/km-core/dist/types/hierarchy-roots.js` returns the file path (proves the new km-core export is reachable from inside the container).
- `docker exec coding-services grep "HIERARCHY_ROOTS" /coding/integrations/mcp-server-semantic-analysis/node_modules/@fwornle/km-core/dist/index.js` shows the root-barrel re-export is live inside the container.
- `mcp-servers:semantic-analysis` restarted cleanly (PID 26970, status `RUNNING`).

**Files modified by deviation:** none (this is a verification / mitigation deviation, not a code-fix).

**Scope assessment:** This is a Rule 4 — the underlying Docker proxy config issue is architectural and out of Phase 60 scope (separate phase: proxy config + launchd-wrapper for corp-vs-public networks). The plan's runtime objective (writer guard live in container) is met via the bind-mount path; the operator should rerun `docker-compose build` once the proxy state is restored, but doing so does not change the runtime behaviour today.

---

**Total deviations:** 1 (handled via bind-mount verification — pre-existing infra issue, not introduced by this plan)
**Impact on plan:** None — the writer guard is verifiably live in the running container. Task 3 acceptance criterion 6 (`docker exec ... grep -l "hard-root-guard" ...`) passes.

## Issues Encountered

- `coding-services` Docker container build failed due to corporate proxy misconfiguration; resolved via bind-mount verification path (see Deviation 1).

## Known Stubs

None — no placeholder values introduced. The repair script handles the data flip live; the writer guard activates immediately on the next ukb run.

## Threat Flags

None — no new network endpoints, auth surfaces, or trust-boundary changes introduced. Existing threat register (T-60-04-01, T-60-04-02, T-60-04-03) is fully addressed by the implementation:

- T-60-04-01 (Tampering — LLM re-classifier overwriting CK): mitigated by writer-side hard-root guard (Task 3) + HIERARCHY_ROOTS closed-set constant (Task 1).
- T-60-04-02 (Tampering — repair script bypassing ontology validation): accepted, as documented; `skipOntologyCheck:true` is the Phase 43 D-G4.1 trusted-path convention and the script is operator-run, not network-exposed.
- T-60-04-03 (Repudiation — repair without audit trail): mitigated by the `.data/repair-ck-ontology-class-<ts>.json` log written on every run, including no-change runs.

## TDD Gate Compliance

Both TDD tasks followed RED → GREEN cleanly:

| Task | RED commit | GREEN commit | Test count | Gate status |
|------|------------|--------------|------------|-------------|
| Task 1 (HIERARCHY_ROOTS) | `lib/km-core@e9439d9` | `lib/km-core@ddc4be3` | 27 | PASS |
| Task 3 (writer guard) | `integrations/mcp-server-semantic-analysis@fa3f76c` | `integrations/mcp-server-semantic-analysis@bcaf8f2` | 8 | PASS |

No REFACTOR commits needed — both implementations were minimal and matched the plan's <action> spec without follow-up cleanup.

## Self-Check: PASSED

Verification commands run before this SUMMARY was finalized:

- `[ -f lib/km-core/src/types/hierarchy-roots.ts ] && echo FOUND` → FOUND
- `[ -f scripts/repair-ck-ontology-class.mjs ] && echo FOUND` → FOUND
- `[ -f integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.hierarchy-roots.test.ts ] && echo FOUND` → FOUND
- `cd lib/km-core && git log --oneline -3` → shows `ddc4be3` (GREEN) + `e9439d9` (RED) in km-core history
- `cd integrations/mcp-server-semantic-analysis && git log --oneline -3` → shows `bcaf8f2` (GREEN) + `fa3f76c` (RED) in semantic-analysis history
- `git log --oneline -3` (superproject) → shows `0936d1d92` (submodule-pointer bump) + `4003876c5` (repair script)
- `docker exec coding-services grep -l "hard-root-guard" /coding/integrations/mcp-server-semantic-analysis/dist/agents/ontology-classification-agent.js` → returns the dist path
- `node scripts/repair-ck-ontology-class.mjs --dry-run` → exits 0 with `DRY RUN — would flip ontologyClass: "Detail" → "System"`
- `cd lib/km-core && npx vitest run tests/unit/hierarchy-roots.test.ts` → 27/27 pass
- `cd integrations/mcp-server-semantic-analysis && node --test dist/agents/ontology-classification-agent.hierarchy-roots.test.js` → 8/8 pass

## Next Phase Readiness

**Plan 60-04 status:** Tasks 1-3 complete; Task 4 is a `type="checkpoint:human-verify"` operator gate. The orchestrator received the checkpoint payload and the plan is PAUSED at Task 4. Plan-level completion + ROADMAP / STATE marking will occur after the operator runs the repair script and confirms the visual smoke at `localhost:5173/viewer/coding`.

**What's ready for the next plan (60-05 / 60-06 in Wave 1):**
- The HIERARCHY_ROOTS surface in `@fwornle/km-core` is shipped and re-exported via both root + types barrels — any future writer / reader can import without diving into the module path.
- The writer-side guard cannot be bypassed by future LLM re-classifier code paths that go through `classifySingleObservation` (the single entry point used by `classifyObservations`).
- The same pattern (closed-set tuple + lookup map + typeguard + writer guard at the LLM seam) can be lifted into LOWERONTO-04 to lock the team-anchor remnants (`Ui`, `Resi`, `Raas`).

**Blockers / concerns:**
- The Docker proxy config issue (Deviation 1) will block future workflow runs that need a full Docker rebuild. This is out-of-scope for Phase 60 but should be filed as a follow-up if it recurs across other plans.
- Task 4 operator gate remains: until the operator runs the repair script against the live snapshot, CK's `ontologyClass` is still `'Detail'` in `.data/knowledge-graph/exports/general.json` and the Online filter will still hide CK. The writer guard prevents the drift from RECURRING, but does not retroactively fix the existing snapshot — that's what the repair script is for.

---
*Phase: 60-unified-viewer-rendering-ux-integrity*
*Completed: 2026-06-17 (Tasks 1-3; Task 4 checkpoint pending operator)*
