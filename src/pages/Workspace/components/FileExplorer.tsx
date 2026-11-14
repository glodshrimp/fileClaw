import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, createContext, useContext, startTransition } from 'react';
import { useWorkspaceStore } from '../../../contexts/useWorkspaceStore';
import {
  Folder,
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  X,
  RotateCw,
  Settings,
  Loader2,
  FolderClosed,
  Terminal,
  FileText,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Copy,
  Clipboard,
  Edit3,
  Paperclip,
  GitBranch,
  GitCommit,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  PlusCircle,
  MinusCircle,
  RotateCcw,
  Archive,
  History,
  GitFork,
  Link2,
  Trash2,
  Diff,
} from 'lucide-react';
import DeleteConfirmModal from '../../../components/DeleteConfirmModal';
import { copyToClipboard } from '../../../utils/copy';
import { getFileIcon as getFileIconUtil, getFolderIcon } from '../../../utils/fileIcon';
import {
  findGitRootForPath,
  getProjectRootPath,
  getRelativePathInRepo,
  getRevealInFolderLabel,
  isPathEqualOrInside,
  normalizePath,
} from '../../../utils/path';
import { useApp } from '../../../contexts/AppContext';
import { toast } from '../../../contexts/useToastStore';
import { confirmDialog } from '../../../components/ui/ModalDialog';
import { parseGitError } from '../../../utils/gitError';
import { CommitDialog } from './git/CommitDialog';
import { BranchesDialog } from './git/BranchesDialog';
import { RemotesDialog } from './git/RemotesDialog';
import { StashDialog } from './git/StashDialog';
import { HistoryDialog } from './git/HistoryDialog';
import { RollbackDialog } from './git/RollbackDialog';
import { PushDialog } from './git/PushDialog';
import { PullDialog } from './git/PullDialog';

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  ctime: number;
  path: string;
}

type GitModalType = 'commit' | 'branches' | 'remotes' | 'stash' | 'history' | 'rollback' | 'push' | 'pull';

interface ActiveGitModalState {
  type: GitModalType;
  path: string;
  repoPath: string;
  targetPaths: string[];
  isDir: boolean;
}

interface ActionContextType {
  openContextMenu: (e: React.MouseEvent, path: string, name: string, isDir: boolean) => void;
  openGitModal: (type: GitModalType, path: string) => void;
  openDeleteModal: (path: string, name: string, isDir: boolean) => void;
  getDirChildren: (dirPath: string, force?: boolean) => Promise<FileEntry[]>;
  startCreating: (parentPath: string, type: 'file' | 'folder') => void;
  creatingTarget: { path: string; type: 'file' | 'folder' } | null;
  cancelCreating: () => void;
  reloadDir: (dirPath: string) => void;
}

const FileExplorerActionContext = createContext<ActionContextType | null>(null);

/** Number of child nodes mounted per animation frame during batch rendering. */
const CHILDREN_BATCH_SIZE = 50;

interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  badge?: string;
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
  onClick?: (e: React.SyntheticEvent) => void | Promise<void>;
  children?: MenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

interface SubmenuPanelProps {
  anchorEl: HTMLElement | null;
  items: MenuItem[];
  onCloseAll: () => void;
  onMouseEnterPanel: () => void;
  onMouseLeavePanel: () => void;
}

const SubmenuPanel: React.FC<SubmenuPanelProps> = ({
  anchorEl,
  items,
  onCloseAll,
  onMouseEnterPanel,
  onMouseLeavePanel,
}) => {
  const subRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ left: 0, top: 0, ready: false });

  useLayoutEffect(() => {
    const sub = subRef.current;
    if (!sub || !anchorEl) return;

    const anchorRect = anchorEl.getBoundingClientRect();
    const subRect = sub.getBoundingClientRect();
    const pad = 8;

    let left = anchorRect.right - 2;
    if (left + subRect.width > window.innerWidth - pad) {
      left = Math.max(pad, anchorRect.left - subRect.width + 2);
    }

    let top = anchorRect.top - 4;
    if (top + subRect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - subRect.height - pad);
    }

    setCoords({ left, top, ready: true });
  }, [anchorEl, items.length]);

  return (
    <div
      ref={subRef}
      role="menu"
      onMouseEnter={onMouseEnterPanel}
      onMouseLeave={onMouseLeavePanel}
      className={`fixed z-[10000] bg-card text-text-primary rounded-xl shadow-2xl border border-border-primary py-1.5 min-w-[225px] max-h-[calc(100vh-16px)] overflow-y-auto scrollbar-thin select-none transition-opacity duration-75 ${
        coords.ready ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: coords.left, top: coords.top }}
    >
      {items.map((sub, si) =>
        sub.divider ? (
          <hr key={si} className="my-1 border-0 border-t border-border-primary" />
        ) : (
          <button
            key={si}
            type="button"
            role="menuitem"
            disabled={sub.disabled}
            onClick={(e) => {
              if (sub.disabled) return;
              e.stopPropagation();
              sub.onClick?.(e);
              onCloseAll();
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-3 cursor-pointer ${
              sub.disabled
                ? 'text-text-tertiary/60 cursor-not-allowed opacity-50'
                : sub.danger
                  ? 'text-functional-error hover:bg-functional-error/10'
                  : 'text-text-primary hover:bg-background-tertiary'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-80" aria-hidden="true">
                {sub.icon}
              </span>
              <span className="truncate">{sub.label}</span>
            </span>
            {sub.badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-background-secondary text-text-secondary border border-border-primary flex-shrink-0">
                {sub.badge}
              </span>
            )}
          </button>
        )
      )}
    </div>
  );
};

const FileExplorerContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const hoverTimerRef = useRef<number | null>(null);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [coords, setCoords] = useState({ left: x, top: y });
  const [isPositioned, setIsPositioned] = useState(false);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  useEffect(() => {
    ref.current?.focus();
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [onClose]);

  useLayoutEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const pad = 8;
      const newLeft = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad));
      const newTop = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad));
      setCoords({ left: newLeft, top: newTop });
      setIsPositioned(true);
    }
  }, [x, y, items.length]);

  const scheduleCloseSubmenu = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setActiveSubmenuIndex(null);
    }, 160);
  }, [clearHoverTimer]);

  const actionableIndices = useMemo(
    () => items.map((it, idx) => (!it.divider && !it.disabled ? idx : -1)).filter((idx) => idx !== -1),
    [items]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (activeSubmenuIndex !== null) {
        setActiveSubmenuIndex(null);
      } else {
        onClose();
      }
      return;
    }

    if (e.key === 'ArrowLeft' && activeSubmenuIndex !== null) {
      e.preventDefault();
      setActiveSubmenuIndex(null);
      return;
    }

    if (actionableIndices.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const curPos = actionableIndices.indexOf(focusedIndex);
      const next = actionableIndices[(curPos + 1) % actionableIndices.length];
      setFocusedIndex(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const curPos = actionableIndices.indexOf(focusedIndex);
      const prev = actionableIndices[(curPos - 1 + actionableIndices.length) % actionableIndices.length];
      setFocusedIndex(prev);
    } else if ((e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') && focusedIndex >= 0) {
      const item = items[focusedIndex];
      if (!item || item.disabled || item.divider) return;
      e.preventDefault();
      if (item.children?.length) {
        setActiveSubmenuIndex(focusedIndex);
      } else if (e.key !== 'ArrowRight') {
        item.onClick?.(e);
        onClose();
      }
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseLeave={scheduleCloseSubmenu}
      className={`fixed z-[9999] bg-card text-text-primary rounded-xl shadow-2xl border border-border-primary py-1.5 min-w-[215px] max-h-[calc(100vh-16px)] overflow-y-auto scrollbar-thin select-none outline-none transition-opacity duration-75 ${
        isPositioned ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: coords.left, top: coords.top }}
    >
      {items.map((it, i) => {
        if (it.divider) {
          return <hr key={i} className="my-1 border-0 border-t border-border-primary" />;
        }

        const hasChildren = !!it.children?.length;
        const isHighlighted = focusedIndex === i || activeSubmenuIndex === i;

        return (
          <div
            key={i}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            className="relative"
            onMouseEnter={() => {
              setFocusedIndex(i);
              clearHoverTimer();
              if (it.disabled) {
                scheduleCloseSubmenu();
                return;
              }
              if (hasChildren) {
                setActiveSubmenuIndex(i);
              } else {
                scheduleCloseSubmenu();
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup={hasChildren ? 'menu' : undefined}
              aria-expanded={hasChildren ? activeSubmenuIndex === i : undefined}
              disabled={it.disabled}
              onClick={(e) => {
                if (it.disabled) return;
                if (hasChildren) {
                  e.stopPropagation();
                  clearHoverTimer();
                  setActiveSubmenuIndex((prev) => (prev === i ? null : i));
                } else {
                  e.stopPropagation();
                  it.onClick?.(e);
                  onClose();
                }
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                it.disabled
                  ? 'text-text-tertiary/60 cursor-not-allowed opacity-50'
                  : it.danger
                    ? 'text-functional-error hover:bg-functional-error/10'
                    : isHighlighted
                      ? 'bg-background-tertiary text-text-primary'
                      : 'text-text-primary hover:bg-background-tertiary'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-80" aria-hidden="true">
                  {it.icon}
                </span>
                <span className="truncate">{it.label}</span>
              </span>
              <span className="flex items-center gap-1.5 flex-shrink-0" aria-hidden="true">
                {it.badge && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                    {it.badge}
                  </span>
                )}
                {it.shortcut && (
                  <span className="text-[10px] text-text-tertiary font-mono">{it.shortcut}</span>
                )}
                {hasChildren && <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />}
              </span>
            </button>

            {hasChildren && activeSubmenuIndex === i && (
              <SubmenuPanel
                anchorEl={rowRefs.current[i]}
                items={it.children!}
                onCloseAll={onClose}
                onMouseEnterPanel={clearHoverTimer}
                onMouseLeavePanel={scheduleCloseSubmenu}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

const isValidFileName = (name: string): boolean => {
  if (!name || !name.trim()) return false;
  return !/[\\/:*?"<>|]/.test(name.trim());
};

const getUniqueDestPath = async (srcPath: string, destDir: string): Promise<string> => {
  const normSrc = normalizePath(srcPath);
  const normDest = normalizePath(destDir);
  const fileName = normSrc.substring(normSrc.lastIndexOf('/') + 1);
  
  let existingFiles: string[] = [];
  try {
    const list = await window.electronAPI.localListDir(normDest);
    existingFiles = list.map((f: any) => f.name.toLowerCase());
  } catch (err) {
    console.error('Failed to list destination directory:', err);
  }

  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex === -1 ? fileName : fileName.substring(0, dotIndex);
  const ext = dotIndex === -1 ? '' : fileName.substring(dotIndex);

  let candidateName = fileName;
  let counter = 0;
  
  while (existingFiles.includes(candidateName.toLowerCase())) {
    counter++;
    candidateName = counter === 1 ? `${baseName}_copy${ext}` : `${baseName}_copy_${counter}${ext}`;
  }

  return `${normDest}/${candidateName}`;
};

interface FlatTreeItem {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  isEmptyPlaceholder?: boolean;
  isCreatingPlaceholder?: boolean;
  creatingType?: 'file' | 'folder';
  isRenamingPlaceholder?: boolean;
  isMorePlaceholder?: boolean;
}

interface GitBadgeInfo {
  label: string;
  colorClass: string;
  title: string;
  isFolderDot?: boolean;
}

interface FileNodeRowProps {
  item: FlatTreeItem;
  isSelected: boolean;
  isExpanded: boolean;
  statusColorClass: string;
  gitBadge: GitBadgeInfo | null;
  isLoading: boolean;
  onRowClick: (e: React.MouseEvent, path: string, name: string, isDir: boolean) => void;
  onContextMenu: (e: React.MouseEvent, path: string, name: string, isDir: boolean) => void;
  onQuickAction: (e: React.MouseEvent, path: string, type: 'file' | 'folder') => void;
  onCreateSubmit: (name: string, parentPath: string, type: 'file' | 'folder') => void;
  onCancelCreating: () => void;
  onRenameSubmit: (oldPath: string, newName: string) => void;
  onCancelRenaming: () => void;
  onLoadAllChildren: (path: string) => void;
}

const FileNodeRow = React.memo<FileNodeRowProps>(({
  item,
  isSelected,
  isExpanded,
  statusColorClass,
  gitBadge,
  isLoading,
  onRowClick,
  onContextMenu,
  onQuickAction,
  onCreateSubmit,
  onCancelCreating,
  onRenameSubmit,
  onCancelRenaming,
  onLoadAllChildren,
}) => {
  const { name, path, isDir, depth, isEmptyPlaceholder, isCreatingPlaceholder, creatingType, isRenamingPlaceholder, isMorePlaceholder } = item;
  const [newItemName, setNewItemName] = useState('');
  const [renameInput, setRenameInput] = useState(name);
  const isCreatingSubmittedRef = useRef(false);
  const isRenamingSubmittedRef = useRef(false);

  if (isEmptyPlaceholder) {
    return (
      <div 
        className="text-[10px] text-slate-500 italic h-6 flex items-center select-none" 
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        空目录
      </div>
    );
  }

  if (isMorePlaceholder) {
    const parentPath = path.substring(0, path.lastIndexOf('/::more::'));
    return (
      <div 
        onClick={() => onLoadAllChildren(parentPath)}
        className="text-[10px] text-primary hover:underline italic h-6 flex items-center cursor-pointer select-none" 
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {name}
      </div>
    );
  }

  if (isRenamingPlaceholder) {
    const submitRename = () => {
      if (isRenamingSubmittedRef.current) return;
      isRenamingSubmittedRef.current = true;
      const trimmed = renameInput.trim();
      if (trimmed && trimmed !== name && isValidFileName(trimmed)) {
        onRenameSubmit(path, trimmed);
      } else {
        onCancelRenaming();
      }
    };

    return (
      <form 
        onSubmit={(e) => {
          e.preventDefault();
          submitRename();
        }} 
        className="flex items-center space-x-1 h-6 pr-2 select-none" 
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <input
          type="text"
          autoFocus
          value={renameInput}
          onChange={(e) => setRenameInput(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              isRenamingSubmittedRef.current = true;
              onCancelRenaming();
            }
          }}
          className="bg-slate-950 border border-primary rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none flex-1 font-mono"
        />
      </form>
    );
  }

  if (isCreatingPlaceholder && creatingType) {
    const parentPath = path.substring(0, path.lastIndexOf('/::creating::'));
    const submitCreate = () => {
      if (isCreatingSubmittedRef.current) return;
      isCreatingSubmittedRef.current = true;
      const trimmed = newItemName.trim();
      if (trimmed && isValidFileName(trimmed)) {
        onCreateSubmit(trimmed, parentPath, creatingType);
        setNewItemName('');
      } else {
        onCancelCreating();
      }
    };

    return (
      <form 
        onSubmit={(e) => {
          e.preventDefault();
          submitCreate();
        }} 
        className="flex items-center space-x-1 h-6 pr-2 select-none" 
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <input
          type="text"
          autoFocus
          placeholder={creatingType === 'file' ? '文件名...' : '文件夹名...'}
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          onBlur={submitCreate}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              isCreatingSubmittedRef.current = true;
              onCancelCreating();
            }
          }}
          className="bg-slate-950 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-primary flex-1 font-mono"
        />
      </form>
    );
  }

  const handleRowClick = (e: React.MouseEvent) => {
    onRowClick(e, path, name, isDir);
  };

  return (
    <div
      data-file-path={path}
      className={`group flex items-center justify-between h-6 px-2 hover:bg-background-secondary/85 text-text-primary rounded cursor-pointer transition-colors text-[11px] select-none ${
        isSelected ? 'bg-primary/20 border-l-2 border-primary pl-[6px]' : ''
      }`}
      style={{ paddingLeft: `${depth * 12 + (isSelected ? 6 : 8)}px` }}
      onClick={handleRowClick}
      onContextMenu={(e) => onContextMenu(e, path, name, isDir)}
    >
      <div className="flex items-center space-x-1.5 min-w-0 flex-1">
        {isDir ? (
          <>
            {isExpanded ? <ChevronDown className="w-3 h-3 text-text-tertiary" /> : <ChevronRight className="w-3 h-3 text-text-tertiary" />}
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-text-tertiary flex-shrink-0" />
            ) : (
              getFolderIcon(name, isExpanded)
            )}
          </>
        ) : (
          getFileIconUtil(name)
        )}
        <span className={`truncate ${statusColorClass || (isSelected ? 'text-primary font-medium' : 'text-text-secondary group-hover:text-text-primary')}`}>
          {name}
        </span>
      </div>

      <div className="flex items-center space-x-1.5 flex-shrink-0 pl-1">
        {gitBadge && (
          <span
            title={gitBadge.title}
            className={`${
              gitBadge.isFolderDot
                ? `w-1.5 h-1.5 rounded-full ${gitBadge.colorClass}`
                : `text-[9px] font-mono font-bold px-1 rounded ${gitBadge.colorClass}`
            } ${isDir ? 'group-hover:hidden' : ''}`}
          >
            {gitBadge.isFolderDot ? '' : gitBadge.label}
          </span>
        )}

        {isDir && (
          <div className="hidden group-hover:flex items-center space-x-1">
            <button
              onClick={(e) => onQuickAction(e, path, 'file')}
              className="p-0.5 hover:bg-background-secondary rounded text-text-tertiary hover:text-text-primary"
              title="新建文件"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => onQuickAction(e, path, 'folder')}
              className="p-0.5 hover:bg-background-secondary rounded text-text-tertiary hover:text-text-primary"
              title="新建文件夹"
            >
              <Folder className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const getStatusColorClass = (
  name: string,
  path: string,
  isDir: boolean,
  gitFileStatuses: Record<string, string>,
  gitDirtyFolders: Record<string, any>
): string => {
  const isCommonIgnored =
    name === 'node_modules' ||
    name === 'target' ||
    name === 'dist' ||
    name === 'build' ||
    name.startsWith('.');

  if (isDir) {
    const folderStatus = gitDirtyFolders[path];
    if (folderStatus) {
      if (folderStatus.notAdded) return 'text-rose-600 dark:text-rose-400';
      if (folderStatus.modified) return 'text-sky-600 dark:text-sky-400';
      if (folderStatus.added) return 'text-emerald-600 dark:text-emerald-400';
      if (folderStatus.untracked) return 'text-amber-600 dark:text-amber-400';
    }
    if (isCommonIgnored) return 'text-text-tertiary';
  } else {
    const statusXY = gitFileStatuses[path];
    if (statusXY) {
      if (statusXY === '??' || statusXY === '?') return 'text-amber-600 dark:text-amber-400';
      if (statusXY === '!!') return 'text-text-tertiary';
      if (statusXY.includes('D')) return 'text-rose-600 dark:text-rose-400 line-through';

      const X = statusXY[0];
      const Y = statusXY[1];
      if (Y === 'M') return 'text-rose-600 dark:text-rose-400';
      if (X === 'M') return 'text-sky-600 dark:text-sky-400';
      if (X === 'A' || X === 'R') return 'text-emerald-600 dark:text-emerald-400';
    }
    if (isCommonIgnored) return 'text-text-tertiary';
  }
  return '';
};

const getGitBadgeInfo = (
  path: string,
  isDir: boolean,
  gitFileStatuses: Record<string, string>,
  gitDirtyFolders: Record<string, any>
): GitBadgeInfo | null => {
  if (isDir) {
    const folderStatus = gitDirtyFolders[path];
    if (!folderStatus) return null;
    if (folderStatus.notAdded) {
      return { label: '•', isFolderDot: true, colorClass: 'bg-rose-500', title: '包含未暂存修改' };
    }
    if (folderStatus.modified || folderStatus.added) {
      return { label: '•', isFolderDot: true, colorClass: 'bg-emerald-500', title: '包含已暂存更改' };
    }
    if (folderStatus.untracked) {
      return { label: '•', isFolderDot: true, colorClass: 'bg-amber-500', title: '包含未跟踪文件' };
    }
    return null;
  }

  const statusXY = gitFileStatuses[path];
  if (!statusXY) return null;
  if (statusXY === '??' || statusXY === '?') {
    return { label: 'U', colorClass: 'text-amber-600 dark:text-amber-400 bg-amber-500/10', title: '未跟踪文件 (Untracked)' };
  }
  if (statusXY.includes('D')) {
    return { label: 'D', colorClass: 'text-rose-600 dark:text-rose-400 bg-rose-500/10', title: '已删除 (Deleted)' };
  }
  if (statusXY[0] === 'R') {
    return { label: 'R', colorClass: 'text-purple-600 dark:text-purple-400 bg-purple-500/10', title: '已重命名 (Renamed)' };
  }
  if (statusXY[0] === 'A') {
    return { label: 'A', colorClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10', title: '已暂存新文件 (Added)' };
  }
  if (statusXY[1] === 'M') {
    return { label: 'M', colorClass: 'text-rose-600 dark:text-rose-400 bg-rose-500/10', title: '已修改（未暂存）' };
  }
  if (statusXY[0] === 'M') {
    return { label: 'M', colorClass: 'text-sky-600 dark:text-sky-400 bg-sky-500/10', title: '已修改（已暂存）' };
  }
  return { label: statusXY.trim() || '•', colorClass: 'text-text-secondary bg-background-secondary', title: `Git 状态: ${statusXY}` };
};

const LARGE_DIR_LIMIT = 200;

export const FileExplorer: React.FC = () => {
  const currentProject = useWorkspaceStore((s) => s.currentProject);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject);
  const { dispatch } = useApp();

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; path: string; isDir: boolean }>>([]);
  const [searching, setSearching] = useState(false);

  // Singleton Modals & Context Menu State
  const [activeCtxMenu, setActiveCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [activeDeleteTarget, setActiveDeleteTarget] = useState<{ path: string; name: string; isDir: boolean; selectedCount: number } | null>(null);
  const [activeGitModal, setActiveGitModal] = useState<ActiveGitModalState | null>(null);
  const [creatingTarget, setCreatingTarget] = useState<{ path: string; type: 'file' | 'folder' } | null>(null);
  const [renamingTarget, setRenamingTarget] = useState<{ path: string; name: string; isDir: boolean } | null>(null);

  // Zustand State subscriptions
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders);
  const selectedFilePaths = useWorkspaceStore((s) => s.selectedFilePaths);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const gitFileStatuses = useWorkspaceStore((s) => s.gitFileStatuses);
  const gitDirtyFolders = useWorkspaceStore((s) => s.gitDirtyFolders);
  const fileExplorerRefreshKey = useWorkspaceStore((s) => s.fileExplorerRefreshKey);
  const fileExplorerClearCacheKey = useWorkspaceStore((s) => s.fileExplorerClearCacheKey);

  const selectAndToggleFolder = useWorkspaceStore((s) => s.selectAndToggleFolder);
  const selectSingleFile = useWorkspaceStore((s) => s.selectSingleFile);
  const setSelectedFilePaths = useWorkspaceStore((s) => s.setSelectedFilePaths);
  const setLastSelectedFilePath = useWorkspaceStore((s) => s.setLastSelectedFilePath);
  const collapseAllFolders = useWorkspaceStore((s) => s.collapseAllFolders);

  // Directory Content Cache
  const dirCache = useRef<Map<string, FileEntry[]>>(new Map());
  const [fullyExpandedDirs, setFullyExpandedDirs] = useState<Record<string, boolean>>({});

  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);
  const refreshFileExplorerStore = useWorkspaceStore((s) => s.refreshFileExplorer);

  const clearDirCache = useCallback(() => {
    dirCache.current.clear();
    setFullyExpandedDirs({});
  }, []);

  useEffect(() => {
    if (fileExplorerClearCacheKey > 0) {
      clearDirCache();
      refreshFileExplorerStore();
    }
  }, [fileExplorerClearCacheKey, clearDirCache, refreshFileExplorerStore]);

  const getDirChildren = useCallback(async (dirPath: string, force = false): Promise<FileEntry[]> => {
    const normalized = normalizePath(dirPath);
    if (!force && dirCache.current.has(normalized)) {
      return dirCache.current.get(normalized)!;
    }
    const list = await window.electronAPI.localListDir(normalized);
    const entries: FileEntry[] = list.map((item: FileEntry) => ({
      name: item.name,
      isDir: item.isDir,
      path: normalizePath(item.path),
      size: item.size ?? 0,
      mtime: item.mtime ?? 0,
      ctime: item.ctime ?? 0,
    }));
    dirCache.current.set(normalized, entries);
    return entries;
  }, []);

  const reloadDir = useCallback(async (dirPath: string) => {
    dirCache.current.delete(dirPath);
    refreshFileExplorerStore();
  }, [refreshFileExplorerStore]);

  // Loading state of folders
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({});

  const loadFolderChildren = useCallback(async (dirPath: string) => {
    const normalized = normalizePath(dirPath);
    setLoadingFolders((prev) => ({ ...prev, [normalized]: true }));
    try {
      await getDirChildren(normalized, true);
    } catch (err) {
      console.error('Failed to load children in lazy loader:', err);
    } finally {
      setLoadingFolders((prev) => ({ ...prev, [normalized]: false }));
      refreshFileExplorerStore();
    }
  }, [getDirChildren, refreshFileExplorerStore]);

  const handleLoadAllChildren = useCallback((dirPath: string) => {
    setFullyExpandedDirs((prev) => ({ ...prev, [dirPath]: true }));
    refreshFileExplorerStore();
  }, [refreshFileExplorerStore]);

  // Build the flat list of visible items recursively
  const visibleItems = useMemo(() => {
    if (!currentProject) return [];
    const root = getProjectRootPath(currentProject);
    const items: FlatTreeItem[] = [];

    const traverse = (path: string, name: string, isDir: boolean, depth: number) => {
      const normalized = normalizePath(path);

      if (renamingTarget && renamingTarget.path === normalized) {
        items.push({
          name,
          path: normalized,
          isDir,
          depth,
          isRenamingPlaceholder: true,
        });
      } else {
        items.push({ name, path: normalized, isDir, depth });
      }

      if (isDir && expandedFolders[normalized]) {
        // Render creating input row first if active in this dir
        if (creatingTarget && creatingTarget.path === normalized) {
          items.push({
            name: '',
            path: `${normalized}/::creating::`,
            isDir: creatingTarget.type === 'folder',
            depth: depth + 1,
            isCreatingPlaceholder: true,
            creatingType: creatingTarget.type,
          });
        }

        const children = dirCache.current.get(normalized);
        if (children) {
          if (children.length === 0) {
            // Render Empty folder indicator row
            if (!creatingTarget || creatingTarget.path !== normalized) {
              items.push({
                name: '空目录',
                path: `${normalized}/::empty::`,
                isDir: false,
                depth: depth + 1,
                isEmptyPlaceholder: true,
              });
            }
          } else {
            const shouldTruncate = children.length > LARGE_DIR_LIMIT && !fullyExpandedDirs[normalized];
            const childrenToShow = shouldTruncate ? children.slice(0, LARGE_DIR_LIMIT) : children;

            for (const child of childrenToShow) {
              traverse(child.path, child.name, child.isDir, depth + 1);
            }

            if (shouldTruncate) {
              items.push({
                name: `显示前 ${LARGE_DIR_LIMIT} 项 (共 ${children.length} 项)，点击加载全部...`,
                path: `${normalized}/::more::`,
                isDir: false,
                depth: depth + 1,
                isEmptyPlaceholder: false,
                isMorePlaceholder: true,
              });
            }
          }
        }
      }
    };

    traverse(root, currentProject.name, true, 0);
    return items;
  }, [currentProject, expandedFolders, creatingTarget, renamingTarget, fullyExpandedDirs, fileExplorerRefreshKey]);

  // Reactive lazy loader for expanded directories
  useEffect(() => {
    visibleItems.forEach((item) => {
      if (item.isDir && expandedFolders[item.path]) {
        const hasCache = dirCache.current.has(item.path);
        const isLoading = loadingFolders[item.path];
        if (!hasCache && !isLoading) {
          loadFolderChildren(item.path);
        }
      }
    });
  }, [visibleItems, expandedFolders, loadingFolders, loadFolderChildren]);

  // Scroll measurement for custom Virtual Scroll list
  const ITEM_HEIGHT = 24;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(600);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  useEffect(() => {
    if (containerRef.current) {
      setMeasuredHeight(containerRef.current.clientHeight);
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setMeasuredHeight(entry.contentRect.height);
        }
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 5);
  const endIndex = Math.min(visibleItems.length, Math.ceil((scrollTop + measuredHeight) / ITEM_HEIGHT) + 5);
  const renderedItems = visibleItems.slice(startIndex, endIndex);

  // Row Interactions
  const handleRowClick = useCallback((e: React.MouseEvent, path: string, name: string, isDir: boolean) => {
    e.stopPropagation();

    const state = useWorkspaceStore.getState();

    if (e.shiftKey && state.lastSelectedFilePath) {
      const visiblePaths = visibleItems
        .filter(item => !item.isEmptyPlaceholder && !item.isCreatingPlaceholder && !item.isMorePlaceholder && !item.isRenamingPlaceholder)
        .map(item => item.path);
      const idxStart = visiblePaths.indexOf(state.lastSelectedFilePath);
      const idxEnd = visiblePaths.indexOf(path);
      
      if (idxStart !== -1 && idxEnd !== -1) {
        const min = Math.min(idxStart, idxEnd);
        const max = Math.max(idxStart, idxEnd);
        const rangePaths = visiblePaths.slice(min, max + 1);
        state.setSelectedFilePaths(rangePaths);
      }
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      if (state.selectedFilePaths.includes(path)) {
        state.setSelectedFilePaths(state.selectedFilePaths.filter(p => p !== path));
      } else {
        state.setSelectedFilePaths([...state.selectedFilePaths, path]);
      }
      state.setLastSelectedFilePath(path);
      return;
    }

    if (isDir) {
      state.selectAndToggleFolder(path);
    } else {
      state.selectSingleFile(path);
      state.openFile(path, name);
    }
  }, [visibleItems]);

  const handleQuickAction = useCallback((e: React.MouseEvent, path: string, type: 'file' | 'folder') => {
    e.stopPropagation();
    const state = useWorkspaceStore.getState();
    if (!state.expandedFolders[path]) {
      state.selectAndToggleFolder(path);
    }
    setCreatingTarget({ path, type });
  }, []);

  const handleCreateSubmit = useCallback(async (name: string, parentPath: string, type: 'file' | 'folder') => {
    try {
      const isCreateDir = type === 'folder';
      await window.electronAPI.localCreateNode(parentPath, name, isCreateDir);
      setCreatingTarget(null);
      
      dirCache.current.delete(parentPath);
      refreshFileExplorerStore();
      
      const state = useWorkspaceStore.getState();
      await state.refreshGitStatus();
    } catch (err: any) {
      toast.error('创建失败', parseGitError(err).summary);
    }
  }, [refreshFileExplorerStore]);

  const cancelCreating = useCallback(() => {
    setCreatingTarget(null);
  }, []);

  const handleRenameSubmit = useCallback(async (oldPath: string, newName: string) => {
    try {
      const normOld = normalizePath(oldPath);
      const parentPath = normOld.substring(0, normOld.lastIndexOf('/'));
      const newPath = `${parentPath}/${newName}`;

      const state = useWorkspaceStore.getState();
      await state.renameNode(normOld, newPath);
      setRenamingTarget(null);

      dirCache.current.delete(parentPath);
      refreshFileExplorerStore();
    } catch (err: any) {
      toast.error('重命名失败', parseGitError(err).summary);
    }
  }, [refreshFileExplorerStore]);

  const cancelRenaming = useCallback(() => {
    setRenamingTarget(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    const realItems = visibleItems.filter(item => !item.isEmptyPlaceholder && !item.isCreatingPlaceholder && !item.isMorePlaceholder && !item.isRenamingPlaceholder);
    if (realItems.length === 0) return;

    const state = useWorkspaceStore.getState();
    const currentSelected = state.selectedFilePaths[state.selectedFilePaths.length - 1] || state.lastSelectedFilePath;
    const currentIndex = realItems.findIndex(i => i.path === currentSelected);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = currentIndex < realItems.length - 1 ? currentIndex + 1 : 0;
      const nextItem = realItems[nextIdx];
      state.setSelectedFilePaths([nextItem.path]);
      state.setLastSelectedFilePath(nextItem.path);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = currentIndex > 0 ? currentIndex - 1 : realItems.length - 1;
      const prevItem = realItems[prevIdx];
      state.setSelectedFilePaths([prevItem.path]);
      state.setLastSelectedFilePath(prevItem.path);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (currentIndex !== -1) {
        const item = realItems[currentIndex];
        if (item.isDir) {
          if (!expandedFolders[item.path]) {
            state.selectAndToggleFolder(item.path);
          } else if (currentIndex < realItems.length - 1) {
            const nextItem = realItems[currentIndex + 1];
            if (nextItem.path.startsWith(item.path + '/')) {
              state.setSelectedFilePaths([nextItem.path]);
              state.setLastSelectedFilePath(nextItem.path);
            }
          }
        }
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (currentIndex !== -1) {
        const item = realItems[currentIndex];
        if (item.isDir && expandedFolders[item.path]) {
          state.selectAndToggleFolder(item.path);
        } else {
          const parentPath = item.path.substring(0, item.path.lastIndexOf('/'));
          const parentItem = realItems.find(i => i.path === parentPath);
          if (parentItem) {
            state.setSelectedFilePaths([parentItem.path]);
            state.setLastSelectedFilePath(parentItem.path);
          }
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentIndex !== -1) {
        const item = realItems[currentIndex];
        if (item.isDir) {
          state.selectAndToggleFolder(item.path);
        } else {
          state.selectSingleFile(item.path);
          state.openFile(item.path, item.name);
        }
      }
    } else if (e.key === 'F2') {
      e.preventDefault();
      if (currentIndex !== -1) {
        const item = realItems[currentIndex];
        setRenamingTarget({ path: item.path, name: item.name, isDir: item.isDir });
      }
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (currentIndex !== -1) {
        const item = realItems[currentIndex];
        const selectedCount = state.selectedFilePaths.includes(item.path) ? state.selectedFilePaths.length : 1;
        setActiveDeleteTarget({ path: item.path, name: item.name, isDir: item.isDir, selectedCount });
      }
    }
  };

  useEffect(() => {
    if (currentProject) {
      refreshGitStatus();
      
      let lastRefreshTime = Date.now();
      let timer: ReturnType<typeof setTimeout>;
      const handleFocus = () => {
        const now = Date.now();
        if (now - lastRefreshTime < 3000) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          lastRefreshTime = Date.now();
          refreshGitStatus();
        }, 500);
      };
      window.addEventListener('focus', handleFocus);
      return () => {
        window.removeEventListener('focus', handleFocus);
        clearTimeout(timer);
      };
    }
  }, [currentProject, refreshGitStatus]);

  useEffect(() => {
    if (!currentProject || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setSearching(true);
      try {
        const root = currentProject.codePath || currentProject.path;
        const results = await window.electronAPI.localSearchFiles(root, searchQuery.trim(), 100);
        setSearchResults(results || []);
      } catch (err) {
        console.error('Failed to search files in Rust backend:', err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, currentProject]);

  const openContextMenu = useCallback(async (e: React.MouseEvent, path: string, name: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    const state = useWorkspaceStore.getState();
    if (!state.selectedFilePaths.includes(path)) {
      state.setSelectedFilePaths([path]);
      state.setLastSelectedFilePath(path);
    }

    const activeSelected = state.selectedFilePaths.includes(path)
      ? state.selectedFilePaths
      : [path];

    let systemClipboardPath = '';
    try {
      systemClipboardPath = await window.electronAPI.localReadFileFromClipboard();
    } catch (err) {
      console.warn('Failed to read system clipboard file path:', err);
    }
    const canPaste = !!(systemClipboardPath || state.copiedFilePath);

    const rootPath = state.currentProject?.codePath || state.currentProject?.path || '';
    const gitRoots = state.gitRoots || [];
    const sortedRoots = [...gitRoots].sort((a, b) => normalizePath(b).length - normalizePath(a).length);
    const nodeGitRoot = sortedRoots.find((r) => isPathEqualOrInside(path, r)) || null;
    const isGitRepo = nodeGitRoot !== null;

    const selectedInRepo = nodeGitRoot
      ? activeSelected.filter((p) => isPathEqualOrInside(p, nodeGitRoot))
      : [path];

    const matchingStatusEntries = nodeGitRoot
      ? Object.entries(state.gitFileStatuses).filter(([absFile]) =>
          selectedInRepo.some((selPath) => isPathEqualOrInside(absFile, selPath))
        )
      : [];

    const canAdd = matchingStatusEntries.some(([, xy]) => {
      if (xy === '??' || xy === '?') return true;
      const y = xy[1] || ' ';
      return y === 'M' || y === 'D' || y === 'U';
    }) || (isDir && !!state.gitDirtyFolders[path]?.notAdded) || (isDir && !!state.gitDirtyFolders[path]?.untracked);

    const canUnstage = matchingStatusEntries.some(([, xy]) => {
      if (!xy || xy === '??' || xy === '?') return false;
      const x = xy[0] || ' ';
      return x === 'M' || x === 'A' || x === 'D' || x === 'R' || x === 'C';
    });

    const hasChanges =
      matchingStatusEntries.length > 0 ||
      selectedInRepo.some((sel) => !!state.gitDirtyFolders[sel] || !!state.gitFileStatuses[sel]);

    const singleFileStatusXY = !isDir && selectedInRepo.length === 1 ? state.gitFileStatuses[path] : undefined;
    const canQuickDiff =
      Boolean(nodeGitRoot && singleFileStatusXY && singleFileStatusXY !== '??' && singleFileStatusXY !== '?');

    const items: MenuItem[] = [];

    if (isDir) {
      items.push({
        label: '在终端中打开',
        icon: <Terminal className="w-3.5 h-3.5" />,
        onClick: () => state.openTerminal(path, name),
      });
    } else {
      items.push({
        label: '打开文件',
        icon: <FileText className="w-3.5 h-3.5" />,
        onClick: () => state.openFile(path, name),
      });
    }

    items.push(
      {
        label: getRevealInFolderLabel(),
        icon: <FolderOpen className="w-3.5 h-3.5" />,
        onClick: async () => {
          try {
            if (window.electronAPI?.revealInFolder) {
              await window.electronAPI.revealInFolder(path);
            } else {
              const parentDir = isDir
                ? path
                : path.substring(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || path;
              await window.electronAPI.openDirectory(parentDir);
            }
          } catch (err: any) {
            toast.error('打开系统文件管理器失败', parseGitError(err).summary);
          }
        },
      },
      { divider: true }
    );

    if (isDir) {
      items.push(
        {
          label: '新建文件',
          icon: <FilePlus className="w-3.5 h-3.5" />,
          onClick: () => {
            if (!state.expandedFolders[path]) {
              state.selectAndToggleFolder(path);
            }
            setCreatingTarget({ path, type: 'file' });
          },
        },
        {
          label: '新建文件夹',
          icon: <FolderPlus className="w-3.5 h-3.5" />,
          onClick: () => {
            if (!state.expandedFolders[path]) {
              state.selectAndToggleFolder(path);
            }
            setCreatingTarget({ path, type: 'folder' });
          },
        },
        { divider: true }
      );
    }

    items.push(
      {
        label: '重命名',
        icon: <Edit3 className="w-3.5 h-3.5" />,
        shortcut: 'F2',
        onClick: () => {
          setRenamingTarget({ path, name, isDir });
        },
      },
      {
        label: '复制完整路径',
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: (evt) => {
          const targetPaths = useWorkspaceStore.getState().selectedFilePaths;
          const out = targetPaths.includes(path) ? targetPaths : [path];
          copyToClipboard(out.join('\n'), evt as any);
        },
      },
      {
        label: '复制相对路径',
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: (evt) => {
          const targetPaths = useWorkspaceStore.getState().selectedFilePaths;
          const out = targetPaths.includes(path) ? targetPaths : [path];
          const relPaths = out.map((p) => getRelativePathInRepo(p, rootPath) || '.');
          copyToClipboard(relPaths.join('\n'), evt as any);
        },
      },
      { divider: true },
      {
        label: '复制文件',
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: async () => {
          try {
            await window.electronAPI.localWriteFileToClipboard(path);
          } catch (err: any) {
            console.error('Failed to copy file to system clipboard:', err);
          }
          state.setCopiedFilePath(path);
          toast.info('已复制文件路径', name);
        },
      },
      {
        label: '粘贴',
        icon: <Clipboard className="w-3.5 h-3.5" />,
        disabled: !canPaste,
        onClick: async () => {
          let sysClipPath = '';
          try {
            sysClipPath = await window.electronAPI.localReadFileFromClipboard();
          } catch (err) {
            console.warn('Failed to read system clipboard file path:', err);
          }

          const sourcePath = sysClipPath ? sysClipPath.trim() : state.copiedFilePath;

          if (!sourcePath) {
            toast.warning('剪贴板中无有效的文件复制记录');
            return;
          }

          const destDir = isDir
            ? path
            : path.substring(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));

          try {
            const finalDestPath = await getUniqueDestPath(sourcePath, destDir);
            const success = await window.electronAPI.localCopyFile(sourcePath, finalDestPath);
            if (success) {
              reloadDir(destDir);
              await state.refreshGitStatus();
              toast.success('粘贴成功');
            } else {
              toast.error('粘贴文件失败', '复制操作未成功完成');
            }
          } catch (err: any) {
            toast.error('粘贴文件失败', err?.message || String(err));
          }
        },
      },
      { divider: true }
    );

    if (!isDir) {
      items.push(
        {
          label: '关联到 AI 助手',
          icon: <Paperclip className="w-3.5 h-3.5" />,
          onClick: async (evt) => {
            try {
              const readResult = await window.electronAPI.readFileBase64(path);
              const attached = {
                name,
                path,
                type: readResult.type,
                data: readResult.data,
                mimeType: readResult.mimeType,
                preview:
                  readResult.type === 'image'
                    ? `data:${readResult.mimeType};base64,${readResult.data}`
                    : undefined,
              };
              window.dispatchEvent(new CustomEvent('attach-file-to-agent', { detail: attached }));
              copyToClipboard('已关联到 AI 助手', evt as any);
            } catch (err: any) {
              toast.error('关联失败', err?.message || String(err));
            }
          },
        },
        { divider: true }
      );
    }

    const openGitModalFor = (type: GitModalType) => {
      if (!nodeGitRoot) return;
      setActiveGitModal({
        type,
        path,
        repoPath: nodeGitRoot,
        targetPaths: selectedInRepo,
        isDir,
      });
    };

    const targetInitDir = isDir
      ? path
      : path.substring(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || rootPath;

    const gitMenu: MenuItem = {
      label: 'Git',
      icon: <GitBranch className="w-3.5 h-3.5 text-primary" />,
      badge: isGitRepo && selectedInRepo.length > 1 ? `已选 ${selectedInRepo.length} 项` : undefined,
      children: isGitRepo && nodeGitRoot
        ? [
            ...(canQuickDiff
              ? [
                  {
                    label: '查看工作区差异 (Diff)',
                    icon: <Diff className="w-3.5 h-3.5 text-sky-500" />,
                    onClick: async () => {
                      try {
                        const relPath = getRelativePathInRepo(path, nodeGitRoot);
                        let originalContent = '';
                        try {
                          originalContent = await window.electronAPI.gitShowFile(nodeGitRoot, 'HEAD', relPath);
                        } catch (err: any) {
                          const parsed = parseGitError(err);
                          if (parsed.raw.startsWith('BINARY_FILE:') || parsed.raw.startsWith('FILE_TOO_LARGE:')) {
                            toast.info(parsed.summary, parsed.hint);
                            return;
                          }
                          originalContent = '';
                        }
                        const readRes = await window.electronAPI.readFileBase64(path);
                        if (readRes.type !== 'text') {
                          toast.info('当前文件为二进制或非文本格式，无法对比差异');
                          return;
                        }
                        state.openDiff(
                          `diff://${relPath}-worktree`,
                          `${name} (工作区差异)`,
                          originalContent,
                          readRes.data || '',
                          'HEAD 版本',
                          '当前工作区'
                        );
                      } catch (err: any) {
                        const parsed = parseGitError(err);
                        toast.error(parsed.summary, parsed.hint);
                      }
                    },
                  },
                  { divider: true },
                ]
              : []),
            {
              label: selectedInRepo.length > 1 ? `提交选中更改 (${selectedInRepo.length})...` : '提交更改 (Commit)...',
              icon: <GitCommit className="w-3.5 h-3.5 text-emerald-500" />,
              onClick: () => openGitModalFor('commit'),
            },
            {
              label: selectedInRepo.length > 1 ? `暂存选中项 (Stage ${selectedInRepo.length})` : '暂存更改 (Stage)',
              icon: <PlusCircle className="w-3.5 h-3.5 text-emerald-500" />,
              disabled: !canAdd,
              onClick: async () => {
                try {
                  await state.runGitAdd(selectedInRepo);
                  toast.success(selectedInRepo.length > 1 ? `已暂存 ${selectedInRepo.length} 项` : '已暂存到暂存区');
                } catch (err: any) {
                  const parsed = parseGitError(err);
                  toast.error(parsed.summary, parsed.hint);
                }
              },
            },
            {
              label: selectedInRepo.length > 1 ? `取消暂存 (${selectedInRepo.length})` : '取消暂存 (Unstage)',
              icon: <MinusCircle className="w-3.5 h-3.5 text-amber-500" />,
              disabled: !canUnstage,
              onClick: async () => {
                try {
                  await state.runGitUnstage(selectedInRepo);
                  toast.success(selectedInRepo.length > 1 ? `已取消暂存 ${selectedInRepo.length} 项` : '已移出暂存区');
                } catch (err: any) {
                  const parsed = parseGitError(err);
                  toast.error(parsed.summary, parsed.hint);
                }
              },
            },
            {
              label: '回滚更改 (Rollback)...',
              icon: <RotateCcw className="w-3.5 h-3.5 text-rose-500" />,
              danger: true,
              disabled: !hasChanges,
              onClick: () => openGitModalFor('rollback'),
            },
            { divider: true },
            {
              label: '推送 (Push)...',
              icon: <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-500" />,
              onClick: () => openGitModalFor('push'),
            },
            {
              label: '拉取 (Pull)...',
              icon: <ArrowDownCircle className="w-3.5 h-3.5 text-sky-500" />,
              onClick: () => openGitModalFor('pull'),
            },
            {
              label: '获取远端更新 (Fetch)',
              icon: <RefreshCw className="w-3.5 h-3.5 text-primary" />,
              onClick: async () => {
                state.setGitSyncLabel('正在获取远端...');
                try {
                  const summary = await window.electronAPI.gitFetch(nodeGitRoot);
                  await state.refreshGitStatus();
                  toast.success('Fetch 完成', summary || '已同步远端分支与标签');
                } catch (err: any) {
                  const parsed = parseGitError(err);
                  toast.error(parsed.summary, parsed.hint);
                } finally {
                  state.setGitSyncLabel(null);
                }
              },
            },
            { divider: true },
            {
              label: '分支与标签管理 (Branches)...',
              icon: <GitFork className="w-3.5 h-3.5" />,
              onClick: () => openGitModalFor('branches'),
            },
            {
              label: '远程仓库管理 (Remotes)...',
              icon: <Link2 className="w-3.5 h-3.5" />,
              onClick: () => openGitModalFor('remotes'),
            },
            { divider: true },
            {
              label: '贮藏工作区 (Stash)...',
              icon: <Archive className="w-3.5 h-3.5" />,
              onClick: () => openGitModalFor('stash'),
            },
            {
              label: '查看提交历史 (History)...',
              icon: <History className="w-3.5 h-3.5" />,
              onClick: () => openGitModalFor('history'),
            },
            {
              label: '在 Git 提交图谱中查看',
              icon: <GitCommit className="w-3.5 h-3.5 text-emerald-500" />,
              onClick: () => state.openGitGraph(nodeGitRoot),
            },
          ]
        : [
            {
              label: '在此目录初始化 Git 仓库',
              icon: <GitBranch className="w-3.5 h-3.5 text-emerald-500" />,
              onClick: async () => {
                const confirmed = await confirmDialog({
                  title: '初始化 Git 仓库',
                  message: `确定要在以下目录执行 git init 创建版本控制仓库吗？`,
                  detail: targetInitDir,
                  confirmText: '初始化仓库',
                  variant: 'primary',
                });
                if (!confirmed) return;
                try {
                  await state.runGitInit(targetInitDir);
                  toast.success('Git 仓库初始化成功', targetInitDir);
                } catch (err: any) {
                  const parsed = parseGitError(err);
                  toast.error(parsed.summary, parsed.hint);
                }
              },
            },
          ],
    };
    items.push(gitMenu, { divider: true });

    items.push({
      label: activeSelected.length > 1 ? `删除选中的 ${activeSelected.length} 项` : '删除',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => {
        const { selectedFilePaths } = useWorkspaceStore.getState();
        const selectedCount = selectedFilePaths.includes(path) ? selectedFilePaths.length : 1;
        setActiveDeleteTarget({ path, name, isDir, selectedCount });
      },
    });

    setActiveCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [reloadDir]);

  const handleConfirmDelete = async () => {
    if (!activeDeleteTarget) return;
    try {
      const { selectedFilePaths, setSelectedFilePaths, setLastSelectedFilePath, refreshGitStatus, closeTabsUnderPath } = useWorkspaceStore.getState();
      const rawTargetPaths = selectedFilePaths.includes(activeDeleteTarget.path) ? selectedFilePaths : [activeDeleteTarget.path];

      const targetPaths = [...rawTargetPaths].sort((a, b) => b.length - a.length);

      for (const p of targetPaths) {
        try {
          await window.electronAPI.localDeleteNode(p);
        } catch (err) {
          console.warn('Failed to delete node:', p, err);
        }
        closeTabsUnderPath(p);
      }
      setSelectedFilePaths([]);
      setLastSelectedFilePath(null);

      clearDirCache();
      refreshFileExplorerStore();
      await refreshGitStatus();
    } catch (err: any) {
      toast.error('删除失败', err?.message || String(err));
    } finally {
      setActiveDeleteTarget(null);
    }
  };

  if (!currentProject) return null;

  const rootPath = getProjectRootPath(currentProject);

  return (
    <div className="flex flex-col h-full bg-background-primary border-r border-border-primary select-none w-full">
      <div className="p-3 border-b border-border-primary flex items-center justify-between flex-shrink-0 bg-background-secondary/20">
        <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider font-mono">资源管理器</h3>
        <div className="flex items-center space-x-1.5">
          <button
            onClick={async () => {
              try {
                const path = await window.electronAPI.selectDirectory();
                if (path) {
                  const updated = { ...currentProject, codePath: path };
                  await window.electronAPI.updateProject(currentProject.id, updated);
                  dispatch({ type: 'UPDATE_PROJECT', payload: updated });
                  setCurrentProject(updated);
                }
              } catch (err) {
                console.error('Failed to change code directory:', err);
              }
            }}
            className="p-1 rounded text-text-secondary hover:bg-background-secondary/80 hover:text-text-primary transition-colors"
            title={`开发代码路径: ${rootPath}`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          
          <button
            onClick={() => {
              setShowSearch(!showSearch);
              if (showSearch) setSearchQuery('');
            }}
            className={`p-1 rounded transition-colors ${
              showSearch ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:bg-background-secondary/80 hover:text-text-primary'
            }`}
            title="搜索文件"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              collapseAllFolders();
            }}
            className="p-1 rounded text-text-secondary hover:bg-background-secondary/80 hover:text-text-primary transition-colors"
            title="折叠全部文件夹"
          >
            <FolderClosed className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={async (e) => {
              const icon = e.currentTarget.querySelector('svg');
              if (icon) {
                icon.classList.add('animate-spin');
                setTimeout(() => icon.classList.remove('animate-spin'), 600);
              }
              clearDirCache();
              refreshFileExplorerStore();
              await refreshGitStatus();
            }}
            className="p-1 rounded text-text-secondary hover:bg-background-secondary/80 hover:text-text-primary transition-colors duration-200"
            title="刷新目录"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="p-2 border-b border-border-primary bg-background-secondary/40 flex-shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索项目文件..."
              className="w-full bg-background-primary border border-border-primary focus:border-primary/50 text-xs text-text-primary rounded px-2.5 py-1.5 pl-7 focus:outline-none placeholder-text-tertiary font-mono transition-all"
              autoFocus
            />
            <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-2.5 top-2.5" />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-text-tertiary hover:text-text-primary"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      <div 
        ref={containerRef} 
        onScroll={handleScroll} 
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-y-auto p-1.5 scrollbar-thin relative focus:outline-none"
      >
        {showSearch && searchQuery.trim() ? (
          searching ? (
            <div className="p-4 text-center text-text-tertiary text-xs font-mono">
              正在搜索中...
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-center text-text-tertiary text-xs font-mono">
              未找到匹配文件
            </div>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map((item) => (
                <div
                  key={item.path}
                  onClick={() => {
                    if (item.isDir) {
                      const state = useWorkspaceStore.getState();
                      if (!state.expandedFolders[item.path]) {
                        state.selectAndToggleFolder(item.path);
                      } else {
                        state.setSelectedFilePaths([item.path]);
                        state.setLastSelectedFilePath(item.path);
                      }
                      setShowSearch(false);
                      setSearchQuery('');
                    } else {
                      openFile(item.path, item.name);
                    }
                  }}
                  className="flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-background-secondary cursor-pointer transition-colors text-xs text-text-secondary hover:text-text-primary"
                >
                  {item.isDir ? (
                    <Folder className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  ) : (
                    getFileIconUtil(item.name)
                  )}
                  
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-mono truncate">{item.name}</span>
                    <span className="text-[9px] text-text-tertiary truncate font-mono select-all">
                      {item.path.substring(rootPath.length + 1) || item.path}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div style={{ height: `${visibleItems.length * ITEM_HEIGHT}px`, width: '100%', position: 'relative' }}>
            <div style={{ transform: `translateY(${startIndex * ITEM_HEIGHT}px)`, position: 'absolute', left: 0, right: 0 }}>
              {renderedItems.map((item) => {
                const isSelected = selectedFilePaths.length > 0
                  ? selectedFilePaths.includes(item.path)
                  : activeTabPath === item.path;

                const isExpanded = !!expandedFolders[item.path];
                const statusColor = getStatusColorClass(item.name, item.path, item.isDir, gitFileStatuses, gitDirtyFolders);
                const gitBadge =
                  item.isEmptyPlaceholder || item.isCreatingPlaceholder || item.isMorePlaceholder || item.isRenamingPlaceholder
                    ? null
                    : getGitBadgeInfo(item.path, item.isDir, gitFileStatuses, gitDirtyFolders);
                const isLoading = !!loadingFolders[item.path];

                return (
                  <FileNodeRow
                    key={item.path}
                    item={item}
                    isSelected={isSelected}
                    isExpanded={isExpanded}
                    statusColorClass={statusColor}
                    gitBadge={gitBadge}
                    isLoading={isLoading}
                    onRowClick={handleRowClick}
                    onContextMenu={openContextMenu}
                    onQuickAction={handleQuickAction}
                    onCreateSubmit={handleCreateSubmit}
                    onCancelCreating={cancelCreating}
                    onRenameSubmit={handleRenameSubmit}
                    onCancelRenaming={cancelRenaming}
                    onLoadAllChildren={handleLoadAllChildren}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Global Modals */}
      {activeDeleteTarget && (
        <DeleteConfirmModal
          isOpen={true}
          onConfirm={handleConfirmDelete}
          onCancel={() => setActiveDeleteTarget(null)}
          title={activeDeleteTarget.selectedCount > 1 ? `确定要删除这 ${activeDeleteTarget.selectedCount} 个选中的项目吗？` : `确定要删除 ${activeDeleteTarget.name} 吗？`}
          description={activeDeleteTarget.isDir || activeDeleteTarget.selectedCount > 1 ? "选中项目将同时递归删除其包含的全部子目录与文件，此操作不可恢复。" : "此文件将被从本地硬盘中彻底删除，且无法恢复。"}
        />
      )}

      {activeCtxMenu && (
        <FileExplorerContextMenu
          x={activeCtxMenu.x}
          y={activeCtxMenu.y}
          items={activeCtxMenu.items}
          onClose={() => setActiveCtxMenu(null)}
        />
      )}

      {activeGitModal?.type === 'commit' && (
        <CommitDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          targetPaths={activeGitModal.targetPaths}
          onClose={() => {
            setActiveGitModal(null);
            refreshGitStatus();
          }}
        />
      )}
      {activeGitModal?.type === 'branches' && (
        <BranchesDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal?.type === 'remotes' && (
        <RemotesDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal?.type === 'stash' && (
        <StashDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          onClose={() => {
            setActiveGitModal(null);
            refreshGitStatus();
          }}
        />
      )}
      {activeGitModal?.type === 'history' && (
        <HistoryDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          isDirectory={activeGitModal.isDir}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal?.type === 'rollback' && (
        <RollbackDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          targetPaths={activeGitModal.targetPaths}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal?.type === 'push' && (
        <PushDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal?.type === 'pull' && (
        <PullDialog
          path={activeGitModal.path}
          projectPath={activeGitModal.repoPath}
          onClose={() => setActiveGitModal(null)}
        />
      )}
    </div>
  );
};

