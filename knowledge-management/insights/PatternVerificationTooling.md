# PatternVerificationTooling

**Type:** SubComponent

## What It Is

PatternVerificationTooling is implemented in `scripts/knowledge-management/verify-patterns.sh`, a shell script that performs static-analysis-style compliance checking against a set of named coding patterns: ConditionalLoggingPattern, ReduxStateManagementPattern, NetworkAwareInstallationPattern, and undocumented-function detection. It is a child concept under the CodingPatterns parent, sitting alongside sibling disciplines DocumentationStyleGuide and ErrorTriageDiscipline as one of several codified quality-verification practices in the project. Note that `src/ontology/heuristics/EntityPatternAnalyzer.ts` is explicitly *not* part of this tooling despite sharing "pattern" terminology — it performs unrelated team-ownership classification of knowledge-graph entities and should not be conflated with this component.

## Architecture and Design

The core architectural pattern is a shell-script-based static analysis/compliance checker that aggregates results into a heredoc-accumulated markdown report with a computed compliance score. Checks use `rg` (ripgrep) to count pattern indicators — e.g., comparing `console.log` vs `Logger` usage for ConditionalLoggingPattern, `useState` vs `useSelector`/`useDispatch` counts for ReduxStateManagementPattern, and grepping `install.sh` for `check_network`/`timeout` calls for NetworkAwareInstallationPattern.

![PatternVerificationTooling — Architecture](images/pattern-verification-tooling-architecture.png)

A notable design decision is conditional gating of checks: Redux and network-awareness checks only execute — and only count toward `TOTAL_CHECKS` — when `package.json` contains `'react'` or `install.sh` exists, respectively. This produces a variable-length, project-shape-dependent checklist rather than a fixed rubric, a deliberate trade-off that keeps the tool relevant across heterogeneous codebases but makes raw compliance-score comparisons across projects unreliable without normalization.

## Implementation Details

The script resolves its repo root dynamically via `SCRIPT_DIR` and `CODING_TOOLS_PATH`/`CODING_REPO` environment overrides, decoupling it from any hardcoded install location. Its compliance score is computed as `PASSED_CHECKS`/`TOTAL_CHECKS`, with denominators shifting based on the conditional gates described above. Beyond static grepping, the tool cross-references a shared memory JSON file (`SHARED_MEMORY`) to pull `TransferablePattern` entities with significance >= 8, checking crude usage indicators against them, then writes results back via `jq` as `last_pattern_verification` and `pattern_compliance_score` metadata — making the script simultaneously a checker and a knowledge-base updater in a single execution pass.

![PatternVerificationTooling — Relationship](images/pattern-verification-tooling-relationship.png)

## Integration Points

The tool integrates with the shared knowledge-base JSON store (read and write via `jq`), effectively closing a feedback loop between static code analysis and the project's persisted pattern knowledge (`TransferablePattern` entities). It also implicitly depends on project conventions like `package.json` and `install.sh` to determine which checks apply. Conceptually, it parallels ErrorTriageDiscipline's verification mindset (reproducing against a baseline before attributing defects) though verify-patterns.sh contains no such baseline-diffing logic itself. It also has a latent integration point with DocumentationStyleGuide's `.puml`/`.png` placement rules (docs/puml/ vs docs/images/ vs docs-content/images/) — should diagram-related checks ever be added to the script, they would need to respect those placement conventions.

## Usage Guidelines

Developers should treat compliance scores as project-relative, not absolute, given the conditional check gating — comparing scores across projects of different shapes (React vs non-React, with/without install.sh) requires normalization first. Because the script writes back to the shared memory JSON, running it has side effects beyond producing a report, so it should be invoked deliberately rather than as an incidental check. Anyone extending pattern checks should avoid confusing this tooling with `EntityPatternAnalyzer.ts`, which is architecturally unrelated despite the naming overlap. Path resolution via `SCRIPT_DIR`/env overrides should be preserved when relocating or wrapping the script to keep it portable across install locations.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Documentation Style Guide for Diagrams and Markdown (CodingPatterns) establishes that .puml sources live in docs/puml/ and rendered .png files in docs/images/, distinct from docs-content/images/ served by MkDocs — a placement rule that PatternVerificationTooling-adjacent scripts would need to respect if diagram-related patterns were ever added to verify-patterns.sh's checks.
- Post-Rewrite Render Error Triage establishes that engineers must reproduce against a pre-rewrite baseline (git stash/checkout) before attributing render errors to a rewrite rather than pre-existing defects — a verification discipline conceptually parallel to what verify-patterns.sh does for code-pattern compliance, though the script itself contains no such baseline-diffing logic.

## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rendered .png files live in docs/images/, distinct from the MkDocs-served docs-content/images/ tree.

### Siblings
- [DocumentationStyleGuide](./DocumentationStyleGuide.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown: .puml sources must live in docs/puml/, distinct from rendered output locations.
- [ErrorTriageDiscipline](./ErrorTriageDiscipline.md) -- [SESSION] Post-Rewrite Render Error Triage: establishes verification discipline for distinguishing pre-existing render errors from regressions introduced by a large rewrite.


---

*Generated from 9 observations*
