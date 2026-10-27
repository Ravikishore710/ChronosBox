import React, { useState } from 'react';
import { DurableRun, RunStatus, StateCheckpoint, KaggleKernelSummary } from '../types/chronos.ts';
import { maskKernelSlug, maskSecretIdentifier, sanitizeDisplayText } from '../utils/privacy.ts';
import {
  GitBranch,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ArrowRight,
  ChevronDown,
  ChevronUp,
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
  revealSecrets?: boolean;
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
  revealSecrets = false,
}) => {
  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];
  const runCheckpoints = checkpoints
    .filter((c) => c.runId === selectedRun?.id)
    .sort((a, b) => a.stepIndex - b.stepIndex);

  const [selectedCpId, setSelectedCpId] = useState<string>('');
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [showWebhookEditor, setShowWebhookEditor] = useState<boolean>(false);
  const [customKernelToSync, setCustomKernelToSync] = useState<string>(
    'raviikishore07/kaggle-v7-production-t4'
  );
  const [webhookJsonInput, setWebhookJsonInput] = useState<string>(
    JSON.stringify(
      {
        event: 'KAGGLE_KERNEL_NEXT_SWEEP_READY',
        run_id: 'KAGGLE-V7-PROD-T4',
        overall_verdict: 'VERIFIED',
        mla_kv_vram_saving_pct: 92.12,
      },
      null,
      2
    )
  );
  const [stepInstruction, setStepInstruction] = useState<string>(
    'Verify MLA KV VRAM savings (92.12%) and persist updated checkpoint.'
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
      <div className="p-8 border border-slate-800/80 bg-[#0F1624] rounded-lg text-center">
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

  const availableKernels =
    discoveredKernels.length > 0
      ? discoveredKernels
      : [
          {
            ref: 'raviikishore07/kaggle-v7-production-t4',
            title: 'Kaggle V7 Production T4',
            lastRunTime: '',
          },
          {
            ref: 'raviikishore07/nexoralm-300m-pretraining',
            title: 'NexoraLM 300M Pretraining',
            lastRunTime: '',
          },
        ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Execution Threads & Masked Remote Kernel Sync */}
      <div className="lg:col-span-4 space-y-6">
        <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Execution Threads</h2>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {runs.length} Active
            </span>
          </div>

          <div className="divide-y divide-slate-800/70">
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
                  className={`w-full text-left px-5 py-4 transition-colors ${
                    isSelected ? 'bg-blue-950/25' : 'hover:bg-slate-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`text-sm font-medium truncate ${
                        isSelected ? 'text-blue-300' : 'text-slate-100'
                      }`}
                    >
                      {run.name}
                    </span>
                    <span
                      className={`text-xs font-mono tabular-nums shrink-0 ${
                        run.status === RunStatus.CIRCUIT_HALTED
                          ? 'text-rose-400'
                          : run.status === RunStatus.PAUSED_WEBHOOK
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums mt-1.5">
                    <span>{maskSecretIdentifier(run.threadId, revealSecrets)}</span>
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
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500 font-mono">
                      <span className="truncate">
                        Target: {maskKernelSlug(run.kaggleKernelSlug, revealSecrets)}
                      </span>
                      <span className="text-emerald-400/90 shrink-0">Protected</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Remote Compute Sync (Masked Slugs by Default) */}
        <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Remote Compute Sync</h2>
            <span className="text-xs font-mono text-slate-400">
              {revealSecrets ? 'Unmasked' : 'Credentials Masked'}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Pulls latest telemetry artifacts from remote GPU runners via authenticated Bearer token
            without exposing private kernel identifiers in the UI.
          </p>

          <div className="space-y-2.5">
            <label className="block text-xs text-slate-400">Target Compute Endpoint</label>
            <select
              value={customKernelToSync}
              onChange={(e) => setCustomKernelToSync(e.target.value)}
              className="w-full bg-[#090D16] border border-slate-800 rounded-md px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500 truncate"
            >
              {availableKernels.map((dk) => (
                <option key={dk.ref} value={dk.ref}>
                  {maskKernelSlug(dk.ref, revealSecrets)} — {dk.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => onPollKaggleKernel(selectedRun.id, customKernelToSync)}
              disabled={busyAction !== null}
              className="w-full px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-2"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  busyAction === `poll_${customKernelToSync}` ? 'animate-spin' : ''
                }`}
              />
              Sync Compute Artifact
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Checkpoint Lineage & State Diff */}
      <div className="lg:col-span-8 space-y-6">
        <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Checkpoint Lineage</h2>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 font-mono tabular-nums">
                <span>Thread {maskSecretIdentifier(selectedRun.threadId, revealSecrets)}</span>
                <span aria-hidden="true">·</span>
                <span>{runCheckpoints.length} Snapshots</span>
                <span aria-hidden="true">·</span>
                <span>${selectedRun.savedCostUsd.toFixed(2)} Loop Spend Saved</span>
              </div>
            </div>

            {activeCheckpoint && (
              <button
                onClick={() =>
                  onResumeCheckpoint(selectedRun.id, activeCheckpoint.id, 'TIME_TRAVEL_FORK')
                }
                disabled={busyAction !== null}
                className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
              >
                <GitBranch className="w-3.5 h-3.5 text-blue-400" />
                Fork & Rewind Here
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                      ? 'border-blue-500 bg-blue-950/25'
                      : 'border-slate-800/80 bg-[#090D16] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-mono tabular-nums text-blue-400 font-medium">
                      Step #{cp.stepIndex} · {cp.id}
                    </span>
                    {isHead && <span className="text-xs font-mono text-emerald-400">HEAD</span>}
                  </div>
                  <div className="text-xs font-semibold text-slate-100 truncate mb-1.5">
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
                      <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
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
              className="flex-1 bg-[#090D16] border border-slate-800 rounded-md px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => onRunGeminiAgentStep(selectedRun.id, stepInstruction)}
              disabled={busyAction !== null || !stepInstruction.trim()}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              {busyAction === 'gemini_step' ? 'Executing Node...' : 'Execute Next Node'}
            </button>
          </div>
        </div>

        {/* Active Checkpoint Inspection & State Diff */}
        {activeCheckpoint && (
          <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
            <div className="p-6 border-b border-slate-800/80 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {sanitizeDisplayText(activeCheckpoint.phaseLabel, revealSecrets)}
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                  {sanitizeDisplayText(
                    activeCheckpoint.stateSnapshot.lastActionSummary,
                    revealSecrets
                  )}
                </p>
              </div>
              <div className="text-right font-mono tabular-nums text-xs text-slate-400">
                <div>Merkle: {activeCheckpoint.workspaceMerkleRoot.slice(0, 12)}...</div>
                <div className="text-slate-500 mt-0.5">
                  Key: {maskSecretIdentifier(activeCheckpoint.redisCacheKey, revealSecrets)}
                </div>
              </div>
            </div>

            {/* Clean Resume & Approval Action Bar */}
            <div className="px-6 py-4 bg-[#090D16]/60 border-b border-slate-800/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-300">
                  <span className="font-semibold text-slate-100">Durable Pause Gate</span>
                  <span className="mx-2 text-slate-600">·</span>
                  <span className="font-mono text-amber-400">
                    {activeCheckpoint.stateSnapshot.pendingWebhookEvent
                      ? `Awaiting ${activeCheckpoint.stateSnapshot.pendingWebhookEvent}`
                      : 'Ready for Signal or Approval'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => setShowWebhookEditor((prev) => !prev)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-900 border border-slate-800 rounded-md transition-colors whitespace-nowrap flex items-center gap-1"
                  >
                    <span>Payload</span>
                    {showWebhookEditor ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={handleWebhookSubmit}
                    disabled={busyAction !== null}
                    className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Inject Webhook & Resume
                  </button>
                  <button
                    onClick={() =>
                      onResumeCheckpoint(selectedRun.id, activeCheckpoint.id, 'HUMAN_APPROVAL')
                    }
                    disabled={busyAction !== null}
                    className="px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Grant Human Approval
                  </button>
                </div>
              </div>

              {showWebhookEditor && (
                <div className="pt-2">
                  <textarea
                    rows={3}
                    value={webhookJsonInput}
                    onChange={(e) => setWebhookJsonInput(e.target.value)}
                    className="w-full bg-[#090D16] border border-slate-800 rounded-md p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  {webhookError && <p className="text-xs text-rose-400 mt-1">{webhookError}</p>}
                </div>
              )}
            </div>

            {/* Clean Two-Column State Diff & Workspace Files */}
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800/80">
              <div>
                <div className="px-5 py-3 border-b border-slate-800/80 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    State Diff vs. {parentCheckpoint ? parentCheckpoint.id : 'ROOT'}
                  </span>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    +{activeCheckpoint.tokenDelta} tok
                  </span>
                </div>
                <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
                  {allVarKeys.map((key) => {
                    const rawBefore = parentVars[key];
                    const rawAfter = currentVars[key];
                    const beforeVal =
                      rawBefore !== undefined
                        ? sanitizeDisplayText(JSON.stringify(rawBefore), revealSecrets)
                        : undefined;
                    const afterVal = sanitizeDisplayText(JSON.stringify(rawAfter), revealSecrets);
                    const changed = beforeVal !== afterVal;
                    return (
                      <div
                        key={key}
                        className="px-5 py-2.5 text-xs font-mono flex items-start justify-between gap-4"
                      >
                        <span className="text-slate-400 shrink-0">{key}</span>
                        <div className="text-right break-all">
                          {changed && beforeVal !== undefined && (
                            <span className="text-rose-400/80 line-through mr-2">{beforeVal}</span>
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

              <div className="flex flex-col justify-between">
                <div>
                  <div className="px-5 py-3 border-b border-slate-800/80 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      Workspace Artifacts ({activeCheckpoint.workspaceFiles.length})
                    </span>
                    <span className="text-xs font-mono text-slate-400">CoW Snapshot</span>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    {activeCheckpoint.workspaceFiles.map((file, idx) => (
                      <button
                        key={file.path}
                        onClick={() => setSelectedFileIdx(idx)}
                        className={`w-full text-left px-5 py-2.5 text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
                          selectedFileIdx === idx
                            ? 'bg-blue-950/25 text-blue-300'
                            : 'text-slate-300 hover:bg-slate-900/40'
                        }`}
                      >
                        <span className="truncate">{file.path}</span>
                        <span className="text-slate-500 tabular-nums shrink-0">
                          {file.sizeBytes} B · {file.sha256.slice(0, 8)}
                        </span>
                      </button>
                    ))}
                  </div>
                  {inspectedFile && (
                    <pre className="p-4 bg-[#090D16] text-xs font-mono text-slate-300 max-h-44 overflow-y-auto border-t border-slate-800/80">
                      {sanitizeDisplayText(inspectedFile.content, revealSecrets)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
