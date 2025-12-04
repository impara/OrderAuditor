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
const isProduction = process.env.NODE_ENV === 'production';

function formatTime(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= currentLevelValue;
}

function logJson(level: LogLevel, message: string, ...args: any[]) {
  const logEntry = {
    timestamp: formatTime(),
    level,
    message,
    context: args.length > 0 ? args : undefined,
  };
  console.log(JSON.stringify(logEntry));
}

function logText(level: LogLevel, message: string, ...args: any[]) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  
  const prefix = `[${time}] [${level.toUpperCase()}]`;
  
  if (level === 'error') {
    console.error(prefix, message, ...args);
  } else if (level === 'warn') {
    console.warn(prefix, message, ...args);
  } else {
    console.log(prefix, message, ...args);
  }
}

export const logger = {
  error: (message: string, ...args: any[]) => {
    if (shouldLog('error')) {
      if (isProduction) {
        logJson('error', message, ...args);
      } else {
        logText('error', message, ...args);
      }
    }
  },

  warn: (message: string, ...args: any[]) => {
    if (shouldLog('warn')) {
      if (isProduction) {
        logJson('warn', message, ...args);
      } else {
        logText('warn', message, ...args);
      }
    }
  },

  info: (message: string, ...args: any[]) => {
    if (shouldLog('info')) {
      if (isProduction) {
        logJson('info', message, ...args);
      } else {
        logText('info', message, ...args);
      }
    }
  },

  debug: (message: string, ...args: any[]) => {
    if (shouldLog('debug')) {
      if (isProduction) {
        logJson('debug', message, ...args);
      } else {
        logText('debug', message, ...args);
      }
    }
  },

  // Convenience method for express-style logging (always info level)
  log: (message: string, source = "express") => {
    if (shouldLog('info')) {
      if (isProduction) {
        logJson('info', `[${source}] ${message}`);
      } else {
        const time = new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });
        console.log(`${time} [${source}] ${message}`);
      }
    }
  },
};


