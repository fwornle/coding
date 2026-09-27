# ArtifactPatternMap

**Type:** Detail

## What It Is

ArtifactPatternMap is not a standalone module or class — no file, export, or symbol by this name exists in the codebase. It is a conceptual label for the composite of two data structures declared in the constructor of `EntityPatternAnalyzer` (`src/ontology/heuristics/EntityPatternAnalyzer.ts`): the `teamDirectories` Map and the `artifactPatterns` array. Together these form the de facto "pattern map" that the parent entity's name refers to, but there is no dedicated data-access layer, interface, or file boundary around it — it is embedded directly in the analyzer's constructor body.

## Architecture and Design

The design follows a **static lookup-table pattern**: `teamDirectories` is a `Map<string, string[]>` hardcoding four teams (Coding, RaaS, ReSi, UI) to disjoint directory prefixes, while `artifactPatterns` is a parallel array of `{team, patterns, entityClassMap}` objects carrying per-team regex vocabularies (e.g., Kubernetes/Argo for RaaS, VirtualTarget/MF4Container for ReSi). These are consulted in sequence — `checkLocalArtifact()` against `teamDirectories`, `matchArtifactPattern()` against `artifactPatterns` — giving the whole thing a **chain-of-responsibility-like linear scan**: for each team, for each pattern, until first match. There is no indexing or priority weighting; match precedence is purely a function of array order, an implicit ordering dependency structurally identical to the Set-ordering issue already flagged for the sibling `ArtifactExtractor`'s `extractArtifacts()`. The taxonomy and regex vocabularies are compiled directly into code rather than externalized to configuration, meaning any change to team boundaries or artifact conventions requires editing `EntityPatternAnalyzer.ts` itself.

## Implementation Details

Each `artifactPatterns` entry carries a `filePathPattern`, `dirPattern`, `classPattern`, and an `entityClassMap` used to resolve a matched artifact to an entity class. This `entityClassMap` duplicates information also held in a separate `teamMappings` object inside `inferEntityClass()` — two independent team-to-entityClass associations with no shared source of truth. Confidence values are hardcoded at the call sites: `checkLocalArtifact()` assigns 0.9, `matchArtifactPattern()` assigns 0.75, feeding directly into the `LayerResult` objects returned by `analyzeEntityPatterns()` — this is the entirety of what sibling `LayeredConfidenceScoring` represents, i.e., two literals, not a scoring framework. The regex-based matching is narrow: any artifact reference not conforming to expected lowercase-directory or CamelCase-suffix shapes is silently dropped rather than surfaced as unclassified, echoing prior tooling issues (node:test heuristic matching) that silently skipped valid files outside anticipated shapes.

## Integration Points

ArtifactPatternMap's two structures are consumed exclusively within `EntityPatternAnalyzer`, by `checkLocalArtifact()` and `matchArtifactPattern()`, and their outputs feed `analyzeEntityPatterns()`'s `LayerResult` construction. Downstream, team/entityClass decisions propagate into manifest/graph entities, meaning any drift between `artifactPatterns.entityClassMap` and `inferEntityClass`'s `teamMappings` produces exactly the kind of metadata mismatch flagged by the "Metadata Merge Bug — Destructive Overwrite Pattern" precedent: undetected drift here surfaces later as corrupted downstream metadata, not as a local error.

## Usage Guidelines

Treat the two entityClass maps as a single logical source that currently lives in two places — any new artifact prefix (e.g., a hypothetical 'Vector' team) must be added to both `artifactPatterns.entityClassMap` and `inferEntityClass`'s `teamMappings`, or classification will silently diverge. Because matching is linear and order-dependent, new patterns should be placed with awareness of which existing patterns they might shadow. Given the silent-drop behavior on non-conforming paths, any change to expected file/directory/class shapes should be paired with an audit for entities that would newly fall outside all regexes — per the re-measurement discipline noted for the Metadata Merge Bug fix, don't declare a pattern-map change safe without confirming it against real downstream classification output, not just literal diff review.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- The 'ArtifactPatternMap' component is not itself a distinct file or class — it appears only conceptually, as the composite of EntityPatternAnalyzer.ts's teamDirectories Map and artifactPatterns array. No separate module named ArtifactPatternMap exists in the code graph; the closest artifacts are the constructor-defined data structures inside EntityPatternAnalyzer's class body.
- teamDirectories is a Map<string,string[]> hardcoding four teams (Coding, RaaS, ReSi, UI) to disjoint directory prefixes, while artifactPatterns is a parallel array of {team, patterns, entityClassMap} objects with per-team regex vocabularies (e.g. Kubernetes/Argo for RaaS, VirtualTarget/MF4Container for ReSi). These two structures are consulted in sequence by checkLocalArtifact() and matchArtifactPattern() respectively, forming the de facto 'pattern map' the parent entity refers to.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Test Inventory Discovery — node:test Compatibility work record shows this project's tooling has previously used narrow heuristic matching (mocha/jest import styles) that silently skipped valid files outside the anticipated shape; the same risk applies to the pattern-map's regexes (filePathPattern, dirPattern, classPattern) since any artifact reference not conforming to the expected lowercase-directory or CamelCase-suffix shape is silently dropped rather than surfaced as unclassified.
- The Metadata Merge Bug — Destructive Overwrite Pattern work record's discipline of re-measuring before declaring a fix closed is relevant here because the pattern-map's team/entityClass decisions feed directly into downstream manifest/graph entities; an undetected mismatch between artifactPatterns' entityClassMap and inferEntityClass's teamMappings would produce exactly the kind of drifted metadata that record warns against.

## Hierarchy Context

### Parent
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- [CGR] EntityPatternAnalyzer (class) in EntityPatternAnalyzer.ts

### Siblings
- [TeamDirectoryRegistry](./TeamDirectoryRegistry.md) -- [LLM+CGR] No file, class, or export named 'TeamDirectoryRegistry' appears anywhere in the supplied code. The closest structure is the private `teamDirectories` field declared in `src/ontology/heuristics/EntityPatternAnalyzer.ts` (constructor, lines ~30-46) — a `Map<string, string[]>` built inline with four hardcoded teams (Coding, RaaS, ReSi, UI) and their directory prefixes. It is a field of `EntityPatternAnalyzer`, not an independently named or exported registry component, and there is no separate module, class, or interface that constitutes 'TeamDirectoryRegistry' as a standalone entity.
- [ArtifactExtractor](./ArtifactExtractor.md) -- [LLM] No entity or file named 'ArtifactExtractor' appears anywhere in the supplied code. The only structurally similar element is the private method `extractArtifacts()` inside `EntityPatternAnalyzer` (src/ontology/heuristics/EntityPatternAnalyzer.ts), which is a lowercase-verb method on the analyzer class, not a standalone 'ArtifactExtractor' component. Retrieval appears to have matched on the word 'Artifact' (also present in the imported `ArtifactMatch` type and the `ArtifactPattern` interface) rather than surfacing a real ArtifactExtractor definition.
- [LayeredConfidenceScoring](./LayeredConfidenceScoring.md) -- [LLM+CGR] The two hardcoded confidence values (0.9 in checkLocalArtifact, 0.75 in matchArtifactPattern) inside EntityPatternAnalyzer.ts constitute the entire 'layered confidence' scheme visible in this file: there is no LayeredConfidenceScoring class, function, or module present anywhere in the supplied code — only these two literal numbers assigned directly in analyzeEntityPatterns() when constructing the returned LayerResult objects.


---

*Generated from 9 observations*
