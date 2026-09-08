# ArtifactPatternMatching

**Type:** Detail

matchArtifactPattern() (step b of analyzeEntityPatterns) is invoked only after checkLocalArtifact() direct match fails, returning confidence 0.75 vs 0.9 for direct matches

# ArtifactPatternMatching — Technical Insight Document

## What It Is

ArtifactPatternMatching is implemented within `EntityPatternAnalyzer.ts` as a fallback classification mechanism driven by an `artifactPatterns` array. Each element of this array is an `ArtifactPattern` object composed of three fields: a `team` identifier, a `patterns` array of `RegExp` instances, and an `entityClassMap` that translates a matched pattern into a concrete entity class name. This structure allows the analyzer to recognize artifact names or content strings (e.g., `LSLSession`, `KubernetesCluster`, `ArgoWorkflow`) and attribute them to both an owning team and a specific entity classification.

## Architecture and Design

The design follows a team-partitioned pattern-matching strategy: rather than a single global regex table, patterns are grouped per team (Coding, RaaS, ReSi, Agentic, UI), mirroring the team/directory ownership model established in the parent `EntityPatternAnalyzer` component (via `teamDirectories`). This creates a consistent mental model across the system — the same team boundaries used for directory ownership (e.g., 'Coding' owning `src/ontology`, `src/knowledge-management`, `scripts`, `.specstory`) are echoed in artifact classification, so an artifact's team affiliation can be cross-validated against both its directory location and its structural/naming pattern.

Architecturally, this is a two-tier confidence system layered on top of a direct-match strategy. `matchArtifactPattern()` is explicitly a fallback: it only executes as "step b" of `analyzeEntityPatterns` after `checkLocalArtifact()` (direct match) fails. This tiered design encodes a clear precedence: exact/local knowledge is trusted more (confidence 0.9) than inferred pattern-based knowledge (confidence 0.75). This is a pragmatic trade-off — regex-based matching is inherently heuristic and can produce false positives, so the system discounts its confidence score accordingly rather than treating it as equally authoritative.

## Implementation Details

Each team's pattern set is tailored to that team's naming conventions. Coding-team patterns target internal architecture components: `/LSL(Session|Monitor|Classifier)/i`, `/Constraint(Rule|Monitor|Hook)/i`, `/MCP(Agent|Service|Tool)/i`, and `/Knowledge(Entity|Retriever|Extractor)/i` — reflecting naming families like LSL sessions, constraint hooks, MCP tooling, and knowledge-management primitives. RaaS-team patterns target infrastructure/orchestration nomenclature: `/Kubernetes(Cluster|Pod|Service)/i`, `/Argo(Workflow|Template)/i`, `/EventMesh(Node|Producer|Consumer)/i`, aligning with cloud-native and workflow-orchestration terminology.

Resolution from a matched pattern to a concrete class is handled per-team via `entityClassMap`. For instance, the Agentic team's map resolves `LangChain` to `AgentFramework` and `RAG` to `RAGSystem`. This indirection layer decouples the raw regex match from the final entity classification, letting multiple pattern variants collapse to the same semantic entity class, and allowing class names to evolve independently of the matching regexes.

The invocation flow is orchestrated by `analyzeEntityPatterns()` (documented as the `AnalyzeEntityPatternsPipeline` sibling), which first calls `extractArtifacts(knowledge.content)` and short-circuits with `null` if no artifacts are found. Only when artifacts exist does the pipeline proceed to check local artifacts directly, falling back to `matchArtifactPattern()`'s regex-driven classification when direct lookups fail.

## Integration Points

ArtifactPatternMatching is tightly coupled to its parent, `EntityPatternAnalyzer`, both structurally (same file, `EntityPatternAnalyzer.ts`) and conceptually (shared team taxonomy with `TeamDirectoryMap`'s `teamDirectories`). It also depends on the upstream extraction step (`extractArtifacts`) and the direct-match step (`checkLocalArtifact`) within the `AnalyzeEntityPatternsPipeline`, since it only activates when those precondition checks fail to resolve an artifact. The `entityClassMap` output feeds downstream consumers of `analyzeEntityPatterns()` that expect a resolved `entityClass` string alongside a confidence score.

## Usage Guidelines

When adding new artifact types, developers should extend the appropriate team's `patterns` array and corresponding `entityClassMap` entry together, keeping naming conventions consistent with existing regex families (e.g., suffix-based grouping like `(Session|Monitor|Classifier)`). Because pattern-matching is a fallback rather than primary path, new artifacts that can be resolved via direct/local lookup should be added to `checkLocalArtifact()`'s data instead, reserving regex patterns for cases where exact matches aren't feasible. Given the reduced confidence (0.75) assigned to pattern matches, downstream consumers should treat this classification as provisional and design tolerance for occasional misclassification, particularly as regex patterns are inherently broad-matching and could overlap across teams if not carefully scoped.


## Hierarchy Context

### Parent
- [EntityPatternAnalyzer](./EntityPatternAnalyzer.md) -- EntityPatternAnalyzer.teamDirectories Map hardcodes directory-to-team ownership, e.g. 'Coding' owns src/ontology, src/knowledge-management, scripts, .specstory

### Siblings
- [TeamDirectoryMap](./TeamDirectoryMap.md) -- teamDirectories in EntityPatternAnalyzer.ts constructor is a Map with keys 'Coding', 'RaaS', 'ReSi', 'Agentic', 'UI' mapping to arrays of directory strings
- [AnalyzeEntityPatternsPipeline](./AnalyzeEntityPatternsPipeline.md) -- analyzeEntityPatterns() in EntityPatternAnalyzer.ts calls extractArtifacts(knowledge.content) and returns null if no artifacts found


---

*Generated from 5 observations*
