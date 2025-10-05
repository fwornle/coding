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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ClassificationLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(process.cwd(), '.specstory', 'logs', 'classification');
    this.projectName = options.projectName || 'unknown';
    this.sessionId = options.sessionId || `session-${Date.now()}`;
    this.logFile = null;
    this.decisions = [];

    // Ensure log directory exists
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  /**
   * Initialize log file for current batch run
   */
  initializeLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `classification-${this.projectName}-${timestamp}.jsonl`;
    this.logFile = path.join(this.logDir, filename);

    // Write header entry
    const header = {
      type: 'session_start',
      timestamp: new Date().toISOString(),
      projectName: this.projectName,
      sessionId: this.sessionId,
      logVersion: '1.0.0'
    };

    fs.writeFileSync(this.logFile, JSON.stringify(header) + '\n', 'utf8');
    console.log(`📝 Classification log: ${this.logFile}`);

    return this.logFile;
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

    // Append to log file
    if (this.logFile) {
      fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n', 'utf8');
    }

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
   * Generate human-readable summary report
   */
  generateSummaryReport() {
    const summaryFile = this.logFile.replace('.jsonl', '-summary.md');

    let markdown = `# Classification Decision Log Summary\n\n`;
    markdown += `**Session**: ${this.sessionId}\n`;
    markdown += `**Project**: ${this.projectName}\n`;
    markdown += `**Timestamp**: ${new Date().toISOString()}\n`;
    markdown += `**Total Decisions**: ${this.decisions.length}\n\n`;

    markdown += `---\n\n`;

    // Statistics
    const stats = this.calculateStatistics();
    markdown += `## Statistics\n\n`;
    markdown += `- **Total Prompt Sets**: ${stats.totalPromptSets}\n`;
    markdown += `- **Classified as CODING**: ${stats.codingCount} (${stats.codingPercentage}%)\n`;
    markdown += `- **Classified as LOCAL**: ${stats.localCount} (${stats.localPercentage}%)\n`;
    markdown += `- **Layer 1 (Path) Decisions**: ${stats.layer1Count}\n`;
    markdown += `- **Layer 2 (Keyword) Decisions**: ${stats.layer2Count}\n`;
    markdown += `- **Layer 3 (Embedding) Decisions**: ${stats.layer3Count}\n`;
    markdown += `- **Layer 4 (Semantic) Decisions**: ${stats.layer4Count}\n`;
    markdown += `- **Average Processing Time**: ${stats.avgProcessingTime}ms\n\n`;

    markdown += `---\n\n`;

    // Individual decisions
    markdown += `## Individual Prompt Set Decisions\n\n`;

    for (const decision of this.decisions) {
      if (decision.type !== 'classification_decision') continue;

      markdown += `### Prompt Set: ${decision.promptSetId}\n\n`;
      markdown += `**Time Range**: ${decision.timeRange.start} → ${decision.timeRange.end}\n`;
      markdown += `**LSL File**: \`${path.basename(decision.lslFile)}\`\n`;
      markdown += `**LSL Lines**: ${decision.lslLineRange.start}-${decision.lslLineRange.end}\n`;
      markdown += `**Target**: ${decision.targetFile === 'foreign' ? '🌍 FOREIGN (coding)' : '📍 LOCAL'}\n`;
      markdown += `**Final Classification**: ${decision.classification.isCoding ? '✅ CODING' : '❌ LOCAL'} (confidence: ${decision.classification.confidence})\n`;
      markdown += `**Decided by**: Layer ${decision.classification.finalLayer}\n\n`;

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

    fs.writeFileSync(summaryFile, markdown, 'utf8');
    console.log(`📊 Summary report: ${summaryFile}`);

    return summaryFile;
  }

  /**
   * Calculate statistics from logged decisions
   */
  calculateStatistics() {
    const classificationDecisions = this.decisions.filter(d => d.type === 'classification_decision');

    const codingCount = classificationDecisions.filter(d => d.classification.isCoding).length;
    const localCount = classificationDecisions.filter(d => !d.classification.isCoding).length;

    const layerCounts = {
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

    if (this.logFile) {
      fs.appendFileSync(this.logFile, JSON.stringify(footer) + '\n', 'utf8');
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
