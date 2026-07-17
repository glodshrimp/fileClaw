import React, { useRef, useEffect, useState } from 'react';
import { FileText, X, Send, Square, Plus, Mic, MicOff, ChevronDown, Check } from 'lucide-react';
import { AttachedFile } from '../types';
import { useWorkspaceStore } from '../../../contexts/useWorkspaceStore';
import { useApp } from '../../../contexts/AppContext';

interface ChatInputProps {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  attachedFiles: AttachedFile[];
  onFileSelect: () => void;
  onRemoveFile: (path: string) => void;
  onSend: () => void;
  onAbort?: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  input,
  setInput,
  isLoading,
  attachedFiles,
  onFileSelect,
  onRemoveFile,
  onSend,
  onAbort,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // App context for model selection
  const { state, dispatch } = useApp();
  const models = state.aiSettings.models;
  const activeModelId = state.aiSettings.activeModelId;
  const activeModel = models.find(m => m.id === activeModelId);

  // Workspace files for autocomplete suggestions
  const currentProject = useWorkspaceStore((s) => s.currentProject);
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const projectPath = currentProject?.codePath || currentProject?.path;

  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [suggestionType, setSuggestionType] = useState<'command' | 'file' | 'tab' | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] = useState(0);

  // Model dropdown states
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Speech recognition (voice input) states
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Group models by provider
  const groupedModels = models.reduce((acc, cfg) => {
    const prov = cfg.provider || 'others';
    if (!acc[prov]) acc[prov] = [];
    acc[prov].push(cfg);
    return acc;
  }, {} as Record<string, any[]>);

  // Auto-load project files for "@" mentions
  useEffect(() => {
    if (projectPath) {
      // List root folder files to autocomplete (non-recursively for speed)
      // @ts-ignore
      window.electronAPI?.localListDir(projectPath).then((nodes: any[]) => {
        if (Array.isArray(nodes)) {
          const filesOnly = nodes.filter(n => !n.isDir).map(n => n.name);
          setProjectFiles(filesOnly);
        }
      }).catch(console.error);
    }
  }, [projectPath]);

  // Click outside listener for model dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('您的系统或浏览器不支持语音输入功能');
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const lastWord = textBeforeCursor.split(/\s/).pop() || '';

    if (lastWord.startsWith('/')) {
      setSuggestionType('command');
      setTriggerPosition(cursor - lastWord.length);
      setShowSuggestions(true);
      setFilteredSuggestions(
        ['/plan', '/clear', '/help'].filter(c => c.startsWith(lastWord))
      );
      setSuggestionIndex(0);
    } else if (lastWord.startsWith('@')) {
      setSuggestionType('file');
      setTriggerPosition(cursor - lastWord.length);
      setShowSuggestions(true);
      const query = lastWord.slice(1).toLowerCase();
      setFilteredSuggestions(
        projectFiles.filter(f => f.toLowerCase().includes(query)).slice(0, 10)
      );
      setSuggestionIndex(0);
    } else if (lastWord.startsWith('#')) {
      setSuggestionType('tab');
      setTriggerPosition(cursor - lastWord.length);
      setShowSuggestions(true);
      const query = lastWord.slice(1).toLowerCase();
      const openFileNames = openTabs.map(t => t.name);
      setFilteredSuggestions(
        openFileNames.filter(name => name.toLowerCase().includes(query)).slice(0, 10)
      );
      setSuggestionIndex(0);
    } else {
      setShowSuggestions(false);
      setSuggestionType(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && filteredSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev + 1) % filteredSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectSuggestion(filteredSuggestions[suggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setSuggestionType(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading) {
        onSend();
        if (textareaRef.current) {
          textareaRef.current.style.height = '40px';
        }
      }
    }
  };

  const handleSelectSuggestion = (item: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursor = textarea.selectionStart;
    const beforeTrigger = input.slice(0, triggerPosition);
    const afterCursor = input.slice(cursor);

    const replacement = item + ' ';
    const newValue = beforeTrigger + replacement + afterCursor;
    setInput(newValue);
    setShowSuggestions(false);
    setSuggestionType(null);

    setTimeout(() => {
      textarea.focus();
      const newCursor = triggerPosition + replacement.length;
      textarea.setSelectionRange(newCursor, newCursor);
    }, 10);
  };

  return (
    <div className="relative bg-background-secondary border border-border rounded-2xl p-1.5 shadow-lg ring-1 ring-black/5 flex flex-col">
      {/* Plan Mode Pulse Badge */}
      {input.trim().startsWith('/plan') && (
        <div className="absolute top-2.5 right-4 bg-primary/10 border border-primary/30 px-2.5 py-0.5 rounded-full text-[9px] font-bold text-primary font-mono flex items-center gap-1.5 animate-pulse select-none z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span>PLAN MODE</span>
        </div>
      )}

      {/* Autocomplete popover */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 bg-[#151b26] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden w-64 max-h-48 overflow-y-auto scrollbar-thin text-xs text-slate-200">
          <div className="px-3 py-1.5 bg-background border-b border-white/5 font-semibold text-text-tertiary uppercase text-[9px] tracking-wider">
            {suggestionType === 'command' && '快捷命令 (Command)'}
            {suggestionType === 'file' && '文件检索 (@)'}
            {suggestionType === 'tab' && '打开标签页 (#)'}
          </div>
          {filteredSuggestions.map((item, idx) => (
            <button
              key={item}
              type="button"
              onClick={() => handleSelectSuggestion(item)}
              className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between font-mono text-[11px] cursor-pointer ${
                idx === suggestionIndex ? 'bg-primary text-white font-semibold' : 'hover:bg-white/5 text-slate-200'
              }`}
            >
              <span>{item}</span>
              {suggestionType === 'command' && (
                <span className="text-[9px] opacity-60">
                  {item === '/plan' && '计划与确认'}
                  {item === '/clear' && '清空消息'}
                  {item === '/help' && '获取指南'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* File Previews */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 p-1.5 mb-1.5 bg-background/50 rounded-xl overflow-x-auto max-h-24 scrollbar-thin">
          {attachedFiles.map((file) => (
            <div key={file.path} className="group relative flex items-center p-1.5 pr-7 bg-background border border-border rounded-xl shadow-sm animate-in fade-in zoom-in duration-200">
              {file.type === 'image' ? (
                <img src={file.preview} alt={file.name} className="w-7 h-7 rounded object-cover mr-1.5" />
              ) : (
                <div className="w-7 h-7 bg-primary/10 rounded flex items-center justify-center mr-1.5">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-[9px] font-medium text-text-primary truncate max-w-[80px]">{file.name}</span>
                <span className="text-[8px] text-text-tertiary uppercase">{file.type}</span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveFile(file.path)}
                className="absolute right-1 top-1 p-0.5 rounded-full bg-background-tertiary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-functional-error/10 hover:text-functional-error cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      
      {/* Row 1: Text Area */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        placeholder={isLoading ? "AI 正在思考中..." : "Ask anything, @ to mention, / for actions"}
        className="w-full px-2 py-1.5 bg-transparent border-none text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none resize-none min-h-[40px] overflow-y-auto scrollbar-thin transition-all"
        rows={1}
      />
      
      {/* Row 2: Toolbar Actions */}
      <div className="flex items-center justify-between px-1.5 py-1 mt-1 border-t border-border-primary/40 pt-1.5">
        {/* Left: + Button and Model Selector */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onFileSelect}
            disabled={isLoading}
            className={`p-1 rounded-lg transition-all cursor-pointer ${
              isLoading ? 'text-text-tertiary cursor-not-allowed opacity-50' : 'text-text-secondary hover:bg-background-tertiary hover:text-primary'
            }`}
            title="关联文件 (+)"
          >
            <Plus className="w-4 h-4" />
          </button>
          
          {/* Model Selector Dropdown */}
          <div className="relative" ref={modelDropdownRef}>
            <button
              type="button"
              onClick={() => setIsModelDropdownOpen(prev => !prev)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-background-secondary hover:border-primary/50 text-[10px] text-text-secondary hover:text-text-primary transition-all cursor-pointer font-medium"
            >
              <span>{activeModel?.displayName || activeModel?.model || '选择模型'}</span>
              <ChevronDown className="w-2.5 h-2.5 text-text-tertiary" />
            </button>
            
            {isModelDropdownOpen && models.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 bg-[#151b26] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden w-64 max-h-48 overflow-y-auto scrollbar-thin text-xs text-slate-200">
                {(Object.entries(groupedModels) as [string, any[]][]).map(([provider, items]) => (
                  <div key={provider}>
                    <div className="px-3 py-1 bg-background border-b border-white/5 text-[9px] font-bold uppercase text-text-tertiary tracking-wider">
                      {provider}
                    </div>
                    {items.map((cfg) => (
                      <button
                        key={cfg.id}
                        type="button"
                        onClick={() => {
                          dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { activeModelId: cfg.id } });
                          setIsModelDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5 transition-colors font-mono text-[11px] cursor-pointer ${
                          cfg.id === activeModelId ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-200'
                        }`}
                      >
                        <span>{cfg.displayName || cfg.model}</span>
                        {cfg.id === activeModelId && (
                          <Check className="w-3.5 h-3.5 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Mic Button and Send Button */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={isLoading}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              isLoading 
                ? 'text-text-tertiary cursor-not-allowed opacity-50' 
                : isListening 
                  ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/20' 
                  : 'text-text-secondary hover:bg-background-tertiary hover:text-primary'
            }`}
            title={isListening ? "停止录音" : "语音输入"}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {isLoading ? (
            <button
              type="button"
              onClick={onAbort}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-functional-error text-white shadow-lg shadow-functional-error/20 hover:scale-105 active:scale-95 transition-all cursor-pointer flex-shrink-0"
              title="停止生成"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                onSend();
                if (textareaRef.current) textareaRef.current.style.height = '40px';
              }}
              disabled={(!input.trim() && attachedFiles.length === 0)}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-all cursor-pointer flex-shrink-0 ${
                (!input.trim() && attachedFiles.length === 0)
                  ? 'text-text-tertiary bg-background-tertiary cursor-not-allowed opacity-50' 
                  : 'bg-primary text-white hover:scale-105 active:scale-95 shadow-md shadow-primary/20'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
