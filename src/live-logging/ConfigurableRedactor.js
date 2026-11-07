#!/usr/bin/env node

/**
 * Configurable Redactor - Maintainable Data Sanitization System
 * 
 * Replaces hard-coded redaction patterns with configurable, maintainable system
 * while preserving all existing security features.
 * 
 * Features:
 * - JSON configuration loading with validation
 * - Pattern validation and testing
 * - Performance optimization with compiled patterns
 * - Secure defaults if configuration fails
 * - Comprehensive logging and error handling
 * - Backward compatibility with existing redaction function
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The redaction rules ship with the coding tools repo (config/redaction/), not
// with the project being logged: every writer — ETM, obs-api, the batch
// processor, rapid-llm-proxy via enhanced-redaction-system.cjs — applies the
// same set, wherever its cwd happens to be.
export const REDACTION_CONFIG_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'redaction');

class ConfigurableRedactor {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.configPath = options.configPath || null;

    // Default configuration directory
    this.defaultConfigDir = REDACTION_CONFIG_DIR;
    this.defaultConfigPath = path.join(this.defaultConfigDir, 'redaction-patterns.json');
    this.defaultSchemaPath = path.join(this.defaultConfigDir, 'redaction-schema.json');
    
    // Runtime state
    this.patterns = [];
    this.compiledPatterns = [];
    this.isInitialized = false;
    this.loadErrors = [];
    
    // Performance tracking
    this.stats = {
      configurationsLoaded: 0,
      patternsCompiled: 0,
      redactionsPerformed: 0,
      totalProcessingTime: 0,
      avgRedactionTime: 0,
      patternValidationErrors: 0
    };
  }

  /**
   * Initialize the redactor by loading and compiling patterns
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    const startTime = Date.now();
    
    try {
      // Load configuration
      const config = await this.loadConfiguration();
      
      // Validate configuration
      const validationResult = this.validateConfiguration(config);
      if (!validationResult.isValid) {
        this.log(`Configuration validation failed: ${validationResult.errors.join(', ')}`);
        throw new Error(`Configuration validation failed: ${validationResult.errors.join(', ')}`);
      }
      
      // Compile patterns for performance
      this.compilePatterns(config.patterns);
      
      this.isInitialized = true;
      this.stats.configurationsLoaded++;
      this.stats.patternsCompiled = this.compiledPatterns.length;
      
      const initTime = Date.now() - startTime;
      this.log(`ConfigurableRedactor initialized: ${this.compiledPatterns.length} patterns in ${initTime}ms`);
      
      return true;
    } catch (error) {
      this.loadErrors.push(error.message);
      console.error('ConfigurableRedactor initialization failed:', error.message);
      
      // NO FALLBACKS - fail properly instead of using defaults
      throw new Error(`ConfigurableRedactor initialization failed: ${error.message}`);
    }
  }

  /**
   * Load configuration from file or use defaults
   * @returns {Promise<object>} Configuration object
   */
  async loadConfiguration() {
    const configPath = this.configPath || this.defaultConfigPath;
    
    // A missing file is an error, never a cue to write defaults: the old
    // auto-create wrote a hardcoded pattern set over the REAL rules file
    // (defaultConfigPath) whenever a caller passed a wrong custom path.
    if (!fs.existsSync(configPath)) {
      throw new Error(`Redaction configuration not found: ${configPath}`);
    }
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent);
      
      this.log(`Configuration loaded: ${config.patterns?.length || 0} patterns from ${configPath}`);
      return config;
    } catch (error) {
      throw new Error(`Failed to load configuration from ${configPath}: ${error.message}`);
    }
  }

  /**
   * Validate configuration against schema and business rules
   * @param {object} config - Configuration to validate
   * @returns {object} Validation result
   */
  validateConfiguration(config) {
    const errors = [];

    // Basic structure validation
    if (!config || typeof config !== 'object') {
      errors.push('Configuration must be an object');
      return { isValid: false, errors };
    }

    if (!config.version || typeof config.version !== 'string') {
      errors.push('Configuration must have a version string');
    }

    if (!Array.isArray(config.patterns)) {
      errors.push('Configuration must have a patterns array');
      return { isValid: false, errors };
    }

    // Validate each pattern
    const patternIds = new Set();
    config.patterns.forEach((pattern, index) => {
      const prefix = `Pattern ${index + 1}`;

      // Required fields
      ['id', 'name', 'pattern', 'flags', 'replacementType', 'replacement', 'enabled', 'severity'].forEach(field => {
        if (!(field in pattern)) {
          errors.push(`${prefix}: Missing required field '${field}'`);
        }
      });

      // Unique IDs
      if (pattern.id) {
        if (patternIds.has(pattern.id)) {
          errors.push(`${prefix}: Duplicate pattern ID '${pattern.id}'`);
        }
        patternIds.add(pattern.id);
      }

      // Validate regex pattern
      if (pattern.pattern) {
        try {
          new RegExp(pattern.pattern, pattern.flags || '');
        } catch (regexError) {
          errors.push(`${prefix}: Invalid regex pattern: ${regexError.message}`);
          this.stats.patternValidationErrors++;
        }
      }

      // Validate severity
      const validSeverities = ['low', 'medium', 'high', 'critical'];
      if (pattern.severity && !validSeverities.includes(pattern.severity)) {
        errors.push(`${prefix}: Invalid severity '${pattern.severity}', must be one of: ${validSeverities.join(', ')}`);
      }

      // Validate replacement type
      const validTypes = ['env_var', 'json_key', 'generic', 'bearer_token', 'connection_string', 'email', 'user_id', 'company_name'];
      if (pattern.replacementType && !validTypes.includes(pattern.replacementType)) {
        errors.push(`${prefix}: Invalid replacementType '${pattern.replacementType}', must be one of: ${validTypes.join(', ')}`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      patternCount: config.patterns.length
    };
  }

  /**
   * Compile patterns for performance
   * @param {array} patterns - Array of pattern configurations
   */
  compilePatterns(patterns) {
    this.compiledPatterns = [];

    patterns.forEach(patternConfig => {
      if (!patternConfig.enabled) {
        return;
      }

      try {
        const compiledPattern = {
          id: patternConfig.id,
          name: patternConfig.name,
          regex: new RegExp(patternConfig.pattern, patternConfig.flags),
          replacementType: patternConfig.replacementType,
          replacement: patternConfig.replacement,
          severity: patternConfig.severity,
          config: patternConfig
        };

        this.compiledPatterns.push(compiledPattern);
      } catch (error) {
        console.error(`Failed to compile pattern ${patternConfig.id}: ${error.message}`);
        this.stats.patternValidationErrors++;
      }
    });

    this.log(`Compiled ${this.compiledPatterns.length} patterns for runtime use`);
  }

  /**
   * Redact sensitive information from text using configured patterns
   * @param {string} text - Text to redact
   * @returns {string} Redacted text
   */
  redact(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    if (!this.isInitialized) {
      throw new Error('ConfigurableRedactor not initialized. Call initialize() with proper configuration first.');
    }

    const startTime = Date.now();
    let redactedText = text;

    // A pattern that throws leaves whatever it should have caught in the
    // text, so it fails the whole redaction instead of being skipped.
    this.compiledPatterns.forEach(compiledPattern => {
      try {
        redactedText = this.applyPatternRedaction(redactedText, compiledPattern);
      } catch (error) {
        throw new Error(`redaction pattern ${compiledPattern.id} failed: ${error.message}`);
      }
    });

    // Update performance stats
    const processingTime = Date.now() - startTime;
    this.stats.redactionsPerformed++;
    this.stats.totalProcessingTime += processingTime;
    this.stats.avgRedactionTime = this.stats.totalProcessingTime / this.stats.redactionsPerformed;

    return redactedText;
  }

  /**
   * Apply a specific pattern redaction with replacement logic
   * @param {string} text - Text to process
   * @param {object} compiledPattern - Compiled pattern object
   * @returns {string} Processed text
   */
  applyPatternRedaction(text, compiledPattern) {
    const { regex, replacementType, replacement } = compiledPattern;

    switch (replacementType) {
      case 'env_var':
        return text.replace(regex, (match, keyName) => {
          return `${keyName}=<SECRET_REDACTED>`;
        });
      
      case 'json_key':
        return text.replace(regex, (match, keyName) => {
          return `"${keyName}": "<SECRET_REDACTED>"`;
        });
      
      case 'connection_string':
        return text.replace(regex, (match) => {
          const protocol = match.split(':')[0];
          return `${protocol}://<CONNECTION_STRING_REDACTED>`;
        });
      
      case 'bearer_token':
        return text.replace(regex, 'Bearer <TOKEN_REDACTED>');
      
      case 'email':
        return text.replace(regex, '<EMAIL_REDACTED>');
      
      case 'user_id':
        return text.replace(regex, '<USER_ID_REDACTED>');
      
      case 'company_name':
        return text.replace(regex, '<COMPANY_NAME_REDACTED>');
      
      case 'generic':
      default:
        return text.replace(regex, replacement);
    }
  }

  /**
   * Load secure default patterns if configuration fails
   */
  loadSecureDefaults() {
    this.log('Loading secure default redaction patterns');
    
    const secureDefaults = [
      {
        id: 'emergency_api_keys',
        regex: /\b(sk-[a-zA-Z0-9]{20,}|xai-[a-zA-Z0-9]{20,}|gh[pousr]_[a-zA-Z0-9]{36,255}|github_pat_[a-zA-Z0-9_]{22,255})/gi,
        replacementType: 'generic',
        replacement: '<SECRET_REDACTED>',
        severity: 'critical'
      },
      {
        id: 'emergency_env_vars',
        regex: /\b(API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*[^\s]+/gi,
        replacementType: 'generic',
        replacement: '<SECRET_REDACTED>',
        severity: 'critical'
      },
      {
        id: 'emergency_emails',
        regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
        replacementType: 'email',
        replacement: '<EMAIL_REDACTED>',
        severity: 'medium'
      }
    ];

    this.compiledPatterns = secureDefaults.map(pattern => ({
      ...pattern,
      name: 'Emergency Default',
      config: pattern
    }));

    this.log(`Loaded ${this.compiledPatterns.length} emergency default patterns`);
  }

  /**
   * Get redactor statistics
   * @returns {object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      patternsActive: this.compiledPatterns.length,
      isInitialized: this.isInitialized,
      hasErrors: this.loadErrors.length > 0,
      errorCount: this.loadErrors.length
    };
  }

  /**
   * Test redaction patterns against sample data
   * @param {string} testText - Text to test
   * @returns {object} Test results
   */
  testPatterns(testText) {
    const results = [];
    
    this.compiledPatterns.forEach(pattern => {
      const matches = [];
      let match;
      
      // Reset regex state
      pattern.regex.lastIndex = 0;
      
      while ((match = pattern.regex.exec(testText)) !== null) {
        matches.push({
          match: match[0],
          index: match.index,
          groups: match.slice(1)
        });
        
        // Prevent infinite loops on global regex
        if (!pattern.regex.global) break;
      }
      
      if (matches.length > 0) {
        results.push({
          patternId: pattern.id,
          patternName: pattern.name,
          matchCount: matches.length,
          matches: matches.slice(0, 5), // Limit to first 5 matches
          severity: pattern.severity
        });
      }
    });
    
    return {
      testText,
      redactedText: this.redact(testText),
      patternResults: results,
      totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0)
    };
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   */
  log(message) {
    if (this.debug) {
      console.log(`[ConfigurableRedactor] ${message}`);
    }
  }
}

// Static convenience method
ConfigurableRedactor.redactText = function(text, options = {}) {
  const redactor = new ConfigurableRedactor(options);
  if (!redactor.isInitialized) {
    redactor.loadSecureDefaults();
  }
  return redactor.redact(text);
};

export default ConfigurableRedactor;

// CLI usage when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const redactor = new ConfigurableRedactor({ debug: true });
  
  console.log('=== ConfigurableRedactor Test ===');
  
  redactor.initialize().then(() => {
    const testText = `
      API_KEY=sk-1234567890abcdef
      "openaiApiKey": "sk-abcdef1234567890"
      Bearer xyz789token
      postgres://user:pass@localhost/db
      contact@example.com
      q284340 worked at BMW
    `;
    
    console.log('Original text:', testText);
    console.log('Redacted text:', redactor.redact(testText));
    console.log('Stats:', JSON.stringify(redactor.getStats(), null, 2));
    console.log('Test Results:', JSON.stringify(redactor.testPatterns(testText), null, 2));
  }).catch(console.error);
}