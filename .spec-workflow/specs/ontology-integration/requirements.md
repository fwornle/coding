# Requirements: Ontology-Based Knowledge Management for Cluster Reprocessing

**Feature ID**: `ONTO-001`
**Priority**: High
**Status**: Draft
**Created**: 2025-01-03
**Domain**: Knowledge Management, Vehicle Data Reprocessing

---

## Executive Summary

Integrate a configurable ontology system into the StreamingKnowledgeExtractor to capture and organize domain knowledge across multiple domains. The system shall support an upper ontology representing the Cluster Reprocessing (RPR) domain and team-specific lower ontologies for five teams:

- **RaaS Team**: Cloud orchestration for vehicle data reprocessing
- **ReSi Team**: Virtual target development for embedded ADAS functions
- **Coding Team**: Knowledge management infrastructure (LSL, constraints, trajectory, MCP)
- **Agentic Team**: AI agent frameworks, RAG systems, and communication protocols
- **UI Team**: Multi-agent curriculum alignment system with AWS serverless architecture

The ontology system enables domain-specific knowledge classification, semantic queries, and team-scoped knowledge retrieval.

---

## 1. Business Context

### 1.1 Problem Statement

The current knowledge management system lacks domain structure for vehicle data reprocessing concepts. Knowledge is classified into generic types (coding_pattern, bug_solution, etc.) without understanding reprocessing-specific entities like:
- Recorded sensor data and trace formats
- Virtual targets and RPUs (Reprocessing Units)
- Data quality frameworks and KPI evaluation
- Orchestration workflows and cloud infrastructure

This limits:
- Discoverability of reprocessing-specific knowledge
- Cross-team knowledge sharing between RaaS and ReSi
- Semantic queries about domain concepts
- Integration with team-specific tooling and workflows

### 1.2 Stakeholders

| Stakeholder | Interest | Impact |
|------------|----------|--------|
| RaaS Team (Java/Cloud) | Cloud orchestration knowledge capture | High |
| ReSi Team (C++/Embedded) | Virtual target development patterns | High |
| Data Engineers | Data format and quality knowledge | Medium |
| Function Developers | ADAS function validation patterns | Medium |
| Knowledge Management System | Ontology infrastructure | High |

### 1.3 Success Criteria

1. **Domain Coverage**: Ontology covers ≥80% of core reprocessing concepts
2. **Classification Accuracy**: ≥85% of knowledge correctly classified to ontology classes
3. **Team Adoption**: Both RaaS and ReSi teams using team-specific ontologies
4. **Query Improvement**: 50% improvement in semantic query precision for domain concepts
5. **Performance**: <100ms overhead for ontology classification per knowledge extraction

---

## 2. Domain Analysis: Cluster Reprocessing (RPR)

### 2.1 Domain Overview

**Cluster Reprocessing** is the ecosystem of tools and services for replaying vehicle-recorded sensor and ECU data through virtual targets to validate ADAS/AD functions.

**Core Process Flow**:
```
Recorded Data → Normalization → Reprocessing → KPI Computation → Safety Assessment (SOTIF)
```

**Execution Contexts**:
- **Local Reprocessing**: Developer machines for rapid iteration
- **Cloud Reprocessing**: Petabyte-scale validation in AWS using Kubernetes

### 2.2 Key Domain Concepts

#### 2.2.1 Data Layer

**RecordedData**:
- **Sources**: Sensor data (camera, radar, lidar), SOME/IP traces, MIPI camera streams
- **Container Formats**:
  - MF4 (recording format on embedded target, may be fragmented)
  - MCAP (normalized data processing format)
- **Payload Formats**:
  - Protobuf/SPP (Serialized Protobuf Protocol)
  - Kaitai-described binary blobs (architecture/compiler-specific)
- **Metadata**: JSON
- **Storage**: S3 buckets (cloud), local filesystem (dev)

**Data Quality**:
- R-DQ (RaaS Data Quality) framework validates data fitness
- Configurable quality criteria via YAML
- Only sufficient-quality data is reprocessed

**Data Normalization**:
- Unfragments MF4 data
- Converts to Protobuf/SPP encoding
- Outputs to MCAP container format
- Handles architecture-specific binary blobs

#### 2.2.2 Reprocessing Layer

**Virtual Target**:
- Software representation of vehicle ECU
- Reads from trace files, writes outputs to trace files
- Runs locally (developer) or in cloud (validation)

**RPU (Reprocessing Unit)**:
- Dockerized virtual target
- Orchestrated on Kubernetes cluster
- Stored in Artifactory binary server
- Versioned for reproducibility

**Compound Reprocessing**:
- Entire sensor + AD-ECU system in DAG
- Coordinated multi-RPU execution
- Managed by Argo Workflows

#### 2.2.3 Orchestration Layer (RaaS)

**RaaS (Reprocessing as a Service)**:
- Java-based orchestration engine
- Event-based data mesh architecture on AWS
- REST API for configuration submission
- Manages:
  - RPU scheduling on Kubernetes
  - Data set selection for reprocessing
  - Version management for RPUs
  - Workflow execution via Argo

**Configuration**:
- YAML-based declarative configs
- Specifies: datasets, RPU versions, execution parameters
- Posted via REST endpoints

**Monitoring & Observability**:
- Prometheus for metrics collection
- Grafana dashboards for visualization
- FinOps (Financial Operations) monitoring

**Data Caching**:
- Performance optimization for repeated processing
- Intermediate result storage

#### 2.2.4 Evaluation Layer

**KPI Framework**:
- Triggering layer around RaaS
- Python-based evaluation scripts (Dockerized)
- Processes:
  - Signal extraction from reprocessed outputs
  - KPI computation for function fitness
  - Safety assessment (SOTIF compliance)
- Configuration specifies:
  - Interval sets for reprocessing
  - KPI docker container versions
  - Evaluation criteria

**SOTIF (Safety of the Intended Functionality)**:
- Validates function behavior meets safety requirements
- Assesses false positives/negatives
- Endurance run analysis

#### 2.2.5 Function Validation Domains

**ADAS Functions**:
- AEB (Automatic Emergency Braking)
- Road marking detection
- Obstacle detection
- Lane keeping assistance
- Adaptive cruise control

---

## 3. Upper Ontology: Cluster Reprocessing (RPR)

### 3.1 Entity Classes

```yaml
# Upper Ontology: "cluster-reprocessing" (cluster-rpr)
version: "1.0.0"
domain: "Vehicle Data Reprocessing & ADAS Validation"

entities:

  # ============================================================================
  # DATA DOMAIN
  # ============================================================================

  RecordedData:
    description: "Vehicle-recorded sensor and ECU data"
    properties:
      sources:
        type: "array"
        items: ["camera", "radar", "lidar", "SOME/IP", "MIPI"]
      containerFormat:
        type: "enum"
        values: ["MF4", "MCAP"]
      payloadFormat:
        type: "enum"
        values: ["Protobuf/SPP", "Kaitai-Binary"]
      metadata:
        type: "JSON"
      duration:
        type: "number"
        unit: "seconds"
      fragmented:
        type: "boolean"
        description: "Whether data is fragmented (common in MF4)"
      storageLocation:
        type: "enum"
        values: ["S3", "Local"]
      dataQuality:
        type: "number"
        min: 0.0
        max: 1.0

  DataSet:
    description: "Collection of RecordedData for testing/validation"
    properties:
      name: { type: "string" }
      purpose:
        type: "enum"
        values: ["endurance-run", "scenario-specific", "regression", "validation"]
      recordingCount: { type: "number" }
      totalSize: { type: "number", unit: "bytes" }
      qualityCriteria: { type: "JSON" }

  DataQualityMetric:
    description: "Measures data fitness for reprocessing"
    properties:
      metricType:
        type: "enum"
        values: ["completeness", "accuracy", "consistency", "temporal-alignment"]
      threshold: { type: "number" }
      evaluationResult: { type: "boolean" }

  NormalizationLayer:
    description: "Transforms fragmented/raw data to normalized format"
    properties:
      inputFormat: { type: "string" }
      outputFormat: { type: "string", default: "SPP@MCAP" }
      transformations: { type: "array", items: "string" }

  # ============================================================================
  # REPROCESSING DOMAIN
  # ============================================================================

  VirtualTarget:
    description: "Software representation of vehicle ECU"
    properties:
      ecuType:
        type: "enum"
        values: ["AD-ECU", "ADAS-ECU", "Perception-ECU", "Planning-ECU"]
      architecture:
        type: "enum"
        values: ["x86-64", "ARM64"]
      sourceCodeVersion: { type: "string" }
      runtimeEnvironment:
        type: "enum"
        values: ["local", "cloud"]
      includesMiddleware: { type: "boolean", default: false }

  RPU:
    description: "Reprocessing Unit - Dockerized virtual target"
    properties:
      imageId: { type: "string" }
      imageTag: { type: "string" }
      artifactoryPath: { type: "string" }
      virtualTarget: { type: "reference", to: "VirtualTarget" }
      resourceRequirements:
        cpu: { type: "string", example: "2000m" }
        memory: { type: "string", example: "4Gi" }

  CompoundReprocessing:
    description: "Entire sensor + ECU system in execution DAG"
    properties:
      rpuComponents: { type: "array", items: "reference-to-RPU" }
      dagDefinition: { type: "JSON" }
      executionMode:
        type: "enum"
        values: ["sequential", "parallel", "hybrid"]

  ReprocessingExecution:
    description: "Instance of reprocessing run"
    properties:
      executionId: { type: "string" }
      dataset: { type: "reference", to: "DataSet" }
      rpu: { type: "reference", to: "RPU" }
      status:
        type: "enum"
        values: ["pending", "running", "completed", "failed"]
      startTime: { type: "ISO8601" }
      endTime: { type: "ISO8601" }
      outputLocation: { type: "string" }

  # ============================================================================
  # ORCHESTRATION DOMAIN
  # ============================================================================

  OrchestrationEngine:
    description: "System managing reprocessing execution"
    properties:
      engineType:
        type: "enum"
        values: ["RaaS", "LocalOrchestrator"]
      architecture:
        type: "string"
        example: "event-based-data-mesh"

  WorkflowDefinition:
    description: "Argo Workflow for reprocessing orchestration"
    properties:
      workflowType:
        type: "enum"
        values: ["compound-reprocessing", "single-rpu", "kpi-evaluation"]
      argoYaml: { type: "string" }
      dependencies: { type: "array", items: "string" }

  KubernetesResource:
    description: "K8s resources for execution"
    properties:
      resourceType:
        type: "enum"
        values: ["Pod", "Job", "Deployment", "Service"]
      namespace: { type: "string" }
      resourceYaml: { type: "string" }

  ConfigurationFile:
    description: "YAML configuration for reprocessing/KPI"
    properties:
      configType:
        type: "enum"
        values: ["reprocessing", "kpi-evaluation", "data-quality", "finops"]
      yamlContent: { type: "string" }
      submissionEndpoint: { type: "string" }

  # ============================================================================
  # EVALUATION DOMAIN
  # ============================================================================

  KPIFramework:
    description: "Triggering layer around RaaS for evaluation"
    properties:
      intervalSets: { type: "array", items: "reference-to-DataSet" }
      kpiContainerVersion: { type: "string" }
      evaluationScript: { type: "string" }

  KPIScript:
    description: "Dockerized Python evaluation script"
    properties:
      scriptName: { type: "string" }
      language: { type: "string", default: "Python" }
      dockerImage: { type: "string" }
      functionTarget:
        type: "enum"
        values: ["AEB", "RoadMarking", "ObstacleDetection", "LaneKeeping", "ACC"]

  SignalExtraction:
    description: "Extracts signals from reprocessed data for KPI computation"
    properties:
      signalNames: { type: "array", items: "string" }
      extractionMethod: { type: "string" }
      outputFormat: { type: "string" }

  SOTIFAssessment:
    description: "Safety of Intended Functionality validation"
    properties:
      functionName: { type: "string" }
      falsePositives: { type: "number" }
      falseNegatives: { type: "number" }
      safetyRequirementsMet: { type: "boolean" }
      enduranceRunAnalysis: { type: "JSON" }

  # ============================================================================
  # INFRASTRUCTURE DOMAIN
  # ============================================================================

  ArtifactoryServer:
    description: "Binary repository for RPU images"
    properties:
      serverUrl: { type: "string" }
      repositories: { type: "array", items: "string" }

  MonitoringSystem:
    description: "Observability infrastructure"
    properties:
      systemType:
        type: "enum"
        values: ["Prometheus", "Grafana", "CloudWatch"]
      metrics: { type: "array", items: "string" }

  DataCache:
    description: "Performance optimization cache"
    properties:
      cacheType:
        type: "enum"
        values: ["intermediate-results", "normalized-data", "kpi-outputs"]
      storageTier:
        type: "enum"
        values: ["memory", "ssd", "s3"]
      ttl: { type: "number", unit: "seconds" }

  FinOps:
    description: "Financial operations and cost optimization"
    properties:
      costCenter: { type: "string" }
      budgetLimit: { type: "number", unit: "USD" }
      costOptimizationRules: { type: "array", items: "JSON" }

relationships:
  # Data relationships
  contains: { from: "DataSet", to: "RecordedData", cardinality: "one-to-many" }
  validates: { from: "DataQualityMetric", to: "RecordedData", cardinality: "many-to-one" }
  normalizes: { from: "NormalizationLayer", to: "RecordedData", cardinality: "one-to-many" }
  produces: { from: "NormalizationLayer", to: "RecordedData", cardinality: "one-to-many" }

  # Reprocessing relationships
  implements: { from: "RPU", to: "VirtualTarget", cardinality: "many-to-one" }
  includes: { from: "CompoundReprocessing", to: "RPU", cardinality: "one-to-many" }
  executes: { from: "ReprocessingExecution", to: "RPU", cardinality: "many-to-one" }
  processes: { from: "ReprocessingExecution", to: "DataSet", cardinality: "many-to-one" }

  # Orchestration relationships
  orchestrates: { from: "OrchestrationEngine", to: "WorkflowDefinition", cardinality: "one-to-many" }
  schedules: { from: "WorkflowDefinition", to: "KubernetesResource", cardinality: "one-to-many" }
  runsOn: { from: "RPU", to: "KubernetesResource", cardinality: "many-to-one" }
  configuredBy: { from: "ReprocessingExecution", to: "ConfigurationFile", cardinality: "many-to-one" }

  # Evaluation relationships
  triggers: { from: "KPIFramework", to: "ReprocessingExecution", cardinality: "one-to-many" }
  evaluates: { from: "KPIScript", to: "ReprocessingExecution", cardinality: "many-to-one" }
  extracts: { from: "SignalExtraction", to: "RecordedData", cardinality: "many-to-many" }
  assesses: { from: "SOTIFAssessment", to: "KPIScript", cardinality: "one-to-one" }

  # Infrastructure relationships
  stores: { from: "ArtifactoryServer", to: "RPU", cardinality: "one-to-many" }
  monitors: { from: "MonitoringSystem", to: "ReprocessingExecution", cardinality: "one-to-many" }
  caches: { from: "DataCache", to: "RecordedData", cardinality: "many-to-many" }
  optimizes: { from: "FinOps", to: "ReprocessingExecution", cardinality: "one-to-many" }
```

---

## 4. Lower Ontology: RaaS Team (Cloud Orchestration)

### 4.1 Team Context

**Team**: RaaS (Reprocessing as a Service)
**Focus**: Petabyte-scale cloud orchestration, data quality, FinOps
**Tech Stack**: Java, AWS, Kubernetes, Argo Workflows, Prometheus, Grafana
**Architecture**: Event-based data mesh

### 4.2 Entity Classes

```yaml
# Lower Ontology: "raas"
extends: "cluster-reprocessing"
version: "1.0.0"
team: "RaaS"

entities:

  # ============================================================================
  # CLOUD ORCHESTRATION
  # ============================================================================

  EventMeshNode:
    description: "Node in event-based data mesh architecture"
    properties:
      nodeType:
        type: "enum"
        values: ["producer", "consumer", "processor", "router"]
      eventTopics: { type: "array", items: "string" }
      javaServiceClass: { type: "string" }

  ArgoWorkflowTemplate:
    description: "Reusable Argo workflow template"
    properties:
      templateName: { type: "string" }
      steps: { type: "array", items: "JSON" }
      parameters: { type: "JSON" }
      retryPolicy: { type: "JSON" }

  KubernetesCluster:
    description: "K8s cluster for RPU execution"
    properties:
      clusterName: { type: "string" }
      region: { type: "string", example: "us-east-1" }
      nodeGroups: { type: "array", items: "JSON" }
      scalingPolicy: { type: "JSON" }

  RESTEndpoint:
    description: "Configuration submission endpoint"
    properties:
      endpoint: { type: "string" }
      httpMethod:
        type: "enum"
        values: ["POST", "PUT", "GET", "DELETE"]
      requestSchema: { type: "JSON" }
      authentication: { type: "string" }

  # ============================================================================
  # DATA QUALITY & CACHING
  # ============================================================================

  RDQFramework:
    description: "RaaS Data Quality validation framework"
    properties:
      qualityRules: { type: "array", items: "JSON" }
      yamlConfigPath: { type: "string" }
      validationStrategy:
        type: "enum"
        values: ["pre-reprocessing", "post-normalization", "continuous"]

  CachingStrategy:
    description: "Data/result caching for performance"
    properties:
      strategyType:
        type: "enum"
        values: ["read-through", "write-through", "lazy-loading"]
      cacheTiers:
        type: "array"
        items: { type: "enum", values: ["memory", "ssd", "s3"] }
      evictionPolicy:
        type: "enum"
        values: ["LRU", "LFU", "TTL"]

  # ============================================================================
  # MONITORING & FINOPS
  # ============================================================================

  PrometheusMetric:
    description: "Prometheus metric definition"
    properties:
      metricName: { type: "string" }
      metricType:
        type: "enum"
        values: ["Counter", "Gauge", "Histogram", "Summary"]
      labels: { type: "JSON" }
      scrapeInterval: { type: "number", unit: "seconds" }

  GrafanaDashboard:
    description: "Grafana visualization dashboard"
    properties:
      dashboardId: { type: "string" }
      panels: { type: "array", items: "JSON" }
      dataSource: { type: "string" }
      refreshInterval: { type: "number", unit: "seconds" }

  CostOptimizationRule:
    description: "FinOps cost reduction strategy"
    properties:
      ruleName: { type: "string" }
      trigger: { type: "JSON" }
      action:
        type: "enum"
        values: ["scale-down", "spot-instances", "data-tiering", "cache-pruning"]
      expectedSavings: { type: "number", unit: "USD" }

  # ============================================================================
  # KPI EVALUATION LAYER
  # ============================================================================

  IntervalSet:
    description: "Time intervals for KPI evaluation"
    properties:
      intervalCount: { type: "number" }
      intervalDuration: { type: "number", unit: "seconds" }
      samplingStrategy:
        type: "enum"
        values: ["continuous", "random", "scenario-based"]

  KPITrigger:
    description: "Trigger configuration for KPI evaluation"
    properties:
      triggerCondition: { type: "JSON" }
      targetKPIScript: { type: "reference", to: "KPIScript" }
      priorityLevel:
        type: "enum"
        values: ["low", "medium", "high", "critical"]

relationships:
  # RaaS-specific relationships
  partOf: { from: "EventMeshNode", to: "OrchestrationEngine", cardinality: "many-to-one" }
  instantiates: { from: "ArgoWorkflowTemplate", to: "WorkflowDefinition", cardinality: "one-to-many" }
  runsOn: { from: "WorkflowDefinition", to: "KubernetesCluster", cardinality: "many-to-one" }
  submitsTo: { from: "ConfigurationFile", to: "RESTEndpoint", cardinality: "many-to-one" }
  validates: { from: "RDQFramework", to: "DataSet", cardinality: "one-to-many" }
  appliesTo: { from: "CachingStrategy", to: "DataCache", cardinality: "one-to-one" }
  collects: { from: "PrometheusMetric", to: "ReprocessingExecution", cardinality: "many-to-many" }
  visualizes: { from: "GrafanaDashboard", to: "PrometheusMetric", cardinality: "one-to-many" }
  applies: { from: "CostOptimizationRule", to: "KubernetesCluster", cardinality: "many-to-one" }
  defines: { from: "IntervalSet", to: "KPIFramework", cardinality: "many-to-one" }
```

---

## 5. Lower Ontology: ReSi Team (Virtual Target Development)

### 5.1 Team Context

**Team**: ReSi (Reprocessing Simulation)
**Focus**: Virtual target development, data format handling, embedded C++ orchestration
**Tech Stack**: C++, x86-64 architecture, MF4/MCAP, Protobuf/SPP
**Domain**: Close to embedded target code, no vehicle middleware

### 5.2 Entity Classes

```yaml
# Lower Ontology: "resi"
extends: "cluster-reprocessing"
version: "1.0.0"
team: "ReSi"

entities:

  # ============================================================================
  # EMBEDDED ORCHESTRATION
  # ============================================================================

  FunctionOrchestrator:
    description: "C++ orchestration layer for ECU functions"
    properties:
      ecuTarget: { type: "reference", to: "VirtualTarget" }
      orchestratedFunctions: { type: "array", items: "string" }
      executionOrder: { type: "array", items: "string" }
      timingConstraints: { type: "JSON" }

  EmbeddedFunction:
    description: "Single ADAS/AD function implementation"
    properties:
      functionName: { type: "string" }
      sourceCodePath: { type: "string" }
      cppStandard:
        type: "enum"
        values: ["C++11", "C++14", "C++17", "C++20"]
      compilationFlags: { type: "string" }
      memoryFootprint: { type: "number", unit: "bytes" }

  # ============================================================================
  # DATA FORMAT HANDLING
  # ============================================================================

  MF4Container:
    description: "MF4 recording format from embedded target"
    properties:
      version:
        type: "enum"
        values: ["4.0", "4.1", "4.2"]
      isFragmented: { type: "boolean" }
      channels: { type: "array", items: "JSON" }
      attachments: { type: "array", items: "string" }

  MCAPContainer:
    description: "MCAP normalized data processing format"
    properties:
      version: { type: "string" }
      schema: { type: "JSON" }
      compressionCodec:
        type: "enum"
        values: ["none", "lz4", "zstd"]
      unfragmented: { type: "boolean", default: true }

  ProtobufSPP:
    description: "Serialized Protobuf Protocol payload"
    properties:
      protoSchema: { type: "string" }
      sppVersion: { type: "string" }
      messageTypes: { type: "array", items: "string" }

  KaitaiBinaryBlob:
    description: "Architecture/compiler-specific binary data"
    properties:
      kaitaiDefinition: { type: "string" }
      architecture:
        type: "enum"
        values: ["x86-64", "ARM32", "ARM64", "RISC-V"]
      compilerVersion: { type: "string" }
      endianness:
        type: "enum"
        values: ["little", "big"]

  DataSerializer:
    description: "Serialization logic for embedded target"
    properties:
      serializationFormat: { type: "string" }
      targetArchitecture: { type: "string" }
      byteOrder: { type: "string" }

  # ============================================================================
  # NORMALIZATION LAYER
  # ============================================================================

  FragmentationHandler:
    description: "Handles MF4 data fragmentation"
    properties:
      fragmentationType:
        type: "enum"
        values: ["image", "video", "large-message"]
      reassemblyStrategy: { type: "string" }
      bufferSize: { type: "number", unit: "bytes" }

  FormatConverter:
    description: "Converts between data formats"
    properties:
      sourceFormat: { type: "string" }
      targetFormat: { type: "string", default: "SPP@MCAP" }
      conversionRules: { type: "JSON" }
      preservesMetadata: { type: "boolean" }

  # ============================================================================
  # TRACE FILE I/O
  # ============================================================================

  TraceFileReader:
    description: "Reads trace files for virtual target input"
    properties:
      supportedFormats: { type: "array", items: "string" }
      readStrategy:
        type: "enum"
        values: ["sequential", "random-access", "streaming"]
      bufferingPolicy: { type: "JSON" }

  TraceFileWriter:
    description: "Writes virtual target outputs to trace files"
    properties:
      outputFormat: { type: "string" }
      compressionEnabled: { type: "boolean" }
      flushStrategy:
        type: "enum"
        values: ["immediate", "buffered", "periodic"]

  # ============================================================================
  # DEVELOPMENT ENVIRONMENT
  # ============================================================================

  LocalDevelopmentSetup:
    description: "Developer machine configuration for local reprocessing"
    properties:
      osType:
        type: "enum"
        values: ["Linux", "Windows", "macOS"]
      compilerToolchain: { type: "string", example: "GCC-11" }
      localTraceFilePath: { type: "string" }
      debuggerConfiguration: { type: "JSON" }

  CompilationProfile:
    description: "Build configuration for virtual target"
    properties:
      targetArch: { type: "string", default: "x86-64" }
      optimizationLevel:
        type: "enum"
        values: ["O0", "O1", "O2", "O3", "Os"]
      includesMiddleware: { type: "boolean", default: false }
      linkage:
        type: "enum"
        values: ["static", "dynamic"]

  # ============================================================================
  # TIMING & SYNCHRONIZATION
  # ============================================================================

  TimingModel:
    description: "Real-time behavior model for virtual target"
    properties:
      executionMode:
        type: "enum"
        values: ["real-time", "as-fast-as-possible", "stepped"]
      clockSource: { type: "string" }
      synchronizationStrategy: { type: "JSON" }

  SOMEIPTrace:
    description: "SOME/IP protocol trace data"
    properties:
      serviceId: { type: "number" }
      methodId: { type: "number" }
      messageType:
        type: "enum"
        values: ["REQUEST", "RESPONSE", "EVENT", "ERROR"]
      payload: { type: "binary" }

relationships:
  # ReSi-specific relationships
  orchestrates: { from: "FunctionOrchestrator", to: "EmbeddedFunction", cardinality: "one-to-many" }
  implements: { from: "VirtualTarget", to: "FunctionOrchestrator", cardinality: "one-to-one" }
  containedIn: { from: "RecordedData", to: "MF4Container", cardinality: "many-to-one" }
  producesFrom: { from: "NormalizationLayer", to: "MF4Container", cardinality: "one-to-many" }
  outputsTo: { from: "NormalizationLayer", to: "MCAPContainer", cardinality: "one-to-many" }
  encodedAs: { from: "RecordedData", to: "ProtobufSPP", cardinality: "many-to-one" }
  describes: { from: "KaitaiBinaryBlob", to: "RecordedData", cardinality: "one-to-many" }
  uses: { from: "DataSerializer", to: "VirtualTarget", cardinality: "many-to-one" }
  handles: { from: "FragmentationHandler", to: "MF4Container", cardinality: "one-to-many" }
  converts: { from: "FormatConverter", to: "RecordedData", cardinality: "many-to-many" }
  reads: { from: "TraceFileReader", to: "VirtualTarget", cardinality: "many-to-one" }
  writes: { from: "TraceFileWriter", to: "VirtualTarget", cardinality: "many-to-one" }
  configures: { from: "LocalDevelopmentSetup", to: "VirtualTarget", cardinality: "one-to-many" }
  buildsUsing: { from: "VirtualTarget", to: "CompilationProfile", cardinality: "many-to-one" }
  appliesTo: { from: "TimingModel", to: "VirtualTarget", cardinality: "one-to-one" }
```

---

## 6. Lower Ontology: Coding Team (Knowledge Management Infrastructure)

### 6.1 Team Context

The **Coding Team** develops and maintains the knowledge management infrastructure for the coding project, including:
- Live Session Logging (LSL) with 4-layer monitoring and 5-layer classification
- Constraint Monitoring with 18 active constraints enforced via PreToolUse hooks
- Trajectory Generation with real-time state tracking and MCP-powered analysis
- Knowledge extraction, graph databases (Graphology + LevelDB), and vector search (Qdrant)
- MCP integrations: Semantic Analysis (10 agents), Serena AST Analysis, Constraint Monitor

### 6.2 Key Entity Classes

The coding lower ontology defines 18 entity classes extending the upper ontology:

**Session Management**:
- `LSLSession` - Live session logging with time-windowed conversation capture
- `ClassificationLayer` - 5-layer classification system (session filter, path, keyword, embedding, semantic)
- `TrajectoryState` - Real-time development trajectory states (exploring, implementing, verifying, etc.)

**Quality & Constraints**:
- `ConstraintRule` - Coding constraints with severity levels (critical, error, warning, info)
- `HookConfiguration` - PreToolUse/PostToolUse hook definitions for enforcement and logging
- `RedactionPattern` - Security patterns for sanitizing sensitive information

**Knowledge Management**:
- `KnowledgeEntity` - Graph nodes with observations and relationships
- `EmbeddingVector` - 384-dim (local Transformers.js) or 1536-dim (OpenAI) embeddings
- `GraphDatabase` - Graphology + LevelDB persistent graph storage
- `VectorDatabase` - Qdrant collections for semantic similarity search

**Infrastructure**:
- `MonitoringLayer` - 4-layer monitoring architecture (watchdog, coordinator, verifier, service)
- `MCPAgent` - Specialized agents in MCP Semantic Analysis Server (10 agents)
- `WorkflowDefinition` - Multi-agent workflow coordination with step dependencies
- `ConfigurationFile` - JSON/YAML configuration files for system components
- `PlantUMLDiagram` - Architecture diagrams with standardized styling

**Detailed Ontology**: See `.data/ontologies/lower/coding-ontology.json` for complete entity definitions, properties, and relationships.

---

## 7. Lower Ontology: Agentic Team (AI Agent Frameworks & RAG Systems)

### 7.1 Team Context

The **Agentic Team** focuses on AI agent frameworks, RAG (Retrieval Augmented Generation) systems, and agent communication protocols through a 6-week nanodegree curriculum:
- **Module 1**: Agent Frameworks (LangChain, LangGraph, CrewAI, PydanticAI, Atomic Agents, ADK, Agno)
- **Module 2**: RAG Architecture (basic RAG, graph RAG, agentic RAG, multimodal RAG)
- **Module 3**: Communication Protocols (MCP, ACP, A2A)
- Cloud development environments with pre-configured workspaces and API access

### 7.2 Key Entity Classes

The agentic lower ontology defines 15 entity classes extending the upper ontology:

**Agent Frameworks**:
- `AgentFramework` - AI agent libraries (LangChain, CrewAI, PydanticAI, etc.)
- `PromptTemplate` - Reusable prompt templates (system, user, few-shot, chain-of-thought, ReAct)
- `ToolDefinition` - Agent tool definitions for function calling
- `AgentWorkflow` - Multi-agent coordination patterns (sequential, parallel, hierarchical, graph, swarm)

**RAG Systems**:
- `RAGSystem` - RAG architectures (basic, graph, agentic, multimodal)
- `VectorStore` - Vector databases (Qdrant, Pinecone, Weaviate, ChromaDB, FAISS, Milvus)
- `KnowledgeGraph` - Graph structures for graph RAG (Neo4j, Neptune, ArangoDB, NetworkX)
- `EvaluationMetric` - RAG evaluation metrics (RAGAS, TruLens, LangSmith)

**Communication & Orchestration**:
- `CommunicationProtocol` - Agent protocols (MCP, ACP, A2A) with transport layers
- `LLMProvider` - LLM service integrations (OpenAI, Anthropic, Groq, Google, AWS Bedrock)

**Learning Resources**:
- `CourseModule` - Week-long modules in 6-week program
- `ModuleContent` - Learning materials (video, interactive notebooks, readings, labs, quizzes)
- `Exercise` - Coding exercises with difficulty levels
- `LabEnvironment` - Cloud development workspaces with pre-installed tools
- `DevelopmentSetup` - Pre-configured environments (Python, Docker, dependencies)

**Detailed Ontology**: See `.data/ontologies/lower/agentic-ontology.json` for complete entity definitions, properties, and relationships.

---

## 8. Lower Ontology: UI Team (Multi-Agent Curriculum Alignment System)

### 8.1 Team Context

The **UI Team** develops the Multi-Agent Curriculum Alignment System (MACAS) for Central European University (CEU):
- **8 Specialized Agents**: Coordinator, Web Search, Browser (Stagehand/MCP), Document Processing, Accreditation Expert, QA, Semantic Search, Chat Interface
- **AWS Serverless**: Lambda functions, API Gateway, Step Functions, EventBridge, S3, CloudFront
- **Databases**: PostgreSQL (Supabase/Neon), Qdrant vector database
- **Frontend**: React 18 + Redux + Tailwind CSS + TypeScript
- **Purpose**: Automate curriculum alignment, gap analysis, and peer university comparisons

### 8.2 Key Entity Classes

The ui lower ontology defines 18 entity classes extending the upper ontology:

**Multi-Agent System**:
- `AgentInstance` - 8 specialized agents with configurable LLM models
- `WorkflowOrchestration` - Multi-agent workflows (sequential, parallel, conditional, event-driven)
- `LLMConfiguration` - Model selection per agent (OpenAI, Anthropic, Groq for cost optimization)

**AWS Serverless Infrastructure**:
- `AWSLambdaFunction` - Serverless compute (Node.js 20.x, Python 3.11)
- `AWSStepFunction` - Workflow orchestration with ASL (Amazon States Language)
- `APIGatewayEndpoint` - REST API endpoints with authentication (Cognito, API key, IAM)
- `EventBridgeRule` - Event-driven triggers (S3 events, scheduled cron)
- `S3Bucket` - File storage (document upload, report export, static assets, backup)
- `CloudFrontDistribution` - CDN for frontend and API distribution

**Data Management**:
- `PostgreSQLSchema` - Database schemas (Supabase/Neon) for users, programs, courses, curricula
- `QdrantCollection` - Vector collections for semantic search (configurable embedding models like Grok)
- `DocumentParser` - Excel/Word/PDF processing with LLM enhancement
- `CurriculumEntity` - Academic entities (courses, programs, learning outcomes, modules, assessments)

**Frontend**:
- `ReactComponent` - UI components (pages, containers, presentational, layout, utility)
- `ReduxState` - State management slices (curriculum, analysis, loading states)
- `TailwindStyle` - CEU brand theme (institutional colors, typography, responsive design)

**Analysis & Reporting**:
- `SemanticSearchQuery` - Natural language queries with vector embeddings and filters
- `GapAnalysisReport` - Gap analysis and peer comparison reports (Excel, Word, PDF export)

**Detailed Ontology**: See `.data/ontologies/lower/ui-ontology.json` for complete entity definitions, properties, and relationships.

---

## 9. Functional Requirements

### FR-1: Ontology Management System

**Priority**: MUST HAVE

#### FR-1.1: Ontology Loading & Parsing
- System SHALL load ontology definitions from JSON files
- System SHALL support upper ontology and multiple lower ontologies
- System SHALL resolve lower ontology inheritance from upper ontology
- System SHALL validate ontology schema on load

#### FR-1.2: Ontology Query API
- System SHALL provide API to query entity types by ontology (upper/lower)
- System SHALL provide API to query relationship types
- System SHALL provide API to resolve team-specific ontology
- System SHALL cache ontology lookups for performance

#### FR-1.3: Ontology Validation
- System SHALL validate entity properties against ontology schema
- System SHALL support optional validation modes: strict, warning, disabled
- System SHALL be configurable per team for validation strictness
- System SHALL return validation results with errors and warnings

---

### FR-2: Knowledge Classification with Ontology

**Priority**: MUST HAVE

#### FR-2.1: LLM-Based Classification
- StreamingKnowledgeExtractor SHALL classify knowledge using ontology classes
- System SHALL use team context to resolve appropriate ontology (resi/raas)
- System SHALL generate LLM prompts with ontology class definitions
- System SHALL extract ontology properties from knowledge text

#### FR-2.2: Confidence Scoring
- System SHALL assign confidence score to ontology classification (0-1)
- System SHALL require minimum confidence threshold (configurable, default 0.6)
- System SHALL log low-confidence classifications for review

#### FR-2.3: Fallback Strategy
- System SHALL fall back to heuristic classification if LLM unavailable
- System SHALL fall back to generic types if budget exceeded
- System SHALL mark fallback classifications with source metadata

---

### FR-3: Graph Database Integration

**Priority**: MUST HAVE

#### FR-3.1: Enhanced Entity Storage
- Graph database SHALL store ontology metadata in entity structure
- Entity SHALL include ontology field with: domain, class, team, properties
- System SHALL preserve backward compatibility with non-ontology entities

#### FR-3.2: Ontology-Based Queries
- System SHALL support queries filtering by ontology class
- System SHALL support queries filtering by ontology properties
- System SHALL support queries with team-specific ontology scope

#### FR-3.3: Relationship Semantics
- System SHALL support ontology-defined relationship types
- System SHALL validate relationships against ontology schema (if enabled)
- System SHALL allow traversing relationships by ontology type

---

### FR-4: Configuration System

**Priority**: MUST HAVE

#### FR-4.1: Ontology Configuration
- System SHALL load configuration from `.specstory/config/ontology-config.json`
- Configuration SHALL specify enabled/disabled state
- Configuration SHALL specify default upper ontology
- Configuration SHALL map teams to lower ontologies

#### FR-4.2: Validation Configuration
- Configuration SHALL specify validation mode per team
- Configuration SHALL specify whether to fail on validation errors
- Configuration SHALL allow disabling validation entirely

#### FR-4.3: Classification Configuration
- Configuration SHALL specify whether to use upper/lower ontologies
- Configuration SHALL specify minimum confidence threshold
- Configuration SHALL specify LLM budget allocation for classification

---

### FR-5: Query & Retrieval Enhancements

**Priority**: SHOULD HAVE

#### FR-5.1: Ontology-Aware Search
- KnowledgeRetriever SHALL support searching by ontology class
- KnowledgeRetriever SHALL support filtering by ontology properties
- KnowledgeRetriever SHALL support semantic search with ontology context

#### FR-5.2: Related Entity Discovery
- System SHALL support finding entities related by ontology relationships
- System SHALL support graph traversal with ontology relationship types
- System SHALL support depth-limited traversal with ontology filters

---

## 10. Non-Functional Requirements

### NFR-1: Performance

- Ontology classification SHALL add <100ms overhead per knowledge extraction
- Ontology query API SHALL return results in <50ms (cached)
- Ontology validation SHALL complete in <20ms per entity

### NFR-2: Scalability

- System SHALL support ontologies with up to 100 entity classes
- System SHALL support ontologies with up to 50 relationship types
- System SHALL support up to 10 team-specific lower ontologies

### NFR-3: Maintainability

- Ontology definitions SHALL be in human-readable JSON format
- Ontology changes SHALL not require code changes
- System SHALL provide CLI tools for ontology management

### NFR-4: Backward Compatibility

- Existing knowledge without ontology metadata SHALL continue to work
- System SHALL support gradual migration to ontology-based classification
- API SHALL maintain compatibility with non-ontology queries

### NFR-5: Extensibility

- System SHALL allow adding new ontology classes without code changes
- System SHALL allow adding new team ontologies via configuration
- System SHALL allow extending upper ontology in lower ontologies

---

## 11. Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

**Deliverables**:
- `OntologyManager.ts` - Load, parse, query ontologies
- `OntologyValidator.ts` - Validate entities against schema
- `types.ts` - TypeScript type definitions

**Tasks**:
1. Create ontology module structure
2. Implement JSON schema parser
3. Implement inheritance resolution
4. Implement validation engine
5. Write unit tests

### Phase 2: Ontology Definitions (Week 1-2)

**Deliverables**:
- `upper-cluster-reprocessing.json` - Upper ontology
- `lower-raas.json` - RaaS team ontology
- `lower-resi.json` - ReSi team ontology
- Documentation for ontology structure

**Tasks**:
1. Define upper ontology entities (25 classes)
2. Define upper ontology relationships (20 types)
3. Define RaaS lower ontology (15 classes)
4. Define ReSi lower ontology (18 classes)
5. Validate ontology completeness with domain experts

### Phase 3: Classification Integration (Week 2-3)

**Deliverables**:
- Enhanced `StreamingKnowledgeExtractor.js`
- `classification-prompts.ts` - LLM prompt templates
- Updated `KnowledgeStorageService.js`

**Tasks**:
1. Add ontologyManager to StreamingKnowledgeExtractor
2. Implement classifyWithOntology() method
3. Create LLM prompts for ontology classification
4. Update entity storage with ontology field
5. Write integration tests

### Phase 4: Query Enhancement (Week 3)

**Deliverables**:
- Enhanced `GraphDatabaseService.js`
- Enhanced `KnowledgeRetriever.js`
- New query methods for ontology-based retrieval

**Tasks**:
1. Add ontology filtering to queryEntities()
2. Implement searchByOntologyClass()
3. Implement findRelatedByOntology()
4. Add ontology context to semantic search
5. Write query tests

### Phase 5: Configuration & Testing (Week 4)

**Deliverables**:
- `ontology-config.json` - Configuration file
- Comprehensive test suite
- CLI tools for ontology management

**Tasks**:
1. Create configuration system
2. Implement CLI for ontology validation
3. Implement CLI for ontology visualization
4. Write E2E tests with real domain knowledge
5. Performance testing and optimization

### Phase 6: Documentation & Rollout (Week 4-5)

**Deliverables**:
- User guide for ontology system
- API reference documentation
- Migration guide for existing knowledge
- Team training materials

**Tasks**:
1. Write ontology user guide
2. Create API reference docs
3. Create migration scripts
4. Conduct team training sessions
5. Gradual rollout with monitoring

---

## 12. Testing Strategy

### Unit Tests
- Ontology loading and parsing
- Inheritance resolution
- Validation engine
- Classification logic

### Integration Tests
- StreamingKnowledgeExtractor with ontology
- Graph database with ontology metadata
- Query methods with ontology filters

### End-to-End Tests
- Real domain knowledge classification
- Team-specific ontology usage
- Cross-team knowledge sharing

### Performance Tests
- Classification overhead measurement
- Query performance with ontology filters
- Scalability with large ontologies

### User Acceptance Tests
- RaaS team validates cloud orchestration ontology
- ReSi team validates virtual target ontology
- Domain experts validate upper ontology completeness

---

## 13. Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| LLM classification errors | High | Medium | Heuristic fallback, human review queue |
| Ontology too rigid for evolving domain | High | Low | Extensible schema, easy to add classes |
| Performance degradation | Medium | Low | Caching, async processing, benchmarking |
| Team resistance to adoption | Medium | Medium | Optional per team, training, benefits demo |
| Ontology maintenance overhead | Low | Medium | Clear governance, CLI tools, versioning |
| Budget exceeded for classification | Medium | Low | Fallback to heuristics, budget monitoring |

---

## 14. Success Metrics

### Adoption Metrics
- % of knowledge classified with ontology (target: >80%)
- Number of teams using team-specific ontologies (target: 5 - RaaS, ReSi, Coding, Agentic, UI)
- Number of ontology-based queries per day (target: >100)

### Quality Metrics
- Classification accuracy (target: >85%)
- Validation pass rate (target: >90%)
- User satisfaction score (target: 4/5)

### Performance Metrics
- Classification latency (target: <100ms)
- Query latency (target: <50ms cached, <300ms uncached)
- System availability (target: >99.5%)

### Business Metrics
- Time to find relevant knowledge (target: -50%)
- Cross-team knowledge reuse (target: +30%)
- Reduction in duplicate knowledge (target: -20%)

---

## 15. Dependencies

### Internal Dependencies
- StreamingKnowledgeExtractor (existing)
- GraphDatabaseService (existing)
- UnifiedInferenceEngine (existing)
- Configuration system (existing)

### External Dependencies
- LLM providers (Groq, OpenRouter, Ollama)
- Domain experts for ontology validation
- Team coordinators for rollout support

### Technical Dependencies
- TypeScript 4.9+
- Node.js 18+
- JSON Schema validation library
- Graph database (Graphology + LevelDB)

---

## 16. Acceptance Criteria

### Must Have
- [ ] Upper ontology covers 80%+ of reprocessing domain concepts
- [ ] RaaS and ReSi lower ontologies validated by respective teams
- [ ] Coding, Agentic, and UI lower ontologies cover their respective domains (LSL/constraints, agent frameworks/RAG, multi-agent curriculum system)
- [ ] StreamingKnowledgeExtractor classifies knowledge using ontology
- [ ] Graph database stores and queries ontology-enriched entities
- [ ] Classification adds <100ms overhead
- [ ] Backward compatibility with non-ontology knowledge maintained

### Should Have
- [ ] Ontology-based semantic search implemented
- [ ] CLI tools for ontology management available
- [ ] Migration script for existing knowledge created
- [ ] Comprehensive documentation published

### Could Have
- [ ] Ontology visualization tool created
- [ ] Automated ontology extension suggestions
- [ ] Export/import for ontology definitions

---

## 17. Out of Scope

- Integration with external ontology repositories (OWL, SKOS)
- Automated ontology learning from unstructured text
- Multi-version ontology support (only single version per team)
- Real-time collaborative ontology editing
- Fine-grained access control per ontology class

---

## 18. Glossary

| Term | Definition |
|------|------------|
| **Cluster Reprocessing (RPR)** | Ecosystem of tools for replaying vehicle data through virtual targets |
| **RaaS** | Reprocessing as a Service - cloud orchestration engine (Java, AWS) |
| **ReSi** | Reprocessing Simulation - virtual target development team (C++, embedded) |
| **RPU** | Reprocessing Unit - Dockerized virtual target container |
| **Compound Reprocessing** | Entire sensor + ECU system in execution DAG |
| **MF4** | Recording format on embedded target (may be fragmented) |
| **MCAP** | Normalized data processing format (unfragmented) |
| **Protobuf/SPP** | Serialized Protobuf Protocol payload encoding |
| **SOME/IP** | Scalable service-Oriented MiddlewarE over IP protocol |
| **SOTIF** | Safety of the Intended Functionality |
| **R-DQ** | RaaS Data Quality framework |
| **FinOps** | Financial Operations and cost optimization |
| **KPI Framework** | Evaluation triggering layer around RaaS |

---

## 19. References

- StreamingKnowledgeExtractor: `src/knowledge-management/StreamingKnowledgeExtractor.js`
- GraphDatabaseService: `src/knowledge-management/GraphDatabaseService.js`
- Continuous Learning System: `docs/knowledge-management/continuous-learning-system.md`
- Ontology research (from agent): Comprehensive analysis of current system

---

**Document Version**: 1.0
**Last Updated**: 2025-01-03
**Author**: AI Assistant (Claude)
**Approved By**: [Pending]
**Next Review**: [After Phase 2 completion]
