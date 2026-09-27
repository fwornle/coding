# CopilotModelIdDriftGuard

**Type:** Detail

# CopilotModelIdDriftGuard — Technical Insight Document

## What It Is

CopilotModelIdDriftGuard is implemented in `tests/features/copilot-model-ids.test.mjs`, and despite its location in a test directory, this file *is* the guard — not a test of separate production code. It exists because `@rapid/llm-proxy` hardcodes copilot-tier model ids in a constructor default, but the package is vendored from a GitHub release tarball rather than npm, which means `patch-package` cannot cleanly diff it (the docstring records a rejected 148KB patch spanning 25 unrelated files as evidence of why that approach was abandoned). The actual repair lives in a separate script, `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`, which rewrites every id in a `RETIRED` array (e.g. `claude-sonnet-4.6`, `claude-opus-4.6`, at lines 15-17). The test suite's job is to assert this repair mechanism has not silently rotted — checking existence, wiring, ordering, and (when possible) actual effect.

It sits under the parent component LLMMockService, alongside sibling ModelContextCatalogueCache, though neither the sibling nor several retrieved dashboard files (cost-model.ts, offload-decision.tsx, use-classifier-judge.ts, store/provider.tsx) have any actual connection to this guard — they were pulled in by filename-substring retrieval on "LLM"/"copilot" and should not be cited as evidence of its behavior.

## Architecture and Design

The core pattern is **guard-by-test**: rather than a runtime check in the request path, protection is enforced at CI/build time via an executable test suite. This is a deliberate trade-off — it cannot catch drift that occurs after deployment, but it catches regressions before they ship, at zero runtime cost.

A second pattern is **dual-invocation idempotent repair**: the same `align-copilot-model-ids.mjs` script is wired into two independent trigger points — a Dockerfile RUN step (covering container builds) and a `package.json` postinstall hook (covering host installs). The guard verifies both wiring paths remain intact.

A third pattern, **ordering-as-invariant testing**, is the most subtle: the test at lines 60-68 uses `findLastIndex` to locate the last `npm install` line in the Dockerfile and asserts the alignment-script invocation's index comes after it (`align > install`). This defends against a regression class that produces no build error — someone reorders RUN steps for caching or readability, unknowingly placing the alignment step before an install that overwrites its correction, silently restoring retired ids.

## Implementation Details

The test suite gates four of its seven tests behind `SA_CHECKED_OUT = existsSync(join(SA, 'package.json'))` (lines 24-32), because `.github/workflows/tests.yml` checks out with `submodules: false` since `integrations/*` is private. The comment in the file is explicit that this gate deliberately checks the submodule's own manifest rather than the individual file under test — checking the alignment script directly would let CI silently skip ordering/coverage assertions even when the submodule is present but the script itself has been deleted or renamed.

The final test (lines 85-95) is architecturally distinct: it reads directly from `node_modules/@rapid/llm-proxy/dist/providers/copilot-provider.js` when present, skipping (not failing) when the package isn't installed. This is the only assertion inspecting the vendored dependency's compiled output rather than the repair script's source text — every other test can only prove the alignment script is present and correctly shaped; this one proves the correction was actually applied to what a running process would load.

Together these give the guard three independent failure surfaces: source-of-repair (the alignment script itself), deployment wiring (Dockerfile ordering), and compiled-output verification (the installed dist file).

## Integration Points

The guard's placement reflects an investigative conclusion from the 'CLI/UKB Run Timeout and Provider Error Diagnostics' work: rapid-llm-proxy's own request handling was ruled out as the cause of short CLI timeouts based on log evidence, narrowing suspicion of silent id-rejection failures to the provider layer rather than the proxy's request path — consistent with why the fix lives in a semantic-analysis-side script rather than a proxy-side patch.

It also connects to the 'LLM Routing Tier Priority' work, which established a fixed fallback order (max-subscription, then work/Copilot-tier, then Groq Llama-70B as last resort). A retired Copilot model id produces a 400 indistinguishable from a legitimately unavailable middle tier, which is exactly what happened in the documented incident where every Wave 3 semantic-analysis call fell through to "All providers failed" and wrote a shallow ~600-character stub instead of a full analysis — the guard exists specifically to prevent that silent masquerade.

## Usage Guidelines

Do not add new retired model ids without updating the `RETIRED` array in `align-copilot-model-ids.mjs` and confirming this test suite still passes with `SA_CHECKED_OUT` true locally, since CI runs with submodules disabled. Never reorder Dockerfile RUN steps involving `npm install` and the alignment script without re-running the ordering test — this is the one regression class that produces no visible build failure. When investigating provider 400s or shallow-stub outputs, check this guard's compiled-output test against `node_modules/@rapid/llm-proxy/dist/providers/copilot-provider.js` before assuming routing/fallback logic is at fault.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'CLI/UKB Run Timeout and Provider Error Diagnostics' work record establishes that rapid-llm-proxy's own request handling was ruled out as the cause of short-duration CLI timeouts, based on log evidence — narrowing investigation of provider-adjacent failures (including silent id-rejection of the kind this drift guard targets) to the provider layer itself rather than the proxy's request path, which is consistent with why the fix here lives in a semantic-analysis-side alignment script rather than a proxy-side patch.
- The 'LLM Routing Tier Priority' work record establishes a fixed fallback order — max-subscription models first, then work/GH Copilot-tier models, then Groq Llama-70B as strict last resort — because routing logic had previously regressed to treating lower-tier providers as primary. This bears on CopilotModelIdDriftGuard because a retired Copilot model id produces a 400 that is functionally indistinguishable from an unavailable middle tier, and the guard's value is specifically in preventing that 400 from masquerading as normal fallback-tier degradation, per the documented 2026-09-20 incident where every Wave 3 semantic-analysis call fell through to 'All providers failed' and wrote a shallow ~600-char stub instead of a full analysis.

## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- [SESSION] 'PlantUML Diagram Generation — Wave 4 Syntax Failures' ties LLMMockService to diagnosing syntax failures/truncation in generated .puml files during mocked runs

### Siblings
- [ModelContextCatalogueCache](./ModelContextCatalogueCache.md) -- [LLM] None of the four supplied code files — tests/features/copilot-model-ids.test.mjs, integrations/system-health-dashboard/src/components/cost/cost-model.ts, integrations/system-health-dashboard/src/components/llm-routing/offload-decision.tsx, integrations/system-health-dashboard/src/components/llm-routing/use-classifier-judge.ts, and store/provider.tsx — implement, import, or reference anything named ModelContextCatalogueCache. The retrieval set matches the parent entity's earlier finding (LLMMockService pulled the same sibling routing/dashboard/cost files by an 'LLM' filename substring); the same substring-matching failure mode recurs here, this time presumably matched on 'Model'/'Context'/'Catalogue'-adjacent tokens rather than any actual implementation of a model-context caching layer.


---

*Generated from 10 observations*
