import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { X, ArrowDownLeft, AlertTriangle } from 'lucide-react';

interface PullDialogProps {
  path: string;
  onClose: () => void;
}

export const PullDialog: React.FC<PullDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const gitRepoBranches = useWorkspaceStore((s) => s.gitRepoBranches);
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);

  // Resolve Git Root repository path
  const projectPath = useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);

  const currentBranch = gitRepoBranches[projectPath] || 'main';

  const [loading, setLoading] = useState(false);
  const [remotes, setRemotes] = useState<[string, string][]>([]);
  const [selectedRemote, setSelectedRemote] = useState('origin');
  const [targetBranch, setTargetBranch] = useState(currentBranch);
  const [rebase, setRebase] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const handlePull = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectPath || loading) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      await window.electronAPI.gitPull(projectPath, selectedRemote, targetBranch, rebase);
      await refreshGitStatus();
      onClose();
    } catch (err: any) {
      setErrorMsg('Pull 失败: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-[#151b26] border border-white/10 rounded-2xl w-full max-w-[380px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2">
            <ArrowDownLeft className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-slate-200">Pull Changes</h2>
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

        <form onSubmit={handlePull} className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-mono">Select Remote:</label>
            <select
              value={selectedRemote}
              onChange={(e) => setSelectedRemote(e.target.value)}
              disabled={loading}
              className="w-full bg-slate-950 border border-white/5 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary/50 font-mono cursor-pointer"
            >
              {remotes.length === 0 ? (
                <option value="origin">origin</option>
              ) : (
                remotes.map(([name, url]) => (
                  <option key={name} value={name}>{name} ({url})</option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-mono">Source Remote Branch:</label>
            <input
              type="text"
              required
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              disabled={loading}
              className="w-full bg-slate-950 border border-white/5 focus:border-primary/50 text-xs text-white rounded-xl px-3 py-2 focus:outline-none font-mono"
            />
          </div>

          <div className="flex items-center text-xs select-none">
            <label className="flex items-center text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={rebase}
                onChange={(e) => setRebase(e.target.checked)}
                disabled={loading}
                className="rounded border-white/10 bg-slate-900 text-primary focus:ring-primary focus:ring-offset-slate-950 w-3.5 h-3.5 mr-2 cursor-pointer"
              />
              Rebase (--rebase)
            </label>
          </div>

          <div className="pt-2 flex items-center justify-end space-x-3 text-xs">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl shadow-lg shadow-primary/20 transition-colors cursor-pointer"
            >
              {loading ? 'Pulling...' : 'Pull'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
