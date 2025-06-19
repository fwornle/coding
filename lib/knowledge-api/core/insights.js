/**
 * Insight Processor - Handles insight extraction and processing
 */

export class InsightProcessor {
  constructor(entityManager, relationManager, logger) {
    this.entities = entityManager;
    this.relations = relationManager;
    this.logger = logger;
  }

  /**
   * Process insight from text content
   */
  async processInsight(insightData) {
    const timer = this.logger.time('processInsight');
    
    try {
      // Validate insight data
      this._validateInsightData(insightData);
      
      // Extract entities from insight
      const entities = await this._extractEntities(insightData);
      
      // Extract relations from insight
      const relations = await this._extractRelations(insightData, entities);
      
      // Calculate significance
      const significance = this._calculateSignificance(insightData, entities, relations);
      
      // Create entities in knowledge base
      const createdEntities = [];
      for (const entityData of entities) {
        try {
          const entity = await this.entities.create({
            ...entityData,
            significance: significance
          });
          createdEntities.push(entity);
        } catch (error) {
          if (error.message.includes('already exists')) {
            // Entity exists, add observation instead
            const existing = await this.entities.findByName(entityData.name);
            if (existing && entityData.observations) {
              for (const obs of entityData.observations) {
                await this.entities.addObservation(existing.name, obs);
              }
            }
            createdEntities.push(existing);
          } else {
            this.logger.warn(`Failed to create entity ${entityData.name}: ${error.message}`);
          }
        }
      }
      
      // Create relations in knowledge base
      const createdRelations = [];
      for (const relationData of relations) {
        try {
          const relation = await this.relations.create({
            ...relationData,
            significance: significance
          });
          createdRelations.push(relation);
        } catch (error) {
          if (!error.message.includes('already exists')) {
            this.logger.warn(`Failed to create relation ${relationData.from} -> ${relationData.to}: ${error.message}`);
          }
        }
      }
      
      const result = {
        entities: createdEntities,
        relations: createdRelations,
        significance,
        processed: new Date().toISOString()
      };
      
      timer.end('Insight processed successfully');
      return result;
      
    } catch (error) {
      timer.end('Insight processing failed');
      this.logger.error('Failed to process insight', { error: error.message });
      throw error;
    }
  }

  /**
   * Process multiple insights in batch
   */
  async processBatch(insights) {
    const results = [];
    const errors = [];
    
    for (let i = 0; i < insights.length; i++) {
      try {
        const result = await this.processInsight(insights[i]);
        results.push(result);
      } catch (error) {
        errors.push({
          index: i,
          insight: insights[i],
          error: error.message
        });
      }
    }
    
    return {
      results,
      errors,
      processed: results.length,
      failed: errors.length
    };
  }

  /**
   * Extract patterns from existing knowledge base
   */
  async extractPatterns(options = {}) {
    const timer = this.logger.time('extractPatterns');
    
    try {
      const minSignificance = options.minSignificance || 7;
      const maxResults = options.maxResults || 50;
      
      // Get high-significance entities
      const entities = await this.entities.getHighSignificance(minSignificance);
      
      // Get high-significance relations
      const relations = await this.relations.getAll({ minSignificance });
      
      // Find connected components (patterns)
      const patterns = await this._findPatterns(entities, relations);
      
      // Rank patterns by significance and connectivity
      const rankedPatterns = this._rankPatterns(patterns);
      
      const result = rankedPatterns.slice(0, maxResults);
      
      timer.end(`Extracted ${result.length} patterns`);
      return result;
      
    } catch (error) {
      timer.end('Pattern extraction failed');
      this.logger.error('Failed to extract patterns', { error: error.message });
      throw error;
    }
  }

  /**
   * Analyze conversation for insights
   */
  async analyzeConversation(conversationText, context = {}) {
    const insights = [];
    
    // Split conversation into exchanges
    const exchanges = this._parseConversation(conversationText);
    
    for (const exchange of exchanges) {
      // Extract problem-solution pairs
      const problemSolutions = this._extractProblemSolutions(exchange);
      
      for (const ps of problemSolutions) {
        const insight = {
          type: 'problem-solution',
          problem: ps.problem,
          solution: ps.solution,
          context: {
            ...context,
            exchange: exchange.id
          },
          technologies: this._extractTechnologies(exchange.content),
          codeFiles: this._extractCodeFiles(exchange.content)
        };
        
        insights.push(insight);
      }
      
      // Extract technical patterns
      const patterns = this._extractTechnicalPatterns(exchange.content);
      
      for (const pattern of patterns) {
        const insight = {
          type: 'technical-pattern',
          pattern: pattern,
          context: {
            ...context,
            exchange: exchange.id
          }
        };
        
        insights.push(insight);
      }
    }
    
    return insights;
  }

  /**
   * Analyze code changes for insights
   */
  async analyzeCodeChanges(gitDiff, commitInfo = {}) {
    const insights = [];
    
    // Parse git diff
    const changes = this._parseGitDiff(gitDiff);
    
    for (const change of changes) {
      // Detect architectural changes
      if (this._isArchitecturalChange(change)) {
        const insight = {
          type: 'architectural-change',
          file: change.file,
          changeType: change.type,
          description: this._describeArchitecturalChange(change),
          context: {
            commit: commitInfo.hash,
            message: commitInfo.message,
            author: commitInfo.author
          }
        };
        
        insights.push(insight);
      }
      
      // Detect pattern implementations
      const patterns = this._detectPatternImplementations(change);
      
      for (const pattern of patterns) {
        const insight = {
          type: 'pattern-implementation',
          pattern: pattern,
          file: change.file,
          context: {
            commit: commitInfo.hash,
            message: commitInfo.message
          }
        };
        
        insights.push(insight);
      }
    }
    
    return insights;
  }

  /**
   * Generate insight recommendations
   */
  async generateRecommendations(currentContext = {}) {
    const recommendations = [];
    
    // Get recent entities
    const recentEntities = await this.entities.getAll();
    const recent = recentEntities
      .sort((a, b) => new Date(b.created) - new Date(a.created))
      .slice(0, 10);
    
    // Find entities with low significance that might need attention
    const lowSignificance = recentEntities.filter(e => (e.significance || 5) < 5);
    
    if (lowSignificance.length > 0) {
      recommendations.push({
        type: 'review-significance',
        entities: lowSignificance.map(e => e.name),
        description: 'These entities have low significance scores and may need review'
      });
    }
    
    // Find isolated entities (no relations)
    const allRelations = await this.relations.getAll();
    const connectedEntities = new Set();
    
    for (const relation of allRelations) {
      connectedEntities.add(relation.from);
      connectedEntities.add(relation.to);
    }
    
    const isolatedEntities = recentEntities.filter(e => !connectedEntities.has(e.name));
    
    if (isolatedEntities.length > 0) {
      recommendations.push({
        type: 'create-relations',
        entities: isolatedEntities.map(e => e.name),
        description: 'These entities have no relations and might benefit from connections'
      });
    }
    
    // Find potential duplicate entities
    const duplicates = this._findPotentialDuplicates(recentEntities);
    
    if (duplicates.length > 0) {
      recommendations.push({
        type: 'merge-duplicates',
        duplicates: duplicates,
        description: 'These entities might be duplicates and could be merged'
      });
    }
    
    return recommendations;
  }

  // Private helper methods

  _validateInsightData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid insight data: must be an object');
    }
    
    if (!data.type) {
      throw new Error('Invalid insight data: type is required');
    }
    
    const validTypes = ['problem-solution', 'technical-pattern', 'architectural-change', 'pattern-implementation'];
    if (!validTypes.includes(data.type)) {
      throw new Error(`Invalid insight type: ${data.type}`);
    }
  }

  async _extractEntities(insightData) {
    const entities = [];
    
    switch (insightData.type) {
      case 'problem-solution':
        if (insightData.problem && insightData.solution) {
          entities.push({
            name: this._generateEntityName(insightData.problem, 'Problem'),
            entityType: 'Problem',
            observations: [
              {
                type: 'problem',
                content: insightData.problem,
                date: new Date().toISOString()
              }
            ]
          });
          
          entities.push({
            name: this._generateEntityName(insightData.solution, 'Solution'),
            entityType: 'Solution',
            observations: [
              {
                type: 'solution',
                content: insightData.solution,
                date: new Date().toISOString()
              }
            ]
          });
        }
        break;
        
      case 'technical-pattern':
        if (insightData.pattern) {
          entities.push({
            name: this._generateEntityName(insightData.pattern, 'Pattern'),
            entityType: 'TechnicalPattern',
            observations: [
              {
                type: 'pattern',
                content: insightData.pattern,
                date: new Date().toISOString()
              }
            ]
          });
        }
        break;
        
      case 'architectural-change':
        entities.push({
          name: this._generateEntityName(insightData.description, 'Architecture'),
          entityType: 'ArchitecturalChange',
          observations: [
            {
              type: 'change',
              content: insightData.description,
              date: new Date().toISOString()
            }
          ]
        });
        break;
    }
    
    return entities;
  }

  async _extractRelations(insightData, entities) {
    const relations = [];
    
    if (insightData.type === 'problem-solution' && entities.length >= 2) {
      const problem = entities.find(e => e.entityType === 'Problem');
      const solution = entities.find(e => e.entityType === 'Solution');
      
      if (problem && solution) {
        relations.push({
          from: solution.name,
          to: problem.name,
          relationType: 'solves'
        });
      }
    }
    
    return relations;
  }

  _calculateSignificance(insightData, entities, relations) {
    let significance = 5; // Base significance
    
    // Increase significance based on insight type
    switch (insightData.type) {
      case 'architectural-change':
        significance += 3;
        break;
      case 'problem-solution':
        significance += 2;
        break;
      case 'technical-pattern':
        significance += 1;
        break;
    }
    
    // Increase significance based on context
    if (insightData.context) {
      if (insightData.context.commit) significance += 1;
      if (insightData.technologies && insightData.technologies.length > 0) significance += 1;
      if (insightData.codeFiles && insightData.codeFiles.length > 0) significance += 1;
    }
    
    // Cap at 10
    return Math.min(significance, 10);
  }

  _generateEntityName(content, type) {
    // Extract key terms from content
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 3);
    
    if (words.length === 0) {
      return `${type}_${Date.now()}`;
    }
    
    const name = words.map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join('');
    
    return `${name}${type}`;
  }

  async _findPatterns(entities, relations) {
    const patterns = [];
    
    // Find clusters of highly connected entities
    const clusters = await this.relations.getClusters(3);
    
    for (const cluster of clusters) {
      const pattern = {
        entities: cluster,
        relations: relations.filter(r => 
          cluster.includes(r.from) && cluster.includes(r.to)
        ),
        significance: this._calculateClusterSignificance(cluster, relations)
      };
      
      patterns.push(pattern);
    }
    
    return patterns;
  }

  _rankPatterns(patterns) {
    return patterns.sort((a, b) => {
      // Sort by significance, then by size
      if (a.significance !== b.significance) {
        return b.significance - a.significance;
      }
      return b.entities.length - a.entities.length;
    });
  }

  _calculateClusterSignificance(cluster, relations) {
    const clusterRelations = relations.filter(r => 
      cluster.includes(r.from) && cluster.includes(r.to)
    );
    
    const avgSignificance = clusterRelations.reduce((sum, r) => 
      sum + (r.significance || 5), 0
    ) / clusterRelations.length;
    
    return Math.round(avgSignificance);
  }

  _parseConversation(text) {
    // Simple conversation parsing - can be enhanced
    const lines = text.split('\n');
    const exchanges = [];
    let currentExchange = null;
    
    for (const line of lines) {
      if (line.startsWith('Human:') || line.startsWith('Assistant:')) {
        if (currentExchange) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          id: exchanges.length,
          speaker: line.startsWith('Human:') ? 'human' : 'assistant',
          content: line.substring(line.indexOf(':') + 1).trim()
        };
      } else if (currentExchange) {
        currentExchange.content += '\n' + line;
      }
    }
    
    if (currentExchange) {
      exchanges.push(currentExchange);
    }
    
    return exchanges;
  }

  _extractProblemSolutions(exchange) {
    // Simple problem-solution extraction
    const problemSolutions = [];
    const content = exchange.content.toLowerCase();
    
    // Look for problem indicators
    const problemPatterns = [
      /problem:?\s*(.+?)(?=solution|$)/gi,
      /issue:?\s*(.+?)(?=fix|solution|$)/gi,
      /error:?\s*(.+?)(?=fix|solution|$)/gi
    ];
    
    // Look for solution indicators
    const solutionPatterns = [
      /solution:?\s*(.+?)(?=\n|$)/gi,
      /fix:?\s*(.+?)(?=\n|$)/gi,
      /resolved:?\s*(.+?)(?=\n|$)/gi
    ];
    
    for (const pattern of problemPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const problem = match[1].trim();
        if (problem.length > 10) {
          problemSolutions.push({ problem, solution: null });
        }
      }
    }
    
    for (const pattern of solutionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const solution = match[1].trim();
        if (solution.length > 10) {
          // Try to match with existing problems
          const existingProblem = problemSolutions.find(ps => !ps.solution);
          if (existingProblem) {
            existingProblem.solution = solution;
          } else {
            problemSolutions.push({ problem: null, solution });
          }
        }
      }
    }
    
    return problemSolutions.filter(ps => ps.problem && ps.solution);
  }

  _extractTechnologies(content) {
    const technologies = [];
    const techPatterns = [
      /\b(react|vue|angular|node|express|fastify|webpack|vite|typescript|javascript|python|java|rust|go|docker|kubernetes)\b/gi,
      /\b(mysql|postgresql|mongodb|redis|elasticsearch|nginx|apache)\b/gi
    ];
    
    for (const pattern of techPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const tech = match[1].toLowerCase();
        if (!technologies.includes(tech)) {
          technologies.push(tech);
        }
      }
    }
    
    return technologies;
  }

  _extractCodeFiles(content) {
    const files = [];
    const filePattern = /\b[\w\-\/\.]+\.(js|ts|jsx|tsx|py|java|rs|go|md|json|yaml|yml|html|css|scss)\b/gi;
    
    let match;
    while ((match = filePattern.exec(content)) !== null) {
      const file = match[0];
      if (!files.includes(file)) {
        files.push(file);
      }
    }
    
    return files;
  }

  _extractTechnicalPatterns(content) {
    const patterns = [];
    const patternKeywords = [
      'singleton', 'factory', 'observer', 'strategy', 'decorator', 'adapter',
      'mvc', 'mvp', 'mvvm', 'redux', 'flux', 'microservices', 'monolith',
      'api', 'rest', 'graphql', 'websocket', 'pub/sub', 'event-driven'
    ];
    
    const lowerContent = content.toLowerCase();
    
    for (const keyword of patternKeywords) {
      if (lowerContent.includes(keyword)) {
        patterns.push(keyword);
      }
    }
    
    return patterns;
  }

  _parseGitDiff(diff) {
    // Simplified git diff parsing
    const changes = [];
    const lines = diff.split('\n');
    let currentFile = null;
    
    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = {
            file: match[2],
            additions: 0,
            deletions: 0,
            changes: []
          };
          changes.push(currentFile);
        }
      } else if (currentFile) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentFile.additions++;
          currentFile.changes.push({ type: 'addition', content: line.substring(1) });
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentFile.deletions++;
          currentFile.changes.push({ type: 'deletion', content: line.substring(1) });
        }
      }
    }
    
    return changes;
  }

  _isArchitecturalChange(change) {
    const architecturalIndicators = [
      'package.json',
      'dockerfile',
      'docker-compose',
      'config',
      'webpack',
      'vite.config',
      'tsconfig',
      'babel.config'
    ];
    
    const filename = change.file.toLowerCase();
    return architecturalIndicators.some(indicator => filename.includes(indicator));
  }

  _describeArchitecturalChange(change) {
    const filename = change.file.toLowerCase();
    
    if (filename.includes('package.json')) {
      return 'Package dependencies updated';
    } else if (filename.includes('docker')) {
      return 'Docker configuration changed';
    } else if (filename.includes('config')) {
      return 'Configuration file modified';
    } else {
      return `Architectural change in ${change.file}`;
    }
  }

  _detectPatternImplementations(change) {
    const patterns = [];
    const content = change.changes.map(c => c.content).join('\n').toLowerCase();
    
    // Detect common patterns
    if (content.includes('export class') || content.includes('class ')) {
      patterns.push('Class-based architecture');
    }
    
    if (content.includes('usestate') || content.includes('useeffect')) {
      patterns.push('React Hooks pattern');
    }
    
    if (content.includes('reducer') || content.includes('dispatch')) {
      patterns.push('Reducer pattern');
    }
    
    return patterns;
  }

  _findPotentialDuplicates(entities) {
    const duplicates = [];
    
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const entity1 = entities[i];
        const entity2 = entities[j];
        
        // Check name similarity
        const nameSimilarity = this._calculateSimilarity(entity1.name, entity2.name);
        
        if (nameSimilarity > 0.8) {
          duplicates.push([entity1.name, entity2.name]);
        }
      }
    }
    
    return duplicates;
  }

  _calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this._levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  _levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }
}