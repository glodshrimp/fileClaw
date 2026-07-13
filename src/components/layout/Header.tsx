import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, HelpCircle, Minus, Square, X, Activity } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Stable platform check
const IS_MAC = navigator.userAgent.includes('Mac');

const Header: React.FC = () => {
  const location = useLocation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let checkMaximized = async () => {
      try {
        const isMax = await getCurrentWindow().isMaximized();
        setIsMaximized(isMax);
      } catch (err) {
        console.warn('Failed to check maximized state:', err);
      }
    };

    checkMaximized();

    // Listen to resize events to update the maximize/restore icon dynamically
    const unlisten = getCurrentWindow().onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then(fn => fn());
    };
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

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error('Failed to minimize window:', err);
    }
  };

  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      const isMax = await win.isMaximized();
      if (isMax) {
        await win.unmaximize();
        setIsMaximized(false);
      } else {
        await win.maximize();
        setIsMaximized(true);
      }
    } catch (err) {
      console.error('Failed to toggle maximize:', err);
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Failed to close window:', err);
    }
  };

  return (
    <header
      className="h-10 bg-background border-b border-border flex items-center justify-between select-none flex-shrink-0 relative"
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
        className="flex items-center h-full"
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
          <div className="flex items-center h-full">
            <button
              onClick={handleMinimize}
              className="w-[46px] h-full flex items-center justify-center hover:bg-text-primary/5 active:bg-text-primary/10 transition-colors"
              title="最小化"
            >
              <Minus className="w-3.5 h-3.5 text-text-secondary" />
            </button>
            <button
              onClick={handleMaximize}
              className="w-[46px] h-full flex items-center justify-center hover:bg-text-primary/5 active:bg-text-primary/10 transition-colors"
              title={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? (
                <svg className="w-3.5 h-3.5 text-text-secondary" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path d="M3,1 L9,1 L9,7 M1,3 L7,3 L7,9 L1,9 Z" />
                </svg>
              ) : (
                <Square className="w-3 h-3 text-text-secondary" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="w-[46px] h-full flex items-center justify-center hover:bg-[#e81123] hover:text-white transition-colors group"
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
