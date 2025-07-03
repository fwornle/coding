#!/usr/bin/env node

/**
 * Standalone Health Monitor
 * 
 * Runs as a separate service to monitor all other services
 */

import { HealthMonitor } from './health-monitor.js';
import process from 'process';

const port = parseInt(process.env.MONITORING_PORT || '9090');
const monitor = new HealthMonitor(port);

// Handle shutdown signals
const shutdown = async (signal) => {
  console.log(`\nReceived ${signal}, shutting down health monitor...`);
  try {
    await monitor.stop();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the monitor
monitor.start().catch(error => {
  console.error('Failed to start health monitor:', error);
  process.exit(1);
});