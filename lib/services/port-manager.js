/**
 * Central Port Manager
 * 
 * Manages port allocation for all services in the coding project.
 * NO HARDCODED FALLBACKS - explicit error handling only.
 */

import { createServer } from 'net';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export class CentralPortManager {
  constructor(configPath = '.env.ports') {
    this.allocatedPorts = new Map(); // serviceName -> port
    this.serviceRegistry = new Map(); // serviceName -> { port, pid, health }
    this.configPath = configPath;
    this.reservedPorts = new Set([22, 80, 443, 5432, 3306]); // System ports to avoid
  }

  /**
   * Load port configuration from .env.ports file
   */
  loadConfiguration() {
    const configFile = path.resolve(this.configPath);
    if (!fs.existsSync(configFile)) {
      throw new Error(`Port configuration file not found: ${configFile}`);
    }

    const config = {};
    const content = fs.readFileSync(configFile, 'utf8');
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, value] = trimmed.split('=');
        if (key && value) {
          // Resolve environment variables
          const resolvedValue = value.replace(/\${([^}]+)}/g, (match, envVar) => {
            const [varName, defaultValue] = envVar.split(':-');
            return process.env[varName] || defaultValue || '';
          });
          config[key.trim()] = resolvedValue.trim();
        }
      }
    }
    
    return config;
  }

  /**
   * Check if a port is available
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = createServer();
      
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      
      server.on('error', () => resolve(false));
    });
  }

  /**
   * Find what process is using a port
   */
  getPortUser(port) {
    try {
      const result = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: 'pipe' });
      const pid = result.trim();
      if (pid) {
        try {
          const processInfo = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8', stdio: 'pipe' });
          return { pid: parseInt(pid), process: processInfo.trim() };
        } catch (e) {
          return { pid: parseInt(pid), process: 'unknown' };
        }
      }
    } catch (e) {
      // Port is not in use
    }
    return null;
  }

  /**
   * Check if a process is one of our services
   */
  isOurService(processInfo) {
    if (!processInfo) return false;
    
    const ourProcesses = [
      'node', 'semantic-analysis', 'mqtt', 'aedes', 
      'vkb-server', 'copilot-http', 'json-rpc', 'health-monitor'
    ];
    
    return ourProcesses.some(proc => 
      processInfo.process.toLowerCase().includes(proc.toLowerCase())
    );
  }

  /**
   * Check service registry for known services
   */
  isKnownService(port) {
    try {
      const servicesFile = path.resolve('.services-running.json');
      if (fs.existsSync(servicesFile)) {
        const services = JSON.parse(fs.readFileSync(servicesFile, 'utf8'));
        
        // Known service-port mappings
        const servicePorts = {
          'vkb-server': 8080,
          'system-health-monitor': 9090,
          'mcp-server': 8081,
          'mqtt-broker': 1883
        };
        
        for (const serviceName of services.services || []) {
          if (servicePorts[serviceName] === port) {
            return serviceName;
          }
        }
      }
    } catch (error) {
      // Ignore errors reading service registry
    }
    
    return null;
  }

  /**
   * Allocate a port for a service
   * NO HARDCODED FALLBACKS - throws error if can't allocate preferred port
   */
  async allocatePort(serviceName, preferredPort, options = {}) {
    const { allowExisting = false, killExisting = false } = options;
    
    // Check if service already has a port allocated
    if (this.allocatedPorts.has(serviceName)) {
      const existingPort = this.allocatedPorts.get(serviceName);
      
      if (allowExisting && await this.isPortAvailable(existingPort)) {
        return existingPort;
      }
      
      // Service exists but port is not available, clean up
      this.deallocatePort(serviceName);
    }

    // Parse preferred port
    const port = parseInt(preferredPort);
    if (isNaN(port) || port < 1024 || port > 65535) {
      throw new Error(
        `Invalid port number for ${serviceName}: ${preferredPort}\n` +
        `Port must be a number between 1024 and 65535`
      );
    }

    // Check if port is reserved
    if (this.reservedPorts.has(port)) {
      throw new Error(
        `Cannot allocate reserved system port ${port} for ${serviceName}\n` +
        `Please choose a different port number in your configuration`
      );
    }

    // Check port availability
    const available = await this.isPortAvailable(port);
    
    if (!available) {
      const portUser = this.getPortUser(port);
      const knownService = this.isKnownService(port);
      
      // If it's a known service from our registry, check if it's actually the same service
      if (knownService) {
        if (knownService === serviceName) {
          console.log(`✅ Port ${port} is used by our registered service: ${knownService}`);
          console.log(`   Allowing ${serviceName} to proceed (service coexistence)`);
          
          // Don't actually allocate since it's already in use by our service
          return port;
        } else {
          console.log(`⚠️  Port ${port} is used by different service: ${knownService} (requested: ${serviceName})`);
          // Fall through to the port conflict handling below
        }
      }
      
      if (portUser && this.isOurService(portUser) && killExisting) {
        console.log(`🔄 Killing existing service on port ${port} (PID: ${portUser.pid})`);
        try {
          execSync(`kill ${portUser.pid}`, { stdio: 'pipe' });
          // Wait a moment for process to die
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Verify port is now available
          if (await this.isPortAvailable(port)) {
            console.log(`✅ Port ${port} freed successfully`);
          } else {
            throw new Error(`Failed to free port ${port} after killing process`);
          }
        } catch (e) {
          throw new Error(
            `Failed to kill existing process on port ${port}: ${e.message}`
          );
        }
      } else {
        // Port is in use and we can't/won't kill it
        const errorMsg = portUser
          ? `Port ${port} is in use by process '${portUser.process}' (PID: ${portUser.pid})`
          : `Port ${port} is in use by unknown process`;
          
        throw new Error(
          `❌ Cannot allocate port ${port} for ${serviceName}\n` +
          `${errorMsg}\n\n` +
          `Options:\n` +
          `1. Kill the process: kill ${portUser?.pid || '<PID>'}\n` +
          `2. Change the port in your .env.ports file\n` +
          `3. Set environment variable: ${serviceName.toUpperCase()}_PORT=<new_port>\n\n` +
          `NO AUTOMATIC FALLBACK - You must explicitly resolve this conflict.`
        );
      }
    }

    // Allocate the port
    this.allocatedPorts.set(serviceName, port);
    this.serviceRegistry.set(serviceName, {
      port,
      pid: null,
      health: 'unknown',
      allocatedAt: new Date()
    });

    console.log(`✅ Allocated port ${port} for ${serviceName}`);
    return port;
  }

  /**
   * Deallocate a port for a service
   */
  deallocatePort(serviceName) {
    const port = this.allocatedPorts.get(serviceName);
    if (port) {
      this.allocatedPorts.delete(serviceName);
      this.serviceRegistry.delete(serviceName);
      console.log(`🔄 Deallocated port ${port} for ${serviceName}`);
    }
  }

  /**
   * Update service status
   */
  updateServiceStatus(serviceName, status) {
    const service = this.serviceRegistry.get(serviceName);
    if (service) {
      Object.assign(service, status);
    }
  }

  /**
   * Get allocated port for a service
   */
  getPort(serviceName) {
    return this.allocatedPorts.get(serviceName);
  }

  /**
   * Get all allocated ports
   */
  getAllocations() {
    return new Map(this.allocatedPorts);
  }

  /**
   * Get service registry
   */
  getServiceRegistry() {
    return new Map(this.serviceRegistry);
  }

  /**
   * Clean up all allocations
   */
  cleanup() {
    console.log('🧹 Cleaning up port allocations...');
    this.allocatedPorts.clear();
    this.serviceRegistry.clear();
  }

  /**
   * Generate port allocation report
   */
  generateReport() {
    console.log('\n📊 Port Allocation Report:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (this.serviceRegistry.size === 0) {
      console.log('No ports currently allocated');
      return;
    }

    for (const [serviceName, info] of this.serviceRegistry) {
      const status = info.health === 'healthy' ? '✅' : 
                    info.health === 'unhealthy' ? '❌' : '❓';
      console.log(`${status} ${serviceName.padEnd(25)} Port: ${info.port.toString().padEnd(6)} PID: ${info.pid || 'N/A'}`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}