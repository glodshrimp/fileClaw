import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { X, Clock, User, Calendar, AlertTriangle } from 'lucide-react';

interface HistoryDialogProps {
  path: string;
  onClose: () => void;
}

export const HistoryDialog: React.FC<HistoryDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const openDiff = useWorkspaceStore((s) => s.openDiff);
  const projectPath = React.useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);

  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<Array<{ hash: string; author: string; date: string; message: string }>>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const getRelativePath = (absolutePath: string, root: string) => {
    if (!root || absolutePath === root) return undefined;
    let rel = absolutePath.substring(root.length);
    if (rel.startsWith('/') || rel.startsWith('\\')) {
      rel = rel.substring(1);
    }
    return rel.replace(/\\/g, '/');
  };

  const relPath = getRelativePath(path, projectPath);

  const fetchHistory = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const list = await window.electronAPI.gitHistory(projectPath, relPath);
      setCommits(list);
    } catch (err: any) {
      setErrorMsg('获取 Git 提交历史失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [projectPath, path]);

  const handleCommitDoubleClick = async (commitHash: string) => {
    if (!projectPath || !relPath) return;
    try {
      const originalContent = await window.electronAPI.gitShowFile(projectPath, commitHash, relPath);
      let modifiedContent = '';
      try {
        const localFile = await window.electronAPI.readFileBase64(path);
        if (localFile && localFile.data) {
          modifiedContent = localFile.data;
        }
      } catch (err) {
        console.error('Failed to read local file content, using empty string:', err);
      }
      
      const fileName = relPath.split('/').pop() || 'file';
      openDiff(
        path.replace(/\\/g, '/'),
        fileName,
        originalContent,
        modifiedContent,
        commitHash.substring(0, 7),
        'Current'
      );
      onClose();
    } catch (err: any) {
      console.error('Failed to open history diff:', err);
      alert('无法打开版本比对: ' + err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#111622] border border-white/10 w-full max-w-xl rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-950/20">
          <div className="flex items-center space-x-2 text-slate-200">
            <Clock className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold font-mono">
              提交日志: {relPath || '项目根目录'}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center space-x-2 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="font-mono">{errorMsg}</span>
          </div>
        )}

        {/* Commits List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin min-h-[300px]">
          {loading && commits.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs py-20">
              正在读取提交历史...
            </div>
          ) : commits.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs py-20 text-center">
              没有找到相关的提交记录
            </div>
          ) : (
            commits.map((commit) => (
              <div
                key={commit.hash}
                onDoubleClick={() => handleCommitDoubleClick(commit.hash)}
                className="bg-slate-950/40 border border-white/5 hover:border-white/10 hover:bg-slate-900/40 rounded-xl p-4 flex flex-col space-y-2 transition-all cursor-pointer select-none"
                title="Double click to compare with current version"
              >
                {/* Hash / Author / Date */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                  <span className="font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded select-all">
                    {commit.hash}
                  </span>
                  <div className="flex items-center space-x-3.5">
                    <span className="flex items-center space-x-1">
                      <User className="w-3.5 h-3.5 text-slate-600" />
                      <span className="text-slate-400 font-medium">{commit.author}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-600" />
                      <span className="text-slate-400">{commit.date}</span>
                    </span>
                  </div>
                </div>

                {/* Commit Message */}
                <div className="text-xs font-mono text-slate-200 font-medium whitespace-pre-wrap select-text leading-relaxed">
                  {commit.message}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
