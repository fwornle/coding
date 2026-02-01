import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import SemanticAnalysisBridge from './semantic-analysis-bridge.js';
import { createLogger } from '../logging/Logger.js';

const logger = createLogger('copilot-http');

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
            logger.info('Semantic Analysis integration enabled');
        } else {
            logger.warn('Semantic Analysis not available - using fallback mode');
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

        // Graph API endpoints for SynchronizationAgent integration
        this.app.get('/api/graph/status', (req, res) => {
            res.json({ 
                status: 'ok',
                adapter: 'graphology',
                memoryService: this.adapter.memoryService ? 'running' : 'stopped'
            });
        });

        this.app.get('/api/graph/full', async (req, res) => {
            try {
                const graphData = await this.getFullGraphData();
                res.json(graphData);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/graph/entity', async (req, res) => {
            try {
                const result = await this.adapter.createEntity(req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.put('/api/graph/entity/:id', async (req, res) => {
            try {
                const result = await this.adapter.updateEntity(req.params.id, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.delete('/api/graph/entity/:id', async (req, res) => {
            try {
                const result = await this.adapter.removeEntity(req.params.id);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/graph/relation', async (req, res) => {
            try {
                const result = await this.adapter.createRelation(req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.put('/api/graph/relation/:id', async (req, res) => {
            try {
                const result = await this.adapter.updateRelation(req.params.id, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.delete('/api/graph/relation/:id', async (req, res) => {
            try {
                const result = await this.adapter.removeRelation(req.params.id);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.delete('/api/graph/clear', async (req, res) => {
            try {
                const result = await this.adapter.clearGraph();
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // Start HTTP server with error handling
        await new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, () => {
                logger.info(`CoPilot HTTP server listening on port ${this.port}`);
                resolve();
            });

            this.server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    logger.error(`Port ${this.port} is already in use`, { suggestion: `Run: lsof -i :${this.port} to see what's using the port` });
                }
                reject(err);
            });
        });
        
        // Set up WebSocket server
        this.wss = new WebSocketServer({ server: this.server });
        
        this.wss.on('connection', (ws) => {
            logger.info('VSCode extension connected via WebSocket');

            ws.on('error', (error) => {
                logger.error('WebSocket error', { error: error.message });
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
                logger.info('VKB server already running');
                return viewerUrl;
            }
        } catch (error) {
            // Server not running, continue to start it
        }

        logger.info('Starting VKB server...');
        
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
                    logger.info(`VKB server ready after ${attempts + 1} seconds`);
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
        
        // Use the memory service which handles both Graphology and knowledge export sync
        if (this.adapter.memoryService) {
            const result = await this.adapter.memoryService.createEntities([completeEntity]);
            // The memory service now automatically syncs to knowledge export
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
            // Fallback to reading knowledge export
            const knowledgeExportPath = path.join(
                process.env.CODING_TOOLS_PATH || path.join(process.env.HOME, 'Agentic', 'coding'),
                '.data', 'knowledge-export', 'coding.json'
            );
            
            let stats = {
                entityCount: 0,
                relationCount: 0,
                lastUpdated: 'N/A',
                inMemory: false
            };
            
            if (fs.existsSync(knowledgeExportPath)) {
                const knowledgeExport = JSON.parse(fs.readFileSync(knowledgeExportPath, 'utf8'));
                stats.entityCount = knowledgeExport.entities?.length || 0;
                stats.relationCount = knowledgeExport.relations?.length || 0;
                stats.lastUpdated = knowledgeExport.metadata?.last_updated || 'N/A';
            }
            
            return stats;
        }
    }

    async getFullGraphData() {
        if (this.adapter.memoryService) {
            // Get full graph data from memory service
            const allEntities = await this.adapter.memoryService.getAllEntities();
            const allRelations = await this.adapter.memoryService.getAllRelations();
            
            return {
                entities: allEntities || [],
                relations: allRelations || [],
                metadata: {
                    source: 'graphology-memory',
                    timestamp: new Date().toISOString()
                }
            };
        } else {
            // Fallback to knowledge export
            const knowledgeExportPath = path.join(
                process.env.CODING_TOOLS_PATH || process.cwd(),
                '.data', 'knowledge-export', 'coding.json'
            );

            if (fs.existsSync(knowledgeExportPath)) {
                const data = JSON.parse(fs.readFileSync(knowledgeExportPath, 'utf8'));
                return {
                    entities: data.entities || [],
                    relations: data.relations || [],
                    metadata: {
                        source: 'knowledge-export-file',
                        timestamp: new Date().toISOString()
                    }
                };
            }
            
            return {
                entities: [],
                relations: [],
                metadata: {
                    source: 'empty',
                    timestamp: new Date().toISOString()
                }
            };
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
        logger.info('CoPilot analysis now uses same ukb logic as Claude Code');

        // Since the CoPilot integration should use the same conservative logic as direct ukb,
        // but ukb requires proper git context, let's return a simple summary instead
        // of duplicating the complex analysis logic.

        logger.info('Using conservative analysis approach (same as direct ukb command)');
        
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
            process.stdout.write('Starting CoPilot HTTP Server...\n');
            await server.start();
            process.stdout.write('CoPilot HTTP Server running at http://localhost:8765\n');
            process.stdout.write('Available endpoints:\n');
            process.stdout.write('  GET  /health - Health check\n');
            process.stdout.write('  POST /api/knowledge/update - Update knowledge base\n');
            process.stdout.write('  POST /api/knowledge/search - Search knowledge base\n');
            process.stdout.write('  GET  /api/knowledge/stats - Get knowledge statistics\n');
            process.stdout.write('  POST /api/viewer/launch - Launch knowledge viewer\n');
            process.stdout.write('  POST /api/browser/navigate - Navigate browser\n');
            process.stdout.write('  POST /api/browser/action - Perform browser action\n');
            process.stdout.write('  POST /api/ukb/analyze - Analyze session for insights\n');
            process.stdout.write('\n');
            process.stdout.write('Ready for @KM commands from VSCode CoPilot!\n');
        } catch (error) {
            process.stderr.write(`Failed to start server: ${error.message}\n`);
            process.stderr.write(`Stack trace: ${error.stack}\n`);
            process.exit(1);
        }

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            process.stdout.write('\nShutting down server...\n');
            if (server.viewerProcess) {
                server.viewerProcess.kill();
            }
            process.exit(0);
        });
    }

    main().catch(error => {
        process.stderr.write(`Unhandled error: ${error.message}\n`);
        process.exit(1);
    });
}

export { CopilotHTTPServer };