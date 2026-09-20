# PatternComplianceChecks

**Type:** Detail

# PatternComplianceChecks

## What It Is

PatternComplianceChecks is the compliance-verification logic embedded in `scripts/knowledge-management/verify-patterns.sh`, with a structurally parallel TypeScript implementation in `src/ontology/heuristics/EntityPatternAnalyzer.ts`. The shell script evaluates a fixed set of architectural conventions — ConditionalLoggingPattern, ReduxStateManagementPattern, NetworkAwareInstallationPattern, and an undocumented-functions heuristic — against the actual codebase, using `rg`/`grep` counts as proxies for compliance. Each check is implemented as an independent, hand-written if-block that both detects a condition and renders its own Markdown fragment via `cat >> "$VERIFICATION_REPORT" << EOF`. Alongside these hardcoded checks, the script also reads `TransferablePattern` entities with `significance >= 8` from `$SHARED_MEMORY` via `jq`, attempting a more generic, knowledge-base-driven verification loop.

## Architecture and Design

The dominant design pattern here is "direct match, then pattern-heuristic fallback with tiered confidence" — visible in EntityPatternAnalyzer's `checkLocalArtifact()` (confidence 0.9, `teamDirectories` prefix match) falling back to `matchArtifactPattern()` (confidence 0.75, regex array). Verify-patterns.sh applies the same two-phase shape at a coarser grain: hardcoded checks first, generic KB-loop second. This convergence across two unrelated domains (compliance checking vs. team-ownership classification) suggests a project-wide idiom rather than a domain-specific accident.

However, the script's second phase is only nominally generic. Its `case "$pattern" in *Logging*|*Redux*|*State*|*)` dispatcher recognizes just two pattern families and reuses `$LOGGER_COUNT`/`$REDUX_COUNT` computed earlier; any other KB-registered pattern falls into the `*)` branch with `USAGE_INDICATOR=0` regardless of actual usage. So the "data-driven" loop is still hand-keyed to the same two hardcoded metrics — extensibility is illusory. As the parent CLIWrapperPattern notes, this is a direct counter-example to that entity's stated bin/ thin-wrapper convention: rather than delegating to library code, verify-patterns.sh embeds scoring, report rendering, and JSON mutation inline, implying scripts/ and bin/ operate under different, unstated conventions (delegation-only vs. self-contained operational tooling).

## Implementation Details

Each hardcoded check follows the same shape: run a count (e.g., `CONSOLE_LOG_COUNT`/`LOGGER_COUNT` via `rg`, or `grep -c` against `install.sh` for `check_network|detect_network|timeout`), compare, and increment `PASSED_CHECKS`/`TOTAL_CHECKS`. Redux and network checks are conditionally counted only when `package.json`/`install.sh` exist. The final `SCORE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))` uses integer division with truncation (2/3 → 66%, not 66.67%), and the `((PASSED_CHECKS++))` post-increment under `set -euo pipefail` is a documented bash footgun: when the first passing check occurs while the counter is still 0, the expression evaluates to 0/false, and `set -e` aborts the script before SCORE is ever computed — an unfixed, real hazard already tracked in this project's own memory (`reference_bash_arith_errexit_platform_divergence.md`).

On the TypeScript side, `analyzeEntityPatterns()` calls `extractArtifacts()` to regex-scan free-text content for file paths, npm packages, and PascalCase class names ending in Service/Agent/Manager/Engine/Handler/Analyzer/Classifier/Filter/Monitor, then classifies each via the tiered-confidence dispatch described above. A structural weakness mirrors the shell script's dead-branch problem: `teamDirectories` (Coding, RaaS, ReSi, UI) and `inferEntityClass()`'s `teamMappings` (adds 'Agentic') are independently maintained taxonomies already out of sync — 'Agentic' is unreachable dead data since neither `checkLocalArtifact()` nor `matchArtifactPattern()` iterate over it.

## Integration Points

The script's final action is an atomic read-modify-write on `$SHARED_MEMORY`: `jq --arg timestamp ... --arg score ...` writes to a tempfile then `mv`s it into place — safe against partial writes, but unguarded by any lock. Since the same file is read earlier in the run for the PATTERNS KB loop, concurrent writers between the two touches could produce a lost-update race (plausible risk, not demonstrated). This entity sits under CLIWrapperPattern as a child implementation, and shares its file (and its report-generation coupling problem) with the sibling VerificationReportGenerator, which documents the same heredoc-interleaved rendering that ties report format to check execution. Two xaml_viewmodel fixture files (`DesignViewModel.cs`, `DesignView.xaml`) appear in this component's evidence set but are graphify parser test fixtures unrelated to compliance checking — flagged as retrieval noise, not genuine integration.

## Usage Guidelines

Adding a new compliance check currently requires editing both the detection if-block and the heredoc report block in the same script edit — there is no config/table separation between "what counts as compliant" and "how it's rendered," despite the KB-loop's promise of genericity. Anyone extending the KB-driven path must also extend the `case` dispatcher, or new `TransferablePattern` entities will silently report as non-compliant. The `((PASSED_CHECKS++))` pattern should be replaced with a form safe under `set -e` (e.g., `PASSED_CHECKS=$((PASSED_CHECKS + 1))`) before relying on this script in strict pipelines. Any process writing `$SHARED_MEMORY` concurrently with a verify-patterns.sh run risks a lost update given the absence of locking. In EntityPatternAnalyzer.ts, the three team taxonomies (`teamDirectories`, `artifactPatterns`, `teamMappings`) should be reconciled or unified before adding new teams, since 'Agentic' demonstrates how easily one can add mapping data that never actually executes.


## Hierarchy Context

### Parent
- [CLIWrapperPattern](./CLIWrapperPattern.md) -- [LLM] The 'CLIWrapperPattern' component's namesake convention is only partially borne out by the actual code sample provided: scripts/knowledge-management/verify-patterns.sh is placed under scripts/, not bin/, and rather than being a thin wrapper it embeds substantial business logic directly in the shell script itself — regex-based compliance checks (console.log vs Logger usage counts), a full Markdown report generator, a compliance scoring algorithm (PASSED_CHECKS * 100 / TOTAL_CHECKS), and direct jq mutation of a $SHARED_MEMORY JSON file. This is a concrete counter-example to the parent entity's stated bin/ thin-wrapper convention ('short, primarily responsible for argument parsing and delegating to library/service code') and suggests scripts/ and bin/ are governed by different, unstated conventions: bin/ for delegation-only entry points, scripts/ for heavier one-off operational tooling that is allowed to own its logic inline.

### Siblings
- [VerificationReportGenerator](./VerificationReportGenerator.md) -- [LLM] verify-patterns.sh (scripts/knowledge-management/verify-patterns.sh) generates its Markdown report through a long sequence of `cat >> "$VERIFICATION_REPORT" << EOF` heredoc appends interleaved with the actual compliance-check logic (rg/grep invocations, conditional scoring). This couples report formatting to check execution in a single linear script rather than separating 'collect metrics' from 'render report' as distinct phases — a refactor extracting a `generate_report()` function fed by a metrics associative array would decouple the two concerns, but as written, adding a new check requires touching both the detection logic and the heredoc block in the same edit, which is exactly the 'hardcoded pattern-specific if-blocks' extensibility gap already flagged in the parent CLIWrapperPattern observations.


---

*Generated from 10 observations*
