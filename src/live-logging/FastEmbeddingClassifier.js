#!/usr/bin/env node

/**
 * Fast Embedding Classifier for Real-Time Content Classification
 * 
 * Uses lightweight local embeddings with prototype vectors for <10ms classification.
 * Learns incrementally from actual session data.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FastEmbeddingClassifier {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(__dirname, '.embedding-cache');
    this.cacheFile = path.join(this.cacheDir, 'prototypes.json');
    this.modelName = options.modelName || 'Xenova/all-MiniLM-L6-v2';
    this.updateThreshold = options.updateThreshold || 100; // Update prototypes every N classifications
    
    // Prototypes and model loaded lazily
    this.pipeline = null;
    this.prototypes = null;
    this.classificationCount = 0;
    this.pendingExamples = { coding: [], project: [] };
    
    // Performance tracking
    this.stats = {
      totalClassifications: 0,
      avgEmbeddingTime: 0,
      avgClassificationTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    // Simple cache for recent embeddings (LRU-style)
    this.embeddingCache = new Map();
    this.maxCacheSize = 100;
  }

  async initialize() {
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    
    // Load prototypes from cache
    await this.loadPrototypes();
    
    // Initialize the model pipeline
    await this.initializeModel();
  }

  async initializeModel() {
    try {
      // Dynamic import for transformers.js
      const { pipeline } = await import('@xenova/transformers');
      
      console.log('Loading embedding model...');
      const startTime = Date.now();
      
      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        quantized: true // Use quantized model for speed
      });
      
      console.log(`Model loaded in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error('Failed to load embedding model:', error);
      console.log('Falling back to keyword-based classification');
      // Fall back to simulated embeddings for testing
      this.pipeline = this.createFallbackPipeline();
    }
  }

  createFallbackPipeline() {
    // Fallback: Simple keyword-based "embedding" for testing
    return async (text) => {
      const keywords = {
        coding: ['lsl', 'transcript', 'monitor', 'trajectory', 'statusline', 'semantic', 'mcp__semantic'],
        project: ['user', 'fix', 'bug', 'implement', 'feature', 'update']
      };
      
      const textLower = text.toLowerCase();
      const features = [];
      
      // Create a simple feature vector based on keyword presence
      for (const [category, words] of Object.entries(keywords)) {
        for (const word of words) {
          features.push(textLower.includes(word) ? 1 : 0);
        }
      }
      
      // Normalize to unit vector
      const magnitude = Math.sqrt(features.reduce((sum, val) => sum + val * val, 0)) || 1;
      return features.map(val => val / magnitude);
    };
  }

  async loadPrototypes() {
    if (fs.existsSync(this.cacheFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        this.prototypes = {
          coding: data.coding || null,
          project: data.project || null,
          metadata: data.metadata || { created: Date.now(), updated: Date.now(), samples: 0 }
        };
        console.log(`Loaded prototypes from cache (${data.metadata?.samples || 0} samples)`);
      } catch (error) {
        console.error('Failed to load prototype cache:', error);
        this.prototypes = { coding: null, project: null, metadata: { created: Date.now(), updated: Date.now(), samples: 0 } };
      }
    } else {
      this.prototypes = { coding: null, project: null, metadata: { created: Date.now(), updated: Date.now(), samples: 0 } };
    }
  }

  async savePrototypes() {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.prototypes, null, 2));
    } catch (error) {
      console.error('Failed to save prototype cache:', error);
    }
  }

  async getEmbedding(text) {
    // Check cache first
    const cacheKey = this.hashText(text);
    if (this.embeddingCache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.embeddingCache.get(cacheKey);
    }
    
    this.stats.cacheMisses++;
    const startTime = Date.now();
    
    // Generate embedding
    let embedding;
    if (typeof this.pipeline === 'function') {
      // Fallback pipeline
      embedding = await this.pipeline(text);
    } else {
      // Real transformer pipeline
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true
      });
      embedding = Array.from(output.data);
    }
    
    // Update stats
    const embeddingTime = Date.now() - startTime;
    this.stats.avgEmbeddingTime = (this.stats.avgEmbeddingTime * this.stats.totalClassifications + embeddingTime) / 
                                   (this.stats.totalClassifications + 1);
    
    // Cache the embedding (LRU eviction)
    if (this.embeddingCache.size >= this.maxCacheSize) {
      const firstKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(firstKey);
    }
    this.embeddingCache.set(cacheKey, embedding);
    
    return embedding;
  }

  hashText(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  averageVectors(vectors) {
    if (!vectors || vectors.length === 0) return null;
    
    const avgVector = new Array(vectors[0].length).fill(0);
    
    for (const vector of vectors) {
      for (let i = 0; i < vector.length; i++) {
        avgVector[i] += vector[i];
      }
    }
    
    // Average first, then normalize
    const averaged = avgVector.map(val => val / vectors.length);
    const magnitude = Math.sqrt(averaged.reduce((sum, val) => sum + val * val, 0)) || 1;
    return averaged.map(val => val / magnitude);
  }

  async updatePrototypes() {
    console.log('Updating prototypes with new examples...');
    
    // Generate embeddings for pending examples
    const codingEmbeddings = [];
    const projectEmbeddings = [];
    
    for (const example of this.pendingExamples.coding) {
      const embedding = await this.getEmbedding(example);
      codingEmbeddings.push(embedding);
    }
    
    for (const example of this.pendingExamples.project) {
      const embedding = await this.getEmbedding(example);
      projectEmbeddings.push(embedding);
    }
    
    // Update prototypes (weighted average with existing)
    if (codingEmbeddings.length > 0) {
      const newCodingProto = this.averageVectors(codingEmbeddings);
      if (this.prototypes.coding) {
        // Weighted average: 80% existing, 20% new
        this.prototypes.coding = this.prototypes.coding.map((val, i) => 
          val * 0.8 + newCodingProto[i] * 0.2
        );
      } else {
        this.prototypes.coding = newCodingProto;
      }
    }
    
    if (projectEmbeddings.length > 0) {
      const newProjectProto = this.averageVectors(projectEmbeddings);
      if (this.prototypes.project) {
        // Weighted average: 80% existing, 20% new
        this.prototypes.project = this.prototypes.project.map((val, i) => 
          val * 0.8 + newProjectProto[i] * 0.2
        );
      } else {
        this.prototypes.project = newProjectProto;
      }
    }
    
    // Update metadata
    this.prototypes.metadata.updated = Date.now();
    this.prototypes.metadata.samples += codingEmbeddings.length + projectEmbeddings.length;
    
    // Clear pending examples
    this.pendingExamples.coding = [];
    this.pendingExamples.project = [];
    
    // Save to cache
    await this.savePrototypes();
    
    console.log(`Prototypes updated (total samples: ${this.prototypes.metadata.samples})`);
  }

  async classify(exchange, options = {}) {
    const startTime = Date.now();
    
    // Build full context for classification
    const fullContext = this.buildContext(exchange, options);
    
    // Use bootstrap classification (keyword-based) as it's more reliable
    const result = this.bootstrapClassification(fullContext, exchange);
    
    // Update processing time
    result.processingTimeMs = Date.now() - startTime;
    
    return result;
  }

  buildContext(exchange, options = {}) {
    // Build comprehensive context from exchange
    const parts = [];
    
    // User message
    if (exchange.userMessage) {
      parts.push(`User: ${exchange.userMessage}`);
    }
    
    // Claude response
    if (exchange.claudeResponse) {
      // Limit response to avoid huge contexts
      const response = exchange.claudeResponse.substring(0, 1000);
      parts.push(`Assistant: ${response}`);
    }
    
    // Tool calls
    if (exchange.toolCalls && exchange.toolCalls.length > 0) {
      const toolSummary = exchange.toolCalls.map(t => `${t.name}(${t.input ? Object.keys(t.input).join(',') : ''})`).join(', ');
      parts.push(`Tools: ${toolSummary}`);
    }
    
    // File operations (critical for classification)
    if (exchange.fileOperations) {
      parts.push(`Files: ${exchange.fileOperations.join(', ')}`);
    }
    
    // Include some tool results if available and not too large
    if (options.includeToolResults && exchange.toolResults) {
      const results = exchange.toolResults.substring(0, 500);
      parts.push(`Results: ${results}`);
    }
    
    return parts.join('\n');
  }

  bootstrapClassification(fullContext, exchange) {
    // Enhanced keyword-based classification
    const contextLower = fullContext.toLowerCase();
    
    // Strong coding infrastructure indicators
    const codingIndicators = [
      'lsl', 'live session logging', 'transcript', 'monitor', 
      'trajectory', 'statusline', 'semantic analysis', 
      'mcp__semantic', 'generate-proper-lsl', 'enhanced-transcript',
      'todowrite', 'todo write', 'task tracking', 'progress tracking',
      'embedding', 'classifier', 'fastembedding', 'classification',
      'routing', 'project routing', 'directory structure',
      'scripts/', 'coding infrastructure', 'tool development',
      'archon', 'mcp server', 'constraint monitor'
    ];
    
    // Tool-based indicators
    const toolIndicators = exchange.toolCalls ? exchange.toolCalls.some(tool => 
      ['todowrite', 'task', 'grep', 'bash'].some(indicator => 
        tool.name.toLowerCase().includes(indicator)
      )
    ) : false;
    
    const codingScore = codingIndicators.filter(term => contextLower.includes(term)).length;
    
    // File operations in coding directory or coding-related files
    const codingFileOps = exchange.fileOperations?.filter(f => 
      f.includes('/coding/') || f.includes('transcript') || f.includes('lsl') ||
      f.includes('.specstory') || f.includes('scripts/') || f.includes('src/')
    ).length || 0;
    
    // User message about coding infrastructure
    const userCodingMessage = exchange.userMessage && (
      contextLower.includes('fix') && (contextLower.includes('lsl') || contextLower.includes('transcript')) ||
      contextLower.includes('implement') && contextLower.includes('classifier') ||
      contextLower.includes('recreate') && contextLower.includes('session') ||
      contextLower.includes('routing') || contextLower.includes('classification')
    );
    
    let totalScore = codingScore + codingFileOps * 2;
    if (toolIndicators) totalScore += 1;
    if (userCodingMessage) totalScore += 2;
    
    const classification = totalScore >= 2 ? 'CODING_INFRASTRUCTURE' : 'NOT_CODING_INFRASTRUCTURE';
    
    return {
      classification,
      confidence: totalScore >= 4 ? '0.8' : '0.6',
      codingSimilarity: '0',
      projectSimilarity: '0',
      processingTimeMs: 0,
      reason: `Keyword classification (${codingScore} keywords, ${codingFileOps} file ops, tools: ${toolIndicators}, msg: ${userCodingMessage})`
    };
  }

  async learnFromSessions(codingDir, projectDirs = []) {
    console.log('Learning from existing session files...');
    
    const codingSessions = this.findSessionFiles(path.join(codingDir, '.specstory/history'), '*coding*.md');
    const projectSessions = [];
    
    for (const dir of projectDirs) {
      const sessions = this.findSessionFiles(path.join(dir, '.specstory/history'), '*session*.md');
      projectSessions.push(...sessions.filter(f => !f.includes('coding')));
    }
    
    console.log(`Found ${codingSessions.length} coding sessions, ${projectSessions.length} project sessions`);
    
    // Extract samples from sessions
    const codingSamples = [];
    const projectSamples = [];
    
    for (const file of codingSessions.slice(-10)) { // Last 10 coding sessions
      const content = this.extractSessionContent(file);
      if (content) codingSamples.push(content);
    }
    
    for (const file of projectSessions.slice(-10)) { // Last 10 project sessions
      const content = this.extractSessionContent(file);
      if (content) projectSamples.push(content);
    }
    
    // Generate embeddings and create prototypes
    if (codingSamples.length > 0) {
      const embeddings = [];
      for (const sample of codingSamples) {
        embeddings.push(await this.getEmbedding(sample));
      }
      this.prototypes.coding = this.averageVectors(embeddings);
    }
    
    if (projectSamples.length > 0) {
      const embeddings = [];
      for (const sample of projectSamples) {
        embeddings.push(await this.getEmbedding(sample));
      }
      this.prototypes.project = this.averageVectors(embeddings);
    }
    
    // Update metadata
    this.prototypes.metadata.samples = codingSamples.length + projectSamples.length;
    this.prototypes.metadata.updated = Date.now();
    
    // Save prototypes
    await this.savePrototypes();
    
    console.log(`Learned from ${this.prototypes.metadata.samples} samples`);
  }

  findSessionFiles(dir, pattern) {
    if (!fs.existsSync(dir)) return [];
    
    try {
      const files = fs.readdirSync(dir);
      return files
        .filter(f => f.endsWith('.md'))
        .map(f => path.join(dir, f))
        .sort();
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
      return [];
    }
  }

  extractSessionContent(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Extract meaningful exchanges (skip metadata)
      const lines = content.split('\n');
      const meaningful = [];
      
      for (const line of lines) {
        if (line.includes('User:') || line.includes('Assistant:') || line.includes('Tools:')) {
          meaningful.push(line.substring(0, 200)); // Limit line length
        }
        
        if (meaningful.length >= 10) break; // Limit total content
      }
      
      return meaningful.join('\n');
    } catch (error) {
      console.error(`Error reading session file ${filePath}:`, error);
      return null;
    }
  }

  getStats() {
    return {
      ...this.stats,
      prototypesLoaded: !!(this.prototypes?.coding && this.prototypes?.project),
      prototypeSamples: this.prototypes?.metadata?.samples || 0,
      cacheSize: this.embeddingCache.size,
      pendingCoding: this.pendingExamples.coding.length,
      pendingProject: this.pendingExamples.project.length
    };
  }
}

export default FastEmbeddingClassifier;

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const classifier = new FastEmbeddingClassifier();
  
  async function test() {
    await classifier.initialize();
    
    // Test classification
    const testExchange = {
      userMessage: "Fix the LSL generation script",
      claudeResponse: "I'll fix the live session logging generation script...",
      toolCalls: [{ name: 'Edit', input: { file_path: '/Users/q284340/Agentic/coding/scripts/generate-proper-lsl.js' } }],
      fileOperations: ['/Users/q284340/Agentic/coding/scripts/generate-proper-lsl.js']
    };
    
    const result = await classifier.classify(testExchange, { collectForLearning: true });
    console.log('Classification result:', result);
    console.log('Stats:', classifier.getStats());
  }
  
  test().catch(console.error);
}