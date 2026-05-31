---
phase: 43-okm-cross-repo-migration-c
plan: 02
subsystem: packaging
tags: [submodule, vendor-tarball, https, cross-repo, npm-pack]

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: Plan 43-01 verification SHA (962de7555d3db237b55372a3952e587c15a68b6d) + tag (v0.1.0-phase43-verified) pushed to public github.com/fwornle/km-core
  - phase: 42-offline-ukb-migration-b
    provides: D-G1.1 lib/km-core submodule pattern (the coding repo's own template)

provides:
  - OKM has its own lib/km-core git submodule, HTTPS-pinned to km-core v0.1.0-phase43-verified
  - scripts/repack-km-core.sh helper (executable, syntax-clean) automates D-G1.4's 7-step re-pack workflow
  - .gitignore extended for submodule node_modules / dist build artifacts
  - Both inner-OKM and outer-rapid-automations commits landed (gitlink kept in sync)

affects: [43-04-ontology-unification, 43-05-route-cleanup, 43-08-storage-cutover, 43-07-json-replay]

tech-stack:
  added:
    - "Git submodule (lib/km-core) — HTTPS clone of github.com/fwornle/km-core"
    - "Bash repack helper (scripts/repack-km-core.sh) — D-G1.4 7-step workflow"
  patterns:
    - "Cross-repo submodule with HTTPS URL for bmw.ghe.com compatibility (per memory/feedback_bmw_ghe_https.md)"
    - "Submodule + vendor-tarball indirection — submodule for dev convenience, vendor tarball for npm-install stability"

key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.gitmodules
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/lib/km-core (submodule)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/scripts/repack-km-core.sh
  modified:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.gitignore (appended 2 lines)

key-decisions:
  - "Pinned at SHA 962de75 (tag v0.1.0-phase43-verified) — required pushing Plan 43-01's commit to public github.com/fwornle/km-core first because the OKM submodule clone over HTTPS can only see pushed commits."
  - "Stashed pre-existing OKM-side dirty state (src/api/server.ts, src/index.ts, src/store/km-store-adapter.ts, vendor/fwornle-km-core-0.1.0.tgz, package-lock.json) before running Plan 02 — those are Phase 44 /api/km mount wiring that Plan 43-05 will explicitly revert per D-G2.4."
  - "Outer rapid-automations bump incidentally captured 3 pre-existing OKM main commits the outer hadn't tracked yet (d9fae27, 92e98da, bfa7314). Documented in the outer commit message; no scope creep."

patterns-established:
  - "Pre-flight check protocol for cross-repo plans: inspect dirty state of all repos before touching, stash unrelated WIP separately so commits stay clean, document the stash in the SUMMARY."
  - "Two-commit cross-repo update: inner repo commit (OKM) lands the actual change; outer repo commit (rapid-automations) bumps the gitlink to make the change visible from the parent."

requirements-completed: [INT-03]

duration: 35min
completed: 2026-05-31
---

# Phase 43 Plan 02: OKM Packaging — Submodule + Repack Helper

**OKM now owns a lib/km-core submodule pinned at the Plan 43-01 verification tag; scripts/repack-km-core.sh wired for future Plan 07 re-pack; existing vendor tarball + package.json untouched as planned.**

## Performance

- **Duration:** ~35 min (including pre-flight cleanup decisions and the github push)
- **Completed:** 2026-05-31T11:30Z
- **Tasks:** 3 (all completed)
- **Files created/modified in OKM:** 4 (.gitmodules, lib/km-core gitlink, scripts/repack-km-core.sh, .gitignore)

## Accomplishments

- **lib/km-core submodule added inside OKM** at `integrations/operational-knowledge-management/lib/km-core/` via `git submodule add`. HTTPS URL `https://github.com/fwornle/km-core.git` (public repo, zero-auth — bmw.ghe.com SSH-publickey issue dodged per `memory/feedback_bmw_ghe_https.md`).
- **Submodule pinned at SHA `962de7555d3db237b55372a3952e587c15a68b6d`**, the exact commit Plan 43-01 verified. Tag `v0.1.0-phase43-verified` resolves to the same SHA.
- **scripts/repack-km-core.sh** authored (executable, `bash -n` clean, no shellcheck regressions). Automates the D-G1.4 7-step workflow: validate semver → cd lib/km-core → npm install → npm run build → npm pack → mv .tgz to vendor/ → rm older vendor tarballs → edit package.json via node one-liner → npm install in OKM root → emit ready-to-paste commit suggestion on stderr. NOT executed in this plan.
- **.gitignore extended** with `lib/km-core/node_modules/` and `lib/km-core/dist/` so future submodule builds don't leak into OKM's git status.
- **Two commits landed:**
  - OKM inner: `eaed945` on main (`chore(packaging): add lib/km-core submodule + repack helper (Phase 43 D-G1.1, D-G1.2, D-G1.4)`)
  - Outer rapid-automations: `669404c` on main (`chore: bump OKM submodule — Phase 43 Plan 02`)
- **km-core v0.1.0-phase43-verified pushed** to public `github.com/fwornle/km-core` so OKM's HTTPS submodule clone could reach it. Plan 43-01's verification commit + tag are now both public.

## Task Commits

Cross-repo, three repos touched:

1. **Task 1 + 2 + 3 (Plan 02 deliverables)** in OKM (`bmw.ghe.com/.../operational-knowledge-management`):
   - `eaed945` — `chore(packaging): add lib/km-core submodule + repack helper (Phase 43 D-G1.1, D-G1.2, D-G1.4)`
   - 4 files changed (.gitmodules new, lib/km-core gitlink new, scripts/repack-km-core.sh new, .gitignore +2 lines)

2. **Outer gitlink bump** in rapid-automations (`bmw.ghe.com/.../rapid-automations`):
   - `669404c` — `chore: bump OKM submodule — Phase 43 Plan 02 (km-core submodule + repack helper)`
   - 1 file changed (integrations/operational-knowledge-management pointer)

3. **km-core push to github.com** (required to make Plan 01's verified SHA reachable via HTTPS):
   - `962de75` (already committed locally in Plan 01) — now pushed to `origin/main`
   - Tag `v0.1.0-phase43-verified` — pushed to origin

## Files Created/Modified

**In OKM (`~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/`):**
- `.gitmodules` (NEW, 3 lines) — declares `[submodule "lib/km-core"]` with HTTPS URL
- `lib/km-core/` (NEW gitlink, mode 160000) — pinned to SHA 962de75
- `scripts/repack-km-core.sh` (NEW, executable) — D-G1.4 7-step automation
- `.gitignore` (MODIFIED, +2 lines) — `lib/km-core/node_modules/` and `lib/km-core/dist/`

**In rapid-automations (`~/Agentic/_work/rapid-automations/`):**
- `integrations/operational-knowledge-management` gitlink bumped `0e6d102 → eaed945`

**Pushed to github.com/fwornle/km-core:**
- Branch `main` advanced `e423c46 → 962de75`
- New tag `v0.1.0-phase43-verified` at `962de75`

**Untouched (per plan scope):**
- `package.json` — `@fwornle/km-core` still points at `file:vendor/fwornle-km-core-0.1.0.tgz` (verified by grep)
- `vendor/fwornle-km-core-0.1.0.tgz` — still 32167 bytes (verified by `ls -la`)
- Every TS source file in OKM — zero edits

## Decisions Made

- **Pushed Plan 01 to github first** rather than the plan's documented fallback (pinning at the current public main SHA `e423c46`). Pushing was the cleanest path — Plan 43-04+ are guaranteed to compile against the verified km-core schema, and the verification round-trip tests are now reachable from the submodule. The push was confined to the user's own public km-core repo.
- **Stashed pre-existing OKM dirty state** rather than committing or reverting it. The stash entry `pre-Phase-43-02 WIP: /api/km mount leak + tarball overwrite + package-lock delete (pending D-G2.4 revert by Plan 05)` preserves the WIP for inspection. Plan 43-05 will revert that exact wiring per D-G2.4, so the stash is likely to be `git stash drop`ped after Plan 05 lands.
- **Outer commit captured 3 pre-existing OKM main commits** that the rapid-automations gitlink had never bumped to (d9fae27, 92e98da, bfa7314). Documented honestly in the outer commit message rather than trying to rewind history.
- **Skipped `.data/ingestion-history.json` from the OKM commit** — it's runtime data churn from `npm test` initialization, not part of Plan 02 scope.

## Deviations from Plan

**1. Pre-flight OKM dirty state required user-approved stash before proceeding**
- **Found during:** Task 1 pre-flight inspection of OKM git status
- **Issue:** OKM had 6 uncommitted files unrelated to Plan 02 (Phase 44 mount wiring + tarball overwrite + package-lock delete)
- **Fix:** Asked user; user chose "stash". Single `git stash push` with explicit filename list captured everything, leaving a clean working tree for Plan 02. Stash entry visible via `git -C $OKM stash list`.
- **Files affected:** Stash entry only; no working-tree changes ascribed to Plan 02.
- **Verification:** Post-stash `git status --short` was empty; pre-Plan-02 baseline established cleanly.
- **Committed in:** N/A — stash, not commit.
- **Impact on plan:** Zero scope creep. The plan's assumptions (clean package.json, clean tarball) were honored.

**2. Pushed Plan 01 commit + tag to github.com (cross-repo write outside plan scope)**
- **Found during:** Task 1 step 2 — submodule clone could not reach SHA 962de75
- **Issue:** Plan 43-01's verification commit was local-only on the user's machine; the public github.com mirror didn't have it.
- **Fix:** Asked user; user chose "push first". `git push origin main` + `git push origin v0.1.0-phase43-verified` to the user's own public repo.
- **Files affected:** None in OKM or coding repo. Two refs advanced on github.com/fwornle/km-core.
- **Verification:** Post-push `git fetch` inside the OKM submodule resolved `v0.1.0-phase43-verified` immediately.
- **Committed in:** N/A — push, not commit.
- **Impact on plan:** Plan 02 ran exactly as written; the push was a precondition the plan didn't anticipate but the user approved.

**3. Outer rapid-automations bump captured 4 commits (3 pre-existing + Plan 02)**
- **Found during:** Pre-bump `git submodule summary` showed 4 commits between outer gitlink and OKM main
- **Issue:** Outer pointer was at `0e6d102`; OKM main was at `eaed945`. Three prior OKM commits (d9fae27, 92e98da, bfa7314) were already on OKM main but never reflected in the outer pointer.
- **Fix:** Single bump captures all 4 — alternative would be to rewind OKM history, which is destructive.
- **Files affected:** `integrations/operational-knowledge-management` pointer in rapid-automations.
- **Verification:** Outer commit message names all 4 covered commits.
- **Committed in:** `669404c` (outer).
- **Impact on plan:** Zero scope creep — Plan 02's own change still rides on the bump; the 3 prior commits were always part of OKM main and would have been picked up by the next bump regardless.

**Total deviations:** 3 procedural — no scope creep, no security implications. All explicitly user-approved.

## Issues Encountered

- **Test baseline contains 2 pre-existing failures + 7 file-level errors** in `tests/unit/{circuit-breaker, claude-code-provider, copilot-provider, failover-chain, llm-service, provider-registry}.test.ts` and `tests/integration/cli-smoke.test.ts`. All reference `src/llm/providers/` — a directory that does NOT exist in the OKM repo. These tests were added by commit `73e15b1 test(09-02): add failover chain test and live CLI smoke tests` and have been failing since. Not a Plan 02 regression. Documented in the inner commit message for trace.
- **Test results:** 493 passed / 2 failed / 41 files (7 with file-load errors). Build green; the 2 test failures + 7 file errors are the pre-existing baseline.

## User Setup Required

None — Plan 02 is purely VCS + script setup. No services started, no env vars added.

## Next Phase Readiness

**Plan 43-03 unblocked** (independent — runs in parallel; targets rapid-automations root `package.json`).

**Plan 43-04, 05, 07, 08 unblocked** — they all import from `@fwornle/km-core` which now resolves consistently:
- Source-of-truth: `lib/km-core/` submodule pinned at `962de75`
- Runtime: `vendor/fwornle-km-core-0.1.0.tgz` (unchanged) — what `npm install` consumes
- Round-trip tests (`tests/unit/entity-layer-field.test.ts`) reachable from the submodule for any cross-repo dev work

**Plan 43-07 cutover prep:** If Plan 07's executor decides a fresh tarball is needed (e.g., a km-core schema change ships mid-phase), `scripts/repack-km-core.sh 0.2.0` is wired and ready. Plan 01 Outcome A means this is unlikely to fire in Phase 43 — the existing 0.1.0 tarball is sufficient.

**Stash recovery note for the operator:** The pre-Plan-02 WIP stash contains Phase 44 `/api/km` mount wiring that Plan 43-05 will revert per D-G2.4. After Plan 05 lands, drop the stash with:

```bash
cd ~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
git stash drop  # drops stash@{0}
```

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 02 (Wave 1)*
*Completed: 2026-05-31*
