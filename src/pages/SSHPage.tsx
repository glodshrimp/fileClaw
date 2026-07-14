import React, { useState } from 'react';
import {
  Server, Plus, Edit2, Trash2, Copy, Eye, EyeOff,
  Terminal as TerminalIcon, Folder, Play, Loader2,
  Wifi, WifiOff, AlertCircle, X, List, Share2, Shield, Radio, Power,
  ChevronDown, ChevronUp, Upload, Download, Monitor, LayoutGrid, ChevronRight
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { SSHInfo, SSHTunnel } from '../types';
import Terminal from '../components/ssh/Terminal';
import SftpBrowser from '../components/ssh/SftpBrowser';
import StatusFooter from '../components/ssh/StatusFooter';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { copyToClipboard } from '../utils/copy';

// ─────────────────────────────────────────────
// Session state type
// ─────────────────────────────────────────────
interface SessionState {
  key: string; // unique: sshId + '_' + timestamp
  ssh: SSHInfo;
  connStatus: 'connecting' | 'connected' | 'error' | 'reconnecting';
  connError: string;
  activeTab: 'terminal' | 'sftp';
  /** When true, terminal runs in local PTY mode (zsh/powershell) instead of SSH */
  localMode?: boolean;
}

const SSHPage: React.FC = () => {
  const { state, dispatch } = useApp();

  // ── Modal / form state ──────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingSSH, setEditingSSH] = useState<SSHInfo | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [expandedTunnels, setExpandedTunnels] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    return (localStorage.getItem('ssh_view_mode') as 'card' | 'list') || 'card';
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('ssh_collapsed_groups');
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const handleSetViewMode = (mode: 'card' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('ssh_view_mode', mode);
  };

  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      localStorage.setItem('ssh_collapsed_groups', JSON.stringify(Array.from(next)));
      return next;
    });
  };
  const [formData, setFormData] = useState({
    name: '', host: '', port: '22', username: '', keyPath: '', password: '', description: '', group: '',
    tunnels: [] as SSHTunnel[],
  });

  // Multi-session state moved to AppContext
  const sessions = state.sshSessions;
  const activeSessionKey = state.activeSessionKey;
  const setSessions = (newSessions: any) => {
    const val = typeof newSessions === 'function' ? newSessions(sessions) : newSessions;
    dispatch({ type: 'SET_SSH_SESSIONS', payload: val });
  };
  const setActiveSessionKey = (key: string | null) => dispatch({ type: 'SET_ACTIVE_SESSION_KEY', payload: key });

  const [closingKey, setClosingKey] = useState<string | null>(null); // for disconnect confirm

  const reconnectAttemptsRef = React.useRef<Record<string, number>>({});
  const sessionsRef = React.useRef(sessions);
  sessionsRef.current = sessions;

  const autoSilentReconnect = (key: string) => {
    const s = sessionsRef.current.find(ss => ss.key === key);
    if (!s) return;

    const attempts = reconnectAttemptsRef.current[key] || 0;
    if (attempts >= 3) {
      console.log(`[SSH Auto-reconnect] Max retry attempts (3) reached for session ${key}. Mark as error.`);
      dispatch({
        type: 'UPDATE_SSH_SESSION',
        payload: { ...s, connStatus: 'error', connError: '连接异常断开，后台已尝试3次自动重连均失败，请检查网络后手动重试。' }
      });
      window.electronAPI.emitSshOutput(key, `\r\n\x1b[31m[系统提示: 已尝试3次自动重连均失败，停止重连。请检查网络后手动重试。]\x1b[0m\r\n`);
      dispatch({ type: 'ABORT_SESSION_TRANSFER_JOBS', payload: { sshId: key } });
      delete reconnectAttemptsRef.current[key];
      return;
    }

    const nextAttempt = attempts + 1;
    reconnectAttemptsRef.current[key] = nextAttempt;

    console.log(`[SSH Auto-reconnect] Attempting auto-reconnect #${nextAttempt} for session ${key} in 5 seconds...`);
    window.electronAPI.emitSshOutput(key, `\r\n\x1b[33m[系统提示: 正在进行第 ${nextAttempt} 次自动重连...]\x1b[0m\r\n`);

    dispatch({
      type: 'UPDATE_SSH_SESSION',
      payload: { 
        ...s, 
        connStatus: 'reconnecting', 
        connError: `正在进行第 ${nextAttempt} 次自动重连...` 
      }
    });

    setTimeout(() => {
      const sLatest = sessionsRef.current.find(ss => ss.key === key);
      if (!sLatest || sLatest.localMode || closingKey === key) {
        console.log(`[SSH Auto-reconnect] Session ${key} was closed or switched to localMode. Abort reconnect.`);
        return;
      }

      const options = {
        host: sLatest.ssh.host, port: sLatest.ssh.port, username: sLatest.ssh.username,
        password: sLatest.ssh.password || undefined,
        keyPath: sLatest.ssh.keyPath || undefined,
      };

      window.electronAPI.sshConnect(key, options)
        .then(async (res) => {
          if (res.success) {
            console.log(`[SSH Auto-reconnect] Session ${key} successfully reconnected!`);
            window.electronAPI.emitSshOutput(key, `\r\n\x1b[32m[系统提示: SSH 连接第 ${nextAttempt} 次重连成功!]\x1b[0m\r\n`);
            delete reconnectAttemptsRef.current[key];

            dispatch({
              type: 'UPDATE_SSH_SESSION',
              payload: { ...sLatest, connStatus: 'connected', connError: '' }
            });

            if (sLatest.ssh.tunnels && sLatest.ssh.tunnels.length > 0) {
              for (const t of sLatest.ssh.tunnels) {
                try {
                  if (t.type === 'local') {
                    await window.electronAPI.sshForwardLocal(key, t.id, t.localPort, t.remoteHost, t.remotePort);
                  } else {
                    await window.electronAPI.sshForwardRemote(key, t.id, t.remotePort, t.localHost, t.localPort);
                  }
                } catch (err) {
                  console.error(`Failed to restart tunnel ${t.name}:`, err);
                }
              }
            }
          } else {
            console.log(`[SSH Auto-reconnect] Session ${key} reconnect attempt #${nextAttempt} failed: ${res.error}`);
            window.electronAPI.emitSshOutput(key, `\r\n\x1b[31m[系统提示: 第 ${nextAttempt} 次重连失败: ${res.error || '未知原因'}]\x1b[0m\r\n`);
            autoSilentReconnect(key);
          }
        })
        .catch((err: any) => {
          console.error(`[SSH Auto-reconnect] Session ${key} reconnect attempt #${nextAttempt} caught error:`, err);
          window.electronAPI.emitSshOutput(key, `\r\n\x1b[31m[系统提示: 第 ${nextAttempt} 次重连异常: ${err?.message || err || '未知异常'}]\x1b[0m\r\n`);
          autoSilentReconnect(key);
        });
    }, 5000);
  };

  // ── Connect ─────────────────────────────────
  const handleConnect = (ssh: SSHInfo) => {
    const key = `${ssh.id}_${Date.now()}`;
    const newSession: SessionState = {
      key, ssh, connStatus: 'connecting', connError: '', activeTab: 'terminal',
    };
    dispatch({ type: 'ADD_SSH_SESSION', payload: newSession });
    setActiveSessionKey(key);

    const options = {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      password: ssh.password || undefined,
      keyPath: ssh.keyPath || undefined,
    };

    window.electronAPI.sshConnect(key, options)
      .then(async (res) => {
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...newSession, connStatus: res.success ? 'connected' : 'error', connError: res.error || '连接失败' }
        });
        if (res.success && ssh.tunnels && ssh.tunnels.length > 0) {
          for (const t of ssh.tunnels) {
            try {
              if (t.type === 'local') {
                await window.electronAPI.sshForwardLocal(key, t.id, t.localPort, t.remoteHost, t.remotePort);
              } else {
                await window.electronAPI.sshForwardRemote(key, t.id, t.remotePort, t.localHost, t.localPort);
              }
            } catch (err) {
              console.error(`Failed to start tunnel ${t.name}:`, err);
            }
          }
        }
      })
      .catch((err: any) => {
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...newSession, connStatus: 'error', connError: err?.message || '未知错误' }
        });
      });
  };

  // ── Close / disconnect session ───────────────
  const requestClose = (key: string) => setClosingKey(key);

  const confirmClose = async () => {
    if (!closingKey) return;
    const key = closingKey;
    const closingSession = sessions.find(s => s.key === key);
    setClosingKey(null);

    if (closingSession?.localMode) {
      // Local terminal mode: destroy all PTY processes (including split panes)
      await window.electronAPI.ptyDestroySession(key);
    } else {
      await window.electronAPI.sshDisconnect(key);
    }

    const remaining = sessions.filter(s => s.key !== key);
    dispatch({ type: 'DELETE_SSH_SESSION', payload: key });

    if (activeSessionKey === key) {
      setActiveSessionKey(remaining.length > 0 ? remaining[remaining.length - 1].key : null);
    }
  };

  const setSessionTab = (key: string, tab: 'terminal' | 'sftp') => {
    const s = sessions.find(ss => ss.key === key);
    if (s) {
      dispatch({ type: 'UPDATE_SSH_SESSION', payload: { ...s, activeTab: tab } });
    }
  };

  const retryConnect = (key: string) => {
    const s = sessions.find(s => s.key === key);
    if (!s) return;

    delete reconnectAttemptsRef.current[key]; // clear automatic attempts count

    dispatch({ type: 'UPDATE_SSH_SESSION', payload: { ...s, connStatus: 'connecting', connError: '' } });

    const options = {
      host: s.ssh.host, port: s.ssh.port, username: s.ssh.username,
      password: s.ssh.password || undefined,
      keyPath: s.ssh.keyPath || undefined,
    };
    window.electronAPI.sshConnect(key, options)
      .then(async (res) => {
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...s, connStatus: res.success ? 'connected' : 'error', connError: res.error || '连接失败' }
        });
        if (res.success && s.ssh.tunnels && s.ssh.tunnels.length > 0) {
          for (const t of s.ssh.tunnels) {
            try {
              if (t.type === 'local') {
                await window.electronAPI.sshForwardLocal(key, t.id, t.localPort, t.remoteHost, t.remotePort);
              } else {
                await window.electronAPI.sshForwardRemote(key, t.id, t.remotePort, t.localHost, t.localPort);
              }
            } catch (err) {
              console.error(`Failed to restart tunnel ${t.name}:`, err);
            }
          }
        }
      })
      .catch((err: any) => {
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...s, connStatus: 'error', connError: err?.message || '未知错误' }
        });
      });
  };

  // ── List / form handlers ─────────────────────
  const handleCopyCommand = (ssh: SSHInfo) => {
    const command = ssh.keyPath
      ? `ssh -i ${ssh.keyPath} ${ssh.username}@${ssh.host} -p ${ssh.port}`
      : `ssh ${ssh.username}@${ssh.host} -p ${ssh.port}`;
    navigator.clipboard.writeText(command);
  };

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTunnelVisibility = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedTunnels(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sshData: SSHInfo = {
      id: editingSSH?.id || Date.now().toString(),
      name: formData.name,
      host: formData.host,
      port: parseInt(formData.port),
      username: formData.username,
      keyPath: formData.keyPath || undefined,
      password: formData.password || undefined,
      description: formData.description,
      group: formData.group || undefined,
      tunnels: formData.tunnels,
      createdAt: editingSSH?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingSSH) {
        // @ts-ignore
        const updated = await window.electronAPI?.updateSSHInfo(editingSSH.id, sshData);
        dispatch({ type: 'UPDATE_SSH_INFO', payload: updated as any });
      } else {
        // @ts-ignore
        const added = await window.electronAPI?.addSSHInfo(sshData);
        dispatch({ type: 'ADD_SSH_INFO', payload: added as any });
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      console.error('Failed to save SSH info:', error);
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteTargetId(id);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      // @ts-ignore
      await window.electronAPI?.deleteSSHInfo(deleteTargetId);
      dispatch({ type: 'DELETE_SSH_INFO', payload: deleteTargetId });
    } catch (error) {
      console.error('Failed to delete SSH info:', error);
    } finally {
      setIsDeleteModalOpen(false);
      setDeleteTargetId(null);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', host: '', port: '22', username: '', keyPath: '', password: '', description: '', group: '', tunnels: [] });
    setEditingSSH(null);
  };

  const openEditModal = (ssh: SSHInfo) => {
    setEditingSSH(ssh);
    setFormData({
      name: ssh.name, host: ssh.host, port: ssh.port.toString(),
      username: ssh.username, keyPath: ssh.keyPath || '',
      password: ssh.password || '', description: ssh.description,
      group: ssh.group || '',
      tunnels: ssh.tunnels || [],
    });
    setIsModalOpen(true);
  };

  // ── Active session object ────────────────────
  const activeSession = sessions.find(s => s.key === activeSessionKey) ?? null;

  // ── Global SSH event listeners ─────────────────
  React.useEffect(() => {
    const unlisteners: Array<() => void> = [];
    sessions.forEach(s => {
      // Listen for unexpected disconnections
      if ((s.connStatus === 'connected' || s.connStatus === 'connecting' || s.connStatus === 'reconnecting') && !s.localMode) {
        const u1 = window.electronAPI.onSshClosed(s.key, () => {
          if (closingKey === s.key) {
            dispatch({ type: 'UPDATE_SSH_SESSION', payload: { ...s, connStatus: 'error', connError: '连接意外断开等 (Session Closed)' } });
            dispatch({ type: 'ABORT_SESSION_TRANSFER_JOBS', payload: { sshId: s.key } });
          } else {
            autoSilentReconnect(s.key);
          }
        });
        const u2 = window.electronAPI.onSshError(s.key, (err: string) => {
          if (closingKey === s.key) {
            dispatch({ type: 'UPDATE_SSH_SESSION', payload: { ...s, connStatus: 'error', connError: err || '连接异常断开' } });
            dispatch({ type: 'ABORT_SESSION_TRANSFER_JOBS', payload: { sshId: s.key } });
          } else {
            autoSilentReconnect(s.key);
          }
        });
        unlisteners.push(u1, u2);
      }
    });
    return () => unlisteners.forEach(u => u());
  }, [sessions, dispatch, closingKey]);

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Session tab bar (shows whenever sessions exist) ── */}
      {sessions.length > 0 && (
        <div className="flex items-center bg-background-secondary border-b border-border-primary overflow-x-auto flex-shrink-0 select-none">
          {/* SSH list tab */}
          <button
            onClick={() => setActiveSessionKey(null)}
            className={`flex items-center space-x-1.5 px-3 py-1 text-[11px] font-medium border-r border-border-primary transition-colors flex-shrink-0 relative h-8 ${!activeSessionKey
                ? 'text-text-primary bg-background-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-primary/80'
              }`}
          >
            {!activeSessionKey && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t" />}
            <List className="w-3 h-3" />
            <span>SSH 列表</span>
          </button>

          {/* Session tabs */}
          {sessions.map(s => (
            <div
              key={s.key}
              onClick={() => setActiveSessionKey(s.key)}
              onDoubleClick={() => s.connStatus === 'connected' && handleConnect(s.ssh)}
              className={`group flex items-center space-x-2 px-3 py-1 text-[11px] font-medium border-r border-border-primary cursor-pointer transition-colors flex-shrink-0 min-w-0 max-w-[180px] relative h-8 ${s.key === activeSessionKey
                  ? 'text-text-primary bg-background-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-background-primary/80'
                }`}
            >
              {/* Active indicator line */}
              {s.key === activeSessionKey && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t" />}
              {/* Status dot */}
              {s.connStatus === 'connecting' && <Loader2 className="w-2.5 h-2.5 text-amber-400 animate-spin flex-shrink-0" />}
              {s.connStatus === 'reconnecting' && <Loader2 className="w-2.5 h-2.5 text-amber-400 animate-spin flex-shrink-0" />}
              {s.connStatus === 'connected' && !s.localMode && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
              {s.connStatus === 'connected' && s.localMode && <Monitor className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />}
              {s.connStatus === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
              <span className="truncate">{s.localMode ? `本地终端 #${sessions.filter(ss => ss.localMode).indexOf(s) + 1}` : s.ssh.name}</span>
              {/* Close button */}
              <button
                onClick={(e) => { e.stopPropagation(); requestClose(s.key); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-background-secondary text-text-secondary hover:text-text-primary transition-all flex-shrink-0 ml-1"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Content area ── */}
      <div className="flex-1 overflow-hidden relative">

        {/* SSH list view */}
        <div className={`absolute inset-0 flex flex-col transition-opacity ${activeSessionKey ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}>
          <div className="flex items-center justify-between p-4 flex-shrink-0 border-b border-border/30">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索 SSH..."
                  className="input-base w-64 pl-10 pr-4"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className="flex items-center p-0.5 bg-background-secondary border border-border rounded-lg">
                <button
                  onClick={() => handleSetViewMode('card')}
                  className={`p-1 rounded-md transition-all ${
                    viewMode === 'card'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                  title="卡片视图"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleSetViewMode('list')}
                  className={`p-1 rounded-md transition-all ${
                    viewMode === 'list'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                  title="列表视图"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              <button onClick={() => setIsModalOpen(true)} className="btn-nexus-blue flex items-center space-x-1.5 !px-2.5 !py-1 !text-xs">
                <Plus className="w-3.5 h-3.5" />
                <span>新增 SSH</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div>
              {(() => {
                if (state.sshInfo.length === 0) {
                  return (
                    <div className="bg-background-secondary border border-border rounded-lg p-12 text-center">
                      <Server className="w-16 h-16 mx-auto mb-4 text-text-tertiary/30" />
                      <p className="text-text-secondary">暂无 SSH 信息，点击上方按钮添加第一条信息</p>
                    </div>
                  );
                }
                const filteredSSH = state.sshInfo.filter(ssh => {
                  const q = searchQuery.toLowerCase();
                  return ssh.name.toLowerCase().includes(q) ||
                    ssh.host.toLowerCase().includes(q) ||
                    ssh.description.toLowerCase().includes(q) ||
                    (ssh.group || '未分组').toLowerCase().includes(q);
                });
                if (filteredSSH.length === 0) {
                  return (
                    <div className="bg-background-secondary border border-border rounded-lg p-12 text-center">
                      <p className="text-text-secondary">没有找到匹配的 SSH 信息</p>
                    </div>
                  );
                }
                const groupedSSH = filteredSSH.reduce((acc, ssh) => {
                  const g = ssh.group || '未分组';
                  if (!acc[g]) acc[g] = [];
                  acc[g].push(ssh);
                  return acc;
                }, {} as Record<string, typeof state.sshInfo>);

                return (
                  <div className="space-y-5">
                    {Object.entries(groupedSSH)
                      .sort(([a], [b]) => a === '未分组' ? 1 : b === '未分组' ? -1 : a.localeCompare(b))
                      .map(([groupName, sshList]) => (
                        <div key={groupName} className="space-y-2.5">
                          <div 
                            onClick={() => toggleGroupCollapse(groupName)}
                            className="flex items-center space-x-2 cursor-pointer select-none group/title py-1 pl-1"
                          >
                            {collapsedGroups.has(groupName) ? (
                              <ChevronRight className="w-4 h-4 text-text-tertiary group-hover/title:text-text-secondary transition-colors" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-text-tertiary group-hover/title:text-text-secondary transition-colors" />
                            )}
                            <h3 className={`text-sm font-bold uppercase tracking-wider ${
                              groupName !== '未分组' ? 'text-text-secondary' : 'text-text-tertiary'
                            }`}>
                              {groupName} ({sshList.length})
                            </h3>
                          </div>

                          {!collapsedGroups.has(groupName) && (
                            viewMode === 'card' ? (
                              <div className="flex flex-wrap gap-4">
                                {sshList.map((ssh) => {
                                  const activeSessions = sessions.filter(s => s.ssh.id === ssh.id);
                                  return (
                                    <div key={ssh.id} onDoubleClick={() => handleConnect(ssh)} className="bg-card border border-border hover:border-primary/50 rounded-lg p-4 card-hover shadow-sm flex-1 min-w-[320px] max-w-full xl:max-w-[calc(33.33%-0.8rem)] cursor-pointer transition-all">
                                      <div className="flex flex-col h-full gap-3">
                                        <div className="flex-1">
                                          <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center space-x-3">
                                              <div className="w-8 h-8 bg-functional-success/10 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <Server className="w-4 h-4 text-functional-success" />
                                              </div>
                                              <div className="min-w-0">
                                                <div className="flex items-center space-x-2">
                                                  <h3 className="text-sm font-semibold text-text-primary truncate">{ssh.name}</h3>
                                                  {activeSessions.length > 0 && (
                                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                                                      {activeSessions.length} 个会话
                                                    </span>
                                                  )}
                                                </div>
                                                <p className="text-xs text-text-tertiary truncate">{ssh.description}</p>
                                              </div>
                                            </div>
                                            
                                            <div className="flex items-center space-x-1 flex-shrink-0 ml-2 -mr-2">
                                              <button onClick={() => openEditModal(ssh)} onDoubleClick={(e) => e.stopPropagation()} className="p-1.5 hover-gradient-primary rounded-lg text-text-tertiary" title="编辑">
                                                <Edit2 className="w-4 h-4" />
                                              </button>
                                              <button onClick={() => handleDeleteClick(ssh.id)} onDoubleClick={(e) => e.stopPropagation()} className="p-1.5 hover-gradient-danger rounded-lg text-functional-error" title="删除">
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                              <button onClick={() => handleConnect(ssh)} onDoubleClick={(e) => e.stopPropagation()} className="p-1.5 bg-primary/10 hover-gradient-primary rounded-lg text-primary ml-1" title="新建连接">
                                                <Play className="w-4 h-4" />
                                              </button>
                                            </div>
                                          </div>
                                          <div className="mt-2 space-y-1">
                                            <div className="flex items-center space-x-3 text-xs">
                                              <span className="text-text-secondary">主机:</span>
                                              <span className="font-mono text-text-primary">{ssh.host}</span>
                                              <span className="text-text-secondary">端口:</span>
                                              <span className="font-mono text-text-primary">{ssh.port}</span>
                                            </div>
                                            <div className="flex items-center space-x-3 text-xs">
                                              <span className="text-text-secondary">用户:</span>
                                              <span className="font-mono text-text-primary">{ssh.username}</span>
                                            </div>
                                            {ssh.password && (
                                              <div className="flex items-center space-x-3 text-xs mt-0.5">
                                                <span className="text-text-secondary">密码:</span>
                                                <div className="flex items-center space-x-1">
                                                  <span className="font-mono text-text-primary mr-2">
                                                    {visiblePasswords.has(ssh.id) ? ssh.password : '••••••••'}
                                                  </span>
                                                  <button onClick={() => togglePasswordVisibility(ssh.id)} className="p-1 hover:bg-gray-200 rounded">
                                                    {visiblePasswords.has(ssh.id) ? <EyeOff className="w-3.5 h-3.5 text-text-tertiary" /> : <Eye className="w-3.5 h-3.5 text-text-tertiary" />}
                                                  </button>
                                                  <button onClick={(e) => copyToClipboard(ssh.password || '', e)} className="p-1 hover:bg-gray-200 rounded">
                                                    <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                            {/* Active sessions quick-switch */}
                                            {activeSessions.length > 0 && (
                                              <div className="flex flex-wrap gap-2 mt-2">
                                                {activeSessions.map(s => (
                                                  <button
                                                    key={s.key}
                                                    onClick={() => setActiveSessionKey(s.key)}
                                                    className="flex items-center space-x-1.5 text-xs px-2.5 py-1 bg-background-secondary dark:bg-background-tertiary text-text-secondary hover:bg-primary/10 hover:text-primary rounded-full transition-colors"
                                                  >
                                                    {s.connStatus === 'connected' && <Wifi className="w-3 h-3 text-green-500" />}
                                                    {s.connStatus === 'connecting' && <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />}
                                                    {s.connStatus === 'error' && <WifiOff className="w-3 h-3 text-red-500" />}
                                                    <span>切换到会话</span>
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                          </div>

                                          {/* Tunnel list in card */}
                                          {ssh.tunnels && ssh.tunnels.length > 0 && (
                                            <div className="mt-2.5 pt-2.5 border-t border-border/50">
                                              <div 
                                                className="flex items-center justify-between cursor-pointer group select-none"
                                                onClick={(e) => toggleTunnelVisibility(ssh.id, e)}
                                              >
                                                <div className="flex items-center space-x-2 text-xs font-bold text-text-tertiary uppercase tracking-wider group-hover:text-text-secondary transition-colors">
                                                  <Share2 className="w-3 h-3" />
                                                  <span>SSH 隧道 ({ssh.tunnels.length})</span>
                                                </div>
                                                {expandedTunnels.has(ssh.id) ? (
                                                  <ChevronUp className="w-4 h-4 text-text-tertiary group-hover:text-text-secondary transition-colors" />
                                                ) : (
                                                  <ChevronDown className="w-4 h-4 text-text-tertiary group-hover:text-text-secondary transition-colors" />
                                                )}
                                              </div>
                                              
                                              {expandedTunnels.has(ssh.id) && (
                                                <div className="space-y-2 mt-3 animate-fade-in">
                                                  {ssh.tunnels.map((t) => (
                                                    <div key={t.id} className="flex items-center justify-between text-xs p-2 bg-background-secondary rounded-lg border border-border/40">
                                                      <div className="flex items-center space-x-3">
                                                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${t.type === 'local' ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'
                                                          }`}>
                                                          {t.type === 'local' ? 'L' : 'R'}
                                                        </span>
                                                        <span className="font-medium text-text-primary">{t.name}</span>
                                                        <span className="text-text-tertiary">
                                                          {t.type === 'local'
                                                            ? `127.0.0.1:${t.localPort} → ${t.remoteHost}:${t.remotePort}`
                                                            : `${t.remotePort} → ${t.localHost}:${t.localPort}`}
                                                        </span>
                                                      </div>
                                                      <div className="flex items-center space-x-2">
                                                        {activeSessions.length > 0 && activeSessions[0].connStatus === 'connected' && (
                                                          <button
                                                            onClick={async (e) => {
                                                              e.stopPropagation();
                                                              const session = activeSessions[0];
                                                              // Stop any existing tunnel first to avoid port conflicts
                                                              try {
                                                                await window.electronAPI.sshStopTunnel(session.key, t.id);
                                                                await new Promise(r => setTimeout(r, 300)); // Wait for OS to release port
                                                              } catch (_) { /* ignore if not running */ }
                                                              try {
                                                                if (t.type === 'local') {
                                                                  await window.electronAPI.sshForwardLocal(session.key, t.id, t.localPort, t.remoteHost, t.remotePort);
                                                                } else {
                                                                  await window.electronAPI.sshForwardRemote(session.key, t.id, t.remotePort, t.localHost, t.localPort);
                                                                }
                                                              } catch (err: any) {
                                                                console.error(`Failed to start tunnel ${t.name}:`, err);
                                                              }
                                                            }}
                                                            className="p-1 hover:bg-background-tertiary rounded text-text-tertiary hover:text-primary transition-colors"
                                                            title="启动隧道"
                                                          >
                                                            <Power className="w-3 h-3" />
                                                          </button>
                                                        )}
                                                      </div>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="overflow-x-auto border border-border rounded-lg bg-background shadow-sm">
                                <table className="min-w-full divide-y divide-border">
                                  <thead className="bg-background-secondary">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">名称 / 描述</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">连接信息 (主机:端口)</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">用户名</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">隧道</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">活动会话</th>
                                      <th className="px-4 py-2 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">操作</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/60 bg-background">
                                    {sshList.map((ssh) => {
                                      const activeSessions = sessions.filter(s => s.ssh.id === ssh.id);
                                      return (
                                        <tr key={ssh.id} className="hover:bg-background-secondary/30 transition-colors">
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <div className="flex items-center space-x-2">
                                              <div className="w-7 h-7 bg-functional-success/10 rounded flex items-center justify-center flex-shrink-0">
                                                <Server className="w-3.5 h-3.5 text-functional-success" />
                                              </div>
                                              <div className="min-w-0">
                                                <div className="text-xs font-semibold text-text-primary truncate max-w-[180px]" title={ssh.name}>{ssh.name}</div>
                                                <div className="text-[10px] text-text-tertiary truncate max-w-[220px]" title={ssh.description}>{ssh.description || '无描述'}</div>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="font-mono text-xs text-text-primary">{ssh.host}:{ssh.port}</span>
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="font-mono text-xs text-text-secondary">{ssh.username}</span>
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            {ssh.tunnels && ssh.tunnels.length > 0 ? (
                                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary">
                                                {ssh.tunnels.length} 个隧道
                                              </span>
                                            ) : (
                                              <span className="text-xs text-text-tertiary">-</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <div className="flex flex-wrap gap-1">
                                              {activeSessions.length > 0 ? (
                                                activeSessions.map(s => (
                                                  <button
                                                    key={s.key}
                                                    onClick={() => setActiveSessionKey(s.key)}
                                                    className="flex items-center space-x-1 text-[9px] px-2 py-0.5 bg-background-secondary border border-border text-text-secondary hover:bg-primary/10 hover:text-primary rounded-full transition-colors"
                                                  >
                                                    {s.connStatus === 'connected' && <Wifi className="w-2.5 h-2.5 text-green-500" />}
                                                    {s.connStatus === 'connecting' && <Loader2 className="w-2.5 h-2.5 text-amber-500 animate-spin" />}
                                                    {s.connStatus === 'error' && <WifiOff className="w-2.5 h-2.5 text-red-500" />}
                                                    <span>#{s.key.split('_')[1]?.slice(-4) || '1'}</span>
                                                  </button>
                                                ))
                                              ) : (
                                                <span className="text-xs text-text-tertiary">-</span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap text-right text-xs font-medium">
                                            <div className="inline-flex items-center space-x-1">
                                              <button onClick={() => openEditModal(ssh)} className="p-1 hover-gradient-primary rounded text-text-tertiary" title="编辑">
                                                <Edit2 className="w-3.5 h-3.5" />
                                              </button>
                                              <button onClick={() => handleDeleteClick(ssh.id)} className="p-1 hover-gradient-danger rounded text-functional-error" title="删除">
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                              <button onClick={() => handleConnect(ssh)} className="p-1 bg-primary/10 hover:bg-primary/20 rounded text-primary ml-1" title="新建连接">
                                                <Play className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )
                          )}
                        </div>
                      ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Session workspaces — all mounted, only active one visible */}
        {sessions.map(s => (
          <div
            key={s.key}
            className={`absolute inset-0 flex flex-col transition-opacity ${s.key === activeSessionKey ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
              }`}
          >
            {/* Session sub-header — seamless continuation of the tab bar */}
            <div className="flex items-center justify-between px-3 py-1 bg-background-secondary/95 border-b border-border-primary flex-shrink-0">
              <div className="flex items-center space-x-3">
                              {/* Terminal / SFTP switcher */}
                <div className="flex items-center space-x-0.5 bg-background-primary/60 p-0.5 rounded-lg border border-border-primary">
                  {/* Terminal button */}
                  <button
                    onClick={() => setSessionTab(s.key, 'terminal')}
                    disabled={s.connStatus !== 'connected' && s.connStatus !== 'reconnecting'}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors flex items-center space-x-1 disabled:opacity-30 ${s.activeTab === 'terminal'
                        ? 'bg-background-tertiary text-text-primary shadow-sm'
                        : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary/60'
                      }`}
                  >
                    <TerminalIcon className="w-3 h-3" />
                    <span>终端</span>
                  </button>
                  {/* SFTP button — shows active-transfer badge */}
                  {(() => {
                    const activeTransfers = (state.transferJobs[s.key] || []).filter(j => !j.done).length;
                    return (
                      <button
                        onClick={() => setSessionTab(s.key, 'sftp')}
                        disabled={(s.connStatus !== 'connected' && s.connStatus !== 'reconnecting') || s.localMode}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors flex items-center space-x-1 disabled:opacity-30 ${s.activeTab === 'sftp'
                            ? 'bg-background-tertiary text-text-primary shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary/60'
                          }`}
                      >
                        <Folder className="w-3 h-3" />
                        <span>SFTP</span>
                        {activeTransfers > 0 && (
                          <span className="ml-0.5 min-w-[14px] h-3.5 px-1 text-[9px] font-bold bg-blue-500 text-white rounded-full flex items-center justify-center leading-none">
                            {activeTransfers}
                          </span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-3">
                  {/* Status indicator */}
                  <div className="flex items-center space-x-2">
                    {(s.connStatus === 'connecting' || s.connStatus === 'reconnecting') && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
                    {s.connStatus === 'connected' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow shadow-green-400/50" />}
                    {s.connStatus === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                    <span className="font-mono text-[11px] text-gray-400">{s.ssh.username}@{s.ssh.host}:{s.ssh.port}</span>
                  </div>
                  {/* Status badge */}
                  {s.connStatus === 'connecting' && <span className="text-[10px] text-amber-400/80 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0 rounded-full">连接中</span>}
                  {s.connStatus === 'reconnecting' && <span className="text-[10px] text-amber-400/80 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0 rounded-full animate-pulse">重连中</span>}
                  {s.connStatus === 'error' && <span className="text-[10px] text-red-400/80 bg-red-400/10 border border-red-400/20 px-1.5 py-0 rounded-full">失败</span>}
                  {s.connStatus === 'connected' && !s.localMode && <span className="text-[10px] text-green-400/80 bg-green-400/10 border border-green-400/20 px-1.5 py-0 rounded-full cursor-default">在线</span>}
                  {s.connStatus === 'connected' && s.localMode && <span className="text-[10px] text-emerald-400/80 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0 rounded-full cursor-default flex items-center space-x-1"><Monitor className="w-2.5 h-2.5" /><span>本地终端</span></span>}
                </div>

                {/* Disconnect */}
                <button
                  onClick={() => requestClose(s.key)}
                  className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors border border-transparent hover:border-red-400/20"
                  title="关闭会话"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Workspace */}
            <div className="flex-1 overflow-hidden relative">
              {/* Connecting / error overlay */}
              {(s.connStatus === 'connecting' || s.connStatus === 'error') && (
                <div className="absolute inset-0 z-20 bg-background-primary flex flex-col items-center justify-center">
                  {s.connStatus === 'connecting' && (
                    <>
                      <div className="relative flex items-center justify-center mb-8">
                        <div className="absolute w-32 h-32 rounded-full border border-blue-500/20 animate-ping" style={{ animationDuration: '2s' }} />
                        <div className="absolute w-24 h-24 rounded-full border border-blue-500/30 animate-ping" style={{ animationDuration: '1.5s', animationDelay: '0.3s' }} />
                        <div className="w-16 h-16 rounded-full bg-blue-600/20 border border-blue-500/50 flex items-center justify-center">
                          <Server className="w-7 h-7 text-blue-400" />
                        </div>
                      </div>
                      <p className="text-text-primary text-lg font-semibold mb-1">正在连接</p>
                      <p className="text-blue-300 font-mono text-sm mb-6">{s.ssh.username}@{s.ssh.host}:{s.ssh.port}</p>
                      <div className="flex items-center space-x-1.5">
                        {[0, 1, 2].map(i => (
                          <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                      <p className="text-text-tertiary text-xs mt-4">建立 SSH 握手中，请稍候</p>
                    </>
                  )}
                  {s.connStatus === 'error' && (
                    <>
                      <div className="w-16 h-16 rounded-full bg-red-600/20 border border-red-500/40 flex items-center justify-center mb-6">
                        <AlertCircle className="w-8 h-8 text-red-400" />
                      </div>
                      <p className="text-text-primary text-lg font-semibold mb-2">
                        {s.connError.includes('Closed') || s.connError.includes('异常断开') ? '连接已断开' : '连接失败'}
                      </p>
                      <p className="text-red-400 text-sm mb-1 font-mono">{s.ssh.username}@{s.ssh.host}:{s.ssh.port}</p>
                      <p className="text-text-secondary text-xs max-w-xs text-center mt-2 mb-8">{s.connError}</p>
                      <div className="flex space-x-3">
                        <button onClick={() => retryConnect(s.key)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                          重新连接
                        </button>
                        <button
                          onClick={() => {
                            dispatch({
                              type: 'UPDATE_SSH_SESSION',
                              payload: { ...s, connStatus: 'connected', localMode: true, activeTab: 'terminal' }
                            });
                          }}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center space-x-1.5"
                          title="在本机启动一个本地终端（macOS: zsh, Windows: PowerShell）"
                        >
                          <Monitor className="w-4 h-4" />
                          <span>本地终端</span>
                        </button>
                        <button onClick={() => requestClose(s.key)} className="px-4 py-2 bg-background-tertiary hover:bg-background-secondary text-text-primary rounded-lg text-sm font-medium transition-colors">
                          关闭会话
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Terminal */}
              <div className={`absolute inset-0 transition-opacity duration-200 ${s.activeTab === 'terminal' && (s.connStatus === 'connected' || s.connStatus === 'reconnecting') ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                }`}>
                <Terminal sshId={s.key} isConnected={s.connStatus === 'connected' || s.connStatus === 'reconnecting'} mode={s.localMode ? 'local' : 'ssh'} />

                {/* Mini transfer overlay — shown only when in terminal tab with active transfers */}
                {s.activeTab === 'terminal' && (s.connStatus === 'connected' || s.connStatus === 'reconnecting') && (() => {
                  const sessionJobs = state.transferJobs[s.key] || [];
                  const activeJobs = sessionJobs.filter(j => !j.done);
                  if (activeJobs.length === 0) return null;
                  return (
                    <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1.5 pointer-events-none">
                      {activeJobs.slice(-3).map(j => {
                        const bps = j.speed;
                        const speedLabel = bps && bps > 0
                          ? bps >= 1048576
                            ? `${(bps / 1048576).toFixed(1)} MB/s`
                            : bps >= 1024
                              ? `${(bps / 1024).toFixed(1)} KB/s`
                              : `${Math.round(bps)} B/s`
                          : null;
                        return (
                          <div
                            key={j.id}
                            className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-card border border-border-primary backdrop-blur-sm shadow-xl w-60"
                            onClick={() => setSessionTab(s.key, 'sftp')}
                            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                            title="点击切换到 SFTP 查看详情"
                          >
                            <div className="flex items-center gap-2">
                              {j.direction === 'upload'
                                ? <Upload className="w-3 h-3 text-blue-400 flex-shrink-0" />
                                : <Download className="w-3 h-3 text-green-400 flex-shrink-0" />}
                              <span className="text-[11px] text-text-primary truncate flex-1">{j.name}</span>
                              {j.progress !== undefined && (
                                <span className="text-[10px] text-text-secondary flex-shrink-0">{j.progress}%</span>
                              )}
                            </div>
                            {j.progress !== undefined && (
                              <div className="w-full bg-background-secondary rounded-full h-0.5 overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 transition-all duration-300 ease-out"
                                  style={{ width: `${j.progress}%` }}
                                />
                              </div>
                            )}
                            {(j.currentFile || speedLabel) && (
                              <div className="flex items-center justify-between gap-1">
                                {j.currentFile && (
                                  <span className="text-[9px] text-text-tertiary truncate flex-1">{j.currentFile}</span>
                                )}
                                {speedLabel && (
                                  <span className="text-[9px] font-mono text-blue-400/80 flex-shrink-0 bg-blue-500/10 px-1 rounded">
                                    {speedLabel}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {activeJobs.length > 3 && (
                        <div className="text-[10px] text-gray-400 text-right pr-1">+{activeJobs.length - 3} 个传输中</div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* SFTP — persistently mounted, CSS-hidden when not active to preserve upload state */}
              {(s.connStatus === 'connected' || s.connStatus === 'reconnecting') && (
                <div className={`absolute inset-0 z-10 bg-background transition-opacity duration-200 ${
                  s.activeTab === 'sftp' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}>
                  <SftpBrowser sshId={s.key} />
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Disconnect confirmation dialog */}
        {closingKey && (
          <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-background border border-border rounded-2xl shadow-2xl p-5 w-full max-w-sm animate-slide-in">
              {(() => {
                const s = sessions.find(ss => ss.key === closingKey);
                return (
                  <>
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                        <WifiOff className="w-5 h-5 text-amber-500" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-text-primary">结束会话？</h3>
                        <p className="text-sm text-text-secondary mt-1">当前连接将被关闭，所有未保存的工作可能丢失。</p>
                      </div>
                    </div>
                    <div className="bg-background-secondary dark:bg-background-tertiary/20 border border-border rounded-xl px-4 py-2.5 mb-4 font-mono text-sm">
                      <p className="text-text-tertiary text-xs mb-1">会话信息</p>
                      <p className="text-text-primary font-bold">{s?.ssh.name}</p>
                      <p className="text-text-secondary text-[11px] mt-0.5">{s?.ssh.username}@{s?.ssh.host}:{s?.ssh.port}</p>
                    </div>
                    <div className="flex space-x-3">
                      <button onClick={() => setClosingKey(null)} className="btn-secondary flex-1 py-2.5">
                        取消
                      </button>
                      <button onClick={confirmClose} className="btn-primary bg-red-500 hover:bg-red-600 border-none flex-1 py-2.5">
                        断开连接
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ── Add/Edit modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl w-full max-w-lg shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
            <div className="px-5 py-3 border-b border-border/50 flex-shrink-0">
              <h3 className="text-lg font-bold text-text-primary">
                {editingSSH ? '编辑 SSH 信息' : '新增 SSH 信息'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 overflow-y-auto scrollbar-thin space-y-3.5">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">名称</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input-base" required />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">主机地址</label>
                  <input type="text" value={formData.host} onChange={(e) => setFormData({ ...formData, host: e.target.value })} className="input-base" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">端口</label>
                  <input type="number" value={formData.port} onChange={(e) => setFormData({ ...formData, port: e.target.value })} className="input-base" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">用户名</label>
                <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="input-base" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">密钥路径（可选）</label>
                <input type="text" value={formData.keyPath} onChange={(e) => setFormData({ ...formData, keyPath: e.target.value })} className="input-base" placeholder="~/.ssh/id_rsa" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">密码（可选）</label>
                <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="input-base" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">分组 (可选)</label>
                  <input type="text" list="ssh-groups" value={formData.group} onChange={(e) => setFormData({ ...formData, group: e.target.value })} className="input-base" placeholder="例如: 生产环境" />
                  <datalist id="ssh-groups">
                    {Array.from(new Set(state.sshInfo.map(s => s.group).filter(Boolean))).map(g => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">描述</label>
                  <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="input-base" rows={1} />
                </div>
              </div>

              {/* Tunnel Management in Modal */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-text-primary flex items-center">
                    <Radio className="w-4 h-4 mr-2 text-primary" />
                    SSH 隧道配置
                  </h4>
                  <button
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      tunnels: [...formData.tunnels, {
                        id: Date.now().toString(),
                        type: 'local',
                        localHost: '127.0.0.1',
                        localPort: 8080,
                        remoteHost: '127.0.0.1',
                        remotePort: 80,
                        name: 'New Tunnel'
                      }]
                    })}
                    className="text-xs text-primary hover:text-primary-hover font-medium flex items-center"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    添加隧道
                  </button>
                </div>

                <div className="space-y-3 max-h-48 overflow-y-auto pr-2 scrollbar-thin">
                  {formData.tunnels.map((t, index) => (
                    <div key={t.id} className="p-3 bg-background-secondary border border-border rounded-xl space-y-3 relative group">
                      <button
                        type="button"
                        onClick={() => {
                          const newTunnels = [...formData.tunnels];
                          newTunnels.splice(index, 1);
                          setFormData({ ...formData, tunnels: newTunnels });
                        }}
                        className="absolute top-2 right-2 p-1 text-text-tertiary hover:text-functional-error opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase mb-1">隧道名称</label>
                          <input
                            type="text"
                            value={t.name}
                            onChange={(e) => {
                              const newTunnels = [...formData.tunnels];
                              newTunnels[index] = { ...t, name: e.target.value };
                              setFormData({ ...formData, tunnels: newTunnels });
                            }}
                            className="input-base text-xs py-1"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase mb-1">类型</label>
                          <select
                            value={t.type}
                            onChange={(e) => {
                              const newTunnels = [...formData.tunnels];
                              newTunnels[index] = { ...t, type: e.target.value as 'local' | 'remote' };
                              setFormData({ ...formData, tunnels: newTunnels });
                            }}
                            className="input-base text-xs py-1"
                          >
                            <option value="local">本地转发 (Local)</option>
                            <option value="remote">远程转发 (Remote)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        <div className="col-span-1">
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase mb-1">地址</label>
                          <input
                            type="text"
                            value={t.type === 'local' ? '127.0.0.1' : t.localHost}
                            disabled={t.type === 'local'}
                            onChange={(e) => {
                              const newTunnels = [...formData.tunnels];
                              newTunnels[index] = { ...t, localHost: e.target.value };
                              setFormData({ ...formData, tunnels: newTunnels });
                            }}
                            className="input-base text-xs py-1"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase mb-1">端口</label>
                          <input
                            type="number"
                            value={t.localPort}
                            onChange={(e) => {
                              const newTunnels = [...formData.tunnels];
                              newTunnels[index] = { ...t, localPort: parseInt(e.target.value) };
                              setFormData({ ...formData, tunnels: newTunnels });
                            }}
                            className="input-base text-xs py-1"
                          />
                        </div>
                        <div className="col-span-1 border-l border-border pl-2 border-dashed">
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase mb-1">远程地址</label>
                          <input
                            type="text"
                            value={t.remoteHost}
                            onChange={(e) => {
                              const newTunnels = [...formData.tunnels];
                              newTunnels[index] = { ...t, remoteHost: e.target.value };
                              setFormData({ ...formData, tunnels: newTunnels });
                            }}
                            className="input-base text-xs py-1"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase mb-1">远程端口</label>
                          <input
                            type="number"
                            value={t.remotePort}
                            onChange={(e) => {
                              const newTunnels = [...formData.tunnels];
                              newTunnels[index] = { ...t, remotePort: parseInt(e.target.value) };
                              setFormData({ ...formData, tunnels: newTunnels });
                            }}
                            className="input-base text-xs py-1"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {formData.tunnels.length === 0 && (
                    <p className="text-xs text-text-tertiary text-center py-4 bg-background-secondary rounded-xl border border-dashed border-border">
                      暂无隧道配置，点击上方按钮添加
                    </p>
                  )}
                </div>
              </div>

              </div>
              <div className="px-5 py-3 border-t border-border/50 flex-shrink-0 flex justify-end space-x-3 bg-background rounded-b-xl">
                <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} className="btn-secondary px-6">取消</button>
                <button type="submit" className="btn-primary px-6">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setIsDeleteModalOpen(false);
          setDeleteTargetId(null);
        }}
        title="确定要删除这个 SSH 信息吗？"
        description="此操作将永久删除该 SSH 配置及其关联的隧道配置，且无法恢复。"
      />
    </div>
  );
};

export default SSHPage;
