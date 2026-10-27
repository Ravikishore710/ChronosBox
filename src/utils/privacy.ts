/**
 * Privacy & Secret Masking Utilities for ChronosBox UI
 * Masks private kernel slugs, account usernames, database names, and lease tokens by default.
 */

export function maskKernelSlug(slug: string | null | undefined, reveal = false): string {
  if (!slug) return 'local-sandbox';
  if (reveal) return slug;
  const parts = slug.split('/');
  if (parts.length === 2) {
    const nameParts = parts[1].split('-');
    const tail = nameParts.slice(-2).join('-');
    return `••••••/••••-${tail}`;
  }
  return `••••••/${slug.slice(-8)}`;
}

export function maskSecretIdentifier(value: string | null | undefined, reveal = false): string {
  if (!value) return '••••••';
  if (reveal) return value;
  if (value.startsWith('chronos:ckpt:')) {
    const segments = value.split(':');
    return `chronos:ckpt:••••:${segments[segments.length - 1]}`;
  }
  if (value.startsWith('lease_')) {
    return `lease_••••••••${value.slice(-2)}`;
  }
  if (value.length <= 6) {
    return '••••••';
  }
  return `${value.slice(0, 2)}••••••${value.slice(-2)}`;
}

export function sanitizeDisplayText(text: string | null | undefined, reveal = false): string {
  if (!text) return '';
  if (reveal) return text;
  return text
    .replace(/raviikishore07\/[a-z0-9-]+/gi, (match) => maskKernelSlug(match, false))
    .replace(/RaviiKishore07/gi, 'usr_••••••07')
    .replace(/\bneondb\b/gi, 'db_••••••')
    .replace(/KGAT_[A-Za-z0-9_*]+/g, 'KGAT_••••••••');
}
