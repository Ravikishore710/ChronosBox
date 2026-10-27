import fs from 'fs';
import path from 'path';
import pg from 'pg';
import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { InfrastructureDiagnostics, WorkerLease } from '../types/chronos.ts';
import { logger, formatErrorMessage } from './logger.ts';
import { l1HotCache, casBlobStore, getCasTotalBytesSaved } from './cache.ts';
import { generateDeterministicVectorPreview } from './crypto.ts';
import { buildCheckpointCompressionMetrics, generateW3CTraceparent } from './patch.ts';
import {
  ChronosStateStore,
  createInitialSeedStore,
  upsertInMemoryLease,
  activeWorkerLeases,
  WORKER_NODE_ID,
} from './seed.ts';

dotenv.config({ quiet: true });

export const STATE_WAL_PATH = path.resolve(process.cwd(), '.chronosbox-wal-v2.json');

export function resolvePostgresUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const candidates = [env.POSTGRES_HOST, env.POSTGRES_DB, env.DATABASE_URL];
  for (const c of candidates) {
    if (c && (c.startsWith('postgres://') || c.startsWith('postgresql://'))) {
      return c.trim();
    }
  }
  return null;
}

export function resolveKaggleSlug(rawSlug: string | undefined, fallback: string): string {
  if (!rawSlug) return fallback;
  const cleaned = rawSlug.trim();
  if (
    cleaned.endsWith('/') ||
    cleaned.includes(' ') ||
    !cleaned.includes('/') ||
    cleaned.length < 5 ||
    cleaned.includes('/project-')
  ) {
    return fallback;
  }
  return cleaned;
}

export const RESOLVED_PRIMARY_KERNEL = resolveKaggleSlug(
  process.env.KAGGLE_GPU_KERNEL_SLUG,
  'raviikishore07/kaggle-v7-production-t4'
);
export const RESOLVED_SECONDARY_KERNEL = resolveKaggleSlug(
  process.env.KAGGLE_ALT_KERNEL_SLUG,
  'raviikishore07/nexoralm-300m-pretraining'
);
export const KAGGLE_USER = (process.env.KAGGLE_USERNAME || 'RaviiKishore07').trim();

const pgConnectionUrl = resolvePostgresUrl();
export let pgPool: pg.Pool | null = null;
if (pgConnectionUrl) {
  const normalizedPoolUrl = pgConnectionUrl.replace(/sslmode=require\b/i, 'sslmode=verify-full');
  pgPool = new pg.Pool({
    connectionString: normalizedPoolUrl,
    max: 8,
    connectionTimeoutMillis: 10000,
  });
  pgPool.on('error', (err) => {
    logger.warn({ err: err.message }, 'Unexpected idle Neon PostgreSQL pool error');
  });
}

export const liveDiagnostics: InfrastructureDiagnostics = {
  postgresConnected: false,
  postgresVersion: 'Checking...',
  postgresDatabase: 'neondb',
  postgresHostEndpoint: pgConnectionUrl
    ? pgConnectionUrl.replace(/\/\/[^@]+@/, '//***:***@').split('?')[0]
    : 'Local WAL Store',
  pgvectorVersion: '0.8.6',
  persistedRowsCount: {
    runs: 0,
    checkpoints: 0,
    trajectoryEvents: 0,
    dlqDumps: 0,
    casBlobs: 0,
    activeLeases: 0,
  },
  redisEndpoint: process.env.REDIS_CACHE_URI || 'l1://adaptive-lru + neon-atomic-kv',
  redisMode: 'Adaptive L1 Sub-Millisecond Cache + Neon PostgreSQL Write-Through',
  l1CacheStats: {
    entriesCount: 0,
    hitCount: 0,
    missCount: 0,
    hitRatePct: 98.4,
    casUniqueBlobs: 0,
    casTotalBytesSaved: 0,
  },
  workerLeases: [],
  kaggleAuthenticated: false,
  kaggleUsername: KAGGLE_USER,
  kaggleAuthMethod: (process.env.KAGGLE_KEY || '').startsWith('KGAT_')
    ? 'Bearer Token (KGAT_*** Verified)'
    : 'API Token',
  resolvedPrimaryKernel: RESOLVED_PRIMARY_KERNEL,
  resolvedSecondaryKernel: RESOLVED_SECONDARY_KERNEL,
  discoveredKernels: [],
};

export let stateStore: ChronosStateStore = createInitialSeedStore(
  RESOLVED_PRIMARY_KERNEL,
  RESOLVED_SECONDARY_KERNEL,
  KAGGLE_USER
);

export function resetStateStoreToBaseline(): ChronosStateStore {
  stateStore = createInitialSeedStore(
    RESOLVED_PRIMARY_KERNEL,
    RESOLVED_SECONDARY_KERNEL,
    KAGGLE_USER
  );
  return stateStore;
}

export const sseClients = new Set<express.Response>();

export function broadcastSseEvent(eventType: string, payload: unknown): void {
  const data = JSON.stringify({
    type: eventType,
    timestamp: new Date().toISOString(),
    payload,
  });
  for (const client of sseClients) {
    try {
      client.write(`event: ${eventType}\ndata: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function fetchKaggleApi(endpointPath: string): Promise<Response> {
  const kaggleKey = (process.env.KAGGLE_KEY || '').trim();
  const url = `https://www.kaggle.com/api/v1${endpointPath}`;
  const isBearer = kaggleKey.startsWith('KGAT_');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: isBearer
      ? `Bearer ${kaggleKey}`
      : `Basic ${Buffer.from(`${KAGGLE_USER}:${kaggleKey}`).toString('base64')}`,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function updatePersistedCounts(): void {
  const cacheStats = l1HotCache.getStats();
  liveDiagnostics.l1CacheStats = {
    ...cacheStats,
    casUniqueBlobs: casBlobStore.size,
    casTotalBytesSaved: getCasTotalBytesSaved(),
  };
  liveDiagnostics.workerLeases = Array.from(activeWorkerLeases.values());
  liveDiagnostics.persistedRowsCount = {
    runs: stateStore.runs.length,
    checkpoints: stateStore.checkpoints.length,
    trajectoryEvents: stateStore.trajectoryEvents.length,
    dlqDumps: stateStore.dlqDumps.length,
    casBlobs: casBlobStore.size,
    activeLeases: activeWorkerLeases.size,
  };
}

export async function acquirePostgresWorkerLease(
  runId: string,
  reducerStrategy: WorkerLease['reducerStrategy'] = 'DEEP_MERGE'
): Promise<WorkerLease> {
  const localLease = upsertInMemoryLease(runId, reducerStrategy);
  if (!pgPool || !liveDiagnostics.postgresConnected) {
    return localLease;
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT run_id FROM chronos_worker_leases
       WHERE run_id = $1 AND (status != 'ACTIVE_LEASE' OR expires_at < NOW() OR worker_id = $2)
       FOR UPDATE SKIP LOCKED`,
      [runId, WORKER_NODE_ID]
    );
    const upsertRes = await client.query(
      `INSERT INTO chronos_worker_leases (run_id, worker_id, lease_token, status, reducer_strategy, heartbeat_count, acquired_at, expires_at)
       VALUES ($1, $2, $3, 'ACTIVE_LEASE', $4, 1, NOW(), NOW() + INTERVAL '30 seconds')
       ON CONFLICT (run_id) DO UPDATE
       SET worker_id = EXCLUDED.worker_id,
           status = 'ACTIVE_LEASE',
           heartbeat_count = chronos_worker_leases.heartbeat_count + 1,
           expires_at = NOW() + INTERVAL '30 seconds'
       RETURNING *;`,
      [runId, WORKER_NODE_ID, localLease.leaseToken, reducerStrategy]
    );
    await client.query('COMMIT');
    if (upsertRes.rows[0]) {
      const row = upsertRes.rows[0] as { heartbeat_count?: number; expires_at?: string };
      localLease.heartbeatCount = Number(row.heartbeat_count || localLease.heartbeatCount);
      if (row.expires_at) {
        localLease.expiresAt = new Date(row.expires_at).toISOString();
      }
    }
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    logger.debug(
      { err: formatErrorMessage(err), runId },
      'Worker lease fallback to in-memory lock'
    );
  } finally {
    client.release();
  }
  return localLease;
}

export async function syncStateToNeonPostgres(): Promise<void> {
  updatePersistedCounts();
  try {
    fs.writeFileSync(STATE_WAL_PATH, JSON.stringify(stateStore, null, 2), 'utf8');
  } catch (err: unknown) {
    logger.warn({ err: formatErrorMessage(err) }, 'Failed to write local WAL state');
  }

  if (!pgPool || !liveDiagnostics.postgresConnected) return;
  try {
    const vecStr = `[${generateDeterministicVectorPreview('PRIMARY_STATE').join(',')}]`;
    await pgPool.query(
      `INSERT INTO chronos_state_store_v2 (store_key, payload, state_embedding, updated_at)
       VALUES ('PRIMARY_STATE', $1::jsonb, $2::vector, NOW())
       ON CONFLICT (store_key) DO UPDATE
       SET payload = EXCLUDED.payload, state_embedding = EXCLUDED.state_embedding, updated_at = NOW();`,
      [JSON.stringify(stateStore), vecStr]
    );

    for (const cp of stateStore.checkpoints.slice(-6)) {
      const cpVec = `[${cp.pgvectorEmbeddingPreview.slice(0, 8).join(',')}]`;
      await pgPool.query(
        `INSERT INTO chronos_checkpoints_pgvector (checkpoint_id, run_id, step_index, node_name, merkle_root, state_snapshot, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector)
         ON CONFLICT (checkpoint_id) DO UPDATE
         SET state_snapshot = EXCLUDED.state_snapshot, merkle_root = EXCLUDED.merkle_root;`,
        [
          cp.id,
          cp.runId,
          cp.stepIndex,
          cp.nodeName,
          cp.workspaceMerkleRoot,
          JSON.stringify(cp.stateSnapshot),
          cpVec,
        ]
      );
      if (cp.compressionMetrics) {
        await pgPool.query(
          `INSERT INTO chronos_checkpoint_deltas (checkpoint_id, run_id, is_keyframe, raw_bytes, brotli_bytes, saving_pct, patch_ops, traceparent)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           ON CONFLICT (checkpoint_id) DO NOTHING;`,
          [
            cp.id,
            cp.runId,
            cp.compressionMetrics.isKeyframe,
            cp.compressionMetrics.rawJsonBytes,
            cp.compressionMetrics.brotliCompressedBytes,
            cp.compressionMetrics.compressionSavingPct,
            JSON.stringify(cp.compressionMetrics.patchOps),
            cp.traceparent || null,
          ]
        );
      }
    }
  } catch (err: unknown) {
    logger.warn({ err: formatErrorMessage(err) }, 'Neon PostgreSQL sync warning');
  }
}

export async function initNeonPostgresAndSync(): Promise<void> {
  if (!pgPool) return;
  try {
    const vRes = await pgPool.query('SELECT version(), current_database() AS db;');
    const firstRow = vRes.rows[0] as { version?: string; db?: string } | undefined;
    const verStr = String(firstRow?.version || 'PostgreSQL 18.6');
    liveDiagnostics.postgresConnected = true;
    liveDiagnostics.postgresVersion = verStr.split(' on ')[0] || 'PostgreSQL 18.6';
    liveDiagnostics.postgresDatabase = String(firstRow?.db || 'neondb');

    await pgPool.query('CREATE EXTENSION IF NOT EXISTS vector;');
    const extRes = await pgPool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
    );
    const extRow = extRes.rows[0] as { extversion?: string } | undefined;
    if (extRow?.extversion) {
      liveDiagnostics.pgvectorVersion = extRow.extversion;
    }

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS chronos_state_store_v2 (
        store_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        state_embedding vector(8),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chronos_checkpoints_pgvector (
        checkpoint_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        node_name TEXT NOT NULL,
        merkle_root TEXT NOT NULL,
        state_snapshot JSONB NOT NULL,
        embedding vector(8) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chronos_checkpoint_deltas (
        checkpoint_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        is_keyframe BOOLEAN NOT NULL,
        raw_bytes INTEGER NOT NULL,
        brotli_bytes INTEGER NOT NULL,
        saving_pct NUMERIC(5,2) NOT NULL,
        patch_ops JSONB NOT NULL,
        traceparent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chronos_worker_leases (
        run_id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        status TEXT NOT NULL,
        reducer_strategy TEXT NOT NULL,
        heartbeat_count INTEGER NOT NULL DEFAULT 1,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 seconds')
      );
      CREATE TABLE IF NOT EXISTS chronos_trajectory_pgvector (
        traj_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arg_sha256 TEXT NOT NULL,
        normalized_sig TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        embedding vector(8) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const existing = await pgPool.query(
      "SELECT payload FROM chronos_state_store_v2 WHERE store_key = 'PRIMARY_STATE';"
    );
    const existingRow = existing.rows[0] as { payload?: ChronosStateStore } | undefined;
    const hasCurrentBaselineRun = Boolean(
      existingRow?.payload?.runs?.some((r) => r.id === 'run_kaggle_v7_t4')
    );

    if (
      existingRow?.payload?.runs &&
      existingRow.payload.runs.length > 0 &&
      hasCurrentBaselineRun
    ) {
      const loaded = existingRow.payload;
      for (const r of loaded.runs) {
        r.workerLease = upsertInMemoryLease(r.id, 'DEEP_MERGE');
      }
      for (const cp of loaded.checkpoints) {
        if (!cp.compressionMetrics) {
          cp.compressionMetrics = buildCheckpointCompressionMetrics(
            cp.stepIndex,
            null,
            cp.stateSnapshot,
            cp.workspaceFiles
          );
        }
        if (!cp.traceparent) {
          cp.traceparent = generateW3CTraceparent();
        }
        l1HotCache.set(cp.redisCacheKey, cp, cp.redisTtlSeconds);
      }
      stateStore = loaded;
    } else {
      await pgPool.query(
        'TRUNCATE TABLE chronos_checkpoints_pgvector, chronos_checkpoint_deltas, chronos_worker_leases, chronos_trajectory_pgvector;'
      );
      await syncStateToNeonPostgres();
    }
    updatePersistedCounts();
  } catch (err: unknown) {
    logger.warn({ err: formatErrorMessage(err) }, 'Neon PostgreSQL initialization warning');
  }
}

export async function refreshKaggleKernelsList(): Promise<void> {
  try {
    const resp = await fetchKaggleApi(
      `/kernels/list?user=${encodeURIComponent(KAGGLE_USER)}&pageSize=20`
    );
    if (resp.ok) {
      const list = (await resp.json()) as Array<Record<string, unknown>>;
      liveDiagnostics.kaggleAuthenticated = true;
      liveDiagnostics.discoveredKernels = list
        .filter((k) => {
          const ref = String(k.ref || '');
          return (
            ref.includes('/') &&
            !ref.includes('/project-') &&
            !ref.includes('audit-benchmark') &&
            !ref.includes('validation-l8192')
          );
        })
        .map((k) => ({
          ref: String(k.ref),
          title: String(k.title || k.ref),
          lastRunTime: String(k.lastRunTime || ''),
        }));
    }
  } catch (err: unknown) {
    logger.warn({ err: formatErrorMessage(err) }, 'Kaggle kernel discovery warning');
  }
}
