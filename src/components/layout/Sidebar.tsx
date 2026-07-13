import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  FolderOpen,
  Server,
  Settings,
  Activity,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Code,
} from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { useWorkspaceStore } from '../../contexts/useWorkspaceStore';

const Sidebar: React.FC = () => {
  const { state, dispatch } = useApp();
  const currentProject = useWorkspaceStore((s) => s.currentProject);
  const isCollapsed = state.sidebarCollapsed;
  const toggleCollapse = () => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: !isCollapsed });


  const navItems = [
    { to: '/projects', icon: FolderOpen, label: '项目目录' },
    ...(currentProject ? [{ to: `/workspace/${currentProject.id}`, icon: Code, label: `工作区 (${currentProject.name})` }] : []),
    { to: '/tracking', icon: Activity, label: '项目追踪' },
    { to: '/ssh', icon: Server, label: 'SSH 终端' },
    { to: '/chat', icon: MessageSquare, label: 'AI 助手' },
    { to: '/settings', icon: Settings, label: '系统设置' },
    ...((window as any).AppPluginAPI?.sidebarItems || [])
  ];

  return (
    <aside
      className={`${isCollapsed ? 'w-[46px]' : 'w-56'} bg-background border-r border-border flex flex-col transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] relative z-10 flex-shrink-0`}
    >
      {/* Navigation */}
      <nav className={`flex-1 ${isCollapsed ? 'px-1 py-1.5' : 'px-1.5 py-1.5'} space-y-0.5 overflow-y-auto overflow-x-hidden scrollbar-none`}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) =>
              `flex items-center ${isCollapsed ? 'justify-center w-[34px] h-[34px] mx-auto' : 'px-2.5 py-[7px]'} rounded-lg transition-all duration-200 group relative ${isActive
                ? 'bg-primary text-white shadow-sm shadow-primary/25'
                : 'text-text-secondary hover:bg-background-secondary hover:text-text-primary'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={`flex-shrink-0 transition-all duration-200 ${
                  isCollapsed ? 'w-[18px] h-[18px]' : 'w-4 h-4 mr-2.5'
                }`} />
                {/* Label — width-animated instead of conditional mount for smooth transition */}
                <span
                  className={`font-medium text-[12px] overflow-hidden whitespace-nowrap truncate transition-all duration-300 ${
                    isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                  }`}
                >
                  {item.label}
                </span>
                {/* Active indicator dot for collapsed mode */}
                {isCollapsed && isActive && (
                  <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-[3px] h-3 bg-primary rounded-l-full" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse/Expand toggle */}
      <div className="flex-shrink-0 border-t border-border">
        <button
          onClick={toggleCollapse}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'px-2.5'} py-2 text-text-tertiary hover:text-text-secondary hover:bg-background-secondary transition-all duration-200 group`}
          title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110" />
          ) : (
            <>
              <PanelLeftClose className="w-3.5 h-3.5 mr-2 transition-transform duration-200 group-hover:scale-110" />
              <span className="text-[10px] font-medium overflow-hidden whitespace-nowrap">收起</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
