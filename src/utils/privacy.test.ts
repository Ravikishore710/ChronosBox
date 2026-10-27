import { describe, it, expect } from 'vitest';
import { maskKernelSlug, maskSecretIdentifier, sanitizeDisplayText } from './privacy.ts';

describe('UI Privacy & Secret Masking Utility', () => {
  it('masks private kernel slugs by default and reveals when requested', () => {
    expect(maskKernelSlug('raviikishore07/kaggle-v7-production-t4', false)).toBe(
      '••••••/••••-production-t4'
    );
    expect(maskKernelSlug('raviikishore07/kaggle-v7-production-t4', true)).toBe(
      'raviikishore07/kaggle-v7-production-t4'
    );
  });

  it('masks secret identifiers, cache keys, and lease tokens by default', () => {
    expect(maskSecretIdentifier('RaviiKishore07', false)).toBe('Ra••••••07');
    expect(maskSecretIdentifier('lease_9a8b7c6d', false)).toBe('lease_••••••••6d');
    expect(maskSecretIdentifier('chronos:ckpt:th_123:ckpt_01', false)).toBe(
      'chronos:ckpt:••••:ckpt_01'
    );
  });

  it('scrubs private kernel slugs, usernames, database names, and tokens from display strings', () => {
    const raw =
      'Fetched raviikishore07/kaggle-v7-production-t4 for RaviiKishore07 into neondb using KGAT_123456';
    const masked = sanitizeDisplayText(raw, false);
    expect(masked).not.toContain('raviikishore07');
    expect(masked).not.toContain('RaviiKishore07');
    expect(masked).not.toContain('neondb');
    expect(masked).not.toContain('KGAT_123456');
  });
});
