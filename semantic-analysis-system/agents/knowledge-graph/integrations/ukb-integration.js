/**
 * UKB Integration
 * Handles integration with the existing UKB (Update Knowledge Base) system
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger.js';

const execAsync = promisify(exec);

export class UkbIntegration {
  constructor(config = {}) {
    this.config = {
      ukbPath: config.ukbPath || process.env.CODING_TOOLS_PATH + '/bin/ukb',
      sharedMemoryPath: config.sharedMemoryPath || process.env.CODING_TOOLS_PATH + '/shared-memory.json',
      autoSync: config.autoSync !== false,
      syncDirection: config.syncDirection || 'bidirectional', // 'to-ukb', 'from-ukb', 'bidirectional'
      ...config
    };
    
    this.logger = new Logger('ukb-integration');
    
    this.validateConfiguration();
  }

  validateConfiguration() {
    if (!process.env.CODING_TOOLS_PATH) {
      throw new Error('CODING_TOOLS_PATH environment variable is required');
    }
    
    if (!this.config.ukbPath) {
      throw new Error('UKB path is required for integration');
    }
  }

  async syncEntity(entity) {
    try {
      if (!this.config.autoSync) {
        return { synced: false, reason: 'Auto-sync disabled' };
      }

      this.logger.debug(`Syncing entity to UKB: ${entity.name}`);
      
      // Convert entity to UKB format
      const ukbData = this.convertEntityToUkbFormat(entity);
      
      // Create temporary input file for UKB
      const tempFile = await this.createTempUkbInput(ukbData);
      
      try {
        // Execute UKB with piped input
        const result = await this.executeUkbCommand(tempFile);
        
        return {
          synced: true,
          entityName: entity.name,
          ukbResult: result
        };
        
      } finally {
        // Clean up temp file
        await this.cleanupTempFile(tempFile);
      }
      
    } catch (error) {
      this.logger.error(`Failed to sync entity ${entity.name} to UKB:`, error);
      return {
        synced: false,
        error: error.message,
        entityName: entity.name
      };
    }
  }

  async syncRelation(relation) {
    try {
      if (!this.config.autoSync) {
        return { synced: false, reason: 'Auto-sync disabled' };
      }

      this.logger.debug(`Syncing relation to UKB: ${relation.from} -> ${relation.to}`);
      
      // Relations are typically embedded in entity observations
      // For now, we'll create a relationship entity
      const relationEntity = {
        name: `Relation: ${relation.from} -> ${relation.to}`,
        entityType: 'Relationship',
        significance: 6,
        observations: [
          `Relationship type: ${relation.relationType}`,
          `From: ${relation.from}`,
          `To: ${relation.to}`,
          `Created: ${relation.metadata?.created || new Date().toISOString()}`
        ],
        metadata: {
          source: 'relation-sync',
          originalRelation: relation
        }
      };
      
      return await this.syncEntity(relationEntity);
      
    } catch (error) {
      this.logger.error('Failed to sync relation to UKB:', error);
      return {
        synced: false,
        error: error.message,
        relation
      };
    }
  }

  async exportToUkb() {
    try {
      this.logger.info('Exporting knowledge graph to UKB...');
      
      // Load current shared memory
      const sharedMemory = await this.loadSharedMemory();
      
      const results = {
        totalEntities: sharedMemory.entities.length,
        syncedEntities: 0,
        errors: []
      };
      
      // Sync each significant entity
      for (const entity of sharedMemory.entities) {
        if (entity.significance >= (this.config.significanceThreshold || 7)) {
          const syncResult = await this.syncEntity(entity);
          
          if (syncResult.synced) {
            results.syncedEntities++;
          } else {
            results.errors.push({
              entity: entity.name,
              error: syncResult.error || syncResult.reason
            });
          }
          
          // Small delay to prevent overwhelming UKB
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      this.logger.info(`Export to UKB completed: ${results.syncedEntities}/${results.totalEntities} entities synced`);
      return results;
      
    } catch (error) {
      this.logger.error('Failed to export to UKB:', error);
      throw error;
    }
  }

  async importFromUkb() {
    try {
      this.logger.info('Importing knowledge from UKB...');
      
      // Load current shared memory to avoid duplicates
      const sharedMemory = await this.loadSharedMemory();
      
      // UKB doesn't have a direct export function, so we'll read the shared-memory.json
      // and check for any new entities that might have been added by UKB
      const currentTimestamp = Date.now();
      const recentEntities = sharedMemory.entities.filter(entity => {
        const created = new Date(entity.metadata?.created || 0);
        return (currentTimestamp - created.getTime()) < 3600000; // Last hour
      });
      
      return {
        importedEntities: recentEntities.length,
        entities: recentEntities,
        message: 'Import from UKB completed (based on recent entities in shared memory)'
      };
      
    } catch (error) {
      this.logger.error('Failed to import from UKB:', error);
      throw error;
    }
  }

  async syncBidirectional() {
    try {
      this.logger.info('Performing bidirectional sync with UKB...');
      
      // First import any new data from UKB
      const importResult = await this.importFromUkb();
      
      // Then export our data to UKB
      const exportResult = await this.exportToUkb();
      
      return {
        import: importResult,
        export: exportResult,
        status: 'completed'
      };
      
    } catch (error) {
      this.logger.error('Bidirectional sync failed:', error);
      throw error;
    }
  }

  async syncAll() {
    try {
      return await this.syncBidirectional();
    } catch (error) {
      this.logger.error('Failed to sync all:', error);
      throw error;
    }
  }

  convertEntityToUkbFormat(entity) {
    // UKB interactive format expects 9 lines:
    // 1. Problem description
    // 2. Solution description
    // 3. Rationale
    // 4. Key learnings
    // 5. Applicability
    // 6. Technologies (comma-separated)
    // 7. Reference URLs
    // 8. Code files
    // 9. Significance (1-10)
    
    const observations = entity.observations || [];
    const metadata = entity.metadata || {};
    
    return {
      problem: this.extractProblem(entity, observations),
      solution: this.extractSolution(entity, observations),
      rationale: this.extractRationale(entity, observations),
      learnings: this.extractLearnings(entity, observations),
      applicability: this.extractApplicability(entity, observations),
      technologies: this.extractTechnologies(entity, observations, metadata),
      references: this.extractReferences(entity, observations, metadata),
      codeFiles: this.extractCodeFiles(entity, observations, metadata),
      significance: entity.significance || 5
    };
  }

  extractProblem(entity, observations) {
    // Try to find problem-related content
    const problemObs = observations.find(obs => 
      obs.toLowerCase().includes('problem') || 
      obs.toLowerCase().includes('issue') ||
      obs.toLowerCase().includes('challenge')
    );
    
    if (problemObs) return problemObs;
    
    // Default based on entity type
    switch (entity.entityType) {
      case 'Pattern':
        return `Pattern application: ${entity.name}`;
      case 'Insight':
        return `Insight identification: ${entity.name}`;
      case 'WorkflowPattern':
        return `Workflow optimization: ${entity.name}`;
      default:
        return `${entity.entityType} analysis: ${entity.name}`;
    }
  }

  extractSolution(entity, observations) {
    const solutionObs = observations.find(obs => 
      obs.toLowerCase().includes('solution') || 
      obs.toLowerCase().includes('approach') ||
      obs.toLowerCase().includes('implementation')
    );
    
    if (solutionObs) return solutionObs;
    
    return observations[0] || `${entity.entityType}: ${entity.name}`;
  }

  extractRationale(entity, observations) {
    const rationaleObs = observations.find(obs => 
      obs.toLowerCase().includes('rationale') || 
      obs.toLowerCase().includes('reason') ||
      obs.toLowerCase().includes('because')
    );
    
    if (rationaleObs) return rationaleObs;
    
    return `Extracted from semantic analysis with significance ${entity.significance}/10`;
  }

  extractLearnings(entity, observations) {
    const learningObs = observations.find(obs => 
      obs.toLowerCase().includes('learning') || 
      obs.toLowerCase().includes('lesson') ||
      obs.toLowerCase().includes('takeaway')
    );
    
    if (learningObs) return learningObs;
    
    return `${entity.entityType} pattern identified for knowledge management`;
  }

  extractApplicability(entity, observations) {
    const applicabilityObs = observations.find(obs => 
      obs.toLowerCase().includes('applicable') || 
      obs.toLowerCase().includes('applies to') ||
      obs.toLowerCase().includes('used for')
    );
    
    if (applicabilityObs) return applicabilityObs;
    
    return `General ${entity.entityType.toLowerCase()} pattern applicable to similar scenarios`;
  }

  extractTechnologies(entity, observations, metadata) {
    const technologies = new Set();
    
    // Extract from metadata
    if (metadata.technologies) {
      if (Array.isArray(metadata.technologies)) {
        metadata.technologies.forEach(tech => technologies.add(tech));
      } else if (typeof metadata.technologies === 'string') {
        metadata.technologies.split(',').forEach(tech => technologies.add(tech.trim()));
      }
    }
    
    // Extract from observations and name
    const content = `${entity.name} ${observations.join(' ')}`.toLowerCase();
    const techPatterns = [
      'javascript', 'typescript', 'node.js', 'react', 'vue', 'angular',
      'python', 'java', 'c++', 'go', 'rust', 'docker', 'kubernetes',
      'aws', 'azure', 'gcp', 'mongodb', 'postgresql', 'redis'
    ];
    
    for (const tech of techPatterns) {
      if (content.includes(tech)) {
        technologies.add(tech);
      }
    }
    
    return Array.from(technologies).join(',') || 'general';
  }

  extractReferences(entity, observations, metadata) {
    const references = [];
    
    // Extract from metadata
    if (metadata.references) {
      if (Array.isArray(metadata.references)) {
        references.push(...metadata.references);
      }
    }
    
    // Extract URLs from observations
    const urlRegex = /https?:\/\/[^\s]+/g;
    for (const obs of observations) {
      const urls = obs.match(urlRegex);
      if (urls) {
        references.push(...urls);
      }
    }
    
    return references.join(',') || 'https://github.com/semantic-analysis-system';
  }

  extractCodeFiles(entity, observations, metadata) {
    const codeFiles = [];
    
    // Extract from metadata
    if (metadata.codeFiles) {
      if (Array.isArray(metadata.codeFiles)) {
        codeFiles.push(...metadata.codeFiles);
      }
    }
    
    // Look for file patterns in observations
    const fileRegex = /[\w\-_]+\.(js|ts|py|java|cpp|c|go|rs|rb|php|cs)/g;
    for (const obs of observations) {
      const files = obs.match(fileRegex);
      if (files) {
        codeFiles.push(...files);
      }
    }
    
    return codeFiles.join(',') || 'semantic-analysis-system';
  }

  async createTempUkbInput(ukbData) {
    const tempDir = process.env.TMPDIR || '/tmp';
    const tempFile = path.join(tempDir, `ukb-input-${Date.now()}.txt`);
    
    const inputContent = [
      ukbData.problem,
      ukbData.solution,
      ukbData.rationale,
      ukbData.learnings,
      ukbData.applicability,
      ukbData.technologies,
      ukbData.references,
      ukbData.codeFiles,
      ukbData.significance.toString()
    ].join('\n');
    
    await fs.writeFile(tempFile, inputContent, 'utf8');
    return tempFile;
  }

  async executeUkbCommand(inputFile) {
    try {
      const command = `${this.config.ukbPath} --interactive < "${inputFile}"`;
      
      this.logger.debug(`Executing UKB command: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.env.CODING_TOOLS_PATH,
        timeout: 30000 // 30 seconds timeout
      });
      
      if (stderr && !stderr.includes('warning')) {
        this.logger.warn('UKB stderr:', stderr);
      }
      
      return {
        success: true,
        stdout,
        stderr
      };
      
    } catch (error) {
      this.logger.error('UKB command execution failed:', error);
      throw new Error(`UKB execution failed: ${error.message}`);
    }
  }

  async cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      this.logger.debug(`Failed to cleanup temp file ${filePath}:`, error.message);
    }
  }

  async loadSharedMemory() {
    try {
      const data = await fs.readFile(this.config.sharedMemoryPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.warn('Failed to load shared memory:', error.message);
      return { entities: [], relations: [], metadata: {} };
    }
  }

  async testUkbAvailability() {
    try {
      const { stdout } = await execAsync(`${this.config.ukbPath} --help`, {
        timeout: 5000
      });
      
      return {
        available: true,
        version: this.extractUkbVersion(stdout)
      };
      
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  extractUkbVersion(helpOutput) {
    const versionMatch = helpOutput.match(/version\s+(\d+\.\d+\.\d+)/i);
    return versionMatch ? versionMatch[1] : 'unknown';
  }

  getInfo() {
    return {
      ukbPath: this.config.ukbPath,
      sharedMemoryPath: this.config.sharedMemoryPath,
      autoSync: this.config.autoSync,
      syncDirection: this.config.syncDirection,
      capabilities: this.getCapabilities()
    };
  }

  getCapabilities() {
    return [
      'entity-sync',
      'relation-sync',
      'bidirectional-sync',
      'ukb-export',
      'ukb-import',
      'format-conversion'
    ];
  }
}