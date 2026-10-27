import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TrajectoryCircuitView } from './TrajectoryCircuitView.tsx';
import {
  DurableRun,
  RunStatus,
  WorkflowType,
  TrajectoryEvent,
  DeadLetterDump,
} from '../types/chronos.ts';

afterEach(() => {
  cleanup();
});

const mockRuns: DurableRun[] = [
  {
    id: 'run_cron_dep_spiral',
    threadId: 'th_pgvec_44019c',
    name: 'Nightly Ledger & Dependency Reconciler',
    description: 'Scheduled data-reconciliation agent',
    workflowType: WorkflowType.CRON_DEPENDENCY_AUDIT,
    kaggleKernelSlug: null,
    status: RunStatus.CIRCUIT_HALTED,
    currentCheckpointId: 'ckpt_cr_002',
    tokensUsed: 3840,
    costUsd: 0.0115,
    savedCostUsd: 41.98,
    strikeCount: 3,
    maxStrikes: 3,
    rollbackCount: 3,
    sandboxQuotas: {
      maxMemoryMb: 512,
      usedMemoryMb: 94,
      timeoutMs: 20000,
      cpuShares: 1024,
      egressWhitelist: ['pypi.org'],
      networkIsolationMode: 'STRICT_ALLOWLIST',
    },
    createdAt: '2026-10-25T12:41:00.000Z',
    updatedAt: '2026-10-25T13:02:40.000Z',
  },
];

const mockTrajectoryEvents: TrajectoryEvent[] = [
  {
    id: 'traj_ok_1',
    runId: 'run_cron_dep_spiral',
    checkpointId: 'ckpt_cr_001',
    stepIndex: 1,
    toolName: 'exec_sandbox_bash',
    canonicalArgsJson: '{"command":"python3 verify.py"}',
    argSha256Hash: '1111aaaa2222bbbb',
    normalizedCommandSig: 'python3 verify.py',
    semanticSimilarityScore: 0,
    loopMatchTier: 'NOMINAL',
    exitCode: 0,
    consecutiveStrikeNumber: 0,
    wasRolledBack: false,
    preMerkleRoot: 'a'.repeat(64),
    postMerkleRoot: 'b'.repeat(64),
    stdout: 'Verified OK',
    stderr: '',
    durationMs: 180,
    tokensConsumed: 400,
    createdAt: '2026-10-25T12:41:00.000Z',
  },
  {
    id: 'traj_fail_3',
    runId: 'run_cron_dep_spiral',
    checkpointId: 'ckpt_cr_002',
    stepIndex: 4,
    toolName: 'exec_sandbox_bash',
    canonicalArgsJson: '{"command":"pip install cuda-bindings-broken==99.0.0"}',
    argSha256Hash: '9999ffff8888eeee',
    normalizedCommandSig: 'pip install cuda-bindings-broken==99.0.0',
    semanticSimilarityScore: 1.0,
    loopMatchTier: 'TIER1_EXACT_SHA256',
    exitCode: 1,
    consecutiveStrikeNumber: 3,
    wasRolledBack: true,
    preMerkleRoot: 'a'.repeat(64),
    postMerkleRoot: 'a'.repeat(64),
    stdout: '',
    stderr: 'ERROR: No matching distribution found for cuda-bindings-broken==99.0.0',
    durationMs: 420,
    tokensConsumed: 900,
    createdAt: '2026-10-25T12:44:00.000Z',
  },
];

const mockDlqDumps: DeadLetterDump[] = [
  {
    id: 'dlq_dump_901',
    runId: 'run_cron_dep_spiral',
    runName: 'Nightly Ledger & Dependency Reconciler',
    haltedAtCheckpointId: 'ckpt_cr_002',
    triggerHash: '9999ffff8888eeee',
    toolName: 'exec_sandbox_bash',
    canonicalArgsJson: '{"command":"pip install cuda-bindings-broken==99.0.0"}',
    failureSignature: 'EXIT_CODE_1_DEPENDENCY_NOT_FOUND',
    consecutiveFailures: 3,
    burnedTokensBeforeHalt: 2700,
    burnedCostUsd: 0.0081,
    estimatedOvernightCostSavedUsd: 41.98,
    crashDumpPayload: {
      engineVersion: 'ChronosBox-v2.5-Production',
      threadId: 'th_pgvec_44019c',
      lastValidCheckpointId: 'ckpt_cr_001',
      lastValidMerkleRoot: 'a'.repeat(64),
      identicalStrikeTimestamps: ['2026-10-25T12:44:00.000Z'],
      stderrTail: 'ERROR: No matching distribution',
      sandboxQuotas: mockRuns[0].sandboxQuotas,
      suggestedRemediation: 'Replace broken dependency pin and replay.',
    },
    resolutionStatus: 'UNRESOLVED',
    createdAt: '2026-10-25T13:02:40.000Z',
  },
];

describe('TrajectoryCircuitView Component', () => {
  it('filters trajectory events by SHA-256 hash and non-zero exit toggle', () => {
    render(
      <TrajectoryCircuitView
        runs={mockRuns}
        selectedRunId="run_cron_dep_spiral"
        onSelectRun={vi.fn()}
        trajectoryEvents={mockTrajectoryEvents}
        dlqDumps={mockDlqDumps}
        onReplayDlqDump={vi.fn()}
        busyAction={null}
      />
    );

    expect(screen.getByText('1111aaaa2222bbbb')).toBeTruthy();
    expect(screen.getByText('9999ffff8888eeee')).toBeTruthy();

    const filterBtn = screen.getByText('All Tool Invocations');
    fireEvent.click(filterBtn);
    expect(screen.queryByText('1111aaaa2222bbbb')).toBeNull();
    expect(screen.getByText('9999ffff8888eeee')).toBeTruthy();
  });

  it('invokes onReplayDlqDump with patched command when DLQ replay is submitted', () => {
    const onReplayMock = vi.fn().mockResolvedValue(undefined);
    render(
      <TrajectoryCircuitView
        runs={mockRuns}
        selectedRunId="run_cron_dep_spiral"
        onSelectRun={vi.fn()}
        trajectoryEvents={mockTrajectoryEvents}
        dlqDumps={mockDlqDumps}
        onReplayDlqDump={onReplayMock}
        busyAction={null}
      />
    );

    const replayBtn = screen.getByText('Patch & Replay From ckpt_cr_001');
    fireEvent.click(replayBtn);

    expect(onReplayMock).toHaveBeenCalledWith(
      'dlq_dump_901',
      'pip install nvidia-cuda-runtime-cu12==12.4.127 --no-input'
    );
  });
});
