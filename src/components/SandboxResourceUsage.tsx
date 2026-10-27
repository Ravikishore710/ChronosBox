import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { SandboxContainerTelemetry, RunStatus } from '../types/chronos.ts';
import { maskSecretIdentifier } from '../utils/privacy.ts';
import { Pause, Play, RefreshCw } from 'lucide-react';

interface SandboxResourceUsageProps {
  selectedRunId: string;
  onSelectRun?: (runId: string) => void;
  revealSecrets?: boolean;
}

export const SandboxResourceUsage: React.FC<SandboxResourceUsageProps> = ({
  selectedRunId,
  onSelectRun,
  revealSecrets = false,
}) => {
  const [containers, setContainers] = useState<SandboxContainerTelemetry[]>([]);
  const [lastPolledAt, setLastPolledAt] = useState<string>('');
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(2000);
  const [viewMode, setViewMode] = useState<'FOCUSED_RUN' | 'ALL_CONTAINERS'>('FOCUSED_RUN');
  const [loading, setLoading] = useState<boolean>(true);

  const pollMetrics = useCallback(async () => {
    try {
      const resp = await fetch('/api/sandbox/metrics');
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data.containers)) {
        setContainers(data.containers);
        setLastPolledAt(data.polledAt || new Date().toISOString());
      }
    } catch {
      // Retain last sample if network hiccups
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    pollMetrics();
    if (!isPolling) return;
    const timer = setInterval(pollMetrics, pollIntervalMs);
    return () => clearInterval(timer);
  }, [pollMetrics, isPolling, pollIntervalMs]);

  const focusedContainer =
    containers.find((c) => c.runId === selectedRunId) || containers[0] || null;

  const displayedContainers =
    viewMode === 'FOCUSED_RUN' && focusedContainer ? [focusedContainer] : containers;

  return (
    <div className="border border-slate-800/80 bg-[#0F1624] rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Sandbox Resource Telemetry</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums mt-0.5">
            <span>cgroup2fs</span>
            <span aria-hidden="true">·</span>
            <span>{containers.length} Containers</span>
            <span aria-hidden="true">·</span>
            <span>
              Updated {lastPolledAt ? new Date(lastPolledAt).toLocaleTimeString() : 'Connecting...'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#090D16] rounded-md border border-slate-800">
            <button
              onClick={() => setViewMode('FOCUSED_RUN')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'FOCUSED_RUN'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Focused Run
            </button>
            <button
              onClick={() => setViewMode('ALL_CONTAINERS')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'ALL_CONTAINERS'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Runs ({containers.length})
            </button>
          </div>

          <select
            value={pollIntervalMs}
            onChange={(e) => setPollIntervalMs(Number(e.target.value))}
            className="bg-[#090D16] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value={1000}>1.0s</option>
            <option value={2000}>2.0s</option>
            <option value={5000}>5.0s</option>
          </select>

          <button
            onClick={() => setIsPolling((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-800 bg-[#090D16] text-slate-200 hover:bg-slate-900 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            {isPolling ? (
              <>
                <Pause className="w-3.5 h-3.5 text-emerald-400" />
                Live
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-slate-400" />
                Paused
              </>
            )}
          </button>

          <button
            onClick={pollMetrics}
            className="p-1.5 text-slate-300 bg-[#090D16] hover:bg-slate-900 border border-slate-800 rounded-md"
            title="Sample Container Metrics Now"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading && containers.length === 0 ? (
        <div className="h-56 bg-[#090D16]/60 animate-pulse" />
      ) : (
        <div
          className={`grid grid-cols-1 ${
            displayedContainers.length > 1
              ? 'xl:grid-cols-3 divide-y xl:divide-y-0 xl:divide-x divide-slate-800/80'
              : 'xl:grid-cols-1'
          }`}
        >
          {displayedContainers.map((ctr) => {
            const isSelected = ctr.runId === selectedRunId;
            return (
              <div
                key={ctr.runId}
                onClick={() => onSelectRun && onSelectRun(ctr.runId)}
                className={`p-6 transition-colors cursor-pointer space-y-4 ${
                  isSelected && displayedContainers.length > 1
                    ? 'bg-blue-950/15'
                    : 'hover:bg-slate-900/20'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">
                      {ctr.runName}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400 mt-0.5">
                      <span>{maskSecretIdentifier(ctr.containerId, revealSecrets)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          ctr.status === RunStatus.CIRCUIT_HALTED
                            ? 'text-rose-400'
                            : ctr.status === RunStatus.PAUSED_WEBHOOK
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }
                      >
                        {ctr.containerState}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-right font-mono tabular-nums">
                    <div>
                      <div className="text-xs text-slate-400 font-sans">CPU Load</div>
                      <div className="text-sm font-semibold text-blue-400">
                        {ctr.currentCpuPercent.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 font-sans">Memory RSS</div>
                      <div className="text-sm font-semibold text-emerald-400">
                        {ctr.currentMemoryMb.toFixed(1)} / {ctr.memoryLimitMb} MB
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={ctr.samples}
                      margin={{ top: 6, right: 10, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis
                        dataKey="timeLabel"
                        stroke="#64748B"
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        yAxisId="cpu"
                        domain={[0, 100]}
                        stroke="#3B82F6"
                        tick={{ fontSize: 10, fill: '#60A5FA' }}
                      />
                      <YAxis
                        yAxisId="ram"
                        orientation="right"
                        domain={[0, ctr.memoryLimitMb]}
                        stroke="#10B981"
                        tick={{ fontSize: 10, fill: '#34D399' }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#090D16',
                          borderColor: '#1E293B',
                          fontSize: '11px',
                          fontFamily: 'JetBrains Mono, monospace',
                          color: '#F8FAFC',
                        }}
                      />
                      <ReferenceLine
                        yAxisId="ram"
                        y={ctr.memoryLimitMb * 0.9}
                        stroke="#EF4444"
                        strokeDasharray="4 4"
                      />
                      <Line
                        yAxisId="cpu"
                        type="monotone"
                        dataKey="cpuPercent"
                        name="CPU (%)"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="ram"
                        type="monotone"
                        dataKey="memoryMb"
                        name="RAM (MB)"
                        stroke="#10B981"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400 pt-2 border-t border-slate-800/70">
                  <span>Peak RAM: {ctr.peakMemoryMb} MB</span>
                  <span>
                    PIDs: {ctr.samples[ctr.samples.length - 1]?.pidsCount || 1} · I/O:{' '}
                    {ctr.samples[ctr.samples.length - 1]?.ioReadKb || 0} KB/s
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
