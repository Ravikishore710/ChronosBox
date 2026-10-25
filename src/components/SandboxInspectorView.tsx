import React, { useState } from 'react';
import {
  DurableRun,
  StateCheckpoint,
  TrajectoryEvent,
} from '../types/chronos.ts';
import { SandboxResourceUsage } from './SandboxResourceUsage.tsx';
import {
  Terminal,
  ShieldAlert,
  RotateCcw,
  FolderTree,
  Play,
  Lock,
  Cpu,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

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
}

export const SandboxInspectorView: React.FC<SandboxInspectorViewProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  checkpoints,
  trajectoryEvents,
  onExecuteSandboxCommand,
  busyAction,
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
  const activeFile =
    files.find((f) => f.path === selectedFilePath) || files[0] || null;

  const [commandInput, setCommandInput] = useState<string>(
    'python3 /workspace/kaggle_zero_ram/verify_cosim_invariants.py'
  );

  const runEvents = trajectoryEvents
    .filter((e) => e.runId === selectedRun?.id)
    .slice()
    .reverse();

  const latestRollbackEvent = runEvents.find(
    (e) => e.wasRolledBack && e.abortedFileDiff
  );

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
      {/* Real-Time Recharts Sandbox Container CPU/RAM Telemetry */}
      <SandboxResourceUsage
        selectedRunId={selectedRun.id}
        onSelectRun={onSelectRun}
      />

      {/* Sandbox Resource Quotas & Isolation Policy Bar */}
      <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Isolated Sandbox Environment & Copy-on-Write Workspace
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pre-execution SHA-256 Merkle tree capture and strict egress policy enforcement.
              Non-zero exit codes trigger automatic atomic rollback.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Active Thread:</label>
            <select
              value={selectedRun.id}
              onChange={(e) => onSelectRun(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-3 border-t border-slate-800">
          <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800/80">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>Container Quota (cgroups v2)</span>
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-slate-100 mt-1">
              {selectedRun.sandboxQuotas.usedMemoryMb} MB /{' '}
              {selectedRun.sandboxQuotas.maxMemoryMb} MB
            </div>
            <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
              CPU Shares: {selectedRun.sandboxQuotas.cpuShares} · Timeout:{' '}
              {selectedRun.sandboxQuotas.timeoutMs / 1000}s
            </div>
          </div>

          <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800/80">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>Committed Merkle Root</span>
              <FolderTree className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-emerald-400 mt-1 truncate">
              {latestCp?.workspaceMerkleRoot.slice(0, 18)}...
            </div>
            <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
              {files.length} Tracked Workspace Files
            </div>
          </div>

          <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800/80">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>Transactional Rollbacks</span>
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-slate-100 mt-1">
              {selectedRun.rollbackCount} Reverted Executions
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Triggered on non-zero exit status
            </div>
          </div>

          <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800/80">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>Allowed Egress Domains</span>
              <Lock className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xs font-mono text-slate-200 mt-1 truncate">
              {selectedRun.sandboxQuotas.egressWhitelist.join(' · ')}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Policy: {selectedRun.sandboxQuotas.networkIsolationMode}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Sandbox Command Runner, Execution Log & Rollback Audit (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                Sandbox Command Runner (`exec_sandbox_bash`)
              </h3>
              <span className="text-xs font-mono text-slate-400">
                Target Context: {activeFile?.path || '/workspace'}
              </span>
            </div>

            <form onSubmit={handleRunCommand} className="flex items-center gap-3">
              <div className="flex-1 flex items-center bg-slate-950 border border-slate-800 rounded-md px-3 py-2 focus-within:border-blue-500">
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
                Execute
              </button>
            </form>

            {/* Execution History Stream for Selected Run */}
            <div className="border border-slate-800 rounded-md overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Recent Tool Invocations ({runEvents.length})
                </span>
                <span className="font-mono text-slate-400">Pre/Post Merkle Verified</span>
              </div>
              <div className="divide-y divide-slate-800/70 max-h-64 overflow-y-auto">
                {runEvents.map((ev) => (
                  <div key={ev.id} className="p-3 bg-slate-950/60 space-y-1.5 text-xs font-mono">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-slate-200 font-semibold">
                        {ev.exitCode === 0 ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        Step #{ev.stepIndex} · {ev.toolName} (Exit {ev.exitCode})
                      </span>
                      <span className="text-slate-400 tabular-nums">
                        {ev.durationMs}ms · {ev.wasRolledBack ? 'ROLLED BACK' : 'COMMITTED'}
                      </span>
                    </div>
                    <div className="text-slate-400 truncate">
                      Merkle: {ev.preMerkleRoot.slice(0, 10)} → {ev.postMerkleRoot.slice(0, 10)}
                    </div>
                    {ev.stderr ? (
                      <div className="text-red-300 bg-red-950/30 px-2.5 py-1.5 rounded border border-red-900/40 whitespace-pre-wrap">
                        {ev.stderr}
                      </div>
                    ) : (
                      <div className="text-slate-300 whitespace-pre-wrap">{ev.stdout}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {latestRollbackEvent && latestRollbackEvent.abortedFileDiff && (
            <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  Atomic File-System Rollback Audit (
                  {latestRollbackEvent.abortedFileDiff.filePath})
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  Exit Code {latestRollbackEvent.exitCode} · Restored Merkle{' '}
                  {latestRollbackEvent.postMerkleRoot.slice(0, 10)}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {latestRollbackEvent.rollbackReason}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded bg-red-950/20 border border-red-900/50">
                  <div className="text-red-400 font-semibold mb-1.5">
                    Discarded Dirty Mutation (Exit {latestRollbackEvent.exitCode})
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-slate-300 text-xs max-h-48 overflow-y-auto">
                    {latestRollbackEvent.abortedFileDiff.attemptedContent}
                  </pre>
                </div>
                <div className="p-3 rounded bg-emerald-950/20 border border-emerald-900/50">
                  <div className="text-emerald-400 font-semibold mb-1.5">
                    Restored Clean Snapshot (Merkle Verified)
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-slate-300 text-xs max-h-48 overflow-y-auto">
                    {latestRollbackEvent.abortedFileDiff.restoredContent}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Workspace File Tree & Content Viewer (5 cols) */}
        <div className="lg:col-span-5 border border-slate-800 bg-[#111827]/70 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">
              Workspace Filesystem Tree
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {files.length} files
            </span>
          </div>

          <div className="divide-y divide-slate-800/80 border-b border-slate-800">
            {files.map((file) => {
              const isSelected = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFilePath(file.path)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-mono transition-colors ${
                    isSelected
                      ? 'bg-blue-950/35 text-blue-300'
                      : 'text-slate-300 hover:bg-slate-900/60'
                  }`}
                >
                  <span className="truncate">{file.path}</span>
                  <span className="text-slate-400 tabular-nums shrink-0">
                    {file.sizeBytes} B · {file.sha256.slice(0, 8)}
                  </span>
                </button>
              );
            })}
          </div>

          {activeFile && (
            <div className="p-4 bg-slate-950/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="text-slate-200 font-semibold">{activeFile.path}</span>
                <span>SHA-256: {activeFile.sha256.slice(0, 14)}...</span>
              </div>
              <pre className="p-3 rounded bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto max-h-96">
                {activeFile.content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
