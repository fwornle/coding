import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logging.js';
import { SemanticAnalyzer } from './semantic-analyzer.js';

export interface RepositoryAnalysisOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
  maxFileSize?: number;
}

export interface RepositoryAnalysisResult {
  structure: string;
  patterns: string[];
  insights: string;
  filesSummary: FileSummary[];
  metrics: RepositoryMetrics;
}

export interface FileSummary {
  path: string;
  language: string;
  size: number;
  patterns: string[];
}

export interface RepositoryMetrics {
  totalFiles: number;
  totalSize: number;
  languageDistribution: Record<string, number>;
  complexityScore: number;
}

export class RepositoryAnalyzer {
  private semanticAnalyzer: SemanticAnalyzer;
  
  constructor() {
    this.semanticAnalyzer = new SemanticAnalyzer();
  }

  async analyzeRepository(repositoryPath: string, options: RepositoryAnalysisOptions = {}): Promise<RepositoryAnalysisResult> {
    const {
      includePatterns = ['**/*'],
      excludePatterns = ['node_modules/**', '.git/**', 'dist/**', 'build/**', '**/*.log'],
      maxFiles = 100,
      maxFileSize = 1024 * 1024, // 1MB
    } = options;

    log(`Analyzing repository: ${repositoryPath}`, "info", {
      includePatterns,
      excludePatterns,
      maxFiles,
      maxFileSize,
    });

    // Validate repository path
    if (!fs.existsSync(repositoryPath)) {
      throw new Error(`Repository path does not exist: ${repositoryPath}`);
    }

    const stats = fs.statSync(repositoryPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${repositoryPath}`);
    }

    // Discover files
    const files = await this.discoverFiles(repositoryPath, includePatterns, excludePatterns, maxFiles, maxFileSize);
    log(`Discovered ${files.length} files for analysis`, "info");

    // Analyze structure
    const structure = this.analyzeStructure(repositoryPath, files);
    
    // Calculate metrics
    const metrics = this.calculateMetrics(files);
    
    // Analyze file contents for patterns
    const filesSummary = await this.analyzeFiles(files);
    
    // Extract overall patterns
    const patterns = this.extractOverallPatterns(filesSummary);
    
    // Generate insights
    const insights = await this.generateInsights(structure, metrics, patterns, filesSummary);

    return {
      structure,
      patterns,
      insights,
      filesSummary,
      metrics,
    };
  }

  private async discoverFiles(
    rootPath: string,
    includePatterns: string[],
    excludePatterns: string[],
    maxFiles: number,
    maxFileSize: number
  ): Promise<string[]> {
    const files: string[] = [];
    
    const walkDirectory = (dirPath: string) => {
      if (files.length >= maxFiles) return;
      
      try {
        const entries = fs.readdirSync(dirPath);
        
        for (const entry of entries) {
          if (files.length >= maxFiles) break;
          
          const fullPath = path.join(dirPath, entry);
          const relativePath = path.relative(rootPath, fullPath);
          
          // Check exclude patterns
          if (this.matchesPatterns(relativePath, excludePatterns)) {
            continue;
          }
          
          const stats = fs.statSync(fullPath);
          
          if (stats.isDirectory()) {
            walkDirectory(fullPath);
          } else if (stats.isFile()) {
            // Check file size
            if (stats.size > maxFileSize) {
              log(`Skipping large file: ${relativePath} (${stats.size} bytes)`, "warning");
              continue;
            }
            
            // Check include patterns
            if (this.matchesPatterns(relativePath, includePatterns)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        log(`Error reading directory ${dirPath}:`, "warning", error);
      }
    };

    walkDirectory(rootPath);
    return files;
  }

  private matchesPatterns(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Simple glob pattern matching
      const regex = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
      
      return new RegExp(`^${regex}$`).test(filePath.replace(/\\/g, '/'));
    });
  }

  private analyzeStructure(rootPath: string, files: string[]): string {
    const structure: Record<string, any> = {};
    
    for (const filePath of files) {
      const relativePath = path.relative(rootPath, filePath);
      const parts = relativePath.split(path.sep);
      
      let current = structure;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      
      const fileName = parts[parts.length - 1];
      current[fileName] = path.extname(fileName);
    }
    
    return this.structureToString(structure);
  }

  private structureToString(structure: Record<string, any>, indent: string = ''): string {
    let result = '';
    
    for (const [name, value] of Object.entries(structure)) {
      if (typeof value === 'object') {
        result += `${indent}📁 ${name}/\n`;
        result += this.structureToString(value, indent + '  ');
      } else {
        const icon = this.getFileIcon(value);
        result += `${indent}${icon} ${name}\n`;
      }
    }
    
    return result;
  }

  private getFileIcon(extension: string): string {
    const iconMap: Record<string, string> = {
      '.js': '📄',
      '.ts': '📘',
      '.jsx': '⚛️',
      '.tsx': '⚛️',
      '.py': '🐍',
      '.java': '☕',
      '.cpp': '⚙️',
      '.c': '⚙️',
      '.cs': '💎',
      '.go': '🐹',
      '.rs': '🦀',
      '.php': '🐘',
      '.rb': '💎',
      '.swift': '🐦',
      '.kt': '🎯',
      '.json': '📋',
      '.yml': '📝',
      '.yaml': '📝',
      '.md': '📖',
      '.txt': '📄',
      '.css': '🎨',
      '.scss': '🎨',
      '.html': '🌐',
      '.xml': '📰',
    };
    
    return iconMap[extension] || '📄';
  }

  private calculateMetrics(files: string[]): RepositoryMetrics {
    const languageDistribution: Record<string, number> = {};
    let totalSize = 0;
    
    for (const filePath of files) {
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
      
      const ext = path.extname(filePath);
      const language = this.getLanguageFromExtension(ext);
      languageDistribution[language] = (languageDistribution[language] || 0) + 1;
    }
    
    // Simple complexity score based on number of different languages and file count
    const languageCount = Object.keys(languageDistribution).length;
    const complexityScore = Math.min(10, Math.round((files.length / 10) + (languageCount * 1.5)));
    
    return {
      totalFiles: files.length,
      totalSize,
      languageDistribution,
      complexityScore,
    };
  }

  private getLanguageFromExtension(ext: string): string {
    const languageMap: Record<string, string> = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.jsx': 'React/JSX',
      '.tsx': 'React/TSX',
      '.py': 'Python',
      '.java': 'Java',
      '.cpp': 'C++',
      '.c': 'C',
      '.cs': 'C#',
      '.go': 'Go',
      '.rs': 'Rust',
      '.php': 'PHP',
      '.rb': 'Ruby',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.json': 'JSON',
      '.yml': 'YAML',
      '.yaml': 'YAML',
      '.md': 'Markdown',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.html': 'HTML',
      '.xml': 'XML',
    };
    
    return languageMap[ext] || 'Other';
  }

  private async analyzeFiles(files: string[]): Promise<FileSummary[]> {
    const summaries: FileSummary[] = [];
    
    // Analyze a subset of key files
    const keyFiles = this.selectKeyFiles(files);
    
    for (const filePath of keyFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath);
        const language = this.getLanguageFromExtension(ext);
        
        // Extract basic patterns from file content
        const patterns = this.extractFilePatterns(content, language);
        
        summaries.push({
          path: filePath,
          language,
          size: stats.size,
          patterns,
        });
        
      } catch (error) {
        log(`Error analyzing file ${filePath}:`, "warning", error);
      }
    }
    
    return summaries;
  }

  private selectKeyFiles(files: string[]): string[] {
    // Select important files for detailed analysis
    const keyFiles: string[] = [];
    const priorities = [
      'package.json',
      'tsconfig.json',
      'readme.md',
      'index.js',
      'index.ts',
      'main.js',
      'main.ts',
      'app.js',
      'app.ts',
      'server.js',
      'server.ts',
    ];
    
    // Add priority files
    for (const file of files) {
      const fileName = path.basename(file).toLowerCase();
      if (priorities.includes(fileName)) {
        keyFiles.push(file);
      }
    }
    
    // Add other significant files (up to 20 total)
    for (const file of files) {
      if (keyFiles.length >= 20) break;
      if (!keyFiles.includes(file)) {
        const ext = path.extname(file);
        if (['.js', '.ts', '.jsx', '.tsx', '.py', '.java'].includes(ext)) {
          keyFiles.push(file);
        }
      }
    }
    
    return keyFiles;
  }

  private extractFilePatterns(content: string, language: string): string[] {
    const patterns: string[] = [];
    
    // Basic pattern detection based on language
    switch (language) {
      case 'JavaScript':
      case 'TypeScript':
        if (content.includes('export')) patterns.push('ES6 Modules');
        if (content.includes('require(')) patterns.push('CommonJS');
        if (content.includes('async') && content.includes('await')) patterns.push('Async/Await');
        if (content.includes('Promise')) patterns.push('Promises');
        if (content.includes('class ')) patterns.push('Classes');
        if (content.includes('function*')) patterns.push('Generators');
        if (content.includes('React')) patterns.push('React');
        if (content.includes('express')) patterns.push('Express.js');
        break;
        
      case 'Python':
        if (content.includes('def ')) patterns.push('Functions');
        if (content.includes('class ')) patterns.push('Classes');
        if (content.includes('async def')) patterns.push('Async/Await');
        if (content.includes('import ')) patterns.push('Modules');
        if (content.includes('@')) patterns.push('Decorators');
        break;
    }
    
    // Generic patterns
    if (content.includes('TODO') || content.includes('FIXME')) patterns.push('TODO Comments');
    if (content.match(/\/\*[\s\S]*?\*\//g)) patterns.push('Block Comments');
    if (content.includes('test(') || content.includes('describe(')) patterns.push('Tests');
    if (content.includes('console.log')) patterns.push('Debug Logging');
    
    return patterns;
  }

  private extractOverallPatterns(filesSummary: FileSummary[]): string[] {
    const patternCounts: Record<string, number> = {};
    
    for (const file of filesSummary) {
      for (const pattern of file.patterns) {
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      }
    }
    
    // Return patterns that appear in multiple files
    return Object.entries(patternCounts)
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([pattern]) => pattern);
  }

  private async generateInsights(
    structure: string,
    metrics: RepositoryMetrics,
    patterns: string[],
    filesSummary: FileSummary[]
  ): Promise<string> {
    const analysisContent = `
Repository Analysis Summary:

## Structure
${structure}

## Metrics
- Total Files: ${metrics.totalFiles}
- Total Size: ${(metrics.totalSize / 1024).toFixed(1)} KB
- Languages: ${Object.keys(metrics.languageDistribution).join(', ')}
- Complexity Score: ${metrics.complexityScore}/10

## Common Patterns
${patterns.map(p => `- ${p}`).join('\n')}

## Key Files Analyzed
${filesSummary.slice(0, 10).map(f => `- ${path.basename(f.path)} (${f.language})`).join('\n')}
`;

    try {
      const result = await this.semanticAnalyzer.analyzeContent(analysisContent, {
        context: "Repository structure and code analysis",
        analysisType: "architecture",
      });
      
      return result.insights;
    } catch (error) {
      log("Failed to generate LLM insights, using basic analysis", "warning", error);
      return `Repository contains ${metrics.totalFiles} files across ${Object.keys(metrics.languageDistribution).length} languages. Primary patterns: ${patterns.slice(0, 5).join(', ')}.`;
    }
  }
}