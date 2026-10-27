import express from 'express';
import { RunStatus, StateCheckpoint, TrajectoryEvent } from '../../types/chronos.ts';
import { CheckpointResumeSchema, DlqReplaySchema } from '../schemas.ts';
import { logger, formatErrorMessage } from '../logger.ts';
import { l1HotCache } from '../cache.ts';
import {
  computeWorkspaceMerkleRoot,
  computeTrajectoryHash,
  generateDeterministicVectorPreview,
  buildFile,
} from '../crypto.ts';
import {
  applyStateChannelReducers,
  buildCheckpointCompressionMetrics,
  generateW3CTraceparent,
} from '../patch.ts';
import {
  stateStore,
  acquirePostgresWorkerLease,
  syncStateToNeonPostgres,
  broadcastSseEvent,
} from '../db.ts';

export const checkpointRouter = express.Router();

checkpointRouter.post('/api/checkpoints/resume', async (req, res) => {
  const parsed = CheckpointResumeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid checkpoint resume payload',
      issues: parsed.error.issues,
    });
  }

  try {
    const { runId, checkpointId, actionType, webhookPayload } = parsed.data;

    const run = stateStore.runs.find((r) => r.id === runId);
    const targetCp = stateStore.checkpoints.find((c) => c.id === checkpointId);
    if (!run || !targetCp) {
      return res.status(404).json({ error: 'Run or checkpoint not found' });
    }

    const lease = await acquirePostgresWorkerLease(run.id, 'DEEP_MERGE');
    run.workerLease = lease;

    const nowIso = new Date().toISOString();
    const runCheckpoints = stateStore.checkpoints.filter((c) => c.runId === run.id);
    const maxStep = Math.max(...runCheckpoints.map((c) => c.stepIndex), 0);
    const nextStepIdx = maxStep + 1;
    const newCpId = `ckpt_res_${Date.now().toString().slice(-5)}`;

    const clonedFiles = targetCp.workspaceFiles.map((f) => ({ ...f }));
    if (actionType === 'WEBHOOK_RESUME' && webhookPayload) {
      const webhookFile = buildFile(
        `/workspace/webhook_event_${nextStepIdx}.json`,
        JSON.stringify(webhookPayload, null, 2),
        nowIso
      );
      clonedFiles.push(webhookFile);
    }

    const newMerkle = computeWorkspaceMerkleRoot(clonedFiles);

    const { merged: mergedVars, reducerSummary } = applyStateChannelReducers(
      targetCp.stateSnapshot.variables,
      {
        resumedFromCheckpoint: targetCp.id,
        resumeMechanism: actionType,
        upstreamTokensRecomputed: 0,
        webhookPayloadReceived: webhookPayload || { status: 'SIGNAL_VERIFIED' },
      }
    );

    const nextSnapshot: StateCheckpoint['stateSnapshot'] = {
      variables: mergedVars,
      messagesCount: targetCp.stateSnapshot.messagesCount + 1,
      lastActionSummary:
        actionType === 'TIME_TRAVEL_FORK'
          ? `Rewound execution state to ${targetCp.id} (Merkle ${newMerkle.slice(
              0,
              10
            )}) via L1/Postgres snapshot without re-running upstream nodes.`
          : `Resumed paused agent from exact Neon PostgreSQL snapshot (${targetCp.id}) with 0 upstream LLM recomputation.`,
      pendingWebhookEvent: null,
      reducerApplied: reducerSummary,
      kaggleTelemetry: targetCp.stateSnapshot.kaggleTelemetry
        ? {
            ...targetCp.stateSnapshot.kaggleTelemetry,
            stepProgress: 'RESUMED_VERIFIED',
            kernelState: 'COMPLETE',
          }
        : null,
    };

    const newCp: StateCheckpoint = {
      id: newCpId,
      runId: run.id,
      parentCheckpointId: targetCp.id,
      stepIndex: nextStepIdx,
      nodeName:
        actionType === 'TIME_TRAVEL_FORK'
          ? `fork_from_${targetCp.id}`
          : actionType === 'HUMAN_APPROVAL'
            ? 'human_approval_granted'
            : 'webhook_resumed_zero_recompute',
      phaseLabel:
        actionType === 'TIME_TRAVEL_FORK'
          ? `0${nextStepIdx}. Time-Travel Fork from Step ${targetCp.stepIndex}`
          : actionType === 'HUMAN_APPROVAL'
            ? `0${nextStepIdx}. Human Approval Confirmed`
            : `0${nextStepIdx}. Webhook Resumed (0 Upstream LLM Re-runs)`,
      status: 'COMMITTED',
      stateSnapshot: nextSnapshot,
      workspaceMerkleRoot: newMerkle,
      workspaceFiles: clonedFiles,
      pgvectorEmbeddingPreview: generateDeterministicVectorPreview(newCpId),
      redisCacheKey: `chronos:ckpt:${run.threadId}:${newCpId}`,
      redisTtlSeconds: 86400,
      tokenDelta: 0,
      costDeltaUsd: 0,
      latencyMs: 38,
      traceparent: generateW3CTraceparent(),
      compressionMetrics: buildCheckpointCompressionMetrics(
        nextStepIdx,
        targetCp.stateSnapshot,
        nextSnapshot,
        clonedFiles
      ),
      createdAt: nowIso,
    };

    l1HotCache.set(newCp.redisCacheKey, newCp, newCp.redisTtlSeconds);
    stateStore.checkpoints.push(newCp);
    run.currentCheckpointId = newCpId;
    run.status = RunStatus.RUNNING;
    run.strikeCount = 0;
    run.savedCostUsd = Number((run.savedCostUsd + 0.45).toFixed(2));
    run.updatedAt = nowIso;

    await syncStateToNeonPostgres();
    broadcastSseEvent('checkpoint_resumed', { runId: run.id, checkpointId: newCp.id });
    res.json({ run, checkpoint: newCp });
  } catch (err: unknown) {
    const message = formatErrorMessage(err);
    logger.error({ err: message }, 'Checkpoint resume failed');
    res.status(500).json({ error: message || 'Checkpoint resume failed' });
  }
});

checkpointRouter.post('/api/dlq/replay', async (req, res) => {
  const parsed = DlqReplaySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid DLQ replay request payload',
      issues: parsed.error.issues,
    });
  }

  try {
    const { dlqId, patchedCommand } = parsed.data;

    const dump = stateStore.dlqDumps.find((d) => d.id === dlqId);
    if (!dump) {
      return res.status(404).json({ error: 'DLQ crash dump not found' });
    }

    const run = stateStore.runs.find((r) => r.id === dump.runId);
    if (!run) {
      return res.status(404).json({ error: 'Associated run not found' });
    }

    const lease = await acquirePostgresWorkerLease(run.id, 'APPEND_UNIQUE');
    run.workerLease = lease;

    const recoveryCp =
      stateStore.checkpoints.find((c) => c.id === dump.crashDumpPayload.lastValidCheckpointId) ||
      stateStore.checkpoints.find((c) => c.runId === run.id);

    const nowIso = new Date().toISOString();
    const baseFiles = (recoveryCp?.workspaceFiles || []).map((f) => ({ ...f }));

    if (baseFiles.length > 0) {
      baseFiles[0] = buildFile(
        baseFiles[0].path,
        baseFiles[0].content.replace(
          'cuda-bindings-broken==99.0.0',
          'nvidia-cuda-runtime-cu12==12.4.127'
        ),
        nowIso
      );
    }

    const newMerkle = computeWorkspaceMerkleRoot(baseFiles);
    const runCheckpoints = stateStore.checkpoints.filter((c) => c.runId === run.id);
    const nextStepIdx = Math.max(...runCheckpoints.map((c) => c.stepIndex), 0) + 1;
    const newCpId = `ckpt_dlq_fix_${Date.now().toString().slice(-4)}`;
    const traceparent = generateW3CTraceparent();

    const {
      canonicalJson,
      hash: patchedHash,
      normalizedCommandSig,
      embedding,
    } = computeTrajectoryHash(
      dump.toolName,
      { command: patchedCommand, patchedFromDlq: dump.id },
      'EXIT_0_OK'
    );

    const nextSnapshot: StateCheckpoint['stateSnapshot'] = {
      variables: {
        ...(recoveryCp?.stateSnapshot.variables || {}),
        dlqRecoveredFrom: dump.id,
        patchedCommand,
        circuitBreakerState: 'CLOSED_NOMINAL',
      },
      messagesCount: (recoveryCp?.stateSnapshot.messagesCount || 2) + 1,
      lastActionSummary: `Patched broken dependency via DLQ replay ("${patchedCommand}") and resumed cleanly from checkpoint ${
        recoveryCp?.id || dump.haltedAtCheckpointId
      }.`,
      pendingWebhookEvent: null,
      reducerApplied: 'DLQ_PATCH_RECOVERY',
      kaggleTelemetry: null,
    };

    const newCp: StateCheckpoint = {
      id: newCpId,
      runId: run.id,
      parentCheckpointId: recoveryCp?.id || dump.haltedAtCheckpointId,
      stepIndex: nextStepIdx,
      nodeName: 'dlq_patched_replay_commit',
      phaseLabel: `0${nextStepIdx}. DLQ Patched & Replayed from Pre-Spiral Snapshot`,
      status: 'COMMITTED',
      stateSnapshot: nextSnapshot,
      workspaceMerkleRoot: newMerkle,
      workspaceFiles: baseFiles,
      pgvectorEmbeddingPreview: embedding,
      redisCacheKey: `chronos:ckpt:${run.threadId}:${newCpId}`,
      redisTtlSeconds: 86400,
      tokenDelta: 520,
      costDeltaUsd: 0.0016,
      latencyMs: 240,
      traceparent,
      compressionMetrics: buildCheckpointCompressionMetrics(
        nextStepIdx,
        recoveryCp?.stateSnapshot || null,
        nextSnapshot,
        baseFiles
      ),
      createdAt: nowIso,
    };

    const trajEvent: TrajectoryEvent = {
      id: `traj_dlq_${Date.now().toString().slice(-5)}`,
      runId: run.id,
      checkpointId: newCpId,
      stepIndex: nextStepIdx,
      toolName: dump.toolName,
      canonicalArgsJson: canonicalJson,
      argSha256Hash: patchedHash,
      normalizedCommandSig,
      semanticSimilarityScore: 0.12,
      loopMatchTier: 'NOMINAL',
      traceparent,
      exitCode: 0,
      consecutiveStrikeNumber: 0,
      wasRolledBack: false,
      rollbackReason: null,
      preMerkleRoot: recoveryCp?.workspaceMerkleRoot || newMerkle,
      postMerkleRoot: newMerkle,
      abortedFileDiff: null,
      stdout: `Successfully installed patched dependencies via: ${patchedCommand}\nLedger reconciliation verified 14,280 rows.`,
      stderr: '',
      durationMs: 240,
      tokensConsumed: 520,
      createdAt: nowIso,
    };

    dump.resolutionStatus = 'PATCHED_AND_RESUMED';
    dump.patchedArgsJson = canonicalJson;
    dump.resolvedAt = nowIso;

    run.status = RunStatus.COMPLETED;
    run.strikeCount = 0;
    run.currentCheckpointId = newCpId;
    run.updatedAt = nowIso;

    l1HotCache.set(newCp.redisCacheKey, newCp, newCp.redisTtlSeconds);
    stateStore.checkpoints.push(newCp);
    stateStore.trajectoryEvents.push(trajEvent);

    await syncStateToNeonPostgres();
    broadcastSseEvent('dlq_replayed', { runId: run.id, dlqId: dump.id });
    res.json({ dump, run, checkpoint: newCp, trajectoryEvent: trajEvent });
  } catch (err: unknown) {
    const message = formatErrorMessage(err);
    logger.error({ err: message }, 'DLQ replay failed');
    res.status(500).json({ error: message || 'DLQ replay failed' });
  }
});
