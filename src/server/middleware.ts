import crypto from 'crypto';
import path from 'path';
import express from 'express';
import { logger, formatErrorMessage } from './logger.ts';

export function redactSensitiveTokens(input: string): string {
  if (!input) return '';
  return input
    .replace(/KGAT_[A-Za-z0-9_]{12,}/g, 'KGAT_[REDACTED]')
    .replace(/AIza[0-9A-Za-z-_]{20,}/g, 'AIza[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/gi, '$1[REDACTED]$3')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]');
}

export function sanitizeWorkspacePath(rawPath: string | undefined): string {
  const fallback = '/workspace/sandbox_mutation.log';
  if (!rawPath || typeof rawPath !== 'string') return fallback;
  const normalized = path.posix.normalize(
    rawPath.startsWith('/') ? rawPath : `/workspace/${rawPath}`
  );
  if (normalized.includes('..') || !normalized.startsWith('/workspace/')) {
    throw new Error(`Invalid workspace path "${rawPath}": path must reside within /workspace/`);
  }
  return normalized;
}

export function securityHeadersMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const requestId =
    (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
    `req_${crypto.randomBytes(8).toString('hex')}`;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

export function createRateLimiter(maxRequestsPerWindow = 180, windowMs = 60000) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const clientKey = req.ip || 'local';
    const now = Date.now();
    const existing = buckets.get(clientKey);
    if (!existing || now > existing.resetAt) {
      buckets.set(clientKey, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > maxRequestsPerWindow) {
      res.status(429).json({
        error: 'Rate limit exceeded. Please retry after current window resets.',
      });
      return;
    }
    next();
  };
}

export function errorHandlerMiddleware(
  err: unknown,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction
): void {
  const message = formatErrorMessage(err);
  logger.error({ path: req.path, method: req.method, err: message }, 'Unhandled route error');
  if (!res.headersSent) {
    res.status(500).json({ error: message || 'Internal server error' });
  }
}
