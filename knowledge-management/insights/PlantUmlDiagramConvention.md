# PlantUmlDiagramConvention

**Type:** Detail

The directory integrations/mcp-server-semantic-analysis/docs/architecture/ contains multiple dedicated Markdown files (agents.md, integration.md, tools.md) that, per the L2 description, each reference PlantUML sources — indicating a one-Markdown-per-diagram-topic pattern.

# PlantUmlDiagramConvention

## What It Is

The `PlantUmlDiagramConvention` is a project-wide documentation standard that mandates all architecture diagrams be authored and stored as `.puml` (PlantUML) source files under `docs/puml/` directories. This convention is evidenced concretely in the `integrations/mcp-server-semantic-analysis/docs/architecture/` directory, where multiple dedicated Markdown files — `agents.md`, `integration.md`, and `tools.md` — each reference PlantUML sources to render their respective diagrams. The convention establishes "diagrams as code" as the canonical approach for visual architectural documentation across the codebase.

As a child of `DocumentationConventions`, this convention crystallizes one specific rule within the broader family of documentation standards governing the project. While its sibling `LayeredDocsSubdirectoryStructure` defines *where* documentation lives (in named subdirectories like `architecture/`, `api/`, and `installation/`), `PlantUmlDiagramConvention` defines *how* the visual content within those documentation areas is authored and versioned.

## Architecture and Design

The architectural approach behind this convention rests on three layered design decisions. First, diagrams are treated as **source artifacts**, not binary outputs — by storing `.puml` files under `docs/puml/`, the project ensures that diagram definitions are plain text that can be diffed, reviewed in pull requests, and merged like any other source code. Second, there is a clean **separation between diagram sources and their textual context**: PlantUML files hold pure diagram logic, while sibling Markdown documents (e.g., `agents.md`, `integration.md`, `tools.md`) provide the narrative explanation and reference those sources.

The third design decision is evident in the **navigation layer**: the `architecture/README.md` file, titled "Architecture Documentation - MCP Server Semantic Analysis," acts as an index into the diagram collection rather than embedding diagrams directly. This separation of navigation concerns from diagram source files mirrors the pattern established by the sibling `LayeredDocsSubdirectoryStructure`, where each subdirectory (architecture, api, installation) has its own README index. The result is a self-describing, hierarchical documentation tree where readers can drill from a top-level README into topic-specific Markdown files, which in turn reference the underlying `.puml` sources.

The "one Markdown per diagram topic" pattern is a deliberate organizational choice. Rather than aggregating all diagrams into a single oversized document, each conceptual area of the architecture (agents, integration points, tools) gets a dedicated Markdown companion. This keeps each document focused and allows the diagram set to grow without producing monolithic documentation files.

## Implementation Details

Implementation of the convention is realized through a consistent directory and file layout rather than through code. The canonical evidence is the structure under `integrations/mcp-server-semantic-analysis/docs/architecture/`:

- `README.md` — the architecture index document ("Architecture Documentation - MCP Server Semantic Analysis")
- `agents.md` — topic-specific documentation referencing PlantUML sources for agent diagrams
- `integration.md` — topic-specific documentation referencing PlantUML sources for integration diagrams
- `tools.md` — topic-specific documentation referencing PlantUML sources for tools diagrams

The actual `.puml` source files are stored under `docs/puml/` directories per the project-wide convention inherited from the parent `DocumentationConventions`. By keeping the PlantUML sources in a separate `docs/puml/` location distinct from the Markdown that references them, the convention enables independent rendering pipelines: a PlantUML processor can scan `docs/puml/` for sources to produce images, while Markdown renderers handle the narrative documents that reference those rendered outputs.

There are no code symbols associated with this entity because the convention is purely a documentation and tooling agreement — it is enforced through directory layout and contributor discipline, not through runtime code. The mechanics are: (1) authors write `.puml` files containing diagram definitions, (2) those files are committed to `docs/puml/`, (3) topic Markdown files in directories like `docs/architecture/` reference the corresponding diagrams, and (4) a top-level `README.md` indexes the topic files.

## Integration Points

This convention integrates tightly with its parent `DocumentationConventions`, which defines the umbrella of documentation standards under which `PlantUmlDiagramConvention` is one specific rule. It also operates in concert with its sibling `LayeredDocsSubdirectoryStructure`: the layered structure establishes the named subdirectories (`architecture/`, `api/`, `installation/`) that host the diagram-referencing Markdown files, and the PlantUML convention determines what those Markdown files reference.

The convention interfaces with version control systems naturally — because `.puml` files are plain text, Git can track changes line-by-line, enabling meaningful diffs on architectural changes. This is a deliberate trade-off favoring traceability over the convenience of WYSIWYG diagram editors that produce binary outputs.

External integration points include any PlantUML rendering toolchain (such as the PlantUML CLI, build-time renderers, or IDE plugins) that converts `.puml` sources into images for display. These tools are not part of the convention itself but are implicitly required to make the diagrams viewable. Renderers consume files from `docs/puml/`, and downstream documentation viewers consume the resulting images alongside the Markdown context.

## Usage Guidelines

When adding new architecture diagrams to the project, contributors should follow these conventions:

1. **Author diagrams as `.puml` source files** and place them under the appropriate `docs/puml/` directory. Do not commit binary diagram formats (such as `.png` or `.svg` exports) as the primary source — they may be generated as derived artifacts, but the `.puml` file is the source of truth.

2. **Create or extend a topic-specific Markdown file** in the relevant documentation subdirectory (e.g., `integrations/<integration-name>/docs/architecture/<topic>.md`) to reference the new diagram. Follow the existing one-Markdown-per-topic pattern established by `agents.md`, `integration.md`, and `tools.md` — if your diagram does not fit an existing topic, create a new topic Markdown file rather than overloading an existing one.

3. **Update the `architecture/README.md` index** to link to any newly added topic Markdown files, preserving its role as the navigation entry point for the architecture documentation set.

4. **Keep diagram sources and narrative documentation separated**. The `.puml` file should contain only the diagram definition; explanations, prose, and context belong in the referencing Markdown document.

5. **Respect the layered subdirectory structure** defined by the sibling `LayeredDocsSubdirectoryStructure`. Architecture diagrams belong under `architecture/`, API-related diagrams under `api/`, and installation-related diagrams under `installation/`, ensuring the self-describing nature of the documentation tree is preserved.

By treating diagrams as code and maintaining the separation between source, narrative, and navigation, this convention ensures that architectural documentation remains reviewable, diffable, and maintainable as the codebase evolves.


## Hierarchy Context

### Parent
- [DocumentationConventions](./DocumentationConventions.md) -- All architecture diagrams are stored as .puml files under docs/puml/ directories, as evidenced by the documentation listing showing integrations/mcp-server-semantic-analysis/docs/architecture/ containing multiple .md files that reference PlantUML sources.

### Siblings
- [LayeredDocsSubdirectoryStructure](./LayeredDocsSubdirectoryStructure.md) -- The integrations/mcp-server-semantic-analysis/docs/ tree contains at least three named subdirectories — architecture/, api/, and installation/ — each with its own README.md (e.g., 'Architecture Documentation - MCP Server Semantic Analysis', 'API Reference - MCP Server Semantic Analysis', 'Installation Guide - MCP Server Semantic Analysis'), making the subdirectory purpose self-describing.


---

*Generated from 4 observations*
