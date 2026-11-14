import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowDownCircle, Loader2, GitMerge, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog } from '../../../../components/ui/ModalDialog';
import { toast } from '../../../../contexts/useToastStore';
import { findGitRootForPath, getBasename } from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface PullDialogProps {
  path: string;
  projectPath?: string;
  onClose: () => void;
}

export const PullDialog: React.FC<PullDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  onClose,
}) => {
  const {
    currentProject,
    gitRoots,
    gitRepoBranches,
    syncWorkspaceAfterGitChange,
    setGitSyncLabel,
  } = useWorkspaceStore();

  const repoPath = useMemo(
    () =>
      explicitProjectPath ||
      findGitRootForPath(path, gitRoots, currentProject?.codePath || currentProject?.path || path),
    [explicitProjectPath, path, gitRoots, currentProject]
  );

  const currentBranch = gitRepoBranches[repoPath] || 'HEAD';

  const [remotes, setRemotes] = useState<[string, string][]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [selectedRemote, setSelectedRemote] = useState('origin');
  const [targetBranch, setTargetBranch] = useState('');
  const [rebase, setRebase] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadRepoRemoteInfo = useCallback(async () => {
    if (!repoPath) return;
    setLoadingInfo(true);
    try {
      const [remoteList, branchList] = await Promise.all([
        window.electronAPI.gitRemotes(repoPath),
        window.electronAPI.gitBranches(repoPath),
      ]);
      setRemotes(remoteList);

      const defaultRemote = remoteList[0]?.[0] || 'origin';
      setSelectedRemote((prev) =>
        remoteList.some(([r]) => r === prev) ? prev : defaultRemote
      );

      const remotesOnly = branchList.filter((b) => b.is_remote).map((b) => b.name);
      setRemoteBranches(remotesOnly);

      const activeRemote = remoteList.some(([r]) => r === selectedRemote)
        ? selectedRemote
        : defaultRemote;
      const prefix = `${activeRemote}/`;
      const branchesForRemote = remotesOnly
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length));

      const fallbackBranch = currentBranch.startsWith('HEAD') ? '' : currentBranch;
      setTargetBranch((prev) => {
        if (prev.trim()) return prev;
        if (fallbackBranch && branchesForRemote.includes(fallbackBranch)) return fallbackBranch;
        return fallbackBranch || branchesForRemote[0] || 'main';
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoadingInfo(false);
    }
  }, [repoPath, currentBranch, selectedRemote]);

  useEffect(() => {
    loadRepoRemoteInfo();
  }, [loadRepoRemoteInfo]);

  const branchesOnSelectedRemote = useMemo(() => {
    const prefix = `${selectedRemote}/`;
    return remoteBranches
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.slice(prefix.length));
  }, [remoteBranches, selectedRemote]);

  const handleFetchFirst = async () => {
    if (!repoPath) return;
    setFetching(true);
    setError(null);
    setGitSyncLabel('正在获取远端...');
    try {
      await window.electronAPI.gitFetch(repoPath);
      await loadRepoRemoteInfo();
      await syncWorkspaceAfterGitChange();
    } catch (err) {
      setError(err);
    } finally {
      setFetching(false);
      setGitSyncLabel(null);
    }
  };

  const handlePull = async () => {
    if (!repoPath || !selectedRemote) return;
    setPulling(true);
    setError(null);
    setGitSyncLabel('正在拉取远端更新...');

    try {
      const output = await window.electronAPI.gitPull(
        repoPath,
        selectedRemote,
        targetBranch.trim(),
        rebase
      );
      await syncWorkspaceAfterGitChange();
      toast.success(
        `已成功从 ${selectedRemote}${targetBranch.trim() ? `/${targetBranch.trim()}` : ''} 拉取`,
        output || undefined
      );
      onClose();
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setPulling(false);
      setGitSyncLabel(null);
    }
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      size="md"
      preventClose={pulling || fetching}
      icon={<ArrowDownCircle className="w-4 h-4 text-sky-500" />}
      title="拉取远程更新 (Git Pull)"
      subtitle={`${getBasename(repoPath)} · 当前分支: ${currentBranch}`}
      headerExtra={
        <button
          type="button"
          onClick={handleFetchFirst}
          disabled={fetching || pulling}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-primary bg-background-primary hover:bg-background-tertiary text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title="先从远端获取最新分支索引 (Fetch)"
        >
          <RefreshCw className={`w-3 h-3 ${fetching ? 'animate-spin' : ''}`} />
          <span>先 Fetch</span>
        </button>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pulling}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary bg-background-tertiary hover:bg-background-secondary border border-border-primary transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handlePull}
            disabled={pulling || loadingInfo || remotes.length === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-45 text-white flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
          >
            {pulling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowDownCircle className="w-3.5 h-3.5" />
            )}
            <span>{pulling ? '正在拉取...' : '执行拉取 (Pull)'}</span>
          </button>
        </>
      }
    >
      <div className="p-4 space-y-4 text-xs">
        {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

        {remotes.length === 0 && !loadingInfo ? (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
            当前仓库尚未配置任何远程仓库 (Remote)，请先在「远程仓库管理」中添加远端 URL。
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="pull-remote" className="block font-medium text-text-secondary">
                远程仓库 (Remote)
              </label>
              <select
                id="pull-remote"
                value={selectedRemote}
                onChange={(e) => setSelectedRemote(e.target.value)}
                className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
              >
                {remotes.map(([name]) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pull-branch" className="block font-medium text-text-secondary">
                远端目标分支
              </label>
              <input
                id="pull-branch"
                list="pull-remote-branches"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="例如 main 或留空使用上游"
                className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary"
              />
              <datalist id="pull-remote-branches">
                {branchesOnSelectedRemote.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <div className="font-medium text-text-secondary">集成策略</div>
          <label
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              !rebase
                ? 'border-primary bg-primary/10'
                : 'border-border-primary bg-background-secondary/50 hover:bg-background-tertiary/60'
            }`}
          >
            <input
              type="radio"
              name="pull-strategy"
              checked={!rebase}
              onChange={() => setRebase(false)}
              className="mt-0.5 text-primary focus:ring-primary"
            />
            <GitMerge className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-text-primary">合并 (Merge — git pull)</div>
              <div className="text-[11px] text-text-secondary mt-0.5">
                保留完整的分支与合并节点记录，发生冲突时安全且易于解决。
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              rebase
                ? 'border-primary bg-primary/10'
                : 'border-border-primary bg-background-secondary/50 hover:bg-background-tertiary/60'
            }`}
          >
            <input
              type="radio"
              name="pull-strategy"
              checked={rebase}
              onChange={() => setRebase(true)}
              className="mt-0.5 text-primary focus:ring-primary"
            />
            <GitCommitHorizontal className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-text-primary">变基 (Rebase — git pull --rebase)</div>
              <div className="text-[11px] text-text-secondary mt-0.5">
                将本地尚未推送的提交依次重放到远端最新提交之后，保持提交图谱线性整洁。
              </div>
            </div>
          </label>
        </div>
      </div>
    </ModalDialog>
  );
};
