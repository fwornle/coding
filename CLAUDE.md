# CLAUDE.md - Coding Project Guidelines

## Mandatory Rules

- **Documentation skill**: ALWAYS invoke `documentation-style` skill before creating/modifying PlantUML, Mermaid, or documentation artifacts
- **PlantUML**: Use `plantuml` CLI command. NEVER `java -jar plantuml.jar`
- **TypeScript**: Mandatory with strict type checking
- **API design**: Never modify working APIs for TypeScript compliance; fix types instead
- **Visual UI verification — use `gsd-browser`**: For any visual smoke / screenshot / click-through against `localhost:3002` / `3032` / `8080` or any local web UI, use the `gsd-browser` CLI (`gsd-browser navigate`, `screenshot`, `click`, `eval`, `select-frame`, `snapshot`). It wraps Playwright with the correct chromium resolution and avoids the `ERR_MODULE_NOT_FOUND` failure mode of inline `chromium.launch()` scripts. The `/playwright-cli` skill is allowed as an entry point but does NOT excuse writing a hand-rolled `node /tmp/foo.mjs` Playwright script — that re-triggers the `prefer-gsd-browser` constraint. For structured E2E tests, place them under `tests/e2e/<area>/<spec>.spec.ts` and run via `npx playwright test`.
- **Constraint dodging is forbidden**: When a constraint blocks a tool call, fix the underlying issue — DO NOT swap to a different API that pattern-matches around the regex (e.g., `process.stderr.write` to dodge `no-console-log`). Switching to a different raw-write API preserves the behaviour the rule prevents and is itself a violation. For legitimate exceptions, include `OVERRIDE_CONSTRAINT: <id>` in the prompt with rationale.
- **km-core scripts**: Any CLI or service that imports `resolveEntities` from `@fwornle/km-core` MUST construct `GraphKMStore` with an `ontologyDir` option — otherwise default-class resolution throws `opts.classes omitted but store has no ontology registry`. Resolve via `import.meta.resolve('@fwornle/km-core')` + walk up to package root. Integration tests pass this explicitly, so absent CLI greps will mask the gap (Phase 41 lesson, commits `87bc2f567` / `fd35c5350`). When authoring a new CLI plan, include an acceptance grep for `ontologyDir` in the script.
- **km-core LLM proxy endpoint**: The local rapid-llm-proxy serves `POST /api/complete` (NOT OpenAI `/v1/chat/completions`) on **port 12435** (host) / **`host.docker.internal:12435`** from inside the coding-services container. The container has `LLM_CLI_PROXY_URL=http://host.docker.internal:12435` pre-set in `docker/docker-compose.yml`. **DO NOT confuse with port 3033** — that's the *Health API*, not the LLM proxy (the Health API will silently return `Cannot POST /api/complete` HTML, masking the wrong-port bug — Phase 42.2 Plan 06 follow-up lesson; submodule commit `7df8773`). Request body: `{ process, messages, taskType? }`; response: `{ content, provider, model, tokens, latencyMs }` — not OpenAI-wrapped. URL resolution precedence (matches `@rapid/llm-proxy` SDK convention): `RAPID_LLM_PROXY_URL` → `LLM_CLI_PROXY_URL` → `LLM_PROXY_URL` → `http://localhost:${LLM_CLI_PROXY_PORT ?? '12435'}`; append `/api/complete` exactly once. See `scripts/backfill-raw-observations.mjs:40,95` for the canonical host-side client and `integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts` for the container-side wrapper. Passing `taskType` routes dedup calls to claude-haiku (cheaper).
- **km-core wiring — hand-made symlink, NOT a package.json dependency**: `@fwornle/km-core` is the `lib/km-core` git submodule, linked in by hand as `node_modules/@fwornle/km-core -> ../../lib/km-core`. It appears in **no** `package.json`, so `npm install` neither creates nor restores it and nothing fails loudly at install time. If the link goes missing (the scope dir `node_modules/@fwornle/` is typically left behind, empty), **every ETM spawn dies instantly** with `ERR_MODULE_NOT_FOUND: Cannot find package '@fwornle/km-core' imported from .../src/live-logging/ObservationWriter.js`. Symptom: statusline shows `[LSL🔴]` and the project's agent letter turns 🟡 **while the Health API still reports green** — this is the ETM, not a service, so health is the wrong place to look. Diagnose: `curl -s localhost:3034/health/state` (the project's `lsl` entry reads `status: stopped`, which `getLSLHealthStatus()` maps to `down`), `launchctl list | grep com.coding.etm` (exit code `1` = crash loop), then `tail .logs/etm.log` for the real error. Fix: `ln -s ../../lib/km-core node_modules/@fwornle/km-core` then `launchctl kickstart -k gui/$(id -u)/com.coding.etm`. Beware the false all-clear: long-lived daemons that resolved the module *before* it vanished (e.g. obs-api) keep running and only fail on their next restart, so "obs-api is up" does not prove the link exists (2026-08-08).
- **km-core snapshot-restore patch (now upstream — nothing to re-apply)**: `hydrate()` in `store/persistence.js` prefers the JSON export over the LevelDB `graph:state` cache when the JSON has more nodes. **Why**: `persistGraph` only fires on clean `close()`; an obs-api crash during shutdown (we hit a `libc++abi mutex lock failed` on SIGTERM) leaves LevelDB frozen at the prior clean state — *days* behind the JSON exports written by the exporter's 5s-debounced scheduleExport. Without it, `launchctl kickstart com.coding.obs-api` resurrects the stale state (a 2026-06-05 snapshot came back over a 2026-06-11 backfill). This is **no longer a local `node_modules` patch** — but not for the reason this file used to give. It is committed in the submodule **source**, at `lib/km-core/src/store/persistence.ts` (marked "Phase 57-05 lesson: prefer JSON exports"), and it reaches `dist/` only by being rebuilt. **`lib/km-core/.gitignore` line 2 is `dist/`, so NOTHING under `lib/km-core/dist/` is tracked by git** — the earlier claim that the patch "is committed at `lib/km-core/dist/store/persistence.js`" was wrong. Two consequences: (1) since the patch lives in source, `npm run build` regenerates it and cannot wipe it, so disregard any older instruction to re-apply it manually after `npm install`; (2) **a fresh clone or a wiped `dist/` has no built km-core at all**, and since `node_modules/@fwornle/km-core` is a symlink to `lib/km-core` (not an npm install), nothing restores it — you MUST run `npm run build` in `lib/km-core` before any consumer can import it. The same applies to every km-core change you make: it does not travel via git as `dist/`, so each machine has to build it.

## Startup & Services

- **Command**: `claude-mcp` or `coding --claude` (starts all services). Never use bare `claude`
- **Dashboard**: http://localhost:3032 | **Health API**: http://localhost:3033
- **Semantic Analysis SSE**: http://localhost:3848 (workflow execution)
- **VKB**: `vkb` command opens http://localhost:8080
- **rapid-llm-proxy routing** (REQUIRED on first start / after `.data/` wipe): run `scripts/configure-wave-analysis-routing.sh` to install `processOverrides` that route `wave-analysis-*` LLM calls through `copilot` (fast HTTP+OAuth) instead of the default `claude-code` (slow CLI subprocess). Without this, wave-analysis is ~30x slower AND silently degrades to mock-mode on truncated CLI responses (Phase 42.2 Plan 06 follow-up lesson). `--show` lists current state; `--reset` removes only the wave-analysis-* entries (preserves health-coordinator / observation-writer overrides which intentionally use claude-code).
- **launchd-managed daemons** (auto-respawn on crash/hang): `com.coding.obs-api`, `com.coding.health-coordinator`, `com.coding.llm-cli-proxy`, `com.coding.sub-agent-live-{claude,copilot,opencode}`, `com.coding.sub-agent-sweep`, **`com.coding.etm`** (Phase 54 — ETM, was nohup-only before), **`com.coding.lsl-lock-sweeper`** (clears orphaned `.specstory/history/.git/index.lock` left by killed committers — project LSL writer OR the SpecStory IDE extension; StartInterval=60 + RunAtLoad, removes a lock only when no live `git` holds it AND mtime > 90s; install via `scripts/install-lsl-lock-sweeper-launchd.sh`, logs to `.data/lsl-lock-sweeper.log`). (The former `com.coding.lsl-resolver` launchd job was retired — LSL observation resolution now runs **in-process inside obs-api** on a 30-min sweep, since km-core's LevelDB is single-owner. Trigger manually via `POST /api/observations/resolve-lsl` or `scripts/resolve-observations-from-lsl.mjs`.) Inspect: `launchctl list | grep com.coding`. Kickstart: `launchctl kickstart -k gui/$(id -u)/<label>`. ETM logs to `.logs/etm.log`; watchdog auto-resets `isProcessing` after 60s and emits `[STALL-DETECT]` when no observation has been written for 5min despite jsonl mtime being recent.

## UKB Workflow Control

**CRITICAL: Match parameters to what user actually says!**

**"ukb", "full ukb", "ukb full"** → PRODUCTION mode (real LLM calls, runs continuously):
```
mcp__semantic-analysis__execute_workflow
  workflow_name: "wave-analysis"
  async_mode: true
  parameters: {team: "coding"}
```

**"ukb full debug", "ukb debug"** → DEBUG mode (mock LLM, single-step):
```
mcp__semantic-analysis__execute_workflow
  workflow_name: "wave-analysis"
  async_mode: true
  debug: true
  parameters: {team: "coding", singleStepMode: true, mockLLM: true, stepIntoSubsteps: true}
```

**Fallback — ONLY if MCP tool is unavailable**, use direct SSE call on port 3848 (see `memory/ukb-workflow.md`).

- NEVER run `ukb` as a bash command
- NEVER use port 3033 for workflows
- NEVER default to debug mode unless user explicitly says "debug"

## Rebuilding After Code Changes

**CRITICAL: This project uses git submodules.** Code changes to submodule TS source do NOT take effect until BOTH steps are done:

1. **`npm run build`** inside the submodule (compiles TS → `dist/`)
2. **Docker rebuild** if the service runs in a container

Forgetting step 1 is a recurring issue — committed source looks correct but `dist/` stays stale and the container runs old code.

**Submodules requiring both steps:**
- `integrations/mcp-server-semantic-analysis`
- `integrations/mcp-constraint-monitor`
- `integrations/graphify` (git submodule built into the `coding-services` image; Python — no `npm run build`, but a Docker rebuild is needed to pick up source changes)

**After ANY code change to a submodule:**
```bash
cd integrations/<submodule> && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```

**Dashboard** (`integrations/system-health-dashboard/`): Bind-mounted into `coding-services` (`docker-compose.yml:96-102` covers `dist/`, `server.js`, `static-server.js`), so **no `docker-compose build` is needed** — but Docker Desktop's VirtioFS caches bind-mounted files and does NOT pick up host edits live. After editing, you MUST do one of:

```bash
# Frontend (UI bundle) only — rebuild dist/, then restart the frontend service:
cd /Users/Q284340/Agentic/coding/integrations/system-health-dashboard && npm run build
docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend

# Backend (server.js / static-server.js) — restart the whole container to invalidate the FUSE cache;
# `supervisorctl restart web-services:health-dashboard` alone re-reads the STALE cached file:
cd /Users/Q284340/Agentic/coding/docker && docker-compose restart coding-services
```

Symptom of the stale-cache bug: the dashboard backend exits with `SyntaxError: Invalid or unexpected token` mid-line, because Docker serves a truncated snapshot of the file. Verify with `docker exec coding-services wc -lc /coding/integrations/system-health-dashboard/server.js` vs the host — sizes must match.

**Config files** (`integrations/mcp-server-semantic-analysis/config/`): Bind-mounted read-only, no rebuild needed.

## Knowledge Management

- **Storage**: `.data/knowledge-graph/` (Graphology + LevelDB)
- **Purge entities**: `node scripts/purge-knowledge-entities.js <YYYY-MM-DD> [--dry-run] [--team=coding] [--verbose]`

## Session Logging

- **Location**: `.specstory/history/`
- **Format**: `YYYY-MM-DD_HHMM-HHMM-<hash>.md`
- Use `/sl` command to read session history for continuity

## Code Graph Analysis

`mcp__semantic-analysis__analyze_code_graph` with actions: `nl_query`, `query`, `call_graph`, `similar`. Reads graphify's static `graph.json` (`.data/graphify/graphify-out/graph.json`) — no Memgraph, no database. Rebuild the graph with `graphify update` (host `bin/graphify` shim → `coding-services`) when it drifts behind HEAD. Graphify also serves its own HTTP MCP endpoint at `http://localhost:3851/mcp` (tools: `query_graph`/`get_node`/`get_neighbors`/`shortest_path`/`graph_stats`/`god_nodes`); the `/graphify` skill is the preferred entry point.

## Available Skills (Auto-Generated)

These skills are defined in `.claude/commands/` and provide reusable workflows.
Read the full skill file when a task matches its description.

- **/documentation-style** (`.claude/commands/documentation-style.md`): Enforce consistent styling for documentation artifacts (PlantUML, Mermaid, markdown, PNG diagrams).
- **/experiment** (`.claude/commands/experiment.md`): Describe a cross-agent experiment in plain English (or with flags), then auto-run the matrix, compare, and render the ranked variant table
- **/graphify** (`.claude/commands/graphify.md`): Query and rebuild the project's code knowledge graph (graphify). Use for any question about the codebase — architecture, "what calls X", "where is Y", file/function relationships, data-flow tracing — instead of blind greps. The graph is a static graph.json served over MCP by the coding-graphify container; rebuild it with `graphify update` when it's stale.
- **/kgbench** (`.claude/commands/kgbench.md`): Run, resume, regrade and report the kgbench code-retrieval benchmark (coding-v1) across retrieval arms, agents and models — and diagnose the routing that decides which model actually answers. Also covers the Performance → Benchmarks dashboard sub-tab, the second front-end over the same scripts.
- **/playwright-cli** (`.claude/commands/playwright-cli.md`): Use this skill whenever the user wants to automate a browser, scrape web content, take screenshots or PDFs of pages, fill out forms, click through UI flows, or run end-to-end tests — without using an MCP server. This skill drives Playwright directly from the bash_tool via Node.js scripts. Trigger whenever the user says things like "open this URL", "screenshot this page", "scrape this site", "automate this form", "test this UI", "extract data from", "click through", "check if this page works", or any task that requires real browser interaction. Prefer this skill over web_fetch when JavaScript rendering, authentication, interaction, or visual output is needed.
- **/sl** (`.claude/commands/sl.md`): Load session logs (LSL) from current and coding projects for continuity

