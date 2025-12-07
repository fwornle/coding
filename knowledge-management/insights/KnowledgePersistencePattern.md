# KnowledgePersistencePattern

**Type:** GraphDatabase

The system uses the graph-sync command to synchronize data between the graph database and JSON exports as part of its data workflow.

## What It Is

- The system provides a command-line interface using the vkb command for visualization and MCP tools for knowledge operations.

- The system stores knowledge exports at .data/knowledge-export, which are auto-synced from the graph database.

- The system auto-syncs JSON exports from the GraphDB to .data/knowledge-export.

- The system uses a microservices architecture with separate components for different services.


## Diagrams

### Architecture

![KnowledgePersistencePattern Architecture](images/knowledge-persistence-pattern-architecture.png)


### Sequence

![KnowledgePersistencePattern Sequence](images/knowledge-persistence-pattern-sequence.png)


### Use cases

![KnowledgePersistencePattern Use cases](images/knowledge-persistence-pattern-use-cases.png)


---

*Generated from 13 observations*
