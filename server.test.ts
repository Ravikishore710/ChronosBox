import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePostgresUrl, resolveKaggleSlug, computeRfc6902Patch } from './server.ts';
import {
  buildCheckpointCompressionMetrics,
  applyStateChannelReducers,
  computeUnifiedLineDiff,
  generateW3CTraceparent,
} from './src/server/patch.ts';
import {
  normalizeShellCommandAst,
  canonicalizeArgs,
  computeSemanticCommandEmbedding,
  cosineSimilarity8D,
  computeTrajectoryHash,
  computeWorkspaceMerkleRoot,
  buildFile,
} from './src/server/crypto.ts';
import {
  ChronosAdaptiveL1Cache,
  registerCasWorkspaceFiles,
  casBlobStore,
} from './src/server/cache.ts';
import {
  KagglePollSchema,
  SandboxExecSchema,
  CheckpointResumeSchema,
  DlqReplaySchema,
  CreateOrStepRunSchema,
  BenchmarkRunSchema,
} from './src/server/schemas.ts';

describe('ChronosBox Pure Server Functions & Subsystem Specs', () => {
  describe('resolvePostgresUrl', () => {
    it('extracts postgresql:// URL from POSTGRES_HOST when present', () => {
      const url = resolvePostgresUrl({
        POSTGRES_HOST: 'postgresql://user:pass@ep-neon.aws.neon.tech/neondb?sslmode=require',
        POSTGRES_DB: 'i only have neon url',
      });
      expect(url).toBe('postgresql://user:pass@ep-neon.aws.neon.tech/neondb?sslmode=require');
    });

    it('falls back to DATABASE_URL when POSTGRES_HOST is not a URL', () => {
      const url = resolvePostgresUrl({
        POSTGRES_HOST: 'localhost',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/chronos',
      });
      expect(url).toBe('postgres://postgres:postgres@localhost:5432/chronos');
    });

    it('returns null when no valid postgres connection string exists', () => {
      const url = resolvePostgresUrl({
        POSTGRES_HOST: 'invalid',
        POSTGRES_DB: 'none',
      });
      expect(url).toBeNull();
    });
  });

  describe('resolveKaggleSlug', () => {
    it('returns fallback when slug is incomplete or contains conversational spaces', () => {
      expect(resolveKaggleSlug('raviikishore07/', 'raviikishore07/kaggle-v7-production-t4')).toBe(
        'raviikishore07/kaggle-v7-production-t4'
      );
      expect(
        resolveKaggleSlug(
          'u can use if u can... but idk',
          'raviikishore07/nexoralm-300m-pretraining'
        )
      ).toBe('raviikishore07/nexoralm-300m-pretraining');
    });

    it('preserves valid owner/kernel slug', () => {
      expect(
        resolveKaggleSlug(
          'raviikishore07/kaggle-v7-production-t4',
          'raviikishore07/nexoralm-300m-pretraining'
        )
      ).toBe('raviikishore07/kaggle-v7-production-t4');
    });
  });

  describe('computeRfc6902Patch & Brotli Delta Compression', () => {
    it('computes add, replace, and remove RFC 6902 operations accurately', () => {
      const prev = { a: 1, b: 'old', removedKey: true };
      const next = { a: 1, b: 'updated', addedKey: 42 };
      const ops = computeRfc6902Patch(prev, next);

      expect(ops).toEqual(
        expect.arrayContaining([
          { op: 'replace', path: '/stateSnapshot/variables/b', value: 'updated' },
          { op: 'remove', path: '/stateSnapshot/variables/removedKey' },
          { op: 'add', path: '/stateSnapshot/variables/addedKey', value: 42 },
        ])
      );
      expect(ops.find((o) => o.path.endsWith('/a'))).toBeUndefined();
    });

    it('compresses intermediate checkpoint deltas with Brotli and tracks savings', () => {
      const files = [buildFile('/workspace/test.py', 'print("hello world")\n'.repeat(20))];
      const prevSnap = {
        variables: { longContext: 'A'.repeat(500), step: 1 },
        messagesCount: 2,
        lastActionSummary: 'Step 1',
      };
      const nextSnap = {
        variables: { longContext: 'A'.repeat(500), step: 2 },
        messagesCount: 3,
        lastActionSummary: 'Step 2',
      };
      const metrics = buildCheckpointCompressionMetrics(2, prevSnap, nextSnap, files);
      expect(metrics.isKeyframe).toBe(false);
      expect(metrics.brotliCompressedBytes).toBeLessThan(metrics.rawJsonBytes);
      expect(metrics.compressionSavingPct).toBeGreaterThan(50);
    });
  });

  describe('Deterministic State Channel Reducers', () => {
    it('applies APPEND_UNIQUE, NUMERIC_MAX, and DEEP_MERGE deterministically', () => {
      const prev = {
        artifacts: ['a.json', 'b.json'],
        savedTokensCount: 1200,
        telemetry: { gpu: 'T4', vramGb: 3.88 },
      };
      const incoming = {
        artifacts: ['b.json', 'c.json'],
        savedTokensCount: 900,
        telemetry: { step: 'COMPLETE' },
      };
      const { merged, reducerSummary } = applyStateChannelReducers(prev, incoming);
      expect(merged.artifacts).toEqual(['a.json', 'b.json', 'c.json']);
      expect(merged.savedTokensCount).toBe(1200);
      expect(merged.telemetry).toEqual({ gpu: 'T4', vramGb: 3.88, step: 'COMPLETE' });
      expect(reducerSummary).toContain('APPEND_UNIQUE');
    });
  });

  describe('Hybrid Two-Tier Trajectory Hashing & Semantic Similarity', () => {
    it('normalizes CLI flag order so flag permutations produce identical SHA-256 hashes', () => {
      const cmdA = 'pip install --no-cache-dir -q torch==2.11.0';
      const cmdB = 'pip install torch==2.11.0 --quiet --no-cache';

      expect(normalizeShellCommandAst(cmdA)).toBe(normalizeShellCommandAst(cmdB));

      const hashA = computeTrajectoryHash(
        'exec_sandbox_bash',
        { command: cmdA, timestamp: 111 },
        'EXIT_1'
      );
      const hashB = computeTrajectoryHash(
        'exec_sandbox_bash',
        { command: cmdB, timestamp: 999 },
        'EXIT_1'
      );
      expect(hashA.hash).toBe(hashB.hash);
    });

    it('computes high cosine similarity (> 0.88) for semantically near-identical failed commands', () => {
      const emb1 = computeSemanticCommandEmbedding(
        'pip install cuda-bindings-broken==99.0.0 --no-input',
        'EXIT_CODE_1_DEPENDENCY_NOT_FOUND'
      );
      const emb2 = computeSemanticCommandEmbedding(
        'pip install cuda-bindings-broken==99.0.1 --no-input',
        'EXIT_CODE_1_DEPENDENCY_NOT_FOUND'
      );
      const sim = cosineSimilarity8D(emb1, emb2);
      expect(sim).toBeGreaterThan(0.88);
    });
  });

  describe('Adaptive L1 Cache & CAS Deduplication', () => {
    beforeEach(() => {
      casBlobStore.clear();
    });

    it('stores, retrieves, and tracks hit rate in ChronosAdaptiveL1Cache', () => {
      const cache = new ChronosAdaptiveL1Cache();
      cache.set('ckpt:1', { id: 'ckpt_1' }, 60);
      expect(cache.get('ckpt:1')).toEqual({ id: 'ckpt_1' });
      expect(cache.get('ckpt:missing')).toBeNull();
      expect(cache.getStats().hitCount).toBe(1);
      expect(cache.getStats().missCount).toBe(1);
    });

    it('deduplicates identical workspace files in Content-Addressable Storage', () => {
      const fileA = buildFile('/workspace/a.txt', 'deterministic_content');
      const firstPass = registerCasWorkspaceFiles([fileA]);
      expect(firstPass.deduplicatedCount).toBe(0);

      const secondPass = registerCasWorkspaceFiles([fileA]);
      expect(secondPass.deduplicatedCount).toBe(1);
      expect(secondPass.bytesSaved).toBe(fileA.sizeBytes);
    });
  });

  describe('Zod API Boundary Validation Schemas', () => {
    it('rejects empty sandbox execution commands and accepts valid payloads', () => {
      const invalid = SandboxExecSchema.safeParse({ runId: 'run_1', command: '' });
      expect(invalid.success).toBe(false);

      const valid = SandboxExecSchema.safeParse({
        runId: 'run_1',
        command: 'pytest -q',
      });
      expect(valid.success).toBe(true);
    });

    it('validates CheckpointResumeSchema actionType enum', () => {
      expect(
        CheckpointResumeSchema.safeParse({
          runId: 'run_1',
          checkpointId: 'ckpt_1',
          actionType: 'INVALID_ACTION',
        }).success
      ).toBe(false);

      expect(
        CheckpointResumeSchema.safeParse({
          runId: 'run_1',
          checkpointId: 'ckpt_1',
          actionType: 'WEBHOOK_RESUME',
        }).success
      ).toBe(true);
    });

    it('validates DlqReplaySchema, CreateOrStepRunSchema, KagglePollSchema, and BenchmarkRunSchema', () => {
      expect(DlqReplaySchema.safeParse({ dlqId: 'dlq_1', patchedCommand: 'pip install torch' }).success).toBe(true);
      expect(CreateOrStepRunSchema.safeParse({ objectivePrompt: 'Verify kernel' }).success).toBe(true);
      expect(KagglePollSchema.safeParse({ runId: 'run_1' }).success).toBe(true);
      expect(BenchmarkRunSchema.safeParse({ iterations: 5000 }).success).toBe(true);
    });

    it('generates valid W3C traceparent and unified line diffs', () => {
      const tp = generateW3CTraceparent();
      expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

      const diff = computeUnifiedLineDiff('/workspace/req.txt', 'torch==1.0\n', 'torch==2.0\n');
      expect(diff).toContain('-torch==1.0');
      expect(diff).toContain('+torch==2.0');
      expect( computeWorkspaceMerkleRoot([]) ).toHaveLength(64);
    });
  });
});
