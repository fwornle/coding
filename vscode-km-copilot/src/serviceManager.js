const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

async function isServiceRunning(port) {
    try {
        const response = await axios.get(`http://localhost:${port}/health`, {
            timeout: 1000
        });
        return response.data.status === 'ok';
    } catch (error) {
        return false;
    }
}

async function startFallbackServiceIfNeeded(port) {
    // Check if service is already running
    if (await isServiceRunning(port)) {
        console.log('Fallback services already running');
        return;
    }
    
    console.log('Starting fallback services...');
    
    // Find the coding tools path
    const codingToolsPath = process.env.CODING_TOOLS_PATH || 
                          path.join(process.env.HOME, 'Agentic', 'coding');
    
    const launchScript = path.join(codingToolsPath, 'scripts', 'launch-copilot.sh');
    
    if (!fs.existsSync(launchScript)) {
        throw new Error(`Launch script not found at ${launchScript}. Please ensure coding tools are installed.`);
    }
    
    // Start the service
    const serviceProcess = spawn('bash', [launchScript, '--service-only'], {
        detached: true,
        stdio: 'ignore',
        env: {
            ...process.env,
            CODING_AGENT: 'copilot',
            CODING_TOOLS_PATH: codingToolsPath,
            FALLBACK_SERVICE_PORT: port.toString()
        }
    });
    
    serviceProcess.unref();
    
    // Wait for service to start
    let attempts = 0;
    while (attempts < 30) {
        if (await isServiceRunning(port)) {
            console.log('Fallback services started successfully');
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
    }
    
    throw new Error('Fallback services failed to start');
}

module.exports = { startFallbackServiceIfNeeded };