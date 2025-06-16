const vscode = require('vscode');
const { KMChatParticipant } = require('./chatParticipant');
const { FallbackServiceClient } = require('./fallbackClient');
const { startFallbackServiceIfNeeded } = require('./serviceManager');

let client;
let chatParticipant;

async function activate(context) {
    console.log('KM Copilot Bridge activating...');
    
    // Start fallback services if not already running
    const servicePort = vscode.workspace.getConfiguration('kmCopilot').get('fallbackServicePort', 8765);
    await startFallbackServiceIfNeeded(servicePort);
    
    // Initialize client
    client = new FallbackServiceClient(servicePort);
    await client.connect();
    
    // Register chat participant for Copilot integration
    chatParticipant = new KMChatParticipant(client);
    
    // Register chat participant with VS Code
    const participant = vscode.chat.createChatParticipant('km-assistant', async (request, context, response, token) => {
        await chatParticipant.handleRequest(request, context, response, token);
    });
    
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'km-icon.png');
    context.subscriptions.push(participant);
    
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('km-copilot.ukb', async () => {
            await chatParticipant.runUKB();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('km-copilot.vkb', async () => {
            await chatParticipant.runVKB();
        })
    );
    
    // Set up status bar
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(database) KM Ready";
    statusBarItem.tooltip = "Knowledge Management services are running";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    
    console.log('KM Copilot Bridge activated successfully');
}

function deactivate() {
    if (client) {
        client.disconnect();
    }
}

module.exports = {
    activate,
    deactivate
};