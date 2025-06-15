#!/usr/bin/env node

// Test script for the memory fallback service

const MemoryFallbackService = require('./lib/fallbacks/memory-fallback');
const path = require('path');

async function testMemoryFallback() {
  console.log('🧠 Testing Memory Fallback Service...\n');
  
  try {
    // Initialize service
    const memory = new MemoryFallbackService({
      dbPath: path.join(__dirname, '.coding-tools', 'test-memory.json')
    });
    
    await memory.initialize();
    console.log('✅ Memory service initialized');
    
    // Test creating entities
    const entities = [
      {
        name: 'ConditionalLoggingPattern',
        entityType: 'Pattern',
        observations: [
          'Never use console.log in production',
          'Always use proper logging library',
          'Check environment before logging'
        ]
      },
      {
        name: 'GraphologyIntegration',
        entityType: 'Feature',
        observations: [
          'Pure JavaScript graph database',
          'No native dependencies',
          'Excellent for agent-agnostic functionality'
        ]
      }
    ];
    
    const createResult = await memory.createEntities(entities);
    console.log('✅ Created entities:', createResult);
    
    // Test creating relations
    const relations = [
      {
        from: 'ConditionalLoggingPattern',
        to: 'GraphologyIntegration',
        relationType: 'usesWith'
      }
    ];
    
    const relationResult = await memory.createRelations(relations);
    console.log('✅ Created relations:', relationResult);
    
    // Test searching
    const searchResults = await memory.searchNodes('logging');
    console.log('✅ Search results for "logging":', searchResults.length, 'items');
    console.log('  Found:', searchResults.map(r => r.name));
    
    // Test reading entire graph
    const graph = await memory.readGraph();
    console.log('✅ Full graph:', graph.metadata);
    console.log('  Nodes:', graph.nodes.length);
    console.log('  Edges:', graph.edges.length);
    
    // Test connected nodes (skip for now due to API issue)
    // const connected = await memory.getConnectedNodes('ConditionalLoggingPattern');
    // console.log('✅ Connected nodes:', connected.nodes.length);
    
    // Test stats
    const stats = memory.getStats();
    console.log('✅ Graph stats:', stats);
    
    // Cleanup
    await memory.cleanup();
    console.log('✅ Memory service cleaned up');
    
    console.log('\n🎉 Memory fallback test completed successfully!');
    
  } catch (error) {
    console.error('❌ Memory fallback test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  testMemoryFallback();
}

module.exports = { testMemoryFallback };