# PatternComplianceScript

**Type:** Detail

# PatternComplianceScript — Technical Insight Document

## What It Is

PatternComplianceScript is implemented at `scripts/knowledge-management/verify-patterns.sh`, a standalone bash CLI that audits a codebase for adherence to a set of named patterns — ConditionalLoggingPattern, ReduxStateManagementPattern, NetworkAwareInstallationPattern, and a "Code Documentation" check — and persists a numeric compliance score back into a shared knowledge-base JSON file (`$SHARED_MEMORY`). As the sole concrete member of the parent component PatternVerificationTooling, it represents the imperative, shell-based half of pattern verification, contrasted with its sibling EntityPatternAnalyzer (`src/ontology/heuristics/EntityPatternAnalyzer.ts`), which performs pattern classification via pure, data-driven TypeScript table lookups (`teamDirectories`, `artifactPatterns`).

## Architecture and Design

The script embodies a **weighted-checklist scoring pattern**: a `TOTAL_CHECKS`/`PASSED_CHECKS` accumulator is incremented per check, and a final `SCORE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))` produces a percentage (around line ~185-210). Unlike EntityPatternAnalyzer's `LayerResult`, which carries a `confidence` field to express graded certainty, every check here collapses to a hard boolean (`-eq 0`, `-gt 0`, `-lt 10`), with thresholds like 20 useState calls or 10 undocumented functions embedded as unexplained magic numbers rather than named constants.

Persistence follows the **atomic file write** idiom — `jq ... > $SHARED_MEMORY.tmp && mv $SHARED_MEMORY.tmp $SHARED_MEMORY` — which protects against truncation on `jq` failure but provides no concurrency control: it's last-writer-wins with no lock file or compare-and-swap, so a concurrent UKB workflow or parallel script invocation can silently clobber `metadata.pattern_compliance_score`.

Repo-root resolution uses a **positional/relative assumption**: `DEFAULT_REPO="$(dirname "$(dirname "$SCRIPT_DIR")")"` hard-codes that the script sits two directories below the repo root. An **environment-variable override pattern** (`CODING_TOOLS_PATH`/`CODING_REPO`) exists specifically to bypass this fragility for CI or relocated checkouts — consistent with the project's broader convention of override-over-hardcoded-path for fixed-location tooling.

Architecturally, this script is one paradigm within PatternVerificationTooling's two-paradigm split: shell-based grep/rg static analysis here, versus EntityPatternAnalyzer's config-over-code TypeScript classification via `entityClassMap`/`teamDirectories`. The two never share a runtime code path — this script consumes the same conceptual `TransferablePattern` catalogue only via `jq` queries against exported JSON.

## Implementation Details

Each compliance check has distinct, heterogeneous semantics despite sharing the same accumulator. ConditionalLoggingPattern and NetworkAwareInstallationPattern are hard-gated into `TOTAL_CHECKS`. ReduxStateManagementPattern is conditionally included — skipped entirely as non-applicable when `package.json` doesn't mention React, and even when React is present, only penalized if `USESTATE_COUNT` exceeds 20, making it effectively a soft warning rather than a strict gate.

The Documentation check computes `UNDOCUMENTED_FUNCTIONS` via a fragile pipeline: `rg "^(export |public |function |const \w+ = \()" ... -B1 | grep -B1 -E "^(export |public |function |const)" | grep -v "^//" | grep -v "^/\*" | wc -l` (~lines 95-100). Because `rg -B1` interleaves matched lines with context and `--` separators, the final `wc -l` conflates code lines, surviving comment lines, and separators — a rough correlate of doc coverage, not an accurate count — yet it directly gates the binary COMPLIANT/NEEDS DOCUMENTATION verdict.

A critical latent bug exists at the score-computation block (line 5 area, `set -euo pipefail`): `((PASSED_CHECKS++))` is a post-increment whose *expression value* is the pre-increment value, so incrementing from 0 evaluates to `((0))`, a bash-false status. Under `errexit` on bash 5 (Linux/Homebrew macOS), this silently kills the script on its very first successful check; it only "works" by accident on <COMPANY_NAME_REDACTED>'s legacy bash 3.2, where this construct doesn't trigger errexit — meaning the script is least reliable precisely in CI/Linux environments where compliance enforcement matters most.

## Integration Points

The script's primary integration surface is `$SHARED_MEMORY`, the same JSON knowledge-base store used by other knowledge-management tooling, into which it writes `metadata.last_pattern_verification` and `metadata.pattern_compliance_score`. `KNOWLEDGE_EXPORT_DIR` is derived from `DEFAULT_REPO` but is dead code — computed yet never referenced, since `$SHARED_MEMORY` is read directly from the environment. This suggests the two-levels-up path arithmetic was originally load-bearing but has since been superseded, likely by the `CODING_TOOLS_PATH`/`CODING_REPO` override mechanism, without the now-unused derivation being cleaned up.

Conceptually the script integrates with the pattern catalogue that EntityPatternAnalyzer also consumes (`TransferablePattern` entities), but strictly through exported JSON and `jq`, not shared TypeScript code — the two components of PatternVerificationTooling remain runtime-disjoint.

## Usage Guidelines

Operators should treat the compliance percentage as **non-comparable across repositories**: because Redux and network checks are conditionally excluded from the denominator depending on project shape (React presence, existence of `install.sh`), a non-React repo reports a numerically higher achievable ceiling than a React repo under the same nominal threshold — comparing raw scores across projects is statistically meaningless without also inspecting `TOTAL_CHECKS`.

Given the errexit bug, any CI pipeline relying on this script's exit code for a "success" signal on Linux should be treated with suspicion until the pre-increment pattern is fixed (e.g., via `PASSED_CHECKS=$((PASSED_CHECKS + 1))` instead of `((PASSED_CHECKS++))`). Concurrent invocations against the same `$SHARED_MEMORY` should be avoided or externally serialized, since there is no locking guarding the read-modify-write. Finally, the Documentation check's verdict should be treated as an approximate signal rather than an authoritative function-level audit, given the known imprecision of its rg/grep/wc pipeline.


## Hierarchy Context

### Parent
- [PatternVerificationTooling](./PatternVerificationTooling.md) -- [LLM] EntityPatternAnalyzer (src/ontology/heuristics/EntityPatternAnalyzer.ts) implements the PatternVerificationTooling component's core classification logic as a two-step, two-layer detector: `checkLocalArtifact` performs a direct team-directory prefix match (via the `teamDirectories` Map, confidence 0.9) before falling back to `matchArtifactPattern`, which runs a table of per-team regexes (`artifactPatterns`, confidence 0.75) against extracted artifact strings. This mirrors the 'Manager wraps external resource lifecycle' and 'registry + adapter' idioms noted in the parent context: rather than a single monolithic dispatcher, ownership resolution is data-driven (the `entityClassMap` and `teamDirectories` tables) so adding a new team means appending to a table, not editing `analyzeEntityPatterns`'s control flow — the same config-over-code philosophy attributed to <AWS_SECRET_REDACTED> in the parent observations.

### Siblings
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- checkLocalArtifact performs a prefix lookup against the teamDirectories Map (e.g. 'src/ontology' mapped to 'Coding') and returns confidence 0.9 on match, called first in analyzeEntityPatterns.


---

*Generated from 9 observations*
