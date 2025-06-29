/**
 * Semantic Analysis Bridge for CoPilot Integration
 * Connects semantic-analysis agent system to CoPilot HTTP server
 */

import { SemanticAnalysisClient } from '../../semantic-analysis-system/mcp-server/clients/semantic-analysis-client.js';

export class SemanticAnalysisBridge {
  constructor(copilotServer) {
    this.copilotServer = copilotServer;
    this.semanticClient = null;
    this.connected = false;
  }

  async initialize() {
    try {
      // Check if semantic-analysis agents are running
      this.semanticClient = new SemanticAnalysisClient({
        mqttUrl: 'mqtt://localhost:1883',
        rpcUrl: 'http://localhost:3001',
        timeout: 30000
      });

      // Try to connect
      await this.semanticClient.connect();
      this.connected = true;
      
      // Register API endpoints with CoPilot server
      this.registerEndpoints();
      
      console.log('✓ Semantic Analysis Bridge initialized');
      return true;
    } catch (error) {
      console.warn('⚠️  Semantic Analysis Bridge not available:', error.message);
      console.log('   Semantic analysis features will be disabled');
      console.log('   To enable: Configure API keys and start agents');
      return false;
    }
  }

  registerEndpoints() {
    const app = this.copilotServer.app;

    // Analyze repository endpoint
    app.post('/api/semantic/analyze-repository', async (req, res) => {
      if (!this.connected) {
        return res.status(503).json({ 
          error: 'Semantic analysis service not available',
          hint: 'Start semantic-analysis agents first'
        });
      }

      try {
        console.log('Repository analysis request body:', req.body);
        const { repository, depth = 10, significanceThreshold = 7 } = req.body || {};
        
        if (!repository) {
          return res.status(400).json({ error: 'Repository path required' });
        }

        const result = await this.semanticClient.analyzeRepository({
          repository,
          depth,
          significanceThreshold
        });

        // Update CoPilot knowledge base with insights
        if (result.patterns && result.patterns.details) {
          for (const pattern of result.patterns.details) {
            await this.copilotServer.updateKnowledge({
              name: pattern.type || 'Pattern',
              entityType: 'SemanticPattern',
              significance: 8,
              observations: [pattern.explanation || pattern.context]
            });
          }
        }

        // Broadcast completion
        this.copilotServer.broadcast({
          type: 'semantic_analysis_completed',
          analysisType: 'repository',
          repository,
          patternCount: result.patterns?.details?.length || 0
        });

        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Analyze conversation endpoint
    app.post('/api/semantic/analyze-conversation', async (req, res) => {
      if (!this.connected) {
        return res.status(503).json({ 
          error: 'Semantic analysis service not available' 
        });
      }

      try {
        const { conversationPath, extractInsights = true } = req.body;
        
        if (!conversationPath) {
          return res.status(400).json({ error: 'Conversation path required' });
        }

        const result = await this.semanticClient.analyzeConversation({
          conversationPath,
          extractInsights,
          updateKnowledge: false // We'll update via CoPilot
        });

        // Update CoPilot knowledge base
        if (result.insights) {
          for (const insight of result.insights) {
            await this.copilotServer.updateKnowledge({
              name: insight.title,
              entityType: insight.type || 'Insight',
              significance: insight.significance || 7,
              observations: [insight.description],
              metadata: {
                applicability: insight.applicability,
                technologies: insight.technologies
              }
            });
          }
        }

        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Search web endpoint
    app.post('/api/semantic/search-web', async (req, res) => {
      if (!this.connected) {
        return res.status(503).json({ 
          error: 'Semantic analysis service not available' 
        });
      }

      try {
        const { query, maxResults = 10, domains } = req.body;
        
        if (!query) {
          return res.status(400).json({ error: 'Search query required' });
        }

        const result = await this.semanticClient.searchWeb({
          query,
          maxResults,
          domains
        });

        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get semantic analysis status
    app.get('/api/semantic/status', async (req, res) => {
      if (!this.connected) {
        return res.json({ 
          available: false,
          status: 'Not connected',
          hint: 'Configure API keys and start agents'
        });
      }

      try {
        const status = await this.semanticClient.getSystemStatus();
        res.json({
          available: true,
          ...status
        });
      } catch (error) {
        res.json({
          available: false,
          status: 'Error',
          error: error.message
        });
      }
    });
  }

  async disconnect() {
    if (this.semanticClient) {
      await this.semanticClient.disconnect();
      this.connected = false;
    }
  }
}

export default SemanticAnalysisBridge;