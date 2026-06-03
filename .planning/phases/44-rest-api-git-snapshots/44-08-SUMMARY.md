---
phase: 44-rest-api-git-snapshots
plan: 08
subsystem: REST API surface
tags: [rest, api-v1, km-core, sse-server, docker, submodule, hydration-gate]
requires:
  - 44-06  # createKmCoreRouter factory (lib/km-core/src/api/router.ts)
  - 42     # B's km-core consumption baseline (ontologyDir, canonical dbPath)
provides:
  - "B-side /api/v1 REST surface mounted on SSE server :3848 (same-port strategy)"
  - "Hydration-gate (503-until-ready) middleware on B mirroring A's pattern"
  - "restartCommand wired through createKmCoreRouter for snapshot/restore"
affects:
  - integrations/mcp-server-semantic-analysis/src/sse-server.ts
  - integrations/mcp-server-semantic-analysis/package.json
  - integrations/mcp-server-semantic-analysis/package-lock.json
  - tests/integration/cross-system-parity.mjs (B-leg ready to flip GREEN)
tech-stack:
  added:
    - "@fwornle/km-core path bump (regenerated tarball at ../../lib/km-core/fwornle-km-core-0.1.0.tgz)"
  patterns:
    - "Same-port REST + SSE on shared Express app (44-RESEARCH Example 3)"
    - "Async IIFE bootstrap (await kmStore.open() before app.listen)"
    - "503-until-ready hydration gate (44-RESEARCH Open Q5)"
    - "Framework-agnostic Router cast through `unknown as Parameters<...>`"
key-files:
  created: []
  modified:
    - integrations/mcp-server-semantic-analysis/src/sse-server.ts
    - integrations/mcp-server-semantic-analysis/package.json
    - integrations/mcp-server-semantic-analysis/package-lock.json
decisions:
  - "Reuse-vs-construct: B has no module-level kmStore singleton — every call site (tools.ts, wave-controller.ts, coordinator.ts) constructs its own GraphKMStore. sse-server.ts follows the same pattern with the canonical Phase-42 opts."
  - "Tarball repointing: B's package.json referenced /tmp/fwornle-km-core-0.1.0.tgz (a path that does not exist on this machine). Repointed to the in-repo location ../../lib/km-core/fwornle-km-core-0.1.0.tgz after regenerating via `npm pack`."
  - "Peer-dep workaround: installed via --legacy-peer-deps to bridge a zod 3.x (km-core) vs zod 4.x (B + openai) version mismatch. Runtime is unaffected — B's zod usage (`z.object`, `z.preprocess`) is API-compatible across the boundary."
  - "Container-side km-core mount sync is operator-owned: ~/Agentic/km-core (bind-mounted into the container) is currently on 962de75 (Phase 43-01) and lacks the /api build output. Documented as a follow-up so the operator can sync before `docker-compose restart`."
metrics:
  duration: "~15min"
  completed: 2026-06-03
---

# Phase 44 Plan 08: Mount km-core /api/v1 on B (sse-server.ts) Summary

One-liner: Attached the canonical `createKmCoreRouter` /api/v1 surface to B's existing SSE/Express server on port 3848 via the same-port strategy, with a 503-until-ready hydration gate and snapshot-restart hint wired through to operator follow-up.

## What Was Built

### Same-port REST mount in `integrations/mcp-server-semantic-analysis/src/sse-server.ts`

The plan added (additive to the existing /health, /sse, /workflow-events, /messages routes):

1. **Imports** — `Router` from express, `path` from node:path, `createKmCoreRouter, GraphKMStore` from `@fwornle/km-core`.
2. **GraphKMStore construction** with the canonical Phase-42 opts:
   - `dbPath: /coding/.data/knowledge-graph/leveldb`
   - `exportDir: /coding/.data/knowledge-graph/exports`
   - `ontologyDir: /coding/.data/ontologies` (CLAUDE.md mandatory rule)
   - `domains: ['coding']`, `debounceMs: 5000`
   - `REPOSITORY_PATH` env-var override defaulting to `/coding` (container path).
3. **503-until-ready middleware** (44-RESEARCH Open Q5 + Pitfall 4 prevention):
   ```ts
   if (!kmStoreReady || !(kmStore as unknown as { graph?: unknown }).graph) {
     res.status(503).json({ error: 'Knowledge graph store not ready' });
     return;
   }
   ```
4. **createKmCoreRouter call** with:
   - `ontologyRegistry: kmStore.ontology` (the public getter, NOT `getOntologyRegistry()` which doesn't exist on GraphKMStore — the PATTERNS doc was slightly off)
   - `snapshotDir` matching `exportDir`
   - `restartCommand: 'docker-compose restart coding-services'` so snapshot restore returns the operator-visible restart hint (CONTEXT S-2: no in-process restart).
5. **`app.use('/api/v1', kmRouter)`** mount.
6. **Async IIFE bootstrap** wrapping `app.listen` — `await kmStore.open()` finishes BEFORE the port accepts connections; on open failure, the SSE surface keeps serving and the 503 gate keeps /api/v1/* safe.
7. **Diagnostic emission** via `process.stderr.write` + the file's `log()` helper (no console.log).

### km-core dependency refresh in `integrations/mcp-server-semantic-analysis/package.json`

- Path bump: `"@fwornle/km-core": "file:../../../../../../tmp/fwornle-km-core-0.1.0.tgz"` → `"file:../../lib/km-core/fwornle-km-core-0.1.0.tgz"`.
- Regenerated the in-repo tarball via `cd lib/km-core && npm pack` — pulls in the Plan 44-06 `createKmCoreRouter` + Plan 44-04 `SnapshotManager` build artifacts.
- `npm install --legacy-peer-deps` bridged the zod 3.x (km-core) vs zod 4.x (B + openai peer) ERESOLVE conflict (runtime-compatible; both B and km-core use the schema subset that works across versions).
- Result: `node_modules/@fwornle/km-core/dist/api/router.d.ts` exposes `createKmCoreRouter` (`grep -c` returns 4); B's TypeScript compiler can resolve the import.

## Where kmStore Was Constructed (read_first Step 1 finding)

`grep -rn "new GraphKMStore" integrations/mcp-server-semantic-analysis/src/`:

| Site | Line | Purpose |
|------|------|---------|
| `src/tools.ts` | 986, 2584 | Per-call construction for KB writes |
| `src/agents/wave-controller.ts` | 554 | Wave-controller bootstrap (canonical paths: `.data/knowledge-graph/{leveldb,exports}`) |
| `src/agents/coordinator.ts` | 1693 | Coordinator's adapter bootstrap (uses `.data/knowledge-graph-migrated/` — pre-Phase-42.2 Plan 05 transitional path; coordinator should be aligned in a follow-up, but out of scope here) |
| `src/storage/km-core-adapter.test.ts` | (test stub) | Unit-test mocks via `StubGraphKMStore` |

**Decision:** no module-level singleton exists. sse-server.ts constructs its own GraphKMStore with the same canonical opts wave-controller uses. Future consolidation into a shared module is a follow-up (Phase-44-extension or Phase 45 prep).

## Commit Topology Determination (read_first Step 2 finding)

```
$ ls -la integrations/mcp-server-semantic-analysis/src/sse-server.ts
-rw-r--r-- ... sse-server.ts          # REAL file, NOT a symlink

$ ls -la integrations/mcp-server-semantic-analysis/.git
-rw-r--r-- ... .git                    # gitlink FILE = submodule
$ cat integrations/mcp-server-semantic-analysis/.git
gitdir: ../../.git/modules/integrations/mcp-server-semantic-analysis
```

**Topology:** Real-file submodule. Commit pair required:
1. `feat(44-08): mount km-core /api/v1 REST routes on SSE server port 3848` — inside the submodule at `integrations/mcp-server-semantic-analysis/` (hash `40d0c74`).
2. `chore(44-08): bump mcp-server-semantic-analysis (B-side /api/v1 mount)` — in the outer coding repo bumping the submodule pointer (hash `7a4c05588`).

## Build + Container Restart Timing

| Step | Time | Output |
|------|------|--------|
| `npm pack` in lib/km-core | ~3s | `fwornle-km-core-0.1.0.tgz` (178.9 kB, 219 files; SHA `298214c3847d18373089ac7bf5fc3e9f2cd88c45`) |
| `npm install --legacy-peer-deps` in B | ~4s | 57 new packages; 1 changed (km-core) |
| `npm run build` in B (tsc) | ~10s | Zero `error TS`; `dist/sse-server.js` rebuilt (11548 bytes; `grep -c "createKmCoreRouter|/api/v1|@fwornle/km-core"` returns 12) |
| `docker-compose build coding-services` | NOT RUN | Operator-owned per plan |
| `docker-compose up -d coding-services` | NOT RUN | Operator-owned per plan |

Per CLAUDE.md feedback_docker_build_time.md, a real container rebuild typically takes 3–5min — the operator should plan for that window.

## Probe Matrix (operator-side verification, NOT executed in this plan)

Expected behavior after `docker-compose restart coding-services` AND container km-core mount sync (see Known Issue below):

| Probe | Expected Status | Expected Body |
|-------|----------------|--------------|
| `curl -s http://localhost:3848/health` | 200 | Existing health body (unchanged from before this plan) |
| `curl -s http://localhost:3848/api/v1/stats` | 200 | `{"success": true, "data": {...}}` envelope |
| `curl -s http://localhost:3848/api/v1/entities?limit=1` | 200 | `{"success": true, "data": [...]}` envelope |
| `curl -s http://localhost:3848/sse` (SSE handshake) | 200 + `text/event-stream` | Existing SSE behavior (regression check) |
| `node --test tests/integration/cross-system-parity.mjs` B-leg | smoke passes | RED → GREEN flip from `fetch failed` to 200 envelope |

## Plan 02 cross-system-parity.mjs B-leg Status

**Pre-plan-08:** B-leg fails fast with `Service B at http://localhost:3848/api/v1/entities?limit=1 unreachable: fetch failed` (no /api/v1 mount on B's server).

**Post-plan-08 (after operator restarts container with synced km-core mount):** B-leg returns 200 + `{success: true, data: ...}` envelope; cross-system shape parity check between A, B, C remains RED until Plan 44-09 (C-cutover) lands.

## Known Issue: Container km-core Mount Lag

Container km-core is mounted from `~/Agentic/km-core` (per `docker/docker-compose.yml:96`), which is a **separate checkout** of the km-core repo. As of plan execution:

- Host `lib/km-core`: at commit `0ac1911 feat(44-06): createKmCoreRouter` ✓ has /api build artifacts
- Container `~/Agentic/km-core`: at commit `962de75 chore(43-01): Phase 43 OKM cross-repo pre-req verification` ✗ NO /api build artifacts

The TS compilation against the refreshed in-repo tarball succeeded because npm resolved the import against `node_modules/@fwornle/km-core/` (extracted from the regenerated tarball). At **container runtime**, however, `import { createKmCoreRouter } from '@fwornle/km-core'` resolves against the bind-mounted `~/Agentic/km-core` — which is stale and will throw `SyntaxError: The requested module '@fwornle/km-core' does not provide an export named 'createKmCoreRouter'`.

**Operator follow-up (REQUIRED before container restart):**
```bash
cd ~/Agentic/km-core
git fetch && git checkout 0ac1911   # or main, if pushed
# Then either npm run build OR copy lib/km-core/dist into ~/Agentic/km-core/dist
```

This is an out-of-scope discovery (Rule 1 candidate but architectural — the bind-mount strategy itself is what causes the lag). Logged here for operator awareness instead of auto-fixed because (a) modifying `~/Agentic/km-core` checkout state is outside this plan's file-scope, and (b) a cleaner fix is "stop bind-mounting from a separate clone — mount lib/km-core instead", which is a docker-compose change for a different plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale km-core tarball path in B's package.json**
- **Found during:** TS build verification (import resolution check).
- **Issue:** `"@fwornle/km-core": "file:../../../../../../tmp/fwornle-km-core-0.1.0.tgz"` resolves to a non-existent path on this workstation; even if the tarball existed there, it would be the May-29 snapshot that lacks `createKmCoreRouter`.
- **Fix:** Repointed to `file:../../lib/km-core/fwornle-km-core-0.1.0.tgz` (in-repo, stable, regenerated via `npm pack` to capture the current 44-06+ build).
- **Files modified:** `integrations/mcp-server-semantic-analysis/package.json` + auto-updated `package-lock.json`.
- **Commit:** `40d0c74` (submodule).

**2. [Rule 3 - Blocking] zod ERESOLVE peer-dep conflict**
- **Found during:** `npm install` after the tarball repoint.
- **Issue:** km-core declares `zod: ^3.25.76`; B's package.json + openai's peerOptional require zod 3.x but B is on zod 4.x. npm refused to resolve.
- **Fix:** `--legacy-peer-deps` flag. Runtime is safe because B's zod usage (`z.object`, `z.preprocess`) is API-compatible across both 3.x and 4.x branches.
- **Files modified:** `package-lock.json` only.
- **Commit:** `40d0c74` (submodule).

**3. [Rule 3 - Blocking] km-core RouterLike vs express.Router type incompatibility**
- **Found during:** First `tsc` build.
- **Issue:** `error TS2345: Argument of type 'Router' is not assignable to parameter of type 'RouterLike'. Types of property 'get' are incompatible. ... Type 'Request<...>' is not assignable to type 'never'.` km-core's RouterLike declares handler params as `never` (an over-restrictive contravariant shape that should be `unknown` or generic).
- **Fix:** `kmRouter as unknown as Parameters<typeof createKmCoreRouter>[1]` cast. Functionally a no-op — same runtime contract, just bridges the TS-checker's type-shape mismatch. Documented in the inline comment.
- **Files modified:** `integrations/mcp-server-semantic-analysis/src/sse-server.ts`.
- **Commit:** `40d0c74` (submodule).
- **Follow-up suggestion:** Fix `RouterLike` upstream in lib/km-core/src/api/router.ts to use `unknown` instead of `never` for handler params, so consumers don't need the cast.

**4. [Rule 2 - Critical, doc correction] `kmStore.getOntologyRegistry()` does not exist**
- **Found during:** Reading GraphKMStore.d.ts before writing the createKmCoreRouter call.
- **Issue:** 44-PATTERNS.md line 497 specifies `ontologyRegistry: kmStore.getOntologyRegistry()` and the plan's `<behavior>` block uses `kmStore.getOntologyRegistry?.()` (optional-chained), but GraphKMStore's public API exposes the registry as a getter named `ontology` (line 79: `get ontology(): OntologyRegistry | undefined;`).
- **Fix:** Used `ontologyRegistry: kmStore.ontology` directly. The plan's optional-chained variant would have silently passed `undefined`, falling back to whatever default createKmCoreRouter uses — incorrect but undetected.
- **Files modified:** `integrations/mcp-server-semantic-analysis/src/sse-server.ts`.
- **Commit:** `40d0c74` (submodule).

### Authentication Gates

None.

### Out-of-Scope Discoveries (Logged, NOT Fixed)

1. **Container km-core mount lag** (`~/Agentic/km-core` is on 43-01) — see Known Issue above. Operator must sync before container restart.
2. **`src/agents/coordinator.ts` uses pre-Phase-42.2-Plan-05 path** (`.data/knowledge-graph-migrated/`) — out of scope; future cleanup plan should align coordinator with wave-controller's canonical `.data/knowledge-graph/` path.

## CLAUDE.md Compliance

- ✅ Submodule build pipeline: `cd integrations/mcp-server-semantic-analysis && npm run build` succeeded.
- ✅ Docker build/restart NOT auto-triggered (operator owns runtime — per the executor's prompt).
- ✅ km-core `ontologyDir` passed at construction (mandatory rule, Phase 41 lesson).
- ✅ `no-console-log` constraint: file uses `process.stderr.write` + `log()` helper. `grep -cE "console\.(log|error|warn|info|debug)"` returns 0.
- ✅ No evolutionary file names: file is `sse-server.ts` (not `sse-server-v2.ts` / `sse-server-with-rest.ts`).
- ✅ `documentation-style` skill: not applicable (no diagrams/PUML touched).

## Self-Check: PASSED

Verified the following before concluding:

```bash
$ git log --oneline -1
7a4c05588 chore(44-08): bump mcp-server-semantic-analysis (B-side /api/v1 mount)

$ git -C integrations/mcp-server-semantic-analysis log --oneline -1
40d0c74 feat(44-08): mount km-core /api/v1 REST routes on SSE server port 3848

$ F=integrations/mcp-server-semantic-analysis/src/sse-server.ts
$ grep -c createKmCoreRouter $F          # → 3 (≥1)
$ grep -c '/api/v1' $F                    # → 9 (≥1)
$ grep -c '@fwornle/km-core' $F           # → 1 (≥1)
$ grep -cE 'kmStoreReady|kmStore.*graph' $F  # → 5 (≥1 hydration gate)
$ grep -c 'docker-compose restart' $F     # → 2 (≥1 restartCommand)
$ grep -c ontologyDir $F                  # → 3 (≥1; CLAUDE.md mandatory)
$ grep -cE 'console\.(log|error|warn|info|debug)' $F  # → 0 (no net increase)
$ ls integrations/mcp-server-semantic-analysis/dist/sse-server.js  # → exists, 11548 bytes
$ grep -c "createKmCoreRouter\|/api/v1\|@fwornle/km-core" integrations/mcp-server-semantic-analysis/dist/sse-server.js  # → 12 (proves build chain ran)
$ find integrations/mcp-server-semantic-analysis/src -maxdepth 1 -name 'sse-server*'
# → ONLY sse-server.ts (no version variants — no-evolutionary-names ✓)
```

Acceptance criteria from PLAN.md all met for static + build checks. Runtime probes (curl, parity test) are operator-side after container restart.
