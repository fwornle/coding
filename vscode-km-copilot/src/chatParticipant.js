const vscode = require('vscode');

class KMChatParticipant {
    constructor(client) {
        this.client = client;
    }
    
    async handleRequest(request, context, response, token) {
        const prompt = request.prompt.toLowerCase();
        
        // Handle direct commands
        if (prompt.includes('ukb') || prompt.includes('update knowledge')) {
            await this.handleUKB(request, response, token);
        } else if (prompt.includes('vkb') || prompt.includes('view knowledge')) {
            await this.handleVKB(request, response, token);
        } else if (prompt.includes('search') || prompt.includes('find')) {
            await this.handleSearch(request, response, token);
        } else {
            // General knowledge query
            await this.handleGeneralQuery(request, response, token);
        }
    }
    
    async handleUKB(request, response, token) {
        response.markdown('## Updating Knowledge Base\n\n');
        
        try {
            // Check if this is an auto-analysis request (no specific pattern provided)
            const isAutoAnalysis = request.prompt.toLowerCase().includes('ukb') && 
                                  !request.prompt.includes('problem:') && 
                                  !request.prompt.includes('solution:');
            
            if (isAutoAnalysis) {
                response.markdown('🔍 **Auto-analyzing session data for transferable insights...**\n\n');
                
                // Trigger comprehensive analysis
                const analysisResult = await this.client.analyzeSessionForInsights();
                
                if (analysisResult.insights.length > 0) {
                    response.markdown(`Found ${analysisResult.insights.length} transferable insights:\n\n`);
                    
                    for (const insight of analysisResult.insights) {
                        response.markdown(`### ${insight.name}\n`);
                        response.markdown(`**Problem:** ${insight.problem}\n`);
                        response.markdown(`**Solution:** ${insight.solution}\n`);
                        response.markdown(`**Significance:** ${insight.significance}/10\n`);
                        response.markdown(`**Source:** ${insight.source}\n\n`);
                    }
                    
                    response.markdown('All insights have been captured in the knowledge base.\n');
                } else {
                    response.markdown('No new transferable insights found in current session data.\n');
                }
                
            } else {
                // Manual pattern entry
                const context = request.prompt;
                const pattern = this.parsePatternFromContext(context);
                
                // Send to fallback service
                const result = await this.client.updateKnowledge(pattern);
                
                response.markdown(`✅ Knowledge base updated successfully!\n\n`);
                response.markdown(`**Entity:** ${result.entity.name}\n`);
                response.markdown(`**Type:** ${result.entity.entityType}\n`);
                response.markdown(`**Significance:** ${result.entity.significance}/10\n\n`);
                
                if (result.entity.observations?.length > 0) {
                    response.markdown('**Observations:**\n');
                    result.entity.observations.forEach(obs => {
                        response.markdown(`- ${obs}\n`);
                    });
                }
            }
            
            // Suggest related actions
            response.button({
                title: 'View in Knowledge Graph',
                command: 'km-copilot.vkb',
                arguments: []
            });
            
        } catch (error) {
            response.markdown(`❌ Error updating knowledge base: ${error.message}\n`);
        }
    }
    
    async handleVKB(request, response, token) {
        response.markdown('## Knowledge Base Viewer\n\n');
        
        try {
            // Launch the web viewer
            const url = await this.client.launchViewer();
            
            response.markdown(`🌐 Knowledge base viewer launched at: [${url}](${url})\n\n`);
            
            // Also show some stats
            const stats = await this.client.getStats();
            response.markdown(`**Statistics:**\n`);
            response.markdown(`- Total entities: ${stats.entityCount}\n`);
            response.markdown(`- Total relations: ${stats.relationCount}\n`);
            response.markdown(`- Last updated: ${stats.lastUpdated}\n`);
            
        } catch (error) {
            response.markdown(`❌ Error launching viewer: ${error.message}\n`);
        }
    }
    
    async handleSearch(request, response, token) {
        const query = request.prompt.replace(/search|find/gi, '').trim();
        
        response.markdown(`## Searching Knowledge Base\n\nQuery: "${query}"\n\n`);
        
        try {
            const results = await this.client.search(query);
            
            if (results.length === 0) {
                response.markdown('No results found.\n');
                return;
            }
            
            response.markdown(`Found ${results.length} results:\n\n`);
            
            for (const result of results) {
                response.markdown(`### ${result.name}\n`);
                response.markdown(`**Type:** ${result.entityType}\n`);
                response.markdown(`**Significance:** ${result.significance}/10\n`);
                
                if (result.problem?.description) {
                    response.markdown(`**Problem:** ${result.problem.description}\n`);
                }
                
                if (result.solution?.approach) {
                    response.markdown(`**Solution:** ${result.solution.approach}\n`);
                }
                
                if (result.codeExample) {
                    response.markdown('\n```javascript\n' + result.codeExample + '\n```\n');
                }
                
                response.markdown('\n---\n\n');
            }
            
        } catch (error) {
            response.markdown(`❌ Error searching: ${error.message}\n`);
        }
    }
    
    async handleGeneralQuery(request, response, token) {
        response.markdown('## Knowledge Management Assistant\n\n');
        
        try {
            // Query the knowledge graph
            const context = await this.client.getRelevantContext(request.prompt);
            
            if (context.entities.length > 0) {
                response.markdown('**Relevant knowledge from your codebase:**\n\n');
                
                for (const entity of context.entities) {
                    response.markdown(`- **${entity.name}** (${entity.entityType})\n`);
                    if (entity.observations?.length > 0) {
                        entity.observations.slice(0, 2).forEach(obs => {
                            response.markdown(`  - ${obs}\n`);
                        });
                    }
                }
                
                response.markdown('\n');
            }
            
            // Provide helpful commands
            response.markdown('**Available commands:**\n');
            response.markdown('- `@km ukb <pattern description>` - Update knowledge base\n');
            response.markdown('- `@km vkb` - View knowledge graph\n');
            response.markdown('- `@km search <query>` - Search knowledge base\n');
            
        } catch (error) {
            response.markdown(`❌ Error: ${error.message}\n`);
        }
    }
    
    parsePatternFromContext(context) {
        // Simple pattern extraction logic
        const pattern = {
            name: 'ExtractedPattern',
            entityType: 'Pattern',
            problem: { description: '' },
            solution: { approach: '' },
            significance: 5,
            observations: []
        };
        
        // Extract problem/solution from context
        const problemMatch = context.match(/problem[:\s]+([^.]+)/i);
        const solutionMatch = context.match(/solution[:\s]+([^.]+)/i);
        
        if (problemMatch) pattern.problem.description = problemMatch[1].trim();
        if (solutionMatch) pattern.solution.approach = solutionMatch[1].trim();
        
        // Try to extract a name
        const nameMatch = context.match(/pattern[:\s]+(\w+)/i);
        if (nameMatch) pattern.name = nameMatch[1];
        
        return pattern;
    }
    
    async runUKB() {
        // Called from command palette
        const input = await vscode.window.showInputBox({
            prompt: 'Describe the pattern or insight to capture',
            placeHolder: 'e.g., Problem: slow rendering, Solution: memoization'
        });
        
        if (input) {
            const pattern = this.parsePatternFromContext(input);
            const result = await this.client.updateKnowledge(pattern);
            vscode.window.showInformationMessage(`Knowledge base updated: ${result.entity.name}`);
        }
    }
    
    async runVKB() {
        // Called from command palette
        const url = await this.client.launchViewer();
        vscode.env.openExternal(vscode.Uri.parse(url));
    }
}

module.exports = { KMChatParticipant };