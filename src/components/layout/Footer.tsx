import React from 'react';
import { useLocation } from 'react-router-dom';
import { Activity, Wifi, Clock, Cpu } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { TransferJob } from '../../types';
import StatusFooter from '../ssh/StatusFooter';
import packageJson from '../../../package.json';

/**
 * Global application footer — always visible at the bottom of the window.
 * Shows app status, active connections count, and current time.
 */
const Footer: React.FC = () => {
  const { state } = useApp();
  const { pathname } = useLocation();
  const [now, setNow] = React.useState(new Date());

  // Update clock aligned to minute boundaries
  React.useEffect(() => {
    const tick = () => setNow(new Date());
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const msToNextMinute = (60 - new Date().getSeconds()) * 1000;
    const timerId = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, 60000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timerId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const activeSessions = state.sshSessions.filter(s => s.connStatus === 'connected').length;
  const totalSessions = state.sshSessions.length;

  // Active transfer count across all sessions
  const activeTransfers = Object.values(state.transferJobs).reduce(
    (sum, jobs) => sum + (jobs as TransferJob[]).filter(j => !j.done).length, 0
  );

  const activeSessionKey = state.activeSessionKey;
  const activeSession = activeSessionKey ? state.sshSessions.find(s => s.key === activeSessionKey) : null;
  const showStatusFooter = pathname === '/ssh' && activeSession?.connStatus === 'connected' && !activeSession?.localMode;
  const isReconnecting = pathname === '/ssh' && activeSession?.connStatus === 'reconnecting';

  const pageLabel = (() => {
    switch (pathname) {
      case '/projects': return '项目目录';
      case '/tracking': return '项目追踪';
      case '/ssh':      return 'SSH终端';
      case '/chat':     return 'AI助手';
      case '/settings': return '系统设置';
      default:          return '就绪';
    }
  })();

  return (
    <footer className="h-[22px] flex items-center px-3 bg-background border-t border-border select-none flex-shrink-0 text-[10px] gap-3 relative overflow-visible z-50">
      {/* App status indicator */}
      <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
        <Activity className="w-3 h-3 text-primary" />
        <span className="text-text-tertiary font-medium">{pageLabel}</span>
      </div>

      <span className="w-px h-3 bg-border" />

      {showStatusFooter ? (
        <StatusFooter sshId={activeSessionKey!} isConnected={true} isVisible={true} />
      ) : isReconnecting ? (
        <div className="flex items-center gap-2 flex-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
          <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent font-bold tracking-wide animate-pulse">
            {activeSession?.connError || '正在进行自动重连...'}
          </span>
        </div>
      ) : (
        <>
          {/* SSH connections */}
          <div className="flex items-center gap-1" title={`${activeSessions} 个活跃连接 / ${totalSessions} 个会话`}>
            <Wifi className={`w-3 h-3 ${activeSessions > 0 ? 'text-green-500' : 'text-text-tertiary'}`} />
            <span className={`font-mono tabular-nums ${activeSessions > 0 ? 'text-green-500/80' : 'text-text-tertiary'}`}>
              {activeSessions}/{totalSessions}
            </span>
          </div>

          {/* Active transfers */}
          {activeTransfers > 0 && (
            <>
              <span className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1 text-blue-400" title={`${activeTransfers} 个传输进行中`}>
                <Cpu className="w-3 h-3 animate-pulse" />
                <span className="font-mono tabular-nums">{activeTransfers} 传输中</span>
              </div>
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Version */}
          <span className="text-text-tertiary/50 hidden sm:inline">v{packageJson.version}</span>

          <span className="w-px h-3 bg-border hidden sm:block" />

          {/* Clock */}
          <div className="flex items-center gap-1 text-text-tertiary">
            <Clock className="w-3 h-3" />
            <span className="font-mono tabular-nums">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </>
      )}
    </footer>
  );
};

export default Footer;
