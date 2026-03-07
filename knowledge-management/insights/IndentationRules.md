# IndentationRules

**Type:** Detail

The indentation rules are defined in the code-formatter.py file, which contains the settings for indentation, such as the number of spaces per level.

## What It Is  

`IndentationRules` are realized inside the **`CodeFormatter`** class that lives in **`code-formatter.py`**.  The file contains the concrete settings that drive how many spaces constitute a single indentation level and the logic that enforces those settings across the codebase.  Whenever the formatter parses a source file, it consults the rules defined in this module to verify that each line’s leading whitespace matches the expected depth, and it rewrites the line when a mismatch is detected.  Because `IndentationRules` are part of the broader **`CodingConventions`** component, they sit alongside sibling rule‑sets such as **`NamingConventions`**, all of which are coordinated by the same `CodeFormatter` implementation.

## Architecture and Design  

The observable architecture follows a **single‑responsibility, rule‑engine** style.  `CodeFormatter` acts as the sole orchestrator for formatting concerns, delegating the actual rule evaluation to internally defined configurations – in this case the indentation settings.  The design mirrors a **configuration‑driven** approach: the number of spaces per level is stored as a configurable constant (or simple data attribute) inside `code-formatter.py`, allowing the parsing algorithm to remain generic while the concrete rule values are supplied at runtime.  Interaction between components is straightforward; the formatter’s parsing routine reads the source text, computes the expected indentation depth based on the current nesting (e.g., block statements, function definitions), and then applies the `IndentationRules` to each line.  This tight coupling between the parser and the rule set eliminates the need for external services or message passing, reflecting a **monolithic** internal design rather than a distributed micro‑service pattern.

## Implementation Details  

The core of the implementation is the **`CodeFormatter`** class.  Within `code-formatter.py` the class declares an indentation constant—typically something like `INDENT_SPACES = 4`—which represents the number of spaces that define one logical level.  The parsing algorithm, also housed in the same class, walks the abstract syntax tree (or a line‑by‑line token stream) to determine the current nesting depth.  For each line it computes `expected_indent = current_depth * INDENT_SPACES` and compares this value to the actual leading whitespace count.  When a discrepancy is found, the formatter either reports a violation or rewrites the line with the correct number of spaces, thereby guaranteeing a uniform indentation style throughout the project.  Because the rule definition lives in the same file as the parser, there is no indirection; the formatter directly accesses the rule values, which simplifies the control flow and reduces latency.

## Integration Points  

`IndentationRules` are integrated through the **`CodingConventions`** parent component.  The parent aggregates the various rule‑sets—`IndentationRules`, `NamingConventions`, and any future conventions—exposing a unified interface to the rest of the system (e.g., IDE plugins, CI linting stages).  The only explicit dependency observed is the `CodeFormatter` class itself; other components invoke its public methods such as `format_file(path)` or `check_indentation(source)`.  Because the rules are hard‑coded in `code-formatter.py`, there are no external configuration files or service endpoints to manage, making the integration surface minimal: callers simply import `CodeFormatter` and rely on its internal rule definitions.

## Usage Guidelines  

Developers should treat the `CodeFormatter` as the authoritative source for indentation policy.  When adding new files or refactoring existing ones, run the formatter (or its checking variant) to validate that each block conforms to the `INDENT_SPACES` setting defined in `code-formatter.py`.  If a project requires a different indentation width, the single point of change is the constant in `code-formatter.py`; updating it automatically propagates the new rule to all parsing passes, ensuring consistency without touching the parsing logic itself.  Because the formatter also enforces naming conventions, developers may run it as a combined linting step to address both indentation and naming in one pass, leveraging the sibling relationship between `IndentationRules` and `NamingConventions`.

---

### Architectural Patterns Identified  
- **Configuration‑driven rule engine**: indentation depth is expressed as a configurable constant that the parsing algorithm consumes.  
- **Single‑responsibility component**: `CodeFormatter` encapsulates all formatting concerns, keeping rule evaluation and application together.  

### Design Decisions and Trade‑offs  
- **In‑file rule definition** eliminates the need for external configuration files, simplifying deployment but reducing flexibility for per‑project overrides.  
- **Tight coupling of parser and rules** yields high performance and low latency at the cost of reduced modularity; extracting rules into separate modules would improve reusability but add indirection.  

### System Structure Insights  
- `IndentationRules` reside under the **`CodingConventions`** hierarchy, sharing the same implementation file with sibling rule‑sets, indicating a cohesive but monolithic design for code style enforcement.  

### Scalability Considerations  
- Because the rule set is static and the parser operates in‑process, the formatter scales linearly with file size; there are no network or I/O bottlenecks.  However, introducing a large number of additional rule‑sets could increase the parsing workload, suggesting a future refactor toward a plug‑in architecture if the rule base grows substantially.  

### Maintainability Assessment  
- Maintaining indentation standards is straightforward: a single constant change updates the entire system.  The co‑location of parsing logic and rule definition aids readability but can become a maintenance hotspot if the file expands to host many unrelated conventions.  Periodic extraction of each convention into its own class (while preserving the `CodeFormatter` façade) would improve separation of concerns without disrupting the existing rule‑engine flow.


## Hierarchy Context

### Parent
- [CodingConventions](./CodingConventions.md) -- The CodeFormatter class in code-formatter.py enforces consistent coding conventions, such as indentation and naming conventions.

### Siblings
- [CodeFormatter](./CodeFormatter.md) -- The CodeFormatter class in code-formatter.py defines the formatting rules, including indentation and naming conventions, which are applied to the codebase.
- [NamingConventions](./NamingConventions.md) -- The CodeFormatter class in code-formatter.py checks for naming conventions, such as camelCase or PascalCase, and corrects them if necessary.


---

*Generated from 3 observations*
