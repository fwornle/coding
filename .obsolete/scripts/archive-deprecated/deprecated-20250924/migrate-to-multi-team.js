#!/usr/bin/env node
/**
 * Migration script to split existing shared-memory.json into team-specific files
 * 
 * This script analyzes the existing shared-memory.json and categorizes entities
 * based on their technology patterns and creates team-specific files.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Team categorization rules based on technologies and patterns
const TEAM_PATTERNS = {
  ui: {
    name: 'UI/Frontend',
    keywords: ['react', 'vue', 'angular', 'javascript', 'typescript', 'css', 'html', 'web', 'frontend', 'ui', 'ux', 'component', 'hook', 'redux', 'state', 'browser'],
    technologies: ['React', 'Vue', 'Angular', 'JavaScript', 'TypeScript', 'CSS', 'HTML', 'Redux', 'Three.js'],
    entityTypes: ['ReactPattern', 'ComponentPattern', 'WebPattern', 'UIPattern']
  },
  resi: {
    name: 'Resilience (ReSi)',
    keywords: ['c++', 'cpp', 'memory', 'performance', 'optimization', 'algorithm', 'system', 'native', 'embedded', 'real-time', 'low-level'],
    technologies: ['C++', 'C', 'Assembly', 'CUDA', 'OpenMP'],
    entityTypes: ['SystemPattern', 'PerformancePattern', 'AlgorithmPattern', 'MemoryPattern']
  },
  raas: {
    name: 'Robotics as a Service (RaaS)',
    keywords: ['java', 'spring', 'devops', 'docker', 'kubernetes', 'jenkins', 'maven', 'gradle', 'microservice', 'api', 'rest', 'cloud', 'aws', 'deployment'],
    technologies: ['Java', 'Spring', 'Docker', 'Kubernetes', 'Jenkins', 'Maven', 'Gradle', 'AWS', 'GCP'],
    entityTypes: ['DevOpsPattern', 'ServicePattern', 'DeploymentPattern', 'InfrastructurePattern']
  }
};

// Patterns that should go to coding knowledge base (cross-team)
const CODING_PATTERNS = [
  'ConditionalLoggingPattern',
  'KnowledgePersistencePattern', 
  'NetworkAwareInstallationPattern',
  'CodingWorkflow',
  'MCPMemoryLoggingIntegrationPattern',
  'VSCodeExtensionBridgePattern',
  'UkbCli',
  'VkbCli'
];

async function main() {
  const projectRoot = path.join(__dirname, '..');
  const sharedMemoryPath = path.join(projectRoot, 'shared-memory.json');
  
  console.log('🚀 Multi-team knowledge base migration');
  console.log('=' .repeat(50));
  
  // Check if shared-memory.json exists
  if (!await fileExists(sharedMemoryPath)) {
    console.log('❌ shared-memory.json not found');
    process.exit(1);
  }
  
  // Load existing data
  console.log('📖 Loading existing shared-memory.json...');
  const data = JSON.parse(await fs.readFile(sharedMemoryPath, 'utf8'));
  
  console.log(`Found ${data.entities?.length || 0} entities and ${data.relations?.length || 0} relations`);
  
  // Categorize entities
  const categorizedEntities = categorizeEntities(data.entities || []);
  
  // Display categorization results
  console.log('\n📊 Categorization Results:');
  for (const [team, entities] of Object.entries(categorizedEntities)) {
    console.log(`  ${team}: ${entities.length} entities`);
  }
  
  // Categorize relations based on their entities
  const categorizedRelations = categorizeRelations(data.relations || [], categorizedEntities);
  
  // Create team-specific files
  await createTeamFiles(projectRoot, categorizedEntities, categorizedRelations, data.metadata);
  
  // Create backup of original file
  const backupPath = sharedMemoryPath.replace('.json', `-backup-${new Date().toISOString().split('T')[0]}.json`);
  await fs.copyFile(sharedMemoryPath, backupPath);
  console.log(`\n💾 Created backup: ${path.basename(backupPath)}`);
  
  console.log('\n✅ Migration completed successfully!');
  console.log('\nNext steps:');
  console.log('1. Test the new team-specific files');
  console.log('2. Set CODING_TEAM environment variable');
  console.log('3. Run: ukb status --team <team> to verify');
}

function categorizeEntities(entities) {
  const categorized = {
    coding: [],
    ui: [],
    resi: [],
    raas: [],
    uncategorized: []
  };
  
  for (const entity of entities) {
    let assigned = false;
    
    // Check if it's a coding pattern (cross-team)
    if (CODING_PATTERNS.includes(entity.name) || entity.name === 'Coding' || entity.name === 'CodingKnowledge') {
      categorized.coding.push(entity);
      assigned = true;
      continue;
    }
    
    // Try to categorize by team patterns
    for (const [teamKey, teamConfig] of Object.entries(TEAM_PATTERNS)) {
      if (assigned) break;
      
      // Check entity type
      if (teamConfig.entityTypes.some(type => entity.entityType === type)) {
        categorized[teamKey].push(entity);
        assigned = true;
        continue;
      }
      
      // Check keywords in name and observations
      const textToSearch = [
        entity.name,
        ...(entity.observations || []).map(obs => 
          typeof obs === 'string' ? obs : obs.content || ''
        )
      ].join(' ').toLowerCase();
      
      if (teamConfig.keywords.some(keyword => textToSearch.includes(keyword))) {
        categorized[teamKey].push(entity);
        assigned = true;
        continue;
      }
      
      // Check technologies mentioned
      if (teamConfig.technologies.some(tech => 
        textToSearch.includes(tech.toLowerCase())
      )) {
        categorized[teamKey].push(entity);
        assigned = true;
        continue;
      }
    }
    
    // Check for project entities that should be general
    if (!assigned) {
      if (entity.entityType === 'Project' || entity.name.includes('Project')) {
        categorized.coding.push(entity);
        assigned = true;
      }
    }
    
    // If still not assigned, mark as uncategorized
    if (!assigned) {
      categorized.uncategorized.push(entity);
    }
  }
  
  return categorized;
}

function categorizeRelations(relations, categorizedEntities) {
  const categorized = {
    coding: [],
    ui: [],
    resi: [],
    raas: [],
    uncategorized: []
  };
  
  // Create entity-to-team mapping
  const entityTeamMap = new Map();
  for (const [team, entities] of Object.entries(categorizedEntities)) {
    for (const entity of entities) {
      entityTeamMap.set(entity.name, team);
    }
  }
  
  for (const relation of relations) {
    const fromTeam = entityTeamMap.get(relation.from);
    const toTeam = entityTeamMap.get(relation.to);
    
    // If both entities are in the same team, put relation there
    if (fromTeam && fromTeam === toTeam) {
      categorized[fromTeam].push(relation);
    }
    // If one entity is in coding, put relation in coding
    else if (fromTeam === 'coding' || toTeam === 'coding') {
      categorized.coding.push(relation);
    }
    // If entities are in different teams, put in coding (cross-team)
    else if (fromTeam && toTeam && fromTeam !== toTeam) {
      categorized.coding.push(relation);
    }
    // If we can't determine, put in uncategorized
    else {
      categorized.uncategorized.push(relation);
    }
  }
  
  return categorized;
}

async function createTeamFiles(projectRoot, categorizedEntities, categorizedRelations, originalMetadata) {
  const files = [
    { 
      team: 'coding', 
      filename: 'shared-memory-coding.json',
      description: 'Cross-team coding knowledge'
    },
    { 
      team: 'ui', 
      filename: 'shared-memory-ui.json',
      description: 'UI/Frontend team knowledge'
    },
    { 
      team: 'resi', 
      filename: 'shared-memory-resi.json',
      description: 'Resilience team knowledge'
    },
    { 
      team: 'raas', 
      filename: 'shared-memory-raas.json',
      description: 'RaaS team knowledge'
    }
  ];
  
  for (const fileInfo of files) {
    const entities = categorizedEntities[fileInfo.team] || [];
    const relations = categorizedRelations[fileInfo.team] || [];
    
    if (entities.length === 0 && relations.length === 0) {
      console.log(`⏭️  Skipping ${fileInfo.filename} (no entities or relations)`);
      continue;
    }
    
    const data = {
      entities,
      relations,
      metadata: {
        ...originalMetadata,
        team: fileInfo.team,
        description: fileInfo.description,
        created_from_migration: new Date().toISOString(),
        total_entities: entities.length,
        total_relations: relations.length
      }
    };
    
    const filePath = path.join(projectRoot, fileInfo.filename);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    
    console.log(`✅ Created ${fileInfo.filename}: ${entities.length} entities, ${relations.length} relations`);
  }
  
  // Handle uncategorized entities if any
  const uncategorizedEntities = categorizedEntities.uncategorized || [];
  const uncategorizedRelations = categorizedRelations.uncategorized || [];
  
  if (uncategorizedEntities.length > 0 || uncategorizedRelations.length > 0) {
    console.log(`\n⚠️  Found ${uncategorizedEntities.length} uncategorized entities and ${uncategorizedRelations.length} relations:`);
    
    for (const entity of uncategorizedEntities) {
      console.log(`   - ${entity.name} (${entity.entityType})`);
    }
    
    console.log('\nThese will need manual categorization. Consider:');
    console.log('1. Adding them to the appropriate team file manually');
    console.log('2. Updating the categorization rules in this script');
    console.log('3. Creating a new team category if needed');
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  });
}