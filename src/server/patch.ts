import crypto from 'crypto';
import zlib from 'zlib';
import {
  Rfc6902PatchOp,
  StateCheckpoint,
  WorkspaceFile,
  CheckpointCompressionMetrics,
} from '../types/chronos.ts';
import { registerCasWorkspaceFiles } from './cache.ts';

export function computeRfc6902Patch(
  prevObj: Record<string, unknown> | null,
  nextObj: Record<string, unknown>,
  basePath = '/stateSnapshot/variables'
): Rfc6902PatchOp[] {
  if (!prevObj) {
    return Object.keys(nextObj).map((k) => ({
      op: 'add',
      path: `${basePath}/${k}`,
      value: nextObj[k],
    }));
  }
  const ops: Rfc6902PatchOp[] = [];
  const allKeys = new Set([...Object.keys(prevObj), ...Object.keys(nextObj)]);
  for (const key of allKeys) {
    const pVal = prevObj[key];
    const nVal = nextObj[key];
    if (!(key in nextObj)) {
      ops.push({ op: 'remove', path: `${basePath}/${key}` });
    } else if (!(key in prevObj)) {
      ops.push({ op: 'add', path: `${basePath}/${key}`, value: nVal });
    } else if (JSON.stringify(pVal) !== JSON.stringify(nVal)) {
      ops.push({ op: 'replace', path: `${basePath}/${key}`, value: nVal });
    }
  }
  return ops;
}

export function buildCheckpointCompressionMetrics(
  stepIndex: number,
  prevSnapshot: StateCheckpoint['stateSnapshot'] | null,
  nextSnapshot: StateCheckpoint['stateSnapshot'],
  files: WorkspaceFile[]
): CheckpointCompressionMetrics {
  const isKeyframe = stepIndex === 1 || stepIndex % 10 === 0 || !prevSnapshot;
  const fullPayloadStr = JSON.stringify({ stateSnapshot: nextSnapshot, files });
  const rawJsonBytes = Buffer.byteLength(fullPayloadStr, 'utf8');

  const patchOps = computeRfc6902Patch(
    prevSnapshot ? prevSnapshot.variables : null,
    nextSnapshot.variables
  );
  const deltaPayloadStr = isKeyframe
    ? fullPayloadStr
    : JSON.stringify({
        patchOps,
        lastActionSummary: nextSnapshot.lastActionSummary,
        fileHashes: files.map((f) => ({ path: f.path, sha256: f.sha256 })),
      });
  const rfc6902DeltaBytes = Buffer.byteLength(deltaPayloadStr, 'utf8');

  const compressedBuf = zlib.brotliCompressSync(Buffer.from(deltaPayloadStr, 'utf8'), {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
    },
  });
  const brotliCompressedBytes = compressedBuf.byteLength;
  const { deduplicatedCount, bytesSaved } = registerCasWorkspaceFiles(files);

  const compressionSavingPct =
    rawJsonBytes > 0
      ? Number(
          Math.max(0, ((rawJsonBytes - brotliCompressedBytes) / rawJsonBytes) * 100).toFixed(1)
        )
      : 0;

  return {
    isKeyframe,
    rawJsonBytes,
    rfc6902DeltaBytes,
    brotliCompressedBytes,
    compressionSavingPct,
    casDeduplicatedFiles: deduplicatedCount,
    casBytesSaved: bytesSaved,
    patchOps: patchOps.slice(0, 12),
  };
}

export function applyStateChannelReducers(
  prevVars: Record<string, unknown>,
  incomingVars: Record<string, unknown>
): { merged: Record<string, unknown>; reducerSummary: string } {
  const merged: Record<string, unknown> = { ...prevVars };
  const appliedRules: string[] = [];

  for (const [key, val] of Object.entries(incomingVars)) {
    const existing = merged[key];
    if (Array.isArray(existing) && Array.isArray(val)) {
      const deduped = Array.from(new Set([...existing, ...val].map((x) => JSON.stringify(x)))).map(
        (s) => JSON.parse(s)
      );
      merged[key] = deduped;
      appliedRules.push(`${key}:APPEND_UNIQUE`);
    } else if (
      typeof existing === 'number' &&
      typeof val === 'number' &&
      (key.toLowerCase().includes('count') ||
        key.toLowerCase().includes('saved') ||
        key.toLowerCase().includes('max'))
    ) {
      merged[key] = Math.max(existing, val);
      appliedRules.push(`${key}:NUMERIC_MAX`);
    } else if (
      existing &&
      val &&
      typeof existing === 'object' &&
      typeof val === 'object' &&
      !Array.isArray(existing) &&
      !Array.isArray(val)
    ) {
      merged[key] = {
        ...(existing as Record<string, unknown>),
        ...(val as Record<string, unknown>),
      };
      appliedRules.push(`${key}:DEEP_MERGE`);
    } else {
      merged[key] = val;
    }
  }

  return {
    merged,
    reducerSummary:
      appliedRules.length > 0
        ? `Deterministic Reducers (${appliedRules.slice(0, 3).join(', ')})`
        : 'Deterministic Channel Merge (LAST_VALUE + CAS)',
  };
}

export function generateW3CTraceparent(existingTraceId?: string): string {
  const traceId =
    existingTraceId && existingTraceId.length === 32
      ? existingTraceId
      : crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  return `00-${traceId}-${spanId}-01`;
}

export function computeUnifiedLineDiff(
  filePath: string,
  beforeText: string,
  afterText: string
): string {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const header = [
    `--- a${filePath}`,
    `+++ b${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  const body: string[] = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < Math.min(maxLen, 18); i++) {
    const bLine = beforeLines[i];
    const aLine = afterLines[i];
    if (bLine === aLine) {
      if (bLine !== undefined) body.push(` ${bLine}`);
    } else {
      if (bLine !== undefined) body.push(`-${bLine}`);
      if (aLine !== undefined) body.push(`+${aLine}`);
    }
  }
  return [...header, ...body].join('\n');
}
