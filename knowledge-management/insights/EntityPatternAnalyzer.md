# EntityPatternAnalyzer

**Type:** Detail

Ownership resolution is table-driven via entityClassMap per ArtifactPattern entry (e.g. Lambda -> AWSLambdaFunction, Kubernetes -> KubernetesCluster), so new teams/entities are added by extending data tables rather than editing analyzeEntityPatterns control flow.

# EntityPatternAnalyzer: Technical Insight Document

## What It Is

`EntityPatternAnalyzer` is a class defined in `EntityPatternAnalyzer.ts` (located at `src/ontology/heuristics/EntityPatternAnalyzer.ts`), implementing the core classification logic for the `PatternVerificationTooling` component. It functions as a two-layer artifact/ownership detector: given free-text `knowledge.content`, it extracts candidate artifact strings and resolves them to owning teams and entity classes with an associated confidence score. It imports its type contracts (`ArtifactMatch`, `LayerResult`) from `ontology/types.ts`, situating it firmly within the ontology subsystem of the codebase.

## Architecture and Design

The analyzer follows a **layered fallback pattern**: `analyzeEntityPatterns` first calls `checkLocalArtifact`, which performs a prefix lookup against a `teamDirectories` Map (e.g., mapping `'src/ontology'` to `'Coding'`) and returns a high-confidence result (0.9) on match. If this fails, control falls back to `matchArtifactPattern`, which iterates an `artifactPatterns` table of regexes (e.g., `/LSL(Session|Monitor|Classifier)/i`, `/Kubernetes(Cluster|Pod|Service)/i`) and returns a lower-confidence result (0.75). This two-tier confidence scheme lets consumers distinguish structurally-certain matches (directory-based) from heuristic, pattern-based inferences.

Critically, ownership resolution is **table-driven** rather than encoded in branching logic: the `entityClassMap` maps each `ArtifactPattern` entry to a concrete class (e.g., `Lambda` → `AWSLambdaFunction`, `Kubernetes` → `KubernetesCluster`). This is the same "config-over-code" philosophy the parent context attributes to `SensitivityClassifier`/`OntologyClassifier`. As documented in the parent's `PatternVerificationTooling` description, this mirrors "Manager wraps external resource lifecycle" and "registry + adapter" idioms — consistent with `EntityPatternAnalyzer`'s membership in both `ManagerPattern` and `AdapterRegistryPattern` per the related-entities list. Extending support for a new team or artifact type means appending rows to `teamDirectories`, `artifactPatterns`, or `entityClassMap` — not modifying `analyzeEntityPatterns`'s control flow.

## Implementation Details

The pipeline begins with `extractArtifacts`, which applies regexes (`filePathPattern`, `npmPattern`) against raw `knowledge.content` to pull out candidate artifact strings before either detection layer runs. These candidates feed into `checkLocalArtifact` (prefix match against `teamDirectories`) and, on miss, `matchArtifactPattern` (regex table scan against `artifactPatterns`). Each layer returns confidence-annotated results (`ArtifactMatch`) that are aggregated into a `LayerResult`.

Performance is a first-class concern: the analyzer explicitly instruments execution with `performance.now()` start/end deltas, recording the elapsed time in `LayerResult.processingTime`, against a documented target of sub-millisecond execution. This suggests the analyzer sits on a hot path — likely invoked per-artifact or per-document during ontology classification — where cumulative latency matters.

## Integration Points

`EntityPatternAnalyzer` depends on `ontology/types.ts` for its `ArtifactMatch` and `LayerResult` type contracts, tying it into the broader ontology type system. It is a child of `PatternVerificationTooling`, sitting alongside sibling component `PatternComplianceScript` (`scripts/knowledge-management/verify-patterns.sh`), which independently enforces pattern compliance via automated checks — though that script has a documented fragility around `errexit` behavior on bash 5 that is unrelated to but co-located within the same verification tooling family. `EntityPatternAnalyzer` also participates in `ManagerPattern` and `AdapterRegistryPattern`, reflecting its role as a registry-backed classifier rather than a monolithic dispatcher.

## Usage Guidelines

Developers extending team or artifact coverage should add entries to the data tables (`teamDirectories`, `artifactPatterns`, `entityClassMap`) rather than modifying `analyzeEntityPatterns` or the layer functions directly — this preserves the config-over-code design intent. Because `checkLocalArtifact` runs first and short-circuits with 0.9 confidence, directory-prefix conventions should be kept unambiguous to avoid masking legitimate regex-based matches. Given the documented <1ms performance target, any additions to the regex tables should be reviewed for catastrophic backtracking or excessive pattern counts, since `matchArtifactPattern` iterates the full table linearly. Finally, since this component is verified by the sibling `PatternComplianceScript`, changes here should be checked against that script's compliance checks, keeping in mind the script's known CI fragility on bash 5 environments.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- EntityPatternAnalyzer (class) in EntityPatternAnalyzer.ts

**Relationships:**
- Imports: ontology/types.ts, ArtifactMatch, LayerResult

**Other:**
- EntityPatternAnalyzer.ts (module) in EntityPatternAnalyzer.ts


## Hierarchy Context

### Parent
- [PatternVerificationTooling](./PatternVerificationTooling.md) -- [LLM] EntityPatternAnalyzer (src/ontology/heuristics/EntityPatternAnalyzer.ts) implements the PatternVerificationTooling component's core classification logic as a two-step, two-layer detector: `checkLocalArtifact` performs a direct team-directory prefix match (via the `teamDirectories` Map, confidence 0.9) before falling back to `matchArtifactPattern`, which runs a table of per-team regexes (`artifactPatterns`, confidence 0.75) against extracted artifact strings. This mirrors the 'Manager wraps external resource lifecycle' and 'registry + adapter' idioms noted in the parent context: rather than a single monolithic dispatcher, ownership resolution is data-driven (the `entityClassMap` and `teamDirectories` tables) so adding a new team means appending to a table, not editing `analyzeEntityPatterns`'s control flow — the same config-over-code philosophy attributed to <AWS_SECRET_REDACTED> in the parent observations.

### Siblings
- [PatternComplianceScript](./PatternComplianceScript.md) -- [LLM] scripts/knowledge-management/verify-patterns.sh contains a latent portability bug at the compliance-score computation block: `TOTAL_CHECKS=$((TOTAL_CHECKS + 1))` followed by `[ "$CONSOLE_LOG_COUNT" -eq 0 ] && ((PASSED_CHECKS++))`, repeated for the Redux, NetworkAwareInstallationPattern, and Documentation checks. Under `set -euo pipefail`, `((PASSED_CHECKS++))` returns the PRE-increment value as its exit status, so incrementing from 0 evaluates to `((0))` which bash treats as a failing (non-zero) status. On bash 5 (the default on Linux and modern macOS via Homebrew), this trips `errexit` and kills the script silently the very first time a check passes from a fresh `PASSED_CHECKS=0` — meaning the script's SUCCESS path is fragile in exactly the environments (Linux CI) where automated pattern-compliance enforcement matters most, while working by accident on legacy bash 3.2 (<COMPANY_NAME_REDACTED>'s shipped default) where the same construct doesn't errexit.


---

*Generated from 8 observations*
