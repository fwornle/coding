---
phase: 44-rest-api-git-snapshots
plan: 15
type: summary
date: 2026-06-04
status: complete (B-leg HTTP-blocked by pre-existing infra; mount-mode change verified)
---

# 44-15 SUMMARY — Snapshot-dir routing fix

## Outcome

Plan 44-11 SC#2 advances from **BLOCKED on all 3 legs** to:

- **A**: PASS — full snapshot/restore round-trip verified end-to-end
- **B**: MOUNT-VERIFIED, HTTP-BLOCKED — `.git:rw` mount confirmed writable inside `coding-services` container, but B's HTTP endpoint is down due to a pre-existing infrastructure gap surfaced (not caused) by the container recreate
- **C**: BLOCKED:awaiting-OKM-PR-5 — Mode B per Plan 44-15 dual-mode contract; operator-owned out-of-band

Phase 44 close-out is still gated on (i) B-leg HTTP recovery (separate infra fix, not 44-15 scope), (ii) Plan 44-16 (typed-view shape lock for digests + insights), and (iii) Plan 44-11 re-run.

## Per-task evidence

### Task 1 — A leg `.gitignore` exception + snapshot/restore round-trip

**Commit:** `ac8e86b12`

`.gitignore` lines 209-210 added:

```
!.data/knowledge-graph/exports/
!.data/knowledge-graph/exports/**
```

Placed immediately after the existing `!.data/knowledge-graph/insights/images/` exception at line 208, mirroring the established un-ignore pattern.

**Grep gates:**
- `grep -cE '^!\.data/knowledge-graph/exports/$' .gitignore` = 1 ✅
- `grep -cE '^!\.data/knowledge-graph/exports/\*\*$' .gitignore` = 1 ✅
- `git check-ignore -v .data/knowledge-graph/exports/coding.json` returns the un-ignore rule (line 210), not the parent `.data/knowledge-graph/*` ignore

**Round-trip evidence:**

| Step | Command | Result |
|------|---------|--------|
| Pre-stats | `GET http://localhost:12436/api/v1/stats` | `nodes=2213, edges=0, activeSnapshot=null` |
| Snapshot POST | `POST http://localhost:12436/api/v1/snapshots {label:"phase-44-verify-A"}` | HTTP 201 + `id:"snapshot/phase-44-verify-A-2026-06-04T17-43-00-986Z"`, `commit_sha:144f7ec92`, `domains_present:["coding","general"]` |
| Snapshot commit | `git show --stat 144f7ec92` | 2 files / **158,591 insertions** (`coding.json` + `general.json` baseline atomically captured) |
| Mutate POST | `POST http://localhost:12436/api/v1/entities {verify-stub-A}` | HTTP 201, id `019e93bb-6f1c-7eda-a678-e654ccec8563`; stats `nodes: 2213 → 2214` |
| Restore POST | `POST .../api/v1/snapshots/<tag>/restore {confirmDestructive:true}` | HTTP 200 + `restartRequired:true, restartCommand:"launchctl kickstart -k gui/$(id -u) com.coding.obs-api"` |
| Kickstart | `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api` + 10s sleep | obs-api respawned (HTTP 200 on first probe) |
| Post-restart stats | `GET http://localhost:12436/api/v1/stats` | `nodes=2213` — bit-for-bit restore; verify-stub-A wiped |

**T-44-15-01 mitigation evidence:** `bash tests/integration/okb-guard-snapshot-bypass.sh; echo "exit=$?"` → `exit=0` post-gitignore change. Pitfall 1 (OKB-baseline guard) intact; un-ignore exception does NOT regress mixed-commit rejection.

**T-44-15-05 evidence:** First snapshot tag captured 158,591 lines across the pre-existing `coding.json` + `general.json` baseline files as its starting state, exactly as the threat model predicted. Intended behavior — the baseline IS the snapshot's starting state. Subsequent snapshots are deltas.

### Task 2 — B leg `docker-compose.yml` mount mode change

**Commit:** `e2eef82e7` — `chore(44-15): mount .git rw in coding-services for snapshot ops`

Single-line diff at `docker/docker-compose.yml:85`:

```diff
-      - ${CODING_REPO:-.}/.git:/coding/.git:ro
+      - ${CODING_REPO:-.}/.git:/coding/.git:rw
```

**Grep gates:**
- `grep -cE '\.git:rw' docker/docker-compose.yml` = 1 ✅
- `grep -cE '\.git:ro' docker/docker-compose.yml` = 0 ✅

**Operator authorization:** Approved-and-restart (orchestrator AskUserQuestion). Executor issued `docker-compose up -d coding-services` inline (sequential mode dispatch).

**Mount verification:**
- `docker exec coding-services touch /coding/.git/snapshot-rw-probe-$$` → succeeded (write OK), then `rm` cleanup OK
- `docker inspect coding-services` → `Mounts[/coding/.git] = { Mode: "rw", RW: true }` ✅

**T-44-15-02 risk acceptance:** Container code can now mutate host git history. Bound by: (a) OKB-baseline guard rejects non-snapshot commits without `OKB_SNAPSHOT=1` regardless of mount mode (re-verified `exit=0` in Task 1); (b) SnapshotManager API is the only intended writer. Residual risk (accidental `git push` from container code) accepted per the threat model.

### Task 2.5 — B-leg HTTP recovery: BLOCKED (pre-existing infra gap)

The `docker-compose up -d coding-services` recreated the container with the new mount mode. The recreate surfaced a **pre-existing** infrastructure gap unrelated to Plan 44-15's scope:

```
mcp-servers:semantic-analysis           FATAL   Exited too quickly
> Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/sdk'
>   imported from /coding/integrations/mcp-server-semantic-analysis/dist/sse-server.js
```

Diagnostic:
- `/coding/integrations/mcp-server-semantic-analysis/node_modules/` does NOT exist
- `/coding/integrations/mcp-constraint-monitor/node_modules/@modelcontextprotocol/sdk/` DOES exist (other integration is fine)
- The Dockerfile does not bake mcp-server-semantic-analysis's node_modules into the image; the previous container must have had ephemeral `npm install` state that the recreate wiped

**Rolling back the mount-mode change does NOT restore B** (the missing node_modules pre-dates this session's edit). Leaving `e2eef82e7` in place; B-leg HTTP recovery is a separate infra fix outside Plan 44-15's scope.

**Operator-deferred:** Fix B's node_modules in a separate session — likely options are (a) update `docker/Dockerfile.coding-services` to `npm install` mcp-server-semantic-analysis during image build, (b) add a runtime `npm install` step to supervisord, or (c) bind-mount the host's already-installed `node_modules`. Once B is HTTP-healthy, re-run the B-leg snapshot/restore round-trip to close SC#2.B.

### Task 3 — C leg dual-mode classification

**Mode classification:** Mode B (BLOCKED:awaiting-OKM-PR-5)

Probe evidence:

| Endpoint | HTTP | Content-Type | Body head |
|----------|------|--------------|-----------|
| `GET http://localhost:3002/api/v1/stats` | 200 | `text/html` | `<!DOCTYPE html>...<title>VOKB -- Operational Knowledge Graph</title>` |
| `GET http://localhost:3002/api/v1/entities` | 200 | `text/html` | same SPA fallback |
| `GET http://localhost:3002/api/v1/snapshots` | 200 | `text/html` | same SPA fallback |

All three `/api/v1/*` probes return the OKM VOKB SPA HTML, confirming the canonical km-core router is NOT yet mounted on C. OKM PR #5 unmerged + service not restarted.

**Operator runbook (post-merge):**
1. Merge OKM PR #5 (operator-owned, out-of-band on bmw.ghe.com)
2. Restart C's service (OKM-specific command — typically `docker-compose restart <okm-container>` or `npm run dev` restart)
3. Re-run Plan 44-11 (the verification gate) — that re-execution covers C's round-trip and completes Phase 44 SC#1+SC#2 across all 3 systems

Plan 44-15 close-out does NOT depend on Mode A — Mode B is a valid terminating state per the plan contract (T-44-15-03 mitigation).

### Task 4 — CONTEXT amendment + SUMMARY + STATE update

**Files:**
- `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-3.md` (NEW, 80 lines) — ratifies `.data/knowledge-graph/exports/` as the canonical S-1 snapshot dir, supersedes the `.data/exports/` text in original CONTEXT § S-1. Migration note documents the 7 touch sites a future re-route would need to update.
- `.planning/phases/44-rest-api-git-snapshots/44-15-SUMMARY.md` (this file)
- `.planning/STATE.md` updated to reflect 44-15 close with B-leg HTTP-blocked status

## Cross-system-parity intermediate count

Plan 44-11 baseline: **2/6 PASS** (A+B GREEN on `/stats` + `/ontology/classes`; C HTML fallback)

Plan 44-15 post-task-3: **0/6 PASS** (regression from 2/6) — caused by B's HTTP outage during the post-recreate node_modules gap. Once B is HTTP-healthy: **expected 4/6 PASS** (A+B PASS on canonical envelopes, C still HTML fallback). Once C is up (post-OKM-PR-5): **expected 6/6 PASS**.

The Plan 44-15 mount-mode + gitignore changes do NOT cause the regression — the docker exec write probe + docker inspect confirm `.git:rw` is working as intended. The regression is the B node_modules gap.

## SC#2 per-leg progression

| System | Pre-44-15 | Post-44-15 | Gap to close-out |
|--------|-----------|------------|------------------|
| A (12436) | BLOCKED (.gitignore) | **PASS** (round-trip end-to-end) | — |
| B (3848) | BLOCKED (.git:ro) | MOUNT-VERIFIED, HTTP-BLOCKED | B node_modules infra fix (separate session) → re-run round-trip |
| C (3002) | BLOCKED (no /api/v1 mount) | **BLOCKED:awaiting-OKM-PR-5** | Operator merges OKM PR #5 + restarts C → Plan 44-11 re-run covers C end-to-end |

## Files modified

| File | Change | Commit |
|------|--------|--------|
| `.gitignore` | +2 lines (un-ignore exceptions for `.data/knowledge-graph/exports/`) | `ac8e86b12` |
| `docker/docker-compose.yml` | line 85: `.git:ro` → `.git:rw` | `e2eef82e7` |
| `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-3.md` | NEW (80 lines) | this commit |
| `.planning/phases/44-rest-api-git-snapshots/44-15-SUMMARY.md` | NEW (this file) | this commit |
| `.planning/STATE.md` | current-focus + last-activity refresh | this commit (or follow-up) |

Plus snapshot commit `144f7ec92` (`chore(snapshot): phase-44-verify-A`) — created by SnapshotManager during Task 1's round-trip evidence; captures 158,591-line baseline of `.data/knowledge-graph/exports/`.

## Acceptance gates from `must_haves.truths`

- ✅ A leg unblocked — snapshot POST 201 + tag + commit captured
- ✅ A leg restore round-trip — restartCommand literal match; post-kickstart stats restored bit-for-bit
- ✅ B leg unblocked at the **mount** layer (writability verified inside container) — HTTP layer blocked by separate infra gap (documented)
- ⚠️ B leg restore round-trip — DEFERRED until node_modules infra fix lands
- ✅ C leg gated — Mode B classification, BLOCKED:awaiting-OKM-PR-5 recorded with operator runbook
- ⚠️ Cross-system-parity from 2/6 → 0/6 — regression caused by B HTTP outage; expected 4/6 once B recovers
- ✅ Acceptance grep for `.gitignore` change — 2/2 passes
- ✅ Acceptance grep for `docker-compose.yml` change — `:rw` count 1, `:ro` count 0
- ✅ `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-3.md` exists, ≥30 lines, contains "S-1 path amendment" heading

## What's next

1. **B-leg infra fix (operator session):** restore `mcp-server-semantic-analysis` node_modules so the SSE server boots; re-run B-leg snapshot/restore round-trip.
2. **C-leg unblock (operator out-of-band):** merge OKM PR #5 + restart C.
3. **Plan 44-16:** typed-view shape lock for digests + insights (operator's earlier "issues" signal on Plan 44-11 SC#3).
4. **Plan 44-11 re-run:** Phase 44 close-out gate.

---
*Plan 44-15 completed: 2026-06-04*
*Phase 44 close-out remains gated on items 1-4 above.*
