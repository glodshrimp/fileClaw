import { create } from 'zustand';
import { Project } from '../types';

export interface OpenFileTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  size?: number;
  unsupported?: boolean;
  isTerminal?: boolean;
  isDiff?: boolean;
  isGitGraph?: boolean;
  diffInfo?: {
    originalContent: string;
    modifiedContent: string;
    originalLabel: string;
    modifiedLabel: string;
  };
  isMarkdownPreview?: boolean;
  previewSourcePath?: string;
}

const getBranchForPath = (path: string | null, roots: string[], repoBranches: Record<string, string>): string | null => {
  if (roots.length === 0) return null;
  if (!path) return repoBranches[roots[0]] || 'HEAD';
  const sortedRoots = [...roots].sort((a, b) => b.length - a.length);
  const matched = sortedRoots.find(r => path.startsWith(r));
  return matched ? repoBranches[matched] || 'HEAD' : (repoBranches[roots[0]] || 'HEAD');
};

interface WorkspaceState {
  currentProject: Project | null;
  openTabs: OpenFileTab[];
  activeTabPath: string | null;
  expandedFolders: Record<string, boolean>; // folderPath -> isExpanded
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  
  // Git State
  gitBranch: string | null;
  gitRoots: string[];
  gitRepoBranches: Record<string, string>;
  gitFileStatuses: Record<string, string>; // absolutePath -> status XY
  gitDirtyFolders: Record<string, { modified: boolean; added: boolean; untracked: boolean; notAdded: boolean }>;

  // Actions
  setCurrentProject: (project: Project | null) => void;
  toggleFolder: (path: string) => void;
  openFile: (path: string, name: string) => Promise<void>;
  closeFile: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  setActiveTab: (path: string) => void;
  closeAllTabs: () => void;
  openTerminal: (path: string, name: string) => void;
  openDiff: (
    path: string, 
    name: string, 
    originalContent: string, 
    modifiedContent: string, 
    originalLabel: string, 
    modifiedLabel: string
  ) => void;
  openGitGraph: () => void;
  openMarkdownPreview: (sourcePath: string, name: string) => void;
  closeOthers: (path: string) => void;
  closeLeft: (path: string) => void;
  closeRight: (path: string) => void;
  
  // Git Actions
  refreshGitStatus: () => Promise<void>;
  runGitCheckout: (branch: string) => Promise<void>;
  runGitAdd: (filePath: string) => Promise<void>;
  runGitRestore: (filePath: string) => Promise<void>;
  runGitInit: () => Promise<void>;

  fileExplorerRefreshKey: number;
  refreshFileExplorer: () => void;

  copiedFilePath: string | null;
  setCopiedFilePath: (path: string | null) => void;

  selectedFilePaths: string[];
  setSelectedFilePaths: (paths: string[]) => void;
  lastSelectedFilePath: string | null;
  setLastSelectedFilePath: (path: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  currentProject: null,
  openTabs: [],
  activeTabPath: null,
  expandedFolders: {},
  isSidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  sidebarWidth: 240,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  copiedFilePath: null,
  setCopiedFilePath: (path) => set({ copiedFilePath: path }),

  selectedFilePaths: [],
  setSelectedFilePaths: (paths) => set({ selectedFilePaths: paths }),
  lastSelectedFilePath: null,
  setLastSelectedFilePath: (path) => set({ lastSelectedFilePath: path }),

  // Git State Init
  gitBranch: null,
  gitRoots: [],
  gitRepoBranches: {},
  gitFileStatuses: {},
  gitDirtyFolders: {},

  fileExplorerRefreshKey: 0,
  refreshFileExplorer: () => set((state) => ({ fileExplorerRefreshKey: (state.fileExplorerRefreshKey || 0) + 1 })),

  setCurrentProject: (project) => {
    set({
      currentProject: project,
      openTabs: [],
      activeTabPath: null,
      expandedFolders: project ? { [project.path]: true } : {},
      selectedFilePaths: [],
      lastSelectedFilePath: null,
      gitBranch: null,
      gitRoots: [],
      gitRepoBranches: {},
      gitFileStatuses: {},
      gitDirtyFolders: {},
    });
    if (project) {
      setTimeout(() => {
        get().refreshGitStatus();
      }, 50);
    }
  },

  toggleFolder: (path) => set((state) => ({
    expandedFolders: {
      ...state.expandedFolders,
      [path]: !state.expandedFolders[path],
    },
  })),

  openFile: async (path, name) => {
    const { openTabs } = get();
    const existingTab = openTabs.find((t) => t.path === path);
    
    if (existingTab) {
      set({ activeTabPath: path });
      return;
    }

    try {
      // 1. Get file size
      let size = 0;
      try {
        const stat = await window.electronAPI.localStat(path);
        size = stat.size || 0;
      } catch (err) {
        console.error('Failed to get file stat:', err);
      }

      const ext = name.split('.').pop()?.toLowerCase();
      const isOffice = ['docx', 'doc', 'xlsx', 'xls'].includes(ext || '');

      let content = '';
      let unsupported = true;

      if (isOffice) {
        // Bypass reading file content into memory for Word and Excel files
        unsupported = true;
        content = '';
      } else {
        const res = await window.electronAPI.readFileBase64(path);
        const isPdf = ext === 'pdf';
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '');
        const isSupported = res.type === 'text' || isPdf || isImage;
        unsupported = !isSupported;

        if (res.data) {
          if (res.type === 'text') {
            content = res.data;
          } else if (isPdf || isImage) {
            content = res.data; // Keep base64 data for PDF and images
          }
        }
      }
      
      const newTab: OpenFileTab = {
        path,
        name,
        content,
        isDirty: false,
        size,
        unsupported,
      };

      set((state) => ({
        openTabs: [...state.openTabs, newTab],
        activeTabPath: path,
        gitBranch: getBranchForPath(path, state.gitRoots, state.gitRepoBranches)
      }));
    } catch (err: any) {
      console.error('Failed to open file:', err);
      alert('无法打开文件: ' + err.message);
    }
  },

  closeFile: (path) => {
    const { openTabs, activeTabPath } = get();
    const newTabs = openTabs.filter((t) => t.path !== path);
    let newActivePath = activeTabPath;

    if (activeTabPath === path) {
      newActivePath = newTabs.length > 0 ? newTabs[newTabs.length - 1].path : null;
    }

    set((state) => ({
      openTabs: newTabs,
      activeTabPath: newActivePath,
      gitBranch: getBranchForPath(newActivePath, state.gitRoots, state.gitRepoBranches)
    }));
  },

  updateTabContent: (path, content) => set((state) => {
    const newTabs = state.openTabs.map((t) => {
      if (t.path === path) {
        return { ...t, content, isDirty: true };
      }
      return t;
    });
    return { openTabs: newTabs };
  }),

  saveFile: async (path) => {
    const { openTabs } = get();
    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;

    try {
      await window.electronAPI.localWriteFile(path, tab.content);
      set((state) => ({
        openTabs: state.openTabs.map((t) => (t.path === path ? { ...t, isDirty: false } : t)),
      }));
      // Refresh git status after saving
      await get().refreshGitStatus();
    } catch (err: any) {
      console.error('Failed to save file:', err);
      alert('保存文件失败: ' + err.message);
    }
  },

  setActiveTab: (path) => {
    set((state) => ({
      activeTabPath: path,
      gitBranch: getBranchForPath(path, state.gitRoots, state.gitRepoBranches)
    }));
  },

  closeAllTabs: () => set({ openTabs: [], activeTabPath: null }),
  openTerminal: (path, name) => {
    const { openTabs } = get();
    const tabId = `terminal-${path}-${Date.now()}`;
    const newTab: OpenFileTab = {
      path: tabId,
      name: `Terminal: ${name}`,
      content: path,
      isDirty: false,
      isTerminal: true
    };
    set((state) => ({
      openTabs: [...state.openTabs, newTab],
      activeTabPath: tabId,
      gitBranch: getBranchForPath(tabId, state.gitRoots, state.gitRepoBranches)
    }));
  },

  openDiff: (path, name, originalContent, modifiedContent, originalLabel, modifiedLabel) => {
    const { openTabs } = get();
    const tabId = `diff-${path}-${originalLabel}-${modifiedLabel}`.replace(/\\/g, '/');
    const existingTab = openTabs.find((t) => t.path === tabId);
    
    if (existingTab) {
      set({ activeTabPath: tabId });
      return;
    }

    const newTab: OpenFileTab = {
      path: tabId,
      name: `Diff: ${name}`,
      content: '',
      isDirty: false,
      isDiff: true,
      diffInfo: {
        originalContent,
        modifiedContent,
        originalLabel,
        modifiedLabel
      }
    };

    set((state) => ({
      openTabs: [...state.openTabs, newTab],
      activeTabPath: tabId,
      gitBranch: getBranchForPath(path, state.gitRoots, state.gitRepoBranches)
    }));
  },

  openGitGraph: () => {
    const { openTabs } = get();
    const tabId = 'git-graph';
    const existingTab = openTabs.find((t) => t.path === tabId);
    
    if (existingTab) {
      set({ activeTabPath: tabId });
      return;
    }

    const newTab: OpenFileTab = {
      path: tabId,
      name: 'Git Graph',
      content: '',
      isDirty: false,
      isGitGraph: true
    };

    set((state) => ({
      openTabs: [...state.openTabs, newTab],
      activeTabPath: tabId
    }));
  },

  openMarkdownPreview: (sourcePath, name) => {
    const { openTabs } = get();
    const previewPath = `preview://${sourcePath}`;
    const existingTab = openTabs.find((t) => t.path === previewPath);

    if (existingTab) {
      set({ activeTabPath: previewPath });
      return;
    }

    const sourceTab = openTabs.find((t) => t.path === sourcePath);
    const content = sourceTab ? sourceTab.content : '';

    const newTab: OpenFileTab = {
      path: previewPath,
      name: `Preview: ${name}`,
      content,
      isDirty: false,
      isMarkdownPreview: true,
      previewSourcePath: sourcePath
    };

    set((state) => ({
      openTabs: [...state.openTabs, newTab],
      activeTabPath: previewPath
    }));
  },

  closeOthers: (path) => {
    const { openTabs } = get();
    const target = openTabs.find((t) => t.path === path);
    if (!target) return;
    set((state) => ({
      openTabs: [target],
      activeTabPath: path,
      gitBranch: getBranchForPath(path, state.gitRoots, state.gitRepoBranches)
    }));
  },

  closeLeft: (path) => {
    const { openTabs, activeTabPath } = get();
    const idx = openTabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const newTabs = openTabs.slice(idx);
    let newActive = activeTabPath;
    if (activeTabPath && !newTabs.some((t) => t.path === activeTabPath)) {
      newActive = path;
    }
    set((state) => ({
      openTabs: newTabs,
      activeTabPath: newActive,
      gitBranch: getBranchForPath(newActive, state.gitRoots, state.gitRepoBranches)
    }));
  },

  closeRight: (path) => {
    const { openTabs, activeTabPath } = get();
    const idx = openTabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const newTabs = openTabs.slice(0, idx + 1);
    let newActive = activeTabPath;
    if (activeTabPath && !newTabs.some((t) => t.path === activeTabPath)) {
      newActive = path;
    }
    set((state) => ({
      openTabs: newTabs,
      activeTabPath: newActive,
      gitBranch: getBranchForPath(newActive, state.gitRoots, state.gitRepoBranches)
    }));
  },

  refreshGitStatus: async () => {
    const { currentProject, activeTabPath } = get();
    if (!currentProject) return;
    const projectPath = currentProject.codePath || currentProject.path;

    try {
      const roots = await window.electronAPI.gitDiscoverRoots(projectPath);
      if (roots.length === 0) {
        set({
          gitBranch: null,
          gitRoots: [],
          gitRepoBranches: {},
          gitFileStatuses: {},
          gitDirtyFolders: {}
        });
        return;
      }

      const mergedStatuses: Record<string, string> = {};
      const repoBranches: Record<string, string> = {};
      const dirtyFolders: Record<string, { modified: boolean; added: boolean; untracked: boolean; notAdded: boolean }> = {};

      const isWindows = projectPath.includes('\\') || (!projectPath.startsWith('/') && projectPath.includes(':'));
      const sep = isWindows ? '\\' : '/';

      for (const rootPath of roots) {
        try {
          const branch = await window.electronAPI.gitCurrentBranch(rootPath);
          repoBranches[rootPath] = branch || 'HEAD';

          const statuses = await window.electronAPI.gitStatus(rootPath);
          for (const [relPath, status] of Object.entries(statuses)) {
            // Build absolute path
            const normalizedRel = relPath.replace(/\\/g, sep).replace(/\//g, sep);
            const absFilePath = rootPath + (rootPath.endsWith(sep) ? '' : sep) + normalizedRel;
            mergedStatuses[absFilePath] = status;

            // Trace parent folders all the way up to workspace root path
            let parent = absFilePath.substring(0, absFilePath.lastIndexOf(sep));
            while (parent && parent.startsWith(projectPath) && parent.length >= projectPath.length) {
              if (!dirtyFolders[parent]) {
                dirtyFolders[parent] = { modified: false, added: false, untracked: false, notAdded: false };
              }
              const X = status[0] || ' ';
              const Y = status[1] || ' ';
              const isNotAdded = Y === 'M' || Y === 'D';
              const isModified = X === 'M';
              const isAdded = X === 'A' || X === 'R';
              const isUntracked = status === '??';

              if (isNotAdded) dirtyFolders[parent].notAdded = true;
              if (isModified) dirtyFolders[parent].modified = true;
              if (isAdded) dirtyFolders[parent].added = true;
              if (isUntracked) dirtyFolders[parent].untracked = true;

              parent = parent.substring(0, parent.lastIndexOf(sep));
            }
          }
        } catch (subErr) {
          console.error(`Failed to refresh git status for sub-repo ${rootPath}:`, subErr);
        }
      }

      // Resolve active branch based on active tab path focus
      let activeBranch = repoBranches[roots[0]] || null;
      if (activeTabPath) {
        const sortedRoots = [...roots].sort((a, b) => b.length - a.length);
        const matched = sortedRoots.find(r => activeTabPath.startsWith(r));
        if (matched) {
          activeBranch = repoBranches[matched];
        }
      }

      set({
        gitBranch: activeBranch || 'HEAD',
        gitRoots: roots,
        gitRepoBranches: repoBranches,
        gitFileStatuses: mergedStatuses,
        gitDirtyFolders: dirtyFolders
      });
    } catch (err) {
      set({
        gitBranch: null,
        gitRoots: [],
        gitRepoBranches: {},
        gitFileStatuses: {},
        gitDirtyFolders: {}
      });
    }
  },

  runGitCheckout: async (branch: string) => {
    const { currentProject, activeTabPath, gitRoots, refreshGitStatus } = get();
    if (!currentProject) return;
    let targetRoot = currentProject.codePath || currentProject.path;
    if (activeTabPath && gitRoots.length > 0) {
      const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
      const matched = sorted.find(r => activeTabPath.startsWith(r));
      if (matched) targetRoot = matched;
    }
    await window.electronAPI.gitCheckout(targetRoot, branch);
    await refreshGitStatus();
  },

  runGitAdd: async (filePath: string) => {
    const { currentProject, gitRoots, refreshGitStatus } = get();
    if (!currentProject) return;
    let targetRoot = currentProject.codePath || currentProject.path;
    if (gitRoots.length > 0) {
      const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
      const matched = sorted.find(r => filePath.startsWith(r));
      if (matched) targetRoot = matched;
    }
    const relPath = filePath.substring(targetRoot.length).replace(/^[\\\/]/, '').replace(/\\/g, '/');
    await window.electronAPI.gitAdd(targetRoot, relPath);
    await refreshGitStatus();
  },

  runGitRestore: async (filePath: string) => {
    const { currentProject, gitRoots, refreshGitStatus } = get();
    if (!currentProject) return;
    let targetRoot = currentProject.codePath || currentProject.path;
    if (gitRoots.length > 0) {
      const sorted = [...gitRoots].sort((a, b) => b.length - a.length);
      const matched = sorted.find(r => filePath.startsWith(r));
      if (matched) targetRoot = matched;
    }
    const relPath = filePath.substring(targetRoot.length).replace(/^[\\\/]/, '').replace(/\\/g, '/');
    await window.electronAPI.gitRestore(targetRoot, relPath);
    await refreshGitStatus();
  },

  runGitInit: async () => {
    const { currentProject, refreshGitStatus } = get();
    if (!currentProject) return;
    const projectPath = currentProject.codePath || currentProject.path;
    await window.electronAPI.gitInit(projectPath);
    await refreshGitStatus();
  },
}));
