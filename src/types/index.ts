export interface Project {
  id: string;
  name: string;
  path: string;
  description: string;
  tags: string[];
  codePath?: string; // Independent code directory
  createdAt: string;
  updatedAt: string;
}

export interface OnlineSystem {
  id: string;
  projectId?: string;
  name: string;
  url: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  systemId?: string;
  platform: string;
  username: string;
  password: string;
  email?: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface SSHTunnel {
  id: string;
  type: 'local' | 'remote';
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  name: string;
}

export interface SSHInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  keyPath?: string;
  password?: string;
  description: string;
  group?: string;
  tunnels?: SSHTunnel[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  type: 'project' | 'system' | 'account' | 'ssh';
  id: string;
  title: string;
  description: string;
  data: Project | OnlineSystem | Account | SSHInfo;
}

export interface SessionState {
  key: string; // unique: sshId + '_' + timestamp
  ssh: SSHInfo;
  connStatus: 'connecting' | 'connected' | 'error' | 'reconnecting';
  connError: string;
  activeTab: 'terminal' | 'sftp';
  /** When true, terminal runs in local PTY mode (zsh/powershell) instead of SSH */
  localMode?: boolean;
}

// File transfer job — shared between SftpBrowser and global state
export interface TransferJob {
  id: string;
  name: string;
  direction: 'upload' | 'download';
  done: boolean;
  error?: string;
  progress?: number;
  currentFile?: string;
  /** Smoothed transfer speed in bytes/s, calculated on the frontend */
  speed?: number;
}

export interface ProjectTrack {
  id: string;
  projectId?: string; // Optional link to existing project
  name: string;
  location: string;
  priority: number; // 0-3 (P3-P0)
  status: 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
  timeframe: string;
  overview: string;
  updates: Array<{
    id: string;
    content: string;
    timestamp: string;
  }>;
  todos: Array<{
    id: string;
    content: string;
    completed: boolean;
  }>;
  factors: string[]; // Keywords/Factors
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalTodo {
  id: string;
  content: string;
  completed: boolean;
  createdAt: string;
}

export type AIProvider = 'openrouter' | 'nvidia' | 'custom' | 'gemini';

export interface AIModelConfig {
  id: string;
  displayName: string;   // 用户自定义显示名
  provider: AIProvider;
  apiKey: string;
  model: string;         // 模型标识符，如 google/gemini-2.0-flash-001
  baseURL?: string;      // 可选，自定义提供商或覆盖默认端点
}

export interface AISettings {
  models: AIModelConfig[];
  activeModelId: string | null;
  proxy?: string;
}

export interface AppState {
  projects: Project[];
  systems: OnlineSystem[];
  accounts: Account[];
  sshInfo: SSHInfo[];
  tracks: ProjectTrack[];
  globalTodos: GlobalTodo[];
  searchResults: SearchResult[];
  sshSessions: SessionState[];
  activeSessionKey: string | null;
  aiSettings: AISettings;
  // Transfer jobs grouped by sshId (persists across tab switches)
  transferJobs: Record<string, TransferJob[]>;
  /** Whether the sidebar is collapsed; controlled via Settings page */
  sidebarCollapsed: boolean;
}

declare global {
  interface Window {
    electronAPI: {
      getProjects: () => Promise<Project[]>;
      addProject: (project: Project) => Promise<void>;
      updateProject: (id: string, project: Project) => Promise<void>;
      deleteProject: (id: string) => Promise<void>;

      getSystems: () => Promise<OnlineSystem[]>;
      addSystem: (system: OnlineSystem) => Promise<void>;
      updateSystem: (id: string, system: OnlineSystem) => Promise<void>;
      deleteSystem: (id: string) => Promise<void>;

      getAccounts: () => Promise<Account[]>;
      addAccount: (account: Account) => Promise<void>;
      updateAccount: (id: string, account: Account) => Promise<void>;
      deleteAccount: (id: string) => Promise<void>;

      getSSHInfo: () => Promise<SSHInfo[]>;
      addSSHInfo: (sshInfo: SSHInfo) => Promise<void>;
      updateSSHInfo: (id: string, sshInfo: SSHInfo) => Promise<void>;
      deleteSSHInfo: (id: string) => Promise<void>;
      
      // 项目追踪
      getTracks: () => Promise<ProjectTrack[]>;
      addTrack: (track: Partial<ProjectTrack>) => Promise<ProjectTrack>;
      updateTrack: (id: string, track: Partial<ProjectTrack>) => Promise<void>;
      deleteTrack: (id: string) => Promise<void>;
      
      // 全局待办
      getGlobalTodos: () => Promise<GlobalTodo[]>;
      addGlobalTodo: (todo: Partial<GlobalTodo>) => Promise<GlobalTodo>;
      updateGlobalTodo: (id: string, todo: Partial<GlobalTodo>) => Promise<void>;
      deleteGlobalTodo: (id: string) => Promise<void>;

      // SSH Terminal & SFTP
      sshConnect: (id: string, options: any) => Promise<{success: boolean, error?: string, message?: string}>;
      sshDisconnect: (id: string) => Promise<void>;
      sshWrite: (id: string, data: string) => Promise<void>;
      sshResize: (id: string, cols: number, rows: number) => Promise<void>;

      // Multi-shell support (split-pane terminals)
      sshOpenShell: (id: string, shellId: string) => Promise<{success: boolean, error?: string, message?: string}>;
      sshCloseShell: (id: string, shellId: string) => Promise<void>;
      sshWriteShell: (id: string, shellId: string, data: string) => Promise<void>;
      sshResizeShell: (id: string, shellId: string, cols: number, rows: number) => Promise<void>;
      sshExec: (id: string, command: string) => Promise<{stdout: string, stderr: string, code: number}>;
      
      sshForwardLocal: (id: string, tunnelId: string, localPort: number, remoteHost: string, remotePort: number) => Promise<{success: boolean, error?: string}>;
      sshForwardRemote: (id: string, tunnelId: string, remotePort: number, localHost: string, localPort: number) => Promise<{success: boolean, error?: string}>;
      sshStopTunnel: (id: string, tunnelId: string) => Promise<void>;
      
      sftpList: (id: string, path: string) => Promise<any[]>;
      sftpMkdir: (id: string, path: string) => Promise<boolean>;
      sftpRmdir: (id: string, path: string) => Promise<boolean>;
      sftpUnlink: (id: string, path: string) => Promise<boolean>;
      sftpRename: (id: string, oldPath: string, newPath: string) => Promise<boolean>;
      sftpUpload: (id: string, localPath: string, remotePath: string, jid?: string, options?: any) => Promise<boolean>;
      sftpCancelTransfer?: (jid: string) => Promise<boolean>;
      sftpDownload: (id: string, remotePath: string, localPath: string, jid?: string) => Promise<boolean>;
      sftpCopy: (id: string, srcPath: string, destPath: string) => Promise<boolean>;
      sftpStat: (id: string, filePath: string) => Promise<{ mode: number; octal: string; isDir?: boolean; size: number; mtime: number; ctime: number }>;
      sftpChmod: (id: string, filePath: string, mode: number) => Promise<boolean>;

      // 本地文件系统
      localListDir: (dirPath: string) => Promise<any[]>;
      localHomeDir: () => Promise<string>;
      localStat: (filePath: string) => Promise<{ size: number; mtime: number; ctime: number; isDir: boolean }>;
      localWriteFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
      localCreateNode: (parentPath: string, name: string, isDir: boolean) => Promise<{ success: boolean; path: string }>;
      localDeleteNode: (filePath: string) => Promise<{ success: boolean }>;
      localCopyFile: (srcPath: string, destPath: string) => Promise<boolean>;
      localWriteFileToClipboard: (path: string) => Promise<boolean>;
      localReadFileFromClipboard: () => Promise<string>;

      // Git APIs
      gitInit: (repoPath: string) => Promise<void>;
      gitDiscoverRoots: (workspacePath: string) => Promise<string[]>;
      gitUnstage: (repoPath: string, filePath: string) => Promise<void>;
      gitCreateBranch: (repoPath: string, name: string, base: string | null, checkout: boolean) => Promise<void>;
      gitDeleteBranch: (repoPath: string, name: string, force: boolean) => Promise<void>;
      gitRenameBranch: (repoPath: string, oldName: string, newName: string) => Promise<void>;
      gitCreateTag: (repoPath: string, tagName: string, commit: string | null, message: string | null, force: boolean) => Promise<void>;
      gitStatus: (repoPath: string) => Promise<Record<string, string>>;
      gitCurrentBranch: (repoPath: string) => Promise<string>;
      gitBranches: (repoPath: string) => Promise<{ name: string; is_remote: boolean; is_current: boolean }[]>;
      gitCheckout: (repoPath: string, branch: string) => Promise<void>;
      gitAdd: (repoPath: string, filePath: string) => Promise<void>;
      gitRestore: (repoPath: string, filePath: string) => Promise<void>;
      gitCommit: (repoPath: string, files: string[], message: string) => Promise<void>;
      gitPush: (repoPath: string, remote: string, branch: string, force: boolean) => Promise<void>;
      gitPull: (repoPath: string, remote: string, branch: string, rebase: boolean) => Promise<void>;
      gitFetch: (repoPath: string) => Promise<void>;
      gitRemotes: (repoPath: string) => Promise<Array<[string, string]>>;
      gitSetRemoteUrl: (repoPath: string, name: string, url: string) => Promise<void>;
      gitHistory: (repoPath: string, filePath?: string) => Promise<any[]>;
      gitLogGraph: (repoPath: string) => Promise<any[]>;
      gitUnpushedCommits: (repoPath: string, remote: string, branch: string) => Promise<{ hash: string; author: string; date: string; message: string }[]>;
      gitCommitFiles: (repoPath: string, hash: string) => Promise<{ path: string; status: string }[]>;
      gitShowFile: (repoPath: string, hash: string, filePath: string) => Promise<string>;
      gitStashPush: (repoPath: string, message?: string) => Promise<void>;
      gitStashList: (repoPath: string) => Promise<string[]>;
      gitStashPop: (repoPath: string, index: number) => Promise<void>;

      onSshOutput: (id: string, callback: (data: string) => void) => () => void;
      onSshError: (id: string, callback: (error: string) => void) => () => void;
      onSshClosed: (id: string, callback: () => void) => () => void;
      onSftpProgress?: (callback: (data: { jid: string; file: string; transferred: number; total: number }) => void) => () => void;
      emitSshOutput: (id: string, data: string) => Promise<void>;
      emitSshReconnected: (id: string) => Promise<void>;
      onSshReconnected: (id: string, callback: () => void) => () => void;

      // 本地终端 (PTY)
      ptySpawn: (id: string, cwd?: string) => Promise<{success: boolean, shell?: string, error?: string}>;
      ptyWrite: (id: string, data: string) => Promise<void>;
      ptyResize: (id: string, cols: number, rows: number) => Promise<void>;
      ptyDestroy: (id: string) => Promise<void>;
      ptyDestroySession: (sessionKey: string) => Promise<void>;
      onPtyOutput: (id: string, callback: (data: string) => void) => () => void;
      onPtyExit: (id: string, callback: (code: number) => void) => () => void;

      globalSearch: (keyword: string) => Promise<SearchResult[]>;
      exportData: () => Promise<any>;
      importData: (data: any) => Promise<boolean>;
      selectDirectory: () => Promise<string | undefined>;
      selectFiles: () => Promise<Array<{ name: string; path: string }>>;
      readFileBase64: (filePath: string) => Promise<{ type: 'image' | 'text'; data: string; mimeType?: string }>;
      getChatSessions: () => Promise<any[]>;
      saveChatSession: (session: any) => Promise<boolean>;
      deleteChatSession: (id: string) => Promise<boolean>;
      openDirectory: (path: string) => Promise<void>;
      openPath: (path: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      getDbPath: () => Promise<string>;
      initProjectDirectory: (path: string) => Promise<{success: boolean, error?: string}>;
      getFrontendPlugins?: () => Promise<Array<{ name: string; code: string }>>;
      printFrontendLog?: (msg: string) => Promise<void>;

      // AI 设置
      getAISettings: () => Promise<AISettings>;
      updateAISettings: (settings: Partial<AISettings>) => Promise<boolean>;
      aiChat: (apiKey: string, model: string, messages: any[], provider?: string, baseURL?: string) => Promise<any>;
      aiAbort: () => Promise<boolean>;
      onConfirmToolExecution: (callback: (data: { toolId: string; toolName: string; args: any }) => void) => () => void;
      respondToToolExecution: (toolId: string, approved: boolean) => Promise<void>;

      // 插件系统与系统层
      platform: string;
    };
  }
}
