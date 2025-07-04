#!/usr/bin/env node

/**
 * Test script to verify MQTT and JSON-RPC infrastructure
 */

import { MQTTBroker } from './semantic-analysis-system/infrastructure/mqtt/broker.js';
import { JSONRPCServer } from './semantic-analysis-system/infrastructure/rpc/server.js';
import { portManager } from './semantic-analysis-system/shared/port-manager.js';

async function testInfrastructure() {
  console.log('🧪 Testing infrastructure services...');

  try {
    // Initialize port manager
    console.log('📋 Initializing port manager...');
    await portManager.initialize();
    console.log('✅ Port manager initialized');

    // Start MQTT broker
    console.log('🔄 Starting MQTT broker...');
    const mqttPort = portManager.getPort('mqtt-broker-tcp');
    const mqttBroker = new MQTTBroker({ port: mqttPort });
    await mqttBroker.start();
    console.log(`✅ MQTT broker started on port ${mqttPort}`);

    // Start JSON-RPC server
    console.log('🔄 Starting JSON-RPC server...');
    const rpcPort = portManager.getPort('json-rpc-server');
    const rpcServer = new JSONRPCServer({ port: rpcPort });
    
    // Add a simple test method
    rpcServer.registerMethod('test.ping', async (params) => {
      return { message: 'pong', timestamp: new Date().toISOString() };
    });
    
    await rpcServer.start();
    console.log(`✅ JSON-RPC server started on port ${rpcPort}`);

    // Test the services
    console.log('🧪 Testing services...');
    
    // Test MQTT broker stats
    const mqttStats = mqttBroker.getStats();
    console.log('📊 MQTT Broker stats:', mqttStats);
    
    // Test JSON-RPC server
    try {
      const response = await fetch(`http://localhost:${rpcPort}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'test.ping',
          id: 1
        })
      });
      
      const result = await response.json();
      console.log('📞 JSON-RPC response:', result);
    } catch (error) {
      console.error('❌ JSON-RPC test failed:', error.message);
    }

    console.log('✅ All infrastructure services working correctly!');

    // Keep running for a bit
    setTimeout(async () => {
      console.log('🛑 Stopping services...');
      await mqttBroker.stop();
      await rpcServer.stop();
      await portManager.cleanup();
      console.log('✅ Services stopped');
      process.exit(0);
    }, 5000);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testInfrastructure();