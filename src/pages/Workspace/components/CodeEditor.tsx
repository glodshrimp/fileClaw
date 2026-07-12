import React, { useEffect, useState, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import { useWorkspaceStore } from '../../../contexts/useWorkspaceStore';
import { X, Save, Edit, PanelLeftOpen } from 'lucide-react';
import { getFileIcon } from '../../../utils/fileIcon';
import { vue } from '@codemirror/lang-vue';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';
import Terminal from '../../../components/ssh/Terminal';
import { DiffTabViewer } from './DiffTabViewer';

interface TabContextMenuProps {
  x: number;
  y: number;
  items: Array<{
    label?: string;
    danger?: boolean;
    divider?: boolean;
    onClick?: (e: React.MouseEvent) => void | Promise<void>;
  }>;
  onClose: () => void;
}

const TabContextMenu: React.FC<TabContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-[#151b26] rounded-xl shadow-2xl border border-white/10 py-1.5 min-w-[180px] select-none"
      style={{ left: x, top: y }}
    >
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="my-1 border-t border-white/5" />
        ) : (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              it.onClick?.(e);
              onClose();
            }}
            className={`w-full text-left px-4 py-1.5 text-xs transition-colors ${
              it.danger
                ? 'text-[#f87171] hover:bg-[#ef4444]/10'
                : 'text-slate-200 hover:bg-white/5'
            }`}
          >
            {it.label}
          </button>
        )
      )}
    </div>
  );
};

export const CodeEditor: React.FC = () => {
  const { 
    openTabs, 
    activeTabPath, 
    closeFile, 
    updateTabContent, 
    saveFile, 
    setActiveTab, 
    isSidebarCollapsed, 
    setSidebarCollapsed,
    closeAllTabs,
    closeOthers,
    closeLeft,
    closeRight
  } = useWorkspaceStore();

  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const [editorVal, setEditorVal] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabPath: string } | null>(null);

  // Sync editor internal value with active tab changes
  useEffect(() => {
    if (activeTab) {
      setEditorVal(activeTab.content);
    } else {
      setEditorVal('');
    }
  }, [activeTabPath, activeTab?.content]);

  // Support Cmd+S / Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabPath) {
          saveFile(activeTabPath);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabPath]);

  // Detect language based on extension
  const getLanguageExtension = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return [javascript({ typescript: true, jsx: true })];
      case 'js':
      case 'jsx':
        return [javascript({ jsx: true })];
      case 'json':
        return [json()];
      case 'html':
        return [html()];
      case 'css':
        return [css()];
      case 'vue':
        return [vue()];
      case 'java':
      case 'class':
        return [java()];
      case 'rs':
        return [rust()];
      default:
        return [];
    }
  };

  const handleEditorChange = (value: string) => {
    if (activeTabPath) {
      setEditorVal(value);
      updateTabContent(activeTabPath, value);
    }
  };

  const buildTabMenuItems = (path: string) => {
    return [
      {
        label: 'Close',
        onClick: () => {
          closeFile(path);
        }
      },
      {
        label: 'Close Others',
        onClick: () => {
          closeOthers(path);
        }
      },
      {
        label: 'Close Left',
        onClick: () => {
          closeLeft(path);
        }
      },
      {
        label: 'Close Right',
        onClick: () => {
          closeRight(path);
        }
      },
      { divider: true },
      {
        label: 'Close All',
        danger: true,
        onClick: () => {
          closeAllTabs();
        }
      }
    ];
  };

  const renderEditorBody = () => {
    if (!activeTab) return null;

    if (activeTab.isTerminal) {
      return (
        <div className="flex-1 h-full bg-[#0f1117] relative flex flex-col min-h-0">
          <Terminal
            sshId={activeTab.path}
            isConnected={true}
            mode="local"
            cwd={activeTab.content}
          />
        </div>
      );
    }

    if (activeTab.isDiff && activeTab.diffInfo) {
      return (
        <DiffTabViewer
          path={activeTab.path}
          name={activeTab.name}
          originalContent={activeTab.diffInfo.originalContent}
          modifiedContent={activeTab.diffInfo.modifiedContent}
          originalLabel={activeTab.diffInfo.originalLabel}
          modifiedLabel={activeTab.diffInfo.modifiedLabel}
        />
      );
    }

    if (activeTab.unsupported) {
      const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      return (
        <div className="flex-1 h-full bg-[#0f1117] flex flex-col items-center justify-center text-slate-500 font-mono text-xs select-none p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-950/40 border border-white/5 flex items-center justify-center mb-4 shadow-xl">
            {getFileIcon(activeTab.name, "w-8 h-8")}
          </div>
          <h4 className="text-sm font-bold text-slate-300 mb-1.5 truncate max-w-[80%]">{activeTab.name}</h4>
          <p className="text-[11px] text-slate-400 mb-4 select-all break-all max-w-[90%] font-mono">
            {activeTab.path}
          </p>
          <div className="px-3.5 py-2 bg-slate-950/30 rounded-xl border border-white/5 text-[10px] space-y-1 text-left min-w-[200px]">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">文件大小:</span>
              <span className="text-slate-300 font-bold">{formatBytes(activeTab.size || 0)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">文件类型:</span>
              <span className="text-slate-300 uppercase font-bold">{activeTab.name.split('.').pop() || '未知'}</span>
            </div>
          </div>
          <p className="text-[10px] text-red-400 mt-6 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/10">
            ⚠️ 该文件格式不支持预览
          </p>
        </div>
      );
    }

    const ext = activeTab.name.split('.').pop()?.toLowerCase();
    const isPdf = ext === 'pdf';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '');

    if (isPdf) {
      return (
        <div className="flex-1 overflow-hidden relative min-h-0 h-full w-full bg-[#0f1117]">
          <iframe
            src={`data:application/pdf;base64,${activeTab.content}`}
            className="w-full h-full border-none bg-slate-900/10"
            title={activeTab.name}
          />
        </div>
      );
    }

    if (isImage) {
      const getMimeType = (fileName: string) => {
        const fileExt = fileName.split('.').pop()?.toLowerCase();
        if (fileExt === 'svg') return 'image/svg+xml';
        if (fileExt === 'ico') return 'image/x-icon';
        return `image/${fileExt || 'png'}`;
      };

      return (
        <div className="flex-1 overflow-auto relative min-h-0 h-full w-full flex items-center justify-center p-8 bg-slate-950/40">
          <img
            src={`data:${getMimeType(activeTab.name)};base64,${activeTab.content}`}
            alt={activeTab.name}
            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg border border-white/5"
          />
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-auto relative min-h-0 text-sm font-mono scrollbar-thin h-full">
        {/* Floating Save Button */}
        {activeTab.isDirty && activeTabPath && (
          <button
            onClick={() => saveFile(activeTabPath)}
            className="absolute top-3 right-5 z-20 px-2.5 py-1 text-[10px] font-bold bg-primary text-white rounded-md shadow-md shadow-primary/25 hover:bg-primary-hover flex items-center space-x-1.5 transition-all opacity-70 hover:opacity-100 uppercase"
          >
            <Save className="w-3.5 h-3.5" />
            <span>保存 // SAVE</span>
          </button>
        )}

        <CodeMirror
          value={editorVal}
          height="100%"
          theme={oneDark}
          extensions={getLanguageExtension(activeTab.name)}
          onChange={handleEditorChange}
          style={{
            fontSize: `${localStorage.getItem('editorFontSize') || '14'}px`,
            fontFamily: localStorage.getItem('editorFontFamily') || 'Monaco, "Fira Code", monospace'
          }}
          className="h-full bg-slate-900/40 focus:outline-none"
        />
      </div>
    );
  };

  const showTabList = openTabs.length > 0 || isSidebarCollapsed;

  return (
    <div className="flex-1 h-full bg-[#0f1117] flex flex-col min-w-0 overflow-hidden relative">
      {/* File Tab List */}
      {showTabList && (
        <div className="flex bg-[#0f1117] border-b border-white/5 overflow-x-auto select-none scrollbar-none flex-shrink-0 h-9">
          {isSidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="px-3 border-r border-white/5 hover:bg-white/5 text-slate-400 hover:text-white transition-all flex items-center justify-center flex-shrink-0"
              title="展开资源管理器"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          {openTabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            return (
              <div
                key={tab.path}
                className={`flex items-center space-x-2 px-4 py-2 border-r border-white/5 cursor-pointer text-xs transition-all relative ${
                  isActive ? 'bg-slate-900/60 text-white border-t-2 border-t-primary' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
                onClick={() => setActiveTab(tab.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, tabPath: tab.path });
                }}
              >
                <span className="flex-shrink-0">{getFileIcon(tab.name, "w-3.5 h-3.5")}</span>
                <span className="font-mono truncate max-w-[120px]">{tab.name}</span>
                {tab.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" title="未保存" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(tab.path);
                  }}
                  className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Body or Empty State */}
      {activeTabPath && activeTab ? (
        renderEditorBody()
      ) : (
        <div className="flex-1 h-full bg-[#0f1117] flex flex-col items-center justify-center text-slate-500 font-mono text-xs select-none">
          <Edit className="w-12 h-12 mb-3 text-slate-700/60" />
          <p>双击左侧文件开始编写代码</p>
          <p className="text-[10px] text-slate-600 mt-1">快捷键: 双击文件打开 • Ctrl+S 保存</p>
        </div>
      )}

      {/* Tab Context Menu */}
      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildTabMenuItems(ctxMenu.tabPath)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
};
