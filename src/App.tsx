/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  DurableRun,
  RunStatus,
  WorkflowType,
  StateCheckpoint,
  TrajectoryEvent,
  DeadLetterDump,
  BenchmarkTrialResult,
  InfrastructureDiagnostics,
} from './types/chronos.ts';
import { DagTimeTravelView } from './components/DagTimeTravelView.tsx';
import { SandboxInspectorView } from './components/SandboxInspectorView.tsx';
import { TrajectoryCircuitView } from './components/TrajectoryCircuitView.tsx';
import { BenchmarksAndArchitectureView } from './components/BenchmarksAndArchitectureView.tsx';
import { NewRunModal } from './components/NewRunModal.tsx';
import { maskKernelSlug, sanitizeDisplayText } from './utils/privacy.ts';
import { Plus, Search, X, CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react';

type ActiveTab = 'DAG_CHECKPOINTS' | 'SANDBOX_RUNNER' | 'CIRCUIT_DLQ' | 'SYSTEM_TELEMETRY';

function extractClientError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('DAG_CHECKPOINTS');
  const [runs, setRuns] = useState<DurableRun[]>([]);
  const [checkpoints, setCheckpoints] = useState<StateCheckpoint[]>([]);
  const [trajectoryEvents, setTrajectoryEvents] = useState<TrajectoryEvent[]>([]);
  const [dlqDumps, setDlqDumps] = useState<DeadLetterDump[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkTrialResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<InfrastructureDiagnostics | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string>('run_kaggle_v7_t4');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [revealSecrets, setRevealSecrets] = useState<boolean>(false);

  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState<boolean>(false);
  const [newRunName, setNewRunName] = useState<string>('Kaggle V7 Production T4 Reconciler');
  const [newRunWorkflow, setNewRunWorkflow] = useState<WorkflowType>(
    WorkflowType.KAGGLE_RECONCILIATION
  );
  const [newRunKernel, setNewRunKernel] = useState<string>(
    'raviikishore07/kaggle-v7-production-t4'
  );
  const [newRunObjective, setNewRunObjective] = useState<string>(
    'Verify 92.12% MLA KV VRAM reduction and commit durable checkpoint.'
  );

  const notify = (type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const fetchFullState = useCallback(async () => {
    try {
      const resp = await fetch('/api/state');
      if (!resp.ok) throw new Error('Failed to load ChronosBox state');
      const data = await resp.json();
      setRuns(data.runs || []);
      setCheckpoints(data.checkpoints || []);
      setTrajectoryEvents(data.trajectoryEvents || []);
      setDlqDumps(data.dlqDumps || []);
      setBenchmark(data.lastBenchmark || null);
      setDiagnostics(data.diagnostics || null);
    } catch (err: unknown) {
      notify('error', extractClientError(err) || 'Error fetching engine state');
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    fetchFullState();
    if (typeof EventSource !== 'undefined') {
      const sse = new EventSource('/api/stream');
      const handlePush = () => {
        fetchFullState();
      };
      sse.addEventListener('checkpoint_committed', handlePush);
      sse.addEventListener('sandbox_exec', handlePush);
      sse.addEventListener('checkpoint_resumed', handlePush);
      sse.addEventListener('dlq_replayed', handlePush);
      sse.addEventListener('agent_step', handlePush);
      return () => {
        sse.close();
      };
    }
  }, [fetchFullState]);

  const handlePollKaggleKernel = async (runId: string, kernelSlug: string) => {
    setBusyAction(`poll_${kernelSlug}`);
    try {
      const resp = await fetch('/api/kaggle/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, kernelSlug }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to sync compute endpoint');
      await fetchFullState();
      notify(
        'success',
        `Synced compute artifact (${maskKernelSlug(kernelSlug, revealSecrets)}) -> Checkpoint ${data.checkpoint.id}`
      );
    } catch (err: unknown) {
      notify('error', extractClientError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleResumeCheckpoint = async (
    runId: string,
    checkpointId: string,
    actionType: 'WEBHOOK_RESUME' | 'HUMAN_APPROVAL' | 'TIME_TRAVEL_FORK',
    webhookPayload?: Record<string, unknown>
  ) => {
    setBusyAction(actionType);
    try {
      const resp = await fetch('/api/checkpoints/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, checkpointId, actionType, webhookPayload }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to resume checkpoint');
      await fetchFullState();
      notify(
        'success',
        `Resumed from ${checkpointId} -> Created ${data.checkpoint.id} (0 upstream tokens recomputed)`
      );
    } catch (err: unknown) {
      notify('error', extractClientError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunGeminiAgentStep = async (runId: string, objectivePrompt: string) => {
    setBusyAction('gemini_step');
    try {
      const resp = await fetch('/api/runs/create-or-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, objectivePrompt }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to execute agent step');
      await fetchFullState();
      notify('success', `Executed durable node -> Checkpoint ${data.checkpoint.id}`);
    } catch (err: unknown) {
      notify('error', extractClientError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateNewRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('create_run');
    try {
      const resp = await fetch('/api/runs/create-or-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRunName,
          workflowType: newRunWorkflow,
          kaggleKernelSlug:
            newRunWorkflow === WorkflowType.KAGGLE_RECONCILIATION ? newRunKernel : null,
          objectivePrompt: newRunObjective,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to launch durable run');
      await fetchFullState();
      setSelectedRunId(data.run.id);
      setIsNewRunModalOpen(false);
      notify('success', `Launched durable run "${data.run.name}"`);
    } catch (err: unknown) {
      notify('error', extractClientError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleExecuteSandboxCommand = async (params: {
    runId: string;
    command: string;
    targetFilePath?: string;
  }) => {
    setBusyAction('sandbox_exec');
    try {
      const resp = await fetch('/api/sandbox/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Sandbox execution failed');
      await fetchFullState();
      if (data.dlqDump) {
        notify(
          'error',
          `Circuit Breaker Tripped (3/3 Strikes)! Routed crash dump ${data.dlqDump.id} to Dead-Letter Queue.`
        );
      } else if (data.trajectoryEvent.wasRolledBack) {
        notify(
          'error',
          `Exit code ${data.trajectoryEvent.exitCode} trapped -> Atomic rollback restored Merkle root ${data.trajectoryEvent.postMerkleRoot.slice(
            0,
            10
          )}`
        );
      } else {
        notify(
          'success',
          `Command exited 0 -> Committed new Merkle root ${data.trajectoryEvent.postMerkleRoot.slice(
            0,
            10
          )}`
        );
      }
    } catch (err: unknown) {
      notify('error', extractClientError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleReplayDlqDump = async (dlqId: string, patchedCommand: string) => {
    setBusyAction(`dlq_${dlqId}`);
    try {
      const resp = await fetch('/api/dlq/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dlqId, patchedCommand }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to replay DLQ dump');
      await fetchFullState();
      notify(
        'success',
        `Patched & replayed ${dlqId} from pre-spiral checkpoint -> Status: ${data.run.status}`
      );
    } catch (err: unknown) {
      notify('error', extractClientError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunBenchmark = async (iterations: number) => {
    setBusyAction('benchmark');
    try {
      const resp = await fetch('/api/benchmarks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iterations }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error('Latency profiler execution failed');
      setBenchmark(data);
      notify(
        'success',
        `Profiled ${iterations.toLocaleString()} SHA-256 AST trajectory hashes (${data.chronosMetrics.sha256TrajectoryThroughputOpsPerSec.toLocaleString()} ops/s)`
      );
    } catch (err: unknown) {
      notify('error', extractClientError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const filteredRuns = runs.filter((r) => {
    const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const matchesSearch =
      !searchQuery.trim() ||
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.threadId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const activeRunsList = filteredRuns.length > 0 ? filteredRuns : runs;
  const totalSavedUsd = runs.reduce((sum, r) => sum + r.savedCostUsd, 0);
  const totalRollbacks = runs.reduce((sum, r) => sum + r.rollbackCount, 0);
  const unresolvedDlqCount = dlqDumps.filter((d) => d.resolutionStatus === 'UNRESOLVED').length;

  return (
    <div className="min-h-screen bg-[#090D16] text-[#F8FAFC] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 bg-[#090D16]/95 sticky top-0 z-30">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('DAG_CHECKPOINTS');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          ChronosBox
        </a>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
          {(
            [
              { id: 'DAG_CHECKPOINTS', label: 'Checkpoints' },
              { id: 'SANDBOX_RUNNER', label: 'Sandbox' },
              { id: 'CIRCUIT_DLQ', label: 'Circuit Breaker' },
              { id: 'SYSTEM_TELEMETRY', label: 'Telemetry' },
            ] as const
          ).map((navItem) => (
            <button
              key={navItem.id}
              onClick={() => setActiveTab(navItem.id)}
              className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === navItem.id ? 'text-slate-100 border-b-2 border-blue-500' : ''
              }`}
            >
              {navItem.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setIsNewRunModalOpen(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New Durable Run
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8 space-y-6">
        {toastMessage && (
          <div
            className={`px-4 py-3 rounded-md border flex items-center justify-between gap-3 text-xs font-medium ${
              toastMessage.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-200'
                : 'bg-rose-950/50 border-rose-800/80 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {toastMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{sanitizeDisplayText(toastMessage.text, revealSecrets)}</span>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Executive Overview & Single-Elevation KPI Strip */}
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-100">
                Durable Agent Control Plane
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                State checkpointing, transactional workspace sandboxes, and deterministic loop
                prevention.
              </p>
            </div>

            <button
              onClick={() => setRevealSecrets((prev) => !prev)}
              className="px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-800 bg-[#0F1624] text-slate-300 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
              title="Toggle visibility of private kernel slugs, account names, and tokens"
            >
              {revealSecrets ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  <span>Identifiers Visible</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Secrets Masked</span>
                </>
              )}
            </button>
          </div>

          <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80">
            <div className="p-5">
              <div className="text-xs text-slate-400">Persisted State Snapshots</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {checkpoints.length} Checkpoints
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                {runs.length} Active Threads
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-400">Compute Endpoints</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {diagnostics?.discoveredKernels?.length || 19} Indexed
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5 truncate">
                {maskKernelSlug(
                  diagnostics?.resolvedPrimaryKernel || 'raviikishore07/kaggle-v7-production-t4',
                  revealSecrets
                )}
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-400">Sandbox Executions</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {trajectoryEvents.length} Runs
              </div>
              <div className="text-xs text-amber-400/90 font-mono tabular-nums mt-0.5">
                {totalRollbacks} Atomic Rollbacks
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-400">Circuit Breaker & DLQ</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1">
                {unresolvedDlqCount} Halted
              </div>
              <div className="text-xs text-emerald-400 font-mono tabular-nums mt-0.5">
                ${totalSavedUsd.toFixed(2)} Loop Spend Saved
              </div>
            </div>
          </div>
        </section>

        {/* Clean Filter & Thread Status Toolbar */}
        <section className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 rounded-lg border border-slate-800/80 bg-[#0F1624]">
          <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter threads by name or thread ID..."
              className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#090D16] rounded-md border border-slate-800">
            {(
              [
                { id: 'ALL', label: 'All Threads' },
                { id: RunStatus.RUNNING, label: 'Running' },
                { id: RunStatus.PAUSED_WEBHOOK, label: 'Paused' },
                { id: RunStatus.CIRCUIT_HALTED, label: 'Halted' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === f.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {loadingInitial ? (
          <div className="space-y-4">
            <div className="h-48 rounded-lg border border-slate-800/80 bg-[#0F1624] animate-pulse" />
            <div className="h-64 rounded-lg border border-slate-800/80 bg-[#0F1624] animate-pulse" />
          </div>
        ) : (
          <>
            {activeTab === 'DAG_CHECKPOINTS' && (
              <DagTimeTravelView
                runs={activeRunsList}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
                checkpoints={checkpoints}
                discoveredKernels={diagnostics?.discoveredKernels || []}
                onPollKaggleKernel={handlePollKaggleKernel}
                onResumeCheckpoint={handleResumeCheckpoint}
                onRunGeminiAgentStep={handleRunGeminiAgentStep}
                busyAction={busyAction}
                revealSecrets={revealSecrets}
              />
            )}

            {activeTab === 'SANDBOX_RUNNER' && (
              <SandboxInspectorView
                runs={activeRunsList}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
                checkpoints={checkpoints}
                trajectoryEvents={trajectoryEvents}
                onExecuteSandboxCommand={handleExecuteSandboxCommand}
                busyAction={busyAction}
                revealSecrets={revealSecrets}
              />
            )}

            {activeTab === 'CIRCUIT_DLQ' && (
              <TrajectoryCircuitView
                runs={activeRunsList}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
                trajectoryEvents={trajectoryEvents}
                dlqDumps={dlqDumps}
                onReplayDlqDump={handleReplayDlqDump}
                busyAction={busyAction}
                revealSecrets={revealSecrets}
              />
            )}

            {activeTab === 'SYSTEM_TELEMETRY' && (
              <BenchmarksAndArchitectureView
                benchmark={benchmark}
                diagnostics={diagnostics}
                checkpoints={checkpoints}
                trajectoryEvents={trajectoryEvents}
                onRunBenchmark={handleRunBenchmark}
                busyAction={busyAction}
                revealSecrets={revealSecrets}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-800/70 py-5 px-6 mt-12">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>ChronosBox Durable Execution Engine</span>
          <span>Secrets & Private Identifiers Masked by Default</span>
        </div>
      </footer>

      <NewRunModal
        isOpen={isNewRunModalOpen}
        onClose={() => setIsNewRunModalOpen(false)}
        onSubmit={handleCreateNewRun}
        newRunName={newRunName}
        setNewRunName={setNewRunName}
        newRunWorkflow={newRunWorkflow}
        setNewRunWorkflow={setNewRunWorkflow}
        newRunKernel={newRunKernel}
        setNewRunKernel={setNewRunKernel}
        newRunObjective={newRunObjective}
        setNewRunObjective={setNewRunObjective}
        discoveredKernels={diagnostics?.discoveredKernels || []}
        busyAction={busyAction}
        revealSecrets={revealSecrets}
      />
    </div>
  );
}
