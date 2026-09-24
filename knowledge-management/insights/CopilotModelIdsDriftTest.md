# CopilotModelIdsDriftTest

**Type:** Detail

## What It Is

CopilotModelIdsDriftTest is implemented at `tests/features/copilot-model-ids.test.mjs`. It is a drift guard: a test suite that verifies, statically, that a correction script — `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs` (the sibling component AlignCopilotModelIdsScript) — remains present, complete, non-circular, and correctly wired into two install paths. It exists because the vendored dependency `@rapid/llm-proxy` hardcodes retired copilot-tier model ids in a constructor default, is installed from a GitHub release tarball rather than npm, and therefore has no clean baseline for `patch-package` to diff against (a real attempt produced a 148KB, 25-file patch). The test file's own header comment documents both the packaging constraint and the incident that motivated it.

## Architecture and Design

The dominant pattern is a **characterization/drift test that asserts on source text rather than runtime behavior** — it never executes the alignment script, because doing so would mutate `node_modules`. This is a deliberate trade-off: weaker guarantees about actual runtime correctness in exchange for safety and determinism in CI.

Layered onto this is a **post-install correction pattern**: since patch-package is unusable, the fix is applied after install via two independent entry points — a Dockerfile RUN step and a package.json postinstall hook. The test enforces a **dual invocation guard**, checking both paths independently, because either omission alone would silently revert the correction.

Finally, **environment-aware gating** governs which assertions run: `SA_CHECKED_OUT` (line 34) checks for `integrations/semantic-analysis/package.json`, reflecting that `.github/workflows/tests.yml` checks out with `submodules: false` since `integrations/*` are private. Gating on the submodule's own manifest rather than the target script keeps the guard honest — deleting or renaming the script still fails the tests when the submodule is present.

## Implementation Details

The `RETIRED = ['claude-sonnet-4.6', 'claude-opus-4.6']` constant (line 20) is the single source of truth for three of six tests. `'the alignment script exists'` (42-45) checks presence. `'it covers every id known to be retired'` (47-55) checks the script's source text literally contains each retired id string. `'its replacements never map onto another retired id'` (57-67) uses `src.matchAll(/\["'([^']+)'",\s*"'([^']+)'"\]/g)` to extract dead/live id pairs and asserts no replacement target is itself retired — static analysis standing in for execution.

Two tests bypass `SA_CHECKED_OUT` entirely because `docker/Dockerfile.coding-services` is always present: `'the Dockerfile runs it, and does not swallow its failure'` (69-77) checks the alignment line lacks `|| true` or `2>/dev/null`; `'the Dockerfile runs it AFTER the install that would overwrite it'` (79-87) compares indices via `findLastIndex`/`findIndex` against `RUN cd integrations/semantic-analysis && npm install`, since that install runs with `--ignore-scripts`, disabling the postinstall hook in-image.

The final test, `'the installed package carries no retired id'` (95-105), has its own independent skip: it checks for `integrations/semantic-analysis/node_modules/@rapid/llm-proxy/dist/providers/copilot-provider.js` and calls `t.skip(...)` if absent. It's the only outcome-based check among six mechanism-based ones.

## Integration Points

This entity couples tightly to its parent, CopilotModelIdAlignment, and its sibling AlignCopilotModelIdsScript, whose actual replacement logic is only knowable through what this test asserts must be true — the test file is effectively the specification for the script's contract. It also integrates with `docker/Dockerfile.coding-services` (build ordering and failure-swallowing checks) and `package.json` postinstall wiring, and depends on the private `integrations/semantic-analysis` submodule and `@rapid/llm-proxy`'s compiled output. The related parent-level session on endpoint-gated access rules for the LLM Model Catalogue shares the same failure class: silently accepting a mismatched or dead model id rather than rejecting it loudly.

## Usage Guidelines

Any newly retired copilot model id must be added to `RETIRED` and to the alignment script's replacement table simultaneously — this file only catches drift, it doesn't discover retirements. Replacement targets must never themselves be retired ids, or the circular-mapping test fails. Any change to Dockerfile install ordering or `--ignore-scripts` behavior must preserve the alignment RUN step occurring after `npm install`. Because four of six tests are gated on submodule checkout, expect reduced coverage in CI versus local runs — the two Dockerfile tests and CI-run assertions still hold as always-on. This suite intentionally trades behavioral confidence for safety and specificity, per the 2026-09-20 incident record; it should not be confused with an integration test of the copilot provider itself.


## Hierarchy Context

### Parent
- [CopilotModelIdAlignment](./CopilotModelIdAlignment.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that mismatched model/endpoint combinations must be rejected rather than silently allowed, which is the same failure class this alignment script guards against for retired Copilot ids.

### Siblings
- [AlignCopilotModelIdsScript](./AlignCopilotModelIdsScript.md) -- [LLM] The supplied code does not contain integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs itself — the only file that references its behavior is tests/features/copilot-model-ids.test.mjs, which regex-matches the script's source text (`/\["'([^']+)'",\s*"'([^']+)'"\]/g`) rather than executing it. This means everything knowable about the script's actual replacement logic, its RETIRED-id table, and how it rewrites the vendored @rapid/llm-proxy constructor default has to be inferred from what the test asserts must be true of it, not observed directly.


---

*Generated from 9 observations*
