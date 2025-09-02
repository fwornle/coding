
// Tool Interaction Hook for Live Logging
// This file is called by the constraint monitor or statusLine to capture tool interactions

const { existsSync, appendFileSync } = require('fs');
const path = require('path');

function captureToolInteraction(toolCall, result, context = {}) {
  const interaction = {
    timestamp: new Date().toISOString(),
    sessionId: 'live-1756824145587-k0cdbd',
    toolCall: toolCall,
    result: result,
    context: context
  };
  
  const bufferPath = path.join(process.cwd(), '.mcp-sync/tool-interaction-buffer.jsonl');
  
  try {
    appendFileSync(bufferPath, JSON.stringify(interaction) + '\n');
  } catch (error) {
    console.error('Hook capture error:', error);
  }
}

module.exports = { captureToolInteraction };
