import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../contexts/AppContext';
import { useWorkspaceStore } from '../../contexts/useWorkspaceStore';
import { FileExplorer } from './components/FileExplorer';
import { CodeEditor } from './components/CodeEditor';
import { ArrowLeft, PanelLeftClose, GitBranch } from 'lucide-react';
import { BranchesDialog } from './components/git/BranchesDialog';
import ChatPage from '../ChatPage';

const WorkspacePage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const currentProject = useWorkspaceStore((s) => s.currentProject);
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const isSidebarCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);
  const setSidebarCollapsed = useWorkspaceStore((s) => s.setSidebarCollapsed);
  const sidebarWidth = useWorkspaceStore((s) => s.sidebarWidth);
  const setSidebarWidth = useWorkspaceStore((s) => s.setSidebarWidth);
  const gitBranch = useWorkspaceStore((s) => s.gitBranch);
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const gitRepoBranches = useWorkspaceStore((s) => s.gitRepoBranches);
  const [showBranchModal, setShowBranchModal] = React.useState(false);
  const showAiSidebar = useWorkspaceStore((s) => s.isAiSidebarOpen);
  const setShowAiSidebar = useWorkspaceStore((s) => s.setAiSidebarOpen);
  const [aiSidebarWidth, setAiSidebarWidth] = React.useState(400);

  const branchLabel = React.useMemo(() => {
    if (!gitBranch || gitRoots.length === 0) return null;
    let activeRoot = gitRoots[0];
    if (activeTabPath) {
      const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
      const matched = sorted.find(r => activeTabPath.startsWith(r));
      if (matched) activeRoot = matched;
    }
    const isWindows = activeRoot.includes('\\') || (!activeRoot.startsWith('/') && activeRoot.includes(':'));
    const sep = isWindows ? '\\' : '/';
    const folderName = activeRoot.substring(activeRoot.lastIndexOf(sep) + 1) || activeRoot;
    return `${folderName}: ${gitBranch}`;
  }, [gitBranch, gitRoots, gitRepoBranches, activeTabPath]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(160, Math.min(600, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    const project = state.projects.find((p) => p.id === projectId);
    if (project) {
      setCurrentProject(project);
    } else {
      navigate('/projects');
    }
  }, [projectId, state.projects, setCurrentProject, navigate]);

  const openAndAttachSelection = () => {
    setShowAiSidebar(true);
    const selection = window.getSelection()?.toString();
    if (selection && selection.trim()) {
      let activeFileName = '';
      if (activeTabPath) {
        activeFileName = activeTabPath.split(/[\/\\]/).pop() || '';
      }
      
      const attached = {
        name: activeFileName ? `${activeFileName} (选区)` : '代码选区',
        path: activeTabPath || 'selection',
        type: 'text',
        data: selection,
        mimeType: 'text/plain',
      };
      
      setTimeout(() => {
        const event = new CustomEvent('attach-file-to-agent', { detail: attached });
        window.dispatchEvent(event);
      }, 100);
    }
  };

  const handleAiMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = aiSidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(280, Math.min(800, startWidth - deltaX));
      setAiSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Bind Ctrl+I / Cmd+I shortcut to toggle AI Agent sidebar and capture selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        if (!showAiSidebar) {
          openAndAttachSelection();
          setShowAiSidebar(true);
        } else {
          setShowAiSidebar(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabPath, aiSidebarWidth, showAiSidebar, setShowAiSidebar]);

  // Automatically open the sidebar when a file is attached to the agent from elsewhere
  useEffect(() => {
    const handleAttachFileGlobal = () => {
      setShowAiSidebar(true);
    };
    window.addEventListener('attach-file-to-agent', handleAttachFileGlobal);
    return () => {
      window.removeEventListener('attach-file-to-agent', handleAttachFileGlobal);
    };
  }, []);

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 font-mono text-xs">
        正在加载项目工作区...
      </div>
    );
  }

  // Get project root path
  const rootPath = currentProject.codePath || currentProject.path;

  // Generate breadcrumbs segments matching the reference image layout
  const getBreadcrumbs = () => {
    const rootFolder = rootPath.split(/[\/\\]/).filter(Boolean).pop() || currentProject.name;
    if (!activeTabPath) {
      return ['Home', rootFolder];
    }
    
    let relPath = activeTabPath.substring(rootPath.length);
    if (relPath.startsWith('/') || relPath.startsWith('\\')) {
      relPath = relPath.substring(1);
    }
    
    // Ignore terminal tab IDs
    if (activeTabPath.startsWith('terminal-')) {
      const parts = activeTabPath.split('-');
      // terminal-path-timestamp: parts[1] is the working directory of terminal
      const termPath = parts[1] || rootPath;
      const termRelPath = termPath.substring(rootPath.length);
      const termRelClean = (termRelPath.startsWith('/') || termRelPath.startsWith('\\')) ? termRelPath.substring(1) : termRelPath;
      const relSegments = termRelClean.split(/[\/\\]/).filter(Boolean);
      return ['Home', rootFolder, ...relSegments, 'Terminal'];
    }

    const relSegments = relPath.split(/[\/\\]/).filter(Boolean);
    return ['Home', rootFolder, ...relSegments];
  };

  const breadcrumbs = getBreadcrumbs();
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutText = isMac ? '⌘I' : 'Ctrl+I';

  return (
    <div className="flex h-full w-full bg-background-primary overflow-hidden text-text-primary select-none">
      {/* Sidebar: File Tree */}
      {!isSidebarCollapsed && (
        <div 
          style={{ width: sidebarWidth }}
          className="flex-shrink-0 flex flex-col border-r border-border-primary h-full bg-background-primary relative select-none"
        >
          {/* Resize Handle */}
          <div
            className="absolute top-0 right-[-3px] bottom-0 w-[6px] cursor-col-resize hover:bg-primary/30 active:bg-primary z-50 transition-colors"
            onMouseDown={handleMouseDown}
          />
          {/* Back to project list */}
          <div className="p-3 border-b border-border-primary bg-background-secondary/40 flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <button
                onClick={() => {
                  setCurrentProject(null);
                  navigate('/projects');
                }}
                className="p-1 rounded text-text-secondary hover:bg-background-secondary/80 hover:text-text-primary transition-colors flex-shrink-0"
                title="返回项目目录"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold text-text-primary font-mono truncate" title={currentProject?.name}>
                {currentProject?.name}
              </span>
            </div>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1 rounded hover:bg-background-secondary/80 text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
              title="折叠侧边栏"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>

        
        <div className="flex-1 min-h-0">
          <FileExplorer />
        </div>
      </div>
      )}

      {/* Main Workspace (Editor + Bottom Breadcrumbs Bar) */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Editor Zone */}
        <div className="flex-1 min-h-0 flex flex-col">
          <CodeEditor />
        </div>

        {/* Bottom Breadcrumbs & AI Agent bar matching the screenshot layout */}
        <div className="h-10 bg-background-secondary border-t border-border-primary px-4 flex items-center justify-between flex-shrink-0 select-none text-[11px] text-text-secondary font-sans">
          {/* Left: Path Breadcrumbs */}
          <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none py-1 flex-1 pr-4">
            {breadcrumbs.map((seg, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="text-text-tertiary font-mono text-[9px] select-none">&gt;</span>}
                <div 
                  className={`border border-border-primary bg-background-primary rounded-full px-2.5 py-0.5 text-[10px] whitespace-nowrap transition-colors max-w-[150px] truncate ${
                    idx === breadcrumbs.length - 1 ? 'text-text-primary font-semibold border-primary/20 bg-primary-light/10' : 'text-text-secondary hover:text-text-primary'
                  }`}
                  title={seg}
                >
                  {seg}
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Right side: Branch Widget + Open AI Agent shortcut */}
          <div className="flex items-center space-x-2.5 flex-shrink-0">
            {branchLabel && (
              <button
                onClick={() => setShowBranchModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1 bg-background-primary border border-border-primary hover:border-text-secondary rounded-full hover:bg-background-tertiary text-text-secondary hover:text-text-primary transition-all duration-150 font-semibold text-[10px] cursor-pointer shadow-lg shadow-black/5 font-mono"
                title="切换 Git 分支"
              >
                <GitBranch className="w-3 h-3 text-primary" />
                <span>{branchLabel}</span>
              </button>
            )}

            <button
              onClick={() => {
                if (!showAiSidebar) {
                  openAndAttachSelection();
                } else {
                  setShowAiSidebar(false);
                }
              }}
              className={`flex items-center space-x-1.5 px-3 py-1 bg-background-primary border rounded-full hover:bg-background-tertiary text-text-secondary hover:text-text-primary transition-all duration-150 font-medium text-[10px] cursor-pointer shadow-lg shadow-black/5 ${
                showAiSidebar ? 'border-primary/60 bg-primary-light/5 text-primary' : 'border-border-primary hover:border-primary/45'
              }`}
              title="快捷键 打开 AI 助手"
            >
              <span>Open AI agent</span>
              <span className="px-1.5 py-0.5 bg-background-secondary text-text-tertiary rounded text-[9px] font-mono border border-border-primary ml-0.5 select-none">{shortcutText}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Right Sidebar: AI Assistant Side Panel */}
      {showAiSidebar && (
        <div 
          style={{ width: aiSidebarWidth }}
          className="flex-shrink-0 flex flex-col border-l border-border-primary h-full bg-background-primary relative select-none animate-in slide-in-from-right duration-200"
        >
          {/* Resize Handle */}
          <div
            className="absolute top-0 left-[-3px] bottom-0 w-[6px] cursor-col-resize hover:bg-primary/30 active:bg-primary z-50 transition-colors"
            onMouseDown={handleAiMouseDown}
          />
          <div className="flex-1 min-h-0">
            <ChatPage isSidebarMode={true} onClose={() => setShowAiSidebar(false)} />
          </div>
        </div>
      )}

      {showBranchModal && (
        <BranchesDialog
          path={activeTabPath || rootPath}
          onClose={() => setShowBranchModal(false)}
        />
      )}
    </div>
  );
};

export default WorkspacePage;
