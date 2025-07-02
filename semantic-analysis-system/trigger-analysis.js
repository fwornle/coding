#!/usr/bin/env node

/**
 * Trigger a full repository analysis through the coordinator agent
 */

import { JSONRPCClient } from './infrastructure/rpc/client.js';
import { Logger } from './shared/logger.js';

const logger = new Logger('trigger-analysis');

async function triggerAnalysis() {
  const rpcClient = new JSONRPCClient({
    endpoint: 'http://localhost:8081'
  });

  try {
    logger.info('Triggering repository analysis via JSON-RPC...');
    
    const result = await rpcClient.call('coordinator.analyze', {
      type: 'repository',
      config: {
        repository: '/Users/q284340/Agentic/coding/semantic-analysis-system',
        depth: 10,
        significanceThreshold: 7,
        generateDocumentation: true,
        generateDiagrams: true,
        outputPath: './docs/insights'
      }
    });
    
    logger.info('Analysis triggered successfully:', result);
    
  } catch (error) {
    logger.error('Failed to trigger analysis:', error);
    
    // Try direct MQTT approach
    logger.info('Trying MQTT approach...');
    const { MQTTClient } = await import('./infrastructure/mqtt/client.js');
    const mqtt = new MQTTClient({
      brokerUrl: 'mqtt://localhost:1883',
      clientId: 'trigger-client'
    });
    
    await mqtt.connect();
    
    await mqtt.publish('coordinator/requests/analyze', {
      requestId: 'manual-trigger-001',
      type: 'repository_analysis',
      config: {
        repository: '/Users/q284340/Agentic/coding/semantic-analysis-system',
        depth: 10,
        significanceThreshold: 7,
        generateDocumentation: true,
        generateDiagrams: true
      }
    });
    
    logger.info('Analysis request published via MQTT');
    
    // Subscribe to results
    await mqtt.subscribe('coordinator/results/#', (message) => {
      logger.info('Result received:', message);
    });
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    await mqtt.disconnect();
  }
}

triggerAnalysis().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});