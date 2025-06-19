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
const KnowledgeAPI = (await import('../lib/knowledge-api/index.js')).default;

// CLI Configuration
const CLI_VERSION = '1.0.0';
const program = new Command();

// Global API instance
let api = null;

/**
 * Initialize the Knowledge API
 */
async function initializeAPI(options = {}) {
  if (api) return api;
  
  try {
    api = new KnowledgeAPI(options);
    await api.initialize();
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
    console.log(chalk.cyan('Entities:'), status.stats.entities);
    console.log(chalk.cyan('Relations:'), status.stats.relations);
    console.log(chalk.cyan('Last Updated:'), status.storage.lastModified || 'Never');
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
    case 'update':
      await updateEntity(api, options);
      break;
    case 'search':
      await searchEntities(api, options);
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
    
    entityData = answers;
    if (answers.observation) {
      entityData.observations = [answers.observation];
    }
    
  } else {
    // Non-interactive mode
    entityData = {
      name: options.name,
      entityType: options.type || 'Other',
      significance: options.significance || 5,
      observations: options.observation ? [options.observation] : []
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
    
    await listEntities(api, { ...options, entities });
    
  } catch (error) {
    spinner.fail('Search failed');
    console.error(chalk.red('Error:'), error.message);
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

// CLI Command Setup
program
  .name('ukb-cli')
  .description('Knowledge API CLI - Agent-agnostic knowledge management')
  .version(CLI_VERSION);

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
  .command('search <query>')
  .description('Search entities')
  .option('-v, --verbose', 'Show detailed information')
  .action((query, options) => manageEntities('search', { ...options, query }));

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

// Interactive mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(async () => {
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