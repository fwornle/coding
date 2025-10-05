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
import { getTimeWindow, utcToLocalTime } from './timezone-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ClassificationLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(process.cwd(), '.specstory', 'logs', 'classification');
    this.projectName = options.projectName || 'unknown';
    this.sessionId = options.sessionId || `session-${Date.now()}`;
    this.userHash = options.userHash || 'unknown';
    this.decisions = [];
    this.windowedLogs = new Map(); // Track logs by time window

    // Ensure log directory exists
    fs.mkdirSync(this.logDir, { recursive: true });
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
          timestamp: new Date().toISOString(),
          projectName: this.projectName,
          timeWindow: fullWindow,
          logVersion: '1.0.0'
        };
        fs.writeFileSync(logFile, JSON.stringify(header) + '\n', 'utf8');
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
    const logEntry = {
      type: 'classification_decision',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...decision
    };

    // Store in memory
    this.decisions.push(logEntry);

    // Determine which time window this decision belongs to
    const promptTimestamp = decision.timeRange?.start || new Date().toISOString();
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

    // Generate one summary per window
    for (const [fullWindow, windowDecisions] of decisionsByWindow.entries()) {
      const summaryFile = path.join(this.logDir, `${fullWindow}-summary.md`);

      let markdown = `# Classification Decision Log Summary\n\n`;
      markdown += `**Time Window**: ${fullWindow}\n`;
      markdown += `**Project**: ${this.projectName}\n`;
      markdown += `**Generated**: ${new Date().toISOString()}\n`;
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
          markdown += `### Prompt Set: ${decision.promptSetId}\n\n`;
          markdown += `**Time Range**: ${decision.timeRange.start} → ${decision.timeRange.end}\n`;
          markdown += `**LSL File**: \`${path.basename(decision.lslFile)}\`\n`;
          markdown += `**LSL Lines**: ${decision.lslLineRange.start}-${decision.lslLineRange.end}\n`;
          markdown += `**Target**: ${decision.targetFile === 'foreign' ? '🌍 FOREIGN (coding)' : '📍 LOCAL'}\n`;
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

      fs.writeFileSync(summaryFile, markdown, 'utf8');
      summaryFiles.push(summaryFile);
    }

    if (summaryFiles.length > 0) {
      console.log(`📊 Generated ${summaryFiles.length} summary report(s) by time window`);
    }

    // Generate overall status file
    this.generateStatusFile();

    return summaryFiles;
  }

  /**
   * Generate overall classification status file with links to all window summaries
   */
  generateStatusFile() {
    const statusFile = path.join(this.logDir, `classification-status-${this.projectName}.md`);

    const stats = this.calculateStatistics();
    const classificationDecisions = this.decisions.filter(d => d.type === 'classification_decision');

    // Group decisions by window to create file links
    const decisionsByWindow = new Map();
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
    markdown += `| Layer | Method | Decisions | Percentage |\n`;
    markdown += `|-------|--------|-----------|------------|\n`;
    markdown += `| 0 | Session Filter | ${stats.layer0Count} | ${Math.round(stats.layer0Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 1 | Path Analysis | ${stats.layer1Count} | ${Math.round(stats.layer1Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 2 | Keyword Matching | ${stats.layer2Count} | ${Math.round(stats.layer2Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 3 | Embedding Search | ${stats.layer3Count} | ${Math.round(stats.layer3Count / stats.totalPromptSets * 100)}% |\n`;
    markdown += `| 4 | Semantic Analysis | ${stats.layer4Count} | ${Math.round(stats.layer4Count / stats.totalPromptSets * 100)}% |\n\n`;

    markdown += `**Average Processing Time**: ${stats.avgProcessingTime}ms\n\n`;
    markdown += `---\n\n`;

    markdown += `## Session Windows\n\n`;
    markdown += `Click on any window to view detailed classification decisions for that time period.\n\n`;

    // Sort windows chronologically
    const sortedWindows = Array.from(decisionsByWindow.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    for (const [window, decisions] of sortedWindows) {
      const summaryFile = `${window}-summary.md`;
      const codingCount = decisions.filter(d => d.classification.isCoding).length;
      const localCount = decisions.filter(d => !d.classification.isCoding).length;

      markdown += `- **[${window}](${summaryFile})** - ${decisions.length} decisions (${codingCount} coding, ${localCount} local)\n`;
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
    const footer = {
      type: 'session_end',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      totalDecisions: this.decisions.length,
      statistics: this.calculateStatistics()
    };

    // Write session end to all active windowed log files
    for (const logFile of this.windowedLogs.values()) {
      fs.appendFileSync(logFile, JSON.stringify(footer) + '\n', 'utf8');
    }

    // Generate summary report
    this.generateSummaryReport();

    console.log(`✅ Classification logging complete: ${this.decisions.length} decisions logged`);
  }
}

// Export for use in other modules
export default ClassificationLogger;

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Classification Logger - Use as module in batch-lsl-processor.js');
  console.log('Example:');
  console.log('  import ClassificationLogger from "./classification-logger.js";');
  console.log('  const logger = new ClassificationLogger({ projectName: "curriculum-alignment" });');
  console.log('  logger.initializeLogFile();');
  console.log('  logger.logDecision({ ... });');
  console.log('  logger.finalize();');
}
