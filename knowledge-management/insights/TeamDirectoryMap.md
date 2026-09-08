# TeamDirectoryMap

**Type:** Detail

teamDirectories in EntityPatternAnalyzer.ts constructor is a Map with keys 'Coding', 'RaaS', 'ReSi', 'Agentic', 'UI' mapping to arrays of directory strings

# TeamDirectoryMap — Technical Insight Document

## What It Is

TeamDirectoryMap is a data structure implemented as a Map within the constructor of `EntityPatternAnalyzer.ts`, keyed by team name — `'Coding'`, `'RaaS'`, `'ReSi'`, `'Agentic'`, `'UI'` — and valued by arrays of directory path strings. It serves as a static, hardcoded ownership registry mapping repository directories to the teams responsible for them. For example, `'Coding'` owns `src/ontology`, `src/knowledge-management`, `src/live-logging`, `scripts`, and `.specstory`; `'RaaS'` owns `raas-service`, `orchestration-engine`, and `event-mesh`; `'ReSi'` owns `virtual-target`, `embedded-functions`, and `reprocessing-engine`.

## Architecture and Design

The design reflects a lookup-table pattern intended for fast, deterministic ownership resolution, functioning as the first-tier check within a two-tier resolution strategy inside its parent, `EntityPatternAnalyzer`. Directory paths act as literal keys/values rather than regex patterns, distinguishing TeamDirectoryMap from its sibling `ArtifactPatternMatching`, which instead relies on an `artifactPatterns` array of `ArtifactPattern` objects containing `team`, `patterns` (RegExp[]), and `entityClassMap`. This division of labor represents a clear design trade-off: TeamDirectoryMap trades flexibility for precision and speed on known paths, while pattern matching handles the long tail of artifacts not explicitly enumerated.

## Implementation Details

TeamDirectoryMap is consumed by `checkLocalArtifact()`, which constitutes "step a" of the broader `analyzeEntityPatterns()` pipeline (the `AnalyzeEntityPatternsPipeline` sibling). This function performs a direct artifact-to-team lookup against the map before any fallback logic executes. Since it is initialized in the constructor, the mapping is fixed at instantiation time — there is no evidence of dynamic loading, external configuration, or runtime mutation, meaning any changes to team ownership require direct code edits to `EntityPatternAnalyzer.ts`.

## Integration Points

TeamDirectoryMap is tightly coupled to its parent `EntityPatternAnalyzer`, existing purely as an internal data member. It integrates directly with `checkLocalArtifact()`, which is invoked early in `analyzeEntityPatterns()` — a pipeline that itself begins by calling `extractArtifacts(knowledge.content)` and short-circuits (returning null) if no artifacts are found. Only if the direct lookup in TeamDirectoryMap fails does control fall through to the sibling `ArtifactPatternMatching` mechanism, establishing an implicit priority ordering between the two ownership-resolution strategies.

## Usage Guidelines

Because TeamDirectoryMap is hardcoded, any reorganization of the repository's directory structure or team ownership must be reflected here manually to avoid stale or incorrect attributions. Developers adding new directories for `'Coding'`, `'RaaS'`, `'ReSi'`, `'Agentic'`, or `'UI'` should update this map directly rather than relying solely on `artifactPatterns` regex fallbacks, since direct entries are checked first and resolve faster and more reliably. When ownership is ambiguous or a directory doesn't cleanly map to one team, prefer extending `ArtifactPatternMatching` instead of overloading TeamDirectoryMap with approximate matches.


## Hierarchy Context

### Parent
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- EntityPatternAnalyzer.teamDirectories Map hardcodes directory-to-team ownership, e.g. 'Coding' owns src/ontology, src/knowledge-management, scripts, .specstory

### Siblings
- [ArtifactPatternMatching](./ArtifactPatternMatching.md) -- artifactPatterns array in EntityPatternAnalyzer.ts defines ArtifactPattern objects each with team, patterns (RegExp[]), and entityClassMap
- [AnalyzeEntityPatternsPipeline](./AnalyzeEntityPatternsPipeline.md) -- analyzeEntityPatterns() in EntityPatternAnalyzer.ts calls extractArtifacts(knowledge.content) and returns null if no artifacts found


---

*Generated from 4 observations*
