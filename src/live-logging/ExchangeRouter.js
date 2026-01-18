/**
 * ExchangeRouter - Session File Routing for Reliable Coding Classifier
 * 
 * Routes classified exchanges to appropriate session files with proper naming.
 * Handles naming conventions for local vs redirected sessions and integrates 
 * with time window management (60-minute windows).
 * 
 * Features:
 * - Follows existing LSL file naming patterns exactly
 * - Handles time window boundaries correctly (60-minute windows)
 * - Routes content between customer project and coding project appropriately
 * - Prevents empty file creation
 * - Supports both live and batch processing modes
 * - Comprehensive logging for debugging routing decisions
 */

const path = require('path');
const fs = require('fs');

class ExchangeRouter {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.codingProjectPath = options.codingProjectPath || this.detectCodingProject();
    this.debug = options.debug || false;
    
    // Determine current project context
    this.currentProject = this.determineCurrentProject();
    this.projectName = path.basename(this.projectPath);
    
    // Time window management - load from config
    const sessionDuration = this.loadSessionDuration();
    this.windowSizeMinutes = Math.round(sessionDuration / 60000);
    this.windowOffsetMinutes = 30; // Start windows at :30 minutes
    
    // Statistics tracking
    this.stats = {
      totalRoutes: 0,
      localRoutes: 0,
      redirectedRoutes: 0,
      filesCreated: 0,
      filesAppended: 0
    };
    
    this.log(`ExchangeRouter initialized for project: ${this.projectName}`);
    this.log(`Coding project path: ${this.codingProjectPath}`);
  }

  /**
   * Load session duration from config
   */
  loadSessionDuration() {
    try {
      const configPath = path.join(this.codingProjectPath, 'config', 'live-logging-config.json');
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
   * Route an exchange to the appropriate session file
   * @param {Object} exchange - Exchange data to route
   * @param {Object} classification - Classification result from ReliableCodingClassifier
   * @returns {Object} Routing result with file paths and actions taken
   */
  async route(exchange, classification) {
    const startTime = Date.now();
    this.stats.totalRoutes++;
    
    try {
      // Determine routing decision
      const routingDecision = this.makeRoutingDecision(exchange, classification);
      
      // Generate session file paths
      const sessionPaths = this.generateSessionPaths(exchange, routingDecision);
      
      // Write content to appropriate files
      const writeResults = await this.writeToSessionFiles(exchange, sessionPaths, routingDecision);
      
      // Update statistics
      this.updateStats(routingDecision, writeResults);
      
      return this.formatRoutingResult(routingDecision, sessionPaths, writeResults, startTime);
      
    } catch (error) {
      this.log(`Routing error: ${error.message}`);
      return this.formatErrorResult(error, startTime);
    }
  }

  /**
   * Make routing decision based on classification
   * @param {Object} exchange - Exchange data
   * @param {Object} classification - Classification result
   * @returns {Object} Routing decision
   */
  makeRoutingDecision(exchange, classification) {
    const isCodingContent = classification.classification === 'CODING_INFRASTRUCTURE' || classification.isCoding;
    const isCurrentlyInCoding = this.currentProject === 'coding';
    
    return {
      isCodingContent,
      isCurrentlyInCoding,
      shouldRedirect: isCodingContent && !isCurrentlyInCoding,
      shouldKeepLocal: !isCodingContent || isCurrentlyInCoding,
      reason: this.buildRoutingReason(isCodingContent, isCurrentlyInCoding),
      confidence: classification.confidence || 0.5
    };
  }

  /**
   * Generate session file paths based on routing decision
   * @param {Object} exchange - Exchange data
   * @param {Object} routingDecision - Routing decision
   * @returns {Object} Session file paths
   */
  generateSessionPaths(exchange, routingDecision) {
    const timestamp = exchange.timestamp || Date.now();
    const timeWindow = this.calculateTimeWindow(timestamp);
    
    const paths = {};
    
    // Always generate local session path
    paths.localPath = this.generateSessionFilePath(
      this.projectPath,
      timeWindow,
      false, // not from other project
      this.projectName
    );
    
    // Generate redirected path if needed
    if (routingDecision.shouldRedirect) {
      paths.redirectedPath = this.generateSessionFilePath(
        this.codingProjectPath,
        timeWindow,
        true, // from other project
        this.projectName
      );
    }
    
    return paths;
  }

  /**
   * Generate a session file path following LSL naming conventions
   * @param {string} targetProjectPath - Target project directory
   * @param {Object} timeWindow - Time window information
   * @param {boolean} isFromOtherProject - Whether content originates from another project
   * @param {string} originProjectName - Name of originating project
   * @returns {string} Generated file path
   */
  generateSessionFilePath(targetProjectPath, timeWindow, isFromOtherProject, originProjectName) {
    const targetProjectName = path.basename(targetProjectPath);
    const historyDir = path.join(targetProjectPath, '.specstory', 'history');
    
    let filename;
    
    if (targetProjectName === 'coding') {
      if (isFromOtherProject) {
        filename = `${timeWindow.dateString}_${timeWindow.windowString}-session-from-${originProjectName}.md`;
      } else {
        filename = `${timeWindow.dateString}_${timeWindow.windowString}-session-from-coding.md`;
      }
    } else {
      filename = `${timeWindow.dateString}_${timeWindow.windowString}-session.md`;
    }
    
    return path.join(historyDir, filename);
  }

  /**
   * Calculate 60-minute time window for timestamp
   * @param {number} timestamp - Unix timestamp
   * @returns {Object} Time window information
   */
  calculateTimeWindow(timestamp) {
    const date = new Date(timestamp);
    
    // Calculate time window (60-minute windows starting at :30)
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const trancheStart = Math.floor((totalMinutes + 30) / 60) * 60 - 30;
    const trancheEnd = trancheStart + 60;
    
    // Handle day boundaries
    let windowStart = new Date(date);
    let windowEnd = new Date(date);
    
    if (trancheStart < 0) {
      // Window crosses midnight backwards
      windowStart.setDate(windowStart.getDate() - 1);
      windowStart.setHours(23, 30, 0, 0);
      windowEnd.setHours(0, 30, 0, 0);
    } else if (trancheEnd >= 24 * 60) {
      // Window crosses midnight forwards  
      windowStart.setHours(23, 30, 0, 0);
      windowEnd.setDate(windowEnd.getDate() + 1);
      windowEnd.setHours(0, 30, 0, 0);
    } else {
      // Normal window within same day
      windowStart.setHours(Math.floor(trancheStart / 60), trancheStart % 60, 0, 0);
      windowEnd.setHours(Math.floor(trancheEnd / 60), trancheEnd % 60, 0, 0);
    }
    
    // Format strings for file naming
    const dateString = this.formatDateString(windowStart);
    const windowString = this.formatWindowString(windowStart, windowEnd);
    
    return {
      start: windowStart,
      end: windowEnd,
      dateString,
      windowString,
      timeString: this.formatTimeString(windowStart, windowEnd)
    };
  }

  /**
   * Format date string for file names (YYYY-MM-DD format)
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string
   */
  formatDateString(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Format window string for file names (HHMM-HHMM format)
   * @param {Date} start - Window start time
   * @param {Date} end - Window end time
   * @returns {string} Formatted window string
   */
  formatWindowString(start, end) {
    const formatTime = (date) => {
      return date.toTimeString().substring(0, 5).replace(':', '');
    };
    
    return `${formatTime(start)}-${formatTime(end)}`;
  }

  /**
   * Format human-readable time string
   * @param {Date} start - Window start time
   * @param {Date} end - Window end time
   * @returns {string} Human-readable time string
   */
  formatTimeString(start, end) {
    const formatTime = (date) => {
      return date.toTimeString().substring(0, 5);
    };
    
    if (start.getDate() !== end.getDate()) {
      return `${formatTime(start)} - ${formatTime(end)} (spans midnight)`;
    } else {
      return `${formatTime(start)} - ${formatTime(end)}`;
    }
  }

  /**
   * Write exchange content to session files
   * @param {Object} exchange - Exchange to write
   * @param {Object} sessionPaths - Generated session paths
   * @param {Object} routingDecision - Routing decision
   * @returns {Object} Write results
   */
  async writeToSessionFiles(exchange, sessionPaths, routingDecision) {
    const results = {
      localWrite: null,
      redirectedWrite: null,
      errors: []
    };
    
    try {
      // Always write to local project (if content belongs there or for tracking)
      if (routingDecision.shouldKeepLocal || routingDecision.shouldRedirect) {
        results.localWrite = await this.writeExchangeToFile(
          exchange, 
          sessionPaths.localPath, 
          routingDecision.shouldRedirect ? 'tracking' : 'content'
        );
      }
      
      // Write to coding project if redirected
      if (routingDecision.shouldRedirect && sessionPaths.redirectedPath) {
        results.redirectedWrite = await this.writeExchangeToFile(
          exchange, 
          sessionPaths.redirectedPath, 
          'content'
        );
      }
      
    } catch (error) {
      results.errors.push(error);
      this.log(`File write error: ${error.message}`);
    }
    
    return results;
  }

  /**
   * Write exchange content to specific file
   * @param {Object} exchange - Exchange to write
   * @param {string} filePath - Target file path
   * @param {string} writeType - Type of write ('content' or 'tracking')
   * @returns {Object} Write result
   */
  async writeExchangeToFile(exchange, filePath, writeType) {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Check if file exists
    const isNewFile = !fs.existsSync(filePath);
    
    // Format exchange content
    const content = this.formatExchangeContent(exchange, writeType, isNewFile);
    
    // Write to file
    if (isNewFile) {
      fs.writeFileSync(filePath, content, 'utf8');
      this.stats.filesCreated++;
    } else {
      fs.appendFileSync(filePath, content, 'utf8');
      this.stats.filesAppended++;
    }
    
    return {
      filePath,
      writeType,
      isNewFile,
      bytesWritten: Buffer.byteLength(content, 'utf8')
    };
  }

  /**
   * Format exchange content for file writing
   * @param {Object} exchange - Exchange to format
   * @param {string} writeType - Type of write ('content' or 'tracking')
   * @param {boolean} isNewFile - Whether this is a new file
   * @returns {string} Formatted content
   */
  formatExchangeContent(exchange, writeType, isNewFile) {
    const timestamp = new Date(exchange.timestamp || Date.now());
    const timeString = timestamp.toISOString();
    
    let content = '';
    
    // Add file header for new files
    if (isNewFile) {
      const timeWindow = this.calculateTimeWindow(exchange.timestamp || Date.now());
      content += this.generateFileHeader(timeWindow, writeType);
    }
    
    // Add exchange content
    content += `\n## ${timeString.substring(11, 19)} - Exchange\n\n`;
    
    if (exchange.userMessage) {
      content += `**User:** ${exchange.userMessage}\n\n`;
    }
    
    if (exchange.assistantResponse?.content || exchange.claudeResponse) {
      const response = exchange.assistantResponse?.content || exchange.claudeResponse;
      content += `**Assistant:** ${response.substring(0, 1000)}${response.length > 1000 ? '...' : ''}\n\n`;
    }
    
    if (exchange.assistantResponse?.toolCalls || exchange.toolCalls) {
      const tools = exchange.assistantResponse?.toolCalls || exchange.toolCalls;
      content += `**Tools Used:** ${tools.map(t => t.name).join(', ')}\n\n`;
    }
    
    // Add routing information for tracking writes
    if (writeType === 'tracking') {
      content += `*Note: This content was redirected to coding project*\n\n`;
    }
    
    content += `---\n`;
    
    return content;
  }

  /**
   * Generate file header for new session files
   * @param {Object} timeWindow - Time window information
   * @param {string} writeType - Type of write
   * @returns {string} File header
   */
  generateFileHeader(timeWindow, writeType) {
    const isRedirected = writeType === 'content' && this.currentProject !== 'coding';
    
    return `# Session Log - ${timeWindow.timeString}\n\n` +
           `**Date:** ${timeWindow.dateString}\n` +
           `**Work Period:** ${timeWindow.timeString}\n` +
           `**Focus:** ${isRedirected ? `Coding activities from ${this.projectName}` : 'Local project session'}\n` +
           `**Duration:** ~60 minutes\n` +
           `${isRedirected ? `**Source Project:** ${this.projectPath}\n` : ''}` +
           `\n---\n\n## Session Overview\n\n` +
           `This session contains ${writeType === 'tracking' ? 'tracked references to' : ''} exchanges ` +
           `${isRedirected ? 'redirected from ' + this.projectName : 'from local project activities'}.\n\n`;
  }

  /**
   * Build routing reason explanation
   * @param {boolean} isCodingContent - Whether content is coding-related
   * @param {boolean} isCurrentlyInCoding - Whether currently in coding project
   * @returns {string} Routing reason
   */
  buildRoutingReason(isCodingContent, isCurrentlyInCoding) {
    if (isCodingContent && !isCurrentlyInCoding) {
      return 'Coding content from non-coding project - redirected to coding';
    } else if (isCodingContent && isCurrentlyInCoding) {
      return 'Coding content in coding project - kept local';
    } else if (!isCodingContent && isCurrentlyInCoding) {
      return 'Non-coding content in coding project - kept local';
    } else {
      return 'Non-coding content in non-coding project - kept local';
    }
  }

  /**
   * Determine current project type
   * @returns {string} Project type ('coding' or other)
   */
  determineCurrentProject() {
    const projectName = path.basename(this.projectPath);
    const isCodingProject = projectName === 'coding' || 
                           this.projectPath.includes('/Agentic/coding') ||
                           fs.existsSync(path.join(this.projectPath, 'CLAUDE.md'));
    
    return isCodingProject ? 'coding' : projectName;
  }

  /**
   * Detect coding project path using heuristics
   * @returns {string} Detected coding project path
   */
  detectCodingProject() {
    const candidates = [
      process.env.CODING_REPO,
      process.env.CODING_TOOLS_PATH,
      path.join(process.env.HOME || '', 'Agentic', 'coding'),
      path.join(process.cwd(), 'coding')
    ].filter(Boolean);
    
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'CLAUDE.md'))) {
        return candidate;
      }
    }
    
    return candidates[candidates.length - 1]; // Use fallback
  }

  /**
   * Update routing statistics
   * @param {Object} routingDecision - Routing decision
   * @param {Object} writeResults - Write results
   */
  updateStats(routingDecision, writeResults) {
    if (routingDecision.shouldKeepLocal) {
      this.stats.localRoutes++;
    }
    
    if (routingDecision.shouldRedirect) {
      this.stats.redirectedRoutes++;
    }
  }

  /**
   * Format routing result
   * @param {Object} routingDecision - Routing decision
   * @param {Object} sessionPaths - Session paths
   * @param {Object} writeResults - Write results
   * @param {number} startTime - Processing start time
   * @returns {Object} Formatted result
   */
  formatRoutingResult(routingDecision, sessionPaths, writeResults, startTime) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      routing: routingDecision,
      paths: sessionPaths,
      writes: writeResults,
      processingTimeMs: processingTime,
      stats: { ...this.stats }
    };
  }

  /**
   * Format error result
   * @param {Error} error - Error that occurred
   * @param {number} startTime - Processing start time
   * @returns {Object} Error result
   */
  formatErrorResult(error, startTime) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      error: error.message,
      processingTimeMs: processingTime,
      stats: { ...this.stats }
    };
  }

  /**
   * Get routing statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const total = this.stats.totalRoutes;
    return {
      ...this.stats,
      redirectionRate: total > 0 ? ((this.stats.redirectedRoutes / total) * 100).toFixed(2) + '%' : '0%',
      localRate: total > 0 ? ((this.stats.localRoutes / total) * 100).toFixed(2) + '%' : '0%',
      avgFilesPerRoute: total > 0 ? ((this.stats.filesCreated + this.stats.filesAppended) / total).toFixed(2) : '0'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRoutes: 0,
      localRoutes: 0,
      redirectedRoutes: 0,
      filesCreated: 0,
      filesAppended: 0
    };
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   */
  log(message) {
    if (this.debug) {
      console.log(`[ExchangeRouter] ${message}`);
    }
  }
}

module.exports = ExchangeRouter;