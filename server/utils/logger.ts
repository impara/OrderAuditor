/**
 * Logger utility with log levels
 * Supports: error, warn, info, debug
 * 
 * Log levels hierarchy:
 * - error: Always shown
 * - warn: Shown if level >= warn
 * - info: Shown if level >= info
 * - debug: Shown if level >= debug
 * 
 * Environment variable LOG_LEVEL controls verbosity:
 * - production: defaults to 'info' (shows error, warn, info)
 * - development: defaults to 'debug' (shows everything)
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVELS.hasOwnProperty(envLevel)) {
    return envLevel;
  }
  // Default: 'info' for production, 'debug' for development
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const currentLogLevel = getLogLevel();
const currentLevelValue = LOG_LEVELS[currentLogLevel];

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= currentLevelValue;
}

export const logger = {
  error: (...args: any[]) => {
    if (shouldLog('error')) {
      console.error(`[${formatTime()}] [ERROR]`, ...args);
    }
  },

  warn: (...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn(`[${formatTime()}] [WARN]`, ...args);
    }
  },

  info: (...args: any[]) => {
    if (shouldLog('info')) {
      console.log(`[${formatTime()}] [INFO]`, ...args);
    }
  },

  debug: (...args: any[]) => {
    if (shouldLog('debug')) {
      console.log(`[${formatTime()}] [DEBUG]`, ...args);
    }
  },

  // Convenience method for express-style logging (always info level)
  log: (message: string, source = "express") => {
    if (shouldLog('info')) {
      console.log(`${formatTime()} [${source}] ${message}`);
    }
  },
};

