import crypto from 'crypto';
import { WorkspaceFile } from '../types/chronos.ts';

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function normalizeShellCommandAst(rawCommand: string): string {
  if (!rawCommand) return '';
  const tokens = rawCommand
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((tok) => {
      if (tok === '--no-cache-dir' || tok === '--no-cache') return '--no-cache';
      if (tok === '-q' || tok === '--quiet' || tok === '--no-input') return '--quiet';
      if (/^--timeout=\d+$/.test(tok)) return '--timeout=<NORM>';
      return tok;
    });
  const flags = tokens.filter((t) => t.startsWith('-')).sort();
  const nonFlags = tokens.filter((t) => !t.startsWith('-'));
  return [...nonFlags, ...flags].join(' ');
}

export function canonicalizeArgs(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeArgs).join(',') + ']';
  }
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const parts = sortedKeys.map((k) => {
    if (k === 'timestamp' || k === 'requestId' || k === 'nonce') {
      return `${JSON.stringify(k)}:"<NORMALIZED>"`;
    }
    if (k === 'command' && typeof record[k] === 'string') {
      return `${JSON.stringify(k)}:${JSON.stringify(normalizeShellCommandAst(record[k] as string))}`;
    }
    return `${JSON.stringify(k)}:${canonicalizeArgs(record[k])}`;
  });
  return '{' + parts.join(',') + '}';
}

export function computeSemanticCommandEmbedding(commandText: string, errorClass: string): number[] {
  const normalized = `${normalizeShellCommandAst(commandText).toLowerCase()} :: ${errorClass.toLowerCase()}`;
  const buckets = new Array<number>(8).fill(0);
  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < trigram.length; j++) {
      h ^= trigram.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    const bucketIdx = Math.abs(h) % 8;
    const sign = (h & 1) === 0 ? 1 : -1;
    buckets[bucketIdx] += sign * 1.0;
  }
  const norm = Math.sqrt(buckets.reduce((acc, v) => acc + v * v, 0)) || 1;
  return buckets.map((v) => Number((v / norm).toFixed(4)));
}

export function cosineSimilarity8D(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? Number((dot / denom).toFixed(4)) : 0;
}

export function computeTrajectoryHash(
  toolName: string,
  args: unknown,
  semanticErrorClass: string
): {
  canonicalJson: string;
  hash: string;
  normalizedCommandSig: string;
  embedding: number[];
} {
  const canonicalJson = canonicalizeArgs(args);
  const cmdStr =
    args && typeof args === 'object' && 'command' in (args as Record<string, unknown>)
      ? String((args as Record<string, unknown>).command || '')
      : canonicalJson;
  const normalizedCommandSig = normalizeShellCommandAst(cmdStr);
  const payload = `${toolName}::${canonicalJson}::${semanticErrorClass}`;
  const embedding = computeSemanticCommandEmbedding(cmdStr, semanticErrorClass);
  return {
    canonicalJson,
    hash: sha256Hex(payload),
    normalizedCommandSig,
    embedding,
  };
}

export function computeWorkspaceMerkleRoot(files: WorkspaceFile[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const combined = sorted.map((f) => `${f.path}:${f.sha256}`).join('|');
  return sha256Hex(combined || 'EMPTY_TREE');
}

export function generateDeterministicVectorPreview(seedText: string): number[] {
  return computeSemanticCommandEmbedding(seedText, 'CHECKPOINT_STATE');
}

export function buildFile(
  filePath: string,
  content: string,
  timestamp = new Date().toISOString()
): WorkspaceFile {
  return {
    path: filePath,
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    sha256: sha256Hex(content),
    updatedAt: timestamp,
  };
}
