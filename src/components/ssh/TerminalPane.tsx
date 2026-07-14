import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Copy, Clipboard, Trash2, RotateCcw, Download, CheckSquare, Search, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
}

/**
 * Strips Vim-style line numbers from copied terminal text while preserving code indentation.
 */
export function stripLineNumbers(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return text;

  if (lines.length === 1) {
    // For single line, require at least one leading space before the number to reduce false positives
    const match = lines[0].match(/^(\s+)(\d+)(\s+)/);
    if (match) {
      return lines[0].slice(match[0].length);
    }
    return text;
  }

  // Pattern: optional spaces, digits, then at least one space
  const regex = /^(\s*)(\d+)(\s+)/;
  const matches = lines.map(line => {
    const match = line.match(regex);
    return match ? { isMatch: true, text: match[0], length: match[0].length } : { isMatch: false, text: '', length: 0 };
  });

  const matchedItems = matches.filter(m => m.isMatch);
  if (matchedItems.length === 0) {
    return text;
  }

  // Find the most common prefix length (usually all matched prefixes have the exact same length)
  const lengthCounts: { [key: number]: number } = {};
  matchedItems.forEach(m => {
    lengthCounts[m.length] = (lengthCounts[m.length] || 0) + 1;
  });

  let maxCount = 0;
  let gutterWidth = 0;
  for (const lenStr in lengthCounts) {
    const len = parseInt(lenStr, 10);
    if (lengthCounts[len] > maxCount) {
      maxCount = lengthCounts[len];
      gutterWidth = len;
    }
  }

  if (gutterWidth === 0) {
    return text;
  }

  return lines.map((line, idx) => {
    const m = matches[idx];
    if (m.isMatch && m.length === gutterWidth) {
      return line.slice(gutterWidth);
    }
    if (line.trim() === '') {
      return '';
    }
    return line;
  }).join('\n');
}

// ── Shared xterm theme ────────────────────────────────────────────────────────

export const TERMINAL_THEME = {
  background: '#0f1117',
  foreground: '#e2e8f0',
  cursor: '#60a5fa',
  cursorAccent: '#0f1117',
  selectionBackground: 'rgba(96, 165, 250, 0.3)',
  black: '#1e293b',
  red: '#ef4444',
  green: '#0dbc79',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  magenta: '#8b5cf6',
  cyan: '#06b6d4',
  white: '#cbd5e1',
  brightBlack: '#475569',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightMagenta: '#a78bfa',
  brightCyan: '#22d3ee',
  brightWhite: '#f8fafc',
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TerminalPaneProps {
  /** The SSH connection id (session key) */
  sshId: string;
  /** Unique shell id for this pane */
  shellId: string;
  /** Whether this pane is the focused one */
  isFocused: boolean;
  /** Whether to use the default shell (shellId === sshId, no openShell needed) */
  isDefaultShell: boolean;
  /** Callback when this pane receives focus */
  onFocus: () => void;
  /** Callback when this pane requests to be closed */
  onClose?: () => void;
  /** Whether to show the close button (hidden for single-pane) */
  showClose?: boolean;
  /** Terminal mode: 'ssh' for remote shell, 'local' for local PTY (zsh/powershell) */
  mode?: 'ssh' | 'local';
  /** Broadcast keystroke data back to parent for syncing splits */
  onInputData?: (data: string) => void;
  /** Whether to automatically strip line numbers when copying */
  autoStripLineNumbers?: boolean;
  /** Whether the pane is currently maximized */
  isMaximized?: boolean;
  /** Callback to toggle maximize/restore state */
  onToggleMaximize?: () => void;
  /** Whether the user is dragging dividers in the workspace */
  isDragging?: boolean;
  /** Custom working directory for local terminals */
  cwd?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

const TerminalPane: React.FC<TerminalPaneProps> = ({
  sshId, shellId, isFocused, isDefaultShell, onFocus, onClose, showClose,
  mode = 'ssh', onInputData, autoStripLineNumbers = false,
  isMaximized = false, onToggleMaximize, isDragging = false, cwd,
}) => {
  const isLocal = mode === 'local';
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [showCloseBtn, setShowCloseBtn] = useState(false);
  const shellReadyRef = useRef(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const showCopiedToast = useCallback(() => {
    setCopiedToast(true);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setCopiedToast(false);
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // ── Resize logic ────────────────────────────────────────────────────────────

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current && terminalRef.current) {
      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      try { fitAddonRef.current.fit(); } catch {}
      const { cols, rows } = xtermRef.current;
      if (cols && rows && cols > 0 && rows > 0) {
        if (cols !== lastSizeRef.current.cols || rows !== lastSizeRef.current.rows) {
          lastSizeRef.current = { cols, rows };
          if (isLocal) {
            window.electronAPI.ptyResize(shellId, cols, rows);
          } else if (isDefaultShell) {
            window.electronAPI.sshResize(sshId, cols, rows);
          } else {
            window.electronAPI.sshResizeShell(sshId, shellId, cols, rows);
          }
        }
      }
    }
  }, [sshId, shellId, isDefaultShell, isLocal]);

  const handleResizeRef = useRef(handleResize);
  handleResizeRef.current = handleResize;

  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeFollowUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedResizeRef = useRef<(() => void) | undefined>(undefined);

  const debouncedResize = useCallback(() => {
    if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    if (resizeFollowUpRef.current) clearTimeout(resizeFollowUpRef.current);
    resizeTimeoutRef.current = setTimeout(() => {
      handleResizeRef.current();
      resizeFollowUpRef.current = setTimeout(() => handleResizeRef.current(), 300);
    }, 100);
  }, []);
  debouncedResizeRef.current = debouncedResize;

  useEffect(() => {
    return () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (resizeFollowUpRef.current) clearTimeout(resizeFollowUpRef.current);
    };
  }, []);

  // ── Open shell (non-default panes) or spawn local PTY ───────────────────────

  useEffect(() => {
    if (isLocal) {
      // Local mode: spawn PTY process
      let cancelled = false;
      (async () => {
        try {
          const res = await window.electronAPI.ptySpawn(shellId, cwd);
          if (res && !res.success) {
            console.error(`[TerminalPane] Failed to spawn local PTY:`, res.error);
          }
          if (!cancelled) shellReadyRef.current = true;
        } catch (err) {
          console.error(`[TerminalPane] Failed to spawn local PTY ${shellId}:`, err);
        }
      })();
      return () => {
        cancelled = true;
        window.electronAPI.ptyDestroy(shellId);
      };
    }

    let cancelled = false;
    (async () => {
      try {
        await window.electronAPI.sshOpenShell(sshId, shellId);
        if (!cancelled) shellReadyRef.current = true;
      } catch (err) {
        console.error(`[TerminalPane] Failed to open shell ${shellId}:`, err);
      }
    })();
    return () => {
      cancelled = true;
      // Close the shell when pane unmounts
      window.electronAPI.sshCloseShell(sshId, shellId);
    };
  }, [sshId, shellId, isLocal, cwd]);

  // ── Initialize xterm ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: localStorage.getItem('termFontFamily') || '"Fira Code", "SauceCodePro Nerd Font", monospace',
      fontSize: parseInt(localStorage.getItem('termFontSize') || '14', 10),
      scrollback: 10000,
      allowProposedApi: true,
      theme: TERMINAL_THEME,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const unicode11 = new Unicode11Addon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      window.electronAPI.openExternal(uri);
    });
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon?.dispose());
      term.loadAddon(webglAddon);
    } catch {
      console.warn('WebGL not supported, falling back to canvas');
    }

    fitAddon.fit();
    setTimeout(() => term.focus(), 100);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // ── Font scaling ──────────────────────────────────────────────────────────
    const MIN_FONT_SIZE = 10;
    const MAX_FONT_SIZE = 24;

    term.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.type === 'keydown') {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          term.options.fontSize = Math.min(term.options.fontSize! + 1, MAX_FONT_SIZE);
          fitAddon.fit();
          return false;
        }
        if (event.key === '-') {
          event.preventDefault();
          term.options.fontSize = Math.max(term.options.fontSize! - 1, MIN_FONT_SIZE);
          fitAddon.fit();
          return false;
        }
        if (event.key === '0') {
          event.preventDefault();
          term.options.fontSize = 14;
          fitAddon.fit();
          return false;
        }
        if (event.key.toLowerCase() === 'f' && (event.shiftKey || event.metaKey)) {
          event.preventDefault();
          setShowSearch(prev => {
            if (prev) setTimeout(() => term.focus(), 10);
            return !prev;
          });
          return false;
        }
      }
      return true;
    });

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        term.options.fontSize = Math.min(Math.max(term.options.fontSize! + delta, MIN_FONT_SIZE), MAX_FONT_SIZE);
        fitAddon.fit();
      }
    };
    const termEl = terminalRef.current;
    termEl.addEventListener('wheel', handleWheel, { passive: false });

    // Select to copy
    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection) {
        const textToCopy = autoStripLineNumbers ? stripLineNumbers(selection) : selection;
        writeClipboard(textToCopy);
        showCopiedToast();
      }
    });

    // ── I/O wiring ────────────────────────────────────────────────────────────
    const onDataDisposable = term.onData((data) => {
      if (!isLocal && !isDefaultShell && !shellReadyRef.current) return;
      if (isLocal) {
        window.electronAPI.ptyWrite(shellId, data);
      } else if (isDefaultShell) {
        window.electronAPI.sshWrite(sshId, data);
      } else {
        window.electronAPI.sshWriteShell(sshId, shellId, data);
      }
      onInputData?.(data);
    });
    const onBinaryDisposable = term.onBinary((data) => {
      if (!isLocal && !isDefaultShell && !shellReadyRef.current) return;
      if (isLocal) {
        window.electronAPI.ptyWrite(shellId, data);
      } else if (isDefaultShell) {
        window.electronAPI.sshWrite(sshId, data);
      } else {
        window.electronAPI.sshWriteShell(sshId, shellId, data);
      }
      onInputData?.(data);
    });

    // ── Resize observers ──────────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => debouncedResizeRef.current?.());
    resizeObserver.observe(terminalRef.current);

    const onWindowResize = () => debouncedResizeRef.current?.();
    window.addEventListener('resize', onWindowResize);

    // ── Output listener ───────────────────────────────────────────────────────
    let removeOutputListener: () => void;
    let removePtyExitListener: (() => void) | null = null;

    if (isLocal) {
      // Local PTY mode — listen on pty-output channel
      removeOutputListener = window.electronAPI.onPtyOutput(shellId, (outputData: string) => {
        if (typeof outputData === 'string') {
          term.write(outputData);
        }
      });
      // Listen for PTY exit to show a message
      removePtyExitListener = window.electronAPI.onPtyExit(shellId, (code: number) => {
        term.write(`\r\n\x1b[90m[进程已退出，代码: ${code}]\x1b[0m\r\n`);
      });
    } else {
      // SSH mode — for default shell, listen on sshId; for extra shells, listen on shellId
      const outputChannel = isDefaultShell ? sshId : shellId;
      removeOutputListener = window.electronAPI.onSshOutput(outputChannel, (outputData: string) => {
        if (typeof outputData === 'string') {
          term.write(outputData);
        }
      });
    }

    // Context menu click-outside is handled by a separate useEffect below

    return () => {
      onDataDisposable.dispose();
      onBinaryDisposable.dispose();
      removeOutputListener();
      if (removePtyExitListener) removePtyExitListener();
      resizeObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
      termEl.removeEventListener('wheel', handleWheel);

      try { webglAddon?.dispose(); } catch {}
      try { webLinksAddon.dispose(); } catch {}
      try { searchAddon.dispose(); } catch {}
      try { unicode11.dispose(); } catch {}
      try { fitAddon.dispose(); } catch {}

      term.dispose();
    };
  }, [sshId, shellId, isDefaultShell, isLocal]);

  // ── Focus management ────────────────────────────────────────────────────────

  useEffect(() => {
    if (isFocused && xtermRef.current) {
      xtermRef.current.focus();
      handleResizeRef.current();
      const followUp = setTimeout(() => handleResizeRef.current(), 300);
      return () => clearTimeout(followUp);
    }
  }, [isFocused]);

  // ── Close context menu on outside click ─────────────────────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = () => setContextMenu(null);
    // Use requestAnimationFrame to avoid closing immediately on the same click that opened it
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handleClickOutside, { once: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [contextMenu]);

  // ── Expose fit method via imperative ref-like approach ──────────────────────

  // Public method: call from parent to re-fit after divider drag
  const refit = useCallback(() => {
    handleResizeRef.current();
  }, []);

  // Store refit on the DOM element so parent can call it
  useEffect(() => {
    if (terminalRef.current) {
      (terminalRef.current as any).__refit = refit;
    }
  }, [refit]);

  // ── Context menu ────────────────────────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 180;
    const menuHeight = 260;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);
    setContextMenu({ x, y });
  };

  const writeToShell = (data: string) => {
    if (isLocal) {
      window.electronAPI.ptyWrite(shellId, data);
    } else if (isDefaultShell) {
      window.electronAPI.sshWrite(sshId, data);
    } else {
      window.electronAPI.sshWriteShell(sshId, shellId, data);
    }
  };

  const menuActions = [
    {
      label: '复制', icon: <Copy className="w-4 h-4" />,
      action: () => {
        const sel = xtermRef.current?.getSelection();
        if (sel) {
          const textToCopy = autoStripLineNumbers ? stripLineNumbers(sel) : sel;
          writeClipboard(textToCopy);
          showCopiedToast();
        }
      }
    },
    {
      label: '无行号复制', icon: <Copy className="w-4 h-4" />,
      action: () => {
        const sel = xtermRef.current?.getSelection();
        if (sel) {
          writeClipboard(stripLineNumbers(sel));
          showCopiedToast();
        }
      }
    },
    {
      label: '粘贴', icon: <Clipboard className="w-4 h-4" />,
      action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) writeToShell(text);
        } catch (err) {
          console.error('Failed to paste:', err);
        }
      }
    },
    { divider: true },
    onToggleMaximize ? {
      label: isMaximized ? '还原窗格布局' : '最大化当前窗格',
      icon: isMaximized ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3m10-10 7-7m-7 7v-4m0 4h4M10 14 3 21m7-7v4m0-4H6"/></svg>
      ),
      action: () => onToggleMaximize()
    } : null,
    onToggleMaximize ? { divider: true } : null,
    {
      label: '全选', icon: <CheckSquare className="w-4 h-4" />,
      action: () => xtermRef.current?.selectAll()
    },
    { divider: true },
    {
      label: '清除缓冲区', icon: <Trash2 className="w-4 h-4" />,
      action: () => xtermRef.current?.clear()
    },
    {
      label: '清屏', icon: <RotateCcw className="w-4 h-4" />,
      action: () => writeToShell('\x0c')
    },
    { divider: true },
    {
      label: '导出日志', icon: <Download className="w-4 h-4" />,
      action: () => {
        if (!xtermRef.current) return;
        const term = xtermRef.current;
        let content = '';
        for (let i = 0; i < term.buffer.active.length; i++) {
          const line = term.buffer.active.getLine(i);
          if (line) content += line.translateToString(true) + '\n';
        }
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `terminal-log-${shellId}-${new Date().getTime()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    },
  ].filter(Boolean) as any;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className={`relative flex flex-col h-full w-full overflow-hidden transition-all duration-300 ease-out ${
        isFocused
          ? 'ring-1 ring-blue-500/60 z-10 opacity-100 shadow-lg shadow-blue-500/5'
          : 'ring-1 ring-white/[0.04] opacity-65 hover:opacity-85'
      }`}
      onClick={() => { onFocus(); xtermRef.current?.focus(); }}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setShowCloseBtn(true)}
      onMouseLeave={() => setShowCloseBtn(false)}
      style={{ background: TERMINAL_THEME.background }}
    >
      {/* Contextual control buttons */}
      <div className="absolute top-1.5 right-1.5 z-30 flex items-center space-x-1">

        {!isMaximized && onToggleMaximize && showCloseBtn && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
            className="p-1 rounded bg-white/5 hover:bg-blue-500/20 text-slate-500 hover:text-blue-400 border border-transparent hover:border-blue-500/20 transition-colors"
            title="最大化此窗格 (Alt+M)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 17V9h8" />
            </svg>
          </button>
        )}
        {isMaximized && onToggleMaximize && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
            className="p-1 rounded bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 border border-blue-500/30 transition-colors flex items-center space-x-1"
            title="还原窗格布局 (ESC / Alt+M)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
            </svg>
            <span className="text-[9px] font-bold font-mono">还原</span>
          </button>
        )}
        {showClose && showCloseBtn && !isMaximized && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            className="p-1 rounded bg-white/5 hover:bg-red-500/20 text-slate-500 hover:text-red-400 border border-transparent hover:border-red-500/20 transition-colors"
            title="关闭此窗格 (Alt+W)"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Terminal surface */}
      <div ref={terminalRef} className="flex-1 w-full min-h-0 p-1" />

      {/* Dragging Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-transparent cursor-grabbing" style={{ pointerEvents: 'auto' }} />
      )}

      {/* Micro Copy Toast */}
      <div
        className={`absolute bottom-3 right-3 z-50 flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-[#0f1117]/95 text-emerald-400 text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-emerald-500/5 backdrop-blur-md transition-all duration-300 transform pointer-events-none ${
          copiedToast ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'
        }`}
      >
        <svg className="w-3 h-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>已复制 // COPIED</span>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="absolute top-2 right-2 z-50 bg-[#1e293b]/85 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2 flex items-center space-x-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchText.trim()) {
                  searchAddonRef.current?.findNext(searchText);
                } else if (e.key === 'Escape') {
                  setShowSearch(false);
                  setTimeout(() => xtermRef.current?.focus(), 10);
                }
              }}
              placeholder="搜索..."
              className="bg-[#0f1117]/85 border border-white/10 rounded-lg py-1 pl-8 pr-2 text-xs text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 w-44 transition-all"
            />
          </div>
          <div className="flex items-center space-x-0.5">
            <button
              onClick={() => searchText.trim() && searchAddonRef.current?.findPrevious(searchText)}
              className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
              title="上一个"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
            </button>
            <button
              onClick={() => searchText.trim() && searchAddonRef.current?.findNext(searchText)}
              className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
              title="下一个"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <button
              onClick={() => { setShowSearch(false); setTimeout(() => xtermRef.current?.focus(), 10); }}
              className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-red-400 transition-colors"
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-[#1e293b]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 min-w-[170px] animate-in fade-in zoom-in-95 duration-150"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuActions.map((item: any, index: number) =>
            item.divider ? (
              <div key={index} className="my-1 border-t border-white/10" />
            ) : (
              <button
                key={index}
                onClick={() => {
                  const result = item.action?.();
                  setContextMenu(null);
                  Promise.resolve(result).finally(() => xtermRef.current?.focus());
                }}
                className="w-full flex items-center space-x-3 px-3.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <span className="opacity-70">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default TerminalPane;
