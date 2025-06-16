#!/usr/bin/env node

/**
 * Code Pattern Analyzer for UKB
 * 
 * This script analyzes code changes and file structures to identify
 * architectural patterns, design patterns, and implementation strategies
 * that can be captured as transferable knowledge.
 */

const fs = require('fs');
const path = require('path');

class CodeAnalyzer {
  constructor(sessionDir) {
    this.sessionDir = sessionDir;
    this.insights = [];
    this.patterns = {
      // Architectural patterns
      mvc: /(?:model|view|controller|router|service)/gi,
      redux: /(?:store|slice|reducer|action|dispatch|selector)/gi,
      hooks: /use[A-Z]\w+/g,
      context: /(?:context|provider|consumer)/gi,
      
      // Design patterns
      factory: /(?:create|factory|builder)/gi,
      observer: /(?:subscribe|observe|emit|listener)/gi,
      singleton: /(?:instance|singleton)/gi,
      strategy: /(?:strategy|handler|adapter)/gi,
      
      // Performance patterns
      memoization: /(?:memo|cache|memoiz)/gi,
      lazy: /(?:lazy|defer|async|await)/gi,
      optimization: /(?:optimize|performance|efficient)/gi,
      
      // Error handling patterns
      errorBoundary: /(?:error.?boundary|catch|try|throw)/gi,
      validation: /(?:validate|schema|type.?check)/gi,
      
      // Testing patterns
      testUtils: /(?:test|spec|mock|stub|spy)/gi,
      
      // Logging patterns
      logging: /(?:log|debug|console|logger)/gi
    };
  }

  async analyze() {
    console.log('🔍 Analyzing code patterns...');
    
    // Load analysis request
    const requestPath = path.join(this.sessionDir, 'agent_analysis_request.json');
    let analysisRequest = null;
    
    if (fs.existsSync(requestPath)) {
      analysisRequest = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    }
    
    // Analyze changed files
    const changedFiles = analysisRequest?.sources?.changed_files || [];
    for (const file of changedFiles) {
      await this.analyzeFile(file);
    }
    
    // Analyze project structure
    await this.analyzeProjectStructure();
    
    // Analyze git diff patterns
    await this.analyzeGitPatterns();
    
    // Save insights
    this.saveInsights();
    
    console.log(`✅ Code analysis complete: Found ${this.insights.length} architectural patterns`);
  }

  async analyzeFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return;
    }
    
    console.log(`📄 Analyzing: ${filePath}`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    const fileExt = path.extname(filePath);
    
    // Determine file type and analyze accordingly
    if (['.js', '.jsx', '.ts', '.tsx'].includes(fileExt)) {
      await this.analyzeJavaScriptFile(filePath, content);
    } else if (['.py'].includes(fileExt)) {
      await this.analyzePythonFile(filePath, content);
    } else if (['.rs'].includes(fileExt)) {
      await this.analyzeRustFile(filePath, content);
    } else if (['.sh', '.bash'].includes(fileExt)) {
      await this.analyzeShellFile(filePath, content);
    }
    
    // Generic pattern analysis
    await this.analyzeGenericPatterns(filePath, content);
  }

  async analyzeJavaScriptFile(filePath, content) {
    const insights = [];
    
    // React patterns
    if (content.includes('useState') || content.includes('useEffect')) {
      const hookMatches = content.match(/use[A-Z]\w+/g) || [];
      if (hookMatches.length >= 3) {
        insights.push({
          pattern: 'hooks-pattern',
          description: `Complex React hooks usage with ${hookMatches.length} hooks`,
          significance: 7,
          hooks: hookMatches
        });
      }
    }
    
    // Redux patterns
    if (content.includes('createSlice') || content.includes('useSelector')) {
      insights.push({
        pattern: 'redux-pattern',
        description: 'Redux Toolkit state management implementation',
        significance: 8,
        stateManagement: true
      });
    }
    
    // Custom hook patterns
    const customHooks = content.match(/function use[A-Z]\w+|const use[A-Z]\w+ =/g);
    if (customHooks && customHooks.length > 0) {
      insights.push({
        pattern: 'custom-hooks',
        description: `Custom React hooks: ${customHooks.join(', ')}`,
        significance: 7,
        hooks: customHooks
      });
    }
    
    // Context patterns
    if (content.includes('createContext') || content.includes('Provider')) {
      insights.push({
        pattern: 'context-pattern',
        description: 'React Context implementation for state sharing',
        significance: 7,
        contextUsage: true
      });
    }
    
    // Performance optimization patterns
    if (content.includes('useMemo') || content.includes('useCallback') || content.includes('React.memo')) {
      insights.push({
        pattern: 'performance-optimization',
        description: 'React performance optimization with memoization',
        significance: 8,
        optimization: true
      });
    }
    
    // Error boundary patterns
    if (content.includes('componentDidCatch') || content.includes('ErrorBoundary')) {
      insights.push({
        pattern: 'error-boundary',
        description: 'Error boundary implementation for error handling',
        significance: 7,
        errorHandling: true
      });
    }
    
    // Convert insights to transferable patterns
    for (const insight of insights) {
      this.createTransferablePattern(insight, filePath, 'JavaScript/TypeScript');
    }
  }

  async analyzePythonFile(filePath, content) {
    const insights = [];
    
    // Class-based patterns
    const classMatches = content.match(/class \w+/g);
    if (classMatches && classMatches.length > 2) {
      insights.push({
        pattern: 'oop-architecture',
        description: `Object-oriented design with ${classMatches.length} classes`,
        significance: 7,
        classes: classMatches
      });
    }
    
    // Decorator patterns
    if (content.includes('@') && content.match(/@\w+/g)) {
      insights.push({
        pattern: 'decorator-pattern',
        description: 'Python decorator usage for cross-cutting concerns',
        significance: 6,
        decorators: true
      });
    }
    
    // Async patterns
    if (content.includes('async def') || content.includes('await')) {
      insights.push({
        pattern: 'async-pattern',
        description: 'Asynchronous programming implementation',
        significance: 7,
        async: true
      });
    }
    
    for (const insight of insights) {
      this.createTransferablePattern(insight, filePath, 'Python');
    }
  }

  async analyzeRustFile(filePath, content) {
    const insights = [];
    
    // Trait patterns
    if (content.includes('trait ') || content.includes('impl ')) {
      insights.push({
        pattern: 'trait-pattern',
        description: 'Rust trait system for code organization',
        significance: 8,
        traits: true
      });
    }
    
    // Error handling patterns
    if (content.includes('Result<') || content.includes('Option<')) {
      insights.push({
        pattern: 'rust-error-handling',
        description: 'Rust error handling with Result and Option types',
        significance: 8,
        errorHandling: true
      });
    }
    
    // Memory safety patterns
    if (content.includes('Box<') || content.includes('Rc<') || content.includes('Arc<')) {
      insights.push({
        pattern: 'memory-management',
        description: 'Rust smart pointer usage for memory management',
        significance: 9,
        memoryManagement: true
      });
    }
    
    for (const insight of insights) {
      this.createTransferablePattern(insight, filePath, 'Rust');
    }
  }

  async analyzeShellFile(filePath, content) {
    const insights = [];
    
    // Error handling patterns
    if (content.includes('set -e') || content.includes('trap')) {
      insights.push({
        pattern: 'shell-error-handling',
        description: 'Robust shell script error handling',
        significance: 7,
        errorHandling: true
      });
    }
    
    // Function patterns
    const functions = content.match(/^[a-zA-Z_][a-zA-Z0-9_]*\(\)/gm);
    if (functions && functions.length >= 5) {
      insights.push({
        pattern: 'shell-modularization',
        description: `Modular shell script with ${functions.length} functions`,
        significance: 6,
        functions: functions
      });
    }
    
    // Validation patterns
    if (content.includes('command -v') || content.includes('which')) {
      insights.push({
        pattern: 'dependency-validation',
        description: 'Command dependency validation in shell scripts',
        significance: 6,
        validation: true
      });
    }
    
    for (const insight of insights) {
      this.createTransferablePattern(insight, filePath, 'Shell');
    }
  }

  async analyzeGenericPatterns(filePath, content) {
    // Configuration patterns
    if (content.includes('config') || content.includes('settings')) {
      this.createTransferablePattern({
        pattern: 'configuration-management',
        description: 'Configuration management implementation',
        significance: 6,
        config: true
      }, filePath, 'Generic');
    }
    
    // Logging patterns
    const logMatches = content.match(/log\.|console\.|print\(/g);
    if (logMatches && logMatches.length > 5) {
      this.createTransferablePattern({
        pattern: 'logging-pattern',
        description: `Comprehensive logging with ${logMatches.length} log statements`,
        significance: 6,
        logging: true
      }, filePath, 'Generic');
    }
  }

  async analyzeProjectStructure() {
    console.log('🏗️  Analyzing project structure...');
    
    // Check for common architectural patterns
    const patterns = this.detectStructuralPatterns();
    
    for (const pattern of patterns) {
      this.createTransferablePattern(pattern, 'Project Structure', 'Architecture');
    }
  }

  detectStructuralPatterns() {
    const patterns = [];
    const projectRoot = process.cwd();
    
    // MVC pattern detection
    const hasMVC = ['models', 'views', 'controllers'].every(dir => 
      fs.existsSync(path.join(projectRoot, dir)) || 
      fs.existsSync(path.join(projectRoot, 'src', dir))
    );
    
    if (hasMVC) {
      patterns.push({
        pattern: 'mvc-architecture',
        description: 'Model-View-Controller architectural pattern',
        significance: 9,
        architecture: true
      });
    }
    
    // Microservices pattern
    const hasServices = fs.existsSync(path.join(projectRoot, 'services')) ||
                       fs.existsSync(path.join(projectRoot, 'microservices'));
    
    if (hasServices) {
      patterns.push({
        pattern: 'microservices-architecture',
        description: 'Microservices architectural pattern',
        significance: 9,
        architecture: true
      });
    }
    
    // Monorepo pattern
    const hasPackages = fs.existsSync(path.join(projectRoot, 'packages')) ||
                       fs.existsSync(path.join(projectRoot, 'apps'));
    
    if (hasPackages) {
      patterns.push({
        pattern: 'monorepo-structure',
        description: 'Monorepo project organization',
        significance: 8,
        architecture: true
      });
    }
    
    return patterns;
  }

  async analyzeGitPatterns() {
    console.log('📊 Analyzing git commit patterns...');
    
    try {
      const { execSync } = require('child_process');
      
      // Get commit frequency
      const commitCount = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
      
      // Get file change patterns
      const fileChanges = execSync('git log --name-only --pretty=format: HEAD~10..HEAD', { encoding: 'utf8' })
        .split('\n')
        .filter(line => line.trim())
        .reduce((acc, file) => {
          acc[file] = (acc[file] || 0) + 1;
          return acc;
        }, {});
      
      // Identify hotspots
      const hotspots = Object.entries(fileChanges)
        .filter(([file, count]) => count >= 3)
        .map(([file, count]) => ({ file, count }));
      
      if (hotspots.length > 0) {
        this.createTransferablePattern({
          pattern: 'code-hotspots',
          description: `Code hotspots requiring attention: ${hotspots.length} files`,
          significance: 7,
          hotspots: hotspots
        }, 'Git Analysis', 'Development Process');
      }
      
    } catch (error) {
      console.log('Git analysis skipped (no git repository)');
    }
  }

  createTransferablePattern(insight, filePath, technology) {
    const patternName = this.generatePatternName(insight.pattern, insight.description);
    
    const pattern = {
      type: 'entity',
      name: patternName,
      entityType: 'ArchitecturalPattern',
      problem: this.inferProblem(insight),
      solution: insight.description,
      approach: this.generateApproach(insight, filePath),
      applicability: this.generateApplicability(insight.pattern),
      technologies: [technology],
      code_files: [filePath],
      observations: [
        `Pattern type: ${insight.pattern}`,
        `Source file: ${filePath}`,
        `Technology: ${technology}`,
        `Significance: ${insight.significance}/10`,
        'Source: code-analysis',
        ...this.generateObservations(insight)
      ],
      significance: insight.significance,
      metadata: {
        source: 'code-analysis',
        pattern_type: insight.pattern,
        extracted_from: ['code'],
        file_path: filePath
      }
    };
    
    this.insights.push(pattern);
  }

  generatePatternName(patternType, description) {
    const words = description.split(' ')
      .filter(word => word.length > 3)
      .slice(0, 3)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    
    return words.join('') + 'Pattern';
  }

  inferProblem(insight) {
    const problemMap = {
      'hooks-pattern': 'Complex state management and side effects in React components',
      'redux-pattern': 'Global state management across large React applications',
      'custom-hooks': 'Reusable stateful logic across multiple components',
      'context-pattern': 'Prop drilling and state sharing between distant components',
      'performance-optimization': 'Rendering performance issues in React applications',
      'error-boundary': 'Unhandled errors crashing React application',
      'oop-architecture': 'Code organization and maintainability in large Python projects',
      'decorator-pattern': 'Cross-cutting concerns and code reusability',
      'async-pattern': 'Handling asynchronous operations efficiently',
      'trait-pattern': 'Code reuse and polymorphism in Rust',
      'rust-error-handling': 'Safe error handling without exceptions',
      'memory-management': 'Manual memory management and ownership',
      'shell-error-handling': 'Robust error handling in shell scripts',
      'shell-modularization': 'Code organization in complex shell scripts',
      'dependency-validation': 'Script execution environment validation',
      'configuration-management': 'Application configuration and settings management',
      'logging-pattern': 'Debugging and monitoring application behavior',
      'mvc-architecture': 'Code organization in large applications',
      'microservices-architecture': 'Scalability and maintainability of large systems',
      'monorepo-structure': 'Managing multiple related projects',
      'code-hotspots': 'Code quality and maintenance burden'
    };
    
    return problemMap[insight.pattern] || 'Complex software development challenge';
  }

  generateApproach(insight, filePath) {
    return `Implemented in ${path.basename(filePath)}: ${insight.description}`;
  }

  generateApplicability(patternType) {
    const applicabilityMap = {
      'hooks-pattern': 'React applications with complex component state',
      'redux-pattern': 'Large React applications requiring predictable state',
      'custom-hooks': 'React codebases with reusable stateful logic',
      'context-pattern': 'React applications with deeply nested components',
      'performance-optimization': 'Performance-critical React applications',
      'error-boundary': 'Production React applications requiring error resilience',
      'oop-architecture': 'Large-scale Python applications and libraries',
      'decorator-pattern': 'Python applications with cross-cutting concerns',
      'async-pattern': 'I/O intensive applications',
      'trait-pattern': 'Rust libraries requiring code reuse',
      'rust-error-handling': 'System programming requiring safety',
      'memory-management': 'Performance-critical Rust applications',
      'shell-error-handling': 'Production deployment and automation scripts',
      'shell-modularization': 'Complex shell script maintenance',
      'dependency-validation': 'Cross-platform shell script deployment',
      'configuration-management': 'Applications requiring flexible configuration',
      'logging-pattern': 'Production applications requiring monitoring',
      'mvc-architecture': 'Web applications and enterprise software',
      'microservices-architecture': 'Scalable distributed systems',
      'monorepo-structure': 'Organizations with multiple related projects',
      'code-hotspots': 'Code quality improvement initiatives'
    };
    
    return applicabilityMap[patternType] || 'Similar software development contexts';
  }

  generateObservations(insight) {
    const observations = [];
    
    if (insight.hooks) {
      observations.push(`React hooks used: ${insight.hooks.join(', ')}`);
    }
    
    if (insight.classes) {
      observations.push(`Classes defined: ${insight.classes.join(', ')}`);
    }
    
    if (insight.functions) {
      observations.push(`Functions defined: ${insight.functions.join(', ')}`);
    }
    
    if (insight.hotspots) {
      observations.push(`File hotspots: ${insight.hotspots.map(h => `${h.file} (${h.count} changes)`).join(', ')}`);
    }
    
    return observations;
  }

  saveInsights() {
    const insightsPath = path.join(this.sessionDir, 'insights.json');
    
    // Merge with existing insights
    let existingData = { insights: [], entities: [], relations: [] };
    if (fs.existsSync(insightsPath)) {
      existingData = JSON.parse(fs.readFileSync(insightsPath, 'utf8'));
    }
    
    // Add new insights
    existingData.insights = [...existingData.insights, ...this.insights];
    
    // Write back
    fs.writeFileSync(insightsPath, JSON.stringify(existingData, null, 2));
    
    console.log(`💾 Saved ${this.insights.length} code analysis insights to ${insightsPath}`);
  }
}

// Main execution
if (require.main === module) {
  const sessionDir = process.argv[2];
  
  if (!sessionDir) {
    console.error('Usage: node analyze-code.js <session-directory>');
    process.exit(1);
  }
  
  const analyzer = new CodeAnalyzer(sessionDir);
  analyzer.analyze().catch(err => {
    console.error('Code analysis failed:', err);
    process.exit(1);
  });
}

module.exports = CodeAnalyzer;