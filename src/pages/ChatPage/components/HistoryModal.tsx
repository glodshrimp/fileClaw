import React from 'react';
import { History, X, MessageSquare, Trash2, Plus } from 'lucide-react';
import { ChatSession } from '../types';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (e: React.MouseEvent, id: string) => void;
  onCreateNewSession: () => void;
}

const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSwitchSession,
  onDeleteSession,
  onCreateNewSession,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div className="bg-background border border-border w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-border flex items-center justify-between bg-background-secondary/50">
          <h3 className="font-bold flex items-center text-text-primary">
            <History className="w-5 h-5 mr-3 text-primary" />
            历史会话记录
          </h3>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-background-tertiary text-text-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSwitchSession(s.id)}
              className={`group flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all border ${
                currentSessionId === s.id 
                  ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20 scale-[1.02]' 
                  : 'bg-background-secondary border-transparent hover:border-primary/30 hover:bg-background-tertiary text-text-secondary'
              }`}
            >
              <div className="flex items-center min-w-0">
                <MessageSquare className={`w-4 h-4 mr-3 flex-shrink-0 ${currentSessionId === s.id ? 'text-white' : 'text-primary'}`} />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{s.title}</span>
                  <span className={`text-[10px] ${currentSessionId === s.id ? 'text-white/70' : 'text-text-tertiary'}`}>
                    {new Date(s.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => onDeleteSession(e, s.id)}
                className={`p-2 rounded-lg transition-all ${
                  currentSessionId === s.id ? 'hover:bg-white/20 text-white' : 'hover-gradient-danger text-functional-error'
                }`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="py-12 text-center">
              <History className="w-12 h-12 mx-auto mb-3 opacity-10" />
              <p className="text-sm text-text-tertiary">暂无历史记录</p>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border bg-background-secondary/30 flex justify-end">
          <button
            onClick={onCreateNewSession}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>开启新对话</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
