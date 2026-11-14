import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowUpCircle,
  Loader2,
  GitCommit,
  RefreshCw,
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  Plus,
  Layers,
  List,
  ChevronsUpDown,
} from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog, confirmDialog } from '../../../../components/ui/ModalDialog';
import { toast } from '../../../../contexts/useToastStore';
import { parseGitError } from '../../../../utils/gitError';
import { findGitRootForPath, getBasename } from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface PushDialogProps {
  path: string;
  projectPath?: string;
  onClose: () => void;
}

interface UnpushedCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface ChangedFile {
  path: string;
  status: string;
  oldPath?: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  status?: string;
  oldPath?: string;
  children: Record<string, TreeNode>;
}

const buildFileTree = (files: ChangedFile[]): TreeNode => {
  const root: TreeNode = { name: '', path: '', isDir: true, children: {} };
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let curr = root;
    let built = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      built = built ? `${built}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (!curr.children[part]) {
        curr.children[part] = {
          name: part,
          path: built,
          isDir: !isLast,
          status: isLast ? f.status : undefined,
          oldPath: isLast ? f.oldPath : undefined,
          children: {},
        };
      }
      curr = curr.children[part];
    }
  }
  return root;
};

const statusBadgeClass = (status?: string) => {
  switch (status) {
    case 'A':
      return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/15';
    case 'D':
      return 'text-rose-600 dark:text-rose-400 bg-rose-500/15';
    case 'R':
    case 'C':
      return 'text-purple-600 dark:text-purple-400 bg-purple-500/15';
    default:
      return 'text-sky-600 dark:text-sky-400 bg-sky-500/15';
  }
};

export const PushDialog: React.FC<PushDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  onClose,
}) => {
  const {
    currentProject,
    gitRoots,
    gitRepoBranches,
    openDiff,
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
  const repoName = getBasename(repoPath) || 'Repository';

  const [remotes, setRemotes] = useState<[string, string][]>([]);
  const [selectedRemote, setSelectedRemote] = useState('origin');
  const [targetBranch, setTargetBranch] = useState(
    currentBranch.startsWith('HEAD') ? '' : currentBranch
  );
  const [commits, setCommits] = useState<UnpushedCommit[]>([]);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<ChangedFile[]>([]);

  const [loadingRemotes, setLoadingRemotes] = useState(true);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const [pushTags, setPushTags] = useState(false);
  const [forcePush, setForcePush] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [treeMode, setTreeMode] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  // Quick remote add when repository has no remotes yet
  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [addingRemote, setAddingRemote] = useState(false);

  const loadRemotes = useCallback(async () => {
    if (!repoPath) return;
    setLoadingRemotes(true);
    try {
      const list = await window.electronAPI.gitRemotes(repoPath);
      setRemotes(list);
      if (list.length > 0 && !list.some(([r]) => r === selectedRemote)) {
        setSelectedRemote(list[0][0]);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoadingRemotes(false);
    }
  }, [repoPath, selectedRemote]);

  useEffect(() => {
    loadRemotes();
  }, [loadRemotes]);

  const loadUnpushed = useCallback(async () => {
    if (!repoPath || !selectedRemote) return;
    setLoadingCommits(true);
    setError(null);
    try {
      const list = await window.electronAPI.gitUnpushedCommits(
        repoPath,
        selectedRemote,
        targetBranch.trim() || currentBranch
      );
      setCommits(list);
      setSelectedCommitHash(list[0]?.hash || null);
      if (list.length === 0) setCommitFiles([]);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingCommits(false);
    }
  }, [repoPath, selectedRemote, targetBranch, currentBranch]);

  useEffect(() => {
    loadUnpushed();
  }, [loadUnpushed]);

  useEffect(() => {
    if (!repoPath || !selectedCommitHash) return;
    let active = true;
    setLoadingFiles(true);
    window.electronAPI
      .gitCommitFiles(repoPath, selectedCommitHash)
      .then((list) => {
        if (!active) return;
        setCommitFiles(list);
        const dirs: Record<string, boolean> = {};
        for (const f of list) {
          const parts = f.path.split('/');
          let cur = '';
          for (let i = 0; i < parts.length - 1; i++) {
            cur = cur ? `${cur}/${parts[i]}` : parts[i];
            dirs[cur] = true;
          }
        }
        setExpandedDirs(dirs);
      })
      .catch((err) => {
        if (active) setError(err);
      })
      .finally(() => {
        if (active) setLoadingFiles(false);
      });
    return () => {
      active = false;
    };
  }, [repoPath, selectedCommitHash]);

  const handleAddQuickRemote = async () => {
    if (!newRemoteUrl.trim()) return;
    setAddingRemote(true);
    setError(null);
    try {
      await window.electronAPI.gitAddRemote(repoPath, 'origin', newRemoteUrl.trim());
      setNewRemoteUrl('');
      setSelectedRemote('origin');
      await loadRemotes();
      await loadUnpushed();
    } catch (err) {
      setError(err);
    } finally {
      setAddingRemote(false);
    }
  };

  const handleOpenCommitFileDiff = async (file: ChangedFile) => {
    if (!repoPath || !selectedCommitHash) return;
    try {
      let originalContent = '';
      if (file.status !== 'A') {
        try {
          originalContent = await window.electronAPI.gitShowFile(
            repoPath,
            `${selectedCommitHash}^`,
            file.oldPath || file.path
          );
        } catch (err: any) {
          const parsed = parseGitError(err);
          if (parsed.raw.startsWith('BINARY_FILE:') || parsed.raw.startsWith('FILE_TOO_LARGE:')) {
            setError(err);
            return;
          }
          // Initial root commit or newly introduced path
          originalContent = '';
        }
      }

      let modifiedContent = '';
      if (file.status !== 'D') {
        modifiedContent = await window.electronAPI.gitShowFile(
          repoPath,
          selectedCommitHash,
          file.path
        );
      }

      openDiff(
        `diff://${selectedCommitHash}-${file.path}`,
        `${getBasename(file.path)} (${selectedCommitHash.slice(0, 7)})`,
        originalContent,
        modifiedContent,
        `${selectedCommitHash.slice(0, 7)}^`,
        selectedCommitHash.slice(0, 7)
      );
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  const handlePush = async () => {
    if (!repoPath || !selectedRemote) return;
    if (forcePush) {
      const confirmed = await confirmDialog({
        title: '确认强制推送 (--force-with-lease)',
        message: `强制推送可能会覆盖远程仓库 ${selectedRemote}/${targetBranch.trim() || 'HEAD'} 上已有的提交历史。确定要继续吗？`,
        confirmText: '确认强制推送',
        cancelText: '取消',
        variant: 'danger',
      });
      if (!confirmed) return;
    }

    setPushing(true);
    setError(null);
    setGitSyncLabel('正在推送到远程仓库...');

    try {
      const output = await window.electronAPI.gitPush(
        repoPath,
        selectedRemote,
        targetBranch.trim() || 'HEAD',
        forcePush,
        pushTags,
        true
      );
      await syncWorkspaceAfterGitChange();
      toast.success(
        `已推送到 ${selectedRemote}/${targetBranch.trim() || 'HEAD'}`,
        output || undefined
      );
      onClose();
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setPushing(false);
      setGitSyncLabel(null);
    }
  };

  const treeRoot = useMemo(() => buildFileTree(commitFiles), [commitFiles]);

  const toggleAllDirs = () => {
    const allDirs: string[] = [];
    for (const f of commitFiles) {
      const parts = f.path.split('/');
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        allDirs.push(cur);
      }
    }
    const anyCollapsed = allDirs.some((d) => !expandedDirs[d]);
    const next: Record<string, boolean> = {};
    for (const d of allDirs) next[d] = anyCollapsed;
    setExpandedDirs(next);
  };

  const renderTree = (node: TreeNode, depth = 0): React.ReactNode => {
    const children = Object.values(node.children).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return children.map((child) => {
      if (child.isDir) {
        const isOpen = !!expandedDirs[child.path];
        return (
          <div key={child.path}>
            <button
              type="button"
              onClick={() =>
                setExpandedDirs((prev) => ({ ...prev, [child.path]: !prev[child.path] }))
              }
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              className="w-full flex items-center gap-1.5 py-1 pr-2 text-xs text-text-secondary hover:text-text-primary hover:bg-background-tertiary rounded transition-colors cursor-pointer"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
              )}
              <Folder className="w-3.5 h-3.5 text-primary/80 flex-shrink-0" />
              <span className="truncate font-mono text-[11px]">{child.name}</span>
            </button>
            {isOpen && renderTree(child, depth + 1)}
          </div>
        );
      }

      const fileObj: ChangedFile = {
        path: child.path,
        status: child.status || 'M',
        oldPath: child.oldPath,
      };
      return (
        <button
          key={child.path}
          type="button"
          onClick={() => handleOpenCommitFileDiff(fileObj)}
          style={{ paddingLeft: `${depth * 14 + 22}px` }}
          className="w-full flex items-center justify-between gap-2 py-1 pr-2 text-xs hover:bg-background-tertiary rounded transition-colors cursor-pointer group"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
            <span className="font-mono text-[11px] text-text-primary truncate group-hover:underline">
              {child.name}
            </span>
          </span>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${statusBadgeClass(child.status)}`}>
            {child.status || 'M'}
          </span>
        </button>
      );
    });
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      size="xl"
      preventClose={pushing}
      icon={<ArrowUpCircle className="w-4 h-4 text-emerald-500" />}
      title={`推送提交到远程仓库 (Git Push)`}
      subtitle={`${repoName} · 当前分支: ${currentBranch}`}
      headerExtra={
        <button
          type="button"
          onClick={loadUnpushed}
          disabled={loadingCommits || pushing}
          title="重新检查待推送提交"
          className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-background-tertiary transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingCommits ? 'animate-spin' : ''}`} />
        </button>
      }
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text-primary select-none">
              <input
                type="checkbox"
                checked={pushTags}
                onChange={(e) => setPushTags(e.target.checked)}
                className="rounded border-border-primary text-primary focus:ring-primary"
              />
              <span>推送标签 (--tags)</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer text-amber-600 dark:text-amber-400 select-none">
              <input
                type="checkbox"
                checked={forcePush}
                onChange={(e) => setForcePush(e.target.checked)}
                className="rounded border-border-primary text-amber-500 focus:ring-amber-500"
              />
              <span>安全强推 (--force-with-lease)</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pushing}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary bg-background-tertiary hover:bg-background-secondary border border-border-primary transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={pushing || loadingRemotes || remotes.length === 0}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer disabled:opacity-45 ${
                forcePush ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {pushing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowUpCircle className="w-3.5 h-3.5" />
              )}
              <span>{forcePush ? '强制推送' : '推送 (Push)'}</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col h-[520px] max-h-[70vh] p-4 gap-3 overflow-hidden">
        {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

        {/* Target Bar */}
        {remotes.length === 0 && !loadingRemotes ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
            <span className="text-amber-700 dark:text-amber-300 font-medium whitespace-nowrap">
              未配置远程仓库 (origin)：
            </span>
            <input
              type="text"
              value={newRemoteUrl}
              onChange={(e) => setNewRemoteUrl(e.target.value)}
              placeholder="输入 Git 远端 URL（如 https://... 或 git@...）"
              className="flex-1 rounded-md border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={handleAddQuickRemote}
              disabled={addingRemote || !newRemoteUrl.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 disabled:opacity-45 text-white font-medium cursor-pointer"
            >
              {addingRemote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              <span>添加 origin</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs bg-background-secondary/60 px-3 py-2 rounded-lg border border-border-primary">
            <span className="font-mono font-semibold text-primary">{repoName}</span>
            <span className="text-text-tertiary font-mono">({currentBranch})</span>
            <span className="text-text-tertiary">→</span>
            <select
              value={selectedRemote}
              onChange={(e) => setSelectedRemote(e.target.value)}
              aria-label="目标远程仓库"
              className="rounded-md border border-border-primary bg-background-primary px-2.5 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
            >
              {remotes.map(([name]) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <span className="text-text-tertiary font-mono">/</span>
            <input
              type="text"
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              aria-label="目标远端分支名"
              placeholder="目标分支名"
              className="flex-1 min-w-[160px] rounded-md border border-border-primary bg-background-primary px-2.5 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {/* Dual Pane: Commits vs Changed Files */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-hidden">
          {/* Left: Unpushed Commits */}
          <div className="flex flex-col border border-border-primary rounded-lg overflow-hidden bg-background-secondary/35">
            <div className="px-3 py-2 bg-background-secondary border-b border-border-primary text-xs font-medium text-text-primary flex items-center justify-between">
              <span>待推送提交 ({commits.length})</span>
              <span className="text-[10px] text-text-tertiary">点击查看变更文件</span>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border-primary/60">
              {loadingCommits ? (
                <div className="flex items-center justify-center h-full text-xs text-text-secondary gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>正在计算未推送提交...</span>
                </div>
              ) : commits.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-text-tertiary px-4 text-center">
                  当前分支没有落后于远端的待推送提交（可勾选“推送标签”直接同步 Tag）
                </div>
              ) : (
                commits.map((c) => {
                  const active = c.hash === selectedCommitHash;
                  return (
                    <button
                      key={c.hash}
                      type="button"
                      onClick={() => setSelectedCommitHash(c.hash)}
                      className={`w-full text-left px-3 py-2 transition-colors cursor-pointer ${
                        active ? 'bg-primary/15 border-l-2 border-primary' : 'hover:bg-background-tertiary/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <GitCommit className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        <span className="font-medium text-text-primary truncate flex-1">{c.message}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-text-tertiary font-mono mt-1 pl-5">
                        <span>{c.author} · {c.date}</span>
                        <span>{c.hash.slice(0, 7)}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Files in selected commit */}
          <div className="flex flex-col border border-border-primary rounded-lg overflow-hidden bg-background-secondary/35">
            <div className="px-3 py-1.5 bg-background-secondary border-b border-border-primary text-xs font-medium text-text-primary flex items-center justify-between">
              <span>变更文件 ({commitFiles.length})</span>
              <div className="flex items-center gap-1">
                {treeMode && commitFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllDirs}
                    title="全部展开 / 折叠"
                    className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-background-tertiary cursor-pointer"
                  >
                    <ChevronsUpDown className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTreeMode((v) => !v)}
                  title={treeMode ? '切换为平铺列表' : '切换为目录树'}
                  className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-background-tertiary cursor-pointer"
                >
                  {treeMode ? <List className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-0.5">
              {loadingFiles ? (
                <div className="flex items-center justify-center h-full text-xs text-text-secondary gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>正在加载文件清单...</span>
                </div>
              ) : !selectedCommitHash ? (
                <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
                  选择左侧提交查看详情
                </div>
              ) : commitFiles.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
                  此提交无文件改动
                </div>
              ) : treeMode ? (
                renderTree(treeRoot)
              ) : (
                commitFiles.map((file) => (
                  <button
                    key={`${file.status}-${file.path}`}
                    type="button"
                    onClick={() => handleOpenCommitFileDiff(file)}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs hover:bg-background-tertiary rounded transition-colors cursor-pointer group"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                      <span className="font-mono text-[11px] text-text-primary truncate group-hover:underline">
                        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                      </span>
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${statusBadgeClass(file.status)}`}>
                      {file.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};
