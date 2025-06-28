/**
 * Shared Logger
 * Provides consistent logging across all agents and services
 */

import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class Logger {
  constructor(component = 'default') {
    this.component = component;
    this.winston = this.createLogger();
  }

  createLogger() {
    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
        return `${timestamp} [${level.toUpperCase()}] [${this.component}] ${message} ${metaStr}`;
      })
    );

    const transports = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      })
    ];

    // Add file transport if log file is specified
    const logFile = process.env.LOG_FILE;
    if (logFile) {
      transports.push(
        new winston.transports.File({
          filename: path.resolve(logFile),
          format: logFormat,
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5
        })
      );
    }

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      transports,
      exitOnError: false
    });
  }

  debug(message, ...args) {
    this.winston.debug(message, ...args);
  }

  info(message, ...args) {
    this.winston.info(message, ...args);
  }

  warn(message, ...args) {
    this.winston.warn(message, ...args);
  }

  error(message, ...args) {
    this.winston.error(message, ...args);
  }

  child(childComponent) {
    return new Logger(`${this.component}:${childComponent}`);
  }
}

export { Logger };