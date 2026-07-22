import React, { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext, startTransition } from 'react';
import { useWorkspaceStore } from '../../../contexts/useWorkspaceStore';
import { Folder, ChevronRight, ChevronDown, Plus, Search, X, RotateCw, Settings, Loader2, FolderClosed } from 'lucide-react';
import DeleteConfirmModal from '../../../components/DeleteConfirmModal';
import { copyToClipboard } from '../../../utils/copy';
import { getFileIcon as getFileIconUtil, getFolderIcon } from '../../../utils/fileIcon';
import { getProjectRootPath, normalizePath } from '../../../utils/path';
import { useApp } from '../../../contexts/AppContext';
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
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void | Promise<void>;
  children?: MenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const FileExplorerContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState<number | null>(null);
  const [coords, setCoords] = useState({ left: x, top: y });
  const [isPositioned, setIsPositioned] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [onClose]);

  React.useLayoutEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const menuWidth = rect.width || 180;
      const menuHeight = rect.height || 350;

      let newLeft = x;
      let newTop = y;

      if (y + menuHeight > window.innerHeight) {
        newTop = Math.max(10, window.innerHeight - menuHeight - 10);
      }

      if (x + menuWidth > window.innerWidth) {
        newLeft = Math.max(10, window.innerWidth - menuWidth - 10);
      }

      setCoords({ left: newLeft, top: newTop });
      setIsPositioned(true);
    }
  }, [x, y]);

  const submenuOpenLeft = coords.left + 360 > window.innerWidth;

  return (
    <div
      ref={ref}
      className={`fixed z-[9999] bg-card rounded-xl shadow-2xl border border-border-primary py-1.5 min-w-[180px] select-none transition-opacity duration-75 ${
        isPositioned ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: coords.left, top: coords.top }}
      onMouseLeave={() => setActiveSubmenuIndex(null)}
    >
      {items.map((it, i) => {
        if (it.divider) {
          return <div key={i} className="my-1 border-t border-border-primary" />;
        }

        const hasChildren = !!it.children?.length;

        return (
          <div
            key={i}
            className="relative"
            onMouseEnter={() => {
              if (it.disabled) {
                setActiveSubmenuIndex(null);
                return;
              }
              if (hasChildren) {
                setActiveSubmenuIndex(i);
              } else {
                setActiveSubmenuIndex(null);
              }
            }}
          >
            <button
              disabled={it.disabled}
              onClick={(e) => {
                if (it.disabled) return;
                if (hasChildren) {
                  e.stopPropagation();
                } else {
                  e.stopPropagation();
                  it.onClick?.(e);
                  onClose();
                }
              }}
              className={`w-full text-left px-4 py-1.5 text-xs transition-colors flex items-center justify-between ${
                it.disabled
                  ? 'text-text-tertiary/60 cursor-not-allowed opacity-50'
                  : it.danger
                    ? 'text-rose-500 hover:bg-rose-500/10'
                    : 'text-text-primary hover:bg-background-secondary/80'
              }`}
            >
              <span>{it.label}</span>
              {hasChildren && <span className="text-[9px] text-text-tertiary font-mono ml-2">▶</span>}
            </button>

            {hasChildren && activeSubmenuIndex === i && (() => {
              const submenuOpenUp = i >= items.length / 2;
              return (
                <div
                  className="absolute bg-card rounded-xl shadow-2xl border border-border-primary py-1.5 min-w-[180px] z-[10000]"
                  style={{
                    left: submenuOpenLeft ? 'auto' : '98%',
                    right: submenuOpenLeft ? '98%' : 'auto',
                    top: submenuOpenUp ? 'auto' : '-6px',
                    bottom: submenuOpenUp ? '-6px' : 'auto',
                  }}
                >
                  {it.children!.map((sub: MenuItem, si: number) =>
                    sub.divider ? (
                      <div key={si} className="my-1 border-t border-border-primary" />
                    ) : (
                      <button
                        key={si}
                        disabled={sub.disabled}
                        onClick={(e) => {
                          if (sub.disabled) return;
                          e.stopPropagation();
                          sub.onClick?.(e);
                          onClose();
                        }}
                        className={`w-full text-left px-4 py-1.5 text-xs transition-colors ${
                          sub.disabled
                            ? 'text-text-tertiary/60 cursor-not-allowed opacity-50'
                            : sub.danger
                              ? 'text-rose-500 hover:bg-rose-500/10'
                              : 'text-text-primary hover:bg-background-secondary/80'
                        }`}
                      >
                        {sub.label}
                      </button>
                    )
                  )}
                </div>
              );
            })()}
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

interface FileNodeRowProps {
  item: FlatTreeItem;
  isSelected: boolean;
  isExpanded: boolean;
  statusColorClass: string;
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

      {isDir && (
        <div className="hidden group-hover:flex items-center space-x-1 flex-shrink-0 pr-1">
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
  );
});

const getStatusColorClass = (
  name: string,
  path: string,
  isDir: boolean,
  gitFileStatuses: Record<string, string>,
  gitDirtyFolders: Record<string, any>
): string => {
  const isCommonIgnored = name === 'node_modules' 
    || name === 'target' 
    || name === 'dist' 
    || name === 'build'
    || name.startsWith('.');

  if (isDir) {
    const folderStatus = gitDirtyFolders[path];
    if (folderStatus) {
      if (folderStatus.notAdded) return 'text-[#f87171]';
      if (folderStatus.modified) return 'text-[#60a5fa]';
      if (folderStatus.added) return 'text-[#4ade80]';
      if (folderStatus.untracked) return 'text-[#fb923c]';
    }
    if (isCommonIgnored) return 'text-slate-500';
  } else {
    const statusXY = gitFileStatuses[path];
    if (statusXY) {
      if (statusXY === '??') return 'text-[#fb923c]';
      if (statusXY === '!!') return 'text-slate-500';
      if (statusXY.includes('D')) return 'text-red-400 line-through';
      
      const X = statusXY[0];
      const Y = statusXY[1];
      if (Y === 'M') return 'text-[#f87171]';
      if (X === 'M') return 'text-[#60a5fa]';
      if (X === 'A' || X === 'R') return 'text-[#4ade80]';
    }
    if (isCommonIgnored) return 'text-slate-500';
  }
  return '';
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
  const [activeGitModal, setActiveGitModal] = useState<{ type: GitModalType; path: string } | null>(null);
  const [creatingTarget, setCreatingTarget] = useState<{ path: string; type: 'file' | 'folder' } | null>(null);
  const [renamingTarget, setRenamingTarget] = useState<{ path: string; name: string; isDir: boolean } | null>(null);

  // Zustand State subscriptions
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders);
  const selectedFilePaths = useWorkspaceStore((s) => s.selectedFilePaths);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const gitFileStatuses = useWorkspaceStore((s) => s.gitFileStatuses);
  const gitDirtyFolders = useWorkspaceStore((s) => s.gitDirtyFolders);
  const fileExplorerRefreshKey = useWorkspaceStore((s) => s.fileExplorerRefreshKey);

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
      alert('创建失败: ' + err.message);
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
      alert('重命名失败: ' + err.message);
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

    let systemClipboardPath = '';
    try {
      systemClipboardPath = await window.electronAPI.localReadFileFromClipboard();
    } catch (err) {
      console.warn('Failed to read system clipboard file path:', err);
    }
    const canPaste = !!(systemClipboardPath || state.copiedFilePath);

    const rootPath = state.currentProject?.codePath || state.currentProject?.path || '';
    const gitRoots = state.gitRoots || [];

    const nodeGitRoot = (() => {
      if (!gitRoots || gitRoots.length === 0) return null;
      const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
      return sorted.find(r => path.startsWith(r)) || null;
    })();
    const isGitRepo = nodeGitRoot !== null;

    const folderStatus = state.gitDirtyFolders[path];
    const statusXY = state.gitFileStatuses[path];

    const canAdd = (() => {
      if (isDir) {
        return folderStatus ? (folderStatus.notAdded || folderStatus.untracked) : false;
      } else {
        if (!statusXY) return false;
        if (statusXY === '??') return true;
        const Y = statusXY[1] || ' ';
        return Y === 'M' || Y === 'D';
      }
    })();

    const hasChanges = isDir ? !!folderStatus : !!statusXY;

    const items: MenuItem[] = [];

    if (isDir) {
      items.push({
        label: 'Open in Terminal',
        onClick: () => state.openTerminal(path, name)
      });
    }

    if (!isDir) {
      items.push({
        label: 'Open',
        onClick: () => state.openFile(path, name)
      });
    }

    items.push(
      {
        label: 'Reveal in Finder',
        onClick: async () => {
          const getParentPath = (filePath: string) => {
            const isWin = filePath.includes('\\') || (!filePath.startsWith('/') && filePath.includes(':'));
            const sep = isWin ? '\\' : '/';
            const parts = filePath.split(sep);
            parts.pop();
            return parts.join(sep);
          };
          const dirToOpen = isDir ? path : getParentPath(path);
          try {
            await window.electronAPI.openDirectory(dirToOpen);
          } catch (err: any) {
            console.error('Failed to open directory:', err);
          }
        }
      },
      { divider: true }
    );

    if (isDir) {
      items.push(
        {
          label: 'New File',
          onClick: () => {
            if (!state.expandedFolders[path]) {
              state.selectAndToggleFolder(path);
            }
            setCreatingTarget({ path, type: 'file' });
          }
        },
        {
          label: 'New Folder',
          onClick: () => {
            if (!state.expandedFolders[path]) {
              state.selectAndToggleFolder(path);
            }
            setCreatingTarget({ path, type: 'folder' });
          }
        },
        { divider: true }
      );
    }

    items.push(
      {
        label: 'Rename',
        onClick: () => {
          setRenamingTarget({ path, name, isDir });
        }
      },
      {
        label: 'Copy Path',
        onClick: (evt: React.MouseEvent) => {
          const { selectedFilePaths } = useWorkspaceStore.getState();
          const targetPaths = selectedFilePaths.includes(path) ? selectedFilePaths : [path];
          copyToClipboard(targetPaths.join('\n'), evt);
        }
      },
      {
        label: 'Copy Relative Path',
        onClick: (evt: React.MouseEvent) => {
          const { selectedFilePaths } = useWorkspaceStore.getState();
          const targetPaths = selectedFilePaths.includes(path) ? selectedFilePaths : [path];
          const relPaths = targetPaths.map(p => {
            let rel = p.substring(rootPath.length);
            if (rel.startsWith('/') || rel.startsWith('\\')) {
              rel = rel.substring(1);
            }
            return rel || '.';
          });
          copyToClipboard(relPaths.join('\n'), evt);
        }
      },
      { divider: true },
      {
        label: 'Copy File',
        onClick: async () => {
          try {
            await window.electronAPI.localWriteFileToClipboard(path);
          } catch (err: any) {
            console.error('Failed to copy file to system clipboard:', err);
          }
          state.setCopiedFilePath(path);
        }
      },
      {
        label: 'Paste',
        disabled: !canPaste,
        onClick: async () => {
          let sysClipPath = '';
          try {
            sysClipPath = await window.electronAPI.localReadFileFromClipboard();
          } catch (e) {
            console.warn('Failed to read system clipboard file path:', e);
          }

          const sourcePath = sysClipPath ? sysClipPath.trim() : state.copiedFilePath;

          if (!sourcePath) {
            alert('剪贴板中无有效的文件复制记录');
            return;
          }

          const destDir = isDir ? path : path.substring(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));

          try {
            const finalDestPath = await getUniqueDestPath(sourcePath, destDir);
            const success = await window.electronAPI.localCopyFile(sourcePath, finalDestPath);
            if (success) {
              reloadDir(destDir);
              await state.refreshGitStatus();
            } else {
              alert('粘贴文件失败：复制操作未成功完成');
            }
          } catch (err: any) {
            console.error('Failed to copy and paste file:', err);
            alert('粘贴文件失败: ' + err.message);
          }
        }
      },
      { divider: true }
    );

    if (!isDir) {
      items.push(
        {
          label: 'Attach to Agent',
          onClick: async (evt: React.MouseEvent) => {
            try {
              const readResult = await window.electronAPI.readFileBase64(path);
              const attached = {
                name,
                path,
                type: readResult.type,
                data: readResult.data,
                mimeType: readResult.mimeType,
                preview: readResult.type === 'image' ? `data:${readResult.mimeType};base64,${readResult.data}` : undefined
              };
              const event = new CustomEvent('attach-file-to-agent', { detail: attached });
              window.dispatchEvent(event);
              copyToClipboard('已成功关联到 Agent', evt);
            } catch (err: any) {
              alert('关联失败: ' + err.message);
            }
          }
        },
        { divider: true }
      );
    }

    const gitMenu: MenuItem = {
      label: 'Git',
      children: isGitRepo ? [
        {
          label: 'Commit File...',
          onClick: () => setActiveGitModal({ type: 'commit', path })
        },
        {
          label: 'Add to Git',
          disabled: !canAdd,
          onClick: async () => {
            try {
              await state.runGitAdd(path);
            } catch (err: any) {
              alert('Stage file failed: ' + err.message);
            }
          }
        },
        {
          label: 'Rollback...',
          disabled: !hasChanges,
          onClick: () => setActiveGitModal({ type: 'rollback', path })
        },
        { divider: true },
        {
          label: 'Push...',
          onClick: () => setActiveGitModal({ type: 'push', path })
        },
        {
          label: 'Pull...',
          onClick: () => setActiveGitModal({ type: 'pull', path })
        },
        {
          label: 'Fetch',
          onClick: async () => {
            try {
              let targetRoot = rootPath;
              if (nodeGitRoot) targetRoot = nodeGitRoot;
              await window.electronAPI.gitFetch(targetRoot);
              await state.refreshGitStatus();
              alert('Fetch 成功！');
            } catch (err: any) {
              alert('Fetch 失败: ' + err.message);
            }
          }
        },
        { divider: true },
        {
          label: 'Branches...',
          onClick: () => setActiveGitModal({ type: 'branches', path })
        },
        {
          label: 'Manage Remotes...',
          onClick: () => setActiveGitModal({ type: 'remotes', path })
        },
        { divider: true },
        {
          label: 'Stash Changes...',
          onClick: () => setActiveGitModal({ type: 'stash', path })
        },
        {
          label: 'Show History',
          onClick: () => setActiveGitModal({ type: 'history', path })
        },
        {
          label: 'Show Git Graph',
          onClick: () => state.openGitGraph()
        }
      ] : [
        {
          label: 'Initialize Git Repository',
          onClick: async () => {
            try {
              await state.runGitInit();
              alert('Git 仓库初始化成功！');
            } catch (err: any) {
              alert('初始化 Git 失败: ' + err.message);
            }
          }
        }
      ]
    };
    items.push(gitMenu, { divider: true });

    items.push({
      label: 'Delete',
      danger: true,
      onClick: () => {
        const { selectedFilePaths } = useWorkspaceStore.getState();
        const selectedCount = selectedFilePaths.includes(path) ? selectedFilePaths.length : 1;
        setActiveDeleteTarget({ path, name, isDir, selectedCount });
      }
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
      alert('删除失败: ' + err.message);
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
                const isLoading = !!loadingFolders[item.path];

                return (
                  <FileNodeRow
                    key={item.path}
                    item={item}
                    isSelected={isSelected}
                    isExpanded={isExpanded}
                    statusColorClass={statusColor}
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
        <CommitDialog path={activeGitModal.path} onClose={() => { setActiveGitModal(null); refreshGitStatus(); }} />
      )}
      {activeGitModal?.type === 'branches' && (
        <BranchesDialog path={activeGitModal.path} onClose={() => setActiveGitModal(null)} />
      )}
      {activeGitModal?.type === 'remotes' && (
        <RemotesDialog path={activeGitModal.path} onClose={() => setActiveGitModal(null)} />
      )}
      {activeGitModal?.type === 'stash' && (
        <StashDialog path={activeGitModal.path} onClose={() => { setActiveGitModal(null); refreshGitStatus(); }} />
      )}
      {activeGitModal?.type === 'history' && (
        <HistoryDialog path={activeGitModal.path} onClose={() => setActiveGitModal(null)} />
      )}
      {activeGitModal?.type === 'rollback' && (
        <RollbackDialog path={activeGitModal.path} onClose={() => setActiveGitModal(null)} />
      )}
      {activeGitModal?.type === 'push' && (
        <PushDialog path={activeGitModal.path} onClose={() => setActiveGitModal(null)} />
      )}
      {activeGitModal?.type === 'pull' && (
        <PullDialog path={activeGitModal.path} onClose={() => setActiveGitModal(null)} />
      )}
    </div>
  );
};

