#!/usr/bin/env node

/**
 * Claude Transcript Reader
 * Reads Claude Code's built-in conversation transcript files
 * Based on the claude-code-tamagotchi pattern
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { runIfMain } from '../lib/utils/esm-cli.js';

class ClaudeTranscriptReader {
  constructor() {
    this.transcriptPaths = this.findTranscriptPaths();
    this.secretPatterns = [
      /sk-ant-[a-zA-Z0-9\-_]{20,}/g,    // Anthropic keys
      /sk-proj-[a-zA-Z0-9]{20,}/g,      // OpenAI keys  
      /xai-[a-zA-Z0-9]{20,}/g,          // XAI/Grok keys
      /gsk_[a-zA-Z0-9]{20,}/g,          // Grok keys (actual format)
      /[A-Za-z0-9]{32,}/g,              // Generic long keys
    ];
  }

  /**
   * Find Claude Code transcript file locations
   */
  findTranscriptPaths() {
    const possiblePaths = [
      // Common Claude Code transcript locations
      path.join(os.homedir(), '.claude', 'transcripts'),
      path.join(os.homedir(), '.config', 'claude-code', 'transcripts'),
      path.join(process.cwd(), '.claude', 'transcripts'),
      path.join(process.cwd(), 'transcripts'),
      // MCP session paths
      path.join(os.homedir(), '.anthropic', 'sessions'),
      path.join(os.homedir(), '.claude', 'sessions'),
    ];

    const existingPaths = possiblePaths.filter(p => {
      try {
        return fs.existsSync(p);
      } catch (e) {
        return false;
      }
    });

    return existingPaths;
  }

  /**
   * Read transcript messages (similar to tamagotchi MessageProcessor)
   */
  async readTranscript(transcriptPath) {
    if (!fs.existsSync(transcriptPath)) {
      return [];
    }

    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const messages = [];

    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        // Apply secret redaction
        const redactedMessage = this.redactSecrets(message);
        messages.push(redactedMessage);
      } catch (error) {
        // Skip malformed lines
        continue;
      }
    }

    return messages;
  }

  /**
   * Redact secrets from message content
   */
  redactSecrets(message) {
    const messageStr = JSON.stringify(message);
    let redactedStr = messageStr;

    // Apply all secret patterns
    this.secretPatterns.forEach(pattern => {
      redactedStr = redactedStr.replace(pattern, (match) => {
        // Preserve first 4 and last 4 characters, redact middle
        if (match.length > 8) {
          return `${match.slice(0, 4)}...<REDACTED>...${match.slice(-4)}`;
        } else {
          return '<REDACTED>';
        }
      });
    });

    try {
      return JSON.parse(redactedStr);
    } catch (error) {
      // If parsing fails after redaction, return original with basic redaction
      return this.basicSecretRedaction(message);
    }
  }

  /**
   * Basic secret redaction as fallback
   */
  basicSecretRedaction(obj) {
    if (typeof obj === 'string') {
      let redacted = obj;
      this.secretPatterns.forEach(pattern => {
        redacted = redacted.replace(pattern, '<REDACTED-KEY>');
      });
      return redacted;
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.basicSecretRedaction(item));
    } else if (obj && typeof obj === 'object') {
      const redacted = {};
      for (const [key, value] of Object.entries(obj)) {
        redacted[key] = this.basicSecretRedaction(value);
      }
      return redacted;
    }
    return obj;
  }

  /**
   * Find the most recent transcript file
   */
  findLatestTranscript() {
    let latestFile = null;
    let latestTime = 0;

    for (const dir of this.transcriptPaths) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.jsonl') || file.endsWith('.json') || file.includes('transcript')) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.mtime.getTime() > latestTime) {
              latestTime = stat.mtime.getTime();
              latestFile = fullPath;
            }
          }
        }
      } catch (error) {
        continue;
      }
    }

    return latestFile;
  }

  /**
   * Get unprocessed messages since last check
   */
  async getUnprocessedMessages(transcriptPath, lastProcessedUuid = null, limit = 10) {
    const allMessages = await this.readTranscript(transcriptPath);
    
    if (!lastProcessedUuid) {
      return allMessages.slice(-limit);
    }

    const lastIndex = allMessages.findIndex(m => m.uuid === lastProcessedUuid);
    if (lastIndex >= 0) {
      return allMessages.slice(lastIndex + 1, lastIndex + 1 + limit);
    }

    return allMessages.slice(-limit);
  }

  /**
   * Extract conversation exchanges for semantic analysis
   */
  extractConversationExchanges(messages) {
    const exchanges = [];
    let currentExchange = null;

    for (const message of messages) {
      if (message.type === 'user' && message.message?.role === 'user') {
        // Start new exchange with user message
        if (currentExchange) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          id: exchanges.length + 1,
          timestamp: message.timestamp || Date.now(),
          userMessage: message.message.content || '',
          claudeResponse: '',
          toolCalls: [],
          toolResults: []
        };
      } else if (message.type === 'assistant' && currentExchange) {
        // Add Claude's response
        if (message.message?.content) {
          if (Array.isArray(message.message.content)) {
            for (const item of message.message.content) {
              if (item.type === 'text') {
                currentExchange.claudeResponse += item.text + '\n';
              } else if (item.type === 'tool_use') {
                currentExchange.toolCalls.push({
                  name: item.name,
                  input: item.input,
                  id: item.id
                });
              }
            }
          } else {
            currentExchange.claudeResponse = message.message.content;
          }
        }
      } else if (message.type === 'user' && message.message?.content && Array.isArray(message.message.content)) {
        // Check for tool results
        for (const item of message.message.content) {
          if (item.type === 'tool_result' && currentExchange) {
            currentExchange.toolResults.push({
              tool_use_id: item.tool_use_id,
              content: item.content
            });
          }
        }
      }
    }

    // Add final exchange
    if (currentExchange) {
      exchanges.push(currentExchange);
    }

    return exchanges;
  }

  /**
   * Monitor transcript for changes (like tamagotchi's hasNewMessages)
   */
  async hasNewMessages(transcriptPath, lastKnownUuid = null) {
    if (!fs.existsSync(transcriptPath)) {
      return false;
    }

    try {
      const messages = await this.readTranscript(transcriptPath);
      if (messages.length === 0) {
        return false;
      }

      const lastMessage = messages[messages.length - 1];
      return lastMessage.uuid !== lastKnownUuid;
    } catch (error) {
      return false;
    }
  }

  /**
   * Count conversation prompts and responses for plausibility check
   */
  async getConversationStats(transcriptPath) {
    try {
      const messages = await this.readTranscript(transcriptPath);
      let userPrompts = 0;
      let claudeResponses = 0;
      let toolCalls = 0;

      for (const message of messages) {
        if (message.type === 'user' && message.message?.role === 'user') {
          userPrompts++;
        } else if (message.type === 'assistant') {
          claudeResponses++;
          
          // Count tool calls
          if (message.message?.content && Array.isArray(message.message.content)) {
            for (const item of message.message.content) {
              if (item.type === 'tool_use') {
                toolCalls++;
              }
            }
          }
        }
      }

      return {
        userPrompts,
        claudeResponses,
        toolCalls,
        totalMessages: messages.length,
        balanced: Math.abs(userPrompts - claudeResponses) <= 2 // Allow some variance
      };
    } catch (error) {
      return {
        userPrompts: 0,
        claudeResponses: 0,
        toolCalls: 0,
        totalMessages: 0,
        balanced: false
      };
    }
  }
}

// Test if run directly
runIfMain(import.meta.url, () => {
  const reader = new ClaudeTranscriptReader();
  
  console.log('🔍 Searching for Claude transcripts...');
  console.log('Found paths:', reader.transcriptPaths);
  
  const latest = reader.findLatestTranscript();
  if (latest) {
    console.log(`📋 Latest transcript: ${latest}`);
    
    reader.getConversationStats(latest).then(stats => {
      console.log('📊 Conversation Stats:', stats);
      
      if (!stats.balanced) {
        console.log('⚠️ PLAUSIBILITY ISSUE: Unbalanced conversation - some messages may be missing!');
      }
    });
  } else {
    console.log('❌ No transcript files found');
    console.log('💡 Make sure you\'re running Claude Code with MCP enabled');
  }
});

export default ClaudeTranscriptReader;