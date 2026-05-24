# EntityCrudEndpoints

**Type:** Detail

The 'typed graph entities' framing (from the parent component analysis) implies endpoints are parameterized by entity type, not just by ID, meaning route structure likely encodes type information (e.g., /entity/:type/:id) rather than using a single generic resource path.

## What It Is

EntityCrudEndpoints represents the HTTP endpoint surface within VkbApiClient (`lib/ukb-unified/core/VkbApiClient.js`) that provides create, read, update, and delete operations for typed graph entities (nodes, edges, and other knowledge graph entity types).

## Architecture and Design

The endpoints are isomorphic with LevelDB's key-value storage layout. This is a deliberate constraint: since DynamicImportFallback enables direct LevelDB access when the API server is unavailable, the HTTP routes must mirror the same storage semantics to ensure behavioral equivalence across both paths.

Routes are parameterized by entity type (e.g., `/entity/:type/:id`), not a single generic resource path. This reflects the typed graph entity model of the parent KnowledgeManagement component and allows type-specific validation or behavior at the endpoint level.

## Implementation Details

No code symbols were directly observed. Based on the architectural constraints: endpoints map key-value operations (get, put, delete, batch) over HTTP verbs (GET, POST/PUT, DELETE) with type and ID encoded in the route path. The schema must remain a thin translation layer over LevelDB semantics to maintain fallback compatibility.

## Integration Points

- **Parent:** VkbApiClient consumes these endpoints as its primary API surface
- **Sibling:** DynamicImportFallback means these endpoints have a direct LevelDB equivalent — any endpoint change must be mirrored in the fallback path to maintain parity
- **Storage:** LevelDB key-value layout is the canonical schema; endpoints conform to it, not the reverse

## Usage Guidelines

When modifying or extending endpoints, preserve isomorphism with the LevelDB storage layout. Adding an endpoint that has no LevelDB fallback equivalent breaks the dynamic import fallback contract. Route parameters should always include entity type to maintain consistency with the typed graph model.


## Hierarchy Context

### Parent
- [VkbApiClient](./VkbApiClient.md) -- VkbApiClient is located at lib/ukb-unified/core/VkbApiClient.js and is dynamically imported at runtime, so callers must handle the case where the import fails (server not running) and fall back to direct LevelDB access

### Siblings
- [DynamicImportFallback](./DynamicImportFallback.md) -- VkbApiClient at lib/ukb-unified/core/VkbApiClient.js is loaded via dynamic import (not static require/import), which means the module resolution can fail at call time rather than at application startup — callers must wrap the import in try/catch or equivalent promise rejection handling.


---

*Generated from 3 observations*
