import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import net from 'net';
import http from 'http';
import { createLogger } from '../logging/Logger.js';

const logger = createLogger('specstory');

class SpecstoryAdapter {
  constructor() {
    this.extensionId = 'specstory.specstory-vscode';
    this.extensionApi = null;
    this.sessionId = Date.now().toString();
    this.initialized = false;
  }

  async initialize() {
    try {
      // Try multiple connection methods in order of preference
      this.extensionApi = await this.connectViaHTTP() || 
                         await this.connectViaIPC() ||
                         await this.connectViaFileWatch();
      
      this.initialized = !!this.extensionApi;
      return this.initialized;
    } catch (error) {
      logger.warn('Specstory extension not available', { error: error.message });
      return false;
    }
  }

  /**
   * Log a conversation entry via Specstory
   */
  async logConversation(entry) {
    if (!this.extensionApi) return false;
    
    try {
      // Format for Specstory
      const specstoryEntry = {
        timestamp: new Date().toISOString(),
        agent: entry.agent || 'copilot',
        type: entry.type || 'conversation',
        content: entry.content,
        metadata: {
          ...entry.metadata,
          project: process.cwd(),
          session: this.sessionId,
          tool: 'coding-tools'
        }
      };
      
      return await this.extensionApi.log(specstoryEntry);
    } catch (error) {
      logger.error('Failed to log via Specstory', { error: error.message });
      return false;
    }
  }

  /**
   * Try to connect via HTTP API
   */
  async connectViaHTTP() {
    const ports = [7357, 7358, 7359]; // Common extension ports
    
    for (const port of ports) {
      try {
        const response = await this.httpRequest({
          hostname: 'localhost',
          port,
          path: '/api/status',
          method: 'GET'
        });
        
        const data = JSON.parse(response);
        if (data.extensionId === this.extensionId || data.name === 'specstory') {
          logger.info(`Connected to Specstory via HTTP on port ${port}`);
          
          return {
            log: async (data) => {
              const response = await this.httpRequest({
                hostname: 'localhost',
                port,
                path: '/api/log',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              }, JSON.stringify(data));
              
              return JSON.parse(response);
            }
          };
        }
      } catch (error) {
        // Try next port
      }
    }
    
    return null;
  }

  /**
   * Try to connect via IPC (Inter-Process Communication)
   */
  async connectViaIPC() {
    const ipcPath = process.platform === 'win32' 
      ? '\\\\.\\pipe\\specstory-vscode'
      : '/tmp/specstory-vscode.sock';
    
    try {
      const connected = await new Promise((resolve) => {
        const client = net.createConnection(ipcPath, () => {
          resolve(true);
        });
        
        client.on('error', () => {
          resolve(false);
        });
        
        setTimeout(() => resolve(false), 1000);
      });
      
      if (connected) {
        logger.info('Connected to Specstory via IPC');
        
        return {
          log: async (data) => {
            return new Promise((resolve, reject) => {
              const client = net.createConnection(ipcPath);
              
              client.on('connect', () => {
                client.write(JSON.stringify({
                  action: 'log',
                  data
                }) + '\n');
              });
              
              client.on('data', (response) => {
                try {
                  const result = JSON.parse(response.toString());
                  resolve(result);
                } catch (error) {
                  reject(error);
                }
                client.end();
              });
              
              client.on('error', reject);
            });
          }
        };
      }
    } catch (error) {
      // IPC not available
    }
    
    return null;
  }

  /**
   * Fallback: Write to watched directory
   */
  async connectViaFileWatch() {
    const watchDir = path.join(os.homedir(), '.specstory', 'watch');
    
    try {
      await fs.mkdir(watchDir, { recursive: true });
      
      // Test if directory is writable
      const testFile = path.join(watchDir, '.test');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      
      logger.info('Using Specstory file watch directory');
      
      return {
        log: async (data) => {
          const filename = `${Date.now()}-${process.pid}.json`;
          const filepath = path.join(watchDir, filename);
          
          await fs.writeFile(filepath, JSON.stringify(data, null, 2));
          
          // Create a marker file to indicate new log
          const markerFile = path.join(watchDir, '.new-log');
          await fs.writeFile(markerFile, filename);
          
          return { success: true, method: 'file-watch', file: filepath };
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper method for HTTP requests
   */
  httpRequest(options, data) {
    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      });
      
      req.on('error', reject);
      
      if (data) {
        req.write(data);
      }
      
      req.end();
    });
  }

  /**
   * Check if Specstory is available
   */
  isAvailable() {
    return this.initialized && this.extensionApi !== null;
  }

  /**
   * Read logs from Specstory
   */
  async readLogs(options = {}) {
    if (!this.extensionApi || !this.extensionApi.read) {
      // Fallback to reading from watch directory
      const watchDir = path.join(os.homedir(), '.specstory', 'watch');
      
      try {
        const files = await fs.readdir(watchDir);
        const logs = [];
        
        for (const file of files) {
          if (file.endsWith('.json') && !file.startsWith('.')) {
            const content = await fs.readFile(path.join(watchDir, file), 'utf8');
            logs.push(JSON.parse(content));
          }
        }
        
        return logs.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      } catch (error) {
        return [];
      }
    }
    
    return await this.extensionApi.read(options);
  }
}

export default SpecstoryAdapter;