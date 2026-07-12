import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../../../contexts/useWorkspaceStore';
import { X, Check, GitCommit, AlertTriangle } from 'lucide-react';

interface CommitDialogProps {
  path: string;
  onClose: () => void;
}

export const CommitDialog: React.FC<CommitDialogProps> = ({ path, onClose }) => {
  const gitRoots = useWorkspaceStore((s) => s.gitRoots);
  const openDiff = useWorkspaceStore((s) => s.openDiff);
  const projectPath = React.useMemo(() => {
    if (!gitRoots || gitRoots.length === 0) return '';
    const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
    return sorted.find(r => path.startsWith(r)) || gitRoots[0];
  }, [path, gitRoots]);
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [fileList, setFileList] = useState<Array<{ path: string; status: string; checked: boolean }>>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStatus = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const statuses = await window.electronAPI.gitStatus(projectPath);
      const list = Object.entries(statuses).map(([filePath, statusXY]) => {
        // XY status: check if it represents added/modified/untracked etc.
        const isUntracked = statusXY === '??' || statusXY === '?';
        // Auto-check modified/added, leave untracked unchecked by default
        return {
          path: filePath,
          status: statusXY,
          checked: !isUntracked
        };
      });
      setFileList(list);
    } catch (err: any) {
      setErrorMsg('获取 Git 状态失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [projectPath]);

  const handleFileDoubleClick = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    if (!projectPath) return;
    try {
      const fileStatus = fileList.find(f => f.path === filePath)?.status;
      const trimmed = fileStatus?.trim() || '';
      const isUntracked = trimmed === '??' || trimmed === '?';
      const isAdded = trimmed.includes('A');
      const isDeleted = trimmed.includes('D');

      const originalContent = (isUntracked || isAdded)
        ? ''
        : await window.electronAPI.gitShowFile(projectPath, 'HEAD', filePath);

      let modifiedContent = '';
      if (!isDeleted) {
        try {
          const absolutePath = `${projectPath}/${filePath}`.replace(/\\/g, '/');
          const localFile = await window.electronAPI.readFileBase64(absolutePath);
          if (localFile && localFile.data) {
            modifiedContent = localFile.data;
          }
        } catch (err) {
          console.error('Failed to read local file:', err);
        }
      }

      const absoluteFilePath = `${projectPath}/${filePath}`.replace(/\\/g, '/');
      const fileName = filePath.split('/').pop() || 'file';

      openDiff(
        absoluteFilePath,
        fileName,
        originalContent,
        modifiedContent,
        'HEAD',
        'Current'
      );
      onClose();
    } catch (err: any) {
      console.error('Failed to open diff in commit dialog:', err);
      alert('无法打开版本比对: ' + err.message);
    }
  };

  const handleToggleFile = (filePath: string) => {
    setFileList((prev) =>
      prev.map((f) => (f.path === filePath ? { ...f, checked: !f.checked } : f))
    );
  };

  const handleToggleAll = () => {
    const allChecked = fileList.every((f) => f.checked);
    setFileList((prev) => prev.map((f) => ({ ...f, checked: !allChecked })));
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg(null);

    const selectedFiles = fileList.filter((f) => f.checked).map((f) => f.path);
    if (selectedFiles.length === 0) {
      setErrorMsg('请选择至少一个文件进行提交');
      return;
    }
    if (!message.trim()) {
      setErrorMsg('请输入提交信息 (Commit Message)');
      return;
    }

    setLoading(true);
    try {
      await window.electronAPI.gitCommit(projectPath, selectedFiles, message.trim());
      onClose();
    } catch (err: any) {
      setErrorMsg('提交失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const trimmed = status.trim();
    if (trimmed === '??' || trimmed === '?') {
      return <span className="px-1.5 py-0.5 text-[9px] bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded">Untracked</span>;
    }
    if (trimmed.includes('M')) {
      return <span className="px-1.5 py-0.5 text-[9px] bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded">Modified</span>;
    }
    if (trimmed.includes('A')) {
      return <span className="px-1.5 py-0.5 text-[9px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded">Added</span>;
    }
    if (trimmed.includes('D')) {
      return <span className="px-1.5 py-0.5 text-[9px] bg-red-500/10 text-red-500 border border-red-500/20 rounded line-through">Deleted</span>;
    }
    return <span className="px-1.5 py-0.5 text-[9px] bg-slate-500/10 text-slate-400 border border-slate-500/20 rounded">{trimmed}</span>;
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#111622] border border-white/10 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-950/20">
          <div className="flex items-center space-x-2 text-slate-200">
            <GitCommit className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold font-mono">提交变更 (Commit Changes)</span>
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

        {/* Content */}
        <form onSubmit={handleCommit} className="flex-1 overflow-y-auto p-4 flex flex-col space-y-4">
          <div className="flex flex-col flex-1 min-h-[200px]">
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
              <span>选择文件 ({fileList.filter(f => f.checked).length} / {fileList.length})</span>
              {fileList.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleAll}
                  className="text-primary hover:underline"
                >
                  {fileList.every(f => f.checked) ? '全不选' : '全选'}
                </button>
              )}
            </div>

            {/* Changed Files Checkbox List */}
            <div className="flex-1 bg-slate-950/50 border border-white/5 rounded-lg overflow-y-auto max-h-[300px] min-h-[150px] p-2 space-y-0.5 scrollbar-thin">
              {loading && fileList.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  正在读取 Git 变更...
                </div>
              ) : fileList.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  没有检测到任何已修改的文件
                </div>
              ) : (
                fileList.map((file) => (
                  <div
                    key={file.path}
                    onClick={() => handleToggleFile(file.path)}
                    onDoubleClick={(e) => handleFileDoubleClick(e, file.path)}
                    className="flex items-center space-x-2 px-2 py-1.5 hover:bg-white/5 rounded cursor-pointer transition-colors text-[11px] font-mono text-slate-300 hover:text-white select-none"
                    title="Double click to compare with HEAD"
                  >
                    <input
                      type="checkbox"
                      checked={file.checked}
                      onChange={() => {}} // handled by div click
                      className="rounded border-white/10 text-primary focus:ring-0 focus:ring-offset-0 cursor-pointer bg-slate-900"
                    />
                    <span className="flex-1 truncate">{file.path}</span>
                    {getStatusBadge(file.status)}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Commit Message Box */}
          <div className="flex flex-col">
            <label className="text-xs text-slate-400 font-mono mb-2">提交说明 (Commit Message)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="请输入本次提交的修改说明..."
              rows={4}
              required
              className="w-full bg-slate-905 border border-white/10 focus:border-primary/50 text-xs text-white rounded-lg p-2.5 focus:outline-none placeholder-slate-500 font-mono transition-all resize-none"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-xs font-mono text-slate-300 hover:text-white rounded-lg border border-white/5 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || fileList.length === 0}
              className="px-4 py-2 bg-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-mono font-medium text-white rounded-lg transition-all flex items-center space-x-1.5 shadow-lg shadow-primary/10"
            >
              <Check className="w-3.5 h-3.5" />
              <span>提交 (Commit)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
