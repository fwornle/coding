# CopilotModelIdDriftGuardTest

**Type:** Detail

# CopilotModelIdDriftGuardTest — Technical Insight Document

## What It Is

CopilotModelIdDriftGuardTest is implemented entirely in `tests/features/copilot-model-ids.test.mjs`, and it is effectively the same artifact as its parent, CopilotModelIdAlignment — the parent's implementation and this test suite are one and the same file. Rather than testing business logic, this suite exists to guarantee that a corrective script, `integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`, stays correctly wired into two build pipelines (a Dockerfile RUN step and an npm `postinstall` hook) that patch retired Copilot model ids out of the vendored `@rapid/llm-proxy` dependency. The file's own header comment is unusually load-bearing documentation, explaining that `@rapid/llm-proxy` is installed from a GitHub release tarball with no npm-registry baseline, making `patch-package` infeasible (a real attempt produced a 148KB diff across 25 unrelated files) — hence the standalone script instead of a vendored patch.

## Architecture and Design

The suite embodies a **drift-guard test pattern**: it doesn't validate model-id correction logic executing correctly, it validates that the mechanism enforcing that correction remains connected to the build. Three architectural patterns reinforce this: the **source-text assertion pattern**, where tests parse raw Dockerfile lines and script source via regex instead of executing code (e.g., `lines.findLastIndex`/`findIndex` against `docker/Dockerfile.coding-services`); the **environment-capability gating pattern**, where `SA_CHECKED_OUT` probes a stable proxy file (`integrations/semantic-analysis/package.json`) to distinguish "submodule absent" from "submodule present but regressed"; and the **dual-invocation-surface pattern**, since the same script is wired into both a Dockerfile RUN step (for `--ignore-scripts` builds) and a package.json postinstall hook (for host installs), each with its own dedicated test.

A key ordering invariant, `the Dockerfile runs it AFTER the install that would overwrite it`, is a fragile-but-deliberate line-index check ensuring the alignment script runs after `npm install`, preventing silent re-vendoring of the unpatched `copilot-provider.js`.

## Implementation Details

Two tests validate a shared `RETIRED = ['claude-sonnet-4.6', 'claude-opus-4.6']` list against the script's source text: `it covers every id known to be retired` checks for literal string presence, while `its replacements never map onto another retired id` parses the script's replacement table via `/\["'([^']+)'",\s*"'([^']+)'"\]/g`, asserting dead ids are retired and live successors are not — guarding against swapping one dead id for another. Both validate string-literal surface only, not runtime behavior. Two Dockerfile tests confirm the script is invoked and not error-swallowed, and that it runs after the last relevant `npm install`. A package.json test confirms postinstall wiring. The final test, `the installed package carries no retired id`, is the only one inspecting the real artifact — `integrations/semantic-analysis/node_modules/@rapid/llm-proxy/dist/providers/copilot-provider.js` — and self-skips if absent.

Of seven tests, four self-skip via `t.skip(SKIP_REASON)` when `SA_CHECKED_OUT` is false (CI checks out `submodules: false`), but the two Dockerfile tests and the dist-inspection test run unconditionally, so Dockerfile-ordering invariants are still exercised in CI.

## Integration Points

This entity's core dependency is cross-repo: correction logic lives in the submodule (`integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`), while enforcement lives in the parent repo's test file — the suite exists specifically to keep that boundary honest. It also depends on `docker/Dockerfile.coding-services` and `.github/workflows/tests.yml`'s submodule checkout behavior. Note that `cost-model.ts`, `offload-decision.tsx`, `use-classifier-judge.ts`, and `store/provider.tsx` are thematic neighbors from the same rapid-llm-proxy ecosystem but are unrelated to this component.

## Usage Guidelines

Treat this file as the canonical enforcement point when modifying the alignment script, Dockerfile RUN order, or postinstall wiring — any reordering or removal will be caught only by these source-text checks, so keep script markers/strings stable. When adding newly retired ids, update `RETIRED` and confirm replacements don't map onto other retired entries.


## Hierarchy Context

### Parent
- [CopilotModelIdAlignment](./CopilotModelIdAlignment.md) -- [LLM] tests/features/copilot-model-ids.test.mjs is the entire visible implementation of CopilotModelIdAlignment: it is a drift-guard test suite, not the alignment logic itself, and its own file-header comment explains why the correction exists as a standalone post-install script (`integrations/semantic-analysis/scripts/align-copilot-model-ids.mjs`) rather than a patch-package diff — attempting patch-package against the vendored `@rapid/llm-proxy` tarball produced a 148KB patch spanning 25 unrelated files, because the package is installed from a GitHub release tarball with no clean npm-registry baseline to diff against.


---

*Generated from 9 observations*
