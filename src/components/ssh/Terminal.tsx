import React, { useState, useCallback, useRef, useEffect } from 'react';
import TerminalPane, { TERMINAL_THEME } from './TerminalPane';
import {
  SplitSquareHorizontal, SplitSquareVertical, Grid2x2, Grid3x3,
  Columns2, X, Maximize2, Play, List, Radio, Hash
} from 'lucide-react';

// ── Preset commands for snippets drawer ─────────────────────────────────────────
const PRESET_SNIPPETS = [
  { name: '查看磁盘空间', cmd: 'df -h' },
  { name: '查看内存使用', cmd: 'free -m' },
  { name: '查看CPU负荷', cmd: 'top -b -n 1 | head -n 20' },
  { name: '查看网卡网标', cmd: 'ip a || ifconfig' },
  { name: '系统端口占用', cmd: 'lsof -i -P -n' },
  { name: '活跃进程排查', cmd: 'ps aux --sort=-%cpu | head -n 15' },
  { name: 'Nginx 访问日志', cmd: 'tail -n 50 -f /var/log/nginx/access.log' },
  { name: 'Docker 容器状态', cmd: 'docker ps --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"' },
];

// ── Split tree types ──────────────────────────────────────────────────────────

interface LeafNode {
  type: 'leaf';
  id: string;
  shellId: string;
}

interface SplitNodeType {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: [TreeNode, TreeNode];
  ratio: number; // 0..1, first child gets ratio, second gets 1-ratio
}

type TreeNode = LeafNode | SplitNodeType;

// ── Tree utilities ────────────────────────────────────────────────────────────

let paneCounter = 0;

function createLeaf(sshId: string): LeafNode {
  const id = `pane-${Date.now()}-${paneCounter++}`;
  return { type: 'leaf', id, shellId: `${sshId}__split__${id}` };
}

function createDefaultLeaf(sshId: string): LeafNode {
  return { type: 'leaf', id: 'default', shellId: sshId };
}

/** Count all leaf nodes */
function countLeaves(node: TreeNode): number {
  if (node.type === 'leaf') return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

/** Collect all leaf IDs */
function collectLeafIds(node: TreeNode): string[] {
  if (node.type === 'leaf') return [node.id];
  return [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])];
}

/** Find a leaf by ID in the tree */
function findLeaf(node: TreeNode, id: string): LeafNode | null {
  if (node.type === 'leaf') return node.id === id ? node : null;
  return findLeaf(node.children[0], id) || findLeaf(node.children[1], id);
}

/** Split a leaf node: replace it with a split containing the original + a new pane */
function splitLeaf(node: TreeNode, leafId: string, direction: 'horizontal' | 'vertical', sshId: string): TreeNode {
  if (node.type === 'leaf') {
    if (node.id === leafId) {
      const newLeaf = createLeaf(sshId);
      return {
        type: 'split',
        direction,
        children: [node, newLeaf],
        ratio: 0.5,
      };
    }
    return node;
  }
  return {
    ...node,
    children: [
      splitLeaf(node.children[0], leafId, direction, sshId),
      splitLeaf(node.children[1], leafId, direction, sshId),
    ] as [TreeNode, TreeNode],
  };
}

/** Remove a leaf and collapse its parent split */
function removeLeaf(node: TreeNode, leafId: string): TreeNode | null {
  if (node.type === 'leaf') {
    return node.id === leafId ? null : node;
  }
  const [c0, c1] = node.children;
  const r0 = removeLeaf(c0, leafId);
  const r1 = removeLeaf(c1, leafId);

  if (r0 === null) return r1;
  if (r1 === null) return r0;

  return { ...node, children: [r0, r1] as [TreeNode, TreeNode] };
}

/** Update ratio at a specific split path */
function updateRatio(node: TreeNode, splitPath: number[], newRatio: number): TreeNode {
  if (splitPath.length === 0 && node.type === 'split') {
    return { ...node, ratio: Math.max(0.15, Math.min(0.85, newRatio)) };
  }
  if (node.type === 'split' && splitPath.length > 0) {
    const [idx, ...rest] = splitPath;
    const newChildren = [...node.children] as [TreeNode, TreeNode];
    newChildren[idx] = updateRatio(newChildren[idx], rest, newRatio);
    return { ...node, children: newChildren };
  }
  return node;
}

/** Build a grid layout tree (e.g., 2×2, 2×3, 3×3) */
function buildGrid(rows: number, cols: number, sshId: string, defaultShellId: string): TreeNode {
  const leaves: LeafNode[] = [];
  for (let i = 0; i < rows * cols; i++) {
    if (i === 0) {
      // First cell reuses the default shell
      leaves.push({ type: 'leaf', id: 'default', shellId: defaultShellId });
    } else {
      leaves.push(createLeaf(sshId));
    }
  }

  // Build rows
  function buildRow(startIdx: number): TreeNode {
    if (cols === 1) return leaves[startIdx];
    let node: TreeNode = leaves[startIdx];
    for (let c = 1; c < cols; c++) {
      node = {
        type: 'split',
        direction: 'horizontal',
        children: [node, leaves[startIdx + c]],
        ratio: c === 1 ? 1 / cols : node.type === 'split' ? 1 - 1 / (cols - c + 1) : 0.5,
      };
    }
    return node;
  }

  if (rows === 1) return buildRow(0);

  let tree: TreeNode = buildRow(0);
  for (let r = 1; r < rows; r++) {
    tree = {
      type: 'split',
      direction: 'vertical',
      children: [tree, buildRow(r * cols)],
      ratio: r === 1 ? 1 / rows : 1 - 1 / (rows - r + 1),
    };
  }
  return tree;
}

// ── Divider component ─────────────────────────────────────────────────────────

interface DividerProps {
  direction: 'horizontal' | 'vertical';
  onDrag: (delta: number, totalSize: number) => void;
  onDragEnd: () => void;
}

const Divider: React.FC<DividerProps> = ({ direction, onDrag, onDragEnd }) => {
  const [dragging, setDragging] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);

    const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const parent = dividerRef.current?.parentElement;
    const totalSize = parent
      ? direction === 'horizontal' ? parent.clientWidth : parent.clientHeight
      : 800;

    const handleMouseMove = (me: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? me.clientX : me.clientY;
      const delta = currentPos - startPos;
      onDrag(delta / totalSize, totalSize);
    };

    const handleMouseUp = () => {
      setDragging(false);
      onDragEnd();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction, onDrag, onDragEnd]);

  return (
    <div
      ref={dividerRef}
      onMouseDown={handleMouseDown}
      className={`flex-shrink-0 group relative transition-colors ${
        direction === 'horizontal'
          ? 'w-[4px] cursor-col-resize'
          : 'h-[4px] cursor-row-resize'
      } ${
        dragging
          ? 'bg-blue-500/70'
          : 'bg-white/[0.06] hover:bg-blue-500/40'
      }`}
    >
      {/* Wider invisible hit area */}
      <div
        className={`absolute ${
          direction === 'horizontal'
            ? 'inset-y-0 -left-1 -right-1'
            : 'inset-x-0 -top-1 -bottom-1'
        }`}
      />
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface TerminalProps {
  sshId: string;
  isConnected?: boolean;
  /** Terminal mode: 'ssh' for remote shell, 'local' for local PTY */
  mode?: 'ssh' | 'local';
  /** Custom working directory for local PTY */
  cwd?: string;
}

// ── Main component ────────────────────────────────────────────────────────────

const Terminal: React.FC<TerminalProps> = ({ sshId, isConnected, mode = 'ssh', cwd }) => {
  const [tree, setTree] = useState<TreeNode>(() => createDefaultLeaf(sshId));
  const [focusedPaneId, setFocusedPaneId] = useState<string>('default');
  const [showToolbar, setShowToolbar] = useState(false);
  const [isSyncInput, setIsSyncInput] = useState(false);
  const [autoStripLineNumbers, setAutoStripLineNumbers] = useState(false);
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [customSnippet, setCustomSnippet] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRatioRef = useRef<number | null>(null);

  const totalPanes = countLeaves(tree);
  const maxPanes = 9;

  // ── Send snippet command to terminal ───────────────────────────────────────
  const sendSnippet = useCallback((cmd: string) => {
    const activePane = findLeaf(tree, focusedPaneId);
    if (!activePane) return;
    
    const payload = cmd + '\n';
    
    // 写入当前聚焦窗口
    if (mode === 'local') {
      window.electronAPI.ptyWrite(activePane.shellId, payload);
    } else if (activePane.shellId === sshId) {
      window.electronAPI.sshWrite(sshId, payload);
    } else {
      window.electronAPI.sshWriteShell(sshId, activePane.shellId, payload);
    }

    // 若同步输入开启，广播到其他所有窗格
    if (isSyncInput) {
      const leafIds = collectLeafIds(tree);
      leafIds.forEach(leafId => {
        if (leafId === focusedPaneId) return;
        const leaf = findLeaf(tree, leafId);
        if (leaf) {
          if (mode === 'local') {
            window.electronAPI.ptyWrite(leaf.shellId, payload);
          } else if (leaf.shellId === sshId) {
            window.electronAPI.sshWrite(sshId, payload);
          } else {
            window.electronAPI.sshWriteShell(sshId, leaf.shellId, payload);
          }
        }
      });
    }
  }, [tree, focusedPaneId, sshId, mode, isSyncInput]);

  // ── Split actions ───────────────────────────────────────────────────────────

  const splitHorizontal = useCallback(() => {
    if (totalPanes >= maxPanes) return;
    setTree(prev => {
      const newTree = splitLeaf(prev, focusedPaneId, 'horizontal', sshId);
      return newTree;
    });
  }, [focusedPaneId, totalPanes, sshId]);

  const splitVertical = useCallback(() => {
    if (totalPanes >= maxPanes) return;
    setTree(prev => splitLeaf(prev, focusedPaneId, 'vertical', sshId));
  }, [focusedPaneId, totalPanes, sshId]);

  const closePane = useCallback((paneId: string) => {
    if (totalPanes <= 1) return;
    setTree(prev => {
      const newTree = removeLeaf(prev, paneId);
      if (!newTree) return prev;
      // Compute focus from the NEW tree (not the stale closure)
      const remaining = collectLeafIds(newTree);
      if (remaining.length > 0) setFocusedPaneId(remaining[0]);
      return newTree;
    });
  }, [totalPanes]);

  const applyGrid = useCallback((rows: number, cols: number) => {
    const needed = rows * cols;
    if (needed > maxPanes) return;
    setTree(buildGrid(rows, cols, sshId, sshId));
    setFocusedPaneId('default');
  }, [sshId]);

  const resetToSingle = useCallback(() => {
    setTree(createDefaultLeaf(sshId));
    setFocusedPaneId('default');
  }, [sshId]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to restore maximized pane
      if (e.key === 'Escape' && maximizedPaneId) {
        e.preventDefault();
        setMaximizedPaneId(null);
        return;
      }

      if (!e.altKey) return;

      // Alt+M: toggle maximize
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (maximizedPaneId) {
          setMaximizedPaneId(null);
        } else if (totalPanes > 1) {
          setMaximizedPaneId(focusedPaneId);
        }
        return;
      }

      // Alt+H: horizontal split
      if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        splitHorizontal();
        return;
      }
      // Alt+V: vertical split
      if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        splitVertical();
        return;
      }
      // Alt+W: close pane
      if (e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        closePane(focusedPaneId);
        return;
      }
      // Alt+Arrow: navigate between panes
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const allIds = collectLeafIds(tree);
        const idx = allIds.indexOf(focusedPaneId);
        if (idx < 0) return;
        let nextIdx = idx;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          nextIdx = (idx + 1) % allIds.length;
        } else {
          nextIdx = (idx - 1 + allIds.length) % allIds.length;
        }
        setFocusedPaneId(allIds[nextIdx]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [splitHorizontal, splitVertical, closePane, focusedPaneId, tree, maximizedPaneId, totalPanes]);

  // ── Refit all panes after divider drag ──────────────────────────────────────

  const refitAllPanes = useCallback(() => {
    if (!containerRef.current) return;
    const paneEls = containerRef.current.querySelectorAll('[data-pane-id]');
    paneEls.forEach((el) => {
      const termEl = el.querySelector('[class*="min-h-0"]');
      if (termEl && (termEl as any).__refit) {
        (termEl as any).__refit();
      }
    });
    // Small delay to ensure layout has settled
    setTimeout(() => {
      paneEls.forEach((el) => {
        const termEl = el.querySelector('[class*="min-h-0"]');
        if (termEl && (termEl as any).__refit) {
          (termEl as any).__refit();
        }
      });
    }, 100);
  }, []);

  // ── Render tree recursively ─────────────────────────────────────────────────

  const renderNode = useCallback(
    (node: TreeNode, splitPath: number[] = []): React.ReactNode => {
      if (node.type === 'leaf') {
        return (
          <div
            key={node.id}
            data-pane-id={node.id}
            className="flex-1 min-w-0 min-h-0 overflow-hidden"
          >
            <TerminalPane
              sshId={sshId}
              shellId={node.shellId}
              isFocused={focusedPaneId === node.id}
              isDefaultShell={node.shellId === sshId}
              onFocus={() => setFocusedPaneId(node.id)}
              onClose={() => closePane(node.id)}
              showClose={totalPanes > 1}
              mode={mode}
              autoStripLineNumbers={autoStripLineNumbers}
              isDragging={isDragging}
              cwd={cwd}
              onToggleMaximize={totalPanes > 1 ? () => setMaximizedPaneId(node.id) : undefined}
              onInputData={(data) => {
                // 如果开启了同步键入模式，将键盘输入广播分发给其他所有的叶子终端信道
                if (isSyncInput) {
                  const leafIds = collectLeafIds(tree);
                  leafIds.forEach(leafId => {
                    if (leafId === node.id) return; // 聚焦窗口已由本地xterm回显，跳过
                    const leaf = findLeaf(tree, leafId);
                    if (leaf) {
                      if (mode === 'local') {
                        window.electronAPI.ptyWrite(leaf.shellId, data);
                      } else if (leaf.shellId === sshId) {
                        window.electronAPI.sshWrite(sshId, data);
                      } else {
                        window.electronAPI.sshWriteShell(sshId, leaf.shellId, data);
                      }
                    }
                  });
                }
              }}
            />
          </div>
        );
      }

      const { direction, children, ratio } = node;
      const isHorizontal = direction === 'horizontal';

      return (
        <div
          key={`split-${splitPath.join('-')}`}
          className="flex min-w-0 min-h-0 overflow-hidden"
          style={{
            flexDirection: isHorizontal ? 'row' : 'column',
            flex: 1,
          }}
        >
          {/* First child */}
          <div
            style={{
              flex: `0 0 calc(${ratio * 100}% - 2px)`,
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            {renderNode(children[0], [...splitPath, 0])}
          </div>

          {/* Divider */}
          <Divider
            direction={direction}
            onDrag={(deltaNorm) => {
              if (dragStartRatioRef.current === null) {
                dragStartRatioRef.current = ratio;
                setIsDragging(true);
              }
              setTree(prev =>
                updateRatio(prev, splitPath, dragStartRatioRef.current! + deltaNorm)
              );
            }}
            onDragEnd={() => {
              dragStartRatioRef.current = null;
              setIsDragging(false);
              refitAllPanes();
            }}
          />

          {/* Second child */}
          <div
            style={{
              flex: `0 0 calc(${(1 - ratio) * 100}% - 2px)`,
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            {renderNode(children[1], [...splitPath, 1])}
          </div>
        </div>
      );
    },
    [sshId, focusedPaneId, closePane, totalPanes, refitAllPanes, mode, autoStripLineNumbers, isDragging, tree, isSyncInput, cwd]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!isConnected) return null;

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col overflow-hidden relative"
      style={{ background: TERMINAL_THEME.background }}
      onMouseEnter={() => totalPanes === 1 && setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      {/* ── Split toolbar ── */}
      <div
        className={`flex items-center px-1.5 py-0 gap-0.5 border-b flex-shrink-0 transition-all duration-200 ${
          totalPanes > 1 || showToolbar
            ? 'opacity-100 h-6 border-white/[0.06]'
            : 'opacity-0 h-0 border-transparent overflow-hidden pointer-events-none'
        }`}
        style={{ background: 'rgba(15, 17, 23, 0.95)' }}
        onMouseEnter={() => setShowToolbar(true)}
      >
        {/* Split buttons */}
        <button
          onClick={splitHorizontal}
          disabled={totalPanes >= maxPanes}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          title="水平分割 (Alt+H)"
        >
          <SplitSquareHorizontal className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={splitVertical}
          disabled={totalPanes >= maxPanes}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          title="垂直分割 (Alt+V)"
        >
          <SplitSquareVertical className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-3 bg-white/10 mx-0.5" />

        {/* Grid presets */}
        <button
          onClick={() => applyGrid(1, 2)}
          disabled={totalPanes >= maxPanes && 2 > totalPanes}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          title="1×2 布局"
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => applyGrid(2, 2)}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          title="2×2 网格"
        >
          <Grid2x2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => applyGrid(2, 3)}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          title="2×3 网格"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="6" height="9" rx="1"/><rect x="9" y="2" width="6" height="9" rx="1"/><rect x="16" y="2" width="6" height="9" rx="1"/>
            <rect x="2" y="13" width="6" height="9" rx="1"/><rect x="9" y="13" width="6" height="9" rx="1"/><rect x="16" y="13" width="6" height="9" rx="1"/>
          </svg>
        </button>
        <button
          onClick={() => applyGrid(3, 3)}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          title="3×3 网格"
        >
          <Grid3x3 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-3 bg-white/10 mx-0.5" />

        {/* Reset to single pane */}
        {totalPanes > 1 && (
          <button
            onClick={resetToSingle}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="重置为单窗格"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* 广播同步输入开关 */}
        {totalPanes > 1 && (
          <button
            onClick={() => setIsSyncInput(prev => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase transition-all ${
              isSyncInput
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-md shadow-amber-500/5'
                : 'hover:bg-white/10 text-slate-400 hover:text-white border border-transparent'
            }`}
            title="多窗格同步广播输入"
          >
            <Radio className={`w-3 h-3 ${isSyncInput ? 'animate-pulse' : ''}`} />
            <span>{isSyncInput ? '同步输入中' : '同步输入'}</span>
          </button>
        )}

        <div className="w-px h-3 bg-white/10 mx-1" />

        {/* 自动过滤行号开关 */}
        <button
          onClick={() => setAutoStripLineNumbers(prev => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase transition-all ${
            autoStripLineNumbers
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'hover:bg-white/10 text-slate-400 hover:text-white border border-transparent'
          }`}
          title="自动过滤复制文本中的 Vim 行号"
        >
          <Hash className="w-3.5 h-3.5" />
          <span>{autoStripLineNumbers ? '过滤行号开' : '过滤行号'}</span>
        </button>

        <div className="w-px h-3 bg-white/10 mx-1" />

        {/* 常用命令速记抽屉开关 */}
        <button
          onClick={() => setShowSnippets(prev => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase transition-all ${
            showSnippets
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'hover:bg-white/10 text-slate-400 hover:text-white border border-transparent'
          }`}
          title="常用命令速记侧边栏"
        >
          <List className="w-3.5 h-3.5" />
          <span>速记面板</span>
        </button>

        <div className="w-px h-3 bg-white/10 mx-1" />

        {/* Pane count indicator */}
        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono mr-1 select-none">
          <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
            totalPanes > 1 ? 'bg-blue-500/10 text-blue-400' : 'bg-white/5 text-slate-500'
          }`}>
            {totalPanes}/{maxPanes}
          </div>
        </div>
      </div>

      {/* ── Invisible hover zone to reveal toolbar when single pane ── */}
      {totalPanes === 1 && !showToolbar && (
        <div
          className="absolute top-0 left-0 right-0 h-6 z-20"
          onMouseEnter={() => setShowToolbar(true)}
        />
      )}

      {/* ── Main Workspace + Snippets Drawer ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        <div className="flex-1 min-w-0 flex overflow-hidden">
          {maximizedPaneId ? (() => {
            const leaf = findLeaf(tree, maximizedPaneId);
            if (!leaf) return renderNode(tree);
            return (
              <div data-pane-id={leaf.id} className="flex-1 min-w-0 min-h-0 overflow-hidden">
                <TerminalPane
                  sshId={sshId}
                  shellId={leaf.shellId}
                  isFocused={focusedPaneId === leaf.id}
                  isDefaultShell={leaf.shellId === sshId}
                  onFocus={() => setFocusedPaneId(leaf.id)}
                  onClose={() => closePane(leaf.id)}
                  showClose={false}
                  mode={mode}
                  autoStripLineNumbers={autoStripLineNumbers}
                  isDragging={false}
                  isMaximized={true}
                  cwd={cwd}
                  onToggleMaximize={() => setMaximizedPaneId(null)}
                  onInputData={(data) => {
                    if (isSyncInput) {
                      const leafIds = collectLeafIds(tree);
                      leafIds.forEach(leafId => {
                        if (leafId === leaf.id) return;
                        const otherLeaf = findLeaf(tree, leafId);
                        if (otherLeaf) {
                          if (mode === 'local') {
                            window.electronAPI.ptyWrite(otherLeaf.shellId, data);
                          } else if (otherLeaf.shellId === sshId) {
                            window.electronAPI.sshWrite(sshId, data);
                          } else {
                            window.electronAPI.sshWriteShell(sshId, otherLeaf.shellId, data);
                          }
                        }
                      });
                    }
                  }}
                />
              </div>
            );
          })() : renderNode(tree)}
        </div>

        {/* ── 命令速记侧边栏 (Drawer) — 磨砂深邃高精质感 ── */}
        {showSnippets && (
          <div className="w-80 bg-slate-900/95 border-l border-white/10 flex flex-col flex-shrink-0 animate-in slide-in-from-right duration-200 z-30 text-slate-300 backdrop-blur-xl">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <List className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-white tracking-wide">常用指令速记面板</h3>
              </div>
              <button
                onClick={() => setShowSnippets(false)}
                className="p-1 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Custom snippet input */}
            <div className="p-4 border-b border-white/10 space-y-2 bg-slate-950/20">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">即时发送自定义命令</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="输入命令..."
                  value={customSnippet}
                  onChange={(e) => setCustomSnippet(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customSnippet.trim()) {
                      sendSnippet(customSnippet.trim());
                      setCustomSnippet('');
                    }
                  }}
                  className="flex-1 px-3 py-1.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all font-mono"
                />
                <button
                  onClick={() => {
                    if (customSnippet.trim()) {
                      sendSnippet(customSnippet.trim());
                      setCustomSnippet('');
                    }
                  }}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition-all hover:shadow-lg hover:shadow-blue-500/20 flex items-center space-x-1"
                >
                  <span>发送</span>
                </button>
              </div>
            </div>

            {/* Snippet list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">系统常用预设</div>
              <div className="space-y-3">
                {PRESET_SNIPPETS.map((item, idx) => (
                  <div
                    key={idx}
                    className="group bg-slate-950/45 hover:bg-slate-950/80 border border-white/5 rounded-2xl p-3.5 flex flex-col justify-between transition-all hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-bold text-slate-200">{item.name}</span>
                      <button
                        onClick={() => sendSnippet(item.cmd)}
                        className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500 hover:text-white text-blue-400 transition-all flex items-center space-x-1"
                        title="立即发送到当前终端"
                      >
                        <Play className="w-3 h-3 fill-current" />
                      </button>
                    </div>
                    <code className="font-mono text-[10px] text-emerald-400/90 break-all bg-black/40 px-2.5 py-1.5 rounded-xl select-all border border-white/[0.03]">
                      {item.cmd}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Terminal;
