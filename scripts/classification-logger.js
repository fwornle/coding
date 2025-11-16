#!/usr/bin/env node

/**
 * Classification Decision Logger
 *
 * Comprehensive logging system for tracking classification decisions across all 4 layers:
 * - Layer 1: PathAnalyzer (file operations)
 * - Layer 2: KeywordMatcher (keyword analysis)
 * - Layer 3: EmbeddingClassifier (vector similarity)
 * - Layer 4: SemanticAnalyzer (LLM-based)
 *
 * For each prompt set, logs:
 * - Time range in LSL file where prompt set is defined
 * - Final file destination (local vs foreign/coding)
 * - Layer-by-layer decision trace with reasoning
 * - Performance metrics for each layer
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTimeWindow, utcToLocalTime, generateLSLFilename } from './timezone-utils.js';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ClassificationLogger {
  constructor(options = {}) {
    // CRITICAL FIX: Always use absolute paths from projectPath, never process.cwd()
    const projectPath = options.projectPath ? path.resolve(options.projectPath) : null;
    const codingRepo = options.codingRepo ? path.resolve(options.codingRepo) : path.resolve('/Users/q284340/Agentic/coding');

    // Determine logDir from projectPath if provided, otherwise use explicit logDir or fall back to coding repo
    if (options.logDir) {
      this.logDir = path.resolve(options.logDir);
    } else if (projectPath) {
      this.logDir = path.join(projectPath, '.specstory', 'logs', 'classification');
    } else {
      // Fallback to coding repo (should rarely happen)
      this.logDir = path.join(codingRepo, '.specstory', 'logs', 'classification');
    }

    this.projectName = options.projectName || 'unknown';
    this.sessionId = options.sessionId || `session-${Date.now()}`;
    this.codingRepo = codingRepo;

    // userHash is REQUIRED - throw error if not provided
    if (!options.userHash) {
      throw new Error('ClassificationLogger requires userHash parameter - use UserHashGenerator.generateHash()');
    }
    this.userHash = options.userHash;

    this.decisions = [];
    this.windowedLogs = new Map(); // Track logs by time window
    this.finalizedWindows = new Set(); // Track which windows are finalized
    this.decisionCountByWindow = new Map(); // Track decision count per window

    // Ensure log directory exists
    fs.mkdirSync(this.logDir, { recursive: true });

    // CRITICAL FIX: Initialize lastFinalizedDecisionCount from disk state
    // to prevent regenerating status files on restart when no new decisions exist
    const existingDecisions = this.readAllDecisionsFromDisk();
    this.lastFinalizedDecisionCount = existingDecisions.length;

    // Initialize window tracking from existing markdown files
    this.initializeWindowTracking();
  }

  /**
   * Initialize window tracking from existing markdown files on disk
   * This prevents regenerating already-finalized windows
   */
  initializeWindowTracking() {
    try {
      // Read local markdown files
      const localFiles = fs.readdirSync(this.logDir)
        .filter(f => f.endsWith('.md') && !f.includes('_from-'));

      for (const file of localFiles) {
        const windowName = file.replace('.md', '');

        // Count decisions in this window from JSONL files
        const decisionCount = this.countDecisionsInWindow(windowName);

        if (decisionCount > 0) {
          this.finalizedWindows.add(windowName);
          this.decisionCountByWindow.set(windowName, decisionCount);
        }
      }

      // Read coding markdown files (from-<project> postfix)
      const codingLogDir = path.join(this.codingRepo, '.specstory', 'logs', 'classification');
      if (fs.existsSync(codingLogDir)) {
        const codingFiles = fs.readdirSync(codingLogDir)
          .filter(f => f.endsWith(`_from-${this.projectName}.md`));

        for (const file of codingFiles) {
          const windowName = file.replace(`_from-${this.projectName}.md`, '');

          // Count decisions in this window from JSONL files
          const decisionCount = this.countDecisionsInWindow(windowName);

          if (decisionCount > 0) {
            this.finalizedWindows.add(windowName);
            this.decisionCountByWindow.set(windowName, decisionCount);
          }
        }
      }

      console.log(`📊 Initialized tracking for ${this.finalizedWindows.size} existing windows`);
    } catch (error) {
      console.warn(`⚠️ Error initializing window tracking: ${error.message}`);
    }
  }

  /**
   * Count decisions in a specific window from JSONL files
   */
  countDecisionsInWindow(windowName) {
    const jsonlFile = path.join(this.logDir, `${windowName}.jsonl`);

    if (!fs.existsSync(jsonlFile)) {
      return 0;
    }

    try {
      const content = fs.readFileSync(jsonlFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());

      let count = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'classification_decision') {
            count++;
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }

      return count;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get or create log file for a specific time window
   * Aligns with LSL file windows (e.g., 2025-10-05_1400-1500)
   */
  getLogFileForWindow(timestamp) {
    const localDate = utcToLocalTime(timestamp);
    const window = getTimeWindow(localDate);
    
    // Format: YYYY-MM-DD_HHMM-HHMM_<userhash> (matching LSL file format exactly)
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    const datePrefix = `${year}-${month}-${day}`;

    const fullWindow = `${datePrefix}_${window}_${this.userHash}`;

    if (!this.windowedLogs.has(fullWindow)) {
      const filename = `${fullWindow}.jsonl`;
      const logFile = path.join(this.logDir, filename);

      // Initialize new window log file
      if (!fs.existsSync(logFile)) {
        const header = {
          type: 'session_start',
          timestamp: timestamp, // Use the window's timestamp, not current time
          projectName: this.projectName,
          timeWindow: fullWindow,
          logVersion: '1.0.0'
        };
        fs.writeFileSync(logFile, JSON.stringify(header) + '\n', 'utf8');

        // CRITICAL FIX: Set file modification time to window timestamp
        const windowDate = new Date(timestamp);
        fs.utimesSync(logFile, windowDate, windowDate);

        console.log(`📊 Created JSONL log: ${path.basename(logFile)}`);
        console.log(`   Window timestamp: ${windowDate.toISOString()}`);
      }

      this.windowedLogs.set(fullWindow, logFile);
    }

    return this.windowedLogs.get(fullWindow);
  }

  /**
   * Initialize logging (for backward compatibility)
   */
  initializeLogFile() {
    // No-op for window-based logging
    // Log files are created on-demand per time window
    console.log(`📝 Classification logs will be organized by time windows in: ${this.logDir}`);
    return this.logDir;
  }

  /**
   * Log a classification decision for a single prompt set
   *
   * @param {Object} decision - Classification decision details
   *   - promptSetId: Unique identifier for prompt set
   *   - timeRange: { start: ISO timestamp, end: ISO timestamp }
   *   - lslFile: Path to LSL file where content is logged
   *   - lslLineRange: { start: line number, end: line number }
   *   - classification: { isCoding: bool, confidence: number, finalLayer: string }
   *   - layerDecisions: Array of layer-by-layer decisions
   *   - sourceProject: Name of source project
   *   - targetFile: 'local' or 'foreign'
   */
  logDecision(decision) {
    // Use the prompt timestamp (not current time) to match the time window
    const promptTimestamp = decision.timeRange?.start || new Date().toISOString();

    const logEntry = {
      type: 'classification_decision',
      timestamp: promptTimestamp, // Changed: use prompt time instead of new Date()
      sessionId: this.sessionId,
      ...decision
    };

    // Store in memory
    this.decisions.push(logEntry);

    // Determine which time window this decision belongs to
    const logFile = this.getLogFileForWindow(promptTimestamp);

    // Append to appropriate windowed log file
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n', 'utf8');

    return logEntry;
  }

  /**
   * Log layer-specific decision details
   *
   * @param {Object} layerInfo
   *   - layer: 'path' | 'keyword' | 'embedding' | 'semantic'
   *   - input: What was analyzed
   *   - output: Classification result
   *   - reasoning: Why this decision was made
   *   - confidence: Confidence score (0-1)
   *   - processingTimeMs: How long this layer took
   *   - decision: 'coding' | 'local' | 'inconclusive'
   */
  logLayerDecision(promptSetId, layerInfo) {
    const logEntry = {
      type: 'layer_decision',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      promptSetId: promptSetId,
      ...layerInfo
    };

    if (this.logFile) {
      fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n', 'utf8');
    }

    return logEntry;
  }

  /**
   * Extract the original "Generated" timestamp from an existing classification file
   */
  extractExistingTimestamp(filePath) {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/\*\*Generated\*\*:\s*([^\s<]+)/);
      return match ? match[1] : null;
    } catch (error) {
      console.error(`Error reading existing timestamp from ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Parse window timestamp from fullWindow string
   * Format: YYYY-MM-DD_HHMM-HHMM_userhash
   * Returns: Date object representing the start of the time window
   */
  parseWindowTimestamp(fullWindow) {
    // Extract date and start time: "2025-11-04_1400-1500_g9b30a" -> "2025-11-04" + "1400"
    const match = fullWindow.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})-\d{4}/);

    if (!match) {
      console.warn(`⚠️  Failed to parse window timestamp from: ${fullWindow}`);
      return new Date();  // Fallback to current time
    }

    const [, date, startTime] = match;
    const hour = startTime.substring(0, 2);
    const minute = startTime.substring(2, 4);

    // Construct ISO timestamp for the window start
    const isoString = `${date}T${hour}:${minute}:00.000Z`;
    return new Date(isoString);
  }

  /**
   * Generate human-readable summary reports (one per time window)
   */
  generateSummaryReport() {
    const summaryFiles = [];

    // Group decisions by time window
    const decisionsByWindow = new Map();
    for (const decision of this.decisions) {
      if (decision.type !== 'classification_decision') continue;

      const promptTimestamp = decision.timeRange?.start || new Date().toISOString();
      const localDate = utcToLocalTime(promptTimestamp);
      const window = getTimeWindow(localDate);

      // Format: YYYY-MM-DD_HHMM-HHMM_<userhash> (matching LSL file format exactly)
      const year = localDate.getFullYear();
      const month = String(localDate.getMonth() + 1).padStart(2, '0');
      const day = String(localDate.getDate()).padStart(2, '0');
      const datePrefix = `${year}-${month}-${day}`;

      const fullWindow = `${datePrefix}_${window}_${this.userHash}`;

      if (!decisionsByWindow.has(fullWindow)) {
        decisionsByWindow.set(fullWindow, []);
      }
      decisionsByWindow.get(fullWindow).push(decision);
    }

    // Generate separate logs for LOCAL and CODING decisions per window
    // CRITICAL: Only regenerate windows with NEW decisions
    for (const [fullWindow, windowDecisions] of decisionsByWindow.entries()) {
      // Check if this window has new decisions
      const previousCount = this.decisionCountByWindow.get(fullWindow) || 0;
      const currentCount = windowDecisions.length;

      // Skip if no new decisions in this window
      if (currentCount === previousCount && this.finalizedWindows.has(fullWindow)) {
        continue;
      }

      // Split decisions by target
      const localDecisions = windowDecisions.filter(d => !d.classification.isCoding);
      const codingDecisions = windowDecisions.filter(d => d.classification.isCoding);

      // CRITICAL FIX: Parse window timestamp from fullWindow string
      // Format: YYYY-MM-DD_HHMM-HHMM_userhash
      const windowTimestamp = this.parseWindowTimestamp(fullWindow);

      // Generate LOCAL classification log (stored locally in project)
      if (localDecisions.length > 0) {
        const localFile = path.join(this.logDir, `${fullWindow}.md`);

        // CRITICAL FIX: ALWAYS use windowTimestamp, never preserve existing wrong timestamps
        // Previous bug: extractExistingTimestamp() would read wrong timestamps and preserve them
        const localContent = this.generateClassificationMarkdown(fullWindow, localDecisions, 'LOCAL', windowTimestamp.toISOString());

        // TRACING: Log file creation
        console.log(`📊 Creating LOCAL classification log: ${path.basename(localFile)}`);
        console.log(`   Window timestamp: ${windowTimestamp.toISOString()}`);

        fs.writeFileSync(localFile, localContent, 'utf8');

        // CRITICAL FIX: Set file modification time to window timestamp
        fs.utimesSync(localFile, windowTimestamp, windowTimestamp);

        // Verify timestamp
        const stats = fs.statSync(localFile);
        console.log(`   File mtime: ${stats.mtime.toISOString()}`);

        summaryFiles.push(localFile);
      }

      // Generate CODING classification log (stored in coding repo with _from-<project> postfix)
      if (codingDecisions.length > 0) {
        const codingLogDir = path.join(this.codingRepo, '.specstory', 'logs', 'classification');
        fs.mkdirSync(codingLogDir, { recursive: true });

        const codingFile = path.join(codingLogDir, `${fullWindow}_from-${this.projectName}.md`);

        // CRITICAL FIX: ALWAYS use windowTimestamp, never preserve existing wrong timestamps
        const codingContent = this.generateClassificationMarkdown(fullWindow, codingDecisions, 'CODING', windowTimestamp.toISOString());

        // TRACING: Log file creation
        console.log(`📊 Creating CODING classification log: ${path.basename(codingFile)}`);
        console.log(`   Window timestamp: ${windowTimestamp.toISOString()}`);

        fs.writeFileSync(codingFile, codingContent, 'utf8');

        // CRITICAL FIX: Set file modification time to window timestamp
        fs.utimesSync(codingFile, windowTimestamp, windowTimestamp);

        // Verify timestamp
        const stats = fs.statSync(codingFile);
        console.log(`   File mtime: ${stats.mtime.toISOString()}`);

        summaryFiles.push(codingFile);
      }

      // Mark window as finalized and update count
      this.decisionCountByWindow.set(fullWindow, currentCount);
      this.finalizedWindows.add(fullWindow);
    }

    if (summaryFiles.length > 0) {
      console.log(`📊 Generated ${summaryFiles.length} summary report(s) by time window`);

      // Generate overall status file (only if we generated new summaries)
      this.generateStatusFile();
    }

    return summaryFiles;
  }

  /**
   * Generate markdown content for classification log
   */
  generateClassificationMarkdown(fullWindow, windowDecisions, target, timestampISO) {
    let markdown = `# Classification Decision Log${target === 'CODING' ? ' (Foreign/Coding)' : ' (Local)'}\n\n`;
    markdown += `**Time Window**: ${fullWindow}<br>\n`;
    markdown += `**Project**: ${this.projectName}<br>\n`;
    markdown += `**Target**: ${target}<br>\n`;

    // CRITICAL FIX: Always use the passed timestamp (which should be window timestamp)
    markdown += `**Generated**: ${timestampISO}<br>\n`;

    markdown += `**Decisions in Window**: ${windowDecisions.length}\n\n`;

    markdown += `---\n\n`;

    // Statistics for this window
    const stats = this.calculateStatisticsForDecisions(windowDecisions);
    markdown += `## Statistics\n\n`;
    markdown += `- **Total Prompt Sets**: ${stats.totalPromptSets}\n`;
    markdown += `- **Classified as CODING**: ${stats.codingCount} (${stats.codingPercentage}%)\n`;
    markdown += `- **Classified as LOCAL**: ${stats.localCount} (${stats.localPercentage}%)\n`;
    markdown += `- **[Layer 0 (Session Filter) Decisions](#layer-0-session-filter)**: ${stats.layer0Count || 0}\n`;
    markdown += `- **[Layer 1 (Path) Decisions](#layer-1-path)**: ${stats.layer1Count}\n`;
    markdown += `- **[Layer 2 (Keyword) Decisions](#layer-2-keyword)**: ${stats.layer2Count}\n`;
    markdown += `- **[Layer 3 (Embedding) Decisions](#layer-3-embedding)**: ${stats.layer3Count}\n`;
    markdown += `- **[Layer 4 (Semantic) Decisions](#layer-4-semantic)**: ${stats.layer4Count}\n`;
    markdown += `- **Average Processing Time**: ${stats.avgProcessingTime}ms\n\n`;

    markdown += `---\n\n`;

    // Group decisions by final layer for easy navigation
    const decisionsByLayer = {
      'session-filter': [],
      'path': [],
      'keyword': [],
      'embedding': [],
      'semantic': []
    };

    for (const decision of windowDecisions) {
      const finalLayer = decision.classification.finalLayer;
      if (decisionsByLayer[finalLayer]) {
        decisionsByLayer[finalLayer].push(decision);
      }
    }

    // Generate sections for each layer
    const layerNames = {
      'session-filter': 'Layer 0: Session Filter',
      'path': 'Layer 1: Path',
      'keyword': 'Layer 2: Keyword',
      'embedding': 'Layer 3: Embedding',
      'semantic': 'Layer 4: Semantic'
    };

    for (const [layerKey, layerTitle] of Object.entries(layerNames)) {
      const decisions = decisionsByLayer[layerKey];
      if (decisions.length === 0) continue;

      markdown += `## ${layerTitle}\n\n`;
      markdown += `**Decisions**: ${decisions.length}\n\n`;

      for (const decision of decisions) {
        // Create link to LSL file anchor
        let lslFileName = path.basename(decision.lslFile);

        // If LSL file is "pending", try to calculate what it should be
        if (lslFileName === 'pending' && decision.timeRange?.start) {
          const targetProject = decision.classification.isCoding ? 'coding' : this.projectName;
          const sourceProject = decision.classification.isCoding ? this.projectName : null;
          const calculatedFilename = generateLSLFilename(
            decision.timeRange.start,
            this.userHash,
            targetProject,
            sourceProject
          );

          // Check if the calculated file exists
          const historyDir = decision.classification.isCoding
            ? path.join(this.codingRepo, '.specstory', 'history')
            : path.join(this.logDir, '../../history');
          const calculatedPath = path.join(historyDir, calculatedFilename);

          if (fs.existsSync(calculatedPath)) {
            lslFileName = calculatedFilename;
          }
        }

        const lslFilePath = decision.classification.isCoding
          ? `../../../history/${lslFileName}`  // CODING logs are in coding/.specstory/logs/classification, LSL in coding/.specstory/history
          : `../../history/${lslFileName}`;     // LOCAL logs are in project/.specstory/logs/classification, LSL in project/.specstory/history
        const lslLink = lslFileName !== 'pending' ? `[${lslFileName}](${lslFilePath}#${decision.promptSetId})` : `\`${lslFileName}\``;

        // Make prompt set heading clickable
        const promptSetHeading = lslFileName !== 'pending'
          ? `### Prompt Set: [${decision.promptSetId}](${lslFilePath}#${decision.promptSetId})\n\n`
          : `### Prompt Set: ${decision.promptSetId}\n\n`;
        markdown += promptSetHeading;
        markdown += `**Time Range**: ${decision.timeRange.start} → ${decision.timeRange.end}<br>\n`;
        markdown += `**LSL File**: ${lslLink}<br>\n`;
        markdown += `**LSL Lines**: ${decision.lslLineRange.start}-${decision.lslLineRange.end}<br>\n`;
        markdown += `**Target**: ${decision.targetFile === 'foreign' ? '🌍 FOREIGN (coding)' : '📍 LOCAL'}<br>\n`;
        markdown += `**Final Classification**: ${decision.classification.isCoding ? '✅ CODING' : '❌ LOCAL'} (confidence: ${decision.classification.confidence})\n\n`;

        markdown += `#### Layer-by-Layer Trace\n\n`;

        for (const layer of decision.layerDecisions) {
          const emoji = layer.decision === 'coding' ? '✅' : layer.decision === 'local' ? '❌' : '⚠️';
          markdown += `${emoji} **Layer ${this.getLayerNumber(layer.layer)} (${layer.layer})**\n`;
          markdown += `- Decision: ${layer.decision}\n`;
          markdown += `- Confidence: ${layer.confidence}\n`;
          markdown += `- Reasoning: ${layer.reasoning}\n`;
          markdown += `- Processing Time: ${layer.processingTimeMs}ms\n\n`;
        }

        markdown += `---\n\n`;
      }
    }

    return markdown;
  }

  /**
   * Read all classification decisions from JSONL files in log directory
   */
  readAllDecisionsFromDisk() {
    const allDecisions = [];

    try {
      const files = fs.readdirSync(this.logDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      for (const file of jsonlFiles) {
        const filePath = path.join(this.logDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'classification_decision') {
              allDecisions.push(entry);
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ Error reading classification logs: ${error.message}`);
    }

    return allDecisions;
  }

  /**
   * Generate overall classification status file with links to all window summaries
   */
  generateStatusFile() {
    // Determine if this is for redirected decisions (from another project)
    const hasRedirectedDecisions = this.readAllDecisionsFromDisk().some(d =>
      d.sourceProject && d.sourceProject !== this.projectName && d.classification?.isCoding
    );

    // Filename: classification-status_<user-hash>.md or classification-status_<user-hash>_from-<project>.md
    const baseFilename = hasRedirectedDecisions
      ? `classification-status_${this.userHash}_from-${this.projectName}.md`
      : `classification-status_${this.userHash}.md`;
    const statusFile = path.join(this.logDir, baseFilename);

    // Read ALL decisions from disk (not just in-memory ones)
    const allDecisions = this.readAllDecisionsFromDisk();

    // Calculate statistics from all decisions
    const stats = this.calculateStatisticsForDecisions(allDecisions);
    const classificationDecisions = allDecisions;

    // Group decisions by window AND by layer for category-based navigation
    const decisionsByWindow = new Map();
    const decisionsByLayer = {
      'session-filter': [],
      'path': [],
      'keyword': [],
      'embedding': [],
      'semantic': []
    };

    for (const decision of classificationDecisions) {
      const promptTimestamp = decision.timeRange?.start || new Date().toISOString();
      const localDate = utcToLocalTime(promptTimestamp);
      const window = getTimeWindow(localDate);

      const year = localDate.getFullYear();
      const month = String(localDate.getMonth() + 1).padStart(2, '0');
      const day = String(localDate.getDate()).padStart(2, '0');
      const datePrefix = `${year}-${month}-${day}`;
      const fullWindow = `${datePrefix}_${window}_${this.userHash}`;

      if (!decisionsByWindow.has(fullWindow)) {
        decisionsByWindow.set(fullWindow, []);
      }
      decisionsByWindow.get(fullWindow).push(decision);

      // Group by classification layer
      const finalLayer = decision.classification.finalLayer;
      if (decisionsByLayer[finalLayer]) {
        decisionsByLayer[finalLayer].push({ window: fullWindow, decision });
      }
    }

    let markdown = `# Classification Status - ${this.projectName}\n\n`;
    markdown += `**Generated**: ${new Date().toISOString()}\n`;
    markdown += `**Total Sessions**: ${decisionsByWindow.size}\n`;
    markdown += `**Total Decisions**: ${stats.totalPromptSets}\n\n`;
    markdown += `---\n\n`;

    markdown += `## Overall Statistics\n\n`;
    markdown += `- **Total Prompt Sets Classified**: ${stats.totalPromptSets}\n`;
    markdown += `- **Classified as CODING**: ${stats.codingCount} (${stats.codingPercentage}%)\n`;
    markdown += `- **Classified as LOCAL**: ${stats.localCount} (${stats.localPercentage}%)\n\n`;

    markdown += `### Classification Method Distribution\n\n`;
    markdown += `Click on a classification method to view all sessions decided by that layer.\n\n`;
    markdown += `| Layer | Method | Decisions | Percentage |\n`;
    markdown += `|-------|--------|-----------|------------|\n`;
    markdown += `| 0 | [Session Filter](#layer-0-session-filter) | ${stats.layer0Count} | ${Math.round(stats.layer0Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 1 | [Path Analysis](#layer-1-path-analysis) | ${stats.layer1Count} | ${Math.round(stats.layer1Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 2 | [Keyword Matching](#layer-2-keyword-matching) | ${stats.layer2Count} | ${Math.round(stats.layer2Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 3 | [Embedding Search](#layer-3-embedding-search) | ${stats.layer3Count} | ${Math.round(stats.layer3Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 4 | [Semantic Analysis](#layer-4-semantic-analysis) | ${stats.layer4Count} | ${Math.round(stats.layer4Count / stats.totalPromptSets * 100)}% |\n\n`;

    markdown += `**Average Processing Time**: ${stats.avgProcessingTime}ms\n\n`;
    markdown += `---\n\n`;

    // Add category sections with windows grouped by layer
    markdown += `## Classification Categories\n\n`;
    markdown += `Sessions grouped by the classification layer that made the final decision.\n\n`;

    // Layer 0: Session Filter
    markdown += `### Layer 0: Session Filter\n\n`;
    const layer0Windows = new Set(decisionsByLayer['session-filter'].map(d => d.window));
    const sortedLayer0Windows = Array.from(layer0Windows).sort();

    // Separate into CODING (redirected) and LOCAL
    const layer0Coding = [];
    const layer0Local = [];
    for (const window of sortedLayer0Windows) {
      const decisions = decisionsByWindow.get(window);
      const codingCount = decisions.filter(d => d.classification.isCoding && d.classification.finalLayer === 'session-filter').length;
      const localCount = decisions.filter(d => !d.classification.isCoding && d.classification.finalLayer === 'session-filter').length;

      if (codingCount > 0) {
        layer0Coding.push({ window, codingCount, localCount });
      }
      if (localCount > 0) {
        layer0Local.push({ window, codingCount, localCount });
      }
    }

    if (layer0Coding.length > 0 || layer0Local.length > 0) {
      if (layer0Coding.length > 0) {
        markdown += `#### Redirected (CODING)\n\n`;
        for (const { window, codingCount } of layer0Coding) {
          const summaryFile = `file://${this.codingRepo}/.specstory/logs/classification/${window}_from-${this.projectName}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${codingCount} coding decisions\n`;
        }
        markdown += `\n`;
      }

      if (layer0Local.length > 0) {
        markdown += `#### Local (LOCAL)\n\n`;
        for (const { window, localCount } of layer0Local) {
          const summaryFile = `${window}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${localCount} local decisions\n`;
        }
        markdown += `\n`;
      }
    } else {
      markdown += `*No sessions decided by this layer*\n\n`;
    }

    // Layer 1: Path Analysis
    markdown += `### Layer 1: Path Analysis\n\n`;
    const layer1Windows = new Set(decisionsByLayer['path'].map(d => d.window));
    const sortedLayer1Windows = Array.from(layer1Windows).sort();

    const layer1Coding = [];
    const layer1Local = [];
    for (const window of sortedLayer1Windows) {
      const decisions = decisionsByWindow.get(window);
      const codingCount = decisions.filter(d => d.classification.isCoding && d.classification.finalLayer === 'path').length;
      const localCount = decisions.filter(d => !d.classification.isCoding && d.classification.finalLayer === 'path').length;

      if (codingCount > 0) layer1Coding.push({ window, codingCount });
      if (localCount > 0) layer1Local.push({ window, localCount });
    }

    if (layer1Coding.length > 0 || layer1Local.length > 0) {
      if (layer1Coding.length > 0) {
        markdown += `#### Redirected (CODING)\n\n`;
        for (const { window, codingCount } of layer1Coding) {
          const summaryFile = `file://${this.codingRepo}/.specstory/logs/classification/${window}_from-${this.projectName}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${codingCount} coding decisions\n`;
        }
        markdown += `\n`;
      }

      if (layer1Local.length > 0) {
        markdown += `#### Local (LOCAL)\n\n`;
        for (const { window, localCount } of layer1Local) {
          const summaryFile = `${window}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${localCount} local decisions\n`;
        }
        markdown += `\n`;
      }
    } else {
      markdown += `*No sessions decided by this layer*\n\n`;
    }

    // Layer 2: Keyword Matching
    markdown += `### Layer 2: Keyword Matching\n\n`;
    const layer2Windows = new Set(decisionsByLayer['keyword'].map(d => d.window));
    const sortedLayer2Windows = Array.from(layer2Windows).sort();

    const layer2Coding = [];
    const layer2Local = [];
    for (const window of sortedLayer2Windows) {
      const decisions = decisionsByWindow.get(window);
      const codingCount = decisions.filter(d => d.classification.isCoding && d.classification.finalLayer === 'keyword').length;
      const localCount = decisions.filter(d => !d.classification.isCoding && d.classification.finalLayer === 'keyword').length;

      if (codingCount > 0) layer2Coding.push({ window, codingCount });
      if (localCount > 0) layer2Local.push({ window, localCount });
    }

    if (layer2Coding.length > 0 || layer2Local.length > 0) {
      if (layer2Coding.length > 0) {
        markdown += `#### Redirected (CODING)\n\n`;
        for (const { window, codingCount } of layer2Coding) {
          const summaryFile = `file://${this.codingRepo}/.specstory/logs/classification/${window}_from-${this.projectName}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${codingCount} coding decisions\n`;
        }
        markdown += `\n`;
      }

      if (layer2Local.length > 0) {
        markdown += `#### Local (LOCAL)\n\n`;
        for (const { window, localCount } of layer2Local) {
          const summaryFile = `${window}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${localCount} local decisions\n`;
        }
        markdown += `\n`;
      }
    } else {
      markdown += `*No sessions decided by this layer*\n\n`;
    }

    // Layer 3: Embedding Search
    markdown += `### Layer 3: Embedding Search\n\n`;
    const layer3Windows = new Set(decisionsByLayer['embedding'].map(d => d.window));
    const sortedLayer3Windows = Array.from(layer3Windows).sort();

    const layer3Coding = [];
    const layer3Local = [];
    for (const window of sortedLayer3Windows) {
      const decisions = decisionsByWindow.get(window);
      const codingCount = decisions.filter(d => d.classification.isCoding && d.classification.finalLayer === 'embedding').length;
      const localCount = decisions.filter(d => !d.classification.isCoding && d.classification.finalLayer === 'embedding').length;

      if (codingCount > 0) layer3Coding.push({ window, codingCount });
      if (localCount > 0) layer3Local.push({ window, localCount });
    }

    if (layer3Coding.length > 0 || layer3Local.length > 0) {
      if (layer3Coding.length > 0) {
        markdown += `#### Redirected (CODING)\n\n`;
        for (const { window, codingCount } of layer3Coding) {
          const summaryFile = `file://${this.codingRepo}/.specstory/logs/classification/${window}_from-${this.projectName}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${codingCount} coding decisions\n`;
        }
        markdown += `\n`;
      }

      if (layer3Local.length > 0) {
        markdown += `#### Local (LOCAL)\n\n`;
        for (const { window, localCount } of layer3Local) {
          const summaryFile = `${window}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${localCount} local decisions\n`;
        }
        markdown += `\n`;
      }
    } else {
      markdown += `*No sessions decided by this layer*\n\n`;
    }

    // Layer 4: Semantic Analysis
    markdown += `### Layer 4: Semantic Analysis\n\n`;
    const layer4Windows = new Set(decisionsByLayer['semantic'].map(d => d.window));
    const sortedLayer4Windows = Array.from(layer4Windows).sort();

    const layer4Coding = [];
    const layer4Local = [];
    for (const window of sortedLayer4Windows) {
      const decisions = decisionsByWindow.get(window);
      const codingCount = decisions.filter(d => d.classification.isCoding && d.classification.finalLayer === 'semantic').length;
      const localCount = decisions.filter(d => !d.classification.isCoding && d.classification.finalLayer === 'semantic').length;

      if (codingCount > 0) layer4Coding.push({ window, codingCount });
      if (localCount > 0) layer4Local.push({ window, localCount });
    }

    if (layer4Coding.length > 0 || layer4Local.length > 0) {
      if (layer4Coding.length > 0) {
        markdown += `#### Redirected (CODING)\n\n`;
        for (const { window, codingCount } of layer4Coding) {
          const summaryFile = `file://${this.codingRepo}/.specstory/logs/classification/${window}_from-${this.projectName}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${codingCount} coding decisions\n`;
        }
        markdown += `\n`;
      }

      if (layer4Local.length > 0) {
        markdown += `#### Local (LOCAL)\n\n`;
        for (const { window, localCount } of layer4Local) {
          const summaryFile = `${window}.md`;
          markdown += `- **[${window}](${summaryFile})** - ${localCount} local decisions\n`;
        }
        markdown += `\n`;
      }
    } else {
      markdown += `*No sessions decided by this layer*\n\n`;
    }

    markdown += `---\n\n`;

    markdown += `## All Session Windows\n\n`;
    markdown += `Complete chronological list of all classification sessions.\n\n`;

    // Sort windows chronologically
    const sortedWindows = Array.from(decisionsByWindow.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    for (const [window, decisions] of sortedWindows) {
      const codingCount = decisions.filter(d => d.classification.isCoding).length;
      const localCount = decisions.filter(d => !d.classification.isCoding).length;

      // Create appropriate links for CODING and LOCAL
      const links = [];
      if (codingCount > 0) {
        const codingFile = `file://${this.codingRepo}/.specstory/logs/classification/${window}_from-${this.projectName}.md`;
        links.push(`[CODING: ${codingCount}](${codingFile})`);
      }
      if (localCount > 0) {
        const localFile = `${window}.md`;
        links.push(`[LOCAL: ${localCount}](${localFile})`);
      }

      markdown += `- **${window}** - ${decisions.length} decisions (${links.join(', ')})\n`;
    }

    markdown += `\n---\n\n`;

    // Add Detailed Session Breakdown section with individual prompt set links
    markdown += `## Detailed Session Breakdown\n\n`;
    markdown += `Individual prompt sets with clickable links to their classification details.\n\n`;

    for (const [window, decisions] of sortedWindows) {
      markdown += `### ${window}\n\n`;

      const codingDecisions = decisions.filter(d => d.classification.isCoding);
      const localDecisions = decisions.filter(d => !d.classification.isCoding);

      if (codingDecisions.length > 0) {
        markdown += `#### CODING Decisions (${codingDecisions.length})\n\n`;
        for (const decision of codingDecisions) {
          const promptSetId = decision.promptSetId;
          // Handle "pending" LSL files - use proper window-based filename
          const lslFileName = (decision.lslFile && decision.lslFile !== 'pending')
            ? path.basename(decision.lslFile)
            : `${window}_from-${this.projectName}.md`;
          const lslFilePath = `file://${this.codingRepo}/.specstory/history/${lslFileName}`;
          const classificationFilePath = `file://${this.codingRepo}/.specstory/logs/classification/${window}_from-${this.projectName}.md`;

          markdown += `- [${promptSetId}](${lslFilePath}#${promptSetId}) `;
          markdown += `([classification](${classificationFilePath}#prompt-set-${promptSetId})) `;
          markdown += `- Layer ${decision.classification.finalLayer}\n`;
        }
        markdown += `\n`;
      }

      if (localDecisions.length > 0) {
        markdown += `#### LOCAL Decisions (${localDecisions.length})\n\n`;
        for (const decision of localDecisions) {
          const promptSetId = decision.promptSetId;
          // Handle "pending" LSL files - use proper window-based filename
          const lslFileName = (decision.lslFile && decision.lslFile !== 'pending')
            ? path.basename(decision.lslFile)
            : `${window}.md`;
          const lslFilePath = `../../../history/${lslFileName}`;
          const classificationFilePath = `${window}.md`;

          markdown += `- [${promptSetId}](${lslFilePath}#${promptSetId}) `;
          markdown += `([classification](${classificationFilePath}#prompt-set-${promptSetId})) `;
          markdown += `- Layer ${decision.classification.finalLayer}\n`;
        }
        markdown += `\n`;
      }
    }

    markdown += `\n---\n\n`;
    markdown += `*Generated by Classification Logger v1.0*\n`;

    fs.writeFileSync(statusFile, markdown, 'utf8');
    console.log(`📋 Generated classification status file: ${path.basename(statusFile)}`);

    return statusFile;
  }

  /**
   * Calculate statistics from a subset of decisions (for a specific time window)
   */
  calculateStatisticsForDecisions(decisions) {
    const codingCount = decisions.filter(d => d.classification.isCoding).length;
    const localCount = decisions.filter(d => !d.classification.isCoding).length;

    const layerCounts = {
      'session-filter': 0,
      path: 0,
      keyword: 0,
      embedding: 0,
      semantic: 0
    };

    let totalProcessingTime = 0;

    for (const decision of decisions) {
      const finalLayer = decision.classification.finalLayer;
      if (layerCounts[finalLayer] !== undefined) {
        layerCounts[finalLayer]++;
      }

      // Sum up processing times
      if (decision.layerDecisions) {
        totalProcessingTime += decision.layerDecisions.reduce((sum, layer) => sum + (layer.processingTimeMs || 0), 0);
      }
    }

    return {
      totalPromptSets: decisions.length,
      codingCount,
      localCount,
      codingPercentage: decisions.length > 0 ? Math.round((codingCount / decisions.length) * 100) : 0,
      localPercentage: decisions.length > 0 ? Math.round((localCount / decisions.length) * 100) : 0,
      layer0Count: layerCounts['session-filter'],
      layer1Count: layerCounts.path,
      layer2Count: layerCounts.keyword,
      layer3Count: layerCounts.embedding,
      layer4Count: layerCounts.semantic,
      avgProcessingTime: decisions.length > 0 ? Math.round(totalProcessingTime / decisions.length) : 0
    };
  }

  /**
   * Calculate statistics from logged decisions
   */
  calculateStatistics() {
    const classificationDecisions = this.decisions.filter(d => d.type === 'classification_decision');

    const codingCount = classificationDecisions.filter(d => d.classification.isCoding).length;
    const localCount = classificationDecisions.filter(d => !d.classification.isCoding).length;

    const layerCounts = {
      'session-filter': 0,
      path: 0,
      keyword: 0,
      embedding: 0,
      semantic: 0
    };

    let totalProcessingTime = 0;

    for (const decision of classificationDecisions) {
      const finalLayer = decision.classification.finalLayer;
      if (layerCounts[finalLayer] !== undefined) {
        layerCounts[finalLayer]++;
      }

      // Sum up processing times
      if (decision.layerDecisions) {
        totalProcessingTime += decision.layerDecisions.reduce((sum, layer) => sum + (layer.processingTimeMs || 0), 0);
      }
    }

    return {
      totalPromptSets: classificationDecisions.length,
      codingCount,
      localCount,
      codingPercentage: classificationDecisions.length > 0 ? Math.round((codingCount / classificationDecisions.length) * 100) : 0,
      localPercentage: classificationDecisions.length > 0 ? Math.round((localCount / classificationDecisions.length) * 100) : 0,
      layer0Count: layerCounts['session-filter'],
      layer1Count: layerCounts.path,
      layer2Count: layerCounts.keyword,
      layer3Count: layerCounts.embedding,
      layer4Count: layerCounts.semantic,
      avgProcessingTime: classificationDecisions.length > 0 ? Math.round(totalProcessingTime / classificationDecisions.length) : 0
    };
  }

  /**
   * Helper to get layer number from name
   */
  getLayerNumber(layerName) {
    const mapping = {
      'session-filter': '0',
      'path': '1',
      'keyword': '2',
      'embedding': '3',
      'semantic': '4'
    };
    return mapping[layerName] || '?';
  }

  /**
   * Finalize logging session
   */
  finalize() {
    // Don't write session_end to windowed files - they should be frozen after their window ends
    // Statistics can be calculated from the classification_decision entries in each window

    // Only generate summary report if there are new decisions since last finalization
    // This prevents unnecessary timestamp updates in git-tracked status files
    // Check disk-based decisions since status file is generated from disk state
    const allDecisionsFromDisk = this.readAllDecisionsFromDisk();
    const currentDecisionCount = allDecisionsFromDisk.length;
    const newDecisions = currentDecisionCount - this.lastFinalizedDecisionCount;

    if (newDecisions > 0) {
      this.generateSummaryReport();
      this.lastFinalizedDecisionCount = currentDecisionCount;
      console.log(`✅ Classification logging complete: ${currentDecisionCount} decisions logged (${newDecisions} new)`);
    } else {
      console.log(`⏭️  No new decisions since last finalization (${currentDecisionCount} total decisions)`);
    }
  }
}

// Export for use in other modules
export default ClassificationLogger;

// CLI usage
runIfMain(import.meta.url, () => {
  console.log('Classification Logger - Use as module in batch-lsl-processor.js');
  console.log('Example:');
  console.log('  import ClassificationLogger from "./classification-logger.js";');
  console.log('  const logger = new ClassificationLogger({ projectName: "curriculum-alignment" });');
  console.log('  logger.initializeLogFile();');
  console.log('  logger.logDecision({ ... });');
  console.log('  logger.finalize();');
});
