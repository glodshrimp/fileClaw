import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Folder, File as FileIcon, ArrowLeft, RefreshCw, Home,
  Trash2, HardDrive, ChevronRight, FolderPlus, Copy, Clipboard,
  Edit3, Download, Upload, ArrowRightLeft, Loader2, Shield, X, Check
} from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { TransferJob } from '../../types';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
interface FsItem {
  name: string;
  size: number;
  mtime: number;
  ctime: number;
  isDir: boolean;
}

interface DragPayload {
  item: FsItem;
  fullPath: string;
  side: 'local' | 'remote';
}

interface CtxMenu {
  x: number; y: number;
  item: FsItem | null;
  currentPath: string;
  side: 'local' | 'remote';
}

// TransferJob is now defined in types/index.ts and imported above

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const sep = '/';
const join = (base: string, name: string) =>
  base === sep ? `${sep}${name}` : `${base}${sep}${name}`;
const parentOf = (p: string) => {
  const parts = p.split(sep).filter(Boolean);
  if (parts.length === 0) return sep;
  parts.pop();
  return parts.length === 0 ? sep : sep + parts.join(sep);
};
const localJoin = (base: string, name: string) => {
  const s = base.endsWith('/') || base.endsWith('\\') ? base : base + '/';
  return s + name;
};
const localParent = (p: string) => {
  // works for both macOS / Linux paths
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (idx <= 0) return p;
  return p.slice(0, idx) || '/';
};
const formatSize = (bytes: number, isDir: boolean) => {
  if (isDir) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024, sz = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), 3);
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sz[i];
};
const formatDate = (ms: number) =>
  ms ? new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

/** Format bytes/s into human-readable speed string with auto unit switching */
const formatSpeed = (bytesPerSec: number): string => {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
};

// ──────────────────────────────────────────────────────────────
// Chmod Modal
// ──────────────────────────────────────────────────────────────
interface ChmodTarget { item: FsItem; fullPath: string; }

const PERM_LABELS = ['读(r)', '写(w)', '执行(x)'];
const OWNER_LABELS = ['所有者', '用户组', '其他用户'];

const ChmodModal: React.FC<{
  target: ChmodTarget;
  initialOctal: string;
  onClose: () => void;
  onApply: (mode: number) => Promise<void>;
}> = ({ target, initialOctal, onClose, onApply }) => {
  // Parse initial mode from octal string (e.g. '0755' or '755')
  const parseBits = (oct: string): boolean[][] => {
    const n = parseInt(oct.replace(/^0+/, '') || '0', 8);
    return [2, 1, 0].map((shift) => {
      const nibble = (n >> (shift * 3)) & 0o7;
      return [(nibble >> 2) & 1, (nibble >> 1) & 1, nibble & 1].map(Boolean);
    });
  };

  const [bits, setBits] = useState<boolean[][]>(() => parseBits(initialOctal));
  const [octetInput, setOctetInput] = useState(initialOctal.replace(/^0+/, '').padStart(3, '0'));
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Compute octal from bits
  const bitsToOctal = (b: boolean[][]): number => {
    return b.reduce((acc, row, i) => {
      const shift = (2 - i) * 3;
      const val = (row[0] ? 4 : 0) + (row[1] ? 2 : 0) + (row[2] ? 1 : 0);
      return acc + (val << shift);
    }, 0);
  };

  const toggleBit = (row: number, col: number) => {
    const nb = bits.map((r, ri) => r.map((v, ci) => ri === row && ci === col ? !v : v));
    setBits(nb);
    setOctetInput(bitsToOctal(nb).toString(8).padStart(3, '0'));
  };

  const handleOctetChange = (v: string) => {
    setOctetInput(v);
    if (/^[0-7]{3}$/.test(v)) {
      setBits(parseBits(v));
    }
  };

  const handleApply = async () => {
    if (!/^[0-7]{3}$/.test(octetInput)) { setErr('请输入有效的3位八进制数（如 755）'); return; }
    setApplying(true); setErr(null);
    try {
      await onApply(parseInt(octetInput, 8));
      onClose();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally { setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#141928] border border-white/10 rounded-2xl shadow-2xl w-[420px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Shield className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">修改权限</p>
              <p className="text-[11px] text-slate-400 truncate max-w-[260px]">{target.fullPath}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Permission grid */}
        <div className="px-5 pt-4 pb-2">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left text-[11px] text-slate-500 font-medium pb-2 w-24">主体</th>
                {PERM_LABELS.map(l => (
                  <th key={l} className="text-center text-[11px] text-slate-500 font-medium pb-2">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {OWNER_LABELS.map((owner, ri) => (
                <tr key={owner} className="border-t border-white/5">
                  <td className="py-2.5 text-xs text-slate-300 font-medium">{owner}</td>
                  {bits[ri].map((checked, ci) => (
                    <td key={ci} className="py-2.5 text-center">
                      <button
                        onClick={() => toggleBit(ri, ci)}
                        className={`w-7 h-7 rounded-lg border transition-all flex items-center justify-center mx-auto ${
                          checked
                            ? 'bg-blue-500/25 border-blue-400/50 text-blue-300'
                            : 'bg-white/5 border-white/10 text-slate-600 hover:border-white/20'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Octal input */}
        <div className="px-5 py-3 flex items-center gap-3">
          <span className="text-xs text-slate-400">八进制</span>
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-sm font-mono">0</span>
            <input
              type="text"
              maxLength={3}
              value={octetInput}
              onChange={(e) => handleOctetChange(e.target.value.replace(/[^0-7]/g, ''))}
              className="w-16 text-center font-mono text-sm bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
            />
          </div>
          <span className="text-xs text-slate-500 ml-1">
            → {['所有者','组','其他'].map((_, i) => bits[i].map(b => b ? '●' : '○').join('')).join(' ')}
          </span>
        </div>

        {err && <p className="px-5 text-xs text-red-400 -mt-1">⚠ {err}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            取消
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-1.5"
          >
            {applying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            应用
          </button>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Utility Modals
// ──────────────────────────────────────────────────────────────
const FileConflictModal: React.FC<{
  fileName: string;
  localFile: { size: number; mtime: number };
  remoteFile: { size: number; mtime: number };
  onCancel: () => void;
  onOverwrite: () => void;
  onRename: (newName: string) => void;
  onResume?: () => void;
}> = ({ fileName, localFile, remoteFile, onCancel, onOverwrite, onRename, onResume }) => {
  const [newName, setNewName] = useState(fileName);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-[#141928] border border-white/10 rounded-2xl shadow-2xl w-[460px] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">文件上传冲突</p>
              <p className="text-[11px] text-slate-400">发现同名文件，请选择操作</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex bg-white/5 rounded-xl border border-white/10 overflow-hidden text-xs">
            <div className="flex-1 p-3 border-r border-white/10 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                <span className="text-slate-400 font-medium uppercase tracking-wider text-[9px]">即将上传 (本地)</span>
              </div>
              <span className="text-white break-all font-mono text-xs leading-tight mb-1">{fileName}</span>
              <div className="flex justify-between items-center text-slate-400">
                <span>大小：</span>
                <span className="font-mono text-blue-300">{localFile.size.toLocaleString()} B</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>时间：</span>
                <span className="text-slate-300">{formatDate(localFile.mtime)}</span>
              </div>
            </div>
            <div className="flex-1 p-3 flex flex-col gap-1.5 bg-black/10">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
                <span className="text-slate-400 font-medium uppercase tracking-wider text-[9px]">已存在 (远程)</span>
              </div>
              <span className="text-white break-all font-mono text-xs leading-tight mb-1">{fileName}</span>
              <div className="flex justify-between items-center text-slate-400">
                <span>大小：</span>
                <span className="font-mono text-yellow-300">{remoteFile.size.toLocaleString()} B</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>时间：</span>
                <span className="text-slate-300">{formatDate(remoteFile.mtime)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400">如需重命名上传，请修改文件名：</span>
            <input 
              autoFocus 
              value={newName} 
              onChange={e => setNewName(e.target.value)} 
              onKeyDown={e => {
                if (e.key === 'Enter') onRename(newName);
                if (e.key === 'Escape') onCancel();
              }}
              className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400" 
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10 bg-black/20">
          <button onClick={onCancel} className="px-4 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">取消</button>
          {onResume && (
            <button onClick={onResume} className="px-4 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors shadow-lg shadow-emerald-500/20">断点续传</button>
          )}
          <button onClick={() => onRename(newName)} className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-lg shadow-blue-500/20">重命名上传</button>
          <button onClick={onOverwrite} className="px-4 py-1.5 text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors shadow-lg shadow-orange-500/20">直接覆盖</button>
        </div>
      </div>
    </div>
  );
};
const PromptModal: React.FC<{
  title: string;
  initialValue: string;
  onClose: () => void;
  onSubmit: (v: string) => void;
}> = ({ title, initialValue, onClose, onSubmit }) => {
  const [val, setVal] = useState(initialValue);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#141928] border border-white/10 rounded-2xl shadow-2xl w-[360px] p-5 flex flex-col" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
        <input autoFocus value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => {
            if (e.key === 'Enter') onSubmit(val);
            if (e.key === 'Escape') onClose();
        }} className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400" />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">取消</button>
          <button onClick={() => onSubmit(val)} className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">确认</button>
        </div>
      </div>
    </div>
  );
};

const ConfirmModal: React.FC<{
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
}> = ({ title, message, onClose, onConfirm }) => {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#141928] border border-white/10 rounded-2xl shadow-2xl w-[360px] p-5 flex flex-col" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-300 mb-5">{message}</p>
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">取消</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="px-4 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">确认</button>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Context Menu Component
// ──────────────────────────────────────────────────────────────
interface MenuItemDef { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; }
interface CtxMenuViewProps { menu: CtxMenu; items: MenuItemDef[]; onClose: () => void; }

const ContextMenuView: React.FC<CtxMenuViewProps> = ({ menu, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      let nx = menu.x;
      let ny = menu.y;
      if (nx + rect.width > window.innerWidth) nx = window.innerWidth - rect.width - 5;
      if (ny + rect.height > window.innerHeight) ny = window.innerHeight - rect.height - 5;
      setPos({ x: Math.max(5, nx), y: Math.max(5, ny) });
    }
  }, [menu.x, menu.y, items.length]);

  useEffect(() => {
    const handle = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-card rounded-xl shadow-2xl border border-border py-1 min-w-[200px] max-h-[85vh] overflow-y-auto scrollbar-thin"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          onClick={() => { it.onClick(); onClose(); }}
          className={`w-full flex items-center space-x-2.5 px-3 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            it.danger ? 'text-functional-error hover:bg-functional-error/10' : 'text-text-primary hover:bg-background-tertiary'
          }`}
        >
          <span className="w-4 flex-shrink-0">{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Single pane
// ──────────────────────────────────────────────────────────────
interface PaneProps {
  title: string;
  titleIcon: React.ReactNode;
  path: string;
  items: FsItem[];
  loading: boolean;
  error: string | null;
  homePath: string;
  side: 'local' | 'remote';
  dragRef: React.MutableRefObject<DragPayload | null>;
  dropHighlight: boolean;
  onNavigate: (path: string) => void;
  onDragStart: (payload: DragPayload) => void;
  onDrop: (targetPath: string, e: React.DragEvent) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onContextMenu: (e: React.MouseEvent, item: FsItem | null) => void;
  onSyncPath?: () => void;
}

const FilePane: React.FC<PaneProps> = ({
  title, titleIcon, path, items, loading, error, homePath, side,
  dragRef, dropHighlight,
  onNavigate, onDragStart, onDrop, onDragEnter, onDragLeave, onContextMenu,
  onSyncPath
}) => {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  useEffect(() => { setSelectedItem(null); }, [path]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const atRoot = path === sep || path === '';
  const parts = path.split(sep).filter(Boolean);
  const crumbs = [{ label: '/', path: sep }, ...parts.map((p, i) => ({
    label: p, path: sep + parts.slice(0, i + 1).join(sep)
  }))];

  // ── Editable address bar ──
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEditValue(path);
    setIsEditing(true);
    // Focus on next paint
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    });
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== path) {
      onNavigate(trimmed);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const dragCounter = useRef(0);

  return (
    <div
      className={`flex flex-col h-full border rounded-xl overflow-hidden transition-shadow ${
        dropHighlight ? 'border-primary shadow-lg shadow-primary/20 bg-primary/5' : 'border-border bg-background'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        } catch (_) {}
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current += 1;
        if (dragCounter.current === 1) {
          onDragEnter();
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
          dragCounter.current = 0;
          onDragLeave();
        }
      }}
      onDrop={(e) => { 
        e.preventDefault(); 
        e.stopPropagation();
        console.log('[FilePane] onDrop fired on path:', path);
        dragCounter.current = 0;
        onDragLeave(); 
        onDrop(path, e); 
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, null); }}
    >
      {/* Header */}
      <div className={`flex items-center space-x-2 px-3 py-2 border-b ${
        side === 'local' ? 'bg-background-secondary border-border' : 'bg-primary/5 border-primary/10'
      }`}>
        {titleIcon}
        <span className="font-semibold text-[10px] text-text-tertiary uppercase tracking-wider">{title}</span>
        {loading && <Loader2 className="w-3.5 h-3.5 ml-auto text-primary animate-spin" />}
      </div>

      {/* Toolbar */}
      <div className={`flex items-center px-2 py-1.5 gap-0.5 border-b ${
        side === 'local' ? 'bg-background-secondary/50 border-border' : 'bg-primary/5 border-primary/10'
      }`}>
        <button onClick={() => onNavigate(side === 'local' ? localParent(path) : parentOf(path))}
          disabled={atRoot || loading}
          className="p-1 rounded hover:bg-background-tertiary disabled:opacity-30 text-text-secondary flex-shrink-0" title="上级">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button onClick={() => onNavigate(homePath)}
          className="p-1 rounded hover:bg-background-tertiary text-text-secondary flex-shrink-0" title="主目录">
          <Home className="w-4 h-4" />
        </button>
        <button onClick={() => onNavigate(path)} disabled={loading}
          className="p-1 rounded hover:bg-background-tertiary text-text-secondary flex-shrink-0" title="刷新">
          <RefreshCw className="w-4 h-4" />
        </button>
        {onSyncPath && (
          <button onClick={onSyncPath} disabled={loading}
            className="p-1 rounded hover:bg-background-tertiary text-blue-500 hover:text-blue-600 flex-shrink-0 transition-colors" title="同步终端工作目录">
            <ArrowRightLeft className="w-4 h-4" />
          </button>
        )}

        {/* Address bar — breadcrumb or input */}
        <div className="flex-1 ml-1 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              onBlur={commitEdit}
              className="w-full px-2 py-0.5 text-xs font-mono bg-white border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-300 text-gray-800"
              placeholder="输入路径后按 Enter 导航..."
              spellCheck={false}
            />
          ) : (
            <div
              onClick={startEdit}
              title="点击输入路径"
              className={`flex items-center text-xs cursor-text rounded px-2 py-0.5 min-h-[22px] overflow-hidden hover:bg-white/80 transition-colors border border-transparent hover:border-gray-200 ${
                side === 'local' ? 'text-gray-600' : 'text-blue-700'
              }`}
            >
              {crumbs.map((c, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ChevronRight className="w-3 h-3 mx-0.5 text-gray-300 flex-shrink-0" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); onNavigate(c.path); }}
                    className="hover:text-blue-600 truncate max-w-[80px] flex-shrink-0"
                    title={c.path}
                  >
                    {c.label}
                  </button>
                </React.Fragment>
              ))}
              {/* Invisible clickable tail area to make the whole bar clickable */}
              <span className="flex-1 min-w-[20px]" />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 text-xs text-red-600 bg-red-50 border-b border-red-100 flex-shrink-0">
          ⚠ {error}
        </div>
      )}

      {/* File table — Virtualized using @tanstack/react-virtual */}
      <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin relative">
        <table className="w-full text-sm table-fixed">
          <thead className="sticky top-0 z-10 bg-background-secondary/95 backdrop-blur-sm shadow-sm">
            <tr className="text-text-tertiary text-[10px] uppercase border-b border-border">
              <th className="w-8 py-2 px-2"></th>
              <th className="text-left font-medium py-2 px-1">文件名</th>
              <th className="text-right font-medium py-2 px-3 w-20">大小</th>
              <th className="text-right font-medium py-2 px-3 w-32 hidden lg:table-cell">创建时间</th>
              <th className="text-right font-medium py-2 px-3 w-32 hidden xl:table-cell">修改时间</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr><td colSpan={5} className="py-10 text-center text-gray-300 text-sm">空目录</td></tr>
            ) : (
              <>
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }}>
                    <td colSpan={5} />
                  </tr>
                )}
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = items[virtualRow.index];
                  if (!item) return null;
                  return (
                    <tr
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        const fp = side === 'local' ? localJoin(path, item.name) : join(path, item.name);
                        onDragStart({ item, fullPath: fp, side });
                        e.dataTransfer.effectAllowed = 'copyMove';
                        e.dataTransfer.setData('application/json', JSON.stringify({ name: item.name, side }));
                        e.dataTransfer.setData('text/plain', item.name);
                      }}
                      onDoubleClick={() => {
                        if (item.isDir) {
                          const np = side === 'local' ? localJoin(path, item.name) : join(path, item.name);
                          onNavigate(np);
                        }
                      }}
                      onContextMenu={(e) => { 
                        e.preventDefault(); e.stopPropagation(); 
                        setSelectedItem(item.name);
                        onContextMenu(e, item); 
                      }}
                      onClick={() => setSelectedItem(item.name)}
                      className={`group cursor-pointer select-none border-b border-border/50 last:border-0 transition-colors h-[36px] ${
                        selectedItem === item.name 
                          ? 'bg-blue-500/10 shadow-[inset_3px_0_0_0_rgba(59,130,246,0.8)]' 
                          : 'hover:bg-primary/5'
                      }`}
                    >
                      <td className="w-8 py-2 px-2 text-center">
                        {item.isDir
                          ? <Folder className="w-4 h-4 text-amber-500 inline" />
                          : <FileIcon className="w-4 h-4 text-text-tertiary inline" />}
                      </td>
                      <td className="py-2 px-1 text-text-primary whitespace-nowrap overflow-hidden text-ellipsis" title={item.name}>
                        {item.name}
                      </td>
                      <td className="py-2 px-3 text-right text-text-secondary font-mono text-[11px] w-20">
                        {formatSize(item.size, item.isDir)}
                      </td>
                      <td className="py-2 px-3 text-right text-text-tertiary text-[11px] w-32 hidden lg:table-cell">
                        {formatDate(item.ctime)}
                      </td>
                      <td className="py-2 px-3 text-right text-text-tertiary text-[11px] w-32 hidden xl:table-cell">
                        {formatDate(item.mtime)}
                      </td>
                    </tr>
                  );
                })}
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr style={{
                    height: `${rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.end || 0) - 36}px`
                  }}>
                    <td colSpan={5} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Transfer job toast
// ──────────────────────────────────────────────────────────────
const TransferToast: React.FC<{ jobs: TransferJob[], onCancel: (id: string) => void }> = ({ jobs, onCancel }) => {
  if (jobs.length === 0) return null;
  const recent = jobs.slice(-4);
  return (
    <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {recent.map(j => (
        <div key={j.id} className={`flex flex-col px-3 py-2 rounded-lg shadow-lg text-[11px] font-medium border animate-slide-in w-64 pointer-events-auto ${
          j.error ? 'bg-error/10 border-error/20 text-error'
          : j.done ? 'bg-functional-success/10 border-functional-success/20 text-functional-success'
          : 'bg-background border-border text-text-primary'
        }`}>
          <div className="flex items-center space-x-2">
            {j.done
              ? (j.error ? '\u2717' : '\u2713')
              : <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
            <span className="truncate flex-1">{j.direction === 'upload' ? '\u2191' : '\u2193'} {j.name}</span>
            {!j.done && j.progress !== undefined && (
              <span className="text-[10px] opacity-80 flex-shrink-0">{j.progress}%</span>
            )}
            {j.error && <span className="opacity-70 line-clamp-1 flex-1">: {j.error}</span>}
            {!j.done && (
              <button 
                onClick={() => onCancel(j.id)}
                className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                title="取消传输"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {!j.done && j.progress !== undefined && (
            <div className="mt-1.5 w-full bg-border rounded-full h-1 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300 ease-out"
                style={{ width: `${j.progress}%` }}
              />
            </div>
          )}
          {/* Speed + currentFile row */}
          {!j.done && (j.speed !== undefined || j.currentFile) && (
            <div className="mt-1 flex items-center justify-between gap-1">
              {j.currentFile && (
                <span className="text-[9px] text-text-tertiary truncate opacity-70 flex-1">{j.currentFile}</span>
              )}
              {j.speed !== undefined && j.speed > 0 && (
                <span className="text-[9px] font-mono text-primary/80 flex-shrink-0 bg-primary/10 px-1 rounded">
                  {formatSpeed(j.speed)}
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Main SftpBrowser
// ──────────────────────────────────────────────────────────────
interface SftpBrowserProps { sshId: string; }

// Cache to remember path state per SSH session
const pathCache: Record<string, { local?: string, remote?: string }> = {};

const SftpBrowser: React.FC<SftpBrowserProps> = ({ sshId }) => {
  // Local pane state
  const [localPath, setLocalPath] = useState('');
  const [localItems, setLocalItems] = useState<FsItem[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState('/');

  // Remote pane state
  const [remotePath, setRemotePath] = useState('/');
  const [remoteItems, setRemoteItems] = useState<FsItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  // Drag-and-drop
  const dragRef = useRef<DragPayload | null>(null);
  const hoveredPaneRef = useRef<{ side: 'local' | 'remote', path: string } | null>(null);
  const [dropHL, setDropHL] = useState<'local' | 'remote' | null>(null);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  // Chmod modal
  const [chmodTarget, setChmodTarget] = useState<{ item: FsItem; fullPath: string; initialOctal: string } | null>(null);

  // General Modals
  const [promptReq, setPromptReq] = useState<{title:string, val:string, cb:(v:string)=>void} | null>(null);
  const [confirmReq, setConfirmReq] = useState<{title:string, msg:string, cb:()=>void} | null>(null);
  const [conflictReq, setConflictReq] = useState<{
    localFile: { size: number; mtime: number };
    remoteFile: { size: number; mtime: number };
    fileName: string;
    onCancel: () => void;
    onOverwrite: () => void;
    onRename: (newName: string) => void;
    onResume?: () => void;
  } | null>(null);

  // Clipboard (supports both sides)
  const [clipboard, setClipboard] = useState<{ item: FsItem; fullPath: string; side: 'local' | 'remote' } | null>(null);

  // Transfer jobs — read from global AppContext (persists across tab switches)
  const { state: appState, dispatch } = useApp();
  const jobs: TransferJob[] = appState.transferJobs[sshId] || [];

  const addJob = (j: Omit<TransferJob, 'id'>): string => {
    const id = Date.now().toString();
    dispatch({ type: 'ADD_TRANSFER_JOB', payload: { sshId, job: { ...j, id } } });
    return id;
  };

  const finishJob = (id: string, error?: string) => {
    dispatch({ type: 'FINISH_TRANSFER_JOB', payload: { sshId, jobId: id, error } });
    // Auto-remove after 4 seconds
    setTimeout(() => {
      dispatch({ type: 'REMOVE_TRANSFER_JOB', payload: { sshId, jobId: id } });
    }, 4000);
  };

  const doSafeUpload = async (localPath: string, destDir: string, originalFileName: string) => {
    try {
      const destPath = join(destDir, originalFileName);
      let remoteStat: { isDir?: boolean; size: number; mtime: number } | null = null;
      try {
        remoteStat = await window.electronAPI.sftpStat(sshId, destPath);
      } catch (e: any) {
        // File does not exist remotely, safe to upload
      }

      const proceedUpload = async (uploadDestPath: string, fileName: string, options?: any) => {
        const jid = addJob({ name: fileName, direction: 'upload', done: false });
        try {
          await window.electronAPI.sftpUpload(sshId, localPath, uploadDestPath, jid, options);
          finishJob(jid);
          loadRemote(destDir);
        } catch (err: any) { finishJob(jid, err.message || String(err)); }
      };

      if (!remoteStat) {
        return proceedUpload(destPath, originalFileName);
      }

      // Conflict: fetch local file stat to display comparison
      let localStat = { size: 0, mtime: 0 };
      try {
        localStat = await window.electronAPI.localStat(localPath);
      } catch (e) {
        // fallback
      }

      const canResume = remoteStat.size < localStat.size;

      setConflictReq({
        fileName: originalFileName,
        localFile: { size: localStat.size, mtime: localStat.mtime },
        remoteFile: { size: remoteStat.size, mtime: remoteStat.mtime },
        onCancel: () => setConflictReq(null),
        onOverwrite: () => {
          setConflictReq(null);
          proceedUpload(destPath, originalFileName);
        },
        onRename: (newName: string) => {
          setConflictReq(null);
          if (!newName || newName.trim() === '') return;
          const newDestPath = join(destDir, newName);
          proceedUpload(newDestPath, newName);
        },
        ...(canResume ? {
          onResume: () => {
            setConflictReq(null);
            proceedUpload(destPath, originalFileName, { resume: true, remoteSize: remoteStat!.size });
          }
        } : {})
      });
    } catch (e: any) {
      alert('上传前检查失败: ' + (e.message || String(e)));
    }
  };

  const cancelJob = (id: string) => {
    if (window.electronAPI.sftpCancelTransfer) {
      window.electronAPI.sftpCancelTransfer(id);
    }
    // 立即在前端触发完成/取消状态更新，使用户界面获得0延迟的即时反馈
    finishJob(id, '传输已取消');
  };

  const handleSyncPath = async () => {
    setRemoteLoading(true);
    try {
      const syncCmd = `ME=$(whoami); pids=$(pgrep -u "$ME" -x "bash|zsh|sh|csh|tcsh|fish|ash|dash" 2>/dev/null); if [ -z "$pids" ]; then pids=$(pgrep -x "bash|zsh|sh|csh|tcsh|fish|ash|dash" 2>/dev/null); fi; if [ -n "$pids" ]; then latest_pid=""; latest_time=0; for pid in $pids; do tty_path=$(readlink "/proc/$pid/fd/0" 2>/dev/null); if [[ "$tty_path" == /dev/pts/* ]]; then mtime=$(stat -c %Y "$tty_path" 2>/dev/null || stat -f %m "$tty_path" 2>/dev/null || echo 0); if [ "$mtime" -gt "$latest_time" ]; then latest_time=$mtime; latest_pid=$pid; fi; fi; done; if [ -n "$latest_pid" ]; then if [ -d "/proc/$latest_pid/cwd" ]; then readlink "/proc/$latest_pid/cwd"; elif command -v lsof >/dev/null 2>&1; then lsof -a -d cwd -p "$latest_pid" -F n 2>/dev/null | sed -n 's/^n//p'; else pwd; fi; else pwd; fi; else pwd; fi`;
      const res = await window.electronAPI.sshExec(sshId, syncCmd);
      if (res && res.code === 0 && res.stdout.trim()) {
        const terminalPath = res.stdout.trim();
        console.log(`[SFTP] Synced terminal path: ${terminalPath}`);
        loadRemote(terminalPath);
      } else {
        alert('同步失败：未能检测到当前终端工作目录。这可能是因为主机繁忙或连接受限。');
      }
    } catch (e: any) {
      alert('同步发生异常: ' + (e.message || String(e)));
    } finally {
      setRemoteLoading(false);
    }
  };

  const loadLocal = useCallback(async (p: string) => {
    setLocalLoading(true); setLocalError(null);
    try {
      const list = await window.electronAPI.localListDir(p);
      setLocalItems(list); setLocalPath(p);
      pathCache[sshId] = { ...pathCache[sshId], local: p };
    } catch (e: any) { setLocalError(e.message || String(e)); }
    finally { setLocalLoading(false); }
  }, [sshId]);

  const loadRemote = useCallback(async (p: string) => {
    setRemoteLoading(true); setRemoteError(null);
    try {
      const list = await window.electronAPI.sftpList(sshId, p);
      setRemoteItems(list); setRemotePath(p);
      pathCache[sshId] = { ...pathCache[sshId], remote: p };
    } catch (e: any) { setRemoteError(typeof e === 'string' ? e : e.message || String(e)); }
    finally { setRemoteLoading(false); }
  }, [sshId]);

  // ── Drag & Drop Event ──
  const latestRef = useRef<any>(null);
  useEffect(() => {
    latestRef.current = { localPath, remotePath, doSafeUpload, loadLocal, handleDrop };
  }); // Update refs on every render to avoid stale closures in Tauri event listener

  // ── Init ──
  useEffect(() => {
    (async () => {
      const h = await window.electronAPI.localHomeDir();
      setHomeDir(h);
      const cachedLocal = pathCache[sshId]?.local;
      const defaultDir = localJoin(h, 'Documents');
      loadLocal(cachedLocal || defaultDir);
    })();
    
    const cachedRemote = pathCache[sshId]?.remote;
    loadRemote(cachedRemote || '/');

    // Speed tracker: records { lastTransferred, lastTime, smoothedSpeed } per jobId
    // Used to compute EMA-smoothed bytes/s without touching Electron transfer code
    const speedTracker = new Map<string, { lastTransferred: number; lastTime: number; smoothedSpeed: number }>();

    // Setup Progress Listener
    let unlisten: (() => void) | undefined;
    if (window.electronAPI.onSftpProgress) {
      unlisten = window.electronAPI.onSftpProgress((data: any) => {
        const { jid, file, transferred, total } = data;
        const progress = total > 0 ? Math.floor((transferred / total) * 100) : 0;
        const now = Date.now();

        // --- EMA speed calculation (pure frontend, no extra IPC) ---
        let speed: number | undefined;
        const prev = speedTracker.get(jid);
        if (prev && now > prev.lastTime) {
          const dt = (now - prev.lastTime) / 1000; // seconds
          const rawSpeed = (transferred - prev.lastTransferred) / dt; // bytes/s
          // Exponential moving average: α=0.3 weights new sample, 0.7 retains history
          const smoothed = rawSpeed * 0.3 + prev.smoothedSpeed * 0.7;
          speed = smoothed > 0 ? smoothed : 0;
          speedTracker.set(jid, { lastTransferred: transferred, lastTime: now, smoothedSpeed: smoothed });
        } else {
          // First sample for this job — just initialise tracker, no speed shown yet
          speedTracker.set(jid, { lastTransferred: transferred, lastTime: now, smoothedSpeed: 0 });
        }

        dispatch({
          type: 'UPDATE_TRANSFER_JOB',
          payload: { sshId, jobId: jid, progress, currentFile: file, speed },
        });
      });
    }
    // Setup Tauri Window DragDrop Listener
    let unlistenDragDrop: (() => void) | undefined;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        
        // Helper to determine which pane is being hovered with 3-tier fallback for all DPI settings
        const getTargetSide = (pos: { x: number, y: number }): 'local' | 'remote' | null => {
          // Tier 1: Raw logical position
          let el = document.elementFromPoint(pos.x, pos.y);
          if (el) {
            const paneLocal = el.closest('[data-pane-side="local"]');
            if (paneLocal) return 'local';
            const paneRemote = el.closest('[data-pane-side="remote"]');
            if (paneRemote) return 'remote';
          }
          
          // Tier 2: Scaled by devicePixelRatio
          const dpr = window.devicePixelRatio || 1;
          if (dpr !== 1) {
            el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
            if (el) {
              const paneLocal = el.closest('[data-pane-side="local"]');
              if (paneLocal) return 'local';
              const paneRemote = el.closest('[data-pane-side="remote"]');
              if (paneRemote) return 'remote';
            }
          }

          // Tier 3: Bounding box collision detection fallback
          const localPaneEl = document.querySelector('[data-pane-side="local"]');
          if (localPaneEl) {
            const rect = localPaneEl.getBoundingClientRect();
            if ((pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom) ||
                (pos.x / dpr >= rect.left && pos.x / dpr <= rect.right && pos.y / dpr >= rect.top && pos.y / dpr <= rect.bottom)) {
              return 'local';
            }
          }

          const remotePaneEl = document.querySelector('[data-pane-side="remote"]');
          if (remotePaneEl) {
            const rect = remotePaneEl.getBoundingClientRect();
            if ((pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom) ||
                (pos.x / dpr >= rect.left && pos.x / dpr <= rect.right && pos.y / dpr >= rect.top && pos.y / dpr <= rect.bottom)) {
              return 'remote';
            }
          }

          return null;
        };

        if (payload.type === 'enter' || payload.type === 'over') {
          const side = getTargetSide(payload.position);
          if (side) {
            setDropHL(side);
            const { localPath: curLocal, remotePath: curRemote } = latestRef.current;
            hoveredPaneRef.current = { side, path: side === 'local' ? curLocal : curRemote };
          } else {
            setDropHL(null);
            hoveredPaneRef.current = null;
          }
        } else if (payload.type === 'leave') {
          setDropHL(null);
          hoveredPaneRef.current = null;
        } else if (payload.type === 'drop') {
          setDropHL(null);
          const paths = payload.paths;
          window.electronAPI.printFrontendLog?.(`[DragDrop] Drop event received. paths: ${JSON.stringify(paths)}`);
          
          const side = getTargetSide(payload.position) || hoveredPaneRef.current?.side;
          const { localPath: curLocal, remotePath: curRemote, doSafeUpload: curUp, loadLocal: curLoadLocal, handleDrop: curHandleDrop } = latestRef.current;
          
          if (!paths || paths.length === 0) {
            // Internal HTML drag intercepted by Tauri!
            if (dragRef.current && side) {
              if (dragRef.current.side !== side) {
                 const targetPath = side === 'local' ? curLocal : curRemote;
                 curHandleDrop(side, targetPath);
              }
              dragRef.current = null;
            }
            hoveredPaneRef.current = null;
            return;
          }
          
          // External OS Drag
          if (!side) return;
          const targetPath = side === 'local' ? curLocal : curRemote;
          window.electronAPI.printFrontendLog?.(`[DragDrop] targetPath: ${targetPath}`);
          
          const extractFileName = (p: string) => {
            const parts = p.split(/[/\\]/).filter(Boolean);
            return parts.length > 0 ? parts[parts.length - 1] : p;
          };

          if (side === 'remote') {
            paths.forEach((lPath) => {
              const fileName = extractFileName(lPath);
              window.electronAPI.printFrontendLog?.(`[DragDrop] Starting safe upload: ${lPath} -> ${targetPath}/${fileName}`);
              curUp(lPath, targetPath, fileName);
            });
          } else if (side === 'local') {
            paths.forEach(async (srcPath) => {
              const fileName = extractFileName(srcPath);
              const destPath = localJoin(targetPath, fileName);
              try {
                await window.electronAPI.localCopyFile(srcPath, destPath);
                curLoadLocal(targetPath);
              } catch (err: any) {
                alert(`复制本地文件失败: ${err.message || String(err)}`);
              }
            });
          }
          hoveredPaneRef.current = null;
        }
      }).then(unlistenFn => {
        unlistenDragDrop = unlistenFn;
      });
    }).catch(console.error);

    return () => {
      unlisten?.();
      unlistenDragDrop?.();
      speedTracker.clear();
    };
  }, [sshId, loadLocal, loadRemote, dispatch]);

  // ── Drag handlers ──
  const handleDrop = async (targetSide: 'local' | 'remote', targetPath: string, e?: React.DragEvent) => {
    window.electronAPI.printFrontendLog?.(`[React Drop] Fired for ${targetSide} at ${targetPath}`);
    
    // Handle external OS drag and drop
    if (e && e.dataTransfer.files && e.dataTransfer.files.length > 0 && !dragRef.current) {
      window.electronAPI.printFrontendLog?.(`[React Drop] External files detected.`);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      if (targetSide === 'remote') {
        files.forEach(async (f) => {
          const lPath = (f as any).path;
          if (!lPath) return; // browser security fallback
          await doSafeUpload(lPath, targetPath, f.name);
        });
      }
      return;
    }

    const payload = dragRef.current;
    dragRef.current = null; // Reset immediately to prevent double-processing from Tauri's window event
    
    window.electronAPI.printFrontendLog?.(`[React Drop] dragRef payload: ${payload ? JSON.stringify({ side: payload.side, name: payload.item.name }) : 'null'}`);
    if (!payload || payload.side === targetSide) return;

    if (payload.side === 'local' && targetSide === 'remote') {
      window.electronAPI.printFrontendLog?.(`[React Drop] Uploading local to remote: ${payload.fullPath} -> ${targetPath}`);
      // Upload local → remote
      await doSafeUpload(payload.fullPath, targetPath, payload.item.name);
    } else if (payload.side === 'remote' && targetSide === 'local') {
      // Download remote → local
      const dest = localJoin(targetPath, payload.item.name);
      const jid = addJob({ name: payload.item.name, direction: 'download', done: false });
      try {
        await window.electronAPI.sftpDownload(sshId, payload.fullPath, dest, jid);
        finishJob(jid);
        loadLocal(targetPath);
      } catch (err: any) { finishJob(jid, err.message || String(err)); }
    }
  };

  // ── Modal helpers ──
  const promptNewFolder = async (side: 'local' | 'remote', currentPath: string) => {
    setPromptReq({
      title: '新文件夹名称:',
      val: '',
      cb: async (name) => {
        setPromptReq(null);
        if (!name) return;
        if (side === 'remote') {
          try {
            await window.electronAPI.sftpMkdir(sshId, join(currentPath, name));
            loadRemote(currentPath);
          } catch (e: any) { alert('创建失败: ' + (e.message || e)); }
        } else {
          try {
            await window.electronAPI.localCreateNode(currentPath, name, true);
            loadLocal(currentPath);
          } catch (e: any) { alert('创建本地文件夹失败: ' + (e.message || e)); }
        }
      }
    });
  };

  const doDelete = async (item: FsItem, currentPath: string) => {
    setConfirmReq({
      title: '确认删除',
      msg: `确定删除 "${item.name}"？`,
      cb: async () => {
        const fp = join(currentPath, item.name);
        try {
          if (item.isDir) await window.electronAPI.sftpRmdir(sshId, fp);
          else await window.electronAPI.sftpUnlink(sshId, fp);
          loadRemote(currentPath);
        } catch (e: any) { alert('删除失败: ' + (e.message || e)); }
      }
    });
  };

  const doRename = async (item: FsItem, currentPath: string) => {
    setPromptReq({
      title: '新名称:',
      val: item.name,
      cb: async (newName) => {
        setPromptReq(null);
        if (!newName || newName === item.name) return;
        try {
          await window.electronAPI.sftpRename(sshId, join(currentPath, item.name), join(currentPath, newName));
          loadRemote(currentPath);
        } catch (e: any) { alert('重命名失败: ' + (e.message || e)); }
      }
    });
  };

  const doPaste = async (destPath: string, destSide: 'local' | 'remote') => {
    if (!clipboard) return;

    if (destSide === 'remote') {
      const dest = join(destPath, clipboard.item.name);
      if (clipboard.side === 'remote') {
        // Remote → Remote copy
        const jid = addJob({ name: clipboard.item.name, direction: 'upload', done: false });
        try {
          await window.electronAPI.sftpCopy(sshId, clipboard.fullPath, dest);
          finishJob(jid); loadRemote(destPath);
        } catch (e: any) { finishJob(jid, e.message || String(e)); }
      } else {
        // Local → Remote upload
        await doSafeUpload(clipboard.fullPath, destPath, clipboard.item.name);
      }
    } else {
      // Paste to local
      if (clipboard.side === 'remote') {
        // Remote → Local download
        const dest = localJoin(destPath, clipboard.item.name);
        const jid = addJob({ name: clipboard.item.name, direction: 'download', done: false });
        try {
          await window.electronAPI.sftpDownload(sshId, clipboard.fullPath, dest, jid);
          finishJob(jid); loadLocal(destPath);
        } catch (e: any) { finishJob(jid, e.message || String(e)); }
      } else {
        alert('本地剪贴板粘贴到本地请使用 Finder 操作');
      }
    }
  };

  const doDownloadItem = async (item: FsItem, remoteSrcPath: string) => {
    const dest = localJoin(localPath, item.name);
    const jid = addJob({ name: item.name, direction: 'download', done: false });
    try {
      await window.electronAPI.sftpDownload(sshId, remoteSrcPath, dest, jid);
      finishJob(jid);
      loadLocal(localPath);
    } catch (e: any) { finishJob(jid, e.message || String(e)); }
  };

  // ── Chmod helpers ──
  const openChmodDialog = async (item: FsItem, fullPath: string) => {
    try {
      const stat = await window.electronAPI.sftpStat(sshId, fullPath);
      setChmodTarget({ item, fullPath, initialOctal: stat.octal });
    } catch (e: any) {
      alert('获取权限失败: ' + (e.message || e));
    }
  };

  const doChmod = async (fullPath: string, mode: number) => {
    await window.electronAPI.sftpChmod(sshId, fullPath, mode);
    // Refresh remote pane after chmod
    loadRemote(remotePath);
  };

  // ── Context menu builder ──
  const buildMenuItems = (menu: CtxMenu): MenuItemDef[] => {
    const { item, currentPath, side } = menu;
    const itemFull = item ? (side === 'remote' ? join(currentPath, item.name) : localJoin(currentPath, item.name)) : '';

    if (side === 'remote') {
      const base: MenuItemDef[] = [
        {
          label: '新建文件夹', icon: <FolderPlus className="w-4 h-4" />,
          onClick: () => promptNewFolder('remote', currentPath)
        },
        {
          label: '粘贴', icon: <Clipboard className="w-4 h-4" />,
          disabled: !clipboard,
          onClick: () => doPaste(currentPath, 'remote')
        },
      ];
      if (item) {
        base.push(
          { label: '复制', icon: <Copy className="w-4 h-4" />, onClick: () => setClipboard({ item, fullPath: itemFull, side: 'remote' }) },
          { label: '下载到本地', icon: <Download className="w-4 h-4" />, onClick: () => doDownloadItem(item, itemFull) },
          { label: '重命名', icon: <Edit3 className="w-4 h-4" />, onClick: () => doRename(item, currentPath) },
          { label: '修改权限', icon: <Shield className="w-4 h-4" />, onClick: () => openChmodDialog(item, itemFull) },
          { label: '删除', icon: <Trash2 className="w-4 h-4" />, onClick: () => doDelete(item, currentPath), danger: true },
        );
      }
      return base;
    } else {
      // local side
      const base: MenuItemDef[] = [
        {
          label: '粘贴 (来自远程)', icon: <Clipboard className="w-4 h-4" />,
          disabled: !clipboard || clipboard.side !== 'remote',
          onClick: () => doPaste(currentPath, 'local'),
        },
      ];
      if (item) {
        base.unshift(
          { label: '复制', icon: <Copy className="w-4 h-4" />, onClick: () => setClipboard({ item, fullPath: itemFull, side: 'local' }) },
          {
            label: '上传到远程', icon: <Upload className="w-4 h-4" />,
            onClick: () => doSafeUpload(itemFull, remotePath, item.name)
          },
        );
      }
      return base;
    }
  };

  // ── Render ──
  return (
    <div className="relative flex h-full gap-0.5 p-2">
      {/* Local */}
      <div className="flex-1 min-w-0 overflow-hidden" data-pane-side="local">
        <FilePane
          title="本机文件" side="local"
          titleIcon={<HardDrive className="w-3.5 h-3.5 text-slate-500" />}
          path={localPath} items={localItems} loading={localLoading} error={localError}
          homePath={homeDir} dragRef={dragRef}
          dropHighlight={dropHL === 'local'}
          onNavigate={loadLocal}
          onDragStart={(p) => { dragRef.current = p; }}
          onDrop={(p, e) => handleDrop('local', p, e)}
          onDragEnter={() => {
            setDropHL('local');
            hoveredPaneRef.current = { side: 'local', path: localPath };
          }}
          onDragLeave={() => {
            setDropHL(prev => prev === 'local' ? null : prev);
            // DO NOT clear hoveredPaneRef.current here to avoid race condition with Tauri's drop event
          }}
          onContextMenu={(e, item) => setCtxMenu({ x: e.clientX, y: e.clientY, item, currentPath: localPath, side: 'local' })}
        />
      </div>

      {/* Center divider with transfer icon */}
      <div className="flex flex-col items-center justify-center gap-2 px-1 flex-shrink-0">
        <div className="w-px flex-1 bg-gradient-to-b from-transparent via-border to-transparent" />
        <div className="w-7 h-7 rounded-full bg-background-secondary border border-border flex items-center justify-center">
          <ArrowRightLeft className="w-3.5 h-3.5 text-text-tertiary" />
        </div>
        <div className="w-px flex-1 bg-gradient-to-b from-transparent via-border to-transparent" />
      </div>

      {/* Remote */}
      <div className="flex-1 min-w-0 overflow-hidden" data-pane-side="remote">
        <FilePane
          title="远程主机" side="remote"
          titleIcon={<HardDrive className="w-3.5 h-3.5 text-blue-500" />}
          path={remotePath} items={remoteItems} loading={remoteLoading} error={remoteError}
          homePath="/" dragRef={dragRef}
          dropHighlight={dropHL === 'remote'}
          onNavigate={loadRemote}
          onDragStart={(p) => { dragRef.current = p; }}
          onDrop={(p, e) => handleDrop('remote', p, e)}
          onDragEnter={() => {
            setDropHL('remote');
            hoveredPaneRef.current = { side: 'remote', path: remotePath };
          }}
          onDragLeave={() => {
            setDropHL(prev => prev === 'remote' ? null : prev);
            // DO NOT clear hoveredPaneRef.current here to avoid race condition with Tauri's drop event
          }}
          onContextMenu={(e, item) => setCtxMenu({ x: e.clientX, y: e.clientY, item, currentPath: remotePath, side: 'remote' })}
          onSyncPath={handleSyncPath}
        />
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenuView
          menu={ctxMenu}
          items={buildMenuItems(ctxMenu)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Transfer toasts */}
      <TransferToast jobs={jobs} onCancel={cancelJob} />

      {/* Chmod modal */}
      {chmodTarget && (
        <ChmodModal
          target={{ item: chmodTarget.item, fullPath: chmodTarget.fullPath }}
          initialOctal={chmodTarget.initialOctal}
          onClose={() => setChmodTarget(null)}
          onApply={(mode) => doChmod(chmodTarget.fullPath, mode)}
        />
      )}

      {promptReq && (
        <PromptModal
          title={promptReq.title}
          initialValue={promptReq.val}
          onClose={() => setPromptReq(null)}
          onSubmit={promptReq.cb}
        />
      )}

      {confirmReq && (
        <ConfirmModal
          title={confirmReq.title}
          message={confirmReq.msg}
          onClose={() => setConfirmReq(null)}
          onConfirm={confirmReq.cb}
        />
      )}

      {conflictReq && (
        <FileConflictModal
          fileName={conflictReq.fileName}
          localFile={conflictReq.localFile}
          remoteFile={conflictReq.remoteFile}
          onCancel={conflictReq.onCancel}
          onOverwrite={conflictReq.onOverwrite}
          onRename={conflictReq.onRename}
          onResume={conflictReq.onResume}
        />
      )}
    </div>
  );
};

export default SftpBrowser;
