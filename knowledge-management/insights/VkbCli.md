# VkbCli

**Type:** TransferablePattern

The GraphDatabaseService and PersistenceAgent components interact with the graph database, while the VkbApiClient manages client interactions with the knowledge graph, and the GraphKnowledgeExporter i...

## What It Is

- The current architecture uses a graph database (Graphology + LevelDB) for knowledge storage, with a separate directory (.data/knowledge-export) for JSON exports, and relies on commands (vkb, coding, graph-sync) for data manipulation and synchronization.

- The GraphDatabaseService and PersistenceAgent components interact with the graph database, while the VkbApiClient manages client interactions with the knowledge graph, and the GraphKnowledgeExporter is responsible for exporting data to the .data/knowledge-export directory.


## Diagrams

### Architecture

![VkbCli Architecture](images/vkb-cli-architecture.png)


### Sequence

![VkbCli Sequence](images/vkb-cli-sequence.png)


### Class

![VkbCli Class](images/vkb-cli-class.png)


### Use cases

![VkbCli Use cases](images/vkb-cli-use-cases.png)


---

*Generated from 2 observations*
