import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, HardDrive, Wifi, Clock, Activity, MemoryStick,
  Server, AlertTriangle, RefreshCw, ChevronUp, ChevronDown,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────
interface ServerMetrics {
  cpuUsage: number;       // 0-100
  memUsed: number;        // MB
  memTotal: number;       // MB
  memPercent: number;     // 0-100
  loadAvg: string;        // 1-min load
  tcpConns: number;       // TCP established connections
  uptime: number;         // seconds
  diskUsed: string;       // e.g. "12G"
  diskTotal: string;      // e.g. "50G"
  diskPercent: number;    // 0-100
  hostname: string;
  kernelVersion: string;
  lastUpdated: number;    // timestamp
}

interface StatusFooterProps {
  sshId: string;
  isConnected: boolean;
  /** Only poll when the session is visible (active tab) to save resources */
  isVisible?: boolean;
}

// ─── Parse helpers ─────────────────────────────────────────

const MONITOR_COMMAND = [
  'echo "===HOSTNAME===" && hostname 2>/dev/null',
  'echo "===KERNEL===" && uname -r 2>/dev/null',
  'echo "===CPU===" && grep "cpu " /proc/stat 2>/dev/null',
  'echo "===MEM===" && free -m 2>/dev/null | awk \'NR==2{print $2,$3,$7}\'',
  'echo "===LOAD===" && cat /proc/loadavg 2>/dev/null',
  'echo "===TCP===" && ss -s 2>/dev/null | awk \'/TCP:/{gsub(/,/,""); print $2}\'',
  'echo "===UPTIME===" && cat /proc/uptime 2>/dev/null | awk \'{print int($1)}\'',
  'echo "===DISK===" && df -h / 2>/dev/null | awk \'NR==2{print $2,$3,$5}\'',
  'echo "===END==="',
].join(' && ');

function parseMetrics(
  stdout: string,
  prevCpuRef: React.MutableRefObject<{idle: number, total: number} | null>
): Partial<ServerMetrics> {
  const m: Partial<ServerMetrics> = {};

  const section = (tag: string): string => {
    const re = new RegExp(`===${tag}===\\n([\\s\\S]*?)(?====|$)`);
    const match = stdout.match(re);
    return match ? match[1].trim() : '';
  };

  // Hostname
  m.hostname = section('HOSTNAME') || 'unknown';

  // Kernel
  m.kernelVersion = section('KERNEL') || '';

  // CPU — calculate from /proc/stat delta
  const cpuLine = section('CPU');
  if (cpuLine) {
    // cpu  user nice system idle iowait irq softirq steal
    const parts = cpuLine.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    if (prevCpuRef.current) {
      const dIdle = idle - prevCpuRef.current.idle;
      const dTotal = total - prevCpuRef.current.total;
      m.cpuUsage = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : 0;
    } else {
      m.cpuUsage = 0; // First read — no delta yet
    }
    prevCpuRef.current = { idle, total };
  }

  // Memory
  const memLine = section('MEM');
  if (memLine) {
    const [total, used] = memLine.split(/\s+/).map(Number);
    m.memTotal = total;
    m.memUsed = used;
    m.memPercent = total > 0 ? (used / total) * 100 : 0;
  }

  // Load average
  const loadLine = section('LOAD');
  if (loadLine) {
    m.loadAvg = loadLine.split(/\s+/)[0] || '0';
  }

  // TCP connections
  const tcpLine = section('TCP');
  m.tcpConns = parseInt(tcpLine) || 0;

  // Uptime
  const uptimeLine = section('UPTIME');
  m.uptime = parseInt(uptimeLine) || 0;

  // Disk
  const diskLine = section('DISK');
  if (diskLine) {
    const [total, used, percent] = diskLine.split(/\s+/);
    m.diskTotal = total || '?';
    m.diskUsed = used || '?';
    m.diskPercent = parseInt(percent) || 0;
  }

  m.lastUpdated = Date.now();
  return m;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}

function severityColor(val: number, warn = 70, crit = 90): string {
  if (val >= crit) return 'text-red-400';
  if (val >= warn) return 'text-amber-400';
  return 'text-green-400';
}

function severityBg(val: number, warn = 70, crit = 90): string {
  if (val >= crit) return 'bg-red-500';
  if (val >= warn) return 'bg-amber-500';
  return 'bg-green-500';
}

// ─── Component ─────────────────────────────────────────────

const StatusFooter: React.FC<StatusFooterProps> = ({ sshId, isConnected, isVisible = true }) => {
  const [metrics, setMetrics] = useState<Partial<ServerMetrics>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const prevCpuRef = useRef<{idle: number, total: number} | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const bootstrapDoneRef = useRef(false);

  const fetchMetrics = useCallback(async () => {
    if (!isConnected || !isVisible) return;
    try {
      const result = await window.electronAPI.sshExec(sshId, MONITOR_COMMAND);
      if (!mountedRef.current) return;
      if (result.code === -1 && !result.stdout) {
        // Don't overwrite existing metrics on timeout — keep stale data visible
        if (Object.keys(metrics).length === 0) setError('命令超时');
        return;
      }
      const parsed = parseMetrics(result.stdout, prevCpuRef);
      setMetrics(prev => ({ ...prev, ...parsed }));
      setError(null);
      setLoading(false);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || '获取失败');
      setLoading(false);
    }
  }, [sshId, isConnected, isVisible]);

  useEffect(() => {
    mountedRef.current = true;
    bootstrapDoneRef.current = false;

    if (!isConnected) {
      setLoading(true);
      setMetrics({});
      prevCpuRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    if (!isVisible) {
      // Pause polling when hidden — clear interval but keep state
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }

    // Initial fetch
    fetchMetrics();
    // CPU bootstrap: schedule a quick second sample 500ms later so CPU isn't stuck at 0%
    const bootstrapTimer = setTimeout(() => {
      if (mountedRef.current && !bootstrapDoneRef.current) {
        bootstrapDoneRef.current = true;
        fetchMetrics();
      }
    }, 500);
    // Periodic refresh — 5 seconds
    intervalRef.current = setInterval(fetchMetrics, 5000);

    return () => {
      mountedRef.current = false;
      clearTimeout(bootstrapTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isConnected, isVisible, fetchMetrics]);

  if (!isConnected) return null;

  const cpu = metrics.cpuUsage ?? 0;
  const mem = metrics.memPercent ?? 0;
  const disk = metrics.diskPercent ?? 0;

  return (
    <>
      {/* Expanded detail panel */}
      {expanded && (
        <div
          className="absolute bottom-full left-0 w-full border-t border-border px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1.5 text-[10px] animate-fade-in bg-background"
        >
          {/* Hostname */}
          <div className="flex items-center gap-1.5">
            <Server className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">主机:</span>
            <span className="text-slate-300 font-mono truncate">{metrics.hostname || '--'}</span>
          </div>
          {/* Kernel */}
          <div className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">内核:</span>
            <span className="text-slate-300 font-mono truncate">{metrics.kernelVersion || '--'}</span>
          </div>
          {/* Memory detail */}
          <div className="flex items-center gap-1.5">
            <MemoryStick className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">内存:</span>
            <span className={`font-mono ${severityColor(mem)}`}>
              {metrics.memUsed ?? '--'}M / {metrics.memTotal ?? '--'}M
            </span>
          </div>
          {/* Disk */}
          <div className="flex items-center gap-1.5">
            <HardDrive className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">磁盘:</span>
            <span className={`font-mono ${severityColor(disk, 80, 95)}`}>
              {metrics.diskUsed || '--'} / {metrics.diskTotal || '--'}
            </span>
          </div>
          {/* Load */}
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">负载:</span>
            <span className="text-slate-300 font-mono">{metrics.loadAvg || '--'}</span>
          </div>
          {/* Uptime */}
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">运行:</span>
            <span className="text-slate-300 font-mono">{formatUptime(metrics.uptime ?? 0)}</span>
          </div>
          {/* Last update */}
          <div className="flex items-center gap-1.5 col-span-2 sm:col-span-2">
            <RefreshCw className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">刷新:</span>
            <span className="text-slate-400 font-mono">
              {metrics.lastUpdated ? new Date(metrics.lastUpdated).toLocaleTimeString() : '--'}
            </span>
            <span className="text-slate-600 ml-1">· 每 5 秒</span>
          </div>
        </div>
      )}

      {/* Main compact bar items */}
      <div className="flex items-center gap-3 w-full">
        {/* Expand/collapse toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="p-0 text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0"
          title={expanded ? '收起详情' : '展开详情'}
        >
          {expanded
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronUp className="w-3 h-3" />
          }
        </button>

        {/* Status dot */}
        {error ? (
          <div className="flex items-center gap-1 text-amber-400" title={error}>
            <AlertTriangle className="w-3 h-3" />
            <span className="hidden sm:inline">异常</span>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-1 text-slate-500">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span className="hidden sm:inline">加载中</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow shadow-green-500/50" />
            <span className="text-green-400/80 hidden sm:inline">运行中</span>
          </div>
        )}

        <span className="w-px h-3 bg-border" />

        {/* CPU */}
        <div className="flex items-center gap-1.5" title={`CPU: ${cpu.toFixed(1)}%`}>
          <Cpu className="w-3 h-3 text-slate-500 flex-shrink-0" />
          <span className={`font-mono tabular-nums ${severityColor(cpu)}`}>{cpu.toFixed(1)}%</span>
          <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden hidden sm:block">
            <div className={`h-full rounded-full transition-all duration-500 ${severityBg(cpu)}`} style={{ width: `${Math.min(cpu, 100)}%` }} />
          </div>
        </div>

        <span className="w-px h-3 bg-border" />

        {/* Memory */}
        <div className="flex items-center gap-1.5" title={`内存: ${metrics.memUsed ?? 0}M / ${metrics.memTotal ?? 0}M`}>
          <MemoryStick className="w-3 h-3 text-slate-500 flex-shrink-0" />
          <span className={`font-mono tabular-nums ${severityColor(mem)}`}>{mem.toFixed(1)}%</span>
          <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden hidden sm:block">
            <div className={`h-full rounded-full transition-all duration-500 ${severityBg(mem)}`} style={{ width: `${Math.min(mem, 100)}%` }} />
          </div>
        </div>

        <span className="w-px h-3 bg-border hidden sm:block" />

        {/* Disk (hidden on very small screens) */}
        <div className="items-center gap-1.5 hidden sm:flex" title={`磁盘: ${metrics.diskUsed || '?'} / ${metrics.diskTotal || '?'}`}>
          <HardDrive className="w-3 h-3 text-slate-500 flex-shrink-0" />
          <span className={`font-mono tabular-nums ${severityColor(disk, 80, 95)}`}>{disk}%</span>
        </div>

        <span className="w-px h-3 bg-border hidden md:block" />

        {/* TCP connections */}
        <div className="items-center gap-1.5 hidden md:flex" title="TCP 连接数">
          <Wifi className="w-3 h-3 text-slate-500 flex-shrink-0" />
          <span className="font-mono tabular-nums text-slate-300">{metrics.tcpConns ?? '--'}</span>
        </div>

        <span className="w-px h-3 bg-border hidden md:block" />

        {/* Load avg */}
        <div className="items-center gap-1.5 hidden md:flex" title="1 分钟负载">
          <Activity className="w-3 h-3 text-slate-500 flex-shrink-0" />
          <span className="font-mono tabular-nums text-slate-300">{metrics.loadAvg || '--'}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Uptime (right side) */}
        <div className="items-center gap-1 hidden sm:flex">
          <Clock className="w-3 h-3 text-slate-600" />
          <span className="text-slate-500 font-mono tabular-nums">{formatUptime(metrics.uptime ?? 0)}</span>
        </div>

        {/* Hostname */}
        <span className="text-slate-600 font-mono truncate max-w-[120px]" title={metrics.hostname}>
          {metrics.hostname || ''}
        </span>
      </div>
    </>
  );
};

export default StatusFooter;
