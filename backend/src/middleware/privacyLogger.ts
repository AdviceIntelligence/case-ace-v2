import type { Request, Response, NextFunction } from 'express';

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  event: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  role?: string;
  purpose?: string;
  ttlSeconds?: number;
  region?: string;
  timestamp: string;
  error?: string;
}

const logBuffer: LogEntry[] = [];
const MAX_LOG_BUFFER_SIZE = 500;

export function getCapturedLogs(): readonly LogEntry[] {
  return [...logBuffer];
}

export function clearCapturedLogs(): void {
  logBuffer.length = 0;
}

export function writePrivacyLog(entry: Omit<LogEntry, 'timestamp'>): void {
  const fullEntry: LogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  logBuffer.push(fullEntry);
  if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }

  if (process.env.NODE_ENV !== 'test') {
    const output = JSON.stringify(fullEntry);
    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

export function privacyLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const sanitizedPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    const level: LogEntry['level'] = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    writePrivacyLog({
      level,
      event: 'HTTP_REQUEST',
      method: req.method,
      path: sanitizedPath,
      statusCode,
      durationMs,
    });
  });

  next();
}
