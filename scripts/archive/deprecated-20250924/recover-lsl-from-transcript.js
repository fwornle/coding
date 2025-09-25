#!/usr/bin/env node

/**
 * LSL Recovery Script
 * Recovers missing LSL files from nano-degree transcript files
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { parseTimestamp, formatTimestamp, getTimeWindow, getTimezone } from './timezone-utils.js';

class LSLRecoveryTool {
  constructor() {
    this.timezone = getTimezone();
    this.codingPath = '/Users/q284340/Agentic/coding';
    this.nanodegreePath = '/Users/q284340/Agentic/nano-degree';
    this.processedExchanges = [];
  }

  /**
   * Determine if exchange is coding-related based on tool calls
   */
  isCodingRelated(exchange) {
    if (!exchange.toolCalls) return false;
    
    for (const tool of exchange.toolCalls) {
      if (tool.input?.file_path?.includes('/coding')) return true;
      if (tool.input?.path?.includes('/coding')) return true;
      if (tool.input?.command?.includes('/coding')) return true;
      if (tool.name === 'Edit' && tool.input?.file_path?.includes('/coding')) return true;
      if (tool.name === 'Read' && tool.input?.file_path?.includes('/coding')) return true;
      if (tool.name === 'Write' && tool.input?.file_path?.includes('/coding')) return true;
      if (tool.name === 'Grep' && tool.input?.path?.includes('/coding')) return true;
      if (tool.name === 'Glob' && tool.input?.path?.includes('/coding')) return true;
    }
    return false;
  }

  /**
   * Get session file path for given project and time tranche
   */
  getSessionFilePath(targetProject, tranche) {
    const baseName = `${tranche.date}_${tranche.timeString}`;
    const currentProjectName = path.basename(this.nanodegreePath);
    
    if (targetProject === this.nanodegreePath) {
      // Local nano-degree project
      return path.join(targetProject, '.specstory', 'history', `${baseName}-session.md`);
    } else {
      // Coding project (redirected from nano-degree)
      return path.join(targetProject, '.specstory', 'history', `${baseName}_coding-session-from-${currentProjectName}.md`);
    }
  }

  /**
   * Create empty session file with header
   */
  async createEmptySessionFile(targetProject, tranche) {
    const sessionFile = this.getSessionFilePath(targetProject, tranche);
    const sessionDir = path.dirname(sessionFile);
    
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const header = `# WORK SESSION (${tranche.timeString})

**Generated:** ${new Date().toISOString()}
**Work Period:** ${tranche.timeString}
**Focus:** Live session logging
**Duration:** ~60 minutes

---

## Session Overview

This session captures real-time tool interactions and exchanges.

---

## Key Activities

`;

    fs.writeFileSync(sessionFile, header);
    console.log(`✅ Created: ${sessionFile}`);
    return sessionFile;
  }

  /**
   * Process transcript file and recover LSL entries
   */
  async processTranscriptFile(transcriptPath) {
    console.log(`\n📖 Processing transcript: ${path.basename(transcriptPath)}`);
    
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lineCount = 0;
    const entries = [];

    for await (const line of rl) {
      lineCount++;
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
        } catch (error) {
          console.error(`Error parsing line ${lineCount}: ${error.message}`);
        }
      }
    }

    console.log(`📊 Found ${entries.length} total entries to analyze`);
    
    // Convert entries to exchanges format
    const exchanges = this.convertEntriesToExchanges(entries);
    console.log(`🔄 Converted to ${exchanges.length} exchanges`);
    
    // Group exchanges by user prompts
    const userPromptSets = this.groupExchangesByUserPrompts(exchanges);
    console.log(`👤 Found ${userPromptSets.length} user prompt sets`);
    
    // Process each user prompt set
    for (const promptSet of userPromptSets) {
      await this.processUserPromptSet(promptSet);
    }
  }

  /**
   * Convert transcript entries to exchange format
   */
  convertEntriesToExchanges(entries) {
    const exchanges = [];
    let currentExchange = null;
    
    for (const entry of entries) {
      if (entry.type === 'user') {
        // Start new user prompt exchange
        if (currentExchange) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          isUserPrompt: true,
          userMessage: entry.content,
          timestamp: entry.timestamp || new Date().toISOString(),
          toolCalls: []
        };
      } else if (entry.type === 'tool_use' && currentExchange) {
        // Add tool call to current exchange
        currentExchange.toolCalls.push({
          name: entry.name,
          input: entry.input
        });
      } else if (entry.type === 'assistant' && currentExchange) {
        // Add Claude response
        currentExchange.claudeMessage = entry.content;
      }
    }
    
    // Add final exchange
    if (currentExchange) {
      exchanges.push(currentExchange);
    }
    
    return exchanges;
  }

  /**
   * Group exchanges by user prompts (similar to transcript monitor logic)
   */
  groupExchangesByUserPrompts(exchanges) {
    const promptSets = [];
    let currentSet = [];
    
    for (const exchange of exchanges) {
      if (exchange.isUserPrompt && currentSet.length > 0) {
        // Start new set
        promptSets.push([...currentSet]);
        currentSet = [exchange];
      } else {
        currentSet.push(exchange);
      }
    }
    
    // Add final set
    if (currentSet.length > 0) {
      promptSets.push(currentSet);
    }
    
    return promptSets;
  }

  /**
   * Process a user prompt set and write to appropriate LSL files
   */
  async processUserPromptSet(promptSet) {
    if (promptSet.length === 0) return;
    
    const firstExchange = promptSet[0];
    const parsedTimestamp = parseTimestamp(firstExchange.timestamp, this.timezone);
    const tranche = getTimeWindow(parsedTimestamp.local.date);
    
    // Determine target project using exclusive routing logic
    const isCoding = this.isCodingRelated(firstExchange);
    const targetProject = isCoding ? this.codingPath : this.nanodegreePath;
    
    // Get session file path
    const sessionFile = this.getSessionFilePath(targetProject, tranche);
    
    // Create file if it doesn't exist
    if (!fs.existsSync(sessionFile)) {
      await this.createEmptySessionFile(targetProject, tranche);
    }
    
    // Write the prompt set to file
    await this.writePromptSetToFile(promptSet, sessionFile, targetProject, parsedTimestamp);
  }

  /**
   * Write prompt set to session file
   */
  async writePromptSetToFile(promptSet, sessionFile, targetProject, parsedTimestamp) {
    const firstExchange = promptSet[0];
    const formattedTime = formatTimestamp(parsedTimestamp, this.timezone);
    
    let content = `### User Prompt - ${formattedTime}`;
    
    // Add redirect indicator if this is coding session from nano-degree
    if (targetProject === this.codingPath) {
      content += ' (Redirected)';
    }
    
    content += '\n\n';
    
    // Add user message
    const userMessage = firstExchange.userMessage?.slice(0, 500) || 'No context';
    content += `**Request:** ${userMessage}\n\n`;
    
    // Add Claude response if available
    const claudeResponse = promptSet.find(ex => ex.claudeMessage);
    if (claudeResponse) {
      const responseText = claudeResponse.claudeMessage.slice(0, 500) || '';
      content += `**Claude Response:** ${responseText}\n\n`;
    }
    
    // Add tools used
    const toolsUsed = promptSet
      .filter(ex => ex.toolCalls?.length > 0)
      .map(ex => ex.toolCalls.map(t => t.name))
      .flat()
      .filter((tool, index, arr) => arr.indexOf(tool) === index);
    
    content += '**Tools Used:**\n';
    if (toolsUsed.length > 0) {
      toolsUsed.forEach(tool => {
        content += `- ${tool}: ❌\n`;
      });
    } else {
      content += '- None\n';
    }
    
    // Add analysis
    const isCoding = this.isCodingRelated(firstExchange);
    content += `\n**Analysis:** ${isCoding ? '🔧 Coding activity' : '📋 General activity'}\n\n---\n\n`;
    
    // Append to file
    fs.appendFileSync(sessionFile, content);
    
    const projectName = path.basename(targetProject);
    console.log(`📝 Added prompt set to ${projectName} (${formattedTime})`);
  }

  /**
   * Recovery main process
   */
  async recover(transcriptFiles) {
    console.log('🔄 Starting LSL Recovery Process');
    console.log(`📁 Nano-degree path: ${this.nanodegreePath}`);
    console.log(`📁 Coding path: ${this.codingPath}`);
    console.log(`🌍 Timezone: ${this.timezone}`);
    
    for (const transcriptFile of transcriptFiles) {
      await this.processTranscriptFile(transcriptFile);
    }
    
    console.log('\n✅ LSL Recovery completed!');
  }
}

// Usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const recovery = new LSLRecoveryTool();
  
  // Process the main transcript files from today and yesterday
  const transcriptFiles = [
    '/Users/q284340/.claude/projects/-Users-q284340-Agentic-nano-degree/93b4e558-8269-46ed-b349-b345fc9e8169.jsonl', // Yesterday night
    '/Users/q284340/.claude/projects/-Users-q284340-Agentic-nano-degree/7dafc21b-cbac-4fae-9e36-c366b64b5a2a.jsonl'  // Today
  ];
  
  recovery.recover(transcriptFiles.filter(f => fs.existsSync(f))).catch(console.error);
}

export { LSLRecoveryTool };