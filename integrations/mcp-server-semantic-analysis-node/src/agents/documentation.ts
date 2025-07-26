import { log } from "../logging.js";
import fs from "fs/promises";
import path from "path";

export interface DocumentationConfig {
  templateDir: string;
  outputFormat: "markdown" | "html" | "pdf";
  includeCodeExamples: boolean;
  includeDiagrams: boolean;
}

export interface AutoGenerationConfig {
  onWorkflowCompletion: boolean;
  onSignificantInsights: boolean;
  significanceThreshold: number;
}

export interface DocumentationTemplate {
  name: string;
  type: "pattern" | "insight" | "analysis" | "workflow";
  content: string;
  variables: string[];
}

export interface DocumentationResult {
  title: string;
  content: string;
  format: string;
  generatedAt: string;
  templateUsed: string;
  metadata: Record<string, any>;
}

export class DocumentationAgent {
  private config: DocumentationConfig;
  private autoConfig: AutoGenerationConfig;
  private templates: Map<string, DocumentationTemplate> = new Map();

  constructor() {
    this.config = {
      templateDir: "/Users/q284340/Agentic/coding/integrations/mcp-server-semantic-analysis-node/templates",
      outputFormat: "markdown",
      includeCodeExamples: true,
      includeDiagrams: false,
    };

    this.autoConfig = {
      onWorkflowCompletion: true,
      onSignificantInsights: true,
      significanceThreshold: 8,
    };

    this.initializeTemplates();
    log("DocumentationAgent initialized", "info");
  }

  private initializeTemplates(): void {
    const templates: DocumentationTemplate[] = [
      {
        name: "pattern_documentation",
        type: "pattern",
        content: `# {{pattern_name}}

## Overview
{{description}}

## Implementation
\`\`\`{{language}}
{{code_example}}
\`\`\`

## Usage
{{usage_example}}

## Benefits
{{benefits}}

## Considerations
{{considerations}}

## Related Patterns
{{related_patterns}}

---
*Generated on {{timestamp}}*`,
        variables: ["pattern_name", "description", "language", "code_example", "usage_example", "benefits", "considerations", "related_patterns", "timestamp"],
      },
      {
        name: "insight_report",
        type: "insight",
        content: `# {{title}}

**Significance:** {{significance}}/10  
**Generated:** {{timestamp}}  
**Type:** {{type}}

## Executive Summary
{{summary}}

## Key Insights
{{insights}}

## Findings
{{findings}}

## Recommendations
{{recommendations}}

## Supporting Data
{{supporting_data}}

## Implementation Guidance
{{implementation_guidance}}

## Next Steps
{{next_steps}}

---
*This document was automatically generated from semantic analysis results*`,
        variables: ["title", "significance", "timestamp", "type", "summary", "insights", "findings", "recommendations", "supporting_data", "implementation_guidance", "next_steps"],
      },
      {
        name: "analysis_documentation",
        type: "analysis",
        content: `# {{analysis_title}}

## Analysis Overview
**Scope:** {{scope}}  
**Duration:** {{duration}}  
**Analyzed:** {{analyzed_items}}

## Methodology
{{methodology}}

## Results Summary
{{results_summary}}

## Detailed Findings
{{detailed_findings}}

## Code Quality Metrics
{{quality_metrics}}

## Architecture Insights
{{architecture_insights}}

## Pattern Analysis
{{pattern_analysis}}

## Recommendations
{{recommendations}}

## Appendices
{{appendices}}

---
*Analysis completed on {{timestamp}}*`,
        variables: ["analysis_title", "scope", "duration", "analyzed_items", "methodology", "results_summary", "detailed_findings", "quality_metrics", "architecture_insights", "pattern_analysis", "recommendations", "appendices", "timestamp"],
      },
      {
        name: "workflow_documentation",
        type: "workflow",
        content: `# {{workflow_name}} - Execution Report

## Workflow Overview
**Name:** {{workflow_name}}  
**Description:** {{workflow_description}}  
**Execution ID:** {{execution_id}}  
**Status:** {{status}}  
**Duration:** {{duration}}

## Agents Involved
{{agents_list}}

## Execution Steps
{{execution_steps}}

## Results
{{results}}

## Quality Metrics
{{quality_metrics}}

## Issues Encountered
{{issues}}

## Lessons Learned
{{lessons_learned}}

## Artifacts Generated
{{artifacts}}

---
*Workflow executed on {{timestamp}}*`,
        variables: ["workflow_name", "workflow_description", "execution_id", "status", "duration", "agents_list", "execution_steps", "results", "quality_metrics", "issues", "lessons_learned", "artifacts", "timestamp"],
      },
    ];

    templates.forEach(template => {
      this.templates.set(template.name, template);
    });

    log(`Initialized ${templates.length} documentation templates`, "info");
  }

  async generateDocumentation(
    templateName: string,
    data: Record<string, any>,
    options: Partial<DocumentationConfig> = {}
  ): Promise<DocumentationResult> {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    const config = { ...this.config, ...options };
    
    log(`Generating documentation using template: ${templateName}`, "info", {
      format: config.outputFormat,
      includeCode: config.includeCodeExamples,
    });

    try {
      // Process template variables
      let content = template.content;
      
      // Add timestamp if not provided
      if (!data.timestamp) {
        data.timestamp = new Date().toISOString();
      }

      // Replace template variables
      for (const variable of template.variables) {
        const value = data[variable] || `[${variable}]`;
        const regex = new RegExp(`{{${variable}}}`, 'g');
        content = content.replace(regex, String(value));
      }

      // Process code examples if enabled
      if (config.includeCodeExamples && data.code_examples) {
        content = this.processCodeExamples(content, data.code_examples);
      }

      // Process diagrams if enabled
      if (config.includeDiagrams && data.diagrams) {
        content = this.processDiagrams(content, data.diagrams);
      }

      const result: DocumentationResult = {
        title: data.title || data.pattern_name || data.analysis_title || data.workflow_name || "Generated Documentation",
        content,
        format: config.outputFormat,
        generatedAt: new Date().toISOString(),
        templateUsed: templateName,
        metadata: {
          templateType: template.type,
          variables: template.variables,
          dataProvided: Object.keys(data),
          config,
        },
      };

      log(`Documentation generated successfully: ${result.title}`, "info");
      return result;
      
    } catch (error) {
      log(`Failed to generate documentation`, "error", error);
      throw error;
    }
  }

  async generatePatternDocumentation(pattern: any): Promise<DocumentationResult> {
    const data = {
      pattern_name: pattern.name || "Unnamed Pattern",
      description: pattern.description || "No description provided",
      language: pattern.language || "javascript",
      code_example: pattern.code || "// No code example available",
      usage_example: pattern.usageExample || "// Usage example not provided",
      benefits: this.formatList(pattern.benefits || ["Improves code organization"]),
      considerations: this.formatList(pattern.considerations || ["Consider performance implications"]),
      related_patterns: this.formatList(pattern.relatedPatterns || ["None identified"]),
    };

    return await this.generateDocumentation("pattern_documentation", data);
  }

  async generateInsightReport(insight: any): Promise<DocumentationResult> {
    const data = {
      title: insight.title || "Analysis Insight Report",
      significance: insight.significance || 5,
      type: insight.type || "General",
      summary: insight.summary || "No summary provided",
      insights: this.formatList(insight.insights || []),
      findings: this.formatList(insight.findings || []),
      recommendations: this.formatList(insight.recommendations || []),
      supporting_data: insight.supportingData ? JSON.stringify(insight.supportingData, null, 2) : "No supporting data",
      implementation_guidance: insight.implementationGuidance || "Implementation guidance not provided",
      next_steps: this.formatList(insight.nextSteps || ["Review and prioritize recommendations"]),
    };

    return await this.generateDocumentation("insight_report", data);
  }

  async generateAnalysisDocumentation(analysis: any): Promise<DocumentationResult> {
    const data = {
      analysis_title: analysis.title || "Code Analysis Report",
      scope: analysis.scope || "Repository analysis",
      duration: analysis.duration || "Unknown",
      analyzed_items: analysis.analyzedItems || "Various code files",
      methodology: analysis.methodology || "Semantic analysis using AI-powered tools",
      results_summary: analysis.resultsSummary || "Analysis completed successfully",
      detailed_findings: this.formatFindings(analysis.findings || []),
      quality_metrics: this.formatMetrics(analysis.qualityMetrics || {}),
      architecture_insights: this.formatList(analysis.architectureInsights || []),
      pattern_analysis: this.formatPatterns(analysis.patterns || []),
      recommendations: this.formatList(analysis.recommendations || []),
      appendices: analysis.appendices || "No additional appendices",
    };

    return await this.generateDocumentation("analysis_documentation", data);
  }

  async generateWorkflowDocumentation(workflow: any): Promise<DocumentationResult> {
    const data = {
      workflow_name: workflow.name || "Unnamed Workflow",
      workflow_description: workflow.description || "No description provided",
      execution_id: workflow.executionId || "Unknown",
      status: workflow.status || "Completed",
      duration: workflow.duration || "Unknown",
      agents_list: this.formatList(workflow.agents || []),
      execution_steps: this.formatSteps(workflow.steps || []),
      results: this.formatResults(workflow.results || {}),
      quality_metrics: this.formatMetrics(workflow.qualityMetrics || {}),
      issues: this.formatList(workflow.issues || ["No issues encountered"]),
      lessons_learned: this.formatList(workflow.lessonsLearned || []),
      artifacts: this.formatList(workflow.artifacts || []),
    };

    return await this.generateDocumentation("workflow_documentation", data);
  }

  private processCodeExamples(content: string, codeExamples: any[]): string {
    // Add additional code examples section
    if (codeExamples.length > 0) {
      const examplesSection = "\n\n## Additional Code Examples\n\n" +
        codeExamples.map((example, index) => 
          `### Example ${index + 1}: ${example.title || 'Untitled'}\n\n` +
          `\`\`\`${example.language || 'javascript'}\n${example.code}\n\`\`\`\n\n` +
          (example.description ? `${example.description}\n\n` : '')
        ).join('');
      
      content += examplesSection;
    }
    
    return content;
  }

  private processDiagrams(content: string, diagrams: any[]): string {
    // Add diagrams section
    if (diagrams.length > 0) {
      const diagramsSection = "\n\n## Diagrams\n\n" +
        diagrams.map((diagram, index) =>
          `### ${diagram.title || `Diagram ${index + 1}`}\n\n` +
          `\`\`\`plantuml\n${diagram.content}\n\`\`\`\n\n`
        ).join('');
      
      content += diagramsSection;
    }
    
    return content;
  }

  private formatList(items: string[]): string {
    if (!Array.isArray(items) || items.length === 0) {
      return "- None";
    }
    return items.map(item => `- ${item}`).join('\n');
  }

  private formatFindings(findings: any[]): string {
    if (!Array.isArray(findings) || findings.length === 0) {
      return "No specific findings to report.";
    }

    return findings.map((finding, index) => 
      `### Finding ${index + 1}: ${finding.title || 'Untitled'}\n\n` +
      `**Severity:** ${finding.severity || 'Low'}\n` +
      `**Description:** ${finding.description || 'No description'}\n` +
      `**Location:** ${finding.location || 'Not specified'}\n\n`
    ).join('');
  }

  private formatMetrics(metrics: Record<string, any>): string {
    if (!metrics || Object.keys(metrics).length === 0) {
      return "No metrics available.";
    }

    return Object.entries(metrics)
      .map(([key, value]) => `- **${key}:** ${value}`)
      .join('\n');
  }

  private formatPatterns(patterns: any[]): string {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      return "No patterns identified.";
    }

    return patterns.map((pattern, index) =>
      `### Pattern ${index + 1}: ${pattern.name || 'Unnamed'}\n\n` +
      `**Type:** ${pattern.type || 'Unknown'}\n` +
      `**Description:** ${pattern.description || 'No description'}\n` +
      `**Usage Count:** ${pattern.usageCount || 'Unknown'}\n\n`
    ).join('');
  }

  private formatSteps(steps: any[]): string {
    if (!Array.isArray(steps) || steps.length === 0) {
      return "No steps recorded.";
    }

    return steps.map((step, index) =>
      `### Step ${index + 1}: ${step.name || 'Unnamed Step'}\n\n` +
      `**Agent:** ${step.agent || 'Unknown'}\n` +
      `**Action:** ${step.action || 'Unknown'}\n` +
      `**Status:** ${step.status || 'Unknown'}\n` +
      `**Duration:** ${step.duration || 'Unknown'}\n\n`
    ).join('');
  }

  private formatResults(results: Record<string, any>): string {
    if (!results || Object.keys(results).length === 0) {
      return "No results recorded.";
    }

    return Object.entries(results)
      .map(([key, value]) => 
        `### ${key}\n\n${typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}\n\n`
      )
      .join('');
  }

  async saveDocumentation(doc: DocumentationResult, outputPath: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, doc.content, 'utf-8');
      
      log(`Documentation saved to: ${outputPath}`, "info");
    } catch (error) {
      log(`Failed to save documentation`, "error", error);
      throw error;
    }
  }

  shouldAutoGenerate(data: any): boolean {
    if (!this.autoConfig.onSignificantInsights) {
      return false;
    }

    const significance = data.significance || 0;
    return significance >= this.autoConfig.significanceThreshold;
  }

  updateConfig(config: Partial<DocumentationConfig>): void {
    Object.assign(this.config, config);
    log("Documentation config updated", "info", this.config);
  }

  updateAutoConfig(config: Partial<AutoGenerationConfig>): void {
    Object.assign(this.autoConfig, config);
    log("Auto-generation config updated", "info", this.autoConfig);
  }
}