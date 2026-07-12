import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { AppState, Project, OnlineSystem, Account, SSHInfo, SessionState, ProjectTrack, GlobalTodo, AISettings, AIModelConfig, TransferJob } from '../types';

type Action =
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'UPDATE_PROJECT'; payload: Project }
  | { type: 'DELETE_PROJECT'; payload: string }
  | { type: 'SET_SYSTEMS'; payload: OnlineSystem[] }
  | { type: 'ADD_SYSTEM'; payload: OnlineSystem }
  | { type: 'UPDATE_SYSTEM'; payload: OnlineSystem }
  | { type: 'DELETE_SYSTEM'; payload: string }
  | { type: 'SET_ACCOUNTS'; payload: Account[] }
  | { type: 'ADD_ACCOUNT'; payload: Account }
  | { type: 'UPDATE_ACCOUNT'; payload: Account }
  | { type: 'DELETE_ACCOUNT'; payload: string }
  | { type: 'SET_SSH_INFO'; payload: SSHInfo[] }
  | { type: 'ADD_SSH_INFO'; payload: SSHInfo }
  | { type: 'UPDATE_SSH_INFO'; payload: SSHInfo }
  | { type: 'DELETE_SSH_INFO'; payload: string }
  | { type: 'SET_SSH_SESSIONS'; payload: SessionState[] }
  | { type: 'ADD_SSH_SESSION'; payload: SessionState }
  | { type: 'UPDATE_SSH_SESSION'; payload: SessionState }
  | { type: 'DELETE_SSH_SESSION'; payload: string }
  | { type: 'SET_ACTIVE_SESSION_KEY'; payload: string | null }
  | { type: 'SET_TRACKS'; payload: ProjectTrack[] }
  | { type: 'ADD_TRACK'; payload: ProjectTrack }
  | { type: 'UPDATE_TRACK'; payload: ProjectTrack }
  | { type: 'DELETE_TRACK'; payload: string }
  | { type: 'SET_GLOBAL_TODOS'; payload: GlobalTodo[] }
  | { type: 'ADD_GLOBAL_TODO'; payload: GlobalTodo }
  | { type: 'UPDATE_GLOBAL_TODO'; payload: GlobalTodo }
  | { type: 'DELETE_GLOBAL_TODO'; payload: string }
  | { type: 'SET_AI_SETTINGS'; payload: AISettings }
  | { type: 'UPDATE_AI_SETTINGS'; payload: Partial<AISettings> }
  // Transfer job actions (keyed by sshId)
  | { type: 'ADD_TRANSFER_JOB'; payload: { sshId: string; job: TransferJob } }
  | { type: 'UPDATE_TRANSFER_JOB'; payload: { sshId: string; jobId: string; progress: number; currentFile?: string; speed?: number } }
  | { type: 'FINISH_TRANSFER_JOB'; payload: { sshId: string; jobId: string; error?: string } }
  | { type: 'REMOVE_TRANSFER_JOB'; payload: { sshId: string; jobId: string } }
  | { type: 'ABORT_SESSION_TRANSFER_JOBS'; payload: { sshId: string } }
  // Sidebar layout
  | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean };

const initialState: AppState = {
  projects: [],
  systems: [],
  accounts: [],
  sshInfo: [],
  tracks: [],
  globalTodos: [],
  searchResults: [],
  sshSessions: [],
  activeSessionKey: null,
  aiSettings: {
    models: [],
    activeModelId: null,
  },
  transferJobs: {},
  sidebarCollapsed: true,
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };
    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.payload] };
    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.payload.id ? action.payload : p
        ),
      };
    case 'DELETE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.payload),
      };
    case 'SET_SYSTEMS':
      return { ...state, systems: action.payload };
    case 'ADD_SYSTEM':
      return { ...state, systems: [...state.systems, action.payload] };
    case 'UPDATE_SYSTEM':
      return {
        ...state,
        systems: state.systems.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case 'DELETE_SYSTEM':
      return {
        ...state,
        systems: state.systems.filter((s) => s.id !== action.payload),
      };
    case 'SET_ACCOUNTS':
      return { ...state, accounts: action.payload };
    case 'ADD_ACCOUNT':
      return { ...state, accounts: [...state.accounts, action.payload] };
    case 'UPDATE_ACCOUNT':
      return {
        ...state,
        accounts: state.accounts.map((a) =>
          a.id === action.payload.id ? action.payload : a
        ),
      };
    case 'DELETE_ACCOUNT':
      return {
        ...state,
        accounts: state.accounts.filter((a) => a.id !== action.payload),
      };
    case 'SET_SSH_INFO':
      return { ...state, sshInfo: action.payload };
    case 'ADD_SSH_INFO':
      return { ...state, sshInfo: [...state.sshInfo, action.payload] };
    case 'UPDATE_SSH_INFO':
      return {
        ...state,
        sshInfo: state.sshInfo.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case 'DELETE_SSH_INFO':
      return {
        ...state,
        sshInfo: state.sshInfo.filter((s) => s.id !== action.payload),
      };
    case 'SET_SSH_SESSIONS':
      return { ...state, sshSessions: action.payload };
    case 'ADD_SSH_SESSION':
      return { ...state, sshSessions: [...state.sshSessions, action.payload] };
    case 'UPDATE_SSH_SESSION':
      return {
        ...state,
        sshSessions: state.sshSessions.map((s) =>
          s.key === action.payload.key ? action.payload : s
        ),
      };
    case 'DELETE_SSH_SESSION':
      return {
        ...state,
        sshSessions: state.sshSessions.filter((s) => s.key !== action.payload),
      };
    case 'SET_ACTIVE_SESSION_KEY':
      return { ...state, activeSessionKey: action.payload };
    case 'SET_TRACKS':
      return { ...state, tracks: action.payload };
    case 'ADD_TRACK':
      return { ...state, tracks: [...state.tracks, action.payload] };
    case 'UPDATE_TRACK':
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.id ? action.payload : t
        ),
      };
    case 'DELETE_TRACK':
      return {
        ...state,
        tracks: state.tracks.filter((t) => t.id !== action.payload),
      };
    case 'SET_GLOBAL_TODOS':
      return { ...state, globalTodos: action.payload };
    case 'ADD_GLOBAL_TODO':
      return { ...state, globalTodos: [...state.globalTodos, action.payload] };
    case 'UPDATE_GLOBAL_TODO':
      return {
        ...state,
        globalTodos: state.globalTodos.map((t) =>
          t.id === action.payload.id ? action.payload : t
        ),
      };
    case 'DELETE_GLOBAL_TODO':
      return {
        ...state,
        globalTodos: state.globalTodos.filter((t) => t.id !== action.payload),
      };
    case 'SET_AI_SETTINGS':
      return { ...state, aiSettings: action.payload };
    case 'UPDATE_AI_SETTINGS':
      return { ...state, aiSettings: { ...state.aiSettings, ...action.payload } };

    // ── Transfer job cases ──────────────────────────────────────
    case 'ADD_TRANSFER_JOB': {
      const { sshId, job } = action.payload;
      const existing = state.transferJobs[sshId] || [];
      // Keep at most the last 20 jobs per session to avoid unbounded growth
      const trimmed = existing.length >= 20 ? existing.slice(-19) : existing;
      return {
        ...state,
        transferJobs: { ...state.transferJobs, [sshId]: [...trimmed, job] },
      };
    }
    case 'UPDATE_TRANSFER_JOB': {
      const { sshId, jobId, progress, currentFile, speed } = action.payload;
      const jobs = state.transferJobs[sshId] || [];
      return {
        ...state,
        transferJobs: {
          ...state.transferJobs,
          [sshId]: jobs.map(j =>
            j.id === jobId
              ? { ...j, progress, currentFile: currentFile ?? j.currentFile, speed: speed ?? j.speed }
              : j
          ),
        },
      };
    }
    case 'FINISH_TRANSFER_JOB': {
      const { sshId, jobId, error } = action.payload;
      const jobs = state.transferJobs[sshId] || [];
      return {
        ...state,
        transferJobs: {
          ...state.transferJobs,
          [sshId]: jobs.map(j =>
            j.id === jobId ? { ...j, done: true, error } : j
          ),
        },
      };
    }
    case 'REMOVE_TRANSFER_JOB': {
      const { sshId, jobId } = action.payload;
      const jobs = state.transferJobs[sshId] || [];
      return {
        ...state,
        transferJobs: {
          ...state.transferJobs,
          [sshId]: jobs.filter(j => j.id !== jobId),
        },
      };
    }
    case 'ABORT_SESSION_TRANSFER_JOBS': {
      const { sshId } = action.payload;
      const jobs = state.transferJobs[sshId] || [];
      return {
        ...state,
        transferJobs: {
          ...state.transferJobs,
          [sshId]: jobs.map(j =>
            j.done ? j : { ...j, done: true, error: '连接断开，传输中止' }
          ),
        },
      };
    }

    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, sidebarCollapsed: action.payload };

    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useEffect(() => {
    // 加载初始数据
    loadData();
  }, []);

  const loadData = async () => {
    const safeLoad = async (name: string, promise: Promise<any>, defaultValue: any) => {
      try {
        const res = await promise;
        // Log successful load details to backend terminal
        const countStr = Array.isArray(res) ? `count=${res.length}` : 'non-array';
        await window.electronAPI.printFrontendLog?.(`safeLoad ${name} loaded: ${countStr}`);
        return res;
      } catch (err: any) {
        // Log load error to backend terminal
        await window.electronAPI.printFrontendLog?.(`safeLoad ${name} failed: ${err?.message || String(err)}`);
        return defaultValue;
      }
    };

    try {
      // @ts-ignore
      const [projects, systems, accounts, sshInfo, tracks, globalTodos, aiSettings] = await Promise.all([
        safeLoad('projects', window.electronAPI.getProjects(), []),
        safeLoad('systems', window.electronAPI.getSystems(), []),
        safeLoad('accounts', window.electronAPI.getAccounts(), []),
        safeLoad('sshInfo', window.electronAPI.getSSHInfo(), []),
        safeLoad('tracks', window.electronAPI.getTracks(), []),
        safeLoad('globalTodos', window.electronAPI.getGlobalTodos(), []),
        safeLoad('aiSettings', window.electronAPI.getAISettings(), { models: [], activeModelId: null }),
      ]);
      
      dispatch({ type: 'SET_PROJECTS', payload: projects || [] });
      dispatch({ type: 'SET_SYSTEMS', payload: systems || [] });
      dispatch({ type: 'SET_ACCOUNTS', payload: accounts || [] });
      dispatch({ type: 'SET_SSH_INFO', payload: sshInfo || [] });
      dispatch({ type: 'SET_TRACKS', payload: tracks || [] });
      dispatch({ type: 'SET_GLOBAL_TODOS', payload: globalTodos || [] });
      dispatch({ type: 'SET_AI_SETTINGS', payload: aiSettings || { models: [], activeModelId: null } });
    } catch (error) {
      console.error('Failed to load data in Promise.all:', error);
    }
  };

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
