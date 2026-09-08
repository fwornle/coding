# AnalyzeEntityPatternsPipeline

**Type:** Detail

Iterates each artifact trying checkLocalArtifact() first (confidence 0.9) then matchArtifactPattern() (confidence 0.75) per the class docstring 'two-step checking'

# AnalyzeEntityPatternsPipeline — Technical Insight Document

## What It Is

AnalyzeEntityPatternsPipeline is the operational pipeline embodied by the `analyzeEntityPatterns()` method in `EntityPatternAnalyzer.ts`. It represents Layer 1 of an entity classification system, tasked with rapidly determining which entity class and owning team a piece of "knowledge content" belongs to, based on artifact references (file paths, patterns) found within that content. As a child concept contained within `EntityPatternAnalyzer`, this pipeline is the executable process that ties together the class's static configuration (team directory maps, artifact patterns) into a single callable flow.

## Architecture and Design

The pipeline follows a clear **fail-fast, staged-matching** design. The entry point, `analyzeEntityPatterns()`, first calls `extractArtifacts(knowledge.content)` to pull candidate artifact references out of raw content. If no artifacts are extracted, the method short-circuits and returns `null` — an explicit early-exit pattern that avoids unnecessary work downstream and signals "no opinion" to whatever orchestrates multiple analysis layers.

For each artifact found, the pipeline applies a documented **two-step checking** strategy (per the class docstring): it first attempts `checkLocalArtifact()`, a higher-confidence (0.9) check presumably against known/local artifact registries, and falls back to `matchArtifactPattern()`, a lower-confidence (0.75) regex-based match against the `artifactPatterns` array (a sibling concept, `ArtifactPatternMatching`). This two-tier confidence scoring is a deliberate design trade-off: prefer exact/local knowledge when available, but degrade gracefully to pattern-based heuristics rather than failing outright.

The pipeline's output is structured as a `LayerResult` object — a standardized contract (`layer`, `layerName`, `entityClass`, `team`, `confidence`, `processingTime`, `evidence`) that strongly suggests this analyzer is one layer in a multi-layer pipeline architecture, where each layer produces a comparable result object for downstream aggregation or arbitration logic.

## Implementation Details

The core method signature and flow center on `analyzeEntityPatterns()`, which:
1. Extracts artifacts via `extractArtifacts(knowledge.content)`.
2. Returns `null` immediately if extraction yields nothing.
3. Iterates extracted artifacts, invoking `checkLocalArtifact()` then `matchArtifactPattern()` per artifact, assigning confidence scores of 0.9 and 0.75 respectively.
4. Constructs and returns a `LayerResult` with `layerName: 'EntityPatternAnalyzer'` and `layer: 1`, embedding the resolved `entityClass`, `team`, `confidence`, `processingTime`, and a human-readable `evidence` string explaining the match.

The team-resolution logic depends on two configuration structures owned by the parent `EntityPatternAnalyzer` class: the `teamDirectories` Map (sibling: `TeamDirectoryMap`), which hardcodes directory-to-team ownership (e.g., 'Coding' owns `src/ontology`, `src/knowledge-management`, `scripts`, `.specstory`), and the `artifactPatterns` array (sibling: `ArtifactPatternMatching`), where each `ArtifactPattern` object carries a `team`, an array of `RegExp` patterns, and an `entityClassMap`. The pipeline's fallback matching step (`matchArtifactPattern()`) directly consumes this array, while `checkLocalArtifact()` presumably consults the directory map or a related local index.

Performance is a first-class design constraint: the class docstring specifies a target of **<1ms response time** for this Layer 1 detection, reflected in the `processingTime` field captured in each `LayerResult`. This implies the implementation favors lightweight, synchronous checks (Map lookups, regex tests) over any I/O-bound or asynchronous operations.

## Integration Points

This pipeline is tightly coupled to its parent `EntityPatternAnalyzer`, which owns the configuration state (`teamDirectories`, `artifactPatterns`) that the pipeline reads at runtime — the pipeline itself holds no independent configuration. It depends on `extractArtifacts()` to bridge from raw `knowledge.content` into structured artifact candidates, and on two resolver functions, `checkLocalArtifact()` and `matchArtifactPattern()`, representing distinct data sources (local/known artifacts vs. regex-pattern heuristics from `ArtifactPatternMatching`).

The `LayerResult` return contract (with explicit `layer: 1` and `layerName`) strongly implies integration with a broader multi-layer analysis system, where results from this and other layers are likely aggregated, compared by confidence, or chained. The `null` return on no-artifacts is itself an integration contract — callers must handle this as a valid "no signal" outcome rather than an error.

## Usage Guidelines

Callers must treat a `null` return as a legitimate, expected outcome when content contains no identifiable artifacts, not as a failure state. When interpreting results, the `confidence` field should be respected as a differentiator: 0.9 (local artifact match) is more trustworthy than 0.75 (pattern match), and downstream consumers should weight or prioritize accordingly if reconciling with other layers.

Because the class targets sub-millisecond performance, any modifications to `analyzeEntityPatterns()`, `checkLocalArtifact()`, or `matchArtifactPattern()` should avoid introducing expensive operations (e.g., synchronous I/O, unbounded regex backtracking) that could violate this budget. When extending team or entity coverage, changes belong in the sibling configuration structures — `teamDirectories` (`TeamDirectoryMap`) for directory ownership and `artifactPatterns` (`ArtifactPatternMatching`) for regex-based detection — rather than in the pipeline logic itself, preserving the separation between configuration data and matching flow. The `evidence` string in each `LayerResult` should be kept human-readable, as it appears intended for debugging/audit purposes when tracing why a given team/entityClass was assigned.


## Hierarchy Context

### Parent
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- EntityPatternAnalyzer.teamDirectories Map hardcodes directory-to-team ownership, e.g. 'Coding' owns src/ontology, src/knowledge-management, scripts, .specstory

### Siblings
- [TeamDirectoryMap](./TeamDirectoryMap.md) -- teamDirectories in EntityPatternAnalyzer.ts constructor is a Map with keys 'Coding', 'RaaS', 'ReSi', 'Agentic', 'UI' mapping to arrays of directory strings
- [ArtifactPatternMatching](./ArtifactPatternMatching.md) -- artifactPatterns array in EntityPatternAnalyzer.ts defines ArtifactPattern objects each with team, patterns (RegExp[]), and entityClassMap


---

*Generated from 4 observations*
