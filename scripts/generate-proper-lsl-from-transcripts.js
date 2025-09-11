#!/usr/bin/env node

/**
 * Proper LSL Generation Script
 * Correctly parses transcript conversation flows and creates detailed LSL files
 * Handles complex multi-message exchanges with tool calls and results
 */

import fs from 'fs';
import path from 'path';
import { parseTimestamp, formatTimestamp } from './timezone-utils.js';
// Use the enhanced transcript monitor for consistent classification logic
import EnhancedTranscriptMonitor from './enhanced-transcript-monitor.js';

// Get the target project from environment or command line
function getTargetProject() {
  const targetPath = process.env.CODING_TARGET_PROJECT || process.cwd();
  const projectName = targetPath.split('/').pop();
  return {
    name: projectName,
    path: targetPath,
    outputDir: `${targetPath}/.specstory/history`,
    // Use consistent filename pattern - drop "coding" from filenames
    filenamePattern: (date, window, isFromOtherProject, originProject) => {
      if (projectName === 'coding') {
        if (isFromOtherProject) {
          return `${date}_${window}-session-from-${originProject}.md`;
        } else {
          return `${date}_${window}-session-from-coding.md`;
        }
      }
      return `${date}_${window}-session.md`;
    }
  };
}

// Function to redact API keys and secrets from text
function redactSecrets(text) {
  if (!text) return text;
  
  // List of API key patterns to redact
  const apiKeyPatterns = [
    // Environment variable format: KEY=value
    /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GROK_API_KEY|XAI_API_KEY|GROQ_API_KEY|GEMINI_API_KEY|CLAUDE_API_KEY|GPT_API_KEY|DEEPMIND_API_KEY|COHERE_API_KEY|HUGGINGFACE_API_KEY|HF_API_KEY|REPLICATE_API_KEY|TOGETHER_API_KEY|PERPLEXITY_API_KEY|AI21_API_KEY|GOOGLE_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AZURE_API_KEY|GCP_API_KEY|GITHUB_TOKEN|GITLAB_TOKEN|BITBUCKET_TOKEN|NPM_TOKEN|PYPI_TOKEN|DOCKER_TOKEN|SLACK_TOKEN|DISCORD_TOKEN|TELEGRAM_TOKEN|STRIPE_API_KEY|SENDGRID_API_KEY|MAILGUN_API_KEY|TWILIO_AUTH_TOKEN|FIREBASE_API_KEY|SUPABASE_API_KEY|MONGODB_URI|POSTGRES_PASSWORD|MYSQL_PASSWORD|REDIS_PASSWORD|DATABASE_URL|CONNECTION_STRING|JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY|PRIVATE_KEY|SECRET_KEY|CLIENT_SECRET|API_SECRET|WEBHOOK_SECRET)\s*=\s*["']?([^"'\s\n]+)["']?/gi,
    
    // JSON format: "apiKey": "sk-..." or "ANTHROPIC_API_KEY": "sk-..." or "xai-..."
    /"(apiKey|API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY|GROK_API_KEY|api_key|anthropicApiKey|openaiApiKey|xaiApiKey|grokApiKey)":\s*"(sk-[a-zA-Z0-9-_]{20,}|xai-[a-zA-Z0-9-_]{20,}|[a-zA-Z0-9-_]{32,})"/gi,
    
    // sk- prefix (common for various API keys)
    /\bsk-[a-zA-Z0-9-_]{20,}/gi,
    
    // xai- prefix (XAI/Grok API keys)
    /\bxai-[a-zA-Z0-9-_]{20,}/gi,
    
    // Common API key formats
    /\b[a-zA-Z0-9]{32,}[-_][a-zA-Z0-9]{8,}/gi,
    
    // Bearer tokens
    /Bearer\s+[a-zA-Z0-9\-._~+\/]{20,}/gi,
    
    // JWT tokens (three base64 parts separated by dots)
    /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi,
    
    // MongoDB connection strings
    /mongodb(\+srv)?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    
    // PostgreSQL/MySQL connection strings
    /postgres(ql)?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    /mysql:\/\/[^:]+:[^@]+@[^\s]+/gi,
    
    // Generic URL with credentials
    /https?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    
    // Email addresses
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
    
    // Corporate user IDs (q followed by 6 digits/letters)
    /\bq[0-9a-zA-Z]{6}\b/gi,
    
    // Common corporate terms
    /\b(BMW|Mercedes|Audi|Tesla|Microsoft|Google|Apple|Amazon|Meta|Facebook|IBM|Oracle|Cisco|Intel|Dell|HP|Lenovo|Samsung|LG|Sony|Panasonic|Siemens|SAP|Accenture|Deloitte|McKinsey|BCG|Bain|Goldman|Morgan|JPMorgan|Deutsche Bank|Commerzbank|Allianz|Munich Re|BASF|Bayer|Volkswagen|Porsche|Bosch|Continental|Airbus|Boeing|Lockheed|Northrop|Raytheon|General Electric|Ford|General Motors|Chrysler|Fiat|Renault|Peugeot|Citroen|Volvo|Scania|MAN|Daimler|ThyssenKrupp|Siemens Energy|RWE|EON|Uniper|TUI|Lufthansa|DHL|UPS|FedEx|TNT|Deutsche Post|Telekom|Vodafone|Orange|BT|Telefonica|Verizon|ATT|Sprint|TMobile)\b/gi
  ];
  
  let redactedText = text;
  
  // Apply each pattern
  apiKeyPatterns.forEach(pattern => {
    if (pattern.source.includes('=')) {
      // For environment variable patterns, preserve the key name
      redactedText = redactedText.replace(pattern, (match, keyName) => {
        return `${keyName}=<SECRET_REDACTED>`;
      });
    } else if (pattern.source.includes('apiKey|API_KEY')) {
      // For JSON format API keys, preserve the key name
      redactedText = redactedText.replace(pattern, (match, keyName) => {
        return `"${keyName}": "<SECRET_REDACTED>"`;
      });
    } else if (pattern.source.includes('mongodb') || pattern.source.includes('postgres') || pattern.source.includes('mysql')) {
      // For connection strings, preserve the protocol
      redactedText = redactedText.replace(pattern, (match) => {
        const protocol = match.split(':')[0];
        return `${protocol}://<CONNECTION_STRING_REDACTED>`;
      });
    } else if (pattern.source.includes('Bearer')) {
      // For Bearer tokens
      redactedText = redactedText.replace(pattern, 'Bearer <TOKEN_REDACTED>');
    } else if (pattern.source.includes('@')) {
      // For email addresses
      redactedText = redactedText.replace(pattern, '<EMAIL_REDACTED>');
    } else if (pattern.source.includes('q[0-9a-zA-Z]')) {
      // For corporate user IDs
      redactedText = redactedText.replace(pattern, '<USER_ID_REDACTED>');
    } else if (pattern.source.includes('BMW|Mercedes')) {
      // For corporate terms
      redactedText = redactedText.replace(pattern, '<COMPANY_NAME_REDACTED>');
    } else {
      // For other patterns, replace with generic redaction
      redactedText = redactedText.replace(pattern, '<SECRET_REDACTED>');
    }
  });
  
  return redactedText;
}

function extractTextContent(content) {
  if (typeof content === 'string') return redactSecrets(content);
  if (Array.isArray(content)) {
    const text = content
      .filter(item => item && item.type === 'text')
      .map(item => item.text)
      .filter(text => text && text.trim())
      .join('\n');
    return redactSecrets(text);
  }
  return '';
}

function extractUserMessage(entry) {
  // Handle different user message structures
  if (entry.message?.content) {
    if (typeof entry.message.content === 'string') {
      return redactSecrets(entry.message.content);
    }
    return extractTextContent(entry.message.content);
  }
  if (entry.content) {
    return extractTextContent(entry.content);
  }
  return '';
}

function isSlashCommandResponse(userMessage, responseText) {
  // Check if this is a response to /sl command (session log reading for continuity)
  const userMsg = userMessage.toLowerCase();
  const hasSlCommand = userMsg.includes('<command-name>/sl</command-name>') || 
                       userMsg.includes('/sl') ||
                       userMsg.includes('sl is running');
  
  const hasSlResponseContent = responseText.toLowerCase().includes('session continuity') ||
                               responseText.toLowerCase().includes('session log') ||
                               responseText.toLowerCase().includes('continuity context') ||
                               responseText.toLowerCase().includes('establishing continuity');
  
  return hasSlCommand && hasSlResponseContent;
}

function truncateSlashCommandResponse(responseText) {
  if (responseText.length <= 500) {
    return responseText;
  }
  return responseText.substring(0, 500) + '\n\n...\n\n*[Response truncated - /sl command output abbreviated for readability]*\n';
}

// Use enhanced transcript monitor for consistent classification
async function isCodingInfrastructureExchange(exchangeText, monitor) {
  try {
    // Create exchange object in the format expected by the monitor
    const exchange = {
      timestamp: new Date().toISOString(),
      content: exchangeText,
      tools: [] // We'll extract tools if needed
    };
    
    // Use the monitor's enhanced coding detection logic
    const isCoding = await monitor.isCodingRelated(exchange);
    return isCoding;
  } catch (error) {
    console.warn(`Classification error: ${error.message}, falling back to path detection`);
    // Fallback to simple path detection if classification fails
    const codingPath = '/Users/q284340/Agentic/coding/';
    return exchangeText.toLowerCase().includes(codingPath.toLowerCase());
  }
}

function extractToolCalls(content) {
  if (Array.isArray(content)) {
    return content
      .filter(item => item && item.type === 'tool_use')
      .map(tool => {
        // Get more detailed tool information
        const description = tool.input?.description || 
                           tool.input?.command || 
                           tool.input?.file_path || 
                           tool.input?.pattern ||
                           'Tool executed';
        // Redact secrets from tool descriptions
        const redactedDescription = redactSecrets(description);
        return `**${tool.name}**: ${redactedDescription}`;
      })
      .join('\n');
  }
  return '';
}

async function generateLSL() {
  const targetProject = getTargetProject();
  console.log(`\n🔄 Generating LSL files for: ${targetProject.path}`);

  // Initialize enhanced transcript monitor for consistent classification logic
  console.log('🧠 Initializing enhanced classification system...');
  const monitor = new EnhancedTranscriptMonitor({ projectPath: targetProject.path });
  
  // Wait for reliable coding classifier to be ready
  let retries = 0;
  while (!monitor.reliableCodingClassifierReady && retries < 30) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retries++;
  }
  
  if (monitor.reliableCodingClassifierReady) {
    console.log('✅ Reliable coding classifier ready with three-layer architecture');
  } else {
    console.log('⚠️ Using fallback classification (semantic analysis + keywords)');
  }

  // Find all transcript files automatically - use imports since this is ES module
  
  function findAllTranscriptFiles() {
    const projectsDir = '/Users/q284340/.claude/projects/';
    const transcriptPaths = [];
    
    // Find all .jsonl files in projects directory
    const projectDirs = fs.readdirSync(projectsDir);
    for (const dirName of projectDirs) {
      if (dirName.startsWith('-Users-q284340-Agentic-')) {
        const projectPath = path.join(projectsDir, dirName);
        try {
          const files = fs.readdirSync(projectPath);
          for (const fileName of files) {
            if (fileName.endsWith('.jsonl')) {
              transcriptPaths.push(path.join(projectPath, fileName));
            }
          }
        } catch (error) {
          // Skip if directory can't be read
          console.warn(`Could not read directory ${projectPath}: ${error.message}`);
        }
      }
    }
    
    return transcriptPaths.sort(); // Sort for consistent ordering
  }
  
  const transcriptPaths = findAllTranscriptFiles();
  console.log(`Found ${transcriptPaths.length} transcript files to process`);

  const sessions = new Map();
  const startTime = Date.now();
  let filesProcessed = 0;
  let totalExchanges = 0;

  for (const transcriptPath of transcriptPaths) {
    if (!fs.existsSync(transcriptPath)) continue;
    
    console.log(`Processing: ${transcriptPath}`);
    
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch (error) {
        console.error(`Error parsing line: ${error.message}`);
      }
    }

    // Process conversation flows properly
    let exchangeCount = 0;
    
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      
      // Only process actual user-initiated messages (not tool results or meta messages)
      if (entry.type === 'user' && !entry.message?.content?.[0]?.tool_use_id && !entry.isMeta) {
        const timestampInfo = parseTimestamp(entry.timestamp);
        const userText = extractUserMessage(entry);
        
        // Skip entries with no meaningful user message to prevent "No context" entries
        if (!userText || userText.trim().length === 0) continue;

        // Collect all related assistant responses and tool interactions
        let fullExchange = userText;
        const assistantResponses = [];
        const toolCalls = [];
        const toolResults = [];
        
        // Look ahead for all related assistant responses and tool interactions
        let j = i + 1;
        while (j < entries.length) {
          const nextEntry = entries[j];
          
          // Stop if we hit another real user message (not a tool result)
          if (nextEntry.type === 'user' && !nextEntry.message?.content?.[0]?.tool_use_id && !nextEntry.isMeta) {
            break;
          }
          
          if (nextEntry.type === 'assistant') {
            let responseText = extractTextContent(nextEntry.message?.content || nextEntry.content);
            if (responseText) {
              // Truncate /sl command responses for readability
              if (isSlashCommandResponse(userText, responseText)) {
                responseText = truncateSlashCommandResponse(responseText);
              }
              assistantResponses.push(responseText);
            }
            
            // Extract tool calls
            const tools = extractToolCalls(nextEntry.message?.content || nextEntry.content);
            if (tools) {
              toolCalls.push(tools);
            }
          } else if (nextEntry.type === 'user' && nextEntry.message?.content?.[0]?.tool_use_id) {
            // This is a tool result
            const toolResult = nextEntry.message.content[0].content;
            if (toolResult && typeof toolResult === 'string') {
              // Redact secrets from tool results
              const redactedResult = redactSecrets(toolResult);
              // For /sl commands, also abbreviate tool results like Claude responses
              if (isSlashCommandResponse(userText, redactedResult)) {
                toolResults.push(truncateSlashCommandResponse(redactedResult));
              } else {
                // Capture full tool result for non-/sl commands
                toolResults.push(redactedResult);
              }
            }
          }
          
          j++;
        }
        
        // Build complete exchange content
        fullExchange += '\n\n' + assistantResponses.join('\n\n');
        if (toolCalls.length > 0) {
          fullExchange += '\n\nTool Calls:\n' + toolCalls.join('\n');
        }
        if (toolResults.length > 0) {
          fullExchange += '\n\nTool Results:\n' + toolResults.join('\n');
        }
        
        // Enhanced logic using the same classification as live monitoring
        // - If we're generating for coding project AND exchange is coding infrastructure → include
        // - If we're generating for any other project AND exchange is NOT coding infrastructure → include
        const touchesCoding = await isCodingInfrastructureExchange(fullExchange, monitor);
        const shouldInclude = (targetProject.name === 'coding') ? touchesCoding : !touchesCoding;
        
        if (shouldInclude) {
          // Determine if this exchange is redirected from another project
          const isFromNanoDegree = transcriptPath.includes('-Users-q284340-Agentic-nano-degree');
          const isFromCoding = transcriptPath.includes('-Users-q284340-Agentic-coding');
          const isRedirected = targetProject.name === 'coding' && isFromNanoDegree && touchesCoding;
          
          // Determine origin project name
          let originProject = null;
          if (isFromNanoDegree) originProject = 'nano-degree';
          else if (isFromCoding) originProject = 'coding';
          
          const exchange = {
            timestamp: timestampInfo,
            userMessage: userText,
            claudeResponses: assistantResponses,
            toolCalls: toolCalls,
            toolResults: toolResults,
            window: timestampInfo.window,
            isRedirected: isRedirected,
            originProject: originProject
          };
          
          const window = exchange.window;
          if (!sessions.has(window)) {
            sessions.set(window, []);
          }
          sessions.get(window).push(exchange);
          exchangeCount++;
        }
        
        // Skip ahead past the processed entries
        i = j - 1;
      }
    }
    
    console.log(`Extracted ${exchangeCount} exchanges from ${path.basename(transcriptPath)}`);
    
    // Update progress tracking
    filesProcessed++;
    totalExchanges += exchangeCount;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const progress = ((filesProcessed / transcriptPaths.length) * 100).toFixed(1);
    console.log(`📊 Progress: ${filesProcessed}/${transcriptPaths.length} files (${progress}%) | ${totalExchanges} exchanges | ${elapsed}s elapsed`);
  }

  // Generate LSL files for each session
  for (const [window, exchanges] of sessions.entries()) {
    if (exchanges.length === 0) continue;
    
    const [startTime, endTime] = window.split('-');
    // Extract actual date from the first exchange in this session
    const firstExchange = exchanges[0];
    const actualDate = firstExchange.timestamp.utc.date.toISOString().split('T')[0]; // Get YYYY-MM-DD part
    // Check if this session came from another project (for coding project only)
    const isFromOtherProject = targetProject.name === 'coding' && exchanges.some(e => e.isRedirected);
    const originProject = isFromOtherProject ? exchanges.find(e => e.isRedirected)?.originProject : null;
    const filename = targetProject.filenamePattern(actualDate, window, isFromOtherProject, originProject);
    const filepath = path.join(targetProject.outputDir, filename);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(targetProject.outputDir)) {
      fs.mkdirSync(targetProject.outputDir, { recursive: true });
    }
    
    let content = `# WORK SESSION (${actualDate}_${startTime}-${endTime})

**Generated:** ${new Date().toLocaleDateString('en-US', { 
  month: '2-digit', 
  day: '2-digit', 
  year: 'numeric' 
}).replace(/\//g, '/')}, ${new Date().toLocaleTimeString('en-US', { 
  hour12: false, 
  hour: '2-digit', 
  minute: '2-digit', 
  second: '2-digit' 
})}
**Work Period:** ${actualDate}_${startTime}-${endTime}
**Focus:** Live session logging from actual transcript data
**Duration:** ~60 minutes
**Project:** ${targetProject.name}

---

## Session Overview

This session contains ${exchanges.length} user exchange${exchanges.length !== 1 ? 's' : ''} extracted from the actual Claude transcript.

---

## Key Activities

`;

    for (let i = 0; i < exchanges.length; i++) {
      const exchange = exchanges[i];
      const formattedTime = formatTimestamp(exchange.timestamp.utc.date);
      
      content += `### User Request ${i + 1} - ${formattedTime.combined}

**User Message:**

${exchange.userMessage}

**Claude Response:**

${exchange.claudeResponses.join('\n\n')}

`;

      if (exchange.toolCalls.length > 0) {
        content += `**Tool Calls:**

${exchange.toolCalls.join('\n')}

`;
      }

      if (exchange.toolResults.length > 0) {
        content += `**Tool Results:**

${exchange.toolResults.join('\n')}

`;
      }

      content += `---

`;
    }

    fs.writeFileSync(filepath, content);
    console.log(`Created: ${filename} with ${exchanges.length} exchanges`);
  }
  
  // Final batch processing summary
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgTimePerFile = filesProcessed > 0 ? (totalElapsed / filesProcessed).toFixed(2) : 0;
  const avgTimePerExchange = totalExchanges > 0 ? ((totalElapsed * 1000) / totalExchanges).toFixed(1) : 0;
  
  console.log(`\n📊 BATCH PROCESSING SUMMARY:`);
  console.log(`   Files processed: ${filesProcessed}`);
  console.log(`   Total exchanges: ${totalExchanges}`);
  console.log(`   Session files generated: ${sessions.size}`);
  console.log(`   Total processing time: ${totalElapsed}s`);
  console.log(`   Average time per file: ${avgTimePerFile}s`);
  console.log(`   Average time per exchange: ${avgTimePerExchange}ms`);
  
  if (monitor.reliableCodingClassifierReady) {
    const stats = monitor.reliableCodingClassifier?.getStats();
    if (stats) {
      console.log(`\n🔬 CLASSIFICATION PERFORMANCE:`);
      console.log(`   Total classifications: ${stats.totalClassifications || 0}`);
      console.log(`   Average classification time: ${stats.avgClassificationTime?.toFixed(1) || 0}ms`);
      console.log(`   Path analysis hits: ${stats.pathAnalysisHits || 0}`);
      console.log(`   Semantic analysis hits: ${stats.semanticAnalysisHits || 0}`);
      console.log(`   Keyword analysis hits: ${stats.keywordAnalysisHits || 0}`);
    }
  }
  
  console.log(`\n✅ LSL file generation complete for ${targetProject.name}!`);
}

// Command line interface
async function main() {
  try {
    await generateLSL();
  } catch (error) {
    console.error('❌ LSL generation failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { generateLSL };