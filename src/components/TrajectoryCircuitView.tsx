import React, { useState } from 'react';
import {
  DurableRun,
  TrajectoryEvent,
  DeadLetterDump,
} from '../types/chronos.ts';
import {
  Hash,
  Wrench,
  Play,
  CheckCircle2,
  XCircle,
  FileWarning,
  Search,
} from 'lucide-react';

interface TrajectoryCircuitViewProps {
  runs: DurableRun[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
  trajectoryEvents: TrajectoryEvent[];
  dlqDumps: DeadLetterDump[];
  onReplayDlqDump: (dlqId: string, patchedCommand: string) => Promise<void>;
  busyAction: string | null;
}

export const TrajectoryCircuitView: React.FC<TrajectoryCircuitViewProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  trajectoryEvents,
  dlqDumps,
  onReplayDlqDump,
  busyAction,
}) => {
  const [selectedDlqId, setSelectedDlqId] = useState<string>(dlqDumps[0]?.id || '');
  const [hashFilter, setHashFilter] = useState<string>('');
  const [onlyFailures, setOnlyFailures] = useState<boolean>(false);

  const activeDlq =
    dlqDumps.find((d) => d.id === selectedDlqId) || dlqDumps[0] || null;

  const [patchedCmdInput, setPatchedCmdInput] = useState<string>(
    'pip install nvidia-cuda-runtime-cu12==12.4.127 --no-input'
  );

  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];

  const filteredEvents = trajectoryEvents
    .filter((ev) => {
      if (onlyFailures && ev.exitCode === 0) return false;
      if (
        hashFilter.trim() &&
        !ev.argSha256Hash.toLowerCase().includes(hashFilter.toLowerCase()) &&
        !ev.canonicalArgsJson.toLowerCase().includes(hashFilter.toLowerCase()) &&
        !(ev.normalizedCommandSig || '').toLowerCase().includes(hashFilter.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .slice()
    .reverse();

  return (
    <div className="space-y-6">
      {/* Circuit Breaker Policy & Filter Header */}
      <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Hybrid 2-Tier Trajectory Monitor (SHA-256 AST + pgvector Cosine) & Dead-Letter Queue
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tier 1 normalizes CLI flag permutations into canonical SHA-256 digests; Tier 2
              computes 8-dim trigram/SimHash cosine similarity (`&gt;= 0.88`) in Neon `pgvector`
              to halt semantic loops at Strike 3.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-500 mr-1.5" />
              <input
                type="text"
                value={hashFilter}
                onChange={(e) => setHashFilter(e.target.value)}
                placeholder="Filter by SHA-256 or normalized AST..."
                className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none w-52"
              />
            </div>

            <button
              onClick={() => setOnlyFailures((prev) => !prev)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                onlyFailures
                  ? 'bg-red-950/50 border-red-800 text-red-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {onlyFailures ? 'Showing Non-Zero Exits Only' : 'All Tool Invocations'}
            </button>

            <select
              value={selectedRun?.id || ''}
              onChange={(e) => onSelectRun(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (Strikes: {r.strikeCount}/3)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Split: Left = Trajectory Hash Stream (7 cols), Right = Dead-Letter Queue Crash Dump Inspector (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 border border-slate-800 bg-[#111827]/70 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Hash className="w-4 h-4 text-blue-400" />
              Tool-Call SHA-256 & pgvector Trajectory Stream
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {filteredEvents.length} Events
            </span>
          </div>

          <div className="divide-y divide-slate-800/80 max-h-[620px] overflow-y-auto">
            {filteredEvents.map((ev) => {
              const isStrike3 = ev.consecutiveStrikeNumber >= 3;
              return (
                <div
                  key={ev.id}
                  className={`p-4 space-y-2 ${
                    isStrike3 ? 'bg-red-950/20' : 'hover:bg-slate-900/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      {ev.exitCode === 0 ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-100">{ev.toolName}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400">Step #{ev.stepIndex}</span>
                      <span className="text-slate-500">·</span>
                      <span
                        className={
                          ev.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'
                        }
                      >
                        Exit {ev.exitCode}
                      </span>
                      {ev.loopMatchTier && ev.loopMatchTier !== 'NOMINAL' && (
                        <>
                          <span className="text-slate-500">·</span>
                          <span className="text-amber-300">{ev.loopMatchTier}</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                      {typeof ev.semanticSimilarityScore === 'number' &&
                        ev.semanticSimilarityScore > 0 && (
                          <span className="text-slate-400">
                            Cosine: {ev.semanticSimilarityScore.toFixed(3)}
                          </span>
                        )}
                      {ev.consecutiveStrikeNumber > 0 && (
                        <span
                          className={
                            isStrike3
                              ? 'text-red-400 font-semibold'
                              : 'text-amber-400'
                          }
                        >
                          Strike {ev.consecutiveStrikeNumber}/3
                          {isStrike3 ? ' [CIRCUIT OPEN]' : ''}
                        </span>
                      )}
                      {ev.wasRolledBack && (
                        <span className="text-slate-400">· Rolled Back</span>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800/90 text-xs font-mono space-y-1">
                    <div className="flex items-center justify-between gap-2 text-slate-400">
                      <span className="truncate">
                        SHA-256: <span className="text-blue-400">{ev.argSha256Hash}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{ev.durationMs}ms</span>
                    </div>
                    {ev.normalizedCommandSig && (
                      <div className="text-emerald-400/90 break-all">
                        Normalized Flag AST: {ev.normalizedCommandSig}
                      </div>
                    )}
                    <div className="text-slate-300 break-all">
                      Canonical JSON: {ev.canonicalArgsJson}
                    </div>
                    {ev.traceparent && (
                      <div className="text-slate-500 truncate">
                        W3C traceparent: {ev.traceparent}
                      </div>
                    )}
                  </div>

                  {ev.abortedFileDiff?.unifiedPatch && (
                    <pre className="text-xs font-mono text-amber-300/90 bg-slate-950 border border-slate-800 rounded p-2.5 overflow-x-auto">
                      {ev.abortedFileDiff.unifiedPatch}
                    </pre>
                  )}

                  {ev.stderr && (
                    <div className="text-xs font-mono text-red-300/90 bg-red-950/30 border border-red-900/40 rounded px-2.5 py-1.5 whitespace-pre-wrap">
                      {ev.stderr}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Dead-Letter Queue (DLQ) Crash Dump & Patch Replay (5 cols) */}
        <div className="lg:col-span-5 border border-slate-800 bg-[#111827]/70 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-red-400" />
              Dead-Letter Queue (DLQ) Crash Dumps
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {dlqDumps.length} Dumps
            </span>
          </div>

          <div className="divide-y divide-slate-800 border-b border-slate-800">
            {dlqDumps.map((dump) => {
              const isSelected = activeDlq?.id === dump.id;
              return (
                <button
                  key={dump.id}
                  onClick={() => setSelectedDlqId(dump.id)}
                  className={`w-full text-left p-3.5 transition-colors ${
                    isSelected ? 'bg-blue-950/30' : 'hover:bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {dump.runName}
                    </span>
                    <span
                      className={`text-xs font-mono shrink-0 ${
                        dump.resolutionStatus === 'PATCHED_AND_RESUMED'
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {dump.resolutionStatus}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400 truncate mt-1">
                    Hash: {dump.triggerHash.slice(0, 20)}... · Halted at{' '}
                    {dump.haltedAtCheckpointId}
                  </div>
                </button>
              );
            })}
          </div>

          {activeDlq && (
            <div className="p-4 space-y-4">
              <div className="space-y-1">
                <div className="text-xs font-mono text-red-400 font-semibold">
                  {activeDlq.failureSignature}
                </div>
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  Halted at {activeDlq.haltedAtCheckpointId} · Last Clean Snapshot:{' '}
                  {activeDlq.crashDumpPayload.lastValidCheckpointId}
                </div>
              </div>

              <div className="p-3 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 space-y-1.5 max-h-56 overflow-y-auto">
                <div className="text-slate-400 font-semibold">
                  Structured Crash Dump Payload:
                </div>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(activeDlq.crashDumpPayload, null, 2)}
                </pre>
              </div>

              <div className="p-3.5 rounded-md bg-slate-950/90 border border-slate-800 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Wrench className="w-3.5 h-3.5 text-blue-400" />
                  <span>Patch Tool Arguments & Replay From Clean Snapshot</span>
                </div>
                <p className="text-xs text-slate-400">
                  {activeDlq.crashDumpPayload.suggestedRemediation}
                </p>

                <input
                  type="text"
                  value={patchedCmdInput}
                  onChange={(e) => setPatchedCmdInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                />

                <button
                  onClick={() => onReplayDlqDump(activeDlq.id, patchedCmdInput)}
                  disabled={busyAction !== null || !patchedCmdInput.trim()}
                  className="w-full px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  {busyAction === `dlq_${activeDlq.id}`
                    ? 'Patching & Replaying...'
                    : `Patch & Replay From ${activeDlq.crashDumpPayload.lastValidCheckpointId}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
