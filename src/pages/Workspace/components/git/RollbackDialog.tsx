import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RotateCcw, AlertTriangle, Loader2, FileText, Trash2, Check } from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog, confirmDialog } from '../../../../components/ui/ModalDialog';
import { toast } from '../../../../contexts/useToastStore';
import { parseGitError } from '../../../../utils/gitError';
import {
  findGitRootForPath,
  getBasename,
  getRelativePathInRepo,
  isPathEqualOrInside,
} from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface RollbackDialogProps {
  path: string;
  projectPath?: string;
  targetPaths?: string[];
  onClose: () => void;
}

interface RollbackFileItem {
  relPath: string;
  absPath: string;
  rawStatus: string;
  isUntracked: boolean;
  isStaged: boolean;
  isDeleted: boolean;
}

export const RollbackDialog: React.FC<RollbackDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  targetPaths,
  onClose,
}) => {
  const { currentProject, gitRoots, gitRepoBranches, openDiff, syncWorkspaceAfterGitChange } =
    useWorkspaceStore();

  const repoPath = useMemo(
    () =>
      explicitProjectPath ||
      findGitRootForPath(path, gitRoots, currentProject?.codePath || currentProject?.path || path),
    [explicitProjectPath, path, gitRoots, currentProject]
  );

  const currentBranch = gitRepoBranches[repoPath] || 'HEAD';

  const filterRoots = useMemo(() => {
    const raw = targetPaths && targetPaths.length > 0 ? targetPaths : [path];
    return raw.map((p) => p);
  }, [targetPaths, path]);

  const [files, setFiles] = useState<RollbackFileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [deleteUntracked, setDeleteUntracked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadFiles = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const statusMap = await window.electronAPI.gitStatus(repoPath);
      const repoClean = repoPath.replace(/[\\/]+$/, '');
      const matching: RollbackFileItem[] = [];

      const isRootTarget = filterRoots.some((r) => {
        const rel = getRelativePathInRepo(r, repoPath);
        return rel === '' || rel === '.';
      });

      for (const [relPath, rawStatus] of Object.entries(statusMap)) {
        const absPath = `${repoClean}/${relPath}`;
        const matches =
          isRootTarget || filterRoots.some((sel) => isPathEqualOrInside(absPath, sel));
        if (!matches) continue;

        const clean = rawStatus || '';
        const isUntracked = clean.trim() === '??' || clean.trim() === '?';
        const isStaged = !isUntracked && clean[0] !== ' ' && clean[0] !== '?';
        const isDeleted = clean.includes('D');

        matching.push({
          relPath,
          absPath,
          rawStatus: clean,
          isUntracked,
          isStaged,
          isDeleted,
        });
      }

      matching.sort((a, b) => a.relPath.localeCompare(b.relPath));
      setFiles(matching);
      setSelectedFiles(new Set(matching.map((f) => f.relPath)));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [repoPath, filterRoots]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const toggleFile = (relPath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFiles.size === files.length) setSelectedFiles(new Set());
    else setSelectedFiles(new Set(files.map((f) => f.relPath)));
  };

  const handleOpenDiff = async (item: RollbackFileItem) => {
    try {
      let originalContent = '';
      if (!item.isUntracked) {
        try {
          originalContent = await window.electronAPI.gitShowFile(repoPath, 'HEAD', item.relPath);
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
      if (!item.isDeleted) {
        const readRes = await window.electronAPI.readFileBase64(item.absPath);
        if (readRes.type !== 'text') {
          setError('当前文件为二进制格式，暂不支持文本差异预览');
          return;
        }
        modifiedContent = readRes.data || '';
      }
      openDiff(
        `diff://${item.relPath}-rollback`,
        `${getBasename(item.relPath)} (回滚前对比)`,
        originalContent,
        modifiedContent,
        item.isUntracked ? '未创建' : 'HEAD (将恢复到此版本)',
        '当前工作区改动'
      );
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  const selectedItems = useMemo(
    () => files.filter((f) => selectedFiles.has(f.relPath)),
    [files, selectedFiles]
  );

  const selectedUntrackedCount = useMemo(
    () => selectedItems.filter((f) => f.isUntracked).length,
    [selectedItems]
  );

  const effectiveTargetCount = useMemo(
    () =>
      selectedItems.filter((f) => !f.isUntracked || deleteUntracked).length,
    [selectedItems, deleteUntracked]
  );

  const handleRollback = async () => {
    if (!repoPath || effectiveTargetCount === 0) return;

    const toProcess = selectedItems.filter((f) => !f.isUntracked || deleteUntracked);
    const stagedList = toProcess.filter((f) => f.isStaged).map((f) => f.relPath);
    const untrackedToDelete = toProcess.filter((f) => f.isUntracked);
    const trackedToRestore = toProcess.filter((f) => !f.isUntracked).map((f) => f.relPath);

    const warnLines = [
      trackedToRestore.length > 0
        ? `• 将还原 ${trackedToRestore.length} 个已追踪文件的修改（未提交的改动会永久丢失）`
        : '',
      untrackedToDelete.length > 0
        ? `• 将从磁盘永久删除 ${untrackedToDelete.length} 个未跟踪文件（无法找回）`
        : '',
    ].filter(Boolean);

    const confirmed = await confirmDialog({
      title: '确认回滚更改',
      message: `即将对选中的 ${toProcess.length} 项执行回滚操作，此操作不可撤销：`,
      detail: warnLines.join('\n'),
      confirmText: '确认回滚',
      cancelText: '取消',
      variant: 'danger',
    });
    if (!confirmed) return;

    setExecuting(true);
    setError(null);

    try {
      if (stagedList.length > 0) {
        await window.electronAPI.gitUnstageFiles(repoPath, stagedList);
      }
      await window.electronAPI.gitRestoreFiles(
        repoPath,
        toProcess.map((f) => f.relPath)
      );
      await syncWorkspaceAfterGitChange();
      toast.success(`已成功回滚 ${toProcess.length} 项更改`);
      onClose();
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      size="lg"
      preventClose={executing}
      icon={<RotateCcw className="w-4 h-4 text-rose-500" />}
      title="回滚更改 (Git Rollback)"
      subtitle={`${getBasename(repoPath)} · 分支: ${currentBranch}`}
      footer={
        <div className="w-full flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deleteUntracked}
              onChange={(e) => setDeleteUntracked(e.target.checked)}
              className="rounded border-border-primary text-rose-500 focus:ring-rose-500"
            />
            <span className="flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>同时删除选中的未跟踪文件 ({selectedUntrackedCount})</span>
            </span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={executing}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary bg-background-tertiary hover:bg-background-secondary border border-border-primary transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleRollback}
              disabled={executing || effectiveTargetCount === 0}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 disabled:opacity-45 text-white flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              {executing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              <span>回滚 ({effectiveTargetCount})</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col h-[440px] max-h-[65vh] p-4 gap-3 overflow-hidden">
        {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            回滚会将选中的已追踪文件恢复到当前 <span className="font-mono font-semibold">HEAD</span> 状态，并移出暂存区。请确认不再需要这些本地更改。
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col border border-border-primary rounded-lg overflow-hidden bg-background-secondary/40">
          <div className="flex items-center justify-between px-3 py-2 bg-background-secondary border-b border-border-primary text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-text-primary select-none">
              <input
                type="checkbox"
                checked={files.length > 0 && selectedFiles.size === files.length}
                onChange={toggleAll}
                disabled={files.length === 0}
                className="rounded border-border-primary text-primary focus:ring-primary"
              />
              <span>全选 ({files.length} 个变更文件)</span>
            </label>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border-primary/60">
            {loading ? (
              <div className="flex items-center justify-center h-full text-xs text-text-secondary gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>正在读取工作区修改...</span>
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-xs text-text-tertiary gap-1.5">
                <Check className="w-6 h-6 text-emerald-500/60" />
                <span>所选路径下没有可回滚的更改</span>
              </div>
            ) : (
              files.map((item) => {
                const isSelected = selectedFiles.has(item.relPath);
                return (
                  <div
                    key={item.relPath}
                    className={`flex items-center justify-between gap-3 px-3 py-1.5 text-xs hover:bg-background-tertiary/70 transition-colors ${
                      isSelected ? 'bg-rose-500/5' : ''
                    }`}
                  >
                    <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleFile(item.relPath)}
                        className="rounded border-border-primary text-rose-500 focus:ring-rose-500 flex-shrink-0"
                      />
                      <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                      <span className="font-mono text-[11px] text-text-primary truncate">
                        {item.relPath}
                      </span>
                    </label>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          item.isUntracked
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : item.isStaged
                              ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {item.isUntracked ? '未跟踪' : item.isStaged ? '已暂存' : '已修改'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenDiff(item)}
                        className="px-2 py-0.5 rounded border border-border-primary bg-background-primary hover:bg-background-tertiary text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                      >
                        查看差异
                      </button>
                    </div>
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
