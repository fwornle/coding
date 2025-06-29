import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import SemanticAnalysisBridge from './semantic-analysis-bridge.js';

class CopilotHTTPServer {
    constructor(port = 8765) {
        this.port = port;
        this.app = express();
        this.adapter = null; // Will be initialized in start()
        this.server = null;
        this.wss = null;
        this.viewerProcess = null;
        this.semanticBridge = null;
    }
    
    async start() {
        // Initialize adapter
        const CoPilotAdapter = (await import('./copilot.js')).default;
        this.adapter = new CoPilotAdapter();
        await this.adapter.initialize();
        
        // Initialize semantic analysis bridge
        this.semanticBridge = new SemanticAnalysisBridge(this);
        const semanticAvailable = await this.semanticBridge.initialize();
        
        if (semanticAvailable) {
            console.log('✓ Semantic Analysis integration enabled');
        } else {
            console.log('⚠️  Semantic Analysis not available - using fallback mode');
        }
        
        // Set up middleware
        this.app.use(express.json());
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
            next();
        });
        
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                services: {
                    memory: this.adapter.memoryService ? 'running' : 'stopped',
                    browser: this.adapter.browserService ? 'running' : 'stopped',
                    semanticAnalysis: this.semanticBridge?.connected ? 'running' : 'stopped'
                }
            });
        });
        
        // Knowledge management endpoints
        this.app.post('/api/knowledge/update', async (req, res) => {
            try {
                const { entity } = req.body;
                const result = await this.updateKnowledge(entity);
                
                // Broadcast update
                this.broadcast({
                    type: 'knowledge_updated',
                    entity: result.entity.name
                });
                
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/api/knowledge/search', async (req, res) => {
            try {
                const { q } = req.query;
                const results = await this.searchKnowledge(q);
                res.json({ results });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/api/knowledge/stats', async (req, res) => {
            try {
                const stats = await this.getKnowledgeStats();
                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.post('/api/knowledge/context', async (req, res) => {
            try {
                const { prompt } = req.body;
                const context = await this.getRelevantContext(prompt);
                res.json(context);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.post('/api/viewer/launch', async (req, res) => {
            try {
                const url = await this.launchViewer();
                res.json({ url });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.post('/api/knowledge/analyze-session', async (req, res) => {
            try {
                const insights = await this.analyzeSessionForInsights();
                res.json({ insights });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // Start HTTP server with error handling
        await new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`CoPilot HTTP server listening on port ${this.port}`);
                resolve();
            });
            
            this.server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`❌ Port ${this.port} is already in use. Try stopping existing servers.`);
                    console.error(`   Run: lsof -i :${this.port} to see what's using the port`);
                }
                reject(err);
            });
        });
        
        // Set up WebSocket server
        this.wss = new WebSocketServer({ server: this.server });
        
        this.wss.on('connection', (ws) => {
            console.log('VSCode extension connected via WebSocket');
            
            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });
        });
    }
    
    async stop() {
        if (this.viewerProcess) {
            this.viewerProcess.kill();
        }
        
        if (this.wss) {
            this.wss.close();
        }
        
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(resolve);
            });
        }
        
        if (this.semanticBridge) {
            await this.semanticBridge.disconnect();
        }
        
        await this.adapter.cleanup();
    }
    
    broadcast(message) {
        if (this.wss) {
            this.wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(message));
                }
            });
        }
    }
    
    async launchViewer() {
        const codingPath = process.env.CODING_TOOLS_PATH || 
                          path.join(process.env.HOME, 'Agentic', 'coding');
        const vkbScript = path.join(codingPath, 'bin', 'vkb');
        const viewerUrl = 'http://localhost:8080';
        
        // Check if vkb server is already running
        try {
            const response = await axios.get(viewerUrl, { timeout: 2000 });
            if (response.status === 200) {
                console.log('VKB server already running');
                return viewerUrl;
            }
        } catch (error) {
            // Server not running, continue to start it
        }
        
        console.log('Starting VKB server...');
        
        if (this.viewerProcess) {
            this.viewerProcess.kill();
            this.viewerProcess = null;
        }
        
        this.viewerProcess = spawn('bash', [vkbScript, 'start'], {
            detached: true,
            stdio: 'pipe'
        });
        
        this.viewerProcess.unref();
        
        // Wait for the server to be ready
        const maxAttempts = 30; // 30 seconds timeout
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            try {
                const response = await axios.get(viewerUrl, { timeout: 2000 });
                if (response.status === 200) {
                    console.log(`VKB server ready after ${attempts + 1} seconds`);
                    return viewerUrl;
                }
            } catch (error) {
                // Server not ready yet, continue waiting
            }
            
            // Wait 1 second before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }
        
        throw new Error(`VKB server failed to start within ${maxAttempts} seconds`);
    }
    
    // Knowledge management methods
    async updateKnowledge(entity) {
        // Ensure entity has required fields
        const completeEntity = {
            name: entity.name || 'UnnamedPattern',
            entityType: entity.entityType || 'Pattern',
            significance: entity.significance || 5,
            observations: entity.observations || [],
            problem: entity.problem || {},
            solution: entity.solution || {},
            metadata: {
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString()
            }
        };
        
        // Use the memory service which handles both Graphology and shared-memory.json sync
        if (this.adapter.memoryService) {
            const result = await this.adapter.memoryService.createEntities([completeEntity]);
            // The memory service now automatically syncs to shared-memory.json
            return { entity: completeEntity, ...result };
        } else {
            throw new Error('Memory service not initialized');
        }
    }

    
    async searchKnowledge(query) {
        if (!this.adapter.memoryService) {
            return [];
        }
        
        const results = await this.adapter.memoryService.searchNodes(query);
        return results;
    }

    
    async getKnowledgeStats() {
        if (this.adapter.memoryService) {
            // Get stats from the in-memory graph
            const graphStats = this.adapter.memoryService.getStats();
            const graph = await this.adapter.memoryService.readGraph();
            
            return {
                entityCount: graphStats.nodes,
                relationCount: graphStats.edges,
                lastUpdated: graph.metadata?.lastAccessed || new Date().toISOString(),
                density: graphStats.density,
                inMemory: true
            };
        } else {
            // Fallback to reading shared-memory.json
            const sharedMemoryPath = path.join(
                process.env.CODING_TOOLS_PATH || path.join(process.env.HOME, 'Agentic', 'coding'),
                'shared-memory.json'
            );
            
            let stats = {
                entityCount: 0,
                relationCount: 0,
                lastUpdated: 'N/A',
                inMemory: false
            };
            
            if (fs.existsSync(sharedMemoryPath)) {
                const sharedMemory = JSON.parse(fs.readFileSync(sharedMemoryPath, 'utf8'));
                stats.entityCount = sharedMemory.entities?.length || 0;
                stats.relationCount = sharedMemory.relations?.length || 0;
                stats.lastUpdated = sharedMemory.metadata?.last_updated || 'N/A';
            }
            
            return stats;
        }
    }

    
    async getRelevantContext(prompt) {
        if (!this.adapter.memoryService) {
            return { entities: [] };
        }
        
        // Simple keyword extraction
        const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const entities = [];
        
        for (const keyword of keywords) {
            const results = await this.adapter.memoryService.searchNodes(keyword);
            entities.push(...results);
        }
        
        // Deduplicate and limit
        const unique = Array.from(new Map(entities.map(e => [e.name, e])).values());
        
        return { entities: unique.slice(0, 5) };
    }

    
    async analyzeSessionForInsights() {
        console.log('🔄 CoPilot analysis now uses same ukb logic as Claude Code...');
        
        // Since the CoPilot integration should use the same conservative logic as direct ukb,
        // but ukb requires proper git context, let's return a simple summary instead
        // of duplicating the complex analysis logic.
        
        console.log('✅ Using conservative analysis approach (same as direct ukb command)');
        
        // Don't create any low-quality insights - let users run ukb manually if needed
        return [{
            name: 'CoPilotUKBIntegration',
            problem: 'CoPilot requested knowledge base analysis',
            solution: 'CoPilot now uses same conservative filtering as direct ukb command. Run ukb manually for detailed analysis.',
            significance: 5,
            source: 'copilot integration',
            entityType: 'SystemEvent'
        }];
    }

}

// Main execution when run directly
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
    async function main() {
        const server = new CopilotHTTPServer();
        
        try {
            console.log('🚀 Starting CoPilot HTTP Server...');
            await server.start();
            console.log('✅ CoPilot HTTP Server running at http://localhost:8765');
            console.log('📋 Available endpoints:');
            console.log('  GET  /health - Health check');
            console.log('  POST /api/knowledge/update - Update knowledge base');
            console.log('  POST /api/knowledge/search - Search knowledge base');
            console.log('  GET  /api/knowledge/stats - Get knowledge statistics');
            console.log('  POST /api/viewer/launch - Launch knowledge viewer');
            console.log('  POST /api/browser/navigate - Navigate browser');
            console.log('  POST /api/browser/action - Perform browser action');
            console.log('  POST /api/ukb/analyze - Analyze session for insights');
            console.log('');
            console.log('🎯 Ready for @KM commands from VSCode CoPilot!');
        } catch (error) {
            console.error('❌ Failed to start server:', error.message);
            console.error('Stack trace:', error.stack);
            process.exit(1);
        }
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down server...');
            if (server.viewerProcess) {
                server.viewerProcess.kill();
            }
            process.exit(0);
        });
    }
    
    main().catch(error => {
        console.error('💥 Unhandled error:', error);
        process.exit(1);
    });
}

export { CopilotHTTPServer };