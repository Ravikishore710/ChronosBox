import { describe, it, expect } from 'vitest';
import {
  redactSensitiveTokens,
  sanitizeWorkspacePath,
  createRateLimiter,
  securityHeadersMiddleware,
} from './middleware.ts';
import type { Request, Response } from 'express';

describe('Security & Rate Limiting Middleware', () => {
  it('redacts sensitive PostgreSQL URLs, Kaggle tokens, and Bearer credentials', () => {
    const raw =
      'Error connecting to postgresql://neondb_owner:secret123@ep-cool.neon.tech/neondb with KGAT_0273d79c91e00a29591af6c2423b77bd and Bearer eyJhbGciOiJIUzI1NiJ9';
    const scrubbed = redactSensitiveTokens(raw);
    expect(scrubbed).not.toContain('secret123');
    expect(scrubbed).not.toContain('KGAT_0273d79c91e00a29591af6c2423b77bd');
    expect(scrubbed).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(scrubbed).toContain('[REDACTED]');
    expect(scrubbed).toContain('KGAT_[REDACTED]');
  });

  it('prevents directory traversal and normalizes paths inside /workspace/', () => {
    expect(() => sanitizeWorkspacePath('../../etc/passwd')).toThrow(/Invalid workspace path/);
    expect(sanitizeWorkspacePath('/workspace/src/solver.py')).toBe('/workspace/src/solver.py');
    expect(sanitizeWorkspacePath('reports/metrics.json')).toBe('/workspace/reports/metrics.json');
  });

  it('attaches strict security headers and X-Request-Id', () => {
    const headers: Record<string, string> = {};
    const req = { headers: {} } as unknown as Request;
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
    } as unknown as Response;
    let nextCalled = false;

    securityHeadersMiddleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['X-Request-Id']).toMatch(/^req_/);
  });

  it('enforces token-bucket rate limits per client IP', () => {
    const limiter = createRateLimiter(2, 60_000);
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let jsonBody: unknown = null;

    const req = { ip: '10.0.0.42', socket: { remoteAddress: '10.0.0.42' } } as unknown as Request;
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (payload: unknown) => {
        jsonBody = payload;
        return res;
      },
    } as unknown as Response;

    let count = 0;
    limiter(req, res, () => {
      count++;
    });
    limiter(req, res, () => {
      count++;
    });
    limiter(req, res, () => {
      count++;
    });

    expect(count).toBe(2);
    expect(statusCode).toBe(429);
    expect(jsonBody).toMatchObject({ error: expect.stringContaining('Rate limit exceeded') });
  });
});
