#!/usr/bin/env node

/**
 * Test the full 7-agent semantic analysis workflow
 */

import { MQTTClient } from './infrastructure/mqtt/client.js';
import { Logger } from './shared/logger.js';

const logger = new Logger('test-full-analysis');

async function triggerRepositoryAnalysis() {
  const mqtt = new MQTTClient({
    brokerUrl: 'mqtt://localhost:1883',
    clientId: 'test-client'
  });

  try {
    logger.info('Connecting to MQTT broker...');
    await mqtt.connect();
    
    logger.info('Triggering repository analysis...');
    
    // Publish analysis request to coordinator
    await mqtt.publish('coordinator/analyze', {
      type: 'repository_analysis',
      repository: '/Users/q284340/Agentic/coding/semantic-analysis-system',
      depth: 10,
      significanceThreshold: 7,
      generateDocumentation: true,
      generateDiagrams: true,
      requestId: 'test-analysis-001'
    });
    
    logger.info('Analysis request sent to coordinator');
    
    // Listen for results
    await mqtt.subscribe('coordinator/results/#', (message, topic) => {
      logger.info(`Result received on ${topic}:`, message);
    });
    
    // Wait for processing
    logger.info('Waiting for analysis to complete...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
    
    await mqtt.disconnect();
    logger.info('Test completed');
    
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

triggerRepositoryAnalysis();