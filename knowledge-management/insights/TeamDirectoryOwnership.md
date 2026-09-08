# TeamDirectoryOwnership

**Type:** Detail

[Code References] src/ontology/heuristics/EntityPatternAnalyzer.ts - teamDirectories Map defines directory-to-team ownership; src/ontology/heuristics/EntityPatternAnalyzer.ts - artifactPatterns array, regex-based team pattern matching with per-team entityClassMap; src/ontology/heuristics/EntityPatternAnalyzer.ts - analyzeEntityPatterns() two-step match cascade (checkLocalArtifact confidence 0.9, matchArtifactPattern confidence 0.75); src/ontology/heuristics/EntityPatternAnalyzer.ts - extractArtifacts() four-regex artifact harvesting (filePathPattern, npmPattern, classPattern, dirPattern); scripts/knowledge-management/verify-patterns.sh - ConditionalLoggingPattern check comparing console.log vs Logger.(log|debug|info|warn|error) call counts; scripts/knowledge-management/verify-patterns.sh - compliance score computation (TOTAL_CHECKS/PASSED_CHECKS, conditional on package.json/install.sh presence); integrations/graphify/tests/fixtures/xaml_viewmodel/ViewModels/DesignViewModel.cs - cross-language ViewModel suffix convention; integrations/graphify/tests/fixtures/xaml_viewmodel/Views/DesignView.xaml - DesignInstance binding to DesignViewModel via vm: namespace

# TeamDirectoryOwnership: Technical Insight Document

## What It Is

TeamDirectoryOwnership is the directory-based ownership inference mechanism implemented primarily in `src/ontology/heuristics/EntityPatternAnalyzer.ts`, specifically within the `teamDirectories` Map. This structure defines a static, hard-coded association between physical directory prefixes (e.g., `src/ontology`, `agent-frameworks`) and the team considered responsible for artifacts located there. It serves as the first, highest-confidence tier in `analyzeEntityPatterns()`'s two-step ownership inference cascade, and functions as a sibling concern to `ArtifactPatternMatching` and `EntityClassMapping`, both of which live in the same file and are governed by the parent `NamingConventions` component.

## Architecture and Design

The defining architectural decision here is the **cascading confidence-scored heuristic**: `checkLocalArtifact()` tests an artifact's path against `teamDirectories` first, assigning confidence 0.9 if a prefix matches, and only falls through to `matchArtifactPattern()`'s regex-based approach (confidence 0.75, the domain of sibling `ArtifactPatternMatching`) when no directory match is found. This encodes an explicit design assumption — physical location is a stronger ownership signal than naming — but the ordering is one-directional and irreversible per call; there's no reconciliation step if both signals disagree.

This is a **static registry pattern**: `teamDirectories` is constructed inline in the `EntityPatternAnalyzer` constructor with no dependency injection, making the registry compile-time fixed rather than externally configurable. Adding a new team requires editing this map directly alongside the `artifactPatterns` array used by the sibling entity, with no cross-validation that new directory prefixes don't overlap with existing ones or that corresponding `entityClassMap` keys (owned by `EntityClassMapping`) stay consistent.

## Implementation Details

`checkLocalArtifact()` operates on artifact strings harvested by `extractArtifacts()`, which uses four regexes (`filePathPattern`, `npmPattern`, `classPattern`, `dirPattern`) to pull candidate paths and identifiers from free-text knowledge content. Once harvested, a string is tested against `teamDirectories` keys via prefix matching — if `artifact.path.startsWith(prefix)` succeeds, ownership is resolved immediately at confidence 0.9, bypassing all regex-based logic entirely. This means the correctness of TeamDirectoryOwnership hinges entirely on the completeness and currency of the hard-coded prefix list; there is no runtime mechanism to detect drift when files move between teams or directories are restructured without an accompanying update to this map.

Because this check runs before pattern matching, it effectively **short-circuits** the sibling `ArtifactPatternMatching` mechanism for any artifact whose path happens to fall under a known prefix, regardless of what its class name might otherwise imply via `EntityClassMapping`'s keyword conventions.

## Integration Points

TeamDirectoryOwnership integrates tightly with sibling components `ArtifactPatternMatching` and `EntityClassMapping` as parts of the same `analyzeEntityPatterns()` cascade — directory-based and pattern-based signals are meant to be complementary, but the file provides no shared source of truth linking them (a `Kubernetes`/`Lambda` style keyword-to-class mapping exists independently in both `entityClassMap` and `teamMappings` per the `EntityClassMapping` findings). It also relates conceptually to the parent `NamingConventions` component, which independently enforces suffix conventions via `scripts/knowledge-management/verify-patterns.sh` — a bash-based ripgrep pass that checks `Logger.*` versus `console.log` usage. Both TeamDirectoryOwnership and this shell script encode "convention implies canonical identity" logic, but as separate, unsynchronized implementations with no shared constants.

Notably, the cross-language ViewModel-suffix fixture at `integrations/graphify/tests/fixtures/xaml_viewmodel/` (C#/XAML) demonstrates a naming convention this analyzer's directory and regex logic never touches, since `teamDirectories` and `artifactPatterns` are TypeScript/JS-oriented only.

## Usage Guidelines

Developers adding a new team must update `teamDirectories` with an accurate, non-overlapping directory prefix, understanding that this entry will take precedence over any regex pattern defined for other teams. Because directory-based matching is a simple `startsWith` prefix test, care should be taken to avoid one team's prefix accidentally subsuming another's subdirectory. Since there is no drift detection, any directory reorganization or team ownership change must be manually reflected here — stale entries will silently misattribute ownership at high confidence (0.9) rather than failing loudly. Given the duplication of naming-convention logic across this analyzer and `verify-patterns.sh`, changes to team/directory conventions should ideally be cross-checked against both to avoid divergent enforcement.


## Hierarchy Context

### Parent
- [NamingConventions](./NamingConventions.md) -- [LLM] scripts/knowledge-management/verify-patterns.sh implements a self-contained compliance checker that greps the codebase for `console.log` calls versus `Logger.*` calls to enforce the ConditionalLoggingPattern naming/usage convention referenced in the parent CodingPatterns component. The script hardcodes its resolution of `CLAUDE_REPO` via `CODING_TOOLS_PATH`/`CODING_REPO` env vars with a fallback to a path derived two directories up from `SCRIPT_DIR`, which ties the script's correctness to its physical location at `scripts/knowledge-management/verify-patterns.sh` — moving the file would silently break the repo-root inference unless the env vars are set.

### Siblings
- [ArtifactPatternMatching](./ArtifactPatternMatching.md) -- [LLM] The `ArtifactPattern` interface in src/ontology/heuristics/EntityPatternAnalyzer.ts couples three independent concerns into a single record: a `team` string, an array of `RegExp` objects, and an `entityClassMap` keyed by keyword. This means the regex list and the entity-class lookup table are maintained as parallel structures that must be kept in sync by hand — for example the 'Coding' team's patterns array contains `/MCP(Agent|Service|Tool)/i` while its entityClassMap only maps the bare keyword `MCP: 'MCPAgent'`, silently collapsing `MCPService` and `MCPTool` matches to the same `MCPAgent` entity class in `inferEntityClassFromPattern`. This is a latent classification-accuracy bug rather than a crash risk, since the method still returns *a* class, just not necessarily the correct one.
- [EntityClassMapping](./EntityClassMapping.md) -- [LLM] The `EntityClassMapping` convention, as implemented in src/ontology/heuristics/EntityPatternAnalyzer.ts, encodes team-ownership inference as static, hand-maintained data structures rather than derived metadata. The `entityClassMap` fields nested inside each `ArtifactPattern` object (e.g. `{ Kubernetes: 'KubernetesCluster', Lambda: 'AWSLambdaFunction' }`) and the parallel `teamMappings` record inside `inferEntityClass()` both hardcode the same keyword-to-class relationship twice — once for pattern-matched artifacts and once for path-matched artifacts. This duplication means any new entity class (e.g. adding a new AWS resource type for the 'UI' team) must be added in at least two places (the `patterns: RegExp[]` array and the corresponding `entityClassMap`), and a third place if `teamMappings` needs the same key. There is no single source of truth for the suffix convention within this file.


---

*Generated from 9 observations*
