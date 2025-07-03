/**
 * Health Monitor
 * 
 * Provides comprehensive health monitoring for all services
 */

import { createServer } from 'http';
import { ServiceLifecycleManager } from './lifecycle-manager.js';

export class HealthMonitor {
  constructor(port = 9090) {
    this.port = port;
    this.server = null;
    this.lifecycleManager = new ServiceLifecycleManager();
    this.running = false;
  }

  /**
   * Start the health monitor HTTP server
   */
  async start() {
    this.server = createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost:${this.port}`);
      
      try {
        switch (url.pathname) {
          case '/health':
            this.handleHealthCheck(req, res);
            break;
          case '/status':
            this.handleStatusCheck(req, res);
            break;
          case '/services':
            this.handleServicesCheck(req, res);
            break;
          default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        this.running = true;
        console.log(`✅ Health monitor started on port ${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the health monitor
   */
  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.running = false;
          console.log('✅ Health monitor stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Handle health check endpoint
   */
  handleHealthCheck(req, res) {
    const status = this.lifecycleManager.getStatus();
    const overallHealth = status.unhealthy === 0 ? 'healthy' : 'unhealthy';
    
    res.writeHead(overallHealth === 'healthy' ? 200 : 503);
    res.end(JSON.stringify({
      status: overallHealth,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        healthy: status.healthy,
        unhealthy: status.unhealthy,
        unknown: status.unknown
      }
    }));
  }

  /**
   * Handle detailed status check
   */
  handleStatusCheck(req, res) {
    const status = this.lifecycleManager.getStatus();
    
    res.writeHead(200);
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        pid: process.pid
      },
      services: status.services,
      ports: Object.fromEntries(status.ports),
      summary: {
        total: Object.keys(status.services).length,
        healthy: status.healthy,
        unhealthy: status.unhealthy,
        unknown: status.unknown
      }
    }));
  }

  /**
   * Handle services list endpoint
   */
  handleServicesCheck(req, res) {
    const status = this.lifecycleManager.getStatus();
    
    const services = Object.entries(status.services).map(([name, info]) => ({
      name,
      port: info.port,
      health: info.health,
      pid: info.pid,
      allocatedAt: info.allocatedAt
    }));

    res.writeHead(200);
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      services
    }));
  }

  /**
   * Check if health monitor is running
   */
  isRunning() {
    return this.running && this.server;
  }
}