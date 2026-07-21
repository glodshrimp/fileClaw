import React, { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from 'react';
import { useWorkspaceStore } from '../../../contexts/useWorkspaceStore';
import { Folder, ChevronRight, ChevronDown, Plus, Search, X, RotateCw, Settings } from 'lucide-react';
import DeleteConfirmModal from '../../../components/DeleteConfirmModal';
import { copyToClipboard } from '../../../utils/copy';
import { getFileIcon as getFileIconUtil, getFolderIcon } from '../../../utils/fileIcon';
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

const getUniqueDestPath = async (srcPath: string, destDir: string): Promise<string> => {
  const separator = srcPath.includes('\\') ? '\\' : '/';
  const fileName = srcPath.substring(Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\')) + 1);
  
  let existingFiles: string[] = [];
  try {
    const list = await window.electronAPI.localListDir(destDir);
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

  return `${destDir}${separator}${candidateName}`;
};

interface FileNodeProps {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
}

const FileNode = React.memo<FileNodeProps>(({ name, path, isDir, depth }) => {
  const actions = useContext(FileExplorerActionContext)!;

  const isExpanded = useWorkspaceStore((s) => !!s.expandedFolders[path]);
  const isSelected = useWorkspaceStore((s) =>
    s.selectedFilePaths.length > 0
      ? s.selectedFilePaths.includes(path)
      : s.activeTabPath === path
  );

  const statusColorClass = useWorkspaceStore((s) => {
    const isCommonIgnored = name === 'node_modules' 
      || name === 'target' 
      || name === 'dist' 
      || name === 'build'
      || name.startsWith('.');

    if (isDir) {
      const folderStatus = s.gitDirtyFolders[path];
      if (folderStatus) {
        if (folderStatus.notAdded) return 'text-[#f87171]';
        if (folderStatus.modified) return 'text-[#60a5fa]';
        if (folderStatus.added) return 'text-[#4ade80]';
        if (folderStatus.untracked) return 'text-[#fb923c]';
      }
      if (isCommonIgnored) return 'text-slate-500';
    } else {
      const statusXY = s.gitFileStatuses[path];
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
  });

  const fileExplorerRefreshKey = useWorkspaceStore((s) => s.fileExplorerRefreshKey);

  const selectAndToggleFolder = useWorkspaceStore((s) => s.selectAndToggleFolder);
  const selectSingleFile = useWorkspaceStore((s) => s.selectSingleFile);
  const setSelectedFilePaths = useWorkspaceStore((s) => s.setSelectedFilePaths);
  const setLastSelectedFilePath = useWorkspaceStore((s) => s.setLastSelectedFilePath);
  const openFile = useWorkspaceStore((s) => s.openFile);

  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [newItemName, setNewItemName] = useState('');

  const isCreatingHere = actions.creatingTarget?.path === path;
  const creatingType = actions.creatingTarget?.type;

  const loadChildren = useCallback(async (force = false) => {
    if (!isDir) return;
    setLoading(true);
    try {
      const res = await actions.getDirChildren(path, force);
      setChildren(res);
    } catch (err) {
      console.error('Failed to load dir:', err);
    } finally {
      setLoading(false);
    }
  }, [isDir, path, actions]);

  useEffect(() => {
    if (isDir && isExpanded) {
      loadChildren();
    }
  }, [isDir, path, isExpanded, fileExplorerRefreshKey, loadChildren]);

  const handleRowClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    const { selectedFilePaths, lastSelectedFilePath } = useWorkspaceStore.getState();

    if (e.shiftKey && lastSelectedFilePath) {
      const elements = Array.from(document.querySelectorAll('[data-file-path]'));
      const visiblePaths = elements.map(el => el.getAttribute('data-file-path')).filter(Boolean) as string[];
      const idxStart = visiblePaths.indexOf(lastSelectedFilePath);
      const idxEnd = visiblePaths.indexOf(path);
      
      if (idxStart !== -1 && idxEnd !== -1) {
        const min = Math.min(idxStart, idxEnd);
        const max = Math.max(idxStart, idxEnd);
        const rangePaths = visiblePaths.slice(min, max + 1);
        setSelectedFilePaths(rangePaths);
      }
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      if (selectedFilePaths.includes(path)) {
        setSelectedFilePaths(selectedFilePaths.filter(p => p !== path));
      } else {
        setSelectedFilePaths([...selectedFilePaths, path]);
      }
      setLastSelectedFilePath(path);
      return;
    }

    if (isDir) {
      selectAndToggleFolder(path);
    } else {
      selectSingleFile(path);
      openFile(path, name);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !creatingType) return;

    try {
      const isCreateDir = creatingType === 'folder';
      await window.electronAPI.localCreateNode(path, newItemName.trim(), isCreateDir);
      actions.cancelCreating();
      setNewItemName('');
      actions.reloadDir(path);
    } catch (err: any) {
      alert('创建失败: ' + err.message);
    }
  };

  return (
    <div className="select-none">
      <div
        data-file-path={path}
        className={`group flex items-center justify-between py-1 px-2 hover:bg-background-secondary/85 text-text-primary rounded cursor-pointer transition-colors text-[11px] ${
          isSelected ? 'bg-primary/20 border-l-2 border-primary pl-[6px]' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + (isSelected ? 6 : 8)}px` }}
        onClick={handleRowClick}
        onContextMenu={(e) => {
          actions.openContextMenu(e, path, name, isDir);
        }}
      >
        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
          {isDir ? (
            <>
              {isExpanded ? <ChevronDown className="w-3 h-3 text-text-tertiary" /> : <ChevronRight className="w-3 h-3 text-text-tertiary" />}
              {getFolderIcon(name, isExpanded)}
            </>
          ) : (
            getFileIconUtil(name)
          )}
          <span className={`truncate ${statusColorClass || (isSelected ? 'text-primary font-medium' : 'text-text-secondary group-hover:text-text-primary')}`}>
            {name}
          </span>
        </div>

        {/* Quick action buttons for directories */}
        {isDir && (
          <div className="hidden group-hover:flex items-center space-x-1 flex-shrink-0 pr-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isExpanded) selectAndToggleFolder(path);
                actions.startCreating(path, 'file');
              }}
              className="p-0.5 hover:bg-background-secondary rounded text-text-tertiary hover:text-text-primary"
              title="新建文件"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isExpanded) selectAndToggleFolder(path);
                actions.startCreating(path, 'folder');
              }}
              className="p-0.5 hover:bg-background-secondary rounded text-text-tertiary hover:text-text-primary"
              title="新建文件夹"
            >
              <Folder className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Inline Create Input */}
      {isCreatingHere && (
        <form onSubmit={handleCreateSubmit} className="flex items-center space-x-1 py-1 pr-2" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
          <input
            type="text"
            autoFocus
            placeholder={creatingType === 'file' ? '文件名...' : '文件夹名...'}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onBlur={() => { actions.cancelCreating(); setNewItemName(''); }}
            className="bg-slate-950 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-primary flex-1 font-mono"
          />
        </form>
      )}

      {/* Children list */}
      {isDir && isExpanded && children && (
        <div className="overflow-hidden">
          {children.length === 0 && !loading && (
            <div className="text-[10px] text-slate-500 italic py-1" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              空目录
            </div>
          )}
          {children.map((child) => (
            <FileNode
              key={child.name}
              name={child.name}
              path={child.path}
              isDir={child.isDir}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const IGNORED_DIRS = ['.git', 'node_modules', 'dist', 'build', 'target', '.vscode', '.idea', '__pycache__', 'env', 'venv'];

const recursiveSearch = async (
  dirPath: string, 
  query: string, 
  results: Array<{ name: string; path: string; isDir: boolean }> = [],
  depth = 0
): Promise<Array<{ name: string; path: string; isDir: boolean }>> => {
  if (results.length >= 100 || depth > 8) return results;

  try {
    const list = await window.electronAPI.localListDir(dirPath);
    for (const item of list) {
      if (results.length >= 100) break;

      const matches = item.name.toLowerCase().includes(query.toLowerCase());
      if (matches) {
        results.push({ name: item.name, path: item.path, isDir: item.isDir });
      }

      if (item.isDir) {
        const folderName = item.name.toLowerCase();
        const shouldIgnore = IGNORED_DIRS.some(ignored => folderName === ignored);
        if (!shouldIgnore) {
          await recursiveSearch(item.path, query, results, depth + 1);
        }
      }
    }
  } catch (err) {
    console.error('Search error in dir:', dirPath, err);
  }
  return results;
};

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

  // Directory Content Cache
  const dirCache = useRef<Map<string, FileEntry[]>>(new Map());

  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);
  const refreshFileExplorerStore = useWorkspaceStore((s) => s.refreshFileExplorer);

  const clearDirCache = useCallback(() => {
    dirCache.current.clear();
  }, []);

  const getDirChildren = useCallback(async (dirPath: string, force = false): Promise<FileEntry[]> => {
    if (!force && dirCache.current.has(dirPath)) {
      return dirCache.current.get(dirPath)!;
    }
    const list = await window.electronAPI.localListDir(dirPath);
    dirCache.current.set(dirPath, list);
    return list;
  }, []);

  const reloadDir = useCallback(async (dirPath: string) => {
    dirCache.current.delete(dirPath);
    refreshFileExplorerStore();
  }, [refreshFileExplorerStore]);

  useEffect(() => {
    if (currentProject) {
      refreshGitStatus();
      
      let timer: ReturnType<typeof setTimeout>;
      const handleFocus = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          refreshGitStatus();
        }, 300);
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
      const root = currentProject.codePath || currentProject.path;
      const results = await recursiveSearch(root, searchQuery.trim());
      setSearchResults(results);
      setSearching(false);
    }, 250);

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

  const openGitModal = useCallback((type: GitModalType, path: string) => {
    setActiveGitModal({ type, path });
  }, []);

  const openDeleteModal = useCallback((path: string, name: string, isDir: boolean) => {
    const { selectedFilePaths } = useWorkspaceStore.getState();
    const selectedCount = selectedFilePaths.includes(path) ? selectedFilePaths.length : 1;
    setActiveDeleteTarget({ path, name, isDir, selectedCount });
  }, []);

  const handleConfirmDelete = async () => {
    if (!activeDeleteTarget) return;
    try {
      const { selectedFilePaths, setSelectedFilePaths, setLastSelectedFilePath, refreshGitStatus } = useWorkspaceStore.getState();
      const targetPaths = selectedFilePaths.includes(activeDeleteTarget.path) ? selectedFilePaths : [activeDeleteTarget.path];
      for (const p of targetPaths) {
        await window.electronAPI.localDeleteNode(p);
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

  const startCreating = useCallback((parentPath: string, type: 'file' | 'folder') => {
    setCreatingTarget({ path: parentPath, type });
  }, []);

  const cancelCreating = useCallback(() => {
    setCreatingTarget(null);
  }, []);

  const actionContextValue = useMemo<ActionContextType>(() => ({
    openContextMenu,
    openGitModal,
    openDeleteModal,
    getDirChildren,
    startCreating,
    creatingTarget,
    cancelCreating,
    reloadDir,
  }), [openContextMenu, openGitModal, openDeleteModal, getDirChildren, startCreating, creatingTarget, cancelCreating, reloadDir]);

  if (!currentProject) return null;

  const rootPath = currentProject.codePath || currentProject.path;

  return (
    <FileExplorerActionContext.Provider value={actionContextValue}>
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

        <div className="flex-1 overflow-y-auto p-1.5 scrollbar-thin">
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
                      if (!item.isDir) {
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
            <FileNode
              name={currentProject.name}
              path={rootPath}
              isDir={true}
              depth={0}
            />
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
    </FileExplorerActionContext.Provider>
  );
};
