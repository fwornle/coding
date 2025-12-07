# UkbCli

**Type:** TransferablePattern

The current architecture uses a graph database (Graphology + LevelDB) stored at .data/knowledge-graph, with auto-synced JSON exports at .data/knowledge-export. The system interacts with external servi...

## What It Is

- The current architecture uses a graph database (Graphology + LevelDB) stored at .data/knowledge-graph, with auto-synced JSON exports at .data/knowledge-export. The system interacts with external services through API clients (VkbApiClient) and MCP tools.

- The GraphDatabaseService, GraphKnowledgeExporter, and PersistenceAgent components work together to manage knowledge storage and exports. The vkb command is used for visualization, while MCP tools are used for knowledge operations.


## Diagrams

### Architecture

![UkbCli Architecture](images/ukb-cli-architecture.png)


### Sequence

![UkbCli Sequence](images/ukb-cli-sequence.png)


### Class

![UkbCli Class](images/ukb-cli-class.png)


### Use cases

![UkbCli Use cases](images/ukb-cli-use-cases.png)


---

*Generated from 2 observations*
