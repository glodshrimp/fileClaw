import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {
  GitCommit,
  GitBranch,
  Tag,
  RefreshCw,
  Search,
  Copy,
  FileText,
  Folder,
  ChevronRight,
  ChevronDown,
  Loader2,
  Plus,
  RotateCcw,
  GitPullRequest,
  ChevronsUpDown,
  List,
  Layers,
  Undo2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog, confirmDialog } from '../../../../components/ui/ModalDialog';
import { toast } from '../../../../contexts/useToastStore';
import { copyToClipboard } from '../../../../utils/copy';
import { parseGitError } from '../../../../utils/gitError';
import { getBasename, getProjectRootPath } from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface GraphCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  refs: string;
  message: string;
}

interface BranchInfo {
  name: string;
  is_remote: boolean;
  is_current: boolean;
}

interface CommitFile {
  path: string;
  status: string;
  oldPath?: string;
}

interface ParsedRef {
  kind: 'head' | 'detached' | 'tag' | 'remote' | 'local';
  label: string;
  target: string | null;
}

interface LaneSegment {
  fromCol: number;
  toCol: number;
  color: string;
}

interface CommitRowLayout {
  col: number;
  color: string;
  incomingCount: number;
  outgoingCount: number;
  passThroughCols: { col: number; color: string }[];
  incomingLines: LaneSegment[];
  outgoingLines: LaneSegment[];
}

const LANE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f43f5e', // rose
  '#84cc16', // lime
];

const LANE_STEP = 14;
const ROW_H = 30;
const PAGE_STEP = 200;

function computeGraphLayouts(commits: GraphCommit[]): {
  layouts: CommitRowLayout[];
  maxCols: number;
} {
  let lanes: (string | null)[] = [];
  let maxCols = 1;
  const layouts: CommitRowLayout[] = [];

  for (let idx = 0; idx < commits.length; idx++) {
    const commit = commits[idx];

    const incomingLines: LaneSegment[] = [];
    const passThroughCols: { col: number; color: string }[] = [];

    // Locate first lane expecting this commit
    let commitCol = lanes.indexOf(commit.hash);
    if (commitCol === -1) {
      const freeSlot = lanes.indexOf(null);
      if (freeSlot !== -1) {
        commitCol = freeSlot;
      } else {
        commitCol = lanes.length;
        lanes.push(null);
      }
    }

    // Any other lane also expecting this commit merges into commitCol
    for (let c = 0; c < lanes.length; c++) {
      const expected = lanes[c];
      if (expected === commit.hash) {
        incomingLines.push({
          fromCol: c,
          toCol: commitCol,
          color: LANE_COLORS[c % LANE_COLORS.length],
        });
        if (c !== commitCol) {
          lanes[c] = null;
        }
      } else if (expected !== null && c !== commitCol) {
        passThroughCols.push({
          col: c,
          color: LANE_COLORS[c % LANE_COLORS.length],
        });
      }
    }

    const nextLanes = [...lanes];
    const outgoingLines: LaneSegment[] = [];
    const firstParent = commit.parents[0] || null;

    if (firstParent) {
      nextLanes[commitCol] = firstParent;
      outgoingLines.push({
        fromCol: commitCol,
        toCol: commitCol,
        color: LANE_COLORS[commitCol % LANE_COLORS.length],
      });
    } else {
      nextLanes[commitCol] = null;
    }

    for (let pIdx = 1; pIdx < commit.parents.length; pIdx++) {
      const parentHash = commit.parents[pIdx];
      let targetCol = nextLanes.indexOf(parentHash);
      if (targetCol === -1) {
        const freeSlot = nextLanes.indexOf(null);
        if (freeSlot !== -1) {
          targetCol = freeSlot;
        } else {
          targetCol = nextLanes.length;
          nextLanes.push(null);
        }
        nextLanes[targetCol] = parentHash;
      }
      outgoingLines.push({
        fromCol: commitCol,
        toCol: targetCol,
        color: LANE_COLORS[targetCol % LANE_COLORS.length],
      });
    }

    // Trim trailing nulls to prevent unbounded lane growth
    while (nextLanes.length > 1 && nextLanes[nextLanes.length - 1] === null) {
      nextLanes.pop();
    }

    maxCols = Math.max(maxCols, nextLanes.length, commitCol + 1);
    lanes = nextLanes;

    layouts.push({
      col: commitCol,
      color: LANE_COLORS[commitCol % LANE_COLORS.length],
      incomingCount: incomingLines.length,
      outgoingCount: outgoingLines.length,
      passThroughCols,
      incomingLines,
      outgoingLines,
    });
  }

  return { layouts, maxCols };
}

function parseRefs(refsStr: string, remoteNames: Set<string>): ParsedRef[] {
  if (!refsStr || !refsStr.trim()) return [];
  return refsStr
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((token): ParsedRef => {
      if (token.startsWith('HEAD -> ')) {
        const branch = token.slice('HEAD -> '.length).trim();
        return { kind: 'head', label: `HEAD → ${branch}`, target: branch };
      }
      if (token === 'HEAD') {
        return { kind: 'detached', label: 'HEAD', target: null };
      }
      if (token.startsWith('tag: ')) {
        const tagName = token.slice('tag: '.length).trim();
        return { kind: 'tag', label: tagName, target: tagName };
      }
      if (remoteNames.has(token) || token.includes('origin/')) {
        return { kind: 'remote', label: token, target: token };
      }
      return { kind: 'local', label: token, target: token };
    });
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  status?: string;
  oldPath?: string;
  children: Record<string, TreeNode>;
}

function buildFileTree(files: CommitFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: {} };
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let cur = root;
    let built = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      built = built ? `${built}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (!cur.children[part]) {
        cur.children[part] = {
          name: part,
          path: built,
          isDir: !isLast,
          status: isLast ? f.status : undefined,
          oldPath: isLast ? f.oldPath : undefined,
          children: {},
        };
      }
      cur = cur.children[part];
    }
  }
  return root;
}

const statusBadgeStyle = (status?: string) => {
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

export const GitGraphTab: React.FC = () => {
  const {
    currentProject,
    gitRoots,
    gitGraphRepoPath,
    setGitGraphRepoPath,
    openDiff,
    syncWorkspaceAfterGitChange,
    setGitSyncLabel,
  } = useWorkspaceStore();

  const projectPath = useMemo(() => {
    if (gitGraphRepoPath && gitRoots.includes(gitGraphRepoPath)) return gitGraphRepoPath;
    if (gitRoots.length > 0) return gitRoots[0];
    return currentProject ? getProjectRootPath(currentProject) : '';
  }, [gitGraphRepoPath, gitRoots, currentProject]);

  const [commits, setCommits] = useState<GraphCommit[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [limit, setLimit] = useState<number>(PAGE_STEP);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [fetching, setFetching] = useState<boolean>(false);
  const [error, setError] = useState<unknown>(null);

  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);
  const [treeMode, setTreeMode] = useState<boolean>(true);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [detailWidth, setDetailWidth] = useState<number>(360);

  // Commit right-click menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    commit: GraphCommit;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [ctxMenuPos, setCtxMenuPos] = useState({ left: 0, top: 0, ready: false });

  // Action sub-modals
  const [branchModal, setBranchModal] = useState<{
    open: boolean;
    commit: GraphCommit | null;
    name: string;
    checkout: boolean;
  }>({ open: false, commit: null, name: '', checkout: true });

  const [tagModal, setTagModal] = useState<{
    open: boolean;
    commit: GraphCommit | null;
    name: string;
    message: string;
    force: boolean;
  }>({ open: false, commit: null, name: '', message: '', force: false });

  const [resetModal, setResetModal] = useState<{
    open: boolean;
    commit: GraphCommit | null;
    mode: 'soft' | 'mixed' | 'hard';
  }>({ open: false, commit: null, mode: 'mixed' });

  const [submittingAction, setSubmittingAction] = useState(false);

  const loadGraphData = useCallback(
    async (requestedLimit: number, appendLoading = false) => {
      if (!projectPath) return;
      if (appendLoading) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const [commitRows, branchRows] = await Promise.all([
          window.electronAPI.gitLogGraph(
            projectPath,
            branchFilter === 'all' ? undefined : branchFilter,
            requestedLimit,
            0
          ),
          window.electronAPI.gitBranches(projectPath),
        ]);
        setCommits(commitRows);
        setBranches(branchRows);
        setSelectedCommitHash((prev) =>
          prev && commitRows.some((c: GraphCommit) => c.hash === prev)
            ? prev
            : commitRows[0]?.hash || null
        );
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [projectPath, branchFilter]
  );

  useEffect(() => {
    setLimit(PAGE_STEP);
    loadGraphData(PAGE_STEP, false);
  }, [loadGraphData]);

  // Load changed files when selectedCommitHash changes
  const selectedCommit = useMemo(
    () => commits.find((c) => c.hash === selectedCommitHash) || null,
    [commits, selectedCommitHash]
  );

  useEffect(() => {
    if (!projectPath || !selectedCommitHash) {
      setCommitFiles([]);
      return;
    }
    let active = true;
    setLoadingFiles(true);
    window.electronAPI
      .gitCommitFiles(projectPath, selectedCommitHash)
      .then((files) => {
        if (!active) return;
        setCommitFiles(files);
        const dirs: Record<string, boolean> = {};
        for (const f of files) {
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
  }, [projectPath, selectedCommitHash]);

  // Context menu viewport clamping & Esc/outside dismiss
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return;
    const rect = ctxMenuRef.current.getBoundingClientRect();
    const pad = 8;
    setCtxMenuPos({
      left: Math.max(pad, Math.min(ctxMenu.x, window.innerWidth - rect.width - pad)),
      top: Math.max(pad, Math.min(ctxMenu.y, window.innerHeight - rect.height - pad)),
      ready: true,
    });
  }, [ctxMenu]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setCtxMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [ctxMenu]);

  const remoteNameSet = useMemo(
    () => new Set(branches.filter((b) => b.is_remote).map((b) => b.name)),
    [branches]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0;

  const filteredCommits = useMemo(() => {
    if (!isFiltering) return commits;
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(normalizedQuery) ||
        c.author.toLowerCase().includes(normalizedQuery) ||
        c.email.toLowerCase().includes(normalizedQuery) ||
        c.hash.toLowerCase().includes(normalizedQuery) ||
        c.refs.toLowerCase().includes(normalizedQuery)
    );
  }, [commits, isFiltering, normalizedQuery]);

  const { layouts, maxCols } = useMemo(
    () => (isFiltering ? { layouts: [], maxCols: 1 } : computeGraphLayouts(commits)),
    [commits, isFiltering]
  );

  const handleFetch = async () => {
    if (!projectPath) return;
    setFetching(true);
    setError(null);
    setGitSyncLabel('正在获取远端...');
    try {
      await window.electronAPI.gitFetch(projectPath);
      await loadGraphData(limit, false);
      await syncWorkspaceAfterGitChange();
      toast.success('已获取远端分支与提交更新');
    } catch (err) {
      setError(err);
    } finally {
      setFetching(false);
      setGitSyncLabel(null);
    }
  };

  const handleCheckoutTarget = async (target: string, label: string, isCommitHash = false) => {
    const confirmed = await confirmDialog({
      title: isCommitHash ? '检出到历史提交 (Detached HEAD)' : '切换 Git 引用',
      message: isCommitHash
        ? `即将检出到提交 ${target.slice(0, 7)}。这会进入游离 HEAD (Detached HEAD) 状态，建议基于该提交创建分支后再提交修改。`
        : `确定要切换到 "${label}" 吗？`,
      confirmText: '确认检出',
      variant: 'primary',
    });
    if (!confirmed) return;

    try {
      await window.electronAPI.gitCheckout(projectPath, target);
      await syncWorkspaceAfterGitChange();
      await loadGraphData(limit, false);
      toast.success(`已检出到 ${isCommitHash ? target.slice(0, 7) : label}`);
    } catch (err) {
      const parsed = parseGitError(err);
      toast.error(parsed.summary, parsed.hint);
    }
  };

  const handleCherryPick = async (commit: GraphCommit) => {
    const confirmed = await confirmDialog({
      title: '遴选提交 (Cherry-pick)',
      message: `确定要将提交 ${commit.hash.slice(0, 7)} 的更改应用到当前所在分支吗？`,
      detail: commit.message,
      confirmText: '执行 Cherry-pick',
      variant: 'primary',
    });
    if (!confirmed) return;

    try {
      await window.electronAPI.gitCherryPick(projectPath, commit.hash);
      await syncWorkspaceAfterGitChange();
      await loadGraphData(limit, false);
      toast.success(`已成功遴选 ${commit.hash.slice(0, 7)}`);
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    }
  };

  const handleRevertCommit = async (commit: GraphCommit) => {
    const confirmed = await confirmDialog({
      title: '回退提交 (Revert)',
      message: `确定要生成一个新的反向提交以抵消提交 ${commit.hash.slice(0, 7)} 吗？`,
      detail: commit.message,
      confirmText: '执行 Revert',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      await window.electronAPI.gitRevertCommit(projectPath, commit.hash);
      await syncWorkspaceAfterGitChange();
      await loadGraphData(limit, false);
      toast.success(`已生成回退提交 (${commit.hash.slice(0, 7)})`);
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    }
  };

  const submitCreateBranch = async () => {
    if (!branchModal.commit || !branchModal.name.trim()) return;
    setSubmittingAction(true);
    try {
      await window.electronAPI.gitCreateBranch(
        projectPath,
        branchModal.name.trim(),
        branchModal.commit.hash,
        branchModal.checkout,
        false
      );
      const createdName = branchModal.name.trim();
      setBranchModal({ open: false, commit: null, name: '', checkout: true });
      await syncWorkspaceAfterGitChange();
      await loadGraphData(limit, false);
      toast.success(`已创建分支 ${createdName}`);
    } catch (err) {
      setError(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const submitCreateTag = async () => {
    if (!tagModal.commit || !tagModal.name.trim()) return;
    setSubmittingAction(true);
    try {
      await window.electronAPI.gitCreateTag(
        projectPath,
        tagModal.name.trim(),
        tagModal.commit.hash,
        tagModal.message.trim() || null,
        tagModal.force
      );
      const tagName = tagModal.name.trim();
      setTagModal({ open: false, commit: null, name: '', message: '', force: false });
      await loadGraphData(limit, false);
      toast.success(`已创建标签 ${tagName}`);
    } catch (err) {
      setError(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const submitReset = async () => {
    if (!resetModal.commit) return;
    if (resetModal.mode === 'hard') {
      const ok = await confirmDialog({
        title: '确认执行 Hard Reset',
        message: `Hard Reset 会永久清除所有未提交的工作区改动与暂存区内容，并将当前分支指针移动到 ${resetModal.commit.hash.slice(0, 7)}。确定要继续吗？`,
        confirmText: '确认 Hard Reset',
        variant: 'danger',
      });
      if (!ok) return;
    }

    setSubmittingAction(true);
    try {
      await window.electronAPI.gitReset(projectPath, resetModal.commit.hash, resetModal.mode);
      const shortHash = resetModal.commit.hash.slice(0, 7);
      const mode = resetModal.mode;
      setResetModal({ open: false, commit: null, mode: 'mixed' });
      await syncWorkspaceAfterGitChange();
      await loadGraphData(limit, false);
      toast.success(`已重置 (${mode}) 到 ${shortHash}`);
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleOpenFileDiff = async (file: CommitFile) => {
    if (!selectedCommit) return;
    try {
      const parentHash = selectedCommit.parents[0] || '';
      let originalContent = '';
      if (parentHash && file.status !== 'A') {
        try {
          originalContent = await window.electronAPI.gitShowFile(
            projectPath,
            parentHash,
            file.oldPath || file.path
          );
        } catch (err: any) {
          const parsed = parseGitError(err);
          if (parsed.raw.startsWith('BINARY_FILE:') || parsed.raw.startsWith('FILE_TOO_LARGE:')) {
            toast.info(parsed.summary, parsed.hint);
            return;
          }
          originalContent = '';
        }
      }

      let modifiedContent = '';
      if (file.status !== 'D') {
        try {
          modifiedContent = await window.electronAPI.gitShowFile(
            projectPath,
            selectedCommit.hash,
            file.path
          );
        } catch (err: any) {
          const parsed = parseGitError(err);
          if (parsed.raw.startsWith('BINARY_FILE:') || parsed.raw.startsWith('FILE_TOO_LARGE:')) {
            toast.info(parsed.summary, parsed.hint);
            return;
          }
          throw err;
        }
      }

      openDiff(
        `diff://${selectedCommit.hash}-${file.path}`,
        `${getBasename(file.path)} (${selectedCommit.hash.slice(0, 7)})`,
        originalContent,
        modifiedContent,
        parentHash ? parentHash.slice(0, 7) : '空 (初始提交)',
        selectedCommit.hash.slice(0, 7)
      );
    } catch (err) {
      const parsed = parseGitError(err);
      toast.error(parsed.summary, parsed.hint);
    }
  };

  const treeRoot = useMemo(() => buildFileTree(commitFiles), [commitFiles]);

  const toggleAllDirs = () => {
    const dirs: string[] = [];
    for (const f of commitFiles) {
      const parts = f.path.split('/');
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        dirs.push(cur);
      }
    }
    const anyClosed = dirs.some((d) => !expandedDirs[d]);
    const next: Record<string, boolean> = {};
    for (const d of dirs) next[d] = anyClosed;
    setExpandedDirs(next);
  };

  const renderFileTree = (node: TreeNode, depth = 0): React.ReactNode => {
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
            {isOpen && renderFileTree(child, depth + 1)}
          </div>
        );
      }

      return (
        <button
          key={child.path}
          type="button"
          onClick={() =>
            handleOpenFileDiff({
              path: child.path,
              status: child.status || 'M',
              oldPath: child.oldPath,
            })
          }
          style={{ paddingLeft: `${depth * 14 + 22}px` }}
          className="w-full flex items-center justify-between gap-2 py-1 pr-2 text-xs text-text-primary hover:bg-background-tertiary rounded transition-colors cursor-pointer group"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
            <span className="font-mono text-[11px] truncate group-hover:underline">
              {child.name}
            </span>
          </span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${statusBadgeStyle(child.status)}`}
          >
            {child.status || 'M'}
          </span>
        </button>
      );
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = detailWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(260, Math.min(620, startW - (ev.clientX - startX)));
      setDetailWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  if (!projectPath || gitRoots.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background-primary text-text-secondary p-6 text-center space-y-2">
        <GitCommit className="w-8 h-8 text-text-tertiary" />
        <div className="text-sm font-medium text-text-primary">当前工作区未检测到 Git 仓库</div>
        <div className="text-xs text-text-tertiary">
          可在左侧资源管理器右键任意目录选择「在此目录初始化 Git 仓库」
        </div>
      </div>
    );
  }

  const localBranchList = branches.filter((b) => !b.is_remote);
  const remoteBranchList = branches.filter((b) => b.is_remote);
  const svgWidth = Math.max(28, maxCols * LANE_STEP + 10);

  return (
    <div className="flex-1 flex flex-col h-full bg-background-primary text-text-primary overflow-hidden select-none">
      {/* Toolbar */}
      <div className="h-11 px-3 border-b border-border-primary bg-background-secondary/80 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {gitRoots.length > 1 && (
            <select
              value={projectPath}
              onChange={(e) => setGitGraphRepoPath(e.target.value)}
              aria-label="选择仓库"
              title={projectPath}
              className="rounded-lg border border-border-primary bg-background-primary px-2.5 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-primary max-w-[160px]"
            >
              {gitRoots.map((root) => (
                <option key={root} value={root}>
                  {getBasename(root)}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="按分支筛选提交图谱"
              className="rounded-lg border border-border-primary bg-background-primary px-2.5 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-primary max-w-[200px]"
            >
              <option value="all">全部分支 (--all)</option>
              {localBranchList.length > 0 && (
                <optgroup label="本地分支">
                  {localBranchList.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.is_current ? `* ${b.name}` : b.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {remoteBranchList.length > 0 && (
                <optgroup label="远端分支">
                  {remoteBranchList.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="relative flex-1 max-w-xs min-w-[140px]">
            <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="筛选提交说明 / 作者 / Hash / Tag..."
              className="w-full pl-8 pr-2.5 py-1 rounded-lg border border-border-primary bg-background-primary text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={handleFetch}
            disabled={fetching || loading}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-primary bg-background-primary hover:bg-background-tertiary text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fetching ? 'animate-spin text-primary' : ''}`} />
            <span>Fetch</span>
          </button>
          <button
            type="button"
            onClick={() => loadGraphData(limit, false)}
            disabled={loading}
            title="刷新提交图谱"
            className="p-1.5 rounded-lg border border-border-primary bg-background-primary hover:bg-background-tertiary text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {Boolean(error) && (
        <div className="px-3 pt-2 flex-shrink-0">
          <GitErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* Main Split: Commit Graph Left + Commit Inspector Right */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: Commit List */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Column Header */}
          <div className="h-7 px-3 border-b border-border-primary bg-background-secondary/50 flex items-center text-[10px] font-semibold uppercase tracking-wider text-text-tertiary flex-shrink-0">
            {!isFiltering && (
              <div
                style={{ width: Math.min(160, svgWidth) }}
                className="flex-shrink-0 pr-2"
              >
                分支线
              </div>
            )}
            <div className="flex-1 min-w-0 pr-3">提交信息 &amp; 引用</div>
            <div className="w-28 flex-shrink-0 hidden sm:block pr-2">作者</div>
            <div className="w-16 flex-shrink-0 hidden md:block pr-2">Hash</div>
            <div className="w-20 flex-shrink-0 text-right">日期</div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {loading && commits.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-text-secondary gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>正在构建提交图谱...</span>
              </div>
            ) : filteredCommits.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
                {isFiltering ? '没有匹配的提交记录' : '当前分支暂无提交记录'}
              </div>
            ) : (
              <>
                {filteredCommits.map((commit, rowIdx) => {
                  const isSelected = commit.hash === selectedCommitHash;
                  const layout = !isFiltering ? layouts[rowIdx] : null;
                  const refList = parseRefs(commit.refs, remoteNameSet);
                  const displayGraphW = Math.min(160, svgWidth);

                  return (
                    <div
                      key={commit.hash}
                      onClick={() => setSelectedCommitHash(commit.hash)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelectedCommitHash(commit.hash);
                        setCtxMenuPos({ left: e.clientX, top: e.clientY, ready: false });
                        setCtxMenu({ x: e.clientX, y: e.clientY, commit });
                      }}
                      style={{ height: ROW_H }}
                      className={`px-3 flex items-center text-xs cursor-pointer transition-colors border-b border-border-primary/40 ${
                        isSelected
                          ? 'bg-primary/15 border-l-2 border-l-primary pl-[10px]'
                          : 'hover:bg-background-tertiary/60'
                      }`}
                    >
                      {/* Constrained SVG lane graph */}
                      {layout && (
                        <div
                          style={{ width: displayGraphW }}
                          className="flex-shrink-0 h-full overflow-x-auto scrollbar-none pr-2"
                        >
                          <svg width={svgWidth} height={ROW_H} className="block">
                            {/* Pass-through vertical lines */}
                            {layout.passThroughCols.map((pt) => {
                              const x = pt.col * LANE_STEP + 9;
                              return (
                                <line
                                  key={`pt-${pt.col}`}
                                  x1={x}
                                  y1={0}
                                  x2={x}
                                  y2={ROW_H}
                                  stroke={pt.color}
                                  strokeWidth={2}
                                  opacity={0.75}
                                />
                              );
                            })}

                            {/* Incoming upper-half connections */}
                            {layout.incomingLines.map((seg, si) => {
                              const x1 = seg.fromCol * LANE_STEP + 9;
                              const x2 = seg.toCol * LANE_STEP + 9;
                              const midY = ROW_H / 2;
                              return x1 === x2 ? (
                                <line
                                  key={`in-${si}`}
                                  x1={x1}
                                  y1={0}
                                  x2={x2}
                                  y2={midY}
                                  stroke={seg.color}
                                  strokeWidth={2}
                                />
                              ) : (
                                <path
                                  key={`in-${si}`}
                                  d={`M ${x1} 0 C ${x1} ${midY * 0.55}, ${x2} ${midY * 0.45}, ${x2} ${midY}`}
                                  fill="none"
                                  stroke={seg.color}
                                  strokeWidth={2}
                                />
                              );
                            })}

                            {/* Outgoing lower-half connections */}
                            {layout.outgoingLines.map((seg, si) => {
                              const x1 = seg.fromCol * LANE_STEP + 9;
                              const x2 = seg.toCol * LANE_STEP + 9;
                              const midY = ROW_H / 2;
                              return x1 === x2 ? (
                                <line
                                  key={`out-${si}`}
                                  x1={x1}
                                  y1={midY}
                                  x2={x2}
                                  y2={ROW_H}
                                  stroke={seg.color}
                                  strokeWidth={2}
                                />
                              ) : (
                                <path
                                  key={`out-${si}`}
                                  d={`M ${x1} ${midY} C ${x1} ${midY + (ROW_H - midY) * 0.55}, ${x2} ${midY + (ROW_H - midY) * 0.45}, ${x2} ${ROW_H}`}
                                  fill="none"
                                  stroke={seg.color}
                                  strokeWidth={2}
                                />
                              );
                            })}

                            {/* Commit Node */}
                            <circle
                              cx={layout.col * LANE_STEP + 9}
                              cy={ROW_H / 2}
                              r={isSelected ? 4.5 : 3.8}
                              fill={layout.color}
                              stroke="var(--card)"
                              strokeWidth={1.6}
                            />
                          </svg>
                        </div>
                      )}

                      {/* Refs + Commit Message */}
                      <div className="flex-1 min-w-0 flex items-center gap-1.5 pr-3">
                        {refList.map((r, ri) => {
                          const badgeCls =
                            r.kind === 'head'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                              : r.kind === 'detached'
                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40'
                                : r.kind === 'tag'
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40'
                                  : r.kind === 'remote'
                                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/40'
                                    : 'bg-primary/15 text-primary border-primary/35';

                          return (
                            <span
                              key={`${r.label}-${ri}`}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (r.target) {
                                  handleCheckoutTarget(r.target, r.label, false);
                                }
                              }}
                              title={r.target ? `双击检出 ${r.label}` : r.label}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono font-medium flex-shrink-0 ${badgeCls}`}
                            >
                              {r.kind === 'tag' ? (
                                <Tag className="w-2.5 h-2.5" />
                              ) : (
                                <GitBranch className="w-2.5 h-2.5" />
                              )}
                              <span>{r.label}</span>
                            </span>
                          );
                        })}

                        <span className="truncate text-text-primary">{commit.message}</span>
                      </div>

                      <div className="w-28 flex-shrink-0 hidden sm:block pr-2 text-[11px] text-text-secondary truncate">
                        {commit.author}
                      </div>

                      <div className="w-16 flex-shrink-0 hidden md:block pr-2 font-mono text-[11px] text-text-tertiary">
                        {commit.hash.slice(0, 7)}
                      </div>

                      <div className="w-20 flex-shrink-0 text-right font-mono text-[11px] text-text-tertiary">
                        {commit.date}
                      </div>
                    </div>
                  );
                })}

                {!isFiltering && commits.length >= limit && (
                  <div className="p-3 flex justify-center border-t border-border-primary/40">
                    <button
                      type="button"
                      onClick={() => {
                        const next = limit + PAGE_STEP;
                        setLimit(next);
                        loadGraphData(next, true);
                      }}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-border-primary bg-background-secondary hover:bg-background-tertiary text-xs text-text-primary cursor-pointer"
                    >
                      {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{loadingMore ? '加载中...' : `加载更多提交 (+${PAGE_STEP})`}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: Resizable Commit Inspector */}
        {selectedCommit && (
          <div
            style={{ width: detailWidth }}
            className="flex-shrink-0 border-l border-border-primary bg-background-secondary/40 flex flex-col relative overflow-hidden"
          >
            {/* Drag Handle */}
            <div
              onMouseDown={handleResizeMouseDown}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
            />

            {/* Full Commit Detail Header */}
            <div className="p-3 border-b border-border-primary space-y-2 flex-shrink-0 bg-background-secondary/70">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <GitCommit className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span className="font-mono text-xs font-semibold text-text-primary truncate select-text">
                    {selectedCommit.hash}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => copyToClipboard(selectedCommit.hash, e)}
                  title="复制完整 Hash"
                  className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-background-tertiary cursor-pointer flex-shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="max-h-24 overflow-y-auto scrollbar-thin text-xs text-text-primary leading-relaxed whitespace-pre-wrap break-words select-text bg-background-primary/70 border border-border-primary rounded-lg p-2">
                {selectedCommit.message}
              </div>

              <div className="text-[11px] text-text-secondary space-y-1">
                <div className="truncate select-text">
                  作者：<span className="text-text-primary font-medium">{selectedCommit.author}</span>{' '}
                  <span className="text-text-tertiary">&lt;{selectedCommit.email}&gt;</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>日期：{selectedCommit.date}</span>
                  {selectedCommit.parents.length > 0 && (
                    <span className="flex items-center gap-1 font-mono text-[10px]">
                      <span className="text-text-tertiary">父提交:</span>
                      {selectedCommit.parents.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            if (commits.some((c) => c.hash === p)) {
                              setSelectedCommitHash(p);
                            } else {
                              toast.info('父提交尚未加载到当前视图', p.slice(0, 7));
                            }
                          }}
                          className="px-1 py-0.5 rounded bg-background-primary border border-border-primary text-primary hover:underline cursor-pointer"
                        >
                          {p.slice(0, 7)}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Changed Files Tree/List */}
            <div className="px-3 py-1.5 border-b border-border-primary flex items-center justify-between text-xs bg-background-secondary/50 flex-shrink-0">
              <span className="font-medium text-text-primary">
                变更文件 ({commitFiles.length})
              </span>
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

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-2 space-y-0.5">
              {loadingFiles ? (
                <div className="flex items-center justify-center h-full text-xs text-text-secondary gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>正在读取变更清单...</span>
                </div>
              ) : commitFiles.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
                  此提交无文件改动
                </div>
              ) : treeMode ? (
                renderFileTree(treeRoot)
              ) : (
                commitFiles.map((file) => (
                  <button
                    key={`${file.status}-${file.path}`}
                    type="button"
                    onClick={() => handleOpenFileDiff(file)}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-primary hover:bg-background-tertiary rounded transition-colors cursor-pointer group"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                      <span className="font-mono text-[11px] truncate group-hover:underline">
                        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                      </span>
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${statusBadgeStyle(file.status)}`}>
                      {file.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Commit Right-Click Context Menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          role="menu"
          className={`fixed z-[10050] min-w-[220px] bg-card text-text-primary border border-border-primary rounded-xl shadow-2xl py-1.5 text-xs select-none transition-opacity duration-75 ${
            ctxMenuPos.ready ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ left: ctxMenuPos.left, top: ctxMenuPos.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              copyToClipboard(ctxMenu.commit.hash, e);
              setCtxMenu(null);
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-text-secondary" />
            <span>复制完整 Hash ({ctxMenu.commit.hash.slice(0, 7)})</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              copyToClipboard(ctxMenu.commit.message, e);
              setCtxMenu(null);
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-text-secondary" />
            <span>复制提交说明</span>
          </button>

          <hr className="my-1 border-0 border-t border-border-primary" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = ctxMenu.commit;
              setCtxMenu(null);
              setBranchModal({ open: true, commit: target, name: '', checkout: true });
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>从此提交新建分支...</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = ctxMenu.commit;
              setCtxMenu(null);
              setTagModal({ open: true, commit: target, name: '', message: '', force: false });
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
          >
            <Tag className="w-3.5 h-3.5 text-amber-500" />
            <span>在此提交创建标签 (Tag)...</span>
          </button>

          <hr className="my-1 border-0 border-t border-border-primary" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = ctxMenu.commit;
              setCtxMenu(null);
              handleCheckoutTarget(target.hash, target.hash.slice(0, 7), true);
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            <span>检出此提交 (Checkout)...</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = ctxMenu.commit;
              setCtxMenu(null);
              handleCherryPick(target);
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
          >
            <GitPullRequest className="w-3.5 h-3.5 text-sky-500" />
            <span>遴选此提交 (Cherry-pick)...</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = ctxMenu.commit;
              setCtxMenu(null);
              handleRevertCommit(target);
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5 text-amber-500" />
            <span>回退此提交 (Revert)...</span>
          </button>

          <hr className="my-1 border-0 border-t border-border-primary" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = ctxMenu.commit;
              setCtxMenu(null);
              setResetModal({ open: true, commit: target, mode: 'mixed' });
            }}
            className="w-full text-left px-3.5 py-1.5 text-functional-error hover:bg-functional-error/10 flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置当前分支到此提交 (Reset)...</span>
          </button>
        </div>
      )}

      {/* Create Branch Modal */}
      <ModalDialog
        isOpen={branchModal.open}
        onClose={() => setBranchModal({ open: false, commit: null, name: '', checkout: true })}
        size="sm"
        title="从提交新建分支"
        subtitle={branchModal.commit ? `基点: ${branchModal.commit.hash.slice(0, 7)}` : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() => setBranchModal({ open: false, commit: null, name: '', checkout: true })}
              className="px-3.5 py-1.5 rounded-lg text-xs text-text-secondary bg-background-tertiary border border-border-primary cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submitCreateBranch}
              disabled={!branchModal.name.trim() || submittingAction}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary hover:bg-primary/90 disabled:opacity-45 text-white cursor-pointer"
            >
              创建分支
            </button>
          </>
        }
      >
        <div className="p-4 space-y-3 text-xs">
          <input
            type="text"
            autoFocus
            value={branchModal.name}
            onChange={(e) => setBranchModal((p) => ({ ...p, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreateBranch();
            }}
            placeholder="输入新分支名称"
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 font-mono text-text-primary focus:outline-none focus:border-primary"
          />
          <label className="flex items-center gap-2 text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={branchModal.checkout}
              onChange={(e) => setBranchModal((p) => ({ ...p, checkout: e.target.checked }))}
              className="rounded border-border-primary text-primary"
            />
            <span>创建后立即检出 (Checkout)</span>
          </label>
        </div>
      </ModalDialog>

      {/* Create Tag Modal */}
      <ModalDialog
        isOpen={tagModal.open}
        onClose={() =>
          setTagModal({ open: false, commit: null, name: '', message: '', force: false })
        }
        size="sm"
        title="在提交处创建标签"
        subtitle={tagModal.commit ? `提交: ${tagModal.commit.hash.slice(0, 7)}` : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() =>
                setTagModal({ open: false, commit: null, name: '', message: '', force: false })
              }
              className="px-3.5 py-1.5 rounded-lg text-xs text-text-secondary bg-background-tertiary border border-border-primary cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submitCreateTag}
              disabled={!tagModal.name.trim() || submittingAction}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-45 text-white cursor-pointer"
            >
              创建标签
            </button>
          </>
        }
      >
        <div className="p-4 space-y-3 text-xs">
          <input
            type="text"
            autoFocus
            value={tagModal.name}
            onChange={(e) => setTagModal((p) => ({ ...p, name: e.target.value }))}
            placeholder="标签名，如 v1.0.0"
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 font-mono text-text-primary focus:outline-none focus:border-primary"
          />
          <input
            type="text"
            value={tagModal.message}
            onChange={(e) => setTagModal((p) => ({ ...p, message: e.target.value }))}
            placeholder="附注说明（可选）"
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-text-primary focus:outline-none focus:border-primary"
          />
          <label className="flex items-center gap-2 text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={tagModal.force}
              onChange={(e) => setTagModal((p) => ({ ...p, force: e.target.checked }))}
              className="rounded border-border-primary text-amber-500"
            />
            <span>覆盖已有同名标签 (-f)</span>
          </label>
        </div>
      </ModalDialog>

      {/* Reset Mode Modal */}
      <ModalDialog
        isOpen={resetModal.open}
        onClose={() => setResetModal({ open: false, commit: null, mode: 'mixed' })}
        size="md"
        title="重置当前分支 (Git Reset)"
        subtitle={
          resetModal.commit
            ? `目标提交: ${resetModal.commit.hash.slice(0, 7)} — ${resetModal.commit.message}`
            : undefined
        }
        icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetModal({ open: false, commit: null, mode: 'mixed' })}
              className="px-3.5 py-1.5 rounded-lg text-xs text-text-secondary bg-background-tertiary border border-border-primary cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submitReset}
              disabled={submittingAction}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer disabled:opacity-45 ${
                resetModal.mode === 'hard'
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-primary hover:bg-primary/90'
              }`}
            >
              执行 Reset (--{resetModal.mode})
            </button>
          </>
        }
      >
        <div className="p-4 space-y-2.5 text-xs">
          {(
            [
              {
                mode: 'soft',
                title: 'Soft Reset (--soft)',
                desc: '仅移动分支指针，原提交后的变更内容保留在「暂存区 (Index)」和工作区。',
              },
              {
                mode: 'mixed',
                title: 'Mixed Reset (--mixed，默认)',
                desc: '移动分支指针并重置暂存区，原变更内容保留在「工作区」等待重新挑选提交。',
              },
              {
                mode: 'hard',
                title: 'Hard Reset (--hard，高风险)',
                desc: '彻底重置指针、暂存区与工作区——自该提交之后的所有本地改动都将永久丢失！',
              },
            ] as const
          ).map((item) => (
            <label
              key={item.mode}
              className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                resetModal.mode === item.mode
                  ? item.mode === 'hard'
                    ? 'border-rose-500 bg-rose-500/10'
                    : 'border-primary bg-primary/10'
                  : 'border-border-primary bg-background-secondary/50 hover:bg-background-tertiary/70'
              }`}
            >
              <input
                type="radio"
                name="reset-mode"
                checked={resetModal.mode === item.mode}
                onChange={() => setResetModal((p) => ({ ...p, mode: item.mode }))}
                className="mt-0.5 text-primary focus:ring-primary"
              />
              <div>
                <div
                  className={`font-medium ${
                    item.mode === 'hard' ? 'text-rose-600 dark:text-rose-400' : 'text-text-primary'
                  }`}
                >
                  {item.title}
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5">{item.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </ModalDialog>
    </div>
  );
};

export default GitGraphTab;
