/**
 * Index Ontology Content to Qdrant
 *
 * Creates team-specific Qdrant collections and indexes ontology entity definitions
 * for Layer 3 semantic embedding classification.
 *
 * Collections created: ontology-coding, ontology-raas, ontology-resi, ontology-agentic, ontology-ui
 *
 * Usage: node scripts/index-ontology-to-qdrant.js
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { EmbeddingGenerator } from '../src/knowledge-management/EmbeddingGenerator.js';
import fs from 'fs/promises';
import path from 'path';

const QDRANT_HOST = process.env.QDRANT_HOST || 'localhost';
const QDRANT_PORT = parseInt(process.env.QDRANT_PORT || '6333');
const VECTOR_SIZE = 384; // Using local 384-dim embeddings (Transformers.js)

/**
 * Parse TypeScript heuristics file to extract entity definitions
 */
async function parseHeuristicsFile(team) {
  const filePath = path.join(
    process.cwd(),
    'src/ontology/heuristics',
    `${team.toLowerCase()}-heuristics.ts`
  );

  const content = await fs.readFile(filePath, 'utf-8');

  // Extract entity definitions using regex
  const entityClasses = [];
  const entityClassPattern = /{\s*entityClass:\s*'([^']+)',\s*description:\s*'([^']+)',\s*patterns:\s*\[([\s\S]*?)\],?\s*(?:minConfidence[^}]*)?\},?/g;

  let match;
  while ((match = entityClassPattern.exec(content)) !== null) {
    const [, entityClass, description, patternsBlock] = match;

    // Extract keywords from patterns block
    const keywords = new Set();
    const requiredKeywords = new Set();

    const keywordsPattern = /keywords:\s*\[([\s\S]*?)\]/g;
    const requiredPattern = /requiredKeywords:\s*\[([\s\S]*?)\]/g;

    let keywordsMatch;
    while ((keywordsMatch = keywordsPattern.exec(patternsBlock)) !== null) {
      const kwList = keywordsMatch[1];
      const kwItems = kwList.match(/'([^']+)'/g) || [];
      kwItems.forEach((kw) => keywords.add(kw.replace(/'/g, '')));
    }

    let requiredMatch;
    while ((requiredMatch = requiredPattern.exec(patternsBlock)) !== null) {
      const reqList = requiredMatch[1];
      const reqItems = reqList.match(/'([^']+)'/g) || [];
      reqItems.forEach((kw) => requiredKeywords.add(kw.replace(/'/g, '')));
    }

    entityClasses.push({
      entityClass,
      description,
      keywords: Array.from(keywords),
      requiredKeywords: Array.from(requiredKeywords),
    });
  }

  return entityClasses;
}

/**
 * Main indexing function
 */
async function indexOntologyToQdrant() {
  console.log('=== Ontology Indexing to Qdrant ===\n');

  // Initialize Qdrant client
  const qdrant = new QdrantClient({
    url: `http://${QDRANT_HOST}:${QDRANT_PORT}`,
  });

  // Check Qdrant availability
  try {
    await qdrant.getCollections();
    console.log(`✓ Connected to Qdrant at ${QDRANT_HOST}:${QDRANT_PORT}\n`);
  } catch (error) {
    console.error('✗ Failed to connect to Qdrant:', error.message);
    console.error('  Make sure Qdrant is running: docker-compose up -d qdrant');
    process.exit(1);
  }

  // Initialize embedding generator
  const embeddingGenerator = new EmbeddingGenerator({
    local: { enabled: true },
    remote: { enabled: false }, // Use local only for speed
  });

  console.log('Initializing embedding generator...');
  await embeddingGenerator.initialize();
  console.log('✓ Embedding generator ready\n');

  // Teams to process
  const teams = ['Coding', 'RaaS', 'ReSi', 'Agentic', 'UI'];

  // Process each team
  for (const team of teams) {
    console.log(`\n=== Processing ${team} Team ===`);

    const collectionName = `ontology-${team.toLowerCase()}`;

    try {
      // Parse heuristics file
      console.log(`  Parsing ${team.toLowerCase()}-heuristics.ts...`);
      const entityClasses = await parseHeuristicsFile(team);
      console.log(`  Found ${entityClasses.length} entity classes`);

      if (entityClasses.length === 0) {
        console.log(`  ⚠ No entities found, skipping ${team}`);
        continue;
      }

      // Create or recreate collection
      await createCollection(qdrant, collectionName);

      // Index entity definitions
      const points = await buildOntologyPoints(
        entityClasses,
        team,
        embeddingGenerator
      );

      console.log(`  Indexing ${points.length} entity definitions...`);
      if (points.length > 0) {
        await qdrant.upsert(collectionName, {
          wait: true,
          points,
        });
        console.log(`  ✓ Indexed ${points.length} entities to ${collectionName}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to index ${team}:`, error.message);
      console.error(error.stack);
    }
  }

  // Print summary
  console.log('\n=== Indexing Summary ===');
  const collections = await qdrant.getCollections();
  const ontologyCollections = collections.collections.filter((c) =>
    c.name.startsWith('ontology-')
  );

  for (const collection of ontologyCollections) {
    const info = await qdrant.getCollection(collection.name);
    console.log(
      `  ${collection.name}: ${info.points_count} entities indexed`
    );
  }

  console.log('\n✓ Ontology indexing complete!');
  console.log(
    '\nLayer 3 (SemanticEmbeddingClassifier) is now ready to use.\n'
  );
}

/**
 * Create or recreate a Qdrant collection
 */
async function createCollection(qdrant, collectionName) {
  try {
    // Check if collection exists
    await qdrant.getCollection(collectionName);
    console.log(`  Collection ${collectionName} exists, recreating...`);

    // Delete existing collection
    await qdrant.deleteCollection(collectionName);
  } catch (error) {
    console.log(`  Creating new collection ${collectionName}...`);
  }

  // Create collection
  await qdrant.createCollection(collectionName, {
    vectors: {
      size: VECTOR_SIZE,
      distance: 'Cosine',
    },
  });

  console.log(`  ✓ Collection ${collectionName} ready`);
}

/**
 * Build Qdrant points from parsed entity classes
 */
async function buildOntologyPoints(entityClasses, team, embeddingGenerator) {
  const points = [];
  let pointId = 1;

  for (const entityDef of entityClasses) {
    const { entityClass, description, keywords, requiredKeywords } = entityDef;

    // Build content for embedding
    const content = buildEntityContent(
      entityClass,
      description,
      keywords,
      requiredKeywords,
      team
    );

    // Generate embedding
    console.log(`    Generating embedding for ${entityClass}...`);
    const embedding = await embeddingGenerator.generate(content, {
      vectorSize: VECTOR_SIZE,
    });

    // Create point
    points.push({
      id: pointId++,
      vector: embedding,
      payload: {
        entityClass,
        description,
        team,
        keywords,
        requiredKeywords,
        content, // Store for reference
      },
    });
  }

  return points;
}

/**
 * Build rich content for embedding generation
 */
function buildEntityContent(
  entityClass,
  description,
  keywords,
  requiredKeywords,
  team
) {
  const parts = [];

  // Entity class and team
  parts.push(`${team} Team: ${entityClass}`);

  // Description
  parts.push(description);

  // Required keywords (high importance)
  if (requiredKeywords.length > 0) {
    parts.push(
      `Core concepts: ${requiredKeywords.join(', ')}`
    );
  }

  // All keywords
  parts.push(
    `Related terms: ${keywords.slice(0, 15).join(', ')}${keywords.length > 15 ? '...' : ''}`
  );

  return parts.join('. ');
}

/**
 * Verify indexing by testing a query
 */
async function verifyIndexing() {
  const qdrant = new QdrantClient({
    url: `http://${QDRANT_HOST}:${QDRANT_PORT}`,
  });

  const embeddingGenerator = new EmbeddingGenerator({
    local: { enabled: true },
    remote: { enabled: false },
  });

  await embeddingGenerator.initialize();

  console.log('\n=== Verification Test ===');
  console.log('Testing query: "live session logging and classification"');

  const queryEmbedding = await embeddingGenerator.generate(
    'live session logging and classification',
    { vectorSize: VECTOR_SIZE }
  );

  const results = await qdrant.search('ontology-coding', {
    vector: queryEmbedding,
    limit: 3,
    score_threshold: 0.5,
  });

  console.log(`\nTop 3 results from ontology-coding:`);
  results.forEach((result, idx) => {
    console.log(
      `  ${idx + 1}. ${result.payload.entityClass} (${result.score.toFixed(3)})`
    );
    console.log(`     ${result.payload.description}`);
  });
}

// Run indexing
indexOntologyToQdrant()
  .then(() => verifyIndexing())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nIndexing failed:', error);
    process.exit(1);
  });
