import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../../contexts/useWorkspaceStore';
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Plus, FileJson, FileCode, FileImage, Search, X } from 'lucide-react';
import DeleteConfirmModal from '../../../components/DeleteConfirmModal';
import { copyToClipboard } from '../../../utils/copy';
import { getFileIcon as getFileIconUtil, getFolderIcon } from '../../../utils/fileIcon';
import { useApp } from '../../../contexts/AppContext';
import { Settings } from 'lucide-react';
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
}

interface FileNodeProps {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  onRefreshParent?: () => void;
}

const joinPath = (parent: string, child: string): string => {
  const isWindows = parent.includes('\\') || (!parent.startsWith('/') && parent.includes(':'));
  const sep = isWindows ? '\\' : '/';
  if (parent.endsWith(sep)) {
    return parent + child;
  }
  return parent + sep + child;
};

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
  const ref = React.useRef<HTMLDivElement>(null);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = React.useState<number | null>(null);
  const [coords, setCoords] = React.useState({ left: x, top: y });
  const [isPositioned, setIsPositioned] = React.useState(false);

  React.useEffect(() => {
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
      className={`fixed z-[9999] bg-[#151b26] rounded-xl shadow-2xl border border-white/10 py-1.5 min-w-[180px] select-none transition-opacity duration-75 ${
        isPositioned ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: coords.left, top: coords.top }}
      onMouseLeave={() => setActiveSubmenuIndex(null)}
    >
      {items.map((it, i) => {
        if (it.divider) {
          return <div key={i} className="my-1 border-t border-white/5" />;
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
                  ? 'text-slate-600 cursor-not-allowed opacity-50'
                  : it.danger
                    ? 'text-[#f87171] hover:bg-[#ef4444]/10'
                    : 'text-slate-200 hover:bg-white/5'
              }`}
            >
              <span>{it.label}</span>
              {hasChildren && <span className="text-[9px] text-slate-500 font-mono ml-2">▶</span>}
            </button>

            {hasChildren && activeSubmenuIndex === i && (() => {
              const submenuOpenUp = i >= items.length / 2;
              return (
                <div
                  className="absolute bg-[#151b26] rounded-xl shadow-2xl border border-white/10 py-1.5 min-w-[180px] z-[10000]"
                  style={{
                    left: submenuOpenLeft ? 'auto' : '98%',
                    right: submenuOpenLeft ? '98%' : 'auto',
                    top: submenuOpenUp ? 'auto' : '-6px',
                    bottom: submenuOpenUp ? '-6px' : 'auto',
                  }}
                >
                  {it.children!.map((sub: MenuItem, si: number) =>
                    sub.divider ? (
                      <div key={si} className="my-1 border-t border-white/5" />
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
                            ? 'text-slate-600 cursor-not-allowed opacity-50'
                            : sub.danger
                              ? 'text-[#f87171] hover:bg-[#ef4444]/10'
                              : 'text-slate-200 hover:bg-white/5'
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

const FileNode: React.FC<FileNodeProps> = ({ name, path, isDir, depth, onRefreshParent }) => {
  const { 
    expandedFolders, 
    toggleFolder, 
    openFile, 
    activeTabPath, 
    openTerminal,
    gitFileStatuses,
    gitDirtyFolders,
    currentProject,
    gitBranch,
    gitRoots
  } = useWorkspaceStore();
  const isExpanded = !!expandedFolders[path];
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [activeGitModal, setActiveGitModal] = useState<'commit' | 'branches' | 'remotes' | 'stash' | 'history' | 'rollback' | 'push' | 'pull' | null>(null);

  const rootPath = currentProject?.codePath || currentProject?.path || '';
  
  const nodeGitRoot = React.useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return null;
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || null;
  }, [path, gitRoots]);

  const isGitRepo = nodeGitRoot !== null;
  const getRelativePath = (absolutePath: string, root: string) => {
    if (!root || absolutePath === root) return '';
    let rel = absolutePath.substring(root.length);
    if (rel.startsWith('/') || rel.startsWith('\\')) {
      rel = rel.substring(1);
    }
    return rel.replace(/\\/g, '/');
  };
  const relPath = getRelativePath(path, rootPath);

  const getGitStatusColorClass = () => {
    const isCommonIgnored = name === 'node_modules' 
      || name === 'target' 
      || name === 'dist' 
      || name === 'build'
      || name.startsWith('.');

    if (isDir) {
      const folderStatus = gitDirtyFolders[path];
      if (folderStatus) {
        if (folderStatus.notAdded) return 'text-[#f87171]'; // Red for not add
        if (folderStatus.modified) return 'text-[#60a5fa]'; // Blue for modified
        if (folderStatus.added) return 'text-[#4ade80]'; // Green for added
        if (folderStatus.untracked) return 'text-[#fb923c]'; // Orange/Yellow for untracked
      }
      if (isCommonIgnored) return 'text-slate-500';
    } else {
      const statusXY = gitFileStatuses[path];
      if (statusXY) {
        if (statusXY === '??') return 'text-[#fb923c]'; // Orange/Yellow for untracked
        if (statusXY === '!!') return 'text-slate-500'; // Gray for ignored
        if (statusXY.includes('D')) return 'text-red-400 line-through'; // Deleted
        
        const X = statusXY[0];
        const Y = statusXY[1];
        if (Y === 'M') return 'text-[#f87171]'; // Red for not add (unstaged change)
        if (X === 'M') return 'text-[#60a5fa]'; // Blue for modified (staged modification)
        if (X === 'A' || X === 'R') return 'text-[#4ade80]'; // Green for added (staged addition)
      }
      if (isCommonIgnored) return 'text-slate-500';
    }
    return '';
  };
  const statusColorClass = getGitStatusColorClass();

  const loadChildren = async () => {
    if (!isDir) return;
    setLoading(true);
    try {
      const res = await window.electronAPI.localListDir(path);
      setChildren(res);
    } catch (err) {
      console.error('Failed to load dir:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isDir && isExpanded) {
      loadChildren();
    }
  }, [path, isExpanded]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFolder(path);
  };

  const handleFileClick = () => {
    if (!isDir) {
      openFile(path, name);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !isCreating) return;

    try {
      const isCreateDir = isCreating === 'folder';
      await window.electronAPI.localCreateNode(path, newItemName.trim(), isCreateDir);
      setIsCreating(null);
      setNewItemName('');
      loadChildren();
    } catch (err: any) {
      alert('创建失败: ' + err.message);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    try {
      await window.electronAPI.localDeleteNode(path);
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    } finally {
      setIsDeleteModalOpen(false);
    }
  };

  const getFileIcon = (fileName: string) => {
    return getFileIconUtil(fileName);
  };

  const isSelected = activeTabPath === path;

  const buildMenuItems = () => {
    const items: MenuItem[] = [];

    // 1. If folder, place 'Open in Terminal' at the very top
    if (isDir) {
      items.push({
        label: 'Open in Terminal',
        onClick: () => {
          openTerminal(path, name);
        }
      });
    }

    // 2. Add base items: Open (files only) and Reveal in Finder (both)
    if (!isDir) {
      items.push({
        label: 'Open',
        onClick: () => {
          openFile(path, name);
        }
      });
    }

    items.push(
      {
        label: 'Reveal in Finder',
        onClick: async () => {
          const getParentPath = (filePath: string) => {
            const isWindows = filePath.includes('\\') || (!filePath.startsWith('/') && filePath.includes(':'));
            const sep = isWindows ? '\\' : '/';
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
            if (!isExpanded) toggleFolder(path);
            setIsCreating('file');
          }
        },
        {
          label: 'New Folder',
          onClick: () => {
            if (!isExpanded) toggleFolder(path);
            setIsCreating('folder');
          }
        },
        { divider: true }
      );
    }

    items.push(
      {
        label: 'Copy Path',
        onClick: (e: React.MouseEvent) => {
          copyToClipboard(path, e);
        }
      },
      {
        label: 'Copy Relative Path',
        onClick: (e: React.MouseEvent) => {
          const rootPath = currentProject?.codePath || currentProject?.path || '';
          let relPath = path.substring(rootPath.length);
          if (relPath.startsWith('/') || relPath.startsWith('\\')) {
            relPath = relPath.substring(1);
          }
          copyToClipboard(relPath || '.', e);
        }
      },
      { divider: true }
    );

    if (!isDir) {
      items.push(
        {
          label: 'Attach to Agent',
          onClick: async (e: React.MouseEvent) => {
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
              copyToClipboard('已成功关联到 Agent', e);
            } catch (err: any) {
              alert('关联失败: ' + err.message);
            }
          }
        },
        { divider: true }
      );
    }

    const canAdd = (() => {
      if (isDir) {
        const folderStatus = gitDirtyFolders[path];
        return folderStatus ? (folderStatus.notAdded || folderStatus.untracked) : false;
      } else {
        const statusXY = gitFileStatuses[path];
        if (!statusXY) return false;
        if (statusXY === '??') return true;
        const Y = statusXY[1] || ' ';
        return Y === 'M' || Y === 'D';
      }
    })();

    const hasChanges = isDir ? !!gitDirtyFolders[path] : !!gitFileStatuses[path];

    // Git submenu
    const gitMenu: MenuItem = {
      label: 'Git',
      children: isGitRepo ? [
        {
          label: 'Commit File...',
          onClick: () => {
            setActiveGitModal('commit');
          }
        },
        {
          label: 'Add to Git',
          disabled: !canAdd,
          onClick: async () => {
            try {
              const { runGitAdd } = useWorkspaceStore.getState();
              await runGitAdd(path);
            } catch (err: any) {
              alert('Stage file failed: ' + err.message);
            }
          }
        },
        {
          label: 'Rollback...',
          disabled: !hasChanges,
          onClick: () => {
            setActiveGitModal('rollback');
          }
        },
        { divider: true },
        {
          label: 'Push...',
          onClick: () => {
            setActiveGitModal('push');
          }
        },
        {
          label: 'Pull...',
          onClick: () => {
            setActiveGitModal('pull');
          }
        },
        {
          label: 'Fetch',
          onClick: async () => {
            try {
              let targetRoot = currentProject?.codePath || currentProject?.path || '';
              if (gitRoots && gitRoots.length > 0) {
                const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
                const matched = sorted.find(r => path.startsWith(r));
                if (matched) targetRoot = matched;
              }
              await window.electronAPI.gitFetch(targetRoot);
              const { refreshGitStatus } = useWorkspaceStore.getState();
              await refreshGitStatus();
              alert('Fetch 成功！');
            } catch (err: any) {
              alert('Fetch 失败: ' + err.message);
            }
          }
        },
        { divider: true },
        {
          label: 'Branches...',
          onClick: () => {
            setActiveGitModal('branches');
          }
        },
        {
          label: 'Manage Remotes...',
          onClick: () => {
            setActiveGitModal('remotes');
          }
        },
        { divider: true },
        {
          label: 'Stash Changes...',
          onClick: () => {
            setActiveGitModal('stash');
          }
        },
        {
          label: 'Show History',
          onClick: () => {
            setActiveGitModal('history');
          }
        }
      ] : [
        {
          label: 'Initialize Git Repository',
          onClick: async () => {
            try {
              const { runGitInit } = useWorkspaceStore.getState();
              await runGitInit();
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
        setIsDeleteModalOpen(true);
      }
    });

    return items;
  };

  return (
    <div className="select-none">
      <div
        className={`group flex items-center justify-between py-1 px-2 hover:bg-white/5 rounded cursor-pointer transition-colors text-[11px] ${
          isSelected ? 'bg-primary/20 border-l-2 border-primary pl-[6px]' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + (isSelected ? 6 : 8)}px` }}
        onClick={isDir ? handleToggle : handleFileClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
          {isDir ? (
            <>
              {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
              {getFolderIcon(name, isExpanded)}
            </>
          ) : (
            getFileIcon(name)
          )}
          <span className={`truncate ${statusColorClass || (isSelected ? 'text-primary font-medium' : 'text-slate-300 group-hover:text-white')}`}>
            {name}
          </span>
        </div>

        {/* Action buttons */}
        <div className="hidden group-hover:flex items-center space-x-1 flex-shrink-0 pr-1">
          {isDir && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setIsCreating('file'); }}
                className="p-0.5 hover-gradient-primary rounded text-slate-400"
                title="新建文件"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsCreating('folder'); }}
                className="p-0.5 hover-gradient-primary rounded text-slate-400"
                title="新建文件夹"
              >
                <Folder className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Input container */}
      {isCreating && (
        <form onSubmit={handleCreate} className="flex items-center space-x-1 py-1 pr-2" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
          <input
            type="text"
            autoFocus
            placeholder={isCreating === 'file' ? '文件名...' : '文件夹名...'}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onBlur={() => { setIsCreating(null); setNewItemName(''); }}
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
              path={joinPath(path, child.name)}
              isDir={child.isDir}
              depth={depth + 1}
              onRefreshParent={loadChildren}
            />
          ))}
        </div>
      )}

      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
        title={`确定要删除 ${name} 吗？`}
        description={isDir ? "删除该目录将同时递归删除其包含的全部子目录与文件，此操作不可恢复。" : "此文件将被从本地硬盘中彻底删除，且无法恢复。"}
      />

      {ctxMenu && (
        <FileExplorerContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildMenuItems()}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {activeGitModal === 'commit' && (
        <CommitDialog
          path={path}
          onClose={() => {
            setActiveGitModal(null);
            useWorkspaceStore.getState().refreshGitStatus();
          }}
        />
      )}
      {activeGitModal === 'branches' && (
        <BranchesDialog
          path={path}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal === 'remotes' && (
        <RemotesDialog
          path={path}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal === 'stash' && (
        <StashDialog
          path={path}
          onClose={() => {
            setActiveGitModal(null);
            useWorkspaceStore.getState().refreshGitStatus();
          }}
        />
      )}
      {activeGitModal === 'history' && (
        <HistoryDialog
          path={path}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal === 'rollback' && (
        <RollbackDialog
          path={path}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal === 'push' && (
        <PushDialog
          path={path}
          onClose={() => setActiveGitModal(null)}
        />
      )}
      {activeGitModal === 'pull' && (
        <PullDialog
          path={path}
          onClose={() => setActiveGitModal(null)}
        />
      )}
    </div>
  );
};

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
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);

  useEffect(() => {
    if (currentProject) {
      refreshGitStatus();
      
      const handleFocus = () => {
        refreshGitStatus();
      };
      window.addEventListener('focus', handleFocus);
      return () => {
        window.removeEventListener('focus', handleFocus);
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

  if (!currentProject) return null;

  const rootPath = currentProject.codePath || currentProject.path;

  return (
    <div className="flex flex-col h-full bg-[#0f1117] border-r border-white/5 select-none w-full">
      <div className="p-3 border-b border-white/5 flex items-center justify-between flex-shrink-0 bg-slate-950/20">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">资源管理器</h3>
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
            className="p-1 rounded text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
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
              showSearch ? 'bg-primary/20 text-primary' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
            title="搜索文件"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-slate-500 max-w-[80px] truncate" title={currentProject.name}>
            {currentProject.name}
          </span>
        </div>
      </div>

      {showSearch && (
        <div className="p-2 border-b border-white/5 bg-slate-950/40 flex-shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索项目文件..."
              className="w-full bg-slate-900 border border-white/10 focus:border-primary/50 text-xs text-white rounded px-2.5 py-1.5 pl-7 focus:outline-none placeholder-slate-500 font-mono transition-all"
              autoFocus
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
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
            <div className="p-4 text-center text-slate-500 text-xs font-mono">
              正在搜索中...
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-xs font-mono">
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
                  className="flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer transition-colors text-xs text-slate-300 hover:text-white"
                >
                  {item.isDir ? (
                    <Folder className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  ) : (
                    getFileIconUtil(item.name)
                  )}
                  
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-mono truncate">{item.name}</span>
                    <span className="text-[9px] text-slate-500 truncate font-mono select-all">
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
    </div>
  );
};
