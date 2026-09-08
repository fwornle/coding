# VerifyPatternsScript

**Type:** Detail

Checks for patterns like ConditionalLoggingPattern (console.log vs Logger usage), ReduxStateManagementPattern (useState vs useSelector/useDispatch counts), and NetworkAwareInstallationPattern (grep for check_network/timeout in install.sh)

# VerifyPatternsScript: Technical Insight Document

## What It Is

VerifyPatternsScript is implemented at `scripts/knowledge-management/verify-patterns.sh`, functioning as a standalone Bash CLI tool that validates whether specific architectural patterns are correctly applied across the codebase. As a child of CliEntrypointPattern, it embodies that parent pattern's defining characteristic: being invoked directly by developers rather than routed through a shared `bin/` dispatcher, and computing all its working paths relative to its own location via `SCRIPT_DIR`. The script's core purpose is pattern verification—it inspects source files for evidence of specific coding conventions (logging discipline, state management approach, installation robustness) and reports findings in a generated Markdown report.

## Architecture and Design

The script follows a self-locating entrypoint design: `SCRIPT_DIR` is computed with `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`, a standard Bash idiom ensuring the script behaves consistently regardless of the caller's current working directory. From this anchor, `DEFAULT_REPO` is derived by navigating two directories up, with an explicit comment noting "Coding root is 2 levels up"—a design decision that hardcodes the assumption about the script's position within the repository's directory tree (`scripts/knowledge-management/`).

To avoid rigidly coupling the script to this positional assumption, a fallback resolution chain is layered on top: `${CODING_TOOLS_PATH:-${CODING_REPO:-$DEFAULT_REPO}}`. This gives operators three levels of override—an explicit tools path, a more general repo path, or the computed default—reflecting a common pattern in CLI entrypoint scripts where environment variables allow flexible deployment without changing the script itself. This is a deliberate trade-off: sensible zero-configuration defaults for the common case, paired with escape hatches for non-standard repo layouts or CI environments.

Strict error handling is enforced via `set -euo pipefail`, a defensive convention typical of standalone shell entrypoints (shared conceptually with sibling scripts under CliEntrypointPattern) that ensures failures in path resolution, missing files, or failed greps halt execution rather than silently producing an incomplete report.

## Implementation Details

The script's verification logic is organized around checks for specific named patterns, each implemented as a targeted inspection:

- **ConditionalLoggingPattern**: distinguishes `console.log` usage from proper `Logger` calls, presumably counting or flagging occurrences to catch places where ad hoc logging bypasses the sanctioned logging abstraction.
- **ReduxStateManagementPattern**: compares counts of `useState` against `useSelector`/`useDispatch` usage, a heuristic for detecting components that manage local state directly rather than integrating with the Redux store.
- **NetworkAwareInstallationPattern**: greps `install.sh` for `check_network` and `timeout` invocations, verifying that installation scripts defend against network failures rather than hanging indefinitely.

Each check appears to be implemented as a discrete grep/count-based heuristic rather than a full AST-based analysis, favoring simplicity and speed over semantic precision—a reasonable trade-off for a verification script meant to give quick, actionable signals rather than exhaustive correctness guarantees.

Output is written to a timestamped file: `/tmp/pattern-verification-$(date +%Y%m%d_%H%M%S).md`. Using `/tmp` with a timestamp avoids collisions between concurrent runs and sidesteps the need for cleanup logic or fixed-path locking, though it also means reports are ephemeral and not automatically archived within the repo.

## Integration Points

VerifyPatternsScript integrates with the broader repository structure primarily through path resolution—its `DEFAULT_REPO` calculation assumes a fixed relationship between its own location (`scripts/knowledge-management/`) and the repository root two levels up. This creates an implicit structural dependency: relocating the script within the tree without updating this offset would break default behavior, one reason the `CODING_TOOLS_PATH`/`CODING_REPO` overrides exist as an integration safety valve for callers (e.g., CI pipelines) that need to specify the repo path explicitly.

It also depends on the presence and conventions of specific target files, most notably `install.sh` for the NetworkAwareInstallationPattern check, implying an expectation that a script by that name and location exists within the resolved repo path. Its relationship to sibling entrypoints under CliEntrypointPattern is one of shared convention rather than direct code sharing—no dispatcher or shared library is mentioned, so consistency across entrypoints depends on developers following the same idioms (SCRIPT_DIR computation, strict mode, override chains) rather than shared abstraction.

## Usage Guidelines

Developers invoking this script should be aware that its default repo detection assumes the script remains at `scripts/knowledge-management/verify-patterns.sh`; if the script is moved, either the two-levels-up logic must be updated or `CODING_REPO`/`CODING_TOOLS_PATH` should be set explicitly. Because each run produces a new timestamped report in `/tmp`, users should not expect a stable output path for tooling integration—any automation consuming the report needs to glob for the latest `pattern-verification-*.md` file or capture the script's own path echo if provided.

Given the heuristic nature of the pattern checks (simple grep/count comparisons), results should be treated as advisory signals prompting manual review rather than definitive pass/fail gates—particularly for ReduxStateManagementPattern, where a high `useState` count doesn't necessarily indicate a violation without contextual judgment. Because the script uses `set -euo pipefail`, any missing expected file (like `install.sh`) or unexpected command failure will abort the entire run, so operators should ensure the target repo structure matches expectations before invoking it in automated pipelines.


## Hierarchy Context

### Parent
- [CliEntrypointPattern](./CliEntrypointPattern.md) -- scripts/knowledge-management/verify-patterns.sh acts as a standalone CLI entrypoint invoked directly rather than through a shared bin/ dispatcher, computing paths relative to SCRIPT_DIR


---

*Generated from 5 observations*
