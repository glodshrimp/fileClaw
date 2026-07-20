import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { X, Check, Globe, Edit2, AlertTriangle, Plus } from 'lucide-react';

interface RemotesDialogProps {
  path: string;
  onClose: () => void;
}

export const RemotesDialog: React.FC<RemotesDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const projectPath = React.useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);

  const [loading, setLoading] = useState(false);
  const [remotes, setRemotes] = useState<Array<[string, string]>>([]);
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newRemoteName, setNewRemoteName] = useState('');
  const [newRemoteUrl, setNewRemoteUrl] = useState('');

  const fetchRemotes = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const list = await window.electronAPI.gitRemotes(projectPath);
      setRemotes(list);
    } catch (err: any) {
      setErrorMsg('获取 Remotes 列表失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRemotes();
  }, [projectPath]);

  const handleStartEdit = (name: string, url: string) => {
    setEditingRemote(name);
    setEditUrl(url);
  };

  const handleCancelEdit = () => {
    setEditingRemote(null);
    setEditUrl('');
  };

  const handleSaveRemote = async (name: string) => {
    if (!editUrl.trim() || loading) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      await window.electronAPI.gitSetRemoteUrl(projectPath, name, editUrl.trim());
      setEditingRemote(null);
      setEditUrl('');
      await fetchRemotes();
    } catch (err: any) {
      setErrorMsg('修改远程地址失败: ' + err.message);
      setLoading(false);
    }
  };

  const handleAddRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRemoteName.trim() || !newRemoteUrl.trim() || loading) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      await window.electronAPI.gitAddRemote(projectPath, newRemoteName.trim(), newRemoteUrl.trim());
      setNewRemoteName('');
      setNewRemoteUrl('');
      await fetchRemotes();
    } catch (err: any) {
      setErrorMsg('添加远程仓库失败: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#111622] border border-white/10 w-full max-w-lg rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh]">
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-950/20">
          <div className="flex items-center space-x-2 text-slate-200">
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold font-mono">配置远程仓库 (Git Remotes)</span>
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

        {/* Remotes Table/List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {/* Add Remote Form */}
          <form onSubmit={handleAddRemote} className="bg-slate-950/60 border border-white/10 rounded-xl p-4 flex flex-col space-y-3">
            <div className="text-xs font-bold text-slate-200 flex items-center space-x-1.5 border-b border-white/5 pb-2">
              <Plus className="w-3.5 h-3.5 text-primary" />
              <span>添加远程仓库 (Add Remote)</span>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <input
                  type="text"
                  value={newRemoteName}
                  onChange={(e) => setNewRemoteName(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 focus:border-primary/50 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none font-mono transition-all"
                  placeholder="名称 (如 origin)"
                  required
                />
              </div>
              <div className="col-span-2">
                <input
                  type="text"
                  value={newRemoteUrl}
                  onChange={(e) => setNewRemoteUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 focus:border-primary/50 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none font-mono transition-all"
                  placeholder="远程仓库 URL (Git URL)"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={loading || !newRemoteName.trim() || !newRemoteUrl.trim()}
                className="px-3.5 py-1.5 bg-primary hover:opacity-90 disabled:opacity-50 text-[10px] font-mono text-white rounded-lg transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加 Remote</span>
              </button>
            </div>
          </form>

          <div className="border-t border-white/5 my-2" />

          {loading && remotes.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-slate-500 font-mono text-xs">
              正在读取远程地址...
            </div>
          ) : remotes.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-slate-500 font-mono text-xs">
              未配置任何远程仓库地址
            </div>
          ) : (
            remotes.map(([name, url]) => {
              const isEditing = name === editingRemote;
              return (
                <div
                  key={name}
                  className="bg-slate-950/40 border border-white/5 rounded-xl p-4 flex flex-col space-y-2.5 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/25">
                      {name}
                    </span>
                    {!isEditing && (
                      <button
                        onClick={() => handleStartEdit(name, url)}
                        className="flex items-center space-x-1 text-[10px] font-mono text-slate-400 hover:text-white transition-colors px-2 py-1 rounded bg-slate-900 border border-white/5"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>编辑</span>
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col space-y-3 pt-1">
                      <input
                        type="text"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 focus:border-primary/50 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none font-mono transition-all"
                        placeholder="Git 远程 URL (e.g. git@github.com:...)"
                        autoFocus
                      />
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="px-3 py-1.5 bg-slate-850 hover:bg-slate-800 text-[10px] font-mono text-slate-300 rounded-lg border border-white/5 transition-colors"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveRemote(name)}
                          disabled={loading || !editUrl.trim()}
                          className="px-3 py-1.5 bg-primary hover:opacity-90 disabled:opacity-50 text-[10px] font-mono text-white rounded-lg transition-colors flex items-center space-x-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>保存</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] font-mono text-slate-400 break-all select-all pt-1 bg-slate-950/20 p-2 rounded border border-white/[0.03]">
                      {url}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
