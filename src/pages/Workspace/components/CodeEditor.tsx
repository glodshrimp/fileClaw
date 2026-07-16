import React, { useEffect, useState, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import { useWorkspaceStore } from '../../../contexts/useWorkspaceStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { X, Save, Edit, PanelLeftOpen, GitBranch, Eye, AlertTriangle, FileText } from 'lucide-react';
import { getFileIcon } from '../../../utils/fileIcon';
import { vue } from '@codemirror/lang-vue';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';
import Terminal from '../../../components/ssh/Terminal';
import { DiffTabViewer } from './DiffTabViewer';
import { GitGraphTab } from './git/GitGraphTab';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// @ts-ignore
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
// @ts-ignore
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
  const { theme } = useTheme();
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
    closeRight,
    openMarkdownPreview
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

    if (activeTab.isMarkdownPreview) {
      const originalTab = openTabs.find(t => t.path === activeTab.previewSourcePath);
      const previewContent = originalTab ? originalTab.content : activeTab.content;

      return (
        <div className="flex-1 overflow-auto relative min-h-0 h-full w-full bg-background-primary p-8 select-text">
          {/* Quick edit button to jump back */}
          {activeTab.previewSourcePath && (
            <button
              onClick={() => setActiveTab(activeTab.previewSourcePath!)}
              className="absolute top-3 right-5 z-20 px-2.5 py-1 text-[10px] font-bold bg-primary hover:bg-primary-hover text-white rounded-md shadow-md shadow-primary/25 flex items-center space-x-1.5 transition-all uppercase"
            >
              <Edit className="w-3.5 h-3.5" />
              <span>编辑 // EDIT</span>
            </button>
          )}

          <div className="max-w-3xl mx-auto prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent text-text-primary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  return !inline && match ? (
                    <div className="rounded-lg overflow-hidden my-4 border border-border shadow-sm">
                      <div className="bg-background-tertiary px-4 py-1.5 border-b border-border flex justify-between items-center text-[10px] text-text-tertiary uppercase font-mono">
                        <span>{match[1]}</span>
                      </div>
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{ margin: 0, background: 'transparent', padding: '1rem', fontSize: '12px' }}
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    <code className="bg-background-tertiary px-1.5 py-0.5 rounded text-primary font-mono text-xs border border-border">
                      {children}
                    </code>
                  );
                },
                table({ children }) {
                  return <div className="overflow-x-auto my-4 rounded-lg border border-border"><table className="min-w-full divide-y divide-border">{children}</table></div>;
                },
                th({ children }) {
                  return <th className="px-4 py-2 bg-background-tertiary text-left text-xs font-bold uppercase tracking-wider text-text-secondary">{children}</th>;
                },
                td({ children }) {
                  return <td className="px-4 py-2 border-t border-border text-sm font-sans text-text-primary">{children}</td>;
                }
              }}
            >
              {previewContent}
            </ReactMarkdown>
          </div>
        </div>
      );
    }

    if (activeTab.isGitGraph) {
      return (
        <GitGraphTab />
      );
    }

    if (activeTab.isTerminal) {
      return (
        <div className="flex-1 h-full bg-background-primary relative flex flex-col min-h-0">
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

      const fileExt = activeTab.name.split('.').pop()?.toLowerCase();
      const isOfficeFile = ['docx', 'doc', 'xlsx', 'xls'].includes(fileExt || '');

      return (
        <div className="flex-1 h-full bg-background-primary flex flex-col items-center justify-center text-text-secondary font-mono text-xs select-none p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-background-secondary/40 border border-border-primary flex items-center justify-center mb-4 shadow-xl">
            {getFileIcon(activeTab.name, "w-8 h-8")}
          </div>
          <h4 className="text-sm font-bold text-text-primary mb-1.5 truncate max-w-[80%]">{activeTab.name}</h4>
          <p className="text-[11px] text-text-secondary mb-4 select-all break-all max-w-[90%] font-mono">
            {activeTab.path}
          </p>
          <div className="px-3.5 py-2 bg-background-secondary/30 rounded-xl border border-border-primary text-[10px] space-y-1 text-left min-w-[200px] mb-6">
            <div className="flex justify-between gap-4">
              <span className="text-text-tertiary">文件大小:</span>
              <span className="text-text-secondary font-bold">{formatBytes(activeTab.size || 0)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-tertiary">文件类型:</span>
              <span className="text-text-secondary uppercase font-bold">{fileExt || '未知'}</span>
            </div>
          </div>

          {isOfficeFile ? (
            <button
              onClick={() => window.electronAPI.openPath(activeTab.path)}
              className="px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl shadow-lg shadow-primary/20 flex items-center space-x-2 font-semibold text-xs transition-all uppercase cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>使用外部应用打开 (WPS Office / Office)</span>
            </button>
          ) : (
            <p className="text-[10px] text-red-400 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/10">
              ⚠️ 该文件格式不支持预览
            </p>
          )}
        </div>
      );
    }

    const ext = activeTab.name.split('.').pop()?.toLowerCase();
    const isPdf = ext === 'pdf';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '');

    if (isPdf) {
      return (
        <div className="flex-1 overflow-hidden relative min-h-0 h-full w-full bg-background-primary">
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
        <div className="flex-1 overflow-auto relative min-h-0 h-full w-full flex items-center justify-center p-8 bg-background-secondary/40">
          <img
            src={`data:${getMimeType(activeTab.name)};base64,${activeTab.content}`}
            alt={activeTab.name}
            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg border border-border-primary"
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

        {/* Floating Preview Button */}
        {activeTab.name.toLowerCase().endsWith('.md') && activeTabPath && (
          <button
            onClick={() => openMarkdownPreview(activeTabPath, activeTab.name)}
            className={`absolute top-3 z-20 px-2.5 py-1 text-[10px] font-bold bg-background-secondary hover:bg-background-tertiary text-text-primary rounded-md shadow-md border border-border flex items-center space-x-1.5 transition-all opacity-70 hover:opacity-100 uppercase ${
              activeTab.isDirty ? 'right-32' : 'right-5'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>预览 // PREVIEW</span>
          </button>
        )}

        <CodeMirror
          value={editorVal}
          height="100%"
          theme={theme === 'dark' ? oneDark : 'light'}
          extensions={getLanguageExtension(activeTab.name)}
          onChange={handleEditorChange}
          style={{
            fontSize: `${localStorage.getItem('editorFontSize') || '14'}px`,
            fontFamily: localStorage.getItem('editorFontFamily') || 'Monaco, "Fira Code", monospace'
          }}
          className="h-full bg-transparent focus:outline-none"
        />
      </div>
    );
  };

  const showTabList = openTabs.length > 0 || isSidebarCollapsed;

  return (
    <div className="flex-1 h-full bg-background-primary flex flex-col min-w-0 overflow-hidden relative">
      {/* File Tab List */}
      {showTabList && (
        <div className="flex bg-background-primary border-b border-border-primary overflow-x-auto select-none scrollbar-none flex-shrink-0 h-9">
          {isSidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="px-3 border-r border-border-primary hover:bg-background-secondary/80 text-text-secondary hover:text-text-primary transition-all flex items-center justify-center flex-shrink-0"
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
                className={`flex items-center space-x-2 px-4 py-2 border-r border-border-primary cursor-pointer text-xs transition-all relative ${
                  isActive ? 'bg-background-secondary/60 text-text-primary border-t-2 border-t-primary font-semibold' : 'text-text-secondary hover:text-text-primary hover:bg-background-secondary/80'
                }`}
                onClick={() => setActiveTab(tab.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, tabPath: tab.path });
                }}
              >
                <span className="flex-shrink-0">
                  {tab.isGitGraph ? (
                    <GitBranch className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  ) : (
                    getFileIcon(tab.name, "w-3.5 h-3.5")
                  )}
                </span>
                <span className="font-mono truncate max-w-[120px]">{tab.name}</span>
                {tab.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" title="未保存" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(tab.path);
                  }}
                  className="p-0.5 rounded hover:bg-background-secondary/85 text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0"
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
        <div className="flex-1 h-full bg-background-primary flex flex-col items-center justify-center text-text-tertiary font-mono text-xs select-none">
          <Edit className="w-12 h-12 mb-3 text-text-tertiary/60" />
          <p>双击左侧文件开始编写代码</p>
          <p className="text-[10px] text-text-tertiary mt-1">快捷键: 双击文件打开 • Ctrl+S 保存</p>
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
