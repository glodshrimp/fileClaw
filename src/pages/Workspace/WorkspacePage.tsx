import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../contexts/AppContext';
import { useWorkspaceStore } from '../../contexts/useWorkspaceStore';
import { FileExplorer } from './components/FileExplorer';
import { CodeEditor } from './components/CodeEditor';
import { ArrowLeft, PanelLeftClose, GitBranch } from 'lucide-react';
import { BranchesDialog } from './components/git/BranchesDialog';

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
    return () => {
      setCurrentProject(null);
    };
  }, [projectId, state.projects, setCurrentProject, navigate]);

  // Bind Ctrl+I / Cmd+I shortcut to switch to AI Agent chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        navigate('/chat');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

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
    <div className="flex h-full w-full bg-[#0f1117] overflow-hidden text-slate-200 select-none">
      {/* Sidebar: File Tree */}
      {!isSidebarCollapsed && (
        <div 
          style={{ width: sidebarWidth }}
          className="flex-shrink-0 flex flex-col border-r border-white/5 h-full bg-[#0f1117] relative select-none"
        >
          {/* Resize Handle */}
          <div
            className="absolute top-0 right-[-3px] bottom-0 w-[6px] cursor-col-resize hover:bg-primary/30 active:bg-primary z-50 transition-colors"
            onMouseDown={handleMouseDown}
          />
          {/* Back to project list */}
          <div className="p-3 border-b border-white/5 bg-slate-950/40 flex items-center justify-between">
            <button
              onClick={() => navigate('/projects')}
              className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回项目目录</span>
            </button>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
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
        <div className="h-10 bg-[#0c0d12] border-t border-white/5 px-4 flex items-center justify-between flex-shrink-0 select-none text-[11px] text-slate-400 font-sans">
          {/* Left: Path Breadcrumbs */}
          <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none py-1 flex-1 pr-4">
            {breadcrumbs.map((seg, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="text-slate-600 font-mono text-[9px] select-none">&gt;</span>}
                <div 
                  className={`border border-white/[0.06] bg-[#161a23]/60 rounded-full px-2.5 py-0.5 text-[10px] whitespace-nowrap transition-colors max-w-[150px] truncate ${
                    idx === breadcrumbs.length - 1 ? 'text-slate-200 font-semibold border-white/10 bg-slate-800/40' : 'text-slate-400 hover:text-slate-200'
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
                className="flex items-center space-x-1.5 px-3 py-1 bg-slate-900 border border-white/10 hover:border-white/20 rounded-full hover:bg-slate-850 text-slate-300 hover:text-white transition-all duration-150 font-semibold text-[10px] cursor-pointer shadow-lg shadow-black/25 font-mono"
                title="切换 Git 分支"
              >
                <GitBranch className="w-3 h-3 text-primary" />
                <span>{branchLabel}</span>
              </button>
            )}

            <button
              onClick={() => navigate('/chat')}
              className="flex items-center space-x-1.5 px-3 py-1 bg-slate-900 border border-white/10 hover:border-primary/45 rounded-full hover:bg-slate-850 text-slate-300 hover:text-white transition-all duration-150 font-medium text-[10px] cursor-pointer shadow-lg shadow-black/25"
              title="快捷键 打开 AI 助手"
            >
              <span>Open AI agent</span>
              <span className="px-1.5 py-0.5 bg-slate-800/80 text-slate-500 rounded text-[9px] font-mono border border-white/5 ml-0.5 select-none">{shortcutText}</span>
            </button>
          </div>
        </div>
      </div>

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
