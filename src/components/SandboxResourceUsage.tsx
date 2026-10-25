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
import {
  Activity,
  Cpu,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';

interface SandboxResourceUsageProps {
  selectedRunId: string;
  onSelectRun?: (runId: string) => void;
}

export const SandboxResourceUsage: React.FC<SandboxResourceUsageProps> = ({
  selectedRunId,
  onSelectRun,
}) => {
  const [containers, setContainers] = useState<SandboxContainerTelemetry[]>([]);
  const [lastPolledAt, setLastPolledAt] = useState<string>('');
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(2000);
  const [viewMode, setViewMode] = useState<'FOCUSED_RUN' | 'ALL_CONTAINERS'>(
    'ALL_CONTAINERS'
  );
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
      // Keep last known samples if network hiccups
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
    viewMode === 'FOCUSED_RUN' && focusedContainer
      ? [focusedContainer]
      : containers;

  return (
    <div className="border border-slate-800 bg-[#111827]/70 rounded-lg p-5 space-y-5">
      {/* Header & Real-Time Polling Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            Real-Time Docker Sandbox Container Telemetry (`SandboxResourceUsage`)
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums mt-1">
            <span>Driver: cgroup2fs / seccomp-strict</span>
            <span aria-hidden="true">·</span>
            <span>Active Sandboxes: {containers.length}</span>
            <span aria-hidden="true">·</span>
            <span>
              Last Sample:{' '}
              {lastPolledAt
                ? new Date(lastPolledAt).toLocaleTimeString()
                : 'Connecting...'}
            </span>
          </div>
        </div>

        {/* Interactive Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-md border border-slate-800">
            <button
              onClick={() => setViewMode('ALL_CONTAINERS')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'ALL_CONTAINERS'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Active Runs ({containers.length})
            </button>
            <button
              onClick={() => setViewMode('FOCUSED_RUN')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'FOCUSED_RUN'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Selected Run Only
            </button>
          </div>

          <select
            value={pollIntervalMs}
            onChange={(e) => setPollIntervalMs(Number(e.target.value))}
            className="bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value={1000}>Poll: 1.0s</option>
            <option value={2000}>Poll: 2.0s</option>
            <option value={5000}>Poll: 5.0s</option>
          </select>

          <button
            onClick={() => setIsPolling((prev) => !prev)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              isPolling
                ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-300'
            }`}
          >
            {isPolling ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                Polling Live
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Paused
              </>
            )}
          </button>

          <button
            onClick={pollMetrics}
            className="p-1.5 text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-md"
            title="Sample Container Metrics Now"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading && containers.length === 0 ? (
        <div className="h-56 rounded-md bg-slate-950/60 border border-slate-800 animate-pulse" />
      ) : (
        <div
          className={`grid grid-cols-1 ${
            displayedContainers.length > 1 ? 'xl:grid-cols-3' : 'xl:grid-cols-1'
          } gap-5`}
        >
          {displayedContainers.map((ctr) => {
            const isSelected = ctr.runId === selectedRunId;
            return (
              <div
                key={ctr.runId}
                onClick={() => onSelectRun && onSelectRun(ctr.runId)}
                className={`p-4 rounded-md border transition-colors cursor-pointer space-y-3 ${
                  isSelected
                    ? 'border-blue-500/80 bg-slate-950/90'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                {/* Container Header Metadata */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      {ctr.runName}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums text-slate-400 mt-0.5">
                      <span>{ctr.containerId}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          ctr.status === RunStatus.CIRCUIT_HALTED
                            ? 'text-red-400'
                            : ctr.status === RunStatus.PAUSED_WEBHOOK
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }
                      >
                        {ctr.containerState}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Live CPU & Memory Readouts */}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800/90">
                    <div className="text-xs text-slate-400 flex items-center justify-between">
                      <span>CPU Utilization</span>
                      <Cpu className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-blue-400 mt-0.5">
                      {ctr.currentCpuPercent.toFixed(1)}%
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500">
                      Shares: {ctr.cpuShares}
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800/90">
                    <div className="text-xs text-slate-400 flex items-center justify-between">
                      <span>RSS Memory</span>
                      <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
                      {ctr.currentMemoryMb.toFixed(1)} MB
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500">
                      Quota: {ctr.memoryLimitMb} MB
                    </div>
                  </div>
                </div>

                {/* Recharts Real-Time CPU (%) & RAM (MB) Line Chart */}
                <div className="h-48 w-full pt-2">
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
                          backgroundColor: '#0B0F17',
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

                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400 pt-1 border-t border-slate-800/80">
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
