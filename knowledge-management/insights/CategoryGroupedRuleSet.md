# CategoryGroupedRuleSet

**Type:** Detail

The RedactionSubsystem's core design decision, as described in the SubComponent context, is that .specstory/config/redaction-config.yaml partitions rules into named category blocks — this means the data model the RedactionRuleLoader parses is a map of category-name → [pattern list], not a flat list of patterns.

# CategoryGroupedRuleSet

## What It Is

CategoryGroupedRuleSet is the in-memory data model produced by parsing `.specstory/config/redaction-config.yaml`, the configuration file that defines the redaction patterns used by the RedactionSubsystem. Rather than representing redaction rules as a flat list of regular expressions or matchers, this entity organizes them as a map of category-name → [pattern list], where each named category block in the YAML source becomes a first-class grouping in the parsed structure. The parsing itself is performed by the RedactionRuleLoader, which reads the YAML file and produces this structured representation for downstream consumption.

The key design property that makes CategoryGroupedRuleSet distinct from a simple namespaced rule collection is that each category carries its own enabled flag. This means category identity is not merely a labeling or organizational convenience — it is a runtime control surface that operators use to toggle entire groups of patterns on or off without touching pattern definitions. CategoryGroupedRuleSet therefore sits as a Detail within its parent RedactionSubsystem, alongside its sibling RedactionEngine, encoding the structural contract between the YAML configuration and the engine that consumes it.

## Architecture and Design

The architectural approach evident in CategoryGroupedRuleSet is a **grouped configuration model** layered with **per-group activation state**. By choosing a `Map<CategoryName, RuleList>` shape over a flat list, the RedactionSubsystem makes category boundaries semantically meaningful: a category represents a coherent class of sensitive data (and the patterns that match it), and the enabled flag attached to each category becomes the natural toggle granularity for operators. This is a deliberate trade-off — flat lists would be simpler to iterate but would force operators to comment out or delete individual patterns to disable a logical grouping.

The design also implies a **filtered-view handoff pattern** between the loader and the engine. When the RedactionEngine receives its rule set at startup (or on reload), it does not see disabled categories at all; the CategoryGroupedRuleSet implementation is responsible for projecting only active categories downstream. This decouples the engine's hot-path matching logic from the configuration's activation state — the engine never has to consult an enabled flag during serialization because filtering has already happened. The result is a clean separation between configuration semantics (handled at load time inside CategoryGroupedRuleSet) and pattern application semantics (handled at runtime inside RedactionEngine).

Within the parent RedactionSubsystem, this design pairs naturally with its sibling RedactionEngine, which is invoked by LSLConverter during serialization. Because redaction is a transformation step inside the log pipeline rather than a post-processing filter, the rule set's structural integrity matters: a malformed or stale CategoryGroupedRuleSet would directly affect serialized output. The grouped model ensures that operational changes (enabling or disabling a category) are atomic at the category level and never leave the engine in a partially-configured state.

## Implementation Details

The concrete shape of CategoryGroupedRuleSet is dictated by the YAML schema in `.specstory/config/redaction-config.yaml`. Each top-level entry in that file is a named category block containing both a list of patterns and an enabled flag. The RedactionRuleLoader parses this structure and constructs the in-memory representation, preserving the category-name → [pattern list] mapping rather than flattening it. Because no code symbols were extracted into this entity's surface area, the precise class or type names are not exposed in the observations, but the data contract is unambiguous: categories are addressable by name, carry an enabled boolean, and own a list of patterns.

The enabled flag's semantics drive a specific implementation requirement: the data model must support filtering by activation state. Whether this is implemented as eager filtering (the loader returns only active categories) or lazy filtering (the engine <USER_ID_REDACTED> an `isEnabled()` accessor) is a detail, but the observations indicate the engine "receives a filtered view of only active categories" — suggesting the eager-filtering approach where CategoryGroupedRuleSet exposes a method to produce the active subset before handing rules to the RedactionEngine.

Hot-reload behavior is another implementation consequence of this model. To disable a category at runtime, an operator edits `redaction-config.yaml` and toggles a flag rather than modifying pattern definitions. This means the RedactionRuleLoader must re-parse on configuration change events and rebuild a fresh CategoryGroupedRuleSet, which the RedactionEngine then consumes in place of its previous filtered view. The pattern code itself is never touched during this operation.

## Integration Points

CategoryGroupedRuleSet is integrated upstream with the YAML source file `.specstory/config/redaction-config.yaml` and the RedactionRuleLoader that parses it. The loader is the sole producer of CategoryGroupedRuleSet instances; the structure of the YAML directly determines the structure of the resulting object, so any schema evolution (e.g., adding fields to categories) requires coordinated changes in both the YAML format and the loader's parsing logic.

Downstream, CategoryGroupedRuleSet feeds the RedactionEngine — its sibling component in the RedactionSubsystem. The engine consumes the filtered view of active categories and uses the resulting patterns during its redaction passes. Because the engine is itself invoked by LSLConverter during serialization, CategoryGroupedRuleSet sits at the start of a chain: YAML config → RedactionRuleLoader → CategoryGroupedRuleSet → RedactionEngine → LSLConverter output. A failure or misconfiguration at the CategoryGroupedRuleSet layer propagates through this entire pipeline, which is why category-level toggling (rather than per-pattern editing) is the preferred operational lever.

The integration boundary with the parent RedactionSubsystem is conceptual: CategoryGroupedRuleSet defines the parent's data contract for "how rules are organized," while RedactionEngine defines the parent's behavioral contract for "how rules are applied." Together they constitute the complete subsystem.

## Usage Guidelines

Developers working with CategoryGroupedRuleSet should treat the category boundary as the unit of operational control. When adding new redaction patterns, place them inside an appropriate existing category in `.specstory/config/redaction-config.yaml` if one fits, or create a new named category if the patterns represent a distinct class of sensitive data that operators might want to toggle independently. Avoid creating catch-all categories like "misc" — doing so undermines the design intent of category-level enable/disable control.

Operators disabling redaction patterns should always do so by flipping a category's enabled flag rather than deleting or commenting out individual patterns. This preserves the pattern definitions for future re-enabling and keeps configuration changes auditable as state transitions rather than content deletions. Conversely, developers should never inline an `enabled: false` check inside individual pattern logic — the activation control belongs at the category level, where CategoryGroupedRuleSet enforces it before the RedactionEngine ever sees the rules.

When modifying the RedactionRuleLoader or any code that consumes CategoryGroupedRuleSet, preserve the invariant that the RedactionEngine receives only active categories. Introducing code paths where the engine sees disabled categories (even if it ignores them) would erode the clean separation between configuration semantics and runtime matching, and would risk subtle bugs where a disabled pattern accidentally gets applied during serialization in the LSLConverter pipeline.

Finally, because the YAML schema and the parsed structure are tightly coupled, any change to the category model — for example, adding priority ordering between categories, or supporting nested subcategories — must be designed as a coordinated change across `redaction-config.yaml`, the RedactionRuleLoader, CategoryGroupedRuleSet itself, and the RedactionEngine's consumption logic.

---

### Summary of Requested Analysis

1. **Architectural patterns identified**: Grouped configuration model with per-group activation flags; filtered-view handoff between loader and consumer; configuration-driven runtime behavior toggling.

2. **Design decisions and trade-offs**: Choosing a map-of-categories over a flat rule list trades parsing simplicity for operational granularity — category-level enable/disable becomes possible without per-pattern editing. Eager filtering at load time trades a small amount of memory churn (rebuilding views on reload) for a cleaner engine hot path.

3. **System structure insights**: CategoryGroupedRuleSet defines the data contract for the RedactionSubsystem, while its sibling RedactionEngine defines the behavioral contract; together they form a pipeline that feeds into LSLConverter serialization, ensuring sensitive data is redacted in-transformation rather than post-hoc.

4. **Scalability considerations**: The category-grouped structure scales naturally with the number of sensitive-data classes rather than the total number of patterns; adding patterns within an existing category has zero structural cost, while adding a new category is a localized change. Reload performance depends on the RedactionRuleLoader rebuilding the full CategoryGroupedRuleSet, which is acceptable given that reloads are infrequent operator-driven events.

5. **Maintainability assessment**: High. The separation between configuration grouping (CategoryGroupedRuleSet) and pattern application (RedactionEngine) keeps responsibilities crisp. Operators can change behavior without touching code, and developers can add patterns without coordinating with operations. The primary maintenance risk is schema drift between `redaction-config.yaml` and the RedactionRuleLoader's parsing assumptions, which should be guarded by validation at load time.


## Hierarchy Context

### Parent
- [RedactionSubsystem](./RedactionSubsystem.md) -- .specstory/config/redaction-config.yaml organizes redaction rules by named categories, allowing operators to enable or disable entire rule groups without modifying individual patterns

### Siblings
- [RedactionEngine](./RedactionEngine.md) -- Per the parent component analysis, RedactionEngine is invoked by LSLConverter during serialization — meaning redaction is applied as a transformation step inside the log pipeline, not as a post-processing filter, ensuring sensitive data never reaches the serialized output layer.


---

*Generated from 3 observations*
