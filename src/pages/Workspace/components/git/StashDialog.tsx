import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { X, Check, Archive, Plus, Play, AlertTriangle } from 'lucide-react';

interface StashDialogProps {
  path: string;
  onClose: () => void;
}

export const StashDialog: React.FC<StashDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const projectPath = React.useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);

  const [loading, setLoading] = useState(false);
  const [stashes, setStashes] = useState<string[]>([]);
  const [stashMessage, setStashMessage] = useState('');
  const [showPushForm, setShowPushForm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStashes = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const list = await window.electronAPI.gitStashList(projectPath);
      setStashes(list);
    } catch (err: any) {
      setErrorMsg('获取 Stash 列表失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStashes();
  }, [projectPath]);

  const handlePushStash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const msg = stashMessage.trim() ? stashMessage.trim() : undefined;
      await window.electronAPI.gitStashPush(projectPath, msg);
      setStashMessage('');
      setShowPushForm(false);
      await fetchStashes();
    } catch (err: any) {
      setErrorMsg('Stash 保存失败: ' + err.message);
      setLoading(false);
    }
  };

  const handlePopStash = async (index: number) => {
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await window.electronAPI.gitStashPop(projectPath, index);
      await fetchStashes();
    } catch (err: any) {
      setErrorMsg('还原 Stash 失败 (可能有冲突): ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#111622] border border-white/10 w-full max-w-md rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh]">
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-950/20">
          <div className="flex items-center space-x-2 text-slate-200">
            <Archive className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold font-mono">Git Stash 贮存管理</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center space-x-2 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="font-mono">{errorMsg}</span>
          </div>
        )}

        {/* Top Controls */}
        <div className="p-4 pb-2 flex items-center justify-between">
          <span className="text-xs text-slate-400 font-mono">Stash 列表 ({stashes.length})</span>
          <button
            onClick={() => setShowPushForm(!showPushForm)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-xs font-mono text-primary rounded-lg transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建 Stash</span>
          </button>
        </div>

        {/* Create Stash Form */}
        {showPushForm && (
          <form onSubmit={handlePushStash} className="px-4 pb-3 pt-1 border-b border-white/5 bg-slate-950/20 flex flex-col space-y-2">
            <input
              type="text"
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
              placeholder="输入 Stash 备注说明 (可选)..."
              className="w-full bg-slate-900 border border-white/10 focus:border-primary/50 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none placeholder-slate-500 font-mono transition-all"
              autoFocus
            />
            <div className="flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowPushForm(false)}
                className="px-2.5 py-1 bg-slate-850 hover:bg-slate-800 text-[10px] font-mono text-slate-400 hover:text-white rounded border border-white/5"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-2.5 py-1 bg-primary hover:opacity-90 disabled:opacity-50 text-[10px] font-mono text-white rounded"
              >
                保存当前更改 (Stash)
              </button>
            </div>
          </form>
        )}

        {/* Stashes List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px] scrollbar-thin">
          {loading && stashes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
              正在读取 Stash...
            </div>
          ) : stashes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs text-center p-4">
              暂无已保存的 Stash。Stash 可以将你当前未提交的代码临时保存起来。
            </div>
          ) : (
            stashes.map((stash, idx) => (
              <div
                key={stash}
                className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-slate-950/20 hover:bg-slate-950/40 transition-colors mb-1.5"
              >
                <div className="flex flex-col min-w-0 flex-1 pr-4">
                  <span className="text-[10px] font-bold font-mono text-slate-400">
                    {`stash@{${idx}}`}
                  </span>
                  <span className="text-[11px] font-mono text-slate-200 truncate mt-0.5" title={stash}>
                    {stash.replace(/^stash@\{\d+\}:\s*/, '')}
                  </span>
                </div>
                
                <button
                  type="button"
                  onClick={() => handlePopStash(idx)}
                  disabled={loading}
                  className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 text-[10px] font-mono text-emerald-400 rounded transition-all flex-shrink-0"
                  title="恢复修改并删除此 Stash"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Pop</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
