#!/usr/bin/env node

// Simple test script to verify agent detection works

const AgentDetector = require('./lib/agent-detector');

async function testAgentDetection() {
  console.log('🔍 Testing Agent Detection...\n');
  
  try {
    const detector = new AgentDetector();
    
    // Test individual detections
    console.log('Checking individual agents:');
    const claudeDetected = await detector.detectClaude();
    console.log(`  Claude Code: ${claudeDetected ? '✅ Found' : '❌ Not found'}`);
    
    const copilotDetected = await detector.detectCoPilot();
    console.log(`  GitHub CoPilot: ${copilotDetected ? '✅ Found' : '❌ Not found'}`);
    
    const specstoryDetected = await detector.detectSpecstoryExtension();
    console.log(`  Specstory Extension: ${specstoryDetected ? '✅ Found' : '❌ Not found'}`);
    
    // Test overall detection
    console.log('\nOverall detection:');
    const allResults = await detector.detectAll();
    console.log('  Results:', allResults);
    
    const bestAgent = await detector.getBest();
    console.log(`  Best agent: ${bestAgent || 'None'}`);
    
    if (bestAgent) {
      const capabilities = detector.getCapabilities(bestAgent);
      console.log(`  Capabilities: ${capabilities.join(', ')}`);
    }
    
    console.log('\n✅ Agent detection test completed');
    
  } catch (error) {
    console.error('❌ Agent detection test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  testAgentDetection();
}

module.exports = { testAgentDetection };