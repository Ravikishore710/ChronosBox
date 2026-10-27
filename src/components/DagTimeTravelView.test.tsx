import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DagTimeTravelView } from './DagTimeTravelView.tsx';
import { DurableRun, RunStatus, WorkflowType, StateCheckpoint } from '../types/chronos.ts';

afterEach(() => {
  cleanup();
});

const mockRuns: DurableRun[] = [
  {
    id: 'run_zero_ram_fdtd',
    threadId: 'th_pgvec_99481a',
    name: 'Project Zero-RAM FDTD GPU (ZR-LLM-COSIM-030)',
    description: 'Durable co-simulation verifier',
    workflowType: WorkflowType.KAGGLE_RECONCILIATION,
    kaggleKernelSlug: 'raviikishore07/project-zero-ram-fdtd-gpu',
    status: RunStatus.PAUSED_WEBHOOK,
    currentCheckpointId: 'ckpt_zr_002',
    tokensUsed: 4280,
    costUsd: 0.0128,
    savedCostUsd: 1.84,
    strikeCount: 0,
    maxStrikes: 3,
    rollbackCount: 0,
    sandboxQuotas: {
      maxMemoryMb: 512,
      usedMemoryMb: 118,
      timeoutMs: 30000,
      cpuShares: 1024,
      egressWhitelist: ['www.kaggle.com'],
      networkIsolationMode: 'STRICT_ALLOWLIST',
    },
    createdAt: '2026-10-25T12:30:00.000Z',
    updatedAt: '2026-10-25T12:41:00.000Z',
  },
];

const mockCheckpoints: StateCheckpoint[] = [
  {
    id: 'ckpt_zr_001',
    runId: 'run_zero_ram_fdtd',
    parentCheckpointId: null,
    stepIndex: 1,
    nodeName: 'fetch_kaggle_zr_llm_cosim_030',
    phaseLabel: '01. Kaggle Bearer Auth & Artifact Fetch',
    status: 'COMMITTED',
    stateSnapshot: {
      variables: { overallVerdict: 'SURVIVES', ece: 0.12 },
      messagesCount: 2,
      lastActionSummary: 'Fetched initial artifact',
      pendingWebhookEvent: null,
      kaggleTelemetry: null,
    },
    workspaceMerkleRoot: 'a'.repeat(64),
    workspaceFiles: [
      {
        path: '/workspace/zr_report.json',
        content: '{"verdict":"SURVIVES"}',
        sizeBytes: 22,
        sha256: 'b'.repeat(64),
        updatedAt: '2026-10-25T12:30:00.000Z',
      },
    ],
    pgvectorEmbeddingPreview: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    redisCacheKey: 'chronos:ckpt:1',
    redisTtlSeconds: 86400,
    tokenDelta: 1200,
    costDeltaUsd: 0.003,
    latencyMs: 210,
    createdAt: '2026-10-25T12:30:00.000Z',
  },
  {
    id: 'ckpt_zr_002',
    runId: 'run_zero_ram_fdtd',
    parentCheckpointId: 'ckpt_zr_001',
    stepIndex: 2,
    nodeName: 'await_next_cosim_webhook',
    phaseLabel: '02. Durable Suspend in Neon PostgreSQL',
    status: 'PAUSED_WAIT',
    stateSnapshot: {
      variables: { overallVerdict: 'SURVIVES', ece: 0.091284 },
      messagesCount: 4,
      lastActionSummary: 'Paused awaiting webhook signal',
      pendingWebhookEvent: 'KAGGLE_KERNEL_NEXT_SWEEP_READY',
      kaggleTelemetry: null,
    },
    workspaceMerkleRoot: 'c'.repeat(64),
    workspaceFiles: [
      {
        path: '/workspace/zr_report.json',
        content: '{"verdict":"SURVIVES","ece":0.091284}',
        sizeBytes: 38,
        sha256: 'd'.repeat(64),
        updatedAt: '2026-10-25T12:35:00.000Z',
      },
    ],
    pgvectorEmbeddingPreview: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    redisCacheKey: 'chronos:ckpt:2',
    redisTtlSeconds: 86400,
    tokenDelta: 950,
    costDeltaUsd: 0.002,
    latencyMs: 145,
    createdAt: '2026-10-25T12:35:00.000Z',
  },
];

describe('DagTimeTravelView Component', () => {
  it('renders durable run queue, DAG checkpoints, and state diff variables', () => {
    render(
      <DagTimeTravelView
        runs={mockRuns}
        selectedRunId="run_zero_ram_fdtd"
        onSelectRun={vi.fn()}
        checkpoints={mockCheckpoints}
        discoveredKernels={[]}
        onPollKaggleKernel={vi.fn()}
        onResumeCheckpoint={vi.fn()}
        onRunGeminiAgentStep={vi.fn()}
        busyAction={null}
      />
    );

    expect(
      screen.getAllByText('Project Zero-RAM FDTD GPU (ZR-LLM-COSIM-030)').length
    ).toBeGreaterThan(0);
    expect(screen.getByText('fetch_kaggle_zr_llm_cosim_030')).toBeTruthy();
    expect(screen.getByText('await_next_cosim_webhook')).toBeTruthy();
    expect(screen.getByText('0.091284')).toBeTruthy();
  });

  it('invokes onResumeCheckpoint with HUMAN_APPROVAL and WEBHOOK_RESUME when triggered', () => {
    const onResumeMock = vi.fn().mockResolvedValue(undefined);
    render(
      <DagTimeTravelView
        runs={mockRuns}
        selectedRunId="run_zero_ram_fdtd"
        onSelectRun={vi.fn()}
        checkpoints={mockCheckpoints}
        discoveredKernels={[]}
        onPollKaggleKernel={vi.fn()}
        onResumeCheckpoint={onResumeMock}
        onRunGeminiAgentStep={vi.fn()}
        busyAction={null}
      />
    );

    const approvalBtn = screen.getByText('Grant Human Approval');
    fireEvent.click(approvalBtn);
    expect(onResumeMock).toHaveBeenCalledWith('run_zero_ram_fdtd', 'ckpt_zr_002', 'HUMAN_APPROVAL');

    const webhookBtn = screen.getByText('Inject Webhook & Resume');
    fireEvent.click(webhookBtn);
    expect(onResumeMock).toHaveBeenCalledWith(
      'run_zero_ram_fdtd',
      'ckpt_zr_002',
      'WEBHOOK_RESUME',
      expect.objectContaining({ event: 'KAGGLE_KERNEL_NEXT_SWEEP_READY' })
    );
  });
});
