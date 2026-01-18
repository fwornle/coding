#!/usr/bin/env node

/**
 * Migration script to convert existing entities to enhanced structure
 * Preserves backward compatibility while adding new structured fields
 */

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_BASE_PATH = process.env.CODING_KNOWLEDGE_BASE ||
  path.join(process.env.HOME, 'Agentic/coding/.data/knowledge-export/coding.json');

function parseObservation(obs, entityType, metadata) {
  const observation = {
    date: metadata.created || new Date().toISOString(),
    metadata: {}
  };

  // Detect observation type based on content patterns
  if (obs.toLowerCase().includes('problem:') || obs.toLowerCase().includes('issue:')) {
    observation.type = 'problem';
    observation.content = obs;
  } else if (obs.toLowerCase().includes('solution:') || obs.toLowerCase().includes('implementation:')) {
    observation.type = 'solution';
    observation.content = obs;
  } else if (obs.toLowerCase().includes('result:') || obs.toLowerCase().includes('improved from') || obs.includes('fps') || obs.includes('ms')) {
    observation.type = 'metric';
    observation.content = obs;
  } else if (obs.toLowerCase().includes('pattern:') || obs.toLowerCase().includes('example:')) {
    observation.type = 'code_example';
    observation.content = obs;
  } else if (obs.toLowerCase().includes('warning:') || obs.toLowerCase().includes('important:') || obs.toLowerCase().includes('never')) {
    observation.type = 'warning';
    observation.content = obs;
  } else if (obs.toLowerCase().includes('applied') || obs.toLowerCase().includes('implemented in')) {
    observation.type = 'application';
    observation.content = obs;
  } else {
    observation.type = 'insight';
    observation.content = obs;
  }

  return observation;
}

function extractProblemSolution(entity) {
  const extracted = {
    problem: null,
    solution: null
  };

  // Extract from direct fields if they exist
  if (entity.problem && entity.solution) {
    extracted.problem = {
      description: entity.problem,
      symptoms: [],
      impact: 'medium'
    };
    extracted.solution = {
      approach: entity.approach || entity.solution,
      implementation: entity.solution,
      code_example: null
    };
  }

  // Extract from observations
  const problemObs = entity.observations?.find(obs => 
    typeof obs === 'string' && obs.toLowerCase().includes('problem:')
  );
  const solutionObs = entity.observations?.find(obs => 
    typeof obs === 'string' && obs.toLowerCase().includes('solution:')
  );

  if (problemObs && !extracted.problem) {
    extracted.problem = {
      description: problemObs.replace(/^problem:\s*/i, ''),
      symptoms: [],
      impact: 'medium'
    };
  }

  if (solutionObs && !extracted.solution) {
    extracted.solution = {
      approach: solutionObs.replace(/^solution:\s*/i, ''),
      implementation: solutionObs.replace(/^solution:\s*/i, ''),
      code_example: null
    };
  }

  return extracted;
}

function migrateEntity(entity) {
  // Skip if already migrated
  if (entity.metadata && entity.observations && 
      entity.observations.length > 0 && 
      typeof entity.observations[0] === 'object') {
    console.log(`✓ ${entity.name} already migrated`);
    return entity;
  }

  console.log(`→ Migrating ${entity.name}...`);

  const migrated = {
    name: entity.name,
    entityType: entity.entityType || entity.type,
    metadata: {
      significance: entity.significance || 5,
      author: entity.author || 'system',
      project: entity.project || null,
      created: entity.created || new Date().toISOString(),
      last_used: null,
      usage_count: 0
    }
  };

  // Extract problem and solution if pattern
  if (entity.entityType === 'TransferablePattern' || entity.entityType === 'WorkflowPattern') {
    const { problem, solution } = extractProblemSolution(entity);
    if (problem) migrated.problem = problem;
    if (solution) migrated.solution = solution;

    // Build context
    migrated.context = {
      applicability: entity.applicability ? 
        (Array.isArray(entity.applicability) ? entity.applicability : [entity.applicability]) : [],
      technologies: entity.technologies || [],
      performance: {}
    };

    // Extract performance metrics from observations
    const perfObs = entity.observations?.find(obs => 
      typeof obs === 'string' && (obs.includes('fps') || obs.includes('ms') || obs.includes('improved from'))
    );
    if (perfObs) {
      const beforeMatch = perfObs.match(/from\s+([^to]+)\s+to/i);
      const afterMatch = perfObs.match(/to\s+([^,\.]+)/i);
      if (beforeMatch) migrated.context.performance.before = beforeMatch[1].trim();
      if (afterMatch) migrated.context.performance.after = afterMatch[1].trim();
    }

    // Build references
    migrated.references = {
      code_files: entity.code_files || [],
      documentation: entity.documentation_link || null,
      external: entity.references || [],
      related_patterns: []
    };
  }

  // Convert observations
  if (entity.observations && Array.isArray(entity.observations)) {
    migrated.observations = entity.observations
      .filter(obs => typeof obs === 'string')
      .map(obs => parseObservation(obs, entity.entityType, migrated.metadata));
    
    // Keep original observations for backward compatibility
    migrated.legacy_observations = entity.observations.filter(obs => typeof obs === 'string');
  } else {
    migrated.observations = [];
    migrated.legacy_observations = [];
  }

  // Preserve any additional fields
  Object.keys(entity).forEach(key => {
    if (!migrated.hasOwnProperty(key) && 
        !['type', 'significance', 'author', 'project', 'created', 
         'problem', 'solution', 'approach', 'applicability', 
         'technologies', 'code_files', 'references', 'documentation_link'].includes(key)) {
      migrated[key] = entity[key];
    }
  });

  return migrated;
}

function migrateKnowledgeBase() {
  console.log('🔄 Starting knowledge base migration...\n');

  // Read current knowledge base
  let kb;
  try {
    const content = fs.readFileSync(KNOWLEDGE_BASE_PATH, 'utf8');
    kb = JSON.parse(content);
  } catch (error) {
    console.error('❌ Error reading knowledge base:', error.message);
    process.exit(1);
  }

  // Skip backup creation - git provides version control
  console.log(`📦 Using git for version control (no backup file created)\n`);

  // Migrate entities
  const migratedEntities = kb.entities.map(migrateEntity);

  // Update knowledge base
  kb.entities = migratedEntities;
  kb.metadata.last_updated = new Date().toISOString();
  kb.metadata.schema_version = '2.0.0';

  // Write updated knowledge base
  fs.writeFileSync(KNOWLEDGE_BASE_PATH, JSON.stringify(kb, null, 2));
  console.log('\n✅ Migration complete!');
  console.log(`📊 Migrated ${migratedEntities.length} entities`);
}

// Run migration
if (require.main === module) {
  migrateKnowledgeBase();
}