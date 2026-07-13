import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { useTheme } from '../../../../contexts/ThemeContext';
import { 
  GitBranch, 
  Search, 
  RotateCw, 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  FileText,
  User, 
  Clock, 
  Calendar,
  Tag,
  AlertCircle
} from 'lucide-react';
import { getFileIcon } from '../../../../utils/fileIcon';

interface GitGraphCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  refs: string;
  message: string;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  status?: string;
  children?: FileTreeNode[];
}

// Color constants for Git Graph Lanes
const LANE_COLORS = [
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#ec4899', // pink
  '#8b5cf6', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
];

export const GitGraphTab: React.FC = () => {
  const { theme } = useTheme();
  const currentProject = useWorkspaceStore((s) => s.currentProject);
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);
  const openDiff = useWorkspaceStore((s) => s.openDiff);

  const [rightPanelWidth, setRightPanelWidth] = useState(350);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(250, Math.min(600, startWidth - deltaX));
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const projectPath = useMemo(() => {
    if (gitRoots && gitRoots.length > 0) {
      return gitRoots[0];
    }
    if (!currentProject) return '';
    return currentProject.codePath || currentProject.path;
  }, [currentProject, gitRoots]);

  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [branches, setBranches] = useState<Array<{ name: string; is_remote: boolean; is_current: boolean }>>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL_BRANCHES');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCommit, setSelectedCommit] = useState<GitGraphCommit | null>(null);
  const [modifiedFiles, setModifiedFiles] = useState<Array<{ path: string; status: string }>>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hoveredCommit, setHoveredCommit] = useState<{ commit: GitGraphCommit; x: number; y: number } | null>(null);

  // Load commit history and branch list
  const loadGitGraphData = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch commits history using our new Rust API
      const list = await window.electronAPI.gitLogGraph(projectPath);
      setCommits(list);

      // 2. Fetch branches
      const branchList = await window.electronAPI.gitBranches(projectPath);
      setBranches(branchList);
      
      const active = branchList.find(b => b.is_current);
      if (active && selectedBranch === 'ALL_BRANCHES') {
        // Set default to current branch or ALL_BRANCHES
      }
    } catch (err: any) {
      console.error('Failed to load git graph data:', err);
      const msg = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
      setErrorMsg('获取 Git Graph 失败: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGitGraphData();
  }, [projectPath]);

  // Load modified files when a commit is selected
  useEffect(() => {
    const loadCommitFiles = async () => {
      if (!projectPath || !selectedCommit) {
        setModifiedFiles([]);
        return;
      }
      setFilesLoading(true);
      try {
        const files = await window.electronAPI.gitCommitFiles(projectPath, selectedCommit.hash);
        setModifiedFiles(files);
        
        // Auto-expand all folders by default
        const initialExpanded: Record<string, boolean> = { '': true };
        files.forEach((f) => {
          const parts = f.path.split('/');
          for (let i = 0; i < parts.length - 1; i++) {
            const folderPath = parts.slice(0, i + 1).join('/');
            initialExpanded[folderPath] = true;
          }
        });
        setExpandedFolders(initialExpanded);
      } catch (err) {
        console.error('Failed to load commit files:', err);
      } finally {
        setFilesLoading(false);
      }
    };
    loadCommitFiles();
  }, [selectedCommit, projectPath]);

  // Filter commits based on search query and branch filter
  const filteredCommits = useMemo(() => {
    return commits.filter((c) => {
      // Branch filter
      if (selectedBranch !== 'ALL_BRANCHES') {
        const cleanRefs = c.refs.replace(/[()]/g, '');
        const refParts = cleanRefs.split(',').map((r) => r.trim());
        const hasRef = refParts.some((ref) => {
          // Check if ref matches selectedBranch (like master or origin/master)
          const cleanRef = ref.replace(/^HEAD -> /, '');
          return cleanRef === selectedBranch;
        });
        if (!hasRef && selectedBranch !== 'ALL_BRANCHES') {
          // If filtering by branch, but we only have 200 commits, we do simple sub-filtering.
          // Note: Rust API runs git log --all so it returns commits from all branches.
        }
      }

      // Search text filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.hash.toLowerCase().includes(q) ||
        c.message.toLowerCase().includes(c.hash.toLowerCase().includes(q) ? '' : q) ||
        c.author.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    });
  }, [commits, selectedBranch, searchQuery]);

  // Topology Lane calculation for the visible commits
  const graphRows = useMemo(() => {
    if (filteredCommits.length === 0) return [];
    
    const activeLanes: string[] = [];
    const hashSet = new Set(filteredCommits.map(c => c.hash));

    return filteredCommits.map((c) => {
      // 1. Assign or find lane
      let laneIndex = activeLanes.indexOf(c.hash);
      if (laneIndex === -1) {
        activeLanes.push(c.hash);
        laneIndex = activeLanes.length - 1;
      }

      const lanesBefore = [...activeLanes];

      // 2. Filter parents present in the current subset
      const validParents = c.parents.filter(p => hashSet.has(p));

      // 3. Update active lanes
      if (validParents.length === 0) {
        activeLanes.splice(laneIndex, 1);
      } else {
        activeLanes[laneIndex] = validParents[0];
        // Insert other parents for merge commits
        for (let i = 1; i < validParents.length; i++) {
          const parent = validParents[i];
          if (!activeLanes.includes(parent)) {
            activeLanes.splice(laneIndex + i, 0, parent);
          }
        }
      }

      const lanesAfter = [...activeLanes];

      // 4. Build line segments for drawing
      const lines: Array<{ from: number; to: number; color: string }> = [];
      lanesBefore.forEach((beforeHash, beforeIdx) => {
        if (beforeIdx === laneIndex) {
          // Connect commit node to its parents
          validParents.forEach((parentHash) => {
            const afterIdx = lanesAfter.indexOf(parentHash);
            if (afterIdx !== -1) {
              lines.push({
                from: beforeIdx,
                to: afterIdx,
                color: LANE_COLORS[beforeIdx % LANE_COLORS.length]
              });
            }
          });
        } else {
          // Drag along existing active lanes
          const afterIdx = lanesAfter.indexOf(beforeHash);
          if (afterIdx !== -1) {
            lines.push({
              from: beforeIdx,
              to: afterIdx,
              color: LANE_COLORS[beforeIdx % LANE_COLORS.length]
            });
          }
        }
      });

      return {
        commit: c,
        lane: laneIndex,
        lines,
        lanesCount: Math.max(lanesBefore.length, lanesAfter.length)
      };
    });
  }, [filteredCommits]);

  // Determine overall max lanes for sizing the graph column
  const maxLanes = useMemo(() => {
    return Math.max(3, ...graphRows.map(r => r.lanesCount));
  }, [graphRows]);

  // Parse refs into nice badges
  const parseRefs = (refsStr: string) => {
    if (!refsStr) return [];
    // Refs string example: "HEAD -> master, origin/master, tag: v1.0"
    const clean = refsStr.replace(/[()]/g, '');
    return clean.split(',').map((r) => {
      const trimmed = r.trim();
      let type: 'head' | 'local' | 'remote' | 'tag' = 'local';
      let name = trimmed;

      if (trimmed.startsWith('HEAD -> ')) {
        type = 'head';
        name = trimmed.substring(8);
      } else if (trimmed.startsWith('tag: ')) {
        type = 'tag';
        name = trimmed.substring(5);
      } else if (trimmed.includes('/')) {
        type = 'remote';
      }

      return { name, type };
    });
  };

  // Branch switching handler
  const handleBranchSwitch = async (branchName: string) => {
    if (!projectPath) return;
    const confirmSwitch = window.confirm(`是否确定检出并切换到分支 "${branchName}"？`);
    if (!confirmSwitch) return;

    try {
      setLoading(true);
      await window.electronAPI.gitCheckout(projectPath, branchName);
      await refreshGitStatus();
      await loadGitGraphData();
      setSelectedCommit(null);
      alert(`成功切换到分支 "${branchName}"`);
    } catch (err: any) {
      console.error('Failed to checkout branch:', err);
      alert(`切换分支失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Tree building for modified files
  const fileTree = useMemo(() => {
    const filteredFiles = modifiedFiles.filter(f => 
      f.path.toLowerCase().includes(fileSearchQuery.toLowerCase())
    );

    const root: FileTreeNode = { name: 'root', path: '', isDir: true, children: [] };

    filteredFiles.forEach((f) => {
      const parts = f.path.split('/');
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const currentPath = parts.slice(0, i + 1).join('/');

        let child = current.children?.find((c) => c.name === part);

        if (!child) {
          child = {
            name: part,
            path: currentPath,
            isDir: !isLast,
            status: isLast ? f.status : undefined,
            children: isLast ? undefined : []
          };
          current.children?.push(child);
        }
        current = child;
      }
    });

    const sortTree = (node: FileTreeNode) => {
      if (node.children) {
        node.children.sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
        node.children.forEach(sortTree);
      }
    };

    sortTree(root);
    return root.children || [];
  }, [modifiedFiles, fileSearchQuery]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  const handleFileClick = async (node: FileTreeNode) => {
    if (node.isDir) return;
    if (!projectPath || !selectedCommit) return;

    try {
      const commitHash = selectedCommit.hash;
      const parentHash = selectedCommit.parents[0] || '';
      const status = node.status || 'M';
      
      let originalContent = '';
      let modifiedContent = '';

      // Get modified content (after commit)
      if (status !== 'D') {
        try {
          modifiedContent = await window.electronAPI.gitShowFile(projectPath, commitHash, node.path);
        } catch (err) {
          console.error('Failed to get modified content:', err);
        }
      }

      // Get original content (before commit)
      if (status !== 'A' && parentHash) {
        try {
          originalContent = await window.electronAPI.gitShowFile(projectPath, parentHash, node.path);
        } catch (err) {
          console.error('Failed to get original content:', err);
        }
      }

      const absolutePath = (projectPath + '/' + node.path).replace(/\\/g, '/');
      const originalLabel = parentHash ? parentHash.substring(0, 7) : 'Empty';
      const modifiedLabel = commitHash.substring(0, 7);

      openDiff(
        absolutePath,
        node.name,
        originalContent,
        modifiedContent,
        originalLabel,
        modifiedLabel
      );
    } catch (err: any) {
      console.error('Failed to open file diff:', err);
      alert('无法打开文件对比: ' + err.message);
    }
  };

  // Render a single file node in tree view
  const renderFileNode = (node: FileTreeNode, depth: number = 0) => {
    const isExpanded = !!expandedFolders[node.path];
    const hasChildren = node.children && node.children.length > 0;

    // Get color/badge by status
    const getStatusInfo = (status?: string) => {
      switch (status) {
        case 'A': return { char: 'A', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', color: 'text-emerald-400' };
        case 'D': return { char: 'D', bg: 'bg-rose-500/10 text-rose-400 border-rose-500/20', color: 'text-rose-400 line-through opacity-60' };
        case 'M': 
        default:
          return { char: 'M', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20', color: 'text-blue-400' };
      }
    };

    const statusInfo = !node.isDir ? getStatusInfo(node.status) : null;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center justify-between py-1 px-2 hover:bg-white/5 rounded-lg cursor-pointer group text-xs font-mono transition-colors ${
            !node.isDir && statusInfo ? statusInfo.color : 'text-slate-300'
          }`}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          onClick={() => {
            if (node.isDir) {
              toggleFolder(node.path);
            } else {
              handleFileClick(node);
            }
          }}
        >
          <div className="flex items-center space-x-1.5 min-w-0 pr-2">
            {node.isDir ? (
              <span className="text-slate-500 flex-shrink-0">
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </span>
            ) : (
              <span className="w-3.5 flex-shrink-0" />
            )}
            
            <span className="flex-shrink-0">
              {node.isDir ? (
                isExpanded ? <FolderOpen className="w-3.5 h-3.5 text-amber-400" /> : <Folder className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                getFileIcon(node.name, "w-3.5 h-3.5")
              )}
            </span>
            <span className="truncate">{node.name}</span>
          </div>

          {!node.isDir && statusInfo && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border scale-90 ${statusInfo.bg}`}>
              {statusInfo.char}
            </span>
          )}
        </div>

        {node.isDir && isExpanded && hasChildren && (
          <div className="mt-0.5">
            {node.children?.map(child => renderFileNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-background-primary text-text-primary select-none overflow-hidden animate-fade-in">
      {/* ── Top Toolbar ── */}
      <div className="p-3 border-b border-border-primary bg-background-secondary/60 flex items-center justify-between flex-shrink-0 space-x-4">
        {/* Left side filters */}
        <div className="flex items-center space-x-2.5 flex-1 max-w-xl">
          {/* Branch Dropdown */}
          <div className="relative">
            <select
              value={selectedBranch}
              onChange={(e) => {
                const val = e.target.value;
                if (val !== 'ALL_BRANCHES') {
                  handleBranchSwitch(val);
                } else {
                  setSelectedBranch('ALL_BRANCHES');
                }
              }}
              className="bg-background-primary border border-border-primary hover:border-text-secondary text-xs px-2.5 py-1.5 rounded-lg outline-none cursor-pointer max-w-[180px] font-mono text-text-primary"
            >
              <option value="ALL_BRANCHES">📅 所有分支 // ALL BRANCHES</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.is_current ? '⭐️ ' : ''}{b.name} {b.is_remote ? '(remote)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Search Commit */}
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="搜索提交、Hash、作者..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-background-primary border border-border-primary hover:border-text-secondary focus:border-primary/50 text-xs pl-8 pr-3 py-1.5 rounded-lg w-full outline-none font-sans text-text-primary"
            />
            <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={loadGitGraphData}
            disabled={loading}
            className="p-1.5 rounded-lg bg-background-primary border border-border-primary hover:bg-background-secondary text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            title="刷新 Git 树"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Error message */}
        {errorMsg && (
          <div className="absolute inset-0 bg-background-primary/95 z-50 flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-red-500/10 border border-red-500/20 max-w-md p-5 rounded-xl text-center shadow-2xl">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-red-300 mb-1.5">获取 Git 历史失败</h4>
              <p className="text-xs text-red-400/90 font-mono mb-4 break-words">{errorMsg}</p>
              <button
                onClick={loadGitGraphData}
                className="px-4 py-1.5 text-xs bg-background-primary border border-border-primary hover:bg-background-secondary rounded-lg cursor-pointer"
              >
                重试加载
              </button>
            </div>
          </div>
        )}

        {/* Left Side: Graph + Commits List */}
        <div className="flex-1 overflow-auto border-r border-border-primary bg-background-primary relative scrollbar-thin">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-text-tertiary font-mono text-xs">
              正在读取 Git 日志树...
            </div>
          ) : graphRows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-text-tertiary font-mono text-xs">
              暂无匹配的 Git 提交记录
            </div>
          ) : (
            <table className="w-full border-collapse text-[11px] font-mono text-text-secondary select-none">
              <thead className="sticky top-0 bg-background-secondary text-text-secondary border-b border-border-primary text-left z-10">
                <tr>
                  <th className="py-2 pl-3" style={{ width: `${maxLanes * 14 + 15}px` }}>Graph</th>
                  <th className="py-2 px-3">Message</th>
                </tr>
              </thead>
              <tbody>
                {graphRows.map((row) => {
                  const isSelected = selectedCommit?.hash === row.commit.hash;
                  const commitRefs = parseRefs(row.commit.refs);

                  return (
                    <tr
                      key={row.commit.hash}
                      onClick={() => setSelectedCommit(row.commit)}
                      onMouseEnter={(e) => {
                        setHoveredCommit({
                          commit: row.commit,
                          x: e.clientX,
                          y: e.clientY
                        });
                      }}
                      onMouseMove={(e) => {
                        setHoveredCommit({
                          commit: row.commit,
                          x: e.clientX,
                          y: e.clientY
                        });
                      }}
                      onMouseLeave={() => {
                        setHoveredCommit(null);
                      }}
                      className={`hover:bg-background-secondary/45 border-b border-border-primary/40 cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary/20 text-text-primary font-medium hover:bg-primary/20' : ''
                      }`}
                    >
                      {/* 1. Graph Cell */}
                      <td className="p-0 relative h-9">
                        <svg
                          className="absolute inset-0 overflow-visible pointer-events-none"
                          style={{ width: `${maxLanes * 14 + 10}px`, height: '100%' }}
                        >
                          {/* Draw connecting lines */}
                          {row.lines.map((line, idx) => {
                            const x1 = line.from * 14 + 10;
                            const y1 = 0;
                            const x2 = line.to * 14 + 10;
                            const y2 = 36; // row height is 36px
                            const path = `M ${x1} ${y1} C ${x1} 18, ${x2} 18, ${x2} ${y2}`;
                            return (
                              <path
                                key={idx}
                                d={path}
                                stroke={line.color}
                                strokeWidth={2}
                                fill="none"
                                strokeLinecap="round"
                              />
                            );
                          })}

                          {/* Draw commit circle node */}
                          <React.Fragment>
                            {isSelected && (
                              <circle
                                cx={row.lane * 14 + 10}
                                cy={18}
                                r={7}
                                fill="none"
                                stroke="#3b82f6"
                                strokeWidth={1.5}
                              />
                            )}
                            <circle
                              cx={row.lane * 14 + 10}
                              cy={18}
                              r={4}
                              fill={LANE_COLORS[row.lane % LANE_COLORS.length]}
                              stroke={theme === 'dark' ? '#0b0c10' : '#ffffff'}
                              strokeWidth={1.5}
                            />
                          </React.Fragment>
                        </svg>
                      </td>

                      {/* 2. Message & Badges */}
                      <td className="py-2 px-3 max-w-md truncate relative">
                        <div className="flex items-center space-x-1.5 overflow-hidden">
                          {/* Badges */}
                          {commitRefs.map((ref, idx) => {
                            let badgeStyle = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'; // local
                            if (ref.type === 'head') {
                              badgeStyle = 'bg-primary/20 text-primary border-primary/30 font-bold';
                            } else if (ref.type === 'remote') {
                              badgeStyle = 'bg-rose-500/10 text-rose-400 border-rose-500/25';
                            } else if (ref.type === 'tag') {
                              badgeStyle = 'bg-amber-500/10 text-amber-400 border-amber-500/25';
                            }

                            return (
                              <span
                                key={idx}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleBranchSwitch(ref.name);
                                }}
                                className={`px-1.5 py-0.5 rounded text-[9px] border cursor-pointer hover:brightness-125 whitespace-nowrap transition-all flex items-center space-x-0.5 ${badgeStyle}`}
                                title={`点击检出该分支: ${ref.name}`}
                              >
                                {ref.type === 'tag' ? <Tag className="w-2.5 h-2.5 flex-shrink-0" /> : <GitBranch className="w-2.5 h-2.5 flex-shrink-0" />}
                                <span className="max-w-[80px] truncate">{ref.name}</span>
                              </span>
                            );
                          })}
                          
                          {/* Message Text */}
                          <span className="truncate max-w-lg" title={row.commit.message}>
                            {row.commit.message}
                          </span>
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Resizer Handle */}
        <div
          className="w-[4px] hover:w-[6px] bg-border-primary hover:bg-primary/50 cursor-col-resize transition-all z-20 flex-shrink-0 relative"
          onMouseDown={handleMouseDown}
        />

        {/* Right Side: Commit Detail Panel */}
        <div
          style={{ width: `${rightPanelWidth}px` }}
          className="flex-shrink-0 bg-background-secondary/50 border-l border-border-primary flex flex-col min-w-[250px] select-none h-full"
        >
          {selectedCommit ? (
            <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
              {/* Commit info details */}
              <div className="p-4 border-b border-border-primary bg-background-secondary/30 flex-shrink-0">
                <h4 className="text-xs font-bold text-text-primary truncate" title={selectedCommit.message}>
                  📝 {selectedCommit.message}
                </h4>
              </div>

              {/* Files search filter */}
              <div className="p-3 border-b border-border-primary flex-shrink-0 flex items-center space-x-2 bg-background-secondary/20">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="过滤修改文件..."
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    className="bg-background-primary border border-border-primary hover:border-text-secondary focus:border-primary/50 text-[10px] pl-7 pr-2.5 py-1 rounded-lg w-full outline-none font-sans text-text-primary"
                  />
                  <Search className="w-3 h-3 text-text-tertiary absolute left-2 top-1/2 -translate-y-1/2" />
                </div>
                {modifiedFiles.length > 0 && (
                  <span className="text-[10px] text-text-secondary font-mono whitespace-nowrap bg-background-primary border border-border-primary px-2 py-0.5 rounded-full">
                    {modifiedFiles.length} 个文件
                  </span>
                )}
              </div>

              {/* Files tree list */}
              <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                {filesLoading ? (
                  <div className="py-12 text-center text-text-tertiary font-mono text-xs">
                    正在拉取变更文件...
                  </div>
                ) : fileTree.length === 0 ? (
                  <div className="py-12 text-center text-text-tertiary font-mono text-xs">
                    该提交未修改任何文件或无匹配结果
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {fileTree.map(node => renderFileNode(node, 0))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-text-tertiary font-mono text-xs p-6">
              <GitBranch className="w-10 h-10 text-text-tertiary/60 mb-2" />
              <p>请点击左侧列表中的提交</p>
              <p className="text-[9px] text-text-tertiary mt-1">查看详细修改的文件结构目录</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Hover Tooltip */}
      {hoveredCommit && (
        <div
          className="fixed z-[9999] bg-card border border-border-primary rounded-xl shadow-2xl p-3.5 max-w-sm pointer-events-none text-xs font-mono select-none flex flex-col space-y-2.5 animate-fade-in"
          style={{
            left: `${Math.min(hoveredCommit.x + 15, window.innerWidth - 340)}px`,
            top: `${Math.min(hoveredCommit.y + 15, window.innerHeight - 150)}px`
          }}
        >
          {/* Header: Author Info */}
          <div className="flex items-center space-x-2 text-text-primary">
            <User className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="font-bold text-text-primary">{hoveredCommit.commit.author}</span>
            <span className="text-[10px] text-text-tertiary font-normal truncate max-w-[150px]" title={hoveredCommit.commit.email}>
              &lt;{hoveredCommit.commit.email}&gt;
            </span>
          </div>

          {/* Date & Hash */}
          <div className="space-y-1 text-[10px] text-text-secondary border-b border-border-primary pb-2">
            <div className="flex items-center space-x-1.5">
              <Calendar className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
              <span>提交日期: {hoveredCommit.commit.date}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
              <span>Hash: {hoveredCommit.commit.hash}</span>
            </div>
          </div>

          {/* Commit Message */}
          <div className="text-text-secondary font-sans text-xs whitespace-pre-wrap break-all leading-relaxed">
            {hoveredCommit.commit.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default GitGraphTab;
