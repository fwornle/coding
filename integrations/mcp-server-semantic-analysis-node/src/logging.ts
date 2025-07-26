import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = "debug" | "info" | "warning" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

let logDir: string = "";
let logFile: string = "";

export function setupLogging(): void {
  // Create logs directory
  logDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // Create log file with timestamp
  const timestamp = new Date().toISOString().split('T')[0];
  logFile = path.join(logDir, `semantic-analysis-${timestamp}.log`);
  
  log("Logging system initialized", "info");
}

export function log(message: string, level: LogLevel = "info", data?: any): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data
  };
  
  // Write to stderr for debugging (visible in terminal)
  console.error(`[${entry.timestamp}] ${level.toUpperCase()}: ${message}`);
  if (data) {
    console.error(`  Data: ${JSON.stringify(data, null, 2)}`);
  }
  
  // Write to log file if initialized
  if (logFile) {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      console.error(`Failed to write to log file: ${error}`);
    }
  }
}

export function logRequest(method: string, params: any): void {
  log(`Request: ${method}`, "info", { params });
}

export function logResponse(method: string, response: any): void {
  log(`Response: ${method}`, "info", { response });
}

export function logError(error: Error | string, context?: string): void {
  const message = context ? `${context}: ${error}` : String(error);
  log(message, "error", error instanceof Error ? {
    name: error.name,
    message: error.message,
    stack: error.stack
  } : undefined);
}