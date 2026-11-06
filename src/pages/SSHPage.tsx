import React, { useState } from 'react';
import {
  Server, Plus, Edit2, Trash2, Copy, Eye, EyeOff,
  Terminal as TerminalIcon, Folder, Play, Loader2,
  Wifi, WifiOff, AlertCircle, X, List, Share2, Shield, Radio, Power,
  ChevronDown, ChevronUp, Upload, Download, Monitor, LayoutGrid, ChevronRight,
  Cpu, RefreshCw
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import {
  SSHInfo, SSHTunnel, ConnectionProtocol,
  SerialDataBits, SerialStopBits, SerialParity, SerialFlowControl, SerialPortDevice
} from '../types';
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
  const [protocolFilter, setProtocolFilter] = useState<'all' | ConnectionProtocol>('all');
  const [availableSerialPorts, setAvailableSerialPorts] = useState<SerialPortDevice[]>([]);
  const [loadingSerialPorts, setLoadingSerialPorts] = useState(false);
  const [customSerialPortMode, setCustomSerialPortMode] = useState(false);
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
    protocol: 'ssh' as ConnectionProtocol,
    name: '', host: '', port: '22', username: '', keyPath: '', password: '', description: '', group: '',
    serialPort: 'COM1',
    baudRate: '115200',
    dataBits: '8',
    stopBits: '1',
    parity: 'none' as SerialParity,
    flowControl: 'none' as SerialFlowControl,
    localEcho: false,
    lineEnding: 'cr' as 'cr' | 'lf' | 'crlf',
    cwd: '',
    shell: '',
    tunnels: [] as SSHTunnel[],
  });

  const getProtocol = (ssh: SSHInfo): ConnectionProtocol => ssh.protocol || 'ssh';

  const formatParityShort = (parity?: SerialParity) => {
    if (parity === 'odd') return 'O';
    if (parity === 'even') return 'E';
    return 'N';
  };

  const formatParityLabel = (parity?: SerialParity) => {
    if (parity === 'odd') return '奇校验 (Odd)';
    if (parity === 'even') return '偶校验 (Even)';
    return '无 (None)';
  };

  const formatFlowControlLabel = (fc?: SerialFlowControl) => {
    if (fc === 'software') return 'XON/XOFF';
    if (fc === 'hardware') return 'RTS/CTS';
    return '无';
  };

  const formatConnectionSummary = (ssh: SSHInfo) => {
    const proto = getProtocol(ssh);
    if (proto === 'serial') {
      return `${ssh.serialPort || 'COM1'} @ ${ssh.baudRate || 115200} (${ssh.dataBits || 8}${formatParityShort(ssh.parity)}${ssh.stopBits || 1})`;
    }
    if (proto === 'local') {
      return `${ssh.cwd || '~'} (${ssh.shell || '默认 Shell'})`;
    }
    return `${ssh.username}@${ssh.host}:${ssh.port}`;
  };

  const refreshSerialPorts = React.useCallback(async () => {
    setLoadingSerialPorts(true);
    try {
      const ports = await window.electronAPI.serialListPorts?.() || [];
      setAvailableSerialPorts(ports);
      setFormData(prev => {
        if (ports.length > 0 && (!prev.serialPort || (prev.serialPort === 'COM1' && !ports.some(p => p.portName === 'COM1')))) {
          return { ...prev, serialPort: ports[0].portName };
        }
        return prev;
      });
    } catch (e) {
      console.error('Failed to list serial ports:', e);
    } finally {
      setLoadingSerialPorts(false);
    }
  }, []);

  React.useEffect(() => {
    if (isModalOpen && formData.protocol === 'serial') {
      refreshSerialPorts();
    }
  }, [isModalOpen, formData.protocol, refreshSerialPorts]);

  // Multi-session state moved to AppContext
  const sessions = state.sshSessions;
  const activeSessionKey = state.activeSessionKey;
  const setSessions = (newSessions: any) => {
    const val = typeof newSessions === 'function' ? newSessions(sessions) : newSessions;
    dispatch({ type: 'SET_SSH_SESSIONS', payload: val });
  };
  const setActiveSessionKey = (key: string | null) => dispatch({ type: 'SET_ACTIVE_SESSION_KEY', payload: key });

  const [closingKey, setClosingKey] = useState<string | null>(null); // for disconnect confirm
  const [activeTunnels, setActiveTunnels] = useState<Set<string>>(new Set());

  const reconnectAttemptsRef = React.useRef<Record<string, number>>({});
  const reconnectTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hasConnectedRef = React.useRef<Set<string>>(new Set());
  const sessionsRef = React.useRef(sessions);
  sessionsRef.current = sessions;

  const clearReconnectTimer = React.useCallback((key: string) => {
    if (reconnectTimersRef.current[key]) {
      clearTimeout(reconnectTimersRef.current[key]);
      delete reconnectTimersRef.current[key];
    }
  }, []);

  React.useEffect(() => {
    return () => {
      Object.keys(reconnectTimersRef.current).forEach(k => {
        clearTimeout(reconnectTimersRef.current[k]);
      });
      reconnectTimersRef.current = {};
    };
  }, []);

  const startSessionTunnels = async (sessionKey: string, tunnels?: SSHTunnel[]) => {
    if (!tunnels || tunnels.length === 0) return;
    for (const t of tunnels) {
      try {
        const res = t.type === 'local'
          ? await window.electronAPI.sshForwardLocal(sessionKey, t.id, t.localPort, t.remoteHost, t.remotePort)
          : await window.electronAPI.sshForwardRemote(sessionKey, t.id, t.remotePort, t.localHost, t.localPort);
        if (!res || res.success !== false) {
          setActiveTunnels(prev => new Set(prev).add(`${sessionKey}:${t.id}`));
        }
      } catch (err) {
        console.error(`Failed to start tunnel ${t.name}:`, err);
      }
    }
  };

  const autoSilentReconnect = (key: string, fromChain = false) => {
    const s = sessionsRef.current.find(ss => ss.key === key);
    if (!s || s.localMode || getProtocol(s.ssh) === 'local') return;
    const isSerial = getProtocol(s.ssh) === 'serial';

    // Deduplicate simultaneous closed + error triggers
    if (!fromChain && reconnectTimersRef.current[key]) {
      return;
    }
    clearReconnectTimer(key);

    const attempts = reconnectAttemptsRef.current[key] || 0;
    if (attempts >= 3) {
      console.log(`[Auto-reconnect] Max retry attempts (3) reached for session ${key}. Mark as error.`);
      dispatch({
        type: 'UPDATE_SSH_SESSION',
        payload: {
          ...s,
          connStatus: 'error',
          connError: isSerial
            ? '串口异常断开，后台已尝试3次自动重连均失败，请检查串口设备后手动重试。'
            : '连接异常断开，后台已尝试3次自动重连均失败，请检查网络后手动重试。'
        }
      });
      if (!isSerial) {
        window.electronAPI.emitSshOutput(key, `\r\n\x1b[31m[系统提示: 已尝试3次自动重连均失败，停止重连。请检查网络后手动重试。]\x1b[0m\r\n`);
        dispatch({ type: 'ABORT_SESSION_TRANSFER_JOBS', payload: { sshId: key } });
      }
      delete reconnectAttemptsRef.current[key];
      return;
    }

    const nextAttempt = attempts + 1;
    reconnectAttemptsRef.current[key] = nextAttempt;

    if (!isSerial) {
      window.electronAPI.emitSshOutput(key, `\r\n\x1b[33m[系统提示: 正在进行第 ${nextAttempt} 次自动重连...]\x1b[0m\r\n`);
    }

    dispatch({
      type: 'UPDATE_SSH_SESSION',
      payload: { 
        ...s, 
        connStatus: 'reconnecting', 
        connError: `正在进行第 ${nextAttempt} 次自动重连...` 
      }
    });

    reconnectTimersRef.current[key] = setTimeout(() => {
      delete reconnectTimersRef.current[key];
      const sLatest = sessionsRef.current.find(ss => ss.key === key);
      if (!sLatest || sLatest.localMode || closingKey === key) {
        return;
      }

      if (getProtocol(sLatest.ssh) === 'serial') {
        window.electronAPI.serialConnect(key, {
          portName: sLatest.ssh.serialPort || 'COM1',
          baudRate: sLatest.ssh.baudRate || 115200,
          dataBits: sLatest.ssh.dataBits || 8,
          stopBits: sLatest.ssh.stopBits || 1,
          parity: sLatest.ssh.parity || 'none',
          flowControl: sLatest.ssh.flowControl || 'none',
        })
          .then((res) => {
            if (res.success) {
              hasConnectedRef.current.add(key);
              delete reconnectAttemptsRef.current[key];
              dispatch({
                type: 'UPDATE_SSH_SESSION',
                payload: { ...sLatest, connStatus: 'connected', connError: '' }
              });
            } else {
              autoSilentReconnect(key, true);
            }
          })
          .catch(() => {
            autoSilentReconnect(key, true);
          });
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
            hasConnectedRef.current.add(key);
            window.electronAPI.emitSshOutput(key, `\r\n\x1b[32m[系统提示: SSH 连接第 ${nextAttempt} 次重连成功!]\x1b[0m\r\n`);
            window.electronAPI.emitSshReconnected(key);
            delete reconnectAttemptsRef.current[key];

            dispatch({
              type: 'UPDATE_SSH_SESSION',
              payload: { ...sLatest, connStatus: 'connected', connError: '' }
            });

            await startSessionTunnels(key, sLatest.ssh.tunnels);
          } else {
            window.electronAPI.emitSshOutput(key, `\r\n\x1b[31m[系统提示: 第 ${nextAttempt} 次重连失败: ${res.error || '未知原因'}]\x1b[0m\r\n`);
            autoSilentReconnect(key, true);
          }
        })
        .catch((err: any) => {
          window.electronAPI.emitSshOutput(key, `\r\n\x1b[31m[系统提示: 第 ${nextAttempt} 次重连异常: ${err?.message || err || '未知异常'}]\x1b[0m\r\n`);
          autoSilentReconnect(key, true);
        });
    }, 5000);
  };

  // ── Connect ─────────────────────────────────
  const handleConnect = (ssh: SSHInfo) => {
    const key = `${ssh.id}_${Date.now()}`;
    const proto = getProtocol(ssh);

    if (proto === 'local') {
      const localSession: SessionState = {
        key,
        ssh,
        connStatus: 'connected',
        connError: '',
        activeTab: 'terminal',
        localMode: true,
      };
      hasConnectedRef.current.add(key);
      dispatch({ type: 'ADD_SSH_SESSION', payload: localSession });
      setActiveSessionKey(key);
      return;
    }

    const newSession: SessionState = {
      key, ssh, connStatus: 'connecting', connError: '', activeTab: 'terminal',
    };
    dispatch({ type: 'ADD_SSH_SESSION', payload: newSession });
    setActiveSessionKey(key);

    if (proto === 'serial') {
      window.electronAPI.serialConnect(key, {
        portName: ssh.serialPort || 'COM1',
        baudRate: ssh.baudRate || 115200,
        dataBits: ssh.dataBits || 8,
        stopBits: ssh.stopBits || 1,
        parity: ssh.parity || 'none',
        flowControl: ssh.flowControl || 'none',
      })
        .then((res) => {
          if (res.success) {
            hasConnectedRef.current.add(key);
          }
          const latest = sessionsRef.current.find(ss => ss.key === key) || newSession;
          dispatch({
            type: 'UPDATE_SSH_SESSION',
            payload: { ...latest, connStatus: res.success ? 'connected' : 'error', connError: res.error || '无法打开串口' }
          });
        })
        .catch((err: any) => {
          const latest = sessionsRef.current.find(ss => ss.key === key) || newSession;
          dispatch({
            type: 'UPDATE_SSH_SESSION',
            payload: { ...latest, connStatus: 'error', connError: err?.message || '串口连接错误' }
          });
        });
      return;
    }

    const options = {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      password: ssh.password || undefined,
      keyPath: ssh.keyPath || undefined,
    };

    window.electronAPI.sshConnect(key, options)
      .then(async (res) => {
        if (res.success) {
          hasConnectedRef.current.add(key);
        }
        const latest = sessionsRef.current.find(ss => ss.key === key) || newSession;
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...latest, connStatus: res.success ? 'connected' : 'error', connError: res.error || '连接失败' }
        });
        if (res.success) {
          await startSessionTunnels(key, ssh.tunnels);
        }
      })
      .catch((err: any) => {
        const latest = sessionsRef.current.find(ss => ss.key === key) || newSession;
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...latest, connStatus: 'error', connError: err?.message || '未知错误' }
        });
      });
  };

  const handleQuickLocalTerminal = () => {
    const now = Date.now();
    const key = `local_${now}`;
    const localSsh: SSHInfo = {
      id: `local_${now}`,
      name: `本地终端`,
      protocol: 'local',
      host: 'localhost',
      port: 0,
      username: 'local',
      description: '本机终端会话',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const localSession: SessionState = {
      key,
      ssh: localSsh,
      connStatus: 'connected',
      connError: '',
      activeTab: 'terminal',
      localMode: true,
    };
    hasConnectedRef.current.add(key);
    dispatch({ type: 'ADD_SSH_SESSION', payload: localSession });
    setActiveSessionKey(key);
  };

  // ── Close / disconnect session ───────────────
  const requestClose = (key: string) => setClosingKey(key);

  const confirmClose = async () => {
    if (!closingKey) return;
    const key = closingKey;
    const closingSession = sessions.find(s => s.key === key);
    setClosingKey(null);
    clearReconnectTimer(key);
    delete reconnectAttemptsRef.current[key];
    hasConnectedRef.current.delete(key);
    setActiveTunnels(prev => {
      const next = new Set(prev);
      Array.from(next).forEach(k => {
        if (k.startsWith(`${key}:`)) next.delete(k);
      });
      return next;
    });

    if (closingSession?.localMode || (closingSession && getProtocol(closingSession.ssh) === 'local')) {
      // Local terminal mode: destroy all PTY processes (including split panes)
      await window.electronAPI.ptyDestroySession(key);
    } else if (closingSession && getProtocol(closingSession.ssh) === 'serial') {
      await window.electronAPI.serialDisconnect(key);
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
    const s = sessionsRef.current.find(ss => ss.key === key);
    if (!s) return;

    clearReconnectTimer(key);
    delete reconnectAttemptsRef.current[key]; // clear automatic attempts count

    dispatch({ type: 'UPDATE_SSH_SESSION', payload: { ...s, connStatus: 'connecting', connError: '' } });

    if (getProtocol(s.ssh) === 'serial') {
      window.electronAPI.serialConnect(key, {
        portName: s.ssh.serialPort || 'COM1',
        baudRate: s.ssh.baudRate || 115200,
        dataBits: s.ssh.dataBits || 8,
        stopBits: s.ssh.stopBits || 1,
        parity: s.ssh.parity || 'none',
        flowControl: s.ssh.flowControl || 'none',
      })
        .then((res) => {
          const latest = sessionsRef.current.find(ss => ss.key === key) || s;
          if (res.success) {
            hasConnectedRef.current.add(key);
          }
          dispatch({
            type: 'UPDATE_SSH_SESSION',
            payload: { ...latest, connStatus: res.success ? 'connected' : 'error', connError: res.error || '串口连接失败' }
          });
        })
        .catch((err: any) => {
          const latest = sessionsRef.current.find(ss => ss.key === key) || s;
          dispatch({
            type: 'UPDATE_SSH_SESSION',
            payload: { ...latest, connStatus: 'error', connError: err?.message || '未知错误' }
          });
        });
      return;
    }

    const options = {
      host: s.ssh.host, port: s.ssh.port, username: s.ssh.username,
      password: s.ssh.password || undefined,
      keyPath: s.ssh.keyPath || undefined,
    };
    window.electronAPI.sshConnect(key, options)
      .then(async (res) => {
        const latest = sessionsRef.current.find(ss => ss.key === key) || s;
        if (res.success) {
          hasConnectedRef.current.add(key);
          window.electronAPI.emitSshOutput(key, `\r\n\x1b[32m[系统提示: 手动重连成功!]\x1b[0m\r\n`);
          window.electronAPI.emitSshReconnected(key);
        }
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...latest, connStatus: res.success ? 'connected' : 'error', connError: res.error || '连接失败' }
        });
        if (res.success) {
          await startSessionTunnels(key, latest.ssh.tunnels);
        }
      })
      .catch((err: any) => {
        const latest = sessionsRef.current.find(ss => ss.key === key) || s;
        dispatch({
          type: 'UPDATE_SSH_SESSION',
          payload: { ...latest, connStatus: 'error', connError: err?.message || '未知错误' }
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
    const proto = formData.protocol || 'ssh';
    const defaultName = proto === 'serial'
      ? `${formData.serialPort || 'COM1'} (${formData.baudRate || 115200})`
      : proto === 'local'
        ? '本地终端'
        : `${formData.username}@${formData.host}`;
    const sshData: SSHInfo = {
      id: editingSSH?.id || Date.now().toString(),
      name: formData.name.trim() || defaultName,
      protocol: proto,
      host: proto === 'ssh' ? formData.host : (proto === 'serial' ? (formData.serialPort || 'COM1') : 'localhost'),
      port: proto === 'ssh' ? (parseInt(formData.port) || 22) : (proto === 'serial' ? (parseInt(formData.baudRate) || 115200) : 0),
      username: proto === 'ssh' ? formData.username : (proto === 'serial' ? 'serial' : 'local'),
      keyPath: proto === 'ssh' ? (formData.keyPath || undefined) : undefined,
      password: proto === 'ssh' ? (formData.password || undefined) : undefined,
      serialPort: proto === 'serial' ? (formData.serialPort || 'COM1') : undefined,
      baudRate: proto === 'serial' ? (parseInt(formData.baudRate) || 115200) : undefined,
      dataBits: proto === 'serial' ? ((parseInt(formData.dataBits) || 8) as SerialDataBits) : undefined,
      stopBits: proto === 'serial' ? ((parseInt(formData.stopBits) || 1) as SerialStopBits) : undefined,
      parity: proto === 'serial' ? formData.parity : undefined,
      flowControl: proto === 'serial' ? formData.flowControl : undefined,
      localEcho: proto === 'serial' ? formData.localEcho : undefined,
      lineEnding: proto === 'serial' ? formData.lineEnding : undefined,
      cwd: proto === 'local' ? (formData.cwd || undefined) : undefined,
      shell: proto === 'local' ? (formData.shell || undefined) : undefined,
      description: formData.description,
      group: formData.group || undefined,
      tunnels: proto === 'ssh' ? formData.tunnels : [],
      createdAt: editingSSH?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingSSH) {
        const updated = await window.electronAPI?.updateSSHInfo(editingSSH.id, sshData);
        dispatch({ type: 'UPDATE_SSH_INFO', payload: (updated as any) || sshData });
      } else {
        const added = await window.electronAPI?.addSSHInfo(sshData);
        dispatch({ type: 'ADD_SSH_INFO', payload: (added as any) || sshData });
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
    setFormData({
      protocol: 'ssh',
      name: '', host: '', port: '22', username: '', keyPath: '', password: '', description: '', group: '',
      serialPort: 'COM1',
      baudRate: '115200',
      dataBits: '8',
      stopBits: '1',
      parity: 'none',
      flowControl: 'none',
      localEcho: false,
      lineEnding: 'cr',
      cwd: '',
      shell: '',
      tunnels: [],
    });
    setCustomSerialPortMode(false);
    setEditingSSH(null);
  };

  const openEditModal = (ssh: SSHInfo) => {
    setEditingSSH(ssh);
    setFormData({
      protocol: getProtocol(ssh),
      name: ssh.name, host: ssh.host, port: (ssh.port || 22).toString(),
      username: ssh.username, keyPath: ssh.keyPath || '',
      password: ssh.password || '', description: ssh.description,
      group: ssh.group || '',
      serialPort: ssh.serialPort || 'COM1',
      baudRate: (ssh.baudRate || 115200).toString(),
      dataBits: (ssh.dataBits || 8).toString(),
      stopBits: (ssh.stopBits || 1).toString(),
      parity: ssh.parity || 'none',
      flowControl: ssh.flowControl || 'none',
      localEcho: Boolean(ssh.localEcho),
      lineEnding: ssh.lineEnding || 'cr',
      cwd: ssh.cwd || '',
      shell: ssh.shell || '',
      tunnels: ssh.tunnels || [],
    });
    setCustomSerialPortMode(false);
    setIsModalOpen(true);
  };

  // ── Active session object ────────────────────
  const activeSession = sessions.find(s => s.key === activeSessionKey) ?? null;

  // ── Global SSH & Serial event listeners ─────────────────
  React.useEffect(() => {
    const unlisteners: Array<() => void> = [];
    sessions.forEach(s => {
      const proto = getProtocol(s.ssh);
      if ((s.connStatus === 'connected' || s.connStatus === 'connecting' || s.connStatus === 'reconnecting') && !s.localMode && proto !== 'local') {
        if (proto === 'serial') {
          const u1 = window.electronAPI.onSerialClosed(s.key, () => {
            if (closingKey === s.key) {
              dispatch({ type: 'UPDATE_SSH_SESSION', payload: { ...s, connStatus: 'error', connError: '串口已关闭' } });
            } else {
              autoSilentReconnect(s.key);
            }
          });
          const u2 = window.electronAPI.onSerialError(s.key, (err: string) => {
            if (closingKey === s.key) {
              dispatch({ type: 'UPDATE_SSH_SESSION', payload: { ...s, connStatus: 'error', connError: err || '串口异常断开' } });
            } else {
              autoSilentReconnect(s.key);
            }
          });
          unlisteners.push(u1, u2);
        } else {
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
              {s.connStatus === 'connected' && !s.localMode && getProtocol(s.ssh) === 'ssh' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
              {s.connStatus === 'connected' && !s.localMode && getProtocol(s.ssh) === 'serial' && <Cpu className="w-2.5 h-2.5 text-amber-400 flex-shrink-0" />}
              {s.connStatus === 'connected' && (s.localMode || getProtocol(s.ssh) === 'local') && <Monitor className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />}
              {s.connStatus === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
              <span className="truncate">
                {s.localMode && getProtocol(s.ssh) !== 'local'
                  ? `本地终端 #${sessions.filter(ss => ss.localMode).indexOf(s) + 1}`
                  : s.ssh.name}
              </span>
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
          <div className="flex items-center justify-between p-4 flex-shrink-0 border-b border-border/30 gap-3 flex-wrap">
            <div className="flex items-center space-x-3 flex-wrap gap-y-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索 SSH / 串口 / 本地终端..."
                  className="input-base w-64 pl-10 pr-4"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              </div>

              {/* Protocol filter pills */}
              <div className="flex items-center p-0.5 bg-background-secondary border border-border rounded-lg text-xs">
                {([
                  { id: 'all', label: '全部' },
                  { id: 'ssh', label: 'SSH' },
                  { id: 'serial', label: '串口' },
                  { id: 'local', label: 'Local' },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setProtocolFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                      protocolFilter === tab.id
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
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

              <button
                onClick={handleQuickLocalTerminal}
                className="flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 transition-all"
                title="一键打开本机终端 (PowerShell / Zsh)"
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>本地终端</span>
              </button>

              <button
                onClick={() => {
                  resetForm();
                  if (protocolFilter !== 'all') {
                    setFormData(prev => ({ ...prev, protocol: protocolFilter }));
                  }
                  setIsModalOpen(true);
                }}
                className="btn-nexus-blue flex items-center space-x-1.5 !px-2.5 !py-1 !text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增连接</span>
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
                      <p className="text-text-secondary">暂无连接配置，点击右上角「新增连接」添加 SSH、串口或本地终端</p>
                    </div>
                  );
                }
                const filteredSSH = state.sshInfo.filter(ssh => {
                  const proto = getProtocol(ssh);
                  if (protocolFilter !== 'all' && proto !== protocolFilter) return false;
                  const q = searchQuery.toLowerCase();
                  return ssh.name.toLowerCase().includes(q) ||
                    (ssh.host || '').toLowerCase().includes(q) ||
                    (ssh.serialPort || '').toLowerCase().includes(q) ||
                    (ssh.cwd || '').toLowerCase().includes(q) ||
                    ssh.description.toLowerCase().includes(q) ||
                    (ssh.group || '未分组').toLowerCase().includes(q);
                });
                if (filteredSSH.length === 0) {
                  return (
                    <div className="bg-background-secondary border border-border rounded-lg p-12 text-center">
                      <p className="text-text-secondary">没有找到匹配的连接配置</p>
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
                                  const proto = getProtocol(ssh);
                                  return (
                                    <div key={ssh.id} onDoubleClick={() => handleConnect(ssh)} className="bg-card border border-border hover:border-primary/50 rounded-lg p-4 card-hover shadow-sm flex-1 min-w-[320px] max-w-full xl:max-w-[calc(33.33%-0.8rem)] cursor-pointer transition-all">
                                      <div className="flex flex-col h-full gap-3">
                                        <div className="flex-1">
                                          <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center space-x-3">
                                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                                proto === 'serial'
                                                  ? 'bg-amber-500/10 text-amber-500'
                                                  : proto === 'local'
                                                    ? 'bg-emerald-500/10 text-emerald-500'
                                                    : 'bg-functional-success/10 text-functional-success'
                                              }`}>
                                                {proto === 'serial' ? (
                                                  <Cpu className="w-4 h-4" />
                                                ) : proto === 'local' ? (
                                                  <Monitor className="w-4 h-4" />
                                                ) : (
                                                  <Server className="w-4 h-4" />
                                                )}
                                              </div>
                                              <div className="min-w-0">
                                                <div className="flex items-center space-x-2">
                                                  <h3 className="text-sm font-semibold text-text-primary truncate">{ssh.name}</h3>
                                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 ${
                                                    proto === 'serial'
                                                      ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                                      : proto === 'local'
                                                        ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                                        : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                                                  }`}>
                                                    {proto === 'serial' ? '串口' : proto === 'local' ? 'LOCAL' : 'SSH'}
                                                  </span>
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
                                            {proto === 'serial' ? (
                                              <>
                                                <div className="flex items-center space-x-3 text-xs">
                                                  <span className="text-text-secondary">端口:</span>
                                                  <span className="font-mono text-text-primary">{ssh.serialPort || 'COM1'}</span>
                                                  <span className="text-text-secondary">波特率:</span>
                                                  <span className="font-mono text-text-primary">{ssh.baudRate || 115200}</span>
                                                </div>
                                                <div className="flex items-center space-x-3 text-xs">
                                                  <span className="text-text-secondary">参数:</span>
                                                  <span className="font-mono text-text-primary">
                                                    {ssh.dataBits || 8}{formatParityShort(ssh.parity)}{ssh.stopBits || 1}
                                                  </span>
                                                  <span className="text-text-secondary">流控:</span>
                                                  <span className="font-mono text-text-primary">{formatFlowControlLabel(ssh.flowControl)}</span>
                                                </div>
                                              </>
                                            ) : proto === 'local' ? (
                                              <>
                                                <div className="flex items-center space-x-3 text-xs">
                                                  <span className="text-text-secondary">目录:</span>
                                                  <span className="font-mono text-text-primary truncate">{ssh.cwd || '默认主目录 (~)'}</span>
                                                </div>
                                                <div className="flex items-center space-x-3 text-xs">
                                                  <span className="text-text-secondary">Shell:</span>
                                                  <span className="font-mono text-text-primary">{ssh.shell || '系统默认'}</span>
                                                </div>
                                              </>
                                            ) : (
                                              <>
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
                                              </>
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
                                                        {activeSessions.length > 0 && activeSessions[0].connStatus === 'connected' && (() => {
                                                          const session = activeSessions[0];
                                                          const tunnelKey = `${session.key}:${t.id}`;
                                                          const isRunning = activeTunnels.has(tunnelKey);
                                                          return (
                                                            <button
                                                              onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (isRunning) {
                                                                  try {
                                                                    await window.electronAPI.sshStopTunnel(session.key, t.id);
                                                                    setActiveTunnels(prev => {
                                                                      const next = new Set(prev);
                                                                      next.delete(tunnelKey);
                                                                      return next;
                                                                    });
                                                                  } catch (err: any) {
                                                                    console.error(`Failed to stop tunnel ${t.name}:`, err);
                                                                  }
                                                                  return;
                                                                }
                                                                try {
                                                                  await window.electronAPI.sshStopTunnel(session.key, t.id);
                                                                } catch (_) { /* ignore if not running */ }
                                                                try {
                                                                  const res = t.type === 'local'
                                                                    ? await window.electronAPI.sshForwardLocal(session.key, t.id, t.localPort, t.remoteHost, t.remotePort)
                                                                    : await window.electronAPI.sshForwardRemote(session.key, t.id, t.remotePort, t.localHost, t.localPort);
                                                                  if (res && res.success === false) {
                                                                    alert(`启动隧道 "${t.name}" 失败: ${res.error || '端口可能被占用'}`);
                                                                  } else {
                                                                    setActiveTunnels(prev => new Set(prev).add(tunnelKey));
                                                                  }
                                                                } catch (err: any) {
                                                                  alert(`启动隧道 "${t.name}" 失败: ${err?.message || String(err)}`);
                                                                }
                                                              }}
                                                              className={`p-1 rounded transition-colors flex items-center gap-1 ${
                                                                isRunning
                                                                  ? 'bg-green-500/15 text-green-400 hover:bg-red-500/15 hover:text-red-400'
                                                                  : 'hover:bg-background-tertiary text-text-tertiary hover:text-primary'
                                                              }`}
                                                              title={isRunning ? '隧道运行中（点击停止）' : '启动隧道'}
                                                            >
                                                              <Power className="w-3 h-3" />
                                                            </button>
                                                          );
                                                        })()}
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
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">协议</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">连接目标 / 参数</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">用户 / 附加项</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">隧道</th>
                                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">活动会话</th>
                                      <th className="px-4 py-2 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">操作</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/60 bg-background">
                                    {sshList.map((ssh) => {
                                      const activeSessions = sessions.filter(s => s.ssh.id === ssh.id);
                                      const proto = getProtocol(ssh);
                                      return (
                                        <tr key={ssh.id} onDoubleClick={() => handleConnect(ssh)} className="hover:bg-background-secondary/30 transition-colors cursor-pointer">
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <div className="flex items-center space-x-2">
                                              <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${
                                                proto === 'serial'
                                                  ? 'bg-amber-500/10 text-amber-500'
                                                  : proto === 'local'
                                                    ? 'bg-emerald-500/10 text-emerald-500'
                                                    : 'bg-functional-success/10 text-functional-success'
                                              }`}>
                                                {proto === 'serial' ? (
                                                  <Cpu className="w-3.5 h-3.5" />
                                                ) : proto === 'local' ? (
                                                  <Monitor className="w-3.5 h-3.5" />
                                                ) : (
                                                  <Server className="w-3.5 h-3.5" />
                                                )}
                                              </div>
                                              <div className="min-w-0">
                                                <div className="text-xs font-semibold text-text-primary truncate max-w-[180px]" title={ssh.name}>{ssh.name}</div>
                                                <div className="text-[10px] text-text-tertiary truncate max-w-[220px]" title={ssh.description}>{ssh.description || '无描述'}</div>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                              proto === 'serial'
                                                ? 'bg-amber-500/10 text-amber-500'
                                                : proto === 'local'
                                                  ? 'bg-emerald-500/10 text-emerald-500'
                                                  : 'bg-blue-500/10 text-blue-500'
                                            }`}>
                                              {proto === 'serial' ? '串口' : proto === 'local' ? 'LOCAL' : 'SSH'}
                                            </span>
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="font-mono text-xs text-text-primary">
                                              {proto === 'serial'
                                                ? `${ssh.serialPort || 'COM1'} @ ${ssh.baudRate || 115200}`
                                                : proto === 'local'
                                                  ? (ssh.cwd || '默认主目录 (~)')
                                                  : `${ssh.host}:${ssh.port}`}
                                            </span>
                                          </td>
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="font-mono text-xs text-text-secondary">
                                              {proto === 'serial'
                                                ? `${ssh.dataBits || 8}${formatParityShort(ssh.parity)}${ssh.stopBits || 1} / 流控:${formatFlowControlLabel(ssh.flowControl)}`
                                                : proto === 'local'
                                                  ? (ssh.shell || '默认 Shell')
                                                  : ssh.username}
                                            </span>
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
                  {/* SFTP button — shows active-transfer badge (only for SSH protocol) */}
                  {getProtocol(s.ssh) === 'ssh' && !s.localMode && (() => {
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
                    <span className="font-mono text-[11px] text-gray-400">{formatConnectionSummary(s.ssh)}</span>
                  </div>
                  {/* Status badge */}
                  {s.connStatus === 'connecting' && <span className="text-[10px] text-amber-400/80 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0 rounded-full">连接中</span>}
                  {s.connStatus === 'reconnecting' && <span className="text-[10px] text-amber-400/80 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0 rounded-full animate-pulse">重连中</span>}
                  {s.connStatus === 'error' && <span className="text-[10px] text-red-400/80 bg-red-400/10 border border-red-400/20 px-1.5 py-0 rounded-full">失败</span>}
                  {s.connStatus === 'connected' && !s.localMode && getProtocol(s.ssh) === 'ssh' && <span className="text-[10px] text-green-400/80 bg-green-400/10 border border-green-400/20 px-1.5 py-0 rounded-full cursor-default">在线</span>}
                  {s.connStatus === 'connected' && !s.localMode && getProtocol(s.ssh) === 'serial' && <span className="text-[10px] text-amber-400/80 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0 rounded-full cursor-default flex items-center space-x-1"><Cpu className="w-2.5 h-2.5" /><span>串口已连</span></span>}
                  {s.connStatus === 'connected' && (s.localMode || getProtocol(s.ssh) === 'local') && <span className="text-[10px] text-emerald-400/80 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0 rounded-full cursor-default flex items-center space-x-1"><Monitor className="w-2.5 h-2.5" /><span>本地终端</span></span>}
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
                          {getProtocol(s.ssh) === 'serial' ? <Cpu className="w-7 h-7 text-amber-400" /> : <Server className="w-7 h-7 text-blue-400" />}
                        </div>
                      </div>
                      <p className="text-text-primary text-lg font-semibold mb-1">正在连接</p>
                      <p className="text-blue-300 font-mono text-sm mb-6">{formatConnectionSummary(s.ssh)}</p>
                      <div className="flex items-center space-x-1.5">
                        {[0, 1, 2].map(i => (
                          <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                      <p className="text-text-tertiary text-xs mt-4">
                        {getProtocol(s.ssh) === 'serial' ? '正在打开串口通信句柄，请稍候' : '建立 SSH 握手中，请稍候'}
                      </p>
                    </>
                  )}
                  {s.connStatus === 'error' && (
                    <>
                      <div className="w-16 h-16 rounded-full bg-red-600/20 border border-red-500/40 flex items-center justify-center mb-6">
                        <AlertCircle className="w-8 h-8 text-red-400" />
                      </div>
                      <p className="text-text-primary text-lg font-semibold mb-2">
                        {s.connError.includes('Closed') || s.connError.includes('异常断开') || s.connError.includes('已关闭') ? '连接已断开' : '连接失败'}
                      </p>
                      <p className="text-red-400 text-sm mb-1 font-mono">{formatConnectionSummary(s.ssh)}</p>
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

              {/* Terminal — stays mounted once connected so scrollback & split panes are preserved across reconnects */}
              <div className={`absolute inset-0 transition-opacity duration-200 ${s.activeTab === 'terminal' && (s.connStatus === 'connected' || s.connStatus === 'reconnecting') ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                }`}>
                <Terminal
                  sshId={s.key}
                  isConnected={s.connStatus === 'connected' || s.connStatus === 'reconnecting' || hasConnectedRef.current.has(s.key)}
                  mode={s.localMode || getProtocol(s.ssh) === 'local' ? 'local' : getProtocol(s.ssh) === 'serial' ? 'serial' : 'ssh'}
                  cwd={s.ssh.cwd}
                  shell={s.ssh.shell}
                  localEcho={s.ssh.localEcho}
                  lineEnding={s.ssh.lineEnding}
                />

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

              {/* SFTP — persistently mounted once connected (SSH only), CSS-hidden when not active to preserve state */}
              {!s.localMode && getProtocol(s.ssh) === 'ssh' && (s.connStatus === 'connected' || s.connStatus === 'reconnecting' || hasConnectedRef.current.has(s.key)) && (
                <div className={`absolute inset-0 z-10 bg-background transition-opacity duration-200 ${
                  s.activeTab === 'sftp' && (s.connStatus === 'connected' || s.connStatus === 'reconnecting') ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}>
                  <SftpBrowser sshId={s.key} />
                </div>
              )}
            </div>

            {/* Server Status Footer — real-time CPU, Memory, Disk, TCP, Load & Uptime (SSH only) */}
            {!s.localMode && getProtocol(s.ssh) === 'ssh' && s.connStatus === 'connected' && (
              <div className="relative flex items-center px-3 py-1 bg-background-secondary/95 border-t border-border-primary text-[11px] select-none flex-shrink-0 z-20">
                <StatusFooter
                  sshId={s.key}
                  isConnected={s.connStatus === 'connected'}
                  isVisible={s.key === activeSessionKey}
                />
              </div>
            )}
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
                      <p className="text-text-secondary text-[11px] mt-0.5">{s ? formatConnectionSummary(s.ssh) : ''}</p>
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
            <div className="px-5 py-3 border-b border-border/50 flex-shrink-0 flex items-center justify-between">
              <h3 className="text-lg font-bold text-text-primary">
                {editingSSH ? '编辑连接配置' : '新增连接配置'}
              </h3>
              {/* Protocol Segmented Switcher */}
              <div className="flex items-center p-0.5 bg-background-secondary border border-border rounded-lg text-xs">
                {([
                  { id: 'ssh', label: 'SSH 协议', icon: <Server className="w-3.5 h-3.5" /> },
                  { id: 'serial', label: '串口 (Serial)', icon: <Cpu className="w-3.5 h-3.5" /> },
                  { id: 'local', label: '本地 (Local)', icon: <Monitor className="w-3.5 h-3.5" /> },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, protocol: tab.id })}
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
                      formData.protocol === tab.id
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 overflow-y-auto scrollbar-thin space-y-3.5">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    名称 {formData.protocol !== 'ssh' && <span className="text-xs text-text-tertiary font-normal">（可选，留空自动生成）</span>}
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-base"
                    placeholder={
                      formData.protocol === 'serial'
                        ? `例如: 开发板调试 (${formData.serialPort || 'COM1'})`
                        : formData.protocol === 'local'
                          ? '例如: 本地 PowerShell / Zsh'
                          : '例如: 生产服务器-01'
                    }
                    required={formData.protocol === 'ssh'}
                  />
                </div>

                {/* ── 串口 (Serial) 协议专属配置（对齐截图 6 项标准参数） ── */}
                {formData.protocol === 'serial' && (
                  <div className="space-y-3.5 bg-background-secondary/40 border border-border/60 rounded-xl p-4">
                    {/* 1. 端口号(P) */}
                    <div className="grid grid-cols-3 items-center gap-3">
                      <label className="text-sm font-medium text-text-secondary">端口号(P):</label>
                      <div className="col-span-2 flex items-center gap-2">
                        {customSerialPortMode ? (
                          <input
                            type="text"
                            value={formData.serialPort}
                            onChange={(e) => setFormData({ ...formData, serialPort: e.target.value })}
                            className="input-base flex-1 font-mono"
                            placeholder="如 COM1 或 /dev/cu.usbserial-1410"
                            required
                          />
                        ) : (
                          <select
                            value={formData.serialPort}
                            onChange={(e) => {
                              if (e.target.value === '__custom__') {
                                setCustomSerialPortMode(true);
                              } else {
                                setFormData({ ...formData, serialPort: e.target.value });
                              }
                            }}
                            className="input-base flex-1 font-mono"
                          >
                            {availableSerialPorts.map(p => (
                              <option key={p.portName} value={p.portName}>
                                {p.portName} {p.description ? `(${p.description})` : ''}
                              </option>
                            ))}
                            {/* Fallback common port options if not already in availableSerialPorts */}
                            {(['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8'].filter(
                              c => !availableSerialPorts.some(p => p.portName === c)
                            )).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                            {formData.serialPort &&
                              !availableSerialPorts.some(p => p.portName === formData.serialPort) &&
                              !['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8'].includes(formData.serialPort) && (
                                <option value={formData.serialPort}>{formData.serialPort}</option>
                              )}
                            <option value="__custom__">手动输入其他端口...</option>
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (customSerialPortMode) setCustomSerialPortMode(false);
                            refreshSerialPorts();
                          }}
                          className="p-2 bg-background-secondary hover:bg-background-tertiary border border-border rounded-lg text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
                          title="刷新检测本机串口列表"
                        >
                          <RefreshCw className={`w-4 h-4 ${loadingSerialPorts ? 'animate-spin text-primary' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {/* 2. 波特率(B) */}
                    <div className="grid grid-cols-3 items-center gap-3">
                      <label className="text-sm font-medium text-text-secondary">波特率(B):</label>
                      <div className="col-span-2">
                        <select
                          value={formData.baudRate}
                          onChange={(e) => setFormData({ ...formData, baudRate: e.target.value })}
                          className="input-base font-mono"
                        >
                          {['4800', '9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600', '1500000'].map(rate => (
                            <option key={rate} value={rate}>{rate}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* 3. 数据位(D) */}
                    <div className="grid grid-cols-3 items-center gap-3">
                      <label className="text-sm font-medium text-text-secondary">数据位(D):</label>
                      <div className="col-span-2">
                        <select
                          value={formData.dataBits}
                          onChange={(e) => setFormData({ ...formData, dataBits: e.target.value })}
                          className="input-base font-mono"
                        >
                          {['8', '7', '6', '5'].map(bits => (
                            <option key={bits} value={bits}>{bits}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* 4. 停止位(S) */}
                    <div className="grid grid-cols-3 items-center gap-3">
                      <label className="text-sm font-medium text-text-secondary">停止位(S):</label>
                      <div className="col-span-2">
                        <select
                          value={formData.stopBits}
                          onChange={(e) => setFormData({ ...formData, stopBits: e.target.value })}
                          className="input-base font-mono"
                        >
                          <option value="1">1</option>
                          <option value="2">2</option>
                        </select>
                      </div>
                    </div>

                    {/* 5. 奇偶校验(A) */}
                    <div className="grid grid-cols-3 items-center gap-3">
                      <label className="text-sm font-medium text-text-secondary">奇偶校验(A):</label>
                      <div className="col-span-2">
                        <select
                          value={formData.parity}
                          onChange={(e) => setFormData({ ...formData, parity: e.target.value as SerialParity })}
                          className="input-base"
                        >
                          <option value="none">无</option>
                          <option value="odd">奇校验 (Odd)</option>
                          <option value="even">偶校验 (Even)</option>
                        </select>
                      </div>
                    </div>

                    {/* 6. 流控制(F) */}
                    <div className="grid grid-cols-3 items-center gap-3">
                      <label className="text-sm font-medium text-text-secondary">流控制(F):</label>
                      <div className="col-span-2">
                        <select
                          value={formData.flowControl}
                          onChange={(e) => setFormData({ ...formData, flowControl: e.target.value as SerialFlowControl })}
                          className="input-base"
                        >
                          <option value="none">无</option>
                          <option value="software">XON/XOFF (软流控)</option>
                          <option value="hardware">RTS/CTS (硬流控)</option>
                        </select>
                      </div>
                    </div>

                    {/* 串口附加选项（换行模式 & 本地回显） */}
                    <div className="grid grid-cols-3 items-center gap-3 pt-2 border-t border-border/40">
                      <label className="text-xs font-medium text-text-tertiary">回车换行 / 回显:</label>
                      <div className="col-span-2 flex items-center justify-between gap-3">
                        <select
                          value={formData.lineEnding}
                          onChange={(e) => setFormData({ ...formData, lineEnding: e.target.value as 'cr' | 'lf' | 'crlf' })}
                          className="input-base !py-1 text-xs font-mono flex-1"
                          title="按回车键发送的行尾字符"
                        >
                          <option value="cr">CR (\r)</option>
                          <option value="crlf">CRLF (\r\n)</option>
                          <option value="lf">LF (\n)</option>
                        </select>
                        <label className="flex items-center space-x-1.5 text-xs text-text-secondary cursor-pointer select-none flex-shrink-0">
                          <input
                            type="checkbox"
                            checked={formData.localEcho}
                            onChange={(e) => setFormData({ ...formData, localEcho: e.target.checked })}
                            className="rounded border-border text-primary focus:ring-primary"
                          />
                          <span>本地回显</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 本地终端 (Local) 协议专属配置 ── */}
                {formData.protocol === 'local' && (
                  <div className="space-y-3.5 bg-background-secondary/40 border border-border/60 rounded-xl p-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">初始工作目录（可选）</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={formData.cwd}
                          onChange={(e) => setFormData({ ...formData, cwd: e.target.value })}
                          className="input-base flex-1 font-mono"
                          placeholder="留空则默认使用系统主目录 (~)"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const dir = await window.electronAPI.selectDirectory();
                              if (dir) {
                                setFormData(prev => ({ ...prev, cwd: dir }));
                              }
                            } catch (err) {
                              console.error('Failed to select directory:', err);
                            }
                          }}
                          className="px-3 py-2 bg-background-secondary hover:bg-background-tertiary border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 flex items-center gap-1.5"
                          title="选择本地工作目录"
                        >
                          <Folder className="w-3.5 h-3.5" />
                          <span>浏览</span>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">启动 Shell（可选）</label>
                      <input
                        type="text"
                        list="local-shells"
                        value={formData.shell}
                        onChange={(e) => setFormData({ ...formData, shell: e.target.value })}
                        className="input-base font-mono"
                        placeholder="留空使用系统默认 (Windows: powershell.exe / macOS: zsh)"
                      />
                      <datalist id="local-shells">
                        <option value="powershell.exe" />
                        <option value="pwsh.exe" />
                        <option value="cmd.exe" />
                        <option value="/bin/zsh" />
                        <option value="/bin/bash" />
                        <option value="/bin/sh" />
                      </datalist>
                    </div>
                  </div>
                )}

                {/* ── SSH 协议专属配置 ── */}
                {formData.protocol === 'ssh' && (
                  <>
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
                      <div className="flex items-center gap-2">
                        <input type="text" value={formData.keyPath} onChange={(e) => setFormData({ ...formData, keyPath: e.target.value })} className="input-base flex-1" placeholder="~/.ssh/id_rsa" />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const files = await window.electronAPI.selectFiles();
                              if (files && files.length > 0) {
                                const picked = files[0] as any;
                                const filePath = typeof picked === 'string' ? picked : picked?.path;
                                if (filePath) {
                                  setFormData(prev => ({ ...prev, keyPath: filePath }));
                                }
                              }
                            } catch (err) {
                              console.error('Failed to select key file:', err);
                            }
                          }}
                          className="px-3 py-2 bg-background-secondary hover:bg-background-tertiary border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 flex items-center gap-1.5"
                          title="选择本地私钥文件"
                        >
                          <Folder className="w-3.5 h-3.5" />
                          <span>浏览</span>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">密码（可选）</label>
                      <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="input-base" />
                    </div>
                  </>
                )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">分组 (可选)</label>
                  <input type="text" list="ssh-groups" value={formData.group} onChange={(e) => setFormData({ ...formData, group: e.target.value })} className="input-base" placeholder="例如: 生产环境 / 硬件调试" />
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

              {/* Tunnel Management in Modal (SSH only) */}
              {formData.protocol === 'ssh' && (
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
              )}

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
        title="确定要删除这个连接配置吗？"
        description="此操作将永久删除该连接配置及其关联设置，且无法恢复。"
      />
    </div>
  );
};

export default SSHPage;
