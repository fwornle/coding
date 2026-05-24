# TextPatternPrimitiveLibrary

**Type:** Detail

The file serves OntologyClassificationAgent, CodeGraphAgent, ContentValidationAgent, and SemanticAnalysisAgent simultaneously, meaning the primitive surface must be broad enough to cover ontology labeling, graph edge inference, validation rule matching, and general semantic tagging without specialization leakage.

## What It Is  

`TextPatternPrimitiveLibrary` lives inside **`src/agents/semantic-analyzer.ts`**.  It is the *single authoritative source* for all low‑level text‑pattern primitives used throughout the semantic‑analysis subsystem.  Four distinct agents – **OntologyClassificationAgent**, **CodeGraphAgent**, **ContentValidationAgent**, and **SemanticAnalysisAgent** – import directly from this file, meaning the library supplies the building blocks that each agent needs to recognise, extract, or validate textual structures.  Because the file is the only place where these primitives are defined, the library is deliberately **centralised**; any change to a primitive instantly propagates to every consumer, guaranteeing a consistent interpretation of patterns across the whole system.

The primitives themselves are not high‑level business routines.  The observations indicate they are **compositional functions, regular‑expression fragments, or lightweight NLP utilities** that can be combined in different ways by the four agents.  This keeps the library agnostic to the specific domain concerns of each agent (ontology labeling, graph edge inference, validation rule matching, or generic semantic tagging) while still providing a rich enough surface to satisfy all of them.

---

## Architecture and Design  

The design follows a **shared‑module / cross‑cutting concern** pattern.  `src/agents/semantic-analyzer.ts` acts as a **facade** that exposes a cohesive API of pattern primitives.  By placing the library at the intersection of four independent agents, the architecture enforces **DRY** (Don’t‑Repeat‑Yourself) at the level of pattern definition and eliminates duplication of regex/NLP logic across the codebase.

Each of the four agents imports the same symbols from `semantic-analyzer.ts`, creating an **implicit contract**: the library must remain stable because any breaking change ripples through all agents simultaneously.  This contract encourages **semantic versioning discipline** and makes the library a *core* component of the semantic‑analysis subsystem.  The pattern‑primitive approach also aligns with a **composition over inheritance** mindset – agents compose the low‑level primitives into higher‑order matching pipelines rather than extending a monolithic matcher class.

Because the library is the only place where primitives are defined, the system exhibits a **vertical slicing** of responsibilities: the agents focus on *what* they need to achieve (classification, graph building, validation, analysis) while the library supplies *how* textual patterns are recognised.  This separation of concerns improves testability (primitives can be unit‑tested in isolation) and enables the agents to be swapped or extended without touching the primitive definitions.

---

## Implementation Details  

Although the source contains **no explicit code symbols** in the provided observations, the description of the library’s role lets us infer its internal shape:

1. **Composable Primitive Functions** – Each primitive is likely a pure function that returns a regular‑expression object, a tokeniser configuration, or a small NLP matcher.  By keeping them pure, the library avoids hidden state and makes composition straightforward.

2. **Naming Conventions** – Since the file is the single source of truth, primitive names are expected to be **domain‑agnostic** (e.g., `identifierPattern`, `camelCaseWord`, `numericLiteral`, `sentenceBoundary`).  This naming strategy prevents any single agent from imposing its own semantics on the primitives.

3. **Export Strategy** – The file probably uses a **named‑export** pattern (e.g., `export const identifierPattern = /[A-Za-z_]\w*/;`) so that agents can import exactly what they need, reducing bundle size and minimizing accidental coupling.

4. **Documentation Hooks** – Given its centrality, the library is a natural place for **inline JSDoc comments** that describe each primitive’s purpose, expected input, and edge‑case handling.  This documentation serves both as a developer guide and as a contract for downstream agents.

5. **Testing** – The primitives are likely covered by a **dedicated test suite** that validates each regex/NLP fragment against a curated corpus of examples.  Because the same primitives are consumed by multiple agents, a single source of truth for test data ensures consistent behaviour.

---

## Integration Points  

`TextPatternPrimitiveLibrary` sits **directly under the `SemanticAnalyzer` component** (the parent) and is imported by the four sibling agents: **OntologyClassificationAgent**, **CodeGraphAgent**, **ContentValidationAgent**, and **SemanticAnalysisAgent**.  The integration flow is simple:

```
src/agents/semantic-analyzer.ts   <-- exports primitives
   ▲                               ▲
   │                               │
   │                               └─ imported by OntologyClassificationAgent
   │
   └─ imported by CodeGraphAgent, ContentValidationAgent, SemanticAnalysisAgent
```

* **Dependency Direction** – All four agents have a **unidirectional dependency** on the library; the library does **not** depend on any of the agents, preserving a clean bottom‑up hierarchy.  
* **Interface Surface** – The library’s public API is the set of exported primitives.  Agents treat these exports as **black‑box pattern descriptors**, feeding them into their own parsing pipelines, graph builders, or validation engines.  
* **Runtime Coupling** – Because the agents share the same module instance, any **runtime configuration** (e.g., locale‑specific regex flags) applied in the library instantly affects every consumer, enabling coordinated behaviour without additional wiring.  

No other modules are mentioned as direct consumers, so the library’s **boundary** is well defined: it is the only bridge between raw textual pattern definition and the higher‑level semantic processing performed by the agents.

---

## Usage Guidelines  

1. **Import Only What You Need** – Use named imports to pull in the exact primitives required by an agent.  This reduces the import footprint and makes the dependency graph explicit.  

   ```ts
   import { identifierPattern, numericLiteral } from './semantic-analyzer';
   ```

2. **Treat Primitives as Pure, Stateless Utilities** – Do not mutate the exported regex objects or alter their flags after import.  If a modification is required, create a new derived primitive locally rather than changing the shared instance.

3. **Compose, Don’t Duplicate** – When building a complex matcher, combine existing primitives using standard composition techniques (e.g., regex concatenation, functional pipelines).  Adding a new primitive should be justified by a genuine reuse scenario across multiple agents.

4. **Version Carefully** – Because any breaking change propagates to four agents, introduce new primitives in a **backward‑compatible** manner.  Deprecate old primitives with clear JSDoc notes and provide migration guidance before removal.

5. **Document Edge Cases** – When extending the library, add comprehensive JSDoc comments and unit tests that capture language‑specific quirks (Unicode handling, case folding, etc.).  This documentation becomes the single source of truth for all agents.

6. **Avoid Business Logic** – Keep the library strictly to pattern definition.  Business decisions (e.g., “classify as ontology term if pattern X matches”) belong in the consuming agents, not in the primitive library.

---

### Architectural Patterns Identified
* **Shared‑module / Cross‑cutting Concern** – Centralised primitive definitions used by multiple independent agents.  
* **Facade** – `semantic-analyzer.ts` presents a clean, stable API surface.  
* **Composition over Inheritance** – Agents build complex behaviour by composing low‑level primitives.

### Design Decisions and Trade‑offs
* **Centralisation vs. Flexibility** – Guarantees consistency but makes the library a single point of failure; any breaking change impacts all agents.  
* **Stateless Primitives** – Improves testability and reusability but requires agents to handle stateful concerns themselves.  
* **Domain‑agnostic Naming** – Prevents leakage of agent‑specific semantics but may require more documentation to convey intent.

### System Structure Insights
* The semantic‑analysis subsystem is **vertically sliced**: low‑level pattern definition (library) → high‑level semantic processing (four agents).  
* The library acts as the **root of the dependency tree** for pattern‑related functionality, with all agents as leaf nodes.

### Scalability Considerations
* Adding new agents that need textual pattern matching can **reuse the existing library** without duplication, supporting horizontal scaling of functionality.  
* If the primitive set grows substantially, the module may become a **performance bottleneck** during import; lazy‑loading or splitting the library into thematic sub‑modules could mitigate this.

### Maintainability Assessment
* **High maintainability** for pattern logic because there is a single location to edit and test.  
* **Moderate risk** due to tight coupling: careful versioning and deprecation policies are essential to avoid cascading breakages.  
* Clear documentation and comprehensive unit tests are crucial to keep the library reliable as the number of consuming agents expands.


## Hierarchy Context

### Parent
- [SemanticAnalyzer](./SemanticAnalyzer.md) -- src/agents/semantic-analyzer.ts is referenced by four distinct agents (OntologyClassificationAgent, CodeGraphAgent, ContentValidationAgent, SemanticAnalysisAgent), making it the single authoritative source for text pattern primitives across the semantic analysis subsystem

### Siblings
- [QuadAgentSharedDependencyPattern](./QuadAgentSharedDependencyPattern.md) -- OntologyClassificationAgent, CodeGraphAgent, ContentValidationAgent, and SemanticAnalysisAgent all import from `src/agents/semantic-analyzer.ts` per the parent component description, meaning this file sits at the intersection of four separate agent execution paths and any breaking API change propagates to all four simultaneously.


---

*Generated from 3 observations*
