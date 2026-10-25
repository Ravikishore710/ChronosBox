export enum RunStatus {
  RUNNING = 'RUNNING',
  PAUSED_WEBHOOK = 'PAUSED_WEBHOOK',
  PAUSED_APPROVAL = 'PAUSED_APPROVAL',
  COMPLETED = 'COMPLETED',
  CIRCUIT_HALTED = 'CIRCUIT_HALTED',
}

export enum WorkflowType {
  KAGGLE_RECONCILIATION = 'KAGGLE_RECONCILIATION',
  CODE_SANDBOX_AGENT = 'CODE_SANDBOX_AGENT',
  CRON_DEPENDENCY_AUDIT = 'CRON_DEPENDENCY_AUDIT',
}

export interface WorkspaceFile {
  path: string;
  content: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: string;
}

export interface SandboxQuotas {
  maxMemoryMb: number;
  usedMemoryMb: number;
  timeoutMs: number;
  cpuShares: number;
  egressWhitelist: string[];
  networkIsolationMode: 'STRICT_ALLOWLIST' | 'AIRGAPPED';
}

export interface SandboxResourceSample {
  timestamp: string;
  timeLabel: string;
  cpuPercent: number;
  memoryMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  pidsCount: number;
  ioReadKb: number;
  ioWriteKb: number;
}

export interface SandboxContainerTelemetry {
  runId: string;
  runName: string;
  threadId: string;
  containerId: string;
  status: RunStatus;
  containerState: 'RUNNING_ISOLATED' | 'PAUSED_CGROUP_FROZEN' | 'HALTED_KILLED';
  cgroupDriver: string;
  cpuShares: number;
  memoryLimitMb: number;
  currentCpuPercent: number;
  currentMemoryMb: number;
  peakMemoryMb: number;
  samples: SandboxResourceSample[];
}

export interface KaggleKernelSummary {
  ref: string;
  title: string;
  lastRunTime: string;
  status?: string;
  outputFiles?: string[];
}

export interface Rfc6902PatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

export interface CheckpointCompressionMetrics {
  isKeyframe: boolean;
  rawJsonBytes: number;
  rfc6902DeltaBytes: number;
  brotliCompressedBytes: number;
  compressionSavingPct: number;
  casDeduplicatedFiles: number;
  casBytesSaved: number;
  patchOps: Rfc6902PatchOp[];
}

export interface WorkerLease {
  runId: string;
  workerId: string;
  leaseToken: string;
  status: 'ACTIVE_LEASE' | 'RELEASED' | 'EXPIRED';
  acquiredAt: string;
  expiresAt: string;
  heartbeatCount: number;
  reducerStrategy: 'LAST_VALUE' | 'APPEND_UNIQUE' | 'NUMERIC_MAX' | 'DEEP_MERGE';
}

export interface InfrastructureDiagnostics {
  postgresConnected: boolean;
  postgresVersion: string;
  postgresDatabase: string;
  postgresHostEndpoint: string;
  pgvectorVersion: string;
  persistedRowsCount: {
    runs: number;
    checkpoints: number;
    trajectoryEvents: number;
    dlqDumps: number;
    casBlobs?: number;
    activeLeases?: number;
  };
  redisEndpoint: string;
  redisMode: string;
  l1CacheStats?: {
    entriesCount: number;
    hitCount: number;
    missCount: number;
    hitRatePct: number;
    casUniqueBlobs: number;
    casTotalBytesSaved: number;
  };
  workerLeases?: WorkerLease[];
  kaggleAuthenticated: boolean;
  kaggleUsername: string;
  kaggleAuthMethod: string;
  resolvedPrimaryKernel: string;
  resolvedSecondaryKernel: string;
  discoveredKernels: KaggleKernelSummary[];
}

export interface StateCheckpoint {
  id: string;
  runId: string;
  parentCheckpointId: string | null;
  stepIndex: number;
  nodeName: string;
  phaseLabel: string;
  status: 'COMMITTED' | 'PAUSED_WAIT' | 'ROLLED_BACK' | 'HALTED_STRIKE_3';
  stateSnapshot: {
    variables: Record<string, unknown>;
    messagesCount: number;
    lastActionSummary: string;
    pendingWebhookEvent?: string | null;
    reducerApplied?: string;
    kaggleTelemetry?: {
      kernelSlug: string;
      gpuDevice: string;
      vramUsedGb: number;
      vramTotalGb: number;
      stepProgress: string;
      fdtdGridThroughputGcells?: number;
      kernelState: string;
    } | null;
  };
  workspaceMerkleRoot: string;
  workspaceFiles: WorkspaceFile[];
  pgvectorEmbeddingPreview: number[];
  redisCacheKey: string;
  redisTtlSeconds: number;
  tokenDelta: number;
  costDeltaUsd: number;
  latencyMs: number;
  traceparent?: string;
  compressionMetrics?: CheckpointCompressionMetrics;
  createdAt: string;
}

export interface TrajectoryEvent {
  id: string;
  runId: string;
  checkpointId: string;
  stepIndex: number;
  toolName: string;
  canonicalArgsJson: string;
  argSha256Hash: string;
  normalizedCommandSig?: string;
  semanticSimilarityScore?: number;
  loopMatchTier?: 'TIER1_EXACT_SHA256' | 'TIER2_PGVECTOR_COSINE' | 'NOMINAL';
  traceparent?: string;
  exitCode: number;
  consecutiveStrikeNumber: number;
  wasRolledBack: boolean;
  rollbackReason?: string | null;
  preMerkleRoot: string;
  postMerkleRoot: string;
  abortedFileDiff?: {
    filePath: string;
    beforeContent: string;
    attemptedContent: string;
    restoredContent: string;
    unifiedPatch?: string;
  } | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  tokensConsumed: number;
  createdAt: string;
}

export interface DeadLetterDump {
  id: string;
  runId: string;
  runName: string;
  haltedAtCheckpointId: string;
  triggerHash: string;
  toolName: string;
  canonicalArgsJson: string;
  failureSignature: string;
  consecutiveFailures: number;
  burnedTokensBeforeHalt: number;
  burnedCostUsd: number;
  estimatedOvernightCostSavedUsd: number;
  crashDumpPayload: {
    engineVersion: string;
    threadId: string;
    lastValidCheckpointId: string;
    lastValidMerkleRoot: string;
    identicalStrikeTimestamps: string[];
    stderrTail: string;
    sandboxQuotas: SandboxQuotas;
    suggestedRemediation: string;
    detectionTier?: string;
    pgvectorCosineSimilarity?: number;
  };
  resolutionStatus: 'UNRESOLVED' | 'PATCHED_AND_RESUMED' | 'ARCHIVED';
  patchedArgsJson?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface DurableRun {
  id: string;
  threadId: string;
  name: string;
  description: string;
  workflowType: WorkflowType;
  kaggleKernelSlug: string | null;
  status: RunStatus;
  currentCheckpointId: string;
  tokensUsed: number;
  costUsd: number;
  savedCostUsd: number;
  strikeCount: number;
  maxStrikes: number;
  rollbackCount: number;
  sandboxQuotas: SandboxQuotas;
  workerLease?: WorkerLease;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkTrialResult {
  id: string;
  executedAt: string;
  iterations: number;
  chronosMetrics: {
    sha256TrajectoryThroughputOpsPerSec: number;
    avgHashLatencyUs: number;
    merkleSnapshotRollbackLatencyMs: number;
    pgvectorCheckpointSerializeMs: number;
    rfc6902BrotliCompressionLatencyMs?: number;
    avgCompressionRatioPct?: number;
    l1CacheLookupLatencyUs?: number;
    pgvectorSemanticQueryLatencyMs?: number;
    loopHaltStrikeThreshold: number;
    costBurnedOnBrokenDepUsd: number;
    costSavedVsUnboundedUsd: number;
    stateRecoveryRecomputeTokens: number;
  };
  competitorComparisons: Array<{
    framework: string;
    durableCheckpointing: string;
    sandboxAutoRollback: string;
    loopDetectionMechanism: string;
    avgLoopDetectionLatencyMs: number;
    overnightSpiralTokenBurnUsd: number;
    webhookZeroRecomputeResume: boolean;
    chronosAdvantageSummary: string;
  }>;
  dataFactorAudit: {
    overallScore: number;
    categories: Array<{
      category: string;
      score: number;
      weight: string;
      verificationEvidence: string;
    }>;
  };
}
