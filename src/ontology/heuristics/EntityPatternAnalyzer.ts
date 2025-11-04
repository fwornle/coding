/**
 * EntityPatternAnalyzer - Layer 1: File/Artifact Detection
 *
 * Analyzes referenced files, paths, and artifacts to determine team ownership.
 * Uses two-step checking: (a) direct artifact match, (b) pattern matching.
 *
 * Performance: <1ms response time
 */

import { LayerResult, ArtifactMatch } from '../types.js';

/**
 * Artifact pattern for team identification
 */
interface ArtifactPattern {
  team: string;
  patterns: RegExp[];
  entityClassMap: Record<string, string>;
}

/**
 * Entity Pattern Analyzer for file/artifact detection
 */
export class EntityPatternAnalyzer {
  private readonly teamDirectories: Map<string, string[]>;
  private readonly artifactPatterns: ArtifactPattern[];

  constructor() {
    // Define team-specific directories
    this.teamDirectories = new Map([
      [
        'Coding',
        [
          'src/ontology',
          'src/knowledge-management',
          'src/live-logging',
          'scripts',
          '.specstory',
        ],
      ],
      ['RaaS', ['raas-service', 'orchestration-engine', 'event-mesh']],
      [
        'ReSi',
        ['virtual-target', 'embedded-functions', 'reprocessing-engine'],
      ],
      [
        'Agentic',
        ['agent-frameworks', 'rag-systems', 'llm-integration'],
      ],
      [
        'UI',
        ['curriculum-alignment', 'aws-lambda', 'multi-agent-system'],
      ],
    ]);

    // Define artifact patterns for pattern-based matching
    this.artifactPatterns = [
      {
        team: 'Coding',
        patterns: [
          /LSL(Session|Monitor|Classifier)/i,
          /Constraint(Rule|Monitor|Hook)/i,
          /Trajectory(State|Generator)/i,
          /MCP(Agent|Service|Tool)/i,
          /Knowledge(Entity|Retriever|Extractor)/i,
        ],
        entityClassMap: {
          LSL: 'LSLSession',
          Constraint: 'ConstraintRule',
          Trajectory: 'TrajectoryState',
          MCP: 'MCPAgent',
          Knowledge: 'KnowledgeEntity',
        },
      },
      {
        team: 'RaaS',
        patterns: [
          /Kubernetes(Cluster|Pod|Service)/i,
          /Argo(Workflow|Template)/i,
          /EventMesh(Node|Producer|Consumer)/i,
          /Prometheus(Metric)/i,
          /Grafana(Dashboard)/i,
        ],
        entityClassMap: {
          Kubernetes: 'KubernetesCluster',
          Argo: 'ArgoWorkflowTemplate',
          EventMesh: 'EventMeshNode',
          Prometheus: 'PrometheusMetric',
          Grafana: 'GrafanaDashboard',
        },
      },
      {
        team: 'ReSi',
        patterns: [
          /VirtualTarget|EmbeddedFunction/i,
          /MF4Container|MCAPContainer/i,
          /ProtobufSPP|KaitaiBinaryBlob/i,
          /FunctionOrchestrator/i,
          /CompilationProfile|TimingModel/i,
        ],
        entityClassMap: {
          Virtual: 'VirtualTarget',
          Embedded: 'EmbeddedFunction',
          MF4: 'MF4Container',
          MCAP: 'MCAPContainer',
          Protobuf: 'ProtobufSPP',
          Function: 'FunctionOrchestrator',
          Compilation: 'CompilationProfile',
        },
      },
      {
        team: 'Agentic',
        patterns: [
          /LangChain|CrewAI|PydanticAI/i,
          /RAG(System|Architecture)/i,
          /AgentFramework|AgentWorkflow/i,
          /MCP|ACP|A2A/i,
          /VectorStore|KnowledgeGraph/i,
        ],
        entityClassMap: {
          LangChain: 'AgentFramework',
          RAG: 'RAGSystem',
          Agent: 'AgentFramework',
          Vector: 'VectorStore',
          Knowledge: 'KnowledgeGraph',
        },
      },
      {
        team: 'UI',
        patterns: [
          /Lambda(Function)?|StepFunction/i,
          /APIGateway|EventBridge/i,
          /React(Component)?|Redux/i,
          /MultiAgent|AgentCoordinator/i,
          /Curriculum(Entity|Alignment)/i,
        ],
        entityClassMap: {
          Lambda: 'AWSLambdaFunction',
          Step: 'AWSStepFunction',
          API: 'APIGatewayEndpoint',
          Event: 'EventBridgeRule',
          React: 'ReactComponent',
          Redux: 'ReduxState',
          Agent: 'AgentInstance',
          Curriculum: 'CurriculumEntity',
        },
      },
    ];
  }

  /**
   * Analyze entity patterns in knowledge content
   *
   * @param knowledge - Knowledge content to analyze
   * @returns LayerResult if artifact match found, null otherwise
   */
  analyzeEntityPatterns(knowledge: {
    id: string;
    content: string;
  }): LayerResult | null {
    const start = performance.now();

    // Extract file paths and artifact references from knowledge content
    const artifacts = this.extractArtifacts(knowledge.content);

    if (artifacts.length === 0) {
      return null; // No artifacts found
    }

    // Try each artifact
    for (const artifact of artifacts) {
      // Step (a): Check if artifact exists in specific team repository
      const localMatch = this.checkLocalArtifact(artifact);
      if (localMatch) {
        return {
          layer: 1,
          layerName: 'EntityPatternAnalyzer',
          entityClass: localMatch.entityClass,
          team: localMatch.team,
          confidence: 0.9, // High confidence for direct artifact match
          processingTime: performance.now() - start,
          evidence: `Referenced artifact '${artifact}' belongs to ${localMatch.team} team`,
        };
      }

      // Step (b): Search for artifact pattern indicating team ownership
      const patternMatch = this.matchArtifactPattern(artifact);
      if (patternMatch) {
        return {
          layer: 1,
          layerName: 'EntityPatternAnalyzer',
          entityClass: patternMatch.entityClass,
          team: patternMatch.team,
          confidence: 0.75, // Medium-high confidence for pattern match
          processingTime: performance.now() - start,
          evidence: `Artifact pattern '${artifact}' matches ${patternMatch.team} conventions`,
        };
      }
    }

    return null; // No artifact evidence found
  }

  /**
   * Extract file paths, URLs, module names, and class names from content
   *
   * @param content - Knowledge content
   * @returns Array of extracted artifacts
   */
  private extractArtifacts(content: string): string[] {
    const artifacts = new Set<string>();

    // Extract file paths (e.g., src/ontology/types.ts)
    const filePathPattern =
      /[a-z-]+\/[a-z-]+\/[a-zA-Z0-9_\-\/]+\.(ts|js|cpp|java|tsx|jsx|py|go|rs)/g;
    const filePaths = content.match(filePathPattern) || [];
    filePaths.forEach((path) => artifacts.add(path));

    // Extract npm packages (e.g., @langchain/core)
    const npmPattern = /@[a-z-]+\/[a-z-]+/g;
    const npmPackages = content.match(npmPattern) || [];
    npmPackages.forEach((pkg) => artifacts.add(pkg));

    // Extract class names with Service/Agent/Manager suffix
    const classPattern = /[A-Z][a-zA-Z]+(Service|Agent|Manager|Engine|Handler|Analyzer|Classifier|Filter|Monitor)/g;
    const classNames = content.match(classPattern) || [];
    classNames.forEach((cls) => artifacts.add(cls));

    // Extract file paths with directories only (e.g., scripts/, src/ontology/)
    const dirPattern = /[a-z-]+\/[a-z-]+\//g;
    const dirs = content.match(dirPattern) || [];
    dirs.forEach((dir) => artifacts.add(dir));

    return Array.from(artifacts);
  }

  /**
   * Check if artifact exists in team-specific directories
   *
   * @param artifact - Artifact path or name
   * @returns ArtifactMatch if found, null otherwise
   */
  private checkLocalArtifact(artifact: string): ArtifactMatch | null {
    for (const [team, dirs] of this.teamDirectories.entries()) {
      if (dirs.some((dir) => artifact.startsWith(dir))) {
        return {
          team,
          entityClass: this.inferEntityClass(artifact, team),
          confidence: 0.9,
        };
      }
    }

    return null;
  }

  /**
   * Match artifact against team-specific patterns
   *
   * @param artifact - Artifact name or path
   * @returns ArtifactMatch if pattern matches, null otherwise
   */
  private matchArtifactPattern(artifact: string): ArtifactMatch | null {
    for (const { team, patterns, entityClassMap } of this.artifactPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(artifact)) {
          // Infer entity class from artifact name
          const entityClass = this.inferEntityClassFromPattern(
            artifact,
            entityClassMap
          );
          return {
            team,
            entityClass,
            confidence: 0.75,
          };
        }
      }
    }

    return null;
  }

  /**
   * Infer entity class from artifact path or name
   *
   * @param artifact - Artifact path or name
   * @param team - Team owner
   * @returns Inferred entity class
   */
  private inferEntityClass(artifact: string, team: string): string {
    // Extract filename from path
    const filename = artifact.split('/').pop() || artifact;

    // Map common prefixes/suffixes to entity classes by team
    const teamMappings: Record<string, Record<string, string>> = {
      Coding: {
        LSL: 'LSLSession',
        Constraint: 'ConstraintRule',
        Trajectory: 'TrajectoryState',
        Knowledge: 'KnowledgeEntity',
        MCP: 'MCPAgent',
      },
      RaaS: {
        Kubernetes: 'KubernetesCluster',
        Argo: 'ArgoWorkflowTemplate',
        Event: 'EventMeshNode',
        Prometheus: 'PrometheusMetric',
      },
      ReSi: {
        Virtual: 'VirtualTarget',
        Embedded: 'EmbeddedFunction',
        MF4: 'MF4Container',
        MCAP: 'MCAPContainer',
      },
      Agentic: {
        Agent: 'AgentFramework',
        RAG: 'RAGSystem',
        LLM: 'LLMProvider',
        Vector: 'VectorStore',
      },
      UI: {
        Lambda: 'AWSLambdaFunction',
        React: 'ReactComponent',
        Redux: 'ReduxState',
        Agent: 'AgentInstance',
      },
    };

    const mapping = teamMappings[team] || {};
    for (const [prefix, entityClass] of Object.entries(mapping)) {
      if (filename.includes(prefix)) {
        return entityClass;
      }
    }

    // Default entity class if no specific mapping found
    return `${team}Artifact`;
  }

  /**
   * Infer entity class from pattern match
   *
   * @param artifact - Artifact name
   * @param entityClassMap - Entity class mapping
   * @returns Inferred entity class
   */
  private inferEntityClassFromPattern(
    artifact: string,
    entityClassMap: Record<string, string>
  ): string {
    for (const [key, entityClass] of Object.entries(entityClassMap)) {
      if (artifact.includes(key)) {
        return entityClass;
      }
    }

    // Default if no match
    return 'Unknown';
  }
}
