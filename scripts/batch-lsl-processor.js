#!/usr/bin/env node

/**
 * Consolidated Batch LSL Processor
 * 
 * Combines functionality from:
 * - post-session-logger.js (post-session processing)
 * - generate-lsl-from-transcripts.js (transcript generation)
 * - retroactive-lsl-regenerator.js (historical regeneration)
 * - recover-lsl-from-transcript.js (recovery from specific transcripts)
 * - rebuild-missing-lsl.js (missing file rebuilding)
 * 
 * Features:
 * - Batch-only mode (no local file writes, only foreign project files)
 * - Proper UTC vs timezone timestamp handling
 * - Time-windowed processing for large transcript sets
 * - Reliable classification with retry logic
 * - Stream-aware data format handling (fixed streaming issues)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import consolidated modules
import { getReliableClassifier } from './reliable-classifier.js';
import ClaudeConversationExtractor from './claude-conversation-extractor.js';
import { getTimeWindow, formatTimestamp, generateLSLFilename } from './timezone-utils.js';
import ClassificationLogger from './classification-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Consolidated Batch LSL Processor
 * Single source of truth for all batch LSL processing operations
 */
class BatchLSLProcessor {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.codingRepo = options.codingRepo || '/Users/q284340/Agentic/coding';
    this.batchMode = options.batchMode || false; // If true, only create foreign files
    this.timeWindow = options.timeWindow || null; // { start: Date, end: Date }
    this.retryAttempts = options.retryAttempts || 3;
    this.sessionDuration = options.sessionDuration || 3600000; // 1 hour in ms

    // Initialize components
    this.classifier = getReliableClassifier();
    this.extractor = new ClaudeConversationExtractor(this.projectPath);

    // Initialize classification logger for batch mode
    const projectName = path.basename(this.projectPath);
    this.classificationLogger = new ClassificationLogger({
      projectName: projectName,
      sessionId: `batch-${Date.now()}`
    });
    this.classificationLogger.initializeLogFile();
    
    // Performance tracking
    this.stats = {
      processed: 0,
      created: 0,
      skipped: 0,
      errors: 0,
      startTime: Date.now()
    };
  }

  /**
   * Main entry point for batch processing
   */
  async process(mode, ...args) {
    console.log(`🔄 Starting Batch LSL Processor in ${mode} mode...`);
    
    try {
      switch (mode) {
        case 'post-session':
          return await this.processPostSession();
        case 'from-transcripts':
          return await this.processFromTranscripts(args[0]);
        case 'retroactive':
          return await this.processRetroactive(args[0], args[1]);
        case 'recover':
          return await this.recoverFromTranscript(args[0]);
        case 'rebuild-missing':
          return await this.rebuildMissing(args[0]);
        case 'foreign-only':
          return await this.processForeignOnly(args[0]);
        default:
          throw new Error(`Unknown processing mode: ${mode}`);
      }
    } catch (error) {
      console.error(`❌ Batch processing failed:`, error.message);
      this.stats.errors++;
      throw error;
    } finally {
      this.printStats();

      // Finalize classification logging and generate summary report
      if (this.classificationLogger) {
        this.classificationLogger.finalize();
      }
    }
  }

  /**
   * Post-session processing (replaces post-session-logger.js)
   * Processes the most recent Claude session after it ends
   */
  async processPostSession() {
    console.log('📝 Processing post-session...');
    
    const transcriptFiles = await this.findRecentTranscripts(30); // 30 minutes
    if (transcriptFiles.length === 0) {
      console.log('⚠️  No recent transcript files found');
      return null;
    }

    const latestFile = transcriptFiles[0];
    console.log(`📖 Processing: ${path.basename(latestFile)}`);
    
    return await this.processTranscriptFile(latestFile);
  }

  /**
   * Generate LSL from transcript files (replaces generate-lsl-from-transcripts.js)
   * Processes transcript files in specified directory
   */
  async processFromTranscripts(transcriptDir) {
    console.log(`📁 Processing transcripts from: ${transcriptDir}`);
    
    const transcriptFiles = await this.findTranscriptFiles(transcriptDir);
    console.log(`Found ${transcriptFiles.length} transcript files`);

    const results = [];
    for (const file of transcriptFiles) {
      try {
        const result = await this.processTranscriptFile(file);
        results.push(result);
        this.stats.processed++;
      } catch (error) {
        console.error(`❌ Failed to process ${path.basename(file)}:`, error.message);
        this.stats.errors++;
      }
    }

    return results;
  }

  /**
   * Retroactive processing (replaces retroactive-lsl-regenerator.js)
   * Regenerates LSL files for specific time period
   */
  async processRetroactive(startDate, endDate) {
    console.log(`🔄 Retroactive processing: ${startDate} to ${endDate}`);
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start) || isNaN(end)) {
      throw new Error('Invalid date format. Use YYYY-MM-DD');
    }

    // Find transcripts in date range
    const transcriptFiles = await this.findTranscriptsInRange(start, end);
    console.log(`Found ${transcriptFiles.length} transcripts in date range`);

    // Process in time windows
    return await this.processInTimeWindows(transcriptFiles, start, end);
  }

  /**
   * Recover from specific transcript (replaces recover-lsl-from-transcript.js)
   * Recovers LSL files from a specific transcript file
   */
  async recoverFromTranscript(transcriptPath) {
    console.log(`🔧 Recovering from transcript: ${path.basename(transcriptPath)}`);
    
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    return await this.processTranscriptFile(transcriptPath);
  }

  /**
   * Rebuild missing LSL files (replaces rebuild-missing-lsl.js)
   * Identifies and rebuilds missing LSL files for a date range
   */
  async rebuildMissing(dateRange) {
    console.log(`🔨 Rebuilding missing LSL files for: ${dateRange}`);
    
    const [startDate, endDate] = dateRange.split(',');
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Find expected vs actual LSL files
    const expected = this.generateExpectedLSLFiles(start, end);
    const existing = await this.findExistingLSLFiles(start, end);
    const missing = expected.filter(exp => !existing.some(ex => ex.timeWindow === exp.timeWindow));

    console.log(`Expected: ${expected.length}, Existing: ${existing.length}, Missing: ${missing.length}`);

    // Rebuild missing files
    const results = [];
    for (const missingFile of missing) {
      try {
        const result = await this.rebuildLSLFile(missingFile);
        results.push(result);
        this.stats.created++;
      } catch (error) {
        console.error(`❌ Failed to rebuild ${missingFile.filename}:`, error.message);
        this.stats.errors++;
      }
    }

    return results;
  }

  /**
   * Foreign-only processing (NEW - solves batch mode issues)
   * Only creates files in foreign projects (e.g., coding from nano-degree)
   * Does NOT write local project files
   */
  async processForeignOnly(sourceProject) {
    console.log(`🌍 Foreign-only processing from: ${sourceProject}`);
    this.batchMode = true; // Enable batch-only mode
    this.debugMode = true; // Enable debug output for classification
    
    const transcriptFiles = await this.findTranscriptFiles(sourceProject);
    console.log(`Found ${transcriptFiles.length} transcripts in source project`);
    
    // Filter for Sept 13-14 files based on file modification date
    const sept13_14Files = transcriptFiles.filter(file => {
      try {
        const stats = fs.statSync(file);
        const fileDate = stats.mtime;
        const dateString = fileDate.toISOString().substring(0, 10); // YYYY-MM-DD
        const fileName = path.basename(file);
        
        if (fileName === 'e093980f-ac28-4a92-8677-687d7091930f.jsonl') {
          console.log(`🔍 Debug ${fileName}: ${dateString}`);
        }
        
        return dateString === '2025-09-13' || dateString === '2025-09-14';
      } catch (error) {
        return false;
      }
    });
    
    console.log(`🎯 Focusing on Sept 13-14 files: ${sept13_14Files.length} files`);

    const results = [];
    for (const file of sept13_14Files) {
      try {
        const result = await this.processTranscriptFile(file, true); // foreignOnly = true
        if (result && result.classification.isCoding) {
          results.push(result);
          this.stats.created++;
        } else {
          this.stats.skipped++;
        }
      } catch (error) {
        console.error(`❌ Foreign processing failed for ${path.basename(file)}:`, error.message);
        this.stats.errors++;
      }
    }

    return results;
  }

  /**
   * Core transcript file processing with streaming fix
   * Handles the streaming data format issues that broke batch mode
   */
  async processTranscriptFile(filePath, foreignOnly = false) {
    const filename = path.basename(filePath);
    console.log(`🔍 Processing: ${filename}`);

    try {
      // Read and parse the transcript file
      const content = fs.readFileSync(filePath, 'utf8');
      
      // CRITICAL FIX: Determine source project from transcript file path
      let sourceProject = 'unknown';
      if (filePath.includes('nano-degree')) {
        sourceProject = 'nano-degree';
      } else if (filePath.includes('coding')) {
        sourceProject = 'coding';
      } else {
        // Extract from path pattern: ~/.claude/projects/-Users-q284340-Agentic-PROJECT-NAME
        // Match everything after the last "Agentic-" until the next slash
        const pathMatch = filePath.match(/Agentic-([^\/]+)/);
        if (pathMatch) {
          sourceProject = pathMatch[1];
        } else {
          // Fallback: extract the project directory name from Claude projects folder
          const projectDirMatch = filePath.match(/\.claude\/projects\/[^\/]*-([^\/]+(?:-[^\/]+)*)/);
          if (projectDirMatch) {
            // Take everything after the first hyphen in the directory name
            const dirName = projectDirMatch[0].split('/').pop();
            // Remove leading hyphen and extract project name
            sourceProject = dirName.substring(1); // Remove leading hyphen
          }
        }
      }
      
      console.log(`📍 Source project: ${sourceProject}`);
      
      // Parse JSONL into entries
      let entries = [];
      if (content.includes('}{')) {
        // Multiple JSON objects concatenated
        const jsonObjects = content.split(/(?<=})\s*(?={)/);
        entries = jsonObjects.map(json => {
          try {
            return JSON.parse(json.trim());
          } catch (e) {
            return null;
          }
        }).filter(obj => obj !== null);
      } else {
        // Line-by-line JSONL format
        entries = content.split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          })
          .filter(obj => obj !== null);
      }
      
      if (entries.length === 0) {
        console.log(`⚠️  No valid entries found in: ${filename}`);
        return null;
      }
      
      // Parse into prompt sets (user interaction boundaries)
      const promptSets = this.parseIntoPromptSets(entries);
      console.log(`📦 Found ${promptSets.length} prompt sets in ${filename}`);
      
      // Group prompt sets by time window AND classification
      const timeWindowGroups = new Map(); // key: "YYYY-MM-DD_HHMM-HHMM_local|foreign"
      
      for (const promptSet of promptSets) {
        // Classify THIS prompt set individually
        const classification = await this.classifyPromptSet(promptSet);
        
        // Determine time window for this prompt set
        const timestamp = new Date(promptSet.startTime);
        const date = timestamp.toISOString().split('T')[0];
        const hour = timestamp.getUTCHours();
        const startHour = String(hour).padStart(2, '0') + '00';
        const endHour = String((hour + 1) % 24).padStart(2, '0') + '00';
        const timeWindow = `${date}_${startHour}-${endHour}`;
        
        // Determine if this goes to local or foreign file
        const fileType = classification.isCoding ? 'foreign' : 'local';
        const groupKey = `${timeWindow}_${fileType}`;
        
        if (!timeWindowGroups.has(groupKey)) {
          timeWindowGroups.set(groupKey, {
            timeWindow: timeWindow,
            fileType: fileType,
            promptSets: [],
            classification: classification, // Use first classification for metadata
            sourceProject: sourceProject // CRITICAL FIX: Pass source project
          });
        }
        
        // Add prompt set to appropriate group
        timeWindowGroups.get(groupKey).promptSets.push(promptSet);
      }
      
      console.log(`📊 Split into ${timeWindowGroups.size} file groups (by time window and classification)`);
      
      // Create files for each group
      const createdFiles = [];
      for (const [groupKey, group] of timeWindowGroups) {
        // Skip local files if in foreign-only mode
        if (foreignOnly && group.fileType === 'local') {
          console.log(`⏭️  Skipping local content in foreign-only mode: ${group.timeWindow}`);
          continue;
        }
        
        // Create appropriate file
        const file = await this.createPromptSetFile(group, foreignOnly);
        if (file) {
          createdFiles.push(file);
          this.stats.created++;
        }
      }
      
      console.log(`✅ Created ${createdFiles.length} files from ${promptSets.length} prompt sets`);
      
      return {
        sourceFile: filePath,
        lslFiles: createdFiles,
        promptSetCount: promptSets.length,
        fileCount: createdFiles.length
      };

    } catch (error) {
      console.error(`❌ Processing failed for ${filename}:`, error.message);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Extract conversation with streaming data format fix
   * This fixes the streaming issues that broke batch mode
   */
  async extractConversationWithRetry(filePath) {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        // Read raw file content
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Handle streaming JSON format (fix for batch mode)
        let parsedData;
        if (content.includes('}{')) {
          // Multiple JSON objects concatenated - split and parse
          const jsonObjects = content.split(/(?<=})\s*(?={)/);
          parsedData = jsonObjects.map(json => {
            try {
              return JSON.parse(json.trim());
            } catch (e) {
              return null;
            }
          }).filter(obj => obj !== null);
        } else {
          // Single JSON object
          try {
            parsedData = JSON.parse(content);
            if (!Array.isArray(parsedData)) {
              parsedData = [parsedData];
            }
          } catch (e) {
            // Try line-by-line parsing for JSONL format
            parsedData = content.split('\n')
              .filter(line => line.trim())
              .map(line => {
                try {
                  return JSON.parse(line);
                } catch (e) {
                  return null;
                }
              })
              .filter(obj => obj !== null);
          }
        }

        // Process parsed data directly into conversation format
        return this.processConversationData(parsedData);

      } catch (error) {
        console.log(`⚠️  Extraction attempt ${attempt} failed:`, error.message);
        if (attempt === this.retryAttempts) {
          throw error;
        }
        await this.delay(1000 * attempt); // Exponential backoff
      }
    }
  }

  /**
   * Process parsed JSONL data into conversation format
   * Converts raw parsed data to expected conversation object
   */
  /**
   * Check if a message is an /sl command that should be filtered out
   * /sl commands are context restoration commands that don't add value to LSL files
   * @param {string} content - The message content to check
   * @returns {boolean} True if this is an /sl command to filter out
   */
  isSlCommand(content) {
    if (!content || typeof content !== 'string') return false;
    
    // Check for /sl commands (with optional number and whitespace)
    const slPattern = /^\/sl\s*(\d+)?\s*$/i;
    const trimmedContent = content.trim();
    
    return slPattern.test(trimmedContent);
  }

  /**
   * Parse conversation into prompt sets (user interaction boundaries)
   * Each prompt set = user prompt + all assistant responses/tools until next user prompt
   * @param {Array} entries - Raw JSONL entries
   * @returns {Array} Array of prompt sets
   */
  parseIntoPromptSets(entries) {
    const promptSets = [];
    let currentSet = null;
    
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      
      const entryType = entry.type;
      const timestamp = entry.timestamp || entry.time || Date.now();
      const content = this.extractContentFromEntry(entry);
      
      // Check if this is a /sl command to filter out
      if (entryType === 'user' && this.isSlCommand(content)) {
        continue; // Skip /sl commands entirely
      }
      
      // Start new prompt set on user messages (not tool results)
      if (entryType === 'user' && !this.isToolResult(entry)) {
        // Save previous prompt set if exists
        if (currentSet && currentSet.exchanges.length > 0) {
          promptSets.push(currentSet);
        }
        
        // Start new prompt set
        currentSet = {
          id: `ps_${timestamp}`,
          startTime: timestamp,
          endTime: timestamp,
          exchanges: [{
            timestamp: timestamp,
            type: 'user',
            content: content,
            raw: entry
          }],
          hasUserMessage: true,
          hasAssistantResponse: false,
          toolCallCount: 0
        };
      }
      // Add to current prompt set
      else if (currentSet) {
        currentSet.exchanges.push({
          timestamp: timestamp,
          type: entryType,
          content: content,
          raw: entry
        });
        
        currentSet.endTime = timestamp;
        
        if (entryType === 'assistant') {
          currentSet.hasAssistantResponse = true;
          // Count tool calls
          if (entry.message && entry.message.content && Array.isArray(entry.message.content)) {
            const toolCalls = entry.message.content.filter(part => part.type === 'tool_use').length;
            currentSet.toolCallCount += toolCalls;
          }
        }
      }
    }
    
    // Don't forget the last prompt set
    if (currentSet && currentSet.exchanges.length > 0) {
      promptSets.push(currentSet);
    }
    
    return promptSets;
  }

  /**
   * Check if an entry is a tool result (not a new user prompt)
   */
  isToolResult(entry) {
    return entry.message && 
           entry.message.content && 
           Array.isArray(entry.message.content) && 
           entry.message.content.some(part => part.type === 'tool_result');
  }

  /**
   * Classify a single prompt set independently
   * This is the core of the new architecture - each prompt set gets its own classification
   */
  async classifyPromptSet(promptSet) {
    try {
      // Build classification input from prompt set exchanges
      const classificationInput = {
        exchanges: [],
        fileOperations: [],
        toolCalls: [],
        userMessage: '',
        assistantMessage: ''
      };
      
      let userContent = [];
      let assistantContent = [];
      
      for (const exchange of promptSet.exchanges) {
        if (exchange.type === 'user') {
          userContent.push(exchange.content);
        } else if (exchange.type === 'assistant') {
          assistantContent.push(exchange.content);
          
          // Extract tool calls from assistant messages
          if (exchange.raw.message && exchange.raw.message.content && Array.isArray(exchange.raw.message.content)) {
            for (const contentPart of exchange.raw.message.content) {
              if (contentPart.type === 'tool_use') {
                classificationInput.toolCalls.push({
                  name: contentPart.name,
                  input: contentPart.input,
                  result: '' // We don't have the result in this format
                });
                
                // Extract file operations from tool calls
                if (contentPart.name === 'Read' || contentPart.name === 'Write' || contentPart.name === 'Edit') {
                  if (contentPart.input && contentPart.input.file_path) {
                    classificationInput.fileOperations.push(contentPart.input.file_path);
                  }
                }
              }
            }
          }
        }
      }
      
      classificationInput.userMessage = userContent.join('\n');
      classificationInput.assistantMessage = assistantContent.join('\n');
      
      // Build exchanges in the format expected by classifier
      classificationInput.exchanges = [{
        userMessage: classificationInput.userMessage,
        assistantMessage: classificationInput.assistantMessage
      }];
      
      // Use the reliable classifier to classify this prompt set
      const classification = await this.classifier.classify(classificationInput, {
        threshold: 4 // Use moderate threshold for individual prompt set classification
      });

      console.log(`📋 Classified prompt set ${promptSet.id}: ${classification.isCoding ? 'CODING' : 'LOCAL'} (confidence: ${classification.confidence})`);

      // Log classification decision with full 4-layer trace
      if (this.classificationLogger && classification.decisionPath) {
        // Transform decisionPath to expected format
        const layerDecisions = classification.decisionPath.map(layer => ({
          layer: layer.layer,
          decision: layer.output.isCoding ? 'coding' : (layer.output.isCoding === false ? 'local' : 'inconclusive'),
          confidence: layer.output.confidence || 0,
          reasoning: layer.output.reason || layer.output.reasoning || 'No reason provided',
          processingTimeMs: layer.duration || 0
        }));

        const decision = {
          promptSetId: promptSet.id,
          timeRange: {
            start: promptSet.startTime,
            end: promptSet.endTime
          },
          lslFile: 'pending', // Will be updated when file is created
          lslLineRange: {
            start: 0,
            end: 0
          },
          classification: {
            isCoding: classification.isCoding,
            confidence: classification.confidence,
            finalLayer: classification.layer
          },
          layerDecisions: layerDecisions,
          sourceProject: path.basename(this.projectPath),
          targetFile: classification.isCoding ? 'foreign' : 'local'
        };

        this.classificationLogger.logDecision(decision);
      }

      return classification;
      
    } catch (error) {
      console.error(`❌ Classification failed for prompt set ${promptSet.id}:`, error.message);
      // Default to local/non-coding if classification fails
      return {
        isCoding: false,
        confidence: 0.01,
        reason: `Classification error: ${error.message}`,
        details: {}
      };
    }
  }

  /**
   * Create a file from grouped prompt sets (all same time window + classification)
   * This replaces the old conversation-level file creation with prompt-set-level grouping
   */
  async createPromptSetFile(group, foreignOnly = false) {
    try {
      const { timeWindow, fileType, promptSets, classification, sourceProject } = group;
      
      console.log(`📄 Creating ${fileType} file for ${timeWindow} with ${promptSets.length} prompt sets`);
      
      // Build markdown content from prompt sets
      let markdownContent = '';
      
      // Add header
      const firstPromptSet = promptSets[0];
      const lastPromptSet = promptSets[promptSets.length - 1];
      const startTime = new Date(firstPromptSet.startTime);
      const endTime = new Date(lastPromptSet.endTime);
      
      markdownContent += `# Claude Code Session Log\n\n`;
      markdownContent += `**Session:** ${timeWindow}\n`;
      markdownContent += `**Type:** ${fileType === 'foreign' ? 'Coding/Development' : 'Local Project'}\n`;
      markdownContent += `**Time Range:** ${startTime.toISOString()} - ${endTime.toISOString()}\n`;
      markdownContent += `**Prompt Sets:** ${promptSets.length}\n`;
      markdownContent += `**Classification:** ${classification.reason}\n\n`;
      markdownContent += `---\n\n`;
      
      // Add each prompt set as a section
      for (let i = 0; i < promptSets.length; i++) {
        const promptSet = promptSets[i];
        markdownContent += `## Prompt Set ${i + 1} (${promptSet.id})\n\n`;
        markdownContent += `**Time:** ${new Date(promptSet.startTime).toISOString()}\n`;
        markdownContent += `**Duration:** ${promptSet.endTime - promptSet.startTime}ms\n`;
        markdownContent += `**Tool Calls:** ${promptSet.toolCallCount}\n\n`;
        
        // Add all exchanges in this prompt set
        for (const exchange of promptSet.exchanges) {
          if (exchange.type === 'user') {
            markdownContent += `### User\n\n${exchange.content}\n\n`;
          } else if (exchange.type === 'assistant') {
            markdownContent += `### Assistant\n\n${exchange.content}\n\n`;
          }
        }
        
        markdownContent += `---\n\n`;
      }
      
      // Use original generateLSLFilename function from timezone-utils.js
      const timestamp = startTime;
      const projectName = sourceProject;
      const targetProject = fileType === 'foreign' ? 'coding' : sourceProject;
      const actualSourceProject = sourceProject;
      
      const filename = generateLSLFilename(timestamp, projectName, targetProject, actualSourceProject);
      
      // Determine target directory
      let targetDir;
      if (fileType === 'foreign') {
        // Foreign files go to coding repo
        targetDir = path.join(this.codingRepo, '.specstory', 'history');
      } else {
        // Local files go to project directory
        targetDir = path.join(this.projectPath, '.specstory', 'history');
      }
      
      // Ensure target directory exists
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      const filePath = path.join(targetDir, filename);
      
      // Write the file
      fs.writeFileSync(filePath, markdownContent);
      
      console.log(`✅ Created ${fileType} file: ${filename} (${markdownContent.length} chars)`);
      
      return {
        path: filePath,
        filename: filename,
        type: fileType,
        timeWindow: timeWindow,
        promptSetCount: promptSets.length,
        size: markdownContent.length
      };
      
    } catch (error) {
      console.error(`❌ File creation failed for ${group.timeWindow}:`, error.message);
      return null;
    }
  }

  processConversationData(parsedData) {
    const exchanges = [];
    let startTime = null;
    let endTime = null;
    
    // Handle both array of objects and single object
    const entries = Array.isArray(parsedData) ? parsedData : [parsedData];
    
    // Group entries into logical conversation exchanges
    let currentExchange = null;
    
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      
      // Extract timestamp
      const timestamp = entry.timestamp || entry.time || Date.now();
      if (!startTime || timestamp < startTime) startTime = timestamp;
      if (!endTime || timestamp > endTime) endTime = timestamp;
      
      const entryType = entry.type;
      const content = this.extractContentFromEntry(entry);
      
      // Start new exchange on user messages
      if (entryType === 'user') {
        // Filter out /sl commands - they're context restoration and don't add value
        if (this.isSlCommand(content)) {
          console.log(`Filtering out /sl command: ${content.trim()}`);
          continue; // Skip this entry entirely
        }
        
        // Finish previous exchange if it exists
        if (currentExchange) {
          exchanges.push(currentExchange);
        }
        
        // Start new exchange
        currentExchange = {
          timestamp: timestamp,
          type: 'user',
          content: content,
          hasUserMessage: true,
          hasAssistantResponse: false,
          toolCallCount: 0,
          source: 'Direct',
          assistantContent: []
        };
      } 
      // Add assistant responses to current exchange
      else if (entryType === 'assistant' && currentExchange) {
        currentExchange.hasAssistantResponse = true;
        currentExchange.assistantContent.push(content);
        
        // Count tool calls
        if (entry.message && entry.message.content && Array.isArray(entry.message.content)) {
          const toolCalls = entry.message.content.filter(part => part.type === 'tool_use').length;
          currentExchange.toolCallCount += toolCalls;
        }
      }
      // Add tool results to current exchange (from user)
      else if (entryType === 'user' && entry.message && entry.message.content && 
               Array.isArray(entry.message.content) && 
               entry.message.content.some(part => part.type === 'tool_result')) {
        if (currentExchange) {
          currentExchange.assistantContent.push(`[Tool Result: ${content}]`);
        }
      }
      // Handle system messages
      else if (entryType === 'system') {
        if (currentExchange) {
          currentExchange.assistantContent.push(`[System: ${content}]`);
        }
      }
      // Fallback for standalone entries
      else if (!currentExchange) {
        exchanges.push({
          timestamp: timestamp,
          type: entryType || 'unknown',
          content: content,
          hasUserMessage: entryType === 'user',
          hasAssistantResponse: entryType === 'assistant',
          toolCallCount: 0,
          source: 'Direct'
        });
      }
    }
    
    // Don't forget the last exchange
    if (currentExchange) {
      // Combine assistant content
      if (currentExchange.assistantContent.length > 0) {
        currentExchange.content += '\n\n**Assistant Response:**\n' + currentExchange.assistantContent.join('\n\n');
      }
      exchanges.push(currentExchange);
    }
    
    return {
      exchanges: exchanges,
      startTime: startTime,
      endTime: endTime,
      totalExchanges: exchanges.length
    };
  }
  
  /**
   * Extract content from JSONL entry
   */
  extractContentFromEntry(entry) {
    if (entry.message && entry.message.content) {
      if (typeof entry.message.content === 'string') {
        return entry.message.content;
      } else if (Array.isArray(entry.message.content)) {
        return entry.message.content.map(part => {
          if (part.type === 'text') {
            return part.text;
          } else if (part.type === 'tool_use') {
            // Show actual tool call details
            const params = part.input ? JSON.stringify(part.input, null, 2) : '{}';
            return `**Tool:** ${part.name}\n**Input:** \`\`\`json\n${params}\n\`\`\``;
          } else if (part.type === 'tool_result') {
            // Show actual tool result
            let resultContent = '';
            if (part.content) {
              if (Array.isArray(part.content)) {
                resultContent = part.content.map(c => c.text || c.content || JSON.stringify(c)).join('\n');
              } else if (typeof part.content === 'string') {
                resultContent = part.content;
              } else {
                resultContent = JSON.stringify(part.content, null, 2);
              }
            } else if (part.result) {
              resultContent = typeof part.result === 'string' ? part.result : JSON.stringify(part.result, null, 2);
            } else {
              resultContent = 'No result content';
            }
            
            // Determine result status
            const isError = part.is_error || (part.content && part.content.some && part.content.some(c => c.type === 'error'));
            const status = isError ? '❌ Error' : '✅ Success';
            
            return `**Result:** ${status}\n\n${resultContent}`;
          }
          return '';
        }).join('\n\n');
      }
    }
    
    return entry.content || entry.text || JSON.stringify(entry, null, 2);
  }

  /**
   * Classify conversation with retry logic
   */
  async classifyWithRetry(conversation, options = {}) {
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await this.classifier.classify(conversation, options);
      } catch (error) {
        console.log(`⚠️  Classification attempt ${attempt} failed:`, error.message);
        if (attempt === this.retryAttempts) {
          throw error;
        }
        await this.delay(2000 * attempt); // Exponential backoff
      }
    }
  }

  /**
   * Create LSL file with proper time windowing and UTC handling
   */
  /**
   * Create LSL file with proper time windowing and UTC handling
   */
  /**
   * Create multiple LSL files split by time windows
   * @param {Object} conversation - Full conversation data
   * @param {Object} classification - Classification results
   * @param {boolean} foreignOnly - Whether this is foreign-only mode
   * @returns {Array} Array of created LSL files
   */
  async createLSLFilesByTimeWindow(conversation, classification, foreignOnly = false) {
    const files = [];
    
    if (!conversation.exchanges || conversation.exchanges.length === 0) {
      return files;
    }
    
    // Group exchanges by hourly time windows
    const timeWindows = new Map();
    
    for (const exchange of conversation.exchanges) {
      const timestamp = new Date(exchange.timestamp || Date.now());
      
      // Get hour window (e.g., "2025-09-13_0800-0900")
      const date = timestamp.toISOString().split('T')[0];
      const hour = timestamp.getUTCHours();
      const startHour = String(hour).padStart(2, '0') + '00';
      const endHour = String((hour + 1) % 24).padStart(2, '0') + '00';
      const windowKey = `${date}_${startHour}-${endHour}`;
      
      if (!timeWindows.has(windowKey)) {
        timeWindows.set(windowKey, []);
      }
      timeWindows.get(windowKey).push(exchange);
    }
    
    console.log(`📊 Split into ${timeWindows.size} time windows`);
    
    // Create a file for each time window
    for (const [windowKey, exchanges] of timeWindows) {
      if (exchanges.length === 0) continue;
      
      // Create a conversation object for this time window
      const windowConversation = {
        exchanges: exchanges,
        startTime: exchanges[0].timestamp,
        endTime: exchanges[exchanges.length - 1].timestamp,
        totalExchanges: exchanges.length
      };
      
      // Store timestamp for filename generation
      this.currentConversationTimestamp = windowConversation.startTime;
      
      try {
        const lslFile = await this.createLSLFile(windowConversation, classification, foreignOnly);
        if (lslFile) {
          files.push(lslFile);
        }
      } catch (error) {
        console.error(`❌ Failed to create file for window ${windowKey}:`, error.message);
      }
    }
    
    return files;
  }

  async createLSLFile(conversation, classification, foreignOnly = false) {
    // CRITICAL FIX: Store original timestamp for filename generation
    this.currentConversationTimestamp = conversation.startTime || 
      (conversation.exchanges && conversation.exchanges.length > 0 ? conversation.exchanges[0].timestamp : null);
    
    // Handle missing or invalid startTime
    let timestamp;
    if (conversation.startTime) {
      timestamp = new Date(conversation.startTime);
    } else if (conversation.exchanges && conversation.exchanges.length > 0) {
      // Use first exchange timestamp as fallback
      timestamp = new Date(conversation.exchanges[0].timestamp || Date.now());
    } else {
      // Use current time as last resort
      timestamp = new Date();
    }
    
    // Validate timestamp
    if (isNaN(timestamp.getTime())) {
      timestamp = new Date();
    }
    
    const timeWindow = getTimeWindow(timestamp);
    
    // Determine target directory
    let targetDir;
    if (foreignOnly && classification.isCoding) {
      // Foreign mode: create in coding project
      targetDir = path.join(this.codingRepo, '.specstory/history');
    } else if (this.batchMode) {
      // Batch mode: skip local files
      return null;
    } else {
      // Normal mode: create in current project
      targetDir = path.join(this.projectPath, '.specstory/history');
    }

    // Ensure directory exists
    fs.mkdirSync(targetDir, { recursive: true });

    // Use original generateLSLFilename function from timezone-utils.js
    const projectName = this.projectPath.split('/').pop();
    const targetProject = foreignOnly && classification.isCoding ? 'coding' : projectName;
    const sourceProject = projectName;
    const filename = generateLSLFilename(timestamp, projectName, targetProject, sourceProject);
    const filePath = path.join(targetDir, filename);

    // Generate LSL content
    const content = this.generateLSLContent(conversation, classification, timeWindow, foreignOnly);

    // Write file
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Created: ${filename}`);

    return {
      path: filePath,
      filename: filename,
      timeWindow: timeWindow
    };
  }


  /**
   * Generate LSL content with proper metadata
   */
  generateLSLContent(conversation, classification, timeWindow, foreignOnly = false) {
    const source = foreignOnly ? 'nano-degree' : 'local';
    
    return `# WORK SESSION (${this.formatTimeRange(timeWindow)})${foreignOnly ? ' - From nano-degree' : ''}

**Generated:** ${new Date().toISOString()}
**Work Period:** ${this.formatTimeRange(timeWindow)}
**Focus:** ${classification.isCoding ? 'Coding activities' : 'General activities'}${foreignOnly ? ' from nano-degree' : ''}
**Duration:** ~${Math.round(this.sessionDuration / 60000)} minutes
${foreignOnly ? `**Source Project:** ${this.projectPath}` : ''}

---

## Session Overview

This session captures ${foreignOnly ? 'coding-related activities redirected from nano-degree' : 'real-time tool interactions and exchanges'}.

---

## Key Activities

${this.formatExchanges(conversation.exchanges)}

---

## Session Metadata

**Timestamp:** ${this.formatTimeRange(timeWindow)}
**Classification:** ${classification.result}
${foreignOnly ? `**Original Project Path:** ${this.projectPath}` : ''}
${foreignOnly ? `**Coding Repository:** ${this.codingRepo}` : ''}
**Created:** ${new Date().toISOString()}
`;
  }

  /**
   * Format exchanges for LSL content
   */
  formatExchanges(exchanges) {
    return exchanges.map((exchange, index) => {
      // Handle various timestamp formats
      let timestamp;
      if (exchange.timestamp) {
        timestamp = new Date(exchange.timestamp);
      } else {
        timestamp = new Date();
      }
      
      // Validate timestamp
      if (isNaN(timestamp.getTime())) {
        timestamp = new Date();
      }
      
      const timeStr = timestamp.toISOString();
      
      let content = `### ${exchange.type} - ${timeStr} (${exchange.source || 'Direct'})

`;

      // Display the actual conversation content
      if (exchange.content && exchange.content.trim()) {
        // Truncate very long content for readability
        let displayContent = exchange.content;
        if (displayContent.length > 2000) {
          displayContent = displayContent.substring(0, 2000) + '\n\n*[Content truncated for readability]*';
        }
        content += `${displayContent}

`;
      }

      content += `**Type:** ${exchange.hasUserMessage && exchange.hasAssistantResponse ? 'Full exchange' : 'Partial exchange'} (${exchange.toolCallCount} tool calls)

---

`;

      return content;
    }).join('');
  }

  /**
   * Utility functions
   */
  formatTimeRange(timeWindow) {
    // Handle string timeWindow (like "1000-1100")
    if (typeof timeWindow === 'string') {
      return timeWindow;
    }
    // Handle object timeWindow with start/end dates
    if (timeWindow.start && timeWindow.end) {
      const start = timeWindow.start.toTimeString().substr(0, 5).replace(':', '');
      const end = timeWindow.end.toTimeString().substr(0, 5).replace(':', '');
      return `${start}-${end}`;
    }
    // Fallback
    return 'unknown-unknown';
  }

  async findRecentTranscripts(minutes) {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const claudeDir = path.join(process.env.HOME, '.claude/projects');
    
    const files = [];
    const dirs = fs.readdirSync(claudeDir);
    
    for (const dir of dirs) {
      const dirPath = path.join(claudeDir, dir);
      if (fs.statSync(dirPath).isDirectory()) {
        const transcripts = fs.readdirSync(dirPath)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => path.join(dirPath, f))
          .filter(f => fs.statSync(f).mtime.getTime() > cutoff);
        files.push(...transcripts);
      }
    }
    
    return files.sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
  }

  async findTranscriptFiles(directory) {
    const files = [];
    const entries = fs.readdirSync(directory);
    
    for (const entry of entries) {
      const fullPath = path.join(directory, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        files.push(...await this.findTranscriptFiles(fullPath));
      } else if (entry.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  async findTranscriptsInRange(start, end) {
    const files = await this.findRecentTranscripts(Infinity);
    return files.filter(file => {
      const stat = fs.statSync(file);
      return stat.mtime >= start && stat.mtime <= end;
    });
  }

  generateExpectedLSLFiles(start, end) {
    const files = [];
    const current = new Date(start);
    
    while (current <= end) {
      const timeWindow = getTimeWindow(current);
      const projectName = this.projectPath.split('/').pop();
      files.push({
        timeWindow: timeWindow,
        filename: generateLSLFilename(current, projectName, projectName, projectName)
      });
      current.setTime(current.getTime() + this.sessionDuration);
    }
    
    return files;
  }

  async findExistingLSLFiles(start, end) {
    const historyDir = path.join(this.projectPath, '.specstory/history');
    if (!fs.existsSync(historyDir)) {
      return [];
    }
    
    const files = fs.readdirSync(historyDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(historyDir, f))
      .filter(f => {
        const stat = fs.statSync(f);
        return stat.mtime >= start && stat.mtime <= end;
      });
    
    return files.map(f => ({
      path: f,
      filename: path.basename(f),
      timeWindow: this.parseTimeWindowFromFilename(path.basename(f))
    }));
  }

  async rebuildLSLFile(missingFile) {
    console.log(`🔨 Rebuilding: ${missingFile.filename}`);
    
    // Find transcript files for the time window
    const transcripts = await this.findTranscriptsForTimeWindow(missingFile.timeWindow);
    if (transcripts.length === 0) {
      throw new Error(`No transcripts found for time window: ${missingFile.filename}`);
    }

    // Process the most relevant transcript
    return await this.processTranscriptFile(transcripts[0]);
  }

  async findTranscriptsForTimeWindow(timeWindow) {
    const files = await this.findRecentTranscripts(Infinity);
    return files.filter(file => {
      const stat = fs.statSync(file);
      return stat.mtime >= timeWindow.start && stat.mtime <= timeWindow.end;
    });
  }

  parseTimeWindowFromFilename(filename) {
    const match = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{4})-(\d{4})/);
    if (!match) return null;
    
    const [, date, startTime, endTime] = match;
    const startHour = parseInt(startTime.substr(0, 2));
    const startMin = parseInt(startTime.substr(2, 2));
    const endHour = parseInt(endTime.substr(0, 2));
    const endMin = parseInt(endTime.substr(2, 2));
    
    const start = new Date(date);
    start.setHours(startHour, startMin, 0, 0);
    
    const end = new Date(date);
    end.setHours(endHour, endMin, 0, 0);
    
    return { start, end };
  }

  async processInTimeWindows(transcriptFiles, start, end) {
    const windows = this.generateTimeWindows(start, end);
    const results = [];
    
    for (const window of windows) {
      const windowFiles = transcriptFiles.filter(file => {
        const stat = fs.statSync(file);
        return stat.mtime >= window.start && stat.mtime <= window.end;
      });
      
      if (windowFiles.length > 0) {
        console.log(`⏰ Processing window ${this.formatTimeRange(window)} (${windowFiles.length} files)`);
        
        for (const file of windowFiles) {
          try {
            const result = await this.processTranscriptFile(file);
            results.push(result);
            this.stats.processed++;
          } catch (error) {
            console.error(`❌ Failed in window ${this.formatTimeRange(window)}:`, error.message);
            this.stats.errors++;
          }
        }
      }
    }
    
    return results;
  }

  generateTimeWindows(start, end) {
    const windows = [];
    const current = new Date(start);
    
    while (current < end) {
      const windowStart = new Date(current);
      const windowEnd = new Date(current.getTime() + this.sessionDuration);
      
      windows.push({
        start: windowStart,
        end: windowEnd > end ? end : windowEnd
      });
      
      current.setTime(current.getTime() + this.sessionDuration);
    }
    
    return windows;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  printStats() {
    const duration = Date.now() - this.stats.startTime;
    console.log(`
📊 Batch Processing Stats:
   Processed: ${this.stats.processed}
   Created: ${this.stats.created}
   Skipped: ${this.stats.skipped}
   Errors: ${this.stats.errors}
   Duration: ${Math.round(duration / 1000)}s
`);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: batch-lsl-processor.js <mode> [args...]

Modes:
  post-session                    - Process most recent session
  from-transcripts <dir>          - Process transcripts from directory  
  retroactive <start> <end>       - Regenerate for date range (YYYY-MM-DD)
  recover <transcript-path>       - Recover from specific transcript
  rebuild-missing <date-range>    - Rebuild missing files (start,end)
  foreign-only <source-project>   - Only create foreign project files

Examples:
  batch-lsl-processor.js post-session
  batch-lsl-processor.js from-transcripts ~/.claude/projects/my-project
  batch-lsl-processor.js retroactive 2025-09-13 2025-09-14
  batch-lsl-processor.js foreign-only /Users/q284340/Agentic/nano-degree
`);
    process.exit(1);
  }

  const mode = args[0];
  const options = {
    projectPath: process.env.PROJECT_PATH || process.cwd(),
    codingRepo: process.env.CODING_REPO || '/Users/q284340/Agentic/coding',
    sessionDuration: parseInt(process.env.SESSION_DURATION) || 3600000,
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS) || 3
  };

  const processor = new BatchLSLProcessor(options);
  
  try {
    const result = await processor.process(mode, ...args.slice(1));
    
    if (result) {
      console.log(`✅ Batch processing completed successfully`);
      if (Array.isArray(result)) {
        console.log(`📁 Generated ${result.length} LSL files`);
      }
    } else {
      console.log(`⚠️  No results generated`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error(`❌ Batch processing failed:`, error.message);
    process.exit(1);
  }
}

// Export for testing
export default BatchLSLProcessor;

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}