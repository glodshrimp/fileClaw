import React, { useState, useEffect } from 'react';
import {
  Download, Upload, Database, RefreshCw, Info, Palette, Sun, Moon, Bot,
  Cpu, Globe, Server, Plus, Edit2, Trash2, Check, X, Key, Eye, EyeOff, Sparkles,
  Copy, AlertTriangle, GitBranch
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { AIProvider, AIModelConfig } from '../types';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { copyToClipboard } from '../utils/copy';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider 元信息
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PROVIDERS: {
  key: AIProvider;
  icon: React.FC<{ className?: string }>;
  name: string;
  desc: string;
  color: string;
  shadow: string;
  modelPlaceholder: string;
  apiKeyPlaceholder: string;
  keyHint?: string;
  modelHint?: string;
  showBaseURL?: boolean;
}[] = [
  {
    key: 'openrouter',
    icon: Globe,
    name: 'OpenRouter',
    desc: '聚合多家顶级模型',
    color: 'from-violet-500 to-purple-600',
    shadow: 'shadow-purple-500/20',
    modelPlaceholder: 'google/gemini-2.0-flash-001',
    apiKeyPlaceholder: 'sk-or-v1-...',
    keyHint: 'openrouter.ai/keys',
    modelHint: 'openrouter.ai/models',
  },
  {
    key: 'nvidia',
    icon: Cpu,
    name: 'NVIDIA NIM',
    desc: '高性能推理加速',
    color: 'from-green-500 to-emerald-600',
    shadow: 'shadow-green-500/20',
    modelPlaceholder: 'z-ai/glm4.7',
    apiKeyPlaceholder: 'nvapi-...',
    keyHint: 'build.nvidia.com',
    modelHint: 'build.nvidia.com/explore/discover',
  },
  {
    key: 'custom',
    icon: Server,
    name: '自定义',
    desc: '任意 OpenAI 兼容接口',
    color: 'from-sky-500 to-blue-600',
    shadow: 'shadow-blue-500/20',
    modelPlaceholder: 'your-model-name',
    apiKeyPlaceholder: 'your-api-key',
    showBaseURL: true,
  },
  {
    key: 'gemini',
    icon: Sparkles,
    name: 'Gemini',
    desc: 'Google 原生模型',
    color: 'from-blue-500 to-indigo-600',
    shadow: 'shadow-blue-500/20',
    modelPlaceholder: 'gemini-3.1-pro',
    apiKeyPlaceholder: 'AIzaSy...',
    keyHint: 'aistudio.google.com/app/apikey',
    modelHint: 'ai.google.dev/models',
  },
];

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map(p => [p.key, p]));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 模型编辑弹窗
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface ModelFormData {
  displayName: string;
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseURL: string;
}

const EMPTY_FORM: ModelFormData = {
  displayName: '',
  provider: 'openrouter',
  apiKey: '',
  model: '',
  baseURL: '',
};

interface ModelModalProps {
  editing: AIModelConfig | null;
  defaultProvider?: AIProvider;
  onSave: (data: ModelFormData) => void;
  onClose: () => void;
}

const ModelModal: React.FC<ModelModalProps> = ({ editing, defaultProvider, onSave, onClose }) => {
  const [form, setForm] = useState<ModelFormData>(() => {
    if (editing) {
      return {
        displayName: editing.displayName,
        provider: editing.provider,
        apiKey: editing.apiKey,
        model: editing.model,
        baseURL: editing.baseURL || '',
      };
    }
    return { ...EMPTY_FORM, provider: defaultProvider || 'openrouter' };
  });
  const [showKey, setShowKey] = useState(false);

  const pInfo = PROVIDER_MAP[form.provider];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-background-secondary border border-border rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-border/50 flex items-center justify-between flex-shrink-0">
          <h3 className="text-lg font-bold text-text-primary">{editing ? '编辑模型配置' : '添加模型配置'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-background-tertiary text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto scrollbar-thin space-y-4 flex-1">
          {/* 提供商选择 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">服务商</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PROVIDERS.map(({ key, icon: Icon, name, color, shadow }) => (
                <button
                  key={key}
                  onClick={() => setForm(f => ({ ...f, provider: key }))}
                  className={`flex flex-col items-center p-3 rounded-xl border-2 transition-all text-sm ${
                    form.provider === key
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border bg-background hover:border-primary/30'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mb-1.5 shadow-sm ${shadow}`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-semibold text-text-primary text-xs">{name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 显示名称 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">显示名称</label>
            <input
              type="text"
              value={form.displayName}
              onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              placeholder={`例如: ${pInfo.name} GLM4 Pro`}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* 自定义 BaseURL */}
          {(form.provider === 'custom' || pInfo.showBaseURL) && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Base URL</label>
              <input
                type="text"
                value={form.baseURL}
                onChange={e => setForm(f => ({ ...f, baseURL: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-text-tertiary mt-1">填写 v1 级别路径，无需追加 /chat/completions</p>
            </div>
          )}

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                placeholder={pInfo.apiKeyPlaceholder}
                className="w-full px-4 py-2 pr-10 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowKey(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {pInfo.keyHint && (
              <p className="text-xs text-text-tertiary mt-1">
                从 <a href={`https://${pInfo.keyHint}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{pInfo.keyHint}</a> 获取
              </p>
            )}
          </div>

          {/* 模型名称 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">模型名称</label>
            <input
              type="text"
              value={form.model}
              onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              placeholder={pInfo.modelPlaceholder}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {pInfo.modelHint && (
              <p className="text-xs text-text-tertiary mt-1">
                参见 <a href={`https://${pInfo.modelHint}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{pInfo.modelHint}</a>
              </p>
            )}
          </div>
        </div>

        <div className="px-6 py-5 border-t border-border/50 flex justify-end gap-3 flex-shrink-0 bg-background-secondary rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary px-5 py-2">取消</button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.apiKey || !form.model}
            className="btn-nexus-blue flex items-center gap-2 px-5 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主 SettingsPage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SettingsPage: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<'preference' | 'ai' | 'git' | 'data' | 'about'>('preference');

  const [termFontSize, setTermFontSize] = useState(() => parseInt(localStorage.getItem('termFontSize') || '14', 10));
  const [termFontFamily, setTermFontFamily] = useState(() => localStorage.getItem('termFontFamily') || 'Consolas, "Fira Code", monospace');
  const [editorFontSize, setEditorFontSize] = useState(() => parseInt(localStorage.getItem('editorFontSize') || '14', 10));
  const [editorFontFamily, setEditorFontFamily] = useState(() => localStorage.getItem('editorFontFamily') || 'Monaco, "Fira Code", monospace');

  useEffect(() => {
    localStorage.setItem('termFontSize', termFontSize.toString());
  }, [termFontSize]);

  useEffect(() => {
    localStorage.setItem('termFontFamily', termFontFamily);
  }, [termFontFamily]);

  useEffect(() => {
    localStorage.setItem('editorFontSize', editorFontSize.toString());
  }, [editorFontSize]);

  useEffect(() => {
    localStorage.setItem('editorFontFamily', editorFontFamily);
  }, [editorFontFamily]);
  
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [dbPath, setDbPath] = useState('');
  const [proxy, setProxy] = useState(state.aiSettings.proxy || '');
  const [isSavingProxy, setIsSavingProxy] = useState(false);
  const [copying, setCopying] = useState(false);

  // Git 设置状态
  const [gitPath, setGitPathState] = useState('');
  const [gitVersion, setGitVersion] = useState<string | null>(null);
  const [gitTestStatus, setGitTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [gitTestError, setGitTestError] = useState<string | null>(null);
  const [isSavingGit, setIsSavingGit] = useState(false);

  // 模态框与防呆确认状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModelConfig | null>(null);
  const [defaultProviderForNew, setDefaultProviderForNew] = useState<AIProvider>('openrouter');
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importPendingData, setImportPendingData] = useState<any>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  useEffect(() => {
    // @ts-ignore
    window.electronAPI?.getDbPath().then((path: string) => setDbPath(path));
    // @ts-ignore
    window.electronAPI?.getGitSettings().then((settings: any) => {
      if (settings) {
        setGitPathState(settings.gitPath || '');
      }
    });
  }, []);

  const handleSaveGitPath = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGit(true);
    try {
      // @ts-ignore
      await window.electronAPI?.updateGitSettings({ gitPath });
      await handleTestGit(gitPath);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingGit(false);
    }
  };

  const handleTestGit = async (path: string) => {
    setGitTestStatus('testing');
    setGitTestError(null);
    try {
      // @ts-ignore
      const version = await window.electronAPI?.testGitPath(path);
      setGitVersion(version);
      setGitTestStatus('success');
    } catch (err: any) {
      setGitVersion(null);
      setGitTestStatus('error');
      setGitTestError(err.message || String(err));
    }
  };

  // ── 数据操作 ──────────────────────────────────────────
  const saveSettings = async (partial: Partial<typeof state.aiSettings>) => {
    const next = { ...state.aiSettings, ...partial };
    // @ts-ignore
    await window.electronAPI?.updateAISettings(next);
    dispatch({ type: 'UPDATE_AI_SETTINGS', payload: partial });
  };

  const handleSaveModel = async (formData: ModelFormData) => {
    const models = [...state.aiSettings.models];
    let nextActiveId = state.aiSettings.activeModelId;

    if (editingModel) {
      const idx = models.findIndex(m => m.id === editingModel.id);
      if (idx >= 0) {
        models[idx] = { ...editingModel, ...formData };
      }
    } else {
      const newModel: AIModelConfig = {
        id: Date.now().toString(),
        ...formData,
      };
      models.push(newModel);
      if (!nextActiveId) nextActiveId = newModel.id;
    }

    await saveSettings({ models, activeModelId: nextActiveId });
    setModalOpen(false);
    setEditingModel(null);
  };

  const handleDeleteClick = (id: string) => {
    setDeleteTargetId(id);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      const models = state.aiSettings.models.filter(m => m.id !== deleteTargetId);
      const nextActiveId = state.aiSettings.activeModelId === deleteTargetId
        ? (models[0]?.id || null)
        : state.aiSettings.activeModelId;
      await saveSettings({ models, activeModelId: nextActiveId });
    } catch (err) {
      console.error('Failed to delete model:', err);
    } finally {
      setIsDeleteModalOpen(false);
      setDeleteTargetId(null);
    }
  };

  const handleSetActive = async (id: string) => {
    await saveSettings({ activeModelId: id });
  };

  const handleSaveProxy = async () => {
    setIsSavingProxy(true);
    try {
      await saveSettings({ proxy });
    } finally {
      setIsSavingProxy(false);
    }
  };

  // ── 导入导出 ──────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    try {
      // @ts-ignore
      const data = await window.electronAPI?.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-management-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const triggerImportFile = async () => {
    try {
      // @ts-ignore
      const files = await window.electronAPI?.selectFiles();
      if (!files || files.length === 0) return;
      const file = files[0];
      
      // @ts-ignore
      const result = await window.electronAPI?.readFileBase64(file.path);
      let text = '';
      if (result.type === 'text') {
        text = result.data;
      } else {
        text = decodeURIComponent(escape(atob(result.data)));
      }
      
      // Strip potential BOM (Byte Order Mark) from text files before parsing
      const cleanText = text.replace(/^\uFEFF/, '').trim();
      const data = JSON.parse(cleanText);
      setImportPendingData(data);
      setShowImportConfirm(true);
    } catch (error: any) {
      console.error('Import parse failed:', error);
      alert('文件解析失败: ' + (error?.message || String(error)));
    }
  };

  const executeImport = async () => {
    if (!importPendingData) return;
    setIsImporting(true);
    setShowImportConfirm(false);
    try {
      // @ts-ignore
      await window.electronAPI?.importData(importPendingData);
      window.location.reload();
    } catch (error: any) {
      console.error('Import failed:', error);
      alert('导入失败: ' + (error?.message || String(error)));
    } finally {
      setIsImporting(false);
      setImportPendingData(null);
    }
  };

  const handleCopyPath = (e: React.MouseEvent) => {
    const fullPath = dbPath ? `${dbPath}\\data.json` : '';
    if (!fullPath) return;
    copyToClipboard(fullPath, e);
    setCopying(true);
    setTimeout(() => setCopying(false), 1500);
  };

  // ── 仪表盘数据 ────────────────────────────────────────
  const stats = [
    { label: '项目总数', value: state.projects.length, color: 'bg-primary' },
    { label: '系统总数', value: state.systems.length, color: 'bg-green-500' },
    { label: '账号总数', value: state.accounts.length, color: 'bg-amber-500' },
    { label: 'SSH 连接数', value: state.sshInfo.length, color: 'bg-red-500' },
  ];

  // 按 provider 分组
  const modelsByProvider = state.aiSettings.models.reduce<Partial<Record<AIProvider, AIModelConfig[]>>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider]!.push(m);
    return acc;
  }, {});

  const currentActiveModel = state.aiSettings.models.find(m => m.id === state.aiSettings.activeModelId);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-text-primary">设置中心</h2>
      </div>

      <div className="flex flex-col md:flex-row gap-6 bg-background-secondary/30 border border-border/60 rounded-2xl p-4 md:p-6 backdrop-blur-sm shadow-sm">
        {/* 左侧类目导航 */}
        <div className="w-full md:w-60 flex-shrink-0 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 border-b md:border-b-0 md:border-r border-border/50 pr-0 md:pr-4">
          <button
            onClick={() => setActiveTab('preference')}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap md:w-full ${
              activeTab === 'preference'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary/60'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>外观与偏好</span>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap md:w-full ${
              activeTab === 'ai'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary/60'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>AI 模型配置</span>
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap md:w-full ${
              activeTab === 'data'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary/60'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>数据与安全</span>
          </button>
          <button
            onClick={() => setActiveTab('git')}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap md:w-full ${
              activeTab === 'git'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary/60'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span>Git 版本控制</span>
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap md:w-full ${
              activeTab === 'about'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-tertiary/60'
            }`}
          >
            <Info className="w-4 h-4" />
            <span>关于系统</span>
          </button>
        </div>

        {/* 右侧工作区面板 */}
        <div className="flex-1 min-w-0">
          {/* 外观与偏好 */}
          {activeTab === 'preference' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-200">
              <div>
                <h3 className="text-lg font-bold text-text-primary">外观与偏好</h3>
                <p className="text-xs text-text-tertiary mt-1">管理系统视觉主题、菜单偏好及快速看板摘要</p>
              </div>

              <div className="bg-background-secondary border border-border/80 rounded-xl p-5 space-y-6">
                {/* 胶囊单选药丸式主题切换 */}
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">主题模式</h4>
                    <p className="text-xs text-text-tertiary mt-0.5">选择你偏好的系统界面风格</p>
                  </div>
                  <div className="flex bg-background border border-border rounded-xl p-1 relative w-56">
                    <div
                      className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-primary rounded-lg transition-all duration-300 ease-out shadow-sm ${
                        theme === 'dark' ? 'left-[calc(50%+2px)]' : 'left-[2px]'
                      }`}
                    />
                    <button
                      onClick={() => setTheme('light')}
                      className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 z-10 transition-colors ${
                        theme === 'light' ? 'text-white' : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <Sun className="w-4 h-4" />
                      <span>浅色</span>
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 z-10 transition-colors ${
                        theme === 'dark' ? 'text-white' : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <Moon className="w-4 h-4" />
                      <span>深色</span>
                    </button>
                  </div>
                </div>

                <div className="h-px bg-border/50" />

                {/* 侧边栏折叠 Toggle Switch */}
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">侧边栏展开</h4>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {state.sidebarCollapsed ? '当前状态：已收起（仅显示图标）' : '当前状态：已展开（显示文本菜单）'}
                    </p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={!state.sidebarCollapsed}
                    onClick={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: !state.sidebarCollapsed })}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary ${
                      !state.sidebarCollapsed ? 'bg-primary' : 'bg-background'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        !state.sidebarCollapsed ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 开发字体与偏好 (Taurax/Terax style) */}
              <div className="bg-background-secondary border border-border/80 rounded-xl p-5 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-text-primary">开发字体与排版偏好</h4>
                  <p className="text-xs text-text-tertiary mt-0.5">控制代码编辑器与终端的字体尺寸、类型及布局</p>
                </div>

                <div className="h-px bg-border/50" />

                {/* 编辑器字体设置 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">代码编辑器字体大小 (Editor Font Size)</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="12"
                        max="28"
                        value={editorFontSize}
                        onChange={(e) => setEditorFontSize(parseInt(e.target.value, 10))}
                        className="flex-1 accent-primary"
                      />
                      <span className="text-xs font-mono text-text-primary w-8 text-right">{editorFontSize}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">代码编辑器字体家族 (Editor Font Family)</label>
                    <input
                      type="text"
                      value={editorFontFamily}
                      onChange={(e) => setEditorFontFamily(e.target.value)}
                      placeholder='Monaco, "Fira Code", monospace'
                      className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="h-px bg-border/50" />

                {/* 终端字体设置 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">终端字体大小 (Terminal Font Size)</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="10"
                        max="24"
                        value={termFontSize}
                        onChange={(e) => setTermFontSize(parseInt(e.target.value, 10))}
                        className="flex-1 accent-primary"
                      />
                      <span className="text-xs font-mono text-text-primary w-8 text-right">{termFontSize}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">终端字体家族 (Terminal Font Family)</label>
                    <input
                      type="text"
                      value={termFontFamily}
                      onChange={(e) => setTermFontFamily(e.target.value)}
                      placeholder='Consolas, "Fira Code", monospace'
                      className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              {/* 指标面板整合 */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-secondary">系统看板简报</h4>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {stats.map((stat) => (
                    <div key={stat.label} className="bg-background-secondary border border-border/80 rounded-xl p-5 shadow-sm">
                      <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{stat.label}</p>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-bold text-text-primary">{stat.value}</span>
                        <span className="text-xs text-text-tertiary">个项目记录</span>
                      </div>
                      <div className="w-full h-1 bg-background-tertiary rounded-full mt-3 overflow-hidden">
                        <div className={`h-full ${stat.color}`} style={{ width: '100%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI模型配置 */}
          {activeTab === 'ai' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-text-primary">AI 模型引擎</h3>
                  <p className="text-xs text-text-tertiary mt-1">配置调用 AI 的凭证及接口代理，管理当前的激活模型</p>
                </div>
                <button
                  onClick={() => { setEditingModel(null); setModalOpen(true); }}
                  className="btn-nexus-blue flex items-center gap-1.5 py-1.5 px-4 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加模型
                </button>
              </div>

              {/* 全局代理设置 */}
              <div className="bg-background-secondary border border-border/80 rounded-xl p-5 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-text-primary">HTTP 代理</h4>
                  <p className="text-xs text-text-tertiary mt-0.5">国内环境若无法直连服务商可配置代理</p>
                </div>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={proxy}
                    onChange={e => setProxy(e.target.value)}
                    placeholder="例如: http://127.0.0.1:7890"
                    className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={handleSaveProxy}
                    disabled={isSavingProxy}
                    className="btn-nexus-blue flex items-center gap-1.5 px-4 py-2 text-xs"
                  >
                    {isSavingProxy ? '保存中...' : '保存代理'}
                  </button>
                </div>
              </div>

              {/* 当前激活模型指示 */}
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs text-text-tertiary font-medium">当前活跃模型</h4>
                    <p className="text-sm font-bold text-text-primary mt-0.5">
                      {currentActiveModel ? currentActiveModel.displayName || currentActiveModel.model : '未配置 / 暂无激活模型'}
                    </p>
                  </div>
                </div>
                {currentActiveModel && (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded-full">
                    Active
                  </span>
                )}
              </div>

              {/* 已配置的模型列表 */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-text-secondary">已配置服务商列表</h4>
                
                {state.aiSettings.models.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-border rounded-xl">
                    <Key className="w-10 h-10 mx-auto mb-2 text-text-tertiary/40" />
                    <p className="text-text-secondary text-sm font-medium">尚未配置任何模型</p>
                    <p className="text-xs text-text-tertiary mt-1">点击右上角「添加模型」配置你的第一个大语言模型</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {PROVIDERS.map(({ key, icon: Icon, name, color, shadow }) => {
                      const items = modelsByProvider[key];
                      if (!items || items.length === 0) return null;
                      return (
                        <div key={key} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${color} flex items-center justify-center shadow-sm ${shadow}`}>
                              <Icon className="w-3 text-white" />
                            </div>
                            <span className="font-bold text-text-primary text-xs">{name}</span>
                            <div className="flex-1 h-px bg-border/50 ml-2" />
                            <button
                              onClick={() => { setEditingModel(null); setDefaultProviderForNew(key); setModalOpen(true); }}
                              className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                            >
                              <Plus className="w-2.5 h-2.5" /> 快速添加
                            </button>
                          </div>

                          <div className="grid grid-cols-1 gap-2">
                            {items.map((cfg) => {
                              const isActive = cfg.id === state.aiSettings.activeModelId;
                              return (
                                <div
                                  key={cfg.id}
                                  className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                                    isActive
                                      ? 'border-primary/50 bg-primary/5 shadow-sm'
                                      : 'border-border bg-background/50 hover:border-border-hover'
                                  }`}
                                >
                                  <button
                                    onClick={() => handleSetActive(cfg.id)}
                                    title={isActive ? '当前激活' : '设为当前模型'}
                                    className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${
                                      isActive
                                        ? 'border-primary bg-primary'
                                        : 'border-border hover:border-primary/60'
                                    }`}
                                  >
                                    {isActive && <Check className="w-2.5 h-2.5 text-white" />}
                                  </button>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-text-primary text-xs truncate">{cfg.displayName || cfg.model}</span>
                                      {isActive && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 bg-primary/10 text-primary rounded-full border border-primary/20 flex-shrink-0">
                                          使用中
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px] font-mono text-text-tertiary truncate">{cfg.model}</span>
                                      {cfg.baseURL && (
                                        <span className="text-[10px] text-text-tertiary truncate max-w-[200px]" title={cfg.baseURL}>
                                          · {cfg.baseURL}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      onClick={() => { setEditingModel(cfg); setModalOpen(true); }}
                                      className="p-1.5 rounded-lg hover-gradient-primary text-text-secondary"
                                      title="编辑"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteClick(cfg.id)}
                                      className="p-1.5 rounded-lg hover-gradient-danger text-functional-error"
                                      title="删除"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 数据与安全 */}
          {activeTab === 'data' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-200">
              <div>
                <h3 className="text-lg font-bold text-text-primary">数据与安全</h3>
                <p className="text-xs text-text-tertiary mt-1">管理系统数据的存储路径及数据的安全备份与恢复操作</p>
              </div>

              {/* 存储路径卡片 */}
              <div className="bg-background-secondary border border-border/80 rounded-xl p-5 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">本地存储目录</h4>
                    <p className="text-xs text-text-tertiary mt-0.5">本应用的数据全部以加密或 JSON 存储于以下本地路径中</p>
                  </div>
                  {copying && (
                    <span className="text-[10px] font-bold text-green-500 bg-green-500/10 px-2 py-0.5 rounded-md border border-green-500/20 animate-fade-in-out">
                      已复制
                    </span>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex-1 font-mono text-xs bg-background p-2.5 rounded-lg border border-border break-all select-all">
                    {dbPath ? `${dbPath}\\data.json` : '正在读取路径...'}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={handleCopyPath}
                      title="复制全路径"
                      className="btn-secondary flex items-center justify-center p-2.5 rounded-lg hover:bg-background-tertiary"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { if (dbPath) { // @ts-ignore
                        window.electronAPI?.openDirectory(dbPath); } }}
                      className="btn-secondary flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg hover:bg-background-tertiary"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">打开目录</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 导入与导出 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-background-secondary border border-border/80 rounded-xl p-5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2">
                      <Download className="w-4 h-4" />
                    </div>
                    <h4 className="text-sm font-semibold text-text-primary">备份系统数据</h4>
                    <p className="text-xs text-text-tertiary">将当前所有项目、SSH、系统账户信息统一打包下载为单个配置文件。</p>
                  </div>
                  <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="btn-nexus-blue w-full py-2 text-xs flex items-center justify-center gap-1.5 mt-5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isExporting ? '打包导出中...' : '生成备份'}</span>
                  </button>
                </div>

                <div className="bg-background-secondary border border-border/80 rounded-xl p-5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 mb-2">
                      <Upload className="w-4 h-4" />
                    </div>
                    <h4 className="text-sm font-semibold text-text-primary">还原备份数据</h4>
                    <p className="text-xs text-text-tertiary">导入先前的 JSON 配置文件。还原操作将会覆盖本地当前的全部项目信息。</p>
                  </div>
                  <button
                    onClick={triggerImportFile}
                    disabled={isImporting}
                    className="btn-secondary w-full py-2 text-xs flex items-center justify-center gap-1.5 mt-5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isImporting ? '还原导入中...' : '选择并还原'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Git 版本控制 */}
          {activeTab === 'git' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-200">
              <div>
                <h3 className="text-lg font-bold text-text-primary">Git 版本控制</h3>
                <p className="text-xs text-text-tertiary mt-1">管理项目的版本控制依赖，支持自定义本地 Git 可执行文件路径</p>
              </div>

              <div className="bg-background-secondary border border-border/80 rounded-xl p-5 space-y-6">
                <form onSubmit={handleSaveGitPath} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-text-secondary block">
                      Git 可执行文件路径 (Custom Git Executable Path)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={gitPath}
                        onChange={(e) => setGitPathState(e.target.value)}
                        placeholder="默认为 'git'（使用系统环境变量）"
                        className="flex-1 px-3.5 py-2 bg-background border border-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                      />
                      <button
                        type="submit"
                        disabled={isSavingGit}
                        className="bg-primary hover:bg-primary-hover text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                      >
                        {isSavingGit ? '保存中...' : '保存并测试'}
                      </button>
                    </div>
                    <p className="text-[10px] text-text-tertiary leading-normal">
                      如果您的系统中没有配置 Git 的环境变量，或者需要使用特定路径的 Git 客户端（如 Portable 版），请在此填入 Git 可执行文件的完整路径（如 Windows 下的 <code className="bg-background px-1 py-0.5 rounded border border-border">C:\Program Files\Git\bin\git.exe</code>）。
                    </p>
                  </div>
                </form>

                {/* 测试结果 */}
                <div className="border-t border-border/50 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-secondary">Git 状态测试</span>
                    <button
                      type="button"
                      onClick={() => handleTestGit(gitPath)}
                      className="text-primary hover:text-primary-hover text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${gitTestStatus === 'testing' ? 'animate-spin' : ''}`} />
                      <span>立即测试</span>
                    </button>
                  </div>

                  {gitTestStatus === 'success' && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-3.5 py-3 rounded-xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <Check className="w-4 h-4 text-emerald-500" />
                        <span>测试成功！Git 可用</span>
                      </div>
                      {gitVersion && <span className="text-[10px] opacity-80">版本信息: {gitVersion}</span>}
                    </div>
                  )}

                  {gitTestStatus === 'error' && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3.5 py-3 rounded-xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        <span>未检测到有效的 Git</span>
                      </div>
                      {gitTestError && <span className="text-[10px] leading-relaxed opacity-80 whitespace-pre-wrap">{gitTestError}</span>}
                    </div>
                  )}

                  {gitTestStatus === 'idle' && (
                    <div className="bg-background-tertiary/20 border border-border/40 text-text-tertiary text-xs px-3.5 py-3 rounded-xl text-center">
                      点击“立即测试”或输入路径并保存来测试 Git 的连通性。
                    </div>
                  )}
                </div>

                {/* 引导指南 */}
                <div className="border-t border-border/50 pt-4 space-y-2">
                  <h4 className="text-xs font-semibold text-text-secondary">如何在您的系统中安装 Git？</h4>
                  <div className="text-[11px] text-text-tertiary space-y-2 leading-relaxed">
                    <p>
                      <strong>Windows:</strong><br />
                      访问官方网站 <a href="https://git-scm.com/download/win" target="_blank" rel="noreferrer" className="text-primary hover:underline">Git for Windows</a> 下载并安装。在安装向导中，请务必勾选 <em>"Git from the command line and also from 3rd-party software"</em> 选项，以便自动配置环境变量。
                    </p>
                    <p>
                      <strong>macOS:</strong><br />
                      打开终端（Terminal）并运行以下命令，系统会自动提示安装 Apple 开发工具（包含 Git）：<br />
                      <code className="block bg-background p-2 rounded border border-border text-[10px] font-mono mt-1 select-all">xcode-select --install</code>
                      或者，您可以通过 Homebrew 安装：<br />
                      <code className="block bg-background p-2 rounded border border-border text-[10px] font-mono mt-1 select-all">brew install git</code>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 关于系统 */}
          {activeTab === 'about' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-200">
              <div>
                <h3 className="text-lg font-bold text-text-primary">关于系统</h3>
                <p className="text-xs text-text-tertiary mt-1">项目管理中心系统配置、核心版本以及依赖架构说明</p>
              </div>

              <div className="bg-background-secondary border border-border/80 rounded-xl overflow-hidden shadow-sm">
                <div className="p-5 border-b border-border/50 bg-background/30 flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary font-bold text-xs shadow-inner">
                    FileClaw
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-text-primary">FileClaw项目管理小工具</h4>
                    <p className="text-[10px] text-text-tertiary">基于 Tauri 2 + Rust 架构的超轻量级项目与 SSH 终端管理器</p>
                  </div>
                </div>

                <div className="divide-y divide-border/40 text-xs">
                  {[
                    ['应用名称', 'FileClaw (项目管理工具)'],
                    ['版本号', '2.0.0 (Tauri 2 迁移版)'],
                    ['核心后端', 'Tauri v2.0 + Rust Engine'],
                    ['终端引擎', 'portable-pty + xterm.js (多路复用)'],
                    ['渲染框架', 'React v19.0 + TypeScript'],
                    ['本地数据', 'LowDB v7.0 + Rust IPC File Channel'],
                    ['界面样式', 'Tailwind CSS v4.0 + shadcn/ui'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between p-4 bg-background-secondary/10 hover:bg-background-tertiary/20 transition-colors">
                      <span className="text-text-secondary font-medium">{k}</span>
                      <span className="text-text-primary font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 模型编辑弹窗 */}
      {modalOpen && (
        <ModelModal
          editing={editingModel}
          defaultProvider={defaultProviderForNew}
          onSave={handleSaveModel}
          onClose={() => { setModalOpen(false); setEditingModel(null); }}
        />
      )}

      {/* 二次防呆确认模态框 */}
      {showImportConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4">
          <div className="bg-background-secondary border-2 border-red-500/20 rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-text-primary">确定导入此备份文件吗？</h3>
                <p className="text-xs text-text-tertiary leading-relaxed">
                  本操作将彻底覆盖你本地现有的全部项目信息、SSH 登录凭证与关联账户。数据一经覆盖，将无法找回。
                </p>
              </div>
            </div>
            <div className="px-6 py-4 bg-background border-t border-border flex justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => { setShowImportConfirm(false); setImportPendingData(null); }}
                className="btn-secondary px-4 py-1.5 text-xs"
              >
                取消
              </button>
              <button
                onClick={executeImport}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-1.5 rounded-lg text-xs transition-colors shadow-sm shadow-red-500/20"
              >
                确定覆盖并导入
              </button>
            </div>
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
        title="确定删除这个模型配置吗？"
        description="此操作将永久删除该 AI 模型的配置参数，且无法恢复。"
      />
    </div>
  );
};

export default SettingsPage;
