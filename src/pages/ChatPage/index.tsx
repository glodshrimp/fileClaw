import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../contexts/AppContext';
import { Message, AttachedFile, ChatSession } from './types';
import ChatHeader from './components/ChatHeader';
import HistoryModal from './components/HistoryModal';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import DeleteConfirmModal from '../../components/DeleteConfirmModal';

interface ChatPageProps {
  isSidebarMode?: boolean;
  onClose?: () => void;
}

const ChatPage: React.FC<ChatPageProps> = ({ isSidebarMode = false, onClose }) => {
  const { state, dispatch } = useApp();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ toolId: string; toolName: string; args: any } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id?: string; type: 'session' | 'clear' } | null>(null);

  useEffect(() => {
    loadSessions();
    
    // 监听 AI 敏感指令执行的二次授权拦截请求
    const removeToolListener = window.electronAPI.onConfirmToolExecution((data) => {
      setPendingConfirmation(data);
    });

    const handleAttachFile = (e: Event) => {
      const customEvent = e as CustomEvent<AttachedFile>;
      if (customEvent.detail) {
        setAttachedFiles(prev => {
          if (prev.some(f => f.path === customEvent.detail.path)) {
            return prev;
          }
          return [...prev, customEvent.detail];
        });
      }
    };
    window.addEventListener('attach-file-to-agent', handleAttachFile);
    
    return () => {
      removeToolListener();
      window.removeEventListener('attach-file-to-agent', handleAttachFile);
    };
  }, []);

  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      saveCurrentSession();
    }
  }, [messages]);

  const loadSessions = async () => {
    try {
      const savedSessions = await window.electronAPI.getChatSessions();
      setSessions(savedSessions.sort((a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt));

      if (savedSessions.length > 0 && !currentSessionId) {
        const mostRecent = savedSessions.sort((a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt)[0];
        setCurrentSessionId(mostRecent.id);
        setMessages(mostRecent.messages);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  };

  const saveCurrentSession = async () => {
    if (!currentSessionId) return;
    const session = sessions.find(s => s.id === currentSessionId);
    const title = messages[0]?.content.slice(0, 30) || '新会话';

    const updatedSession: ChatSession = {
      id: currentSessionId,
      title: session?.title || title,
      messages,
      updatedAt: Date.now(),
    };

    try {
      await window.electronAPI.saveChatSession(updatedSession);
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== currentSessionId);
        return [updatedSession, ...filtered];
      });
    } catch (err) {
      console.error('Failed to save session:', err);
    }
  };

  const createNewSession = () => {
    const newId = Date.now().toString();
    setCurrentSessionId(newId);
    setMessages([]);
    setAttachedFiles([]);
    setInput('');
    setIsHistoryModalOpen(false);
  };

  const switchSession = (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      setCurrentSessionId(id);
      setMessages(session.messages);
      setAttachedFiles([]);
      setIsHistoryModalOpen(false);
    }
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget({ id, type: 'session' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, type } = deleteTarget;
    try {
      if (type === 'session' && id) {
        await window.electronAPI.deleteChatSession(id);
        setSessions(prev => prev.filter(s => s.id !== id));
        if (currentSessionId === id) {
          createNewSession();
        }
      } else if (type === 'clear') {
        setMessages([]);
      }
    } catch (err) {
      console.error(`Failed to delete/clear:`, err);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleFileSelect = async () => {
    try {
      const files = await window.electronAPI.selectFiles();
      if (files.length === 0) return;

      const newFiles: AttachedFile[] = [];
      for (const file of files) {
        if (attachedFiles.find((f: AttachedFile) => f.path === file.path)) continue;
        const readResult = await window.electronAPI.readFileBase64(file.path);
        newFiles.push({
          ...file,
          type: readResult.type,
          data: readResult.data,
          mimeType: readResult.mimeType,
          preview: readResult.type === 'image' ? `data:${readResult.mimeType};base64,${readResult.data}` : undefined
        });
      }
      setAttachedFiles(prev => [...prev, ...newFiles]);
    } catch (err) {
      console.error('Failed to select files:', err);
    }
  };

  const handleSend = async (retryContent?: string, retryFiles?: any[]) => {
    const messageContent = retryContent || input;
    const messageFiles = retryFiles || attachedFiles;

    if (!messageContent.trim() && messageFiles.length === 0) return;
    if (isLoading) return;

    const { models, activeModelId } = state.aiSettings;
    const activeModel = models.find(m => m.id === activeModelId);
    if (!activeModel) {
      alert('请先在系统设置中配置并选择一个 AI 模型');
      return;
    }
    const { apiKey, model, provider, baseURL } = activeModel;

    // Capture files to be sent
    const capturedFiles = messageFiles.map((f: AttachedFile) => ({ name: f.name, type: f.type, preview: f.preview }));

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      status: 'sent',
      files: capturedFiles
    };

    const assistantMessageId = (Date.now() + 1).toString();
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'pending'
    };

    if (!retryContent) {
      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setInput('');
      setAttachedFiles([]);
    } else {
      // For retry, we update the existing assistant message or append a new one
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.status === 'error') {
          return [...prev.slice(0, -1), assistantPlaceholder];
        }
        return [...prev, assistantPlaceholder];
      });
    }

    setIsLoading(true);

    try {
      let fullPrompt = messageContent;
      if (messageFiles.length > 0) {
        fullPrompt += '\n\n【附件内容】:';
        messageFiles.forEach((f: any) => {
          if (f.type === 'text') fullPrompt += `\n--- 文件: ${f.name} ---\n${f.data}\n`;
          else fullPrompt += `\n[图片附件: ${f.name}]`;
        });
      }

      const data = await window.electronAPI.aiChat(
        apiKey,
        model || 'google/gemini-2.0-flash-001',
        [
          ...messages.filter(m => m.status === 'sent').map((m: Message) => ({ role: m.role, content: m.content })),
          { role: 'user', content: fullPrompt }
        ],
        provider || 'openrouter',
        baseURL
      );

      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: data.choices[0].message.content,
        reasoning: data.choices[0].message.reasoning_content || data.choices[0].message.reasoning,
        timestamp: Date.now(),
        status: 'sent'
      };

      setMessages((prev) => prev.map(m => m.id === assistantMessageId ? assistantMessage : m));
    } catch (error: any) {
      console.error('Chat error:', error);
      if (error.name === 'AbortError') {
        setMessages((prev) => prev.filter(m => m.id !== assistantMessageId));
      } else {
        setMessages((prev) => prev.map(m => m.id === assistantMessageId ? { ...m, status: 'error', content: `发送失败: ${error.message}` } : m));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAbort = async () => {
    try {
      await window.electronAPI.aiAbort();
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  };
  const handleRetry = () => {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMessage) {
      const files = lastUserMessage.files?.map(f => ({ ...f, data: '', path: '' })) || [];
      handleSend(lastUserMessage.content, files as any);
    }
  };

  const handleDeleteMessage = (id: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      
      const targetMessage = prev[idx];
      if (targetMessage.role === 'user') {
        const nextMessage = prev[idx + 1];
        if (nextMessage && nextMessage.role === 'assistant') {
          return prev.filter((_, i) => i !== idx && i !== idx + 1);
        }
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearChat = () => {
    setDeleteTarget({ type: 'clear' });
  };

  return (
    <div className={`flex overflow-hidden bg-background relative ${
      isSidebarMode 
        ? 'w-full h-full' 
        : 'h-[calc(100vh-40px)] -m-6 animate-in fade-in duration-300'
    }`}>
      {/* 敏感工具命令执行二次授权卡片 — 高端磨砂玻璃风格 */}
      {pendingConfirmation && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-[520px] max-w-[90%] bg-slate-900/85 border border-white/10 rounded-2xl shadow-2xl p-6 text-white backdrop-blur-xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center space-x-3.5 mb-4">
              <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold tracking-wide">敏感命令二次授权确认</h3>
                <p className="text-xs text-slate-400">AI 助手申请执行系统指令</p>
              </div>
            </div>

            <div className="space-y-3.5 mb-6">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">请求工具:</span>
                <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-blue-400 border border-white/5">{pendingConfirmation.toolName}</span>
              </div>
              
              {pendingConfirmation.toolName === 'execute_ssh_command' && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">远程服务器:</span>
                  <span className="font-mono text-slate-300">{pendingConfirmation.args.ssh_id_or_name}</span>
                </div>
              )}

              <div className="text-sm">
                <p className="text-slate-400 mb-1.5">即将执行的指令:</p>
                <div className="bg-black/40 border border-white/5 rounded-xl p-3.5 font-mono text-emerald-400 text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[160px] scrollbar-thin">
                  {pendingConfirmation.args.command}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={() => {
                  window.electronAPI.respondToToolExecution(pendingConfirmation.toolId, false);
                  setPendingConfirmation(null);
                }}
                className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-200 border border-white/5"
              >
                拒绝执行
              </button>
              <button
                onClick={() => {
                  window.electronAPI.respondToToolExecution(pendingConfirmation.toolId, true);
                  setPendingConfirmation(null);
                }}
                className="px-5 py-2 text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all duration-200 hover:-translate-y-0.5"
              >
                授权允许
              </button>
            </div>
          </div>
        </div>
      )}

      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitchSession={switchSession}
        onDeleteSession={deleteSession}
        onCreateNewSession={createNewSession}
      />

      <div className={`flex-1 flex flex-col min-w-0 ${isSidebarMode ? 'p-3' : 'p-6'}`}>
        <ChatHeader
          model={state.aiSettings.models.find(m => m.id === state.aiSettings.activeModelId)?.model ?? ''}
          provider={state.aiSettings.models.find(m => m.id === state.aiSettings.activeModelId)?.provider}
          displayName={state.aiSettings.models.find(m => m.id === state.aiSettings.activeModelId)?.displayName}
          models={state.aiSettings.models}
          activeModelId={state.aiSettings.activeModelId}
          onChangeActiveModel={(id: string) => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { activeModelId: id } })}
          onOpenHistory={() => setIsHistoryModalOpen(true)}
          onNewChat={createNewSession}
          onClearChat={clearChat}
          isSidebarMode={isSidebarMode}
          onClose={onClose}
          sessionTitle={sessions.find(s => s.id === currentSessionId)?.title || '新会话'}
        />

        <MessageList
          messages={messages}
          isLoading={isLoading}
          messagesEndRef={messagesEndRef}
          onRetry={handleRetry}
          onDeleteMessage={handleDeleteMessage}
        />

        <ChatInput
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          attachedFiles={attachedFiles}
          onFileSelect={handleFileSelect}
          onRemoveFile={(path) => setAttachedFiles(prev => prev.filter(f => f.path !== path))}
          onSend={() => handleSend()}
          onAbort={handleAbort}
        />
      </div>

      <DeleteConfirmModal
        isOpen={deleteTarget !== null}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title={deleteTarget?.type === 'session' ? "确定要删除此会话吗？" : "确定要清空当前会话的消息吗？"}
        description={deleteTarget?.type === 'session'
          ? "此操作将从数据库中永久删除该聊天会话及其所有历史消息，且无法恢复。"
          : "此操作将清空当前对话区域展示的全部历史消息，且无法恢复。"
        }
      />
    </div>
  );
};

export default ChatPage;
