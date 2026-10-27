import React, { useState } from 'react';
import { DurableRun, StateCheckpoint, TrajectoryEvent } from '../types/chronos.ts';
import { SandboxResourceUsage } from './SandboxResourceUsage.tsx';
import { sanitizeDisplayText } from '../utils/privacy.ts';
import { Play, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';

interface SandboxInspectorViewProps {
  runs: DurableRun[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
  checkpoints: StateCheckpoint[];
  trajectoryEvents: TrajectoryEvent[];
  onExecuteSandboxCommand: (params: {
    runId: string;
    command: string;
    targetFilePath?: string;
  }) => Promise<void>;
  busyAction: string | null;
  revealSecrets?: boolean;
}

export const SandboxInspectorView: React.FC<SandboxInspectorViewProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  checkpoints,
  trajectoryEvents,
  onExecuteSandboxCommand,
  busyAction,
  revealSecrets = false,
}) => {
  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];
  const runCheckpoints = checkpoints
    .filter((c) => c.runId === selectedRun?.id)
    .sort((a, b) => a.stepIndex - b.stepIndex);
  const latestCp =
    runCheckpoints.find((c) => c.id === selectedRun?.currentCheckpointId) ||
    runCheckpoints[runCheckpoints.length - 1];

  const files = latestCp?.workspaceFiles || [];
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const activeFile = files.find((f) => f.path === selectedFilePath) || files[0] || null;

  const [commandInput, setCommandInput] = useState<string>(
    'python3 /workspace/kaggle_v7/verify_vram_invariants.py'
  );

  const runEvents = trajectoryEvents
    .filter((e) => e.runId === selectedRun?.id)
    .slice()
    .reverse();

  const latestRollbackEvent = runEvents.find((e) => e.wasRolledBack && e.abortedFileDiff);

  if (!selectedRun) return null;

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    await onExecuteSandboxCommand({
      runId: selectedRun.id,
      command: commandInput.trim(),
      targetFilePath: activeFile?.path,
    });
  };

  return (
    <div className="space-y-6">
      <SandboxResourceUsage
        selectedRunId={selectedRun.id}
        onSelectRun={onSelectRun}
        revealSecrets={revealSecrets}
      />

      {/* Flat Single-Elevation Sandbox Quotas & Policy Strip */}
      <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Isolated Sandbox Environment & Copy-on-Write Workspace
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pre-execution SHA-256 Merkle capture with automatic atomic rollback on non-zero exit
              codes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Active Thread</label>
            <select
              value={selectedRun.id}
              onChange={(e) => onSelectRun(e.target.value)}
              className="bg-[#090D16] border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80">
          <div className="p-5">
            <div className="text-xs text-slate-400">Container Quota</div>
            <div className="text-base font-semibold font-mono tabular-nums text-slate-100 mt-1">
              {selectedRun.sandboxQuotas.usedMemoryMb} / {selectedRun.sandboxQuotas.maxMemoryMb} MB
            </div>
            <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
              Shares: {selectedRun.sandboxQuotas.cpuShares} · Timeout:{' '}
              {selectedRun.sandboxQuotas.timeoutMs / 1000}s
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-slate-400">Committed Merkle Root</div>
            <div className="text-base font-semibold font-mono tabular-nums text-emerald-400 mt-1 truncate">
              {latestCp?.workspaceMerkleRoot.slice(0, 16)}...
            </div>
            <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
              {files.length} Tracked Files
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-slate-400">Transactional Rollbacks</div>
            <div className="text-base font-semibold font-mono tabular-nums text-slate-100 mt-1">
              {selectedRun.rollbackCount} Reverted
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Restored on exit != 0</div>
          </div>

          <div className="p-5">
            <div className="text-xs text-slate-400">Allowed Egress Domains</div>
            <div className="text-xs font-mono text-slate-200 mt-1.5 truncate">
              {selectedRun.sandboxQuotas.egressWhitelist.join(' · ')}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {selectedRun.sandboxQuotas.networkIsolationMode}
            </div>
          </div>
        </div>
      </div>

      {/* Two-Column Workbench: Command Runner (Left) & Workspace Files (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">Sandbox Command Runner</h3>
            <span className="text-xs font-mono text-slate-400">
              Context: {activeFile?.path || '/workspace'}
            </span>
          </div>

          <div className="p-6 space-y-5">
            <form onSubmit={handleRunCommand} className="flex items-center gap-3">
              <div className="flex-1 flex items-center bg-[#090D16] border border-slate-800 rounded-md px-3.5 py-2 focus-within:border-blue-500">
                <span className="text-xs font-mono text-slate-500 mr-2 select-none">$</span>
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="Enter command to execute in isolated workspace..."
                  className="w-full bg-transparent text-xs font-mono text-slate-100 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={busyAction !== null || !commandInput.trim()}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                {busyAction === 'sandbox_exec' ? 'Running...' : 'Execute'}
              </button>
            </form>

            {latestRollbackEvent && latestRollbackEvent.abortedFileDiff && (
              <div className="p-4 rounded-md border border-amber-900/50 bg-amber-950/15 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Last Atomic Rollback ({latestRollbackEvent.abortedFileDiff.filePath})
                  </span>
                  <span className="font-mono text-amber-400/90">
                    Restored {latestRollbackEvent.postMerkleRoot.slice(0, 10)}
                  </span>
                </div>
                <p className="text-xs text-slate-300">{latestRollbackEvent.rollbackReason}</p>
              </div>
            )}

            <div className="border-t border-slate-800/80 pt-4">
              <div className="text-xs font-semibold text-slate-300 mb-3">
                Recent Tool Executions ({runEvents.length})
              </div>
              <div className="divide-y divide-slate-800/70 max-h-72 overflow-y-auto">
                {runEvents.map((ev) => (
                  <div key={ev.id} className="py-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="flex items-center gap-2 text-slate-200">
                        {ev.exitCode === 0 ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        )}
                        <span>Step #{ev.stepIndex}</span>
                        <span className="text-slate-500">·</span>
                        <span className={ev.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          Exit {ev.exitCode}
                        </span>
                      </span>
                      <span className="text-slate-400 tabular-nums">{ev.durationMs}ms</span>
                    </div>
                    {ev.stdout && (
                      <pre className="text-xs font-mono text-slate-300 bg-[#090D16] border border-slate-800/80 rounded p-2.5 whitespace-pre-wrap">
                        {sanitizeDisplayText(ev.stdout, revealSecrets)}
                      </pre>
                    )}
                    {ev.stderr && (
                      <pre className="text-xs font-mono text-rose-300 bg-rose-950/20 border border-rose-900/40 rounded p-2.5 whitespace-pre-wrap">
                        {sanitizeDisplayText(ev.stderr, revealSecrets)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Copy-on-Write Workspace Explorer */}
        <div className="lg:col-span-5 border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Workspace File Tree</h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {files.length} Files
            </span>
          </div>

          <div className="divide-y divide-slate-800/70 border-b border-slate-800/80">
            {files.map((file) => {
              const isSelected = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFilePath(file.path)}
                  className={`w-full text-left px-5 py-3 text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
                    isSelected
                      ? 'bg-blue-950/25 text-blue-300'
                      : 'text-slate-300 hover:bg-slate-900/40'
                  }`}
                >
                  <span className="truncate">{file.path}</span>
                  <span className="text-slate-500 tabular-nums shrink-0">
                    {file.sizeBytes} B · {file.sha256.slice(0, 8)}
                  </span>
                </button>
              );
            })}
          </div>

          {activeFile && (
            <div>
              <div className="px-5 py-2.5 bg-[#090D16]/60 border-b border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="truncate">{activeFile.path}</span>
                <span className="shrink-0">SHA-256: {activeFile.sha256.slice(0, 12)}</span>
              </div>
              <pre className="p-5 text-xs font-mono text-slate-200 bg-[#090D16] overflow-x-auto max-h-96 whitespace-pre-wrap">
                {sanitizeDisplayText(activeFile.content, revealSecrets)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
