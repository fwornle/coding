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
    
    try {
        await startFallbackServiceIfNeeded(servicePort);
        
        // Initialize client
        client = new FallbackServiceClient(servicePort);
        await client.connect();
    } catch (error) {
        console.error('Failed to start/connect to fallback services:', error);
        vscode.window.showWarningMessage(
            'KM Bridge: Fallback services not running. Start with: coding --copilot'
        );
    }
    
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
            try {
                // Show input box for pattern
                const input = await vscode.window.showInputBox({
                    placeHolder: 'Problem: slow rendering, Solution: use React.memo',
                    prompt: 'Enter knowledge pattern or leave empty for auto-analysis',
                    ignoreFocusOut: true
                });
                
                if (input !== undefined) {
                    // Create a mock request/response for command palette usage
                    const mockRequest = { prompt: input || 'ukb' };
                    const mockResponse = {
                        markdown: (text) => {
                            vscode.window.showInformationMessage(text.replace(/[#*`]/g, ''));
                        },
                        button: () => {} // Ignore buttons in command palette mode
                    };
                    
                    await chatParticipant.handleUKB(mockRequest, mockResponse, null);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update knowledge base: ${error.message}`);
            }
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('km-copilot.vkb', async () => {
            try {
                // Launch viewer directly
                const url = await client.launchViewer();
                
                vscode.window.showInformationMessage(`Knowledge base viewer launched at: ${url}`);
                
                // Open in browser
                vscode.env.openExternal(vscode.Uri.parse(url));
                
                // Also get and show stats
                const stats = await client.getStats();
                vscode.window.showInformationMessage(
                    `Knowledge Base Stats: ${stats.entityCount} entities, ${stats.relationCount} relations`
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to launch knowledge viewer: ${error.message}`);
            }
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