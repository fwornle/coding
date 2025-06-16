const axios = require('axios');
const WebSocket = require('ws');
const vscode = require('vscode');

class FallbackServiceClient {
    constructor(port) {
        this.port = port;
        this.baseUrl = `http://localhost:${port}`;
        this.ws = null;
        this.connected = false;
    }
    
    async connect() {
        try {
            // Check if service is running
            const response = await axios.get(`${this.baseUrl}/health`);
            if (response.data.status === 'ok') {
                this.connected = true;
                
                // Set up WebSocket for real-time updates
                this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
                
                this.ws.on('open', () => {
                    console.log('WebSocket connected to fallback services');
                });
                
                this.ws.on('message', (data) => {
                    const message = JSON.parse(data);
                    this.handleServiceMessage(message);
                });
                
                this.ws.on('error', (error) => {
                    console.error('WebSocket error:', error);
                });
                
                return true;
            }
        } catch (error) {
            console.error('Failed to connect to fallback services:', error.message);
            throw new Error('Fallback services not running. Run "coding --copilot" first.');
        }
    }
    
    async disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        this.connected = false;
    }
    
    async updateKnowledge(pattern) {
        const response = await axios.post(`${this.baseUrl}/api/knowledge/update`, {
            entity: pattern
        });
        return response.data;
    }
    
    async search(query) {
        const response = await axios.get(`${this.baseUrl}/api/knowledge/search`, {
            params: { q: query }
        });
        return response.data.results;
    }
    
    async getStats() {
        const response = await axios.get(`${this.baseUrl}/api/knowledge/stats`);
        return response.data;
    }
    
    async launchViewer() {
        const response = await axios.post(`${this.baseUrl}/api/viewer/launch`);
        return response.data.url;
    }
    
    async getRelevantContext(prompt) {
        const response = await axios.post(`${this.baseUrl}/api/knowledge/context`, {
            prompt: prompt
        });
        return response.data;
    }
    
    async analyzeSessionForInsights() {
        const response = await axios.post(`${this.baseUrl}/api/knowledge/analyze-session`);
        return response.data;
    }
    
    handleServiceMessage(message) {
        switch (message.type) {
            case 'knowledge_updated':
                vscode.window.showInformationMessage(`Knowledge base updated: ${message.entity}`);
                break;
            case 'service_status':
                if (message.status !== 'ok') {
                    vscode.window.showWarningMessage(`Service issue: ${message.message}`);
                }
                break;
        }
    }
}

module.exports = { FallbackServiceClient };