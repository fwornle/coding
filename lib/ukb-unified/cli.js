#!/usr/bin/env node
/**
 * UKB Unified CLI - One-stop knowledge base update command
 *
 * Default behavior: Smart incremental update
 * - Checks team checkpoint for last successful run
 * - Analyzes gap (new commits, sessions since last run)
 * - Runs comprehensive workflow for gap only
 * - Updates checkpoint and knowledge base
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { TeamCheckpointManager } from './core/TeamCheckpointManager.js';
import { GapAnalyzer } from './core/GapAnalyzer.js';
import { ConfigManager } from './core/ConfigManager.js';
import { WorkflowOrchestrator } from './core/WorkflowOrchestrator.js';
import { EntityCommand } from './commands/entity.js';
import { RelationCommand } from './commands/relation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get coding repo root
const CODING_REPO = process.env.CODING_REPO || path.join(__dirname, '..', '..');

// CLI version
const VERSION = '2.0.0';

/**
 * Main CLI class
 */
class UKBCli {
  constructor() {
    this.codingRepo = CODING_REPO;
    this.checkpointManager = new TeamCheckpointManager(this.codingRepo, { debug: false });
    this.gapAnalyzer = new GapAnalyzer(this.codingRepo, { debug: false });
    this.configManager = new ConfigManager(this.codingRepo, { debug: false });
    this.orchestrator = null; // Initialized lazily with config
  }

  /**
   * Parse command-line arguments
   */
  parseArgs(argv) {
    const args = {
      command: null,
      options: {},
      flags: {
        full: false,
        force: false,
        dryRun: false,
        verbose: false,
        help: false,
        version: false
      }
    };

    // Parse arguments
    for (let i = 2; i < argv.length; i++) {
      const arg = argv[i];

      if (arg === '--help' || arg === '-h') {
        args.flags.help = true;
      } else if (arg === '--version' || arg === '-v') {
        args.flags.version = true;
      } else if (arg === '--full') {
        args.flags.full = true;
      } else if (arg === '--force') {
        args.flags.force = true;
      } else if (arg === '--dry-run') {
        args.flags.dryRun = true;
      } else if (arg === '--verbose') {
        args.flags.verbose = true;
      } else if (arg === '--debug') {
        args.flags.debug = true;
      } else if (arg.startsWith('--')) {
        // Parse --key=value or --key value
        const [key, value] = arg.slice(2).split('=');
        if (value) {
          args.options[key] = value;
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          args.options[key] = argv[++i];
        } else {
          args.options[key] = true;
        }
      } else if (!args.command) {
        args.command = arg;
      }
    }

    return args;
  }

  /**
   * Show help message
   */
  showHelp() {
    console.log(`
UKB - Update Knowledge Base v${VERSION}
Smart incremental knowledge base updates via comprehensive semantic analysis

USAGE
  ukb [command] [options]

DEFAULT BEHAVIOR (no args)
  ukb
    > Check team checkpoint for last successful run
    > Analyze gap: new commits & sessions since last run
    > Run comprehensive workflow (10-agent semantic analysis)
    > Update knowledge base (GraphDB + JSON export)
    > Update checkpoint (.data/ukb-last-run.json)

COMMANDS
  (default)              Smart incremental update (recommended)
  analyze [workflow]     Run specific analysis workflow
  status                 Show knowledge base and checkpoint status
  checkpoint             Checkpoint management commands
  config                 Configuration management
  entity                 Entity operations (list, add, delete, search)
  relation               Relation operations (list, add, delete)
  search <query>         Search knowledge base
  validate               Validate knowledge base integrity
  help                   Show this help message

FLAGS
  --full                 Ignore checkpoint, run complete analysis
  --force                Force analysis even if no changes detected
  --dry-run              Show what would be analyzed without executing
  --verbose              Show detailed progress information
  --debug                Enable debug logging
  --help, -h             Show help message
  --version, -v          Show version

EXAMPLES
  # Daily workflow - just run ukb!
  ukb

  # Check status before running
  ukb status

  # Preview what will be analyzed
  ukb --dry-run

  # Force full re-analysis
  ukb --full

  # Run specific workflow
  ukb analyze pattern-extraction

  # Search knowledge base
  ukb search "authentication pattern"

  # Check checkpoint info
  ukb checkpoint status

CHECKPOINT
  Team-wide checkpoint stored in .data/ukb-last-run.json (git-tracked)
  Enables incremental analysis across entire team via git sync

For more info: docs/knowledge-management/ukb-update.md
`);
  }

  /**
   * Show version
   */
  showVersion() {
    console.log(`ukb version ${VERSION}`);
  }

  /**
   * Default command: Smart incremental update
   */
  async defaultCommand(options) {
    console.log('🔍 UKB - Update Knowledge Base\n');

    // Enable debug if requested
    if (options.debug) {
      this.checkpointManager.debug = true;
      this.gapAnalyzer.debug = true;
      this.configManager.debug = true;
    }

    // Load checkpoint
    const checkpoint = await this.checkpointManager.loadCheckpoint();

    // Check if this is first run
    if (!checkpoint.lastSuccessfulRun) {
      console.log('📍 No previous checkpoint found');
      console.log('   This appears to be the first run.');
      console.log('   A full analysis should be performed.');
      console.log('\n💡 Recommendation: Use `ukb --full` for first-time setup\n');
      return;
    }

    // Get gap summary
    const summary = await this.gapAnalyzer.getGapSummary(checkpoint);

    if (!summary.hasGap) {
      console.log('✓ Knowledge base is up to date');
      console.log(`  Last run: ${summary.sinceLastRun}`);
      console.log('\n💡 No new commits or sessions to analyze\n');
      return;
    }

    // Show what will be analyzed
    console.log(`📊 Analysis scope since last run (${summary.sinceLastRun}):`);
    console.log(`   Commits:  ${summary.commits.count} new ${summary.commits.count > 0 ? `(${summary.commits.first}...${summary.commits.last})` : ''}`);
    console.log(`   Sessions: ${summary.sessions.count} new (${summary.sessions.local} local, ${summary.sessions.redirected} redirected)`);

    // Dry run mode
    if (options.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
      console.log('Would execute:');
      console.log('  1. GitHistoryAgent → Analyze new commits');
      console.log('  2. VibeHistoryAgent → Analyze new session logs');
      console.log('  3. SemanticAnalysisAgent → Extract insights');
      console.log('  4. InsightGenerationAgent → Generate documentation');
      console.log('  5. DeduplicationAgent → Merge with existing knowledge');
      console.log('  6. PersistenceAgent → Save to GraphDB');
      console.log('  7. Update checkpoint and JSON export\n');
      return;
    }

    // Execute incremental workflow
    console.log('\n⚙️  Running incremental workflow...\n');

    try {
      // Initialize orchestrator with config
      const config = await this.configManager.loadConfig();
      if (!this.orchestrator) {
        this.orchestrator = new WorkflowOrchestrator(config, { debug: options.debug });
      }

      // Generate full scope with coding repo
      const scope = await this.gapAnalyzer.generateIncrementalScope(checkpoint);
      scope.codingRepo = this.codingRepo;

      // Execute workflow
      const startTime = Date.now();
      const result = await this.orchestrator.executeIncrementalWorkflow(scope, {
        verbose: options.verbose
      });

      const duration = Date.now() - startTime;

      // Check if workflow succeeded
      if (!result.success) {
        console.error('\n❌ Workflow failed');
        console.error(`   ${result.error || 'Unknown error'}\n`);
        return;
      }

      // Show results
      console.log('✓ Workflow completed successfully\n');
      console.log('Results:');
      console.log(`  Entities created:    ${result.stats.entitiesCreated}`);
      console.log(`  Relations created:   ${result.stats.relationsCreated}`);
      console.log(`  Insights generated:  ${result.stats.insightsGenerated}`);
      console.log(`  Commits analyzed:    ${result.stats.commitsAnalyzed}`);
      console.log(`  Sessions analyzed:   ${result.stats.sessionsAnalyzed}`);
      console.log(`  Duration:            ${Math.floor(duration / 1000)}s`);

      // Update checkpoint
      console.log('\n📝 Updating checkpoint...');
      await this.checkpointManager.updateAfterSuccessfulRun({
        lastCommit: result.lastCommit,
        lastSession: result.lastSession,
        entitiesCreated: result.stats.entitiesCreated,
        relationsCreated: result.stats.relationsCreated,
        insightsGenerated: result.stats.insightsGenerated,
        commitsAnalyzed: result.stats.commitsAnalyzed,
        sessionsAnalyzed: result.stats.sessionsAnalyzed,
        duration: duration,
        workflowType: result.workflowType
      });

      console.log('✓ Checkpoint updated\n');

      // Check if we should remind about committing
      const autoCommit = await this.configManager.isAutoCommitEnabled();
      if (!autoCommit) {
        console.log('💡 Remember to commit updated checkpoint and knowledge base:');
        console.log('   git add .data/ukb-last-run.json .data/shared-memory-*.json');
        console.log('   git commit -m "chore: update knowledge base [ukb]"\n');
      }

      // Show mock warning if applicable
      if (result.details?.mock) {
        console.log('⚠️  Note: This was a MOCK run (MCP semantic-analysis not available)');
        console.log('   To use actual semantic analysis, run ukb within Claude Code');
        console.log('   with mcp-server-semantic-analysis configured.\n');
      }

    } catch (error) {
      console.error(`\n❌ Error executing workflow: ${error.message}`);
      if (options.debug) {
        console.error(error.stack);
      }
      console.error('');
    }
  }

  /**
   * Status command
   */
  async statusCommand(options) {
    console.log('📊 UKB Status\n');

    // Checkpoint status
    const checkpointStatus = await this.checkpointManager.getStatus();

    console.log('Checkpoint:');
    if (checkpointStatus.initialized) {
      console.log(`  Last run:     ${checkpointStatus.lastRun}`);
      console.log(`  Time ago:     ${checkpointStatus.timeSinceLastRun.humanReadable}`);
      console.log(`  Last commit:  ${checkpointStatus.lastCommit || 'N/A'}`);
      console.log(`  Last session: ${checkpointStatus.lastSession || 'N/A'}`);
      if (checkpointStatus.lastRunStats) {
        console.log('\n  Last Run Stats:');
        console.log(`    Entities:    +${checkpointStatus.lastRunStats.entitiesCreated}`);
        console.log(`    Relations:   +${checkpointStatus.lastRunStats.relationsCreated}`);
        console.log(`    Insights:    +${checkpointStatus.lastRunStats.insightsGenerated}`);
        console.log(`    Commits:     ${checkpointStatus.lastRunStats.commitsAnalyzed}`);
        console.log(`    Sessions:    ${checkpointStatus.lastRunStats.sessionsAnalyzed}`);
        console.log(`    Duration:    ${Math.floor(checkpointStatus.lastRunStats.duration / 1000)}s`);
      }
    } else {
      console.log(`  Status: ${checkpointStatus.message}`);
    }

    // Gap analysis
    if (checkpointStatus.initialized) {
      const checkpoint = await this.checkpointManager.loadCheckpoint();
      const summary = await this.gapAnalyzer.getGapSummary(checkpoint);

      console.log('\nPending Analysis:');
      if (summary.hasGap) {
        console.log(`  New commits:  ${summary.commits.count}`);
        console.log(`  New sessions: ${summary.sessions.count}`);
        console.log(`  Status:       Updates available`);
      } else {
        console.log(`  Status:       Up to date ✓`);
      }
    }

    // Configuration
    const config = await this.configManager.loadConfig();
    console.log('\nConfiguration:');
    console.log(`  Default:      ${config.defaultBehavior} mode`);
    console.log(`  Team:         ${config.team}`);
    console.log(`  Auto-commit:  ${config.autoCommitCheckpoint ? 'enabled' : 'disabled'}`);

    console.log('');
  }

  /**
   * Checkpoint command
   */
  async checkpointCommand(subcommand, options) {
    if (subcommand === 'status') {
      await this.statusCommand(options);
    } else if (subcommand === 'reset') {
      console.log('⚠️  Resetting checkpoint...');
      await this.checkpointManager.resetCheckpoint();
      console.log('✓ Checkpoint reset - next run will be full analysis\n');
    } else {
      console.log('Unknown checkpoint subcommand. Use: status, reset');
    }
  }

  /**
   * Entity command
   */
  async entityCommand(subcommand, argv, options) {
    const config = await this.configManager.loadConfig();
    const entityCmd = new EntityCommand(this.codingRepo, config);

    try {
      if (subcommand === 'list') {
        const entities = await entityCmd.list(options);
        console.log(`\n📦 Entities (${entities.length} total):\n`);
        if (entities.length === 0) {
          console.log('  (no entities found)\n');
        } else {
          for (const entity of entities) {
            console.log(`  ${entity.name}`);
            console.log(`    Type: ${entity.type}`);
            console.log(`    Observations: ${entity.observations}`);
            console.log(`    Modified: ${entity.modified}\n`);
          }
        }
      } else if (subcommand === 'show') {
        const name = argv[4];
        if (!name) {
          console.log('Usage: ukb entity show <name>');
          return;
        }
        const entity = await entityCmd.show(name, options);
        console.log(`\n📦 Entity: ${entity.name}\n`);
        console.log(`  Type:        ${entity.entityType}`);
        console.log(`  Confidence:  ${entity.confidence}`);
        console.log(`  Source:      ${entity.source}`);
        console.log(`  Created:     ${entity.created_at}`);
        console.log(`  Modified:    ${entity.last_modified}`);
        if (entity.observations && entity.observations.length > 0) {
          console.log(`\n  Observations (${entity.observations.length}):`);
          entity.observations.forEach((obs, i) => {
            console.log(`    ${i + 1}. ${obs}`);
          });
        }
        console.log('');
      } else if (subcommand === 'delete') {
        const name = argv[4];
        if (!name) {
          console.log('Usage: ukb entity delete <name>');
          return;
        }
        const result = await entityCmd.delete(name, options);
        console.log(`\n✓ Entity deleted: ${result.deleted}\n`);
      } else if (subcommand === 'search') {
        const query = argv[4];
        if (!query) {
          console.log('Usage: ukb entity search <query>');
          return;
        }
        const results = await entityCmd.search(query, options);
        console.log(`\n🔍 Search results (${results.length} found):\n`);
        if (results.length === 0) {
          console.log('  (no matches)\n');
        } else {
          for (const result of results) {
            console.log(`  ${result.name} (${result.type})`);
            console.log(`    Observations: ${result.observations}\n`);
          }
        }
      } else {
        console.log('Unknown entity subcommand. Use: list, show, delete, search');
      }
    } finally {
      await entityCmd.close();
    }
  }

  /**
   * Relation command
   */
  async relationCommand(subcommand, argv, options) {
    const config = await this.configManager.loadConfig();
    const relationCmd = new RelationCommand(this.codingRepo, config);

    try {
      if (subcommand === 'list') {
        const relations = await relationCmd.list(options);
        console.log(`\n🔗 Relations (${relations.length} total):\n`);
        if (relations.length === 0) {
          console.log('  (no relations found)\n');
        } else {
          for (const rel of relations) {
            console.log(`  ${rel.from} --[${rel.type}]--> ${rel.to}`);
            console.log(`    Confidence: ${rel.confidence}`);
            console.log(`    Created: ${rel.created}\n`);
          }
        }
      } else if (subcommand === 'show') {
        const from = argv[4];
        const to = argv[5];
        if (!from || !to) {
          console.log('Usage: ukb relation show <from> <to>');
          return;
        }
        const relations = await relationCmd.show(from, to, options);
        console.log(`\n🔗 Relations from ${from} to ${to} (${relations.length}):\n`);
        for (const rel of relations) {
          console.log(`  Type:       ${rel.type}`);
          console.log(`  Confidence: ${rel.confidence}`);
          console.log(`  Created:    ${rel.created}\n`);
        }
      } else if (subcommand === 'delete') {
        const from = argv[4];
        const to = argv[5];
        if (!from || !to) {
          console.log('Usage: ukb relation delete <from> <to> [--type=TYPE] [--all]');
          return;
        }
        const result = await relationCmd.delete(from, to, options);
        console.log(`\n✓ Deleted ${result.deleted} relation(s) from ${from} to ${to}\n`);
      } else if (subcommand === 'find-related') {
        const entity = argv[4];
        if (!entity) {
          console.log('Usage: ukb relation find-related <entity> [--depth=N]');
          return;
        }
        const results = await relationCmd.findRelated(entity, options);
        console.log(`\n🔍 Related entities to ${entity} (${results.length} found):\n`);
        if (results.length === 0) {
          console.log('  (no related entities)\n');
        } else {
          for (const result of results) {
            console.log(`  ${result.entity.name} (${result.entity.entityType})`);
            console.log(`    Depth: ${result.depth}`);
            console.log(`    Via: ${result.relationshipType || 'N/A'}\n`);
          }
        }
      } else {
        console.log('Unknown relation subcommand. Use: list, show, delete, find-related');
      }
    } finally {
      await relationCmd.close();
    }
  }

  /**
   * Run CLI
   */
  async run(argv = process.argv) {
    const args = this.parseArgs(argv);

    try {
      // Handle flags
      if (args.flags.help) {
        this.showHelp();
        return;
      }

      if (args.flags.version) {
        this.showVersion();
        return;
      }

      // Handle commands
      if (!args.command) {
        // Default: incremental update
        await this.defaultCommand({
          full: args.flags.full,
          force: args.flags.force,
          dryRun: args.flags.dryRun,
          verbose: args.flags.verbose,
          debug: args.flags.debug
        });
      } else if (args.command === 'status') {
        await this.statusCommand(args.options);
      } else if (args.command === 'checkpoint') {
        const subcommand = args.options._ || argv[3];
        await this.checkpointCommand(subcommand, args.options);
      } else if (args.command === 'entity') {
        const subcommand = argv[3];
        await this.entityCommand(subcommand, argv, args.options);
      } else if (args.command === 'relation') {
        const subcommand = argv[3];
        await this.relationCommand(subcommand, argv, args.options);
      } else if (args.command === 'help') {
        this.showHelp();
      } else {
        console.log(`Unknown command: ${args.command}`);
        console.log('Use `ukb --help` for usage information\n');
      }

    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);
      if (args.flags.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }
}

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new UKBCli();
  cli.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default UKBCli;
