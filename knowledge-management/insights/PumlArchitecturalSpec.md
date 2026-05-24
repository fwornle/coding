# PumlArchitecturalSpec

**Type:** Detail

The project documentation tree shows dedicated architecture directories (e.g., integrations/mcp-server-semantic-analysis/docs/architecture/) with files such as agents.md, integration.md, and tools.md — indicating that diagrams are intended to complement layered, topic-scoped written documentation rather than replace it

# PumlArchitecturalSpec

## What It Is

`PumlArchitecturalSpec` is a documentation convention implemented through the `docs/puml/` directory, which serves as the designated home for PlantUML source files across the project. It represents the canonical format and location for architectural diagrams that visually specify system structure and behavior. Rather than being a piece of executable code or a runtime component, this entity codifies a project-wide convention: any architectural diagram intended to capture design intent should be authored as a `.puml` source file within `docs/puml/`.

As a child of `DiagramAsDocumentation`, `PumlArchitecturalSpec` provides the concrete format choice that makes the parent's broader "diagram as documentation" philosophy practical. Where `DiagramAsDocumentation` establishes the principle that diagrams capture architectural decisions and provide visual specification, `PumlArchitecturalSpec` specifies *how* that principle is realized — through PlantUML sources kept in a dedicated directory, deliberately separated from the prose markdown documentation that lives in topic-scoped folders elsewhere in the tree.

## Architecture and Design

The architectural approach evident from the observations is one of **separation of concerns within documentation itself**. Visual specifications (PlantUML sources) are physically segregated into `docs/puml/`, while narrative architectural documentation lives in dedicated subdirectories such as `integrations/mcp-server-semantic-analysis/docs/architecture/`, which contains topic-scoped files like `agents.md`, `integration.md`, and `tools.md`. This split intentionally treats diagrams as complementary artifacts rather than substitutes for written explanation — diagrams answer "what does the structure look like?" while prose markdown answers "why does it work this way, and how do I use it?"

The decision to canonicalize PlantUML — a textual, declarative diagram format — rather than exported PNG or SVG binaries reflects a deeper architectural commitment: **diagrams should be reviewable artifacts, not opaque assets**. Because `.puml` files are plain text, they produce meaningful diffs in version control. A reviewer examining a pull request can read the structural changes to an architecture diagram the same way they read code changes: line by line, with context, in a familiar diff view. This makes architectural evolution traceable through the same review process as functional changes.

The co-location of `docs/puml/` within the project's documentation tree, while keeping it physically distinct from the markdown files, follows a deliberate pattern: keep all documentation together for discoverability, but separate by *type* so each format can be tooled, rendered, and reviewed appropriately.

## Implementation Details

Implementation of `PumlArchitecturalSpec` is convention-based rather than code-based — there are no code symbols associated with this entity. The "implementation" consists of three concrete commitments:

1. **Designated directory**: All PlantUML sources live in `docs/puml/`. This single-location rule eliminates ambiguity about where new diagrams should be added and where existing ones can be found.

2. **Format canonicalization**: The diagram source format is PlantUML, not exported image formats. This means contributors author `.puml` files directly; rendered images, if needed for embedding in markdown, are generated from these sources rather than checked in as the primary artifact.

3. **Complementary relationship with markdown documentation**: Diagrams under `docs/puml/` are designed to pair with the prose documentation in directories like `integrations/mcp-server-semantic-analysis/docs/architecture/`. The files `agents.md`, `integration.md`, and `tools.md` represent the topic-scoped, layered prose that PlantUML diagrams visually augment.

The mechanics are deliberately minimal: a developer creates a new `.puml` file in `docs/puml/`, references it conceptually (or via rendered output) from the relevant `.md` file in the appropriate `docs/architecture/` location, and commits both. The system relies on convention enforced through code review rather than tooling-level validation.

## Integration Points

`PumlArchitecturalSpec` integrates with the broader documentation ecosystem along two axes. First, it nests within the `DiagramAsDocumentation` parent concept — every PlantUML spec authored under `docs/puml/` is an instance of treating diagrams as first-class architectural documentation, capturing decisions in a versioned, reviewable form.

Second, it integrates with the markdown documentation tree through topical correspondence. The architecture directories scattered through the project — exemplified by `integrations/mcp-server-semantic-analysis/docs/architecture/` and its `agents.md`, `integration.md`, and `tools.md` files — provide the prose context that PlantUML diagrams illustrate. The integration is conceptual and editorial rather than mechanical: there is no enforced linking between a `.puml` source and a specific markdown file, but the practice expects diagrams to support the layered topics described in those markdown files.

Version control is the third integration point and arguably the most consequential. Because PlantUML is text, `docs/puml/` participates fully in Git's diff, blame, and review workflows. Architectural changes become reviewable artifacts in pull requests, and the history of a system's structure can be reconstructed by walking the commit history of its `.puml` files.

## Usage Guidelines

When adding or modifying architectural diagrams, developers should observe the following conventions:

- **Always author diagrams as PlantUML sources placed in `docs/puml/`.** Do not commit PNG, SVG, or other rendered binary formats as the primary artifact. Rendered images may be generated and embedded in markdown, but the `.puml` source is canonical.

- **Treat diagrams as complementary, not substitutive.** A diagram should accompany prose documentation in the appropriate `docs/architecture/` directory (such as `integrations/mcp-server-semantic-analysis/docs/architecture/`), not replace it. Use diagrams to convey structure and relationships; use markdown files like `agents.md`, `integration.md`, and `tools.md` to convey rationale, usage, and detail.

- **Review diagram changes like code changes.** Because `.puml` files are diffable, architectural changes warrant the same scrutiny as functional changes. Pull request reviewers should examine `.puml` diffs to understand structural evolution.

- **Keep diagram scope aligned with topic scope.** The existing pattern of topic-scoped architecture files (one per major concern like agents, integration, tools) suggests diagrams should similarly be scoped — a single diagram should illuminate a coherent topic rather than attempting to capture the entire system at once.

- **Place new diagrams in `docs/puml/` regardless of which subsystem they describe.** The centralized location is part of the convention; subsystem-specific markdown lives near the code, but diagrams remain co-located in the dedicated diagram directory.

---

### Summary of Architectural Insights

1. **Architectural patterns identified**: Convention-over-configuration documentation layout; separation of concerns by documentation type (visual sources vs. prose); text-as-source for diagrams to enable code-review workflows.

2. **Design decisions and trade-offs**: Choosing PlantUML over rendered binaries trades immediate visual accessibility (you must render to view) for reviewability and version-control friendliness. Centralizing under `docs/puml/` trades co-location-with-code (diagrams next to the modules they describe) for a single, predictable location.

3. **System structure insights**: The documentation tree is bifurcated — prose lives in topic-scoped `docs/architecture/` folders close to their subsystems, while diagrams consolidate in `docs/puml/`. This reflects a deliberate dual organization: prose follows the code, diagrams follow the format.

4. **Scalability considerations**: The single-directory convention scales straightforwardly as long as filenames remain descriptive and possibly hierarchically prefixed. Tooling for batch rendering or validation could be added without changing the convention.

5. **Maintainability assessment**: High maintainability follows from textual sources being diff-friendly and centrally located. The chief maintenance risk is drift between diagrams and the markdown files they illustrate, since the linkage is editorial rather than enforced — a risk mitigated by reviewing both together in the same pull request.


## Hierarchy Context

### Parent
- [DiagramAsDocumentation](./DiagramAsDocumentation.md) -- The PlantUML diagrams in docs/puml/ capture architectural decisions and provide visual specification


---

*Generated from 3 observations*
