import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { Low } from 'lowdb';
import { TauriLowdbAdapter } from './db/TauriLowdbAdapter';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Helper to log to Tauri terminal
async function logToBackend(msg: string) {
  try {
    await invoke('print_frontend_log', { msg });
  } catch (err) {
    console.error(err);
  }
}

// Initialize lowdb on the frontend
let db: Low<any>;

async function getDb() {
  if (!db) {
    await logToBackend('getDb: Initializing TauriLowdbAdapter...');
    const adapter = new TauriLowdbAdapter<any>('data.json');
    db = new Low(adapter, {
      projects: [],
      systems: [],
      accounts: [],
      sshInfo: [],
      tracks: [],
      globalTodos: [],
      chatSessions: [],
      aiSettings: {
        models: [],
        activeModelId: null,
        proxy: '',
      }
    });
    
    await logToBackend('getDb: Reading from database file...');
    await db.read();
    
    await logToBackend(`getDb: db.read completed. db.data is null? ${db.data === null || db.data === undefined}`);
    
    // Ensure all base structures are present
    db.data = db.data || {};
    db.data.projects = db.data.projects || [];
    db.data.systems = db.data.systems || [];
    db.data.accounts = db.data.accounts || [];
    db.data.sshInfo = db.data.sshInfo || [];
    db.data.tracks = db.data.tracks || [];
    db.data.globalTodos = db.data.globalTodos || [];
    db.data.chatSessions = db.data.chatSessions || [];
    db.data.aiSettings = db.data.aiSettings || { models: [], activeModelId: null };
    
    await logToBackend(`getDb: Initialization finished. projects count=${db.data.projects.length}, sshInfo count=${db.data.sshInfo.length}`);
  }
  return db;
}

// Simple base64 encrypters to replace electron's safeStorage
function encryptString(str: string): string {
  if (!str) return str;
  return 'enc:b64:' + btoa(unescape(encodeURIComponent(str)));
}

function decryptString(str: string): string {
  if (!str) return str;
  if (typeof str !== 'string') return str;
  if (str.startsWith('enc:b64:')) {
    try {
      return decodeURIComponent(escape(atob(str.substring(8))));
    } catch {
      return str;
    }
  }
  if (str.startsWith('enc:')) {
    // Cannot decrypt old Electron safeStorage passwords natively, return empty to trigger re-entry
    return '';
  }
  return str;
}

// Abort controller for AI chat
let currentAbortController: AbortController | null = null;

// Global API Bridge definition
const electronAPI: any = {
  platform: navigator.userAgent.includes('Windows') ? 'win32' : navigator.userAgent.includes('Mac') ? 'darwin' : 'linux',
  minimize: async () => await getCurrentWindow().minimize(),
  maximize: async () => await getCurrentWindow().toggleMaximize(),
  isMaximized: async () => await getCurrentWindow().isMaximized(),
  close: async () => await getCurrentWindow().hide(),
  startDragging: async () => await getCurrentWindow().startDragging(),

  // Database CRUD - Projects
  getProjects: async () => {
    const db = await getDb();
    return db.data.projects;
  },
  addProject: async (project: any) => {
    const db = await getDb();
    db.data.projects.push(project);
    await db.write();
  },
  updateProject: async (id: string, project: any) => {
    const db = await getDb();
    db.data.projects = db.data.projects.map((p: any) => p.id === id ? project : p);
    await db.write();
  },
  deleteProject: async (id: string) => {
    const db = await getDb();
    db.data.projects = db.data.projects.filter((p: any) => p.id !== id);
    await db.write();
  },

  // Database CRUD - Systems
  getSystems: async () => {
    const db = await getDb();
    return db.data.systems;
  },
  addSystem: async (system: any) => {
    const db = await getDb();
    db.data.systems.push(system);
    await db.write();
  },
  updateSystem: async (id: string, system: any) => {
    const db = await getDb();
    db.data.systems = db.data.systems.map((s: any) => s.id === id ? system : s);
    await db.write();
  },
  deleteSystem: async (id: string) => {
    const db = await getDb();
    db.data.systems = db.data.systems.filter((s: any) => s.id !== id);
    await db.write();
  },

  // Database CRUD - Accounts
  getAccounts: async () => {
    const db = await getDb();
    return db.data.accounts.map((a: any) => ({ ...a, password: decryptString(a.password) }));
  },
  addAccount: async (account: any) => {
    const db = await getDb();
    const encrypted = { ...account, password: encryptString(account.password) };
    db.data.accounts.push(encrypted);
    await db.write();
  },
  updateAccount: async (id: string, account: any) => {
    const db = await getDb();
    const encrypted = { ...account, password: encryptString(account.password) };
    db.data.accounts = db.data.accounts.map((a: any) => a.id === id ? encrypted : a);
    await db.write();
  },
  deleteAccount: async (id: string) => {
    const db = await getDb();
    db.data.accounts = db.data.accounts.filter((a: any) => a.id !== id);
    await db.write();
  },

  // Database CRUD - SSHInfo
  getSSHInfo: async () => {
    const db = await getDb();
    return db.data.sshInfo.map((s: any) => ({ ...s, password: decryptString(s.password) }));
  },
  addSSHInfo: async (sshInfo: any) => {
    const db = await getDb();
    const encrypted = { ...sshInfo, password: encryptString(sshInfo.password) };
    db.data.sshInfo.push(encrypted);
    await db.write();
    return { ...encrypted, password: sshInfo.password };
  },
  updateSSHInfo: async (id: string, sshInfo: any) => {
    const db = await getDb();
    const encrypted = { ...sshInfo, password: encryptString(sshInfo.password) };
    db.data.sshInfo = db.data.sshInfo.map((s: any) => s.id === id ? encrypted : s);
    await db.write();
    return { ...encrypted, password: sshInfo.password };
  },
  deleteSSHInfo: async (id: string) => {
    const db = await getDb();
    db.data.sshInfo = db.data.sshInfo.filter((s: any) => s.id !== id);
    await db.write();
  },

  // Database CRUD - Tracks
  getTracks: async () => {
    const db = await getDb();
    return db.data.tracks || [];
  },
  addTrack: async (track: any) => {
    const db = await getDb();
    const newTrack = {
      id: track.id || Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...track,
    };
    db.data.tracks.push(newTrack);
    await db.write();
    return newTrack;
  },
  updateTrack: async (id: string, track: any) => {
    const db = await getDb();
    db.data.tracks = db.data.tracks.map((t: any) => t.id === id ? { ...t, ...track, updatedAt: new Date().toISOString() } : t);
    await db.write();
  },
  deleteTrack: async (id: string) => {
    const db = await getDb();
    db.data.tracks = db.data.tracks.filter((t: any) => t.id !== id);
    await db.write();
  },

  // Database CRUD - GlobalTodos
  getGlobalTodos: async () => {
    const db = await getDb();
    return db.data.globalTodos || [];
  },
  addGlobalTodo: async (todo: any) => {
    const db = await getDb();
    const newTodo = {
      id: todo.id || Date.now().toString(),
      createdAt: new Date().toISOString(),
      completed: false,
      ...todo,
    };
    db.data.globalTodos.push(newTodo);
    await db.write();
    return newTodo;
  },
  updateGlobalTodo: async (id: string, todo: any) => {
    const db = await getDb();
    db.data.globalTodos = db.data.globalTodos.map((t: any) => t.id === id ? { ...t, ...todo } : t);
    await db.write();
  },
  deleteGlobalTodo: async (id: string) => {
    const db = await getDb();
    db.data.globalTodos = db.data.globalTodos.filter((t: any) => t.id !== id);
    await db.write();
  },

  // Chat sessions
  getChatSessions: async () => {
    const db = await getDb();
    return db.data.chatSessions || [];
  },
  saveChatSession: async (session: any) => {
    const db = await getDb();
    const exists = db.data.chatSessions.find((s: any) => s.id === session.id);
    if (exists) {
      db.data.chatSessions = db.data.chatSessions.map((s: any) => s.id === session.id ? session : s);
    } else {
      db.data.chatSessions.push(session);
    }
    await db.write();
    return true;
  },
  deleteChatSession: async (id: string) => {
    const db = await getDb();
    db.data.chatSessions = db.data.chatSessions.filter((s: any) => s.id !== id);
    await db.write();
    return true;
  },

  // AI settings
  getAISettings: async () => {
    const db = await getDb();
    const settings = db.data.aiSettings || { models: [], activeModelId: null };
    // Decrypt apiKeys
    const decryptedModels = (settings.models || []).map((m: any) => ({
      ...m,
      apiKey: decryptString(m.apiKey)
    }));
    return { ...settings, models: decryptedModels };
  },
  updateAISettings: async (settings: any) => {
    const db = await getDb();
    const current = db.data.aiSettings || { models: [], activeModelId: null };
    const updated = { ...current, ...settings };
    if (Array.isArray(updated.models)) {
      updated.models = updated.models.map((m: any) => ({
        ...m,
        apiKey: encryptString(m.apiKey)
      }));
    }
    db.data.aiSettings = updated;
    await db.write();
    return true;
  },

  // File system invokes
  localListDir: (dirPath: string) => invoke('local_list_dir', { dirPath }),
  localHomeDir: () => invoke('local_home_dir'),
  localStat: (filePath: string) => invoke('local_stat', { filePath }),
  localWriteFile: (filePath: string, content: string) => invoke('local_write_file', { filePath, content }),
  localCreateNode: (parentPath: string, name: string, isDir: boolean) => invoke('local_create_node', { parentPath, name, isDir }),
  localDeleteNode: (filePath: string) => invoke('local_delete_node', { filePath }),
  localCopyFile: (srcPath: string, destPath: string) => invoke('local_copy_file', { srcPath, destPath }),
  localWriteFileToClipboard: (path: string) => invoke('local_write_file_to_clipboard', { path }),
  localReadFileFromClipboard: () => invoke('local_read_file_from_clipboard'),
  readFileBase64: (filePath: string) => invoke('read_file_base64', { filePath }),
  selectDirectory: () => invoke('select_directory'),
  selectFiles: () => invoke('select_files'),
  openDirectory: (path: string) => invoke('open_directory', { dirPath: path }),
  openPath: (path: string) => invoke('open_directory', { dirPath: path }),
  openExternal: (url: string) => invoke('opener_open_url', { url }), // Use tauri-plugin-opener standard command

  // PTY shell commands
  ptySpawn: (id: string, cwd?: string) => invoke('pty_spawn', { id, cwd }),
  ptyWrite: (id: string, data: string) => invoke('pty_write', { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke('pty_resize', { id, cols, rows }),
  ptyDestroy: (id: string) => invoke('pty_destroy', { id }),
  ptyDestroySession: (sessionKey: string) => invoke('pty_destroy_session', { sessionKey }),
  onPtyOutput: (id: string, callback: (data: string) => void) => {
    let active = true;
    const unlistenPromise = listen(`pty-output-${id}`, (event: any) => {
      if (active) callback(event.payload);
    });
    return () => {
      active = false;
      unlistenPromise.then(unlistenFn => {
        if (typeof unlistenFn === 'function') unlistenFn();
      }).catch(console.error);
    };
  },
  onPtyExit: (id: string, callback: (code: number) => void) => {
    let active = true;
    const unlistenPromise = listen(`pty-exit-${id}`, (event: any) => {
      if (active) callback(event.payload);
    });
    return () => {
      active = false;
      unlistenPromise.then(unlistenFn => {
        if (typeof unlistenFn === 'function') unlistenFn();
      }).catch(console.error);
    };
  },

  // SSH & SFTP commands
  sshConnect: async (id: string, options: any) => {
    const res: any = await invoke('ssh_connect', {
      id,
      host: options.host,
      port: options.port || 22,
      username: options.username,
      password: options.password || null,
      keyPath: options.keyPath || null,
    });
    return res;
  },
  sshDisconnect: (id: string) => invoke('ssh_disconnect', { id }),
  sshWrite: (id: string, data: string) => invoke('ssh_write_shell', { id, shellId: id, data }),
  sshResize: (id: string, cols: number, rows: number) => invoke('ssh_resize_shell', { id, shellId: id, cols, rows }),
  sshOpenShell: (id: string, shellId: string) => invoke('ssh_open_shell', { id, shellId }),
  sshCloseShell: (id: string, shellId: string) => invoke('ssh_close_shell', { id, shellId }),
  sshWriteShell: (id: string, shellId: string, data: string) => invoke('ssh_write_shell', { id, shellId, data }),
  sshResizeShell: (id: string, shellId: string, cols: number, rows: number) => invoke('ssh_resize_shell', { id, shellId, cols, rows }),
  sshExec: (id: string, command: string) => invoke('ssh_exec', { id, command }),
  sshForwardLocal: (id: string, tunnelId: string, localPort: number, remoteHost: string, remotePort: number) => invoke('ssh_forward_local', { id, tunnelId, localPort, remoteHost, remotePort }),
  sshForwardRemote: (id: string, tunnelId: string, remotePort: number, localHost: string, localPort: number) => invoke('ssh_forward_remote', { id, tunnelId, remotePort, localHost, localPort }),
  sshStopTunnel: (id: string, tunnelId: string) => invoke('ssh_stop_tunnel', { id, tunnelId }),
  
  sftpList: (id: string, path: string) => invoke('sftp_list', { id, path }),
  sftpMkdir: (id: string, path: string) => invoke('sftp_mkdir', { id, path }),
  sftpRmdir: (id: string, path: string) => invoke('sftp_rmdir', { id, path }),
  sftpUnlink: (id: string, path: string) => invoke('sftp_unlink', { id, path }),
  sftpRename: (id: string, oldPath: string, newPath: string) => invoke('sftp_rename', { id, oldPath, newPath }),
  sftpUpload: (id: string, localPath: string, remotePath: string, jid: string) => invoke('sftp_upload', { id, localPath, remotePath, jid }),
  sftpDownload: (id: string, remotePath: string, localPath: string, jid: string) => invoke('sftp_download', { id, remotePath, localPath, jid }),
  sftpCancelTransfer: (jid: string) => invoke('sftp_cancel_transfer', { jid }),
  sftpStat: (id: string, filePath: string) => invoke('sftp_stat', { id, filePath }),
  sftpChmod: (id: string, filePath: string, mode: number) => invoke('sftp_chmod', { id, filePath, mode }),

  onSshOutput: (id: string, callback: (data: string) => void) => {
    let active = true;
    const unlistenPromise = listen(`ssh-output-${id}`, (event: any) => {
      if (active) callback(event.payload);
    });
    return () => {
      active = false;
      unlistenPromise.then(unlistenFn => {
        if (typeof unlistenFn === 'function') unlistenFn();
      }).catch(console.error);
    };
  },
  emitSshOutput: (id: string, data: string) => emit(`ssh-output-${id}`, data),
  emitSshReconnected: (id: string) => emit(`ssh-reconnected-${id}`, {}),
  onSshReconnected: (id: string, callback: () => void) => {
    let active = true;
    const unlistenPromise = listen(`ssh-reconnected-${id}`, () => {
      if (active) callback();
    });
    return () => {
      active = false;
      unlistenPromise.then(unlistenFn => {
        if (typeof unlistenFn === 'function') unlistenFn();
      }).catch(console.error);
    };
  },
  onSshClosed: (id: string, callback: () => void) => {
    let active = true;
    const unlistenPromise = listen(`ssh-closed-${id}`, () => {
      if (active) callback();
    });
    return () => {
      active = false;
      unlistenPromise.then(unlistenFn => {
        if (typeof unlistenFn === 'function') unlistenFn();
      }).catch(console.error);
    };
  },
  onSshError: (id: string, callback: (err: string) => void) => {
    let active = true;
    const unlistenPromise = listen(`ssh-error-${id}`, (event: any) => {
      if (active) callback(event.payload);
    });
    return () => {
      active = false;
      unlistenPromise.then(unlistenFn => {
        if (typeof unlistenFn === 'function') unlistenFn();
      }).catch(console.error);
    };
  },
  onSftpProgress: (callback: (data: any) => void) => {
    let active = true;
    const unlistenPromise = listen('sftp-progress', (event: any) => {
      if (active) callback(event.payload);
    });
    return () => {
      active = false;
      unlistenPromise.then(unlistenFn => {
        if (typeof unlistenFn === 'function') unlistenFn();
      }).catch(console.error);
    };
  },

  // Global search
  globalSearch: async (keyword: string) => {
    const db = await getDb();
    const kw = keyword.toLowerCase();
    const results: any[] = [];
    
    // Search projects
    (db.data.projects || []).forEach((p: any) => {
      if (p.name?.toLowerCase().includes(kw) || p.description?.toLowerCase().includes(kw)) {
        results.push({ type: 'project', id: p.id, title: p.name, description: p.description, data: p });
      }
    });

    // Search systems
    (db.data.systems || []).forEach((s: any) => {
      if (s.name?.toLowerCase().includes(kw) || s.url?.toLowerCase().includes(kw)) {
        results.push({ type: 'system', id: s.id, title: s.name, description: s.url, data: s });
      }
    });

    // Search accounts
    (db.data.accounts || []).forEach((a: any) => {
      if (a.username?.toLowerCase().includes(kw) || a.platform?.toLowerCase().includes(kw)) {
        results.push({ type: 'account', id: a.id, title: `${a.platform} (${a.username})`, description: a.description, data: a });
      }
    });

    // Search SSH
    (db.data.sshInfo || []).forEach((s: any) => {
      if (s.name?.toLowerCase().includes(kw) || s.host?.toLowerCase().includes(kw)) {
        results.push({ type: 'ssh', id: s.id, title: s.name, description: `${s.username}@${s.host}`, data: s });
      }
    });

    return results;
  },

  exportData: async () => {
    const db = await getDb();
    return db.data;
  },
  importData: async (data: any) => {
    const db = await getDb();
    db.data = data;
    await db.write();
    return true;
  },
  getDbPath: () => invoke('get_db_path'),
  printFrontendLog: (msg: string) => invoke('print_frontend_log', { msg }),
  initProjectDirectory: async (path: string) => {
    // Check if directory exists, if not create it
    try {
      await invoke('local_create_node', { parentPath: path, name: '', isDir: true });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },

  // AI Chat powered by Vercel AI SDK on client side
  aiChat: async (apiKey: string, model: string, messages: any[], provider?: string, baseURL?: string) => {
    currentAbortController = new AbortController();
    
    // Construct custom provider URL or headers if needed
    const defaultBaseURLs: Record<string, string> = {
      openrouter: 'https://openrouter.ai/api/v1',
      nvidia: 'https://integrate.api.nvidia.com/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1',
    };

    const targetBaseURL = baseURL || defaultBaseURLs[provider || 'openrouter'];
    
    try {
      const openaiProvider = createOpenAI({
        apiKey,
        baseURL: targetBaseURL,
        headers: provider === 'openrouter' ? {
          'HTTP-Referer': 'https://github.com/jinlong/FileClaw',
          'X-Title': 'FileClaw Project Manager',
        } : {},
      });

      const response = await generateText({
        model: openaiProvider(model),
        messages: messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content
        })),
        abortSignal: currentAbortController.signal,
      });

      return {
        choices: [
          {
            message: {
              content: response.text,
              reasoning_content: null,
            }
          }
        ]
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new DOMException('Aborted', 'AbortError');
      }
      throw err;
    }
  },

  aiAbort: async () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    return true;
  },

  // Git APIs
  gitInit: (repoPath: string) => invoke('git_init', { repoPath }),
  gitDiscoverRoots: (workspacePath: string) => invoke('git_discover_roots', { workspacePath }),
  gitUnstage: (repoPath: string, filePath: string) => invoke('git_unstage', { repoPath, filePath }),
  gitCreateBranch: (repoPath: string, name: string, base: string | null, checkout: boolean) => invoke('git_create_branch', { repoPath, name, base, checkout }),
  gitDeleteBranch: (repoPath: string, name: string, force: boolean) => invoke('git_delete_branch', { repoPath, name, force }),
  gitRenameBranch: (repoPath: string, oldName: string, newName: string) => invoke('git_rename_branch', { repoPath, oldName, newName }),
  gitCreateTag: (repoPath: string, tagName: string, commit: string | null, message: string | null, force: boolean) => invoke('git_create_tag', { repoPath, tagName, commit, message, force }),
  gitStatus: (repoPath: string) => invoke('git_status', { repoPath }),
  gitCurrentBranch: (repoPath: string) => invoke('git_current_branch', { repoPath }),
  gitBranches: (repoPath: string) => invoke('git_branches', { repoPath }),
  gitCheckout: (repoPath: string, branch: string) => invoke('git_checkout', { repoPath, branch }),
  gitAdd: (repoPath: string, filePath: string) => invoke('git_add', { repoPath, filePath }),
  gitRestore: (repoPath: string, filePath: string) => invoke('git_restore', { repoPath, filePath }),
  gitCommit: (repoPath: string, files: string[], message: string) => invoke('git_commit', { repoPath, files, message }),
  gitPush: (repoPath: string, remote: string, branch: string, force: boolean) => invoke('git_push', { repoPath, remote, branch, force }),
  gitPull: (repoPath: string, remote: string, branch: string, rebase: boolean) => invoke('git_pull', { repoPath, remote, branch, rebase }),
  gitFetch: (repoPath: string) => invoke('git_fetch', { repoPath }),
  gitRemotes: (repoPath: string) => invoke('git_remotes', { repoPath }),
  gitSetRemoteUrl: (repoPath: string, name: string, url: string) => invoke('git_set_remote_url', { repoPath, name, url }),
  gitHistory: (repoPath: string, filePath?: string) => invoke('git_history', { repoPath, filePath }),
  gitLogGraph: (repoPath: string) => invoke('git_log_graph', { repoPath }),
  gitUnpushedCommits: (repoPath: string, remote: string, branch: string) => invoke('git_unpushed_commits', { repoPath, remote, branch }),
  gitCommitFiles: (repoPath: string, hash: string) => invoke('git_commit_files', { repoPath, hash }),
  gitShowFile: (repoPath: string, hash: string, filePath: string) => invoke('git_show_file', { repoPath, hash, filePath }),
  gitStashPush: (repoPath: string, message?: string) => invoke('git_stash_push', { repoPath, message }),
  gitStashList: (repoPath: string) => invoke('git_stash_list', { repoPath }),
  gitStashPop: (repoPath: string, index: number) => invoke('git_stash_pop', { repoPath, index }),

  // Mock sensitivity execution listener for agents
  onConfirmToolExecution: (callback: (data: any) => void) => {
    // Since Tauri 2 agent commands will run securely in sandbox or confirmed via user,
    // this can return a no-op cleanup callback
    return () => {};
  },
  respondToToolExecution: async (toolId: string, approved: boolean) => {
    // No-op
  }
};

window.electronAPI = electronAPI;
export default electronAPI;
