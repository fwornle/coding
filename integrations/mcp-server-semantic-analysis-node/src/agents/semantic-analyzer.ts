import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { log } from "../logging.js";

export interface AnalysisOptions {
  context?: string;
  analysisType?: "general" | "code" | "patterns" | "architecture";
  provider?: "anthropic" | "openai" | "auto";
}

export interface CodeAnalysisOptions {
  language?: string;
  filePath?: string;
  focus?: "patterns" | "quality" | "security" | "performance" | "architecture";
}

export interface PatternExtractionOptions {
  patternTypes?: string[];
  context?: string;
}

export interface AnalysisResult {
  insights: string;
  provider: string;
  confidence: number;
}

export interface CodeAnalysisResult {
  analysis: string;
  findings: string[];
  recommendations: string[];
  patterns: string[];
}

export interface Pattern {
  name: string;
  type: string;
  description: string;
  code: string;
  usageExample?: string;
}

export interface PatternExtractionResult {
  patterns: Pattern[];
  summary: string;
}

export class SemanticAnalyzer {
  private anthropicClient: Anthropic | null = null;
  private openaiClient: OpenAI | null = null;

  constructor() {
    this.initializeClients();
  }

  private initializeClients(): void {
    // Initialize Anthropic client
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey && anthropicKey !== "your-anthropic-api-key") {
      this.anthropicClient = new Anthropic({
        apiKey: anthropicKey,
      });
      log("Anthropic client initialized", "info");
    }

    // Initialize OpenAI client  
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && openaiKey !== "your-openai-api-key") {
      this.openaiClient = new OpenAI({
        apiKey: openaiKey,
      });
      log("OpenAI client initialized", "info");
    }

    if (!this.anthropicClient && !this.openaiClient) {
      log("No LLM clients available - check API keys", "warning");
    }
  }

  async analyzeContent(content: string, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    const { context, analysisType = "general", provider = "auto" } = options;

    log(`Analyzing content with ${provider} provider`, "info", {
      contentLength: content.length,
      analysisType,
      hasContext: !!context,
    });

    const prompt = this.buildAnalysisPrompt(content, context, analysisType);

    let result: AnalysisResult;
    
    // Determine which provider to use
    if (provider === "anthropic" || (provider === "auto" && this.anthropicClient)) {
      result = await this.analyzeWithAnthropic(prompt);
    } else if (provider === "openai" || (provider === "auto" && this.openaiClient)) {
      result = await this.analyzeWithOpenAI(prompt);
    } else {
      throw new Error("No available LLM provider");
    }

    return result;
  }

  async analyzeCode(code: string, options: CodeAnalysisOptions = {}): Promise<CodeAnalysisResult> {
    const { language, filePath, focus = "patterns" } = options;

    log(`Analyzing code with focus: ${focus}`, "info", {
      codeLength: code.length,
      language,
      filePath,
    });

    const prompt = this.buildCodeAnalysisPrompt(code, language, filePath, focus);
    const analysis = await this.analyzeWithBestProvider(prompt);

    // Parse structured response
    return this.parseCodeAnalysisResponse(analysis.insights);
  }

  async extractPatterns(source: string, options: PatternExtractionOptions = {}): Promise<PatternExtractionResult> {
    const { patternTypes, context } = options;

    log("Extracting patterns from source", "info", {
      sourceLength: source.length,
      patternTypes,
      hasContext: !!context,
    });

    const prompt = this.buildPatternExtractionPrompt(source, patternTypes, context);
    const analysis = await this.analyzeWithBestProvider(prompt);

    return this.parsePatternExtractionResponse(analysis.insights);
  }

  private async analyzeWithBestProvider(prompt: string): Promise<AnalysisResult> {
    // Try Anthropic first, fallback to OpenAI
    if (this.anthropicClient) {
      try {
        return await this.analyzeWithAnthropic(prompt);
      } catch (error) {
        log("Anthropic analysis failed, trying OpenAI", "warning", error);
      }
    }

    if (this.openaiClient) {
      return await this.analyzeWithOpenAI(prompt);
    }

    throw new Error("No available LLM providers");
  }

  private async analyzeWithAnthropic(prompt: string): Promise<AnalysisResult> {
    if (!this.anthropicClient) {
      throw new Error("Anthropic client not available");
    }

    const response = await this.anthropicClient.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 4096,
      temperature: 0.3,
      system: "You are an expert semantic analysis AI specializing in code analysis, technical documentation, and software development patterns. Provide precise, structured, and actionable insights.",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Anthropic");
    }

    return {
      insights: content.text,
      provider: "anthropic",
      confidence: 0.9,
    };
  }

  private async analyzeWithOpenAI(prompt: string): Promise<AnalysisResult> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not available");
    }

    const response = await this.openaiClient.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are an expert semantic analysis AI specializing in code analysis, technical documentation, and software development patterns. Provide precise, structured, and actionable insights.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    return {
      insights: content,
      provider: "openai",
      confidence: 0.85,
    };
  }

  private buildAnalysisPrompt(content: string, context?: string, analysisType: string = "general"): string {
    let prompt = `Please analyze the following content for insights, patterns, and key findings:\n\n`;
    
    if (context) {
      prompt += `**Context:** ${context}\n\n`;
    }
    
    prompt += `**Analysis Type:** ${analysisType}\n\n`;
    prompt += `**Content:**\n${content}\n\n`;
    
    switch (analysisType) {
      case "code":
        prompt += `Focus on: code quality, patterns, architecture, potential issues, and improvement opportunities.`;
        break;
      case "patterns":
        prompt += `Focus on: identifying reusable patterns, design principles, and architectural structures.`;
        break;
      case "architecture":
        prompt += `Focus on: system architecture, component relationships, and structural insights.`;
        break;
      default:
        prompt += `Provide comprehensive insights covering key themes, patterns, and actionable recommendations.`;
    }
    
    return prompt;
  }

  private buildCodeAnalysisPrompt(code: string, language?: string, filePath?: string, focus: string = "patterns"): string {
    let prompt = `Analyze the following code and provide structured insights:\n\n`;
    
    if (language) {
      prompt += `**Language:** ${language}\n`;
    }
    if (filePath) {
      prompt += `**File:** ${filePath}\n`;
    }
    
    prompt += `**Focus:** ${focus}\n\n`;
    prompt += `**Code:**\n\`\`\`\n${code}\n\`\`\`\n\n`;
    
    prompt += `Please provide a JSON response with the following structure:
{
  "analysis": "Overall analysis summary",
  "findings": ["finding1", "finding2", ...],
  "recommendations": ["rec1", "rec2", ...],
  "patterns": ["pattern1", "pattern2", ...]
}`;
    
    return prompt;
  }

  private buildPatternExtractionPrompt(source: string, patternTypes?: string[], context?: string): string {
    let prompt = `Extract reusable patterns from the following source:\n\n`;
    
    if (context) {
      prompt += `**Context:** ${context}\n\n`;
    }
    
    if (patternTypes && patternTypes.length > 0) {
      prompt += `**Pattern Types to Look For:** ${patternTypes.join(", ")}\n\n`;
    }
    
    prompt += `**Source:**\n${source}\n\n`;
    prompt += `Please extract patterns and provide a JSON response with:
{
  "patterns": [
    {
      "name": "Pattern Name",
      "type": "Pattern Type",
      "description": "Description",
      "code": "Example code"
    }
  ],
  "summary": "Overall summary of patterns found"
}`;
    
    return prompt;
  }

  private parseCodeAnalysisResponse(response: string): CodeAnalysisResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          analysis: parsed.analysis || "Analysis not provided",
          findings: parsed.findings || [],
          recommendations: parsed.recommendations || [],
          patterns: parsed.patterns || [],
        };
      }
    } catch (error) {
      log("Failed to parse structured response, falling back to text parsing", "warning");
    }

    // Fallback to text parsing
    return {
      analysis: response,
      findings: this.extractBulletPoints(response, "findings"),
      recommendations: this.extractBulletPoints(response, "recommendations"),
      patterns: this.extractBulletPoints(response, "patterns"),
    };
  }

  private parsePatternExtractionResponse(response: string): PatternExtractionResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          patterns: parsed.patterns || [],
          summary: parsed.summary || "No patterns extracted",
        };
      }
    } catch (error) {
      log("Failed to parse pattern response", "warning");
    }

    // Fallback
    return {
      patterns: [],
      summary: response,
    };
  }

  async generateDocumentation(analysisResult: any, metadata: any = {}): Promise<string> {
    const { title = "Analysis Documentation", format = "markdown" } = metadata;
    
    const docContent = `# ${title}

## Overview
This documentation was automatically generated from semantic analysis results.

## Analysis Summary
${JSON.stringify(analysisResult, null, 2)}

## Key Findings
- Pattern identification completed
- Code quality assessed
- Architecture documented

## Recommendations
1. Follow identified patterns consistently
2. Address quality issues
3. Maintain architecture documentation

---
*Generated on ${new Date().toISOString()}*`;
    
    return docContent;
  }

  private extractBulletPoints(text: string, section: string): string[] {
    const lines = text.split('\n');
    const items: string[] = [];
    let inSection = false;

    for (const line of lines) {
      if (line.toLowerCase().includes(section.toLowerCase())) {
        inSection = true;
        continue;
      }
      
      if (inSection && (line.startsWith('- ') || line.startsWith('* ') || line.match(/^\d+\./))) {
        items.push(line.replace(/^[-*\d.]\s*/, '').trim());
      } else if (inSection && line.trim() === '') {
        continue;
      } else if (inSection && line.match(/^[A-Z]/)) {
        break; // End of section
      }
    }

    return items;
  }
}