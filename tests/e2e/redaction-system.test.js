#!/usr/bin/env node

/**
 * Redaction System E2E Tests
 * 
 * Comprehensive test suite for the ConfigurableRedactor system to ensure
 * sensitive data is properly protected in Live Session Logging system.
 * 
 * Tests cover:
 * - All 40+ redaction patterns with realistic test data
 * - Configuration loading and validation
 * - Pattern performance and accuracy
 * - Edge cases and error handling
 * - Security compliance and validation
 * - Integration with enhanced-transcript-monitor
 * 
 * Requirements: 5.4 - Redaction system effectiveness
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import ConfigurableRedactor from '../../src/live-logging/ConfigurableRedactor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RedactionSystemTest {
  constructor(options = {}) {
    this.options = {
      verbose: false,
      keepData: false,
      timeout: 30000,
      ...options
    };
    
    this.testResults = [];
    this.testData = new Map();
    this.tempConfigDir = null;
    
    this.log('Redaction System Test Suite initialized');
  }

  log(message) {
    if (this.options.verbose) {
      console.log(`[RedactionSystem] ${new Date().toISOString()} ${message}`);
    }
  }

  async runAllTests() {
    this.log('Starting comprehensive redaction system E2E tests');
    
    const tests = [
      'basicRedactorInitialization',
      'configurationLoading',
      'configurationValidation',
      'allPatternRedactionTests',
      'performanceAndAccuracyTests',
      'configurationErrorHandling',
      'failClosedWithoutInitialization',
      'enhancedTranscriptMonitorIntegration'
    ];

    let passed = 0;
    let failed = 0;

    for (const testName of tests) {
      try {
        this.log(`Running test: ${testName}`);
        const result = await this[testName]();
        
        if (result.success) {
          passed++;
          this.log(`✓ ${testName} - PASSED`);
        } else {
          failed++;
          this.log(`✗ ${testName} - FAILED: ${result.error}`);
        }
        
        this.testResults.push({
          test: testName,
          success: result.success,
          error: result.error,
          details: result.details,
          duration: result.duration
        });
        
      } catch (error) {
        failed++;
        this.log(`✗ ${testName} - ERROR: ${error.message}`);
        this.testResults.push({
          test: testName,
          success: false,
          error: error.message,
          duration: 0
        });
      }
    }

    // Cleanup unless keeping data
    if (!this.options.keepData) {
      await this.cleanup();
    }

    this.log(`Tests completed: ${passed} passed, ${failed} failed`);
    
    return {
      success: failed === 0,
      passed,
      failed,
      total: tests.length,
      results: this.testResults
    };
  }

  async basicRedactorInitialization() {
    const startTime = Date.now();
    
    try {
      // Test basic instantiation
      const redactor = new ConfigurableRedactor({ debug: this.options.verbose });
      
      // Test initialization
      const initResult = await redactor.initialize();
      
      if (!redactor.isInitialized) {
        return {
          success: false,
          error: 'Redactor failed to initialize',
          duration: Date.now() - startTime
        };
      }
      
      // Test basic redaction functionality
      const testText = 'API_KEY=sk-1234567890abcdef';
      const redactedText = redactor.redact(testText);
      
      if (redactedText === testText) {
        return {
          success: false,
          error: 'Basic redaction did not modify test text',
          duration: Date.now() - startTime
        };
      }
      
      // Test stats collection
      const stats = redactor.getStats();
      if (!stats.isInitialized || stats.patternsActive === 0) {
        return {
          success: false,
          error: 'Redactor stats indicate problems with initialization',
          duration: Date.now() - startTime
        };
      }
      
      this.testData.set('basicRedactor', redactor);
      
      return {
        success: true,
        details: {
          initialized: initResult,
          patternsLoaded: stats.patternsActive,
          basicRedactionWorking: redactedText !== testText
        },
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async configurationLoading() {
    const startTime = Date.now();
    
    try {
      // Create temporary configuration directory
      this.tempConfigDir = path.join('/tmp', `redaction-test-${Date.now()}`);
      fs.mkdirSync(this.tempConfigDir, { recursive: true });
      
      // Create custom configuration
      const customConfig = {
        version: "1.0.0",
        description: "Test configuration",
        enabled: true,
        patterns: [
          {
            id: "test_api_keys",
            name: "Test API Keys",
            description: "Test API key pattern",
            pattern: "\\btest-key-[a-zA-Z0-9]{10}",
            flags: "gi",
            replacementType: "generic",
            replacement: "<TEST_KEY_REDACTED>",
            enabled: true,
            severity: "critical"
          },
          {
            id: "test_secrets",
            name: "Test Secrets",
            description: "Test secret pattern",
            pattern: "\\bsecret-[0-9]{6}",
            flags: "gi",
            replacementType: "generic",
            replacement: "<TEST_SECRET_REDACTED>",
            enabled: true,
            severity: "high"
          }
        ]
      };
      
      const configPath = path.join(this.tempConfigDir, 'redaction-patterns.json');
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));
      
      // Test loading custom configuration
      const redactor = new ConfigurableRedactor({
        debug: this.options.verbose,
        configPath: configPath
      });
      
      const initResult = await redactor.initialize();
      
      if (!initResult) {
        return {
          success: false,
          error: 'Failed to initialize with custom configuration',
          duration: Date.now() - startTime
        };
      }
      
      const stats = redactor.getStats();
      if (stats.patternsActive !== 2) {
        return {
          success: false,
          error: `Expected 2 patterns, got ${stats.patternsActive}`,
          duration: Date.now() - startTime
        };
      }
      
      // Test custom pattern functionality
      const testText = 'API key: test-key-abcdef1234 and secret-123456';
      const redactedText = redactor.redact(testText);
      
      if (!redactedText.includes('<TEST_KEY_REDACTED>') || !redactedText.includes('<TEST_SECRET_REDACTED>')) {
        return {
          success: false,
          error: 'Custom patterns did not work correctly',
          details: { original: testText, redacted: redactedText },
          duration: Date.now() - startTime
        };
      }
      
      return {
        success: true,
        details: {
          customConfigLoaded: true,
          patternsActive: stats.patternsActive,
          redactionExample: { original: testText, redacted: redactedText }
        },
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async configurationValidation() {
    const startTime = Date.now();
    
    try {
      const redactor = new ConfigurableRedactor({ debug: this.options.verbose });
      
      // Test various invalid configurations
      const invalidConfigs = [
        {
          name: 'Missing version',
          config: { patterns: [] },
          expectedError: 'version'
        },
        {
          name: 'Missing patterns array',
          config: { version: '1.0.0' },
          expectedError: 'patterns array'
        },
        {
          name: 'Invalid regex pattern',
          config: {
            version: '1.0.0',
            patterns: [{
              id: 'invalid_regex',
              name: 'Invalid Regex',
              pattern: '[invalid(regex',
              flags: 'gi',
              replacementType: 'generic',
              replacement: 'REDACTED',
              enabled: true,
              severity: 'high'
            }]
          },
          expectedError: 'Invalid regex'
        },
        {
          name: 'Duplicate pattern IDs',
          config: {
            version: '1.0.0',
            patterns: [
              {
                id: 'duplicate',
                name: 'First',
                pattern: 'test1',
                flags: 'gi',
                replacementType: 'generic',
                replacement: 'REDACTED',
                enabled: true,
                severity: 'high'
              },
              {
                id: 'duplicate',
                name: 'Second',
                pattern: 'test2',
                flags: 'gi',
                replacementType: 'generic',
                replacement: 'REDACTED',
                enabled: true,
                severity: 'high'
              }
            ]
          },
          expectedError: 'Duplicate pattern ID'
        }
      ];
      
      const validationResults = [];
      
      for (const testCase of invalidConfigs) {
        const validation = redactor.validateConfiguration(testCase.config);
        
        if (validation.isValid) {
          validationResults.push({
            testCase: testCase.name,
            passed: false,
            error: 'Expected validation to fail but it passed'
          });
        } else {
          const hasExpectedError = validation.errors.some(error => 
            error.toLowerCase().includes(testCase.expectedError.toLowerCase())
          );
          
          validationResults.push({
            testCase: testCase.name,
            passed: hasExpectedError,
            error: hasExpectedError ? null : `Expected error containing "${testCase.expectedError}", got: ${validation.errors.join(', ')}`
          });
        }
      }
      
      // Test valid configuration
      const validConfig = {
        version: '1.0.0',
        patterns: [{
          id: 'valid_test',
          name: 'Valid Test Pattern',
          description: 'A valid test pattern',
          pattern: '\\bvalid-[0-9]+',
          flags: 'gi',
          replacementType: 'generic',
          replacement: '<VALID_REDACTED>',
          enabled: true,
          severity: 'medium'
        }]
      };
      
      const validValidation = redactor.validateConfiguration(validConfig);
      validationResults.push({
        testCase: 'Valid configuration',
        passed: validValidation.isValid,
        error: validValidation.isValid ? null : validValidation.errors.join(', ')
      });
      
      const allPassed = validationResults.every(r => r.passed);
      
      return {
        success: allPassed,
        error: allPassed ? null : 'Some validation tests failed',
        details: { validationResults },
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async allPatternRedactionTests() {
    const startTime = Date.now();
    
    try {
      const redactor = new ConfigurableRedactor({ debug: this.options.verbose });
      await redactor.initialize();
      
      // Comprehensive test data covering all pattern types
      const testCases = [
        {
          category: 'Environment Variables',
          tests: [
            {
              input: 'ANTHROPIC_API_KEY=sk-ant-1234567890abcdef',
              shouldMatch: true,
              expectedRedacted: 'ANTHROPIC_API_KEY=<SECRET_REDACTED>'
            },
            {
              input: 'OPENAI_API_KEY="sk-1234567890abcdef"',
              shouldMatch: true,
              expectedRedacted: 'OPENAI_API_KEY=<SECRET_REDACTED>'
            },
            {
              input: 'XAI_API_KEY=xai-abcd1234567890efgh',
              shouldMatch: true,
              expectedRedacted: 'XAI_API_KEY=<SECRET_REDACTED>'
            },
            {
              input: 'DATABASE_URL=postgres://user:pass@localhost:5432/db',
              shouldMatch: true,
              expectedRedacted: 'DATABASE_URL=<SECRET_REDACTED>'
            }
          ]
        },
        {
          category: 'JSON API Keys',
          tests: [
            {
              input: '"apiKey": "sk-1234567890abcdef"',
              shouldMatch: true,
              expectedContains: '"apiKey": "<SECRET_REDACTED>"'
            },
            {
              input: '"ANTHROPIC_API_KEY": "sk-ant-1234567890abcdef"',
              shouldMatch: true,
              expectedContains: '"ANTHROPIC_API_KEY": "<SECRET_REDACTED>"'
            },
            {
              input: '"xaiApiKey": "xai-1234567890abcdef"',
              shouldMatch: true,
              expectedContains: '"xaiApiKey": "<SECRET_REDACTED>"'
            }
          ]
        },
        {
          category: 'API Key Formats',
          tests: [
            {
              input: 'sk-1234567890abcdefghijk',
              shouldMatch: true,
              expectedRedacted: '<SECRET_REDACTED>'
            },
            {
              input: 'xai-1234567890abcdefghijk',
              shouldMatch: true,
              expectedRedacted: '<SECRET_REDACTED>'
            },
            {
              // 32+ alphanumerics, separator, 8+ — the generic_api_keys shape. A short
              // hyphenated slug like some-key-12345678-abcdefgh is deliberately NOT a
              // secret: redacting slugs mangles file and branch names in observations.
              input: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6-abcdefgh',
              shouldMatch: true,
              expectedRedacted: '<SECRET_REDACTED>'
            }
          ]
        },
        {
          category: 'Bearer Tokens',
          tests: [
            {
              input: 'Authorization: Bearer abc123xyz789token',
              shouldMatch: true,
              expectedContains: 'Bearer <TOKEN_REDACTED>'
            },
            {
              input: 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9',
              shouldMatch: true,
              expectedRedacted: 'Bearer <TOKEN_REDACTED>'
            }
          ]
        },
        {
          category: 'JWT Tokens',
          tests: [
            {
              // The public sample token from jwt.io (an earlier redaction pass had
              // replaced this fixture with its own placeholder).
              input: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
              shouldMatch: true,
              expectedRedacted: '<JWT_REDACTED>'
            }
          ]
        },
        {
          category: 'Database Connection Strings',
          tests: [
            {
              input: 'mongodb://username:password@localhost:27017/database',
              shouldMatch: true,
              expectedRedacted: 'mongodb://<CONNECTION_STRING_REDACTED>'
            },
            {
              input: 'postgresql://user:secret@db.example.com:5432/mydb',
              shouldMatch: true,
              expectedRedacted: 'postgresql://<CONNECTION_STRING_REDACTED>'
            },
            {
              input: 'mysql://admin:password123@mysql.example.com:3306/app_db',
              shouldMatch: true,
              expectedRedacted: 'mysql://<CONNECTION_STRING_REDACTED>'
            }
          ]
        },
        {
          category: 'URLs with Credentials',
          tests: [
            {
              input: 'https://user:pass@api.example.com/data',
              shouldMatch: true,
              expectedRedacted: 'https://<CONNECTION_STRING_REDACTED>'
            },
            {
              input: 'http://admin:secret@internal.company.com/admin',
              shouldMatch: true,
              expectedRedacted: 'http://<CONNECTION_STRING_REDACTED>'
            }
          ]
        },
        {
          category: 'Email Addresses',
          tests: [
            {
              input: 'Contact: john.doe@example.com',
              shouldMatch: true,
              expectedContains: '<EMAIL_REDACTED>'
            },
            {
              input: 'user.name+tag@company.co.uk',
              shouldMatch: true,
              expectedRedacted: '<EMAIL_REDACTED>'
            }
          ]
        },
        {
          category: 'Corporate User IDs',
          tests: [
            {
              input: 'User q123456 logged in',
              shouldMatch: true,
              expectedContains: '<USER_ID_REDACTED>'
            },
            {
              input: 'Employee qABC123 submitted report',
              shouldMatch: true,
              expectedContains: '<USER_ID_REDACTED>'
            }
          ]
        },
        {
          category: 'Company Names',
          tests: [
            {
              input: 'Working with BMW and Mercedes',
              shouldMatch: true,
              expectedContains: '<COMPANY_NAME_REDACTED>'
            },
            {
              input: 'Microsoft and Google partnership',
              shouldMatch: true,
              expectedContains: '<COMPANY_NAME_REDACTED>'
            }
          ]
        }
      ];
      
      const categoryResults = [];
      
      for (const category of testCases) {
        const categoryResult = {
          category: category.category,
          total: category.tests.length,
          passed: 0,
          failed: 0,
          failures: []
        };
        
        for (const test of category.tests) {
          const redactedText = redactor.redact(test.input);
          let passed = false;
          let failureReason = null;
          
          if (test.expectedRedacted) {
            passed = redactedText === test.expectedRedacted;
            failureReason = passed ? null : `Expected "${test.expectedRedacted}", got "${redactedText}"`;
          } else if (test.expectedContains) {
            passed = redactedText.includes(test.expectedContains);
            failureReason = passed ? null : `Expected to contain "${test.expectedContains}", got "${redactedText}"`;
          } else if (test.shouldMatch) {
            passed = redactedText !== test.input;
            failureReason = passed ? null : `Text was not redacted: "${test.input}"`;
          }
          
          if (passed) {
            categoryResult.passed++;
          } else {
            categoryResult.failed++;
            categoryResult.failures.push({
              input: test.input,
              output: redactedText,
              reason: failureReason
            });
          }
        }
        
        categoryResults.push(categoryResult);
      }
      
      const totalTests = categoryResults.reduce((sum, cat) => sum + cat.total, 0);
      const totalPassed = categoryResults.reduce((sum, cat) => sum + cat.passed, 0);
      const totalFailed = categoryResults.reduce((sum, cat) => sum + cat.failed, 0);
      
      return {
        success: totalFailed === 0,
        error: totalFailed > 0 ? `${totalFailed}/${totalTests} pattern tests failed` : null,
        details: {
          summary: { totalTests, totalPassed, totalFailed },
          categoryResults
        },
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async performanceAndAccuracyTests() {
    const startTime = Date.now();
    
    try {
      const redactor = new ConfigurableRedactor({ debug: this.options.verbose });
      await redactor.initialize();
      
      // Performance test with large text
      const largeTestText = Array(1000).fill(`
        API_KEY=sk-1234567890abcdef
        "apiKey": "sk-abcdef1234567890" 
        Bearer xyz789token
        postgres://user:pass@localhost/db
        contact@example.com
        User q284340 at BMW
      `).join('\n');
      
      const performanceStartTime = Date.now();
      const redactedLargeText = redactor.redact(largeTestText);
      const performanceTime = Date.now() - performanceStartTime;
      
      // Test accuracy - ensure no false positives
      const falsePositiveTests = [
        'normal-text-with-dashes',
        'email-like-but-invalid@',
        'short-key-sk',
        'company: My-Company-Name (not in pattern)'
      ];
      
      let falsePositives = 0;
      for (const text of falsePositiveTests) {
        const redacted = redactor.redact(text);
        if (redacted !== text) {
          falsePositives++;
          this.log(`False positive detected: "${text}" -> "${redacted}"`);
        }
      }
      
      // Test pattern testing functionality
      const patternTestText = `
        API_KEY=sk-test123456789
        "apiKey": "sk-another123456"
        user@example.com
        Bearer token123xyz
      `;
      
      const patternTestResults = redactor.testPatterns(patternTestText);
      
      const stats = redactor.getStats();
      
      // Performance benchmarks (reasonable thresholds)
      const performanceThresholds = {
        maxTimeFor1000Lines: 1000, // 1 second max for 1000 lines
        maxAvgRedactionTime: 100   // 100ms max average
      };
      
      const performanceIssues = [];
      if (performanceTime > performanceThresholds.maxTimeFor1000Lines) {
        performanceIssues.push(`Large text processing too slow: ${performanceTime}ms`);
      }
      
      if (stats.avgRedactionTime > performanceThresholds.maxAvgRedactionTime) {
        performanceIssues.push(`Average redaction time too slow: ${stats.avgRedactionTime}ms`);
      }
      
      return {
        success: falsePositives === 0 && performanceIssues.length === 0,
        error: falsePositives > 0 ? `${falsePositives} false positives detected` :
               performanceIssues.length > 0 ? performanceIssues.join(', ') : null,
        details: {
          performance: {
            largeTextProcessingTime: performanceTime,
            avgRedactionTime: stats.avgRedactionTime,
            totalRedactions: stats.redactionsPerformed
          },
          accuracy: {
            falsePositives,
            testedFalsePositiveCases: falsePositiveTests.length
          },
          patternTesting: {
            totalMatches: patternTestResults.totalMatches,
            patternsTriggered: patternTestResults.patternResults.length
          }
        },
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * A missing or corrupt config must make initialize() THROW. The caller
   * (ObservationWriter) then refuses to store anything. Falling back to
   * built-in defaults would silently drop the custom patterns (user ids,
   * company names) while everything looks fine.
   */
  async configurationErrorHandling() {
    const startTime = Date.now();
    const corruptedConfigPath = path.join(os.tmpdir(), `corrupted-config-${Date.now()}.json`);

    try {
      const outcomes = {};
      for (const [label, configPath] of [
        ['nonExistentConfig', path.join(os.tmpdir(), `non-existent-config-${Date.now()}.json`)],
        ['corruptedConfig', corruptedConfigPath],
      ]) {
        if (label === 'corruptedConfig') fs.writeFileSync(configPath, '{ invalid json content');
        const redactor = new ConfigurableRedactor({ debug: this.options.verbose, configPath });
        try {
          await redactor.initialize();
          outcomes[label] = 'initialized';
        } catch {
          outcomes[label] = 'refused';
        }
        if (redactor.isInitialized) outcomes[label] = 'initialized';
      }

      const success = Object.values(outcomes).every((o) => o === 'refused');
      return {
        success,
        ...(success ? {} : { error: `a broken config must make initialize() throw: ${JSON.stringify(outcomes)}` }),
        details: outcomes,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return { success: false, error: error.message, duration: Date.now() - startTime };
    } finally {
      if (fs.existsSync(corruptedConfigPath)) fs.unlinkSync(corruptedConfigPath);
    }
  }

  /**
   * redact() on an uninitialized redactor must THROW, never return its input:
   * returned input is indistinguishable from "nothing to redact".
   */
  async failClosedWithoutInitialization() {
    const startTime = Date.now();
    const redactor = new ConfigurableRedactor({ debug: this.options.verbose });
    let outcome;
    try {
      const out = redactor.redact('PASSWORD=hunter2hunter2');
      outcome = out === 'PASSWORD=hunter2hunter2' ? 'returned input unchanged' : 'returned redacted text';
    } catch {
      outcome = 'refused';
    }
    return {
      success: outcome === 'refused',
      ...(outcome === 'refused' ? {} : { error: `uninitialized redact() ${outcome}` }),
      duration: Date.now() - startTime
    };
  }

  async enhancedTranscriptMonitorIntegration() {
    const startTime = Date.now();
    
    try {
      // Test integration by simulating enhanced-transcript-monitor usage
      const redactor = new ConfigurableRedactor({ debug: this.options.verbose });
      await redactor.initialize();
      
      // Create mock transcript data similar to what enhanced-transcript-monitor processes
      const mockTranscriptExchanges = [
        {
          id: 'exchange-1',
          content: 'Set ANTHROPIC_API_KEY=sk-ant-1234567890abcdef',
          timestamp: Date.now()
        },
        {
          id: 'exchange-2', 
          content: 'Configure database: postgresql://user:password@localhost:5432/app',
          timestamp: Date.now()
        },
        {
          id: 'exchange-3',
          content: 'User john.doe@company.com submitted request',
          timestamp: Date.now()
        },
        {
          id: 'exchange-4',
          content: 'JWT token: eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.payload.signature',
          timestamp: Date.now()
        }
      ];
      
      // Process each exchange through redaction (simulating transcript monitor)
      const processedExchanges = [];
      
      for (const exchange of mockTranscriptExchanges) {
        const startRedactionTime = Date.now();
        const redactedContent = redactor.redact(exchange.content);
        const redactionTime = Date.now() - startRedactionTime;
        
        processedExchanges.push({
          ...exchange,
          redactedContent,
          redactionTime,
          wasModified: redactedContent !== exchange.content
        });
      }
      
      // Verify all sensitive data was redacted
      const sensitiveDataRedacted = processedExchanges.every(ex => ex.wasModified);
      
      if (!sensitiveDataRedacted) {
        const unprocessed = processedExchanges.filter(ex => !ex.wasModified);
        return {
          success: false,
          error: `Some exchanges not redacted: ${unprocessed.map(ex => ex.id).join(', ')}`,
          duration: Date.now() - startTime
        };
      }
      
      // Performance check for real-time processing
      const maxRedactionTime = Math.max(...processedExchanges.map(ex => ex.redactionTime));
      const avgRedactionTime = processedExchanges.reduce((sum, ex) => sum + ex.redactionTime, 0) / processedExchanges.length;
      
      // Real-time processing should be fast (< 50ms per exchange)
      if (maxRedactionTime > 50) {
        return {
          success: false,
          error: `Real-time redaction too slow: max ${maxRedactionTime}ms`,
          duration: Date.now() - startTime
        };
      }
      
      // Test bulk processing (simulating batch mode)
      const bulkContent = mockTranscriptExchanges.map(ex => ex.content).join('\n');
      const bulkStartTime = Date.now();
      const bulkRedacted = redactor.redact(bulkContent);
      const bulkTime = Date.now() - bulkStartTime;
      
      return {
        success: true,
        details: {
          realTimeProcessing: {
            exchangesProcessed: processedExchanges.length,
            allSensitiveDataRedacted: sensitiveDataRedacted,
            maxRedactionTime,
            avgRedactionTime
          },
          bulkProcessing: {
            processingTime: bulkTime,
            contentLength: bulkContent.length,
            wasRedacted: bulkRedacted !== bulkContent
          },
          integrationReady: maxRedactionTime < 50 && bulkTime < 100
        },
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async cleanup() {
    this.log('Cleaning up test data');
    
    try {
      // Clean up temporary configuration directory
      if (this.tempConfigDir && fs.existsSync(this.tempConfigDir)) {
        fs.rmSync(this.tempConfigDir, { recursive: true, force: true });
        this.log(`Cleaned up temporary config directory: ${this.tempConfigDir}`);
      }
      
      // Clean up any other temporary files
      const tempFiles = [
        '/tmp/non-existent-config.json',
        ...Array.from({ length: 10 }, (_, i) => `/tmp/corrupted-config-${Date.now() - i}.json`)
      ];
      
      for (const file of tempFiles) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }
      
    } catch (error) {
      this.log(`Cleanup warning: ${error.message}`);
    }
  }

  generateReport() {
    const report = {
      testSuite: 'Redaction System E2E Tests',
      timestamp: new Date().toISOString(),
      summary: {
        total: this.testResults.length,
        passed: this.testResults.filter(r => r.success).length,
        failed: this.testResults.filter(r => !r.success).length,
        duration: this.testResults.reduce((sum, r) => sum + r.duration, 0)
      },
      results: this.testResults,
      environment: {
        nodeVersion: process.version,
        platform: process.platform
      }
    };
    
    return report;
  }
}

// CLI Integration
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    keepData: args.includes('--keep-data') || args.includes('-k'),
    timeout: parseInt(args.find(arg => arg.startsWith('--timeout='))?.split('=')[1]) || 30000
  };
  
  const tester = new RedactionSystemTest(options);
  
  console.log('🔒 Redaction System E2E Tests');
  console.log('=============================');
  console.log('');
  
  tester.runAllTests()
    .then(results => {
      console.log('');
      console.log('📊 Test Results Summary:');
      console.log(`   Total: ${results.total}`);
      console.log(`   Passed: ${results.passed}`);
      console.log(`   Failed: ${results.failed}`);
      console.log('');
      
      if (options.verbose || results.failed > 0) {
        const report = tester.generateReport();
        console.log('📋 Detailed Report:');
        console.log(JSON.stringify(report, null, 2));
      }
      
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test suite failed:', error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

export default RedactionSystemTest;