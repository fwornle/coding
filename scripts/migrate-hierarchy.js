#!/usr/bin/env node
/**
 * Hierarchy Migration Script (Phase 5)
 *
 * Creates scaffold nodes and classifies existing entities into the
 * L0 → L1 → L2 hierarchy defined in component-manifest.yaml.
 *
 * Usage:
 *   node scripts/migrate-hierarchy.js [--dry-run] [--team=coding]
 */

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VKB = process.env.VKB_URL || 'http://localhost:8080';
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TEAM = (args.find(a => a.startsWith('--team=')) || '--team=coding').split('=')[1];
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

// Load manifest
const manifestPath = join(__dirname, '..', 'integrations', 'mcp-server-semantic-analysis', 'config', 'component-manifest.yaml');
const manifest = parse(readFileSync(manifestPath, 'utf8'));

// API helpers
async function apiGet(path) {
  const res = await fetch(`${VKB}${path}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${VKB}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${VKB}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${VKB}${path}`, { method: 'DELETE' });
  return res.json();
}

// Build classification rules from manifest
function buildClassifier(manifest) {
  const rules = [];
  for (const comp of manifest.components) {
    // L2 children first (more specific match wins)
    if (comp.children) {
      for (const child of comp.children) {
        rules.push({
          name: child.name,
          parent: comp.name,
          level: 2,
          keywords: child.keywords || [],
          aliases: child.aliases || [],
          description: child.description
        });
      }
    }
    rules.push({
      name: comp.name,
      parent: manifest.project.name,
      level: 1,
      keywords: comp.keywords || [],
      aliases: comp.aliases || [],
      description: comp.description
    });
  }
  return rules;
}

function classifyEntity(entityName, observations, rules) {
  const text = [
    entityName,
    ...(observations || []).map(o => typeof o === 'string' ? o : o.content || '')
  ].join(' ').toLowerCase();

  let bestMatch = null;
  let bestScore = 0;

  for (const rule of rules) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) score += 1;
    }
    for (const alias of rule.aliases) {
      if (text.includes(alias.toLowerCase())) score += 2;
    }
    if (entityName.toLowerCase().includes(rule.name.toLowerCase())) score += 5;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  if (!bestMatch || bestScore < 1) {
    bestMatch = rules.find(r => r.name === 'CodingPatterns');
  }
  return bestMatch;
}

// Main
async function main() {
  log(`\n=== Hierarchy Migration ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const rules = buildClassifier(manifest);
  log(`Loaded ${rules.length} classification rules from manifest\n`);

  const data = await apiGet(`/api/entities?team=${TEAM}&limit=500`);
  const entities = data.entities || data;
  log(`Found ${entities.length} existing entities\n`);

  const existingNames = new Set(entities.map(e => e.entity_name));

  // Step 1: Create scaffold nodes
  log('-- Step 1: Create scaffold nodes --\n');

  const scaffoldNodes = [];
  for (const comp of manifest.components) {
    scaffoldNodes.push({
      name: comp.name,
      level: 1,
      parent: manifest.project.name,
      description: comp.description,
      children: (comp.children || []).map(c => c.name)
    });
    if (comp.children) {
      for (const child of comp.children) {
        scaffoldNodes.push({
          name: child.name,
          level: 2,
          parent: comp.name,
          description: child.description,
          children: []
        });
      }
    }
  }

  for (const node of scaffoldNodes) {
    const action = existingNames.has(node.name) ? 'UPDATE' : 'CREATE';
    log(`  ${action} L${node.level} ${node.name} (parent: ${node.parent})`);

    if (!DRY_RUN) {
      const body = {
        name: node.name,
        entityType: node.level === 1 ? 'Component' : 'SubComponent',
        observations: [node.description],
        significance: 8,
        team: TEAM,
        parentEntityName: node.parent,
        hierarchyLevel: node.level,
        isScaffoldNode: true,
        childEntityNames: node.children
      };

      if (action === 'CREATE') {
        await apiPost('/api/entities', body);
      } else {
        await apiPut(`/api/entities/${encodeURIComponent(node.name)}?team=${TEAM}`, body);
      }
    }
  }

  // Update Coding project node
  log(`  UPDATE L0 ${manifest.project.name} (root)`);
  if (!DRY_RUN) {
    const codingEntity = entities.find(e => e.entity_name === 'Coding');
    await apiPut(`/api/entities/Coding?team=${TEAM}`, {
      entityType: 'Project',
      observations: codingEntity?.observations || [manifest.project.description],
      significance: 10,
      team: TEAM,
      parentEntityName: 'CollectiveKnowledge',
      hierarchyLevel: 0,
      isScaffoldNode: true,
      childEntityNames: manifest.components.map(c => c.name)
    });
  }

  log(`\n  Created/updated ${scaffoldNodes.length + 1} scaffold nodes\n`);

  // Step 2: Classify leaf entities
  log('-- Step 2: Classify leaf entities --\n');

  const classifications = {};
  const scaffoldNames = new Set(scaffoldNodes.map(n => n.name));
  scaffoldNames.add('Coding');
  scaffoldNames.add('CollectiveKnowledge');

  for (const entity of entities) {
    const name = entity.entity_name;
    if (scaffoldNames.has(name)) continue;

    const match = classifyEntity(name, entity.observations, rules);
    if (match) {
      classifications[name] = match;
      log(`  ${name} -> ${match.name} (L${match.level})`);
    }
  }

  // Step 3: Apply hierarchy fields
  log('\n-- Step 3: Apply hierarchy fields --\n');

  for (const [entityName, match] of Object.entries(classifications)) {
    const entity = entities.find(e => e.entity_name === entityName);
    if (!entity) continue;

    log(`  ${entityName}: parent=${match.name}, level=${match.level + 1}`);

    if (!DRY_RUN) {
      await apiPut(`/api/entities/${encodeURIComponent(entityName)}?team=${TEAM}`, {
        entityType: entity.entity_type,
        observations: entity.observations,
        team: TEAM,
        parentEntityName: match.name,
        hierarchyLevel: match.level + 1,
        isScaffoldNode: false,
        childEntityNames: []
      });
    }
  }

  // Step 4: Rewire relations
  log('\n-- Step 4: Rewire relations --\n');

  const relData = await apiGet(`/api/relations?team=${TEAM}`);
  const relations = relData.relations || relData;
  const flatContains = relations.filter(r =>
    (r.from_name === 'Coding' || r.from === 'Coding') &&
    (r.relation_type === 'contains' || r.relationType === 'contains')
  );
  log(`  Found ${flatContains.length} flat Coding->entity 'contains' edges to rewire`);

  for (const rel of flatContains) {
    const target = rel.to_name || rel.to;
    const match = classifications[target];
    if (!match) continue;

    if (!DRY_RUN) {
      await apiDelete(`/api/relations?from=Coding&to=${encodeURIComponent(target)}&team=${TEAM}&type=contains`);
    }
  }

  // Create new hierarchical contains edges
  const parentChildren = {};
  for (const [entityName, match] of Object.entries(classifications)) {
    if (!parentChildren[match.name]) parentChildren[match.name] = [];
    parentChildren[match.name].push(entityName);
  }

  for (const node of scaffoldNodes) {
    for (const childName of node.children) {
      if (!parentChildren[node.name]) parentChildren[node.name] = [];
      if (!parentChildren[node.name].includes(childName)) {
        parentChildren[node.name].push(childName);
      }
    }
  }

  for (const comp of manifest.components) {
    if (!parentChildren[manifest.project.name]) parentChildren[manifest.project.name] = [];
    if (!parentChildren[manifest.project.name].includes(comp.name)) {
      parentChildren[manifest.project.name].push(comp.name);
    }
  }

  let edgesCreated = 0;
  for (const [parent, children] of Object.entries(parentChildren)) {
    for (const child of children) {
      log(`  ${parent} -> contains -> ${child}`);
      if (!DRY_RUN) {
        await apiPost('/api/relations', { from: parent, to: child, type: 'contains', team: TEAM });
        edgesCreated++;
      }
    }
  }

  // Update childEntityNames on scaffold nodes
  if (!DRY_RUN) {
    for (const node of scaffoldNodes) {
      const allChildren = parentChildren[node.name] || [];
      if (allChildren.length > 0) {
        const refreshed = (await apiGet(`/api/entities?team=${TEAM}&limit=500`)).entities;
        const entity = refreshed.find(e => e.entity_name === node.name);
        if (entity) {
          await apiPut(`/api/entities/${encodeURIComponent(node.name)}?team=${TEAM}`, {
            entityType: entity.entity_type,
            observations: entity.observations,
            team: TEAM,
            parentEntityName: node.parent,
            hierarchyLevel: node.level,
            isScaffoldNode: true,
            childEntityNames: allChildren
          });
        }
      }
    }
  }

  log(`\n  Created ${edgesCreated} hierarchical 'contains' edges`);

  log('\n=== Migration Summary ===\n');
  log(`  Scaffold nodes: ${scaffoldNodes.length + 1}`);
  log(`  Classified entities: ${Object.keys(classifications).length}`);
  log(`  New contains edges: ${edgesCreated}`);
  log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes made)' : 'LIVE'}`);
  log('');
}

main().catch(err => {
  process.stderr.write('Migration failed: ' + err.message + '\n');
  process.exit(1);
});
