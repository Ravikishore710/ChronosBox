import React, { useState } from 'react';
import { DurableRun, RunStatus, StateCheckpoint, KaggleKernelSummary } from '../types/chronos.ts';
import {
  GitCommit,
  GitBranch,
  Play,
  Webhook,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Cpu,
  Database,
  RefreshCw,
  ArrowRight,
  FileCode,
} from 'lucide-react';

interface DagTimeTravelViewProps {
  runs: DurableRun[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
  checkpoints: StateCheckpoint[];
  discoveredKernels: KaggleKernelSummary[];
  onPollKaggleKernel: (runId: string, kernelSlug: string) => Promise<void>;
  onResumeCheckpoint: (
    runId: string,
    checkpointId: string,
    actionType: 'WEBHOOK_RESUME' | 'HUMAN_APPROVAL' | 'TIME_TRAVEL_FORK',
    webhookPayload?: Record<string, unknown>
  ) => Promise<void>;
  onRunGeminiAgentStep: (runId: string, prompt: string) => Promise<void>;
  busyAction: string | null;
}

export const DagTimeTravelView: React.FC<DagTimeTravelViewProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  checkpoints,
  discoveredKernels,
  onPollKaggleKernel,
  onResumeCheckpoint,
  onRunGeminiAgentStep,
  busyAction,
}) => {
  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];
  const runCheckpoints = checkpoints
    .filter((c) => c.runId === selectedRun?.id)
    .sort((a, b) => a.stepIndex - b.stepIndex);

  const [selectedCpId, setSelectedCpId] = useState<string>('');
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [customKernelToSync, setCustomKernelToSync] = useState<string>(
    'raviikishore07/project-zero-ram-fdtd-gpu'
  );
  const [webhookJsonInput, setWebhookJsonInput] = useState<string>(
    JSON.stringify(
      {
        event: 'KAGGLE_KERNEL_NEXT_SWEEP_READY',
        kernel: 'raviikishore07/project-zero-ram-fdtd-gpu',
        run_id: 'ZR-LLM-COSIM-030',
        overall_verdict: 'SURVIVES',
        expected_calibration_error_ece: 0.091284,
      },
      null,
      2
    )
  );
  const [stepInstruction, setStepInstruction] = useState<string>(
    'Verify T20f thermal drift (-0.0165%) and MLA KV VRAM savings (92.12%) and persist updated checkpoint to Neon PostgreSQL.'
  );
  const [webhookError, setWebhookError] = useState<string | null>(null);

  const activeCheckpoint =
    runCheckpoints.find((c) => c.id === selectedCpId) ||
    runCheckpoints.find((c) => c.id === selectedRun?.currentCheckpointId) ||
    runCheckpoints[runCheckpoints.length - 1];

  const parentCheckpoint = activeCheckpoint?.parentCheckpointId
    ? runCheckpoints.find((c) => c.id === activeCheckpoint.parentCheckpointId) || null
    : null;

  if (!selectedRun) {
    return (
      <div className="p-8 border border-slate-800 bg-slate-900/40 rounded-lg text-center">
        <p className="text-sm text-slate-400">No durable agent runs found in the state store.</p>
      </div>
    );
  }

  const handleWebhookSubmit = async () => {
    if (!activeCheckpoint) return;
    setWebhookError(null);
    try {
      const parsed = JSON.parse(webhookJsonInput) as Record<string, unknown>;
      await onResumeCheckpoint(selectedRun.id, activeCheckpoint.id, 'WEBHOOK_RESUME', parsed);
    } catch {
      setWebhookError('Invalid JSON payload. Please provide valid JSON before injecting webhook.');
    }
  };

  const currentVars = activeCheckpoint?.stateSnapshot.variables || {};
  const parentVars = parentCheckpoint?.stateSnapshot.variables || {};
  const allVarKeys = Array.from(new Set([...Object.keys(parentVars), ...Object.keys(currentVars)]));
  const inspectedFile =
    activeCheckpoint?.workspaceFiles[selectedFileIdx] ||
    activeCheckpoint?.workspaceFiles[0] ||
    null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-4 space-y-6">
        <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              01. Durable Execution Threads
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {runs.length} Threads
            </span>
          </div>
          <div className="space-y-2.5">
            {runs.map((run) => {
              const isSelected = run.id === selectedRun.id;
              return (
                <button
                  key={run.id}
                  onClick={() => {
                    onSelectRun(run.id);
                    setSelectedCpId(run.currentCheckpointId);
                    setSelectedFileIdx(0);
                  }}
                  className={`w-full text-left p-3.5 rounded-md border transition-colors ${
                    isSelected
                      ? 'border-blue-500/80 bg-blue-950/25'
                      : 'border-slate-800/90 bg-slate-900/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-100 truncate">
                      {run.name}
                    </span>
                    <span
                      className={`text-xs font-mono tabular-nums shrink-0 ${
                        run.status === RunStatus.CIRCUIT_HALTED
                          ? 'text-red-400'
                          : run.status === RunStatus.PAUSED_WEBHOOK
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums">
                    <span>{run.threadId}</span>
                    <span aria-hidden="true">·</span>
                    <span>{run.tokensUsed.toLocaleString()} tok</span>
                    <span aria-hidden="true">·</span>
                    <span>${run.costUsd.toFixed(4)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Strikes {run.strikeCount}/{run.maxStrikes}
                    </span>
                  </div>
                  {run.kaggleKernelSlug && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
                      <span className="truncate">{run.kaggleKernelSlug}</span>
                      <span className="text-emerald-400 shrink-0">LIVE API</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-slate-100">
              02. Live Kaggle GPU Kernel Reconciler
            </h2>
            <Cpu className="w-4 h-4 text-blue-400 shrink-0" />
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            Authenticated via Kaggle Bearer token (
            <span className="font-mono text-slate-200">KGAT_***</span>) for{' '}
            <span className="font-mono text-slate-200">RaviiKishore07</span> (
            {discoveredKernels.length || 19} live kernels).
          </p>
          <div className="space-y-3">
            {[
              {
                slug: 'raviikishore07/project-zero-ram-fdtd-gpu',
                label: 'Project Zero-RAM FDTD GPU (ZR-LLM-COSIM-030)',
                metrics: 'Verdict: SURVIVES · ECE: 0.09128 · 940nm · zr_llm_cosim_030_gpu.json',
              },
              {
                slug: 'raviikishore07/kaggle-v7-production-t4',
                label: 'Holygrail V7 Production T4 (2x Tesla T4)',
                metrics: '3,881.6 MB vs 14,739.2 MB OOM · 92.12% MLA KV Saved',
              },
            ].map((k) => (
              <div
                key={k.slug}
                className="p-3 rounded-md border border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{k.label}</div>
                  <div className="text-xs font-mono text-blue-400 truncate mt-0.5">{k.slug}</div>
                  <div className="text-xs text-slate-400 mt-1">{k.metrics}</div>
                </div>
                <button
                  onClick={() => onPollKaggleKernel(selectedRun.id, k.slug)}
                  disabled={busyAction !== null}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${busyAction === `poll_${k.slug}` ? 'animate-spin' : ''}`}
                  />
                  Pull Live Output
                </button>
              </div>
            ))}

            {discoveredKernels.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <label className="block text-xs text-slate-400">
                  Sync Any Discovered Kernel ({discoveredKernels.length} Available):
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={customKernelToSync}
                    onChange={(e) => setCustomKernelToSync(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500 truncate"
                  >
                    {discoveredKernels.map((dk) => (
                      <option key={dk.ref} value={dk.ref}>
                        {dk.ref} ({dk.title})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => onPollKaggleKernel(selectedRun.id, customKernelToSync)}
                    disabled={busyAction !== null}
                    className="px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md whitespace-nowrap shrink-0"
                  >
                    Sync Selected
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-8 space-y-6">
        <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                03. Neon PostgreSQL 18.6 (`neondb` + `pgvector 0.8.6`) Checkpoint Lineage
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 font-mono tabular-nums">
                <span>Thread: {selectedRun.threadId}</span>
                <span aria-hidden="true">·</span>
                <span>Checkpoints: {runCheckpoints.length}</span>
                <span aria-hidden="true">·</span>
                <span>Saved Cost: ${selectedRun.savedCostUsd.toFixed(2)}</span>
              </div>
            </div>
            {activeCheckpoint && (
              <button
                onClick={() =>
                  onResumeCheckpoint(selectedRun.id, activeCheckpoint.id, 'TIME_TRAVEL_FORK')
                }
                disabled={busyAction !== null}
                className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
              >
                <GitBranch className="w-3.5 h-3.5 text-blue-400" />
                Fork & Rewind Here
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            {runCheckpoints.map((cp) => {
              const isSelected = activeCheckpoint?.id === cp.id;
              const isHead = selectedRun.currentCheckpointId === cp.id;
              return (
                <button
                  key={cp.id}
                  onClick={() => {
                    setSelectedCpId(cp.id);
                    setSelectedFileIdx(0);
                  }}
                  className={`text-left p-3.5 rounded-md border transition-colors ${
                    isSelected
                      ? 'border-blue-500 bg-blue-950/30'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-mono tabular-nums text-blue-400 font-medium">
                      Step #{cp.stepIndex} · {cp.id}
                    </span>
                    {isHead && <span className="text-xs font-mono text-emerald-400">HEAD</span>}
                  </div>
                  <div className="text-xs font-semibold text-slate-100 truncate mb-1">
                    {cp.nodeName}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-slate-400">
                    {cp.status === 'COMMITTED' && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    {cp.status === 'PAUSED_WAIT' && (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    {(cp.status === 'ROLLED_BACK' || cp.status === 'HALTED_STRIKE_3') && (
                      <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    )}
                    <span className="truncate">{cp.status}</span>
                    <span aria-hidden="true">·</span>
                    <span>{cp.latencyMs}ms</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="text"
              value={stepInstruction}
              onChange={(e) => setStepInstruction(e.target.value)}
              placeholder="Describe next durable agent node objective..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => onRunGeminiAgentStep(selectedRun.id, stepInstruction)}
              disabled={busyAction !== null || !stepInstruction.trim()}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              {busyAction === 'gemini_step'
                ? 'Executing Gemini Node...'
                : 'Execute Next Durable Node'}
            </button>
          </div>
        </div>

        {activeCheckpoint && (
          <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {activeCheckpoint.phaseLabel}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {activeCheckpoint.stateSnapshot.lastActionSummary}
                </p>
              </div>
              <div className="text-right font-mono tabular-nums text-xs text-slate-400">
                <div>Merkle: {activeCheckpoint.workspaceMerkleRoot.slice(0, 16)}...</div>
                <div className="text-slate-500">Cache Key: {activeCheckpoint.redisCacheKey}</div>
              </div>
            </div>

            <div className="p-4 rounded-md border border-slate-800 bg-slate-950/70 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Webhook className="w-4 h-4 text-amber-400" />
                  <span>
                    Durable Webhook & Human Approval Gate (Zero Upstream LLM Recomputation)
                  </span>
                </div>
                <span className="text-xs font-mono text-amber-400">
                  {activeCheckpoint.stateSnapshot.pendingWebhookEvent
                    ? `Awaiting: ${activeCheckpoint.stateSnapshot.pendingWebhookEvent}`
                    : 'Ready for External Signal Injection'}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                <div className="md:col-span-8">
                  <label className="block text-xs text-slate-400 mb-1">
                    External Webhook JSON Payload
                  </label>
                  <textarea
                    rows={4}
                    value={webhookJsonInput}
                    onChange={(e) => setWebhookJsonInput(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  {webhookError && <p className="text-xs text-red-400 mt-1">{webhookError}</p>}
                </div>
                <div className="md:col-span-4 flex flex-col gap-2 pt-5">
                  <button
                    onClick={handleWebhookSubmit}
                    disabled={busyAction !== null}
                    className="w-full px-3 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Inject Webhook & Resume
                  </button>
                  <button
                    onClick={() =>
                      onResumeCheckpoint(selectedRun.id, activeCheckpoint.id, 'HUMAN_APPROVAL')
                    }
                    disabled={busyAction !== null}
                    className="w-full px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Grant Human Approval
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-800 rounded-md overflow-hidden">
                <div className="px-3.5 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <GitCommit className="w-3.5 h-3.5 text-blue-400" />
                    State Snapshot Diff vs. {parentCheckpoint ? parentCheckpoint.id : 'ROOT'}
                  </span>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    +{activeCheckpoint.tokenDelta} tok
                  </span>
                </div>
                <div className="divide-y divide-slate-800/70 max-h-64 overflow-y-auto">
                  {allVarKeys.map((key) => {
                    const beforeVal = JSON.stringify(parentVars[key]);
                    const afterVal = JSON.stringify(currentVars[key]);
                    const changed = beforeVal !== afterVal;
                    return (
                      <div
                        key={key}
                        className="px-3.5 py-2 text-xs font-mono flex items-start justify-between gap-3"
                      >
                        <span className="text-slate-400 shrink-0">{key}</span>
                        <div className="text-right break-all">
                          {changed && beforeVal !== undefined && (
                            <span className="text-red-400/80 line-through mr-2">{beforeVal}</span>
                          )}
                          <span
                            className={changed ? 'text-emerald-400 font-medium' : 'text-slate-300'}
                          >
                            {afterVal}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border border-slate-800 rounded-md overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="px-3.5 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-blue-400" />
                      Checkpointed Artifacts ({activeCheckpoint.workspaceFiles.length})
                    </span>
                    <span className="text-xs font-mono text-slate-400">Click to Inspect</span>
                  </div>
                  <div className="divide-y divide-slate-800/70">
                    {activeCheckpoint.workspaceFiles.map((file, idx) => (
                      <button
                        key={file.path}
                        onClick={() => setSelectedFileIdx(idx)}
                        className={`w-full text-left px-3.5 py-2 text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
                          selectedFileIdx === idx
                            ? 'bg-blue-950/30 text-blue-300'
                            : 'text-slate-200 hover:bg-slate-900/50'
                        }`}
                      >
                        <span className="truncate">{file.path}</span>
                        <span className="text-slate-400 tabular-nums shrink-0">
                          {file.sizeBytes} B · {file.sha256.slice(0, 8)}
                        </span>
                      </button>
                    ))}
                  </div>
                  {inspectedFile && (
                    <pre className="p-3 bg-slate-950 text-xs font-mono text-slate-300 max-h-40 overflow-y-auto border-t border-slate-800">
                      {inspectedFile.content}
                    </pre>
                  )}
                </div>
                <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-xs font-mono text-slate-400">
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Database className="w-3.5 h-3.5 text-blue-400" />
                      Neon pgvector(0.8.6) State Embedding
                    </span>
                    <span>neondb · vector(8)</span>
                  </div>
                  <div className="truncate text-slate-500 tabular-nums">
                    [{activeCheckpoint.pgvectorEmbeddingPreview.join(', ')}]
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
