#!/usr/bin/env node

/**
 * Reference Enrichment for UKB
 * 
 * This script is designed to be called from within coding agents to
 * enrich pattern insights with authoritative reference URLs and documentation.
 * 
 * Since we're running within a coding agent, we can leverage the agent's
 * web research capabilities.
 */

const fs = require('fs');
const path = require('path');

class ReferenceEnricher {
  constructor() {
    this.techReferences = {
      // Core technologies with documentation
      'React': [
        'https://react.dev/',
        'https://react.dev/learn',
        'https://react.dev/reference/react'
      ],
      'TypeScript': [
        'https://www.typescriptlang.org/docs/',
        'https://www.typescriptlang.org/docs/handbook/intro.html'
      ],
      'Redux': [
        'https://redux.js.org/',
        'https://redux-toolkit.js.org/'
      ],
      'Three.js': [
        'https://threejs.org/docs/',
        'https://threejs.org/manual/',
        'https://threejs.org/examples/'
      ],
      'Node.js': [
        'https://nodejs.org/docs/latest/api/',
        'https://nodejs.dev/learn'
      ],
      'Git': [
        'https://git-scm.com/doc',
        'https://www.atlassian.com/git/tutorials'
      ],
      'Docker': [
        'https://docs.docker.com/',
        'https://docs.docker.com/get-started/'
      ],
      'JavaScript': [
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
        'https://javascript.info/'
      ],
      'Python': [
        'https://docs.python.org/3/',
        'https://realpython.com/'
      ],
      'Rust': [
        'https://doc.rust-lang.org/book/',
        'https://doc.rust-lang.org/rust-by-example/'
      ],
      'WebGL': [
        'https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API',
        'https://webglfundamentals.org/'
      ]
    };

    // Pattern-specific references
    this.patternReferences = {
      'performance': [
        'https://web.dev/performance/',
        'https://developer.chrome.com/docs/devtools/performance/'
      ],
      'architecture': [
        'https://martinfowler.com/architecture/',
        'https://www.patterns.dev/'
      ],
      'state-management': [
        'https://redux.js.org/style-guide/',
        'https://react.dev/learn/managing-state'
      ],
      'debugging': [
        'https://developer.chrome.com/docs/devtools/',
        'https://code.visualstudio.com/docs/editor/debugging'
      ],
      'testing': [
        'https://jestjs.io/docs/getting-started',
        'https://testing-library.com/docs/'
      ],
      'error-handling': [
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Control_flow_and_error_handling',
        'https://nodejs.org/api/errors.html'
      ]
    };
  }

  enrichInsights(insightsPath) {
    console.log('📚 Enriching insights with reference documentation...');
    
    // Load insights
    const data = JSON.parse(fs.readFileSync(insightsPath, 'utf8'));
    
    // Enrich each insight
    for (const insight of data.insights || []) {
      this.enrichInsight(insight);
    }
    
    // Save enriched data
    fs.writeFileSync(insightsPath, JSON.stringify(data, null, 2));
    
    console.log(`✅ Enriched ${data.insights?.length || 0} insights with references`);
  }

  enrichInsight(insight) {
    const references = new Set(insight.references || []);
    
    // Add technology-specific references
    if (insight.technologies) {
      for (const tech of insight.technologies) {
        const techRefs = this.findTechnologyReferences(tech);
        techRefs.forEach(ref => references.add(ref));
      }
    }
    
    // Add pattern-specific references
    if (insight.metadata?.pattern_type) {
      const patternRefs = this.patternReferences[insight.metadata.pattern_type] || [];
      patternRefs.forEach(ref => references.add(ref));
    }
    
    // Add problem-specific references
    const problemRefs = this.findProblemReferences(insight.problem);
    problemRefs.forEach(ref => references.add(ref));
    
    // Update insight
    insight.references = Array.from(references);
    
    // Add enrichment note to observations
    if (!insight.observations.some(obs => obs.includes('References enriched'))) {
      insight.observations.push(`References enriched: ${insight.references.length} documentation links added`);
    }
  }

  findTechnologyReferences(technology) {
    const refs = [];
    
    // Direct match
    if (this.techReferences[technology]) {
      refs.push(...this.techReferences[technology]);
    }
    
    // Case-insensitive match
    const techLower = technology.toLowerCase();
    for (const [key, values] of Object.entries(this.techReferences)) {
      if (key.toLowerCase() === techLower) {
        refs.push(...values);
      }
    }
    
    // Partial match
    for (const [key, values] of Object.entries(this.techReferences)) {
      if (techLower.includes(key.toLowerCase()) || key.toLowerCase().includes(techLower)) {
        refs.push(...values.slice(0, 1)); // Just first reference for partial matches
      }
    }
    
    return [...new Set(refs)]; // Remove duplicates
  }

  findProblemReferences(problem) {
    if (!problem) return [];
    
    const refs = [];
    const problemLower = problem.toLowerCase();
    
    // Keywords to reference mapping
    const keywordMap = {
      'memory leak': [
        'https://developer.chrome.com/docs/devtools/memory-problems/',
        'https://nodejs.org/en/docs/guides/simple-profiling/'
      ],
      'performance': [
        'https://web.dev/performance/',
        'https://developer.chrome.com/docs/lighthouse/performance/'
      ],
      'cors': [
        'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
        'https://web.dev/cross-origin-resource-sharing/'
      ],
      'authentication': [
        'https://auth0.com/docs/get-started',
        'https://jwt.io/introduction'
      ],
      'database': [
        'https://www.postgresql.org/docs/',
        'https://docs.mongodb.com/'
      ],
      'api': [
        'https://restfulapi.net/',
        'https://graphql.org/learn/'
      ],
      'deployment': [
        'https://vercel.com/docs',
        'https://docs.netlify.com/'
      ],
      'bundling': [
        'https://webpack.js.org/concepts/',
        'https://vitejs.dev/guide/'
      ],
      'styling': [
        'https://tailwindcss.com/docs',
        'https://styled-components.com/docs'
      ],
      'routing': [
        'https://reactrouter.com/en/main',
        'https://nextjs.org/docs/app/building-your-application/routing'
      ]
    };
    
    // Check for keyword matches
    for (const [keyword, references] of Object.entries(keywordMap)) {
      if (problemLower.includes(keyword)) {
        refs.push(...references);
      }
    }
    
    return [...new Set(refs)];
  }

  // Method to generate research queries for agent
  generateResearchQueries(insight) {
    const queries = [];
    
    // Technology-specific queries
    if (insight.technologies?.length > 0) {
      queries.push(`${insight.technologies[0]} ${insight.metadata?.pattern_type || 'pattern'} best practices`);
      queries.push(`${insight.technologies[0]} documentation ${insight.problem?.split(' ').slice(0, 3).join(' ')}`);
    }
    
    // Problem-specific queries
    if (insight.problem) {
      const keywords = insight.problem.split(' ')
        .filter(word => word.length > 4)
        .slice(0, 3)
        .join(' ');
      queries.push(`${keywords} solution programming`);
    }
    
    // Pattern-specific queries
    if (insight.entityType) {
      queries.push(`${insight.entityType.replace('Pattern', '')} pattern software development`);
    }
    
    return queries;
  }
}

// Create instructions for agent-based web research
function createAgentInstructions(insightsPath) {
  const enricher = new ReferenceEnricher();
  const data = JSON.parse(fs.readFileSync(insightsPath, 'utf8'));
  const instructions = [];
  
  instructions.push('# Web Research Instructions for Reference Enrichment\n');
  instructions.push('Please research and add authoritative references for the following insights:\n');
  
  for (const insight of data.insights || []) {
    const queries = enricher.generateResearchQueries(insight);
    
    instructions.push(`\n## ${insight.name}`);
    instructions.push(`**Technologies:** ${insight.technologies?.join(', ') || 'General'}`);
    instructions.push(`**Problem:** ${insight.problem || 'N/A'}`);
    instructions.push('\n**Suggested searches:**');
    
    for (const query of queries) {
      instructions.push(`- "${query}"`);
    }
    
    instructions.push('\n**Look for:**');
    instructions.push('- Official documentation');
    instructions.push('- Best practice guides');
    instructions.push('- Tutorial resources');
    instructions.push('- Community standards\n');
  }
  
  const instructionsPath = path.join(path.dirname(insightsPath), 'research_instructions.md');
  fs.writeFileSync(instructionsPath, instructions.join('\n'));
  
  console.log(`📋 Research instructions saved to: ${instructionsPath}`);
  console.log('The coding agent should use web search to find relevant references.');
}

// Main execution
if (require.main === module) {
  const command = process.argv[2];
  const insightsPath = process.argv[3];
  
  if (!command || !insightsPath) {
    console.log('Usage:');
    console.log('  enrich-references.js enrich <insights.json>   # Add known references');
    console.log('  enrich-references.js research <insights.json> # Generate research instructions');
    process.exit(1);
  }
  
  const enricher = new ReferenceEnricher();
  
  if (command === 'enrich') {
    enricher.enrichInsights(insightsPath);
  } else if (command === 'research') {
    createAgentInstructions(insightsPath);
  } else {
    console.error('Unknown command:', command);
    process.exit(1);
  }
}

module.exports = ReferenceEnricher;