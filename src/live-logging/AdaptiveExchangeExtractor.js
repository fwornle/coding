/**
 * AdaptiveExchangeExtractor - Dynamically extracts exchanges using detected formats
 * 
 * Features:
 * - Uses AdaptiveTranscriptFormatDetector to learn formats
 * - Applies appropriate extraction strategy based on detected format
 * - Falls back gracefully for unknown formats
 * - Self-improving through format learning
 */

import AdaptiveTranscriptFormatDetector from './AdaptiveTranscriptFormatDetector.js';

class AdaptiveExchangeExtractor {
  constructor(options = {}) {
    this.config = {
      debug: options.debug || false,
      formatCacheTTL: options.formatCacheTTL || 300000, // 5 minutes
      minSampleSize: options.minSampleSize || 1   // FIXED: Reduced to 1 for memory-constrained streaming batches
    };
    
    this.detector = new AdaptiveTranscriptFormatDetector({
      debug: this.config.debug,
      configPath: options.configPath
    });
    
    this.formatCache = new Map();
    this.stats = {
      formatsDetected: 0,
      exchangesExtracted: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    // Listen for new format detections
    this.detector.on('formatDetected', (data) => {
      this.debug(`New format detected: ${data.formatId}`);
      this.stats.formatsDetected++;
    });
  }

  /**
   * Extract exchanges from a batch of messages with adaptive format detection
   */
  static extractExchangesFromBatch(messages, options = {}) {
    const extractor = new AdaptiveExchangeExtractor(options);
    return extractor.extractExchanges(messages);
  }

  /**
   * Main extraction method - detects format and applies appropriate strategy
   */
  extractExchanges(messages) {
    console.log(`🚨 DEBUG: AdaptiveExchangeExtractor.extractExchanges called with ${messages ? messages.length : 'null'} messages`);
    if (!messages || messages.length === 0) {
      console.log(`🚨 DEBUG: No messages provided, returning empty array`);
      return [];
    }

    console.log(`🚨 DEBUG: minSampleSize=${this.config.minSampleSize}, messages.length=${messages.length}`);
    // Check if we have enough data for format detection
    if (messages.length < this.config.minSampleSize) {
      console.log(`🚨 DEBUG: Insufficient sample size (${messages.length}), using fallback extraction`);
      this.debug(`Insufficient sample size (${messages.length}), using fallback extraction`);
      const result = this.extractWithFallback(messages);
      console.log(`🚨 DEBUG: Fallback extraction returned ${result.length} exchanges`);
      return result;
    }

    // Try to get cached format or detect new one
    const formatResult = this.getOrDetectFormat(messages);
    
    if (!formatResult) {
      console.log(`🚨 DEBUG: Format detection failed, using fallback extraction`);
      this.debug('Format detection failed, using fallback extraction');
      return this.extractWithFallback(messages);
    }

    // Apply extraction strategy based on detected format
    const strategy = this.detector.getExtractionStrategy(formatResult);
    console.log(`🚨 DEBUG: Using strategy extraction for format ${formatResult.formatId}`);
    console.log(`🚨 DEBUG: Strategy config: ${JSON.stringify(strategy)}`);
    const exchanges = this.extractWithStrategy(messages, strategy);
    
    console.log(`🚨 DEBUG: Strategy extraction returned ${exchanges.length} exchanges`);
    this.debug(`Extracted ${exchanges.length} exchanges using format: ${formatResult.formatId}`);
    this.stats.exchangesExtracted += exchanges.length;
    
    return exchanges;
  }

  /**
   * Get cached format or detect new format for message batch
   */
  getOrDetectFormat(messages) {
    // Generate cache key based on message structure sample
    const cacheKey = this.generateCacheKey(messages.slice(0, 10));
    
    // Check cache first
    const cached = this.formatCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.config.formatCacheTTL) {
      this.stats.cacheHits++;
      return cached.formatResult;
    }
    
    // Detect format
    this.stats.cacheMisses++;
    const formatResult = this.detector.detectFormat(messages);
    
    // Cache result
    if (formatResult) {
      this.formatCache.set(cacheKey, {
        formatResult,
        timestamp: Date.now()
      });
    }
    
    return formatResult;
  }

  /**
   * Generate cache key from message sample
   */
  generateCacheKey(messageSample) {
    const types = messageSample
      .map(msg => msg?.type || 'unknown')
      .join(',');
    return `types:${types}`;
  }

  /**
   * Extract exchanges using detected format strategy
   */
  extractWithStrategy(messages, strategy) {
    const exchanges = [];
    let currentExchange = null;
    
    this.debug(`Using extraction strategy for format: ${strategy.formatId}`);
    
    for (const msg of messages) {
      if (!msg || !msg.type) continue;
      
      // DEBUG: Track our target Sept 14 exchange
      const isTargetMsg = msg.timestamp && msg.timestamp.includes('2025-09-14T11:15');
      if (isTargetMsg) {
        console.log(`🎯 DEBUG: Found target Sept 14 11:15 message in extraction!`);
        console.log(`   Message type: ${msg.type}`);
        console.log(`   Timestamp: ${msg.timestamp}`);
        console.log(`   Has message field: ${!!msg.message}`);
        console.log(`   User turn indicators: ${JSON.stringify(strategy.exchangeDetection.userTurnIndicators)}`);
        console.log(`   Assistant turn indicators: ${JSON.stringify(strategy.exchangeDetection.assistantTurnIndicators)}`);
        console.log(`   Message includes userTurnIndicator: ${strategy.exchangeDetection.userTurnIndicators.includes(msg.type)}`);
      }
      
      // Check for user turn start
      if (strategy.exchangeDetection.userTurnIndicators.includes(msg.type)) {
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Target message matches user turn indicator!`);
        }
        
        // Complete previous exchange if exists
        if (currentExchange) {
          exchanges.push(currentExchange);
          if (isTargetMsg) {
            console.log(`🎯 DEBUG: Completed previous exchange, starting new one for target`);
          }
        }
        
        // Start new exchange
        currentExchange = {
          uuid: msg.uuid || this.generateUUID(),
          timestamp: msg.timestamp,
          humanMessage: this.extractContent(msg, strategy.messageExtraction.userContentPath),
          userMessage: this.extractContent(msg, strategy.messageExtraction.userContentPath), // Normalized for modern pipeline
          assistantMessage: null,
          toolCalls: [],
          toolResults: []
        };
        
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Created new exchange for target:`);
          console.log(`   UUID: ${currentExchange.uuid}`);
          console.log(`   Timestamp: ${currentExchange.timestamp}`);
          console.log(`   User content path: ${strategy.messageExtraction.userContentPath}`);
          console.log(`   Extracted humanMessage length: ${currentExchange.humanMessage ? currentExchange.humanMessage.length : 'null'}`);
          console.log(`   Extracted userMessage length: ${currentExchange.userMessage ? currentExchange.userMessage.length : 'null'}`);
        }
        
        // For legacy format, user message is complete immediately
        if (strategy.formatId === 'claude-legacy-v1' && msg.message) {
          currentExchange.humanMessage = this.extractMessageContent(msg.message);
          currentExchange.userMessage = this.extractMessageContent(msg.message); // Normalized for modern pipeline
          
          if (isTargetMsg) {
            console.log(`🎯 DEBUG: Using legacy format extraction for target`);
            console.log(`   Legacy extracted humanMessage length: ${currentExchange.humanMessage ? currentExchange.humanMessage.length : 'null'}`);
          }
        }
      }
      
      // Check for user turn end (new format)
      else if (msg.type?.includes('turn_end') && msg.type?.includes('human') && currentExchange) {
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Target message is user turn end!`);
        }
        currentExchange.humanMessage = this.extractContent(msg, strategy.messageExtraction.userContentPath);
        currentExchange.userMessage = this.extractContent(msg, strategy.messageExtraction.userContentPath); // Normalized for modern pipeline
      }
      
      // Check for assistant turn start (new format)
      else if (strategy.exchangeDetection.assistantTurnIndicators.includes(msg.type)) {
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Target message is assistant turn start!`);
        }
        // Assistant response will be completed at turn end
      }
      
      // Check for assistant turn end or assistant message (legacy)
      // NOTE: Do NOT complete exchange here - accumulate multiple assistant messages until next user prompt
      else if (this.isAssistantMessage(msg, strategy) && currentExchange) {
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Target message is assistant message!`);
        }

        // Accumulate assistant content (append to existing)
        const newContent = this.extractContent(msg, strategy.messageExtraction.assistantContentPath);
        if (newContent) {
          currentExchange.assistantMessage = (currentExchange.assistantMessage || '') + newContent + '\n';
        }

        // Extract tool calls from message content (works for all formats with content arrays)
        // This handles both legacy format AND modern format with embedded tool_use in content
        if (msg.message?.content && Array.isArray(msg.message.content)) {
          const toolCalls = this.extractToolCallsFromContent(msg.message.content);
          if (toolCalls.length > 0) {
            currentExchange.toolCalls.push(...toolCalls);
          }
        }

        // DO NOT complete exchange here - wait for next user prompt
        // Exchange will be completed when a new user message arrives (in userTurnIndicators check)
      }
      
      // Check for tool use (new format)
      else if (strategy.toolHandling.toolUseType && msg.type === strategy.toolHandling.toolUseType && currentExchange) {
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Target message is tool use!`);
        }
        const toolCall = this.extractToolCall(msg, strategy.toolHandling);
        if (toolCall) {
          currentExchange.toolCalls.push(toolCall);
        }
      }
      
      // Check for tool result (new format)
      else if (strategy.toolHandling.toolResultType && msg.type === strategy.toolHandling.toolResultType && currentExchange) {
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Target message is tool result!`);
        }
        const toolResult = this.extractToolResult(msg, strategy.toolHandling);
        if (toolResult) {
          currentExchange.toolResults.push(toolResult);
        }
      } else if (isTargetMsg) {
        console.log(`🎯 DEBUG: Target message doesn't match any extraction patterns!`);
        console.log(`   Current exchange exists: ${!!currentExchange}`);
        console.log(`   Strategy format ID: ${strategy.formatId}`);
      }
    }
    
    // Add final exchange if exists
    if (currentExchange) {
      const hasTarget = currentExchange.timestamp && currentExchange.timestamp.includes('2025-09-14T11:15');
      if (hasTarget) {
        console.log(`🎯 DEBUG: Adding target exchange to final results!`);
        console.log(`   Final humanMessage length: ${currentExchange.humanMessage ? currentExchange.humanMessage.length : 'null'}`);
        console.log(`   Final userMessage length: ${currentExchange.userMessage ? currentExchange.userMessage.length : 'null'}`);
      }
      exchanges.push(currentExchange);
    }
    
    // DEBUG: Check if target was found in final exchanges
    const targetInResults = exchanges.find(ex => ex.timestamp && ex.timestamp.includes('2025-09-14T11:15'));
    if (targetInResults) {
      console.log(`🎯 DEBUG: Target exchange found in final results!`);
      console.log(`   Final exchange userMessage preview: ${targetInResults.userMessage ? targetInResults.userMessage.substring(0, 200) : 'null'}...`);
    } else {
      console.log(`❌ DEBUG: Target exchange NOT found in final results!`);
      console.log(`   Total exchanges extracted: ${exchanges.length}`);
    }
    
    return exchanges;
  }

  /**
   * Check if message is an assistant message
   */
  isAssistantMessage(msg, strategy) {
    // Check for assistant turn end
    if (msg.type?.includes('turn_end') && msg.type?.includes('claude')) {
      return true;
    }
    
    // Check for legacy assistant message
    if (strategy.exchangeDetection.assistantTurnIndicators.includes(msg.type)) {
      return true;
    }
    
    return false;
  }

  /**
   * Extract content from message using specified path
   */
  extractContent(msg, contentPath) {
    if (!msg) return '';
    
    // DEBUG: Track our target exchange through content extraction
    const isTargetMsg = msg.timestamp && msg.timestamp.includes('2025-09-14T11:15');
    if (isTargetMsg) {
      console.log(`🎯 DEBUG: extractContent for target exchange!`);
      console.log(`   Content path: ${contentPath}`);
      console.log(`   Message structure: ${Object.keys(msg)}`);
      console.log(`   Has content: ${!!msg.content}`);
      console.log(`   Has message: ${!!msg.message}`);
      console.log(`   Message.content exists: ${!!(msg.message && msg.message.content)}`);
    }
    
    if (!contentPath) {
      // Fallback: try to extract content from any available field
      if (msg.content) {
        if (isTargetMsg) console.log(`🎯 DEBUG: Using direct content field`);
        return msg.content;
      }
      if (msg.message && msg.message.content) {
        if (isTargetMsg) console.log(`🎯 DEBUG: Using message.content field as fallback`);
        return msg.message.content;
      }
      return '';
    }
    
    if (contentPath === 'content') {
      const result = msg.content || '';
      if (isTargetMsg) {
        console.log(`🎯 DEBUG: Content path 'content' returned ${result.length} chars`);
      }
      return result;
    }
    
    if (contentPath === 'message.content') {
      const result = this.extractMessageContent(msg.message);
      if (isTargetMsg) {
        console.log(`🎯 DEBUG: Content path 'message.content' returned ${result.length} chars`);
        console.log(`🎯 DEBUG: Content preview: ${result.substring(0, 200)}...`);
      }
      return result;
    }
    
    // ENHANCED: Try more flexible path resolution
    if (contentPath.includes('.')) {
      const parts = contentPath.split('.');
      let current = msg;
      for (const part of parts) {
        if (current && current[part] !== undefined) {
          current = current[part];
        } else {
          current = null;
          break;
        }
      }
      if (current && typeof current === 'string') {
        if (isTargetMsg) {
          console.log(`🎯 DEBUG: Flexible path '${contentPath}' returned ${current.length} chars`);
        }
        return current;
      }
    }
    
    if (isTargetMsg) {
      console.log(`🎯 DEBUG: No content extracted, returning empty string`);
    }
    return '';
  }

  /**
   * Extract content from message.content field (handles string or array)
   */
  extractMessageContent(messageObj) {
    // DEBUG: Track our target exchange
    const isTargetMsg = messageObj && messageObj.content && typeof messageObj.content === 'string' && messageObj.content.includes('Live Session Logging');
    if (isTargetMsg) {
      console.log(`🎯 DEBUG: extractMessageContent for target!`);
      console.log(`   messageObj exists: ${!!messageObj}`);
      console.log(`   messageObj.content exists: ${!!messageObj?.content}`);
      console.log(`   Content type: ${typeof messageObj?.content}`);
      console.log(`   Content preview: ${messageObj?.content?.substring(0, 200)}...`);
    }
    
    if (!messageObj?.content) {
      if (isTargetMsg) console.log(`🎯 DEBUG: No messageObj.content, returning empty`);
      return '';
    }
    
    if (typeof messageObj.content === 'string') {
      if (isTargetMsg) {
        console.log(`🎯 DEBUG: Returning string content (${messageObj.content.length} chars)`);
      }
      return messageObj.content;
    }
    
    if (Array.isArray(messageObj.content)) {
      if (isTargetMsg) {
        console.log(`🎯 DEBUG: Processing array content with ${messageObj.content.length} items`);
      }
      return messageObj.content
        .filter(item => item.type === 'text' || item.type === 'tool_result')
        .map(item => {
          if (item.type === 'text') return item.text;
          if (item.type === 'tool_result') return item.content;
          return '';
        })
        .join('\n');
    }
    
    if (isTargetMsg) console.log(`🎯 DEBUG: Unknown content format, returning empty`);
    return '';
  }

  /**
   * Extract tool calls from message content array (legacy format)
   */
  extractToolCallsFromContent(content) {
    if (!Array.isArray(content)) return [];
    
    return content
      .filter(item => item.type === 'tool_use')
      .map(item => ({
        id: item.id,
        name: item.name,
        input: item.input
      }));
  }

  /**
   * Extract tool call from tool_use message (new format)
   */
  extractToolCall(msg, toolHandling) {
    return {
      id: msg.tool_use_id,
      name: msg.tool_name,
      input: msg.input_json
    };
  }

  /**
   * Extract tool result from tool_result message (new format)
   */
  extractToolResult(msg, toolHandling) {
    return {
      tool_use_id: msg.tool_use_id,
      output: msg.output_json,
      is_error: msg.is_error || false
    };
  }

  /**
   * Fallback extraction for unknown or insufficient formats
   */
  extractWithFallback(messages) {
    this.debug('Using fallback exchange extraction');
    
    const exchanges = [];
    let currentExchange = null;
    
    for (const msg of messages) {
      if (!msg || !msg.type) continue;
      
      // DEBUG: Track the specific Sept 14 07:12:32 exchange
      const isTarget = msg.timestamp === '2025-09-14T07:12:32.092Z';
      if (isTarget) {
        console.log(`🎯 DEBUG TARGET EXCHANGE 07:12:32 in extractWithFallback:`);
        console.log(`   msg.type: ${msg.type}`);
        console.log(`   msg.message?.role: ${msg.message?.role}`);
        console.log(`   msg.message?.content: ${msg.message?.content ? msg.message.content.substring(0, 100) : 'null'}`);
        console.log(`   isToolResultMessage: ${this.isToolResultMessage(msg)}`);
      }
      
      // Handle user messages (both formats) - exclude tool results
      if (((msg.type === 'user' && msg.message?.role === 'user') || 
          msg.type === 'human_turn_start') &&
          !this.isToolResultMessage(msg)) {
        
        if (isTarget) {
          console.log(`   ✅ TARGET EXCHANGE MATCHED user message condition`);
        }
        
        // Complete previous exchange (only if meaningful)
        if (currentExchange) {
          if (this.isMeaningfulExchange(currentExchange)) {
            exchanges.push(currentExchange);
          }
        }
        
        // Start new exchange
        const userMessage = this.extractFallbackUserMessage(msg);
        if (isTarget) {
          console.log(`   extractFallbackUserMessage returned: ${userMessage ? userMessage.substring(0, 100) : 'null'}`);
        }
        
        currentExchange = {
          uuid: msg.uuid || this.generateUUID(),
          timestamp: msg.timestamp,
          humanMessage: userMessage,
          userMessage: userMessage, // Normalized for modern pipeline
          assistantMessage: null,
          toolCalls: [],
          toolResults: [],
          isUserPrompt: true
        };
        
        if (isTarget) {
          console.log(`   Created currentExchange with userMessage: ${currentExchange.userMessage ? currentExchange.userMessage.substring(0, 100) : 'null'}`);
        }
      }
      
      // Handle user turn end (new format)
      else if (msg.type === 'human_turn_end' && currentExchange) {
        if (msg.content) {
          currentExchange.humanMessage = msg.content;
          currentExchange.userMessage = msg.content; // Normalized for modern pipeline
        }
      }
      
      // Handle assistant messages (both formats)
      // NOTE: Do NOT complete exchange here - accumulate multiple assistant messages until next user prompt
      else if ((msg.type === 'assistant' && msg.message?.role === 'assistant') ||
               msg.type === 'claude_turn_end') {

        if (currentExchange) {
          // Accumulate assistant content (append to existing)
          const newContent = this.extractFallbackAssistantMessage(msg);
          if (newContent) {
            currentExchange.assistantMessage = (currentExchange.assistantMessage || '') + newContent + '\n';
          }

          // Extract tool calls from content array
          if (msg.message?.content && Array.isArray(msg.message.content)) {
            const toolCalls = this.extractToolCallsFromContent(msg.message.content);
            currentExchange.toolCalls.push(...toolCalls);
          }

          // DO NOT complete exchange here - wait for next user prompt
          // Exchange will be completed when a new user message arrives
        }
      }
      
      // Handle tool use/results (new format)
      else if (msg.type === 'tool_use' && currentExchange) {
        currentExchange.toolCalls.push({
          id: msg.tool_use_id,
          name: msg.tool_name,
          input: msg.input_json
        });
      }
      else if (msg.type === 'tool_result' && currentExchange) {
        currentExchange.toolResults.push({
          tool_use_id: msg.tool_use_id,
          output: msg.output_json,
          is_error: msg.is_error || false
        });
      }
    }
    
    // Add final exchange (only if meaningful)
    if (currentExchange) {
      if (this.isMeaningfulExchange(currentExchange)) {
        exchanges.push(currentExchange);
      }
    }
    
    return exchanges;
  }

  /**
   * Check if an exchange has meaningful content
   */
  isMeaningfulExchange(exchange) {
    if (!exchange) return false;
    
    // Check for meaningful user message
    const hasUserMessage = this.hasMeaningfulContent(exchange.humanMessage || exchange.userMessage);
    
    // Check for meaningful assistant response
    const hasAssistantResponse = this.hasMeaningfulContent(exchange.assistantMessage);
    
    // Check for tool calls
    const hasToolCalls = exchange.toolCalls && exchange.toolCalls.length > 0;
    
    // Exchange is meaningful if it has at least one of: user message, assistant response, or tool calls
    return hasUserMessage || hasAssistantResponse || hasToolCalls;
  }

  /**
   * Check if content is meaningful (not empty, not placeholder, not empty JSON)
   */
  hasMeaningfulContent(content) {
    if (!content) return false;
    
    // Handle string content
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (!trimmed) return false;
      if (trimmed === '(No user message)' || trimmed === '(No response)') return false;
      if (trimmed === '{}' || trimmed === '[]' || trimmed === '""' || trimmed === "''") return false; // Empty JSON objects/arrays/strings
      return true;
    }
    
    // Handle object content
    if (typeof content === 'object') {
      // Check if it's an empty object or array
      if (Array.isArray(content)) return content.length > 0;
      if (Object.keys(content).length === 0) return false;
      
      // Convert to string and check - avoid JSON.stringify issues
      const stringified = JSON.stringify(content);
      return stringified !== '{}' && stringified !== '[]' && stringified !== '""' && stringified.trim() !== '';
    }
    
    return false;
  }

  /**
   * Check if a message is a tool result
   */
  isToolResultMessage(msg) {
    // Check if message content is a tool result
    if (Array.isArray(msg.message?.content)) {
      return msg.message.content.some(item => item.type === 'tool_result');
    }
    return false;
  }

  /**
   * Extract user message for fallback mode
   */
  extractFallbackUserMessage(msg) {
    // DEBUG: Check for Sept 14 exchanges
    const isSept14Debug = msg?.timestamp?.includes('2025-09-14T07:');
    
    if (isSept14Debug) {
      console.log(`🎯 DEBUG extractFallbackUserMessage for Sept 14:`);
      console.log(`   Timestamp: ${msg.timestamp}`);
      console.log(`   msg.content exists: ${!!msg.content}`);
      console.log(`   msg.message exists: ${!!msg.message}`);
      if (msg.message) {
        console.log(`   msg.message.content exists: ${!!msg.message.content}`);
        console.log(`   msg.message.content preview: ${msg.message.content ? msg.message.content.substring(0, 100) : 'null'}`);
      }
    }
    
    if (msg.content) {
      if (isSept14Debug) console.log(`   Returning msg.content: ${msg.content.substring(0, 100)}`);
      return msg.content;
    }
    
    if (msg.message) {
      const result = this.extractMessageContent(msg.message);
      if (isSept14Debug) console.log(`   Returning extractMessageContent result: ${result ? result.substring(0, 100) : 'null'}`);
      return result;
    }
    
    if (isSept14Debug) console.log(`   Returning empty string - no content found`);
    return '';
  }

  /**
   * Extract assistant message for fallback mode
   */
  extractFallbackAssistantMessage(msg) {
    if (msg.content) return msg.content;
    if (msg.message) return this.extractMessageContent(msg.message);
    return '';
  }

  /**
   * Generate a UUID for exchanges without one
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get extraction statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.formatCache.size,
      knownFormats: this.detector.knownFormats.size
    };
  }

  debug(message) {
    if (this.config.debug) {
      console.log(`[AdaptiveExtractor] ${message}`);
    }
  }
}

export default AdaptiveExchangeExtractor;