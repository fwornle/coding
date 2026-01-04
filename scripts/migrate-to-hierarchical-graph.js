#!/usr/bin/env node
/**
 * Migration Script: Convert to Hierarchical Graph Structure
 *
 * Migrates the knowledge graph from star topology (all topics -> CollectiveKnowledge)
 * to hierarchical structure (CollectiveKnowledge -> Projects -> Topics).
 *
 * Changes:
 * 1. Removes ALL relations from topics TO CollectiveKnowledge (any type: contributes_to,
 *    related-to, contains, etc.) - except those from Project/System nodes
 * 2. Creates "includes" relations from CollectiveKnowledge to each Project node
 *
 * Usage:
 *   node scripts/migrate-to-hierarchical-graph.js [options]
 *
 * Options:
 *   --dry-run       Show what would be changed without making changes
 *   --team=<team>   Migrate only a specific team (default: all teams)
 *   --verbose       Show detailed output
 *   --help          Show this help message
 */

const VKB_BASE_URL = process.env.VKB_URL || 'http://localhost:8080';

async function fetchTeams() {
  const response = await fetch(`${VKB_BASE_URL}/api/teams`);
  const data = await response.json();
  return data.available.map(t => t.name);
}

async function fetchEntities(team) {
  const response = await fetch(`${VKB_BASE_URL}/api/entities?team=${team}&limit=1000`);
  const data = await response.json();
  return data.entities || [];
}

async function fetchRelations(team) {
  const response = await fetch(`${VKB_BASE_URL}/api/relations?team=${team}&limit=2000`);
  const data = await response.json();
  return data.relations || [];
}

async function deleteRelation(from, to, team, type = null, deleteAll = true) {
  const url = new URL(`${VKB_BASE_URL}/api/relations`);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('team', team);
  if (type) {
    url.searchParams.set('type', type);
  } else if (deleteAll) {
    // Delete ALL edges between entities regardless of type
    url.searchParams.set('all', 'true');
  }

  const response = await fetch(url.toString(), { method: 'DELETE' });
  return response.json();
}

async function createRelation(from, to, type, team) {
  const response = await fetch(`${VKB_BASE_URL}/api/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, type, team, confidence: 1.0 })
  });
  return response.json();
}

async function checkHealth() {
  try {
    const response = await fetch(`${VKB_BASE_URL}/api/health`);
    const data = await response.json();
    return data.status === 'healthy';
  } catch {
    return false;
  }
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    team: null,
    verbose: false,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg.startsWith('--team=')) {
      options.team = arg.split('=')[1];
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Migration Script: Convert to Hierarchical Graph Structure

Migrates from star topology to hierarchical structure:
  Before: Topics -> contributes_to -> CollectiveKnowledge
  After:  CollectiveKnowledge -> includes -> Projects -> Topics

Usage:
  node scripts/migrate-to-hierarchical-graph.js [options]

Options:
  --dry-run       Show what would be changed without making changes
  --team=<team>   Migrate only a specific team (default: all teams)
  --verbose       Show detailed output
  --help, -h      Show this help message

Environment:
  VKB_URL         Base URL for VKB server (default: http://localhost:8080)
`);
}

async function migrateTeam(team, options) {
  console.log(`\n  Processing team: ${team}`);

  const entities = await fetchEntities(team);
  const relations = await fetchRelations(team);

  // Find CollectiveKnowledge and Project nodes
  const collectiveKnowledge = entities.find(e =>
    e.entity_name === 'CollectiveKnowledge' || e.name === 'CollectiveKnowledge'
  );
  const projectNodes = entities.filter(e =>
    e.entity_type === 'Project' || e.entityType === 'Project'
  );

  if (!collectiveKnowledge) {
    console.log(`    No CollectiveKnowledge node found, skipping...`);
    return { removed: 0, created: 0 };
  }

  // Find ALL relations TO CollectiveKnowledge (except from Projects/System nodes)
  // These create the unwanted star topology and should be removed
  const projectAndSystemNames = new Set([
    'CollectiveKnowledge',
    ...projectNodes.map(p => p.entity_name || p.name)
  ]);

  const relationsToCollectiveKnowledge = relations.filter(r => {
    const fromName = r.from_name || r.from;
    const toName = r.to_name || r.to;
    // Remove any relation TO CollectiveKnowledge from non-infrastructure entities
    return toName === 'CollectiveKnowledge' && !projectAndSystemNames.has(fromName);
  });

  // Find existing includes relations from CollectiveKnowledge
  const existingIncludes = relations.filter(r => {
    const relType = r.relation_type || r.type || r.relationType;
    const fromName = r.from_name || r.from;
    return relType === 'includes' && fromName === 'CollectiveKnowledge';
  });

  const existingIncludesTo = new Set(existingIncludes.map(r => r.to_name || r.to));

  // Calculate what needs to be done
  const toRemove = relationsToCollectiveKnowledge;
  const toCreate = projectNodes.filter(p => {
    const name = p.entity_name || p.name;
    return !existingIncludesTo.has(name);
  });

  console.log(`    Found: ${relationsToCollectiveKnowledge.length} relations TO CollectiveKnowledge to remove`);
  console.log(`    Found: ${projectNodes.length} project nodes`);
  console.log(`    Need to create: ${toCreate.length} includes relations`);

  if (options.verbose) {
    if (toRemove.length > 0) {
      console.log(`    Relations to remove:`);
      toRemove.forEach(r => console.log(`      - ${r.from_name || r.from} -> ${r.to_name || r.to}`));
    }
    if (toCreate.length > 0) {
      console.log(`    Relations to create:`);
      toCreate.forEach(p => console.log(`      - CollectiveKnowledge -> includes -> ${p.entity_name || p.name}`));
    }
  }

  if (options.dryRun) {
    return { removed: toRemove.length, created: toCreate.length };
  }

  // Execute removals
  let removed = 0;
  for (const rel of toRemove) {
    try {
      const result = await deleteRelation(
        rel.from_name || rel.from,
        'CollectiveKnowledge',
        team,
        rel.relation_type || rel.type
      );
      if (result.success) {
        removed++;
        if (options.verbose) {
          console.log(`    [OK] Removed: ${rel.from_name || rel.from} -> CollectiveKnowledge`);
        }
      }
    } catch (error) {
      console.log(`    [FAIL] Remove ${rel.from_name || rel.from}: ${error.message}`);
    }
  }

  // Execute creations
  let created = 0;
  for (const project of toCreate) {
    try {
      const projectName = project.entity_name || project.name;
      const result = await createRelation('CollectiveKnowledge', projectName, 'includes', team);
      if (result.success) {
        created++;
        if (options.verbose) {
          console.log(`    [OK] Created: CollectiveKnowledge -> includes -> ${projectName}`);
        }
      }
    } catch (error) {
      console.log(`    [FAIL] Create includes -> ${project.entity_name || project.name}: ${error.message}`);
    }
  }

  return { removed, created };
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log(`\nMigrate to Hierarchical Graph Structure`);
  console.log(`========================================`);
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);

  // Check VKB health
  const healthy = await checkHealth();
  if (!healthy) {
    console.error('\nError: VKB server is not healthy or not running.');
    console.error('Start it with: vkb start');
    process.exit(1);
  }

  // Get teams to process
  let teams;
  if (options.team) {
    teams = [options.team];
  } else {
    teams = await fetchTeams();
  }

  console.log(`\nTeams to migrate: ${teams.join(', ')}`);

  // Process each team
  let totalRemoved = 0;
  let totalCreated = 0;

  for (const team of teams) {
    const result = await migrateTeam(team, options);
    totalRemoved += result.removed;
    totalCreated += result.created;
  }

  // Summary
  console.log(`\n========================================`);
  console.log(`Summary:`);
  console.log(`  Relations TO CollectiveKnowledge ${options.dryRun ? 'to remove' : 'removed'}: ${totalRemoved}`);
  console.log(`  includes relations ${options.dryRun ? 'to create' : 'created'}: ${totalCreated}`);

  if (options.dryRun) {
    console.log(`\nRun without --dry-run to apply changes.`);
  } else {
    console.log(`\nMigration complete. Graph is now hierarchical.`);
  }

  console.log('');
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
