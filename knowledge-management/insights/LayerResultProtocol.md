# LayerResultProtocol

**Type:** Detail

[Code References] src/ontology/heuristics/EntityPatternAnalyzer.ts:constructor - hardcoded teamDirectories Map and artifactPatterns array literal; src/ontology/heuristics/EntityPatternAnalyzer.ts:analyzeEntityPatterns() - two-step per-artifact loop with early return on first match; src/ontology/heuristics/EntityPatternAnalyzer.ts:extractArtifacts() - four regex passes (filePathPattern, npmPattern, classPattern, dirPattern) merged into a Set<string>; src/ontology/heuristics/EntityPatternAnalyzer.ts:checkLocalArtifact() - directory-prefix match via teamDirectories, confidence 0.9, calls inferEntityClass(); src/ontology/heuristics/EntityPatternAnalyzer.ts:matchArtifactPattern() - regex match via artifactPatterns, confidence 0.75, calls inferEntityClassFromPattern(); src/ontology/heuristics/EntityPatternAnalyzer.ts:inferEntityClass() - truncated; local teamMappings Record<string,Record<string,string>> built per-call

# LayerResultProtocol — Technical Insight Document

## What It Is

`LayerResultProtocol` is the conceptual result-shape contract governing team-ownership resolution within `TeamOwnershipHeuristics`, implemented concretely in `src/ontology/heuristics/EntityPatternAnalyzer.ts`. It sits above two sibling mechanisms — `TeamDirectoryRegistry` and `ArtifactPatternMatcher` — and describes the layered, tiered outcome that `analyzeEntityPatterns()` produces as it walks artifacts extracted from content. Each artifact is resolved through exactly one of two "layers": a high-confidence local-artifact lookup (0.9) or a lower-confidence pattern-match fallback (0.75), and the protocol reflects whichever layer produced the first successful hit.

## Architecture and Design

The dominant pattern is a **chain-of-responsibility / early-exit pipeline**: for each artifact inside the `for...of artifacts` loop in `analyzeEntityPatterns()`, `checkLocalArtifact()` is always attempted before `matchArtifactPattern()`, and the loop returns on the first success at either tier. This is explicitly a first-match-wins design, not best-match-wins — despite encoding two distinct confidence tiers (0.9 vs 0.75) that would only matter if compared, no cross-artifact or cross-tier comparison ever occurs.

A second pattern is **strategy-via-data-table**: team ownership rules are expressed declaratively as arrays/maps of regex-plus-metadata (`teamDirectories`, `artifactPatterns`) rather than as branching logic or polymorphic classes. This mirrors the sibling `TeamDirectoryRegistry` and `ArtifactPatternMatcher`, which represent the directory-prefix and regex-matching halves of this same layered protocol.

Layer ordering is doubly implicit: which artifact is tested first depends on `Set` insertion order from `extractArtifacts()` (file paths → npm packages → class names → directory paths), and which team/pattern wins within `matchArtifactPattern()` depends on array-declaration order of `artifactPatterns`. Neither ordering is documented or enforced by the type system.

## Implementation Details

`extractArtifacts()` runs four independent regex passes (`filePathPattern`, `npmPattern`, `classPattern`, `dirPattern`) and merges results into a single `Set<string>`. The resulting iteration order is purely incidental to regex execution order, meaning a generic file path is always tested before a more distinctive class name like `KubernetesClusterManager`.

Each layer derives its `entityClass` through structurally different code paths: `checkLocalArtifact()` calls `inferEntityClass(artifact, team)`, doing a `teamMappings` lookup; `matchArtifactPattern()` calls `inferEntityClassFromPattern(artifact, entityClassMap)`, reading the `entityClassMap` embedded on the matched `ArtifactPattern`. Both encode the same conceptual prefix-to-class semantics (e.g., 'Knowledge' → 'KnowledgeEntity') as two independently-editable copies. Notably, `inferEntityClass()`'s `teamMappings` table is rebuilt on every call rather than hoisted, a minor per-call allocation cost against the file's own <1ms budget.

The `ArtifactPattern` interface (`team`, `patterns: RegExp[]`, `entityClassMap`) is populated as a five-element literal array in the constructor, with a three-way ordering dependency: 'Coding' (index 0, `/MCP(Agent|Service|Tool)/i`) preempts 'Agentic' (`/MCP|ACP|A2A/i`), which preempts 'UI' (`/MultiAgent|AgentCoordinator/i`) — undocumented and unenforced.

## Integration Points

`LayerResultProtocol` is contained within `TeamOwnershipHeuristics` and is functionally the composite of its siblings `TeamDirectoryRegistry` (backing `checkLocalArtifact()`) and `ArtifactPatternMatcher` (backing `matchArtifactPattern()`). All data — `teamDirectories` and `artifactPatterns` — is hardcoded as constructor literals with zero runtime configuration loading (no file I/O, no DI), making the whole subsystem self-contained but requiring source edits and recompilation for any team/pattern change.

## Usage Guidelines

Developers should treat the protocol's confidence values (0.9/0.75) as ordinal hints, not as guarantees of best-match selection — the current implementation never compares confidences across candidates. Anyone adding a new team pattern must place it correctly relative to existing entries in `artifactPatterns`, since specificity is enforced only by array position. Changes to prefix-to-class mappings must be made in both `teamMappings` and the relevant `entityClassMap` to avoid drift. Given the hardcoded, no-config design, testing benefits from not needing file-I/O mocks, but any real deployment change requires a code change and rebuild rather than a config update.


## Hierarchy Context

### Siblings
- [TeamDirectoryRegistry](./TeamDirectoryRegistry.md) -- [LLM] EntityPatternAnalyzer.analyzeEntityPatterns() in src/ontology/heuristics/EntityPatternAnalyzer.ts extracts artifacts once via extractArtifacts() and then iterates them in a single for...of loop, calling checkLocalArtifact() before matchArtifactPattern() for each artifact and returning immediately on the first hit of either. This means the method never scores all candidate artifacts and picks the best one — it is strictly first-match-wins across both the directory-prefix and regex-pattern strategies, so the Set iteration order returned by extractArtifacts() (insertion order: file paths, then npm packages, then class names, then bare directory paths) directly determines which team gets credited when a piece of knowledge content references multiple teams' artifacts.
- [ArtifactPatternMatcher](./ArtifactPatternMatcher.md) -- [LLM] [object Object]


---

*Generated from 9 observations*
