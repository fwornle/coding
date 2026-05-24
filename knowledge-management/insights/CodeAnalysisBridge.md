# CodeAnalysisBridge

**Type:** Detail

Relationship types CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, and CONTAINS_MODULE (listed as key documented components) indicate CodeAnalysisBridge also produces structural containment edges in addition to semantic relationships like DEFINES and DEPENDS_ON_EXTERNAL.

# CodeAnalysisBridge

## What It Is

CodeAnalysisBridge is a stage within the `OnlineLearning` batch analysis pipeline that translates static code analysis outputs into graph entities and relationships consumable by the downstream graph storage layer. While the observations do not pinpoint a single implementation file for the bridge itself, its outputs converge—alongside two sibling source channels (git history analysis and LSL session analysis)—into the unified graph write path implemented in `storage/graph-database-adapter.ts` via `GraphDatabaseAdapter`. The broader code-to-graph infrastructure it feeds is documented in `integrations/code-graph-rag/README.md` ("Graph-Code: A Graph-Based RAG System for Any Codebases"), which describes the RAG layer as a downstream consumer of the relationship data CodeAnalysisBridge produces.

Functionally, CodeAnalysisBridge is responsible for emitting both **structural containment edges** (`CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`) that capture the hierarchical organization of a codebase, and **semantic relationships** (`DEFINES`, `DEPENDS_ON_EXTERNAL`) that capture the meaning of symbols and their external dependencies. These relationship types are recognized as key documented components of the project's graph schema.

## Architecture and Design

The architectural role of CodeAnalysisBridge is that of an **adapter/translator stage** sitting between two distinct domains: the output format of a static code analyzer (parsed packages, folders, files, modules, symbol definitions, external imports) and the typed-graph contract enforced by `GraphDatabaseAdapter`. Its parent, `OnlineLearning`, follows a **fan-in batch pipeline pattern**: three parallel source channels (git history, LSL sessions, code analysis) each produce graph-ready output, and all three converge on a single write path. CodeAnalysisBridge is the code-analysis arm of this fan-in topology.

This design implies a clear **separation of concerns**: each source channel owns its own extraction and mapping logic, but all channels share a common output schema. CodeAnalysisBridge does not write to the graph store directly—it produces relationship and entity records conforming to the shared schema, which `GraphDatabaseAdapter` then persists. This indirection keeps the static analysis logic decoupled from the graph storage technology and allows the sibling channels to evolve their own mapping logic without coordination.

The dual emission of structural (`CONTAINS_*`) and semantic (`DEFINES`, `DEPENDS_ON_EXTERNAL`) relationships reflects a layered graph design. Structural edges form the skeleton—a navigable tree of package → folder → file → module—while semantic edges overlay meaning on top: which modules define which symbols, and which modules reach out to external dependencies. Downstream RAG <USER_ID_REDACTED> described in `integrations/code-graph-rag/README.md` can traverse either layer or both.

## Implementation Details

CodeAnalysisBridge's implementation centers on mapping logic that takes static analysis outputs and produces typed graph records. Although the source observations do not enumerate concrete classes or functions within the bridge itself, the relationship types it produces give a clear picture of its emission surface:

- **Containment edges**: `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`. These are emitted as the bridge walks the parsed project structure, materializing one edge per parent–child relationship at each level of the hierarchy. The four distinct types preserve the semantic distinction between package, filesystem folder, file, and module-level scoping rather than collapsing them into a single generic `CONTAINS` edge.
- **Definition edges**: `DEFINES`. Emitted from a containing module (or other definer) to a symbol, capturing the "this scope defines this entity" relationship that static analysis surfaces from parsed source code.
- **External dependency edges**: `DEPENDS_ON_EXTERNAL`. Emitted when the analyzer detects a reference to a symbol or package outside the codebase under analysis. This explicitly distinguishes external dependencies from internal definitions—an important typing decision for downstream <USER_ID_REDACTED> that, for example, want to enumerate third-party surface area without traversing internal code.

Because CodeAnalysisBridge is one of three parallel source channels in a batch pipeline, it is invoked in a batch-oriented manner by `OnlineLearning` rather than reactively. Its output is materialized as a batch of records handed off to `GraphDatabaseAdapter` for persistence.

## Integration Points

The primary downstream integration is with **`GraphDatabaseAdapter`** in `storage/graph-database-adapter.ts`. CodeAnalysisBridge does not perform graph writes itself; instead, it conforms its output to the shared schema that `GraphDatabaseAdapter` accepts. This is the convergence point for all three sibling channels under `OnlineLearning`, so the bridge's output schema is governed by the same contract used by the git history and LSL session channels.

The secondary downstream consumer is the **code-graph-rag** subsystem, documented in `integrations/code-graph-rag/README.md`. Once CodeAnalysisBridge's relationships are persisted, the RAG layer <USER_ID_REDACTED> them to answer code-aware questions, navigate the codebase graph, and reason over external dependencies. The richer the bridge's typed output, the more expressive RAG-layer <USER_ID_REDACTED> can be.

Upstream, the bridge integrates with whatever static analysis tooling provides the parsed project structure and symbol-level information. The observations identify the bridge as the stage that **maps** these outputs, implying it consumes a structured analyzer output rather than parsing source code itself.

Within the `OnlineLearning` pipeline, CodeAnalysisBridge runs in parallel with the git history channel and the LSL session channel. The three are siblings under the same orchestrator and share the same output destination, but they do not depend on each other's results.

## Usage Guidelines

**Register relationship types before emitting them.** Because CodeAnalysisBridge must conform its output schema to the contract accepted by `GraphDatabaseAdapter`, any new relationship type it introduces must be registered in the shared graph schema *before* the bridge starts emitting it. Emitting an unregistered type will be rejected at the write boundary. This applies equally to new structural edges and new semantic edges.

**Preserve the distinction between structural and semantic edges.** The graph schema deliberately separates containment (`CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`) from semantic relationships (`DEFINES`, `DEPENDS_ON_EXTERNAL`). When adding new emission logic, classify the new edge into the appropriate layer rather than overloading an existing type. Collapsing layers will degrade the precision of downstream RAG <USER_ID_REDACTED>.

**Mark external dependencies explicitly via `DEPENDS_ON_EXTERNAL`.** Internal references should not be conflated with external ones. The `DEPENDS_ON_EXTERNAL` type exists precisely to allow downstream consumers to reason about the boundary between the codebase under analysis and its third-party surface area.

**Keep the bridge as a pure mapping stage.** CodeAnalysisBridge is positioned as a translator between static analysis output and the graph schema. It should not perform graph writes directly, should not depend on the sibling channels (git history, LSL sessions), and should not embed downstream RAG-layer concerns. The clean fan-in topology under `OnlineLearning` depends on each channel remaining a self-contained producer.

**Treat the bridge as batch-invoked.** Like its siblings, CodeAnalysisBridge runs as part of `OnlineLearning`'s batch pipeline. New functionality should be designed to operate over a full analysis pass rather than as an incremental or streaming computation, unless the parent pipeline is reworked accordingly.

---

### Summary of Architectural Insights

1. **Architectural patterns identified**: Adapter/translator stage; fan-in batch pipeline (three parallel source channels converging on a single graph write path); layered graph schema separating structural containment from semantic meaning.
2. **Design decisions and trade-offs**: Indirection through `GraphDatabaseAdapter` (decouples bridge from storage technology at the cost of an enforced shared schema); four distinct `CONTAINS_*` types instead of a generic `CONTAINS` (more expressive <USER_ID_REDACTED>, slightly more schema surface to maintain); explicit `DEPENDS_ON_EXTERNAL` typing (clear internal/external boundary at the cost of an additional relationship type).
3. **System structure insights**: CodeAnalysisBridge is one of three siblings under `OnlineLearning`; outputs converge in `storage/graph-database-adapter.ts`; downstream consumed by the RAG layer documented in `integrations/code-graph-rag/README.md`.
4. **Scalability considerations**: Batch-oriented execution allows parallelism across the three source channels; the shared schema contract is the throughput bottleneck and the coordination point. Large codebases will produce proportionally large containment trees, so emission should remain streamable into the adapter rather than buffered whole in memory where possible.
5. **Maintainability assessment**: Strong—responsibilities are cleanly partitioned (mapping vs. persistence vs. consumption), and the typed schema makes additions discoverable and auditable. The main maintenance discipline required is keeping new emitted relationship types registered in the shared schema before use.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning extraction runs as a batch analysis pipeline referencing git history, LSL sessions, and code analysis—three distinct source channels whose outputs converge into a single graph write path via GraphDatabaseAdapter in storage/graph-database-adapter.ts


---

*Generated from 4 observations*
