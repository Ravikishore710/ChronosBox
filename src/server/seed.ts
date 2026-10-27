import crypto from 'crypto';
import {
  DurableRun,
  RunStatus,
  WorkflowType,
  StateCheckpoint,
  TrajectoryEvent,
  DeadLetterDump,
  WorkspaceFile,
  BenchmarkTrialResult,
  WorkerLease,
} from '../types/chronos.ts';
import { l1HotCache } from './cache.ts';
import {
  sha256Hex,
  normalizeShellCommandAst,
  canonicalizeArgs,
  computeTrajectoryHash,
  computeWorkspaceMerkleRoot,
  generateDeterministicVectorPreview,
  buildFile,
} from './crypto.ts';
import {
  buildCheckpointCompressionMetrics,
  generateW3CTraceparent,
  computeUnifiedLineDiff,
} from './patch.ts';

export const WORKER_NODE_ID = `worker_node_${crypto.randomBytes(3).toString('hex')}`;
export const activeWorkerLeases = new Map<string, WorkerLease>();

export function upsertInMemoryLease(
  runId: string,
  reducerStrategy: WorkerLease['reducerStrategy'] = 'DEEP_MERGE'
): WorkerLease {
  const now = Date.now();
  const existing = activeWorkerLeases.get(runId);
  const lease: WorkerLease = {
    runId,
    workerId: WORKER_NODE_ID,
    leaseToken: existing?.leaseToken || `lease_${crypto.randomBytes(6).toString('hex')}`,
    status: 'ACTIVE_LEASE',
    acquiredAt: existing?.acquiredAt || new Date(now).toISOString(),
    expiresAt: new Date(now + 30000).toISOString(),
    heartbeatCount: (existing?.heartbeatCount || 0) + 1,
    reducerStrategy,
  };
  activeWorkerLeases.set(runId, lease);
  return lease;
}

export interface ChronosStateStore {
  runs: DurableRun[];
  checkpoints: StateCheckpoint[];
  trajectoryEvents: TrajectoryEvent[];
  dlqDumps: DeadLetterDump[];
  lastBenchmark: BenchmarkTrialResult | null;
}

function makeSeedCheckpoint(params: {
  id: string;
  runId: string;
  threadId: string;
  parentId: string | null;
  stepIndex: number;
  nodeName: string;
  phaseLabel: string;
  status: StateCheckpoint['status'];
  variables: Record<string, unknown>;
  summary: string;
  reducerApplied: string;
  pendingWebhookEvent?: string | null;
  kaggleTelemetry?: StateCheckpoint['stateSnapshot']['kaggleTelemetry'];
  files: WorkspaceFile[];
  tokenDelta: number;
  latencyMs: number;
  createdAt: string;
}): StateCheckpoint {
  const merkle = computeWorkspaceMerkleRoot(params.files);
  const snapshot: StateCheckpoint['stateSnapshot'] = {
    variables: params.variables,
    messagesCount: params.stepIndex * 2,
    lastActionSummary: params.summary,
    pendingWebhookEvent: params.pendingWebhookEvent || null,
    reducerApplied: params.reducerApplied,
    kaggleTelemetry: params.kaggleTelemetry || null,
  };
  const cp: StateCheckpoint = {
    id: params.id,
    runId: params.runId,
    parentCheckpointId: params.parentId,
    stepIndex: params.stepIndex,
    nodeName: params.nodeName,
    phaseLabel: params.phaseLabel,
    status: params.status,
    stateSnapshot: snapshot,
    workspaceMerkleRoot: merkle,
    workspaceFiles: params.files,
    pgvectorEmbeddingPreview: generateDeterministicVectorPreview(params.id),
    redisCacheKey: `chronos:ckpt:${params.threadId}:${params.id}`,
    redisTtlSeconds: 86400,
    tokenDelta: params.tokenDelta,
    costDeltaUsd: Number((params.tokenDelta * 0.000003).toFixed(4)),
    latencyMs: params.latencyMs,
    traceparent: generateW3CTraceparent(),
    compressionMetrics: buildCheckpointCompressionMetrics(
      params.stepIndex,
      null,
      snapshot,
      params.files
    ),
    createdAt: params.createdAt,
  };
  l1HotCache.set(cp.redisCacheKey, cp, cp.redisTtlSeconds);
  return cp;
}

export function createInitialSeedStore(
  primaryKernel: string,
  secondaryKernel: string,
  kaggleUser: string
): ChronosStateStore {
  const [t0, t1, t2, t3, t4] = [
    '2026-10-25T12:30:00.000Z',
    '2026-10-25T12:34:15.000Z',
    '2026-10-25T12:41:00.000Z',
    '2026-10-25T12:55:10.000Z',
    '2026-10-25T13:02:40.000Z',
  ];

  const zrReport = JSON.stringify({
    run_id: 'ZR-LLM-COSIM-030',
    kernel_ref: primaryKernel,
    overall_verdict: 'SURVIVES',
    operating_wavelength_nm: 940.0,
    expected_calibration_error_ece: 0.091284,
    thermal_300k_to_350k_ppl_drift_pct: -0.016557,
  });

  const run1Files1 = [
    buildFile('/workspace/kaggle_zero_ram/zr_llm_cosim_030_gpu.json', zrReport, t0),
    buildFile(
      '/workspace/kaggle_zero_ram/verify_cosim_invariants.py',
      'def verify_zr_cosim(r):\n    return r["overall_verdict"] == "SURVIVES"\n',
      t0
    ),
  ];
  const run1Files2 = [
    ...run1Files1,
    buildFile(
      '/workspace/kaggle_zero_ram/neon_pgvector_sync_manifest.json',
      JSON.stringify({ synced_kernel: primaryKernel, ece: 0.091284 }),
      t2
    ),
  ];
  const run2Files = [
    buildFile(
      '/workspace/holygrail_t4/production_300m_report_t4.json',
      JSON.stringify({ kernel_ref: secondaryKernel, kv_vram_saving_pct: 92.12 }),
      t1
    ),
    buildFile(
      '/workspace/holygrail_t4/requirements.lock',
      'torch==2.11.0+cu128\ntriton==3.2.0\n',
      t1
    ),
  ];

  const run3Files = [
    buildFile(
      '/workspace/cron_reconciler/pyproject.toml',
      '[project]\nname = "chronos-reconciler"\ndependencies = ["cuda-bindings-broken==99.0.0"]\n',
      t2
    ),
  ];

  const run1: DurableRun = {
    id: 'run_zero_ram_fdtd',
    threadId: 'th_pgvec_99481a',
    name: 'Project Zero-RAM FDTD GPU (ZR-LLM-COSIM-030)',
    description: 'Durable co-simulation verifier for raviikishore07/project-zero-ram-fdtd-gpu.',
    workflowType: WorkflowType.KAGGLE_RECONCILIATION,
    kaggleKernelSlug: primaryKernel,
    status: RunStatus.PAUSED_WEBHOOK,
    currentCheckpointId: 'ckpt_zr_003',
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
      egressWhitelist: ['www.kaggle.com', 'kaggleusercontent.com', 'pypi.org'],
      networkIsolationMode: 'STRICT_ALLOWLIST',
    },
    workerLease: upsertInMemoryLease('run_zero_ram_fdtd', 'DEEP_MERGE'),
    createdAt: t0,
    updatedAt: t2,
  };

  const run2: DurableRun = {
    id: 'run_holygrail_v7_t4',
    threadId: 'th_pgvec_77210b',
    name: 'Holygrail 300M V7 Production T4 (2x Tesla T4)',
    description: 'Durable verifier for raviikishore07/kaggle-v7-production-t4 (92.12% KV savings).',
    workflowType: WorkflowType.KAGGLE_RECONCILIATION,
    kaggleKernelSlug: secondaryKernel,
    status: RunStatus.RUNNING,
    currentCheckpointId: 'ckpt_hg_002',
    tokensUsed: 6190,
    costUsd: 0.0185,
    savedCostUsd: 3.42,
    strikeCount: 1,
    maxStrikes: 3,
    rollbackCount: 1,
    sandboxQuotas: {
      maxMemoryMb: 1024,
      usedMemoryMb: 342,
      timeoutMs: 45000,
      cpuShares: 2048,
      egressWhitelist: ['www.kaggle.com', 'kaggleusercontent.com', 'huggingface.co'],
      networkIsolationMode: 'STRICT_ALLOWLIST',
    },
    workerLease: upsertInMemoryLease('run_holygrail_v7_t4', 'NUMERIC_MAX'),
    createdAt: t1,
    updatedAt: t3,
  };

  const run3: DurableRun = {
    id: 'run_cron_dep_spiral',
    threadId: 'th_pgvec_44019c',
    name: 'Nightly Ledger & Dependency Reconciler (Cron)',
    description: 'Scheduled data-reconciliation agent halted after 3 identical semantic failures.',
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
      egressWhitelist: ['pypi.org', 'files.pythonhosted.org'],
      networkIsolationMode: 'STRICT_ALLOWLIST',
    },
    workerLease: upsertInMemoryLease('run_cron_dep_spiral', 'APPEND_UNIQUE'),
    createdAt: t2,
    updatedAt: t4,
  };

  const {
    canonicalJson: strikeCanonical,
    hash: strikeHash,
    normalizedCommandSig: strikeNormSig,
  } = computeTrajectoryHash(
    'exec_sandbox_bash',
    { command: 'pip install cuda-bindings-broken==99.0.0 --no-input' },
    'EXIT_CODE_1_DEPENDENCY_NOT_FOUND'
  );

  const zrTelemetry = {
    kernelSlug: primaryKernel,
    gpuDevice: 'Zero-RAM Photonic/FDTD Co-Sim GPU',
    vramUsedGb: 3.88,
    vramTotalGb: 14.56,
    stepProgress: 'ZR-LLM-COSIM-030 (85.28s)',
    fdtdGridThroughputGcells: 4.82,
    kernelState: 'COMPLETE',
  };

  const checkpoints: StateCheckpoint[] = [
    makeSeedCheckpoint({
      id: 'ckpt_zr_001',
      runId: run1.id,
      threadId: run1.threadId,
      parentId: null,
      stepIndex: 1,
      nodeName: 'fetch_kaggle_zr_llm_cosim_030',
      phaseLabel: '01. Kaggle Bearer Auth & ZR-LLM-COSIM-030 Artifact Fetch',
      status: 'COMMITTED',
      variables: {
        kaggleUsername: kaggleUser,
        kernelSlug: primaryKernel,
        overallVerdict: 'SURVIVES',
      },
      summary: 'Fetched live zr_llm_cosim_030_gpu.json from Kaggle API via Bearer token.',
      reducerApplied: 'Initial Keyframe Snapshot',
      kaggleTelemetry: zrTelemetry,
      files: run1Files1,
      tokenDelta: 1420,
      latencyMs: 310,
      createdAt: t0,
    }),
    makeSeedCheckpoint({
      id: 'ckpt_zr_002',
      runId: run1.id,
      threadId: run1.threadId,
      parentId: 'ckpt_zr_001',
      stepIndex: 2,
      nodeName: 'verify_t20f_thermal_and_ece_invariants',
      phaseLabel: '02. T20f Calibration & 300K-350K Thermal Audit',
      status: 'COMMITTED',
      variables: {
        kaggleUsername: kaggleUser,
        expectedCalibrationErrorEce: 0.091284,
        overallVerdict: 'SURVIVES',
      },
      summary: 'Verified T20f ECE <= 0.15 and persisted RFC 6902 delta + Brotli snapshot.',
      reducerApplied: 'DEEP_MERGE + CAS_DEDUP',
      kaggleTelemetry: zrTelemetry,
      files: run1Files2,
      tokenDelta: 1890,
      latencyMs: 428,
      createdAt: t1,
    }),
    makeSeedCheckpoint({
      id: 'ckpt_zr_003',
      runId: run1.id,
      threadId: run1.threadId,
      parentId: 'ckpt_zr_002',
      stepIndex: 3,
      nodeName: 'await_next_cosim_webhook_or_human_gate',
      phaseLabel: '03. Durable Suspend in Neon PostgreSQL',
      status: 'PAUSED_WAIT',
      variables: { expectedCalibrationErrorEce: 0.091284, computeThreadSuspended: true },
      summary: 'Agent state snapshot persisted to Neon PostgreSQL awaiting webhook.',
      reducerApplied: 'NUMERIC_MAX',
      pendingWebhookEvent: 'KAGGLE_KERNEL_NEXT_SWEEP_READY',
      kaggleTelemetry: { ...zrTelemetry, kernelState: 'PAUSED_AWAITING_WEBHOOK' },
      files: run1Files2,
      tokenDelta: 970,
      latencyMs: 145,
      createdAt: t2,
    }),
    makeSeedCheckpoint({
      id: 'ckpt_hg_001',
      runId: run2.id,
      threadId: run2.threadId,
      parentId: null,
      stepIndex: 1,
      nodeName: 'sync_holygrail_300m_report_t4',
      phaseLabel: '01. Synced production_300m_report_t4.json from Kaggle API',
      status: 'COMMITTED',
      variables: { kernelSlug: secondaryKernel, mlaKvVramSavingPct: 92.12 },
      summary: 'Fetched production_300m_report_t4.json (92.12% MLA KV cache reduction).',
      reducerApplied: 'Initial Keyframe Snapshot',
      files: run2Files,
      tokenDelta: 3100,
      latencyMs: 380,
      createdAt: t1,
    }),
    makeSeedCheckpoint({
      id: 'ckpt_hg_002',
      runId: run2.id,
      threadId: run2.threadId,
      parentId: 'ckpt_hg_001',
      stepIndex: 2,
      nodeName: 'sandbox_rollback_recovery_guard',
      phaseLabel: '02. Atomic Rollback After Non-Zero Bash Exit',
      status: 'ROLLED_BACK',
      variables: { kernelSlug: secondaryKernel, mlaKvVramSavingPct: 92.12, lastExitCode: 1 },
      summary: 'Tool exited with status 1; sandbox restored pre-execution Merkle snapshot.',
      reducerApplied: 'CAS_ROLLBACK_RESTORE',
      files: run2Files,
      tokenDelta: 3090,
      latencyMs: 290,
      createdAt: t3,
    }),
    makeSeedCheckpoint({
      id: 'ckpt_cr_001',
      runId: run3.id,
      threadId: run3.threadId,
      parentId: null,
      stepIndex: 1,
      nodeName: 'load_reconciliation_workspace',
      phaseLabel: '01. Pre-Spiral Clean Checkpoint',
      status: 'COMMITTED',
      variables: { brokenDependency: 'cuda-bindings-broken==99.0.0' },
      summary: 'Loaded clean workspace snapshot prior to dependency installation.',
      reducerApplied: 'Initial Keyframe Snapshot',
      files: run3Files,
      tokenDelta: 1140,
      latencyMs: 215,
      createdAt: t2,
    }),
    makeSeedCheckpoint({
      id: 'ckpt_cr_002',
      runId: run3.id,
      threadId: run3.threadId,
      parentId: 'ckpt_cr_001',
      stepIndex: 2,
      nodeName: 'circuit_breaker_halt_strike_3',
      phaseLabel: '02. Circuit Breaker Tripped (3x Hybrid SHA-256 + pgvector Match)',
      status: 'HALTED_STRIKE_3',
      variables: {
        circuitBreakerState: 'OPEN_HALTED',
        triggerSha256: strikeHash,
        consecutiveIdenticalFailures: 3,
      },
      summary: 'Halted execution after 3 identical semantic failures and routed crash dump to DLQ.',
      reducerApplied: 'CIRCUIT_BREAKER_LOCK',
      files: run3Files,
      tokenDelta: 2700,
      latencyMs: 180,
      createdAt: t4,
    }),
  ];

  const merkle3_1 = computeWorkspaceMerkleRoot(run3Files);
  const trajectoryEvents: TrajectoryEvent[] = [
    {
      id: 'traj_001',
      runId: run1.id,
      checkpointId: 'ckpt_zr_002',
      stepIndex: 2,
      toolName: 'exec_sandbox_bash',
      canonicalArgsJson: canonicalizeArgs({ command: 'python3 verify_cosim_invariants.py' }),
      argSha256Hash: sha256Hex('exec_sandbox_bash::verify_cosim_invariants::EXIT_0'),
      normalizedCommandSig: normalizeShellCommandAst('python3 verify_cosim_invariants.py'),
      semanticSimilarityScore: 0,
      loopMatchTier: 'NOMINAL',
      traceparent: generateW3CTraceparent(),
      exitCode: 0,
      consecutiveStrikeNumber: 0,
      wasRolledBack: false,
      rollbackReason: null,
      preMerkleRoot: checkpoints[0].workspaceMerkleRoot,
      postMerkleRoot: checkpoints[1].workspaceMerkleRoot,
      abortedFileDiff: null,
      stdout: '{"run_id": "ZR-LLM-COSIM-030", "verdict": "SURVIVES"}',
      stderr: '',
      durationMs: 340,
      tokensConsumed: 890,
      createdAt: t1,
    },
    ...[1, 2, 3].map((strikeIdx) => ({
      id: `traj_spiral_${strikeIdx}`,
      runId: run3.id,
      checkpointId: 'ckpt_cr_002',
      stepIndex: 1 + strikeIdx,
      toolName: 'exec_sandbox_bash',
      canonicalArgsJson: strikeCanonical,
      argSha256Hash: strikeHash,
      normalizedCommandSig: strikeNormSig,
      semanticSimilarityScore: strikeIdx === 1 ? 0.0 : 1.0,
      loopMatchTier: (strikeIdx > 1
        ? 'TIER1_EXACT_SHA256'
        : 'NOMINAL') as TrajectoryEvent['loopMatchTier'],
      traceparent: generateW3CTraceparent(),
      exitCode: 1,
      consecutiveStrikeNumber: strikeIdx,
      wasRolledBack: true,
      rollbackReason: `Non-zero exit code (1) on dependency install (Strike ${strikeIdx}/3).`,
      preMerkleRoot: merkle3_1,
      postMerkleRoot: merkle3_1,
      abortedFileDiff: {
        filePath: '/workspace/cron_reconciler/pip_build.tmp',
        beforeContent: '<FILE_DID_NOT_EXIST>',
        attemptedContent: 'partial wheel build artifact',
        restoredContent: '<FILE_REMOVED_ON_ROLLBACK>',
        unifiedPatch: computeUnifiedLineDiff(
          '/workspace/cron_reconciler/pip_build.tmp',
          '<NONE>',
          'partial wheel'
        ),
      },
      stdout: 'Looking in indexes: https://pypi.org/simple',
      stderr: 'ERROR: No matching distribution found for cuda-bindings-broken==99.0.0',
      durationMs: 410 + strikeIdx * 15,
      tokensConsumed: 900,
      createdAt: new Date(Date.parse(t2) + strikeIdx * 60000).toISOString(),
    })),
  ];

  const dlqDumps: DeadLetterDump[] = [
    {
      id: 'dlq_dump_901',
      runId: run3.id,
      runName: run3.name,
      haltedAtCheckpointId: 'ckpt_cr_002',
      triggerHash: strikeHash,
      toolName: 'exec_sandbox_bash',
      canonicalArgsJson: strikeCanonical,
      failureSignature:
        'EXIT_CODE_1_DEPENDENCY_NOT_FOUND :: pip install cuda-bindings-broken==99.0.0',
      consecutiveFailures: 3,
      burnedTokensBeforeHalt: 2700,
      burnedCostUsd: 0.0081,
      estimatedOvernightCostSavedUsd: 41.98,
      crashDumpPayload: {
        engineVersion: 'ChronosBox-v2.5-Production',
        threadId: run3.threadId,
        lastValidCheckpointId: 'ckpt_cr_001',
        lastValidMerkleRoot: merkle3_1,
        identicalStrikeTimestamps: [t2, t3, t4],
        stderrTail: 'ERROR: No matching distribution found for cuda-bindings-broken==99.0.0',
        sandboxQuotas: run3.sandboxQuotas,
        suggestedRemediation:
          'Replace cuda-bindings-broken==99.0.0 with nvidia-cuda-runtime-cu12==12.4.127.',
        detectionTier: 'TIER1_EXACT_SHA256 + TIER2_PGVECTOR_COSINE',
        pgvectorCosineSimilarity: 1.0,
      },
      resolutionStatus: 'UNRESOLVED',
      createdAt: t4,
    },
  ];

  return { runs: [run1, run2, run3], checkpoints, trajectoryEvents, dlqDumps, lastBenchmark: null };
}
