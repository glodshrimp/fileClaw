import React, { useState, useRef, useEffect } from 'react';
import { Bot, History, Plus, Trash2, Settings, ChevronDown, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AIModelConfig, AIProvider } from '../../../types';

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA NIM',
  custom: '自定义',
  gemini: 'Gemini',
};

const PROVIDER_COLORS: Record<AIProvider, string> = {
  openrouter: 'from-violet-500 to-purple-600',
  nvidia: 'from-green-500 to-emerald-600',
  custom: 'from-sky-500 to-blue-600',
  gemini: 'from-blue-500 to-indigo-600',
};

interface ChatHeaderProps {
  model: string;
  provider?: AIProvider;
  displayName?: string;
  models: AIModelConfig[];
  activeModelId: string | null;
  onChangeActiveModel: (id: string) => void;
  onOpenHistory: () => void;
  onNewChat: () => void;
  onClearChat: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  model,
  provider,
  displayName,
  models,
  activeModelId,
  onChangeActiveModel,
  onOpenHistory,
  onNewChat,
  onClearChat,
}) => {
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 按 provider 分组
  const grouped = models.reduce<Record<string, AIModelConfig[]>>((acc, m) => {
    const p = m.provider;
    if (!acc[p]) acc[p] = [];
    acc[p].push(m);
    return acc;
  }, {});

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-primary flex items-center">
            <Bot className="w-8 h-8 mr-3 text-primary" />
            AI 助手
          </h2>
        </div>

        {/* 模型选择器 */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsModelDropdownOpen(prev => !prev)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-sm ${
              models.length === 0
                ? 'border-border text-text-tertiary bg-background-secondary'
                : 'border-border bg-background-secondary hover:border-primary/50 hover:shadow-sm'
            }`}
            title="切换模型"
          >
            {models.length === 0 ? (
              <span className="text-text-tertiary">未配置模型</span>
            ) : activeModelId ? (
              <>
                {provider && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold text-white bg-gradient-to-r ${PROVIDER_COLORS[provider]}`}>
                    {PROVIDER_LABELS[provider]}
                  </span>
                )}
                <span className="font-medium text-text-primary max-w-[160px] truncate">
                  {displayName || model || '未命名'}
                </span>
              </>
            ) : (
              <span className="text-text-tertiary">选择模型</span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* 下拉列表 */}
          {isModelDropdownOpen && models.length > 0 && (
            <div className="absolute top-full left-0 mt-2 w-72 bg-background-secondary border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {(Object.entries(grouped) as [AIProvider, AIModelConfig[]][]).map(([prov, items]) => (
                <div key={prov}>
                  <div className="px-3 py-2 bg-background border-b border-border">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold text-white bg-gradient-to-r ${PROVIDER_COLORS[prov]}`}>
                      {PROVIDER_LABELS[prov]}
                    </span>
                  </div>
                  {items.map((cfg) => (
                    <button
                      key={cfg.id}
                      onClick={() => {
                        onChangeActiveModel(cfg.id);
                        setIsModelDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-background transition-colors ${
                        cfg.id === activeModelId ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-text-primary truncate">{cfg.displayName || cfg.model}</div>
                        <div className="text-xs text-text-tertiary font-mono truncate">{cfg.model}</div>
                      </div>
                      {cfg.id === activeModelId && (
                        <Check className="w-4 h-4 text-primary flex-shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <div className="flex bg-background-secondary p-1 rounded-xl border border-border mr-2 shadow-sm">
          <button
            onClick={onOpenHistory}
            className="flex items-center space-x-2 px-3 py-2 rounded-lg text-text-secondary hover:bg-background-tertiary transition-all"
            title="查看历史记录"
          >
            <History className="w-5 h-5" />
            <span className="text-xs font-semibold">历史记录</span>
          </button>
          <div className="w-[1px] bg-border mx-1 my-1" />
          <button
            onClick={onNewChat}
            className="flex items-center space-x-2 px-3 py-2 rounded-lg text-primary hover:bg-primary/10 transition-all font-semibold"
            title="开启新会话"
          >
            <Plus className="w-5 h-5" />
            <span className="text-xs font-semibold">新对话</span>
          </button>
        </div>
        
        <button 
          onClick={onClearChat}
          className="btn-secondary p-2.5 rounded-xl border border-border bg-background-secondary hover-gradient-danger text-functional-error"
          title="清空当前消息"
        >
          <Trash2 className="w-5 h-5" />
        </button>
        <Link 
          to="/settings"
          className="btn-secondary p-2.5 rounded-xl border border-border bg-background-secondary hover-gradient-primary text-text-secondary"
          title="设置"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </div>
    </div>
  );
};

export default ChatHeader;
