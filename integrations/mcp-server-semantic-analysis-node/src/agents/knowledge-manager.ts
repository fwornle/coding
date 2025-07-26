import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logging.js';

export interface UkbEntityOptions {
  name: string;
  type: string;
  insights: string;
  significance: number;
  tags: string[];
  codeFiles?: string[];
  referenceUrls?: string[];
}

export interface UkbCreationResult {
  success: boolean;
  details: string;
  entityId?: string;
  error?: string;
}

export interface KnowledgeQuery {
  query: string;
  entityType?: string;
  maxResults?: number;
}

export interface KnowledgeSearchResult {
  entities: KnowledgeEntity[];
  totalCount: number;
}

export interface KnowledgeEntity {
  name: string;
  type: string;
  significance: number;
  observations: string[];
  tags?: string[];
}

export class KnowledgeManager {
  private codingToolsPath: string;
  private ukbPath: string;

  constructor() {
    this.codingToolsPath = process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding';
    this.ukbPath = path.join(this.codingToolsPath, 'ukb');
    
    log("Knowledge Manager initialized", "info", {
      codingToolsPath: this.codingToolsPath,
      ukbPath: this.ukbPath,
    });
  }

  async createUkbEntity(options: UkbEntityOptions): Promise<UkbCreationResult> {
    const { name, type, insights, significance, tags, codeFiles, referenceUrls } = options;

    log(`Creating UKB entity: ${name}`, "info", {
      type,
      significance,
      tagsCount: tags.length,
    });

    try {
      // Validate inputs
      if (!name || !type || !insights) {
        throw new Error("Name, type, and insights are required");
      }

      if (significance < 1 || significance > 10) {
        throw new Error("Significance must be between 1 and 10");
      }

      // Check if ukb command exists
      if (!this.isUkbAvailable()) {
        throw new Error("UKB command not available. Ensure you're in the coding environment.");
      }

      // Prepare input for ukb interactive mode
      const ukbInput = this.prepareUkbInput({
        name,
        type,
        insights,
        significance,
        tags,
        codeFiles,
        referenceUrls,
      });

      // Execute ukb command
      const result = await this.executeUkbCommand(ukbInput);
      
      if (result.success) {
        log(`Successfully created UKB entity: ${name}`, "info");
        return {
          success: true,
          details: `Entity "${name}" created successfully with significance ${significance}/10`,
          entityId: name,
        };
      } else {
        throw new Error(result.error || "UKB command failed");
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`Failed to create UKB entity: ${errorMsg}`, "error", error);
      
      return {
        success: false,
        details: `Failed to create entity: ${errorMsg}`,
        error: errorMsg,
      };
    }
  }

  async searchKnowledge(query: KnowledgeQuery): Promise<KnowledgeSearchResult> {
    const { query: searchQuery, entityType, maxResults = 10 } = query;

    log(`Searching knowledge base: ${searchQuery}`, "info", {
      entityType,
      maxResults,
    });

    try {
      // Search using the knowledge base files directly
      const knowledgeBase = await this.loadKnowledgeBase();
      const results = this.searchInKnowledgeBase(knowledgeBase, searchQuery, entityType);
      
      return {
        entities: results.slice(0, maxResults),
        totalCount: results.length,
      };

    } catch (error) {
      log(`Knowledge search failed: ${error}`, "error", error);
      return {
        entities: [],
        totalCount: 0,
      };
    }
  }

  private isUkbAvailable(): boolean {
    try {
      // Check if ukb script exists
      const ukbScriptPath = path.join(this.codingToolsPath, 'ukb');
      return fs.existsSync(ukbScriptPath);
    } catch (error) {
      return false;
    }
  }

  private prepareUkbInput(options: UkbEntityOptions): string {
    const { insights, type, significance, tags, codeFiles, referenceUrls } = options;

    // Format for ukb interactive mode (9-line format)
    const lines = [
      insights.substring(0, 200), // Problem description (truncated)
      insights, // Full solution description  
      `Created via semantic analysis MCP server`, // Rationale
      `Automated insight extraction and analysis`, // Key learnings
      `Pattern applies to similar ${type.toLowerCase()} scenarios`, // Applicability
      tags.join(',') || 'semantic-analysis,automated', // Technologies
      referenceUrls?.join(',') || '', // Reference URLs
      codeFiles?.join(',') || '', // Code files
      significance.toString(), // Significance (1-10)
    ];

    return lines.join('\n') + '\n';
  }

  private async executeUkbCommand(input: string): Promise<{ success: boolean; error?: string; output?: string }> {
    return new Promise((resolve) => {
      const ukbProcess = spawn(this.ukbPath, ['--interactive'], {
        cwd: this.codingToolsPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      ukbProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ukbProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ukbProcess.on('close', (code) => {
        log(`UKB process exited with code ${code}`, "info", {
          stdout: stdout.substring(0, 500),
          stderr: stderr.substring(0, 500),
        });

        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          resolve({ 
            success: false, 
            error: stderr || `Process exited with code ${code}` 
          });
        }
      });

      ukbProcess.on('error', (error) => {
        log(`UKB process error: ${error}`, "error", error);
        resolve({ 
          success: false, 
          error: `Failed to execute ukb: ${error.message}` 
        });
      });

      // Send input to ukb
      ukbProcess.stdin.write(input);
      ukbProcess.stdin.end();

      // Set timeout
      setTimeout(() => {
        ukbProcess.kill('SIGTERM');
        resolve({ 
          success: false, 
          error: 'UKB command timed out' 
        });
      }, 30000); // 30 second timeout
    });
  }

  private async loadKnowledgeBase(): Promise<KnowledgeEntity[]> {
    const entities: KnowledgeEntity[] = [];
    
    try {
      // Look for shared-memory files
      const sharedMemoryFiles = [
        'shared-memory-coding.json',
        'shared-memory-ui.json', 
        'shared-memory-resi.json',
        'shared-memory-raas.json',
      ];

      for (const fileName of sharedMemoryFiles) {
        const filePath = path.join(this.codingToolsPath, fileName);
        
        if (fs.existsSync(filePath)) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            
            if (data.entities && Array.isArray(data.entities)) {
              for (const entity of data.entities) {
                entities.push({
                  name: entity.name || 'Unknown',
                  type: entity.entityType || entity.type || 'Unknown',
                  significance: entity.significance || 5,
                  observations: Array.isArray(entity.observations) 
                    ? entity.observations.map((obs: any) => 
                        typeof obs === 'string' ? obs : obs.content || String(obs)
                      )
                    : [],
                  tags: entity.tags || [],
                });
              }
            }
          } catch (error) {
            log(`Error parsing knowledge base file ${fileName}:`, "warning", error);
          }
        }
      }
    } catch (error) {
      log("Error loading knowledge base:", "error", error);
    }

    return entities;
  }

  private searchInKnowledgeBase(
    entities: KnowledgeEntity[], 
    query: string, 
    entityType?: string
  ): KnowledgeEntity[] {
    const queryLower = query.toLowerCase();
    
    return entities
      .filter(entity => {
        // Filter by entity type if specified
        if (entityType && entity.type.toLowerCase() !== entityType.toLowerCase()) {
          return false;
        }
        
        // Search in name, type, and observations
        const searchText = [
          entity.name,
          entity.type,
          ...entity.observations,
          ...(entity.tags || []),
        ].join(' ').toLowerCase();
        
        return searchText.includes(queryLower);
      })
      .sort((a, b) => {
        // Sort by significance (descending) and then by name match relevance
        const aNameMatch = a.name.toLowerCase().includes(queryLower);
        const bNameMatch = b.name.toLowerCase().includes(queryLower);
        
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        
        return b.significance - a.significance;
      });
  }

  async getEntityDetails(entityName: string): Promise<KnowledgeEntity | null> {
    try {
      const knowledgeBase = await this.loadKnowledgeBase();
      return knowledgeBase.find(e => e.name.toLowerCase() === entityName.toLowerCase()) || null;
    } catch (error) {
      log(`Error getting entity details for ${entityName}:`, "error", error);
      return null;
    }
  }

  async listEntityTypes(): Promise<string[]> {
    try {
      const knowledgeBase = await this.loadKnowledgeBase();
      const types = new Set(knowledgeBase.map(e => e.type));
      return Array.from(types).sort();
    } catch (error) {
      log("Error listing entity types:", "error", error);
      return [];
    }
  }

  async getKnowledgeStats(): Promise<{ totalEntities: number; entityTypes: Record<string, number> }> {
    try {
      const knowledgeBase = await this.loadKnowledgeBase();
      const entityTypes: Record<string, number> = {};
      
      for (const entity of knowledgeBase) {
        entityTypes[entity.type] = (entityTypes[entity.type] || 0) + 1;
      }
      
      return {
        totalEntities: knowledgeBase.length,
        entityTypes,
      };
    } catch (error) {
      log("Error getting knowledge stats:", "error", error);
      return { totalEntities: 0, entityTypes: {} };
    }
  }
}