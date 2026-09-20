# PatternComplianceReportGenerator

**Type:** Detail

Conditionally checks ReduxStateManagementPattern only if package.json contains 'react', and NetworkAwareInstallationPattern only if install.sh exists, showing pattern checks are gated by project characteristics

# PatternComplianceReportGenerator — Technical Insight Document

## What It Is

PatternComplianceReportGenerator is implemented in `scripts/knowledge-management/verify-patterns.sh`, a shell script that audits a codebase for adherence to a set of named architectural/coding patterns (e.g., ConditionalLoggingPattern, ReduxStateManagementPattern, NetworkAwareInstallationPattern) and produces a Markdown compliance report. Each invocation generates a timestamped output file at `/tmp/pattern-verification-$(date +%Y%m%d_%H%M%S).md`, making every run independently auditable without overwriting prior results. As a member of CLIScriptConventions, it follows the same self-contained CLI script idiom used across the codebase's shell tooling.

## Architecture and Design

The generator's core design is a rule-based, per-pattern verification pipeline: for each known pattern, the script runs targeted checks (typically `rg` searches for code signatures) and appends a COMPLIANT/NON-COMPLIANT verdict to the report via heredoc blocks. This produces a linear, extensible report structure where new patterns can be added as additional check blocks.

A key architectural decision is conditional applicability: not every pattern is checked on every project. ReduxStateManagementPattern is only evaluated if `package.json` contains `'react'`, and NetworkAwareInstallationPattern only if an `install.sh` file exists. This gating logic reflects an awareness that pattern relevance is project-dependent — the script avoids false negatives/noise by skipping checks that don't apply, rather than reporting NON-COMPLIANT for patterns that were never meant to be present.

Another architectural layer is cross-referencing against a persisted knowledge store: the script reads a SHARED_MEMORY JSON file with `jq`, extracting high-significance TransferablePattern entities, and compares their recorded usage counts against what static analysis detects in the current codebase. This bridges a lightweight static-analysis tool with a longer-lived, structured knowledge base, effectively validating that documented/learned patterns are still empirically present in code.

## Implementation Details

Compliance detection relies heavily on `ripgrep` (`rg`) pattern counts — e.g., counting occurrences of `console.log` versus `Logger.(log|debug|info|warn|error)` to determine whether ConditionalLoggingPattern is being followed (presumably favoring structured Logger calls over raw console statements). These counts are compared and a verdict is written into the report using heredoc-based Markdown blocks, keeping report formatting inline with the shell logic rather than delegated to a templating engine.

The conditional pattern checks are implemented as simple existence/content tests (`package.json` grep for `'react'`, file existence check for `install.sh`) that gate whether entire pattern-check blocks execute at all.

The SHARED_MEMORY cross-reference step uses `jq` queries to filter for high-significance TransferablePattern entities, then correlates their stored usage counts with the indicators found via the `rg`-based scans, giving a second layer of verification beyond simple string matching.

## Integration Points

The script integrates with the filesystem-based SHARED_MEMORY JSON store as an external data dependency, relying on `jq` for structured querying. It also depends on the target repository's own files (`package.json`, `install.sh`) to determine which checks are relevant. As part of CLIScriptConventions, it follows the shared convention of resolving `SCRIPT_DIR` via `BASH_SOURCE[0]` and deriving `DEFAULT_REPO` (overridable via `CODING_TOOLS_PATH`/`CODING_REPO`), consistent with sibling scripts under `scripts/knowledge-management/` and the broader env-var-driven configuration idiom used elsewhere (e.g., `LLM_PROXY_URL`, `QWEN_LOCAL_API_KEY`).

## Usage Guidelines

Each run produces a uniquely timestamped report, so developers should expect accumulation of files in `/tmp` and should clean up periodically rather than relying on a fixed report path. Because pattern checks are conditionally gated, absence of a pattern's section in the report should be read as "not applicable to this project," not as an implicit failure. When adding new patterns to verify, follow the existing convention: implement an `rg`-based or file-existence-based detection, gate it appropriately if project-specific, and append results via the same heredoc-based reporting style. Since the script cross-references SHARED_MEMORY, keeping that JSON store current is necessary for the TransferablePattern usage-count comparisons to remain meaningful.


## Hierarchy Context

### Parent
- [CLIScriptConventions](./CLIScriptConventions.md) -- [LLM] The config/agents/*.sh adapter pattern described in the parent context is one instance of a broader convention visible in scripts/knowledge-management/verify-patterns.sh: shell scripts in this codebase are written as self-contained, idempotent CLI tools that resolve their own root directory via `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` and then derive a repo-relative path (`DEFAULT_REPO="$(dirname "$(dirname "$SCRIPT_DIR")")"`), overridable via `CODING_TOOLS_PATH`/`CODING_REPO` env vars. This mirrors the env-var-driven configuration idiom (LLM_PROXY_URL, QWEN_LOCAL_API_KEY) at the shell-script layer: no script hardcodes an absolute path, so the same script works whether invoked from bin/, cron, or CI.


---

*Generated from 4 observations*
