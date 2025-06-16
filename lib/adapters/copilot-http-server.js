const express = require('express');
const WebSocket = require('ws');
const { CoPilotAdapter } = require('./copilot');
const { spawn } = require('child_process');
const path = require('path');

class CopilotHTTPServer {
    constructor(port = 8765) {
        this.port = port;
        this.app = express();
        this.adapter = new CoPilotAdapter();
        this.server = null;
        this.wss = null;
        this.viewerProcess = null;
    }
    
    async start() {
        // Initialize adapter
        await this.adapter.initialize();
        
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
            res.json({ status: 'ok', services: this.adapter.getServiceStatus() });
        });
        
        // Knowledge management endpoints
        this.app.post('/api/knowledge/update', async (req, res) => {
            try {
                const { entity } = req.body;
                const result = await this.adapter.updateKnowledge(entity);
                
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
                const results = await this.adapter.searchKnowledge(q);
                res.json({ results });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/api/knowledge/stats', async (req, res) => {
            try {
                const stats = await this.adapter.getKnowledgeStats();
                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.post('/api/knowledge/context', async (req, res) => {
            try {
                const { prompt } = req.body;
                const context = await this.adapter.getRelevantContext(prompt);
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
                const insights = await this.adapter.analyzeSessionForInsights();
                res.json({ insights });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // Start HTTP server
        this.server = this.app.listen(this.port, () => {
            console.log(`CoPilot HTTP server listening on port ${this.port}`);
        });
        
        // Set up WebSocket server
        this.wss = new WebSocket.Server({ server: this.server });
        
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
        
        if (this.viewerProcess) {
            this.viewerProcess.kill();
        }
        
        this.viewerProcess = spawn('bash', [vkbScript], {
            detached: true,
            stdio: 'ignore'
        });
        
        this.viewerProcess.unref();
        
        // vkb typically runs on port 8080
        return 'http://localhost:8080';
    }
}

// Add methods to CoPilotAdapter for knowledge management
CoPilotAdapter.prototype.updateKnowledge = async function(entity) {
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
    
    // Add to memory service
    if (this.memoryService) {
        await this.memoryService.createEntity(completeEntity);
    }
    
    // Update shared-memory.json
    const sharedMemoryPath = path.join(
        process.env.CODING_TOOLS_PATH || path.join(process.env.HOME, 'Agentic', 'coding'),
        'shared-memory.json'
    );
    
    const fs = require('fs');
    let sharedMemory = { entities: [], relations: [], metadata: {} };
    
    if (fs.existsSync(sharedMemoryPath)) {
        sharedMemory = JSON.parse(fs.readFileSync(sharedMemoryPath, 'utf8'));
    }
    
    // Add or update entity
    const existingIndex = sharedMemory.entities.findIndex(e => e.name === completeEntity.name);
    if (existingIndex >= 0) {
        sharedMemory.entities[existingIndex] = completeEntity;
    } else {
        sharedMemory.entities.push(completeEntity);
    }
    
    sharedMemory.metadata.last_updated = new Date().toISOString();
    
    fs.writeFileSync(sharedMemoryPath, JSON.stringify(sharedMemory, null, 2));
    
    return { entity: completeEntity };
};

CoPilotAdapter.prototype.searchKnowledge = async function(query) {
    if (!this.memoryService) {
        return [];
    }
    
    const results = await this.memoryService.searchEntities(query);
    return results;
};

CoPilotAdapter.prototype.getKnowledgeStats = async function() {
    const sharedMemoryPath = path.join(
        process.env.CODING_TOOLS_PATH || path.join(process.env.HOME, 'Agentic', 'coding'),
        'shared-memory.json'
    );
    
    const fs = require('fs');
    let stats = {
        entityCount: 0,
        relationCount: 0,
        lastUpdated: 'N/A'
    };
    
    if (fs.existsSync(sharedMemoryPath)) {
        const sharedMemory = JSON.parse(fs.readFileSync(sharedMemoryPath, 'utf8'));
        stats.entityCount = sharedMemory.entities?.length || 0;
        stats.relationCount = sharedMemory.relations?.length || 0;
        stats.lastUpdated = sharedMemory.metadata?.last_updated || 'N/A';
    }
    
    return stats;
};

CoPilotAdapter.prototype.getRelevantContext = async function(prompt) {
    if (!this.memoryService) {
        return { entities: [] };
    }
    
    // Simple keyword extraction
    const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const entities = [];
    
    for (const keyword of keywords) {
        const results = await this.memoryService.searchEntities(keyword);
        entities.push(...results);
    }
    
    // Deduplicate and limit
    const unique = Array.from(new Map(entities.map(e => [e.name, e])).values());
    
    return { entities: unique.slice(0, 5) };
};

CoPilotAdapter.prototype.analyzeSessionForInsights = async function() {
    const fs = require('fs').promises;
    const path = require('path');
    const { spawn } = require('child_process');
    const { promisify } = require('util');
    const exec = promisify(require('child_process').exec);
    
    const codingPath = process.env.CODING_TOOLS_PATH || 
                      path.join(process.env.HOME, 'Agentic', 'coding');
    
    const insights = [];
    
    try {
        // 1. Analyze git commits for recent changes
        const { stdout: gitLog } = await exec('git log --oneline -10', { cwd: codingPath });
        const commits = gitLog.trim().split('\n');
        
        for (const commit of commits) {
            if (commit.includes('fix:') || commit.includes('feat:') || commit.includes('refactor:')) {
                const [hash, ...messageParts] = commit.split(' ');
                const message = messageParts.join(' ');
                
                // Extract pattern from commit message
                let problem = 'Code issue identified';
                let solution = message;
                let significance = 6;
                
                if (message.includes('fix:')) {
                    problem = `Bug: ${message.replace('fix:', '').trim()}`;
                    solution = 'Applied fix as described in commit';
                    significance = 7;
                } else if (message.includes('feat:')) {
                    problem = `Feature needed: ${message.replace('feat:', '').trim()}`;
                    solution = 'Implemented new feature';
                    significance = 8;
                } else if (message.includes('refactor:')) {
                    problem = `Code quality issue: ${message.replace('refactor:', '').trim()}`;
                    solution = 'Refactored code for better structure';
                    significance = 6;
                }
                
                insights.push({
                    name: `GitPattern_${hash.substring(0, 7)}`,
                    problem,
                    solution,
                    significance,
                    source: `Git commit ${hash}`,
                    entityType: 'GitPattern'
                });
            }
        }
        
        // 2. Analyze .specstory/history files for conversation patterns
        const specstoryDir = path.join(codingPath, '.specstory', 'history');
        
        try {
            const historyFiles = await fs.readdir(specstoryDir);
            const recentFiles = historyFiles
                .filter(f => f.endsWith('.md'))
                .sort()
                .slice(-3); // Last 3 conversation files
            
            for (const file of recentFiles) {
                const filePath = path.join(specstoryDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                
                // Look for common patterns in conversations
                if (content.includes('Error:') || content.includes('error')) {
                    const errorContext = this.extractErrorContext(content);
                    if (errorContext) {
                        insights.push({
                            name: `ConversationPattern_${file.replace('.md', '')}`,
                            problem: errorContext.problem,
                            solution: errorContext.solution,
                            significance: 7,
                            source: `Conversation log ${file}`,
                            entityType: 'ConversationPattern'
                        });
                    }
                }
                
                // Look for successful solutions
                if (content.includes('✅') || content.includes('success')) {
                    const successContext = this.extractSuccessContext(content);
                    if (successContext) {
                        insights.push({
                            name: `SuccessPattern_${file.replace('.md', '')}`,
                            problem: successContext.problem,
                            solution: successContext.solution,
                            significance: 8,
                            source: `Conversation log ${file}`,
                            entityType: 'SuccessPattern'
                        });
                    }
                }
            }
        } catch (err) {
            // .specstory directory might not exist
            console.log('No .specstory history found for analysis');
        }
        
        // 3. Add insights to knowledge base
        for (const insight of insights) {
            await this.updateKnowledge({
                name: insight.name,
                entityType: insight.entityType,
                significance: insight.significance,
                problem: { description: insight.problem },
                solution: { approach: insight.solution },
                observations: [
                    `Source: ${insight.source}`,
                    `Auto-discovered: ${new Date().toISOString()}`
                ]
            });
        }
        
    } catch (error) {
        console.error('Error analyzing session for insights:', error);
    }
    
    return insights;
};

CoPilotAdapter.prototype.extractErrorContext = function(content) {
    // Simple pattern extraction for error resolution
    const errorMatch = content.match(/(?:Error:|error[:\s])([^\n]+)/i);
    const solutionMatch = content.match(/(?:✅|Fixed|Solution|Resolved)[:\s]([^\n]+)/i);
    
    if (errorMatch) {
        return {
            problem: `Error encountered: ${errorMatch[1].trim()}`,
            solution: solutionMatch ? solutionMatch[1].trim() : 'Resolution applied'
        };
    }
    return null;
};

CoPilotAdapter.prototype.extractSuccessContext = function(content) {
    // Simple pattern extraction for successful solutions
    const successMatch = content.match(/(?:✅|Success|Completed)[:\s]([^\n]+)/i);
    const contextMatch = content.match(/(?:Problem|Issue|Task)[:\s]([^\n]+)/i);
    
    if (successMatch) {
        return {
            problem: contextMatch ? contextMatch[1].trim() : 'Task completed',
            solution: successMatch[1].trim()
        };
    }
    return null;
};

module.exports = { CopilotHTTPServer };