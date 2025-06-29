#!/usr/bin/env node
/**
 * UKB CLI - Modern command-line interface for the Knowledge API
 * 
 * Provides a stable, agent-agnostic interface for knowledge management
 * across different coding assistants and platforms.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Dynamic imports for the Knowledge API
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Knowledge API
import KnowledgeAPI from './index.js';
import GitAnalyzer from './utils/git-analyzer.js';

// CLI Configuration
const CLI_VERSION = '1.0.0';
const program = new Command();

// Global API instance
let api = null;

/**
 * Detect target team/project based on entity content
 */
function detectTargetTeam(name, entityType, observation = '') {
  const content = `${name} ${entityType} ${observation}`.toLowerCase();
  
  // Coding-related keywords
  const codingKeywords = [
    'pattern', 'api', 'cli', 'code', 'system', 'architecture', 'workflow',
    'analysis', 'documentation', 'automation', 'semantic', 'mcp', 'knowledge',
    'ukb', 'vkb', 'installation', 'logging', 'integration', 'bridge', 'extension'
  ];
  
  // UI-related keywords  
  const uiKeywords = [
    'viewport', 'redux', 'react', 'three', 'fiber', 'animation', 'routing',
    'component', 'hook', 'timeline', 'dynarch', 'culling', 'rendering', 'canvas'
  ];
  
  // Count matches
  const codingMatches = codingKeywords.filter(keyword => content.includes(keyword)).length;
  const uiMatches = uiKeywords.filter(keyword => content.includes(keyword)).length;
  
  // Return team based on strongest match
  if (codingMatches > uiMatches) {
    return 'coding';
  } else if (uiMatches > codingMatches) {
    return 'ui';
  }
  
  // Default to coding for ambiguous cases
  return 'coding';
}

/**
 * Handle piped input for entity creation
 */
async function handlePipedInput() {
  const api = await initializeAPI();
  
  return new Promise((resolve, reject) => {
    let input = '';
    
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    
    process.stdin.on('end', async () => {
      try {
        const lines = input.trim().split('\n').filter(line => line.trim().length > 0);
        
        if (lines.length < 2) {
          console.error(chalk.red('Piped input requires at least 2 lines'));
          console.error(chalk.gray('Format 1 - Simple Entity:'));
          console.error(chalk.gray('  EntityName'));
          console.error(chalk.gray('  EntityType'));
          console.error(chalk.gray('  Significance (optional, default: 5)'));
          console.error(chalk.gray('  Observation (optional)'));
          console.error(chalk.gray(''));
          console.error(chalk.gray('Format 2 - Complex Insight (9 lines):'));
          console.error(chalk.gray('  Problem description'));
          console.error(chalk.gray('  Solution description'));
          console.error(chalk.gray('  Rationale'));
          console.error(chalk.gray('  Key learnings'));
          console.error(chalk.gray('  Applicability'));
          console.error(chalk.gray('  Technologies (comma-separated)'));
          console.error(chalk.gray('  Reference URLs'));
          console.error(chalk.gray('  Code files (comma-separated)'));
          console.error(chalk.gray('  Significance (1-10)'));
          process.exit(1);
        }
        
        // Detect format: if 7+ lines, treat as complex insight; otherwise simple entity
        if (lines.length >= 7) {
          await handleComplexInsight(lines);
        } else {
          await handleSimpleEntity(lines);
        }
        
      } catch (error) {
        console.error(chalk.red('Failed to process piped input:'), error.message);
        reject(error);
      }
    });
  });
}

/**
 * Handle simple entity creation from piped input
 */
async function handleSimpleEntity(lines) {
  const api = await initializeAPI();
  const [name, entityType, significance = '5', observation] = lines;
  
  // Validate entity type
  const validTypes = [
    'WorkflowPattern', 'TechnicalPattern', 'Problem', 'Solution', 
    'Tool', 'Framework', 'Best Practice', 'Documentation', 'Other'
  ];
  
  if (!validTypes.includes(entityType)) {
    console.error(chalk.red(`Invalid entity type: ${entityType}`));
    console.error(chalk.gray('Valid types:'), validTypes.join(', '));
    process.exit(1);
  }
  
  // Validate significance
  const sig = parseInt(significance);
  if (isNaN(sig) || sig < 1 || sig > 10) {
    console.error(chalk.red(`Invalid significance: ${significance} (must be 1-10)`));
    process.exit(1);
  }
  
  // Detect target project based on keywords
  const targetTeam = detectTargetTeam(name, entityType, observation);
  
  // Create entity data
  const entityData = {
    name: name.trim(),
    entityType: entityType.trim(),
    significance: sig,
    observations: observation ? [observation.trim()] : [],
    metadata: {
      team: targetTeam,
      created_by: 'ukb-cli'
    }
  };
  
  console.log(chalk.cyan(`Creating entity from piped input:`));
  console.log(chalk.gray(`  Name: ${entityData.name}`));
  console.log(chalk.gray(`  Type: ${entityData.entityType}`));
  console.log(chalk.gray(`  Significance: ${entityData.significance}/10`));
  if (entityData.observations.length > 0) {
    console.log(chalk.gray(`  Observation: ${entityData.observations[0]}`));
  }
  console.log();
  
  const spinner = ora(`Creating entity "${entityData.name}"...`).start();
  
  try {
    const entity = await api.entities.create(entityData);
    spinner.succeed(`Created entity: ${entity.name}`);
  } catch (error) {
    spinner.fail('Failed to create entity');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

/**
 * Handle complex insight processing from piped input
 */
async function handleComplexInsight(lines) {
  const api = await initializeAPI();
  
  if (lines.length < 9) {
    console.error(chalk.red('Complex insight format requires exactly 9 lines'));
    console.error(chalk.gray('Expected:'));
    console.error(chalk.gray('  1. Problem description'));
    console.error(chalk.gray('  2. Solution description'));
    console.error(chalk.gray('  3. Rationale'));
    console.error(chalk.gray('  4. Key learnings'));
    console.error(chalk.gray('  5. Applicability'));
    console.error(chalk.gray('  6. Technologies (comma-separated)'));
    console.error(chalk.gray('  7. Reference URLs'));
    console.error(chalk.gray('  8. Code files (comma-separated)'));
    console.error(chalk.gray('  9. Significance (1-10)'));
    process.exit(1);
  }
  
  const [
    problem, solution, rationale, learnings, applicability,
    technologies, references, codeFiles, significance
  ] = lines;
  
  // Validate significance
  const sig = parseInt(significance);
  if (isNaN(sig) || sig < 1 || sig > 10) {
    console.error(chalk.red(`Invalid significance: ${significance} (must be 1-10)`));
    process.exit(1);
  }
  
  console.log(chalk.cyan(`Processing complex insight from piped input:`));
  console.log(chalk.gray(`  Problem: ${problem.substring(0, 60)}...`));
  console.log(chalk.gray(`  Solution: ${solution.substring(0, 60)}...`));
  console.log(chalk.gray(`  Significance: ${sig}/10`));
  console.log();
  
  // Generate entity name from problem/solution
  const entityName = generateEntityName(problem, solution);
  
  // Detect target team based on content
  const targetTeam = detectTargetTeam(entityName, 'WorkflowPattern', `${problem} ${solution} ${applicability}`);
  
  // Create comprehensive entity with structured observations
  const entityData = {
    name: entityName,
    entityType: 'WorkflowPattern',
    significance: sig,
    observations: [
      { type: 'problem', content: problem.trim(), date: new Date().toISOString() },
      { type: 'solution', content: solution.trim(), date: new Date().toISOString() },
      { type: 'rationale', content: rationale.trim(), date: new Date().toISOString() },
      { type: 'learnings', content: learnings.trim(), date: new Date().toISOString() },
      { type: 'applicability', content: applicability.trim(), date: new Date().toISOString() }
    ],
    metadata: {
      team: targetTeam,
      technologies: technologies.split(',').map(t => t.trim()).filter(t => t.length > 0),
      references: references.split(',').map(r => r.trim()).filter(r => r.length > 0),
      codeFiles: codeFiles.split(',').map(f => f.trim()).filter(f => f.length > 0),
      created_by: 'piped-insight',
      insight_type: 'problem-solution'
    }
  };
  
  const spinner = ora(`Creating insight "${entityName}"...`).start();
  
  try {
    const entity = await api.entities.create(entityData);
    spinner.succeed(`Created insight: ${entity.name}`);
    
    console.log(chalk.green('\nInsight details:'));
    console.log(chalk.cyan('  Technologies:'), entityData.metadata.technologies.join(', ') || 'None');
    console.log(chalk.cyan('  References:'), entityData.metadata.references.length || 'None');
    console.log(chalk.cyan('  Code Files:'), entityData.metadata.codeFiles.length || 'None');
    
  } catch (error) {
    spinner.fail('Failed to create insight');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

/**
 * Generate entity name from problem and solution
 */
function generateEntityName(problem, solution) {
  // Extract key terms from problem and solution
  const problemWords = problem.split(' ').slice(0, 3);
  const solutionWords = solution.split(' ').slice(0, 3);
  
  // Create a pattern name
  const problemKey = problemWords.join('').replace(/[^a-zA-Z]/g, '');
  const solutionKey = solutionWords.join('').replace(/[^a-zA-Z]/g, '');
  
  return `${problemKey}${solutionKey}Pattern`.substring(0, 40);
}

/**
 * Initialize the Knowledge API
 */
async function initializeAPI(options = {}) {
  if (api) return api;
  
  try {
    // Get global options from commander
    const globalOptions = program.opts();
    
    // Merge team option if provided
    const mergedOptions = { 
      ...options,
      ...(globalOptions.team && { 
        storage: { 
          ...(options.storage || {}),
          team: globalOptions.team 
        }
      })
    };
    
    api = new KnowledgeAPI(mergedOptions);
    
    try {
      await api.initialize();
    } catch (initError) {
      // If file doesn't exist and this is a ukb command, offer to create it
      if (initError.message.includes('Knowledge base file not found')) {
        console.log(chalk.yellow('Knowledge base file not found.'));
        const create = await inquirer.prompt([{
          type: 'confirm',
          name: 'createNew',
          message: 'Create a new knowledge base file?',
          default: true
        }]);
        
        if (create.createNew) {
          await api.createNew();
          console.log(chalk.green('Created new knowledge base file.'));
        } else {
          throw initError;
        }
      } else {
        throw initError;
      }
    }
    
    return api;
  } catch (error) {
    console.error(chalk.red('Failed to initialize Knowledge API:'), error.message);
    process.exit(1);
  }
}

/**
 * Display status information
 */
async function displayStatus() {
  const spinner = ora('Getting knowledge base status...').start();
  
  try {
    const api = await initializeAPI();
    const status = await api.getStatus();
    
    spinner.succeed('Knowledge base status:');
    
    console.log(chalk.cyan('Storage:'), status.storage.path);
    console.log(chalk.cyan('Team:'), status.storage.team || 'default');
    console.log(chalk.cyan('Entities:'), status.stats.entities);
    console.log(chalk.cyan('Relations:'), status.stats.relations);
    console.log(chalk.cyan('Last Updated:'), status.storage.lastModified || 'Never');
    
    // Show multi-file info if available
    if (status.storage.files) {
      console.log(chalk.gray('\nFile sources:'));
      if (status.storage.files.coding) {
        console.log(chalk.gray('  Coding:'), path.basename(status.storage.files.coding));
      }
      if (status.storage.files.team) {
        console.log(chalk.gray('  Team:'), path.basename(status.storage.files.team));
      }
    }
    console.log(chalk.cyan('Version:'), status.version);
    
  } catch (error) {
    spinner.fail('Failed to get status');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

/**
 * Interactive entity management
 */
async function manageEntities(action, options) {
  const api = await initializeAPI();
  
  switch (action) {
    case 'list':
      await listEntities(api, options);
      break;
    case 'add':
      await addEntity(api, options);
      break;
    case 'remove':
      await removeEntity(api, options);
      break;
    case 'remove-multiple':
      await removeMultipleEntities(api, options);
      break;
    case 'rename':
      await renameEntity(api, options);
      break;
    case 'update':
      await updateEntity(api, options);
      break;
    case 'search':
      await searchEntities(api, options);
      break;
    case 'add-observation':
      await addObservation(api, options);
      break;
    case 'remove-observation':
      await removeObservation(api, options);
      break;
    case 'add-batch':
      await addEntitiesBatch(api, options);
      break;
    case 'update-batch':
      await updateEntitiesBatch(api, options);
      break;
    default:
      console.error(chalk.red('Unknown entity action:'), action);
      process.exit(1);
  }
}

async function listEntities(api, options) {
  const spinner = ora('Loading entities...').start();
  
  try {
    const entities = await api.entities.getAll(options);
    spinner.succeed(`Found ${entities.length} entities`);
    
    if (entities.length === 0) {
      console.log(chalk.yellow('No entities found.'));
      return;
    }
    
    // Display entities in a table-like format
    console.log('\n' + chalk.bold('Entities:'));
    console.log(chalk.gray('-'.repeat(80)));
    
    for (const entity of entities) {
      const significance = '★'.repeat(entity.significance || 5);
      console.log(chalk.cyan(entity.name.padEnd(30)) + 
                  chalk.yellow(entity.entityType.padEnd(20)) + 
                  chalk.green(significance));
      
      if (options.verbose && entity.observations && entity.observations.length > 0) {
        const obs = entity.observations[0];
        const content = typeof obs === 'string' ? obs : obs.content || obs;
        console.log(chalk.gray('  ' + content.substring(0, 60) + '...'));
      }
    }
    
  } catch (error) {
    spinner.fail('Failed to list entities');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function addEntity(api, options) {
  let entityData = {};
  
  if (options.interactive) {
    // Interactive mode
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Entity name:',
        validate: input => input.length > 0 || 'Name is required'
      },
      {
        type: 'list',
        name: 'entityType',
        message: 'Entity type:',
        choices: [
          'WorkflowPattern',
          'TechnicalPattern',
          'Problem',
          'Solution',
          'Tool',
          'Framework',
          'Best Practice',
          'Documentation',
          'Other'
        ]
      },
      {
        type: 'number',
        name: 'significance',
        message: 'Significance (1-10):',
        default: 5,
        validate: input => (input >= 1 && input <= 10) || 'Must be between 1 and 10'
      },
      {
        type: 'input',
        name: 'observation',
        message: 'Initial observation (optional):'
      }
    ]);
    
    // Detect target team based on input
    const targetTeam = detectTargetTeam(answers.name, answers.entityType, answers.observation || '');
    
    entityData = {
      ...answers,
      metadata: {
        team: targetTeam,
        created_by: 'ukb-cli-interactive'
      }
    };
    
    if (answers.observation) {
      entityData.observations = [answers.observation];
    }
    
  } else {
    // Non-interactive mode
    const targetTeam = detectTargetTeam(options.name, options.type || 'Other', options.observation || '');
    
    entityData = {
      name: options.name,
      entityType: options.type || 'Other',
      significance: options.significance || 5,
      observations: options.observation ? [options.observation] : [],
      metadata: {
        team: targetTeam,
        created_by: 'ukb-cli'
      }
    };
  }
  
  const spinner = ora(`Creating entity "${entityData.name}"...`).start();
  
  try {
    const entity = await api.entities.create(entityData);
    spinner.succeed(`Created entity: ${entity.name}`);
    
  } catch (error) {
    spinner.fail('Failed to create entity');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function removeEntity(api, options) {
  let entityName = options.name;
  
  if (!entityName && options.interactive) {
    const entities = await api.entities.getAll();
    
    if (entities.length === 0) {
      console.log(chalk.yellow('No entities found.'));
      return;
    }
    
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'entityName',
        message: 'Select entity to remove:',
        choices: entities.map(e => ({
          name: `${e.name} (${e.entityType})`,
          value: e.name
        }))
      }
    ]);
    
    entityName = answer.entityName;
  }
  
  if (!entityName) {
    console.error(chalk.red('Entity name is required'));
    process.exit(1);
  }
  
  // Confirm deletion
  const confirmAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete "${entityName}"?`,
      default: false
    }
  ]);
  
  if (!confirmAnswer.confirm) {
    console.log(chalk.yellow('Deletion cancelled.'));
    return;
  }
  
  const spinner = ora(`Removing entity "${entityName}"...`).start();
  
  try {
    await api.entities.delete(entityName);
    spinner.succeed(`Removed entity: ${entityName}`);
    
  } catch (error) {
    spinner.fail('Failed to remove entity');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function updateEntity(api, options) {
  // Implementation for update functionality
  console.log(chalk.yellow('Update functionality not yet implemented'));
}

async function removeMultipleEntities(api, options) {
  const entities = options.entities;
  
  if (!entities || entities.length === 0) {
    console.error(chalk.red('No entities specified for removal'));
    process.exit(1);
  }
  
  // Confirm deletion of multiple entities
  const confirmAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete ${entities.length} entities: ${entities.join(', ')}?`,
      default: false
    }
  ]);
  
  if (!confirmAnswer.confirm) {
    console.log(chalk.yellow('Deletion cancelled.'));
    return;
  }
  
  const spinner = ora(`Removing ${entities.length} entities...`).start();
  let successCount = 0;
  let failureCount = 0;
  
  for (const entityName of entities) {
    try {
      await api.entities.delete(entityName.trim());
      successCount++;
    } catch (error) {
      failureCount++;
      console.log(chalk.red(`\nFailed to remove "${entityName}": ${error.message}`));
    }
  }
  
  if (failureCount === 0) {
    spinner.succeed(`Successfully removed ${successCount} entities`);
  } else {
    spinner.warn(`Removed ${successCount} entities, failed to remove ${failureCount}`);
  }
}

async function renameEntity(api, options) {
  const { oldName, newName } = options;
  
  if (!oldName || !newName) {
    console.error(chalk.red('Both old name and new name are required'));
    process.exit(1);
  }
  
  const spinner = ora(`Renaming entity "${oldName}" to "${newName}"...`).start();
  
  try {
    // Get the entity first
    const entities = await api.entities.getAll();
    const entity = entities.find(e => e.name === oldName);
    
    if (!entity) {
      spinner.fail(`Entity "${oldName}" not found`);
      process.exit(1);
    }
    
    // Create new entity with updated name
    const updatedEntity = {
      ...entity,
      name: newName,
      metadata: {
        ...entity.metadata,
        last_updated: new Date().toISOString(),
        renamed_from: oldName
      }
    };
    
    // Remove old entity and add new one
    await api.entities.delete(oldName);
    await api.entities.create(updatedEntity);
    
    // Update any relations that reference the old name
    const relations = await api.relations.getAll();
    const relationsToUpdate = relations.filter(r => r.from === oldName || r.to === oldName);
    
    for (const relation of relationsToUpdate) {
      // Remove old relation
      await api.relations.delete(relation);
      
      // Add updated relation
      const updatedRelation = {
        ...relation,
        from: relation.from === oldName ? newName : relation.from,
        to: relation.to === oldName ? newName : relation.to
      };
      await api.relations.create(updatedRelation);
    }
    
    spinner.succeed(`Renamed entity "${oldName}" to "${newName}" and updated ${relationsToUpdate.length} relations`);
    
  } catch (error) {
    spinner.fail('Failed to rename entity');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function searchEntities(api, options) {
  let query = options.query;
  
  if (!query && options.interactive) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'query',
        message: 'Search query:',
        validate: input => input.length > 0 || 'Query is required'
      }
    ]);
    
    query = answer.query;
  }
  
  if (!query) {
    console.error(chalk.red('Search query is required'));
    process.exit(1);
  }
  
  const spinner = ora(`Searching for "${query}"...`).start();
  
  try {
    const entities = await api.entities.search(query);
    spinner.succeed(`Found ${entities.length} entities matching "${query}"`);
    
    if (entities.length === 0) {
      console.log(chalk.yellow('No entities found.'));
      return;
    }
    
    // Display search results
    console.log('\n' + chalk.bold('Search Results:'));
    console.log(chalk.gray('-'.repeat(80)));
    
    for (const entity of entities) {
      const significance = '★'.repeat(entity.significance || 5);
      console.log(chalk.cyan(entity.name.padEnd(30)) + 
                  chalk.yellow(entity.entityType.padEnd(20)) + 
                  chalk.green(significance));
      
      if (options.verbose && entity.observations && entity.observations.length > 0) {
        const obs = entity.observations[0];
        const content = typeof obs === 'string' ? obs : obs.content || obs;
        console.log(chalk.gray('  ' + content.substring(0, 60) + '...'));
      }
    }
    
  } catch (error) {
    spinner.fail('Search failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function addObservation(api, options) {
  const { entityName, observation } = options;
  
  if (!entityName || !observation) {
    console.error(chalk.red('Entity name and observation are required'));
    process.exit(1);
  }
  
  const spinner = ora(`Adding observation to "${entityName}"...`).start();
  
  try {
    // Get the entity first
    const entities = await api.entities.getAll();
    const entity = entities.find(e => e.name === entityName);
    
    if (!entity) {
      spinner.fail(`Entity "${entityName}" not found`);
      process.exit(1);
    }
    
    // Add the observation
    const updatedObservations = [...(entity.observations || []), observation];
    const updatedEntity = {
      ...entity,
      observations: updatedObservations,
      metadata: {
        ...entity.metadata,
        last_updated: new Date().toISOString()
      }
    };
    
    await api.entities.update(entityName, updatedEntity);
    spinner.succeed(`Added observation to "${entityName}"`);
    
  } catch (error) {
    spinner.fail('Failed to add observation');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function removeObservation(api, options) {
  const { entityName, observation } = options;
  
  if (!entityName || !observation) {
    console.error(chalk.red('Entity name and observation are required'));
    process.exit(1);
  }
  
  const spinner = ora(`Removing observation from "${entityName}"...`).start();
  
  try {
    // Get the entity first
    const entities = await api.entities.getAll();
    const entity = entities.find(e => e.name === entityName);
    
    if (!entity) {
      spinner.fail(`Entity "${entityName}" not found`);
      process.exit(1);
    }
    
    // Remove the observation
    const observations = entity.observations || [];
    const updatedObservations = observations.filter(obs => {
      const obsContent = typeof obs === 'string' ? obs : obs.content || obs;
      return obsContent !== observation;
    });
    
    if (updatedObservations.length === observations.length) {
      spinner.warn(`Observation not found in "${entityName}"`);
      return;
    }
    
    const updatedEntity = {
      ...entity,
      observations: updatedObservations,
      metadata: {
        ...entity.metadata,
        last_updated: new Date().toISOString()
      }
    };
    
    await api.entities.update(entityName, updatedEntity);
    spinner.succeed(`Removed observation from "${entityName}"`);
    
  } catch (error) {
    spinner.fail('Failed to remove observation');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

/**
 * Batch operations for entities
 */
async function addEntitiesBatch(api, options) {
  const { file, dryRun } = options;
  
  if (!file) {
    console.error(chalk.red('Batch file is required'));
    process.exit(1);
  }
  
  try {
    const content = await fs.readFile(file, 'utf8');
    const batchData = JSON.parse(content);
    
    if (!Array.isArray(batchData.entities)) {
      console.error(chalk.red('Batch file must contain an "entities" array'));
      process.exit(1);
    }
    
    const entities = batchData.entities;
    console.log(`\n${chalk.bold('📁 Batch Entity Addition')}`);
    console.log(chalk.gray('='.repeat(50)));
    console.log(chalk.cyan('Total entities to add:'), chalk.white(entities.length));
    
    if (dryRun) {
      console.log(chalk.yellow('\n🔍 DRY RUN - No changes will be made\n'));
      
      for (const entity of entities) {
        console.log(chalk.cyan(`  + ${entity.name} (${entity.entityType || 'Unknown'}) - Significance: ${entity.significance || 5}/10`));
        if (entity.observations && entity.observations.length > 0) {
          console.log(chalk.gray(`    Observations: ${entity.observations.length}`));
        }
      }
      return;
    }
    
    const spinner = ora(`Adding ${entities.length} entities...`).start();
    let successCount = 0;
    let failureCount = 0;
    
    for (const entityData of entities) {
      try {
        await api.entities.create(entityData);
        successCount++;
      } catch (error) {
        failureCount++;
        console.log(chalk.red(`\nFailed to add "${entityData.name}": ${error.message}`));
      }
    }
    
    if (failureCount === 0) {
      spinner.succeed(`Successfully added ${successCount} entities`);
    } else {
      spinner.warn(`Added ${successCount} entities, failed to add ${failureCount}`);
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to process batch file:'), error.message);
    process.exit(1);
  }
}

async function updateEntitiesBatch(api, options) {
  const { file, dryRun } = options;
  
  if (!file) {
    console.error(chalk.red('Batch file is required'));
    process.exit(1);
  }
  
  try {
    const content = await fs.readFile(file, 'utf8');
    const batchData = JSON.parse(content);
    
    if (!Array.isArray(batchData.entities)) {
      console.error(chalk.red('Batch file must contain an "entities" array'));
      process.exit(1);
    }
    
    const entities = batchData.entities;
    console.log(`\n${chalk.bold('📝 Batch Entity Update')}`);
    console.log(chalk.gray('='.repeat(50)));
    console.log(chalk.cyan('Total entities to update:'), chalk.white(entities.length));
    
    if (dryRun) {
      console.log(chalk.yellow('\n🔍 DRY RUN - No changes will be made\n'));
      
      for (const entity of entities) {
        console.log(chalk.cyan(`  ~ ${entity.name} (${entity.entityType || 'Unknown'})`));
      }
      return;
    }
    
    const spinner = ora(`Updating ${entities.length} entities...`).start();
    let successCount = 0;
    let failureCount = 0;
    
    for (const entityData of entities) {
      try {
        await api.entities.update(entityData.name, entityData);
        successCount++;
      } catch (error) {
        failureCount++;
        console.log(chalk.red(`\nFailed to update "${entityData.name}": ${error.message}`));
      }
    }
    
    if (failureCount === 0) {
      spinner.succeed(`Successfully updated ${successCount} entities`);
    } else {
      spinner.warn(`Updated ${successCount} entities, failed to update ${failureCount}`);
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to process batch file:'), error.message);
    process.exit(1);
  }
}

/**
 * Interactive relation management
 */
async function manageRelations(action, options) {
  const api = await initializeAPI();
  
  switch (action) {
    case 'list':
      await listRelations(api, options);
      break;
    case 'add':
      await addRelation(api, options);
      break;
    case 'remove':
      await removeRelation(api, options);
      break;
    case 'add-batch':
      await addRelationsBatch(api, options);
      break;
    case 'remove-batch':
      await removeRelationsBatch(api, options);
      break;
    default:
      console.error(chalk.red('Unknown relation action:'), action);
      process.exit(1);
  }
}

async function listRelations(api, options) {
  const spinner = ora('Loading relations...').start();
  
  try {
    const relations = await api.relations.getAll(options);
    spinner.succeed(`Found ${relations.length} relations`);
    
    if (relations.length === 0) {
      console.log(chalk.yellow('No relations found.'));
      return;
    }
    
    console.log('\n' + chalk.bold('Relations:'));
    console.log(chalk.gray('-'.repeat(80)));
    
    for (const relation of relations) {
      const significance = '★'.repeat(relation.significance || 5);
      console.log(
        chalk.cyan(relation.from) + 
        chalk.gray(' -[') + 
        chalk.yellow(relation.relationType) + 
        chalk.gray(']-> ') + 
        chalk.cyan(relation.to) + 
        ' ' + chalk.green(significance)
      );
    }
    
  } catch (error) {
    spinner.fail('Failed to list relations');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function addRelation(api, options) {
  let relationData = {};
  
  if (options.interactive) {
    // Get available entities
    const entities = await api.entities.getAll();
    const entityChoices = entities.map(e => e.name);
    
    if (entityChoices.length < 2) {
      console.log(chalk.yellow('Need at least 2 entities to create a relation.'));
      return;
    }
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'from',
        message: 'From entity:',
        choices: entityChoices
      },
      {
        type: 'list',
        name: 'to',
        message: 'To entity:',
        choices: entityChoices
      },
      {
        type: 'list',
        name: 'relationType',
        message: 'Relation type:',
        choices: [
          'implements',
          'uses',
          'solves',
          'related_to',
          'depends_on',
          'improves',
          'replaces',
          'part_of',
          'exemplifies'
        ]
      },
      {
        type: 'number',
        name: 'significance',
        message: 'Significance (1-10):',
        default: 5,
        validate: input => (input >= 1 && input <= 10) || 'Must be between 1 and 10'
      }
    ]);
    
    relationData = answers;
    
  } else {
    relationData = {
      from: options.from,
      to: options.to,
      relationType: options.type || 'related_to',
      significance: options.significance || 5
    };
  }
  
  const spinner = ora(`Creating relation: ${relationData.from} -[${relationData.relationType}]-> ${relationData.to}`).start();
  
  try {
    const relation = await api.relations.create(relationData);
    spinner.succeed('Relation created successfully');
    
  } catch (error) {
    spinner.fail('Failed to create relation');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function removeRelation(api, options) {
  let relationData = {};
  
  if (options.byId) {
    // Remove by ID
    const relations = await api.relations.getAll();
    const relation = relations.find(r => r.id === options.byId);
    
    if (!relation) {
      console.error(chalk.red(`Relation with ID "${options.byId}" not found`));
      process.exit(1);
    }
    
    relationData = relation;
    
  } else if (options.interactive) {
    // Get available relations
    const relations = await api.relations.getAll();
    
    if (relations.length === 0) {
      console.log(chalk.yellow('No relations found.'));
      return;
    }
    
    const relationChoices = relations.map(r => ({
      name: `${r.from} -[${r.relationType}]-> ${r.to} (ID: ${r.id})`,
      value: r
    }));
    
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'relation',
        message: 'Select relation to remove:',
        choices: relationChoices
      }
    ]);
    
    relationData = answer.relation;
    
  } else {
    relationData = {
      from: options.from,
      to: options.to,
      relationType: options.type
    };
  }
  
  if (!options.byId && (!relationData.from || !relationData.to || !relationData.relationType)) {
    console.error(chalk.red('Either --by-id or all of --from, --to, and --type are required'));
    process.exit(1);
  }
  
  // Confirm deletion
  const confirmAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete relation: ${relationData.from} -[${relationData.relationType}]-> ${relationData.to}?`,
      default: false
    }
  ]);
  
  if (!confirmAnswer.confirm) {
    console.log(chalk.yellow('Deletion cancelled.'));
    return;
  }
  
  const spinner = ora(`Removing relation: ${relationData.from} -[${relationData.relationType}]-> ${relationData.to}`).start();
  
  try {
    await api.relations.delete(relationData.id);
    spinner.succeed('Relation removed successfully');
    
  } catch (error) {
    spinner.fail('Failed to remove relation');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

/**
 * Batch operations for relations
 */
async function addRelationsBatch(api, options) {
  const { file, dryRun } = options;
  
  if (!file) {
    console.error(chalk.red('Batch file is required'));
    process.exit(1);
  }
  
  try {
    const content = await fs.readFile(file, 'utf8');
    const batchData = JSON.parse(content);
    
    if (!Array.isArray(batchData.relations)) {
      console.error(chalk.red('Batch file must contain a "relations" array'));
      process.exit(1);
    }
    
    const relations = batchData.relations;
    console.log(`\n${chalk.bold('🔗 Batch Relation Addition')}`);
    console.log(chalk.gray('='.repeat(50)));
    console.log(chalk.cyan('Total relations to add:'), chalk.white(relations.length));
    
    if (dryRun) {
      console.log(chalk.yellow('\n🔍 DRY RUN - No changes will be made\n'));
      
      for (const relation of relations) {
        console.log(chalk.cyan(`  + ${relation.from} -[${relation.relationType}]-> ${relation.to}`));
        if (relation.significance) {
          console.log(chalk.gray(`    Significance: ${relation.significance}/10`));
        }
      }
      return;
    }
    
    const spinner = ora(`Adding ${relations.length} relations...`).start();
    let successCount = 0;
    let failureCount = 0;
    
    for (const relationData of relations) {
      try {
        await api.relations.create(relationData);
        successCount++;
      } catch (error) {
        failureCount++;
        console.log(chalk.red(`\nFailed to add relation "${relationData.from} -> ${relationData.to}": ${error.message}`));
      }
    }
    
    if (failureCount === 0) {
      spinner.succeed(`Successfully added ${successCount} relations`);
    } else {
      spinner.warn(`Added ${successCount} relations, failed to add ${failureCount}`);
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to process batch file:'), error.message);
    process.exit(1);
  }
}

async function removeRelationsBatch(api, options) {
  const { file, dryRun } = options;
  
  if (!file) {
    console.error(chalk.red('Batch file is required'));
    process.exit(1);
  }
  
  try {
    const content = await fs.readFile(file, 'utf8');
    const batchData = JSON.parse(content);
    
    if (!Array.isArray(batchData.relations)) {
      console.error(chalk.red('Batch file must contain a "relations" array'));
      process.exit(1);
    }
    
    const relations = batchData.relations;
    console.log(`\n${chalk.bold('🗑️  Batch Relation Removal')}`);
    console.log(chalk.gray('='.repeat(50)));
    console.log(chalk.cyan('Total relations to remove:'), chalk.white(relations.length));
    
    if (dryRun) {
      console.log(chalk.yellow('\n🔍 DRY RUN - No changes will be made\n'));
      
      for (const relation of relations) {
        console.log(chalk.red(`  - ${relation.from} -[${relation.relationType}]-> ${relation.to}`));
      }
      return;
    }
    
    // Confirm deletion
    const confirmAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete ${relations.length} relations?`,
        default: false
      }
    ]);
    
    if (!confirmAnswer.confirm) {
      console.log(chalk.yellow('Deletion cancelled.'));
      return;
    }
    
    const spinner = ora(`Removing ${relations.length} relations...`).start();
    let successCount = 0;
    let failureCount = 0;
    
    for (const relationData of relations) {
      try {
        await api.relations.delete(relationData);
        successCount++;
      } catch (error) {
        failureCount++;
        console.log(chalk.red(`\nFailed to remove relation "${relationData.from} -> ${relationData.to}": ${error.message}`));
      }
    }
    
    if (failureCount === 0) {
      spinner.succeed(`Successfully removed ${successCount} relations`);
    } else {
      spinner.warn(`Removed ${successCount} relations, failed to remove ${failureCount}`);
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to process batch file:'), error.message);
    process.exit(1);
  }
}

/**
 * Interactive insight processing
 */
async function processInsight(options) {
  const api = await initializeAPI();
  
  if (options.interactive) {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'type',
        message: 'Insight type:',
        choices: [
          { name: 'Problem-Solution pair', value: 'problem-solution' },
          { name: 'Technical Pattern', value: 'technical-pattern' },
          { name: 'Architectural Change', value: 'architectural-change' }
        ]
      },
      {
        type: 'input',
        name: 'problem',
        message: 'Problem description:',
        when: answers => answers.type === 'problem-solution'
      },
      {
        type: 'input',
        name: 'solution',
        message: 'Solution description:',
        when: answers => answers.type === 'problem-solution'
      },
      {
        type: 'input',
        name: 'pattern',
        message: 'Pattern description:',
        when: answers => answers.type === 'technical-pattern'
      },
      {
        type: 'input',
        name: 'description',
        message: 'Change description:',
        when: answers => answers.type === 'architectural-change'
      }
    ]);
    
    const spinner = ora('Processing insight...').start();
    
    try {
      const result = await api.insights.processInsight(answers);
      spinner.succeed('Insight processed successfully');
      
      console.log(chalk.green('Created:'));
      console.log(chalk.cyan(`  ${result.entities.length} entities`));
      console.log(chalk.cyan(`  ${result.relations.length} relations`));
      console.log(chalk.cyan(`  Significance: ${result.significance}/10`));
      
    } catch (error) {
      spinner.fail('Failed to process insight');
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  }
}

/**
 * Import/Export functionality
 */
async function importData(filePath, options) {
  const api = await initializeAPI();
  
  const spinner = ora(`Importing data from ${filePath}...`).start();
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    
    await api.storage.importData(data, options.merge);
    
    spinner.succeed('Data imported successfully');
    
  } catch (error) {
    spinner.fail('Import failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function exportData(filePath, options) {
  const api = await initializeAPI();
  
  const spinner = ora(`Exporting data to ${filePath}...`).start();
  
  try {
    const data = await api.storage.exportData();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    
    spinner.succeed('Data exported successfully');
    
  } catch (error) {
    spinner.fail('Export failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

/**
 * Git analysis functions
 */
async function autoAnalyze(options) {
  // Auto-analysis disabled per user request - no automatic KB modifications
  console.log('⛔ Auto-analysis has been permanently disabled.');
  console.log('   To update the knowledge base, use explicit commands only:');
  console.log('   - ukb --interactive    (manual deep insight capture)');
  console.log('   - ukb --add-entity     (manual entity creation)');
  console.log('   - ukb --add-relation   (manual relationship creation)');
  console.log('');
  console.log('   Automatic knowledge base modifications are not allowed.');
  return;
  
  /* DISABLED AUTO-ANALYSIS CODE:
  const api = await initializeAPI();
  const numCommits = parseInt(options.numCommits) || 10;
  const significanceThreshold = parseInt(options.significance) || 7;
  
  const spinner = ora(`Analyzing last ${numCommits} commits...`).start();
  
  try {
    const gitAnalyzer = new GitAnalyzer({ 
      significanceThreshold,
      repoPath: process.cwd()
    });
    
    const insights = await gitAnalyzer.analyzeRecentCommits(numCommits);
    
    spinner.succeed(`Auto-analysis completed for ${numCommits} commits`);
    
    if (insights.length === 0) {
      console.log(chalk.yellow('No significant insights found in recent commits.'));
      return;
    }
    
    console.log(`\n${chalk.bold('📈 Git Analysis Results')}`);
    console.log(chalk.gray('='.repeat(50)));
    
    for (const insight of insights) {
      const significance = '★'.repeat(insight.significance);
      console.log(`\n${chalk.cyan(insight.hash)} ${chalk.green(significance)} (${insight.significance}/10)`);
      console.log(chalk.white(insight.message));
      console.log(chalk.gray(`  Author: ${insight.author} | Date: ${insight.date}`));
      console.log(chalk.gray(`  Files: ${insight.diffStats.files} | +${insight.diffStats.insertions} -${insight.diffStats.deletions}`));
      
      // Show detected patterns
      const patterns = Object.entries(insight.messageAnalysis)
        .filter(([_, matched]) => matched)
        .map(([pattern, _]) => pattern);
      
      if (patterns.length > 0) {
        console.log(chalk.yellow(`  Patterns: ${patterns.join(', ')}`));
      }
    }
    
    // Generate and save insights to knowledge base
    const patternInsights = gitAnalyzer.generateInsights(insights);
    if (patternInsights.length > 0) {
      console.log(`\n${chalk.bold('💡 Generated Insights')}`);
      for (const insight of patternInsights) {
        console.log(chalk.cyan(`  • ${insight.description} (${insight.significance}/10)`));
      }
    }
    
  } catch (error) {
    spinner.fail('Auto-analysis failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
  */
}

async function fullHistoryAnalyze(options) {
  const api = await initializeAPI();
  const branch = options.branch || 'main';
  const significanceThreshold = parseInt(options.significance) || 5;
  
  const spinner = ora(`Analyzing full history on branch ${branch}...`).start();
  
  try {
    const gitAnalyzer = new GitAnalyzer({ 
      significanceThreshold,
      repoPath: process.cwd()
    });
    
    const analysis = await gitAnalyzer.analyzeFullHistory(branch);
    const repoStats = await gitAnalyzer.getRepoStats();
    
    spinner.succeed(`Full history analysis completed for branch ${branch}`);
    
    console.log(`\n${chalk.bold('📊 Repository Statistics')}`);
    console.log(chalk.gray('='.repeat(50)));
    console.log(chalk.cyan('Total Commits:'), chalk.white(analysis.totalCommits));
    console.log(chalk.cyan('Analyzed Commits:'), chalk.white(analysis.analyzedCommits));
    console.log(chalk.cyan('Significant Insights:'), chalk.white(analysis.insights.length));
    console.log(chalk.cyan('Branch:'), chalk.white(analysis.branch));
    
    if (analysis.insights.length > 0) {
      console.log(`\n${chalk.bold('🔍 Significant Historical Insights')}`);
      console.log(chalk.gray('='.repeat(50)));
      
      // Group insights by significance
      const highSignificance = analysis.insights.filter(i => i.significance >= 8);
      const mediumSignificance = analysis.insights.filter(i => i.significance >= 6 && i.significance < 8);
      
      if (highSignificance.length > 0) {
        console.log(`\n${chalk.bold.red('High Significance (8-10)')}`);
        for (const insight of highSignificance.slice(0, 5)) {
          const significance = '★'.repeat(insight.significance);
          console.log(`\n${chalk.cyan(insight.hash)} ${chalk.red(significance)} (${insight.significance}/10)`);
          console.log(chalk.white(insight.message));
          console.log(chalk.gray(`  ${insight.date} | Files: ${insight.diffStats.files}`));
        }
      }
      
      if (mediumSignificance.length > 0) {
        console.log(`\n${chalk.bold.yellow('Medium Significance (6-7)')}`);
        for (const insight of mediumSignificance.slice(0, 3)) {
          const significance = '★'.repeat(insight.significance);
          console.log(`\n${chalk.cyan(insight.hash)} ${chalk.yellow(significance)} (${insight.significance}/10)`);
          console.log(chalk.white(insight.message));
          console.log(chalk.gray(`  ${insight.date} | Files: ${insight.diffStats.files}`));
        }
      }
    }
    
    // Generate insights summary
    const patternInsights = gitAnalyzer.generateInsights(analysis.insights);
    if (patternInsights.length > 0) {
      console.log(`\n${chalk.bold('🎯 Pattern Analysis')}`);
      console.log(chalk.gray('='.repeat(50)));
      for (const insight of patternInsights) {
        console.log(chalk.cyan(`  • ${insight.description}`));
      }
    }
    
  } catch (error) {
    spinner.fail('Full history analysis failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function agentMode(options) {
  const api = await initializeAPI();
  
  console.log(chalk.bold.cyan('🤖 Agent Mode - Deep Analysis'));
  console.log(chalk.gray('Interactive analysis with conversation integration\n'));
  
  try {
    // This would provide interactive agent analysis
    console.log(chalk.yellow('Agent mode functionality not yet fully implemented in ukb-cli'));
    console.log(chalk.gray('This mode will provide interactive deep analysis with conversation context'));
    
    if (options.conversation) {
      console.log(chalk.gray('Conversation analysis would be included'));
    }
    
  } catch (error) {
    console.error(chalk.red('Agent mode failed:'), error.message);
    process.exit(1);
  }
}

/**
 * Utility functions
 */
async function validateKnowledgeBase(options) {
  const api = await initializeAPI();
  
  const spinner = ora('Validating knowledge base...').start();
  
  try {
    // This would run validation checks
    const validation = await api.storage.validate();
    
    if (validation.valid) {
      spinner.succeed('Knowledge base validation passed');
    } else {
      spinner.warn('Knowledge base validation found issues');
      
      console.log(chalk.yellow('Validation Issues:'));
      for (const error of validation.errors) {
        console.log(chalk.red('  ❌ ' + error));
      }
      
      if (options.fix) {
        console.log(chalk.cyan('\nAttempting to fix issues...'));
        // Auto-fix logic would go here
        console.log(chalk.yellow('Auto-fix functionality not yet implemented'));
      }
    }
    
  } catch (error) {
    spinner.fail('Validation failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function showStatistics(options) {
  const api = await initializeAPI();
  
  const spinner = ora('Calculating statistics...').start();
  
  try {
    const status = await api.getStatus();
    spinner.succeed('Statistics calculated');
    
    console.log('\n' + chalk.bold('📊 Knowledge Base Statistics'));
    console.log(chalk.gray('='.repeat(50)));
    
    console.log(chalk.cyan('Entities:'), chalk.white(status.stats.entities));
    console.log(chalk.cyan('Relations:'), chalk.white(status.stats.relations));
    console.log(chalk.cyan('Storage Size:'), chalk.white(status.storage.size || 'Unknown'));
    console.log(chalk.cyan('Last Modified:'), chalk.white(status.storage.lastModified || 'Never'));
    
    if (options.verbose) {
      console.log('\n' + chalk.bold('Detailed Breakdown:'));
      console.log(chalk.gray('-'.repeat(30)));
      
      // This would show entity type breakdown, relation type breakdown, etc.
      console.log(chalk.yellow('Detailed statistics not yet fully implemented'));
    }
    
  } catch (error) {
    spinner.fail('Failed to calculate statistics');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function backupKnowledgeBase(options) {
  const api = await initializeAPI();
  
  const backupPath = options.path || `shared-memory-backup-${new Date().toISOString().split('T')[0]}.json`;
  const spinner = ora(`Creating backup at ${backupPath}...`).start();
  
  try {
    const data = await api.storage.exportData();
    await fs.writeFile(backupPath, JSON.stringify(data, null, 2), 'utf8');
    
    spinner.succeed(`Backup created: ${backupPath}`);
    
  } catch (error) {
    spinner.fail('Backup failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function restoreKnowledgeBase(backupFile, options) {
  const api = await initializeAPI();
  
  if (!options.confirm) {
    const confirmAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to restore from ${backupFile}? This will overwrite current data.`,
        default: false
      }
    ]);
    
    if (!confirmAnswer.confirm) {
      console.log(chalk.yellow('Restore cancelled.'));
      return;
    }
  }
  
  const spinner = ora(`Restoring from ${backupFile}...`).start();
  
  try {
    const content = await fs.readFile(backupFile, 'utf8');
    const data = JSON.parse(content);
    
    await api.storage.importData(data, false); // Don't merge, replace
    
    spinner.succeed('Knowledge base restored successfully');
    
  } catch (error) {
    spinner.fail('Restore failed');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

// CLI Command Setup
program
  .name('ukb-cli')
  .description('Knowledge API CLI - Agent-agnostic knowledge management')
  .version(CLI_VERSION)
  .option('--team <team>', 'Specify team context (overrides CODING_TEAM environment variable)');

// Status command
program
  .command('status')
  .description('Show knowledge base status')
  .action(displayStatus);

// Entity commands
const entityCmd = program
  .command('entity')
  .description('Manage entities');

entityCmd
  .command('list')
  .description('List entities')
  .option('-t, --type <type>', 'Filter by entity type')
  .option('-s, --min-significance <number>', 'Minimum significance score')
  .option('-v, --verbose', 'Show detailed information')
  .action(options => manageEntities('list', options));

entityCmd
  .command('add')
  .description('Add a new entity')
  .option('-n, --name <name>', 'Entity name')
  .option('-t, --type <type>', 'Entity type')
  .option('-s, --significance <number>', 'Significance score (1-10)')
  .option('-o, --observation <text>', 'Initial observation')
  .option('-i, --interactive', 'Interactive mode')
  .action(options => manageEntities('add', options));

entityCmd
  .command('remove')
  .description('Remove an entity')
  .option('-n, --name <name>', 'Entity name')
  .option('-i, --interactive', 'Interactive selection')
  .action(options => manageEntities('remove', options));

entityCmd
  .command('remove-multiple <entities>')
  .description('Remove multiple entities (comma-separated)')
  .action(entities => {
    const entityList = entities.split(',').map(e => e.trim());
    manageEntities('remove-multiple', { entities: entityList });
  });

entityCmd
  .command('rename <oldName> <newName>')
  .description('Rename an entity')
  .action((oldName, newName) => manageEntities('rename', { oldName, newName }));

entityCmd
  .command('search <query>')
  .description('Search entities')
  .option('-v, --verbose', 'Show detailed information')
  .action((query, options) => manageEntities('search', { ...options, query }));

entityCmd
  .command('add-observation <entityName> <observation>')
  .description('Add observation to existing entity')
  .action((entityName, observation) => manageEntities('add-observation', { entityName, observation }));

entityCmd
  .command('remove-observation <entityName> <observation>')
  .description('Remove observation from entity')
  .action((entityName, observation) => manageEntities('remove-observation', { entityName, observation }));

entityCmd
  .command('add-batch <file>')
  .description('Add multiple entities from JSON file')
  .option('--dry-run', 'Show what would be added without making changes')
  .action((file, options) => manageEntities('add-batch', { file, ...options }));

entityCmd
  .command('update-batch <file>')
  .description('Update multiple entities from JSON file')
  .option('--dry-run', 'Show what would be updated without making changes')
  .action((file, options) => manageEntities('update-batch', { file, ...options }));

// Relation commands
const relationCmd = program
  .command('relation')
  .description('Manage relations');

relationCmd
  .command('list')
  .description('List relations')
  .option('-f, --from <entity>', 'Filter by source entity')
  .option('-t, --to <entity>', 'Filter by target entity')
  .option('-r, --type <type>', 'Filter by relation type')
  .action(options => manageRelations('list', options));

relationCmd
  .command('add')
  .description('Add a new relation')
  .option('-f, --from <entity>', 'Source entity')
  .option('-t, --to <entity>', 'Target entity')
  .option('-r, --type <type>', 'Relation type')
  .option('-s, --significance <number>', 'Significance score (1-10)')
  .option('-i, --interactive', 'Interactive mode')
  .action(options => manageRelations('add', options));

relationCmd
  .command('remove')
  .description('Remove a relation')
  .option('-f, --from <entity>', 'Source entity')
  .option('-t, --to <entity>', 'Target entity')
  .option('-r, --type <type>', 'Relation type')
  .option('--by-id <id>', 'Remove relation by ID')
  .option('-i, --interactive', 'Interactive mode')
  .action(options => manageRelations('remove', options));

relationCmd
  .command('add-batch <file>')
  .description('Add multiple relations from JSON file')
  .option('--dry-run', 'Show what would be added without making changes')
  .action((file, options) => manageRelations('add-batch', { file, ...options }));

relationCmd
  .command('remove-batch <file>')
  .description('Remove multiple relations from JSON file')
  .option('--dry-run', 'Show what would be removed without making changes')
  .action((file, options) => manageRelations('remove-batch', { file, ...options }));

// Insight command
program
  .command('insight')
  .description('Process an insight')
  .option('-i, --interactive', 'Interactive mode')
  .action(processInsight);

// Import/Export commands
program
  .command('import <file>')
  .description('Import data from JSON file')
  .option('-m, --merge', 'Merge with existing data')
  .action(importData);

program
  .command('export <file>')
  .description('Export data to JSON file')
  .action(exportData);

// Git analysis commands
program
  .command('auto')
  .description('Auto-analyze recent git commits for insights')
  .option('-n, --num-commits <number>', 'Number of commits to analyze', '10')
  .option('-s, --significance <number>', 'Minimum significance threshold', '7')
  .action(autoAnalyze);

program
  .command('full-history')
  .description('Analyze complete git history')
  .option('-b, --branch <branch>', 'Branch to analyze', 'main')
  .option('-s, --significance <number>', 'Minimum significance threshold', '5')
  .action(fullHistoryAnalyze);

program
  .command('agent')
  .description('Interactive agent mode for deep analysis')
  .option('-c, --conversation', 'Include conversation analysis')
  .action(agentMode);

// Additional utility commands
program
  .command('validate')
  .description('Validate knowledge base integrity')
  .option('--fix', 'Attempt to fix validation errors')
  .action(validateKnowledgeBase);

program
  .command('stats')
  .description('Show detailed knowledge base statistics')
  .option('-v, --verbose', 'Show detailed breakdown')
  .action(showStatistics);

program
  .command('backup')
  .description('Create backup of knowledge base')
  .option('-p, --path <path>', 'Backup file path')
  .action(backupKnowledgeBase);

program
  .command('restore <backupFile>')
  .description('Restore knowledge base from backup')
  .option('--confirm', 'Skip confirmation prompt')
  .action(restoreKnowledgeBase);

// Interactive mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .option('--piped', 'Force piped input mode')
  .action(async (options) => {
    // Check if input is piped (non-TTY) or forced piped mode
    if (!process.stdin.isTTY || options.piped) {
      console.log(chalk.bold.cyan('🧠 Knowledge API Piped Input Mode'));
      console.log(chalk.gray('Processing piped input for entity creation...\n'));
      
      // Handle piped input for entity creation
      await handlePipedInput();
      return;
    }
    
    console.log(chalk.bold.cyan('🧠 Knowledge API Interactive Mode'));
    console.log(chalk.gray('Type "exit" to quit\n'));
    
    while (true) {
      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: '📊 View status', value: 'status' },
            { name: '📝 List entities', value: 'entity-list' },
            { name: '➕ Add entity', value: 'entity-add' },
            { name: '🔗 List relations', value: 'relation-list' },
            { name: '🔗 Add relation', value: 'relation-add' },
            { name: '💡 Process insight', value: 'insight' },
            { name: '🚪 Exit', value: 'exit' }
          ]
        }
      ]);
      
      if (answer.action === 'exit') {
        console.log(chalk.green('Goodbye!'));
        break;
      }
      
      try {
        switch (answer.action) {
          case 'status':
            await displayStatus();
            break;
          case 'entity-list':
            await manageEntities('list', { interactive: true });
            break;
          case 'entity-add':
            await manageEntities('add', { interactive: true });
            break;
          case 'relation-list':
            await manageRelations('list', { interactive: true });
            break;
          case 'relation-add':
            await manageRelations('add', { interactive: true });
            break;
          case 'insight':
            await processInsight({ interactive: true });
            break;
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
      }
      
      console.log(); // Add spacing
    }
  });

// Handle unknown commands
program
  .action(() => {
    console.error(chalk.red('Unknown command. Use --help for available commands.'));
    process.exit(1);
  });

// Error handling
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled error:'), error.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log(chalk.yellow('\nShutting down...'));
  if (api) {
    await api.close();
  }
  process.exit(0);
});

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}