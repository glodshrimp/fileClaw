import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, HelpCircle, Minus, Square, X, Copy, Activity } from 'lucide-react';

// Stable platform check — electronAPI is injected synchronously by preload
const IS_MAC = (window as any).electronAPI?.platform === 'darwin';

const Header: React.FC = () => {
  const location = useLocation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if ((window as any).electronAPI?.isMaximized) {
        const maximized = await (window as any).electronAPI.isMaximized();
        setIsMaximized(maximized);
      }
    };

    checkMaximized();
    // 简单轮询或者依赖窗口事件，Electron 也可以通过 IPC 发送事件，但这里先简单处理
    const interval = setInterval(checkMaximized, 1000);
    return () => clearInterval(interval);
  }, []);

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/projects':
        return '项目目录管理';
      case '/systems':
        return '在线系统管理';
      case '/accounts':
        return '账号信息管理';
      case '/ssh':
        return 'SSH 信息管理';
      case '/settings':
        return '系统设置';
      default:
        return '项目目录管理';
    }
  };

  const handleMinimize = () => {
    (window as any).electronAPI?.minimize();
  };

  const handleMaximize = async () => {
    if ((window as any).electronAPI?.maximize) {
      const maximized = await (window as any).electronAPI.maximize();
      setIsMaximized(maximized);
    }
  };

  const handleClose = () => {
    (window as any).electronAPI?.close();
  };

  return (
    <header
      className="h-10 bg-background border-b border-border flex items-center justify-between select-none flex-shrink-0"
      data-tauri-drag-region="deep"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Left side: Logo + page title */}
      <div className="flex items-center h-full">
        {/* macOS: leave space for traffic lights (~70px) */}
        {IS_MAC ? (
          <div className="w-[70px] flex-shrink-0" />
        ) : (
          /* Windows/Linux: show app logo */
          <div className="flex items-center gap-2 pl-3 pr-3 h-full border-r border-border flex-shrink-0 pointer-events-none">
            <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center">
              <Activity className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-bold text-primary whitespace-nowrap">项目管理</span>
          </div>
        )}
        <div className="px-4 flex items-center">
          <h2 className="text-sm font-semibold text-text-primary">{getPageTitle()}</h2>
        </div>
      </div>

      {/* Right side: utilities + window controls */}
      <div
        className="flex items-center"
        data-tauri-drag-region="false"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <div className="flex items-center space-x-2 mr-4 border-r border-border pr-4">
          <button className="p-1.5 hover:bg-background-secondary rounded-md transition-colors">
            <Bell className="w-4 h-4 text-text-secondary" />
          </button>
          <button className="p-1.5 hover:bg-background-secondary rounded-md transition-colors">
            <HelpCircle className="w-4 h-4 text-text-secondary" />
          </button>
        </div>

        {/* 窗口控制按钮 - 仅在 Windows/Linux 上显示 */}
        {!IS_MAC && (
          <div className="flex items-center">
            <button
              onClick={handleMinimize}
              className="p-2 hover:bg-background-secondary transition-colors"
              title="最小化"
            >
              <Minus className="w-4 h-4 text-text-secondary" />
            </button>
            <button
              onClick={handleMaximize}
              className="p-2 hover:bg-background-secondary transition-colors"
              title={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? (
                <Copy className="w-3.5 h-3.5 text-text-secondary transform rotate-180" />
              ) : (
                <Square className="w-3.5 h-3.5 text-text-secondary" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-red-500 hover:text-white transition-colors group"
              title="关闭"
            >
              <X className="w-4 h-4 text-text-secondary group-hover:text-white" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
