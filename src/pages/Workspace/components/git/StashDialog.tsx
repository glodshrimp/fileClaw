import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Archive,
  Plus,
  Play,
  Download,
  Trash2,
  ChevronRight,
  ChevronDown,
  FileText,
  Loader2,
} from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog, confirmDialog } from '../../../../components/ui/ModalDialog';
import { toast } from '../../../../contexts/useToastStore';
import { findGitRootForPath, getBasename } from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface StashDialogProps {
  path: string;
  projectPath?: string;
  onClose: () => void;
}

interface StashFileItem {
  path: string;
  status: string;
  oldPath?: string;
}

export const StashDialog: React.FC<StashDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  onClose,
}) => {
  const { currentProject, gitRoots, syncWorkspaceAfterGitChange } = useWorkspaceStore();

  const repoPath = useMemo(
    () =>
      explicitProjectPath ||
      findGitRootForPath(path, gitRoots, currentProject?.codePath || currentProject?.path || path),
    [explicitProjectPath, path, gitRoots, currentProject]
  );

  const [stashes, setStashes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [filesMap, setFilesMap] = useState<Record<number, StashFileItem[]>>({});
  const [loadingFilesIndex, setLoadingFilesIndex] = useState<number | null>(null);

  const loadStashes = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const list = await window.electronAPI.gitStashList(repoPath);
      setStashes(list);
      setFilesMap({});
      setExpandedIndex(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    loadStashes();
  }, [loadStashes]);

  const handleTogglePreview = async (index: number) => {
    if (expandedIndex === index) {
      setExpandedIndex(null);
      return;
    }
    setExpandedIndex(index);
    if (filesMap[index]) return;

    setLoadingFilesIndex(index);
    try {
      const files = await window.electronAPI.gitStashFiles(repoPath, index);
      setFilesMap((prev) => ({ ...prev, [index]: files }));
    } catch (err) {
      setError(err);
    } finally {
      setLoadingFilesIndex(null);
    }
  };

  const handleCreateStash = async () => {
    setCreating(true);
    setError(null);
    try {
      await window.electronAPI.gitStashPush(
        repoPath,
        message.trim() || undefined,
        includeUntracked
      );
      setMessage('');
      await loadStashes();
      await syncWorkspaceAfterGitChange();
      toast.success('已贮藏工作区修改');
    } catch (err) {
      setError(err);
    } finally {
      setCreating(false);
    }
  };

  const handleApply = async (index: number) => {
    setBusyIndex(index);
    setError(null);
    try {
      await window.electronAPI.gitStashApply(repoPath, index);
      await syncWorkspaceAfterGitChange();
      toast.success(`已应用 stash@{${index}}（保留记录）`);
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setBusyIndex(null);
    }
  };

  const handlePop = async (index: number) => {
    setBusyIndex(index);
    setError(null);
    try {
      await window.electronAPI.gitStashPop(repoPath, index);
      await loadStashes();
      await syncWorkspaceAfterGitChange();
      toast.success(`已弹出并移除 stash@{${index}}`);
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setBusyIndex(null);
    }
  };

  const handleDrop = async (index: number) => {
    const confirmed = await confirmDialog({
      title: '删除贮藏记录',
      message: `确定要永久丢弃 stash@{${index}} 吗？此操作无法撤销。`,
      detail: stashes[index],
      confirmText: '确认删除',
      variant: 'danger',
    });
    if (!confirmed) return;

    setBusyIndex(index);
    setError(null);
    try {
      await window.electronAPI.gitStashDrop(repoPath, index);
      await loadStashes();
    } catch (err) {
      setError(err);
    } finally {
      setBusyIndex(null);
    }
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      size="lg"
      preventClose={creating || busyIndex !== null}
      icon={<Archive className="w-4 h-4 text-amber-500" />}
      title="贮藏工作区更改 (Git Stash)"
      subtitle={getBasename(repoPath)}
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
      <div className="flex flex-col h-[480px] max-h-[68vh] p-4 gap-3 overflow-hidden text-xs">
        {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

        {/* Create Stash Bar */}
        <div className="p-3 rounded-lg border border-border-primary bg-background-secondary/50 space-y-2.5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !creating) handleCreateStash();
              }}
              placeholder="贮藏备注（可选），例如：WIP 临时切换分支修复线上问题"
              className="flex-1 rounded-lg border border-border-primary bg-background-primary px-3 py-1.5 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={handleCreateStash}
              disabled={creating}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-45 text-white font-medium transition-colors cursor-pointer"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>贮藏当前更改</span>
            </button>
          </div>
          <label className="inline-flex items-center gap-2 text-[11px] text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(e) => setIncludeUntracked(e.target.checked)}
              className="rounded border-border-primary text-amber-500 focus:ring-amber-500"
            />
            <span>包含未跟踪的新建文件 (-u / --include-untracked)</span>
          </label>
        </div>

        {/* Stash List */}
        <div className="flex-1 min-h-0 flex flex-col border border-border-primary rounded-lg overflow-hidden bg-background-secondary/35">
          <div className="px-3 py-2 bg-background-secondary border-b border-border-primary font-medium text-text-primary">
            已贮藏记录 ({stashes.length}) · 点击条目前可预览变动文件
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border-primary/60">
            {loading ? (
              <div className="flex items-center justify-center h-full text-text-secondary gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>正在加载 Stash 列表...</span>
              </div>
            ) : stashes.length === 0 ? (
              <div className="flex items-center justify-center h-full text-text-tertiary">
                当前仓库没有 Stash 记录
              </div>
            ) : (
              stashes.map((entry, idx) => {
                const isExpanded = expandedIndex === idx;
                const files = filesMap[idx];
                const isBusy = busyIndex === idx;
                return (
                  <div key={`${idx}-${entry}`} className="bg-background-primary/30">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-background-tertiary/60 transition-colors">
                      <button
                        type="button"
                        onClick={() => handleTogglePreview(idx)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                        )}
                        <span className="font-mono text-[11px] text-text-primary truncate" title={entry}>
                          {entry}
                        </span>
                      </button>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApply(idx)}
                          disabled={isBusy}
                          title="应用到工作区并保留此 Stash 记录"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-primary bg-background-primary hover:bg-background-tertiary text-[11px] text-text-primary cursor-pointer"
                        >
                          <Play className="w-3 h-3 text-emerald-500" />
                          <span>应用</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePop(idx)}
                          disabled={isBusy}
                          title="应用到工作区并从 Stash 列表移除 (Pop)"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/10 hover:bg-primary/20 text-[11px] text-primary font-medium cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>弹出 (Pop)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDrop(idx)}
                          disabled={isBusy}
                          title="丢弃此 Stash 记录 (Drop)"
                          className="p-1 rounded text-text-tertiary hover:text-functional-error hover:bg-functional-error/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-8 pb-2.5 pt-1 bg-background-secondary/40 border-t border-border-primary/40 space-y-1">
                        {loadingFilesIndex === idx ? (
                          <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary py-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>正在读取文件清单...</span>
                          </div>
                        ) : !files || files.length === 0 ? (
                          <div className="text-[11px] text-text-tertiary">无文件变更记录</div>
                        ) : (
                          files.map((f) => (
                            <div
                              key={`${f.status}-${f.path}`}
                              className="flex items-center justify-between gap-2 text-[11px] py-0.5"
                            >
                              <span className="flex items-center gap-1.5 font-mono text-text-secondary truncate">
                                <FileText className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{f.path}</span>
                              </span>
                              <span className="font-mono text-[10px] px-1 rounded bg-background-tertiary text-text-secondary">
                                {f.status}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};
