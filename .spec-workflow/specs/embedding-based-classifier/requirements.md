# Requirements Document

## Introduction

The Live Session Logging (LSL) system currently uses a three-layer classification approach (PathAnalyzer → KeywordMatcher → SemanticAnalyzer) that needs enhancement to better distinguish between coding infrastructure work and general software development work. This enhancement adds an EmbeddingClassifier as a new Layer 3 in the ReliableCodingClassifier, creating a four-layer system using vector similarity and leveraging the proven mcp-constraint-monitor technology stack (Qdrant vector database + sentence-transformers embeddings).

The enhancement provides semantic understanding of content classification to accurately identify when conversations are about the coding infrastructure itself (vs. general software development), while extending the existing architecture to a four-layer system (PathAnalyzer → KeywordMatcher → EmbeddingClassifier → SemanticAnalyzer) and achieving <3ms classification time for real-time LSL processing.

## Alignment with Product Vision

This enhancement directly supports core product goals:

- **Real-Time Classification**: Enhances existing keyword approach with semantic vector similarity for improved content routing accuracy
- **Infrastructure Intelligence**: Repository indexing enables accurate identification of coding infrastructure-specific discussions
- **Pattern Recognition**: Vector embeddings capture semantic patterns that simple keyword matching cannot detect
- **Development Process Intelligence**: Accurate classification enables proper trajectory analysis and workflow optimization

Aligns with Phase 1 Foundation goals: "Real-time content classification and routing" and "Core live session logging and knowledge management."

## Requirements

### Requirement 1: Coding Repository Indexing System

**User Story:** As a developer using the LSL system, I want the coding infrastructure repository to be indexed with semantic embeddings, so that conversations about the coding infrastructure itself can be accurately identified and routed.

#### Acceptance Criteria

1. WHEN the system initializes THEN it SHALL automatically create vector embeddings for the coding repository's documentation, source code, and README files
2. WHEN significant changes occur in the coding repository THEN the system SHALL trigger reindexing within 30 seconds
3. WHEN indexing occurs THEN the system SHALL create a single Qdrant collection 'coding_infrastructure' containing all coding-related semantic patterns
4. WHEN generating embeddings THEN the system SHALL use sentence-transformers/all-MiniLM-L6-v2 with 384-dimensional vectors
5. WHEN processing the coding repository THEN the system SHALL complete initial indexing within 5 minutes

### Requirement 2: EmbeddingClassifier Implementation  

**User Story:** As a developer, I want the classification system to use vector similarity in addition to keyword matching, so that content is accurately routed based on semantic meaning when keyword matching is inconclusive.

#### Acceptance Criteria

1. WHEN classifying content THEN the EmbeddingClassifier SHALL be added as Layer 3 in the ReliableCodingClassifier four-layer system (PathAnalyzer → KeywordMatcher → EmbeddingClassifier → SemanticAnalyzer)
2. WHEN the KeywordMatcher returns inconclusive results THEN the EmbeddingClassifier SHALL generate embeddings for incoming content and compute cosine similarity against the coding infrastructure collection
3. WHEN classification completes THEN the system SHALL return results within 3ms using optimized Qdrant settings (HNSW indexing, int8 quantization)
4. WHEN confidence scoring THEN the system SHALL provide reasoning based on similarity scores: "Coding infrastructure similarity: X.XX"
5. WHEN integration occurs THEN the EmbeddingClassifier SHALL integrate seamlessly into the existing ReliableCodingClassifier architecture without breaking existing functionality

### Requirement 3: Significant Change Detection and Index Updates

**User Story:** As a developer working on evolving coding infrastructure, I want the vector index to update only when significant changes occur, so that classification accuracy is maintained without unnecessary processing overhead.

#### Acceptance Criteria

1. WHEN significant changes are detected THEN the system SHALL trigger reindexing based on documentation changes, new major features, or structural refactoring
2. WHEN changes occur THEN the system SHALL use a heuristic approach monitoring documentation files (*.md, README, CHANGELOG) as primary triggers since developers typically update docs after major changes
3. WHEN scientific detection is available THEN the system SHALL optionally use semantic diff analysis to measure content drift above threshold (e.g., >20% semantic change in key documentation)
4. WHEN automatic detection is complex THEN the system SHALL provide a manual reindex script (scripts/reindex-coding-infrastructure.js) for user-triggered updates
5. WHEN reindexing occurs THEN the system SHALL update the entire coding infrastructure collection to ensure consistency

### Requirement 4: Performance and Reliability

**User Story:** As a developer using real-time LSL monitoring, I want classification to be lightning fast and reliable, so that it doesn't impact my development workflow or introduce processing delays.

#### Acceptance Criteria

1. WHEN performing classification THEN the system SHALL complete embedding generation and similarity search within 3ms
2. WHEN using Qdrant database THEN the system SHALL leverage optimized settings: HNSW indexing (m=16, ef_construct=100), int8 quantization for 4x speed
3. WHEN embeddings are cached THEN the system SHALL reuse embeddings for identical content to avoid regeneration
4. WHEN vector operations fail THEN the system SHALL gracefully fall back to the SemanticAnalyzer layer without blocking classification
5. WHEN memory usage occurs THEN the system SHALL maintain reasonable memory footprint even with large repository indexes

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: RepositoryIndexer handles indexing, EmbeddingClassifier handles classification, ChangeDetector handles updates
- **Modular Design**: Embedding functionality isolated in reusable components that can be leveraged by other systems
- **Dependency Management**: Minimize dependencies by reusing existing mcp-constraint-monitor components (Qdrant client, embedding generation)
- **Clear Interfaces**: EmbeddingClassifier provides consistent interface pattern for seamless integration into existing classification pipeline

### Performance
- **Layer 3 Classification Speed**: <3ms for EmbeddingClassifier processing (within <30ms total four-layer pipeline)
- **Index Updates**: <30 seconds for incremental index updates after file changes
- **Memory Efficiency**: Reasonable memory usage even with large repository indexes (target: <500MB for typical projects)
- **Startup Time**: <5 seconds for EmbeddingClassifier initialization including Qdrant connection

### Security
- **No Sensitive Data**: Never index or embed sensitive information (credentials, tokens, personal data)
- **Local Operation**: All vector operations performed locally, no external API calls for embeddings
- **Access Control**: Repository indexes isolated per project with no cross-project data leakage

### Reliability
- **Graceful Degradation**: Fall back to SemanticAnalyzer if embedding classification fails
- **Error Recovery**: Automatic retry with exponential backoff for transient Qdrant connection failures  
- **Index Consistency**: Atomic updates to prevent corrupted indexes, with automatic repair mechanisms
- **Backward Compatibility**: Seamless integration with existing ReliableCodingClassifier architecture

### Usability
- **Transparent Operation**: Classification decisions include clear reasoning based on similarity scores
- **Debugging Support**: Comprehensive logging of embedding generation, similarity scores, and classification decisions
- **Setup Automation**: Automatic repository detection and index creation without manual configuration
- **Progress Feedback**: Clear progress reporting during initial repository indexing operations