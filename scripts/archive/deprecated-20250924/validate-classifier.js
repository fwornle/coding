#!/usr/bin/env node
/**
 * Historical Accuracy Validation Script for ReliableCodingClassifier
 * 
 * Validates the ReliableCodingClassifier against historical transcripts with manual ground truth
 * classification. Provides statistical analysis comparing old vs new classifier performance.
 * 
 * Features:
 * - Processes historical transcripts from .specstory/history/
 * - Manual ground truth classification interface
 * - Statistical accuracy reporting (precision, recall, F1-score)
 * - Comparison with FastEmbeddingClassifier performance
 * - Detailed failure case analysis
 * - Confidence score analysis
 * - Performance benchmarking
 * - Export validation results to JSON/CSV
 * 
 * Usage:
 * node scripts/validate-classifier.js [options]
 * 
 * Options:
 * --sample-size N     Number of exchanges to validate (default: 100)
 * --output-format     json|csv|both (default: json)
 * --ground-truth-file Path to existing ground truth data
 * --export-only       Only export results, don't run validation
 * --interactive       Interactive ground truth classification
 * --batch             Non-interactive batch mode
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { performance } = require('perf_hooks');

// Import classifiers
const ReliableCodingClassifier = require('../src/live-logging/ReliableCodingClassifier');
const FastEmbeddingClassifier = require('../src/live-logging/FastEmbeddingClassifier');

class ClassifierValidator {
  constructor(options = {}) {
    this.options = {
      sampleSize: options.sampleSize || 100,
      outputFormat: options.outputFormat || 'json',
      groundTruthFile: options.groundTruthFile || 'validation-ground-truth.json',
      interactive: options.interactive || false,
      batch: options.batch || false,
      exportOnly: options.exportOnly || false,
      ...options
    };

    this.projectPath = process.cwd();
    this.historyPath = path.join(this.projectPath, '.specstory', 'history');
    this.validationDataPath = path.join(this.projectPath, 'test', 'validation');
    this.groundTruthPath = path.join(this.validationDataPath, this.options.groundTruthFile);
    
    // Ensure validation directory exists
    if (!fs.existsSync(this.validationDataPath)) {
      fs.mkdirSync(this.validationDataPath, { recursive: true });
    }

    // Initialize classifiers
    this.reliableClassifier = new ReliableCodingClassifier({
      debug: false,
      enableLogging: false
    });
    
    this.fastClassifier = new FastEmbeddingClassifier({
      debug: false
    });

    // Validation results
    this.validationResults = {
      metadata: {
        timestamp: new Date().toISOString(),
        sampleSize: 0,
        totalExchanges: 0,
        validationDuration: 0,
        options: this.options
      },
      groundTruth: [],
      reliableClassifierResults: [],
      fastClassifierResults: [],
      statistics: {
        reliable: {},
        fast: {},
        comparison: {}
      },
      performanceMetrics: {
        reliable: { avgTime: 0, maxTime: 0, minTime: Infinity },
        fast: { avgTime: 0, maxTime: 0, minTime: Infinity }
      },
      failureCases: {
        reliable: [],
        fast: []
      }
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Main validation workflow
   */
  async run() {
    try {
      console.log('🔍 Starting ReliableCodingClassifier Historical Validation');
      console.log(`📊 Sample size: ${this.options.sampleSize}`);
      console.log(`📂 History path: ${this.historyPath}`);
      console.log(`💾 Ground truth file: ${this.groundTruthPath}`);
      console.log('');

      if (this.options.exportOnly) {
        return await this.exportResults();
      }

      // Step 1: Load or create ground truth data
      await this.loadOrCreateGroundTruth();

      // Step 2: Initialize classifiers
      await this.initializeClassifiers();

      // Step 3: Run validation
      await this.runValidation();

      // Step 4: Calculate statistics
      this.calculateStatistics();

      // Step 5: Generate report
      this.generateReport();

      // Step 6: Export results
      await this.exportResults();

      console.log('\n✅ Validation completed successfully!');
      
    } catch (error) {
      console.error('\n❌ Validation failed:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  /**
   * Load existing ground truth or create new one
   */
  async loadOrCreateGroundTruth() {
    console.log('📋 Loading ground truth data...');
    
    if (fs.existsSync(this.groundTruthPath) && !this.options.interactive) {
      // Load existing ground truth
      const groundTruthData = JSON.parse(fs.readFileSync(this.groundTruthPath, 'utf8'));
      this.validationResults.groundTruth = groundTruthData.groundTruth || [];
      console.log(`✅ Loaded ${this.validationResults.groundTruth.length} ground truth samples`);
    } else {
      // Create new ground truth through manual classification
      await this.createGroundTruth();
    }
  }

  /**
   * Create ground truth data through manual classification
   */
  async createGroundTruth() {
    console.log('🎯 Creating ground truth data through manual classification...');
    
    // Get sample exchanges from historical transcripts
    const sampleExchanges = await this.getSampleExchanges();
    console.log(`📝 Found ${sampleExchanges.length} sample exchanges`);

    if (this.options.interactive) {
      console.log('\n🔍 Manual Classification Mode');
      console.log('For each exchange, classify as:');
      console.log('  1 = CODING_INFRASTRUCTURE (coding-related)');
      console.log('  0 = NOT_CODING_INFRASTRUCTURE (not coding-related)');
      console.log('  s = Skip this exchange');
      console.log('  q = Quit and save current progress\n');

      for (let i = 0; i < sampleExchanges.length; i++) {
        const exchange = sampleExchanges[i];
        
        console.log(`\n--- Exchange ${i + 1}/${sampleExchanges.length} ---`);
        console.log(`File: ${exchange.sourceFile}`);
        console.log(`User: ${exchange.userMessage.substring(0, 200)}${exchange.userMessage.length > 200 ? '...' : ''}`);
        console.log(`Assistant: ${exchange.assistantResponse.substring(0, 200)}${exchange.assistantResponse.length > 200 ? '...' : ''}`);
        
        const classification = await this.promptForClassification();
        
        if (classification === 'q') {
          console.log('🛑 Stopping classification and saving progress...');
          break;
        } else if (classification === 's') {
          console.log('⏭️  Skipping exchange...');
          continue;
        }
        
        const isCoding = classification === '1';
        
        this.validationResults.groundTruth.push({
          id: `${exchange.sourceFile}_${i}`,
          exchange: exchange,
          groundTruthClassification: isCoding ? 'CODING_INFRASTRUCTURE' : 'NOT_CODING_INFRASTRUCTURE',
          isCoding: isCoding,
          classifiedAt: new Date().toISOString(),
          confidence: 1.0 // Manual classification has perfect confidence
        });
        
        console.log(`✅ Classified as: ${isCoding ? 'CODING' : 'NOT_CODING'}`);
      }
    } else {
      // Batch mode - use heuristic classification for initial ground truth
      console.log('🤖 Using heuristic classification for initial ground truth...');
      
      for (let i = 0; i < sampleExchanges.length; i++) {
        const exchange = sampleExchanges[i];
        const heuristicClassification = this.heuristicClassify(exchange);
        
        this.validationResults.groundTruth.push({
          id: `${exchange.sourceFile}_${i}`,
          exchange: exchange,
          groundTruthClassification: heuristicClassification ? 'CODING_INFRASTRUCTURE' : 'NOT_CODING_INFRASTRUCTURE',
          isCoding: heuristicClassification,
          classifiedAt: new Date().toISOString(),
          confidence: 0.8, // Heuristic classification has lower confidence
          method: 'heuristic'
        });
      }
    }

    // Save ground truth data
    await this.saveGroundTruth();
    console.log(`✅ Created ${this.validationResults.groundTruth.length} ground truth samples`);
  }

  /**
   * Prompt user for manual classification
   */
  async promptForClassification() {
    return new Promise((resolve) => {
      this.rl.question('Classification (1=CODING, 0=NOT_CODING, s=skip, q=quit): ', (answer) => {
        const cleaned = answer.trim().toLowerCase();
        if (['1', '0', 's', 'q'].includes(cleaned)) {
          resolve(cleaned);
        } else {
          console.log('❌ Invalid input. Please enter 1, 0, s, or q');
          resolve(this.promptForClassification());
        }
      });
    });
  }

  /**
   * Heuristic classification for batch mode
   */
  heuristicClassify(exchange) {
    const text = (exchange.userMessage + ' ' + exchange.assistantResponse).toLowerCase();
    
    // Strong coding indicators
    const codingKeywords = [
      '/users/q284340/agentic/coding', 'claude.md', 'ukb', 'vkb', 'mcp', 'knowledge-management',
      'semantic-analysis', 'embedding', 'classifier', 'specstory', 'transcript', 'logging',
      'node_modules', 'package.json', 'npm install', 'git commit', 'bash', 'shell script'
    ];
    
    // Strong non-coding indicators
    const nonCodingKeywords = [
      'general conversation', 'hello', 'how are you', 'weather', 'personal', 'casual chat'
    ];
    
    const codingScore = codingKeywords.reduce((score, keyword) => {
      return score + (text.includes(keyword) ? 1 : 0);
    }, 0);
    
    const nonCodingScore = nonCodingKeywords.reduce((score, keyword) => {
      return score + (text.includes(keyword) ? 1 : 0);
    }, 0);
    
    // Path-based classification
    if (exchange.sourceFile && exchange.sourceFile.includes('coding')) {
      return true;
    }
    
    // Tool-based classification
    if (exchange.assistantResponse.includes('"toolCalls"') || 
        exchange.assistantResponse.includes('"tool_uses"')) {
      return true;
    }
    
    return codingScore > nonCodingScore;
  }

  /**
   * Get sample exchanges from historical transcripts
   */
  async getSampleExchanges() {
    console.log('📂 Collecting sample exchanges from historical transcripts...');
    
    if (!fs.existsSync(this.historyPath)) {
      throw new Error(`History directory not found: ${this.historyPath}`);
    }
    
    const transcriptFiles = fs.readdirSync(this.historyPath)
      .filter(file => file.endsWith('.md'))
      .sort()
      .slice(-20); // Use last 20 transcript files
    
    const allExchanges = [];
    
    for (const file of transcriptFiles) {
      const filePath = path.join(this.historyPath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const exchanges = this.parseTranscriptExchanges(content, file);
      allExchanges.push(...exchanges);
    }
    
    // Sample exchanges evenly across files
    const sampleSize = Math.min(this.options.sampleSize, allExchanges.length);
    const sampledExchanges = [];
    const step = Math.floor(allExchanges.length / sampleSize);
    
    for (let i = 0; i < sampleSize; i++) {
      const index = i * step;
      if (index < allExchanges.length) {
        sampledExchanges.push(allExchanges[index]);
      }
    }
    
    return sampledExchanges;
  }

  /**
   * Parse exchanges from transcript content
   */
  parseTranscriptExchanges(content, sourceFile) {
    const exchanges = [];
    const lines = content.split('\n');
    
    let currentExchange = null;
    let currentRole = null;
    let currentContent = [];
    
    for (const line of lines) {
      if (line.startsWith('# User')) {
        if (currentExchange && currentExchange.userMessage && currentExchange.assistantResponse) {
          exchanges.push(currentExchange);
        }
        currentExchange = { sourceFile, userMessage: '', assistantResponse: '' };
        currentRole = 'user';
        currentContent = [];
      } else if (line.startsWith('# Assistant')) {
        if (currentExchange && currentContent.length > 0) {
          currentExchange.userMessage = currentContent.join('\n').trim();
        }
        currentRole = 'assistant';
        currentContent = [];
      } else if (currentRole && line.trim()) {
        currentContent.push(line);
      }
      
      // Handle end of exchange
      if (currentRole === 'assistant' && currentContent.length > 0 && currentExchange) {
        currentExchange.assistantResponse = currentContent.join('\n').trim();
      }
    }
    
    // Add final exchange if exists
    if (currentExchange && currentExchange.userMessage && currentExchange.assistantResponse) {
      exchanges.push(currentExchange);
    }
    
    return exchanges.filter(ex => ex.userMessage.length > 10 && ex.assistantResponse.length > 10);
  }

  /**
   * Initialize both classifiers
   */
  async initializeClassifiers() {
    console.log('⚙️ Initializing classifiers...');
    
    try {
      await this.reliableClassifier.initialize();
      console.log('✅ ReliableCodingClassifier initialized');
    } catch (error) {
      console.error('❌ Failed to initialize ReliableCodingClassifier:', error.message);
      throw error;
    }
    
    try {
      await this.fastClassifier.initialize();
      console.log('✅ FastEmbeddingClassifier initialized');
    } catch (error) {
      console.log('⚠️ FastEmbeddingClassifier initialization failed (expected):', error.message);
      // Continue without FastEmbeddingClassifier if it fails
    }
  }

  /**
   * Run validation against both classifiers
   */
  async runValidation() {
    console.log('\n🔬 Running validation against classifiers...');
    const startTime = performance.now();
    
    for (let i = 0; i < this.validationResults.groundTruth.length; i++) {
      const groundTruthItem = this.validationResults.groundTruth[i];
      const exchange = groundTruthItem.exchange;
      
      console.log(`📊 Processing exchange ${i + 1}/${this.validationResults.groundTruth.length}...`);
      
      // Test ReliableCodingClassifier
      const reliableStart = performance.now();
      try {
        const reliableResult = await this.reliableClassifier.classifyExchange(exchange);
        const reliableTime = performance.now() - reliableStart;
        
        this.validationResults.reliableClassifierResults.push({
          id: groundTruthItem.id,
          classification: reliableResult.classification,
          isCoding: reliableResult.isCoding,
          confidence: reliableResult.confidence,
          layer: reliableResult.layer,
          processingTime: reliableTime,
          correct: reliableResult.isCoding === groundTruthItem.isCoding
        });
        
        this.updatePerformanceMetrics('reliable', reliableTime);
        
      } catch (error) {
        console.error(`❌ ReliableCodingClassifier failed on exchange ${i + 1}:`, error.message);
        this.validationResults.failureCases.reliable.push({
          id: groundTruthItem.id,
          error: error.message,
          exchange: exchange
        });
      }
      
      // Test FastEmbeddingClassifier (if available)
      if (this.fastClassifier) {
        const fastStart = performance.now();
        try {
          const fastResult = await this.fastClassifier.classifyExchange(exchange);
          const fastTime = performance.now() - fastStart;
          
          this.validationResults.fastClassifierResults.push({
            id: groundTruthItem.id,
            classification: fastResult.classification,
            isCoding: fastResult.isCoding,
            confidence: fastResult.confidence,
            processingTime: fastTime,
            correct: fastResult.isCoding === groundTruthItem.isCoding
          });
          
          this.updatePerformanceMetrics('fast', fastTime);
          
        } catch (error) {
          this.validationResults.failureCases.fast.push({
            id: groundTruthItem.id,
            error: error.message,
            exchange: exchange
          });
        }
      }
    }
    
    const totalTime = performance.now() - startTime;
    this.validationResults.metadata.validationDuration = totalTime;
    this.validationResults.metadata.sampleSize = this.validationResults.groundTruth.length;
    
    console.log(`✅ Validation completed in ${(totalTime / 1000).toFixed(2)}s`);
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(classifier, time) {
    const metrics = this.validationResults.performanceMetrics[classifier];
    const count = classifier === 'reliable' 
      ? this.validationResults.reliableClassifierResults.length
      : this.validationResults.fastClassifierResults.length;
    
    metrics.avgTime = ((metrics.avgTime * (count - 1)) + time) / count;
    metrics.maxTime = Math.max(metrics.maxTime, time);
    metrics.minTime = Math.min(metrics.minTime, time);
  }

  /**
   * Calculate validation statistics
   */
  calculateStatistics() {
    console.log('📈 Calculating validation statistics...');
    
    // Calculate statistics for ReliableCodingClassifier
    this.validationResults.statistics.reliable = this.calculateClassifierStats(
      this.validationResults.reliableClassifierResults,
      'ReliableCodingClassifier'
    );
    
    // Calculate statistics for FastEmbeddingClassifier
    if (this.validationResults.fastClassifierResults.length > 0) {
      this.validationResults.statistics.fast = this.calculateClassifierStats(
        this.validationResults.fastClassifierResults,
        'FastEmbeddingClassifier'
      );
      
      // Calculate comparison statistics
      this.validationResults.statistics.comparison = this.calculateComparisonStats();
    }
  }

  /**
   * Calculate statistics for a specific classifier
   */
  calculateClassifierStats(results, classifierName) {
    if (results.length === 0) {
      return { accuracy: 0, precision: 0, recall: 0, f1Score: 0, totalSamples: 0 };
    }
    
    let truePositives = 0; // Correctly identified as coding
    let falsePositives = 0; // Incorrectly identified as coding
    let trueNegatives = 0; // Correctly identified as not coding
    let falseNegatives = 0; // Incorrectly identified as not coding
    
    for (const result of results) {
      const groundTruth = this.validationResults.groundTruth.find(gt => gt.id === result.id);
      if (!groundTruth) continue;
      
      if (result.isCoding && groundTruth.isCoding) {
        truePositives++;
      } else if (result.isCoding && !groundTruth.isCoding) {
        falsePositives++;
      } else if (!result.isCoding && !groundTruth.isCoding) {
        trueNegatives++;
      } else if (!result.isCoding && groundTruth.isCoding) {
        falseNegatives++;
      }
    }
    
    const accuracy = (truePositives + trueNegatives) / results.length;
    const precision = truePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = truePositives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1Score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    return {
      classifierName,
      accuracy: accuracy * 100,
      precision: precision * 100,
      recall: recall * 100,
      f1Score: f1Score * 100,
      truePositives,
      falsePositives,
      trueNegatives,
      falseNegatives,
      totalSamples: results.length,
      correctPredictions: truePositives + trueNegatives,
      avgConfidence: results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length
    };
  }

  /**
   * Calculate comparison statistics between classifiers
   */
  calculateComparisonStats() {
    const reliableStats = this.validationResults.statistics.reliable;
    const fastStats = this.validationResults.statistics.fast;
    
    return {
      accuracyImprovement: reliableStats.accuracy - fastStats.accuracy,
      precisionImprovement: reliableStats.precision - fastStats.precision,
      recallImprovement: reliableStats.recall - fastStats.recall,
      f1ScoreImprovement: reliableStats.f1Score - fastStats.f1Score,
      speedComparison: {
        reliableAvgTime: this.validationResults.performanceMetrics.reliable.avgTime,
        fastAvgTime: this.validationResults.performanceMetrics.fast.avgTime,
        speedupFactor: this.validationResults.performanceMetrics.fast.avgTime / 
                      this.validationResults.performanceMetrics.reliable.avgTime
      }
    };
  }

  /**
   * Generate validation report
   */
  generateReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 CLASSIFIER VALIDATION REPORT');
    console.log('='.repeat(80));
    
    console.log(`\n📈 METADATA:`);
    console.log(`  Sample size: ${this.validationResults.metadata.sampleSize}`);
    console.log(`  Validation duration: ${(this.validationResults.metadata.validationDuration / 1000).toFixed(2)}s`);
    console.log(`  Timestamp: ${this.validationResults.metadata.timestamp}`);
    
    // ReliableCodingClassifier results
    const reliable = this.validationResults.statistics.reliable;
    if (reliable.totalSamples > 0) {
      console.log(`\n🎯 RELIABLECODINGCLASSIFIER RESULTS:`);
      console.log(`  Accuracy: ${reliable.accuracy.toFixed(2)}%`);
      console.log(`  Precision: ${reliable.precision.toFixed(2)}%`);
      console.log(`  Recall: ${reliable.recall.toFixed(2)}%`);
      console.log(`  F1-Score: ${reliable.f1Score.toFixed(2)}%`);
      console.log(`  True Positives: ${reliable.truePositives}`);
      console.log(`  False Positives: ${reliable.falsePositives}`);
      console.log(`  True Negatives: ${reliable.trueNegatives}`);
      console.log(`  False Negatives: ${reliable.falseNegatives}`);
      console.log(`  Average Confidence: ${reliable.avgConfidence.toFixed(2)}`);
      console.log(`  Average Processing Time: ${this.validationResults.performanceMetrics.reliable.avgTime.toFixed(2)}ms`);
    }
    
    // FastEmbeddingClassifier results
    const fast = this.validationResults.statistics.fast;
    if (fast.totalSamples > 0) {
      console.log(`\n⚡ FASTEMBEDDINGCLASSIFIER RESULTS:`);
      console.log(`  Accuracy: ${fast.accuracy.toFixed(2)}%`);
      console.log(`  Precision: ${fast.precision.toFixed(2)}%`);
      console.log(`  Recall: ${fast.recall.toFixed(2)}%`);
      console.log(`  F1-Score: ${fast.f1Score.toFixed(2)}%`);
      console.log(`  Average Processing Time: ${this.validationResults.performanceMetrics.fast.avgTime.toFixed(2)}ms`);
      
      // Comparison
      const comparison = this.validationResults.statistics.comparison;
      console.log(`\n🔄 IMPROVEMENT ANALYSIS:`);
      console.log(`  Accuracy Improvement: +${comparison.accuracyImprovement.toFixed(2)}%`);
      console.log(`  Precision Improvement: +${comparison.precisionImprovement.toFixed(2)}%`);
      console.log(`  Recall Improvement: +${comparison.recallImprovement.toFixed(2)}%`);
      console.log(`  F1-Score Improvement: +${comparison.f1ScoreImprovement.toFixed(2)}%`);
      console.log(`  Speed Comparison: ${comparison.speedComparison.speedupFactor.toFixed(2)}x ${
        comparison.speedComparison.speedupFactor > 1 ? 'slower' : 'faster'
      }`);
    }
    
    // Failure analysis
    if (this.validationResults.failureCases.reliable.length > 0) {
      console.log(`\n❌ RELIABLECODINGCLASSIFIER FAILURES (${this.validationResults.failureCases.reliable.length}):`);
      this.validationResults.failureCases.reliable.slice(0, 3).forEach((failure, i) => {
        console.log(`  ${i + 1}. ID: ${failure.id}`);
        console.log(`     Error: ${failure.error}`);
      });
    }
    
    if (this.validationResults.failureCases.fast.length > 0) {
      console.log(`\n❌ FASTEMBEDDINGCLASSIFIER FAILURES (${this.validationResults.failureCases.fast.length}):`);
      console.log(`  (Expected - FastEmbeddingClassifier has known issues)`);
    }
    
    console.log('\n' + '='.repeat(80));
  }

  /**
   * Save ground truth data
   */
  async saveGroundTruth() {
    const groundTruthData = {
      metadata: {
        createdAt: new Date().toISOString(),
        sampleSize: this.validationResults.groundTruth.length,
        method: this.options.interactive ? 'manual' : 'heuristic'
      },
      groundTruth: this.validationResults.groundTruth
    };
    
    fs.writeFileSync(this.groundTruthPath, JSON.stringify(groundTruthData, null, 2));
    console.log(`💾 Ground truth saved to: ${this.groundTruthPath}`);
  }

  /**
   * Export validation results
   */
  async exportResults() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    if (this.options.outputFormat === 'json' || this.options.outputFormat === 'both') {
      const jsonFile = path.join(this.validationDataPath, `validation-results-${timestamp}.json`);
      fs.writeFileSync(jsonFile, JSON.stringify(this.validationResults, null, 2));
      console.log(`📊 JSON results exported to: ${jsonFile}`);
    }
    
    if (this.options.outputFormat === 'csv' || this.options.outputFormat === 'both') {
      const csvFile = path.join(this.validationDataPath, `validation-results-${timestamp}.csv`);
      await this.exportToCsv(csvFile);
      console.log(`📈 CSV results exported to: ${csvFile}`);
    }
    
    // Export summary report
    const reportFile = path.join(this.validationDataPath, `validation-report-${timestamp}.md`);
    await this.exportReport(reportFile);
    console.log(`📝 Validation report exported to: ${reportFile}`);
  }

  /**
   * Export results to CSV format
   */
  async exportToCsv(filePath) {
    const csvLines = [
      'id,ground_truth,reliable_classification,reliable_correct,reliable_confidence,reliable_time,fast_classification,fast_correct,fast_confidence,fast_time'
    ];
    
    for (const gt of this.validationResults.groundTruth) {
      const reliable = this.validationResults.reliableClassifierResults.find(r => r.id === gt.id);
      const fast = this.validationResults.fastClassifierResults.find(r => r.id === gt.id);
      
      const line = [
        gt.id,
        gt.isCoding ? '1' : '0',
        reliable ? (reliable.isCoding ? '1' : '0') : 'N/A',
        reliable ? (reliable.correct ? '1' : '0') : 'N/A',
        reliable ? reliable.confidence.toFixed(3) : 'N/A',
        reliable ? reliable.processingTime.toFixed(2) : 'N/A',
        fast ? (fast.isCoding ? '1' : '0') : 'N/A',
        fast ? (fast.correct ? '1' : '0') : 'N/A',
        fast ? fast.confidence.toFixed(3) : 'N/A',
        fast ? fast.processingTime.toFixed(2) : 'N/A'
      ].join(',');
      
      csvLines.push(line);
    }
    
    fs.writeFileSync(filePath, csvLines.join('\n'));
  }

  /**
   * Export detailed report to Markdown
   */
  async exportReport(filePath) {
    const reliable = this.validationResults.statistics.reliable;
    const fast = this.validationResults.statistics.fast;
    const comparison = this.validationResults.statistics.comparison;
    
    const report = `# Classifier Validation Report

Generated: ${this.validationResults.metadata.timestamp}
Sample Size: ${this.validationResults.metadata.sampleSize}
Validation Duration: ${(this.validationResults.metadata.validationDuration / 1000).toFixed(2)}s

## ReliableCodingClassifier Results

| Metric | Value |
|--------|-------|
| Accuracy | ${reliable.accuracy.toFixed(2)}% |
| Precision | ${reliable.precision.toFixed(2)}% |
| Recall | ${reliable.recall.toFixed(2)}% |
| F1-Score | ${reliable.f1Score.toFixed(2)}% |
| True Positives | ${reliable.truePositives} |
| False Positives | ${reliable.falsePositives} |
| True Negatives | ${reliable.trueNegatives} |
| False Negatives | ${reliable.falseNegatives} |
| Average Confidence | ${reliable.avgConfidence.toFixed(2)} |
| Average Processing Time | ${this.validationResults.performanceMetrics.reliable.avgTime.toFixed(2)}ms |

${fast.totalSamples > 0 ? `## FastEmbeddingClassifier Results

| Metric | Value |
|--------|-------|
| Accuracy | ${fast.accuracy.toFixed(2)}% |
| Precision | ${fast.precision.toFixed(2)}% |
| Recall | ${fast.recall.toFixed(2)}% |
| F1-Score | ${fast.f1Score.toFixed(2)}% |
| Average Processing Time | ${this.validationResults.performanceMetrics.fast.avgTime.toFixed(2)}ms |

## Improvement Analysis

| Metric | Improvement |
|--------|-------------|
| Accuracy | +${comparison.accuracyImprovement.toFixed(2)}% |
| Precision | +${comparison.precisionImprovement.toFixed(2)}% |
| Recall | +${comparison.recallImprovement.toFixed(2)}% |
| F1-Score | +${comparison.f1ScoreImprovement.toFixed(2)}% |
| Speed Factor | ${comparison.speedComparison.speedupFactor.toFixed(2)}x |` : ''}

## Failure Analysis

### ReliableCodingClassifier Failures: ${this.validationResults.failureCases.reliable.length}
${this.validationResults.failureCases.reliable.map((f, i) => `${i + 1}. ${f.id}: ${f.error}`).join('\n')}

### FastEmbeddingClassifier Failures: ${this.validationResults.failureCases.fast.length}
(Expected due to known issues with FastEmbeddingClassifier)

## Conclusion

${reliable.accuracy > 85 ? '✅' : '❌'} ReliableCodingClassifier achieves ${reliable.accuracy.toFixed(1)}% accuracy
${reliable.f1Score > 80 ? '✅' : '❌'} F1-Score of ${reliable.f1Score.toFixed(1)}% indicates strong performance
${this.validationResults.performanceMetrics.reliable.avgTime < 10 ? '✅' : '❌'} Average processing time of ${this.validationResults.performanceMetrics.reliable.avgTime.toFixed(2)}ms meets <10ms requirement

${fast.totalSamples > 0 && comparison.accuracyImprovement > 50 ? 
  '🎯 **SIGNIFICANT IMPROVEMENT**: ReliableCodingClassifier shows major improvement over FastEmbeddingClassifier' :
  '📊 Validation completed successfully'
}
`;
    
    fs.writeFileSync(filePath, report);
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sample-size':
        options.sampleSize = parseInt(args[++i]);
        break;
      case '--output-format':
        options.outputFormat = args[++i];
        break;
      case '--ground-truth-file':
        options.groundTruthFile = args[++i];
        break;
      case '--export-only':
        options.exportOnly = true;
        break;
      case '--interactive':
        options.interactive = true;
        break;
      case '--batch':
        options.batch = true;
        break;
      case '--help':
        console.log(`
Usage: node scripts/validate-classifier.js [options]

Options:
  --sample-size N       Number of exchanges to validate (default: 100)
  --output-format       json|csv|both (default: json)
  --ground-truth-file   Path to existing ground truth data
  --export-only         Only export results, don't run validation
  --interactive         Interactive ground truth classification
  --batch               Non-interactive batch mode
  --help               Show this help message
`);
        process.exit(0);
        break;
    }
  }
  
  const validator = new ClassifierValidator(options);
  await validator.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ClassifierValidator;