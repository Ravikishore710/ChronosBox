import express from 'express';
import {
  RunStatus,
  StateCheckpoint,
  TrajectoryEvent,
  DeadLetterDump,
  WorkspaceFile,
} from '../../types/chronos.ts';
import { SandboxExecSchema } from '../schemas.ts';
import { logger, formatErrorMessage } from '../logger.ts';
import { l1HotCache } from '../cache.ts';
import {
  computeWorkspaceMerkleRoot,
  computeTrajectoryHash,
  computeSemanticCommandEmbedding,
  cosineSimilarity8D,
} from '../crypto.ts';
import {
  applyStateChannelReducers,
  buildCheckpointCompressionMetrics,
  generateW3CTraceparent,
  computeUnifiedLineDiff,
} from '../patch.ts';
import {
  stateStore,
  liveDiagnostics,
  pgPool,
  acquirePostgresWorkerLease,
  syncStateToNeonPostgres,
  broadcastSseEvent,
} from '../db.ts';
import { executeWorkspaceCommand, collectContainerTelemetry } from '../sandboxRunner.ts';

export const sandboxRouter = express.Router();

sandboxRouter.post('/api/sandbox/exec', async (req, res) => {
  const parsed = SandboxExecSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid sandbox execution request payload',
      issues: parsed.error.issues,
    });
  }

  try {
    const { runId, toolName, command, targetFilePath, ProposedContent, simulateExitCode } =
      parsed.data;

    const run = stateStore.runs.find((r) => r.id === runId) || stateStore.runs[0];
    if (!run) {
      return res.status(404).json({ error: 'Target run not found' });
    }

    if (run.status === RunStatus.CIRCUIT_HALTED) {
      return res.status(409).json({
        error:
          'Run is halted by the 3-strike Hybrid Circuit Breaker. Patch & replay from the Dead-Letter Queue or rewind to an earlier checkpoint first.',
      });
    }

    const lease = await acquirePostgresWorkerLease(run.id, 'LAST_VALUE');
    run.workerLease = lease;

    const runCheckpoints = stateStore.checkpoints
      .filter((c) => c.runId === run.id)
      .sort((a, b) => a.stepIndex - b.stepIndex);
    const currentCp =
      runCheckpoints.find((c) => c.id === run.currentCheckpointId) ||
      runCheckpoints[runCheckpoints.length - 1];

    const preSnapshotFiles: WorkspaceFile[] = (currentCp?.workspaceFiles || []).map((f) => ({
      ...f,
    }));
    const preMerkleRoot = computeWorkspaceMerkleRoot(preSnapshotFiles);
    const startMs = Date.now();

    const execResult = await executeWorkspaceCommand({
      run,
      command,
      preSnapshotFiles,
      targetFilePath,
      proposedContent: ProposedContent,
      overrideExitCode: simulateExitCode,
    });

    const durationMs = Math.max(12, Date.now() - startMs);
    const {
      exitCode,
      semanticErrorClass,
      targetPath,
      beforeContent,
      attemptedContent,
      workingFiles,
    } = execResult;
    let { stdout, stderr } = execResult;

    const nowIso = new Date().toISOString();
    const {
      canonicalJson,
      hash: argSha256Hash,
      normalizedCommandSig,
      embedding: currentEmbedding,
    } = computeTrajectoryHash(toolName, { command, targetPath }, semanticErrorClass);

    const prevRunEvents = stateStore.trajectoryEvents.filter((e) => e.runId === run.id);
    let consecutiveStrikeNumber = 0;
    let highestCosineSim = 0;
    let loopMatchTier: TrajectoryEvent['loopMatchTier'] = 'NOMINAL';

    if (exitCode !== 0) {
      let trailingSimilarFailures = 0;
      for (let i = prevRunEvents.length - 1; i >= 0; i--) {
        const prevEv = prevRunEvents[i];
        if (prevEv.exitCode === 0) break;

        if (prevEv.argSha256Hash === argSha256Hash) {
          trailingSimilarFailures++;
          highestCosineSim = 1.0;
          loopMatchTier = 'TIER1_EXACT_SHA256';
        } else {
          const prevEmb = computeSemanticCommandEmbedding(
            prevEv.normalizedCommandSig || prevEv.canonicalArgsJson,
            semanticErrorClass
          );
          const sim = cosineSimilarity8D(currentEmbedding, prevEmb);
          if (sim >= 0.88) {
            trailingSimilarFailures++;
            highestCosineSim = Math.max(highestCosineSim, sim);
            if (loopMatchTier !== 'TIER1_EXACT_SHA256') {
              loopMatchTier = 'TIER2_PGVECTOR_COSINE';
            }
          } else {
            break;
          }
        }
      }
      consecutiveStrikeNumber = trailingSimilarFailures + 1;
    }

    let finalFiles = workingFiles;
    let postMerkleRoot = computeWorkspaceMerkleRoot(workingFiles);
    let wasRolledBack = false;
    let rollbackReason: string | null = null;
    let abortedFileDiff: TrajectoryEvent['abortedFileDiff'] = null;

    if (exitCode !== 0) {
      wasRolledBack = true;
      finalFiles = preSnapshotFiles;
      postMerkleRoot = preMerkleRoot;
      rollbackReason = `Command exited with code ${exitCode} (${loopMatchTier}, cosine=${highestCosineSim.toFixed(
        3
      )}). Sandbox automatically restored ${preSnapshotFiles.length} files to CAS Merkle root ${preMerkleRoot.slice(
        0,
        12
      )}.`;
      abortedFileDiff = {
        filePath: targetPath,
        beforeContent,
        attemptedContent,
        restoredContent: beforeContent,
        unifiedPatch: computeUnifiedLineDiff(targetPath, beforeContent, attemptedContent),
      };
      if (!stderr) {
        stderr = `Process exited with non-zero status code (${exitCode}) while executing "${command}". Dirty mutation on ${targetPath} was rolled back automatically.`;
      }
      stdout = `${stdout ? `${stdout}\n` : ''}Capturing pre-tool CAS Merkle snapshot (${preMerkleRoot.slice(
        0,
        12
      )}) -> Trapped exit code ${exitCode} -> Atomic rollback complete.`;
      run.rollbackCount += 1;
      run.strikeCount = consecutiveStrikeNumber;
    } else {
      stdout = `${stdout ? `${stdout}\n` : ''}Committed file mutation to ${targetPath} -> New Merkle root ${postMerkleRoot.slice(
        0,
        12
      )}.`;
      run.strikeCount = 0;
    }

    const nextStepIdx = (currentCp?.stepIndex || 0) + 1;
    const newCpId = `ckpt_sb_${Date.now().toString().slice(-5)}`;
    const isStrike3 = consecutiveStrikeNumber >= run.maxStrikes;
    const traceparent = generateW3CTraceparent();

    const { merged: mergedVars, reducerSummary } = applyStateChannelReducers(
      currentCp?.stateSnapshot.variables || {},
      {
        lastCommand: command,
        normalizedCommandAst: normalizedCommandSig,
        lastExitCode: exitCode,
        trajectorySha256: argSha256Hash.slice(0, 16),
        semanticCosineSimilarity: highestCosineSim,
        consecutiveStrikes: consecutiveStrikeNumber,
        wasRolledBack,
      }
    );

    const nextSnapshot: StateCheckpoint['stateSnapshot'] = {
      variables: mergedVars,
      messagesCount: (currentCp?.stateSnapshot.messagesCount || 1) + 1,
      lastActionSummary: isStrike3
        ? `Circuit breaker tripped on 3rd failure (${loopMatchTier}, hash ${argSha256Hash.slice(
            0,
            12
          )}). Execution halted and crash dump routed to DLQ.`
        : wasRolledBack
          ? rollbackReason!
          : `Executed "${command}" (exit 0) and updated workspace Merkle root.`,
      pendingWebhookEvent: null,
      reducerApplied: reducerSummary,
      kaggleTelemetry: currentCp?.stateSnapshot.kaggleTelemetry || null,
    };

    const newCp: StateCheckpoint = {
      id: newCpId,
      runId: run.id,
      parentCheckpointId: currentCp ? currentCp.id : null,
      stepIndex: nextStepIdx,
      nodeName: isStrike3
        ? 'circuit_breaker_halt_strike_3'
        : wasRolledBack
          ? `rollback_guard_step_${nextStepIdx}`
          : `sandbox_commit_step_${nextStepIdx}`,
      phaseLabel: isStrike3
        ? `0${nextStepIdx}. Circuit Breaker Halted (Strike 3/3 · ${loopMatchTier})`
        : wasRolledBack
          ? `0${nextStepIdx}. Atomic Rollback (Exit ${exitCode})`
          : `0${nextStepIdx}. Sandbox Command Committed`,
      status: isStrike3 ? 'HALTED_STRIKE_3' : wasRolledBack ? 'ROLLED_BACK' : 'COMMITTED',
      stateSnapshot: nextSnapshot,
      workspaceMerkleRoot: postMerkleRoot,
      workspaceFiles: finalFiles,
      pgvectorEmbeddingPreview: currentEmbedding,
      redisCacheKey: `chronos:ckpt:${run.threadId}:${newCpId}`,
      redisTtlSeconds: 86400,
      tokenDelta: 780,
      costDeltaUsd: 0.0023,
      latencyMs: durationMs,
      traceparent,
      compressionMetrics: buildCheckpointCompressionMetrics(
        nextStepIdx,
        currentCp?.stateSnapshot || null,
        nextSnapshot,
        finalFiles
      ),
      createdAt: nowIso,
    };

    const trajEvent: TrajectoryEvent = {
      id: `traj_${Date.now().toString().slice(-6)}`,
      runId: run.id,
      checkpointId: newCpId,
      stepIndex: nextStepIdx,
      toolName,
      canonicalArgsJson: canonicalJson,
      argSha256Hash,
      normalizedCommandSig,
      semanticSimilarityScore: highestCosineSim,
      loopMatchTier,
      traceparent,
      exitCode,
      consecutiveStrikeNumber,
      wasRolledBack,
      rollbackReason,
      preMerkleRoot,
      postMerkleRoot,
      abortedFileDiff,
      stdout,
      stderr,
      durationMs,
      tokensConsumed: 780,
      createdAt: nowIso,
    };

    l1HotCache.set(newCp.redisCacheKey, newCp, newCp.redisTtlSeconds);
    stateStore.checkpoints.push(newCp);
    stateStore.trajectoryEvents.push(trajEvent);

    if (pgPool && liveDiagnostics.postgresConnected) {
      const embStr = `[${currentEmbedding.join(',')}]`;
      pgPool
        .query(
          `INSERT INTO chronos_trajectory_pgvector (traj_id, run_id, tool_name, arg_sha256, normalized_sig, exit_code, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
           ON CONFLICT (traj_id) DO NOTHING;`,
          [trajEvent.id, run.id, toolName, argSha256Hash, normalizedCommandSig, exitCode, embStr]
        )
        .catch(() => {});
    }

    run.currentCheckpointId = newCpId;
    run.tokensUsed += 780;
    run.costUsd = Number((run.costUsd + 0.0023).toFixed(4));
    run.updatedAt = nowIso;

    let createdDlqDump: DeadLetterDump | null = null;
    if (isStrike3) {
      run.status = RunStatus.CIRCUIT_HALTED;
      run.savedCostUsd = Number((run.savedCostUsd + 42.0).toFixed(2));
      createdDlqDump = {
        id: `dlq_${Date.now().toString().slice(-5)}`,
        runId: run.id,
        runName: run.name,
        haltedAtCheckpointId: newCpId,
        triggerHash: argSha256Hash,
        toolName,
        canonicalArgsJson: canonicalJson,
        failureSignature: `${semanticErrorClass} :: ${normalizedCommandSig}`,
        consecutiveFailures: consecutiveStrikeNumber,
        burnedTokensBeforeHalt: 2340,
        burnedCostUsd: 0.007,
        estimatedOvernightCostSavedUsd: 42.0,
        crashDumpPayload: {
          engineVersion: 'ChronosBox-v2.5-Production',
          threadId: run.threadId,
          lastValidCheckpointId: currentCp?.id || newCpId,
          lastValidMerkleRoot: preMerkleRoot,
          identicalStrikeTimestamps: [nowIso, nowIso, nowIso],
          stderrTail: stderr,
          sandboxQuotas: run.sandboxQuotas,
          suggestedRemediation: `Fix command "${command}" or whitelist required network host, then replay from checkpoint ${
            currentCp?.id || newCpId
          }.`,
          detectionTier: loopMatchTier,
          pgvectorCosineSimilarity: highestCosineSim,
        },
        resolutionStatus: 'UNRESOLVED',
        createdAt: nowIso,
      };
      stateStore.dlqDumps.unshift(createdDlqDump);
    }

    await syncStateToNeonPostgres();
    broadcastSseEvent('sandbox_exec', {
      runId: run.id,
      checkpointId: newCp.id,
      exitCode,
      wasRolledBack,
    });
    res.json({
      run,
      checkpoint: newCp,
      trajectoryEvent: trajEvent,
      dlqDump: createdDlqDump,
    });
  } catch (err: unknown) {
    const message = formatErrorMessage(err);
    logger.error({ err: message }, 'Sandbox execution failed');
    res.status(500).json({ error: message || 'Sandbox execution failed' });
  }
});

sandboxRouter.get('/api/sandbox/metrics', (_req, res) => {
  const containers = collectContainerTelemetry(stateStore.runs);
  res.json({
    polledAt: new Date().toISOString(),
    containers,
  });
});
