#!/usr/bin/env node

/**
 * Enhanced Claude Code Transcript Monitor
 * Supports multiple parallel sessions with prompt-triggered trajectory updates
 */

// Load environment variables from coding/.env
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { dirname, join } from 'path';
const require = createRequire(import.meta.url);

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
// SemanticAnalyzer removed — called APIs directly without proxy support, hanging on VPN
import ReliableCodingClassifier from '../src/live-logging/ReliableCodingClassifier.js';
import StreamingTranscriptReader from '../src/live-logging/StreamingTranscriptReader.js';
import MastraTranscriptReader from '../src/live-logging/MastraTranscriptReader.js';
import ConfigurableRedactor from '../src/live-logging/ConfigurableRedactor.js';
import UserHashGenerator from '../src/live-logging/user-hash-generator.js';
import LSLFileManager from '../src/live-logging/LSLFileManager.js';
import ClassificationLogger from './classification-logger.js';
import ProcessStateManager from './process-state-manager.js';
import { enableAutoRestart } from './auto-restart-watcher.js';
import { execSync as _execSync } from 'child_process';
import { ObservationWriter } from '../src/live-logging/ObservationWriter.js';

// Knowledge management dependencies
import { DatabaseManager } from '../src/databases/DatabaseManager.js';
// NOTE: EmbeddingGenerator removed - embedding generation now handled by MCP semantic analysis
// import { EmbeddingGenerator } from '../src/knowledge-management/EmbeddingGenerator.js';
import { UnifiedInferenceEngine } from '../src/inference/UnifiedInferenceEngine.js';
import { runIfMain } from '../lib/utils/esm-cli.js';

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
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot;
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

    // Detect agent type: 'claude' (default) or 'copilot'
    this.agentType = config.agent || process.env.CODING_AGENT || 'claude';
    
    this.config = {
      checkInterval: config.checkInterval || 2000, // More frequent for prompt detection
      projectPath: config.projectPath || this.getProjectPath(config),
      debug: this.debug_enabled,
      sessionDuration: config.sessionDuration || 7200000, // 2 hours (generous for debugging)
      timezone: config.timezone || getTimezone(), // Use central timezone config
      healthFile: this.getCentralizedHealthFile(config.projectPath || this.getProjectPath(config)),
      mode: config.mode || 'all', // Processing mode: 'all' or 'foreign'
      ...config
    };
    
    // Store options for methods to access
    this.options = config;

    // Initialize Process State Manager for preventing multiple instances
    this.processStateManager = new ProcessStateManager();
    this.serviceRegistered = false;

    this.transcriptPath = this.findCurrentTranscript();

    // State file for persisting lastProcessedUuid across restarts
    this.stateFile = this.getStateFilePath();
    this.lastProcessedUuid = this.loadLastProcessedUuid();
    this.exchangeCount = 0;
    this.lastFileSize = 0;

    // Multi-transcript tracking: process ALL active transcripts simultaneously
    // Each entry: { lastFileSize, lastProcessedUuid, agentType }
    this.trackedTranscripts = new Map();
    this._initMultiTranscriptTracking();

    // Idle timeout: auto-exit if no transcript activity for this duration
    // This prevents orphaned monitors when Claude sessions are force-quit
    this.idleTimeout = config.idleTimeout || 1800000; // 30 minutes default
    this.lastActivityTime = Date.now(); // Track when we last saw transcript activity
    
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
    
    // Semantic analyzer removed — all LLM calls route through the LLM proxy (port 12435)
    // SemanticAnalyzer called APIs directly (no proxy support), hanging on VPN
    this.semanticAnalyzer = null;
    
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

    // Observation tap - fire-and-forget per D-04 (Phase 23)
    this.observationWriter = null;
    this._lastObservationId = null; // Track last written observation for cross-prompt-set artifact updates
    this._initObservationWriter();

    // Initialize classification logger for tracking 4-layer classification decisions
    this.classificationLogger = null;
    try {
      const projectName = path.basename(this.config.projectPath);
      const userHash = UserHashGenerator.generateHash({ debug: false });
      const codingRepo = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot;

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
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot;
    
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
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot;
    const projectName = path.basename(this.config.projectPath);
    const stateFileName = `${projectName}-transcript-monitor-state.json`;
    return path.join(codingPath, '.health', stateFileName);
  }

  /**
   * Initialize multi-transcript tracking by discovering all active transcripts
   */
  _initMultiTranscriptTracking() {
    const allTranscripts = this.findAllActiveTranscripts();
    const savedState = this._loadMultiTranscriptState();

    for (const t of allTranscripts) {
      const saved = savedState[t.path] || {};
      this.trackedTranscripts.set(t.path, {
        lastFileSize: 0,
        lastProcessedUuid: saved.lastProcessedUuid || null,
        agentType: t.source,
        currentUserPromptSet: [],
        lastTranche: null
      });
    }

    // Ensure the primary transcript is in the tracked set
    if (this.transcriptPath && !this.trackedTranscripts.has(this.transcriptPath)) {
      this.trackedTranscripts.set(this.transcriptPath, {
        lastFileSize: 0,
        lastProcessedUuid: this.lastProcessedUuid,
        agentType: this.agentType,
        currentUserPromptSet: [],
        lastTranche: null
      });
    }

    if (this.trackedTranscripts.size > 1) {
      process.stderr.write(`[EnhancedTranscriptMonitor] Multi-transcript: tracking ${this.trackedTranscripts.size} active transcripts\n`);
    }
  }

  /**
   * Find ALL active transcripts for this project (Claude JSONL + Copilot events.jsonl)
   */
  findAllActiveTranscripts() {
    const transcripts = [];

    // Claude JSONL files
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = this.getProjectDirName();
    const projectDir = path.join(baseDir, projectName);

    if (fs.existsSync(projectDir)) {
      try {
        const files = fs.readdirSync(projectDir)
          .filter(file => file.endsWith('.jsonl'))
          .map(file => {
            const filePath = path.join(projectDir, file);
            const stats = fs.statSync(filePath);
            return { path: filePath, mtime: stats.mtime, source: 'claude' };
          })
          .filter(f => (Date.now() - f.mtime.getTime()) < this.config.sessionDuration * 2);
        transcripts.push(...files);
      } catch (e) {
        this.debug(`Error scanning Claude transcripts: ${e.message}`);
      }
    }

    // Copilot events.jsonl
    const copilotTranscript = this.findCopilotTranscript();
    if (copilotTranscript) {
      transcripts.push({ path: copilotTranscript, mtime: new Date(), source: 'copilot' });
    }

    // OpenCode SQLite
    const openCodeTranscript = this.findOpenCodeTranscript();
    if (openCodeTranscript) {
      transcripts.push({ path: openCodeTranscript, mtime: new Date(), source: 'opencode' });
    }

    // Mastra NDJSON transcripts
    const mastraTranscriptDir = this.findMastraTranscriptDir();
    if (mastraTranscriptDir && fs.existsSync(mastraTranscriptDir)) {
      try {
        const mastraFiles = fs.readdirSync(mastraTranscriptDir)
          .filter(f => f.endsWith('.jsonl') || f.endsWith('.ndjson'))
          .map(f => {
            const fp = path.join(mastraTranscriptDir, f);
            const stats = fs.statSync(fp);
            return { path: fp, mtime: stats.mtime, source: 'mastra' };
          })
          .filter(f => (Date.now() - f.mtime.getTime()) < this.config.sessionDuration * 2);
        transcripts.push(...mastraFiles);
      } catch (e) {
        this.debug(`Error scanning Mastra transcripts: ${e.message}`);
      }
    }

    return transcripts;
  }

  /**
   * Load per-transcript state from state file
   */
  _loadMultiTranscriptState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
        return state.perTranscript || {};
      }
    } catch { /* ignore */ }
    return {};
  }

  /**
   * Save per-transcript state to state file
   */
  _saveMultiTranscriptState() {
    try {
      const stateDir = path.dirname(this.stateFile);
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      // Merge with existing state to preserve primary lastProcessedUuid
      let existing = {};
      try {
        if (fs.existsSync(this.stateFile)) {
          existing = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
        }
      } catch { /* ignore */ }

      const perTranscript = {};
      for (const [tPath, tracker] of this.trackedTranscripts) {
        if (tracker.lastProcessedUuid) {
          perTranscript[tPath] = {
            lastProcessedUuid: tracker.lastProcessedUuid,
            lastUpdated: new Date().toISOString()
          };
        }
      }

      const state = {
        ...existing,
        lastProcessedUuid: this.lastProcessedUuid,
        transcriptPath: this.transcriptPath,
        perTranscript,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      this.debug(`Failed to save multi-transcript state: ${error.message}`);
    }
  }

  /**
   * Refresh the set of tracked transcripts (called periodically)
   */
  _refreshTrackedTranscripts() {
    const allTranscripts = this.findAllActiveTranscripts();
    let added = 0;
    let removed = 0;

    const activePaths = new Set(allTranscripts.map(t => t.path));

    // Add new transcripts
    for (const t of allTranscripts) {
      if (!this.trackedTranscripts.has(t.path)) {
        this.trackedTranscripts.set(t.path, {
          lastFileSize: 0,
          lastProcessedUuid: null,
          agentType: t.source,
          currentUserPromptSet: [],
          lastTranche: null
        });
        added++;
        process.stderr.write(`[EnhancedTranscriptMonitor] New transcript detected: ${path.basename(t.path)} (${t.source})\n`);
      }
    }

    // Remove stale transcripts (no longer in active set)
    for (const [tPath] of this.trackedTranscripts) {
      if (!activePaths.has(tPath)) {
        this.trackedTranscripts.delete(tPath);
        removed++;
      }
    }

    if (added > 0 || removed > 0) {
      process.stderr.write(`[EnhancedTranscriptMonitor] Transcript refresh: ${added} added, ${removed} removed, ${this.trackedTranscripts.size} total\n`);
    }
  }

  /**
   * Process all tracked transcripts for new content (multi-transcript main loop)
   */
  async _processAllTrackedTranscripts() {
    let anyNewContent = false;

    for (const [tPath, tracker] of this.trackedTranscripts) {
      try {
        // Detect new content: file size for file-based transcripts, message count for OpenCode
        let currentSize;
        if (this.isOpenCodePath(tPath)) {
          const sessionId = this.getOpenCodeSessionId(tPath);
          currentSize = this.getOpenCodeMessageCount(sessionId);
        } else {
          const stats = fs.statSync(tPath);
          currentSize = stats.size;
        }
        if (currentSize === tracker.lastFileSize) {
          // No new content — but check if this transcript has a stale prompt set to flush.
          // This is the KEY path: assistant finished responding, waiting for user input.
          // The prompt set is complete and should be flushed as an observation.
          if (tracker.currentUserPromptSet && tracker.currentUserPromptSet.length > 0) {
            const lastTs = tracker.currentUserPromptSet[tracker.currentUserPromptSet.length - 1].timestamp;
            const setAge = Date.now() - new Date(lastTs).getTime();
            if (setAge > 10000) {
              // Check agent-specific completion before flushing
              const completionState = this.isAssistantComplete(tPath, tracker.agentType, tracker.currentUserPromptSet);
              if (!completionState.complete) {
                // Safety cap: force flush after 5 minutes to prevent infinite buffering
                const firstTs = tracker.currentUserPromptSet[0].timestamp;
                const setDuration = Date.now() - new Date(firstTs).getTime();
                if (setDuration <= 5 * 60 * 1000) {
                  this.debug(`⏳ Deferring flush (${Math.round(setAge/1000)}s old): ${completionState.reason}`);
                  continue;
                }
                this.debug(`⚠️ Force-flushing after ${Math.round(setDuration/60000)}min despite: ${completionState.reason}`);
              }
              // Swap state to this transcript's context for the flush
              const savedPath = this.transcriptPath;
              const savedUuid = this.lastProcessedUuid;
              const savedAgent = this.agentType;
              this.transcriptPath = tPath;
              this.lastProcessedUuid = tracker.lastProcessedUuid;
              this.agentType = tracker.agentType;

              const setTranche = this.getCurrentTimetranche(tracker.currentUserPromptSet[0].timestamp);
              const target = await this.determineTargetProject(tracker.currentUserPromptSet[0]);
              this.debug(`⏰ Flushing stale prompt set (no new content, ${Math.round(setAge/1000)}s old): ${tracker.currentUserPromptSet.length} exchanges from ${path.basename(tPath)}`);
              if (target !== null) {
                await this.processUserPromptSetCompletion(tracker.currentUserPromptSet, target, setTranche);
              } else {
                this._firePromptSetObservation(tracker.currentUserPromptSet);
              }
              tracker.currentUserPromptSet = [];
              // Update lastProcessedUuid from the flushed set
              tracker.lastProcessedUuid = this.lastProcessedUuid;
              this._saveMultiTranscriptState();

              // Restore
              this.transcriptPath = savedPath;
              this.lastProcessedUuid = savedUuid;
              this.agentType = savedAgent;
              anyNewContent = true; // trigger activity timestamp update
            }
          }
          continue;
        }

        // New content detected in this transcript
        anyNewContent = true;
        tracker.lastFileSize = currentSize;

        // Flush any pending prompt set from the previous transcript before switching.
        // Without this, transcript A's leftover prompt set gets completed by transcript B's
        // first exchange, causing cross-transcript contamination and wrong file targets.
        if (this.currentUserPromptSet.length > 0) {
          const flushTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
          const flushTarget = await this.determineTargetProject(this.currentUserPromptSet[0]);
          if (flushTarget !== null) {
            await this.processUserPromptSetCompletion(this.currentUserPromptSet, flushTarget, flushTranche);
          } else {
            // Not coding-related — skip LSL but still fire observation
            this._firePromptSetObservation(this.currentUserPromptSet);
          }
          this.currentUserPromptSet = [];
        }

        // Save and swap state to process this transcript
        const savedPath = this.transcriptPath;
        const savedSize = this.lastFileSize;
        const savedUuid = this.lastProcessedUuid;
        const savedAgent = this.agentType;
        const savedPromptSet = this.currentUserPromptSet;
        const savedLastTranche = this.lastTranche;

        this.transcriptPath = tPath;
        this.lastFileSize = tracker.lastFileSize;
        this.lastProcessedUuid = tracker.lastProcessedUuid;
        this.agentType = tracker.agentType;
        this.currentUserPromptSet = tracker.currentUserPromptSet || [];
        this.lastTranche = tracker.lastTranche || null;

        try {
          const exchanges = await this.getUnprocessedExchanges();
          console.log(`[ObsDebug] ${exchanges.length} exchanges, promptSet=${this.currentUserPromptSet.length}, lastUuid=${this.lastProcessedUuid?.slice(-8) || 'none'}`);
          if (exchanges.length > 0) {
            await this.processExchanges(exchanges);
            console.log(`[ObsDebug] After processExchanges: promptSet=${this.currentUserPromptSet.length}`);
          }

          // Time-based flush: fire observation for accumulated exchanges even when
          // no NEW exchanges arrive (handles OpenCode user-message persistence gap)
          if (exchanges.length === 0 && this.currentUserPromptSet.length > 0) {
            const oldestExchange = this.currentUserPromptSet[0];
            const ageMs = Date.now() - (oldestExchange.timestamp ? new Date(oldestExchange.timestamp).getTime() : Date.now());
            const FLUSH_THRESHOLD_MS = 3 * 60 * 1000;
            if (ageMs > FLUSH_THRESHOLD_MS) {
              console.log(`⏰ Time-based flush (no new exchanges): ${this.currentUserPromptSet.length} exchanges held for ${Math.round(ageMs / 1000)}s`);
              this._firePromptSetObservation(this.currentUserPromptSet);
              // Update lastProcessedUuid so we don't re-read
              const lastExch = this.currentUserPromptSet[this.currentUserPromptSet.length - 1];
              if (lastExch && lastExch.id) {
                this.lastProcessedUuid = lastExch.id;
              }
              this.currentUserPromptSet = [];
            }
          }

          // Flush stale or long-running prompt set for this transcript
          if (this.currentUserPromptSet.length > 0) {
            const lastTs = this.currentUserPromptSet[this.currentUserPromptSet.length - 1].timestamp;
            const setAge = Date.now() - new Date(lastTs).getTime();
            const firstTs = this.currentUserPromptSet[0].timestamp;
            const setDuration = Date.now() - new Date(firstTs).getTime();
            const isStale = setAge > 10000;
            const isLongRunning = setDuration > 5 * 60 * 1000;
            if (isStale || isLongRunning) {
              // Check agent-specific completion before flushing
              const completionState = this.isAssistantComplete(tPath, tracker.agentType, this.currentUserPromptSet);
              if (!completionState.complete && !isLongRunning) {
                this.debug(`⏳ Deferring per-transcript flush (${Math.round(setAge/1000)}s old): ${completionState.reason}`);
              } else {
                if (!completionState.complete) {
                  this.debug(`⚠️ Force-flushing per-transcript set after ${Math.round(setDuration/60000)}min despite: ${completionState.reason}`);
                }
                const setTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
                const target = await this.determineTargetProject(this.currentUserPromptSet[0]);
                const reason = isLongRunning ? `long-running (${Math.round(setDuration/60000)}min)` : `stale (${Math.round(setAge/1000)}s), ${completionState.reason}`;
                if (target !== null) {
                  this.debug(`⏰ Flushing per-transcript prompt set: ${this.currentUserPromptSet.length} exchanges, reason: ${reason}`);
                  await this.processUserPromptSetCompletion(this.currentUserPromptSet, target, setTranche);
                } else {
                  // Not coding-related — skip LSL but still fire observation
                  this._firePromptSetObservation(this.currentUserPromptSet);
                }
                this.currentUserPromptSet = [];
              }
            }
          }

          // Save back updated state to tracker
          tracker.lastProcessedUuid = this.lastProcessedUuid;
          tracker.currentUserPromptSet = this.currentUserPromptSet;
          tracker.lastTranche = this.lastTranche;
        } catch (error) {
          this.debug(`Error processing transcript ${path.basename(tPath)}: ${error.message}`);
        }

        // Restore primary state
        this.transcriptPath = savedPath;
        this.lastFileSize = savedSize;
        this.lastProcessedUuid = savedUuid;
        this.agentType = savedAgent;
        this.currentUserPromptSet = savedPromptSet;
        this.lastTranche = savedLastTranche;
      } catch (e) {
        // File may have been deleted
        if (e.code === 'ENOENT') {
          this.trackedTranscripts.delete(tPath);
        }
      }
    }

    if (anyNewContent) {
      this.lastActivityTime = Date.now();
      this._saveMultiTranscriptState();
    }

    return anyNewContent;
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

      // NOTE: EmbeddingGenerator removed - embedding generation now handled by MCP semantic analysis
      // Initialize embedding generator
      // const embeddingGenerator = new EmbeddingGenerator({
      //   projectPath: this.config.projectPath,
      //   databaseManager: databaseManager,
      //   debug: this.debug_enabled
      // });

      // Initialize inference engine — route all models through copilot on VPN
      // Direct API providers (groq, openai, anthropic) hang on corporate VPN
      const vpnSafeRouting = {
        'trajectory-intent': 'copilot/claude-sonnet-4.6',
        'trajectory-goal': 'copilot/claude-sonnet-4.6',
        'knowledge-pattern': 'copilot/claude-sonnet-4.6',
        'knowledge-concept': 'copilot/claude-sonnet-4.6',
        'concept-abstraction': 'copilot/claude-sonnet-4.6',
        'sensitive-analysis': 'copilot/claude-sonnet-4.6',
        'default': 'copilot/claude-sonnet-4.6'
      };
      const inferenceEngine = new UnifiedInferenceEngine({
        projectPath: this.config.projectPath,
        modelRouting: vpnSafeRouting,
        debug: this.debug_enabled
      });

      // Create knowledge extractor with all dependencies
      this.knowledgeExtractor = new StreamingKnowledgeExtractor({
        projectPath: this.config.projectPath,
        databaseManager: databaseManager,
        embeddingGenerator: null, // Embedding generation now handled by MCP semantic analysis
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

  /**
   * Initialize the ObservationWriter for live observation tap (Phase 23).
   * Non-blocking: errors are logged but never prevent ETM from operating.
   */
  async _initObservationWriter() {
    try {
      this.observationWriter = new ObservationWriter({
        dbPath: path.join(codingRoot, '.observations', 'observations.db'),
        // proxyUrl derived from LLM_CLI_PROXY_PORT env var (default 12435) in ObservationWriter
        // No provider specified — proxy uses network-adaptive routing
        // (VPN → copilot, outside → claude-code, fallback → groq/openai/anthropic)
        batchSize: 2, // Small batches for per-exchange granularity
      });
      await this.observationWriter.init();
      this.debug('[ObservationTap] Writer initialized');
    } catch (err) {
      process.stderr.write(`[ObservationTap] Init failed (non-blocking): ${err.message}\n`);
      this.observationWriter = null;
    }
  }

  /**
   * Fire observation for a COMPLETE prompt set (all exchanges).
   * Builds a consolidated message list so the LLM sees the full picture:
   * user intent + all tool calls + all assistant responses + final outcome.
   */
  _firePromptSetObservation(exchanges) {
    if (!this.observationWriter) return;
    if (!exchanges || exchanges.length === 0) return;

    // Deduplicate: prevent rapid-fire observations for the same exchange
    // Use exchange count + latest message UUID as dedup key (stable per logical turn)
    if (!this._firedPromptKeys) this._firedPromptKeys = new Map();
    const lastExchange = exchanges[exchanges.length - 1];
    const exchangeId = lastExchange?.id || lastExchange?.uuid || '';
    const userKey = `${exchanges.length}|${exchangeId}`;
    const now = Date.now();
    const lastFired = this._firedPromptKeys.get(userKey);
    if (lastFired && (now - lastFired) < 15000) {
      this.debug?.(`[ObservationTap] Dedup: skipping duplicate fire for same exchange (${Math.round((now - lastFired)/1000)}s ago)`);
      return;
    }
    this._firedPromptKeys.set(userKey, now);
    // Prune old keys (>2min) to prevent memory leak
    for (const [k, t] of this._firedPromptKeys) {
      if (now - t > 120000) this._firedPromptKeys.delete(k);
    }

    const messages = [];
    for (const exchange of exchanges) {
      // Include user messages from ALL exchanges so the LLM sees the full context
      // (clarifications, follow-ups within the same prompt set)
      if (exchange.userMessage) {
        messages.push({
          id: `${exchange.uuid || exchange.id}-user`,
          role: 'user',
          content: typeof exchange.userMessage === 'string' ? exchange.userMessage : JSON.stringify(exchange.userMessage),
          createdAt: new Date(exchange.timestamp).toISOString(),
          metadata: { agent: this.agentType, format: 'live' }
        });
      }

      // Build assistant content: tool call summary + text response
      let assistantContent = '';
      if (exchange.toolCalls && exchange.toolCalls.length > 0) {
        const toolSummary = exchange.toolCalls.map(tc => {
          const inp = tc.input || {};
          if (tc.name === 'Edit' || tc.name === 'Write') {
            return `${tc.name}: ${inp.file_path || 'unknown file'}`;
          } else if (tc.name === 'Read') {
            return `Read: ${inp.file_path || 'unknown file'}`;
          } else if (tc.name === 'Bash') {
            const cmd = (inp.command || '').slice(0, 120);
            return `Bash: ${cmd}`;
          } else if (tc.name === 'Grep' || tc.name === 'Glob') {
            return `${tc.name}: ${inp.pattern || ''} in ${inp.path || '.'}`;
          } else {
            return tc.name;
          }
        }).join('\n');
        assistantContent += `[Tool calls]\n${toolSummary}\n\n`;
      }
      const resp = exchange.assistantMessage || exchange.claudeResponse;
      if (resp) {
        const respStr = typeof resp === 'string' ? resp : JSON.stringify(resp);
        assistantContent += respStr;
      }

      if (assistantContent) {
        messages.push({
          id: `${exchange.uuid || exchange.id}-assistant`,
          role: 'assistant',
          content: assistantContent,
          createdAt: new Date(exchange.timestamp).toISOString(),
          metadata: { agent: this.agentType, format: 'live' }
        });
      }
    }

    if (messages.length < 2) return; // Need at least user + assistant

    // Extract modified files programmatically from tool calls (ground truth, not LLM-inferred)
    const modifiedFiles = [];
    const readFiles = [];
    for (const exchange of exchanges) {
      if (exchange.toolCalls) {
        for (const tc of exchange.toolCalls) {
          const filePath = tc.input?.file_path || tc.input?.filePath;
          if (filePath) {
            if (tc.name === 'Edit' || tc.name === 'Write') {
              if (!modifiedFiles.includes(filePath)) modifiedFiles.push(filePath);
            } else if (tc.name === 'Read') {
              if (!readFiles.includes(filePath)) readFiles.push(filePath);
            }
          }
        }
      }
    }

    // Debug: log tool call extraction for artifact tracking diagnosis
    const allToolCalls = exchanges.flatMap(ex => (ex.toolCalls || []).map(tc => tc.name));
    process.stderr.write(`[ObservationTap] Prompt set: ${exchanges.length} exchanges, ${allToolCalls.length} tool calls [${[...new Set(allToolCalls)].join(',')}], ${modifiedFiles.length} modified, ${readFiles.length} read\n`);

    const metadata = {
      agent: this.agentType,
      sessionId: this.sessionId || null,
      sourceFile: 'live-etm',
      project: path.basename(this.config.projectPath || ''),
      modifiedFiles: modifiedFiles.length > 0 ? modifiedFiles : undefined,
      readFiles: readFiles.length > 0 ? readFiles : undefined,
    };

    // Patch recent observations that have "Artifacts: none" with the actual modified files.
    // Handles: incremental re-processing where early fires miss Edit calls,
    // multi-turn tool calls across prompt set boundaries, ETM restarts.
    if (modifiedFiles.length > 0) {
      this._patchRecentObservationsWithArtifacts(modifiedFiles, readFiles);
    }

    // Fire-and-forget: do NOT await. Per D-04 and D-05.
    this.observationWriter.processMessages(messages, metadata).then(result => {
      // Store the observation ID so the NEXT prompt set can update it if needed
      if (result && result.lastObservationId) {
        this._lastObservationId = result.lastObservationId;
      }
    }).catch(err => {
      process.stderr.write(`[ObservationTap] PromptSet error: ${err.message}\n`);
    });
  }

  /**
   * Patch recent observations that have "Artifacts: none" with actual modified files.
   * Scans the last 30 minutes of observations for this agent and patches any missing artifacts.
   * Handles: (1) incremental re-processing where early fires miss Edit calls,
   * (2) multi-turn tool calls across prompt set boundaries,
   * (3) ETM restarts re-processing already-written exchanges.
   */
  _patchRecentObservationsWithArtifacts(modifiedFiles, readFiles) {
    if (!this.observationWriter?.db) return;
    if (!modifiedFiles || modifiedFiles.length === 0) return;
    try {
      const db = this.observationWriter.db;
      const rows = db.prepare(
        `SELECT id, summary, metadata FROM observations
         WHERE agent = ? AND summary LIKE '%Artifacts: none%'
          AND created_at > datetime('now', '-4 hours')
         ORDER BY created_at DESC LIMIT 10`
      ).all(this.agentType);

      if (rows.length === 0) return;

      const artifactsList = modifiedFiles.map(f => `edited ${f.split('/').pop()}`).join(', ');

      for (const row of rows) {
        const updatedSummary = row.summary.replace(/Artifacts:\s*none/i, `Artifacts: ${artifactsList}`);
        if (updatedSummary === row.summary) continue;

        let meta = {};
        try { meta = JSON.parse(row.metadata || '{}'); } catch { /* ignore */ }
        if (meta.modifiedFiles && meta.modifiedFiles.length > 0) continue;
        meta.modifiedFiles = modifiedFiles;
        if (readFiles && readFiles.length > 0) {
          meta.readFiles = [...new Set([...(meta.readFiles || []), ...readFiles])];
        }

        db.prepare('UPDATE observations SET summary = ?, metadata = ? WHERE id = ?')
          .run(updatedSummary, JSON.stringify(meta), row.id);
        process.stderr.write(`[ObservationTap] Patched observation ${row.id.slice(0,8)} with ${modifiedFiles.length} artifacts\n`);
      }
     } catch (err) {
       process.stderr.write(`[ObservationTap] Failed to patch observations: ${err.message}\n`);
     }
   }

   /**
    * One-time startup patch: fix ALL historical observations where metadata
    * contains modifiedFiles but summary says "Artifacts: none".
    * This handles backfilled observations and old entries the live patcher missed.
    */
   _patchHistoricalArtifacts() {
     if (!this.observationWriter?.db) return;
     try {
       const db = this.observationWriter.db;
       const rows = db.prepare(
         `SELECT id, summary, metadata FROM observations
          WHERE summary LIKE '%Artifacts: none%'
          AND metadata IS NOT NULL AND metadata != '{}'
          ORDER BY created_at DESC LIMIT 500`
       ).all();

       let patched = 0;
       for (const row of rows) {
         let meta = {};
         try { meta = JSON.parse(row.metadata || '{}'); } catch { continue; }
         if (!meta.modifiedFiles || meta.modifiedFiles.length === 0) continue;

         const artifactsList = meta.modifiedFiles.map(f => `edited ${f.split('/').pop()}`).join(', ');
         const updatedSummary = row.summary.replace(/Artifacts:\s*none/i, `Artifacts: ${artifactsList}`);
         if (updatedSummary === row.summary) continue;

         db.prepare('UPDATE observations SET summary = ? WHERE id = ?')
           .run(updatedSummary, row.id);
         patched++;
       }
       if (patched > 0) {
         process.stderr.write(`[ObservationTap] Startup: patched ${patched} historical observations with artifacts from metadata\n`);
       }
     } catch (err) {
       process.stderr.write(`[ObservationTap] Historical artifact patch failed: ${err.message}\n`);
     }
   }

   async initializeReliableCodingClassifier() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot;

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
    // Auto-detect: check BOTH copilot and Claude sources, use most recent
    const candidates = [];

    // Check copilot session-state
    const copilotTranscript = this.findCopilotTranscript();
    if (copilotTranscript) {
      try {
        const stats = fs.statSync(copilotTranscript);
        const timeDiff = Date.now() - stats.mtime.getTime();
        if (timeDiff < this.config.sessionDuration * 2) {
          candidates.push({ path: copilotTranscript, mtime: stats.mtime, source: 'copilot' });
        }
      } catch (e) { /* ignore */ }
    }

    // Check Claude JSONL
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = this.getProjectDirName();
    const projectDir = path.join(baseDir, projectName);
    
    if (fs.existsSync(projectDir)) {
      try {
        const files = fs.readdirSync(projectDir)
          .filter(file => file.endsWith('.jsonl'))
          .map(file => {
            const filePath = path.join(projectDir, file);
            const stats = fs.statSync(filePath);
            return { path: filePath, mtime: stats.mtime, size: stats.size, source: 'claude' };
          })
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0) {
          const mostRecent = files[0];
          const timeDiff = Date.now() - mostRecent.mtime.getTime();
          if (timeDiff < this.config.sessionDuration * 2) {
            candidates.push(mostRecent);
          }
        }
      } catch (error) {
        this.debug(`Error scanning Claude transcripts: ${error.message}`);
      }
    }

    // Check OpenCode SQLite
    const openCodeTranscript = this.findOpenCodeTranscript();
    if (openCodeTranscript) {
      const sessionId = this.getOpenCodeSessionId(openCodeTranscript);
      try {
        const query = `SELECT time_updated FROM session WHERE id = '${sessionId.replace(/'/g, "''")}';`;
        const result = _execSync(`sqlite3 "${this.openCodeDbPath}" "${query}"`, { encoding: 'utf-8', timeout: 3000 }).trim();
        const mtime = new Date(parseInt(result, 10));
        candidates.push({ path: openCodeTranscript, mtime, source: 'opencode' });
      } catch (e) {
        this.debug(`Error getting OpenCode session time: ${e.message}`);
      }
    }

    // Check Mastra transcript directory (.observations/transcripts/)
    const mastraTranscriptDir = this.findMastraTranscriptDir();
    if (mastraTranscriptDir) {
      try {
        const mastraFiles = fs.readdirSync(mastraTranscriptDir)
          .filter(f => f.endsWith('.jsonl') || f.endsWith('.ndjson'))
          .map(f => {
            const fp = path.join(mastraTranscriptDir, f);
            const stats = fs.statSync(fp);
            return { path: fp, mtime: stats.mtime, size: stats.size };
          })
          .filter(f => (Date.now() - f.mtime.getTime()) < this.config.sessionDuration * 2)
          .sort((a, b) => b.mtime - a.mtime);

        if (mastraFiles.length > 0) {
          candidates.push({ path: mastraFiles[0].path, mtime: mastraFiles[0].mtime, source: 'mastra' });
        }
      } catch (e) {
        this.debug(`Error scanning Mastra transcripts: ${e.message}`);
      }
    }

    if (candidates.length === 0) {
      this.debug('No active transcripts found (copilot, Claude, OpenCode, or Mastra)');
      return null;
    }

    // Use most recently modified source
    candidates.sort((a, b) => b.mtime - a.mtime);
    const winner = candidates[0];
    this.agentType = winner.source;
    this.debug(`Using ${winner.source} transcript: ${winner.path}`);
    return winner.path;
  }

  /**
   * Find the mastra transcript directory.
   * Mastra lifecycle hooks write NDJSON transcripts to .observations/transcripts/
   * relative to the project path.
   */
  findMastraTranscriptDir() {
    // Check if this is a mastra session (via env or agent adapter)
    const isMastraAgent = process.env.CODING_AGENT === 'mastra' ||
      process.env.AGENT_TRANSCRIPT_FMT === 'mastra' ||
      process.env.CODING_TRANSCRIPT_FORMAT === 'mastra';

    // Transcripts go to the target project's .observations/transcripts/
    const transcriptDir = path.join(this.config.projectPath, '.observations', 'transcripts');
    if (fs.existsSync(transcriptDir)) {
      return transcriptDir;
    }

    // Only create if explicitly a mastra session
    if (isMastraAgent) {
      return transcriptDir; // Will be created by MastraTranscriptReader.start()
    }

    return null;
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
                    // Not coding-related — skip LSL but still fire observation
                    this._firePromptSetObservation(this.currentUserPromptSet);
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
                    // Not coding-related — skip LSL but still fire observation
                    this._firePromptSetObservation(this.currentUserPromptSet);
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
            // Not coding-related — skip LSL but still fire observation
            this._firePromptSetObservation(this.currentUserPromptSet);
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
   * Get project path with strict validation - NO fallback to process.cwd()
   * This prevents LSL files from being written to wrong directories when scripts run from test installations
   */
  getProjectPath(config = {}) {
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const rootDir = process.env.CODING_REPO || path.join(__dirname, '..');

    // Check ONLY explicitly configured paths - NEVER use process.cwd()
    // Priority: 1) TRANSCRIPT_SOURCE_PROJECT env var, 2) config.projectPath, 3) CODING_REPO
    const checkPaths = [
      process.env.TRANSCRIPT_SOURCE_PROJECT, // Source project to monitor transcripts from (e.g., nano-degree)
      config.projectPath,                    // Explicitly configured project path (passed as parameter)
      rootDir                                // Coding repo
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

    // CRITICAL: Fail fast if no valid project found - DO NOT fall back to process.cwd()
    const errorMsg = `CRITICAL: No valid project path found with .specstory directory.\n` +
      `Checked paths: ${JSON.stringify(checkPaths)}\n` +
      `This prevents LSL files from being written to wrong directories.\n` +
      `Set TRANSCRIPT_SOURCE_PROJECT or ensure CODING_REPO points to a valid project.`;
    console.error(errorMsg);
    throw new Error('No valid project path found');
  }

  /**
   * Convert project path to Claude's directory naming
   */
  getProjectDirName() {
    // Claude Code encodes project paths by replacing both / and _ with -
    const normalized = this.config.projectPath.replace(/[/_]/g, '-');
    return normalized.startsWith('-') ? normalized : '-' + normalized;
  }

  /**
   * Find current Copilot CLI transcript (events.jsonl) by scanning session-state directories
   * Matches sessions whose cwd matches this monitor's project path
   */
  findCopilotTranscript() {
    const baseDir = path.join(os.homedir(), '.copilot', 'session-state');
    if (!fs.existsSync(baseDir)) {
      this.debug('Copilot session-state directory not found');
      return null;
    }

    try {
      const sessions = fs.readdirSync(baseDir)
        .map(dir => {
          const eventsPath = path.join(baseDir, dir, 'events.jsonl');
          if (!fs.existsSync(eventsPath)) return null;
          const stats = fs.statSync(eventsPath);
          return { dir, path: eventsPath, mtime: stats.mtime, size: stats.size };
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);

      // Find sessions matching this project path
      for (const session of sessions) {
        const timeDiff = Date.now() - session.mtime.getTime();
        if (timeDiff > this.config.sessionDuration * 2) continue;

        // Read first line to check session.start for cwd match
        try {
          const fd = fs.openSync(session.path, 'r');
          const buf = Buffer.alloc(2048);
          const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
          fs.closeSync(fd);
          const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0];
          const startEvent = JSON.parse(firstLine);
          if (startEvent.type === 'session.start' &&
              startEvent.data?.context?.cwd === this.config.projectPath) {
            this.debug(`Found copilot transcript: ${session.path}`);
            return session.path;
          }
        } catch { continue; }
      }

      this.debug('No matching copilot transcript found for project');
      return null;
    } catch (error) {
      this.debug(`Error finding copilot transcript: ${error.message}`);
      return null;
    }
  }

  /**
   * OpenCode SQLite database path
   */
  get openCodeDbPath() {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  /**
   * Check if a transcript path is a virtual OpenCode path
   */
  isOpenCodePath(transcriptPath) {
    return transcriptPath && transcriptPath.startsWith('opencode://');
  }

  /**
   * Check if the assistant has finished responding for a given transcript.
   * Uses agent-specific completion signals to avoid flushing mid-response.
   *
   * @param {string} transcriptPath - The transcript path (file path or virtual opencode:// path)
   * @param {string} agentType - Agent type: 'opencode', 'claude', 'copilot', 'mastra'
   * @param {Array} promptSet - Current prompt set exchanges (used for fallback heuristics)
   * @returns {{ complete: boolean, reason: string }}
   */
  isAssistantComplete(transcriptPath, agentType, promptSet) {
    // OpenCode: query SQLite for definitive finish signal
    if (this.isOpenCodePath(transcriptPath)) {
      const sessionId = this.getOpenCodeSessionId(transcriptPath);

      // Strategy: Check if a new user message has arrived AFTER the last exchange
      // in the prompt set. If so, the previous prompt set is definitionally complete
      // (the user moved on to a new prompt).
      const lastExchange = promptSet[promptSet.length - 1];
      const lastExchangeTs = lastExchange ? new Date(lastExchange.timestamp).getTime() : 0;
      const newUserMsg = this._hasNewUserMessageAfter(sessionId, lastExchangeTs);
      if (newUserMsg) {
        return { complete: true, reason: 'new user message arrived after prompt set' };
      }

      // No new user message — check if the latest assistant message for this
      // prompt set has a completion signal
      const state = this.getOpenCodeCompletionState(sessionId);

      if (!state.complete) {
        if (state.hasToolsPending) {
          return { complete: false, reason: 'tools still pending/running' };
        }
        if (state.finish === null) {
          return { complete: false, reason: 'assistant still generating (no finish signal)' };
        }
        return { complete: false, reason: 'completion state incomplete' };
      }

      // finish='stop' means the assistant delivered a final text response — prompt set is done
      if (state.finish === 'stop') {
        return { complete: true, reason: 'assistant finish=stop' };
      }

      // finish='tool-calls' with no pending tools — the tools completed
      if (state.finish === 'tool-calls' && !state.hasToolsPending) {
        return { complete: true, reason: 'assistant finish=tool-calls, all tools done' };
      }

      return { complete: false, reason: `finish=${state.finish}, tools pending=${state.hasToolsPending}` };
    }

    // Claude Code: check if the last exchange in the prompt set has a stop_reason
    if (agentType === 'claude') {
      const lastExchange = promptSet[promptSet.length - 1];
      if (lastExchange?.stopReason === 'end_turn' || lastExchange?.stopReason === 'stop') {
        return { complete: true, reason: `stop_reason=${lastExchange.stopReason}` };
      }
      // Claude transcripts append claude_turn_end when the turn is done.
      // If we have a non-empty assistant response, and the file hasn't grown in 10s,
      // it's likely complete (Claude doesn't have a reliable end_turn for text responses).
      if (lastExchange?.claudeResponse || lastExchange?.assistantMessage) {
        return { complete: true, reason: 'has assistant response (Claude structural)' };
      }
      return { complete: false, reason: 'no assistant response yet' };
    }

    // Copilot: assistant.message events are only emitted when the response is complete
    if (agentType === 'copilot') {
      const lastExchange = promptSet[promptSet.length - 1];
      if (lastExchange?.claudeResponse || lastExchange?.assistantMessage) {
        return { complete: true, reason: 'copilot assistant.message received' };
      }
      return { complete: false, reason: 'no copilot response yet' };
    }

    // Mastra: the Stop hook fires when the assistant finishes, so any assistant
    // message in the transcript means the response is complete
    if (agentType === 'mastra') {
      const lastExchange = promptSet[promptSet.length - 1];
      if (lastExchange?.claudeResponse || lastExchange?.assistantMessage) {
        return { complete: true, reason: 'mastra Stop hook fired' };
      }
      return { complete: false, reason: 'no mastra response yet' };
    }

    // Unknown agent — fall back to assuming complete (preserve existing behavior)
    return { complete: true, reason: 'unknown agent type, defaulting to complete' };
  }

  /**
   * Check if a new user message exists in the OpenCode DB after a given timestamp.
   * Used to determine if the user has moved on to a new prompt, which means the
   * previous prompt set is definitionally complete.
   *
   * @param {string} sessionId - OpenCode session ID
   * @param {number} afterTimestamp - Unix ms timestamp to check after
   * @returns {boolean}
   */
  _hasNewUserMessageAfter(sessionId, afterTimestamp) {
    const dbPath = this.openCodeDbPath;
    if (!fs.existsSync(dbPath)) return false;

    try {
      const execSync = _execSync;
      const escapedId = sessionId.replace(/'/g, "''");
      const query = `SELECT COUNT(*) FROM message WHERE session_id = '${escapedId}' AND json_extract(data, '$.role') = 'user' AND time_created > ${afterTimestamp};`;
      const result = execSync(`sqlite3 "${dbPath}" "${query}"`, {
        encoding: 'utf-8',
        timeout: 3000
      }).trim();
      return (parseInt(result, 10) || 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Extract session ID from virtual OpenCode path
   */
  getOpenCodeSessionId(transcriptPath) {
    return transcriptPath ? transcriptPath.replace('opencode://', '') : null;
  }

  /**
   * Find current OpenCode transcript by scanning SQLite for sessions matching this project path.
   * Returns a virtual path like "opencode://<session_id>" since there's no file to watch.
   */
  findOpenCodeTranscript() {
    const dbPath = this.openCodeDbPath;
    if (!fs.existsSync(dbPath)) {
      this.debug('OpenCode database not found');
      return null;
    }

    try {
      const execSync = _execSync;
      const projectPath = this.config.projectPath;

      // Resolve symlinks so we match regardless of which path alias was used
      const resolvedPath = fs.realpathSync(projectPath);
      const escapedPath = resolvedPath.replace(/'/g, "''");
      const escapedOrig = projectPath.replace(/'/g, "''");

      // Find sessions whose directory matches this project path (try both resolved and original), ordered by most recent
      const query = `SELECT s.id, s.directory, s.time_updated, s.title FROM session s WHERE s.directory = '${escapedPath}' OR s.directory = '${escapedOrig}' ORDER BY s.time_updated DESC LIMIT 1;`;
      const result = execSync(`sqlite3 "${dbPath}" "${query}"`, {
        encoding: 'utf-8',
        timeout: 5000
      }).trim();

      if (!result) {
        this.debug('No matching OpenCode session found for project');
        return null;
      }

      const [sessionId, directory, timeUpdated, title] = result.split('|');
      const sessionAge = Date.now() - parseInt(timeUpdated, 10);

      // Only consider sessions active within 2x session duration
      if (sessionAge > this.config.sessionDuration * 2) {
        this.debug(`OpenCode session too old: ${Math.round(sessionAge / 60000)}min (${title})`);
        return null;
      }

      this.openCodeSessionId = sessionId;
      this.debug(`Found OpenCode session: ${sessionId} (${title}, ${Math.round(sessionAge / 1000)}s ago)`);
      return `opencode://${sessionId}`;
    } catch (error) {
      this.debug(`Error finding OpenCode transcript: ${error.message}`);
      return null;
    }
  }

  /**
   * Read messages from OpenCode SQLite database for a given session.
   * Queries the message + part tables and converts to Claude-compatible format
   * that the existing extractExchanges pipeline can process.
   */
    readOpenCodeMessages(sessionId) {
    const dbPath = this.openCodeDbPath;
    if (!fs.existsSync(dbPath)) return [];

    try {
      // Use better-sqlite3 directly — no process spawn, no pipe buffer limits, no ETIMEDOUT
      let Database;
      try { 
        Database = require('better-sqlite3'); 
      } catch { 
        try {
          // Try absolute path if CWD-relative require fails
          Database = require('/Users/Q284340/Agentic/coding/node_modules/better-sqlite3');
        } catch {
          this.debug('better-sqlite3 not available, using sqlite3 CLI fallback');
          return this._readOpenCodeMessagesCli(sessionId);
        }
      }
      const db = Database(dbPath, { readonly: true });
      
      const query = `SELECT m.id, m.time_created, m.data as msg_data,
  (SELECT json_group_array(p.data) FROM part p WHERE p.message_id = m.id) as parts_json
FROM message m
WHERE m.id IN (
  SELECT id FROM (
    SELECT id FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 50
  )
  UNION
  SELECT id FROM (
    SELECT id FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created DESC LIMIT 10
  )
)
ORDER BY m.time_created ASC`;
      
      const rows = db.prepare(query).all(sessionId, sessionId);
      db.close();

      if (rows.length === 0) return [];

      const normalized = [];

      for (const row of rows) {
        const msgId = row.id;
        const timeCreated = row.time_created;
        let msgData;
        try {
          msgData = JSON.parse(row.msg_data);
        } catch { continue; }

        let parts = [];
        try {
          const partsArr = JSON.parse(row.parts_json || '[]');
          parts = partsArr.map(p => { try { return typeof p === 'string' ? JSON.parse(p) : p; } catch { return null; } }).filter(Boolean);
        } catch {}

        const timestamp = new Date(parseInt(timeCreated, 10)).toISOString();

        if (msgData.role === 'user') {
          // Find user text from parts
          const textParts = parts.filter(p => p.type === 'text');
          const userText = textParts.map(p => p.text || '').join('\n') || '';

          normalized.push({
            type: 'user',
            uuid: msgId,
            timestamp,
            message: {
              role: 'user',
              content: [{ type: 'text', text: userText }]
            }
          });
        } else if (msgData.role === 'assistant') {
          const content = [];

          for (const part of parts) {
            if (part.type === 'text' && part.text) {
              content.push({ type: 'text', text: part.text });
            } else if (part.type === 'tool' && part.tool && part.state) {
              // Tool invocation — map to tool_use
              content.push({
                type: 'tool_use',
                id: part.callID || part.tool,
                name: part.tool,
                input: part.state?.input || {}
              });

              // If tool has completed output, add as a separate tool_result message after this one
              if (part.state?.status === 'completed' && part.state?.output != null) {
                const resultContent = typeof part.state.output === 'string'
                  ? part.state.output
                  : JSON.stringify(part.state.output);
                // Queue tool result as a follow-up user message
                normalized.push({
                  type: 'assistant',
                  uuid: msgId,
                  timestamp,
                  message: { role: 'assistant', content: [...content], stop_reason: 'tool_use' }
                });
                content.length = 0; // Reset for next segment

                normalized.push({
                  type: 'user',
                  uuid: `${msgId}_tool_${part.callID || part.tool}`,
                  timestamp,
                  message: {
                    role: 'user',
                    content: [{
                      type: 'tool_result',
                      tool_use_id: part.callID || part.tool,
                      content: resultContent.substring(0, 50000), // Truncate very large outputs
                      is_error: part.state?.metadata?.exit > 0 || false
                    }]
                  }
                });
                continue; // Already pushed assistant message
              }
            }
            // Skip step-start, step-finish, reasoning, patch parts — they're metadata
          }

          if (content.length > 0) {
            normalized.push({
              type: 'assistant',
              uuid: msgId,
              timestamp,
              message: {
                role: 'assistant',
                content,
                stop_reason: msgData.finish ?? undefined
              }
            });
          }
        }
      }

      this.debug(`Read ${normalized.length} normalized messages from OpenCode session ${sessionId}`);
      return normalized;
    } catch (error) {
      this.debug(`Error reading OpenCode messages: ${error.message}`);
      return [];
    }
  }

  /**
   * CLI fallback for readOpenCodeMessages when better-sqlite3 is unavailable
   */
  _readOpenCodeMessagesCli(sessionId) {
    const dbPath = this.openCodeDbPath;
    // Use sqlite3 CLI with file redirect to avoid pipe buffer overflow
    const tmpDir = '/tmp/etm-opencode';
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const sqlFile = path.join(tmpDir, 'query.sql');
    const outFile = path.join(tmpDir, 'result.json');
    const query = `SELECT m.id, m.time_created, json_extract(m.data, '$.role') as role
FROM message m
WHERE m.id IN (
  SELECT id FROM (SELECT id FROM message WHERE session_id = '${sessionId}' ORDER BY time_created DESC LIMIT 50)
  UNION
  SELECT id FROM (SELECT id FROM message WHERE session_id = '${sessionId}' AND json_extract(data, '$.role') = 'user' ORDER BY time_created DESC LIMIT 10)
)
ORDER BY m.time_created ASC;`;
    fs.writeFileSync(sqlFile, `.mode json\n${query}`);
    try {
      _execSync(`sqlite3 "${dbPath}" < "${sqlFile}" > "${outFile}" 2>/dev/null`, { timeout: 15000 });
      const raw = fs.readFileSync(outFile, 'utf8').trim();
      if (!raw) return [];
      const rows = JSON.parse(raw);
      return rows.map(r => ({
        type: r.role === 'user' ? 'user' : 'assistant',
        uuid: r.id,
        timestamp: new Date(parseInt(r.time_created, 10)).toISOString(),
        message: { role: r.role || 'assistant', content: '' }
      }));
    } catch (e) {
      this.debug(`CLI fallback failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Get the current message count for an OpenCode session (used for change detection)
   */
   getOpenCodeMessageCount(sessionId) {
    const dbPath = this.openCodeDbPath;
    if (!fs.existsSync(dbPath)) return 0;

    try {
      let Database;
      try { Database = require('better-sqlite3'); } catch {
        // Fallback to execSync
        const result = _execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM message WHERE session_id = '${sessionId.replace(/'/g, "''")}';"`, {
          encoding: 'utf-8', timeout: 3000
        }).trim();
        return parseInt(result, 10) || 0;
      }
      const db = Database(dbPath, { readonly: true });
      const row = db.prepare('SELECT COUNT(*) as cnt FROM message WHERE session_id = ?').get(sessionId);
      db.close();
      return row ? row.cnt : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get the completion state of the latest assistant message in an OpenCode session.
   * Used to determine if the assistant is still generating before flushing prompt sets.
   *
   * @param {string} sessionId - OpenCode session ID
   * @returns {{ complete: boolean, finish: string|null, hasToolsPending: boolean }}
   *   - complete: true if the last assistant message has a finish signal
   *   - finish: 'stop' (text done), 'tool-calls' (intermediate), or null (still generating)
   *   - hasToolsPending: true if any tool parts are in pending/running state
   */
  getOpenCodeCompletionState(sessionId) {
    const dbPath = this.openCodeDbPath;
    if (!fs.existsSync(dbPath)) return { complete: true, finish: null, hasToolsPending: false };

    try {
      const execSync = _execSync;
      const escapedId = sessionId.replace(/'/g, "''");

      // Get the latest assistant message's finish state and completion timestamp
      const msgQuery = `SELECT json_extract(data, '$.finish') as finish, json_extract(data, '$.time.completed') as completed FROM message WHERE session_id = '${escapedId}' AND json_extract(data, '$.role') = 'assistant' ORDER BY time_created DESC LIMIT 1;`;
      const msgResult = execSync(`sqlite3 "${dbPath}" "${msgQuery}"`, {
        encoding: 'utf-8',
        timeout: 3000
      }).trim();

      if (!msgResult) return { complete: true, finish: null, hasToolsPending: false };

      const [finish, completed] = msgResult.split('|');
      const hasFinish = finish && finish !== '' && finish !== 'null';
      const hasCompleted = completed && completed !== '' && completed !== 'null';

      // Check for pending/running tool parts in this session's latest messages
      const toolQuery = `SELECT COUNT(*) FROM part WHERE session_id = '${escapedId}' AND json_extract(data, '$.type') = 'tool' AND (json_extract(data, '$.state.status') = 'pending' OR json_extract(data, '$.state.status') = 'running') AND message_id IN (SELECT id FROM message WHERE session_id = '${escapedId}' ORDER BY time_created DESC LIMIT 5);`;
      const toolResult = execSync(`sqlite3 "${dbPath}" "${toolQuery}"`, {
        encoding: 'utf-8',
        timeout: 3000
      }).trim();
      const pendingTools = parseInt(toolResult, 10) || 0;

      return {
        complete: hasFinish && hasCompleted && pendingTools === 0,
        finish: hasFinish ? finish : null,
        hasToolsPending: pendingTools > 0
      };
    } catch (error) {
      this.debug(`Error getting OpenCode completion state: ${error.message}`);
      return { complete: true, finish: null, hasToolsPending: false }; // fail-open
    }
  }

  /**
   * Normalize Copilot events.jsonl entries to Claude-compatible message format
   * so the existing extractExchanges pipeline can process them unchanged
   */
  normalizeCopilotMessages(messages) {
    const normalized = [];
    for (const event of messages) {
      if (!event.type) continue;
      switch (event.type) {
        case 'user.message':
          normalized.push({
            type: 'user',
            uuid: event.id,
            timestamp: event.timestamp,
            message: {
              role: 'user',
              content: [{ type: 'text', text: event.data?.content || '' }]
            }
          });
          break;
        case 'assistant.message': {
          const content = [];
          if (event.data?.content) {
            content.push({ type: 'text', text: event.data.content });
          }
          if (event.data?.toolRequests) {
            for (const tr of event.data.toolRequests) {
              content.push({
                type: 'tool_use',
                id: tr.toolCallId,
                name: tr.name,
                input: tr.arguments || {}
              });
            }
          }
          normalized.push({
            type: 'assistant',
            uuid: event.id || event.data?.messageId,
            timestamp: event.timestamp,
            message: {
              role: 'assistant',
              content,
              stop_reason: 'end_turn'
            }
          });
          break;
        }
        case 'tool.execution_complete': {
          if (event.data?.result) {
            const resultContent = typeof event.data.result === 'string'
              ? event.data.result
              : event.data.result.content || JSON.stringify(event.data.result);
            normalized.push({
              type: 'user',
              uuid: event.id,
              timestamp: event.timestamp,
              message: {
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: event.data.toolCallId,
                  content: resultContent,
                  is_error: event.data.success === false
                }]
              }
            });
          }
          break;
        }
        // session.start, assistant.turn_start/end, tool.execution_start, abort, etc. are skipped
      }
    }
    return normalized;
  }

  /**
   * Read and parse transcript messages
   */
  readTranscriptMessages(transcriptPath) {
    // Handle OpenCode virtual paths — read from SQLite instead of file
    if (this.isOpenCodePath(transcriptPath)) {
      const sessionId = this.getOpenCodeSessionId(transcriptPath);
      return this.readOpenCodeMessages(sessionId);
    }

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

      // If this is a copilot events.jsonl, normalize to Claude-compatible format
      const isCopilotTranscript = messages.length > 0 &&
        messages[0].type === 'session.start' &&
        messages[0].data?.producer === 'copilot-agent';
      if (isCopilotTranscript) {
        this.debug('Detected copilot events.jsonl — normalizing to Claude format');
        return this.normalizeCopilotMessages(messages);
      }

      // If this is a mastra NDJSON transcript, normalize to Claude-compatible format
      const isMastraTranscript = this.agentType === 'mastra' ||
        (messages.length > 0 && (
          messages[0].type === 'session_start' ||
          (messages[0].type === 'message' && messages.some(m => m.type === 'onStepFinish' || m.type === 'onToolCall'))
        ));
      if (isMastraTranscript) {
        this.debug('Detected mastra NDJSON transcript — normalizing to Claude format');
        return this.normalizeMastraMessages(messages);
      }

      return messages;
    } catch (error) {
      this.debug(`Error reading transcript: ${error.message}`);
      return [];
    }
  }

  /**
   * Normalize mastra lifecycle hook NDJSON events to Claude-compatible message format.
   * Maps mastra event types (message, onStepFinish, onToolCall, etc.) to the
   * user/assistant message format that the ETM exchange extraction pipeline expects.
   *
   * Per D-09: native mastra format is read by a dedicated normalizer.
   * Per D-11: agent identity captured in metadata, not filename.
   */
  normalizeMastraMessages(events) {
    const normalized = [];
    let messageIndex = 0;

    for (const event of events) {
      const ts = event.timestamp || new Date().toISOString();
      const uuid = event.id || event.sessionId || `mastra_${messageIndex++}`;

      switch (event.type) {
        case 'message': {
          if (event.role === 'user' && event.content) {
            normalized.push({
              type: 'user',
              uuid,
              timestamp: ts,
              message: {
                role: 'user',
                content: event.content
              },
              mastraAgent: true
            });
          } else if (event.role === 'assistant' && event.content) {
            normalized.push({
              type: 'assistant',
              uuid,
              timestamp: ts,
              message: {
                role: 'assistant',
                content: event.content,
                stop_reason: 'end_turn'
              },
              mastraAgent: true
            });
          }
          break;
        }
        case 'onStepFinish': {
          if (event.output) {
            const content = typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
            normalized.push({
              type: 'assistant',
              uuid,
              timestamp: ts,
              message: {
                role: 'assistant',
                content,
                stop_reason: 'end_turn'
              },
              mastraAgent: true
            });
          }
          break;
        }
        case 'onToolCall': {
          normalized.push({
            type: 'assistant',
            uuid,
            timestamp: ts,
            message: {
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: event.toolCallId || uuid,
                name: event.tool || event.name || 'unknown',
                input: event.input || {}
              }]
            },
            mastraAgent: true
          });
          break;
        }
        case 'onToolResult': {
          const resultContent = typeof event.output === 'string'
            ? event.output
            : JSON.stringify(event.output || {});
          normalized.push({
            type: 'user',
            uuid,
            timestamp: ts,
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: event.toolCallId || uuid,
                content: resultContent,
                is_error: event.is_error || false
              }]
            },
            mastraAgent: true
          });
          break;
        }
        // session_start and session_end are metadata-only; skip for exchange extraction
        case 'session_start':
        case 'session_end':
          break;
        default:
          // Unknown event with content — treat as assistant message
          if (event.content) {
            const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
            normalized.push({
              type: 'assistant',
              uuid,
              timestamp: ts,
              message: {
                role: 'assistant',
                content,
                stop_reason: 'end_turn'
              },
              mastraAgent: true
            });
          }
          break;
      }
    }

    return normalized;
  }

  /**
   * Extract conversation exchanges with user prompt detection
   */
  async extractExchanges(messages) {
    const exchanges = [];
    let currentExchange = null;
    let userMessageCount = 0;
    let filteredUserMessageCount = 0;

    // FIX: Handle continuation from mid-conversation (when first message isn't a user prompt)
    // This occurs when lastProcessedUuid points to a user prompt that was already written,
    // but subsequent assistant/tool_result messages still need to be captured.
    if (messages.length > 0) {
      const firstMessage = messages[0];
      const isFirstMessageUserPrompt = firstMessage.type === 'user' &&
        firstMessage.message?.role === 'user' &&
        !this.isToolResultMessage(firstMessage);

      if (!isFirstMessageUserPrompt) {
        // Create a continuation exchange to collect assistant responses and tool results
        // that belong to the previous (already-written) exchange
        currentExchange = {
          id: firstMessage.uuid || `continuation_${Date.now()}`, // Use REAL UUID for tracking
          timestamp: firstMessage.timestamp || new Date().toISOString(),
          userMessage: '', // No user message for continuation
          claudeResponse: '',
          toolCalls: [],
          toolResults: [],
          isUserPrompt: false,  // Mark as NOT a user prompt (continuation)
          isComplete: true,  // FIX: Continuation exchanges ARE complete - they contain accumulated content
          stopReason: 'continuation',
          isContinuation: true,  // Flag for special handling
          lastMessageUuid: firstMessage.uuid  // Track actual last message for accurate lastProcessedUuid
        };
        this.debug(`📎 Created continuation exchange for mid-conversation messages (id: ${currentExchange.id})`);
      }
    }

    for (const message of messages) {
      // Skip tool result messages - they are NOT user prompts
      if (message.type === 'user' && message.message?.role === 'user' && 
          !this.isToolResultMessage(message)) {
        // New user prompt - complete previous exchange and start new one
        if (currentExchange) {
          // FIX: Don't override isUserPrompt - preserve continuation exchanges as non-user-prompts
          // Previous: currentExchange.isUserPrompt = true; (WRONG - destroyed continuation flag)
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
          stopReason: null,    // NEW: Track stop reason
          lastMessageUuid: message.uuid  // Track actual last message for accurate lastProcessedUuid
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
        // Track the actual last message UUID for accurate resumption
        if (message.uuid) {
          currentExchange.lastMessageUuid = message.uuid;
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
        // Track the actual last message UUID for accurate resumption
        if (message.uuid && currentExchange) {
          currentExchange.lastMessageUuid = message.uuid;
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

    // Filter to unprocessed exchanges using the FULL exchange list (which correctly
    // splits on user prompts). An exchange is unprocessed if its lastMessageUuid
    // comes after lastProcessedUuid in the message stream.
    let unprocessed;

    if (!this.lastProcessedUuid) {
      unprocessed = exchanges.slice(-10);
    } else {
      // Find which message lastProcessedUuid corresponds to
      const lastProcessedMsgIndex = messages.findIndex(msg => msg.uuid === this.lastProcessedUuid);
      if (lastProcessedMsgIndex >= 0) {
        // Find exchanges that contain messages AFTER lastProcessedUuid.
        // An exchange is unprocessed if its lastMessageUuid is after lastProcessedMsgIndex.
        unprocessed = exchanges.filter(ex => {
          const exLastUuid = ex.lastMessageUuid || ex.id;
          const exMsgIndex = messages.findIndex(m => m.uuid === exLastUuid);
          return exMsgIndex > lastProcessedMsgIndex;
        });
        this.debug(`🔍 Found ${unprocessed.length} unprocessed exchanges (${unprocessed.filter(e => e.isUserPrompt).length} user prompts) after msg index ${lastProcessedMsgIndex}`);
      } else {
        // UUID not found in messages, fall back to last 10 exchanges
        this.debug(`⚠️ lastProcessedUuid not found in messages, using last 10 exchanges`);
        unprocessed = exchanges.slice(-10);
      }
    }

    return unprocessed;
  }

  /**
   * Determine target project using user's simplified logic:
   * (1) Read correct transcript file (always from current project via statusLine)
   * (2a) If running in coding -> write to coding LSL
   * (2b) If running outside coding -> check redirect status
   */
  async determineTargetProject(exchangeOrPromptSet) {
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot;

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

    // CRITICAL: Check if we're running from coding directory FIRST (applies to ALL modes)
    // This prevents _from-coding redirect files when already in the coding project
    const projectBasename = path.basename(this.config.projectPath);
    if (projectBasename === 'coding') {
      if (isSept14Debug) {
        console.log(`   ✅ ROUTING TO CODING PROJECT - running from coding directory (applies to all modes)`);
      }
      return this.config.projectPath;  // Use actual project path, not computed codingPath
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
    
    // Regular 'all' mode logic - running from outside coding
    // (coding directory case is handled above, before mode check)
    // Require majority of exchanges to be coding-related before redirecting
    // This prevents a single false positive from routing entire prompt sets away
    let codingCount = 0;
    let totalCount = 0;
    for (const exchange of exchanges) {
      totalCount++;
      if (await this.isCodingRelated(exchange)) {
        codingCount++;
      }
    }
    
    // Require >50% of exchanges to be coding-related for redirect
    // (single exchange prompt sets still work: 1/1 = 100%)
    if (codingCount > 0 && codingCount / totalCount > 0.5) {
      if (isSept14Debug) {
        console.log(`   ✅ ROUTING TO CODING PROJECT - ${codingCount}/${totalCount} exchanges are coding-related`);
      }
      return codingPath; // Redirect to coding
    }
    
    if (isSept14Debug) {
      console.log(`   ✅ STAYING IN LOCAL PROJECT - only ${codingCount}/${totalCount} exchanges are coding-related`);
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

        // Convert timestamp to numeric milliseconds for consistent prompt set IDs
        const timestamp = exchange.timestamp ? (typeof exchange.timestamp === 'number' ? exchange.timestamp : new Date(exchange.timestamp).getTime()) : Date.now();

        const decision = {
          promptSetId: exchange.uuid || `ps_${timestamp}`,
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

    // CRITICAL: Normalize paths before comparison to avoid false mismatches
    // (e.g., trailing slashes, symlinks, or different path resolutions)
    const resolvedTarget = path.resolve(targetProject);
    const resolvedProject = path.resolve(this.config.projectPath);

    if (resolvedTarget === resolvedProject) {
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
   * Get the active (current) session file path, splitting into a new part file
   * if the current one exceeds the configured max size.
   * Returns the path to the file that should be appended to.
   */
  getActiveSessionFilePath(targetProject, tranche) {
    const baseFile = this.getSessionFilePath(targetProject, tranche);
    
    // Read max file size from config (default 200KB)
    const maxSizeKB = this.config?.liveLogging?.max_lsl_file_size_kb
      || this.liveLoggingConfig?.max_lsl_file_size_kb
      || 200;
    const maxSizeBytes = maxSizeKB * 1024;

    // If base file doesn't exist or is under the limit, use it
    if (!fs.existsSync(baseFile)) return baseFile;
    const baseStats = fs.statSync(baseFile);
    if (baseStats.size < maxSizeBytes) return baseFile;

    // Base file is too large — find the highest existing part number
    const dir = path.dirname(baseFile);
    const baseName = path.basename(baseFile, '.md'); // e.g. 2026-04-17_1100-1200_c197ef
    // baseName may contain _from-<project> suffix; the part number sits between
    // the time window and the user hash: YYYY-MM-DD_HHMM-HHMM-N_hash[_from-proj]
    // We need to list existing part files and find the max N.
    
    const currentProjectName = path.basename(this.config.projectPath);
    const resolvedTarget = path.resolve(targetProject);
    const resolvedProject = path.resolve(this.config.projectPath);
    const isRedirected = resolvedTarget !== resolvedProject;
    const timestamp = tranche.originalTimestamp ||
      new Date(`${tranche.date}T${tranche.timeString.split('-')[0].slice(0,2)}:${tranche.timeString.split('-')[0].slice(2)}:00.000Z`).getTime();

    // Try increasing part numbers until we find one that doesn't exist or is under limit
    let partNumber = 1;
    while (true) {
      const partFilename = generateLSLFilename(
        timestamp, currentProjectName, targetProject,
        isRedirected ? this.config.projectPath : targetProject,
        { partNumber }
      );
      const partFile = path.join(dir, partFilename);
      
      if (!fs.existsSync(partFile)) {
        this.debug(`📂 Splitting LSL file: starting part ${partNumber} (${path.basename(baseFile)} exceeded ${maxSizeKB}KB)`);
        return partFile;
      }
      
      const partStats = fs.statSync(partFile);
      if (partStats.size < maxSizeBytes) {
        return partFile; // This part still has room
      }
      
      partNumber++;
      
      // Safety: don't create more than 99 parts per hour window
      if (partNumber > 99) {
        this.debug(`⚠️ LSL split limit reached (99 parts), appending to last part`);
        return partFile;
      }
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
  async createSessionFileWithContent(targetProject, tranche, initialContent, explicitFilePath = null) {
    const sessionFile = explicitFilePath || this.getSessionFilePath(targetProject, tranche);
    
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

      // CRITICAL FIX: Use session's actual timestamp from tranche, NOT current time!
      // This preserves historical accuracy when regenerating files
      const sessionTimestamp = new Date(tranche.originalTimestamp);
      const currentTime = new Date();

      // IMMUTABILITY PROTECTION: Warn if regenerating historical files
      const timeDiffHours = (currentTime - sessionTimestamp) / (1000 * 60 * 60);
      if (timeDiffHours > 1) {
        console.warn(`⚠️  REGENERATING HISTORICAL FILE: ${path.basename(sessionFile)}`);
        console.warn(`   Session time: ${sessionTimestamp.toISOString()}`);
        console.warn(`   Current time: ${currentTime.toISOString()}`);
        console.warn(`   Age: ${timeDiffHours.toFixed(1)} hours old`);
        console.warn(`   This should ONLY happen during intentional reprocessing!`);
        this.logHealthError(`Regenerated historical file: ${path.basename(sessionFile)} (${timeDiffHours.toFixed(1)}h old)`);
      }

      // Per D-11: Agent identity captured in LSL file header/metadata, not filename
      const agentDisplayName = this.agentType === 'mastra' ? 'Mastracode' :
        this.agentType === 'copilot' ? 'GitHub Copilot' :
        this.agentType === 'opencode' ? 'OpenCode' : 'Claude Code';
      const agentLine = `**Agent:** ${agentDisplayName}\n`;

      const sessionHeader = `# WORK SESSION (${tranche.timeString})${isRedirected ? ` - From ${currentProjectName}` : ''}\n\n` +
        `**Generated:** ${sessionTimestamp.toISOString()}\n` +
        `**Work Period:** ${tranche.timeString}\n` +
        agentLine +
        `**Focus:** ${isRedirected ? `Coding activities from ${currentProjectName}` : 'Live session logging'}\n` +
        `**Duration:** ~60 minutes\n` +
        `${isRedirected ? `**Source Project:** ${this.config.projectPath}\n` : ''}` +
        `\n---\n\n## Session Overview\n\n` +
        `This session captures ${isRedirected ? 'coding-related activities redirected from ' + currentProjectName : 'real-time tool interactions and exchanges'}.\n\n` +
        `---\n\n## Key Activities\n\n`;

        // TRACING: Log file creation with timestamp details
        console.log(`📝 Creating LSL file: ${path.basename(sessionFile)}`);
        console.log(`   Session timestamp: ${sessionTimestamp.toISOString()}`);
        console.log(`   Tranche: ${tranche.timeString} (${tranche.date})`);
        console.log(`   Redirected: ${isRedirected}`);

        // Write header + initial content in one operation
        fs.writeFileSync(sessionFile, sessionHeader + initialContent);

        // CRITICAL FIX: Set file modification time to session time (not current time)
        // This preserves historical accuracy in the filesystem timestamps
        fs.utimesSync(sessionFile, sessionTimestamp, sessionTimestamp);

        // CRITICAL FIX: Verify file was actually created with correct timestamps
        if (fs.existsSync(sessionFile)) {
          const stats = fs.statSync(sessionFile);
          console.log(`✅ File created successfully: ${path.basename(sessionFile)}`);
          console.log(`   File mtime: ${stats.mtime.toISOString()}`);
          console.log(`   Content "Generated" field: ${sessionTimestamp.toISOString()}`);

          // Verify timestamps match
          const mtimeDiff = Math.abs(stats.mtime.getTime() - sessionTimestamp.getTime());
          if (mtimeDiff > 1000) {  // Allow 1 second tolerance
            console.warn(`⚠️  WARNING: File mtime doesn't match session timestamp!`);
            console.warn(`   Expected: ${sessionTimestamp.toISOString()}`);
            console.warn(`   Actual:   ${stats.mtime.toISOString()}`);
            console.warn(`   Diff:     ${mtimeDiff}ms`);
          }

          // Add to file manager for size monitoring and rotation
          this.fileManager.watchFile(sessionFile, {
            projectPath: targetProject,
            tranche: tranche,
            isRedirected: isRedirected,
            startTime: sessionTimestamp  // Use session time, not current time
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
   * @param {Array} completedSet - Array of exchanges in this prompt set
   * @param {string} targetProject - Project to write to
   * @param {Object} tranche - Time window object
   * @param {string} promptSetId - Optional prompt set ID for anchors (generated if not provided)
   * @returns {boolean} true if set was written, false if held back due to incomplete exchanges
   */
  async processUserPromptSetCompletion(completedSet, targetProject, tranche, promptSetId = null) {
    if (completedSet.length === 0) return false;

    // Generate promptSetId if not provided (using first exchange timestamp as numeric milliseconds)
    if (!promptSetId) {
      const firstExchange = completedSet[0];
      const rawTimestamp = firstExchange.timestamp || Date.now();
      // Ensure timestamp is numeric milliseconds, not ISO string
      const timestamp = typeof rawTimestamp === 'number' ? rawTimestamp : new Date(rawTimestamp).getTime();
      promptSetId = `ps_${timestamp}`;
    }

    // REMOVED: isComplete check was broken because transcript doesn't reliably provide stop_reason
    // (only tool_use stop_reasons appear, not end_turn for text responses)
    // This method is only called when a NEW user prompt arrives, which means the previous
    // prompt set is definitionally complete. The "meaningful content" filter below handles
    // exchanges that haven't received responses yet.

    // Filter out exchanges with no meaningful content
    const meaningfulExchanges = completedSet.filter(exchange => {
      // Skip slash commands (like /sl)
      if (exchange.userMessage && this.isSlCommand(exchange.userMessage)) {
        return false;
      }

      // Skip warmup and goodbye messages (session lifecycle noise)
      const userMsg = (exchange.userMessage || '').trim().toLowerCase();
      if (userMsg === 'warmup') {
        this.debug('Filtering out warmup message');
        return false;
      }
      if (userMsg === 'goodbye' || userMsg === 'goodbye!' ||
          (exchange.userMessage || '').includes('<local-command-stdout>Goodbye!</local-command-stdout>')) {
        this.debug('Filtering out goodbye message');
        return false;
      }

      // Skip interrupted requests
      if (userMsg === '[request interrupted by user]') {
        this.debug('Filtering out interrupted request');
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

    // Use split-aware file path: automatically creates numbered parts when files exceed max size
    const sessionFile = this.getActiveSessionFilePath(targetProject, tranche);

    // Create session file with the actual content (no empty files)
    // Add prompt set anchor and header for classification log links
    let sessionContent = '';

    // Add prompt set anchor for linking from classification logs
    sessionContent += `<a name="${promptSetId}"></a>\n`;
    sessionContent += `## Prompt Set (${promptSetId})\n\n`;

    // Calculate prompt set metadata
    const firstExchange = meaningfulExchanges[0];
    const lastExchange = meaningfulExchanges[meaningfulExchanges.length - 1];
    const startTime = new Date(firstExchange.timestamp || Date.now());
    const endTime = new Date(lastExchange.timestamp || Date.now());
    const duration = endTime.getTime() - startTime.getTime();
    const toolCallCount = meaningfulExchanges.reduce((sum, ex) => sum + (ex.toolCalls?.length || 0), 0);

    sessionContent += `**Time:** ${startTime.toISOString()}\n`;
    sessionContent += `**Duration:** ${duration}ms\n`;
    sessionContent += `**Tool Calls:** ${toolCallCount}\n\n`;

    // Add all exchanges in this prompt set
    for (const exchange of meaningfulExchanges) {
      sessionContent += await this.formatExchangeForLogging(exchange, targetProject !== this.config.projectPath);
    }

    sessionContent += `---\n\n`;
    
    if (!fs.existsSync(sessionFile)) {
      // Create file with content immediately (may be a new split part)
      await this.createSessionFileWithContent(targetProject, tranche, sessionContent, sessionFile);
    } else {
      // Check if file needs rotation before appending (legacy archive rotation at 40MB)
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

    process.stderr.write(`[LSL] Completed user prompt set: ${meaningfulExchanges.length}/${completedSet.length} exchanges → ${path.basename(sessionFile)}\n`);

    // Git auto-track: stage LSL files in the project's own .specstory directory
    // Fire-and-forget: don't block the monitor on git operations
    if (sessionFile.includes('.specstory/history/') || sessionFile.includes('.specstory/logs/')) {
      const resolvedTarget = path.resolve(targetProject);
      const resolvedProject = path.resolve(this.config.projectPath);
      // Only git-add for the monitor's own project, not cross-project files
      if (resolvedTarget === resolvedProject) {
        try {
          const { exec } = await import('child_process');
          exec(`git add "${sessionFile}"`, { cwd: this.config.projectPath, timeout: 5000 }, (err) => {
            if (err) this.debug(`git add failed for ${path.basename(sessionFile)}: ${err.message}`);
            else this.debug(`git add OK: ${path.basename(sessionFile)}`);
          });
        } catch (e) {
          this.debug(`git auto-track error: ${e.message}`);
        }
      }
    }

    // Fire observation for the COMPLETED prompt set — the LLM sees ALL exchanges
    // (user prompt + every tool call + every assistant response) in one shot.
    this._firePromptSetObservation(meaningfulExchanges);

    // CRITICAL: Update lastProcessedUuid ONLY when prompt set is successfully written
    // This ensures incomplete exchanges are re-processed on subsequent cycles until
    // they have full content (assistant response + tool calls)
    // FIX: Use lastMessageUuid (actual last message) instead of id (user prompt)
    // This prevents re-processing of already-handled assistant/tool_result messages
    const writtenLastExchange = completedSet[completedSet.length - 1];
    const lastUuid = writtenLastExchange?.lastMessageUuid || writtenLastExchange?.id;
    if (lastUuid) {
      this.lastProcessedUuid = lastUuid;
      this.saveLastProcessedUuid();
      this.debug(`✅ Updated lastProcessedUuid to ${lastUuid} after successful write`);
    }

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
      // SECURITY: Redact user message
      content += `**User Request:** ${await redactSecrets(userMessageStr)}\n\n`;
    } else {
      // This is an automatic execution (hook, system-initiated, etc.)
      content += `**System Action:** (Initiated automatically)\n\n`;
    }

    content += `**Tool:** ${toolName}\n`;
    // SECURITY: Redact tool inputs (may contain API keys, passwords, etc.)
    content += `**Input:** \`\`\`json\n${await redactSecrets(JSON.stringify(toolArgs, null, 2))}\n\`\`\`\n\n`;

    const status = toolSuccess ? '✅ Success' : '❌ Error';
    content += `**Result:** ${status}\n`;

    // SECURITY: Redact tool outputs (may contain secrets in responses)
    if (result?.content) {
      const output = typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
      content += `**Output:** \`\`\`\n${await redactSecrets(output.slice(0, 500))}${output.length > 500 ? '\n...[truncated]' : ''}\n\`\`\`\n\n`;
    }

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
  async formatTextOnlyContent(exchange, exchangeTime, isRedirected) {
    let content = `### Text Exchange - ${exchangeTime}${isRedirected ? ' (Redirected)' : ''}\n\n`;

    const userMsg = exchange.userMessage || '';
    const assistantResp = exchange.assistantResponse || exchange.claudeResponse || '';

    // Ensure userMsg and assistantResp are strings
    const userMsgStr = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg);
    const assistantRespStr = typeof assistantResp === 'string' ? assistantResp : JSON.stringify(assistantResp);

    // Only show sections that have content
    if (userMsgStr && userMsgStr.trim()) {
      // SECURITY: Redact user messages (may contain API keys in examples, etc.)
      const truncated = userMsgStr.slice(0, 500);
      content += `**User Message:** ${await redactSecrets(truncated)}${userMsgStr.length > 500 ? '...' : ''}\n\n`;
    }

    if (assistantRespStr && assistantRespStr.trim()) {
      // SECURITY: Redact assistant responses (may echo back secrets from user)
      const truncated = assistantRespStr.slice(0, 500);
      content += `**Assistant Response:** ${await redactSecrets(truncated)}${assistantRespStr.length > 500 ? '...' : ''}\n\n`;
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
      codingRoot.toLowerCase() + '/',
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
      this.debug(`Tranche: ${currentTranche.timeString} for exchange at ${new Date(exchange.timestamp).toISOString()}`);
      
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

      // Observations now fire at prompt-set level in processUserPromptSetCompletion,
      // not per-exchange. This ensures the LLM sees ALL tool calls, edits, and outcomes
      // before generating the summary — not just the first exchange.

      if (exchange.isUserPrompt) {
        userPromptCount++;
        const userMessageText = typeof exchange.userMessage === 'string' ? exchange.userMessage : JSON.stringify(exchange.userMessage);
        console.log(`🔵 USER PROMPT ${userPromptCount}: ${userMessageText?.substring(0, 100)}...`);
        // New user prompt detected

        // CRITICAL FIX: Check if this is the SAME exchange we're already holding
        // (re-processed with updated content like tool calls)
        const isSameExchangeReprocessed = this.currentUserPromptSet.length > 0 &&
          this.currentUserPromptSet[0].id === exchange.id;

        if (isSameExchangeReprocessed) {
          // Same exchange re-processed with more content - UPDATE the exchange in the set
          // This allows tool calls to be added to an initially incomplete exchange
          this.debug(`🔄 Updating exchange ${exchange.id} in current prompt set (toolCalls: ${exchange.toolCalls?.length || 0})`);
          this.currentUserPromptSet[0] = exchange;
          // Don't complete or start new - just update and continue
        } else {
          // Different exchange - proceed with normal completion logic

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
                // Not coding-related — skip LSL writing but still fire observation
                this._firePromptSetObservation(this.currentUserPromptSet);
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
                // Not coding-related — skip LSL writing but still fire observation
                // Observations are about learning, not about LSL file routing
                this._firePromptSetObservation(this.currentUserPromptSet);
                this.currentUserPromptSet = [];
              }

              // Note: Redirect detection now handled by conversation-based analysis in status line
            }
          }

          // Start new user prompt set
          this.currentUserPromptSet = [exchange];
          this.lastUserPromptTime = exchange.timestamp;
        }
        
      } else {
        nonUserPromptCount++;
        // Add to current user prompt set
        if (this.currentUserPromptSet.length > 0) {
          this.currentUserPromptSet.push(exchange);
        } else if (exchange.isContinuation) {
          // FIX: Start a new prompt set for continuation exchanges
          // This handles the case where previous prompt set was written at hour boundary
          // but subsequent tool calls/responses need to be captured
          this.currentUserPromptSet = [exchange];
          this.debug(`📎 Started prompt set with continuation exchange`);
        }
      }

      // REMOVED: Don't update lastProcessedUuid here - it causes incomplete exchanges
      // to be skipped on subsequent cycles. lastProcessedUuid is now updated in
      // processUserPromptSetCompletion when the prompt set is successfully written.
      // this.lastProcessedUuid = exchange.id;  // DISABLED
      this.exchangeCount++;
    }

    // No per-exchange observation flush needed — observations fire at prompt-set level

    // REMOVED: Save moved to processUserPromptSetCompletion
    // this.saveLastProcessedUuid();  // DISABLED

    console.log(`📊 EXCHANGE SUMMARY: ${userPromptCount} user prompts, ${nonUserPromptCount} non-user prompts (total: ${exchanges.length})`);

    // Trigger knowledge extraction asynchronously (non-blocking)
    if (this.knowledgeExtractionEnabled && this.knowledgeExtractor && exchanges.length > 0) {
      this.extractKnowledgeAsync(exchanges).catch(err => {
        this.debug(`Knowledge extraction failed (non-critical): ${err.message}`);
        this.knowledgeExtractionStatus.errorCount++;
      });
    }

    // Time-based flush: if the prompt set has been accumulating for too long without
    // a user prompt (e.g., OpenCode stops persisting user messages after session grows),
    // flush it anyway so observations don't stop. This handles the case where user messages
    // are missing from the DB but the conversation is still active.
    if (this.currentUserPromptSet.length > 0) {
      const oldestExchange = this.currentUserPromptSet[0];
      const ageMs = Date.now() - (oldestExchange.timestamp ? new Date(oldestExchange.timestamp).getTime() : Date.now());
      const FLUSH_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes — flush if held for 3+ min
      
      if (ageMs > FLUSH_THRESHOLD_MS && this.currentUserPromptSet.length >= 1) {
        console.log(`⏰ Time-based flush: prompt set held for ${Math.round(ageMs / 1000)}s with ${this.currentUserPromptSet.length} exchanges — flushing (no user prompt detected)`);
        
        // Fire observation for the accumulated exchanges
        this._firePromptSetObservation(this.currentUserPromptSet);
        
        // Also write to LSL if possible
        try {
          const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
          if (targetProject !== null) {
            const setTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);
            await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, setTranche);
          }
        } catch (err) {
          this.debug(`Time-based flush LSL write failed (non-critical): ${err.message}`);
        }
        
        // Update lastProcessedUuid so next cycle doesn't re-read the same messages
        const lastExchange = this.currentUserPromptSet[this.currentUserPromptSet.length - 1];
        if (lastExchange && lastExchange.id) {
          this.lastProcessedUuid = lastExchange.id;
          this.saveLastProcessedUuid();
          this.debug(`📌 Updated lastProcessedUuid to ${lastExchange.id} after time-based flush`);
        }
        
        this.currentUserPromptSet = [];
      } else {
        this.debug(`⏳ Holding ${this.currentUserPromptSet.length} exchanges in prompt set (age: ${Math.round(ageMs / 1000)}s) - waiting for user prompt or flush threshold`);
      }
    }
  }

  // Removed redirect file methods - status line now uses conversation-based detection

  /**
   * Check if transcript has new content
   */
  hasNewContent() {
    if (!this.transcriptPath) return false;

    // OpenCode: poll message count instead of file size
    if (this.isOpenCodePath(this.transcriptPath)) {
      try {
        const sessionId = this.getOpenCodeSessionId(this.transcriptPath);
        const msgCount = this.getOpenCodeMessageCount(sessionId);
        const hasNew = msgCount !== this.lastFileSize; // Reuse lastFileSize to store message count
        this.lastFileSize = msgCount;
        if (hasNew) {
          this.lastActivityTime = Date.now();
        }
        return hasNew;
      } catch {
        return false;
      }
    }

    try {
      const stats = fs.statSync(this.transcriptPath);
      const hasNew = stats.size !== this.lastFileSize;
      this.lastFileSize = stats.size;

      // Update activity time when we see new content
      if (hasNew) {
        this.lastActivityTime = Date.now();
      }

      return hasNew;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start monitoring
   */
  async start() {
    if (!this.transcriptPath) {
      console.log('⚠️  No current transcript file found yet - will wait for Claude session to start.');
      console.log('   Monitor will pick up transcript automatically once Claude Code is running.');
    }

    // CRITICAL: Check for existing instances and register this service
    const projectPath = this.config.projectPath;
    const serviceName = 'enhanced-transcript-monitor';

    // Initialize PSM if not already done
    if (!this.processStateManager.initialized) {
      console.log('[PSM] Initializing...');
      await this.processStateManager.initialize();
      console.log('[PSM] Initialized');
    }

    // Clean up dead PIDs before checking for duplicates
    // This prevents stale registry entries from blocking new registrations
    console.log('[PSM] Cleaning up dead processes...');
    const cleanupStats = await this.processStateManager.cleanupDeadProcesses();
    if (cleanupStats.total > 0) {
      console.log(`🧹 Cleaned up ${cleanupStats.total} dead process(es) from registry`);
    }

    // Check if another instance is already running for this project
    const existingService = await this.processStateManager.getService(serviceName, 'per-project', { projectPath });
    if (existingService && this.processStateManager.isProcessAlive(existingService.pid)) {
      console.error(`❌ Another instance of ${serviceName} is already running for project ${path.basename(projectPath)}`);
      console.error(`   PID: ${existingService.pid}, Started: ${new Date(existingService.startTime).toISOString()}`);
      console.error(`   To fix: Kill the existing instance with: kill ${existingService.pid}`);
      process.exit(1);
    }

    // Register this service instance
    try {
      await this.processStateManager.registerService({
        name: serviceName,
        type: 'per-project',
        projectPath: projectPath,
        pid: process.pid,
        script: 'enhanced-transcript-monitor.js',
        metadata: {
          transcriptPath: this.transcriptPath,
          mode: this.config.mode
        }
      });
      this.serviceRegistered = true;
      console.log(`✅ Service registered (PID: ${process.pid})`);
    } catch (error) {
      console.error(`❌ Failed to register service: ${error.message}`);
      process.exit(1);
    }

    process.stderr.write(`[EnhancedTranscriptMonitor] Starting enhanced transcript monitor\n`);
    process.stderr.write(`[EnhancedTranscriptMonitor] Project: ${this.config.projectPath}\n`);
    process.stderr.write(`[EnhancedTranscriptMonitor] Primary transcript: ${this.transcriptPath ? path.basename(this.transcriptPath) : 'waiting for session...'}\n`);
    if (this.trackedTranscripts.size > 1) {
      process.stderr.write(`[EnhancedTranscriptMonitor] Multi-transcript mode: tracking ${this.trackedTranscripts.size} active transcripts\n`);
      for (const [tPath, tracker] of this.trackedTranscripts) {
        process.stderr.write(`[EnhancedTranscriptMonitor]   - ${path.basename(tPath)} (${tracker.agentType})\n`);
      }
    }
    process.stderr.write(`[EnhancedTranscriptMonitor] Check interval: ${this.config.checkInterval}ms\n`);
    const sessionDurationMins = Math.round(this.getSessionDurationMs() / 60000);
    console.log(`⏰ Session boundaries: Every ${sessionDurationMins} minutes`);

    // One-time startup: patch historical observations missing artifacts
    this._patchHistoricalArtifacts();

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

    // Artifact patcher counter — patch "Artifacts: none" entries every 5 minutes
    let artifactPatchCounter = 0;
    const ARTIFACT_PATCH_INTERVAL = 150; // Every 150 cycles (5 minutes at 2s intervals)

    this.intervalId = setInterval(async () => {
      if (this.isProcessing) return;

      // Periodically patch observations missing artifact info
      artifactPatchCounter++;
      if (artifactPatchCounter >= ARTIFACT_PATCH_INTERVAL) {
        artifactPatchCounter = 0;
        this._patchRecentObservationsWithArtifacts();
      }

      // Periodically finalize classification logger to generate MD summary reports
      finalizationCounter++;
      if (finalizationCounter >= FINALIZATION_INTERVAL) {
        finalizationCounter = 0;
        if (this.classificationLogger) {
          console.log('📊 Generating classification summary reports...');
          this.classificationLogger.finalize();
        }
      }

      // Periodically refresh tracked transcripts to detect new/closed sessions
      transcriptRefreshCounter++;
      if (transcriptRefreshCounter >= TRANSCRIPT_REFRESH_INTERVAL) {
        transcriptRefreshCounter = 0;
        this._refreshTrackedTranscripts();

        // Also update primary transcript (for health file reporting)
        const newTranscriptPath = this.findCurrentTranscript();
        if (newTranscriptPath && newTranscriptPath !== this.transcriptPath) {
          this.transcriptPath = newTranscriptPath;
          this.lastFileSize = 0;
          this.lastActivityTime = Date.now();
        }
      }

      // IDLE TIMEOUT CHECK: Auto-exit if no transcript activity for too long
      // This prevents orphaned monitors when Claude sessions are force-quit
      const idleTime = Date.now() - this.lastActivityTime;
      if (idleTime > this.idleTimeout) {
        // Before exiting, check if there's still an active session for this project.
        // Check both tmux (Claude CLI) and OpenCode sessions.
        let hasActiveSession = false;
        try {
          const { execSync } = await import('child_process');
          // Check tmux sessions (Claude CLI)
          try {
            const paneOutput = execSync('tmux list-panes -a -F "#{pane_current_path}" 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
            hasActiveSession = paneOutput.split('\n').some(p => p.trim() === this.config.projectPath);
          } catch { /* tmux not available */ }
          
           // Check OpenCode sessions — query the DB for recent messages
          if (!hasActiveSession && this.openCodeSessionId) {
            try {
              const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
              if (fs.existsSync(dbPath)) {
                let latestMs = 0;
                try {
                  const Database = require('better-sqlite3');
                  const db = Database(dbPath, { readonly: true });
                  const row = db.prepare('SELECT MAX(p.time_created) as latest FROM part p JOIN message m ON p.message_id = m.id WHERE m.session_id = ?').get(this.openCodeSessionId);
                  db.close();
                  latestMs = row && row.latest ? Number(row.latest) : 0;
                } catch {
                  const escapedId = this.openCodeSessionId.replace(/'/g, "''");
                  const result = _execSync(`sqlite3 "${dbPath}" "SELECT MAX(p.time_created) FROM part p JOIN message m ON p.message_id = m.id WHERE m.session_id = '${escapedId}';"`, {
                    encoding: 'utf-8', timeout: 3000
                  }).trim();
                  latestMs = Number(result) || new Date(result).getTime() || 0;
                }
                if (latestMs > 0) {
                  const ageMs = Date.now() - latestMs;
                  if (ageMs < this.idleTimeout) {
                    hasActiveSession = true;
                    this.lastActivityTime = Date.now();
                    this.debug(`⏰ OpenCode session still active (last message ${Math.round(ageMs/1000)}s ago)`);
                  }
                }
              }
            } catch (e) { this.debug(`OpenCode session check failed: ${e.message}`); }
          }
        } catch { /* checks failed — proceed with exit */ }

        if (hasActiveSession) {
          // Reset activity time to prevent checking every cycle
          this.lastActivityTime = Date.now();
          this.debug('⏰ Idle timeout reached but active session detected — staying alive');
        } else {
          const idleMinutes = Math.round(idleTime / 60000);
          process.stderr.write(`[EnhancedTranscriptMonitor] ${new Date().toISOString()} Idle timeout reached: no transcript activity for ${idleMinutes} minutes. Auto-exiting.\n`);

          // Graceful shutdown WITHOUT stop marker — PSM should be free to restart
          // this monitor when a new Claude session starts. Only user-initiated
          // stops (SIGINT/SIGTERM) should set the stop marker.
          if (this.intervalId) clearInterval(this.intervalId);
          if (this.healthIntervalId) clearInterval(this.healthIntervalId);
          await this.stop({ setStopMarker: false });
          process.exit(0);
        }
      }

      // Flush held prompt sets when they're stale or cross hour boundaries.
      // Without this, the last prompt set stays buffered indefinitely because
      // processExchanges only completes a set when the NEXT user prompt arrives.
      if (this.currentUserPromptSet.length > 0) {
        const currentTranche = this.getCurrentTimetranche();
        const setTranche = this.getCurrentTimetranche(this.currentUserPromptSet[0].timestamp);

        // Flush if: hour boundary crossed OR set has been held too long (> 10s)
        // OR set has been accumulating for > 5 minutes (long agent runs)
        const hourCrossed = currentTranche.timeString !== setTranche.timeString || currentTranche.date !== setTranche.date;
        const lastExchangeTs = this.currentUserPromptSet[this.currentUserPromptSet.length - 1].timestamp;
        const setAge = Date.now() - new Date(lastExchangeTs).getTime();
        const isStale = setAge > 10000; // 10 seconds without new exchanges in this set
        const firstExchangeTs = this.currentUserPromptSet[0].timestamp;
        const setDuration = Date.now() - new Date(firstExchangeTs).getTime();
        const isLongRunning = setDuration > 5 * 60 * 1000; // 5 minutes since first exchange

        if (hourCrossed || isStale || isLongRunning) {
          // Check agent-specific completion before flushing (unless hour boundary forces it)
          const completionState = this.isAssistantComplete(this.transcriptPath, this.agentType, this.currentUserPromptSet);
          const shouldFlush = hourCrossed || completionState.complete || isLongRunning;

          if (!shouldFlush) {
            this.debug(`⏳ Deferring held prompt set flush (${Math.round(setAge/1000)}s old): ${completionState.reason}`);
          } else {
            const reason = hourCrossed
              ? `hour boundary (${setTranche.timeString} → ${currentTranche.timeString})`
              : isLongRunning
                ? `long-running (${Math.round(setDuration/60000)}min, ${this.currentUserPromptSet.length} exchanges)`
                : `complete (${Math.round(setAge/1000)}s), ${completionState.reason}`;
            this.debug(`⏰ Flushing held prompt set: ${this.currentUserPromptSet.length} exchanges, reason: ${reason}`);
            const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
            if (targetProject !== null) {
              const wasWritten = await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, setTranche);
              if (wasWritten) {
                this.currentUserPromptSet = [];
                this.lastTranche = currentTranche;
              }
            } else {
              // Not coding-related — skip LSL but still fire observation
              this._firePromptSetObservation(this.currentUserPromptSet);
              this.currentUserPromptSet = [];
              this.lastTranche = currentTranche;
            }
          }
        }
      }

      // POLL LOOP DEBUG - trace which branch we take
      const _ttSize = this.trackedTranscripts.size;
      const _psLen = this.currentUserPromptSet.length;
      if (this._pollDebugCounter === undefined) this._pollDebugCounter = 0;
      if (++this._pollDebugCounter % 30 === 1) { // every 60s (30 * 2s)
        console.error(`[POLL] trackedTranscripts=${_ttSize} promptSet=${_psLen} isProcessing=${this.isProcessing} transcript=${this.transcriptPath ? 'yes' : 'no'}`);
      }

      // Multi-transcript processing: check ALL tracked transcripts for new content
      if (this.trackedTranscripts.size > 1) {
        this.isProcessing = true;
        try {
          await this._processAllTrackedTranscripts();
        } catch (error) {
          this.debug(`Error in multi-transcript loop: ${error.message}`);
          this.logHealthError(`Multi-transcript loop error: ${error.message}`);
        } finally {
          this.isProcessing = false;
        }
      } else {
        // Single-transcript fallback (original behavior)
        // Time-based flush MUST run even when hasNewContent() returns false
        // (handles OpenCode user-message persistence gap — assistant-only accumulation)
        if (this.currentUserPromptSet.length > 0) {
          const oldestExchange = this.currentUserPromptSet[0];
          const ageMs = Date.now() - (oldestExchange.timestamp ? new Date(oldestExchange.timestamp).getTime() : Date.now());
          const FLUSH_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
          if (ageMs > FLUSH_THRESHOLD_MS) {
            this.isProcessing = true;
            try {
              console.log(`⏰ Time-based flush (single-transcript): ${this.currentUserPromptSet.length} exchanges held for ${Math.round(ageMs / 1000)}s`);
              this._firePromptSetObservation(this.currentUserPromptSet);
              const lastExch = this.currentUserPromptSet[this.currentUserPromptSet.length - 1];
              if (lastExch && lastExch.id) {
                this.lastProcessedUuid = lastExch.id;
                this.saveLastProcessedUuid(this.lastProcessedUuid);
              }
              this.currentUserPromptSet = [];
            } catch (error) {
              this.debug(`Error in time-based flush: ${error.message}`);
            } finally {
              this.isProcessing = false;
            }
          }
        }

        if (!this.hasNewContent()) return;

        this.isProcessing = true;
        try {
          const exchanges = await this.getUnprocessedExchanges();
          console.log(`[ObsDebug-single] ${exchanges.length} exchanges, promptSet=${this.currentUserPromptSet.length}, lastUuid=${this.lastProcessedUuid?.slice(-8) || 'none'}`);
          if (exchanges.length > 0) {
            await this.processExchanges(exchanges);
            console.log(`[ObsDebug-single] After processExchanges: promptSet=${this.currentUserPromptSet.length}`);
          }
        } catch (error) {
          this.debug(`Error in monitoring loop: ${error.message}`);
          this.logHealthError(`Monitoring loop error: ${error.message}`);
        } finally {
          this.isProcessing = false;
        }
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

      // Don't set stop marker on signal-based shutdown (SIGINT/SIGTERM).
      // These happen when tmux sessions are killed, machine sleeps, Docker restarts, etc.
      // The coordinator should be free to restart the monitor for active sessions.
      // Only explicit user-initiated stops (coding --stop) should set the marker.
      await this.stop({ setStopMarker: false });
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Stop monitoring
   * @param {Object} [options]
   * @param {boolean} [options.setStopMarker=true] - Whether to set stop marker in PSM.
   *   Set to false for idle timeout exits so PSM can restart the monitor.
   *   Set to true for intentional stops (SIGINT/SIGTERM) to prevent restart loops.
   */
  async stop(options = {}) {
    const { setStopMarker = true } = options;
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

    // Mark project as intentionally stopped BEFORE unregistering (closes race window)
    // Skip stop marker for idle timeout exits — PSM should be free to restart
    if (this.serviceRegistered && setStopMarker) {
      try {
        await this.processStateManager.stopProject(this.config.projectPath, {
          reason: 'graceful_shutdown',
          stoppedBy: 'enhanced-transcript-monitor',
          pid: process.pid
        });
        this.debug('🛑 Project marked as intentionally stopped in PSM');
      } catch (error) {
        this.debug(`Failed to set stop marker: ${error.message}`);
      }
    } else if (!setStopMarker) {
      this.debug('⏰ Idle timeout exit — skipping stop marker so PSM can restart');
    }

    // Unregister service from Process State Manager
    if (this.serviceRegistered) {
      try {
        await this.processStateManager.unregisterService('enhanced-transcript-monitor', 'per-project', { projectPath: this.config.projectPath });
        this.serviceRegistered = false;
        this.debug('✅ Service unregistered from Process State Manager');
      } catch (error) {
        this.debug(`Failed to unregister service: ${error.message}`);
      }
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
   * Update health file on shutdown with 'stopped' status
   * Previously this deleted the file, but that caused health verifier to report
   * false errors when no Claude session was active for a project.
   * Now we keep the file but mark it as stopped.
   */
  cleanupHealthFile() {
    try {
      const stoppedHealth = {
        timestamp: Date.now(),
        projectPath: this.config.projectPath,
        transcriptPath: this.transcriptPath,
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
        reason: 'graceful_shutdown',
        metrics: {
          processId: process.pid,
          uptimeSeconds: Math.round(process.uptime()),
          finalExchangeCount: this.exchangeCount || 0
        }
      };
      fs.writeFileSync(this.config.healthFile, JSON.stringify(stoppedHealth, null, 2));
      this.debug('Health file updated with stopped status');
    } catch (error) {
      this.debug(`Failed to update health file on shutdown: ${error.message}`);
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
    
    // CRITICAL FIX: NEVER delete existing LSL files from CLOSED sessions!
    // LSL files are immutable historical records once the session window closes.
    // The "window closed --> don't touch" principle must be respected.
    //
    // PREVIOUS BUGGY BEHAVIOR (now disabled):
    // - Deleted ALL files matching patterns regardless of whether session was closed
    // - Changed timestamps on historical records (INVALID!)
    // - Violated immutability principle for completed sessions
    //
    // If you need to regenerate specific files, manually delete them first
    // (and ONLY if the session is still open/current).

    console.log('⚠️  SKIPPING deletion of existing LSL files - they are immutable historical records!');
    console.log('   LSL files from closed sessions must NEVER be modified or deleted.');
    console.log('   To regenerate specific files, manually delete them first (only if session still open).');

    /* DISABLED - DANGEROUS CODE THAT VIOLATED IMMUTABILITY:
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
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot;
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
    */
    
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
  // CRITICAL DEBUGGING: Log spawn source with full stack trace
  const spawnLogFile = join(codingRoot, '.logs', 'monitor-spawn-debug.log');
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      ppid: process.ppid,
      argv: process.argv,
      cwd: process.cwd(),
      env: {
        TRANSCRIPT_SOURCE_PROJECT: process.env.TRANSCRIPT_SOURCE_PROJECT,
        CODING_REPO: process.env.CODING_REPO,
        CODING_TOOLS_PATH: process.env.CODING_TOOLS_PATH,
        PROJECT_PATH: process.env.PROJECT_PATH
      },
      // Capture stack trace to see what called spawn()
      spawnStack: new Error('SPAWN TRACE').stack
    };

    fs.appendFileSync(spawnLogFile, '\n=== MONITOR SPAWN ===\n' + JSON.stringify(logEntry, null, 2) + '\n');
    console.error('🔍 SPAWN DEBUG: Logged to', spawnLogFile);
  } catch (logError) {
    console.error('Failed to log spawn debug:', logError.message);
  }

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
    // First non-flag argument is the project path (passed by start-services-robust.js)
    const projectPath = args.find(arg => !arg.startsWith('-') && !arg.startsWith('--'));
    const config = { debug: true };
    if (projectPath) {
      config.projectPath = projectPath;
    }
    const monitor = new EnhancedTranscriptMonitor(config);
    await monitor.start();

    // Watch for code changes and auto-restart (supervisor will restart us)
    enableAutoRestart({
      scriptUrl: import.meta.url,
      dependencies: [
        './process-state-manager.js',
        './timezone-utils.js',
        './classification-logger.js'
      ],
      cleanupFn: () => monitor.stop({ setStopMarker: false }),
      logger: (msg) => monitor.debug(msg)
    });
  } catch (error) {
    console.error('❌ Failed to start transcript monitor:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run if called directly
runIfMain(import.meta.url, () => {
  main().catch(console.error);
});

export default EnhancedTranscriptMonitor;