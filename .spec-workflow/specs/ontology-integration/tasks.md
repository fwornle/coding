# Tasks Document

<!-- AI Instructions: For each task, generate a _Prompt field with structured AI guidance following this format:
_Prompt: Role: [specialized developer role] | Task: [clear task description with context references] | Restrictions: [what not to do, constraints] | Success: [specific completion criteria]_
This helps provide better AI agent guidance beyond simple "work on this task" prompts. -->

## Phase 1: Ontology Infrastructure (Week 1)

- [x] 1. Setup project structure and TypeScript types
  - Files: `src/ontology/types.ts`, `.data/ontologies/` directory structure
  - Create ontology directory structure: `.data/ontologies/upper/`, `.data/ontologies/lower/`, `.data/ontologies/schemas/`, `src/ontology/`, `src/ontology/heuristics/`
  - Define all TypeScript interfaces: `Ontology`, `EntityDefinition`, `PropertyDefinition`, `RelationshipDefinition`, `OntologyMetadata`, `ValidationError`, `OntologyClassification`, `ValidationOptions`, `ValidationResult`, `ClassificationOptions`, `QueryOptions`, `OntologyQuery`
  - Create JSON Schema for ontology structure validation
  - Purpose: Establish foundation for ontology system with proper type safety
  - _Leverage: Design document sections 3.1-3.2 for interface definitions_
  - _Requirements: REQ-1.1 (Configurable Ontologies), REQ-1.2 (JSON Format)_
  - _Prompt: Role: TypeScript Architect specializing in type-safe system design | Task: Create comprehensive TypeScript type definitions following design sections 3.1-3.2 that (1) define Ontology interface with name, version, type, entities, relationships, metadata fields, (2) define EntityDefinition with description, extendsEntity, properties, requiredProperties, examples, (3) define PropertyDefinition supporting string/number/boolean/object/array/reference types with validation rules, (4) create directory structure for upper/lower ontologies and schemas, (5) implement JSON Schema for ontology file validation, ensuring all types are properly exported and documented | Restrictions: Must compile with TypeScript strict mode; must not allow invalid ontology structures; must support both upper and lower ontology types; all interfaces must have comprehensive JSDoc comments | Success: All interfaces compile without errors, JSON Schema validates correct ontologies and rejects malformed ones, directory structure created, types properly exported_
  - **Status**: ✅ Completed

- [x] 2. Create upper ontology for Cluster Reprocessing domain
  - File: `.data/ontologies/upper/cluster-reprocessing-ontology.json`
  - Define 25 entity classes: RecordedData, MF4Container, MCAPContainer, ProtobufSPP, KaitaiBinaryBlob, RecordingMetadata, VirtualTarget, RPU, CompoundReprocessing, ReprocessingDAG, KPIFramework, KPIDefinition, ValidationResult, SOTIFScenario, FunctionOrchestrator, FunctionComponent, DataFlowConnection, ResourceAllocation, ExecutionMetrics, StorageBackend, CacheStrategy, CostMetric, OptimizationRule, IntervalSet, TimestampRange
  - Add comprehensive property definitions with types, descriptions, and examples for each entity
  - Define relationships between entities (e.g., RPU references VirtualTarget, CompoundReprocessing contains RPU array)
  - Validate against JSON Schema to ensure structural correctness
  - Purpose: Create domain-level ontology covering entire vehicle data reprocessing ecosystem
  - _Leverage: Requirements document Appendix A.1 for entity definitions_
  - _Requirements: REQ-2.1 (Upper Ontology), REQ-2.3 (Entity Classes)_
  - _Prompt: Role: Domain Expert in vehicle data reprocessing and ADAS systems | Task: Create comprehensive upper ontology following requirements Appendix A.1 that (1) defines 25 entity classes covering recorded data, reprocessing units, virtual targets, KPI frameworks, and infrastructure, (2) includes detailed property definitions with proper types (enum for containerFormat, reference for virtualTarget, object for resourceRequirements), (3) adds 2-3 examples per entity class showing realistic data, (4) defines relationships between related entities, (5) validates against ontology JSON Schema, capturing domain knowledge from vehicle sensor data recording/replay systems | Restrictions: Must use exact entity class names from requirements; must not include team-specific details (those go in lower ontologies); properties must cover essential domain concepts; examples must be realistic; must validate against schema | Success: All 25 entity classes defined with complete properties, each entity has clear description and examples, relationships properly defined, validates against schema, covers entire reprocessing domain_
  - **Status**: ✅ Completed

- [x] 3. Create RaaS lower ontology for cloud orchestration team
  - File: `.data/ontologies/lower/raas-ontology.json`
  - Define 15 RaaS-specific entity classes: EventMeshNode, DataContract, SchemaRegistry, ArgoWorkflowTemplate, KubernetesCluster, PodSpec, RDQFramework, CachingStrategy, PrometheusMetric, GrafanaDashboard, CostOptimizationRule, FinOpsReport, IntervalSet, KPITrigger, AlertingRule
  - Set `extendsOntology` to point to upper ontology path, use `extendsEntity` to extend base entities with RaaS-specific properties
  - Add properties specific to cloud infrastructure: Kubernetes specifications, Argo workflow definitions, event mesh configuration, monitoring metrics
  - Purpose: Create team-specific ontology for RaaS Java cloud orchestration context
  - _Leverage: Requirements document Appendix A.2 for RaaS entity definitions_
  - _Requirements: REQ-2.2 (Lower Ontologies), REQ-2.4 (Team Scope)_
  - _Prompt: Role: Cloud Infrastructure Engineer specializing in Kubernetes and event-driven architectures | Task: Create RaaS lower ontology following requirements Appendix A.2 that (1) defines 15 cloud-specific entity classes for Kubernetes, Argo Workflows, event mesh, monitoring, and cost optimization, (2) extends upper ontology entities where applicable (e.g., CompoundReprocessing extended by ArgoWorkflowTemplate with dagSpec and parallelization), (3) includes RaaS-specific properties like Kubernetes podSpec, Prometheus metric definitions, FinOps cost rules, (4) adds examples using RaaS terminology and infrastructure, (5) sets extendsOntology path to upper ontology, capturing RaaS team's cloud orchestration patterns | Restrictions: Must properly reference upper ontology; extended entities must include base properties; properties must reflect actual RaaS infrastructure; examples must use real Kubernetes/Argo patterns; must validate against schema | Success: All 15 RaaS entity classes defined, proper extension of upper ontology entities, RaaS-specific properties complete, examples use cloud terminology, validates against schema, captures RaaS team context_
  - **Status**: ✅ Completed

- [x] 4. Create ReSi lower ontology for embedded C++ team
  - File: `.data/ontologies/lower/resi-ontology.json`
  - Define 18 ReSi-specific entity classes: EmbeddedFunction, FunctionOrchestrator, MF4Container, MCAPContainer, ProtobufSPP, KaitaiBinaryBlob, MIPIStream, SOMEIPTrace, FragmentationHandler, FormatConverter, TraceFileReader, TraceFileWriter, LocalDevelopmentSetup, CompilationProfile, TimingModel, HardwareAbstraction, SignalMapping, DebugConfiguration
  - Set `extendsOntology` to point to upper ontology, extend relevant entities with embedded systems properties
  - Add C++-specific properties: compilation profiles, timing models, hardware abstraction layers, signal mappings
  - Purpose: Create team-specific ontology for ReSi embedded C++ virtual target development
  - _Leverage: Requirements document Appendix A.3 for ReSi entity definitions_
  - _Requirements: REQ-2.2 (Lower Ontologies), REQ-2.4 (Team Scope)_
  - _Prompt: Role: Embedded Systems Engineer specializing in C++ virtual ECU development | Task: Create ReSi lower ontology following requirements Appendix A.3 that (1) defines 18 embedded-specific entity classes for data formats, virtual targets, compilation, and hardware abstraction, (2) extends upper ontology entities where applicable (e.g., RecordedData extended with fragmentation handling, format conversion), (3) includes ReSi-specific properties like compilationProfile, timingModel, hardwareAbstraction, (4) adds examples using embedded systems and C++ terminology, (5) sets extendsOntology path to upper ontology, capturing ReSi team's virtual target development patterns | Restrictions: Must properly reference upper ontology; extended entities must include base properties; properties must reflect embedded C++ development; examples must use realistic virtual target scenarios; must validate against schema | Success: All 18 ReSi entity classes defined, proper extension of upper ontology entities, ReSi-specific properties complete, examples use embedded terminology, validates against schema, captures ReSi team context_
  - **Status**: ✅ Completed

- [x] 5. Create Coding lower ontology for knowledge management infrastructure team
  - File: `.data/ontologies/lower/coding-ontology.json`
  - Define 18 Coding-specific entity classes: LSLSession, ClassificationLayer, ConstraintRule, TrajectoryState, MCPAgent, KnowledgeEntity, EmbeddingVector, GraphDatabase, VectorDatabase, MonitoringLayer, HookConfiguration, RedactionPattern, ToolWrapper, HealthFile, ConfigurationFile, WorkflowDefinition, PlantUMLDiagram, ServiceRegistry
  - Set `extendsOntology` to point to upper ontology, extend relevant entities with knowledge management properties
  - Add infrastructure-specific properties: 4-layer monitoring, 5-layer classification, constraint severity levels, vector dimensions, graph persistence
  - Purpose: Create team-specific ontology for Coding team's LSL, constraints, trajectory, and MCP systems
  - _Leverage: `.data/ontologies/lower/coding-ontology.json` (already created), requirements sections 6.1-6.2_
  - _Requirements: REQ-2.2 (Lower Ontologies), REQ-2.4 (Team Scope)_
  - _Prompt: Role: Infrastructure Engineer specializing in knowledge management and monitoring systems | Task: Validate and integrate Coding lower ontology that (1) defines 18 infrastructure entity classes for LSL (live session logging), constraint monitoring, trajectory generation, and MCP agents, (2) extends upper ontology entities where applicable (e.g., AnalysisArtifact extended by LSLSession with time windows and classification), (3) includes Coding-specific properties like classificationLayer (5-layer system), constraintRule (18 active constraints), trajectoryState (real-time development states), (4) adds examples using LSL/constraint/trajectory terminology, (5) ensures proper extension of base entities and relationships, capturing Coding team's knowledge infrastructure patterns | Restrictions: Must properly reference upper ontology; extended entities must include base properties; properties must reflect actual LSL/constraint systems; examples must use realistic infrastructure scenarios; must validate against schema | Success: All 18 Coding entity classes properly defined, correct extension of upper ontology entities, infrastructure-specific properties complete, examples use LSL/constraint terminology, validates against schema, captures Coding team context_
  - **Status**: ✅ Completed

- [x] 6. Create Agentic lower ontology for AI agent frameworks team
  - File: `.data/ontologies/lower/agentic-ontology.json`
  - Define 15 Agentic-specific entity classes: AgentFramework, RAGSystem, CommunicationProtocol, ModuleContent, Exercise, LabEnvironment, CourseModule, LLMProvider, VectorStore, ToolDefinition, PromptTemplate, AgentWorkflow, KnowledgeGraph, EvaluationMetric, DevelopmentSetup
  - Set `extendsOntology` to point to upper ontology, extend relevant entities with agent/RAG properties
  - Add AI-specific properties: LangChain/CrewAI frameworks, RAG types (basic/graph/agentic/multimodal), MCP/ACP/A2A protocols, nanodegree curriculum structure
  - Purpose: Create team-specific ontology for Agentic team's agent frameworks, RAG systems, and learning resources
  - _Leverage: `.data/ontologies/lower/agentic-ontology.json` (already created), requirements sections 7.1-7.2_
  - _Requirements: REQ-2.2 (Lower Ontologies), REQ-2.4 (Team Scope)_
  - _Prompt: Role: AI/ML Engineer specializing in agent frameworks and RAG systems | Task: Validate and integrate Agentic lower ontology that (1) defines 15 AI agent entity classes for frameworks (LangChain, CrewAI, PydanticAI), RAG systems (basic, graph, agentic, multimodal), communication protocols (MCP, ACP, A2A), and learning resources (6-week nanodegree), (2) extends upper ontology entities where applicable (e.g., SystemComponent extended by AgentFramework with capabilities and architecture patterns), (3) includes Agentic-specific properties like ragType, retrieverType, protocolName, courseModule structure, (4) adds examples using agent framework and RAG terminology, (5) ensures proper extension of base entities and relationships, capturing Agentic team's AI agent development patterns | Restrictions: Must properly reference upper ontology; extended entities must include base properties; properties must reflect actual agent frameworks and RAG architectures; examples must use realistic AI agent scenarios; must validate against schema | Success: All 15 Agentic entity classes properly defined, correct extension of upper ontology entities, AI-specific properties complete, examples use agent/RAG terminology, validates against schema, captures Agentic team context_
  - **Status**: ✅ Completed

- [x] 7. Create UI lower ontology for multi-agent curriculum system team
  - File: `.data/ontologies/lower/ui-ontology.json`
  - Define 18 UI-specific entity classes: AgentInstance, WorkflowOrchestration, AWSLambdaFunction, AWSStepFunction, APIGatewayEndpoint, EventBridgeRule, S3Bucket, CloudFrontDistribution, PostgreSQLSchema, QdrantCollection, ReactComponent, ReduxState, TailwindStyle, DocumentParser, CurriculumEntity, SemanticSearchQuery, GapAnalysisReport, LLMConfiguration
  - Set `extendsOntology` to point to upper ontology, extend relevant entities with multi-agent and AWS serverless properties
  - Add UI-specific properties: 8 specialized agents, AWS Lambda/Step Functions, React/Redux/Tailwind, curriculum analysis workflows
  - Purpose: Create team-specific ontology for UI team's MACAS (Multi-Agent Curriculum Alignment System)
  - _Leverage: `.data/ontologies/lower/ui-ontology.json` (already created), requirements sections 8.1-8.2_
  - _Requirements: REQ-2.2 (Lower Ontologies), REQ-2.4 (Team Scope)_
  - _Prompt: Role: Full-Stack Engineer specializing in multi-agent systems and AWS serverless architecture | Task: Validate and integrate UI lower ontology that (1) defines 18 multi-agent curriculum system entity classes for 8 specialized agents (Coordinator, WebSearch, Browser, DocumentProcessing, AccreditationExpert, QA, SemanticSearch, ChatInterface), AWS serverless infrastructure (Lambda, Step Functions, API Gateway, EventBridge), and React frontend (components, Redux state, Tailwind styling), (2) extends upper ontology entities where applicable (e.g., ModelComponent extended by AgentInstance with agent roles and LLM configuration), (3) includes UI-specific properties like workflowOrchestration, lambdaFunction runtime, reactComponent type, curriculumEntity structure, (4) adds examples using multi-agent and curriculum terminology, (5) ensures proper extension of base entities and relationships, capturing UI team's MACAS patterns | Restrictions: Must properly reference upper ontology; extended entities must include base properties; properties must reflect actual AWS serverless and multi-agent architectures; examples must use realistic curriculum alignment scenarios; must validate against schema | Success: All 18 UI entity classes properly defined, correct extension of upper ontology entities, multi-agent/serverless properties complete, examples use MACAS terminology, validates against schema, captures UI team context_
  - **Status**: ✅ Completed

## Phase 2: Core Components (Week 2)

- [x] 8. Implement OntologyManager for loading and resolving ontologies
  - File: `src/ontology/OntologyManager.ts`
  - Implement `loadOntology(path)` to read and parse ontology JSON files with schema validation
  - Implement `resolveEntity(entityClass, team?)` to merge upper and lower entity definitions with inheritance
  - Implement `getAllEntityClasses(team?)` to return upper classes (no team) or upper + lower classes (with team)
  - Implement `getRelationships(team?)` to return relationship definitions
  - Add in-memory LRU caching (1000 entries, 1-hour TTL) for parsed ontologies and resolved entities
  - Add `reloadOntologies()` for hot-reloading and `validateOntologyFile(path)` for pre-validation
  - Purpose: Central manager for ontology lifecycle with inheritance resolution and caching
  - _Leverage: Design document sections 2.2, 5.1 for API design and caching strategy_
  - _Requirements: REQ-2.5 (Inheritance Model), REQ-3.1 (Validation), REQ-5.4 (Caching)_
  - _Prompt: Role: Senior TypeScript Developer specializing in configuration management and caching | Task: Implement OntologyManager following design sections 2.2, 5.1 that (1) loads ontology files with JSON Schema validation, (2) resolves entity definitions by merging upper and lower ontologies using extendsEntity inheritance, (3) caches parsed ontologies and resolved entities in LRU cache (1000 entries, 1-hour TTL), (4) provides methods getAllEntityClasses and getRelationships with optional team filtering, (5) supports hot-reloading via reloadOntologies, (6) implements comprehensive error handling with OntologyError class, handling file not found, parse errors, validation failures | Restrictions: Must validate ontology structure before loading; must handle missing files gracefully; entity resolution must correctly merge properties (lower overrides upper); cache must improve load time >10x; must support concurrent access safely | Success: Ontologies load correctly with validation, entity resolution properly merges upper + lower definitions, caching improves performance >10x, all methods work with and without team parameter, error messages are actionable, hot-reloading works without restart_
  - **Status**: ✅ Completed

- [x] 9. Implement OntologyValidator for schema validation
  - File: `src/ontology/OntologyValidator.ts`
  - Implement `validate(knowledge, entityClass, options)` to check knowledge against entity schema with strict/lenient modes
  - Implement `validateProperty(value, propertyDef)` to validate types, enums, patterns, ranges, references, and nested structures
  - Implement `validateRelationship(relationship, ontology)` to check relationship types and cardinality
  - Collect all validation errors with property paths (e.g., "properties.rpuComponents[2].imageTag") for debugging
  - Support `allowUnknownProperties` option to ignore extra properties in lenient mode
  - Purpose: Validate knowledge extractions against ontology schemas with configurable strictness
  - _Leverage: Design document sections 2.2, 5.1 for validation logic_
  - _Requirements: REQ-3.1 (Validation), REQ-3.2 (Strict/Lenient Modes)_
  - _Prompt: Role: Quality Assurance Engineer specializing in schema validation and data quality | Task: Implement OntologyValidator following design sections 2.2, 5.1 that (1) validates knowledge objects against entity definitions from OntologyManager, (2) checks required properties are present, (3) validates property types (string, number, boolean, object, array, reference), (4) enforces constraints (enum, pattern, min, max), (5) validates nested objects and arrays recursively, (6) supports strict mode (fail on any error) and lenient mode (collect errors but continue), (7) generates detailed error messages with property paths, handling complex nested structures and references | Restrictions: Must validate all property types correctly; must handle nested objects and arrays; error messages must include full property path; strict mode must fail immediately; lenient mode must collect all errors; must not modify knowledge object during validation | Success: All property types validated correctly, required properties checked, enums and patterns enforced, nested structures validated recursively, error messages include property paths, strict/lenient modes work as expected, validation completes in <50ms for typical knowledge_
  - **Status**: ✅ Completed

- [x] 10. Implement 5-layer heuristic classification system (modeled after LSL)
  - **Overview**: Replace keyword-only classification with multi-layer approach to prevent false positives from team keyword overlap
  - **Architecture**: Progressive layers (Layer 0→4) with early exit optimization at first high-confidence result (≥0.85)
  - **Performance Target**: <100ms for 90% of classifications (Layer 0-2 exit: <10ms)
  - _Leverage: Design document section 3 (Multi-Layer Heuristic Classification System), LSL classification approach from docs/core-systems/live-session-logging.md_
  - _Requirements: REQ-2.3 (Multi-Layer Heuristic Classification), REQ-2.4 (Fallback Strategy)_
  - **Status**: ✅ Completed (needs redesign - keyword-only implementation)

  - [x] 10.1 Implement Layer 0: Team Context Filter (Conversation Bias Tracking)
    - File: `src/ontology/heuristics/TeamContextFilter.ts`
    - Track sliding window of recent classifications (default: 5 exchanges) with temporal decay
    - Calculate team bias: exponential decay on classification age, dominant team strength
    - Apply only to neutral/ambiguous knowledge (weak signals from other layers)
    - Activation threshold: bias strength ≥0.65, neutral indicators (Layer 1 <0.5, Layer 2 <0.3, Layer 3 diff <0.15)
    - Return confidence: bias strength × 0.8 (discounted for contextual nature)
    - Purpose: Handle follow-up questions ("more details", "similar pattern") by conversation momentum
    - _Response Time: <1ms_
    - _Prompt: Role: Conversation Analysis Engineer specializing in context tracking | Task: Implement TeamContextFilter following design section 3.2 that (1) maintains classificationHistory array (windowSize=5) storing recent team classifications, (2) implements calculateTeamBias with exponential temporal decay (weight = exp(-age * 0.2)), (3) calculates bias strength as (maxTeamCount / totalWeight), (4) checks isNeutralKnowledge using neutrality thresholds from other layers, (5) returns LayerResult with confidence (biasStrength * 0.8) only if bias ≥0.65 and knowledge is neutral, (6) tracks classification history to update sliding window | Restrictions: Must execute in <1ms; must not apply to non-neutral knowledge; must use temporal decay for recent bias; bias strength must be accurate; must properly discount confidence for contextual nature | Success: Context filter activates only for neutral knowledge, temporal decay correctly weights recent classifications, bias calculation identifies dominant team, response time <1ms, follow-up questions correctly inherit team context_

  - [x] 10.2 Implement Layer 1: Entity Pattern Analyzer (File/Artifact Detection)
    - File: `src/ontology/heuristics/EntityPatternAnalyzer.ts`
    - Extract file paths, module names, and artifact references from knowledge content using regex patterns
    - Implement two-step artifact checking: (a) check if artifact exists in team-specific directories, (b) search for artifact patterns indicating team ownership
    - Define team directory patterns: Coding→[src/ontology, src/knowledge-management, scripts], RaaS→[raas-service, orchestration-engine], ReSi→[virtual-target, embedded-functions], Agentic→[agent-frameworks, rag-systems], UI→[curriculum-alignment, aws-lambda]
    - Return high confidence (0.9) for direct artifact match, medium-high (0.75) for pattern match
    - Purpose: Accurate team detection from clear file/artifact references with early exit
    - _Response Time: <1ms_
    - _Prompt: Role: Pattern Analysis Engineer specializing in file path and artifact detection | Task: Implement EntityPatternAnalyzer following design section 3.3 that (1) extracts artifacts using regex patterns (file paths, npm packages, service classes), (2) implements checkLocalArtifact checking if artifact startsWith team-specific directories, (3) implements matchArtifactPattern searching for team-specific naming conventions, (4) returns LayerResult with confidence 0.9 for local matches or 0.75 for pattern matches, (5) infers entityClass from artifact type and team context, (6) provides evidence explaining which artifact matched which team | Restrictions: Must execute in <1ms; must handle multiple artifact types (files, modules, classes); team directories must be comprehensive; must check local artifacts before patterns; confidence must reflect match type; must return null if no artifacts found | Success: Direct artifact matches return 0.9 confidence, pattern matches return 0.75 confidence, execution <1ms, team directories correctly identify ownership, entity class inference accurate, evidence clearly explains match_

  - [x] 10.3 Enhance Layer 2: Keyword Matcher with multi-match requirement
    - File: `src/ontology/heuristics/EnhancedKeywordMatcher.ts` (refactor existing HeuristicClassifier.ts)
    - **CRITICAL CHANGE**: Require MULTIPLE keyword matches from same team (not single keyword)
    - Implement confidence scoring: single keyword (0.4-0.6 low), multiple keywords (0.6-0.8 medium), multiple + required keywords (0.8-0.95 high)
    - Calculate per-team scores, find team with highest score
    - Return LayerResult only if totalMatches ≥2 AND confidence ≥0.5
    - Refactor existing raas/resi/coding/agentic/ui-heuristics.ts files to enhance patterns with confidence calibration
    - Purpose: Prevent false positives from single keyword matches while maintaining speed
    - _Response Time: <10ms_
    - _Prompt: Role: Keyword Analysis Engineer specializing in multi-evidence pattern matching | Task: Enhance existing KeywordMatcher following design section 3.4 that (1) requires MINIMUM 2 keyword matches from same team (prevents false positives), (2) implements scoreKeywords calculating totalMatches, checking requiredKeywords (all present), checking excludeKeywords (none present), (3) calculates confidence: 0 (no matches), 0.5 (single match), 0.65 (multiple, no required), 0.85 (multiple + required), with keyword boost (totalMatches * 0.05) up to 0.95, (4) returns LayerResult only if totalMatches ≥2 and confidence ≥0.5, (5) provides evidence listing matched keywords and team, (6) refactors existing heuristics files to work with new scoring | Restrictions: Must execute in <10ms; must require ≥2 matches; confidence must reflect match quality; must check requiredKeywords (all) and excludeKeywords (none); must not be sole decision maker; must provide clear evidence; existing heuristics must be preserved | Success: Single keywords no longer classify (prevents false positives), multiple keywords return medium confidence, required+multiple return high confidence, execution <10ms, confidence scores accurate, evidence shows matched keywords, refactored heuristics compatible_

  - [x] 10.4 Implement Layer 3: Semantic Embedding Classifier (Ontology Similarity)
    - File: `src/ontology/heuristics/SemanticEmbeddingClassifier.ts`
    - Generate 384-dim embeddings for knowledge content using existing EmbeddingGenerator (Transformers.js)
    - Create team-specific Qdrant collections for ontology content: ontology-raas, ontology-resi, ontology-coding, ontology-agentic, ontology-ui
    - Index each team's ontology entities and properties with embeddings
    - Search collections for semantic similarity (threshold: 0.65, limit: 5)
    - Find best match across teams, check if significantly better than second-best (diff >0.1 for disambiguation)
    - Return LayerResult with confidence: similarity score (or similarity * 0.9 if ambiguous)
    - Purpose: High-accuracy semantic classification preventing keyword overlap false positives
    - _Response Time: ~50ms_
    - _Prompt: Role: Vector Search Engineer specializing in semantic similarity classification | Task: Implement SemanticEmbeddingClassifier following design section 3.5 that (1) generates 384-dim embeddings using existing EmbeddingGenerator with Transformers.js, (2) creates indexOntologyContent method indexing each team's ontology entities/properties into Qdrant collections (ontology-{team}), (3) implements classifyByEmbedding searching all relevant team collections with scoreThreshold 0.65, (4) finds bestMatch sorting by similarity score, (5) checks disambiguation (best - secondBest > 0.1), applies confidence penalty (0.9x) if ambiguous, (6) returns LayerResult with entityClass, team, confidence, evidence showing similarity scores | Restrictions: Must use existing EmbeddingGenerator; must create separate Qdrant collections per team; must index ontology content before first use; similarity threshold 0.65; must disambiguate close matches; execution ~50ms; must handle missing collections gracefully | Success: Ontology content indexed in team collections, embeddings generate correctly, similarity search finds semantically related entities, disambiguation works, confidence reflects match quality, execution ~50ms, evidence shows similarity scores, example "caching strategy" → RaaS CachingStrategy (0.78)_

  - [x] 10.5 Integrate all layers into HeuristicClassifier with early exit
    - File: `src/ontology/heuristics/HeuristicClassifier.ts` (major refactor)
    - Implement classification pipeline calling layers 0→4 in sequence
    - Early exit optimization: return immediately if any layer achieves confidence ≥earlyExitThreshold (default 0.85)
    - Aggregate results from multiple layers when no single layer is confident
    - Track layer that made final decision for analytics (method tracking)
    - Implement aggregateLayerResults: single high confidence (use it), multiple agree (average with boost), multiple disagree (use highest if ≥0.75, else escalate to Layer 4)
    - Purpose: Orchestrate 5-layer pipeline with performance optimization and multi-evidence aggregation
    - _Performance: <100ms for 90% (Layers 0-2 early exit: <10ms)_
    - _Prompt: Role: System Integration Engineer specializing in multi-layer pipelines | Task: Refactor HeuristicClassifier following design section 3.7 that (1) implements classify method calling layers 0→4 sequentially, (2) checks early exit after each layer (if confidence ≥0.85, return immediately), (3) collects layerResults array if no early exit, (4) implements aggregateLayerResults: if single result ≥0.85 use it, if multiple agree average with 1.1x boost, if disagree use max if ≥0.75 else escalate to Layer 4, (5) returns OntologyClassification with finalLayer tracking, (6) adds performance metrics tracking layer execution times | Restrictions: Must call layers in order 0→4; must early exit at ≥0.85; must aggregate correctly when no single confident layer; must track which layer decided; must achieve <100ms for 90% of classifications; must handle layer failures gracefully; must log performance metrics | Success: Pipeline executes layers in order, early exit works at ≥0.85 confidence, 90% classifications complete in <100ms, aggregation correctly combines evidence, layer tracking accurate, performance metrics logged, handles all edge cases, prevents false positives from keyword-only matching_

- [x] 11. Implement OntologyClassifier with LLM and heuristic support
  - File: `src/ontology/OntologyClassifier.ts`
  - Implement `classify(knowledge, options)` to classify single knowledge extraction using heuristics first, LLM fallback if needed
  - Implement `classifyBatch(knowledgeBatch, options)` to process multiple knowledge items efficiently with batched LLM calls
  - Implement `buildClassificationPrompt(knowledge, entityClasses)` to create structured LLM prompt with entity descriptions and examples
  - Implement `applyHeuristicFallback(knowledge)` to try pattern matching before expensive LLM call
  - Parse LLM response to extract entity class, confidence score, property values, and reasoning
  - Purpose: Classify knowledge into ontology entity classes using hybrid heuristic + LLM approach
  - _Leverage: Design document sections 2.2, 5.2 for classification architecture; UnifiedInferenceEngine for LLM calls_
  - _Requirements: REQ-4.1 (LLM Classification), REQ-4.2 (Heuristic Fallback), REQ-4.3 (Confidence Thresholds)_
  - _Prompt: Role: ML Engineer specializing in hybrid classification systems and LLM integration | Task: Implement OntologyClassifier following design sections 2.2, 5.2 that (1) tries heuristic classification first for speed, (2) falls back to LLM if heuristic confidence <0.8 or returns null, (3) builds structured LLM prompt including knowledge content, available entity classes with descriptions, and classification instructions, (4) calls UnifiedInferenceEngine with budget awareness, (5) parses LLM response to extract entity class, confidence, properties, and reasoning, (6) supports batch classification for efficiency, (7) respects confidence threshold option (default 0.7), handling mixed team scope and classification method tracking | Restrictions: Must try heuristics before LLM to save costs; must check budget before LLM calls; batch classification must use single LLM call; confidence threshold must be configurable; must log classification method (heuristic/llm) and confidence; must handle LLM failures gracefully; prompt must include entity descriptions to guide classification | Success: Heuristics used for >50% of classifications, LLM achieves >85% accuracy on remaining cases, batch processing reduces LLM calls by >5x, confidence scores reliable, budget limits respected, classification method logged, handles all team scopes correctly_
  - **Status**: ✅ Completed

- [x] 12. Implement OntologyQueryEngine for knowledge retrieval
  - File: `src/ontology/OntologyQueryEngine.ts`
  - Implement `findByEntityClass(entityClass, team?, options?)` to query knowledge by ontology entity class with pagination
  - Implement `findByProperty(entityClass, propertyPath, value)` to filter by specific property values with dot notation support
  - Implement `aggregateByEntityClass(team?)` to count knowledge items per entity class
  - Implement `findRelated(knowledgeId, relationshipType?)` to follow ontology relationships in graph
  - Implement `query(query: OntologyQuery)` for complex queries combining multiple filters
  - Purpose: Enable powerful ontology-based knowledge retrieval with filtering and aggregation
  - _Leverage: Design document sections 2.2, 5.3 for query API; GraphDatabaseService for data access_
  - _Requirements: REQ-5.1 (Ontology-Based Retrieval), REQ-5.2 (Property Filtering)_
  - _Prompt: Role: Database Engineer specializing in graph queries and filtering | Task: Implement OntologyQueryEngine following design sections 2.2, 5.3 that (1) queries GraphDatabaseService by ontology.entityClass attribute with optional team filtering (including "mixed"), (2) filters by property values using dot notation for nested properties (e.g., "properties.resourceRequirements.cpu"), (3) aggregates counts by entity class, (4) follows ontology relationships in graph to find related knowledge, (5) supports complex queries combining entity class, team, properties, relationships, and confidence filters, (6) implements pagination (limit, offset) and sorting, achieving <100ms p95 latency for simple queries | Restrictions: Must filter by team correctly (include "mixed" team items); must handle nested property access safely; must support pagination for large result sets; aggregations must be accurate; relationship queries must follow graph edges; complex queries must combine filters properly | Success: Entity class queries return correct filtered results, property filtering handles nested objects, aggregations accurate, pagination works correctly, relationship queries follow graph, complex queries combine filters properly, query latency <100ms p95 for simple queries, <500ms for complex_
  - **Status**: ✅ Completed

## Phase 3: Integration (Week 3)

- [x] 13. Extend KnowledgeConfig with ontology configuration
  - File: `src/knowledge-management/types.ts`
  - Add `ontology` field to `KnowledgeConfig` interface with enabled flag, paths, team scope, confidence threshold, validation settings, caching settings, classification settings
  - Create default configuration in `config/knowledge-management.json` with ontology enabled, default paths, and reasonable defaults
  - Create team-specific configurations in `config/teams/raas.json` and `config/teams/resi.json`
  - Purpose: Provide configuration structure for ontology system with sensible defaults
  - _Leverage: Design document sections 4.1, 7.3 for configuration design_
  - _Requirements: REQ-6.1 (Configuration), REQ-6.2 (Team Configuration)_
  - _Prompt: Role: Configuration Engineer specializing in structured configuration management | Task: Extend KnowledgeConfig following design sections 4.1, 7.3 to (1) add ontology field with enabled, upperOntologyPath, lowerOntologyPath, team, confidenceThreshold, validation {enabled, strict}, caching {enabled, ttl, maxSize}, classification {batchSize, useHeuristicFallback, heuristicThreshold}, (2) create default config with ontology enabled, paths to .data/ontologies/, team="mixed", confidenceThreshold=0.7, validation enabled lenient, (3) create RaaS team config with lowerOntologyPath to raas-ontology.json and strict validation, (4) create ReSi team config with lowerOntologyPath to resi-ontology.json and lenient validation, supporting environment variable overrides | Restrictions: Must use TypeScript interface for type safety; defaults must be production-ready; team configs must override only necessary fields; paths must be relative to project root; must support environment variables for sensitive settings | Success: Configuration interface type-safe, default config enables ontology system, team configs properly override defaults, validation enforced by TypeScript, environment variables work, documentation clear_
  - **Status**: ✅ Completed

- [x] 14. Integrate OntologyManager into StreamingKnowledgeExtractor initialization
  - File: `src/knowledge-management/StreamingKnowledgeExtractor.js`
  - Add private fields: `ontologyManager?: OntologyManager`, `ontologyClassifier?: OntologyClassifier`, `ontologyValidator?: OntologyValidator`
  - Update constructor to initialize ontology components if `config.ontology?.enabled` is true
  - Initialize OntologyManager with config paths, OntologyClassifier with manager and UnifiedInferenceEngine, OntologyValidator if validation enabled
  - Add error handling for ontology initialization failures with graceful degradation
  - Purpose: Bootstrap ontology system within knowledge extraction infrastructure
  - _Leverage: Design document section 4.1 for integration design; existing StreamingKnowledgeExtractor constructor_
  - _Requirements: REQ-7.1 (Non-Breaking Integration)_
  - _Prompt: Role: Integration Engineer specializing in backward-compatible system integration | Task: Integrate OntologyManager into StreamingKnowledgeExtractor following design section 4.1 that (1) adds optional ontology fields to class (ontologyManager, ontologyClassifier, ontologyValidator), (2) initializes ontology components in constructor only if config.ontology.enabled is true, (3) loads upper and lower ontologies via OntologyManager, (4) creates OntologyClassifier with manager and inference engine, (5) creates OntologyValidator if config.ontology.validation.enabled, (6) handles initialization errors gracefully without breaking extraction, (7) logs ontology system status, ensuring zero breaking changes when ontology disabled | Restrictions: Must work normally when ontology disabled; must not throw errors if ontology files missing; must log initialization status clearly; must not break existing tests; ontology components must be optional | Success: Ontology components initialize correctly when enabled, system works normally when disabled, initialization errors handled gracefully with clear messages, no breaking changes to existing functionality, tests pass_
  - **Status**: ✅ Completed

- [x] 15. Integrate classification into processExchange workflow
  - File: `src/knowledge-management/StreamingKnowledgeExtractor.js`
  - Update `processExchange` method to classify knowledge if ontology enabled and confidence >= threshold
  - Add ontology metadata to knowledge object: entityClass, team, properties, relationships, classification {confidence, method, modelUsed, timestamp}
  - Validate knowledge if validation enabled and add validation results to ontology metadata
  - Log warning if strict validation fails but continue processing (store with errors)
  - Purpose: Enhance knowledge extraction with ontology classification and validation
  - _Leverage: Design document sections 4.1, 6.1 for integration workflow; sequence diagram for classification flow_
  - _Requirements: REQ-7.2 (Classification Integration), REQ-7.3 (Validation Integration)_
  - _Prompt: Role: Workflow Engineer specializing in data enrichment pipelines | Task: Integrate classification into processExchange following design sections 4.1, 6.1 and sequence diagram that (1) after extractKnowledge, calls ontologyClassifier.classify if ontology enabled, (2) checks if classification confidence >= config.ontology.confidenceThreshold (default 0.7), (3) adds ontology metadata with entityClass, team, properties, relationships[], classification {confidence, method, modelUsed, timestamp}, (4) validates knowledge if config.ontology.validation.enabled, (5) adds validation results with validated flag, strict mode, and errors[], (6) logs warning if strict validation fails but continues processing, ensuring backward compatibility and performance | Restrictions: Must only classify when ontology enabled; must respect confidence threshold; must not block on classification failure; validation failures must not prevent storage; must log classification and validation results; must preserve existing knowledge structure; must complete classification in <500ms p95 | Success: Knowledge gets ontology metadata when confidence sufficient, validation runs and adds results, strict validation logs warnings, classification failures degrade gracefully, existing functionality unchanged when ontology disabled, performance acceptable <500ms p95_
  - **Status**: ✅ Completed

- [x] 16. Enhance GraphDatabaseService to store and query ontology metadata
  - File: `src/knowledge-management/GraphDatabaseService.js`
  - Update `storeKnowledge` to add ontology node attributes: `ontology.entityClass`, `ontology.team`, `ontology.confidence`
  - Create graph edges for ontology relationships with edge type and metadata (entityClass, targetEntityClass)
  - Implement `queryByOntologyClass(entityClass, team?)` to filter nodes by ontology attributes
  - Add graph indices on `ontology.entityClass` and `ontology.team` for query performance
  - Purpose: Persist and index ontology metadata in graph database for efficient querying
  - _Leverage: Design document section 4.2 for graph integration; existing GraphDatabaseService storage methods_
  - _Requirements: REQ-8.1 (Graph Storage), REQ-8.2 (Ontology Indexing)_
  - _Prompt: Role: Graph Database Engineer specializing in property graph modeling and indexing | Task: Enhance GraphDatabaseService following design section 4.2 that (1) updates storeKnowledge to add ontology node attributes when knowledge.ontology exists, (2) creates graph edges for each ontology.relationships[] entry with relationship type and metadata, (3) implements queryByOntologyClass to filter nodes by ontology.entityClass and optionally ontology.team (including "mixed" items), (4) adds graph indices on ontology.entityClass and ontology.team for fast filtering, ensuring backward compatibility when ontology metadata absent | Restrictions: Must handle knowledge without ontology metadata gracefully; must not break existing storage; edges must include relationship metadata; indices must improve query performance >10x; team filtering must include "mixed" items; must support concurrent access | Success: Ontology metadata stored as node attributes, relationships create graph edges, queryByOntologyClass returns correct filtered results, indices improve query performance >10x, backward compatible with non-ontology knowledge, concurrent access safe_
  - **Status**: ✅ Completed

- [x] 17. Integrate OntologyQueryEngine into KnowledgeRetriever
  - File: `src/knowledge-management/KnowledgeRetriever.js`
  - Add private field `ontologyQueryEngine?: OntologyQueryEngine` and initialize if ontology enabled
  - Implement `retrieveByOntology(query: OntologyQuery)` method for ontology-based retrieval
  - Enhance `retrieve` method for hybrid semantic + ontology retrieval by intersecting results
  - Add `RetrievalQuery` type with optional ontology field for filtering
  - Purpose: Enable ontology-based and hybrid knowledge retrieval in existing retrieval API
  - _Leverage: Design document section 4.3 for retrieval integration; existing KnowledgeRetriever semantic search_
  - _Requirements: REQ-9.1 (Ontology Retrieval), REQ-9.2 (Hybrid Retrieval)_
  - _Prompt: Role: Search Engineer specializing in multi-modal retrieval and result fusion | Task: Integrate OntologyQueryEngine into KnowledgeRetriever following design section 4.3 that (1) initializes OntologyQueryEngine in constructor if ontology enabled, (2) implements retrieveByOntology method calling ontologyQueryEngine.findByEntityClass, (3) enhances retrieve method to support optional query.ontology field for filtering, (4) implements hybrid retrieval by performing semantic search then intersecting with ontology results, (5) returns filtered results maintaining semantic ranking, ensuring backward compatibility and acceptable performance | Restrictions: Must work normally when ontology disabled; hybrid retrieval must preserve semantic ranking; ontology filter must not break semantic search; must support all query options; performance must be acceptable for combined queries | Success: retrieveByOntology works for entity class queries, hybrid retrieval correctly intersects semantic + ontology results, semantic ranking preserved, backward compatible when ontology field absent, performance acceptable for hybrid queries, no breaking changes to existing API_
  - **Status**: ✅ Completed

## Phase 4: Testing & Validation (Week 4-5)

- [x] 18. Create unit tests for OntologyManager
  - File: `test/ontology/OntologyManager.test.js`
  - Test `loadOntology` with valid, malformed, and missing ontology files
  - Test `resolveEntity` for upper-only, lower-only, and merged entities with inheritance
  - Test `getAllEntityClasses` without team (upper only) and with team (upper + lower merged)
  - Test caching behavior: load once, serve from cache, verify cache improves load time >10x
  - Test cache invalidation via `reloadOntologies`
  - Purpose: Ensure OntologyManager correctly loads, resolves, and caches ontologies
  - _Leverage: Test fixtures with sample ontology files; Jest testing framework_
  - _Requirements: REQ-10.1 (Testing), REQ-10.2 (Coverage >85%)_
  - _Prompt: Role: Test Engineer specializing in unit testing and TypeScript | Task: Write comprehensive unit tests for OntologyManager that (1) test loadOntology with valid ontology returns parsed object, malformed JSON throws parse error, missing file throws file not found error, (2) test resolveEntity for upper entity returns upper definition, lower entity with extendsEntity returns merged definition with lower properties overriding upper, (3) test getAllEntityClasses without team returns only upper classes, with team="RaaS" returns upper + RaaS classes, (4) test caching by loading same ontology twice and verifying second load served from cache in <1ms, (5) test reloadOntologies clears cache and reloads files, using Jest with test fixtures and mocks | Restrictions: Must achieve >90% code coverage; must test all error conditions; must verify cache performance improvement; must use test fixtures not production files; must mock file system when appropriate | Success: All tests pass, >90% code coverage, error conditions tested, cache performance verified >10x improvement, test fixtures realistic, mocks used appropriately_
  - **Status**: ✅ Completed (all 23 tests passing ✅)

- [ ] 19. Create unit tests for OntologyValidator
  - File: `src/ontology/__tests__/OntologyValidator.test.ts`
  - Test property type validation: string, number, boolean, object, array, reference types
  - Test required property validation, enum validation, pattern (regex) validation, range validation (min, max)
  - Test nested object and array validation recursively
  - Test strict vs lenient mode: strict fails on first error, lenient collects all errors
  - Test validation error messages include full property paths (e.g., "properties.rpuComponents[2].imageTag")
  - Purpose: Ensure OntologyValidator correctly validates knowledge against entity schemas
  - _Leverage: Test fixtures with valid and invalid knowledge objects_
  - _Requirements: REQ-10.1 (Testing), REQ-10.2 (Coverage >85%)_
  - _Prompt: Role: QA Engineer specializing in schema validation testing | Task: Write comprehensive unit tests for OntologyValidator that (1) test validateProperty for all types (string passes with string value, fails with number), (2) test required properties (missing required property fails, present passes), (3) test enum (value in enum passes, value not in enum fails), (4) test pattern (matching pattern passes, non-matching fails), (5) test range (value within min/max passes, outside fails), (6) test nested objects (validates recursively, reports nested property path), (7) test arrays (validates each item, reports item index in path), (8) test strict mode (first error throws), (9) test lenient mode (collects all errors), verifying error messages include property paths | Restrictions: Must achieve >90% code coverage; must test all validation rules; must verify error messages include paths; must test both validation modes; strict mode must fail fast; lenient mode must find all errors | Success: All tests pass, >90% code coverage, all validation types tested, error messages include property paths, strict/lenient modes work correctly, nested validation tested_
  - **Status**: ⏳ Not started

- [x] 20. Create unit tests for OntologyClassifier
  - File: `src/ontology/__tests__/OntologyClassifier.test.ts`
  - Test heuristic classification for known RaaS patterns (Kubernetes, Argo terms) and ReSi patterns (C++, data format terms)
  - Test LLM classification fallback when heuristic returns null or low confidence
  - Test confidence threshold filtering: classification below threshold not stored
  - Test team-specific classification: RaaS, ReSi, and mixed team modes
  - Test batch classification more efficient than individual (mock UnifiedInferenceEngine for deterministic results)
  - Purpose: Ensure OntologyClassifier correctly classifies knowledge with hybrid heuristic + LLM approach
  - _Leverage: Mock UnifiedInferenceEngine for deterministic LLM responses; test fixtures with known patterns_
  - _Requirements: REQ-10.1 (Testing), REQ-10.2 (Coverage >85%)_
  - _Prompt: Role: ML Test Engineer specializing in classification system testing | Task: Write comprehensive unit tests for OntologyClassifier that (1) test heuristic classification for RaaS patterns ("kubectl apply" → KubernetesCluster with confidence >0.7) and ReSi patterns ("virtual target ECU" → VirtualTarget), (2) test LLM fallback (mock UnifiedInferenceEngine to return classification, verify LLM called when heuristic returns null), (3) test confidence threshold (classification with confidence 0.6 filtered when threshold 0.7), (4) test team modes (team="RaaS" uses RaaS heuristics + upper, team="ReSi" uses ReSi + upper, team="mixed" tries all), (5) test batch classification (calls UnifiedInferenceEngine once for multiple items vs multiple times individual), using Jest with mocked inference engine | Restrictions: Must mock UnifiedInferenceEngine for deterministic tests; must achieve >85% code coverage; must test all team modes; must verify heuristics tried before LLM; batch efficiency must be tested; confidence scoring must be tested | Success: All tests pass, >85% code coverage, heuristic classification >80% accurate on test patterns, LLM fallback works, confidence threshold enforced, team modes correct, batch more efficient than individual, mocked LLM deterministic_
  - **Status**: ✅ Completed - 17/17 tests passing with mocked UnifiedInferenceEngine

- [ ] 21. Create unit tests for OntologyQueryEngine
  - File: `src/ontology/__tests__/OntologyQueryEngine.test.ts`
  - Test `findByEntityClass` returns correct results, filters by team including "mixed" items
  - Test `findByProperty` with simple properties and nested properties using dot notation
  - Test `aggregateByEntityClass` returns accurate counts per entity class
  - Test `findRelated` follows ontology relationships in graph
  - Test complex queries combining multiple filters
  - Purpose: Ensure OntologyQueryEngine correctly queries knowledge by ontology metadata
  - _Leverage: Mock GraphDatabaseService with test data; test fixtures with ontology metadata_
  - _Requirements: REQ-10.1 (Testing), REQ-10.2 (Coverage >85%)_
  - _Prompt: Role: Database Test Engineer specializing in query testing | Task: Write comprehensive unit tests for OntologyQueryEngine that (1) test findByEntityClass returns only knowledge with matching entityClass, (2) test team filter (team="RaaS" returns RaaS + mixed items, excludes ReSi), (3) test findByProperty with simple property (finds items where property matches value) and nested property using dot notation ("properties.cpu" = "4 cores"), (4) test aggregateByEntityClass returns map with entity class names and counts, (5) test findRelated follows relationship edges in mocked graph, (6) test pagination (limit=10, offset=20 returns correct slice), (7) test complex query combining entityClass + team + property filters, mocking GraphDatabaseService | Restrictions: Must mock GraphDatabaseService with controlled test data; must achieve >85% code coverage; must test all query methods; must test edge cases (empty results, missing properties); team filtering must include "mixed" correctly | Success: All tests pass, >85% code coverage, all query methods tested, team filtering correct, property filtering handles nested access, aggregations accurate, relationship queries work, pagination correct, complex queries combine filters properly_
  - **Status**: ⏳ Not started

- [ ] 22. Create integration tests for end-to-end workflows
  - File: `src/ontology/__tests__/integration.test.ts`
  - Test full knowledge extraction with ontology: create exchange → extract → classify → validate → store → verify metadata
  - Test knowledge extraction without ontology: verify system works normally, no ontology metadata added
  - Test ontology-based retrieval: store knowledge with different entity classes → query by entity class → verify results
  - Test hybrid retrieval: store knowledge with similar content but different entity classes → semantic + ontology query → verify intersection
  - Test upper + lower ontology inheritance: RaaS team gets upper + RaaS entities, ReSi gets upper + ReSi entities, mixed gets all
  - Purpose: Validate complete ontology integration end-to-end with realistic workflows
  - _Leverage: Test fixtures with complete ontology files and realistic knowledge examples_
  - _Requirements: REQ-10.1 (Testing), REQ-10.3 (Integration Tests)_
  - _Prompt: Role: Integration Test Engineer specializing in end-to-end testing | Task: Write comprehensive integration tests that (1) test full extraction workflow with ontology enabled (create test exchange → processExchange → verify knowledge has ontology metadata with entityClass, confidence, validation), (2) test extraction with ontology disabled (verify no ontology metadata, system works normally), (3) test ontology-based retrieval (store 3 knowledge items with different entityClasses → query by RPU entity → verify only RPU items returned), (4) test hybrid retrieval (store items with similar text content but different entityClasses → semantic query + ontology filter → verify intersection correct), (5) test team inheritance (configure team="RaaS" → verify can classify as both upper and RaaS entities, not ReSi entities), using real ontology files and realistic test data | Restrictions: Must use complete test ontology files; must test all team configurations; must verify metadata structure correct; must test ontology enabled and disabled; must verify backward compatibility; must test realistic scenarios | Success: All integration tests pass, end-to-end workflows work correctly, ontology disabled mode works, team inheritance correct, hybrid retrieval intersects properly, backward compatible, realistic scenarios tested_
  - **Status**: ⏳ Not started

- [ ] 23. Create performance tests and benchmarks
  - File: `src/ontology/__tests__/performance.test.ts`
  - Measure ontology loading time: cold load vs cached load, verify caching improves load time >10x
  - Measure classification throughput: heuristic classifications/second, LLM classifications/second, batch vs individual
  - Measure query latency: simple query (entity class only), complex query (multiple filters), aggregation query
  - Measure memory usage with cached ontologies and 10k knowledge items
  - Purpose: Validate performance meets requirements and identify bottlenecks
  - _Leverage: Performance testing utilities; realistic data volumes_
  - _Requirements: REQ-11.1 (Performance), REQ-11.2 (Latency < 500ms)_
  - _Prompt: Role: Performance Engineer specializing in benchmarking and optimization | Task: Create performance test suite that (1) measures ontology loading (cold load first time, cached load subsequent, verify cached >10x faster), (2) measures classification throughput (heuristic >100/sec, LLM >10/sec, batch >50/sec vs individual 10/sec), (3) measures query latency (simple query p95 <100ms, complex query p95 <500ms, aggregation <200ms), (4) measures memory usage (baseline, with cached ontologies +50MB max, with 10k knowledge items +100MB max), (5) generates benchmark report with percentiles and throughput numbers, testing realistic workloads | Restrictions: Must test with realistic data volumes; must measure percentiles (p50, p95, p99); must verify against requirements (classification <500ms p95, query <100ms p95 simple); must measure memory overhead; must generate report | Success: Performance tests pass, ontology loading cached >10x faster, classification p95 <500ms, query latency p95 <100ms simple <500ms complex, memory overhead <50MB, throughput meets targets, benchmark report generated_
  - **Status**: ⏳ Not started

## Phase 5: Documentation & Polish (Week 6)

- [ ] 24. Write API documentation for all ontology components
  - Files: JSDoc comments in source files, generated API docs via TypeDoc
  - Document OntologyManager API: method signatures, parameters, return types, usage examples, error conditions
  - Document OntologyClassifier API: classification options, confidence thresholds, team scoping, batch classification
  - Document OntologyQueryEngine API: query methods, filter syntax, aggregations, relationships
  - Document configuration options: all fields explained, team-specific configuration, environment variables
  - Purpose: Provide comprehensive API documentation for developers
  - _Leverage: Design document API sections 5.1-5.3; TypeDoc for generation_
  - _Requirements: REQ-12.1 (Documentation), REQ-12.2 (API Docs)_
  - _Prompt: Role: Technical Writer specializing in API documentation | Task: Write comprehensive API documentation that (1) adds JSDoc comments to all public methods with @param, @returns, @throws, @example tags, (2) documents OntologyManager methods (loadOntology, resolveEntity, getAllEntityClasses) with examples and error conditions, (3) documents OntologyClassifier methods with classification options and confidence scoring explained, (4) documents OntologyQueryEngine methods with query syntax examples, (5) documents configuration structure with all fields and defaults, (6) generates API documentation using TypeDoc, following design document API sections | Restrictions: Must add JSDoc to all public methods; must include usage examples; must document all parameters and return types; must explain error conditions; TypeDoc must generate without errors; examples must be runnable | Success: All public APIs documented with JSDoc, usage examples provided, error conditions documented, TypeDoc generates complete docs, examples compile and run, configuration fully explained_
  - **Status**: ⏳ Not started

- [ ] 25. Write user guide for ontology system
  - File: `docs/ontology-integration-guide.md`
  - Write "Getting Started" section: enabling ontology system, configuration options, first classification
  - Write "Ontology Design" section: upper/lower structure, entity definitions, relationships, best practices
  - Write "Classification" section: heuristic vs LLM, confidence thresholds, team scoping, troubleshooting
  - Write "Validation" section: strict vs lenient mode, error interpretation, fixing validation errors
  - Write "Querying" section: ontology-based queries, hybrid queries, aggregations, common use cases
  - Purpose: Guide users through ontology system usage with practical examples
  - _Leverage: Design document sections 2-6 for concepts; generated PNG diagrams for visuals_
  - _Requirements: REQ-12.1 (Documentation), REQ-12.3 (User Guide)_
  - _Prompt: Role: Documentation Engineer specializing in user guides and tutorials | Task: Write comprehensive user guide following design document that (1) explains getting started with configuration examples, (2) describes ontology design with upper/lower structure and entity definition format, (3) explains classification with heuristic vs LLM approach and confidence scoring, (4) covers validation with strict/lenient modes and error fixing, (5) demonstrates querying with examples for common use cases, (6) includes architecture diagrams from design document, (7) provides troubleshooting section for common issues, making concepts accessible to developers | Restrictions: Must cover all major features; must include practical runnable examples; must use diagrams to clarify concepts; must address common issues in troubleshooting; must be accessible to developers new to ontologies | Success: Guide covers all features, examples practical and runnable, diagrams clarify concepts, troubleshooting addresses common issues, accessible to new users, well-organized sections_
  - **Status**: ⏳ Not started

- [ ] 26. Write migration guide for deployment
  - File: `docs/ontology-migration-guide.md`
  - Document phased rollout approach: Phase 1 enable alongside existing, Phase 2 monitor and tune, Phase 3 full integration
  - Document rollback procedure: disable via configuration, no data migration needed
  - Document backward compatibility guarantees: ontology is optional, existing functionality unchanged
  - Provide deployment checklist: configuration, ontology files, testing, monitoring
  - Purpose: Guide safe deployment of ontology system to production
  - _Leverage: Design document section 7.5 for migration strategy_
  - _Requirements: REQ-12.1 (Documentation), REQ-12.4 (Migration Guide)_
  - _Prompt: Role: DevOps Engineer specializing in safe system migrations | Task: Write migration guide following design section 7.5 that (1) describes phased rollout (Phase 1: enable with ontology disabled initially, Phase 2: enable gradually per team, Phase 3: full integration), (2) documents rollback procedure (set ontology.enabled=false, system continues working without ontology), (3) explains backward compatibility (ontology optional, existing tests pass, no breaking changes), (4) provides deployment checklist (verify config, validate ontology files, run tests, monitor metrics, have rollback plan), (5) describes monitoring and metrics to watch post-deployment, ensuring safe migration path | Restrictions: Must provide safe rollback path; must explain backward compatibility clearly; checklist must be complete; must address common deployment issues; must emphasize monitoring post-deployment | Success: Migration guide provides clear phased approach, rollback safe and tested, backward compatibility explained, deployment checklist complete, monitoring guidance provided, addresses common issues_
  - **Status**: ⏳ Not started

- [ ] 27. Perform code review and refactoring
  - Files: All ontology source files
  - Review all ontology code for clarity, consistent naming conventions, proper error handling, appropriate logging
  - Refactor complex methods for readability (extract helper methods, simplify conditionals)
  - Remove dead code and TODOs, address linter warnings
  - Verify TypeScript strict mode compliance, ensure comprehensive JSDoc comments
  - Purpose: Ensure code quality and maintainability before release
  - _Leverage: ESLint and TypeScript linter configurations_
  - _Requirements: REQ-13.1 (Code Quality)_
  - _Prompt: Role: Senior Code Reviewer specializing in TypeScript and code quality | Task: Perform comprehensive code review that (1) reviews all ontology code for clarity and readability, (2) ensures consistent naming conventions across all files, (3) verifies error handling is comprehensive and appropriate, (4) checks logging is useful but not excessive, (5) refactors complex methods (>50 lines, cyclomatic complexity >10) into smaller functions, (6) removes dead code, commented code, and TODO markers, (7) addresses all ESLint and TypeScript warnings, (8) verifies strict mode compliance, using code review best practices | Restrictions: Must maintain existing functionality; must not introduce bugs; refactoring must improve readability; must pass all existing tests; must address all linter warnings; strict mode must be enabled | Success: All code reviewed, consistent style throughout, complex methods refactored, dead code removed, no linter warnings, strict mode compliant, code clarity improved, tests still pass_
  - **Status**: ⏳ Not started

- [ ] 28. Add monitoring and metrics collection
  - File: `src/ontology/metrics.ts`
  - Add metrics collection: classifications per second, classification latency histogram, classification confidence histogram, heuristic fallback rate, validation failure rate, query latency histogram, cache hit rate
  - Export metrics in Prometheus format for scraping
  - Create Grafana dashboard template with classification metrics, validation metrics, query metrics, cache metrics
  - Add audit logging: classification decisions, validation results, ontology modifications
  - Purpose: Enable monitoring and observability of ontology system in production
  - _Leverage: Design document section 9 for metrics design; Prometheus client library_
  - _Requirements: REQ-14.1 (Monitoring), REQ-14.2 (Metrics)_
  - _Prompt: Role: Observability Engineer specializing in metrics and monitoring | Task: Implement monitoring following design section 9 that (1) collects metrics (classifications/sec counter, classification latency histogram with p50/p95/p99, confidence histogram, heuristic fallback rate, validation failure rate, query latency histogram, cache hit rate), (2) exports metrics in Prometheus format on /metrics endpoint, (3) creates Grafana dashboard JSON template with panels for all metrics, (4) adds structured audit logging (classification decisions with entity/confidence/method, validation results with errors, ontology modifications with timestamp/user), (5) documents monitoring setup, using Prometheus client library | Restrictions: Must export standard Prometheus format; dashboard must be importable; metrics must have proper labels (team, entityClass); audit logs must be structured JSON; must not impact performance; must document metric meanings | Success: All metrics collected and exported, Prometheus scrapes successfully, Grafana dashboard imports and displays metrics, audit logs capture important events, performance impact <5ms per operation, monitoring documentation complete_
  - **Status**: ⏳ Not started

- [ ] 29. Perform security review
  - Files: All ontology source files, configuration files
  - Review ontology file access controls: ensure `.data/ontologies/` is git-ignored, verify file permissions restrictive
  - Review LLM prompt injection risks: sanitize knowledge content before classification, validate LLM responses
  - Review sensitive data handling: ensure ontology metadata doesn't leak PII, check logging doesn't expose sensitive info
  - Document security considerations for deployment
  - Purpose: Ensure ontology system is secure and protects sensitive data
  - _Leverage: Design document section 8 for security considerations_
  - _Requirements: REQ-15.1 (Security), REQ-15.2 (Data Protection)_
  - _Prompt: Role: Security Engineer specializing in application security and data protection | Task: Perform security review following design section 8 that (1) reviews ontology file access (verify .data/ontologies/ in .gitignore, check file permissions 600, ensure no secrets in ontologies), (2) reviews prompt injection risks (sanitize knowledge content before LLM classification, validate LLM responses against schema, limit LLM influence), (3) reviews data protection (verify no PII in ontology metadata, check audit logs sanitized, ensure sensitive content routed to local LLM), (4) reviews authentication and authorization (ontology access controls, team-based restrictions), (5) documents security best practices for deployment, identifying vulnerabilities | Restrictions: Must check all data flows; must verify PII protection; must validate LLM integration security; must ensure secrets not exposed; must document all findings; must provide remediation for issues | Success: No PII in ontology metadata or logs, ontology files properly secured, prompt injection risks mitigated, LLM responses validated, sensitive data protected, security documentation complete, no critical vulnerabilities_
  - **Status**: ⏳ Not started

- [ ] 30. Final testing and bug fixes
  - Files: All ontology source files and tests
  - Run full test suite: unit tests, integration tests, performance tests, verify all pass
  - Perform manual end-to-end testing with RaaS configuration, ReSi configuration, mixed configuration
  - Test edge cases and error scenarios: malformed ontologies, classification failures, validation errors, database failures
  - Fix any discovered bugs and verify fixes with tests
  - Purpose: Validate system readiness for production deployment
  - _Leverage: Complete test suite from Phase 4_
  - _Requirements: REQ-16.1 (Final Testing), REQ-16.2 (Bug Fixes)_
  - _Prompt: Role: QA Lead specializing in final release testing | Task: Perform final testing that (1) runs complete test suite (npm test) and verifies all tests pass, (2) performs manual E2E testing with RaaS config (extract knowledge → classify as RaaS entities → query → retrieve), (3) performs manual E2E testing with ReSi config, (4) performs manual E2E testing with mixed config (can classify as both teams), (5) tests error scenarios (corrupt ontology file → graceful degradation, LLM unavailable → heuristic fallback, validation fails strict mode → warning logged), (6) fixes discovered bugs with regression tests, (7) updates test suite to cover new scenarios, ensuring production readiness | Restrictions: Must test all team configurations; must test error scenarios; bug fixes must include tests; must verify acceptance criteria from tasks; must perform exploratory testing; regression tests must prevent issues | Success: All automated tests pass, manual testing reveals no critical bugs, error scenarios handled gracefully, bug fixes tested, acceptance criteria verified, system ready for production_
  - **Status**: ⏳ Not started

- [ ] 31. Prepare release and deploy to production
  - Files: CHANGELOG.md, version bump, release tag
  - Update CHANGELOG with all changes: new features, configuration changes, migration instructions, known limitations
  - Bump version number following semantic versioning (e.g., 2.0.0 for major features)
  - Tag release in git and create release notes
  - Deploy to staging environment and run smoke tests
  - Deploy to production with ontology disabled initially, enable gradually per team (ReSi → RaaS → mixed)
  - Monitor metrics and logs post-deployment for issues
  - Purpose: Release ontology integration to production safely
  - _Leverage: Design document section 7.5 for deployment strategy_
  - _Requirements: REQ-17.1 (Release), REQ-17.2 (Deployment)_
  - _Prompt: Role: Release Manager specializing in safe production deployments | Task: Prepare and execute release following design section 7.5 that (1) updates CHANGELOG with features (ontology system, classification, validation, querying), configuration changes, migration steps, (2) bumps version to 2.0.0 for major feature, (3) tags release in git and creates GitHub release notes, (4) deploys to staging with full ontology enabled and runs smoke tests, (5) deploys to production with ontology.enabled=false initially, (6) enables for ReSi team first (smaller, more controlled), monitors metrics, (7) enables for RaaS team, monitors, (8) enables for mixed team, full rollout, continuing to monitor metrics (classification accuracy, query latency, error rates), following phased rollout strategy | Restrictions: Must deploy to staging first; production must start with ontology disabled; must enable gradually per team; must monitor metrics continuously; must have rollback plan ready; must not disrupt existing functionality | Success: CHANGELOG complete, version tagged, release notes clear, staging deployment successful, production deployment phased, each phase monitored before next, no critical issues, metrics healthy, rollback plan ready if needed_
  - **Status**: ⏳ Not started

## Success Metrics

Post-deployment, track these metrics to validate success:

### Functional Metrics
- Classification accuracy > 85% (LLM) / > 90% (heuristic) on validation dataset
- Validation catch rate > 95% for malformed data with known issues
- Query recall > 90% for ontology-based retrieval on test queries

### Performance Metrics
- Classification latency p95 < 500ms (meets REQ-11.2)
- Query latency p95 < 100ms for simple queries, < 500ms for complex
- Memory overhead < 50MB with cached ontologies
- No degradation in knowledge extraction throughput

### Adoption Metrics
- > 50% of knowledge extractions successfully classified within 2 weeks
- > 10 ontology-based queries per day within 1 month
- Both RaaS and ReSi teams actively using team-specific ontologies

### Quality Metrics
- Test coverage > 85% across all ontology components
- Zero critical bugs reported in first 2 weeks post-deployment
- Documentation completeness > 90% (all features documented)

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-03 | Claude | Initial flattened tasks document based on requirements and design |
