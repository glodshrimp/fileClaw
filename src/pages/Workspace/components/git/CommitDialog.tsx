import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GitCommit,
  RefreshCw,
  Check,
  Loader2,
  FileText,
  ArrowUpCircle,
  Filter,
} from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog } from '../../../../components/ui/ModalDialog';
import { toast } from '../../../../contexts/useToastStore';
import { parseGitError } from '../../../../utils/gitError';
import {
  findGitRootForPath,
  getBasename,
  getRelativePathInRepo,
  isPathEqualOrInside,
} from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface CommitDialogProps {
  path: string;
  projectPath?: string;
  targetPaths?: string[];
  onClose: () => void;
}

interface StatusEntry {
  relPath: string;
  absPath: string;
  rawStatus: string;
  isStaged: boolean;
  isUntracked: boolean;
  isDeleted: boolean;
}

export const CommitDialog: React.FC<CommitDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  targetPaths,
  onClose,
}) => {
  const { currentProject, gitRoots, gitRepoBranches, openDiff, syncWorkspaceAfterGitChange, setGitSyncLabel } =
    useWorkspaceStore();

  const repoPath = useMemo(
    () =>
      explicitProjectPath ||
      findGitRootForPath(path, gitRoots, currentProject?.codePath || currentProject?.path || path),
    [explicitProjectPath, path, gitRoots, currentProject]
  );

  const currentBranch = gitRepoBranches[repoPath] || 'HEAD';

  const scopedPaths = useMemo(() => {
    const raw = targetPaths && targetPaths.length > 0 ? targetPaths : [path];
    return raw.filter((p) => {
      const rel = getRelativePathInRepo(p, repoPath);
      return rel !== '' && rel !== '.';
    });
  }, [targetPaths, path, repoPath]);

  const hasScopedFilter = scopedPaths.length > 0;

  const [files, setFiles] = useState<StatusEntry[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [onlyShowScoped, setOnlyShowScoped] = useState<boolean>(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingMode, setSubmittingMode] = useState<'commit' | 'commit-push' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loadStatus = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const statuses = await window.electronAPI.gitStatus(repoPath);
      const entries: StatusEntry[] = Object.entries(statuses).map(([relPath, rawStatus]) => {
        const clean = rawStatus || '';
        const x = clean[0] || ' ';
        const absPath = `${repoPath.replace(/[\\/]+$/, '')}/${relPath}`;
        const isUntracked = clean.trim() === '??' || clean.trim() === '?';
        const isStaged = !isUntracked && x !== ' ' && x !== '?';
        const isDeleted = clean.includes('D');
        return { relPath, absPath, rawStatus: clean, isStaged, isUntracked, isDeleted };
      });
      entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
      setFiles(entries);

      if (hasScopedFilter) {
        const matched = entries
          .filter((entry) => scopedPaths.some((sel) => isPathEqualOrInside(entry.absPath, sel)))
          .map((e) => e.relPath);
        setSelectedFiles(new Set(matched.length > 0 ? matched : entries.map((e) => e.relPath)));
      } else {
        setSelectedFiles(new Set(entries.map((e) => e.relPath)));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [repoPath, hasScopedFilter, scopedPaths]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const visibleFiles = useMemo(() => {
    if (!hasScopedFilter || !onlyShowScoped) return files;
    return files.filter((entry) => scopedPaths.some((sel) => isPathEqualOrInside(entry.absPath, sel)));
  }, [files, hasScopedFilter, onlyShowScoped, scopedPaths]);

  const toggleFile = (relPath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (visibleFiles.length === 0) return;
    const allSelected = visibleFiles.every((f) => selectedFiles.has(f.relPath));
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      for (const f of visibleFiles) {
        if (allSelected) next.delete(f.relPath);
        else next.add(f.relPath);
      }
      return next;
    });
  };

  const handleOpenDiff = async (entry: StatusEntry) => {
    if (!repoPath) return;
    try {
      let originalContent = '';
      if (!entry.isUntracked) {
        try {
          originalContent = await window.electronAPI.gitShowFile(repoPath, 'HEAD', entry.relPath);
        } catch (err: any) {
          const parsed = parseGitError(err);
          if (parsed.raw.startsWith('BINARY_FILE:') || parsed.raw.startsWith('FILE_TOO_LARGE:')) {
            setError(err);
            return;
          }
          originalContent = '';
        }
      }

      let modifiedContent = '';
      if (!entry.isDeleted) {
        const readRes = await window.electronAPI.readFileBase64(entry.absPath);
        if (readRes.type !== 'text') {
          setError('当前文件为二进制或图片格式，暂不支持文本差异预览');
          return;
        }
        modifiedContent = readRes.data || '';
      }

      const fileName = getBasename(entry.relPath);
      openDiff(
        `diff://${entry.relPath}-worktree`,
        `${fileName} (工作区差异)`,
        originalContent,
        modifiedContent,
        entry.isUntracked ? '未创建' : 'HEAD',
        '当前工作区'
      );
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  const handleSubmit = async (alsoPush: boolean) => {
    if (!repoPath) return;
    if (selectedFiles.size === 0) {
      setError('请至少勾选一个要提交的文件');
      return;
    }
    if (!message.trim()) {
      setError('请输入提交说明 (Commit Message)');
      return;
    }

    setSubmittingMode(alsoPush ? 'commit-push' : 'commit');
    setError(null);
    const list = Array.from(selectedFiles);

    try {
      await window.electronAPI.gitCommit(repoPath, list, message.trim());

      if (alsoPush) {
        setGitSyncLabel('正在推送提交...');
        try {
          const remotes = await window.electronAPI.gitRemotes(repoPath);
          const remoteName = remotes[0]?.[0] || 'origin';
          const branchName = currentBranch.startsWith('HEAD') ? 'HEAD' : currentBranch;
          await window.electronAPI.gitPush(repoPath, remoteName, branchName, false, false, true);
          await syncWorkspaceAfterGitChange();
          toast.success(`已提交并推送到 ${remoteName}/${branchName}`, `${list.length} 个文件`);
        } finally {
          setGitSyncLabel(null);
        }
      } else {
        await syncWorkspaceAfterGitChange();
        toast.success(`已成功提交 ${list.length} 个文件到 ${currentBranch}`);
      }
      onClose();
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setSubmittingMode(null);
    }
  };

  const renderStatusBadge = (entry: StatusEntry) => {
    const trimmed = entry.rawStatus.trim();
    if (entry.isUntracked) {
      return (
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
          U 未跟踪
        </span>
      );
    }
    if (entry.isDeleted) {
      return (
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400">
          D 删除
        </span>
      );
    }
    if (trimmed.startsWith('A')) {
      return (
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          A 新增
        </span>
      );
    }
    if (trimmed.startsWith('R')) {
      return (
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400">
          R 重命名
        </span>
      );
    }
    return (
      <span
        className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
          entry.isStaged
            ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
        }`}
      >
        M {entry.isStaged ? '已暂存' : '已修改'}
      </span>
    );
  };

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const submitShortcutLabel = isMac ? '⌘+Enter' : 'Ctrl+Enter';
  const allVisibleChecked =
    visibleFiles.length > 0 && visibleFiles.every((f) => selectedFiles.has(f.relPath));

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      size="lg"
      preventClose={Boolean(submittingMode)}
      icon={<GitCommit className="w-4 h-4 text-emerald-500" />}
      title="提交更改 (Git Commit)"
      subtitle={`${getBasename(repoPath)} · 分支: ${currentBranch}`}
      headerExtra={
        <button
          type="button"
          onClick={loadStatus}
          disabled={loading || Boolean(submittingMode)}
          title="刷新更改列表"
          className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-background-tertiary transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      }
      footer={
        <div className="w-full flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-tertiary">
            已选择 {selectedFiles.size} / {files.length} 个文件
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={Boolean(submittingMode)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary bg-background-tertiary hover:bg-background-secondary border border-border-primary transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={Boolean(submittingMode) || selectedFiles.size === 0 || !message.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              {submittingMode === 'commit' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>提交 ({submitShortcutLabel})</span>
            </button>
            <button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={Boolean(submittingMode) || selectedFiles.size === 0 || !message.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary hover:bg-primary/90 disabled:opacity-45 text-white flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              {submittingMode === 'commit-push' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowUpCircle className="w-3.5 h-3.5" />
              )}
              <span>提交并推送</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col h-[500px] max-h-[68vh] p-4 gap-3 overflow-hidden">
        {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

        {/* Changes list */}
        <div className="flex-1 min-h-0 flex flex-col border border-border-primary rounded-lg overflow-hidden bg-background-secondary/40">
          <div className="flex items-center justify-between px-3 py-2 bg-background-secondary border-b border-border-primary text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-text-primary select-none">
              <input
                type="checkbox"
                checked={allVisibleChecked}
                onChange={toggleAllVisible}
                disabled={visibleFiles.length === 0}
                className="rounded border-border-primary text-primary focus:ring-primary"
              />
              <span>全选可见更改 ({visibleFiles.length})</span>
            </label>

            {hasScopedFilter && (
              <button
                type="button"
                onClick={() => setOnlyShowScoped((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] transition-colors cursor-pointer ${
                  onlyShowScoped
                    ? 'bg-primary/15 border-primary/40 text-primary font-medium'
                    : 'bg-background-primary border-border-primary text-text-secondary hover:text-text-primary'
                }`}
              >
                <Filter className="w-3 h-3" />
                <span>{onlyShowScoped ? '仅显示当前选中路径' : '显示全仓库更改'}</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border-primary/60">
            {loading ? (
              <div className="flex items-center justify-center h-full text-xs text-text-secondary gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>正在扫描工作区状态...</span>
              </div>
            ) : visibleFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-xs text-text-tertiary gap-1.5 py-8">
                <Check className="w-6 h-6 text-emerald-500/60" />
                <span>工作区很干净，当前范围内没有可提交的更改</span>
              </div>
            ) : (
              visibleFiles.map((entry) => {
                const checked = selectedFiles.has(entry.relPath);
                return (
                  <div
                    key={entry.relPath}
                    className={`flex items-center justify-between gap-3 px-3 py-1.5 text-xs transition-colors hover:bg-background-tertiary/70 ${
                      checked ? 'bg-primary/5' : ''
                    }`}
                  >
                    <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFile(entry.relPath)}
                        className="rounded border-border-primary text-primary focus:ring-primary flex-shrink-0"
                      />
                      <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                      <span
                        className="font-mono text-[11px] text-text-primary truncate cursor-pointer hover:underline"
                        title={`点击查看差异: ${entry.relPath}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleOpenDiff(entry);
                        }}
                      >
                        {entry.relPath}
                      </span>
                    </label>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {renderStatusBadge(entry)}
                      <button
                        type="button"
                        onClick={() => handleOpenDiff(entry)}
                        className="px-2 py-0.5 rounded border border-border-primary bg-background-primary hover:bg-background-tertiary text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                      >
                        对比
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Commit Message */}
        <div className="space-y-1.5 flex-shrink-0">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="commit-message-input" className="font-medium text-text-primary">
              提交说明 (Commit Message)
            </label>
            <span className="text-[11px] text-text-tertiary">
              按 {submitShortcutLabel} 快捷提交
            </span>
          </div>
          <textarea
            id="commit-message-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submittingMode) {
                e.preventDefault();
                handleSubmit(false);
              }
            }}
            rows={4}
            placeholder="简明描述本次提交的改动内容，例如：feat: 优化文件树 Git 右键菜单与主题适配"
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary resize-none scrollbar-thin"
          />
        </div>
      </div>
    </ModalDialog>
  );
};
