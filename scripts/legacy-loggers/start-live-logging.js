#!/usr/bin/env node

/**
 * Startup wrapper for Live Logging Coordinator
 * This properly initializes the coordinator for background operation
 */

import { getGlobalCoordinator } from './live-logging-coordinator.js';

async function start() {
    try {
        console.log('🚀 Starting Live Logging Coordinator...');
        
        const coordinator = await getGlobalCoordinator();
        
        if (coordinator) {
            console.log(`✅ Live Logging Coordinator initialized (Session: ${coordinator.sessionId})`);
            
            // Keep the process alive
            setInterval(() => {
                // Process any buffered interactions every 5 seconds
                coordinator.processBufferedInteractions().catch(err => {
                    console.error('Buffer processing error:', err);
                });
            }, 5000);
            
            // Handle graceful shutdown
            process.on('SIGINT', async () => {
                console.log('\n📋 Shutting down Live Logging Coordinator...');
                await coordinator.finalizeSession();
                process.exit(0);
            });
            
            process.on('SIGTERM', async () => {
                console.log('\n📋 Shutting down Live Logging Coordinator...');
                await coordinator.finalizeSession();
                process.exit(0);
            });
            
        } else {
            console.error('❌ Failed to initialize Live Logging Coordinator');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error starting Live Logging Coordinator:', error);
        process.exit(1);
    }
}

// Start the coordinator
start();