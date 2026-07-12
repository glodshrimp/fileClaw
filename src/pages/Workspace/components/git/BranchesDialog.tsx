import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { X, Check, GitBranch, Plus, Search, AlertTriangle, Settings, ChevronDown, ChevronRight, Tag, Star, Folder } from 'lucide-react';

interface BranchesDialogProps {
  path: string;
  onClose: () => void;
}

interface GitBranchItem {
  name: string;
  is_remote: boolean;
  is_current: boolean;
}

export const BranchesDialog: React.FC<BranchesDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const gitRepoBranches = useWorkspaceStore((s) => s.gitRepoBranches);
  
  const projectPath = useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);

  const activeBranchName = gitRepoBranches[projectPath] || 'HEAD';

  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<GitBranchItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Accordion Expand/Collapse States
  const [localExpanded, setLocalExpanded] = useState(true);
  const [remoteExpanded, setRemoteExpanded] = useState(true);

  // Interactive Context Action Popover State
  const [selectedBranch, setSelectedBranch] = useState<GitBranchItem | null>(null);
  const [popoverCoords, setPopoverCoords] = useState<{ x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sub-modal triggers
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createBaseBranch, setCreateBaseBranch] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [checkoutOnCreate, setCheckoutOnCreate] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<GitBranchItem | null>(null);
  const [renameNewName, setRenameNewName] = useState('');

  const [showTagModal, setShowTagModal] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagCommit, setTagCommit] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [tagForce, setTagForce] = useState(false);

  const fetchBranches = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await window.electronAPI.gitBranches(projectPath);
      setBranches(list);
    } catch (err: any) {
      setErrorMsg('获取分支列表失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, [projectPath]);

  // Click outside to close branch action popover
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectedBranch(null);
        setPopoverCoords(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Filter branches
  const filtered = useMemo(() => {
    return branches.filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [branches, searchQuery]);

  // Separate Local and Remote
  const localBranches = useMemo(() => filtered.filter(b => !b.is_remote), [filtered]);
  const remoteBranches = useMemo(() => filtered.filter(b => b.is_remote), [filtered]);

  // Handle click on branch item: Open context popover
  const handleBranchClick = (e: React.MouseEvent, branch: GitBranchItem) => {
    e.stopPropagation();
    setSelectedBranch(branch);
    
    // Position popover next to clicked item
    const rect = e.currentTarget.getBoundingClientRect();
    setPopoverCoords({
      x: rect.right + 8,
      y: Math.min(rect.top, window.innerHeight - 250),
    });
  };

  // Perform Checkout
  const handleCheckout = async (branchName: string) => {
    setLoading(true);
    setErrorMsg(null);
    setSelectedBranch(null);
    setPopoverCoords(null);
    try {
      await window.electronAPI.gitCheckout(projectPath, branchName);
      const { refreshGitStatus } = useWorkspaceStore.getState();
      await refreshGitStatus();
      await fetchBranches();
    } catch (err: any) {
      setErrorMsg('切换分支失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Perform Create Branch
  const handleCreateBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim() || loading) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      // If overwrite checked, we first try to delete the branch if it exists, or pass flag
      await window.electronAPI.gitCreateBranch(
        projectPath,
        newBranchName.trim(),
        createBaseBranch,
        checkoutOnCreate
      );
      
      const { refreshGitStatus } = useWorkspaceStore.getState();
      await refreshGitStatus();
      await fetchBranches();
      setShowCreateModal(false);
      setNewBranchName('');
      setCreateBaseBranch(null);
    } catch (err: any) {
      setErrorMsg('创建分支失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Perform Rename Branch
  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameNewName.trim() || loading) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await window.electronAPI.gitRenameBranch(
        projectPath,
        renameTarget.name,
        renameNewName.trim()
      );
      const { refreshGitStatus } = useWorkspaceStore.getState();
      await refreshGitStatus();
      await fetchBranches();
      setShowRenameModal(false);
      setRenameTarget(null);
      setRenameNewName('');
    } catch (err: any) {
      setErrorMsg('重命名分支失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Perform Delete Branch
  const handleDeleteBranch = async (branchName: string) => {
    if (branchName === activeBranchName) {
      setErrorMsg('无法删除当前处于活动状态的分支');
      return;
    }
    if (!confirm(`确定要删除分支 "${branchName}" 吗？`)) return;

    setLoading(true);
    setErrorMsg(null);
    setSelectedBranch(null);
    setPopoverCoords(null);
    try {
      await window.electronAPI.gitDeleteBranch(projectPath, branchName, false);
      await fetchBranches();
    } catch (err: any) {
      // Try force delete if standard fails
      if (confirm(`删除失败，是否强行删除分支？\n${err.message}`)) {
        try {
          await window.electronAPI.gitDeleteBranch(projectPath, branchName, true);
          await fetchBranches();
        } catch (forceErr: any) {
          setErrorMsg('强行删除分支失败: ' + forceErr.message);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Perform Create Tag
  const handleCreateTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagName.trim() || loading) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await window.electronAPI.gitCreateTag(
        projectPath,
        tagName.trim(),
        tagCommit.trim() || null,
        tagMessage.trim() || null,
        tagForce
      );
      setShowTagModal(false);
      setTagName('');
      setTagCommit('');
      setTagMessage('');
      setTagForce(false);
    } catch (err: any) {
      setErrorMsg('创建标签失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#151b26] border border-white/10 w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-150 relative">
        
        {/* Title Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-slate-200">Git Branches</h2>
          </div>
          <div className="flex items-center space-x-2">
            <button className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors">
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start space-x-2 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}

        {/* Action Header Panel */}
        <div className="px-5 pt-4 pb-2 border-b border-white/5 space-y-3 flex-shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for branches and actions"
              className="w-full bg-slate-950/40 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl pl-8 pr-3 py-2 focus:outline-none placeholder-slate-500 font-mono transition-all"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              onClick={() => {
                setCreateBaseBranch(null);
                setShowCreateModal(true);
              }}
              className="flex items-center justify-center space-x-1.5 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-slate-300 hover:text-white transition-all cursor-pointer font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Branch...</span>
            </button>
            <button
              onClick={() => setShowTagModal(true)}
              className="flex items-center justify-center space-x-1.5 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-slate-300 hover:text-white transition-all cursor-pointer font-medium"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>New Tag...</span>
            </button>
          </div>
        </div>

        {/* Grouped Accordions List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[220px] scrollbar-thin">
          {loading && branches.length === 0 ? (
            <div className="h-full py-20 flex items-center justify-center text-slate-500 font-mono text-xs">
              读取 Git 分支中...
            </div>
          ) : branches.length === 0 ? (
            <div className="h-full py-20 flex items-center justify-center text-slate-500 font-mono text-xs">
              未检测到分支
            </div>
          ) : (
            <>
              {/* Local Branches Accordion */}
              <div>
                <button
                  onClick={() => setLocalExpanded(!localExpanded)}
                  className="w-full flex items-center space-x-1 py-1.5 text-xs text-slate-400 font-semibold hover:text-white transition-colors"
                >
                  {localExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span>Local</span>
                  <span className="text-[10px] text-slate-600 bg-slate-950/40 px-1.5 py-0.2 rounded ml-1 font-mono">
                    {localBranches.length}
                  </span>
                </button>

                {localExpanded && (
                  <div className="pl-4 mt-1 space-y-0.5">
                    {localBranches.length === 0 ? (
                      <div className="text-[10px] text-slate-600 font-mono py-1.5 pl-2">无本地分支</div>
                    ) : (
                      localBranches.map(b => (
                        <div
                          key={b.name}
                          onClick={(e) => handleBranchClick(e, b)}
                          className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors text-xs font-mono group ${
                            b.is_current
                              ? 'bg-primary/10 text-primary border border-primary/20 font-bold'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <Tag className={`w-3.5 h-3.5 ${b.is_current ? 'text-primary' : 'text-amber-500/80'}`} />
                            <span className="truncate">{b.name}</span>
                          </div>
                          
                          <div className="flex items-center space-x-1.5 text-[9px] text-slate-500 font-sans group-hover:text-slate-300">
                            {b.is_current && <span className="text-[9px] text-primary bg-primary/20 px-1 rounded">active</span>}
                            <span>▶</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Remote Branches Accordion */}
              <div>
                <button
                  onClick={() => setRemoteExpanded(!remoteExpanded)}
                  className="w-full flex items-center space-x-1 py-1.5 text-xs text-slate-400 font-semibold hover:text-white transition-colors"
                >
                  {remoteExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span>Remote</span>
                  <span className="text-[10px] text-slate-600 bg-slate-950/40 px-1.5 py-0.2 rounded ml-1 font-mono">
                    {remoteBranches.length}
                  </span>
                </button>

                {remoteExpanded && (
                  <div className="pl-4 mt-1 space-y-0.5">
                    {remoteBranches.length === 0 ? (
                      <div className="text-[10px] text-slate-600 font-mono py-1.5 pl-2">无远程分支</div>
                    ) : (
                      remoteBranches.map(b => (
                        <div
                          key={b.name}
                          onClick={(e) => handleBranchClick(e, b)}
                          className="flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer text-slate-300 hover:bg-white/5 hover:text-white transition-colors text-xs font-mono group"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <Folder className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                            <span className="truncate">{b.name}</span>
                          </div>
                          <span className="text-[9px] text-slate-500 font-sans group-hover:text-slate-300">▶</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Close Button Footer */}
        <div className="px-5 py-4 bg-slate-950/40 border-t border-white/5 flex items-center justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* ========================================== */}
        {/* BRANCH CONTEXT ACTIONS POPOVER (Image 2)   */}
        {/* ========================================== */}
        {selectedBranch && popoverCoords && (
          <div
            ref={popoverRef}
            className="fixed z-[10005] bg-[#1a2233] border border-white/10 rounded-xl shadow-2xl py-1.5 min-w-[170px] select-none text-xs font-mono animate-in fade-in duration-75"
            style={{ left: popoverCoords.x, top: popoverCoords.y }}
          >
            {!selectedBranch.is_current && (
              <button
                onClick={() => handleCheckout(selectedBranch.name)}
                className="w-full text-left px-4 py-1.5 hover:bg-white/5 text-slate-200 hover:text-white transition-colors"
              >
                Checkout '{selectedBranch.name}'
              </button>
            )}
            
            <button
              onClick={() => {
                setCreateBaseBranch(selectedBranch.name);
                setNewBranchName('');
                setShowCreateModal(true);
                setSelectedBranch(null);
                setPopoverCoords(null);
              }}
              className="w-full text-left px-4 py-1.5 hover:bg-white/5 text-slate-200 hover:text-white transition-colors"
            >
              New Branch from '{selectedBranch.name.substring(selectedBranch.name.lastIndexOf('/') + 1)}'...
            </button>

            {!selectedBranch.is_remote && (
              <>
                <button
                  onClick={() => {
                    setRenameTarget(selectedBranch);
                    setRenameNewName(selectedBranch.name);
                    setShowRenameModal(true);
                    setSelectedBranch(null);
                    setPopoverCoords(null);
                  }}
                  className="w-full text-left px-4 py-1.5 hover:bg-white/5 text-slate-200 hover:text-white transition-colors flex items-center justify-between"
                >
                  <span>Rename...</span>
                  <span className="text-[10px] text-slate-500 font-sans">F2</span>
                </button>
                
                <button
                  onClick={() => handleDeleteBranch(selectedBranch.name)}
                  className="w-full text-left px-4 py-1.5 hover:bg-red-500/10 text-red-400 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {/* ========================================== */}
        {/* CREATE NEW BRANCH SUB-MODAL (Image 3)      */}
        {/* ========================================== */}
        {showCreateModal && (
          <div className="absolute inset-0 bg-black/75 z-[10010] flex items-center justify-center p-4">
            <div className="bg-[#151b26] border border-white/10 rounded-2xl w-full max-w-[340px] shadow-2xl p-5 animate-in zoom-in-95 duration-100 flex flex-col">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Create New Branch</h3>
              
              <form onSubmit={handleCreateBranchSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono">Branch Name:</label>
                  <input
                    type="text"
                    required
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="Enter branch name"
                    autoFocus
                    className="w-full bg-slate-950 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl px-3 py-2 focus:outline-none placeholder-slate-600 font-mono"
                  />
                </div>

                <div className="space-y-2 text-xs select-none">
                  <label className="flex items-center text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checkoutOnCreate}
                      onChange={(e) => setCheckoutOnCreate(e.target.checked)}
                      className="rounded border-white/10 bg-slate-900 text-primary focus:ring-primary focus:ring-offset-slate-950 w-3.5 h-3.5 mr-2 cursor-pointer"
                    />
                    Checkout branch
                  </label>

                  <label className="flex items-center text-slate-400 cursor-pointer opacity-60">
                    <input
                      type="checkbox"
                      checked={overwriteExisting}
                      onChange={(e) => setOverwriteExisting(e.target.checked)}
                      className="rounded border-white/10 bg-slate-900 text-primary focus:ring-primary focus:ring-offset-slate-950 w-3.5 h-3.5 mr-2 cursor-pointer"
                    />
                    Overwrite existing branch
                  </label>
                </div>

                <div className="pt-2 flex items-center justify-end space-x-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setNewBranchName('');
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl shadow-lg transition-colors cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* RENAME BRANCH SUB-MODAL                    */}
        {/* ========================================== */}
        {showRenameModal && renameTarget && (
          <div className="absolute inset-0 bg-black/75 z-[10010] flex items-center justify-center p-4">
            <div className="bg-[#151b26] border border-white/10 rounded-2xl w-full max-w-[340px] shadow-2xl p-5 animate-in zoom-in-95 duration-100 flex flex-col">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Rename Branch</h3>
              
              <form onSubmit={handleRenameSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono">Rename '{renameTarget.name}' to:</label>
                  <input
                    type="text"
                    required
                    value={renameNewName}
                    onChange={(e) => setRenameNewName(e.target.value)}
                    autoFocus
                    className="w-full bg-slate-950 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl px-3 py-2 focus:outline-none placeholder-slate-600 font-mono"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end space-x-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRenameModal(false);
                      setRenameTarget(null);
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl shadow-lg transition-colors cursor-pointer"
                  >
                    Rename
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* CREATE TAG SUB-MODAL (Image 4)             */}
        {/* ========================================== */}
        {showTagModal && (
          <div className="absolute inset-0 bg-black/75 z-[10010] flex items-center justify-center p-4">
            <div className="bg-[#151b26] border border-white/10 rounded-2xl w-full max-w-[360px] shadow-2xl p-5 animate-in zoom-in-95 duration-100 flex flex-col">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Create Tag</h3>
              
              <form onSubmit={handleCreateTagSubmit} className="space-y-3.5">
                <div className="space-y-1 text-xs">
                  <label className="text-[10px] text-slate-400 font-mono">Git Root:</label>
                  <div className="w-full bg-slate-950 border border-white/5 text-[10px] text-slate-400 rounded-xl px-3 py-2 select-all font-mono break-all leading-normal">
                    {projectPath}
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <span className="text-[10px] text-slate-400 font-mono mr-2">Current Branch:</span>
                  <span className="text-primary font-mono font-semibold">{activeBranchName}</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono">Tag Name:</label>
                  <input
                    type="text"
                    required
                    value={tagName}
                    onChange={(e) => setTagName(e.target.value)}
                    placeholder="Enter tag name"
                    autoFocus
                    className="w-full bg-slate-950 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl px-3 py-2 focus:outline-none placeholder-slate-600 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono">Commit Revision (Optional):</label>
                  <input
                    type="text"
                    value={tagCommit}
                    onChange={(e) => setTagCommit(e.target.value)}
                    placeholder="HEAD / Commit Hash"
                    className="w-full bg-slate-950 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl px-3 py-2 focus:outline-none placeholder-slate-600 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono">Message (Optional):</label>
                  <textarea
                    rows={2}
                    value={tagMessage}
                    onChange={(e) => setTagMessage(e.target.value)}
                    placeholder="Enter annotation message"
                    className="w-full bg-slate-950 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl px-3 py-2 focus:outline-none placeholder-slate-600 font-mono resize-none"
                  />
                </div>

                <div className="text-xs select-none">
                  <label className="flex items-center text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tagForce}
                      onChange={(e) => setTagForce(e.target.checked)}
                      className="rounded border-white/10 bg-slate-900 text-primary focus:ring-primary focus:ring-offset-slate-950 w-3.5 h-3.5 mr-2 cursor-pointer"
                    />
                    Force create tag
                  </label>
                </div>

                <div className="pt-2 flex items-center justify-end space-x-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTagModal(false);
                      setTagName('');
                      setTagCommit('');
                      setTagMessage('');
                      setTagForce(false);
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl shadow-lg transition-colors cursor-pointer"
                  >
                    Create Tag
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
