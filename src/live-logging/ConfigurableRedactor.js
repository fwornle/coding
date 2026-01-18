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

class ConfigurableRedactor {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.configPath = options.configPath || null;
    this.projectPath = options.projectPath || process.cwd();
    
    // Default configuration directory
    this.defaultConfigDir = path.join(this.projectPath, '.specstory', 'config');
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
    
    if (!fs.existsSync(configPath)) {
      this.log(`Configuration file not found: ${configPath}, creating default configuration`);
      await this.createDefaultConfiguration();
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
   * Create default configuration file with all current patterns
   * @returns {Promise<void>}
   */
  async createDefaultConfiguration() {
    const defaultConfig = {
      version: "1.0.0",
      description: "Configurable redaction patterns for LSL system",
      enabled: true,
      patterns: [
        {
          id: "env_vars",
          name: "Environment Variables",
          description: "API keys and secrets in KEY=value format",
          pattern: "\\b(ANTHROPIC_API_KEY|ANTHROPIC_ADMIN_API_KEY|OPENAI_API_KEY|OPENAI_ADMIN_API_KEY|GROK_API_KEY|XAI_API_KEY|GEMINI_API_KEY|CLAUDE_API_KEY|GPT_API_KEY|DEEPMIND_API_KEY|COHERE_API_KEY|HUGGINGFACE_API_KEY|HF_API_KEY|REPLICATE_API_KEY|TOGETHER_API_KEY|PERPLEXITY_API_KEY|AI21_API_KEY|GOOGLE_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AZURE_API_KEY|GCP_API_KEY|GITHUB_TOKEN|GITLAB_TOKEN|BITBUCKET_TOKEN|NPM_TOKEN|PYPI_TOKEN|DOCKER_TOKEN|SLACK_TOKEN|DISCORD_TOKEN|TELEGRAM_TOKEN|STRIPE_API_KEY|SENDGRID_API_KEY|MAILGUN_API_KEY|TWILIO_AUTH_TOKEN|FIREBASE_API_KEY|SUPABASE_API_KEY|MONGODB_URI|POSTGRES_PASSWORD|MYSQL_PASSWORD|REDIS_PASSWORD|DATABASE_URL|CONNECTION_STRING|JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY|PRIVATE_KEY|SECRET_KEY|CLIENT_SECRET|API_SECRET|WEBHOOK_SECRET)\\s*=\\s*[\"']?([^\"'\\s\\n]+)[\"']?",
          flags: "gi",
          replacementType: "env_var",
          replacement: "$1=<SECRET_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "json_api_keys", 
          name: "JSON API Keys",
          description: "API keys in JSON format",
          pattern: "\"(apiKey|API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY|GROK_API_KEY|api_key|anthropicApiKey|openaiApiKey|xaiApiKey|grokApiKey)\":\\s*\"(sk-[a-zA-Z0-9-_]{20,}|xai-[a-zA-Z0-9-_]{20,}|[a-zA-Z0-9-_]{32,})\"",
          flags: "gi",
          replacementType: "json_key",
          replacement: "\"$1\": \"<SECRET_REDACTED>\"",
          enabled: true,
          severity: "critical"
        },
        {
          id: "sk_ant_admin_keys",
          name: "Anthropic Admin API Keys",
          description: "Anthropic Admin API keys with sk-ant-admin- prefix",
          pattern: "\\bsk-ant-admin-[a-zA-Z0-9_-]{20,}",
          flags: "gi",
          replacementType: "generic",
          replacement: "<SECRET_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "sk_ant_keys",
          name: "Anthropic API Keys",
          description: "Anthropic API keys with sk-ant- prefix (non-admin)",
          pattern: "\\bsk-ant-[a-zA-Z0-9_-]{20,}",
          flags: "gi",
          replacementType: "generic",
          replacement: "<SECRET_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "sk_keys",
          name: "sk- Prefixed Keys",
          description: "OpenAI and similar API keys with sk- prefix (includes hyphens)",
          pattern: "\\bsk-[a-zA-Z0-9_-]{20,}",
          flags: "gi",
          replacementType: "generic",
          replacement: "<SECRET_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "xai_keys",
          name: "XAI API Keys",
          description: "XAI/Grok API keys with xai- prefix",
          pattern: "\\bxai-[a-zA-Z0-9_-]{20,}",
          flags: "gi",
          replacementType: "generic",
          replacement: "<SECRET_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "groq_keys",
          name: "Groq API Keys",
          description: "Groq API keys with gsk_ prefix",
          pattern: "\\bgsk_[a-zA-Z0-9]{20,}",
          flags: "gi",
          replacementType: "generic",
          replacement: "<SECRET_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_access_key_id_json",
          name: "AWS Access Key ID (JSON)",
          description: "AWS Access Key IDs in JSON format (AKIA*/ASIA* prefixes)",
          pattern: "\"(AccessKeyId|aws_access_key_id|accessKeyId)\"\\s*:\\s*\"(A[SK]IA[A-Z0-9]{12,})\"",
          flags: "gi",
          replacementType: "json_key",
          replacement: "\"$1\": \"<AWS_KEY_REDACTED>\"",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_secret_access_key_json",
          name: "AWS Secret Access Key (JSON)",
          description: "AWS Secret Access Keys in JSON format (40+ char base64-like)",
          pattern: "\"(SecretAccessKey|aws_secret_access_key|secretAccessKey)\"\\s*:\\s*\"([a-zA-Z0-9+/]{20,})\"",
          flags: "gi",
          replacementType: "json_key",
          replacement: "\"$1\": \"<AWS_SECRET_REDACTED>\"",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_session_token_json",
          name: "AWS Session Token (JSON)",
          description: "AWS Session Tokens in JSON format (long base64 strings, may span lines)",
          pattern: "\"(SessionToken|aws_session_token|sessionToken)\"\\s*:\\s*\"([a-zA-Z0-9+/=\\s]{50,})\"",
          flags: "gi",
          replacementType: "json_key",
          replacement: "\"$1\": \"<AWS_TOKEN_REDACTED>\"",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_session_token_standalone",
          name: "AWS Session Token (Standalone)",
          description: "AWS STS Session Tokens with IQoJb3JpZ2lu base64 prefix (decoded: {\"origin\")",
          pattern: "IQoJb3JpZ2lu[a-zA-Z0-9+/=]{20,}",
          flags: "g",
          replacementType: "generic",
          replacement: "<AWS_TOKEN_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_session_token_truncated",
          name: "AWS Session Token (Truncated refs)",
          description: "Truncated AWS Session Token references in logs/docs",
          pattern: "IQoJb3JpZ2lu[a-zA-Z0-9+/=]*\\.{2,3}",
          flags: "g",
          replacementType: "generic",
          replacement: "<AWS_TOKEN_REDACTED>...",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_access_key_standalone",
          name: "AWS Access Key ID (Standalone)",
          description: "Standalone AWS Access Key IDs (AKIA*/ASIA* prefixes)",
          pattern: "\\bA[SK]IA[A-Z0-9]{12,}\\b",
          flags: "g",
          replacementType: "generic",
          replacement: "<AWS_KEY_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_secret_standalone",
          name: "AWS Secret Access Key (Standalone)",
          description: "Standalone AWS Secret Access Keys (40 char base64-like with + and /)",
          pattern: "[a-zA-Z0-9+/]{40}",
          flags: "g",
          replacementType: "generic",
          replacement: "<AWS_SECRET_REDACTED>",
          enabled: true,
          severity: "high"
        },
        {
          id: "aws_secret_in_context",
          name: "AWS Secret in Context",
          description: "AWS Secrets appearing after keywords like Secret:, SecretKey:, etc.",
          pattern: "(Secret|SecretKey|SecretAccessKey|secret_key)[:\\s]+[a-zA-Z0-9+/]{20,}",
          flags: "gi",
          replacementType: "generic",
          replacement: "$1: <AWS_SECRET_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_secret_truncated",
          name: "AWS Secret (Truncated)",
          description: "Truncated AWS secrets in logs (base64-like followed by ...)",
          pattern: "[a-zA-Z0-9+/]{8,}\\+[a-zA-Z0-9+/]*\\.{2,3}",
          flags: "g",
          replacementType: "generic",
          replacement: "<AWS_SECRET_REDACTED>...",
          enabled: true,
          severity: "critical"
        },
        {
          id: "aws_credentials_block",
          name: "AWS Credentials Block",
          description: "Full AWS credentials JSON blocks from CLI output",
          pattern: "\\{[^}]*[\"']?(AccessKeyId|Credentials)[\"']?[^}]*\\}",
          flags: "gi",
          replacementType: "generic",
          replacement: "{<AWS_CREDENTIALS_REDACTED>}",
          enabled: true,
          severity: "critical"
        },
        {
          id: "generic_api_keys",
          name: "Generic API Keys",
          description: "Common API key formats with dashes/underscores",
          pattern: "\\b[a-zA-Z0-9]{32,}[-_][a-zA-Z0-9]{8,}",
          flags: "gi",
          replacementType: "generic",
          replacement: "<SECRET_REDACTED>",
          enabled: true,
          severity: "high"
        },
        {
          id: "bearer_tokens",
          name: "Bearer Tokens",
          description: "Authorization Bearer tokens",
          pattern: "Bearer\\s+[a-zA-Z0-9\\-._~+\\/]{20,}",
          flags: "gi",
          replacementType: "bearer_token",
          replacement: "Bearer <TOKEN_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "jwt_tokens",
          name: "JWT Tokens",
          description: "JSON Web Tokens (three base64 parts)",
          pattern: "\\beyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+",
          flags: "gi",
          replacementType: "generic",
          replacement: "<JWT_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "mongodb_urls",
          name: "MongoDB Connection Strings",
          description: "MongoDB connection URLs with credentials",
          pattern: "mongodb(\\+srv)?:\\/\\/[^:]+:[^@]+@[^\\s]+",
          flags: "gi",
          replacementType: "connection_string",
          replacement: "mongodb://<CONNECTION_STRING_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "postgres_urls",
          name: "PostgreSQL Connection Strings", 
          description: "PostgreSQL connection URLs with credentials",
          pattern: "postgres(ql)?:\\/\\/[^:]+:[^@]+@[^\\s]+",
          flags: "gi",
          replacementType: "connection_string",
          replacement: "postgresql://<CONNECTION_STRING_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "mysql_urls",
          name: "MySQL Connection Strings",
          description: "MySQL connection URLs with credentials", 
          pattern: "mysql:\\/\\/[^:]+:[^@]+@[^\\s]+",
          flags: "gi",
          replacementType: "connection_string",
          replacement: "mysql://<CONNECTION_STRING_REDACTED>",
          enabled: true,
          severity: "critical"
        },
        {
          id: "generic_urls_with_auth",
          name: "Generic URLs with Credentials",
          description: "HTTP/HTTPS URLs with embedded credentials",
          pattern: "https?:\\/\\/[^:]+:[^@]+@[^\\s]+",
          flags: "gi",
          replacementType: "connection_string",
          replacement: "http://<URL_WITH_CREDENTIALS_REDACTED>",
          enabled: true,
          severity: "high"
        },
        {
          id: "email_addresses",
          name: "Email Addresses",
          description: "Personal and corporate email addresses",
          pattern: "\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b",
          flags: "gi",
          replacementType: "email",
          replacement: "<EMAIL_REDACTED>",
          enabled: true,
          severity: "medium"
        },
        {
          id: "corporate_user_ids",
          name: "Corporate User IDs",
          description: "Corporate user identifiers (q + 6 characters)",
          pattern: "\\bq[0-9a-zA-Z]{6}\\b",
          flags: "gi",
          replacementType: "user_id",
          replacement: "<USER_ID_REDACTED>",
          enabled: true,
          severity: "medium"
        },
        {
          id: "corporate_names",
          name: "Corporate Company Names",
          description: "Well-known corporate and brand names",
          pattern: "\\b(BMW|Mercedes|Audi|Tesla|Microsoft|Google|Apple|Amazon|Meta|Facebook|IBM|Oracle|Cisco|Intel|Dell|HP|Lenovo|Samsung|LG|Sony|Panasonic|Siemens|SAP|Accenture|Deloitte|McKinsey|BCG|Bain|Goldman|Morgan|JPMorgan|Deutsche Bank|Commerzbank|Allianz|Munich Re|BASF|Bayer|Volkswagen|Porsche|Bosch|Continental|Airbus|Boeing|Lockheed|Northrop|Raytheon|General Electric|Ford|General Motors|Chrysler|Fiat|Renault|Peugeot|Citroen|Volvo|Scania|MAN|Daimler|ThyssenKrupp|Siemens Energy|RWE|EON|Uniper|TUI|Lufthansa|DHL|UPS|FedEx|TNT|Deutsche Post|Telekom|Vodafone|Orange|BT|Telefonica|Verizon|ATT|Sprint|TMobile)\\b",
          flags: "gi",
          replacementType: "company_name",
          replacement: "<COMPANY_NAME_REDACTED>",
          enabled: true,
          severity: "low"
        }
      ]
    };

    // Ensure config directory exists
    if (!fs.existsSync(this.defaultConfigDir)) {
      fs.mkdirSync(this.defaultConfigDir, { recursive: true });
    }

    // Write configuration file
    fs.writeFileSync(this.defaultConfigPath, JSON.stringify(defaultConfig, null, 2));
    this.log(`Created default configuration at: ${this.defaultConfigPath}`);
    
    // Also create the schema file
    await this.createConfigurationSchema();
  }

  /**
   * Create JSON schema for configuration validation
   * @returns {Promise<void>}
   */
  async createConfigurationSchema() {
    const schema = {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "Redaction Patterns Configuration",
      "description": "Schema for configurable redaction patterns in LSL system",
      "type": "object",
      "required": ["version", "patterns"],
      "properties": {
        "version": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$",
          "description": "Configuration version (semver)"
        },
        "description": {
          "type": "string",
          "description": "Human-readable description of the configuration"
        },
        "enabled": {
          "type": "boolean",
          "description": "Global enable/disable flag"
        },
        "patterns": {
          "type": "array",
          "description": "Array of redaction patterns",
          "items": {
            "type": "object",
            "required": ["id", "name", "pattern", "flags", "replacementType", "replacement", "enabled", "severity"],
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[a-z_]+$",
                "description": "Unique identifier for the pattern"
              },
              "name": {
                "type": "string",
                "description": "Human-readable name"
              },
              "description": {
                "type": "string", 
                "description": "Description of what this pattern matches"
              },
              "pattern": {
                "type": "string",
                "description": "Regular expression pattern (without delimiters)"
              },
              "flags": {
                "type": "string",
                "pattern": "^[gimuy]*$",
                "description": "Regular expression flags"
              },
              "replacementType": {
                "type": "string",
                "enum": ["env_var", "json_key", "generic", "bearer_token", "connection_string", "email", "user_id", "company_name"],
                "description": "Type of replacement logic to use"
              },
              "replacement": {
                "type": "string",
                "description": "Replacement string (may include capture groups)"
              },
              "enabled": {
                "type": "boolean",
                "description": "Enable/disable this pattern"
              },
              "severity": {
                "type": "string",
                "enum": ["low", "medium", "high", "critical"],
                "description": "Security severity level"
              }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    };

    fs.writeFileSync(this.defaultSchemaPath, JSON.stringify(schema, null, 2));
    this.log(`Created configuration schema at: ${this.defaultSchemaPath}`);
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

    this.compiledPatterns.forEach(compiledPattern => {
      try {
        redactedText = this.applyPatternRedaction(redactedText, compiledPattern);
      } catch (error) {
        console.error(`Error applying pattern ${compiledPattern.id}: ${error.message}`);
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
        regex: /\b(sk-[a-zA-Z0-9]{20,}|xai-[a-zA-Z0-9]{20,})/gi,
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