/**
 * AdaptiveTranscriptFormatDetector - Automatically learns and adapts to transcript formats
 * 
 * Features:
 * - Auto-detects transcript message structure patterns
 * - Learns and stores format schemas in config file
 * - Handles format evolution gracefully
 * - Provides robust extraction logic for any format
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const { varDir } = require('../../lib/paths/data-home.cjs');

// The formats coding ships with (tools repo) seed what this machine learns.
// Learned state is rewritten on every match, so it lives in the data home's
// var/ — never in the project the monitor watches (it used to default to
// <cwd>/config/, and the ETM's cwd IS the project: every watched repo grew a
// config/transcript-formats.json, often committed).
const SHIPPED_FORMATS = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'transcript-formats.json');

class AdaptiveTranscriptFormatDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      configPath: options.configPath || path.join(varDir(), 'transcript-formats.json'),
      sampleSize: options.sampleSize || 100, // Messages to analyze for format detection
      confidenceThreshold: options.confidenceThreshold || 0.8,
      debug: options.debug || false,
      explicitPath: Boolean(options.configPath)
    };
    
    this.knownFormats = new Map();
    this.loadKnownFormats();
  }

  /**
   * Load known formats from config file
   */
  loadKnownFormats() {
    try {
      const source = fs.existsSync(this.config.configPath) ? this.config.configPath
        : (!this.config.explicitPath && fs.existsSync(SHIPPED_FORMATS) ? SHIPPED_FORMATS : null);
      if (source) {
        const configData = JSON.parse(fs.readFileSync(source, 'utf8'));
        
        for (const [formatId, formatDef] of Object.entries(configData.formats || {})) {
          this.knownFormats.set(formatId, {
            ...formatDef,
            lastSeen: new Date(formatDef.lastSeen),
            firstSeen: new Date(formatDef.firstSeen)
          });
        }
        
        this.debug(`Loaded ${this.knownFormats.size} known formats from config`);
      } else {
        // Initialize with known formats
        this.initializeBaseFormats();
      }
    } catch (error) {
      this.debug(`Error loading format config: ${error.message}`);
      this.initializeBaseFormats();
    }
  }

  /**
   * Initialize with the formats we currently know about
   */
  initializeBaseFormats() {
    // Format 1: New Claude Code format (human_turn_start/claude_turn_start)
    this.knownFormats.set('claude-code-v2', {
      id: 'claude-code-v2',
      name: 'Claude Code V2 Format',
      description: 'New format with human_turn_start/claude_turn_start',
      version: '2.0',
      patterns: {
        userTurnStart: { type: 'human_turn_start', required: ['uuid', 'timestamp'] },
        userTurnEnd: { type: 'human_turn_end', required: ['content'] },
        assistantTurnStart: { type: 'claude_turn_start', required: [] },
        assistantTurnEnd: { type: 'claude_turn_end', required: ['content'] },
        toolUse: { type: 'tool_use', required: ['tool_use_id', 'tool_name', 'input_json'] },
        toolResult: { type: 'tool_result', required: ['tool_use_id', 'output_json'] }
      },
      confidence: 1.0,
      firstSeen: new Date('2025-09-15'),
      lastSeen: new Date(),
      sampleCount: 0
    });

    // Format 2: Legacy Claude format (user/assistant)
    this.knownFormats.set('claude-legacy-v1', {
      id: 'claude-legacy-v1', 
      name: 'Claude Legacy V1 Format',
      description: 'Legacy format with user/assistant message types',
      version: '1.0',
      patterns: {
        userMessage: { 
          type: 'user', 
          required: ['uuid', 'timestamp', 'message'],
          messageStructure: { role: 'user', content: 'string|array' }
        },
        assistantMessage: {
          type: 'assistant',
          required: ['uuid', 'timestamp', 'message'],
          messageStructure: { role: 'assistant', content: 'string|array' }
        }
      },
      confidence: 1.0,
      firstSeen: new Date('2025-09-13'),
      lastSeen: new Date('2025-09-14'),
      sampleCount: 0
    });

    this.saveFormatsConfig();
  }

  /**
   * Analyze a batch of messages to detect format patterns
   */
  analyzeMessageBatch(messages) {
    if (!messages || messages.length === 0) return null;

    const sample = messages.slice(0, this.config.sampleSize);
    const analysis = {
      messageTypes: new Map(),
      messageStructures: new Map(),
      commonFields: new Set(),
      exchangePatterns: [],
      confidence: 0
    };

    // Analyze message type distribution and structure
    for (const msg of sample) {
      if (!msg || typeof msg !== 'object') continue;

      const msgType = msg.type;
      if (!msgType) continue;

      // Count message types
      analysis.messageTypes.set(msgType, (analysis.messageTypes.get(msgType) || 0) + 1);

      // Analyze structure
      const structure = this.analyzeMessageStructure(msg);
      const structureKey = JSON.stringify(structure);
      analysis.messageStructures.set(structureKey, {
        ...structure,
        count: (analysis.messageStructures.get(structureKey)?.count || 0) + 1,
        type: msgType
      });

      // Track common fields
      Object.keys(msg).forEach(field => analysis.commonFields.add(field));
    }

    // Detect exchange patterns
    analysis.exchangePatterns = this.detectExchangePatterns(sample);
    
    // Calculate confidence based on pattern consistency
    analysis.confidence = this.calculatePatternConfidence(analysis);

    return analysis;
  }

  /**
   * Analyze the structure of a single message
   */
  analyzeMessageStructure(msg) {
    const structure = {
      fields: {},
      nested: {},
      types: {}
    };

    for (const [key, value] of Object.entries(msg)) {
      structure.types[key] = typeof value;
      
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          structure.fields[key] = 'array';
          if (value.length > 0) {
            structure.nested[key] = typeof value[0];
          }
        } else {
          structure.fields[key] = 'object';
          structure.nested[key] = Object.keys(value);
        }
      } else {
        structure.fields[key] = typeof value;
      }
    }

    return structure;
  }

  /**
   * Detect patterns in message sequences that indicate exchanges
   */
  detectExchangePatterns(messages) {
    const patterns = [];
    let currentPattern = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const current = messages[i];
      const next = messages[i + 1];

      if (!current?.type || !next?.type) continue;

      const transition = `${current.type} -> ${next.type}`;
      currentPattern.push(transition);

      // Look for turn boundaries (user -> assistant or similar)
      if (this.isExchangeBoundary(current, next)) {
        if (currentPattern.length > 0) {
          patterns.push([...currentPattern]);
          currentPattern = [];
        }
      }

      // Limit pattern length
      if (currentPattern.length > 10) {
        currentPattern = currentPattern.slice(-5);
      }
    }

    return patterns;
  }

  /**
   * Determine if there's an exchange boundary between two messages
   */
  isExchangeBoundary(current, next) {
    // Check for user/assistant transitions
    if (current.type === 'user' && next.type === 'assistant') return true;
    if (current.type === 'assistant' && next.type === 'user') return true;
    
    // Check for turn end/start transitions
    if (current.type?.includes('turn_end') && next.type?.includes('turn_start')) return true;
    if (current.type === 'claude_turn_end' && next.type === 'human_turn_start') return true;
    
    return false;
  }

  /**
   * Calculate confidence score for detected patterns
   */
  calculatePatternConfidence(analysis) {
    let confidence = 0;
    
    // Consistency of message types (higher = better)
    const typeEntropy = this.calculateEntropy(Array.from(analysis.messageTypes.values()));
    confidence += (1 - typeEntropy) * 0.3;
    
    // Presence of exchange patterns (higher = better)
    if (analysis.exchangePatterns.length > 0) {
      confidence += 0.3;
    }
    
    // Structural consistency (higher = better)
    const structureConsistency = this.calculateStructureConsistency(analysis.messageStructures);
    confidence += structureConsistency * 0.4;
    
    return Math.min(1.0, confidence);
  }

  /**
   * Calculate entropy for array of values (0 = perfect consistency, 1 = maximum chaos)
   */
  calculateEntropy(values) {
    const total = values.reduce((sum, val) => sum + val, 0);
    if (total === 0) return 1;
    
    const probabilities = values.map(val => val / total);
    const entropy = -probabilities.reduce((sum, p) => {
      return p > 0 ? sum + p * Math.log2(p) : sum;
    }, 0);
    
    return entropy / Math.log2(values.length) || 0;
  }

  /**
   * Calculate how consistent message structures are
   */
  calculateStructureConsistency(structures) {
    if (structures.size === 0) return 0;
    
    const structuresByType = new Map();
    
    for (const [structureKey, structureData] of structures) {
      const type = structureData.type;
      if (!structuresByType.has(type)) {
        structuresByType.set(type, []);
      }
      structuresByType.get(type).push(structureData);
    }
    
    // Calculate consistency within each message type
    let totalConsistency = 0;
    let typeCount = 0;
    
    for (const [type, typeStructures] of structuresByType) {
      if (typeStructures.length === 1) {
        totalConsistency += 1; // Perfect consistency
      } else {
        // Calculate variance in structures for this type
        const consistency = 1 / typeStructures.length; // Simple heuristic
        totalConsistency += consistency;
      }
      typeCount++;
    }
    
    return typeCount > 0 ? totalConsistency / typeCount : 0;
  }

  /**
   * Detect format for a batch of messages
   */
  detectFormat(messages) {
    const analysis = this.analyzeMessageBatch(messages);
    if (!analysis || analysis.confidence < this.config.confidenceThreshold) {
      return null;
    }

    // Try to match against known formats
    for (const [formatId, format] of this.knownFormats) {
      const matchScore = this.calculateFormatMatch(analysis, format);
      if (matchScore > 0.8) {
        this.debug(`Matched known format: ${formatId} (score: ${matchScore.toFixed(2)})`);
        
        // Update format statistics
        format.lastSeen = new Date();
        format.sampleCount += messages.length;
        this.saveFormatsConfig();
        
        return {
          formatId,
          format,
          matchScore,
          analysis
        };
      }
    }

    // If no match, create new format
    return this.createNewFormat(analysis, messages);
  }

  /**
   * Calculate how well analysis matches a known format
   */
  calculateFormatMatch(analysis, format) {
    let score = 0;
    let checks = 0;

    // Check message type patterns
    for (const [patternKey, patternDef] of Object.entries(format.patterns)) {
      checks++;
      
      if (analysis.messageTypes.has(patternDef.type)) {
        score += 1;
      }
    }

    return checks > 0 ? score / checks : 0;
  }

  /**
   * Create a new format definition from analysis
   */
  createNewFormat(analysis, messages) {
    const formatId = `detected-${Date.now()}`;
    const timestamp = new Date();
    
    const newFormat = {
      id: formatId,
      name: `Auto-detected Format ${formatId}`,
      description: `Automatically detected format with ${analysis.messageTypes.size} message types`,
      version: '1.0',
      patterns: this.generatePatternsFromAnalysis(analysis),
      confidence: analysis.confidence,
      firstSeen: timestamp,
      lastSeen: timestamp,
      sampleCount: messages.length,
      autoDetected: true
    };

    this.knownFormats.set(formatId, newFormat);
    this.saveFormatsConfig();
    
    this.debug(`Created new format: ${formatId} (confidence: ${analysis.confidence.toFixed(2)})`);
    this.emit('formatDetected', { formatId, format: newFormat, analysis });

    return {
      formatId,
      format: newFormat,
      matchScore: 1.0,
      analysis
    };
  }

  /**
   * Generate pattern definitions from analysis results
   */
  generatePatternsFromAnalysis(analysis) {
    const patterns = {};
    
    for (const [structureKey, structureData] of analysis.messageStructures) {
      const patternKey = `${structureData.type}_pattern`;
      
      patterns[patternKey] = {
        type: structureData.type,
        required: Object.keys(structureData.fields || {}),
        structure: structureData.fields,
        nested: structureData.nested
      };
    }

    return patterns;
  }

  /**
   * Save formats configuration to file
   */
  saveFormatsConfig() {
    try {
      const configDir = path.dirname(this.config.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const configData = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        formats: {}
      };

      for (const [formatId, format] of this.knownFormats) {
        configData.formats[formatId] = {
          ...format,
          firstSeen: format.firstSeen.toISOString(),
          lastSeen: format.lastSeen.toISOString()
        };
      }

      fs.writeFileSync(this.config.configPath, JSON.stringify(configData, null, 2), 'utf8');
      this.debug(`Saved ${this.knownFormats.size} formats to config`);
    } catch (error) {
      this.debug(`Error saving format config: ${error.message}`);
    }
  }

  /**
   * Get the best extraction strategy for detected format
   */
  getExtractionStrategy(formatResult) {
    if (!formatResult) return this.getDefaultStrategy();

    const { format } = formatResult;
    
    // Generate extraction strategy based on format patterns
    const strategy = {
      formatId: format.id,
      exchangeDetection: this.generateExchangeDetection(format),
      messageExtraction: this.generateMessageExtraction(format),
      toolHandling: this.generateToolHandling(format)
    };

    return strategy;
  }

  /**
   * Generate exchange detection logic for format
   */
  generateExchangeDetection(format) {
    const detection = {
      userTurnIndicators: [],
      assistantTurnIndicators: [],
      turnBoundaries: []
    };

    for (const [patternKey, pattern] of Object.entries(format.patterns)) {
      if (pattern.type?.includes('user') || pattern.type?.includes('human')) {
        detection.userTurnIndicators.push(pattern.type);
      }
      
      if (pattern.type?.includes('assistant') || pattern.type?.includes('claude')) {
        detection.assistantTurnIndicators.push(pattern.type);
      }
      
      if (pattern.type?.includes('turn_start') || pattern.type?.includes('turn_end')) {
        detection.turnBoundaries.push(pattern.type);
      }
    }

    return detection;
  }

  /**
   * Generate message extraction logic for format
   */
  generateMessageExtraction(format) {
    const extraction = {
      userContentPath: null,
      assistantContentPath: null,
      metadataFields: []
    };

    // Analyze patterns to determine content extraction paths
    for (const [patternKey, pattern] of Object.entries(format.patterns)) {
      if (pattern.nested && pattern.nested.message) {
        if (pattern.type?.includes('user') || pattern.type?.includes('human')) {
          extraction.userContentPath = 'message.content';
        }
        if (pattern.type?.includes('assistant') || pattern.type?.includes('claude')) {
          extraction.assistantContentPath = 'message.content';
        }
      } else if (pattern.required?.includes('content')) {
        if (pattern.type?.includes('user') || pattern.type?.includes('human')) {
          extraction.userContentPath = 'content';
        }
        if (pattern.type?.includes('assistant') || pattern.type?.includes('claude')) {
          extraction.assistantContentPath = 'content';
        }
      }

      // Track metadata fields
      if (pattern.required) {
        extraction.metadataFields.push(...pattern.required);
      }
    }

    return extraction;
  }

  /**
   * Generate tool handling logic for format
   */
  generateToolHandling(format) {
    const handling = {
      toolUseType: null,
      toolResultType: null,
      toolCallStructure: null,
      toolResultStructure: null
    };

    for (const [patternKey, pattern] of Object.entries(format.patterns)) {
      if (pattern.type?.includes('tool_use')) {
        handling.toolUseType = pattern.type;
        handling.toolCallStructure = pattern.required;
      }
      
      if (pattern.type?.includes('tool_result')) {
        handling.toolResultType = pattern.type;
        handling.toolResultStructure = pattern.required;
      }
    }

    return handling;
  }

  /**
   * Get default extraction strategy when format detection fails
   */
  getDefaultStrategy() {
    return {
      formatId: 'fallback',
      exchangeDetection: {
        userTurnIndicators: ['user', 'human_turn_start'],
        assistantTurnIndicators: ['assistant', 'claude_turn_start'],
        turnBoundaries: ['human_turn_end', 'claude_turn_end']
      },
      messageExtraction: {
        userContentPath: 'message.content',
        assistantContentPath: 'message.content',
        metadataFields: ['uuid', 'timestamp', 'type']
      },
      toolHandling: {
        toolUseType: 'tool_use',
        toolResultType: 'tool_result',
        toolCallStructure: ['tool_use_id', 'tool_name', 'input_json'],
        toolResultStructure: ['tool_use_id', 'output_json']
      }
    };
  }

  debug(message) {
    if (this.config.debug) {
      console.log(`[AdaptiveFormatDetector] ${message}`);
    }
  }
}

export default AdaptiveTranscriptFormatDetector;