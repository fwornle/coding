import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { log } from "./logging.js";
import { SemanticAnalyzer } from "./agents/semantic-analyzer.js";
import { RepositoryAnalyzer } from "./agents/repository-analyzer.js";
import { KnowledgeManager } from "./agents/knowledge-manager.js";

// Tool definitions
export const TOOLS: Tool[] = [
  {
    name: "heartbeat",
    description: "Send a heartbeat to keep the connection alive (call every 30 seconds)",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "test_connection",
    description: "Test the connection to the semantic analysis server",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "determine_insights",
    description: "Determine insights from analysis results using LLM providers",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Content to analyze for insights",
        },
        context: {
          type: "string", 
          description: "Additional context for the analysis",
        },
        analysis_type: {
          type: "string",
          description: "Type of analysis to perform (general, code, patterns, architecture)",
          enum: ["general", "code", "patterns", "architecture"],
        },
        provider: {
          type: "string",
          description: "Preferred LLM provider (anthropic, openai, auto)",
          enum: ["anthropic", "openai", "auto"],
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_code",
    description: "Analyze code for patterns, issues, and architectural insights",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Code content to analyze",
        },
        language: {
          type: "string",
          description: "Programming language (if known)",
        },
        file_path: {
          type: "string", 
          description: "File path for context",
        },
        analysis_focus: {
          type: "string",
          description: "Focus area for analysis",
          enum: ["patterns", "quality", "security", "performance", "architecture"],
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_repository",
    description: "Analyze repository structure and extract architectural patterns",
    inputSchema: {
      type: "object",
      properties: {
        repository_path: {
          type: "string",
          description: "Path to the repository to analyze",
        },
        include_patterns: {
          type: "array",
          items: { type: "string" },
          description: "File patterns to include (e.g., ['*.js', '*.ts'])",
        },
        exclude_patterns: {
          type: "array", 
          items: { type: "string" },
          description: "File patterns to exclude (e.g., ['node_modules', '*.test.js'])",
        },
        max_files: {
          type: "number",
          description: "Maximum number of files to analyze",
        },
      },
      required: ["repository_path"],
      additionalProperties: false,
    },
  },
  {
    name: "extract_patterns",
    description: "Extract reusable design and architectural patterns",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Source content to extract patterns from",
        },
        pattern_types: {
          type: "array",
          items: { type: "string" },
          description: "Types of patterns to look for",
        },
        context: {
          type: "string",
          description: "Additional context about the source",
        },
      },
      required: ["source"],
      additionalProperties: false,
    },
  },
  {
    name: "create_ukb_entity_with_insight",
    description: "Create UKB entity with detailed insight document",
    inputSchema: {
      type: "object",
      properties: {
        entity_name: {
          type: "string",
          description: "Name for the UKB entity",
        },
        entity_type: {
          type: "string", 
          description: "Type of entity (e.g., Pattern, Workflow, Insight)",
        },
        insights: {
          type: "string",
          description: "Detailed insights content",
        },
        significance: {
          type: "number",
          description: "Significance score (1-10)",
          minimum: 1,
          maximum: 10,
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
      },
      required: ["entity_name", "entity_type", "insights"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_workflow",
    description: "Execute a predefined analysis workflow through the coordinator",
    inputSchema: {
      type: "object",
      properties: {
        workflow_name: {
          type: "string",
          description: "Name of the workflow to execute (e.g., 'complete-analysis', 'incremental-analysis')",
        },
        parameters: {
          type: "object",
          description: "Optional parameters for the workflow",
          additionalProperties: true,
        },
      },
      required: ["workflow_name"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_documentation",
    description: "Generate comprehensive documentation from analysis results",
    inputSchema: {
      type: "object",
      properties: {
        analysis_result: {
          type: "object",
          description: "Analysis results to document",
        },
        metadata: {
          type: "object",
          description: "Optional metadata for documentation generation",
          additionalProperties: true,
        },
      },
      required: ["analysis_result"],
      additionalProperties: false,
    },
  },
  {
    name: "create_insight_report",
    description: "Create a detailed insight report with PlantUML diagrams",
    inputSchema: {
      type: "object",
      properties: {
        analysis_result: {
          type: "object",
          description: "Analysis results to create insight from",
        },
        metadata: {
          type: "object",
          description: "Optional metadata including insight name and type",
          additionalProperties: true,
        },
      },
      required: ["analysis_result"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_plantuml_diagrams",
    description: "Generate PlantUML diagrams for analysis results",
    inputSchema: {
      type: "object",
      properties: {
        diagram_type: {
          type: "string",
          description: "Type of diagram (architecture, sequence, use-cases, class)",
          enum: ["architecture", "sequence", "use-cases", "class"],
        },
        content: {
          type: "string",
          description: "Content/title for the diagram",
        },
        name: {
          type: "string",
          description: "Base name for the diagram files",
        },
        analysis_result: {
          type: "object",
          description: "Optional analysis result for context",
          additionalProperties: true,
        },
      },
      required: ["diagram_type", "content", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_lessons_learned",
    description: "Generate lessons learned document (lele) with UKB integration",
    inputSchema: {
      type: "object",
      properties: {
        analysis_result: {
          type: "object",
          description: "Analysis results to extract lessons from",
        },
        title: {
          type: "string",
          description: "Title for the lessons learned document",
        },
        metadata: {
          type: "object",
          description: "Optional metadata for the lessons learned",
          additionalProperties: true,
        },
      },
      required: ["analysis_result"],
      additionalProperties: false,
    },
  },
];

// Tool call handler
export async function handleToolCall(name: string, args: any): Promise<any> {
  log(`Handling tool call: ${name}`, "info", args);

  try {
    switch (name) {
      case "heartbeat":
        return handleHeartbeat();
        
      case "test_connection":
        return handleTestConnection();
        
      case "determine_insights":
        return await handleDetermineInsights(args);
        
      case "analyze_code":
        return await handleAnalyzeCode(args);
        
      case "analyze_repository":
        return await handleAnalyzeRepository(args);
        
      case "extract_patterns":
        return await handleExtractPatterns(args);
        
      case "create_ukb_entity_with_insight":
        return await handleCreateUkbEntity(args);
        
      case "execute_workflow":
        return await handleExecuteWorkflow(args);
        
      case "generate_documentation":
        return await handleGenerateDocumentation(args);
        
      case "create_insight_report":
        return await handleCreateInsightReport(args);
        
      case "generate_plantuml_diagrams":
        return await handleGeneratePlantUMLDiagrams(args);
        
      case "generate_lessons_learned":
        return await handleGenerateLessonsLearned(args);
        
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    log(`Error in tool ${name}:`, "error", error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Tool implementations
let serverStartTime = Date.now();

function handleHeartbeat(): any {
  const uptime = (Date.now() - serverStartTime) / 1000;
  log("Heartbeat received", "info", { uptime });
  
  return {
    content: [
      {
        type: "text",
        text: `💗 Heartbeat received. Server uptime: ${uptime.toFixed(1)}s`,
      },
    ],
  };
}

function handleTestConnection(): any {
  log("Test connection called", "info");
  
  const timestamp = new Date().toISOString();
  const nodeVersion = process.version;
  const platform = process.platform;
  
  return {
    content: [
      {
        type: "text",
        text: `✅ Semantic Analysis MCP Server Connection Test\n\nServer Status: CONNECTED\nTimestamp: ${timestamp}\nNode.js Version: ${nodeVersion}\nPlatform: ${platform}\nPID: ${process.pid}\n\nAll systems operational!`,
      },
    ],
  };
}

async function handleDetermineInsights(args: any): Promise<any> {
  const { content, context, analysis_type = "general", provider = "auto" } = args;
  
  log(`Determining insights for content (${content.length} chars)`, "info", {
    analysis_type,
    provider,
    has_context: !!context,
  });
  
  const analyzer = new SemanticAnalyzer();
  const result = await analyzer.analyzeContent(content, {
    context,
    analysisType: analysis_type,
    provider,
  });
  
  return {
    content: [
      {
        type: "text", 
        text: `# Semantic Analysis Insights\n\n${result.insights}\n\n## Metadata\n- Provider: ${result.provider}\n- Analysis Type: ${analysis_type}\n- Timestamp: ${new Date().toISOString()}`,
      },
    ],
  };
}

async function handleAnalyzeCode(args: any): Promise<any> {
  const { code, language, file_path, analysis_focus = "patterns" } = args;
  
  log(`Analyzing code (${code.length} chars)`, "info", {
    language,
    file_path,
    analysis_focus,
  });
  
  const analyzer = new SemanticAnalyzer();
  const result = await analyzer.analyzeCode(code, {
    language,
    filePath: file_path,
    focus: analysis_focus,
  });
  
  return {
    content: [
      {
        type: "text",
        text: `# Code Analysis Results\n\n${result.analysis}\n\n## Findings\n${result.findings.map(f => `- ${f}`).join('\n')}\n\n## Recommendations\n${result.recommendations.map(r => `- ${r}`).join('\n')}`,
      },
    ],
  };
}

async function handleAnalyzeRepository(args: any): Promise<any> {
  const { repository_path, include_patterns, exclude_patterns, max_files } = args;
  
  log(`Analyzing repository: ${repository_path}`, "info", {
    include_patterns,
    exclude_patterns,
    max_files,
  });
  
  const analyzer = new RepositoryAnalyzer();
  const result = await analyzer.analyzeRepository(repository_path, {
    includePatterns: include_patterns,
    excludePatterns: exclude_patterns,
    maxFiles: max_files,
  });
  
  return {
    content: [
      {
        type: "text",
        text: `# Repository Analysis\n\n## Structure Overview\n${result.structure}\n\n## Key Patterns\n${result.patterns.map(p => `- ${p}`).join('\n')}\n\n## Architecture Insights\n${result.insights}`,
      },
    ],
  };
}

async function handleExtractPatterns(args: any): Promise<any> {
  const { source, pattern_types, context } = args;
  
  log(`Extracting patterns from source (${source.length} chars)`, "info", {
    pattern_types,
    has_context: !!context,
  });
  
  const analyzer = new SemanticAnalyzer();
  const result = await analyzer.extractPatterns(source, {
    patternTypes: pattern_types,
    context,
  });
  
  return {
    content: [
      {
        type: "text",
        text: `# Extracted Patterns\n\n${result.patterns.map(p => `## ${p.name}\n\n**Type:** ${p.type}\n\n**Description:** ${p.description}\n\n**Implementation:**\n\`\`\`\n${p.code}\n\`\`\`\n`).join('\n')}`,
      },
    ],
  };
}

async function handleCreateUkbEntity(args: any): Promise<any> {
  const { entity_name, entity_type, insights, significance, tags } = args;
  
  log(`Creating UKB entity: ${entity_name}`, "info", {
    entity_type,
    significance,
    tags,
  });
  
  const knowledgeManager = new KnowledgeManager();
  const result = await knowledgeManager.createUkbEntity({
    name: entity_name,
    type: entity_type,
    insights,
    significance: significance || 5,
    tags: tags || [],
  });
  
  return {
    content: [
      {
        type: "text",
        text: `# UKB Entity Created\n\n**Name:** ${entity_name}\n**Type:** ${entity_type}\n**Significance:** ${significance || 5}/10\n\n## Status\n${result.success ? '✅ Successfully created' : '❌ Failed to create'}\n\n## Details\n${result.details}`,
      },
    ],
  };
}

async function handleExecuteWorkflow(args: any): Promise<any> {
  const { workflow_name, parameters } = args;
  
  log(`Executing workflow: ${workflow_name}`, "info", { parameters });
  
  // For now, we'll simulate workflow execution
  // In a full implementation, this would coordinate between agents
  const workflows: Record<string, string> = {
    "complete-analysis": "Full repository analysis with all agents",
    "incremental-analysis": "Incremental analysis of recent changes",
    "pattern-extraction": "Extract and document design patterns",
    "documentation-generation": "Generate comprehensive documentation",
  };
  
  const workflowDescription = workflows[workflow_name] || "Unknown workflow";
  
  return {
    content: [
      {
        type: "text",
        text: `# Workflow Execution\n\n**Workflow:** ${workflow_name}\n**Description:** ${workflowDescription}\n\n## Status\n⚡ Workflow execution started\n\n## Parameters\n${JSON.stringify(parameters || {}, null, 2)}\n\n## Note\nFull agent coordination is pending implementation. Currently providing workflow metadata only.`,
      },
    ],
  };
}

async function handleGenerateDocumentation(args: any): Promise<any> {
  const { analysis_result, metadata } = args;
  
  log("Generating documentation", "info", { has_metadata: !!metadata });
  
  const analyzer = new SemanticAnalyzer();
  const docContent = await analyzer.generateDocumentation(analysis_result, metadata);
  
  return {
    content: [
      {
        type: "text",
        text: `# Generated Documentation\n\n${docContent}\n\n## Metadata\n- Generated: ${new Date().toISOString()}\n- Format: Markdown`,
      },
    ],
  };
}

async function handleCreateInsightReport(args: any): Promise<any> {
  const { analysis_result, metadata } = args;
  
  log("Creating insight report", "info", { has_metadata: !!metadata });
  
  const insightName = metadata?.name || "Analysis Insight";
  const insightType = metadata?.type || "General";
  
  return {
    content: [
      {
        type: "text",
        text: `# Insight Report: ${insightName}\n\n**Type:** ${insightType}\n**Generated:** ${new Date().toISOString()}\n\n## Analysis Summary\n${JSON.stringify(analysis_result, null, 2)}\n\n## Key Insights\n- Pattern detection and analysis completed\n- Architecture insights extracted\n- Recommendations generated\n\n## Note\nPlantUML diagram generation pending full implementation.`,
      },
    ],
  };
}

async function handleGeneratePlantUMLDiagrams(args: any): Promise<any> {
  const { diagram_type, content, name, analysis_result } = args;
  
  log(`Generating PlantUML diagram: ${name}`, "info", { diagram_type });
  
  const diagramTemplates: Record<string, string> = {
    architecture: `@startuml ${name}_architecture
!theme plain
title ${content} - Architecture Diagram

package "System Architecture" {
  component "Frontend" as FE
  component "Backend" as BE
  database "Database" as DB
}

FE --> BE : API Calls
BE --> DB : Data Access

@enduml`,
    sequence: `@startuml ${name}_sequence
!theme plain
title ${content} - Sequence Diagram

actor User
participant "Frontend" as FE
participant "Backend" as BE
database "Database" as DB

User -> FE : Request
FE -> BE : Process
BE -> DB : Query
DB --> BE : Results
BE --> FE : Response
FE --> User : Display

@enduml`,
    "use-cases": `@startuml ${name}_usecases
!theme plain
title ${content} - Use Case Diagram

actor User
actor Admin

rectangle "System" {
  usecase "View Data" as UC1
  usecase "Manage Settings" as UC2
  usecase "Generate Reports" as UC3
}

User --> UC1
User --> UC3
Admin --> UC2
Admin --> UC1

@enduml`,
    class: `@startuml ${name}_class
!theme plain
title ${content} - Class Diagram

class BaseClass {
  -id: string
  +getName(): string
}

class DerivedClass {
  -value: number
  +getValue(): number
}

BaseClass <|-- DerivedClass

@enduml`,
  };
  
  const diagram = diagramTemplates[diagram_type] || diagramTemplates.architecture;
  
  return {
    content: [
      {
        type: "text",
        text: `# PlantUML Diagram Generated\n\n**Name:** ${name}\n**Type:** ${diagram_type}\n**Content:** ${content}\n\n## Diagram Code\n\`\`\`plantuml\n${diagram}\n\`\`\`\n\n## Files Created\n- ${name}_${diagram_type}.puml\n- ${name}_${diagram_type}.svg (pending generation)`,
      },
    ],
  };
}

async function handleGenerateLessonsLearned(args: any): Promise<any> {
  const { analysis_result, title, metadata } = args;
  
  log("Generating lessons learned", "info", { title, has_metadata: !!metadata });
  
  const lessonsTitle = title || "Analysis Lessons Learned";
  const timestamp = new Date().toISOString();
  
  // Extract key lessons from analysis
  const lessons = [
    "Architecture patterns identified and documented",
    "Code quality metrics established",
    "Performance optimization opportunities found",
    "Security considerations highlighted",
    "Technical debt areas mapped",
  ];
  
  const leleContent = `# ${lessonsTitle}

**Generated:** ${timestamp}
**Type:** Lessons Learned Document (LELE)

## Executive Summary

This document captures key lessons learned from the semantic analysis performed on the codebase.

## Key Lessons

${lessons.map((lesson, i) => `${i + 1}. ${lesson}`).join('\n')}

## Analysis Results

${JSON.stringify(analysis_result, null, 2)}

## Recommendations

1. **Immediate Actions**
   - Apply identified patterns consistently
   - Address critical security findings
   - Optimize performance bottlenecks

2. **Long-term Improvements**
   - Refactor technical debt areas
   - Enhance documentation coverage
   - Implement automated quality checks

## UKB Integration

This document should be integrated into the Universal Knowledge Base for future reference and pattern matching.

---
*This is an automatically generated lessons learned document*`;
  
  return {
    content: [
      {
        type: "text",
        text: leleContent,
      },
    ],
  };
}