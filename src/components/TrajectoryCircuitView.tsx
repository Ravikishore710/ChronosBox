import React, { useState } from 'react';
import { DurableRun, TrajectoryEvent, DeadLetterDump } from '../types/chronos.ts';
import { maskSecretIdentifier, sanitizeDisplayText } from '../utils/privacy.ts';
import { Play, CheckCircle2, XCircle, Search, ChevronDown, ChevronUp } from 'lucide-react';

interface TrajectoryCircuitViewProps {
  runs: DurableRun[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
  trajectoryEvents: TrajectoryEvent[];
  dlqDumps: DeadLetterDump[];
  onReplayDlqDump: (dlqId: string, patchedCommand: string) => Promise<void>;
  busyAction: string | null;
  revealSecrets?: boolean;
}

export const TrajectoryCircuitView: React.FC<TrajectoryCircuitViewProps> = ({
  runs,
  selectedRunId,
  onSelectRun,
  trajectoryEvents,
  dlqDumps,
  onReplayDlqDump,
  busyAction,
  revealSecrets = false,
}) => {
  const [selectedDlqId, setSelectedDlqId] = useState<string>(dlqDumps[0]?.id || '');
  const [hashFilter, setHashFilter] = useState<string>('');
  const [onlyFailures, setOnlyFailures] = useState<boolean>(false);
  const [showRawCrashDump, setShowRawCrashDump] = useState<boolean>(false);

  const activeDlq = dlqDumps.find((d) => d.id === selectedDlqId) || dlqDumps[0] || null;

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
      {/* Clean Filter & Circuit Policy Bar */}
      <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Trajectory Monitor & 3-Strike Circuit Breaker
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Normalizes CLI flag permutations into SHA-256 digests and halts semantic retry loops on
            the 3rd consecutive failure.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center bg-[#090D16] border border-slate-800 rounded-md px-3 py-1.5">
            <Search className="w-3.5 h-3.5 text-slate-500 mr-2" />
            <input
              type="text"
              value={hashFilter}
              onChange={(e) => setHashFilter(e.target.value)}
              placeholder="Filter by SHA-256 or command..."
              className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none w-48"
            />
          </div>

          <button
            onClick={() => setOnlyFailures((prev) => !prev)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              onlyFailures
                ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                : 'bg-[#090D16] border-slate-800 text-slate-300 hover:text-slate-100'
            }`}
          >
            {onlyFailures ? 'Showing Non-Zero Exits Only' : 'All Tool Invocations'}
          </button>

          <select
            value={selectedRun?.id || ''}
            onChange={(e) => onSelectRun(e.target.value)}
            className="bg-[#090D16] border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (Strikes: {r.strikeCount}/3)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Split: Trajectory Stream (Left 7 cols) & Dead-Letter Queue (Right 5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">Trajectory Digest Stream</span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {filteredEvents.length} Invocations
            </span>
          </div>

          <div className="divide-y divide-slate-800/70 max-h-[600px] overflow-y-auto">
            {filteredEvents.map((ev) => {
              const isStrike3 = ev.consecutiveStrikeNumber >= 3;
              return (
                <div
                  key={ev.id}
                  className={`px-6 py-4 space-y-2 ${
                    isStrike3 ? 'bg-rose-950/15' : 'hover:bg-slate-900/30'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      {ev.exitCode === 0 ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-100">{ev.toolName}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">Step #{ev.stepIndex}</span>
                      <span className="text-slate-600">·</span>
                      <span className={ev.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        Exit {ev.exitCode}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                      {ev.consecutiveStrikeNumber > 0 && (
                        <span
                          className={isStrike3 ? 'text-rose-400 font-semibold' : 'text-amber-400'}
                        >
                          Strike {ev.consecutiveStrikeNumber}/3
                        </span>
                      )}
                      {ev.wasRolledBack && <span className="text-slate-400">· Rolled Back</span>}
                      <span className="text-slate-500">· {ev.durationMs}ms</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400">
                    <span className="truncate">
                      SHA-256: <span className="text-blue-400">{ev.argSha256Hash}</span>
                    </span>
                    {typeof ev.semanticSimilarityScore === 'number' &&
                      ev.semanticSimilarityScore > 0 && (
                        <span className="text-slate-400 tabular-nums">
                          Cosine: {ev.semanticSimilarityScore.toFixed(3)}
                        </span>
                      )}
                  </div>

                  {ev.normalizedCommandSig && (
                    <div className="text-xs font-mono text-slate-300 bg-[#090D16] border border-slate-800/80 rounded px-3 py-1.5 truncate">
                      $ {sanitizeDisplayText(ev.normalizedCommandSig, revealSecrets)}
                    </div>
                  )}

                  {ev.stderr && (
                    <div className="text-xs font-mono text-rose-300/90 bg-rose-950/25 border border-rose-900/40 rounded px-3 py-1.5 whitespace-pre-wrap">
                      {sanitizeDisplayText(ev.stderr, revealSecrets)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Dead-Letter Queue Crash Dumps */}
        <div className="lg:col-span-5 border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">Dead-Letter Queue</span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {dlqDumps.filter((d) => d.resolutionStatus === 'UNRESOLVED').length} Halted
            </span>
          </div>

          <div className="divide-y divide-slate-800/70 border-b border-slate-800/80">
            {dlqDumps.map((dump) => {
              const isSelected = activeDlq?.id === dump.id;
              return (
                <button
                  key={dump.id}
                  onClick={() => setSelectedDlqId(dump.id)}
                  className={`w-full text-left px-6 py-4 transition-colors ${
                    isSelected ? 'bg-blue-950/25' : 'hover:bg-slate-900/40'
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
                          : 'text-rose-400'
                      }`}
                    >
                      {dump.resolutionStatus}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400 truncate mt-1">
                    Halted at {dump.haltedAtCheckpointId} · Saved $
                    {dump.estimatedOvernightCostSavedUsd.toFixed(2)}
                  </div>
                </button>
              );
            })}
          </div>

          {activeDlq && (
            <div className="p-6 space-y-5">
              <div className="space-y-1.5">
                <div className="text-xs font-mono text-rose-400 font-semibold break-all">
                  {activeDlq.failureSignature}
                </div>
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  Thread {maskSecretIdentifier(activeDlq.crashDumpPayload.threadId, revealSecrets)}{' '}
                  · Clean Snapshot: {activeDlq.crashDumpPayload.lastValidCheckpointId}
                </div>
              </div>

              <div>
                <button
                  onClick={() => setShowRawCrashDump((prev) => !prev)}
                  className="text-xs font-medium text-slate-400 hover:text-slate-200 flex items-center gap-1"
                >
                  <span>{showRawCrashDump ? 'Hide' : 'Inspect'} Crash Dump Snapshot</span>
                  {showRawCrashDump ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                {showRawCrashDump && (
                  <pre className="mt-2 p-3 rounded bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                    {sanitizeDisplayText(
                      JSON.stringify(activeDlq.crashDumpPayload, null, 2),
                      revealSecrets
                    )}
                  </pre>
                )}
              </div>

              <div className="pt-4 border-t border-slate-800/80 space-y-3">
                <div className="text-xs font-semibold text-slate-200">
                  Patch Command & Replay From Pre-Spiral Snapshot
                </div>
                <p className="text-xs text-slate-400">
                  {activeDlq.crashDumpPayload.suggestedRemediation}
                </p>

                <input
                  type="text"
                  value={patchedCmdInput}
                  onChange={(e) => setPatchedCmdInput(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-800 rounded-md px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                />

                <button
                  onClick={() => onReplayDlqDump(activeDlq.id, patchedCmdInput)}
                  disabled={busyAction !== null || !patchedCmdInput.trim()}
                  className="w-full px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
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
