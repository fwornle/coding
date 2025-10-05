#!/usr/bin/env node
/**
 * Automated Diagram Generator
 * 
 * Generates PlantUML and Mermaid diagrams from analysis results:
 * - Architecture diagrams from code analysis
 * - Workflow diagrams from session analysis
 * - Pattern diagrams from extracted patterns
 * - Integration diagrams for multi-component systems
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// Configuration
const CODING_ROOT = path.join(__dirname, '..');
const PUML_PATH = path.join(CODING_ROOT, 'knowledge-management', 'insights', 'puml');
const IMAGES_PATH = path.join(CODING_ROOT, 'knowledge-management', 'insights', 'images');

class DiagramGenerator {
  constructor(options = {}) {
    this.config = {
      plantUMLEnabled: true,
      mermaidEnabled: true,
      outputFormats: ['png', 'svg'],
      diagramTypes: ['architecture', 'workflow', 'pattern', 'integration'],
      ...options
    };
    
    this.logger = this.createLogger();
  }
  
  createLogger() {
    return {
      info: (msg) => console.log(`[${new Date().toISOString()}] DIAGRAM INFO: ${msg}`),
      warn: (msg) => console.log(`[${new Date().toISOString()}] DIAGRAM WARN: ${msg}`),
      error: (msg) => console.error(`[${new Date().toISOString()}] DIAGRAM ERROR: ${msg}`),
      debug: (msg) => {
        if (process.env.DEBUG) {
          console.log(`[${new Date().toISOString()}] DIAGRAM DEBUG: ${msg}`);
        }
      }
    };
  }
  
  /**
   * Generate diagrams from insight analysis
   */
  async generateDiagramsFromInsight(insight) {
    this.logger.info(`Generating diagrams for: ${insight.title}`);
    
    const diagrams = [];
    
    try {
      // Ensure output directories exist
      await fs.mkdir(PUML_PATH, { recursive: true });
      await fs.mkdir(IMAGES_PATH, { recursive: true });
      
      // Generate different types of diagrams based on insight content
      if (this.shouldGenerateArchitectureDiagram(insight)) {
        const archDiagram = await this.generateArchitectureDiagram(insight);
        if (archDiagram) diagrams.push(archDiagram);
      }
      
      if (this.shouldGenerateWorkflowDiagram(insight)) {
        const workflowDiagram = await this.generateWorkflowDiagram(insight);
        if (workflowDiagram) diagrams.push(workflowDiagram);
      }
      
      if (this.shouldGeneratePatternDiagram(insight)) {
        const patternDiagram = await this.generatePatternDiagram(insight);
        if (patternDiagram) diagrams.push(patternDiagram);
      }
      
      if (this.shouldGenerateIntegrationDiagram(insight)) {
        const integrationDiagram = await this.generateIntegrationDiagram(insight);
        if (integrationDiagram) diagrams.push(integrationDiagram);
      }
      
      // Render diagrams to images
      for (const diagram of diagrams) {
        await this.renderDiagram(diagram);
      }
      
      this.logger.info(`Generated ${diagrams.length} diagram(s) for ${insight.title}`);
      return diagrams;
      
    } catch (error) {
      this.logger.error(`Failed to generate diagrams: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Check if architecture diagram should be generated
   */
  shouldGenerateArchitectureDiagram(insight) {
    const architectureKeywords = [
      'architecture', 'component', 'service', 'module', 'system',
      'microservices', 'api', 'database', 'server', 'client'
    ];
    
    const content = (insight.solution + ' ' + insight.implementation + ' ' + insight.technologies.join(' ')).toLowerCase();
    return architectureKeywords.some(keyword => content.includes(keyword));
  }
  
  /**
   * Check if workflow diagram should be generated
   */
  shouldGenerateWorkflowDiagram(insight) {
    const workflowKeywords = [
      'workflow', 'process', 'pipeline', 'flow', 'sequence',
      'steps', 'pipeline', 'automation', 'trigger'
    ];
    
    const content = (insight.problem + ' ' + insight.solution).toLowerCase();
    return workflowKeywords.some(keyword => content.includes(keyword));
  }
  
  /**
   * Check if pattern diagram should be generated
   */
  shouldGeneratePatternDiagram(insight) {
    return insight.patterns && insight.patterns.length > 0;
  }
  
  /**
   * Check if integration diagram should be generated
   */
  shouldGenerateIntegrationDiagram(insight) {
    const integrationKeywords = [
      'integration', 'connect', 'interface', 'bridge', 'adapter',
      'mcp', 'api', 'webhook', 'event'
    ];
    
    const content = (insight.solution + ' ' + insight.implementation).toLowerCase();
    return integrationKeywords.some(keyword => content.includes(keyword)) || 
           insight.technologies.length > 2;
  }
  
  /**
   * Generate architecture diagram
   */
  async generateArchitectureDiagram(insight) {
    const filename = this.sanitizeFilename(insight.title) + '-architecture';
    
    const plantUML = this.generateArchitecturePlantUML(insight);
    const mermaid = this.generateArchitectureMermaid(insight);
    
    return {
      type: 'architecture',
      filename,
      title: `${insight.title} - Architecture`,
      plantUML,
      mermaid,
      insight
    };
  }
  
  /**
   * Generate PlantUML for architecture
   */
  generateArchitecturePlantUML(insight) {
    const technologies = insight.technologies || [];
    const files = insight.relatedFiles || [];
    
    return `@startuml ${this.sanitizeFilename(insight.title)}-architecture
!define RECTANGLE class
!include ../../../docs/puml/_standard-style.puml

title ${insight.title} - Architecture Overview

package "System Components" {
${technologies.map(tech => `  [${tech}] as ${tech.replace(/[^a-zA-Z0-9]/g, '')}`).join('\\n')}
}

${files.length > 0 ? `
package "Implementation Files" {
${files.slice(0, 5).map(file => `  [${path.basename(file)}]`).join('\\n')}
}
` : ''}

note top : ${insight.solution || 'Architecture implementation'}

${this.generateArchitectureRelations(technologies, files)}

@enduml`;
  }
  
  /**
   * Generate architecture relations
   */
  generateArchitectureRelations(technologies, files) {
    const relations = [];
    
    // Common technology relationships
    if (technologies.includes('React') && technologies.includes('Redux')) {
      relations.push('React --> Redux : state management');
    }
    if (technologies.includes('Node.js') && technologies.includes('Express')) {
      relations.push('Express --> Nodejs : runtime');
    }
    if (technologies.includes('TypeScript')) {
      relations.push('TypeScript --> JavaScript : compiles to');
    }
    
    return relations.join('\\n');
  }
  
  /**
   * Generate Mermaid for architecture
   */
  generateArchitectureMermaid(insight) {
    const technologies = insight.technologies || [];
    
    return `graph TD
    subgraph "${insight.title} Architecture"
        ${technologies.map((tech, index) => `${tech.replace(/[^a-zA-Z0-9]/g, '')}[${tech}]`).join('\\n        ')}
    end
    
    ${this.generateMermaidArchitectureRelations(technologies)}
`;
  }
  
  /**
   * Generate Mermaid architecture relations
   */
  generateMermaidArchitectureRelations(technologies) {
    const relations = [];
    
    if (technologies.includes('React') && technologies.includes('Redux')) {
      relations.push('React --> Redux');
    }
    if (technologies.includes('Node.js') && technologies.includes('Express')) {
      relations.push('Nodejs --> Express');
    }
    
    return relations.join('\\n    ');
  }
  
  /**
   * Generate workflow diagram
   */
  async generateWorkflowDiagram(insight) {
    const filename = this.sanitizeFilename(insight.title) + '-workflow';
    
    const plantUML = this.generateWorkflowPlantUML(insight);
    const mermaid = this.generateWorkflowMermaid(insight);
    
    return {
      type: 'workflow',
      filename,
      title: `${insight.title} - Workflow`,
      plantUML,
      mermaid,
      insight
    };
  }
  
  /**
   * Generate PlantUML for workflow
   */
  generateWorkflowPlantUML(insight) {
    return `@startuml ${this.sanitizeFilename(insight.title)}-workflow
!include ../../../docs/puml/_standard-style.puml

title ${insight.title} - Workflow

start

:${insight.problem || 'Initial Problem'};

:${insight.solution || 'Apply Solution'};

if (Implementation Successful?) then (yes)
  :${insight.benefits || 'Achieve Benefits'};
else (no)
  :Review and Adjust;
  stop
endif

:${insight.applicability || 'Apply to Similar Cases'};

stop

note right : Technologies: ${insight.technologies.join(', ')}

@enduml`;
  }
  
  /**
   * Generate Mermaid for workflow
   */
  generateWorkflowMermaid(insight) {
    return `flowchart TD
    A[${insight.problem || 'Problem Identified'}] --> B[${insight.solution || 'Solution Applied'}]
    B --> C{Implementation Success?}
    C -->|Yes| D[${insight.benefits || 'Benefits Achieved'}]
    C -->|No| E[Review and Adjust]
    E --> B
    D --> F[${insight.applicability || 'Apply to Similar Cases'}]
    
    style A fill:#ffcccc
    style D fill:#ccffcc
    style F fill:#ccccff
`;
  }
  
  /**
   * Generate pattern diagram
   */
  async generatePatternDiagram(insight) {
    const filename = this.sanitizeFilename(insight.title) + '-pattern';
    
    const plantUML = this.generatePatternPlantUML(insight);
    const mermaid = this.generatePatternMermaid(insight);
    
    return {
      type: 'pattern',
      filename,
      title: `${insight.title} - Pattern`,
      plantUML,
      mermaid,
      insight
    };
  }
  
  /**
   * Generate PlantUML for pattern
   */
  generatePatternPlantUML(insight) {
    const patterns = insight.patterns || [];
    
    return `@startuml ${this.sanitizeFilename(insight.title)}-pattern
!include ../../../docs/puml/_standard-style.puml

title ${insight.title} - Design Patterns

${patterns.map(pattern => `
package "${pattern}" {
  class ${pattern.replace(/[^a-zA-Z0-9]/g, '')} {
    +${this.getPatternMethods(pattern).join('\\n    +')}
  }
}
`).join('')}

note top : ${insight.implementation || 'Pattern implementation details'}

@enduml`;
  }
  
  /**
   * Get typical methods for a pattern
   */
  getPatternMethods(pattern) {
    const patternMethods = {
      'Repository Pattern': ['find()', 'save()', 'delete()', 'findAll()'],
      'Factory Pattern': ['create()', 'createInstance()', 'build()'],
      'Observer Pattern': ['subscribe()', 'unsubscribe()', 'notify()'],
      'Strategy Pattern': ['execute()', 'setStrategy()', 'getStrategy()'],
      'Redux Pattern': ['dispatch()', 'getState()', 'subscribe()']
    };
    
    return patternMethods[pattern] || ['implement()', 'execute()', 'configure()'];
  }
  
  /**
   * Generate Mermaid for pattern
   */
  generatePatternMermaid(insight) {
    const patterns = insight.patterns || [];
    
    return `classDiagram
    class ${insight.title.replace(/[^a-zA-Z0-9]/g, '')} {
        ${this.getMermaidPatternMethods(patterns).join('\\n        ')}
    }
    
    ${patterns.map(pattern => `
    class ${pattern.replace(/[^a-zA-Z0-9]/g, '')} {
        ${this.getPatternMethods(pattern).join('\\n        ')}
    }
    `).join('')}
`;
  }
  
  /**
   * Get Mermaid pattern methods
   */
  getMermaidPatternMethods(patterns) {
    return patterns.flatMap(pattern => this.getPatternMethods(pattern)).slice(0, 4);
  }
  
  /**
   * Generate integration diagram
   */
  async generateIntegrationDiagram(insight) {
    const filename = this.sanitizeFilename(insight.title) + '-integration';
    
    const plantUML = this.generateIntegrationPlantUML(insight);
    const mermaid = this.generateIntegrationMermaid(insight);
    
    return {
      type: 'integration',
      filename,
      title: `${insight.title} - Integration`,
      plantUML,
      mermaid,
      insight
    };
  }
  
  /**
   * Generate PlantUML for integration
   */
  generateIntegrationPlantUML(insight) {
    const technologies = insight.technologies || [];
    
    return `@startuml ${this.sanitizeFilename(insight.title)}-integration
!include ../../../docs/puml/_standard-style.puml

title ${insight.title} - Technology Integration

${technologies.map(tech => `component "${tech}" as ${tech.replace(/[^a-zA-Z0-9]/g, '')}`).join('\\n')}

${this.generateIntegrationConnections(technologies)}

note top : ${insight.implementation || 'Integration implementation'}

@enduml`;
  }
  
  /**
   * Generate integration connections
   */
  generateIntegrationConnections(technologies) {
    const connections = [];
    
    // Common integration patterns
    for (let i = 0; i < technologies.length - 1; i++) {
      const from = technologies[i].replace(/[^a-zA-Z0-9]/g, '');
      const to = technologies[i + 1].replace(/[^a-zA-Z0-9]/g, '');
      connections.push(`${from} --> ${to} : integrates`);
    }
    
    return connections.join('\\n');
  }
  
  /**
   * Generate Mermaid for integration
   */
  generateIntegrationMermaid(insight) {
    const technologies = insight.technologies || [];
    
    return `graph LR
    ${technologies.map((tech, index) => `${tech.replace(/[^a-zA-Z0-9]/g, '')}[${tech}]`).join('\\n    ')}
    
    ${this.generateMermaidIntegrationConnections(technologies)}
`;
  }
  
  /**
   * Generate Mermaid integration connections
   */
  generateMermaidIntegrationConnections(technologies) {
    const connections = [];
    
    for (let i = 0; i < technologies.length - 1; i++) {
      const from = technologies[i].replace(/[^a-zA-Z0-9]/g, '');
      const to = technologies[i + 1].replace(/[^a-zA-Z0-9]/g, '');
      connections.push(`${from} --> ${to}`);
    }
    
    return connections.join('\\n    ');
  }
  
  /**
   * Render diagram to image format
   */
  async renderDiagram(diagram) {
    try {
      // Save PlantUML source
      if (diagram.plantUML) {
        const pumlFile = path.join(PUML_PATH, `${diagram.filename}.puml`);
        await fs.writeFile(pumlFile, diagram.plantUML);
        
        // Try to render with PlantUML if available
        if (this.config.plantUMLEnabled) {
          await this.renderPlantUML(pumlFile, diagram.filename);
        }
      }
      
      // Save Mermaid source
      if (diagram.mermaid) {
        const mermaidFile = path.join(PUML_PATH, `${diagram.filename}.mmd`);
        await fs.writeFile(mermaidFile, diagram.mermaid);
        
        // Try to render with Mermaid CLI if available
        if (this.config.mermaidEnabled) {
          await this.renderMermaid(mermaidFile, diagram.filename);
        }
      }
      
      this.logger.debug(`Rendered diagram: ${diagram.filename}`);
      
    } catch (error) {
      this.logger.warn(`Failed to render diagram ${diagram.filename}: ${error.message}`);
    }
  }
  
  /**
   * Render PlantUML to PNG
   */
  async renderPlantUML(pumlFile, filename) {
    try {
      // Try plantuml command
      const outputFile = path.join(IMAGES_PATH, `${filename}.png`);
      await execAsync(`plantuml -tpng -o "${IMAGES_PATH}" "${pumlFile}"`);
      this.logger.debug(`PlantUML rendered: ${filename}.png`);
    } catch (error) {
      this.logger.debug(`PlantUML rendering failed: ${error.message}`);
      // Could try online PlantUML service or other alternatives
    }
  }
  
  /**
   * Render Mermaid to PNG
   */
  async renderMermaid(mermaidFile, filename) {
    try {
      // Try mermaid CLI
      const outputFile = path.join(IMAGES_PATH, `${filename}-mermaid.png`);
      await execAsync(`mmdc -i "${mermaidFile}" -o "${outputFile}"`);
      this.logger.debug(`Mermaid rendered: ${filename}-mermaid.png`);
    } catch (error) {
      this.logger.debug(`Mermaid rendering failed: ${error.message}`);
      // Could try mermaid online service or other alternatives
    }
  }
  
  /**
   * Sanitize filename for filesystem
   */
  sanitizeFilename(title) {
    return title
      .replace(/[^a-zA-Z0-9\\s-]/g, '')
      .replace(/\\s+/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase()
      .substring(0, 50);
  }
  
  /**
   * Get diagram references for markdown inclusion
   */
  getDiagramReferences(diagrams) {
    const references = [];
    
    diagrams.forEach(diagram => {
      const pngPath = `./images/${diagram.filename}.png`;
      const mermaidPngPath = `./images/${diagram.filename}-mermaid.png`;
      
      references.push(`## ${diagram.title}`);
      references.push('');
      
      if (diagram.plantUML) {
        references.push(`![${diagram.title}](${pngPath})`);
        references.push('');
        references.push('<details>');
        references.push('<summary>PlantUML Source</summary>');
        references.push('');
        references.push('```plantuml');
        references.push(diagram.plantUML);
        references.push('```');
        references.push('</details>');
        references.push('');
      }
      
      if (diagram.mermaid) {
        references.push(`![${diagram.title} (Mermaid)](${mermaidPngPath})`);
        references.push('');
        references.push('<details>');
        references.push('<summary>Mermaid Source</summary>');
        references.push('');
        references.push('```mermaid');
        references.push(diagram.mermaid);
        references.push('```');
        references.push('</details>');
        references.push('');
      }
    });
    
    return references.join('\\n');
  }
}

// Export for use in other modules
export { DiagramGenerator };

// CLI interface for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new DiagramGenerator();
  
  const testInsight = {
    title: 'React Redux Integration Pattern',
    problem: 'Complex state management across components',
    solution: 'Implement Redux with typed hooks',
    implementation: 'Created slices and custom hooks for type safety',
    benefits: 'Predictable state updates, better debugging',
    technologies: ['React', 'Redux', 'TypeScript'],
    patterns: ['Redux Pattern', 'Hook Pattern'],
    applicability: 'Large React applications',
    relatedFiles: ['src/store/index.ts', 'src/hooks/redux.ts']
  };
  
  generator.generateDiagramsFromInsight(testInsight).then(diagrams => {
    console.log('Generated diagrams:', diagrams.map(d => d.filename));
    console.log('\\nMarkdown references:');
    console.log(generator.getDiagramReferences(diagrams));
  }).catch(error => {
    console.error('Test failed:', error);
  });
}