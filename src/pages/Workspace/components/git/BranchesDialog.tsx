import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import {
  GitBranch,
  Search,
  Plus,
  RefreshCw,
  Tag,
  Check,
  Loader2,
  MoreHorizontal,
  Edit3,
  Trash2,
  GitMerge,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { ModalDialog, confirmDialog } from '../../../../components/ui/ModalDialog';
import { toast } from '../../../../contexts/useToastStore';
import { findGitRootForPath, getBasename } from '../../../../utils/path';
import { GitErrorBanner } from './GitErrorBanner';

interface BranchesDialogProps {
  path: string;
  projectPath?: string;
  onClose: () => void;
}

interface BranchItem {
  name: string;
  is_remote: boolean;
  is_current: boolean;
}

interface PopoverMenuProps {
  anchorRect: DOMRect;
  branch: BranchItem;
  onClose: () => void;
  onCheckout: () => void;
  onNewBranch: () => void;
  onMerge: () => void;
  onRename: () => void;
  onCreateTag: () => void;
  onDelete: () => void;
}

const BranchActionPopover: React.FC<PopoverMenuProps> = ({
  anchorRect,
  branch,
  onClose,
  onCheckout,
  onNewBranch,
  onMerge,
  onRename,
  onCreateTag,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchorRect.right, top: anchorRect.bottom, ready: false });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;

    let left = anchorRect.right - rect.width;
    if (left < pad) left = Math.min(anchorRect.left, window.innerWidth - rect.width - pad);
    left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));

    let top = anchorRect.bottom + 4;
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, anchorRect.top - rect.height - 4);
    }

    setPos({ left, top, ready: true });
  }, [anchorRect]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('keydown', handleEsc, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('keydown', handleEsc, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className={`fixed z-[10050] min-w-[200px] bg-card text-text-primary border border-border-primary rounded-xl shadow-2xl py-1.5 text-xs select-none transition-opacity duration-75 ${
        pos.ready ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: pos.left, top: pos.top }}
    >
      {!branch.is_current && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onCheckout();
            onClose();
          }}
          className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
        >
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          <span>检出到此分支 (Checkout)</span>
        </button>
      )}
      {!branch.is_current && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onMerge();
            onClose();
          }}
          className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
        >
          <GitMerge className="w-3.5 h-3.5 text-sky-500" />
          <span>合并到当前分支 (Merge)</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onNewBranch();
          onClose();
        }}
        className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5 text-primary" />
        <span>基于此分支新建分支...</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCreateTag();
          onClose();
        }}
        className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center gap-2 cursor-pointer"
      >
        <Tag className="w-3.5 h-3.5 text-amber-500" />
        <span>基于此分支打标签...</span>
      </button>

      {!branch.is_remote && (
        <>
          <hr className="my-1 border-0 border-t border-border-primary" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onRename();
              onClose();
            }}
            className="w-full text-left px-3.5 py-1.5 hover:bg-background-tertiary flex items-center justify-between gap-2 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5" />
              <span>重命名分支</span>
            </span>
            <span className="text-[10px] font-mono text-text-tertiary">F2</span>
          </button>
          {!branch.is_current && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="w-full text-left px-3.5 py-1.5 text-functional-error hover:bg-functional-error/10 flex items-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除本地分支</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};

export const BranchesDialog: React.FC<BranchesDialogProps> = ({
  path,
  projectPath: explicitProjectPath,
  onClose,
}) => {
  const { currentProject, gitRoots, syncWorkspaceAfterGitChange, setGitSyncLabel } =
    useWorkspaceStore();

  const repoPath = useMemo(
    () =>
      explicitProjectPath ||
      findGitRootForPath(path, gitRoots, currentProject?.codePath || currentProject?.path || path),
    [explicitProjectPath, path, gitRoots, currentProject]
  );

  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [showTagsSection, setShowTagsSection] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [selectedBranchName, setSelectedBranchName] = useState<string | null>(null);
  const [activePopover, setActivePopover] = useState<{
    branch: BranchItem;
    rect: DOMRect;
  } | null>(null);

  // Sub-modals
  const [newBranchModal, setNewBranchModal] = useState<{
    open: boolean;
    base: string;
    name: string;
    checkout: boolean;
    overwriteExisting: boolean;
  }>({ open: false, base: 'HEAD', name: '', checkout: true, overwriteExisting: false });

  const [renameModal, setRenameModal] = useState<{
    open: boolean;
    oldName: string;
    newName: string;
  }>({ open: false, oldName: '', newName: '' });

  const [tagModal, setTagModal] = useState<{
    open: boolean;
    commit: string;
    name: string;
    message: string;
    force: boolean;
  }>({ open: false, commit: 'HEAD', name: '', message: '', force: false });

  const loadData = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const [branchList, tagList] = await Promise.all([
        window.electronAPI.gitBranches(repoPath),
        window.electronAPI.gitTags(repoPath).catch(() => []),
      ]);
      setBranches(branchList);
      setTags(tagList);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Wire F2 rename shortcut for selected local branch
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2') return;
      if (newBranchModal.open || renameModal.open || tagModal.open) return;
      const activeTag = (document.activeElement as HTMLElement)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      if (!selectedBranchName) return;
      const found = branches.find((b) => !b.is_remote && b.name === selectedBranchName);
      if (found) {
        e.preventDefault();
        setRenameModal({ open: true, oldName: found.name, newName: found.name });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedBranchName, branches, newBranchModal.open, renameModal.open, tagModal.open]);

  const handleFetch = async () => {
    if (!repoPath) return;
    setBusy(true);
    setError(null);
    setGitSyncLabel('正在获取远端分支...');
    try {
      await window.electronAPI.gitFetch(repoPath);
      await loadData();
      await syncWorkspaceAfterGitChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setGitSyncLabel(null);
    }
  };

  const handleCheckout = async (branchName: string) => {
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitCheckout(repoPath, branchName);
      await loadData();
      await syncWorkspaceAfterGitChange();
      toast.success(`已切换到分支 ${branchName}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = async (branchName: string) => {
    const confirmed = await confirmDialog({
      title: '合并分支',
      message: `确定要将分支 "${branchName}" 合并到当前分支吗？`,
      confirmText: '执行合并',
      variant: 'primary',
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const out = await window.electronAPI.gitMergeBranch(repoPath, branchName);
      await loadData();
      await syncWorkspaceAfterGitChange();
      toast.success(`已合并 ${branchName}`, out || undefined);
    } catch (err) {
      await syncWorkspaceAfterGitChange();
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBranch = async (branchName: string) => {
    const confirmed = await confirmDialog({
      title: '删除本地分支',
      message: `确定要删除本地分支 "${branchName}" 吗？`,
      confirmText: '删除分支',
      variant: 'danger',
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitDeleteBranch(repoPath, branchName, false);
      await loadData();
      await syncWorkspaceAfterGitChange();
      toast.success(`已删除分支 ${branchName}`);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.toLowerCase().includes('not fully merged')) {
        const forceConfirm = await confirmDialog({
          title: '分支包含未合并提交',
          message: `分支 "${branchName}" 还有尚未合并到当前分支的提交。确定要使用 -D 强制删除并丢弃该分支指针吗？`,
          confirmText: '强制删除 (-D)',
          variant: 'danger',
        });
        if (forceConfirm) {
          try {
            await window.electronAPI.gitDeleteBranch(repoPath, branchName, true);
            await loadData();
            await syncWorkspaceAfterGitChange();
            toast.success(`已强制删除分支 ${branchName}`);
          } catch (forceErr) {
            setError(forceErr);
          }
        }
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    const confirmed = await confirmDialog({
      title: '删除本地标签',
      message: `确定要删除本地标签 "${tagName}" 吗？`,
      confirmText: '删除标签',
      variant: 'danger',
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitDeleteTag(repoPath, tagName);
      await loadData();
      await syncWorkspaceAfterGitChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitNewBranch = async () => {
    const name = newBranchModal.name.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitCreateBranch(
        repoPath,
        name,
        newBranchModal.base || null,
        newBranchModal.checkout,
        newBranchModal.overwriteExisting
      );
      setNewBranchModal((p) => ({ ...p, open: false, name: '' }));
      await loadData();
      await syncWorkspaceAfterGitChange();
      toast.success(`分支 ${name} 创建成功`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const newName = renameModal.newName.trim();
    if (!newName || newName === renameModal.oldName) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitRenameBranch(repoPath, renameModal.oldName, newName);
      setRenameModal({ open: false, oldName: '', newName: '' });
      await loadData();
      await syncWorkspaceAfterGitChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCreateTag = async () => {
    const tagName = tagModal.name.trim();
    if (!tagName) return;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.gitCreateTag(
        repoPath,
        tagName,
        tagModal.commit || null,
        tagModal.message.trim() || null,
        tagModal.force
      );
      setTagModal({ open: false, commit: 'HEAD', name: '', message: '', force: false });
      await loadData();
      await syncWorkspaceAfterGitChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const localBranches = branches.filter((b) => !b.is_remote && b.name.toLowerCase().includes(q));
  const remoteBranches = branches.filter((b) => b.is_remote && b.name.toLowerCase().includes(q));
  const filteredTags = tags.filter((t) => t.toLowerCase().includes(q));

  return (
    <>
      <ModalDialog
        isOpen={true}
        onClose={onClose}
        size="md"
        preventClose={busy}
        icon={<GitBranch className="w-4 h-4 text-primary" />}
        title="分支与标签管理"
        subtitle={getBasename(repoPath)}
        headerExtra={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleFetch}
              disabled={busy || loading}
              title="获取远端最新分支 (Fetch)"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-primary bg-background-primary hover:bg-background-tertiary text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
              <span>Fetch</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setNewBranchModal({
                  open: true,
                  base: branches.find((b) => b.is_current)?.name || 'HEAD',
                  name: '',
                  checkout: true,
                  overwriteExisting: false,
                })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-[11px] font-medium transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>新建分支</span>
            </button>
          </div>
        }
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
        <div className="flex flex-col h-[470px] max-h-[68vh] p-4 gap-3 overflow-hidden">
          {Boolean(error) && <GitErrorBanner error={error} onDismiss={() => setError(null)} />}

          {/* Search */}
          <div className="relative flex-shrink-0">
            <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索本地分支、远端分支或标签...（选中本地分支按 F2 重命名）"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border-primary bg-background-primary text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-4 pr-1">
            {loading ? (
              <div className="flex items-center justify-center h-full text-xs text-text-secondary gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>正在加载分支与标签...</span>
              </div>
            ) : (
              <>
                {/* Local Branches */}
                <section className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-1">
                    本地分支 ({localBranches.length})
                  </div>
                  {localBranches.length === 0 ? (
                    <div className="text-xs text-text-tertiary px-2 py-2">无匹配的本地分支</div>
                  ) : (
                    localBranches.map((branch) => {
                      const isSel = selectedBranchName === branch.name;
                      return (
                        <div
                          key={branch.name}
                          onClick={() => setSelectedBranchName(branch.name)}
                          onDoubleClick={() => {
                            if (!branch.is_current) handleCheckout(branch.name);
                          }}
                          className={`group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                            branch.is_current
                              ? 'bg-primary/15 text-primary font-semibold border border-primary/25'
                              : isSel
                                ? 'bg-background-tertiary text-text-primary'
                                : 'hover:bg-background-tertiary/70 text-text-primary'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="font-mono truncate">{branch.name}</span>
                            {branch.is_current && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-white font-sans">
                                当前
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            aria-label={`操作分支 ${branch.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBranchName(branch.name);
                              setActivePopover({
                                branch,
                                rect: e.currentTarget.getBoundingClientRect(),
                              });
                            }}
                            className="p-1 rounded hover:bg-background-primary text-text-tertiary hover:text-text-primary cursor-pointer"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </section>

                {/* Remote Branches */}
                <section className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-1">
                    远端分支 ({remoteBranches.length})
                  </div>
                  {remoteBranches.length === 0 ? (
                    <div className="text-xs text-text-tertiary px-2 py-2">暂无远端跟踪分支</div>
                  ) : (
                    remoteBranches.map((branch) => (
                      <div
                        key={branch.name}
                        onClick={() => setSelectedBranchName(branch.name)}
                        onDoubleClick={() => handleCheckout(branch.name)}
                        className="group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs hover:bg-background-tertiary/70 text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <GitBranch className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          <span className="font-mono truncate">{branch.name}</span>
                        </div>
                        <button
                          type="button"
                          aria-label={`操作远端分支 ${branch.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePopover({
                              branch,
                              rect: e.currentTarget.getBoundingClientRect(),
                            });
                          }}
                          className="p-1 rounded hover:bg-background-primary text-text-tertiary hover:text-text-primary cursor-pointer"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </section>

                {/* Collapsible Tags */}
                <section className="space-y-1 pt-1 border-t border-border-primary/70">
                  <button
                    type="button"
                    onClick={() => setShowTagsSection((v) => !v)}
                    className="w-full flex items-center justify-between px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-primary cursor-pointer"
                  >
                    <span className="flex items-center gap-1">
                      {showTagsSection ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <span>标签 Tags ({filteredTags.length})</span>
                    </span>
                  </button>
                  {showTagsSection && (
                    <div className="space-y-1 pl-2">
                      {filteredTags.length === 0 ? (
                        <div className="text-xs text-text-tertiary px-2 py-1">暂无标签</div>
                      ) : (
                        filteredTags.map((tag) => (
                          <div
                            key={tag}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs hover:bg-background-tertiary/70"
                          >
                            <span className="flex items-center gap-2 font-mono text-text-primary truncate">
                              <Tag className="w-3 h-3 text-amber-500 flex-shrink-0" />
                              <span className="truncate">{tag}</span>
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleCheckout(tag)}
                                className="px-2 py-0.5 rounded border border-border-primary bg-background-primary hover:bg-background-tertiary text-[10px] text-text-secondary hover:text-text-primary cursor-pointer"
                              >
                                检出
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTag(tag)}
                                title="删除标签"
                                className="p-1 rounded text-text-tertiary hover:text-functional-error hover:bg-functional-error/10 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>

        {activePopover && (
          <BranchActionPopover
            anchorRect={activePopover.rect}
            branch={activePopover.branch}
            onClose={() => setActivePopover(null)}
            onCheckout={() => handleCheckout(activePopover.branch.name)}
            onMerge={() => handleMerge(activePopover.branch.name)}
            onNewBranch={() =>
              setNewBranchModal({
                open: true,
                base: activePopover.branch.name,
                name: '',
                checkout: true,
                overwriteExisting: false,
              })
            }
            onRename={() =>
              setRenameModal({
                open: true,
                oldName: activePopover.branch.name,
                newName: activePopover.branch.name,
              })
            }
            onCreateTag={() =>
              setTagModal({
                open: true,
                commit: activePopover.branch.name,
                name: '',
                message: '',
                force: false,
              })
            }
            onDelete={() => handleDeleteBranch(activePopover.branch.name)}
          />
        )}
      </ModalDialog>

      {/* New Branch Sub-Modal */}
      <ModalDialog
        isOpen={newBranchModal.open}
        onClose={() => setNewBranchModal((p) => ({ ...p, open: false }))}
        size="sm"
        title="新建分支"
        subtitle={`基准起点: ${newBranchModal.base}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setNewBranchModal((p) => ({ ...p, open: false }))}
              className="px-3.5 py-1.5 rounded-lg text-xs text-text-secondary bg-background-tertiary border border-border-primary cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submitNewBranch}
              disabled={!newBranchModal.name.trim() || busy}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary hover:bg-primary/90 disabled:opacity-45 text-white cursor-pointer"
            >
              创建分支
            </button>
          </>
        }
      >
        <div className="p-4 space-y-3 text-xs">
          <div className="space-y-1">
            <label className="block font-medium text-text-secondary">新分支名称</label>
            <input
              type="text"
              autoFocus
              value={newBranchModal.name}
              onChange={(e) => setNewBranchModal((p) => ({ ...p, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewBranch();
              }}
              placeholder="例如 feat/git-ux"
              className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 font-mono text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-text-secondary">
            <input
              type="checkbox"
              checked={newBranchModal.checkout}
              onChange={(e) => setNewBranchModal((p) => ({ ...p, checkout: e.target.checked }))}
              className="rounded border-border-primary text-primary"
            />
            <span>创建后立即检出 (Checkout)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-amber-600 dark:text-amber-400">
            <input
              type="checkbox"
              checked={newBranchModal.overwriteExisting}
              onChange={(e) =>
                setNewBranchModal((p) => ({ ...p, overwriteExisting: e.target.checked }))
              }
              className="rounded border-border-primary text-amber-500"
            />
            <span>若同名分支已存在则强制重置 (-B / -f)</span>
          </label>
        </div>
      </ModalDialog>

      {/* Rename Branch Sub-Modal */}
      <ModalDialog
        isOpen={renameModal.open}
        onClose={() => setRenameModal((p) => ({ ...p, open: false }))}
        size="sm"
        title="重命名分支"
        subtitle={`原分支名: ${renameModal.oldName}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setRenameModal((p) => ({ ...p, open: false }))}
              className="px-3.5 py-1.5 rounded-lg text-xs text-text-secondary bg-background-tertiary border border-border-primary cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submitRename}
              disabled={!renameModal.newName.trim() || busy}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary hover:bg-primary/90 disabled:opacity-45 text-white cursor-pointer"
            >
              确认重命名
            </button>
          </>
        }
      >
        <div className="p-4 space-y-2 text-xs">
          <label className="block font-medium text-text-secondary">新分支名称</label>
          <input
            type="text"
            autoFocus
            value={renameModal.newName}
            onChange={(e) => setRenameModal((p) => ({ ...p, newName: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
            }}
            className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 font-mono text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
      </ModalDialog>

      {/* Create Tag Sub-Modal */}
      <ModalDialog
        isOpen={tagModal.open}
        onClose={() => setTagModal((p) => ({ ...p, open: false }))}
        size="sm"
        title="创建标签 (Tag)"
        subtitle={`目标位置: ${tagModal.commit}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setTagModal((p) => ({ ...p, open: false }))}
              className="px-3.5 py-1.5 rounded-lg text-xs text-text-secondary bg-background-tertiary border border-border-primary cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submitCreateTag}
              disabled={!tagModal.name.trim() || busy}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-45 text-white cursor-pointer"
            >
              创建标签
            </button>
          </>
        }
      >
        <div className="p-4 space-y-3 text-xs">
          <div className="space-y-1">
            <label className="block font-medium text-text-secondary">标签名称</label>
            <input
              type="text"
              autoFocus
              value={tagModal.name}
              onChange={(e) => setTagModal((p) => ({ ...p, name: e.target.value }))}
              placeholder="例如 v1.2.0"
              className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 font-mono text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="block font-medium text-text-secondary">附注说明 (可选)</label>
            <input
              type="text"
              value={tagModal.message}
              onChange={(e) => setTagModal((p) => ({ ...p, message: e.target.value }))}
              placeholder="填写则创建带附注的 Tag (-a)"
              className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-text-primary focus:outline-none focus:border-primary"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-text-secondary">
            <input
              type="checkbox"
              checked={tagModal.force}
              onChange={(e) => setTagModal((p) => ({ ...p, force: e.target.checked }))}
              className="rounded border-border-primary text-amber-500"
            />
            <span>覆盖已存在的同名标签 (-f)</span>
          </label>
        </div>
      </ModalDialog>
    </>
  );
};
