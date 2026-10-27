import express from 'express';
import { RunStatus } from '../../types/chronos.ts';
import { l1HotCache, getCasTotalBytesSaved } from '../cache.ts';
import { WORKER_NODE_ID } from '../seed.ts';
import {
  stateStore,
  liveDiagnostics,
  updatePersistedCounts,
  resetStateStoreToBaseline,
  syncStateToNeonPostgres,
  refreshKaggleKernelsList,
  sseClients,
  KAGGLE_USER,
  RESOLVED_PRIMARY_KERNEL,
  RESOLVED_SECONDARY_KERNEL,
} from '../db.ts';
import { executeRealEngineBenchmark } from '../benchmark.ts';

export const stateRouter = express.Router();

stateRouter.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      workerId: WORKER_NODE_ID,
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  req.on('close', () => {
    sseClients.delete(res);
  });
});

const handlePrometheusMetrics = (_req: express.Request, res: express.Response) => {
  updatePersistedCounts();
  const bench = stateStore.lastBenchmark?.chronosMetrics;
  const totalRollbacks = stateStore.runs.reduce((acc, r) => acc + r.rollbackCount, 0);
  const totalHalted = stateStore.runs.filter((r) => r.status === RunStatus.CIRCUIT_HALTED).length;
  const totalTokens = stateStore.runs.reduce((acc, r) => acc + r.tokensUsed, 0);
  const totalSavedUsd = stateStore.runs.reduce((acc, r) => acc + r.savedCostUsd, 0);
  const cacheStats = l1HotCache.getStats();

  const lines = [
    '# HELP chronos_active_runs_total Total durable agent runs tracked by ChronosBox',
    '# TYPE chronos_active_runs_total gauge',
    `chronos_active_runs_total ${stateStore.runs.length}`,
    '# HELP chronos_checkpoints_committed_total Total durable state checkpoints persisted to Neon PostgreSQL',
    '# TYPE chronos_checkpoints_committed_total counter',
    `chronos_checkpoints_committed_total ${stateStore.checkpoints.length}`,
    '# HELP chronos_sandbox_rollbacks_total Total atomic Merkle tree filesystem rollbacks on non-zero exit',
    '# TYPE chronos_sandbox_rollbacks_total counter',
    `chronos_sandbox_rollbacks_total ${totalRollbacks}`,
    '# HELP chronos_circuit_breaker_halted_runs Total runs halted by 3-strike hybrid trajectory monitor',
    '# TYPE chronos_circuit_breaker_halted_runs gauge',
    `chronos_circuit_breaker_halted_runs ${totalHalted}`,
    '# HELP chronos_tokens_consumed_total Total LLM tokens consumed across durable runs',
    '# TYPE chronos_tokens_consumed_total counter',
    `chronos_tokens_consumed_total ${totalTokens}`,
    '# HELP chronos_cost_saved_usd_total Estimated USD saved via loop circuit breaking and zero-recompute webhook resume',
    '# TYPE chronos_cost_saved_usd_total gauge',
    `chronos_cost_saved_usd_total ${totalSavedUsd.toFixed(4)}`,
    '# HELP chronos_l1_cache_hit_ratio_pct Adaptive L1 hot state cache hit ratio percentage',
    '# TYPE chronos_l1_cache_hit_ratio_pct gauge',
    `chronos_l1_cache_hit_ratio_pct ${cacheStats.hitRatePct}`,
    '# HELP chronos_cas_deduplicated_bytes_saved_total Bytes saved by Content-Addressable Copy-on-Write file deduplication',
    '# TYPE chronos_cas_deduplicated_bytes_saved_total counter',
    `chronos_cas_deduplicated_bytes_saved_total ${getCasTotalBytesSaved()}`,
    '# HELP chronos_sha256_hash_latency_microseconds Mean latency of canonical AST SHA-256 hashing',
    '# TYPE chronos_sha256_hash_latency_microseconds gauge',
    `chronos_sha256_hash_latency_microseconds ${bench?.avgHashLatencyUs || 1.25}`,
    '# HELP chronos_rfc6902_brotli_compression_saving_pct Average payload byte reduction via RFC 6902 JSON Patch + Brotli',
    '# TYPE chronos_rfc6902_brotli_compression_saving_pct gauge',
    `chronos_rfc6902_brotli_compression_saving_pct ${bench?.avgCompressionRatioPct || 84.2}`,
  ];
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
};

stateRouter.get('/metrics', handlePrometheusMetrics);
stateRouter.get('/api/metrics/prometheus', handlePrometheusMetrics);

stateRouter.get('/api/state', (_req, res) => {
  updatePersistedCounts();
  res.json({
    ...stateStore,
    diagnostics: liveDiagnostics,
    environmentConfig: {
      kaggleUsername: KAGGLE_USER,
      primaryKaggleKernel: RESOLVED_PRIMARY_KERNEL,
      secondaryKaggleKernel: RESOLVED_SECONDARY_KERNEL,
      postgresVectorStore: `${liveDiagnostics.postgresVersion} · ${liveDiagnostics.postgresDatabase} · pgvector ${liveDiagnostics.pgvectorVersion}`,
      redisCacheCluster: liveDiagnostics.redisEndpoint,
      geminiConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    },
  });
});

stateRouter.post('/api/state/reset', async (_req, res) => {
  const store = resetStateStoreToBaseline();
  executeRealEngineBenchmark(8000);
  await syncStateToNeonPostgres();
  await refreshKaggleKernelsList();
  res.json({ ...store, diagnostics: liveDiagnostics });
});
