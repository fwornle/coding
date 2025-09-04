#!/usr/bin/env node

/**
 * Grok Analyzer for Live Logging
 * Fast AI analysis of tool interactions using Grok
 */

import Groq from 'groq-sdk'; // Note: Using for XAI/Grok API compatibility

export class GrokAnalyzer {
  constructor(apiKey, model = 'llama-3.1-8b-instant') {
    if (!apiKey) {
      throw new Error('GROK_API_KEY is required');
    }
    
    this.client = new Groq({ apiKey });
    this.model = model;
    this.timeout = 10000; // 10 second timeout
  }

  /**
   * Analyze a tool interaction for insights
   */
  async analyzeToolInteraction(interaction, context = {}) {
    try {
      const prompt = this.buildAnalysisPrompt(interaction, context);
      
      const response = await this.client.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that analyzes Claude Code tool interactions to provide brief, insightful observations. Keep responses concise and actionable.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.model,
        temperature: 0.7,
        max_tokens: 200,
        timeout: this.timeout
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        return { insight: 'Analysis completed', category: 'info' };
      }

      return this.parseAnalysisResponse(content, interaction);

    } catch (error) {
      console.error(`Grok analysis error: ${error.message}`);
      return { 
        insight: 'Analysis unavailable', 
        category: 'error',
        error: error.message 
      };
    }
  }

  /**
   * Build analysis prompt for tool interaction
   */
  buildAnalysisPrompt(interaction, context) {
    const { toolName, toolInput, toolResult, success } = interaction;
    const { userRequest, previousActions } = context;

    return `Analyze this Claude Code tool interaction:

**User Request:** ${userRequest || 'Not specified'}

**Tool Used:** ${toolName}
**Input:** ${JSON.stringify(toolInput, null, 2)}
**Result:** ${success ? 'Success' : 'Error'}
${toolResult ? `**Output:** ${typeof toolResult === 'string' ? toolResult.slice(0, 200) : JSON.stringify(toolResult).slice(0, 200)}` : ''}

**Previous Actions:** ${previousActions?.join(', ') || 'None'}

Provide a brief insight about:
1. What this tool interaction accomplished
2. Any patterns or potential improvements
3. Overall progress assessment

Format as: INSIGHT: [your observation] | CATEGORY: [info|success|warning|error]`;
  }

  /**
   * Parse the AI response into structured data
   */
  parseAnalysisResponse(content, interaction) {
    const lines = content.split('\n');
    let insight = '';
    let category = 'info';

    for (const line of lines) {
      if (line.startsWith('INSIGHT:')) {
        insight = line.replace('INSIGHT:', '').trim();
      } else if (line.startsWith('CATEGORY:')) {
        category = line.replace('CATEGORY:', '').trim().toLowerCase();
      }
    }

    // Fallback if parsing fails
    if (!insight) {
      insight = content.split('|')[0]?.trim() || content.trim();
    }

    // Validate category
    if (!['info', 'success', 'warning', 'error'].includes(category)) {
      category = 'info';
    }

    // Add tool-specific insights
    const toolInsight = this.getToolSpecificInsight(interaction);
    if (toolInsight) {
      insight = `${toolInsight} ${insight}`;
    }

    return {
      insight: insight.slice(0, 200), // Limit length
      category,
      timestamp: Date.now()
    };
  }

  /**
   * Get tool-specific insights
   */
  getToolSpecificInsight(interaction) {
    const { toolName, toolInput, success } = interaction;

    switch (toolName.toLowerCase()) {
      case 'edit':
      case 'multiedit':
        return success ? '📝 Code modified' : '❌ Edit failed';
      
      case 'write':
        return success ? '📄 File created' : '❌ Write failed';
      
      case 'read':
        const filePath = toolInput?.file_path || '';
        if (filePath.includes('.md')) return '📖 Documentation read';
        if (filePath.includes('.js') || filePath.includes('.ts')) return '💻 Code analyzed';
        return '📋 File examined';
      
      case 'bash':
        const command = toolInput?.command || '';
        if (command.includes('npm') || command.includes('yarn')) return '📦 Package management';
        if (command.includes('git')) return '🔄 Git operation';
        if (command.includes('test')) return '🧪 Tests executed';
        return success ? '✅ Command executed' : '❌ Command failed';
      
      case 'grep':
        return '🔍 Code search performed';
      
      case 'glob':
        return '📁 Files located';
      
      default:
        return success ? '⚙️ Tool executed' : '❌ Tool failed';
    }
  }

  /**
   * Analyze session summary
   */
  async analyzeSessionSummary(interactions, sessionDuration) {
    if (interactions.length === 0) {
      return { summary: 'No activities recorded', productivity: 'unknown' };
    }

    try {
      const toolCounts = this.countToolUsage(interactions);
      const successRate = interactions.filter(i => i.success).length / interactions.length;
      
      const prompt = `Analyze this Claude Code session:

**Duration:** ${Math.round(sessionDuration / 60000)} minutes
**Tool Interactions:** ${interactions.length}
**Success Rate:** ${Math.round(successRate * 100)}%
**Tool Usage:** ${Object.entries(toolCounts).map(([tool, count]) => `${tool}:${count}`).join(', ')}

Recent activities:
${interactions.slice(-5).map(i => `- ${i.toolName}: ${i.success ? 'success' : 'failed'}`).join('\n')}

Provide a brief session summary and productivity assessment.
Format as: SUMMARY: [your summary] | PRODUCTIVITY: [high|medium|low]`;

      const response = await this.client.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that analyzes coding session productivity. Be encouraging and constructive.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.model,
        temperature: 0.6,
        max_tokens: 150,
        timeout: this.timeout
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      return this.parseSessionSummary(content, interactions);

    } catch (error) {
      console.error(`Session analysis error: ${error.message}`);
      return { 
        summary: 'Session analysis unavailable', 
        productivity: 'unknown' 
      };
    }
  }

  /**
   * Count tool usage
   */
  countToolUsage(interactions) {
    const counts = {};
    for (const interaction of interactions) {
      counts[interaction.toolName] = (counts[interaction.toolName] || 0) + 1;
    }
    return counts;
  }

  /**
   * Parse session summary response
   */
  parseSessionSummary(content, interactions) {
    const lines = content.split('\n');
    let summary = '';
    let productivity = 'medium';

    for (const line of lines) {
      if (line.startsWith('SUMMARY:')) {
        summary = line.replace('SUMMARY:', '').trim();
      } else if (line.startsWith('PRODUCTIVITY:')) {
        productivity = line.replace('PRODUCTIVITY:', '').trim().toLowerCase();
      }
    }

    // Fallback
    if (!summary) {
      summary = content.split('|')[0]?.trim() || 'Session completed';
    }

    // Validate productivity
    if (!['high', 'medium', 'low'].includes(productivity)) {
      productivity = interactions.length > 20 ? 'high' : 
                   interactions.length > 10 ? 'medium' : 'low';
    }

    return {
      summary: summary.slice(0, 150),
      productivity,
      toolCount: interactions.length,
      successRate: Math.round((interactions.filter(i => i.success).length / interactions.length) * 100)
    };
  }
}