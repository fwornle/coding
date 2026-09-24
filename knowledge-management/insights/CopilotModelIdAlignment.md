# CopilotModelIdAlignment

**Type:** Detail

## What It Is

CopilotModelIdAlignment is the component responsible for keeping a vendored third-party dependency, `@rapid/llm-proxy`, from silently reintroducing retired Copilot model ids (`claude-sonnet-4.6`, `claude-opus-4.6`) into the build. Its concrete implementation surface lives in two files: `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs` (the patch script itself, encapsulated as the child component AlignCopilotModelIdsScript) and `tests/features/copilot-model-ids.test.mjs` (the guarding test suite, which *is* the child component CopilotModelIdsDriftTest). The script exists because `@rapid/llm-proxy` is installed from a GitHub release tarball rather than npm, so `patch-package` cannot produce a clean diff against it — a real attempt generated a 148KB patch across 25 unrelated files. The alignment script is a targeted, hand-rolled replacement mechanism instead.

## Architecture and Design

The dominant pattern here is a **drift-guard regression test protecting a build-time patch script wired into two independent install paths**: `docker/Dockerfile.coding-services` (via a `RUN` step after `npm install`) and `package.json`'s `postinstall` hook (for host installs). The test suite asserts both paths exist, that the Dockerfile step runs *after* `npm install`, and that neither path swallows failures via `|| true` or `2>/dev/null` — losing either invariant means the retired ids can silently reappear after any reinstall.

Rather than executing the script, `copilot-model-ids.test.mjs` regex-matches its source text (`/\["'([^']+)'",\s*"'([^']+)'"\]/g`) to extract the replacement table and validate its contents. This is a static, source-inspection style of testing chosen presumably because the script's target (a vendored dependency file) may not be present or safely executable in the test environment. This design decision trades runtime fidelity for guaranteed-safe, environment-independent verification.

## Implementation Details

The patch script's actual replacement logic is not directly observed — only inferred from what the test asserts must be true of its source text, i.e., a table of `['old-id', 'new-id']` pairs used to rewrite `@rapid/llm-proxy`'s vendored `copilot-provider.js` constructor default. This exact-match replacement table is structurally analogous to the fallback pricing pattern in the sibling-adjacent `cost-model.ts` (exact → fast-suffix → family), though the two are otherwise unconnected.

A concrete incident anchors the design rationale: on 2026-09-20, a retired model id caused Copilot to return HTTP 400 for the "standard" tier used by `semantic_analysis`, which cascaded into "[llm] All providers failed" and produced a ~600-char stub instead of a ~4400-char analysis — with nothing in the logs naming the offending model. This silent, hard-to-diagnose failure mode is the direct motivation for asserting both install paths loudly rather than allowing swallowed errors.

A significant known weakness: CI checks out `integrations/semantic-analysis` as a private submodule with `submodules:false` in `tests.yml`, so most of the alignment tests self-skip via `SA_CHECKED_OUT` rather than fail — meaning the guard's coverage in CI is materially weaker than the test file's assertions suggest.

## Integration Points

CopilotModelIdAlignment sits at the install-time/build-time layer, distinct from the live-traffic proxy layer described in the session notes on "LLM CLI Proxy — Provider Architecture and Restart Behavior," where `proxy-bridge/server.mjs` is a persistent, launchd-managed process all downstream agents depend on. This means a 400 error from a retired model id could originate from either an unpatched vendored dependency (this component's concern) or a stale/restarted proxy process — two disjoint failure sources that must be triaged separately.

Notably, the retired ids also live redundantly in `integrations/system-health-dashboard/src/components/cost/cost-model.ts`'s `DEFAULT_COST_CONFIG.modelPrices`, where they remain first-class priced entries (used in the `FAMILY_REPRESENTATIVE` fallback for "opus"). This registry is untouched by the alignment script, so a fix here does not propagate there — a structurally disconnected duplicate of the same vendor id space.

Within the hierarchy, CopilotModelIdAlignment is nested under both LLMAbstraction and LLMMockService, though the latter's manifest is shown to absorb unrelated content (a PlantUML `.puml` versioning policy work record), evidencing that work-record attribution in the session index can drift from the actual code. Siblings OpencodeModelSplice, PiModelsJsonMerge, and ModelContextLimitsResolver are all confirmed structurally distinct — none reference copilot ids, model-json merging, or context-limit resolution — despite superficial thematic proximity in the LLM/model-routing space.

## Usage Guidelines

Any change to the install pipeline (Dockerfile, package.json) must preserve both the Dockerfile `RUN` step ordering (after `npm install`) and the `postinstall` hook — the test suite exists specifically to prevent either path from being silently dropped or its failures swallowed. Developers touching `@rapid/llm-proxy` version pinning should re-run and re-validate `copilot-model-ids.test.mjs`, being aware that in CI the test may self-skip via `SA_CHECKED_OUT` rather than actually fail, so a green CI run is not proof the guard executed. Anyone updating retired/replacement model id lists should also check `cost-model.ts`'s `DEFAULT_COST_CONFIG`, since it is a separate, unsynchronized registry of the same ids. Finally, diagnosing a Copilot 400 error should consider both this component (build-time patch) and the live `proxy-bridge/server.mjs` process (runtime) as independent root causes.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- tests/features/copilot-model-ids.test.mjs is the actual implementation surface for 'CopilotModelIdAlignment': it guards integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs, which patches a vendored @rapid/llm-proxy dependency's hardcoded retired Copilot model ids ('claude-sonnet-4.6', 'claude-opus-4.6') because patch-package cannot diff a GitHub-tarball install. This is the only file among the five supplied that is actually about copilot model id alignment; the other four are thematically adjacent LLM-routing/cost dashboard code.
- The test suite enforces a two-place invariant: the alignment script must run both in docker/Dockerfile.coding-services (checked via string search for the script's filename and confirmed to run AFTER 'npm install' and without '|| true' or '2>/dev/null' swallowing failures) and via package.json's postinstall hook for host installs. Losing either path silently reintroduces the retired ids after any reinstall.
- The test file documents a concrete incident: on 2026-09-20 a retired model id caused Copilot to return 400 for the 'standard' tier used by semantic_analysis, which fell through to '[llm] All providers failed' and produced a ~600-char stub entity instead of a ~4400-char analysis, with nothing in the logs naming the model — motivating the drift-guard tests over silent failure.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'PlantUML Source Files (.puml) Versioning Policy' work record is filed under this component's parent (LLMMockService) despite being about whether .puml diagram sources are committed alongside rendered .png documentation outputs, unrelated to copilot model ids or mock-mode switching — direct evidence that work-record attribution in the session index can drift from the code it names.
- 'LLM CLI Proxy — Provider Architecture and Restart Behavior' establishes that proxy-bridge/server.mjs is the persistent launchd-managed proxy all downstream agents depend on; this is a separate live-traffic path from the alignment script's build-time patch of @rapid/llm-proxy's vendored copilot-provider.js, so a 400 from a retired id could originate from either an unpatched vendored dependency or a stale/restarted proxy process.

## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- [SESSION] 'PlantUML Source Files (.puml) Versioning Policy' work record is filed under LLMMockService, indicating the component's manifest also absorbs unrelated documentation-versioning decisions rather than only LLM mode state.

### Children
- [AlignCopilotModelIdsScript](./AlignCopilotModelIdsScript.md) -- [LLM] The supplied code does not contain integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs itself — the only file that references its behavior is tests/features/copilot-model-ids.test.mjs, which regex-matches the script's source text (`/\["'([^']+)'",\s*"'([^']+)'"\]/g`) rather than executing it. This means everything knowable about the script's actual replacement logic, its RETIRED-id table, and how it rewrites the vendored @rapid/llm-proxy constructor default has to be inferred from what the test asserts must be true of it, not observed directly.
- [CopilotModelIdsDriftTest](./CopilotModelIdsDriftTest.md) -- [LLM] tests/features/copilot-model-ids.test.mjs IS the CopilotModelIdsDriftTest component itself, not a description of it — the file's own header comment explains its reason for existing: `@rapid/llm-proxy` hardcodes copilot-tier model ids in a constructor default and is installed from a GitHub release tarball rather than npm, so `patch-package` has no clean baseline to diff (a real attempt produced a 148KB patch spanning 25 unrelated files). The test therefore treats `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs` as the thing being guarded, and asserts against its presence and source text rather than executing it.

### Siblings
- [OpencodeModelSplice](./OpencodeModelSplice.md) -- [LLM] None of the four supplied code files (tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx, integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts) and store/provider.tsx reference an entity named OpencodeModelSplice, an opencode-specific model-splicing function, or any string containing 'splice'. They cluster around cost accounting, offload routing, and the classifier judge for the dashboard's Token Usage tab, which is thematically adjacent to LLM routing but structurally distinct from a mode-resolution/model-substitution component.
- [PiModelsJsonMerge](./PiModelsJsonMerge.md) -- [LLM] None of the five supplied files reference `PiModelsJsonMerge`, a `models.json` file, a `pi` CLI/agent, or any merge/patch logic for model catalogues. `cost-model.ts` prices already-recorded token rows, `offload-decision.tsx` and `use-classifier-judge.ts` render the routing dashboard's offload ladder and judge-health panel, `provider.tsx` wires a Redux `<Provider>`, and `copilot-model-ids.test.mjs` guards a Copilot-specific vendored-id rewrite script (`integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`). None of these touch pi's model configuration.
- [ModelContextLimitsResolver](./ModelContextLimitsResolver.md) -- [LLM] None of the five supplied code files — tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, .../llm-routing/offload-decision.tsx, .../llm-routing/use-classifier-judge.ts, and src/store/provider.tsx — declare, import, or call anything named ModelContextLimitsResolver, nor do any of them compute or expose a per-model context-window token ceiling. Their subject matter is pricing (cost-model.ts), routing/offload policy UI (offload-decision.tsx), classifier-judge health (use-classifier-judge.ts), a vendored copilot-model-id drift guard (copilot-model-ids.test.mjs), and a Redux store bootstrap (provider.tsx) — none of which is context-limit resolution.


---

*Generated from 10 observations*
