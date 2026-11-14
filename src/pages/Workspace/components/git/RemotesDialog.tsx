import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Link2,
  Plus,
  Edit2,
  Check,
  X,
  Trash2,
  Copy,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog, confirmDialog } from '../../../../components/ui/ModalDialog';
import { copyToClipboard } from '../../../../utils/copy';
import { findGitRootForPath, getBasename } from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface RemotesDialogProps {
  path: string;
  projectPath?: string;
  onClose: () => void;
}

export const RemotesDialog: React.FC<RemotesDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  onClose,
}) => {
  const { currentProject, gitRoots, setGitSyncLabel, syncWorkspaceAfterGitChange } =
    useWorkspaceStore();

  const repoPath = useMemo(
    () =>
      explicitProjectPath ||
      findGitRootForPath(path, gitRoots, currentProject?.codePath || currentProject?.path || path),
    [explicitProjectPath, path, gitRoots, currentProject]
  );

  const [remotes, setRemotes] = useState<Array<[string, string]>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('origin');
  const [newUrl, setNewUrl] = useState('');

  const [fetchSummary, setFetchSummary] = useState<string | null>(null);

  const loadRemotes = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const list = await window.electronAPI.gitRemotes(repoPath);
      setRemotes(list);
      if (list.some(([name]) => name === 'origin')) {
        setNewName('upstream');
      } else {
        setNewName('origin');
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    loadRemotes();
  }, [loadRemotes]);

  const handleSaveEdit = async (name: string) => {
    if (!editUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitSetRemoteUrl(repoPath, name, editUrl.trim());
      setEditingName(null);
      await loadRemotes();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddRemote = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitAddRemote(repoPath, newName.trim(), newUrl.trim());
      setNewUrl('');
      setShowAddForm(false);
      await loadRemotes();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveRemote = async (name: string) => {
    const confirmed = await confirmDialog({
      title: '移除远程仓库',
      message: `确定要移除远程仓库 "${name}" 吗？这仅解除本地远程引用配置，不会影响远程服务器上的数据。`,
      confirmText: '确认移除',
      variant: 'danger',
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitRemoveRemote(repoPath, name);
      await loadRemotes();
      await syncWorkspaceAfterGitChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleTestFetch = async () => {
    setBusy(true);
    setError(null);
    setFetchSummary(null);
    setGitSyncLabel('正在测试连接远端...');
    try {
      const out = await window.electronAPI.gitFetch(repoPath);
      await syncWorkspaceAfterGitChange();
      setFetchSummary(out || '连接正常：已成功同步远端引用');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setGitSyncLabel(null);
    }
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      size="md"
      preventClose={busy}
      icon={<Link2 className="w-4 h-4 text-primary" />}
      title="远程仓库管理 (Git Remotes)"
      subtitle={getBasename(repoPath)}
      headerExtra={
        <div className="flex items-center gap-1.5">
          {remotes.length > 0 && (
            <button
              type="button"
              onClick={handleTestFetch}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-primary bg-background-primary hover:bg-background-tertiary text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              title="测试远端连通性并 Fetch"
            >
              <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
              <span>测试连接</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-[11px] font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>添加远端</span>
          </button>
        </div>
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 rounded-lg text-xs font-medium text-text-secondary bg-background-tertiary hover:bg-background-secondary border border-border-primary transition-colors cursor-pointer"
        >
          关闭
        </button>
      }
    >
      <div className="p-4 space-y-3 text-xs max-h-[65vh] overflow-y-auto scrollbar-thin">
        {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

        {fetchSummary && (
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs">
            {fetchSummary}
          </div>
        )}

        {showAddForm && (
          <div className="p-3 rounded-lg bg-background-secondary border border-border-primary space-y-2.5">
            <div className="font-medium text-text-primary">新增远程仓库</div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="名称 (origin)"
                className="col-span-1 rounded-md border border-border-primary bg-background-primary px-2.5 py-1.5 font-mono text-text-primary focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="URL (https://... 或 git@...)"
                className="col-span-2 rounded-md border border-border-primary bg-background-primary px-2.5 py-1.5 font-mono text-text-primary focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1 rounded-md bg-background-tertiary border border-border-primary text-text-secondary cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddRemote}
                disabled={busy || !newName.trim() || !newUrl.trim()}
                className="px-3 py-1 rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-45 cursor-pointer"
              >
                确认添加
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-secondary gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>正在加载远端配置...</span>
          </div>
        ) : remotes.length === 0 ? (
          <div className="text-center py-8 text-text-tertiary border border-dashed border-border-primary rounded-lg">
            尚未配置任何远程仓库，点击右上角「添加远端」创建 origin。
          </div>
        ) : (
          <div className="space-y-2">
            {remotes.map(([name, url]) => {
              const isEditing = editingName === name;
              return (
                <div
                  key={name}
                  className="p-3 rounded-lg border border-border-primary bg-background-secondary/50 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-primary">{name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => copyToClipboard(url, e)}
                        title="复制 URL"
                        className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-background-tertiary cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingName(name);
                          setEditUrl(url);
                        }}
                        title="编辑 URL"
                        className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-background-tertiary cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveRemote(name)}
                        title="移除此远端"
                        className="p-1 rounded text-text-tertiary hover:text-functional-error hover:bg-functional-error/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(name);
                          if (e.key === 'Escape') setEditingName(null);
                        }}
                        className="flex-1 rounded-md border border-border-primary bg-background-primary px-2.5 py-1 font-mono text-text-primary focus:outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(name)}
                        disabled={busy || !editUrl.trim()}
                        className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingName(null)}
                        className="p-1.5 rounded-md bg-background-tertiary border border-border-primary text-text-secondary cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="font-mono text-[11px] text-text-secondary break-all select-text">
                      {url}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalDialog>
  );
};
