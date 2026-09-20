# SelfLocatingScriptRoot

**Type:** Detail

[Architecture Notes] Root resolution is hardcoded to a fixed directory depth (2 levels up from `scripts/knowledge-management/`) rather than using a tool like `git rev-parse --show-toplevel`, making it positionally fragile; No cross-validation exists between the self-located `$CLAUDE_REPO` and the externally-supplied `$SHARED_MEMORY` path — they are assumed, not verified, to belong to the same project instance; Mutation targets (`$VERIFICATION_REPORT`, `$SHARED_MEMORY.tmp`) are placed outside the self-located root tree, limiting the impact of a miscomputed root; The self-locating idiom is duplicated per-script rather than centralized in a shared sourced library, per the parent context's claim of structural mirroring with `config/agents/*.sh`; Strict mode (`set -euo pipefail`) is only inconsistently guarded against known non-zero exit codes from `rg`/pipelines, an incomplete application of the defensive pattern

# SelfLocatingScriptRoot — Technical Insight Document

## What It Is

`SelfLocatingScriptRoot` is the pattern by which `scripts/knowledge-management/verify-patterns.sh` determines its own position in the filesystem and derives a project root from it, rather than assuming a fixed working directory. The core mechanism lives at line 8: `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`. From this, lines 9–11 walk two directory levels up (`dirname "$(dirname "$SCRIPT_DIR")"`) to compute `DEFAULT_REPO`, under the explicit, code-commented assumption that the script permanently lives at `scripts/knowledge-management/verify-patterns.sh`. This computed value is only a fallback in a larger override chain that produces `CLAUDE_REPO`, which in turn seeds `KNOWLEDGE_EXPORT_DIR` for downstream pattern verification against `$SHARED_MEMORY`.

## Architecture and Design

The design combines two distinct idioms noted in Architectural Patterns: directory-walk self-location, and an environment-variable-with-fallback chain (`CLAUDE_REPO="${CODING_TOOLS_PATH:-${CODING_REPO:-$DEFAULT_REPO}}"`). The walk is treated as a last resort, not the primary resolution mechanism — CI systems, submodule checkouts, or alternate invocations can inject `CODING_TOOLS_PATH` or `CODING_REPO` to bypass positional assumptions entirely. This mirrors the `LLM_PROXY_URL`/`RAPID_LLM_PROXY_URL` fallback idiom documented in the parent entity, AgentAbstractionConventions, confirming that this is a project-wide convention for making `bin/`- and `scripts/`-level executables relocatable, not something unique to this script.

A second architectural decision is the strict separation of detection from mutation. `$CLAUDE_REPO` feeds only into `KNOWLEDGE_EXPORT_DIR`, a read path; the script's actual mutation targets — `$VERIFICATION_REPORT` (written to `/tmp`) and `$SHARED_MEMORY.tmp` (atomically `mv`'d into place via `jq`) — sit entirely outside the self-located root tree. This containment strategy means a miscomputed root has limited blast radius: it can corrupt what the script reads, but never what it writes.

## Implementation Details

Root resolution happens once, at startup (lines 8–10), as an inline sequence of shell commands rather than a reusable function — no shared `lib/script-root.sh` exists. The script also runs under `set -euo pipefail` (line 5), which creates a friction point with tools like `rg` that exit non-zero on no-match. This is handled inconsistently: `CONSOLE_LOG_COUNT=$(rg ... || echo "0")` guards against `errexit` aborting the script on a clean (zero-hits) codebase, but the `UNDOCUMENTED_FUNCTIONS` pipeline has no equivalent guard (though it's safe only because `wc -l` itself always exits 0). This asymmetry is a real gap in the defensive pattern's application, per Architecture Notes.

Notably, the script never validates that `$CLAUDE_REPO` actually contains expected project structure, nor that `$SHARED_MEMORY` (an env var referenced but never assigned here) is consistent with the resolved root. The two are treated as an implicit contract — assumed to reference the same project instance — with no cross-check. A mismatched invocation could silently verify patterns against the wrong knowledge base without any error surfacing at the point of failure.

## Integration Points

`SelfLocatingScriptRoot` is a child concept under AgentAbstractionConventions, and its closest structural sibling is the `config/agents/*.sh` adapter family, which the parent context asserts mirrors this exact idiom (self-location via `$(cd "$(dirname ...)" && pwd)`, plus fallback-chain configuration). The script also integrates with `$SHARED_MEMORY` as an external dependency — read via `jq` for pattern lists and written atomically at the end via `.tmp` + `mv` — and with `/tmp` as an out-of-tree location for `$VERIFICATION_REPORT`. No dependency exists on `git rev-parse --show-toplevel` or any other repo-detection tool, which is itself a notable non-integration.

## Usage Guidelines

Developers extending or relocating `verify-patterns.sh` must preserve the two-level directory relationship documented in its comment, or update `DEFAULT_REPO`'s derivation accordingly — the fallback is brittle-by-construction and will silently compute a wrong root rather than fail loudly, with errors only surfacing downstream (e.g., a missing `.data/knowledge-export` directory). Prefer overriding via `CODING_TOOLS_PATH` or `CODING_REPO` in CI/non-standard checkouts rather than relying on positional inference. When invoking this script, ensure `$SHARED_MEMORY` is set to a path consistent with the resolved `$CLAUDE_REPO`, since nothing enforces this alignment. Given the pattern is currently duplicated by copy-paste across at least two entrypoints (this script and the `config/agents/*.sh` adapters), any future change to root-resolution depth or the fallback chain should be made in all copies — or better, factored into a shared sourced helper — to avoid the same maintainability risk already flagged for `EntityPatternAnalyzer`'s duplicated team-mapping tables (`teamDirectories`, `artifactPatterns`, `teamMappings`). Finally, when adding new downstream commands under `set -euo pipefail`, audit them for grep/ripgrep's no-match convention and add `|| echo "0"` (or equivalent) fallbacks consistently, rather than piecemeal as currently implemented.


## Hierarchy Context

### Parent
- [AgentAbstractionConventions](./AgentAbstractionConventions.md) -- [LLM] The `config/agents/*.sh` adapter scripts described in the parent context establish a normalization boundary that is structurally mirrored in `scripts/knowledge-management/verify-patterns.sh`: both are Bash entrypoints that resolve their own root via `$(cd "$(dirname ...)" && pwd)` rather than assuming a fixed working directory, and both read configuration through environment variables with fallback chains (`CODING_TOOLS_PATH:-${CODING_REPO:-$DEFAULT_REPO}` in verify-patterns.sh mirrors the `LLM_PROXY_URL`/`RAPID_LLM_PROXY_URL` fallback idiom cited for the agent scripts). This shows the environment-variable-with-fallback convention is not confined to LLM provider wiring — it is a project-wide idiom for making any `bin/`- or `scripts/`-level executable relocatable and invocable from CI, cron, or an arbitrary submodule checkout without hardcoded paths.


---

*Generated from 9 observations*
