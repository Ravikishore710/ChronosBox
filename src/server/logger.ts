import pino from 'pino';

export const logger = pino({
  name: 'chronosbox-engine',
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      '*.apiKey',
      '*.password',
      '*.connectionString',
      '*.kaggleKey',
    ],
    censor: '[REDACTED]',
  },
});

export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
