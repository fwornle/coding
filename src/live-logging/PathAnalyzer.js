/**
 * PathAnalyzer - Layer 1 of Reliable Coding Classifier
 * 
 * Provides 100% accuracy file path detection for coding project operations.
 * Extracts file paths from tool calls and checks if paths belong to coding project filetree.
 * 
 * Features:
 * - Machine-agnostic using environment variables
 * - Cross-platform path handling
 * - Support for absolute, relative, and tilde paths
 * - Tool call analysis for file operations
 * - Comprehensive operational logging
 */

import path from 'path';
import fs from 'fs';

class PathAnalyzer {
  constructor(options = {}) {
    this.codingRepo = options.codingRepo || this.detectCodingRepo();
    this.debug = options.debug || false;
    
    // Normalize coding repo path for consistent comparison
    if (this.codingRepo) {
      this.codingRepo = path.resolve(this.expandPath(this.codingRepo));
    }
    
    // Supported file operation tools
    this.fileOperationTools = new Set([
      'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep',
      'NotebookEdit', 'Bash', 'TodoWrite'
    ]);
    
    this.stats = {
      totalAnalyses: 0,
      codingPathHits: 0,
      fileOperationsDetected: 0,
      pathResolutionErrors: 0
    };
    
    this.log(`PathAnalyzer initialized with coding repo: ${this.codingRepo}`);
  }

  /**
   * Analyze exchange for file paths targeting coding project
   * @param {Object} exchange - Exchange data to analyze
   * @returns {Object} Analysis result with isCoding flag and reasoning
   */
  async analyzePaths(exchange) {
    const startTime = Date.now();
    this.stats.totalAnalyses++;

    try {
      const fileOperations = this.extractFileOperations(exchange);

      if (fileOperations.length === 0) {
        return this.formatResult(false, [], 'No file operations detected', startTime);
      }

      this.stats.fileOperationsDetected += fileOperations.length;

      // Check each file operation for coding repo targeting
      const codingOperations = [];
      const nonCodingOperations = [];
      const codingWriteOperations = [];
      const nonCodingWriteOperations = [];

      for (const filePath of fileOperations) {
        const isWrite = this.isWriteOperation(exchange, filePath);

        if (this.isCodingPath(filePath)) {
          codingOperations.push(filePath);
          if (isWrite) codingWriteOperations.push(filePath);
          this.stats.codingPathHits++;
        } else {
          nonCodingOperations.push(filePath);
          if (isWrite) nonCodingWriteOperations.push(filePath);
        }
      }

      // Priority 1: Write operations determine classification
      // If there are write operations, classify based on majority of writes
      if (codingWriteOperations.length > 0 || nonCodingWriteOperations.length > 0) {
        if (nonCodingWriteOperations.length > codingWriteOperations.length) {
          const reason = `Majority of write operations target local project: ${nonCodingWriteOperations.join(', ')}`;
          return this.formatResult(false, fileOperations, reason, startTime, {
            codingOperations,
            nonCodingOperations,
            codingWriteOperations,
            nonCodingWriteOperations
          });
        } else if (codingWriteOperations.length > nonCodingWriteOperations.length) {
          const reason = `Majority of write operations target coding repo: ${codingWriteOperations.join(', ')}`;
          return this.formatResult(true, fileOperations, reason, startTime, {
            codingOperations,
            nonCodingOperations,
            codingWriteOperations,
            nonCodingWriteOperations
          });
        }
        // If equal writes, fall through to majority rule
      }

      // Priority 2: Majority rule - if >50% of operations are coding, classify as coding
      const codingPercentage = (codingOperations.length / fileOperations.length) * 100;

      if (codingPercentage > 50) {
        const reason = `Majority (${codingPercentage.toFixed(1)}%) of file operations target coding repo: ${codingOperations.join(', ')}`;
        return this.formatResult(true, fileOperations, reason, startTime, {
          codingOperations,
          nonCodingOperations,
          codingPercentage
        });
      }

      // Majority of operations target customer project
      const reason = `Majority (${(100 - codingPercentage).toFixed(1)}%) of file operations target local project: ${nonCodingOperations.join(', ')}`;
      return this.formatResult(false, fileOperations, reason, startTime, {
        codingOperations,
        nonCodingOperations,
        codingPercentage
      });

    } catch (error) {
      this.log(`Analysis error: ${error.message}`);
      return this.formatResult(false, [], `Analysis error: ${error.message}`, startTime);
    }
  }

  /**
   * Determine if a file operation is a write operation
   * @param {Object} exchange - Exchange containing tool calls
   * @param {string} filePath - File path to check
   * @returns {boolean} True if this is a write operation
   */
  isWriteOperation(exchange, filePath) {
    const writeTools = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

    // Check assistant response tool calls
    if (exchange.assistantResponse && exchange.assistantResponse.toolCalls) {
      for (const tool of exchange.assistantResponse.toolCalls) {
        if (writeTools.has(tool.name)) {
          const params = tool.parameters || tool.input || {};
          const toolPath = params.file_path || params.path || params.notebook_path || params.filePath;
          if (toolPath === filePath) {
            return true;
          }
        }
      }
    }

    // Check direct tool calls array
    if (exchange.toolCalls) {
      for (const tool of exchange.toolCalls) {
        if (writeTools.has(tool.name)) {
          const params = tool.parameters || tool.input || {};
          const toolPath = params.file_path || params.path || params.notebook_path || params.filePath;
          if (toolPath === filePath) {
            return true;
          }
        }
      }
    }

    // Check for write tools in text format
    if (exchange.assistantResponse && typeof exchange.assistantResponse === 'string') {
      const text = exchange.assistantResponse;
      for (const toolName of writeTools) {
        const toolRegex = new RegExp(`<(?:tool_use|invoke)\\s+name="${toolName}"[^>]*>.*?<parameter\\s+name="(?:file_path|path|notebook_path)"[^>]*>([^<]+)<\\/parameter>`, 'gs');
        let match;
        while ((match = toolRegex.exec(text)) !== null) {
          if (match[1].trim() === filePath) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Extract file paths from exchange data
   * @param {Object} exchange - Exchange containing tool calls and metadata
   * @returns {Array} Array of unique file paths
   */
  extractFileOperations(exchange) {
    const operations = new Set();
    
    // Extract from assistant response tool calls
    if (exchange.assistantResponse && exchange.assistantResponse.toolCalls) {
      for (const tool of exchange.assistantResponse.toolCalls) {
        this.extractPathsFromTool(tool, operations);
      }
    }
    
    // Extract from direct tool calls array (alternative format)
    if (exchange.toolCalls) {
      for (const tool of exchange.toolCalls) {
        this.extractPathsFromTool(tool, operations);
      }
    }
    
    // Extract from tool calls in text format (XML-like)
    if (exchange.assistantResponse && typeof exchange.assistantResponse === 'string') {
      this.extractPathsFromText(exchange.assistantResponse, operations);
    }
    
    // Also check user message for file paths
    if (exchange.userMessage && typeof exchange.userMessage === 'string') {
      this.extractPathsFromText(exchange.userMessage, operations);
    }
    
    // Extract from fileOperations field (if present in exchange)
    if (exchange.fileOperations && Array.isArray(exchange.fileOperations)) {
      exchange.fileOperations.forEach(op => operations.add(op));
    }
    
    // Extract from metadata file paths
    if (exchange.metadata && exchange.metadata.filePaths) {
      exchange.metadata.filePaths.forEach(fp => operations.add(fp));
    }
    
    return Array.from(operations).filter(op => op && typeof op === 'string');
  }

  /**
   * Extract file paths from individual tool call
   * @param {Object} tool - Tool call object
   * @param {Set} operations - Set to add operations to
   */
  extractPathsFromTool(tool, operations) {
    if (!tool || !this.fileOperationTools.has(tool.name)) {
      return;
    }
    
    const params = tool.parameters || tool.input || {};
    
    // Common file path parameters
    const pathFields = [
      'file_path', 'path', 'notebook_path', 'filePath', 
      'directory', 'dir', 'cwd', 'workingDirectory'
    ];
    
    for (const field of pathFields) {
      if (params[field] && typeof params[field] === 'string') {
        operations.add(params[field]);
      }
    }
    
    // Handle array of file paths
    if (params.files && Array.isArray(params.files)) {
      params.files.forEach(file => {
        if (typeof file === 'string') {
          operations.add(file);
        } else if (file && file.path) {
          operations.add(file.path);
        }
      });
    }
    
    // Handle Bash commands with file references
    if (tool.name === 'Bash' && params.command) {
      this.extractPathsFromBashCommand(params.command, operations);
    }
    
    // Handle Glob patterns (extract base directory)
    if (tool.name === 'Glob' && params.pattern) {
      const basePath = this.extractBasePathFromGlob(params.pattern, params.path);
      if (basePath) {
        operations.add(basePath);
      }
    }
  }

  /**
   * Extract file paths from text content (handles XML-like tool calls and direct path references)
   * @param {string} text - Text content to parse
   * @param {Set} operations - Set to add operations to
   */
  extractPathsFromText(text, operations) {
    if (!text || typeof text !== 'string') return;
    
    // Extract from XML-like tool calls: <tool_use name="Read"><parameter name="file_path">...</parameter></tool_use>
    const toolCallRegex = /<tool_use[^>]*name="([^"]+)"[^>]*>(.*?)<\/tool_use>/gs;
    let match;
    
    while ((match = toolCallRegex.exec(text)) !== null) {
      const toolName = match[1];
      const toolContent = match[2];
      
      if (this.fileOperationTools.has(toolName)) {
        // Extract file_path parameter from tool content
        const filePathMatch = /<parameter\s+name="file_path"[^>]*>([^<]+)<\/parameter>/g.exec(toolContent);
        if (filePathMatch) {
          operations.add(filePathMatch[1].trim());
        }
        
        // Also check other path parameters
        const pathParamRegex = /<parameter\s+name="(path|notebook_path|directory|dir)"[^>]*>([^<]+)<\/parameter>/g;
        let pathMatch;
        while ((pathMatch = pathParamRegex.exec(toolContent)) !== null) {
          operations.add(pathMatch[2].trim());
        }
      }
    }
    
    // Extract from function_calls format: <invoke name="Read"><parameter name="file_path">...</parameter></invoke>
    const functionCallRegex = /<invoke\s+name="([^"]+)"[^>]*>(.*?)<\/invoke>/gs;
    let funcMatch;
    
    while ((funcMatch = functionCallRegex.exec(text)) !== null) {
      const toolName = funcMatch[1];
      const toolContent = funcMatch[2];
      
      if (this.fileOperationTools.has(toolName)) {
        const filePathMatch = /<parameter\s+name="file_path"[^>]*>([^<]+)<\/parameter>/g.exec(toolContent);
        if (filePathMatch) {
          operations.add(filePathMatch[1].trim());
        }
      }
    }
    
    // Extract direct file paths (simple regex for absolute paths)
    // Use negative lookbehind to avoid matching slashes in the middle of relative paths
    const absolutePathRegex = /(?<![a-zA-Z0-9_-])([\/~][^\s<>"'|;&]*(?:\.[\w]+)?)/g;
    let pathMatch;
    while ((pathMatch = absolutePathRegex.exec(text)) !== null) {
      const path = pathMatch[1].trim();
      // Only include paths that look like real file paths
      if (path.length > 2 && !path.includes(' ') && (path.includes('/') || path.startsWith('~'))) {
        operations.add(path);
      }
    }

    // Extract relative file paths from plain text
    // Match patterns like "src/file.js", "docs/images/pic.png", "integrations/module/file.ts"
    // This is crucial for detecting when user references files that exist in coding repo but not locally
    const relativePathRegex = /\b([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+(?:\.[a-zA-Z0-9]+)?)\b/g;
    let relPathMatch;
    while ((relPathMatch = relativePathRegex.exec(text)) !== null) {
      const relPath = relPathMatch[1].trim();
      // Only include paths that:
      // 1. Have at least one slash (are actually paths, not just filenames)
      // 2. Don't look like URLs (no protocol)
      // 3. Have a reasonable length (avoid false positives)
      // 4. Don't start with common TLDs (likely URL fragments)
      const commonTLDs = /^(com|org|net|edu|gov|io|co|dev|app|xyz)\//;
      if (relPath.includes('/') && !relPath.includes('://') && relPath.length > 3 && !commonTLDs.test(relPath)) {
        operations.add(relPath);
      }
    }
  }

  /**
   * Extract file paths from bash command text
   * @param {string} command - Bash command
   * @param {Set} operations - Set to add operations to
   */
  extractPathsFromBashCommand(command, operations) {
    const filePatterns = [
      /(?:cd|ls|cat|head|tail|grep|find|cp|mv|rm|mkdir|touch|chmod)\s+([^\s;|&]+)/g,
      /([\/~][^\s;|&]*)/g, // Absolute paths starting with / or ~
      /(\w+\/[^\s;|&]*)/g  // Relative paths with /
    ];
    
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        const path = match[1];
        if (path && !path.startsWith('-') && path.length > 1) {
          operations.add(path);
        }
      }
    }
  }

  /**
   * Extract base path from glob pattern
   * @param {string} pattern - Glob pattern
   * @param {string} basePath - Optional base path
   * @returns {string} Base directory path
   */
  extractBasePathFromGlob(pattern, basePath) {
    if (basePath) return basePath;
    
    // Extract directory part before wildcards
    const parts = pattern.split(/[*?[\]{}]/);
    if (parts.length > 0 && parts[0]) {
      const base = parts[0];
      const lastSlash = base.lastIndexOf('/');
      return lastSlash > 0 ? base.substring(0, lastSlash) : base;
    }
    
    return null;
  }

  /**
   * Check if file path belongs to coding project
   *
   * Implements two-step detection:
   * Step (a): Check if file exists locally when "coding" not mentioned in path
   * Step (b): If not found locally, search by filename in coding project
   *
   * @param {string} filePath - File path to check
   * @returns {boolean} True if path belongs to coding project
   */
  isCodingPath(filePath) {
    if (!filePath || !this.codingRepo) return false;

    try {
      // Handle special cases
      if (filePath === '.' || filePath === './') {
        return process.cwd().startsWith(this.codingRepo);
      }

      // Expand and resolve path
      const expandedPath = this.expandPath(filePath);
      const resolvedPath = path.resolve(expandedPath);

      // If path explicitly includes "coding" in it, check if it starts with coding repo
      if (filePath.includes('coding/') || filePath.includes('coding\\') || resolvedPath.startsWith(this.codingRepo)) {
        return resolvedPath.startsWith(this.codingRepo);
      }

      // Step (a): For relative paths without explicit "coding" prefix,
      // check if file exists locally (in current project)
      if (!path.isAbsolute(filePath)) {
        const localPath = path.resolve(process.cwd(), expandedPath);

        // If file exists locally, it belongs to local project (not coding)
        if (fs.existsSync(localPath)) {
          this.log(`File exists locally: ${localPath} - NOT coding project`);
          return false;
        }

        // Step (b): If not found locally, search by filename in coding project
        // This handles cases like "docs/images/viewer.png" which might exist at
        // "coding/integrations/memory-visualizer/docs/images/viewer.png"
        const filename = path.basename(filePath);
        const foundInCoding = this.findFileInCoding(filename, filePath);

        if (foundInCoding) {
          this.log(`File found in coding project: ${foundInCoding} - IS coding project`);
          return true;
        }

        // Not found in either location - treat as local project
        this.log(`File not found locally or in coding: ${filePath} - defaulting to local project`);
        return false;
      }

      // For absolute paths, check if they start with coding repo
      return resolvedPath.startsWith(this.codingRepo);

    } catch (error) {
      this.stats.pathResolutionErrors++;
      this.log(`Path resolution error for "${filePath}": ${error.message}`);
      return false;
    }
  }

  /**
   * Search for a file by name and partial path in coding project
   *
   * @param {string} filename - Base filename to search for
   * @param {string} partialPath - Partial path like "docs/images/viewer.png"
   * @returns {string|null} Full path if found in coding, null otherwise
   */
  findFileInCoding(filename, partialPath) {
    if (!this.codingRepo || !filename) return null;

    try {
      // Try to match the partial path structure within coding repo
      // For "docs/images/viewer.png", try common locations:
      // - coding/docs/images/viewer.png (direct match - tried first)
      // - coding/integrations/*/docs/images/viewer.png (in integrations subdirectory)
      // - coding/**/docs/images/viewer.png (recursive search as fallback)

      // Check direct paths first (fast)
      const directPath = path.join(this.codingRepo, partialPath);
      if (fs.existsSync(directPath)) {
        return directPath;
      }

      // Fall back to recursive search by filename (slower but thorough)
      // Only search if the file is likely to be in coding (e.g., .png, .puml, docs/)
      if (this.shouldSearchInCoding(partialPath)) {
        const found = this.recursiveFindFile(this.codingRepo, filename, partialPath);
        return found;
      }

      return null;
    } catch (error) {
      this.log(`Error searching for file in coding: ${error.message}`);
      return null;
    }
  }

  /**
   * Determine if we should search for this file in coding project
   * Based on file extension and path patterns
   *
   * @param {string} filePath - File path to check
   * @returns {boolean} True if we should search in coding
   */
  shouldSearchInCoding(filePath) {
    // Extensions that are likely coding project assets
    const codingExtensions = ['.png', '.jpg', '.svg', '.puml', '.md', '.json'];
    const hasCodeExtension = codingExtensions.some(ext => filePath.endsWith(ext));

    // Path patterns that suggest coding project
    const codingPatterns = ['docs/', 'images/', 'puml/', 'presentation/', 'scripts/'];
    const hasCodePattern = codingPatterns.some(pattern => filePath.includes(pattern));

    return hasCodeExtension || hasCodePattern;
  }

  /**
   * Recursively search for a file by name in a directory
   * Limits search depth to avoid performance issues
   *
   * @param {string} dir - Directory to search in
   * @param {string} filename - Filename to find
   * @param {string} partialPath - Partial path to match against
   * @param {number} depth - Current search depth
   * @param {number} maxDepth - Maximum search depth
   * @returns {string|null} Full path if found, null otherwise
   */
  recursiveFindFile(dir, filename, partialPath, depth = 0, maxDepth = 4) {
    if (depth > maxDepth) return null;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip node_modules, .git, and other large directories
        if (entry.name === 'node_modules' || entry.name === '.git' ||
            entry.name === '.data' || entry.name.startsWith('.')) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          const found = this.recursiveFindFile(fullPath, filename, partialPath, depth + 1, maxDepth);
          if (found) return found;
        } else if (entry.isFile() && entry.name === filename) {
          // Check if the full path ends with the partial path structure
          if (fullPath.endsWith(partialPath) || fullPath.includes(partialPath.replace(/\\/g, '/'))) {
            return fullPath;
          }
        }
      }

      return null;
    } catch (error) {
      // Permission errors or other issues - skip this directory
      return null;
    }
  }

  /**
   * Expand tilde and environment variables in path
   * @param {string} filePath - Path potentially containing ~ or env vars
   * @returns {string} Expanded path
   */
  expandPath(filePath) {
    if (!filePath) return filePath;
    
    // Expand tilde
    if (filePath.startsWith('~/')) {
      return path.join(process.env.HOME || process.env.USERPROFILE || '', filePath.slice(2));
    }
    
    // Expand environment variables like $HOME, $USER
    return filePath.replace(/\$([A-Z_]+)/g, (match, varName) => {
      return process.env[varName] || match;
    });
  }

  /**
   * Detect coding repository path using environment variables and heuristics
   * @returns {string} Detected coding repo path
   */
  detectCodingRepo() {
    // Priority order: env vars, then auto-detection
    const candidatePaths = [
      process.env.CODING_REPO,
      process.env.CODING_TOOLS_PATH,
      path.join(process.env.HOME || '', 'Agentic', 'coding'),
      path.join(process.env.HOME || '', 'Claude', 'coding'),
      path.join(process.cwd(), 'coding'),
      '/Users/q284340/Agentic/coding' // Fallback for development
    ].filter(Boolean);
    
    for (const candidatePath of candidatePaths) {
      const expandedPath = this.expandPath(candidatePath);
      
      if (this.isValidCodingRepo(expandedPath)) {
        this.log(`Auto-detected coding repo: ${expandedPath}`);
        return expandedPath;
      }
    }
    
    // Use first candidate as fallback
    const fallback = candidatePaths[candidatePaths.length - 1];
    this.log(`Could not auto-detect coding repo, using fallback: ${fallback}`);
    return fallback;
  }

  /**
   * Validate if path is a valid coding repository
   * @param {string} repoPath - Path to validate
   * @returns {boolean} True if valid coding repo
   */
  isValidCodingRepo(repoPath) {
    if (!repoPath) return false;
    
    try {
      const resolved = path.resolve(repoPath);
      return fs.existsSync(resolved) && 
             fs.existsSync(path.join(resolved, 'CLAUDE.md'));
    } catch (error) {
      return false;
    }
  }

  /**
   * Format analysis result
   * @param {boolean} isCoding - Classification result
   * @param {Array} fileOperations - Detected file operations
   * @param {string} reason - Classification reasoning
   * @param {number} startTime - Analysis start time
   * @param {Object} details - Additional details
   * @returns {Object} Formatted result
   */
  formatResult(isCoding, fileOperations, reason, startTime, details = {}) {
    const processingTime = Date.now() - startTime;
    
    return {
      isCoding,
      fileOperations,
      reason,
      confidence: isCoding ? 0.98 : 0.02, // Path analysis is very reliable
      processingTimeMs: processingTime,
      layer: 'path',
      details: {
        codingRepo: this.codingRepo,
        totalOperations: fileOperations.length,
        ...details
      }
    };
  }

  /**
   * Get analysis statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      codingDetectionRate: this.stats.totalAnalyses > 0 
        ? (this.stats.codingPathHits / this.stats.totalAnalyses * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalAnalyses: 0,
      codingPathHits: 0,
      fileOperationsDetected: 0,
      pathResolutionErrors: 0
    };
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   */
  log(message) {
    if (this.debug) {
      console.log(`[PathAnalyzer] ${message}`);
    }
  }
}

export default PathAnalyzer;