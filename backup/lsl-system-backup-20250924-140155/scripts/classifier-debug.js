#!/usr/bin/env node
/**
 * ReliableCodingClassifier Operational Monitoring and Debugging Tools
 * 
 * Comprehensive debugging and monitoring toolkit for the ReliableCodingClassifier system.
 * Provides real-time diagnostics, performance monitoring, failure analysis, and 
 * operational health checks.
 * 
 * Features:
 * - Real-time classifier performance monitoring
 * - Interactive debugging sessions with step-by-step analysis
 * - Failure case analysis and reproduction
 * - Performance profiling and bottleneck identification
 * - Component health checks and status monitoring
 * - Historical performance trend analysis
 * - Configuration validation and optimization suggestions
 * - Live logging system integration monitoring
 * - Export diagnostic reports for support
 * 
 * Usage:
 * node scripts/classifier-debug.js [command] [options]
 * 
 * Commands:
 * monitor      Start real-time monitoring dashboard
 * analyze      Analyze specific exchange or failure case
 * profile      Run performance profiling
 * health       Check system health status
 * trends       Show historical performance trends
 * config       Validate and optimize configuration
 * live         Monitor live logging integration
 * report       Generate comprehensive diagnostic report
 * 
 * Options:
 * --exchange    Specific exchange text to analyze
 * --file        File containing exchange to analyze
 * --duration    Monitoring duration in minutes (default: 10)
 * --output      Output format: console|json|html (default: console)
 * --save        Save results to file
 * --verbose     Detailed debug output
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const readline = require('readline');
const EventEmitter = require('events');

// Import classifier and components
const ReliableCodingClassifier = require('../src/live-logging/ReliableCodingClassifier');
const PathAnalyzer = require('../src/live-logging/PathAnalyzer');
const KeywordMatcher = require('../src/live-logging/KeywordMatcher');
const SemanticAnalyzerAdapter = require('../src/live-logging/SemanticAnalyzerAdapter');
const ExchangeRouter = require('../src/live-logging/ExchangeRouter');
const OperationalLogger = require('../src/live-logging/OperationalLogger');
const StatusLineIntegrator = require('../src/live-logging/StatusLineIntegrator');

class ClassifierDebugger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      duration: options.duration || 10, // minutes
      output: options.output || 'console',
      verbose: options.verbose || false,
      save: options.save || false,
      ...options
    };

    this.projectPath = process.cwd();
    this.debugPath = path.join(this.projectPath, 'debug');
    
    // Ensure debug directory exists
    if (!fs.existsSync(this.debugPath)) {
      fs.mkdirSync(this.debugPath, { recursive: true });
    }

    // Initialize components
    this.classifier = null;
    this.components = {};
    this.monitoringData = {
      startTime: null,
      exchanges: [],
      performance: [],
      errors: [],
      healthChecks: [],
      trends: {}
    };

    // Create readline interface for interactive debugging
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Main entry point for debugging commands
   */
  async run(command, args) {
    try {
      console.log('🔧 ReliableCodingClassifier Debug Tools');
      console.log(`📊 Command: ${command}`);
      console.log(`⚙️  Options:`, this.options);
      console.log('');

      switch (command) {
        case 'monitor':
          await this.runMonitoring();
          break;
        case 'analyze':
          await this.runAnalysis(args);
          break;
        case 'profile':
          await this.runProfiling();
          break;
        case 'health':
          await this.runHealthCheck();
          break;
        case 'trends':
          await this.showTrends();
          break;
        case 'config':
          await this.validateConfiguration();
          break;
        case 'live':
          await this.monitorLiveLogging();
          break;
        case 'report':
          await this.generateReport();
          break;
        default:
          this.showHelp();
          break;
      }

    } catch (error) {
      console.error('❌ Debug operation failed:', error.message);
      if (this.options.verbose) {
        console.error('Stack trace:', error.stack);
      }
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  /**
   * Initialize classifier and components for debugging
   */
  async initializeComponents() {
    console.log('⚙️ Initializing classifier components...');
    
    try {
      // Initialize main classifier
      this.classifier = new ReliableCodingClassifier({
        debug: this.options.verbose,
        enableLogging: false
      });
      await this.classifier.initialize();

      // Initialize individual components for isolated testing
      this.components = {
        pathAnalyzer: new PathAnalyzer({ debug: this.options.verbose }),
        keywordMatcher: new KeywordMatcher({ debug: this.options.verbose }),
        semanticAnalyzer: new SemanticAnalyzerAdapter({ debug: this.options.verbose }),
        exchangeRouter: new ExchangeRouter({ debug: this.options.verbose }),
        operationalLogger: new OperationalLogger({ debug: this.options.verbose }),
        statusLineIntegrator: new StatusLineIntegrator({ debug: this.options.verbose })
      };

      // Initialize semantic analyzer if available
      if (this.components.semanticAnalyzer) {
        try {
          await this.components.semanticAnalyzer.initialize();
        } catch (error) {
          console.warn('⚠️ SemanticAnalyzer initialization failed:', error.message);
        }
      }

      console.log('✅ Components initialized successfully');
      return true;

    } catch (error) {
      console.error('❌ Component initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Run real-time monitoring dashboard
   */
  async runMonitoring() {
    console.log(`📊 Starting real-time monitoring (${this.options.duration} minutes)...`);
    
    await this.initializeComponents();
    
    this.monitoringData.startTime = Date.now();
    const endTime = this.monitoringData.startTime + (this.options.duration * 60 * 1000);
    
    // Set up monitoring intervals
    const statsInterval = setInterval(() => {
      this.collectPerformanceStats();
    }, 1000);
    
    const healthInterval = setInterval(() => {
      this.runHealthChecks();
    }, 10000);
    
    console.log('\n📈 Real-time Monitoring Dashboard');
    console.log('='.repeat(60));
    console.log('Press Ctrl+C to stop monitoring\n');
    
    // Monitoring loop
    while (Date.now() < endTime) {
      await this.displayMonitoringStatus();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Clear console and redraw (simple dashboard)
      if (this.options.output === 'console') {
        console.clear();
        console.log('\n📈 Real-time Monitoring Dashboard');
        console.log('='.repeat(60));
      }
    }
    
    // Cleanup
    clearInterval(statsInterval);
    clearInterval(healthInterval);
    
    console.log('\n✅ Monitoring completed');
    await this.saveMonitoringData();
  }

  /**
   * Analyze specific exchange or failure case
   */
  async runAnalysis(args) {
    console.log('🔍 Running exchange analysis...');
    
    await this.initializeComponents();
    
    let exchangeText = '';
    
    if (args.exchange) {
      exchangeText = args.exchange;
    } else if (args.file) {
      if (!fs.existsSync(args.file)) {
        throw new Error(`Analysis file not found: ${args.file}`);
      }
      exchangeText = fs.readFileSync(args.file, 'utf8');
    } else {
      // Interactive mode
      console.log('📝 Enter exchange text (type "END" on a new line to finish):');
      exchangeText = await this.getMultilineInput();
    }
    
    if (!exchangeText.trim()) {
      throw new Error('No exchange text provided for analysis');
    }
    
    const exchange = this.parseExchange(exchangeText);
    console.log('\n🔬 Detailed Analysis:');
    console.log('='.repeat(60));
    
    await this.performDetailedAnalysis(exchange);
  }

  /**
   * Perform step-by-step detailed analysis
   */
  async performDetailedAnalysis(exchange) {
    const analysisStart = performance.now();
    
    console.log('\n📋 Exchange Summary:');
    console.log(`   User Message: ${exchange.userMessage.substring(0, 100)}...`);
    console.log(`   Assistant Response: ${exchange.assistantResponse.substring(0, 100)}...`);
    console.log(`   Total Length: ${exchange.userMessage.length + exchange.assistantResponse.length} characters`);
    
    // Step 1: Path Analysis
    console.log('\n🛤️  Step 1: Path Analysis');
    const pathStart = performance.now();
    const pathResult = await this.components.pathAnalyzer.analyze(exchange);
    const pathTime = performance.now() - pathStart;
    
    console.log(`   Result: ${pathResult.isCoding ? 'CODING' : 'NOT_CODING'}`);
    console.log(`   Confidence: ${pathResult.confidence.toFixed(3)}`);
    console.log(`   Detected Paths: ${pathResult.detectedPaths?.length || 0}`);
    console.log(`   Processing Time: ${pathTime.toFixed(2)}ms`);
    
    if (pathResult.detectedPaths && pathResult.detectedPaths.length > 0) {
      console.log(`   Sample Paths:`);
      pathResult.detectedPaths.slice(0, 3).forEach(path => {
        console.log(`     - ${path}`);
      });
    }
    
    // Step 2: Semantic Analysis (if available)
    console.log('\n🧠 Step 2: Semantic Analysis');
    let semanticResult = null;
    if (this.components.semanticAnalyzer && this.components.semanticAnalyzer.isReady()) {
      const semanticStart = performance.now();
      try {
        semanticResult = await this.components.semanticAnalyzer.analyze(exchange);
        const semanticTime = performance.now() - semanticStart;
        
        console.log(`   Result: ${semanticResult.isCoding ? 'CODING' : 'NOT_CODING'}`);
        console.log(`   Confidence: ${semanticResult.confidence.toFixed(3)}`);
        console.log(`   Processing Time: ${semanticTime.toFixed(2)}ms`);
        
        if (semanticResult.features) {
          console.log(`   Key Features: ${Object.keys(semanticResult.features).slice(0, 3).join(', ')}`);
        }
        
      } catch (error) {
        console.log(`   Error: ${error.message}`);
      }
    } else {
      console.log(`   Status: Not available or not ready`);
    }
    
    // Step 3: Keyword Matching
    console.log('\n🔑 Step 3: Keyword Matching');
    const keywordStart = performance.now();
    const keywordResult = await this.components.keywordMatcher.analyze(exchange);
    const keywordTime = performance.now() - keywordStart;
    
    console.log(`   Result: ${keywordResult.isCoding ? 'CODING' : 'NOT_CODING'}`);
    console.log(`   Confidence: ${keywordResult.confidence.toFixed(3)}`);
    console.log(`   Processing Time: ${keywordTime.toFixed(2)}ms`);
    console.log(`   Matched Keywords: ${keywordResult.matchedKeywords?.length || 0}`);
    
    if (keywordResult.matchedKeywords && keywordResult.matchedKeywords.length > 0) {
      console.log(`   Sample Matches:`);
      keywordResult.matchedKeywords.slice(0, 5).forEach(keyword => {
        console.log(`     - ${keyword}`);
      });
    }
    
    // Step 4: Final Classification
    console.log('\n🎯 Step 4: Final Classification');
    const classificationStart = performance.now();
    const finalResult = await this.classifier.classifyExchange(exchange);
    const classificationTime = performance.now() - classificationStart;
    
    console.log(`   Final Result: ${finalResult.classification}`);
    console.log(`   Is Coding: ${finalResult.isCoding}`);
    console.log(`   Confidence: ${finalResult.confidence.toFixed(3)}`);
    console.log(`   Layer: ${finalResult.layer}`);
    console.log(`   Total Processing Time: ${classificationTime.toFixed(2)}ms`);
    
    // Step 5: Router Decision
    console.log('\n🚦 Step 5: Router Decision');
    const routingResult = await this.components.exchangeRouter.determineRouting(
      exchange, finalResult, { currentProject: 'test' }
    );
    
    console.log(`   Should Redirect: ${routingResult.shouldRedirect}`);
    console.log(`   Target Project: ${routingResult.targetProject}`);
    console.log(`   Reason: ${routingResult.reason}`);
    
    const totalTime = performance.now() - analysisStart;
    console.log('\n⏱️  Performance Summary:');
    console.log(`   Total Analysis Time: ${totalTime.toFixed(2)}ms`);
    console.log(`   Path Analysis: ${pathTime.toFixed(2)}ms (${((pathTime/totalTime)*100).toFixed(1)}%)`);
    console.log(`   Semantic Analysis: ${semanticResult ? 'Available' : 'Skipped'}`);
    console.log(`   Keyword Matching: ${keywordTime.toFixed(2)}ms (${((keywordTime/totalTime)*100).toFixed(1)}%)`);
    console.log(`   Overall Classification: ${classificationTime.toFixed(2)}ms`);
    
    // Save detailed analysis
    if (this.options.save) {
      const analysisReport = {
        timestamp: new Date().toISOString(),
        exchange,
        analysis: {
          pathResult,
          semanticResult,
          keywordResult,
          finalResult,
          routingResult
        },
        performance: {
          totalTime,
          pathTime,
          keywordTime,
          classificationTime
        }
      };
      
      const reportPath = path.join(this.debugPath, `analysis-${Date.now()}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(analysisReport, null, 2));
      console.log(`\n📄 Detailed analysis saved to: ${reportPath}`);
    }
  }

  /**
   * Run performance profiling
   */
  async runProfiling() {
    console.log('⚡ Running performance profiling...');
    
    await this.initializeComponents();
    
    // Test exchanges for profiling
    const testExchanges = [
      {
        userMessage: 'Can you read the file at /Users/q284340/Agentic/coding/CLAUDE.md?',
        assistantResponse: 'I\'ll read the CLAUDE.md file for you. [tool use] Read /Users/q284340/Agentic/coding/CLAUDE.md'
      },
      {
        userMessage: 'What\'s the weather like today?',
        assistantResponse: 'I don\'t have access to real-time weather data.'
      },
      {
        userMessage: 'Help me fix this Node.js error in my package.json',
        assistantResponse: 'I can help you fix the Node.js error. Let me examine your package.json file.'
      },
      {
        userMessage: 'Hello, how are you?',
        assistantResponse: 'Hello! I\'m doing well, thank you for asking. How can I help you today?'
      }
    ];
    
    const profileResults = {
      timestamp: new Date().toISOString(),
      testRuns: [],
      statistics: {
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        standardDeviation: 0
      }
    };
    
    console.log(`🔬 Profiling ${testExchanges.length} test exchanges...`);
    
    for (let i = 0; i < testExchanges.length; i++) {
      const exchange = testExchanges[i];
      console.log(`\n📊 Test ${i + 1}/${testExchanges.length}: ${exchange.userMessage.substring(0, 50)}...`);
      
      // Run multiple iterations for statistical significance
      const iterations = 10;
      const times = [];
      
      for (let j = 0; j < iterations; j++) {
        const start = performance.now();
        const result = await this.classifier.classifyExchange(exchange);
        const time = performance.now() - start;
        times.push(time);
        
        process.stdout.write(`   Iteration ${j + 1}/${iterations}: ${time.toFixed(2)}ms\r`);
      }
      
      const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);
      
      const testResult = {
        exchange,
        iterations,
        times,
        statistics: { avgTime, minTime, maxTime, stdDev }
      };
      
      profileResults.testRuns.push(testResult);
      
      console.log(`   Average: ${avgTime.toFixed(2)}ms, Min: ${minTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms, StdDev: ${stdDev.toFixed(2)}ms`);
    }
    
    // Calculate overall statistics
    const allTimes = profileResults.testRuns.flatMap(run => run.times);
    profileResults.statistics.avgTime = allTimes.reduce((sum, time) => sum + time, 0) / allTimes.length;
    profileResults.statistics.minTime = Math.min(...allTimes);
    profileResults.statistics.maxTime = Math.max(...allTimes);
    
    const overallVariance = allTimes.reduce((sum, time) => sum + Math.pow(time - profileResults.statistics.avgTime, 2), 0) / allTimes.length;
    profileResults.statistics.standardDeviation = Math.sqrt(overallVariance);
    
    console.log('\n📈 Overall Performance Results:');
    console.log(`   Average Time: ${profileResults.statistics.avgTime.toFixed(2)}ms`);
    console.log(`   Min Time: ${profileResults.statistics.minTime.toFixed(2)}ms`);
    console.log(`   Max Time: ${profileResults.statistics.maxTime.toFixed(2)}ms`);
    console.log(`   Standard Deviation: ${profileResults.statistics.standardDeviation.toFixed(2)}ms`);
    console.log(`   Total Tests: ${allTimes.length} classifications`);
    
    // Performance analysis
    const target = 10; // Target <10ms
    const withinTarget = allTimes.filter(time => time < target).length;
    const targetPercentage = (withinTarget / allTimes.length) * 100;
    
    console.log(`\n🎯 Performance Analysis:`);
    console.log(`   Target: <${target}ms`);
    console.log(`   Within Target: ${withinTarget}/${allTimes.length} (${targetPercentage.toFixed(1)}%)`);
    console.log(`   Status: ${targetPercentage >= 95 ? '✅ EXCELLENT' : targetPercentage >= 85 ? '⚠️ GOOD' : '❌ NEEDS IMPROVEMENT'}`);
    
    // Save profiling results
    const profilePath = path.join(this.debugPath, `profile-${Date.now()}.json`);
    fs.writeFileSync(profilePath, JSON.stringify(profileResults, null, 2));
    console.log(`\n📄 Profiling results saved to: ${profilePath}`);
  }

  /**
   * Run comprehensive health checks
   */
  async runHealthCheck() {
    console.log('🏥 Running system health checks...');
    
    const healthReport = {
      timestamp: new Date().toISOString(),
      overall: 'UNKNOWN',
      components: {},
      issues: [],
      recommendations: []
    };
    
    try {
      // Initialize components first
      await this.initializeComponents();
      
      // Check classifier health
      console.log('\n🎯 Checking ReliableCodingClassifier...');
      healthReport.components.classifier = await this.checkClassifierHealth();
      
      // Check individual components
      console.log('\n🔧 Checking individual components...');
      for (const [name, component] of Object.entries(this.components)) {
        console.log(`   Checking ${name}...`);
        healthReport.components[name] = await this.checkComponentHealth(name, component);
      }
      
      // Check file system resources
      console.log('\n📁 Checking file system resources...');
      healthReport.components.filesystem = await this.checkFileSystemHealth();
      
      // Check performance requirements
      console.log('\n⚡ Checking performance requirements...');
      healthReport.components.performance = await this.checkPerformanceHealth();
      
      // Determine overall health
      const componentStatuses = Object.values(healthReport.components).map(c => c.status);
      const criticalIssues = componentStatuses.filter(status => status === 'CRITICAL').length;
      const warnings = componentStatuses.filter(status => status === 'WARNING').length;
      
      if (criticalIssues > 0) {
        healthReport.overall = 'CRITICAL';
      } else if (warnings > 0) {
        healthReport.overall = 'WARNING';
      } else {
        healthReport.overall = 'HEALTHY';
      }
      
      console.log('\n📊 Health Check Summary:');
      console.log('='.repeat(50));
      console.log(`   Overall Status: ${healthReport.overall}`);
      console.log(`   Critical Issues: ${criticalIssues}`);
      console.log(`   Warnings: ${warnings}`);
      console.log(`   Healthy Components: ${componentStatuses.filter(s => s === 'HEALTHY').length}`);
      
      if (healthReport.issues.length > 0) {
        console.log(`\n❌ Issues Found:`);
        healthReport.issues.forEach((issue, i) => {
          console.log(`   ${i + 1}. ${issue}`);
        });
      }
      
      if (healthReport.recommendations.length > 0) {
        console.log(`\n💡 Recommendations:`);
        healthReport.recommendations.forEach((rec, i) => {
          console.log(`   ${i + 1}. ${rec}`);
        });
      }
      
    } catch (error) {
      healthReport.overall = 'CRITICAL';
      healthReport.issues.push(`Health check failed: ${error.message}`);
      console.error('❌ Health check failed:', error.message);
    }
    
    // Save health report
    const healthPath = path.join(this.debugPath, `health-${Date.now()}.json`);
    fs.writeFileSync(healthPath, JSON.stringify(healthReport, null, 2));
    console.log(`\n📄 Health report saved to: ${healthPath}`);
    
    return healthReport;
  }

  /**
   * Check classifier-specific health
   */
  async checkClassifierHealth() {
    const health = {
      status: 'HEALTHY',
      initialized: false,
      testClassification: null,
      issues: []
    };
    
    try {
      // Test basic classification
      const testExchange = {
        userMessage: 'Test message',
        assistantResponse: 'Test response'
      };
      
      const start = performance.now();
      const result = await this.classifier.classifyExchange(testExchange);
      const time = performance.now() - start;
      
      health.initialized = true;
      health.testClassification = {
        result: result.classification,
        time: time,
        confidence: result.confidence
      };
      
      if (time > 50) {
        health.status = 'WARNING';
        health.issues.push(`Slow classification time: ${time.toFixed(2)}ms`);
      }
      
    } catch (error) {
      health.status = 'CRITICAL';
      health.issues.push(`Classification test failed: ${error.message}`);
    }
    
    return health;
  }

  /**
   * Check individual component health
   */
  async checkComponentHealth(name, component) {
    const health = {
      status: 'HEALTHY',
      available: !!component,
      initialized: false,
      issues: []
    };
    
    if (!component) {
      health.status = 'CRITICAL';
      health.issues.push('Component not available');
      return health;
    }
    
    try {
      // Check if component has required methods
      const requiredMethods = ['analyze'];
      for (const method of requiredMethods) {
        if (typeof component[method] !== 'function') {
          health.status = 'WARNING';
          health.issues.push(`Missing method: ${method}`);
        }
      }
      
      // Test component if it has analyze method
      if (component.analyze) {
        const testExchange = {
          userMessage: 'Test message',
          assistantResponse: 'Test response'
        };
        
        const result = await component.analyze(testExchange);
        health.initialized = true;
        
        if (!result || typeof result.isCoding !== 'boolean') {
          health.status = 'WARNING';
          health.issues.push('Unexpected analysis result format');
        }
      }
      
    } catch (error) {
      health.status = 'WARNING';
      health.issues.push(`Component test failed: ${error.message}`);
    }
    
    return health;
  }

  /**
   * Check file system health
   */
  async checkFileSystemHealth() {
    const health = {
      status: 'HEALTHY',
      paths: {},
      issues: []
    };
    
    const pathsToCheck = [
      this.projectPath,
      path.join(this.projectPath, '.specstory', 'history'),
      this.debugPath
    ];
    
    for (const checkPath of pathsToCheck) {
      try {
        const exists = fs.existsSync(checkPath);
        const stats = exists ? fs.statSync(checkPath) : null;
        
        health.paths[checkPath] = {
          exists,
          readable: exists ? fs.constants.R_OK : false,
          writable: exists ? fs.constants.W_OK : false,
          isDirectory: stats ? stats.isDirectory() : false
        };
        
        if (!exists) {
          health.status = 'WARNING';
          health.issues.push(`Path does not exist: ${checkPath}`);
        }
        
      } catch (error) {
        health.status = 'WARNING';
        health.issues.push(`Cannot access path ${checkPath}: ${error.message}`);
      }
    }
    
    return health;
  }

  /**
   * Check performance health
   */
  async checkPerformanceHealth() {
    const health = {
      status: 'HEALTHY',
      metrics: {},
      issues: []
    };
    
    try {
      // Quick performance test
      const testExchange = {
        userMessage: 'Performance test message',
        assistantResponse: 'Performance test response'
      };
      
      const iterations = 5;
      const times = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await this.classifier.classifyExchange(testExchange);
        times.push(performance.now() - start);
      }
      
      const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      const maxTime = Math.max(...times);
      
      health.metrics = {
        avgTime: avgTime,
        maxTime: maxTime,
        target: 10,
        withinTarget: avgTime < 10
      };
      
      if (avgTime > 10) {
        health.status = 'WARNING';
        health.issues.push(`Average classification time (${avgTime.toFixed(2)}ms) exceeds target (10ms)`);
      }
      
      if (maxTime > 50) {
        health.status = 'WARNING';
        health.issues.push(`Maximum classification time (${maxTime.toFixed(2)}ms) is concerning`);
      }
      
    } catch (error) {
      health.status = 'CRITICAL';
      health.issues.push(`Performance test failed: ${error.message}`);
    }
    
    return health;
  }

  /**
   * Display real-time monitoring status
   */
  async displayMonitoringStatus() {
    const uptime = (Date.now() - this.monitoringData.startTime) / 1000;
    const stats = this.getMonitoringStats();
    
    console.log(`⏰ Uptime: ${uptime.toFixed(0)}s`);
    console.log(`📊 Exchanges Processed: ${stats.totalExchanges}`);
    console.log(`⚡ Avg Processing Time: ${stats.avgTime.toFixed(2)}ms`);
    console.log(`❌ Errors: ${stats.errors}`);
    console.log(`🏥 Health Status: ${stats.healthStatus}`);
    console.log('');
  }

  /**
   * Get current monitoring statistics
   */
  getMonitoringStats() {
    return {
      totalExchanges: this.monitoringData.exchanges.length,
      avgTime: this.monitoringData.performance.length > 0 
        ? this.monitoringData.performance.reduce((sum, p) => sum + p.time, 0) / this.monitoringData.performance.length 
        : 0,
      errors: this.monitoringData.errors.length,
      healthStatus: this.monitoringData.healthChecks.length > 0 
        ? this.monitoringData.healthChecks[this.monitoringData.healthChecks.length - 1].status 
        : 'UNKNOWN'
    };
  }

  /**
   * Parse exchange from text input
   */
  parseExchange(text) {
    const lines = text.trim().split('\n');
    const exchange = { userMessage: '', assistantResponse: '' };
    
    let currentSection = null;
    let content = [];
    
    for (const line of lines) {
      if (line.toLowerCase().includes('user')) {
        currentSection = 'user';
        content = [];
      } else if (line.toLowerCase().includes('assistant')) {
        if (currentSection === 'user') {
          exchange.userMessage = content.join('\n').trim();
        }
        currentSection = 'assistant';
        content = [];
      } else if (currentSection) {
        content.push(line);
      }
    }
    
    if (currentSection === 'assistant') {
      exchange.assistantResponse = content.join('\n').trim();
    }
    
    // If no clear sections found, treat entire text as user message
    if (!exchange.userMessage && !exchange.assistantResponse) {
      exchange.userMessage = text;
      exchange.assistantResponse = 'Test response for analysis';
    }
    
    return exchange;
  }

  /**
   * Get multiline input from user
   */
  async getMultilineInput() {
    const lines = [];
    
    return new Promise((resolve) => {
      const processLine = (line) => {
        if (line.trim().toUpperCase() === 'END') {
          resolve(lines.join('\n'));
        } else {
          lines.push(line);
          this.rl.question('', processLine);
        }
      };
      
      this.rl.question('', processLine);
    });
  }

  /**
   * Save monitoring data
   */
  async saveMonitoringData() {
    const dataPath = path.join(this.debugPath, `monitoring-${Date.now()}.json`);
    fs.writeFileSync(dataPath, JSON.stringify(this.monitoringData, null, 2));
    console.log(`📄 Monitoring data saved to: ${dataPath}`);
  }

  /**
   * Generate comprehensive diagnostic report
   */
  async generateReport() {
    console.log('📄 Generating comprehensive diagnostic report...');
    
    const report = {
      timestamp: new Date().toISOString(),
      system: {
        node: process.version,
        platform: process.platform,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      },
      health: null,
      configuration: null,
      recentErrors: [],
      recommendations: []
    };
    
    try {
      // Run health check
      report.health = await this.runHealthCheck();
      
      // Collect recent error logs
      const errorLogPath = path.join(this.projectPath, 'logs', 'classifier-errors.log');
      if (fs.existsSync(errorLogPath)) {
        const errorLog = fs.readFileSync(errorLogPath, 'utf8');
        report.recentErrors = errorLog.split('\n')
          .filter(line => line.trim())
          .slice(-10); // Last 10 errors
      }
      
      // Generate recommendations
      report.recommendations = this.generateRecommendations(report);
      
      console.log('✅ Diagnostic report generated successfully');
      
    } catch (error) {
      console.error('❌ Report generation failed:', error.message);
      report.error = error.message;
    }
    
    // Save report
    const reportPath = path.join(this.debugPath, `diagnostic-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Diagnostic report saved to: ${reportPath}`);
    
    return report;
  }

  /**
   * Generate system recommendations
   */
  generateRecommendations(report) {
    const recommendations = [];
    
    if (report.health && report.health.overall !== 'HEALTHY') {
      recommendations.push('System health issues detected - review component status');
    }
    
    if (report.system.memory.heapUsed > 100 * 1024 * 1024) { // 100MB
      recommendations.push('High memory usage detected - consider optimizing classifier components');
    }
    
    if (report.recentErrors.length > 5) {
      recommendations.push('High error rate - investigate recent error patterns');
    }
    
    recommendations.push('Run regular health checks to monitor system performance');
    recommendations.push('Consider implementing automated alerts for critical issues');
    
    return recommendations;
  }

  /**
   * Show help information
   */
  showHelp() {
    console.log(`
ReliableCodingClassifier Debug Tools

Usage: node scripts/classifier-debug.js [command] [options]

Commands:
  monitor      Start real-time monitoring dashboard
  analyze      Analyze specific exchange or failure case
  profile      Run performance profiling
  health       Check system health status
  trends       Show historical performance trends
  config       Validate and optimize configuration
  live         Monitor live logging integration
  report       Generate comprehensive diagnostic report

Options:
  --exchange     Specific exchange text to analyze
  --file         File containing exchange to analyze
  --duration     Monitoring duration in minutes (default: 10)
  --output       Output format: console|json|html (default: console)
  --save         Save results to file
  --verbose      Detailed debug output

Examples:
  # Real-time monitoring for 5 minutes
  node scripts/classifier-debug.js monitor --duration 5

  # Analyze specific exchange text
  node scripts/classifier-debug.js analyze --exchange "Help me debug this code"

  # Run performance profiling
  node scripts/classifier-debug.js profile --save

  # Check system health
  node scripts/classifier-debug.js health --verbose

  # Generate full diagnostic report
  node scripts/classifier-debug.js report
`);
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  
  const options = {};
  const commandArgs = {};
  
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--exchange':
        commandArgs.exchange = args[++i];
        break;
      case '--file':
        commandArgs.file = args[++i];
        break;
      case '--duration':
        options.duration = parseInt(args[++i]);
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--save':
        options.save = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
    }
  }
  
  const debugger = new ClassifierDebugger(options);
  await debugger.run(command, commandArgs);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ClassifierDebugger;