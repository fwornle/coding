# DynamicImportFallback

**Type:** Detail

Because the import can fail silently (from the caller's perspective), any caller that omits the fallback will experience a null-reference or unresolved-promise failure rather than a clear error message, making the fallback contract a critical correctness requirement documented at the L2 boundary.

# DynamicImportFallback

## What It Is

DynamicImportFallback is the runtime import pattern used when loading VkbApiClient from `lib/ukb-unified/core/VkbApiClient.js`. Rather than a static import, VkbApiClient is loaded via dynamic `import()`, making module resolution a runtime operation. When the import or subsequent connection fails (e.g., server not running), callers fall back to direct LevelDB access. This fallback is a **first-class operational mode**, not an error path.

## Architecture and Design

The core design decision is that VkbApiClient is an HTTP proxy over the same LevelDB data store that the fallback accesses directly. Both paths are semantically equivalent for reads. This means the system treats the API server as an optional layer—useful when running, but not required for correctness.

This pattern makes the fallback contract a correctness requirement at the boundary between callers and VkbApiClient, not merely a resilience feature. Any caller that omits fallback handling will encounter null-reference or unresolved-promise failures silently, rather than clear errors.

The sibling EntityCrudEndpoints defines the API surface VkbApiClient consumes, covering entity types (nodes, edges, typed entities). The fallback path must replicate equivalent read semantics without those endpoints.

## Implementation Details

The dynamic import is wrapped in try/catch (or promise rejection handling). On failure, the caller switches to direct LevelDB access. Because failure is tied to a runtime condition (server availability) rather than misconfiguration, both code paths must be fully implemented and tested.

## Integration Points

- **VkbApiClient** (parent): the module being dynamically imported
- **LevelDB**: the direct-access fallback target, also the backing store behind VkbApiClient
- **EntityCrudEndpoints**: defines the HTTP surface that VkbApiClient proxies; the fallback path bypasses this entirely

## Usage Guidelines

Every caller that dynamically imports VkbApiClient **must** implement the fallback to direct LevelDB access. Omitting it is a correctness bug. Both paths should be treated as equally valid operational modes and tested accordingly. Read operations must produce identical results regardless of path.


## Hierarchy Context

### Parent
- [VkbApiClient](./VkbApiClient.md) -- VkbApiClient is located at lib/ukb-unified/core/VkbApiClient.js and is dynamically imported at runtime, so callers must handle the case where the import fails (server not running) and fall back to direct LevelDB access

### Siblings
- [EntityCrudEndpoints](./EntityCrudEndpoints.md) -- VkbApiClient (lib/ukb-unified/core/VkbApiClient.js) serves the KnowledgeManagement component, so its endpoint surface must cover at minimum the entity types tracked by the knowledge graph (nodes, edges, typed entities) with distinct routes per operation.


---

*Generated from 4 observations*
