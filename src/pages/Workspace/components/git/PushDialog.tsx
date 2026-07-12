import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { 
  X, ArrowUpRight, AlertTriangle, Folder, FolderOpen, FileCode, 
  ChevronDown, ChevronRight, Plus, HelpCircle, ChevronUp, Loader2,
  Maximize2, Minimize2, Eye, Edit2, ListCollapse, ListTree
} from 'lucide-react';

interface PushDialogProps {
  path: string;
  onClose: () => void;
}

interface GitCommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  status?: string;
  children: TreeNode[];
}

export const PushDialog: React.FC<PushDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const gitRepoBranches = useWorkspaceStore((s) => s.gitRepoBranches);
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);
  const openDiff = useWorkspaceStore((s) => s.openDiff);

  // Resolve Git Root repository path
  const projectPath = useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);

  const repoName = useMemo(() => {
    if (!projectPath) return '';
    return projectPath.split('/').pop() || '';
  }, [projectPath]);

  const currentBranch = gitRepoBranches[projectPath] || 'main';

  const [loading, setLoading] = useState(false);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);

  const [remotes, setRemotes] = useState<[string, string][]>([]);
  const [selectedRemote, setSelectedRemote] = useState('origin');
  const [targetBranch, setTargetBranch] = useState(currentBranch);
  
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<GitCommitInfo | null>(null);
  const [commitFiles, setCommitFiles] = useState<{ path: string; status: string }[]>([]);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Inline branch creation state
  const [showNewBranchForm, setShowNewBranchForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchError, setNewBranchError] = useState<string | null>(null);

  // Bottom settings
  const [pushTags, setPushTags] = useState(false);
  const [tagOption, setTagOption] = useState<'All' | 'Current'>('All');
  
  // Custom split-button dropdown state
  const [showPushMenu, setShowPushMenu] = useState(false);
  const pushMenuRef = useRef<HTMLDivElement>(null);

  // Tree expanded state
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (pushMenuRef.current && !pushMenuRef.current.contains(e.target as Node)) {
        setShowPushMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Load remotes list
  const loadRemotes = async () => {
    if (!projectPath) return;
    try {
      const res = await window.electronAPI.gitRemotes(projectPath);
      setRemotes(res);
      if (res.length > 0) {
        setSelectedRemote(res[0][0]);
      }
    } catch (err: any) {
      console.error('Failed to load remotes:', err);
    }
  };

  useEffect(() => {
    loadRemotes();
  }, [projectPath]);

  // Load unpushed commits
  const loadCommits = async () => {
    if (!projectPath || !selectedRemote || !targetBranch) return;
    setCommitsLoading(true);
    try {
      const res = await window.electronAPI.gitUnpushedCommits(projectPath, selectedRemote, targetBranch);
      setCommits(res);
      if (res.length > 0) {
        setSelectedCommit(res[0]);
      } else {
        setSelectedCommit(null);
      }
    } catch (err: any) {
      console.error('Failed to load unpushed commits:', err);
      setCommits([]);
      setSelectedCommit(null);
    } finally {
      setCommitsLoading(false);
    }
  };

  useEffect(() => {
    loadCommits();
  }, [projectPath, selectedRemote, targetBranch, currentBranch]);

  // Load commit files when selectedCommit changes
  const loadCommitFiles = async (hash: string) => {
    if (!projectPath) return;
    setFilesLoading(true);
    try {
      const res = await window.electronAPI.gitCommitFiles(projectPath, hash);
      setCommitFiles(res);
    } catch (err) {
      console.error('Failed to load commit files:', err);
      setCommitFiles([]);
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCommit) {
      loadCommitFiles(selectedCommit.hash);
    } else {
      setCommitFiles([]);
    }
  }, [selectedCommit]);

  const handleFileDoubleClick = async (filePath: string, fileName: string) => {
    if (!selectedCommit || !projectPath) return;
    try {
      const fileStatus = commitFiles.find(f => f.path === filePath)?.status;
      const isAdded = fileStatus === 'A';
      const isDeleted = fileStatus === 'D';

      const originalContent = isAdded 
        ? '' 
        : await window.electronAPI.gitShowFile(projectPath, `${selectedCommit.hash}^`, filePath);

      const modifiedContent = isDeleted 
        ? '' 
        : await window.electronAPI.gitShowFile(projectPath, selectedCommit.hash, filePath);

      const absoluteFilePath = `${projectPath}/${filePath}`.replace(/\\/g, '/');

      openDiff(
        absoluteFilePath, 
        fileName, 
        originalContent, 
        modifiedContent, 
        `${selectedCommit.hash.substring(0, 7)}^`, 
        selectedCommit.hash.substring(0, 7)
      );
      onClose();
    } catch (err: any) {
      console.error('Failed to open diff:', err);
      alert('无法打开版本比对: ' + err.message);
    }
  };

  const handlePush = async (force: boolean) => {
    if (!projectPath || loading) return;

    setLoading(true);
    setErrorMsg(null);
    setShowPushMenu(false);

    try {
      // In the future, we could also push tags if pushTags is true
      await window.electronAPI.gitPush(projectPath, selectedRemote, targetBranch, force);
      await refreshGitStatus();
      onClose();
    } catch (err: any) {
      setErrorMsg('Push 失败: ' + err.message);
      setLoading(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newBranchName.trim();
    if (!name || !projectPath) return;

    setNewBranchError(null);
    try {
      await window.electronAPI.gitCreateBranch(projectPath, name, null, true);
      await refreshGitStatus();
      setTargetBranch(name);
      setShowNewBranchForm(false);
      setNewBranchName('');
    } catch (err: any) {
      setNewBranchError(err.message || '创建分支失败');
    }
  };

  // Build tree from files list
  const fileTree = useMemo(() => {
    const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
    commitFiles.forEach(file => {
      const parts = file.path.split('/');
      let current = root;
      let currentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;
        let child = current.children.find(c => c.name === part);
        if (!child) {
          child = {
            name: part,
            path: currentPath,
            isDir: !isLast,
            status: isLast ? file.status : undefined,
            children: []
          };
          current.children.push(child);
        }
        current = child;
      }
    });

    // Sort folders first, then files
    const sortTree = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach(n => {
        if (n.children.length > 0) {
          sortTree(n.children);
        }
      });
    };
    sortTree(root.children);

    return root.children;
  }, [commitFiles]);

  // Collapse/Expand all triggers
  const handleCollapseAll = () => {
    const newExpanded: Record<string, boolean> = {};
    const traverse = (nodes: TreeNode[]) => {
      nodes.forEach(n => {
        if (n.isDir) {
          newExpanded[n.path] = false;
          traverse(n.children);
        }
      });
    };
    traverse(fileTree);
    setExpandedFolders(newExpanded);
  };

  const handleExpandAll = () => {
    setExpandedFolders({}); // Empty means default expanded
  };

  // Render tree recursively
  const renderFileTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map((node) => {
      const isExpanded = expandedFolders[node.path] !== false;
      const toggleExpand = () => {
        setExpandedFolders(prev => ({
          ...prev,
          [node.path]: !isExpanded
        }));
      };

      if (node.isDir) {
        return (
          <div key={node.path} className="select-none">
            <div
              onClick={toggleExpand}
              className="flex items-center space-x-2 py-1 px-2 hover:bg-white/5 rounded cursor-pointer transition-colors"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              )}
              <Folder className="w-4 h-4 text-blue-400/80 fill-blue-400/10 flex-shrink-0" />
              <span className="text-slate-300 text-xs font-mono truncate">{node.name}</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {node.children.length} file{node.children.length !== 1 && 's'}
              </span>
            </div>
            {isExpanded && renderFileTree(node.children, depth + 1)}
          </div>
        );
      } else {
        let statusColor = 'text-slate-400';
        let statusBg = 'bg-slate-500/15 border-slate-500/30';
        if (node.status === 'A') {
          statusColor = 'text-emerald-400';
          statusBg = 'bg-emerald-500/10 border-emerald-500/20';
        } else if (node.status === 'M') {
          statusColor = 'text-sky-400';
          statusBg = 'bg-sky-500/10 border-sky-500/20';
        } else if (node.status === 'D') {
          statusColor = 'text-rose-400';
          statusBg = 'bg-rose-500/10 border-rose-500/20';
        }

        return (
          <div
            key={node.path}
            onDoubleClick={() => handleFileDoubleClick(node.path, node.name)}
            className="flex items-center justify-between py-1 px-2 hover:bg-white/5 rounded font-mono text-xs select-none group cursor-pointer"
            style={{ paddingLeft: `${depth * 16 + 24}px` }}
            title="Double click to compare versions"
          >
            <div className="flex items-center space-x-2 overflow-hidden mr-2">
              <FileCode className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="text-slate-300 truncate" title={node.path}>
                {node.name}
              </span>
            </div>
            {node.status && (
              <span className={`px-1.5 py-0.2 text-[9px] font-semibold border rounded ${statusColor} ${statusBg} flex-shrink-0`}>
                {node.status}
              </span>
            )}
          </div>
        );
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-[#151b26] border border-white/10 rounded-2xl w-full max-w-[840px] h-[620px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100">
        
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2">
            <ArrowUpRight className="w-4 h-4 text-primary animate-pulse" />
            <h2 className="text-sm font-semibold text-slate-200">
              Push Commits to <span className="text-primary font-mono">{repoName}</span>
            </h2>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>



        {/* Main Body - Split Layout */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          
          {/* Left Pane: Commits & Settings */}
          <div className="w-[42%] border-r border-white/5 flex flex-col bg-[#0e131d]">
            
            {/* Branch path header */}
            <div className="p-3 bg-slate-950/40 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center space-x-2 font-mono text-[11px] overflow-hidden">
                <span className="text-primary font-semibold truncate max-w-[100px]" title={currentBranch}>{currentBranch}</span>
                <span className="text-slate-500 flex-shrink-0">→</span>
                <span className="text-slate-400 flex-shrink-0">{selectedRemote}</span>
                <span className="text-slate-500 flex-shrink-0">:</span>
                <span className="text-sky-400 font-semibold truncate max-w-[100px]" title={targetBranch}>{targetBranch}</span>
              </div>
            </div>

            {/* Commits list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono px-2 py-1">
                Commits to Push ({commits.length})
              </div>

              {commitsLoading ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-2">
                  <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
                  <span className="text-xs text-slate-500 font-mono">Loading commits...</span>
                </div>
              ) : commits.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-500 font-mono px-4">
                  No unpushed commits found for this target.
                </div>
              ) : (
                commits.map((c) => {
                  const isSelected = selectedCommit?.hash === c.hash;
                  return (
                    <div
                      key={c.hash}
                      onClick={() => setSelectedCommit(c)}
                      className={`p-2.5 rounded-xl cursor-pointer transition-all flex flex-col space-y-1 select-none border ${
                        isSelected 
                          ? 'bg-primary/10 border-primary/30 text-white shadow-inner' 
                          : 'bg-[#111724]/40 border-white/5 hover:bg-white/5 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold font-mono text-slate-400 group-hover:text-white truncate mr-2">
                          {c.hash.substring(0, 7)}
                        </span>
                        <span className="text-[9px] font-mono text-slate-500">{c.date}</span>
                      </div>
                      <p className="text-xs font-mono leading-relaxed truncate">{c.message}</p>
                      <div className="text-[9px] font-mono text-slate-500 flex items-center space-x-1">
                        <span>By:</span>
                        <span className="text-slate-400 font-medium truncate max-w-[120px]">{c.author}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Push Settings Panel & Branch creation at bottom of left pane */}
            <div className="p-3 bg-slate-950/30 border-t border-white/5 space-y-3 flex-shrink-0">
              
              {/* Branch switcher/New branch */}
              <div className="space-y-2">
                {showNewBranchForm ? (
                  <form onSubmit={handleCreateBranch} className="space-y-2 bg-slate-950/80 p-2.5 border border-white/10 rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400">New Branch Name:</span>
                      <button 
                        type="button" 
                        onClick={() => setShowNewBranchForm(false)}
                        className="text-slate-500 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center space-x-1">
                      <input
                        type="text"
                        required
                        placeholder="e.g. feat/login"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        className="flex-1 bg-slate-900 border border-white/5 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none font-mono"
                      />
                      <button
                        type="submit"
                        className="bg-primary hover:bg-primary-hover text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        Create
                      </button>
                    </div>
                    {newBranchError && (
                      <div className="text-[9px] text-rose-400 font-mono">{newBranchError}</div>
                    )}
                  </form>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-mono text-slate-400">
                      Local Branch: <span className="text-primary font-bold">{currentBranch}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewBranchForm(true);
                        setNewBranchName('');
                        setNewBranchError(null);
                      }}
                      className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 text-[10px] rounded-lg border border-white/5 transition-all cursor-pointer font-semibold"
                    >
                      <Plus className="w-3 h-3 text-primary" />
                      <span>New Branch</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Remote / Target Branch controls */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono">Remote:</label>
                  <select
                    value={selectedRemote}
                    onChange={(e) => setSelectedRemote(e.target.value)}
                    disabled={loading}
                    className="w-full bg-slate-950 border border-white/5 text-xs text-white rounded-xl px-2.5 py-2 focus:outline-none focus:border-primary/50 font-mono cursor-pointer"
                  >
                    {remotes.length === 0 ? (
                      <option value="origin">origin</option>
                    ) : (
                      remotes.map(([name, url]) => (
                        <option key={name} value={name}>{name}</option>
                      ))
                    )}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono">Target Branch:</label>
                  <input
                    type="text"
                    required
                    value={targetBranch}
                    onChange={(e) => setTargetBranch(e.target.value)}
                    disabled={loading}
                    className="w-full bg-slate-950 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl px-2.5 py-2 focus:outline-none font-mono"
                  />
                </div>
              </div>

            </div>

          </div>

          {/* Right Pane: Changed Files List */}
          <div className="w-[58%] flex flex-col bg-[#0b0e14]">
            
            {/* File List Toolbar (Matches screenshot exactly!) */}
            <div className="px-3 py-2 bg-slate-950/30 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center space-x-3">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                  Changed Files ({commitFiles.length})
                </span>
                
                {/* Visual action markers from IntelliJ push dialog */}
                <div className="flex items-center space-x-1.5 border-l border-white/5 pl-3">
                  <button className="text-slate-400 hover:text-white p-0.5 rounded transition-colors" title="Go to Source">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                  <button className="text-slate-400 hover:text-white p-0.5 rounded transition-colors" title="View Source">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button className="text-slate-400 hover:text-white p-0.5 rounded transition-colors" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Collapse/Expand action buttons */}
              <div className="flex items-center space-x-1">
                <button 
                  onClick={handleExpandAll}
                  className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/5 transition-colors"
                  title="Expand All"
                >
                  <ListTree className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={handleCollapseAll}
                  className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/5 transition-colors"
                  title="Collapse All"
                >
                  <ListCollapse className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Files list / tree */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
              {filesLoading ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-2">
                  <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
                  <span className="text-xs text-slate-500 font-mono">Loading changed files...</span>
                </div>
              ) : !selectedCommit ? (
                <div className="text-center py-20 text-xs text-slate-500 font-mono">
                  Select a commit on the left to inspect changed files.
                </div>
              ) : commitFiles.length === 0 ? (
                <div className="text-center py-20 text-xs text-slate-500 font-mono">
                  No files were modified in this commit.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {renderFileTree(fileTree)}
                </div>
              )}
            </div>

          </div>

        </div>

        {/* Error message banner */}
        {errorMsg && (
          <div className="mx-5 my-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start space-x-2 text-xs text-red-400 flex-shrink-0">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-all font-mono">{errorMsg}</span>
          </div>
        )}

        {/* Bottom Bar Controls */}
        <div className="p-4 border-t border-white/5 bg-[#151b26] flex items-center justify-between flex-shrink-0">
          
          {/* Help & Push Tags section */}
          <div className="flex items-center space-x-4 text-xs select-none">
            <button className="text-slate-400 hover:text-white cursor-pointer" title="Help">
              <HelpCircle className="w-4 h-4" />
            </button>
            <div className="flex items-center space-x-2 font-mono">
              <input
                id="push-tags-chk"
                type="checkbox"
                checked={pushTags}
                onChange={(e) => setPushTags(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/5 bg-slate-950 accent-primary cursor-pointer"
              />
              <label htmlFor="push-tags-chk" className="text-slate-400 cursor-pointer">Push tags:</label>
              <select
                value={tagOption}
                onChange={(e) => setTagOption(e.target.value as any)}
                disabled={!pushTags}
                className="bg-slate-950 border border-white/5 text-[10px] text-white rounded-lg px-2 py-0.5 focus:outline-none disabled:opacity-40 cursor-pointer font-bold"
              >
                <option value="All">All</option>
                <option value="Current">Current branch</option>
              </select>
            </div>
          </div>

          {/* Cancel & Push Buttons */}
          <div className="flex items-center space-x-3 text-xs font-semibold">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl transition-all cursor-pointer font-semibold border border-white/5"
            >
              Cancel
            </button>
            
            {/* Split Push Button Dropdown */}
            <div className="relative flex items-center" ref={pushMenuRef}>
              <button
                type="button"
                onClick={() => handlePush(false)}
                disabled={loading}
                className="px-5 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white rounded-l-xl transition-all cursor-pointer flex items-center space-x-1.5 shadow-lg shadow-primary/20"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Pushing...</span>
                  </>
                ) : (
                  <span>Push</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => !loading && setShowPushMenu(!showPushMenu)}
                disabled={loading}
                className="px-2 py-2 bg-primary/95 border-l border-white/10 hover:bg-primary-hover disabled:bg-primary/50 text-white rounded-r-xl transition-all cursor-pointer flex items-center justify-center shadow-lg shadow-primary/20"
              >
                <ChevronDown className="w-4 h-4" />
              </button>

              {/* Action Dropdown Menu */}
              {showPushMenu && (
                <div className="absolute right-0 bottom-full mb-1.5 bg-[#1a2333] border border-white/10 rounded-xl w-36 shadow-2xl py-1 z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <button
                    type="button"
                    onClick={() => handlePush(false)}
                    className="w-full text-left px-3 py-2 text-slate-200 hover:bg-white/5 hover:text-white transition-colors cursor-pointer font-mono font-medium"
                  >
                    Push Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePush(true)}
                    className="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors cursor-pointer border-t border-white/5 font-mono font-medium"
                  >
                    Push Anyway (Force)
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
