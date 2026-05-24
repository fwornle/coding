# SharedPlantUmlStylePalette

**Type:** Detail

`docs/puml/_standard-style.puml` is explicitly described in the parent sub-component as the single source of shared color palette, font, and stereotype definitions, meaning all other `.puml` files depend on it via an `!include` or `!import` directive rather than duplicating style rules.

## What It Is  

`SharedPlantUmlStylePalette` lives in the file **`docs/puml/_standard-style.puml`**.  The leading underscore follows the PlantUML convention for *partial* files – it is never rendered as a diagram on its own but is meant to be imported by other diagram sources.  The file contains the **canonical colour palette, font settings, and stereotype definitions** that are used throughout the entire documentation set.  Every subsystem diagram under the **`DiagramFirstDocumentation`** umbrella includes this file via an `!include` (or `!import`) directive, thereby inheriting a single source of visual truth.  Authors can therefore write a diagram such as `docs/puml/subsystem-a.puml` that begins with:

```plantuml
!include _standard-style.puml
```

and instantly gain access to the pre‑defined styles and stereotypes like `<<service>>` or `<<database>>`.  Because the palette is centralised, a global visual change—say, switching the primary brand colour or adjusting the default font size—requires a single edit in `_standard‑style.puml`; the change propagates automatically to every diagram that imports it.

---

## Architecture and Design  

The architecture adopts a **centralised style‑library pattern**.  Rather than scattering colour codes, font families, or stereotype visual rules across dozens of diagram files, the system isolates them in one reusable fragment.  This mirrors the *DRY* (Don’t Repeat Yourself) principle and provides a **single point of maintenance** for visual consistency.  

The design leverages PlantUML’s native **include mechanism** as a lightweight modularisation technique.  Each diagram acts as a consumer that **composes** its visual definition by pulling in the shared palette.  The underscore‑prefixed filename (`_standard-style.puml`) is a naming convention that signals its role as infrastructure rather than a deliverable artifact; this convention is part of the **naming‑based contract** between the palette and its consumers.  

Stereotype definitions inside the palette serve as a **semantic styling layer**.  By mapping domain concepts (`<<service>>`, `<<database>>`, etc.) to visual attributes, the system enforces a **semantic‑visual contract**: any diagram that annotates an element with a known stereotype automatically receives the prescribed colour, shape, or font style.  This eliminates ad‑hoc styling decisions and guarantees that the same concept looks identical across all subsystem diagrams.

The overall interaction can be visualised as a simple dependency graph:

```
+------------------------+
| docs/puml/_standard-   |
| style.puml   (palette) |
+----------+-------------+
           |
           |  !include / !import
           v
+------------------------+   +------------------------+   …
| docs/puml/subsystem‑A  |   | docs/puml/subsystem‑B  |
| .puml (diagram)        |   | .puml (diagram)        |
+------------------------+   +------------------------+
```

All diagrams are **leaf nodes** that depend on the shared palette; there are no circular dependencies because the palette contains no `!include` statements of its own.

---

## Implementation Details  

The implementation is entirely declarative within PlantUML.  `_standard-style.puml` defines three main categories:

1. **Colour palette** – a series of `!define` statements that bind symbolic names (e.g., `!define PrimaryColor #1A73E8`) to hex colour codes.  Diagram authors reference these symbols instead of raw hex values, ensuring that colour changes are isolated to the palette file.

2. **Font configuration** – global directives such as `skinparam defaultFontName "Roboto"` and size specifications (`skinparam defaultFontSize 12`).  Because PlantUML applies `skinparam` values globally, every diagram that imports the file inherits the same typography.

3. **Stereotype visual rules** – a block of `skinparam stereotype` statements that map each stereotype to a style, for example:

   ```plantuml
   skinparam stereotype {
     Service {
       BackgroundColor PrimaryColor
       FontColor White
       BorderColor DarkGray
     }
     Database {
       BackgroundColor #F5F5F5
       FontColor #333333
       BorderColor #CCCCCC
     }
   }
   ```

   With these definitions in place, any element annotated as `<<Service>>` automatically renders with the `Service` visual block.

Because the file contains **no executable PlantUML code** (no `@startuml` / `@enduml` block), it cannot be rendered on its own.  This intentional omission reinforces its role as a shared resource rather than a standalone diagram.

---

## Integration Points  

`SharedPlantUmlStylePalette` is tightly coupled to **all PlantUML diagram sources** within the `DiagramFirstDocumentation` component.  Its sole integration contract is the **`!include`/`!import` directive**, which is a compile‑time inclusion mechanism—PlantUML resolves the file path at diagram generation time.  Consequently, the palette does not expose a runtime API; the integration surface is purely file‑system based.

The parent component, **`DiagramFirstDocumentation`**, aggregates the palette and the consumer diagrams.  No sibling entities are observed to share the palette directly, but any future diagram placed under the same `docs/puml/` hierarchy can adopt the palette simply by adding the include line.  Because the palette resides at the top level of the `puml` directory, relative includes are straightforward (`!include _standard-style.puml`), eliminating path‑resolution complexity.

There are **no external library dependencies** beyond PlantUML itself.  The palette does not import other files, which keeps the dependency graph shallow and reduces the risk of cascading failures when a change is made.

---

## Usage Guidelines  

1. **Always import the palette first** – Every diagram file should start with `!include _standard-style.puml` before any other PlantUML statements.  This guarantees that colour and stereotype definitions are available to subsequent elements.

2. **Reference palette symbols, not raw values** – When a custom colour is needed (e.g., for a highlight), use the symbolic names defined in `_standard-style.puml` (`PrimaryColor`, `SecondaryColor`, etc.).  Direct hex literals should be avoided to preserve the single‑source‑of‑truth model.

3. **Apply stereotypes for semantic styling** – Prefer annotating elements with the provided stereotypes (`<<service>>`, `<<database>>`, etc.) instead of manually setting colours or shapes.  This ensures that any future visual refresh of a stereotype automatically updates all diagrams that use it.

4. **Do not render `_standard-style.puml` directly** – Because the file lacks a diagram boundary (`@startuml` / `@enduml`), attempting to render it will produce an empty output.  Treat it as a library file; only consumer diagrams should be rendered.

5. **When updating visual branding, edit only this file** – Changing a colour, font, or stereotype style should be performed in `_standard-style.puml`.  After the edit, regenerate the diagrams; the changes will be reflected everywhere without further modifications.

6. **Keep the file minimal and focused** – Add new colour or stereotype definitions only when a genuine new visual concept is required.  Over‑populating the palette can dilute its purpose and make maintenance harder.

---

### Architectural Patterns Identified  

* **Centralised Shared Resource (Style Library)** – A single file provides reusable visual definitions for all consumers.  
* **File‑Based Modularisation** – PlantUML’s `!include` serves as a lightweight composition mechanism, analogous to a module import.  
* **Naming‑Convention Contract** – The underscore prefix signals “partial” status, guiding maintainers on intended usage.

### Design Decisions and Trade‑offs  

* **Decision:** Store all visual constants in a single PlantUML file.  
  *Trade‑off:* Simplifies global updates but creates a single point of failure; a syntax error in the palette breaks every diagram.  
* **Decision:** Use stereotypes for semantic styling.  
  *Trade‑off:* Guarantees visual consistency but requires diagram authors to learn and apply the correct stereotype names.  

### System Structure Insights  

The `DiagramFirstDocumentation` component is organised around a **hierarchical file layout** where the root `puml` directory contains the shared palette and a flat or nested set of subsystem diagram files.  The palette sits at the top of the hierarchy, and every leaf diagram pulls from it, forming a clear **one‑to‑many dependency** relationship.

### Scalability Considerations  

Because the palette is a plain text file, its size remains negligible even as the number of stereotypes grows.  The include mechanism scales linearly: adding new diagrams does not increase the load on the palette beyond a single file read per diagram generation.  The only scalability limit would be the readability of the palette itself; if it becomes excessively large, maintainers might consider splitting it into logically grouped fragments (e.g., `_colors.puml`, `_stereotypes.puml`) while preserving the same inclusion pattern.

### Maintainability Assessment  

The current design scores highly on maintainability:

* **Single source of truth** eliminates duplicated style definitions.  
* **Explicit naming convention** (`_standard-style.puml`) makes the file’s purpose obvious to new contributors.  
* **Declarative style definitions** are easy to audit; any visual change is a straightforward edit.  

Potential maintenance risks are limited to syntax errors in the shared file and the need for developers to stay aligned with the defined stereotypes.  Regular linting of PlantUML files and a short style‑guide document can mitigate these risks.


## Hierarchy Context

### Parent
- [DiagramFirstDocumentation](./DiagramFirstDocumentation.md) -- docs/puml/_standard-style.puml provides shared color palette, font, and stereotype definitions imported by all other diagrams, ensuring visual consistency across subsystem diagrams


---

*Generated from 4 observations*
