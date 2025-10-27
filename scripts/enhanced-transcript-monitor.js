#!/usr/bin/env node

/**
 * Enhanced Claude Code Transcript Monitor
 * Supports multiple parallel sessions with prompt-triggered trajectory updates
 */

// Load environment variables from coding/.env
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const codingRoot = join(__dirname, '..');
config({ path: join(codingRoot, '.env') });

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { parseTimestamp, formatTimestamp, getTimeWindow, getTimezone, utcToLocalTime, generateLSLFilename } from './timezone-utils.js';
import AdaptiveExchangeExtractor from '../src/live-logging/AdaptiveExchangeExtractor.js';
import { SemanticAnalyzer } from '../src/live-logging/SemanticAnalyzer.js';
import ReliableCodingClassifier from '../src/live-logging/ReliableCodingClassifier.js';
import StreamingTranscriptReader from '../src/live-logging/StreamingTranscriptReader.js';
import ConfigurableRedactor from '../src/live-logging/ConfigurableRedactor.js';
import UserHashGenerator from '../src/live-logging/user-hash-generator.js';
import LSLFileManager from '../src/live-logging/LSLFileManager.js';
import ClassificationLogger from './classification-logger.js';

// Knowledge management dependencies
import { DatabaseManager } from '../src/databases/DatabaseManager.js';
import { EmbeddingGenerator } from '../src/knowledge-management/EmbeddingGenerator.js';
import { UnifiedInferenceEngine } from '../src/inference/UnifiedInferenceEngine.js';

// Trajectory analyzer integration (optional - requires @anthropic-ai/sdk)
let RealTimeTrajectoryAnalyzer = null;
try {
  const module = await import('../src/live-logging/RealTimeTrajectoryAnalyzer.js');
  RealTimeTrajectoryAnalyzer = module.default || module.RealTimeTrajectoryAnalyzer;
} catch (err) {
  // Trajectory analyzer not available (missing dependencies) - continue without it
  console.log('Trajectory analyzer not available:', err.message);
}

// Knowledge extraction integration (optional)
let StreamingKnowledgeExtractor = null;
try {
  const module = await import('../src/knowledge-management/StreamingKnowledgeExtractor.js');
  StreamingKnowledgeExtractor = module.default;
} catch (err) {
  // Knowledge extraction not available - continue without it
  console.log('Knowledge extraction not available:', err.message);
}

// ConfigurableRedactor instance for consistent redaction
let redactor = null;

// Initialize redactor with configuration
async function initializeRedactor() {
  if (!redactor) {
    const codingPath = process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding';
    redactor = new ConfigurableRedactor({
      configPath: path.join(codingPath, '.specstory', 'config', 'redaction-patterns.json'),
      debug: false
    });
    
    // CRITICAL: Actually initialize the redactor - no fallbacks allowed
    await redactor.initialize();
  }
  return redactor;
}

// Function to redact API keys and secrets from text using ConfigurableRedactor
async function redactSecrets(text) {
  if (!text) return text;
  
  // NO FALLBACKS - fail properly if redactor can't initialize
  const redactorInstance = await initializeRedactor();
  return redactorInstance.redact(text);
}

class EnhancedTranscriptMonitor {
  constructor(config = {}) {
    // Initialize debug early so it can be used in getProjectPath
    this.debug_enabled = config.debug || process.env.TRANSCRIPT_DEBUG === 'true';
    
    this.config = {
      checkInterval: config.checkInterval || 2000, // More frequent for prompt detection
      projectPath: config.projectPath || this.getProjectPath(),
      debug: this.debug_enabled,
      sessionDuration: config.sessionDuration || 7200000, // 2 hours (generous for debugging)
      timezone: config.timezone || getTimezone(), // Use central timezone config
      healthFile: this.getCentralizedHealthFile(config.projectPath || this.getProjectPath()),
      mode: config.mode || 'all', // Processing mode: 'all' or 'foreign'
      ...config
    };
    
    // Store options for methods to access
    this.options = config;

    this.transcriptPath = this.findCurrentTranscript();

    // State file for persisting lastProcessedUuid across restarts
    this.stateFile = this.getStateFilePath();
    this.lastProcessedUuid = this.loadLastProcessedUuid();
    this.exchangeCount = 0;
    this.lastFileSize = 0;
    
    // Initialize adaptive exchange extractor for streaming processing
    this.adaptiveExtractor = new AdaptiveExchangeExtractor();
    
    // Initialize LSL File Manager for size monitoring and rotation
    this.fileManager = new LSLFileManager({
      maxFileSize: config.maxFileSize || (50 * 1024 * 1024), // 50MB default
      rotationThreshold: config.rotationThreshold || (40 * 1024 * 1024), // 40MB rotation trigger
      enableCompression: false, // Disabled - keep files uncompressed
      compressionLevel: config.compressionLevel || 6,
      maxArchivedFiles: config.maxArchivedFiles || 50,
      monitoringInterval: config.fileMonitoringInterval || (5 * 60 * 1000), // 5 minutes
      enableRealTimeMonitoring: config.enableFileMonitoring !== false,
      debug: this.debug_enabled
    });
    this.isProcessing = false;
    this.currentUserPromptSet = [];
    this.lastUserPromptTime = null;
    this.sessionFiles = new Map(); // Track multiple session files
    
    // Initialize reliable coding classifier for local classification
    this.reliableCodingClassifier = null;
    this.reliableCodingClassifierReady = false;
    this.initializeReliableCodingClassifier().catch(err => {
      console.error('Reliable coding classifier initialization failed:', err.message);
    });

    // Initialize knowledge extraction (optional, non-blocking)
    this.knowledgeExtractor = null;
    this.knowledgeExtractionEnabled = config.enableKnowledgeExtraction !== false && StreamingKnowledgeExtractor !== null;
    this.knowledgeExtractionStatus = { state: 'idle', lastExtraction: null, errorCount: 0 };
    if (this.knowledgeExtractionEnabled) {
      this.initializeKnowledgeExtractor().catch(err => {
        this.debug(`Knowledge extractor initialization failed (non-critical): ${err.message}`);
        this.knowledgeExtractionStatus.state = 'disabled';
      });
    }
    
    // Initialize semantic analyzer for content classification (fallback)
    this.semanticAnalyzer = null;
    try {
      const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.OPENAI_API_KEY;
      if (apiKey) {
        this.semanticAnalyzer = new SemanticAnalyzer(apiKey);
        this.debug('Semantic analyzer initialized for content classification (fallback)');
      } else {
        this.debug('No API key found - semantic analysis disabled');
      }
    } catch (error) {
      console.error('Failed to initialize semantic analyzer:', error.message);
      this.semanticAnalyzer = null;
    }
    
    // Initialize real-time trajectory analyzer (if available)
    this.trajectoryAnalyzer = null;
    if (RealTimeTrajectoryAnalyzer) {
      try {
        this.trajectoryAnalyzer = new RealTimeTrajectoryAnalyzer({
          projectPath: this.config.projectPath,
          codingToolsPath: process.env.CODING_TOOLS_PATH || process.env.CODING_REPO,
          debug: this.debug_enabled
        });
        this.debug('Real-time trajectory analyzer initialized');
      } catch (error) {
        console.error('Failed to initialize trajectory analyzer:', error.message);
        this.trajectoryAnalyzer = null;
      }
    } else {
      this.debug('Trajectory analyzer not available (missing dependencies)');
    }

    // Initialize classification logger for tracking 4-layer classification decisions
    this.classificationLogger = null;
    try {
      const projectName = path.basename(this.config.projectPath);
      const userHash = UserHashGenerator.generateHash({ debug: false });
      const codingRepo = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';

      this.classificationLogger = new ClassificationLogger({
        projectPath: this.config.projectPath, // CRITICAL: Pass projectPath for correct log directory
        projectName: projectName,
        sessionId: `live-${Date.now()}`,
        userHash: userHash,
        codingRepo: codingRepo // CRITICAL: Pass coding repo for redirected logs
      });
      this.classificationLogger.initializeLogFile();
      this.debug('Classification logger initialized');
    } catch (error) {
      console.error('Failed to initialize classification logger:', error.message);
      this.classificationLogger = null;
    }

    // Track LSL line numbers for each exchange
    this.exchangeLineNumbers = new Map(); // Map exchange ID to {start, end} line numbers
  }
  /**
   * Get centralized health file path in coding project to avoid cluttering individual projects
   */
  getCentralizedHealthFile(projectPath) {
    // Get coding project path
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    
    // Create project-specific health file name based on project path
    const projectName = path.basename(projectPath);
    const healthFileName = `${projectName}-transcript-monitor-health.json`;
    
    // Store in coding project's .health directory
    return path.join(codingPath, '.health', healthFileName);
  }

  /**
   * Get state file path for persisting lastProcessedUuid
   */
  getStateFilePath() {
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    const projectName = path.basename(this.config.projectPath);
    const stateFileName = `${projectName}-transcript-monitor-state.json`;
    return path.join(codingPath, '.health', stateFileName);
  }

  /**
   * Load lastProcessedUuid from state file to prevent re-processing exchanges after restarts
   */
  loadLastProcessedUuid() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
        this.debug(`Loaded lastProcessedUuid from state file: ${state.lastProcessedUuid}`);
        return state.lastProcessedUuid || null;
      }
    } catch (error) {
      this.debug(`Failed to load state file: ${error.message}`);
    }
    return null;
  }

  /**
   * Save lastProcessedUuid to state file for persistence across restarts
   */
  saveLastProcessedUuid() {
    try {
      const stateDir = path.dirname(this.stateFile);
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }
      const state = {
        lastProcessedUuid: this.lastProcessedUuid,
        lastUpdated: new Date().toISOString(),
        transcriptPath: this.transcriptPath
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      this.debug(`Failed to save state file: ${error.message}`);
    }
  }

  /**
   * Get session duration from config file in milliseconds
   */
  getSessionDurationMs() {
    try {
      const codingRepo = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO;
      if (!codingRepo) {
        return 3600000; // Default: 1 hour
      }
      
      const configPath = path.join(codingRepo, 'config', 'live-logging-config.json');
      if (!fs.existsSync(configPath)) {
        return 3600000; // Default: 1 hour
      }
      
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.live_logging?.session_duration || 3600000; // Default: 1 hour
    } catch (error) {
      return 3600000; // Default: 1 hour
    }
  }

  /**
   * Initialize reliable coding classifier
   */
  /**
   * Initialize knowledge extraction system (optional, non-blocking)
   */
  async initializeKnowledgeExtractor() {
    if (!StreamingKnowledgeExtractor) {
      this.debug('Knowledge extraction not available');
      return;
    }

    try {
      // Initialize database manager (without GraphDB to avoid lock conflicts with VKB)
      const databaseManager = new DatabaseManager({
        projectPath: this.config.projectPath,
        debug: this.debug_enabled,
        graphDb: { enabled: false }  // Disable GraphDB - VKB server owns the GraphDB lock
      });
      await databaseManager.initialize();

      // Initialize embedding generator
      const embeddingGenerator = new EmbeddingGenerator({
        projectPath: this.config.projectPath,
        databaseManager: databaseManager,
        debug: this.debug_enabled
      });

      // Initialize inference engine
      const inferenceEngine = new UnifiedInferenceEngine({
        projectPath: this.config.projectPath,
        debug: this.debug_enabled
      });

      // Create knowledge extractor with all dependencies
      this.knowledgeExtractor = new StreamingKnowledgeExtractor({
        projectPath: this.config.projectPath,
        databaseManager: databaseManager,
        embeddingGenerator: embeddingGenerator,
        inferenceEngine: inferenceEngine,
        trajectoryAnalyzer: this.trajectoryAnalyzer, // Pass existing trajectory analyzer if available
        enableBudgetTracking: true,
        enableSensitivityDetection: true,
        debug: this.debug_enabled
      });

      await this.knowledgeExtractor.initialize();
      this.knowledgeExtractionStatus.state = 'ready';
      this.debug('✅ Knowledge extraction initialized');
    } catch (error) {
      this.debug(`❌ Failed to initialize knowledge extractor: ${error.message}`);
      this.knowledgeExtractionStatus.state = 'error';
      throw error;
    }
  }

  /**
   * Extract knowledge from exchanges asynchronously (non-blocking)
   * This runs in the background and doesn't block LSL processing
   */
  async extractKnowledgeAsync(exchanges) {
    if (!this.knowledgeExtractor || this.knowledgeExtractionStatus.state !== 'ready') {
      return;
    }

    try {
      this.knowledgeExtractionStatus.state = 'processing';
      const startTime = Date.now();

      // Convert exchanges to format expected by knowledge extractor
      const transcript = exchanges.map(ex => ({
        role: ex.isUserPrompt ? 'user' : 'assistant',
        content: ex.isUserPrompt ? ex.userMessage : ex.assistantMessage,
        timestamp: ex.timestamp
      }));

      // Extract knowledge (async, non-blocking)
      const extractedKnowledge = await this.knowledgeExtractor.extractFromTranscript(transcript);

      const duration = Date.now() - startTime;
      this.knowledgeExtractionStatus.state = 'ready';
      this.knowledgeExtractionStatus.lastExtraction = new Date().toISOString();

      this.debug(`📚 Knowledge extracted: ${extractedKnowledge.length} items in ${duration}ms`);
    } catch (error) {
      this.knowledgeExtractionStatus.state = 'error';
      throw error;
    }
  }

  /**
   * Get current knowledge extraction status (for status line)
   */
  getKnowledgeExtractionStatus() {
    return {
      enabled: this.knowledgeExtractionEnabled,
      state: this.knowledgeExtractionStatus.state,
      lastExtraction: this.knowledgeExtractionStatus.lastExtraction,
      errorCount: this.knowledgeExtractionStatus.errorCount
    };
  }

  async initializeReliableCodingClassifier() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
      
      this.reliableCodingClassifier = new ReliableCodingClassifier({
        projectPath: this.config.projectPath,
        codingRepo: codingPath,
        apiKey: process.env.XAI_API_KEY || process.env.OPENAI_API_KEY,
        skipSemanticAnalysis: this.options?.skipSemanticAnalysis || false,
        debug: this.debug
      });
      
      await this.reliableCodingClassifier.initialize();
      
      this.reliableCodingClassifierReady = true;
      this.debug(`Reliable coding classifier initialized with three-layer architecture`);
    } catch (error) {
      console.error('Failed to initialize reliable coding classifier:', error.message);
      this.reliableCodingClassifier = null;
      this.reliableCodingClassifierReady = false;
    }
  }

  /**
   * Get all transcript files for historical reprocessing
   */
  getAllTranscriptFiles() {
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = this.getProjectDirName();
    const projectDir = path.join(baseDir, projectName);
    
    if (!fs.existsSync(projectDir)) {
      this.debug(`Project directory not found: ${projectDir}`);
      return [];
    }

    this.debug(`Looking for all transcripts in: ${projectDir}`);

    try {
      const files = fs.readdirSync(projectDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filePath = path.join(projectDir, file);
          const stats = fs.statSync(filePath);
          return { path: filePath, mtime: stats.mtime, size: stats.size };
        })
        .sort((a, b) => a.mtime - b.mtime); // Sort oldest first for chronological processing

      this.debug(`Found ${files.length} transcript files for processing`);
      return files.map(f => f.path);
    } catch (error) {
      this.debug(`Error reading transcript directory: ${error.message}`);
      return [];
    }
  }

  /**
   * Find current session's transcript file
   */
  findCurrentTranscript() {
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = this.getProjectDirName();
    const projectDir = path.join(baseDir, projectName);
    
    if (!fs.existsSync(projectDir)) {
      this.debug(`Project directory not found: ${projectDir}`);
      return null;
    }

    this.debug(`Looking for transcripts in: ${projectDir}`);

    try {
      const files = fs.readdirSync(projectDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filePath = path.join(projectDir, file);
          const stats = fs.statSync(filePath);
          return { path: filePath, mtime: stats.mtime, size: stats.size };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) return null;

      const mostRecent = files[0];
      const timeDiff = Date.now() - mostRecent.mtime.getTime();
      
      if (timeDiff < this.config.sessionDuration * 2) {
        this.debug(`Using transcript: ${mostRecent.path}`);
        return mostRecent.path;
      }

      this.debug(`Transcript too old: ${timeDiff}ms > ${this.config.sessionDuration * 2}ms`);
      return null;
    } catch (error) {
      this.debug(`Error finding transcript: ${error.message}`);
      return null;
    }
  }

  /**
   * Find all transcript files for parallel processing
   */
  findAllTranscripts() {
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = this.getProjectDirName();
    const projectDir = path.join(baseDir, projectName);
    
    if (!fs.existsSync(projectDir)) {
      this.debug(`Project directory not found: ${projectDir}`);
      return [];
    }

    this.debug(`Looking for all transcripts in: ${projectDir}`);

    try {
      const files = fs.readdirSync(projectDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filePath = path.join(projectDir, file);
          const stats = fs.statSync(filePath);
          return { 
            path: filePath, 
            filename: file,
            mtime: stats.mtime, 
            size: stats.size,
            exchanges: 0 // Will be populated later
          };
        })
        .sort((a, b) => b.mtime - a.mtime); // Most recent first

      this.debug(`Found ${files.length} transcript files`);
      return files;
    } catch (error) {
      this.debug(`Error finding transcripts: ${error.message}`);
      return [];
    }
  }

  /**
   * Process a single transcript file and return summary statistics
   * Now supports both streaming and non-streaming modes
   */
  async processSingleTranscript(transcriptFile, useStreaming = false) {
    const startTime = Date.now();
    let processedExchanges = 0;
    
    try {
      this.debug(`Processing transcript: ${path.basename(transcriptFile.path)}`);
      
      // Use streaming for large files (>10MB)
      const shouldStream = useStreaming || transcriptFile.size > 10 * 1024 * 1024;
      
      if (shouldStream) {
        // Use memory-efficient streaming processing
        return await this.processSingleTranscriptStreaming(transcriptFile);
      }
      
      // Original non-streaming processing for smaller files
      const messages = this.readTranscriptMessages(transcriptFile.path);
      const exchanges = await this.extractExchanges(messages);
      
      transcriptFile.exchanges = exchanges.length;
      
      if (exchanges.length === 0) {
        return { 
          file: transcriptFile.filename, 
          exchanges: 0, 
          processed: 0, 
          duration: Date.now() - startTime,
          status: 'empty',
          mode: 'batch'
        };
      }
      
      // Process exchanges in batches to avoid memory issues
      const batchSize = 25; // Smaller batch for parallel processing
      
      for (let i = 0; i < exchanges.length; i += batchSize) {
        const batch = exchanges.slice(i, i + batchSize);
        await this.processExchanges(batch);
        processedExchanges += batch.length;
      }
      
      return { 
        file: transcriptFile.filename, 
        exchanges: exchanges.length, 
        processed: processedExchanges, 
        duration: Date.now() - startTime,
        status: 'success',
        mode: 'batch'
      };
      
    } catch (error) {
      console.error(`❌ Error processing ${transcriptFile.filename}: ${error.message}`);
      return { 
        file: transcriptFile.filename, 
        exchanges: transcriptFile.exchanges || 0, 
        processed: processedExchanges, 
        duration: Date.now() - startTime,
        status: 'error',
        error: error.message,
        mode: 'batch'
      };
    }
  }

  /**
   * Process a single transcript file using memory-efficient streaming
   */
  async processSingleTranscriptStreaming(transcriptFile) {
    const startTime = Date.now();
    let totalExchanges = 0;
    let processedExchanges = 0;
    
    try {
      console.log(`🌊 Using streaming mode for large file: ${transcriptFile.filename} (${(transcriptFile.size / 1024 / 1024).toFixed(1)}MB)`);
      
      const reader = new StreamingTranscriptReader({
        batchSize: 20,  // Process 20 messages at a time
        maxMemoryMB: 50,  // Limit memory usage to 50MB
        progressInterval: 100,  // Report progress every 100 lines
        debug: this.config.debug
      });
      
      // Set up event handlers
      reader.on('progress', (stats) => {
        if (this.config.debug) {
          console.log(`   📊 Progress: ${stats.progress}% | Lines: ${stats.linesRead} | Memory: ${stats.memoryMB}MB`);
        }
      });
      
      reader.on('batch', (stats) => {
        totalExchanges = stats.totalProcessed;
      });
      
      reader.on('error', (error) => {
        console.warn(`   ⚠️ Stream error: ${error.error}`);
      });
      
      // CRITICAL FIX: Accumulate all exchanges from streaming instead of processing them immediately
      const allExchanges = [];
      
      // Process the file with streaming - accumulate exchanges only
      const stats = await reader.processFile(transcriptFile.path, async (messageBatch) => {
        // Extract exchanges from this batch
        const exchanges = StreamingTranscriptReader.extractExchangesFromBatch(messageBatch, { useAdaptiveExtraction: true });
        
        if (exchanges.length > 0) {
          // DEBUG: Check for Sept 14 exchanges during accumulation
          for (const exchange of exchanges) {
            if (exchange.timestamp && exchange.timestamp.includes('2025-09-14T07:')) {
              console.log(`🎯 DEBUG ACCUMULATION: Found Sept 14 07:xx exchange during streaming!`);
              console.log(`   Timestamp: ${exchange.timestamp}`);
              console.log(`   IsUserPrompt: ${exchange.isUserPrompt}`);
              console.log(`   Content preview: ${exchange.userMessage ? exchange.userMessage.substring(0, 100) : 'No userMessage'}`);
            }
          }
          
          // FIXED: Just accumulate exchanges, don't process them yet
          allExchanges.push(...exchanges);
          processedExchanges += exchanges.length;
        }
      });
      
      // DEBUG: Check what Sept 14 exchanges we accumulated
      const sept14Exchanges = allExchanges.filter(ex => ex.timestamp && ex.timestamp.includes('2025-09-14T07:'));
      if (sept14Exchanges.length > 0) {
        console.log(`🎯 DEBUG: Accumulated ${sept14Exchanges.length} Sept 14 07:xx exchanges:`);
        for (const ex of sept14Exchanges) {
          console.log(`   ${ex.timestamp}: isUserPrompt=${ex.isUserPrompt}, hasContent=${!!ex.userMessage}`);
        }
      }
      
      // CRITICAL FIX: Process all accumulated exchanges using proper historical processing
      if (allExchanges.length > 0) {
        console.log(`🚨 DEBUG: CRITICAL FIX TRIGGERED - Processing ${allExchanges.length} accumulated exchanges from streaming in time order`);
        console.log(`🔄 Processing ${allExchanges.length} accumulated exchanges from streaming in time order`);
        
        // Sort exchanges by timestamp for proper chronological processing
        allExchanges.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        // Process exchanges in batches using the non-streaming logic (designed for historical processing)
        const batchSize = 50;
        for (let i = 0; i < allExchanges.length; i += batchSize) {
          const batch = allExchanges.slice(i, i + batchSize);
          
          // Process each exchange individually to respect session boundaries and build prompt sets
          for (const exchange of batch) {
            const currentTranche = this.getCurrentTimetranche(exchange.timestamp);

            if (exchange.isUserPrompt) {
              // New user prompt detected

              // Check for session boundaries and complete prompt sets as needed
              if (this.isNewSessionBoundary(currentTranche, this.lastTranche)) {
                // Complete previous user prompt set if exists
                if (this.currentUserPromptSet.length > 0) {
                  const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
                  if (targetProject !== null) {
                    // FIX: Use tranche from the FIRST exchange in the set being written
                    const setTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
                    const wasWritten = await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, setTranche);
                    if (wasWritten) {
                      this.currentUserPromptSet = [];
                    }
                  } else {
                    this.currentUserPromptSet = [];
                  }
                }
                this.lastTranche = currentTranche;
              } else {
                // Same session - complete current user prompt set before starting new one
                if (this.currentUserPromptSet.length > 0) {
                  const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
                  if (targetProject !== null) {
                    // FIX: Use tranche from the FIRST exchange in the set being written
                    const setTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
                    const wasWritten = await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, setTranche);
                    if (wasWritten) {
                      this.currentUserPromptSet = [];
                    }
                  } else {
                    this.currentUserPromptSet = [];
                  }
                }
              }

              // Start new user prompt set
              this.currentUserPromptSet = [exchange];
            } else {
              // Add non-user-prompt exchange to current user prompt set
              if (this.currentUserPromptSet.length > 0) {
                this.currentUserPromptSet.push(exchange);
              }
            }
          }
        }
        
        // Complete any remaining user prompt set
        if (this.currentUserPromptSet.length > 0) {
          console.log(`🔄 Completing final user prompt set with ${this.currentUserPromptSet.length} exchanges after streaming`);
          const currentTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
          const targetProject = await this.determineTargetProject(this.currentUserPromptSet);
          console.log(`🎯 Final target project for streaming: ${targetProject}`);
          if (targetProject !== null) {
            const wasWritten = await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, currentTranche);
            if (wasWritten) {
              this.currentUserPromptSet = [];
            }
          } else {
            this.currentUserPromptSet = [];
          }
        }
      }
      
      return {
        file: transcriptFile.filename,
        exchanges: totalExchanges,
        processed: processedExchanges,
        duration: Date.now() - startTime,
        status: 'success',
        mode: 'streaming',
        stats: {
          linesRead: stats.linesRead,
          batches: stats.batches,
          errors: stats.errors,
          throughput: stats.throughput
        }
      };
      
    } catch (error) {
      console.error(`❌ Stream error processing ${transcriptFile.filename}: ${error.message}`);
      return {
        file: transcriptFile.filename,
        exchanges: totalExchanges,
        processed: processedExchanges,
        duration: Date.now() - startTime,
        status: 'error',
        error: error.message,
        mode: 'streaming'
      };
    }
  }

  /**
   * Process multiple transcript files in parallel with concurrency control
   */
  async processTranscriptsInParallel(transcriptFiles, maxConcurrency = 3) {
    if (!transcriptFiles || transcriptFiles.length === 0) {
      console.log('📄 No transcript files to process');
      return [];
    }

    console.log(`🚀 Starting parallel processing of ${transcriptFiles.length} transcript files (max concurrency: ${maxConcurrency})`);
    const startTime = Date.now();
    
    // Process files with controlled concurrency
    const results = [];
    const activePromises = [];
    
    for (const transcriptFile of transcriptFiles) {
      // Wait if we've reached max concurrency
      if (activePromises.length >= maxConcurrency) {
        const completedResult = await Promise.race(activePromises);
        results.push(completedResult.result);
        
        // Remove completed promise from active list
        const completedIndex = activePromises.findIndex(p => p.result === completedResult.result);
        if (completedIndex !== -1) {
          activePromises.splice(completedIndex, 1);
        }
        
        console.log(`✅ Completed ${completedResult.result.file} (${results.length}/${transcriptFiles.length})`);
      }
      
      // Start processing this file
      const promise = this.processSingleTranscript(transcriptFile).then(result => ({ result }));
      activePromises.push(promise);
    }
    
    // Wait for all remaining promises to complete
    const remainingResults = await Promise.all(activePromises);
    results.push(...remainingResults.map(r => r.result));
    
    const totalDuration = Date.now() - startTime;
    const totalExchanges = results.reduce((sum, r) => sum + r.exchanges, 0);
    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const streamingCount = results.filter(r => r.mode === 'streaming').length;
    const batchCount = results.filter(r => r.mode === 'batch').length;
    
    console.log(`\n🏁 Parallel processing completed:`);
    console.log(`   📊 Total files: ${transcriptFiles.length}`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   🌊 Streaming mode: ${streamingCount} files`);
    console.log(`   📦 Batch mode: ${batchCount} files`);
    console.log(`   📝 Total exchanges: ${totalExchanges}`);
    console.log(`   ⚡ Processed exchanges: ${totalProcessed}`);
    console.log(`   ⏱️  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`   🚄 Average per file: ${(totalDuration / transcriptFiles.length / 1000).toFixed(1)}s`);
    
    if (errorCount > 0) {
      console.log(`\n❌ Files with errors:`);
      results.filter(r => r.status === 'error').forEach(r => {
        console.log(`   • ${r.file}: ${r.error}`);
      });
    }
    
    return results;
  }

  // Timezone utilities are now imported from timezone-utils.js

  /**
   * Use robust project path detection like status line - check both coding repo and current directory
   */
  getProjectPath() {
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const rootDir = process.env.CODING_REPO || path.join(__dirname, '..');
    
    // Check target project first (like status line does), then coding repo, then current directory
    const checkPaths = [
      process.env.TRANSCRIPT_SOURCE_PROJECT, // Source project to monitor transcripts from (e.g., nano-degree)
      rootDir,                           // Coding repo 
      process.cwd()                      // Current working directory
    ].filter(Boolean); // Remove null/undefined values
    
    if (this.debug_enabled) console.error(`Checking project paths: ${JSON.stringify(checkPaths)}`);
    
    // Look for .specstory directory to confirm it's a valid project
    for (const checkPath of checkPaths) {
      const specstoryDir = path.join(checkPath, '.specstory');
      if (fs.existsSync(specstoryDir)) {
        if (this.debug_enabled) console.error(`Found project with .specstory at: ${checkPath}`);
        return checkPath;
      }
    }
    
    // Fallback: prefer current directory since that's where user is working  
    if (this.debug_enabled) console.error(`No .specstory found, using fallback: ${process.cwd()}`);
    return process.cwd();
  }

  /**
   * Convert project path to Claude's directory naming
   */
  getProjectDirName() {
    const normalized = this.config.projectPath.replace(/\//g, '-');
    return normalized.startsWith('-') ? normalized : '-' + normalized;
  }

  /**
   * Read and parse transcript messages
   */
  readTranscriptMessages(transcriptPath) {
    if (!fs.existsSync(transcriptPath)) return [];

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const messages = [];

      for (const line of lines) {
        try {
          messages.push(JSON.parse(line));
        } catch (error) {
          continue;
        }
      }
      return messages;
    } catch (error) {
      this.debug(`Error reading transcript: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract conversation exchanges with user prompt detection
   */
  async extractExchanges(messages) {
    const exchanges = [];
    let currentExchange = null;
    let userMessageCount = 0;
    let filteredUserMessageCount = 0;

    for (const message of messages) {
      // Skip tool result messages - they are NOT user prompts
      if (message.type === 'user' && message.message?.role === 'user' && 
          !this.isToolResultMessage(message)) {
        // New user prompt - complete previous exchange and start new one
        if (currentExchange) {
          currentExchange.isUserPrompt = true;
          exchanges.push(currentExchange);
        }
        
        currentExchange = {
          id: message.uuid,
          timestamp: message.timestamp || Date.now(),
          userMessage: await this.extractUserMessage(message) || '',
          claudeResponse: '',
          toolCalls: [],
          toolResults: [],
          isUserPrompt: true,
          isComplete: false,  // NEW: Track completion status
          stopReason: null    // NEW: Track stop reason
        };
      } else if (message.type === 'assistant' && currentExchange) {
        if (message.message?.content) {
          if (Array.isArray(message.message.content)) {
            for (const item of message.message.content) {
              if (item.type === 'text') {
                currentExchange.claudeResponse += item.text + '\n';
              } else if (item.type === 'tool_use') {
                currentExchange.toolCalls.push({
                  name: item.name,
                  input: item.input,
                  id: item.id
                });
              }
            }
          } else if (typeof message.message.content === 'string') {
            currentExchange.claudeResponse = message.message.content;
          }
        }

        // NEW: Mark exchange as complete when stop_reason is present
        if (message.message?.stop_reason !== null && message.message?.stop_reason !== undefined) {
          currentExchange.isComplete = true;
          currentExchange.stopReason = message.message.stop_reason;
        }
      } else if (message.type === 'user' && message.message?.content && Array.isArray(message.message.content)) {
        for (const item of message.message.content) {
          if (item.type === 'tool_result' && currentExchange) {
            currentExchange.toolResults.push({
              tool_use_id: item.tool_use_id,
              content: item.content,
              is_error: item.is_error || false
            });
          }
        }
      }
    }

    if (currentExchange) {
      exchanges.push(currentExchange);
    }

    console.log(`📊 EXTRACTION SUMMARY: ${userMessageCount} total user messages, ${filteredUserMessageCount} actual user prompts, ${exchanges.length} exchanges created`);
    return exchanges;
  }

  /**
   * Extract text content from message content
   */
  extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(item => item.type === 'text' || item.type === 'tool_result')
        .map(item => {
          if (item.type === 'text') return item.text;
          if (item.type === 'tool_result') return item.content;
          return '';
        })
        .join('\n');
    }
    return '';
  }

  /**
   * Check if a message is a tool result (not an actual user message)
   */
  isToolResultMessage(message) {
    if (!message.message?.content || !Array.isArray(message.message.content)) {
      return false;
    }
    
    // Tool result messages have content array with tool_result items
    return message.message.content.some(item => 
      item.type === 'tool_result' && item.tool_use_id
    );
  }

  /**
   * Analyze exchange content for categorization (stub implementation)
   */
  analyzeExchangeContent(exchange) {
    return {
      categories: [],
      confidence: 0.5,
      reasoning: 'Basic analysis'
    };
  }


  async extractUserMessage(entry) {
    // Handle different user message structures - using proven logic from LSL script
    if (entry.message?.content) {
      if (typeof entry.message.content === 'string') {
        return await redactSecrets(entry.message.content);
      }
      return await redactSecrets(this.extractTextContent(entry.message.content));
    }
    // Handle legacy humanMessage format (Sept 13-14 transcripts)
    if (entry.humanMessage) {
      return await redactSecrets(this.extractTextContent(entry.humanMessage));
    }
    // Handle direct userMessage field (modern format)
    if (entry.userMessage) {
      return await redactSecrets(this.extractTextContent(entry.userMessage));
    }
    if (entry.content) {
      return await redactSecrets(this.extractTextContent(entry.content));
    }
    return '';
  }

  /**
   * Get unprocessed exchanges
   *
   * NEW BEHAVIOR: Only returns COMPLETE exchanges (with stop_reason).
   * Incomplete exchanges are held back and re-checked on next monitoring cycle.
   * This prevents incomplete exchanges from being written to LSL files and
   * automatically recovers them when they become complete.
   *
   * @returns {Array} Complete, unprocessed exchanges ready to be written
   */
  async getUnprocessedExchanges() {
    if (!this.transcriptPath) return [];

    const messages = this.readTranscriptMessages(this.transcriptPath);
    if (messages.length === 0) return [];

    const exchanges = await this.extractExchanges(messages);

    // Filter to unprocessed exchanges
    let unprocessed;
    if (!this.lastProcessedUuid) {
      unprocessed = exchanges.slice(-10);
    } else {
      const lastIndex = exchanges.findIndex(ex => ex.id === this.lastProcessedUuid);
      if (lastIndex >= 0) {
        unprocessed = exchanges.slice(lastIndex + 1);
      } else {
        unprocessed = exchanges.slice(-10);
      }
    }

    // Return all unprocessed exchanges - filtering moved to processUserPromptSetCompletion
    return unprocessed;
  }

  /**
   * Determine target project using user's simplified logic:
   * (1) Read correct transcript file (always from current project via statusLine)
   * (2a) If running in coding -> write to coding LSL
   * (2b) If running outside coding -> check redirect status
   */
  async determineTargetProject(exchangeOrPromptSet) {
    const codingPath = process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding';
    
    // Handle both single exchange and prompt set array  
    const exchanges = Array.isArray(exchangeOrPromptSet) ? exchangeOrPromptSet : [exchangeOrPromptSet];
    const firstExchange = exchanges[0];
    
    // DEBUG: Check for ALL Sept 14 07:xx timeframe (not just 07:12)
    const isSept14Debug = firstExchange.timestamp && firstExchange.timestamp.includes('2025-09-14T07:');
    if (isSept14Debug) {
      console.log(`🎯 DEBUG Sept 14 (${firstExchange.timestamp}): Classifying prompt set with ${exchanges.length} exchanges`);
      console.log(`   First exchange timestamp: ${firstExchange.timestamp}`);
      console.log(`   Mode: ${this.config.mode}`);
      console.log(`   Project path: ${this.config.projectPath}`);
      
      // Log ALL exchanges in the prompt set
      for (let i = 0; i < exchanges.length; i++) {
        console.log(`   Exchange ${i+1}: ${exchanges[i].timestamp}`);
        if (exchanges[i].userMessage) {
          console.log(`      Content: ${exchanges[i].userMessage.substring(0, 100)}...`);
        }
      }
    }
    
    // Handle foreign mode: Only process coding-related exchanges and route them to coding project
    if (this.config.mode === 'foreign') {
      // Check ALL exchanges in the prompt set for coding content
      for (let i = 0; i < exchanges.length; i++) {
        const exchange = exchanges[i];
        const isCoding = await this.isCodingRelated(exchange);
        if (isSept14Debug) {
          console.log(`   🔍 Exchange ${i+1} (${exchange.timestamp}): isCoding=${isCoding}`);
        }
        if (isCoding) {
          if (isSept14Debug) {
            console.log(`   ✅ ROUTING TO CODING PROJECT due to coding content found in exchange ${i+1}`);
          }
          return codingPath; // Route to coding project if ANY exchange is coding-related
        }
      }
      if (isSept14Debug) {
        console.log(`   ❌ SKIPPING - no coding content found in foreign mode`);
      }
      return null; // Skip if no coding exchanges found in foreign mode
    }
    
    // Regular 'all' mode logic:
    
    // Check if we're running from coding directory
    if (this.config.projectPath.includes('/coding')) {
      if (isSept14Debug) {
        console.log(`   ✅ ROUTING TO CODING PROJECT - running from coding directory`);
      }
      return codingPath;
    }
    
    // Running from outside coding - check redirect status
    // Check ALL exchanges for coding content (not just first one)
    for (const exchange of exchanges) {
      if (await this.isCodingRelated(exchange)) {
        if (isSept14Debug) {
          console.log(`   ✅ ROUTING TO CODING PROJECT - coding content detected in exchange`);
        }
        return codingPath; // Redirect to coding
      }
    }
    
    if (isSept14Debug) {
      console.log(`   ✅ STAYING IN LOCAL PROJECT - no coding content detected`);
    }
    return this.config.projectPath; // Stay in local project
  }

  /**
   * Create or append to session file with exclusive routing
   * DEPRECATED: Files should only be created when there's content to write
   */
  async createOrAppendToSessionFile(targetProject, tranche, exchange) {
    // DISABLED: Empty file creation removed
    // Files are now only created in processUserPromptSetCompletion when there's actual content
    this.debug('⚠️ createOrAppendToSessionFile called but disabled - files only created with content');
  }

  /**
   * Check if content involves coding project using semantic analysis
   */
  async isCodingRelated(exchange) {
    if (!exchange || (!exchange.userMessage && !exchange.humanMessage && !exchange.message)) {
      return false;
    }
    
    // DEBUG: Check for Sept 14 exchanges
    const isSept14 = exchange.timestamp && exchange.timestamp.includes('2025-09-14T07:');
    if (isSept14) {
      console.log(`🎯 DEBUG Sept 14 isCodingRelated check:`);
      console.log(`   Timestamp: ${exchange.timestamp}`);
      console.log(`   UserMessage exists: ${!!exchange.userMessage}`);
      console.log(`   UserMessage preview: ${exchange.userMessage ? exchange.userMessage.substring(0, 200) : 'null'}`);
    }
    
    // CRITICAL FIX: Wait for classifier initialization instead of returning false immediately
    if (!this.reliableCodingClassifier) {
      // Wait up to 10 seconds for classifier to initialize
      const maxWaitTime = 10000; // 10 seconds
      const checkInterval = 100; // Check every 100ms
      const startTime = Date.now();
      
      while (!this.reliableCodingClassifierReady && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      if (!this.reliableCodingClassifier) {
        console.warn('⚠️ ReliableCodingClassifier not available after waiting, defaulting to false');
        return false;
      }
    }
    
    try {
      // Use the correct method - 'classify' not 'classifyExchange'
      const result = await this.reliableCodingClassifier.classify(exchange);

      if (isSept14) {
        console.log(`   🔍 Classification result: ${result.isCoding}`);
        console.log(`   Score: ${result.score}`);
        console.log(`   Reason: ${result.reason}`);
        console.log(`   Components: ${JSON.stringify(result.components)}`);
      }

      // Log classification decision with full 4-layer trace
      if (this.classificationLogger && result.decisionPath) {
        // Transform decisionPath to expected format
        const layerDecisions = result.decisionPath.map(layer => ({
          layer: layer.layer,
          decision: layer.output.isCoding ? 'coding' : (layer.output.isCoding === false ? 'local' : 'inconclusive'),
          confidence: layer.output.confidence || 0,
          reasoning: layer.output.reason || layer.output.reasoning || 'No reason provided',
          processingTimeMs: layer.duration || 0
        }));

        const decision = {
          promptSetId: exchange.uuid || `ps_${exchange.timestamp || new Date().toISOString()}`,
          timeRange: {
            start: exchange.timestamp || new Date().toISOString(),
            end: new Date().toISOString()
          },
          lslFile: 'pending', // Will be updated when written to LSL
          lslLineRange: {
            start: 0,
            end: 0
          },
          classification: {
            isCoding: result.isCoding,
            confidence: result.confidence,
            finalLayer: result.layer
          },
          layerDecisions: layerDecisions,
          sourceProject: path.basename(this.config.projectPath),
          targetFile: result.isCoding ? 'foreign' : 'local'
        };

        this.classificationLogger.logDecision(decision);

        // Note: MD summaries generated periodically (every 30 mins) and on shutdown
        // to avoid constant timestamp updates in git-tracked status files
      }

      return result.isCoding;
    } catch (error) {
      console.error(`Error in isCodingRelated: ${error.message}`);
      return false;
    }
  }
  


  /**
   * Get time tranche for given timestamp using full-hour boundaries (XX:00 - (XX+1):00)
   */
  getCurrentTimetranche(timestamp = null) {
    const targetTime = timestamp ? new Date(timestamp) : new Date();
    
    // Convert UTC timestamp to local time using timezone utils
    const localDate = utcToLocalTime(targetTime);
    
    // Use timezone-utils for consistent time window calculation
    const timeWindow = getTimeWindow(localDate);
    
    // CRITICAL FIX: Use local date components instead of .toISOString() which converts back to UTC
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    
    return {
      timeString: timeWindow,
      date: `${year}-${month}-${day}`,
      // CRITICAL FIX: Preserve original timestamp to avoid timezone reconstruction bugs
      originalTimestamp: timestamp || targetTime.getTime()
    };
  }

  /**
   * Get session file path with multi-project naming
   */
  getSessionFilePath(targetProject, tranche) {
    const currentProjectName = path.basename(this.config.projectPath);
    
    // CRITICAL FIX: Use the original exchange timestamp directly, not reconstructed from tranche
    // The tranche object should preserve the original exchange timestamp
    const timestamp = tranche.originalTimestamp || 
      new Date(`${tranche.date}T${tranche.timeString.split('-')[0].slice(0,2)}:${tranche.timeString.split('-')[0].slice(2)}:00.000Z`).getTime();
    
    if (targetProject === this.config.projectPath) {
      // Local project - use generateLSLFilename with same target/source
      const filename = generateLSLFilename(timestamp, currentProjectName, targetProject, targetProject);
      return path.join(targetProject, '.specstory', 'history', filename);
    } else {
      // Redirected to coding project - use generateLSLFilename with different target/source
      const filename = generateLSLFilename(timestamp, currentProjectName, targetProject, this.config.projectPath);
      return path.join(targetProject, '.specstory', 'history', filename);
    }
  }

  /**
   * Update comprehensive trajectory file
   */
  async updateComprehensiveTrajectory(targetProject) {
    try {
      const { spawn } = await import('child_process');
      
      // Use the CODING_TOOLS_PATH environment variable set by bin/coding
      const codingToolsPath = process.env.CODING_TOOLS_PATH;
      if (!codingToolsPath) {
        throw new Error('CODING_TOOLS_PATH environment variable not set. Run from coding/bin/coding');
      }
      
      const updateScript = path.join(codingToolsPath, 'scripts', 'repository-trajectory-generator.js');
      
      const child = spawn('node', [updateScript], {
        cwd: targetProject,
        stdio: 'pipe',
        env: { ...process.env, TRANSCRIPT_SOURCE_PROJECT: targetProject }
      });
      
      child.stdout.on('data', (data) => {
        this.debug(`Trajectory: ${data.toString().trim()}`);
      });
      
      child.stderr.on('data', (data) => {
        this.debug(`Trajectory Error: ${data.toString().trim()}`);
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          this.debug(`✅ Updated comprehensive trajectory for ${path.basename(targetProject)}`);
        } else {
          this.debug(`⚠️ Trajectory update failed with code ${code}`);
        }
      });
    } catch (error) {
      this.debug(`Error updating comprehensive trajectory: ${error.message}`);
    }
  }

  /**
   * Check if new session boundary crossed
   */
  isNewSessionBoundary(currentTranche, lastTranche) {
    return !lastTranche || 
           currentTranche.timeString !== lastTranche.timeString ||
           currentTranche.date !== lastTranche.date;
  }

  /**
   * Create session file with initial content (no longer creates empty files)
   */
  async createSessionFileWithContent(targetProject, tranche, initialContent) {
    const sessionFile = this.getSessionFilePath(targetProject, tranche);
    
    try {
      // Ensure directory exists
      const sessionDir = path.dirname(sessionFile);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
        console.log(`📁 Created directory: ${sessionDir}`);
      }

      // Create session file with actual content (not empty)
      if (!fs.existsSync(sessionFile)) {
      const currentProjectName = path.basename(this.config.projectPath);
      const isRedirected = targetProject !== this.config.projectPath;
      
      const sessionHeader = `# WORK SESSION (${tranche.timeString})${isRedirected ? ` - From ${currentProjectName}` : ''}\n\n` +
        `**Generated:** ${new Date().toISOString()}\n` +
        `**Work Period:** ${tranche.timeString}\n` +
        `**Focus:** ${isRedirected ? `Coding activities from ${currentProjectName}` : 'Live session logging'}\n` +
        `**Duration:** ~60 minutes\n` +
        `${isRedirected ? `**Source Project:** ${this.config.projectPath}\n` : ''}` +
        `\n---\n\n## Session Overview\n\n` +
        `This session captures ${isRedirected ? 'coding-related activities redirected from ' + currentProjectName : 'real-time tool interactions and exchanges'}.\n\n` +
        `---\n\n## Key Activities\n\n`;
      
        // Write header + initial content in one operation
        fs.writeFileSync(sessionFile, sessionHeader + initialContent);
        
        // CRITICAL FIX: Verify file was actually created
        if (fs.existsSync(sessionFile)) {
          console.log(`📝 Created ${isRedirected ? 'redirected' : 'new'} session with content: ${path.basename(sessionFile)}`);
          
          // Add to file manager for size monitoring and rotation
          this.fileManager.watchFile(sessionFile, {
            projectPath: targetProject,
            tranche: tranche,
            isRedirected: isRedirected,
            startTime: new Date()
          });
          
        } else {
          throw new Error(`Failed to create session file: ${sessionFile}`);
        }
      }

      return sessionFile;
      
    } catch (error) {
      console.error(`🚨 SESSION FILE CREATION FAILED: ${sessionFile}`);
      console.error(`Error: ${error.message}`);
      
      // Health monitor should detect this
      this.logHealthError(`Session file creation failed: ${sessionFile} - ${error.message}`);
      throw error;
    }
  }


  /**
   * Check if content is meaningful (not empty, not placeholder, not empty JSON)
   */
  hasMeaningfulContent(content) {
    if (!content) return false;

    // Handle string content
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (!trimmed) return false;
      if (trimmed === '(No user message)' || trimmed === '(No response)') return false;
      if (trimmed === '{}' || trimmed === '[]' || trimmed === '""' || trimmed === "''") return false; // Empty JSON objects/arrays/strings
      return true;
    }

    // Handle object content
    if (typeof content === 'object') {
      // Check if it's an empty object or array
      if (Array.isArray(content)) return content.length > 0;
      if (Object.keys(content).length === 0) return false;

      // Convert to string and check - avoid JSON.stringify issues
      const stringified = JSON.stringify(content);
      return stringified !== '{}' && stringified !== '[]' && stringified !== '""' && stringified.trim() !== '';
    }

    return false;
  }

  /**
   * Check if a message is an /sl command that should be filtered out
   * /sl commands are context restoration commands that don't add value to LSL files
   * @param {string} content - The message content to check
   * @returns {boolean} True if this is an /sl command to filter out
   */
  isSlCommand(content) {
    if (!content || typeof content !== 'string') return false;

    const trimmedContent = content.trim();

    // Check for simple /sl commands (with optional number and whitespace)
    const slPattern = /^\/sl\s*(\d+)?\s*$/i;
    if (slPattern.test(trimmedContent)) return true;

    // Check for XML-like format: <command-name>/sl</command-name>
    if (trimmedContent.includes('<command-name>/sl</command-name>')) return true;

    // Check for command-message format: <command-message>sl is running
    if (trimmedContent.includes('<command-message>sl is running')) return true;

    return false;
  }

  /**
   * Process user prompt set completion
   * @returns {boolean} true if set was written, false if held back due to incomplete exchanges
   */
  async processUserPromptSetCompletion(completedSet, targetProject, tranche) {
    if (completedSet.length === 0) return false;

    // NEW: Check if all exchanges are complete before writing
    const incompleteExchanges = completedSet.filter(ex => {
      const hasResponse = ex.claudeResponse?.trim() || ex.assistantResponse?.trim() ||
                         (ex.toolCalls && ex.toolCalls.length > 0);
      return hasResponse && !ex.isComplete;  // Has response but not complete
    });

    if (incompleteExchanges.length > 0) {
      console.log(`⏳ Holding back prompt set - ${incompleteExchanges.length} exchange(s) still incomplete`);
      incompleteExchanges.forEach(ex => {
        const age = Date.now() - new Date(ex.timestamp).getTime();
        console.log(`   - ${ex.id.substring(0, 8)}: waiting ${Math.floor(age/1000)}s`);
      });
      return false;  // Don't write yet, keep accumulating
    }

    // Filter out exchanges with no meaningful content
    const meaningfulExchanges = completedSet.filter(exchange => {
      // Skip slash commands (like /sl)
      if (exchange.userMessage && this.isSlCommand(exchange.userMessage)) {
        return false;
      }
      
      // Skip exchanges with no user message and no response (empty entries)
      const hasUserMessage = this.hasMeaningfulContent(exchange.userMessage);
      const hasAssistantResponse = this.hasMeaningfulContent(exchange.claudeResponse) || this.hasMeaningfulContent(exchange.assistantResponse);
      const hasToolCalls = exchange.toolCalls && exchange.toolCalls.length > 0;
      
      // Keep exchange if it has at least one of: meaningful user message, assistant response, or tool calls
      return hasUserMessage || hasAssistantResponse || hasToolCalls;
    });
    
    // Only skip if literally no exchanges (should be rare)
    if (meaningfulExchanges.length === 0) {
      this.debug(`Skipping empty user prompt set - no meaningful exchanges`);
      return false;
    }

    const sessionFile = this.getSessionFilePath(targetProject, tranche);
    
    // Create session file with the actual content (no empty files)
    let sessionContent = '';
    for (const exchange of meaningfulExchanges) {
      sessionContent += await this.formatExchangeForLogging(exchange, targetProject !== this.config.projectPath);
    }
    
    if (!fs.existsSync(sessionFile)) {
      // Create file with content immediately
      await this.createSessionFileWithContent(targetProject, tranche, sessionContent);
    } else {
      // Check if file needs rotation before appending
      const rotationCheck = await this.fileManager.checkFileRotation(sessionFile);
      
      if (rotationCheck.needsRotation) {
        this.debug(`File rotated: ${path.basename(sessionFile)} (${this.fileManager.formatBytes(rotationCheck.currentSize)})`);
        
        // After rotation, create new session file with current content
        await this.createSessionFileWithContent(targetProject, tranche, sessionContent);
      } else {
        // Append to existing file
        try {
          fs.appendFileSync(sessionFile, sessionContent);
          this.debug(`📝 Appended ${meaningfulExchanges.length} exchanges to ${path.basename(sessionFile)}`);
        } catch (error) {
          this.logHealthError(`Failed to append to session file: ${error.message}`);
        }
      }
    }

    // Update comprehensive trajectory instead of individual trajectory files
    // DISABLED: This was causing constant timestamp-only updates with minimal value
    // await this.updateComprehensiveTrajectory(targetProject);

    console.log(`📋 Completed user prompt set: ${meaningfulExchanges.length}/${completedSet.length} exchanges → ${path.basename(sessionFile)}`);
    return true;  // Successfully written
  }

  /**
   * Format exchange content for logging (returns formatted string instead of writing to file)
   */
  async formatExchangeForLogging(exchange, isRedirected) {
    const timestamp = formatTimestamp(exchange.timestamp);
    const exchangeTime = timestamp.lslFormat;
    
    if (exchange.toolCalls && exchange.toolCalls.length > 0) {
      // Format tool calls
      let content = '';
      for (const toolCall of exchange.toolCalls) {
        const result = exchange.toolResults.find(r => r.tool_use_id === toolCall.id);
        content += await this.formatToolCallContent(exchange, toolCall, result, exchangeTime, isRedirected);
      }
      return content;
    } else {
      // Format text-only exchange
      return this.formatTextOnlyContent(exchange, exchangeTime, isRedirected);
    }
  }

  /**
   * Format tool call content
   */
  async formatToolCallContent(exchange, toolCall, result, exchangeTime, isRedirected) {
    const toolSuccess = result && !result.is_error;
    
    // Handle both old and new tool call formats
    const toolName = toolCall.function?.name || toolCall.name || 'Unknown Tool';
    const toolArgs = toolCall.function?.arguments || toolCall.input || toolCall.parameters || {};
    
    let content = `### ${toolName} - ${exchangeTime}${isRedirected ? ' (Redirected)' : ''}\n\n`;
    
    // Handle both undefined and empty string cases
    const userMessage = (exchange.userMessage && exchange.userMessage.trim()) || 
                       (exchange.humanMessage && exchange.humanMessage.trim());
    
    if (userMessage) {
      // Handle Promise objects that might be from redactSecrets calls
      const userMessageStr = userMessage && typeof userMessage === 'object' && userMessage.then ? 
        await userMessage : 
        (typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage));
      content += `**User Request:** ${userMessageStr}\n\n`;
    } else {
      // This is an automatic execution (hook, system-initiated, etc.)
      content += `**System Action:** (Initiated automatically)\n\n`;
    }
    
    content += `**Tool:** ${toolName}\n`;
    content += `**Input:** \`\`\`json\n${JSON.stringify(toolArgs, null, 2)}\n\`\`\`\n\n`;
    
    const status = toolSuccess ? '✅ Success' : '❌ Error';
    content += `**Result:** ${status}\n`;
    
    if (result) {
      const analysis = this.analyzeExchangeContent(exchange);
      if (analysis.categories.length > 0) {
        content += `**AI Analysis:** ${analysis.categories.join(', ')} - routing: ${isRedirected ? 'coding project' : 'local project'}\n`;
      }
    }
    
    content += `\n---\n\n`;
    return content;
  }

  /**
   * Format text-only exchange content
   */
  formatTextOnlyContent(exchange, exchangeTime, isRedirected) {
    let content = `### Text Exchange - ${exchangeTime}${isRedirected ? ' (Redirected)' : ''}\n\n`;
    
    const userMsg = exchange.userMessage || '';
    const assistantResp = exchange.assistantResponse || exchange.claudeResponse || '';
    
    // Ensure userMsg and assistantResp are strings
    const userMsgStr = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg);
    const assistantRespStr = typeof assistantResp === 'string' ? assistantResp : JSON.stringify(assistantResp);
    
    // Only show sections that have content
    if (userMsgStr && userMsgStr.trim()) {
      content += `**User Message:** ${userMsgStr.slice(0, 500)}${userMsgStr.length > 500 ? '...' : ''}\n\n`;
    }
    
    if (assistantRespStr && assistantRespStr.trim()) {
      content += `**Assistant Response:** ${assistantRespStr.slice(0, 500)}${assistantRespStr.length > 500 ? '...' : ''}\n\n`;
    }
    
    content += `**Type:** Text-only exchange (no tool calls)\n\n---\n\n`;
    
    return content;
  }

  /**
   * Log exchange to session file
   */
  async logExchangeToSession(exchange, sessionFile, targetProject) {
    const isRedirected = targetProject !== this.config.projectPath;
    this.debug(`📝 LOGGING TO SESSION: ${sessionFile} (redirected: ${isRedirected})`);
    
    // Skip exchanges with no meaningful content (no user message AND no tool calls)
    if ((!exchange.userMessage || (typeof exchange.userMessage === 'string' && exchange.userMessage.trim().length === 0)) && 
        (!exchange.toolCalls || exchange.toolCalls.length === 0)) {
      this.debug(`Skipping exchange with no meaningful content (no user message and no tool calls)`);
      return;
    }

    // Skip /sl commands only, process all other exchanges regardless of tool calls
    if (exchange.userMessage && this.isSlCommand(exchange.userMessage)) {
      this.debug(`Skipping /sl command: ${exchange.userMessage.substring(0, 50)}...`);
      return;
    }
    
    
    this.debug(`Processing exchange: tools=${exchange.toolCalls ? exchange.toolCalls.length : 0}`);
    
    // Log tool calls if present, otherwise log text-only exchange
    if (exchange.toolCalls && exchange.toolCalls.length > 0) {
      // Log each tool call individually with detailed format (like original monitor)
      for (const toolCall of exchange.toolCalls) {
        const result = exchange.toolResults.find(r => r.tool_use_id === toolCall.id);
        await this.logDetailedToolCall(exchange, toolCall, result, sessionFile, isRedirected);
      }
    } else {
      // Log text-only exchange (no tool calls)
      await this.logTextOnlyExchange(exchange, sessionFile, isRedirected);
    }
  }

  /**
   * Log text-only exchange (no tool calls)
   */
  async logTextOnlyExchange(exchange, sessionFile, isRedirected) {
    const timestamp = formatTimestamp(exchange.timestamp);
    const exchangeTime = timestamp.lslFormat;

    // Build exchange entry
    const exchangeEntry = {
      timestamp: exchangeTime,
      user_message: exchange.userMessage,
      assistant_response: exchange.assistantResponse || exchange.claudeResponse,
      type: 'text_exchange',
      has_tool_calls: false
    };

    // Add routing information if redirected
    if (isRedirected) {
      exchangeEntry.routing_info = {
        original_project: this.config.projectPath,
        redirected_to: 'coding',
        reason: 'coding_content_detected'
      };
    }

    // Format and append to session file
    let content = `### Text Exchange - ${exchangeTime}${isRedirected ? ' (Redirected)' : ''}\n\n`;

    const userMsg = exchange.userMessage || '(No user message)';
    const assistantResp = exchange.assistantResponse || exchange.claudeResponse || '(No response)';

    // Ensure userMsg and assistantResp are strings
    const userMsgStr = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg);
    const assistantRespStr = typeof assistantResp === 'string' ? assistantResp : JSON.stringify(assistantResp);

    content += `**User Message:** ${userMsgStr}\n\n`;

    if (assistantRespStr && assistantRespStr !== '(No response)' && assistantRespStr.trim()) {
      content += `**Claude Response:** ${assistantRespStr}\n\n`;
    }

    content += `---\n\n`;
    
    try {
      this.debug(`📝 WRITING TEXT CONTENT: ${content.length} chars to ${sessionFile}`);
      fs.appendFileSync(sessionFile, content);
      
      // CRITICAL FIX: Verify content was actually written
      if (fs.existsSync(sessionFile)) {
        this.debug(`✅ TEXT WRITE COMPLETE`);
      } else {
        throw new Error(`File disappeared after write: ${sessionFile}`);
      }
    } catch (error) {
      console.error(`🚨 TEXT CONTENT WRITE FAILED: ${sessionFile}`);
      console.error(`Error: ${error.message}`);
      this.logHealthError(`Text content write failed: ${sessionFile} - ${error.message}`);
      throw error;
    }
  }

  /**
   * Log individual tool call with detailed JSON input/output (original monitor format)
   */
  async logDetailedToolCall(exchange, toolCall, result, sessionFile, isRedirected) {
    const timestamp = formatTimestamp(exchange.timestamp);
    const exchangeTime = timestamp.lslFormat;
    const toolSuccess = result && !result.is_error;
    
    // Use built-in fast semantic analysis for routing info (not MCP server)
    const routingAnalysis = this.analyzeForRouting(exchange, toolCall, result);
    
    let content = `### ${toolCall.name} - ${exchangeTime}${isRedirected ? ' (Redirected)' : ''}\n\n`;
    
    const userMsg = (exchange.userMessage && exchange.userMessage.trim()) || 
                    (exchange.humanMessage && exchange.humanMessage.trim());
    
    if (userMsg) {
      // Handle Promise objects that might be from redactSecrets calls
      const resolvedUserMsg = userMsg && typeof userMsg === 'object' && userMsg.then ? 
        await userMsg : userMsg;
      // Ensure userMsg is a string before using slice
      const userMsgStr = typeof resolvedUserMsg === 'string' ? resolvedUserMsg : JSON.stringify(resolvedUserMsg);
      content += `**User Request:** ${await redactSecrets(userMsgStr.slice(0, 200))}${userMsgStr.length > 200 ? '...' : ''}\n\n`;
    } else {
      // This is an automatic execution (hook, system-initiated, etc.)
      content += `**System Action:** (Initiated automatically)\n\n`;
    }
    content += `**Tool:** ${toolCall.name}\n`;
    content += `**Input:** \`\`\`json\n${await redactSecrets(JSON.stringify(toolCall.input, null, 2))}\n\`\`\`\n\n`;
    content += `**Result:** ${toolSuccess ? '✅ Success' : '❌ Error'}\n`;
    
    if (result?.content) {
      const output = typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
      content += `**Output:** \`\`\`\n${await redactSecrets(output.slice(0, 500))}${output.length > 500 ? '\n...[truncated]' : ''}\n\`\`\`\n\n`;
    }
    
    content += `**AI Analysis:** ${routingAnalysis}\n\n---\n\n`;
    try {
      this.debug(`📝 WRITING TOOL CONTENT: ${content.length} chars to ${sessionFile}`);
      fs.appendFileSync(sessionFile, content);
      
      // CRITICAL FIX: Verify content was actually written
      if (fs.existsSync(sessionFile)) {
        this.debug(`✅ TOOL WRITE COMPLETE`);
      } else {
        throw new Error(`File disappeared after write: ${sessionFile}`);
      }
    } catch (error) {
      console.error(`🚨 TOOL CONTENT WRITE FAILED: ${sessionFile}`);
      console.error(`Error: ${error.message}`);
      this.logHealthError(`Tool content write failed: ${sessionFile} - ${error.message}`);
      throw error;
    }
  }

  /**
   * Fast built-in semantic analysis for routing decisions (not MCP server)
   */
  analyzeForRouting(exchange, toolCall, result) {
    const toolInput = JSON.stringify(toolCall.input || {});
    const resultContent = JSON.stringify(result?.content || '');
    // Handle both undefined and empty string cases
    const userMessage = (exchange.userMessage && exchange.userMessage.trim()) || 
                       (exchange.humanMessage && exchange.humanMessage.trim()) || 
                       '(Initiated automatically)';
    
    // Check for coding-related file paths and operations
    const codingPaths = [
      '/users/q284340/agentic/coding/',
      'coding/scripts/',
      'coding/bin/',
      'coding/src/',
      'coding/.specstory/',
      'coding/integrations/'
    ];
    
    const combinedText = (toolInput + resultContent + userMessage).toLowerCase();
    const isCoding = codingPaths.some(path => combinedText.includes(path));
    
    // Determine activity category
    let category = 'general';
    if (toolCall.name === 'Edit' || toolCall.name === 'Write' || toolCall.name === 'MultiEdit') {
      category = 'file_modification';
    } else if (toolCall.name === 'Read' || toolCall.name === 'Glob') {
      category = 'file_read';
    } else if (toolCall.name === 'Bash') {
      category = 'command_execution';
    } else if (toolCall.name === 'Grep') {
      category = 'search_operation';
    }
    
    return `${isCoding ? '🔧 Coding-related' : '📋 General'} ${category} - routing: ${isCoding ? 'coding project' : 'local project'}`;
  }

  /**
   * Process exchanges with enhanced user prompt detection
   */
  async processExchanges(exchanges) {
    if (!exchanges || exchanges.length === 0) return;

    this.debug(`Processing ${exchanges.length} exchanges`);
    let userPromptCount = 0;
    let nonUserPromptCount = 0;

    for (const exchange of exchanges) {
      // CRITICAL FIX: Use exchange timestamp for proper time tranche calculation
      const currentTranche = this.getCurrentTimetranche(exchange.timestamp); // Use exchange timestamp
      console.log(`🐛 DEBUG TRANCHE: ${JSON.stringify(currentTranche)} for exchange at ${new Date(exchange.timestamp).toISOString()}`);
      
      // Real-time trajectory analysis for each exchange
      if (this.trajectoryAnalyzer) {
        try {
          const trajectoryAnalysis = await this.trajectoryAnalyzer.analyzeTrajectoryState(exchange);
          
          // Check if intervention is needed
          if (this.trajectoryAnalyzer.shouldIntervene(trajectoryAnalysis)) {
            const guidance = this.trajectoryAnalyzer.generateInterventionGuidance(trajectoryAnalysis, exchange);
            this.debug(`🎯 Trajectory intervention: ${guidance.message}`);
            
            // Log intervention to health file for monitoring
            this.logHealthError(`Trajectory intervention: ${guidance.message}`);
          }
          
          this.debug(`📊 Trajectory state: ${trajectoryAnalysis.state} (confidence: ${trajectoryAnalysis.confidence})`);
        } catch (error) {
          this.debug(`Failed to analyze trajectory: ${error.message}`);
        }
      }
      
      if (exchange.isUserPrompt) {
        userPromptCount++;
        const userMessageText = typeof exchange.userMessage === 'string' ? exchange.userMessage : JSON.stringify(exchange.userMessage);
        console.log(`🔵 USER PROMPT ${userPromptCount}: ${userMessageText?.substring(0, 100)}...`);
        // New user prompt detected
        
        // Check if we crossed session boundary
        if (this.isNewSessionBoundary(currentTranche, this.lastTranche)) {

          // Complete previous user prompt set if exists
          if (this.currentUserPromptSet.length > 0) {
            const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
            if (targetProject !== null) {
              // FIX: Use tranche from the FIRST exchange in the set being written
              const setTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
              const wasWritten = await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, setTranche);
              // Only clear if successfully written, otherwise keep accumulating
              if (wasWritten) {
                this.currentUserPromptSet = [];
              }
            } else {
              // Skip non-relevant exchanges
              this.currentUserPromptSet = [];
            }
          }

          // NO LONGER CREATE EMPTY FILES AT SESSION BOUNDARIES
          // Files are only created when processUserPromptSetCompletion has content to write
          this.lastTranche = currentTranche;
          this.debug('🕒 Session boundary crossed, but not creating empty files');

        } else {
          // Same session - complete current user prompt set
          if (this.currentUserPromptSet.length > 0) {
            const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
            if (targetProject !== null) {
              // FIX: Use tranche from the FIRST exchange in the set being written
              const setTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
              const wasWritten = await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, setTranche);
              // Only clear if successfully written
              if (wasWritten) {
                this.currentUserPromptSet = [];
              }
            } else {
              // Skip non-relevant exchanges
              this.currentUserPromptSet = [];
            }

            // Note: Redirect detection now handled by conversation-based analysis in status line
          }
        }
        
        // Start new user prompt set
        this.currentUserPromptSet = [exchange];
        this.lastUserPromptTime = exchange.timestamp;
        
      } else {
        nonUserPromptCount++;
        // Add to current user prompt set
        if (this.currentUserPromptSet.length > 0) {
          this.currentUserPromptSet.push(exchange);
        }
      }
      
      this.lastProcessedUuid = exchange.id;
      this.exchangeCount++;
    }

    // Save state after processing all exchanges to prevent re-processing on restart
    this.saveLastProcessedUuid();

    console.log(`📊 EXCHANGE SUMMARY: ${userPromptCount} user prompts, ${nonUserPromptCount} non-user prompts (total: ${exchanges.length})`);

    // Trigger knowledge extraction asynchronously (non-blocking)
    if (this.knowledgeExtractionEnabled && this.knowledgeExtractor && exchanges.length > 0) {
      this.extractKnowledgeAsync(exchanges).catch(err => {
        this.debug(`Knowledge extraction failed (non-critical): ${err.message}`);
        this.knowledgeExtractionStatus.errorCount++;
      });
    }

    // Process any remaining user prompt set
    if (this.currentUserPromptSet.length > 0) {
      console.log(`🔄 Processing final user prompt set with ${this.currentUserPromptSet.length} exchanges`);
      const currentTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
      const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
      console.log(`🎯 Final target project: ${targetProject}`);
      if (targetProject !== null) {
        const wasWritten = await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, currentTranche);
        // Only clear if successfully written
        if (wasWritten) {
          this.currentUserPromptSet = [];
        }
      } else {
        this.currentUserPromptSet = [];
      }
    }
  }

  // Removed redirect file methods - status line now uses conversation-based detection

  /**
   * Check if transcript has new content
   */
  hasNewContent() {
    if (!this.transcriptPath) return false;

    try {
      const stats = fs.statSync(this.transcriptPath);
      const hasNew = stats.size !== this.lastFileSize;
      this.lastFileSize = stats.size;
      return hasNew;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start monitoring
   */
  start() {
    if (!this.transcriptPath) {
      console.log('❌ No current transcript file found. Make sure Claude Code is running.');
      return;
    }

    console.log(`🚀 Starting enhanced transcript monitor`);
    console.log(`📁 Project: ${this.config.projectPath}`);
    console.log(`📊 Transcript: ${path.basename(this.transcriptPath)}`);
    console.log(`🔍 Check interval: ${this.config.checkInterval}ms`);
    const sessionDurationMins = Math.round(this.getSessionDurationMs() / 60000);
    console.log(`⏰ Session boundaries: Every ${sessionDurationMins} minutes`);

    // Create initial health file
    this.updateHealthFile();
    
    // Set up health file update interval (every 5 seconds)
    this.healthIntervalId = setInterval(() => {
      this.updateHealthFile();
    }, 5000);

    // Add transcript refresh counter for periodic updates
    let transcriptRefreshCounter = 0;
    const TRANSCRIPT_REFRESH_INTERVAL = 30; // Refresh transcript path every 30 cycles (60 seconds at 2s intervals)

    // Add classification finalization counter for periodic MD report generation
    let finalizationCounter = 0;
    const FINALIZATION_INTERVAL = 900; // Finalize every 900 cycles (30 minutes at 2s intervals)

    this.intervalId = setInterval(async () => {
      if (this.isProcessing) return;

      // Periodically finalize classification logger to generate MD summary reports
      finalizationCounter++;
      if (finalizationCounter >= FINALIZATION_INTERVAL) {
        finalizationCounter = 0;
        if (this.classificationLogger) {
          console.log('📊 Generating classification summary reports...');
          this.classificationLogger.finalize();
        }
      }

      // CRITICAL FIX: Periodically refresh transcript path to detect new Claude sessions
      transcriptRefreshCounter++;
      if (transcriptRefreshCounter >= TRANSCRIPT_REFRESH_INTERVAL) {
        transcriptRefreshCounter = 0;
        const newTranscriptPath = this.findCurrentTranscript();
        
        if (newTranscriptPath && newTranscriptPath !== this.transcriptPath) {
          console.log(`🔄 Transcript file changed: ${path.basename(newTranscriptPath)}`);
          console.log(`   Previous: ${path.basename(this.transcriptPath)} (${this.lastFileSize} bytes)`);

          // Reset file tracking for new transcript
          this.transcriptPath = newTranscriptPath;
          this.lastFileSize = 0;
          // BUG FIX: Don't reset lastProcessedUuid - it should persist across transcript files
          // to prevent re-processing and duplicate writes to LSL files
          // this.lastProcessedUuid = null; // REMOVED - was causing duplicate writes

          // Log transcript switch to health file
          this.logHealthError(`Transcript switched to: ${path.basename(newTranscriptPath)}`);

          console.log(`   ✅ Now monitoring: ${path.basename(this.transcriptPath)}`);
          console.log(`   📌 Continuing from last processed UUID to prevent duplicates`);
        }
      }

      if (!this.hasNewContent()) return;

      this.isProcessing = true;
      try {
        const exchanges = await this.getUnprocessedExchanges();
        if (exchanges.length > 0) {
          await this.processExchanges(exchanges);
        }
      } catch (error) {
        this.debug(`Error in monitoring loop: ${error.message}`);
        this.logHealthError(`Monitoring loop error: ${error.message}`);
      } finally {
        this.isProcessing = false;
      }
    }, this.config.checkInterval);

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Stopping enhanced transcript monitor...');
      
      // Complete any pending user prompt set
      if (this.currentUserPromptSet.length > 0) {
        const currentTranche = this.getCurrentTimetranche();
        const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);

        if (targetProject !== null) {
          // On shutdown, try to write even if incomplete (we're about to exit anyway)
          await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, currentTranche);
          // Note: We don't check return value since we're shutting down
        }
      }
      
      // Note: No longer need to clear redirect files

      // Finalize classification logger (generates summary MD files)
      if (this.classificationLogger) {
        this.classificationLogger.finalize();
      }

      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Stop monitoring
   */
  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.healthIntervalId) {
      clearInterval(this.healthIntervalId);
      this.healthIntervalId = null;
    }

    // Stop trajectory analyzer heartbeat
    if (this.trajectoryAnalyzer) {
      this.trajectoryAnalyzer.stopHeartbeat();
      this.debug('🎯 Trajectory analyzer heartbeat stopped');
    }

    // Shutdown file manager gracefully
    if (this.fileManager) {
      await this.fileManager.shutdown();
      this.debug('📁 LSL File Manager shut down gracefully');
    }

    this.cleanupHealthFile();
    console.log('📋 Enhanced transcript monitor stopped');
  }

  /**
   * Debug logging
   */
  debug(message) {
    if (this.config.debug) {
      console.error(`[EnhancedTranscriptMonitor] ${new Date().toISOString()} ${message}`);
    }
  }

  /**
   * Update health file to indicate monitor is running
   */
  updateHealthFile() {
    try {
      // Generate user hash for multi-user collision prevention
      const userHash = UserHashGenerator.generateHash({ debug: false });
      
      // Get current process and system metrics
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const uptime = process.uptime();
      
      // CRITICAL FIX: Add suspicious activity detection
      const uptimeHours = uptime / 3600;
      const isSuspiciousActivity = this.exchangeCount === 0 && uptimeHours > 0.5; // No exchanges after 30+ minutes
      
      // Check if transcript file exists and get its info
      let transcriptStatus = 'unknown';
      let transcriptSize = 0;
      let transcriptAge = 0;
      
      if (this.transcriptPath) {
        try {
          const stats = fs.statSync(this.transcriptPath);
          transcriptSize = stats.size;
          transcriptAge = Date.now() - stats.mtime.getTime();
          transcriptStatus = transcriptAge > (this.config.sessionDuration * 2) ? 'stale' : 'active';
        } catch (error) {
          transcriptStatus = 'missing';
        }
      } else {
        transcriptStatus = 'not_found';
      }
      
      const healthData = {
        timestamp: Date.now(),
        projectPath: this.config.projectPath,
        transcriptPath: this.transcriptPath,
        status: isSuspiciousActivity ? 'suspicious' : 'running',
        userHash: userHash,
        metrics: {
          memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          memoryTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
          cpuUser: cpuUsage.user,
          cpuSystem: cpuUsage.system,
          uptimeSeconds: Math.round(uptime),
          processId: process.pid
        },
        transcriptInfo: {
          status: transcriptStatus,
          sizeBytes: transcriptSize,
          ageMs: transcriptAge,
          lastFileSize: this.lastFileSize
        },
        activity: {
          lastExchange: this.lastProcessedUuid || null,
          exchangeCount: this.exchangeCount || 0,
          isSuspicious: isSuspiciousActivity,
          suspicionReason: isSuspiciousActivity ? `No exchanges processed in ${uptimeHours.toFixed(1)} hours` : null
        },
        streamingActive: this.streamingReader !== null,
        errors: this.healthErrors || [],
        trajectory: this.trajectoryAnalyzer ? this.trajectoryAnalyzer.getCurrentTrajectoryState() : null,
        knowledgeExtraction: this.getKnowledgeExtractionStatus()
      };
      
      // Add warning if suspicious activity detected
      if (isSuspiciousActivity) {
        console.warn(`⚠️ HEALTH WARNING: Monitor has processed 0 exchanges in ${uptimeHours.toFixed(1)} hours`);
        console.warn(`   Current transcript: ${this.transcriptPath ? path.basename(this.transcriptPath) : 'none'}`);
        console.warn(`   Transcript status: ${transcriptStatus} (${transcriptSize} bytes, age: ${Math.round(transcriptAge/1000)}s)`);
      }
      
      fs.writeFileSync(this.config.healthFile, JSON.stringify(healthData, null, 2));
    } catch (error) {
      this.debug(`Failed to update health file: ${error.message}`);
    }
  }

  /**
   * Log health error for monitoring
   */
  logHealthError(errorMessage) {
    if (!this.healthErrors) {
      this.healthErrors = [];
    }
    
    const error = {
      timestamp: Date.now(),
      message: errorMessage,
      isoTime: new Date().toISOString()
    };
    
    this.healthErrors.push(error);
    
    // Keep only last 10 errors to avoid bloating
    if (this.healthErrors.length > 10) {
      this.healthErrors = this.healthErrors.slice(-10);
    }
    
    // Immediately update health file to reflect error
    this.updateHealthFile();
    
    console.error(`🚨 HEALTH ERROR LOGGED: ${errorMessage}`);
  }

  /**
   * Remove health file on shutdown
   */
  cleanupHealthFile() {
    try {
      if (fs.existsSync(this.config.healthFile)) {
        fs.unlinkSync(this.config.healthFile);
      }
    } catch (error) {
      this.debug(`Failed to cleanup health file: ${error.message}`);
    }
  }
}

/**
 * Batch reprocess all historical transcripts with current format
 */
async function reprocessHistoricalTranscripts(projectPath = null) {
  try {
    const targetProject = projectPath || process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd();
    const monitor = new EnhancedTranscriptMonitor({ projectPath: targetProject });
    
    console.log('🔄 Starting historical transcript reprocessing...');
    console.log(`📁 Target project: ${targetProject}`);
    
    // Clear existing session files for clean regeneration
    const historyDir = path.join(targetProject, '.specstory', 'history');
    if (fs.existsSync(historyDir)) {
      const sessionFiles = fs.readdirSync(historyDir).filter(file => 
        file.includes('-session') && file.endsWith('.md')
      );
      
      console.log(`🗑️ Removing ${sessionFiles.length} existing session files for clean regeneration...`);
      for (const file of sessionFiles) {
        fs.unlinkSync(path.join(historyDir, file));
      }
    }
    
    // Also clear redirected session files in coding project if different
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    if (targetProject !== codingPath) {
      const codingHistoryDir = path.join(codingPath, '.specstory', 'history');
      if (fs.existsSync(codingHistoryDir)) {
        const redirectedFiles = fs.readdirSync(codingHistoryDir).filter(file => 
          file.includes('from-' + path.basename(targetProject)) && file.endsWith('.md')
        );
        
        console.log(`🗑️ Removing ${redirectedFiles.length} redirected session files in coding project...`);
        for (const file of redirectedFiles) {
          fs.unlinkSync(path.join(codingHistoryDir, file));
        }
      }
    }
    
    // Reset processing state to reprocess everything
    monitor.lastProcessedUuid = null;
    
    // Find and process all transcript files
    const transcriptFiles = monitor.findAllTranscripts();
    if (transcriptFiles.length === 0) {
      console.log('❌ No transcript files found for this project');
      return;
    }
    
    console.log(`📊 Found ${transcriptFiles.length} transcript files to process`);
    
    // Check if parallel processing is requested via environment variable
    const useParallel = process.env.LSL_PARALLEL_PROCESSING !== 'false';
    const maxConcurrency = parseInt(process.env.LSL_MAX_CONCURRENCY || '3');
    
    if (useParallel && transcriptFiles.length > 1) {
      console.log(`🚀 Using parallel processing with max concurrency: ${maxConcurrency}`);
      await monitor.processTranscriptsInParallel(transcriptFiles, maxConcurrency);
    } else {
      console.log(`🔄 Using sequential processing...`);
      
      // Fallback to sequential processing for single files or when disabled
      let totalProcessed = 0;
      for (let i = 0; i < transcriptFiles.length; i++) {
        const transcriptFile = transcriptFiles[i];
        console.log(`📊 Processing transcript ${i + 1}/${transcriptFiles.length}: ${transcriptFile.filename}`);
        
        const result = await monitor.processSingleTranscript(transcriptFile);
        totalProcessed += result.processed;
        
        console.log(`✅ Processed ${result.processed} exchanges from ${result.file} in ${(result.duration / 1000).toFixed(1)}s`);
      }
      
      console.log(`⚡ Total processed exchanges: ${totalProcessed}`);
    }
    
    console.log('✅ Historical transcript reprocessing completed!');
    console.log(`📋 Generated detailed LSL files with current format`);
    
    // Show summary of created files
    if (fs.existsSync(historyDir)) {
      const newFiles = fs.readdirSync(historyDir).filter(file => 
        file.includes('-session') && file.endsWith('.md')
      );
      console.log(`📁 Created ${newFiles.length} session files in ${path.basename(targetProject)}`);
    }
    
    if (targetProject !== codingPath && fs.existsSync(path.join(codingPath, '.specstory', 'history'))) {
      const codingFiles = fs.readdirSync(path.join(codingPath, '.specstory', 'history')).filter(file => 
        file.includes('from-' + path.basename(targetProject)) && file.endsWith('.md')
      );
      console.log(`📁 Created ${codingFiles.length} redirected session files in coding project`);
    }
    
  } catch (error) {
    console.error('❌ Failed to reprocess historical transcripts:', error.message);
    process.exit(1);
  }
}

// CLI interface
async function main() {
  try {
    const args = process.argv.slice(2);
    
    // Check for reprocessing mode
    if (args.includes('--reprocess') || args.includes('--batch')) {
      const projectArg = args.find(arg => arg.startsWith('--project='));
      const projectPath = projectArg ? projectArg.split('=')[1] : null;
      
      // Set environment variables for parallel processing options
      if (args.includes('--parallel')) {
        process.env.LSL_PARALLEL_PROCESSING = 'true';
      }
      if (args.includes('--no-parallel')) {
        process.env.LSL_PARALLEL_PROCESSING = 'false';
      }
      
      const concurrencyArg = args.find(arg => arg.startsWith('--concurrency='));
      if (concurrencyArg) {
        process.env.LSL_MAX_CONCURRENCY = concurrencyArg.split('=')[1];
      }
      
      await reprocessHistoricalTranscripts(projectPath);
      return;
    }
    
    // Normal monitoring mode
    const monitor = new EnhancedTranscriptMonitor({ debug: true });
    await monitor.start();
  } catch (error) {
    console.error('❌ Failed to start transcript monitor:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default EnhancedTranscriptMonitor;