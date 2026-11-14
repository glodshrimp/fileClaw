import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  History,
  GitCommit,
  Copy,
  FileText,
  ChevronRight,
  ChevronDown,
  Loader2,
  Folder,
} from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog } from '../../../../components/ui/ModalDialog';
import { copyToClipboard } from '../../../../utils/copy';
import { parseGitError } from '../../../../utils/gitError';
import {
  findGitRootForPath,
  getBasename,
  getRelativePathInRepo,
} from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface HistoryDialogProps {
  path: string;
  projectPath?: string;
  isDirectory?: boolean;
  onClose: () => void;
}

interface CommitRecord {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface CommitFile {
  path: string;
  status: string;
  oldPath?: string;
}

const PAGE_SIZE = 50;

export const HistoryDialog: React.FC<HistoryDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  isDirectory = false,
  onClose,
}) => {
  const { currentProject, gitRoots, openDiff } = useWorkspaceStore();

  const repoPath = useMemo(
    () =>
      explicitProjectPath ||
      findGitRootForPath(path, gitRoots, currentProject?.codePath || currentProject?.path || path),
    [explicitProjectPath, path, gitRoots, currentProject]
  );

  const relPath = useMemo(() => getRelativePathInRepo(path, repoPath), [path, repoPath]);
  const isScopeDir = isDirectory || relPath === '' || relPath === '.';

  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // For directory mode: expandable commit files
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [commitFilesMap, setCommitFilesMap] = useState<Record<string, CommitFile[]>>({});
  const [loadingFilesHash, setLoadingFilesHash] = useState<string | null>(null);

  const loadHistory = useCallback(
    async (skip: number, append: boolean) => {
      if (!repoPath) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const scopeArg = relPath === '' || relPath === '.' ? undefined : relPath;
        const rows = await window.electronAPI.gitHistory(repoPath, scopeArg, PAGE_SIZE, skip);
        setHasMore(rows.length >= PAGE_SIZE);
        setCommits((prev) => (append ? [...prev, ...rows] : rows));
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [repoPath, relPath]
  );

  useEffect(() => {
    loadHistory(0, false);
  }, [loadHistory]);

  const handleOpenDiffForFile = async (commitHash: string, targetFile: string, oldFile?: string, status?: string) => {
    if (!repoPath) return;
    setError(null);
    try {
      let originalContent = '';
      if (status !== 'A') {
        try {
          originalContent = await window.electronAPI.gitShowFile(
            repoPath,
            `${commitHash}^`,
            oldFile || targetFile
          );
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
      if (status !== 'D') {
        modifiedContent = await window.electronAPI.gitShowFile(repoPath, commitHash, targetFile);
      }

      openDiff(
        `diff://${commitHash}-${targetFile}`,
        `${getBasename(targetFile)} (${commitHash.slice(0, 7)})`,
        originalContent,
        modifiedContent,
        `${commitHash.slice(0, 7)}^`,
        commitHash.slice(0, 7)
      );
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  const handleRowClick = async (commit: CommitRecord) => {
    if (!isScopeDir) {
      await handleOpenDiffForFile(commit.hash, relPath);
      return;
    }

    if (expandedHash === commit.hash) {
      setExpandedHash(null);
      return;
    }
    setExpandedHash(commit.hash);
    if (commitFilesMap[commit.hash]) return;

    setLoadingFilesHash(commit.hash);
    try {
      const files = await window.electronAPI.gitCommitFiles(repoPath, commit.hash);
      const scoped =
        relPath && relPath !== '.'
          ? files.filter((f) => f.path === relPath || f.path.startsWith(`${relPath}/`))
          : files;
      setCommitFilesMap((prev) => ({ ...prev, [commit.hash]: scoped }));
    } catch (err) {
      setError(err);
    } finally {
      setLoadingFilesHash(null);
    }
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      size="lg"
      icon={
        isScopeDir ? (
          <Folder className="w-4 h-4 text-primary" />
        ) : (
          <History className="w-4 h-4 text-primary" />
        )
      }
      title={isScopeDir ? '目录 / 仓库提交历史' : '文件修改历史 (Git History)'}
      subtitle={`${getBasename(repoPath)} · ${relPath || '全仓库'}`}
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
      <div className="flex flex-col h-[500px] max-h-[68vh] p-4 gap-3 overflow-hidden text-xs">
        {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

        <div className="flex-1 min-h-0 flex flex-col border border-border-primary rounded-lg overflow-hidden bg-background-secondary/35">
          <div className="px-3 py-2 bg-background-secondary border-b border-border-primary text-[11px] text-text-secondary flex items-center justify-between">
            <span>
              {isScopeDir
                ? '点击提交展开该次涉及的变动文件，再点击文件对比 Diff'
                : '点击任意提交即可对比该次修改前后的代码差异'}
            </span>
            <span className="font-mono">已加载 {commits.length} 条</span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border-primary/60">
            {loading ? (
              <div className="flex items-center justify-center h-full text-text-secondary gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>正在加载提交历史...</span>
              </div>
            ) : commits.length === 0 ? (
              <div className="flex items-center justify-center h-full text-text-tertiary">
                暂无提交历史记录
              </div>
            ) : (
              <>
                {commits.map((commit) => {
                  const isExpanded = expandedHash === commit.hash;
                  const files = commitFilesMap[commit.hash];
                  return (
                    <div key={commit.hash} className="bg-background-primary/30">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-background-tertiary/70 transition-colors">
                        <button
                          type="button"
                          onClick={() => handleRowClick(commit)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          {isScopeDir ? (
                            isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                            )
                          ) : (
                            <GitCommit className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-text-primary truncate">
                              {commit.message}
                            </div>
                            <div className="text-[11px] text-text-tertiary font-mono mt-0.5">
                              {commit.author} · {commit.date}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-background-secondary border border-border-primary text-text-secondary">
                            {commit.hash.slice(0, 7)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => copyToClipboard(commit.hash, e)}
                            title="复制完整 Hash"
                            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-background-tertiary cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isScopeDir && isExpanded && (
                        <div className="px-8 pb-2.5 pt-1 bg-background-secondary/40 border-t border-border-primary/40 space-y-1">
                          {loadingFilesHash === commit.hash ? (
                            <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary py-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>正在读取提交变动...</span>
                            </div>
                          ) : !files || files.length === 0 ? (
                            <div className="text-[11px] text-text-tertiary">该目录在此提交中无文件列表</div>
                          ) : (
                            files.map((f) => (
                              <button
                                key={`${f.status}-${f.path}`}
                                type="button"
                                onClick={() =>
                                  handleOpenDiffForFile(commit.hash, f.path, f.oldPath, f.status)
                                }
                                className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-background-tertiary text-[11px] cursor-pointer group"
                              >
                                <span className="flex items-center gap-1.5 font-mono text-text-primary truncate group-hover:underline">
                                  <FileText className="w-3 h-3 text-text-tertiary flex-shrink-0" />
                                  <span className="truncate">
                                    {f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                                  </span>
                                </span>
                                <span className="font-mono text-[10px] px-1.5 rounded bg-background-primary border border-border-primary text-text-secondary">
                                  {f.status}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {hasMore && (
                  <div className="p-2.5 flex justify-center">
                    <button
                      type="button"
                      onClick={() => loadHistory(commits.length, true)}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-border-primary bg-background-primary hover:bg-background-tertiary text-xs text-text-primary cursor-pointer"
                    >
                      {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{loadingMore ? '加载中...' : '加载更多提交记录'}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};
