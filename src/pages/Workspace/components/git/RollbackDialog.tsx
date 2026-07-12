import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { X, Folder, FileText, AlertTriangle, RefreshCw } from 'lucide-react';

interface RollbackDialogProps {
  path: string; // Absolute path of the selected node
  onClose: () => void;
}

interface RollbackFile {
  relPath: string;
  absPath: string;
  status: string;
  checked: boolean;
}

export const RollbackDialog: React.FC<RollbackDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const gitFileStatuses = useWorkspaceStore((s) => s.gitFileStatuses);
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);

  // Resolve Git Root repository path
  const projectPath = useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);

  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<RollbackFile[]>([]);
  const [deleteAddedFiles, setDeleteAddedFiles] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load modified files inside this specific repository path
  const loadFiles = () => {
    if (!projectPath) return;
    
    const isWindows = projectPath.includes('\\') || (!projectPath.startsWith('/') && projectPath.includes(':'));
    const sep = isWindows ? '\\' : '/';
    
    // Find all modified files that start with projectPath
    const list: RollbackFile[] = [];
    for (const [absPath, status] of Object.entries(gitFileStatuses)) {
      if (absPath.startsWith(projectPath)) {
        // Compute relative path to repository root
        let rel = absPath.substring(projectPath.length);
        if (rel.startsWith('/') || rel.startsWith('\\')) {
          rel = rel.substring(1);
        }
        rel = rel.replace(/\\/g, '/');

        // Check if the current clicked path is a file or matches the directory prefix
        // (so we only list files under the right-clicked subtree)
        const isChildOfSelected = path === projectPath || absPath.startsWith(path);
        if (isChildOfSelected) {
          list.push({
            relPath: rel,
            absPath,
            status,
            checked: true, // Default checked like IntelliJ
          });
        }
      }
    }
    setFiles(list);
  };

  useEffect(() => {
    loadFiles();
  }, [projectPath, gitFileStatuses, path]);

  // Handle select all / select none
  const toggleAll = (checked: boolean) => {
    setFiles(prev => prev.map(f => ({ ...f, checked })));
  };

  const handleCheckboxChange = (index: number) => {
    setFiles(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], checked: !copy[index].checked };
      return copy;
    });
  };

  // Perform Rollback
  const handleRollback = async () => {
    const selected = files.filter(f => f.checked);
    if (selected.length === 0) {
      setErrorMsg('请选择要回滚的变更文件');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      for (const file of selected) {
        const isUntracked = file.status === '??';
        const isStagedAdd = file.status[0] === 'A';
        const isUnstagedAdd = file.status[1] === '?' || isUntracked;

        if (isUntracked) {
          // Untracked files: physically delete if checkbox is checked
          if (deleteAddedFiles) {
            await window.electronAPI.localDeleteNode(file.absPath);
          }
        } else if (isStagedAdd) {
          // Staged addition: unstage first (reverts to untracked / unstaged)
          await window.electronAPI.gitUnstage(projectPath, file.relPath);
          if (deleteAddedFiles) {
            await window.electronAPI.localDeleteNode(file.absPath);
          }
        } else {
          // Modified or deleted files: run full restore
          await window.electronAPI.gitRestore(projectPath, file.relPath);
        }
      }

      await refreshGitStatus();
      onClose();
    } catch (err: any) {
      setErrorMsg('回滚变更失败: ' + err.message);
      setLoading(false);
    }
  };

  // Status summaries
  const modifiedCount = files.filter(f => f.status.includes('M') || f.status.includes('D')).length;
  const addedCount = files.filter(f => f.status[0] === 'A' || f.status === '??').length;
  const selectedCount = files.filter(f => f.checked).length;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-[#151b26] border border-white/10 rounded-2xl w-full max-w-[500px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Title Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-slate-200">Rollback Changes</h2>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start space-x-2 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}

        {/* Changes Tree Area */}
        <div className="flex-1 flex flex-col min-h-0 p-5">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-2 px-1">
            <span>Changes ({files.length} files)</span>
            <div className="space-x-3">
              <button 
                type="button"
                onClick={() => toggleAll(true)}
                className="hover:text-white transition-colors"
              >
                全选
              </button>
              <button 
                type="button"
                onClick={() => toggleAll(false)}
                className="hover:text-white transition-colors"
              >
                全不选
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto border border-white/5 bg-slate-950/20 rounded-xl p-2.5 scrollbar-thin space-y-1">
            {files.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs py-10">
                没有可回滚的变更
              </div>
            ) : (
              files.map((file, idx) => {
                const dirPath = file.relPath.substring(0, file.relPath.lastIndexOf('/'));
                const fileName = file.relPath.substring(file.relPath.lastIndexOf('/') + 1) || file.relPath;
                
                return (
                  <label
                    key={file.absPath}
                    className="flex items-center p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors group select-none"
                  >
                    <input
                      type="checkbox"
                      checked={file.checked}
                      onChange={() => handleCheckboxChange(idx)}
                      disabled={loading}
                      className="rounded border-white/10 bg-slate-900 text-primary focus:ring-primary focus:ring-offset-slate-950 w-3.5 h-3.5 mr-3 cursor-pointer"
                    />
                    
                    <div className="flex items-center min-w-0 flex-1">
                      {file.status.includes('D') ? (
                        <FileText className="w-4 h-4 text-red-400/80 mr-2 flex-shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400 mr-2 flex-shrink-0" />
                      )}
                      
                      <div className="flex flex-col min-w-0">
                        <span className={`text-xs font-mono truncate ${
                          file.status === '??' ? 'text-amber-400' :
                          file.status[0] === 'A' ? 'text-emerald-400' :
                          file.status[1] === 'M' ? 'text-red-400' : // Red for not add
                          file.status[0] === 'M' ? 'text-blue-400' : // Blue for staged modified
                          'text-slate-300'
                        }`}>
                          {fileName}
                        </span>
                        {dirPath && (
                          <span className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                            {dirPath}
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="text-[10px] font-mono text-slate-500 bg-slate-950/40 border border-white/5 px-1.5 py-0.5 rounded ml-2 flex-shrink-0 uppercase">
                      {file.status === '??' ? 'untracked' :
                       file.status[0] === 'A' ? 'added' :
                       file.status[1] === 'M' ? 'not staged' :
                       file.status[0] === 'M' ? 'modified' :
                       file.status.includes('D') ? 'deleted' : 'modified'}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Delete Added Files Checkbox */}
        <div className="px-5 pb-4 flex items-center flex-shrink-0 select-none">
          <label className="flex items-center text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteAddedFiles}
              onChange={(e) => setDeleteAddedFiles(e.target.checked)}
              disabled={loading}
              className="rounded border-white/10 bg-slate-900 text-primary focus:ring-primary focus:ring-offset-slate-950 w-3.5 h-3.5 mr-2 cursor-pointer"
            />
            Delete local copies of added files
          </label>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 bg-slate-950/40 border-t border-white/5 flex items-center justify-between flex-shrink-0 text-xs font-mono">
          <div className="text-slate-400">
            {selectedCount} files selected ({modifiedCount} modified, {addedCount} added)
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl transition-all cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleRollback}
              disabled={loading || selectedCount === 0}
              className="px-5 py-2 bg-primary hover:bg-primary-hover disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-xl shadow-lg shadow-primary/20 transition-all cursor-pointer flex items-center space-x-1.5"
            >
              <span>Rollback</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
