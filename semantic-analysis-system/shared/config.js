/**
 * Configuration Management
 * Centralized configuration loading and validation
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ConfigManager {
  constructor(options = {}) {
    this.configPath = options.configPath || resolve(__dirname, '../config');
    this.envFile = options.envFile || '.env';
    this.config = {};
    
    this.loadConfiguration();
  }

  loadConfiguration() {
    // Load environment variables
    this.loadEnvironment();
    
    // Load YAML configuration
    this.loadYamlConfig();
    
    // Apply environment overrides
    this.applyEnvironmentOverrides();
  }

  loadEnvironment() {
    try {
      const envPath = resolve(process.cwd(), this.envFile);
      dotenv.config({ path: envPath });
    } catch (error) {
      console.warn('No .env file found, using environment variables only');
    }
  }

  loadYamlConfig() {
    try {
      const configFile = resolve(this.configPath, 'agents.yaml');
      const yamlContent = readFileSync(configFile, 'utf8');
      this.config = yaml.load(yamlContent);
      
      // Replace environment variable placeholders
      this.config = this.interpolateEnvironmentVariables(this.config);
    } catch (error) {
      console.warn('Failed to load YAML config, using defaults:', error.message);
      this.config = this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    return {
      agents: {
        'semantic-analysis': {
          enabled: true,
          llm: {
            primary: 'claude',
            fallback: 'openai'
          }
        }
      },
      infrastructure: {
        mqtt: {
          broker: {
            host: 'localhost',
            port: 1883
          }
        },
        jsonrpc: {
          server: {
            port: 8080
          }
        }
      }
    };
  }

  interpolateEnvironmentVariables(obj) {
    if (typeof obj === 'string') {
      return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
        return process.env[varName] || match;
      });
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateEnvironmentVariables(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateEnvironmentVariables(value);
      }
      return result;
    }
    
    return obj;
  }

  applyEnvironmentOverrides() {
    // Apply specific environment variable overrides
    const envOverrides = {
      'infrastructure.mqtt.broker.host': process.env.MQTT_BROKER_HOST,
      'infrastructure.mqtt.broker.port': process.env.MQTT_BROKER_PORT,
      'infrastructure.jsonrpc.server.port': process.env.JSON_RPC_PORT,
      'agents.semantic-analysis.llm.primary': process.env.DEFAULT_LLM_PROVIDER
    };

    for (const [path, value] of Object.entries(envOverrides)) {
      if (value !== undefined) {
        this.setNestedValue(this.config, path, value);
      }
    }
  }

  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  get(path, defaultValue = null) {
    return this.getNestedValue(this.config, path) || defaultValue;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  getAgentConfig(agentName) {
    return this.get(`agents.${agentName}`, {});
  }

  getInfrastructureConfig(component) {
    return this.get(`infrastructure.${component}`, {});
  }

  isAgentEnabled(agentName) {
    return this.get(`agents.${agentName}.enabled`, false);
  }

  getLLMConfig(agentName) {
    return this.get(`agents.${agentName}.llm`, {
      primary: 'claude',
      fallback: 'openai'
    });
  }

  getMQTTConfig() {
    return {
      brokerUrl: `mqtt://${this.get('infrastructure.mqtt.broker.host', 'localhost')}:${this.get('infrastructure.mqtt.broker.port', 1883)}`,
      ...this.get('infrastructure.mqtt.client', {})
    };
  }

  getJSONRPCConfig() {
    return this.get('infrastructure.jsonrpc.server', {
      port: 8080,
      host: '0.0.0.0'
    });
  }

  validate() {
    const errors = [];
    
    // Validate required environment variables for LLM providers
    const llmProviders = new Set();
    
    for (const agentConfig of Object.values(this.get('agents', {}))) {
      if (agentConfig.llm?.primary) {
        llmProviders.add(agentConfig.llm.primary);
      }
      if (agentConfig.llm?.fallback) {
        llmProviders.add(agentConfig.llm.fallback);
      }
    }
    
    if (llmProviders.has('claude') && !process.env.ANTHROPIC_API_KEY) {
      errors.push('ANTHROPIC_API_KEY is required when using Claude LLM provider');
    }
    
    if (llmProviders.has('openai') && !process.env.OPENAI_API_KEY) {
      errors.push('OPENAI_API_KEY is required when using OpenAI LLM provider');
    }
    
    // Validate knowledge base path
    if (!process.env.CODING_KB_PATH) {
      errors.push('CODING_KB_PATH environment variable is required');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  reload() {
    this.loadConfiguration();
  }
}