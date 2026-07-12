import React, { useRef, useEffect } from 'react';
import { Paperclip, FileText, X, Send, Square } from 'lucide-react';
import { AttachedFile } from '../types';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
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

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 250)}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading) {
        onSend();
        // Reset height after sending
        if (textareaRef.current) {
          textareaRef.current.style.height = '44px';
        }
      }
    }
  };

  return (
    <div className="relative bg-background-secondary border border-border rounded-2xl p-2 shadow-lg ring-1 ring-black/5">
      {/* File Previews */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 mb-2 bg-background/50 rounded-xl overflow-x-auto max-h-32 scrollbar-thin">
          {attachedFiles.map((file) => (
            <div key={file.path} className="group relative flex items-center p-2 pr-8 bg-background border border-border rounded-xl shadow-sm animate-in fade-in zoom-in duration-200">
              {file.type === 'image' ? (
                <img src={file.preview} alt={file.name} className="w-8 h-8 rounded object-cover mr-2" />
              ) : (
                <div className="w-8 h-8 bg-primary/10 rounded flex items-center justify-center mr-2">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-[10px] font-medium text-text-primary truncate max-w-[100px]">{file.name}</span>
                <span className="text-[8px] text-text-tertiary uppercase">{file.type}</span>
              </div>
              <button
                onClick={() => onRemoveFile(file.path)}
                className="absolute right-1 top-1 p-1 rounded-full bg-background-tertiary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-functional-error/10 hover:text-functional-error"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      
      <div className="flex items-end space-x-2">
        <button
          onClick={onFileSelect}
          disabled={isLoading}
          className={`p-3 rounded-xl transition-all flex-shrink-0 ${
            isLoading ? 'text-text-tertiary cursor-not-allowed opacity-50' : 'text-text-secondary hover:bg-background-tertiary hover:text-primary'
          }`}
          title="选择文件"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder={isLoading ? "AI 正在思考中..." : "输入您的消息...(Shift+Enter 换行)"}
          className="w-full px-4 py-3 bg-transparent border-none text-sm focus:outline-none resize-none min-h-[44px] overflow-y-auto scrollbar-thin transition-all"
          rows={1}
        />
        
        {isLoading ? (
          <button
            onClick={onAbort}
            className="p-3 rounded-xl bg-functional-error text-white shadow-lg shadow-functional-error/20 hover:scale-105 active:scale-95 mb-1 transition-all flex-shrink-0 animate-in zoom-in duration-200"
            title="停止生成"
          >
            <Square className="w-5 h-5 fill-current" />
          </button>
        ) : (
          <button
            onClick={() => {
              onSend();
              if (textareaRef.current) textareaRef.current.style.height = '44px';
            }}
            disabled={(!input.trim() && attachedFiles.length === 0)}
            className={`p-3 rounded-xl transition-all flex-shrink-0 ${
              (!input.trim() && attachedFiles.length === 0)
                ? 'text-text-tertiary cursor-not-allowed opacity-50 mb-1' 
                : 'bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 mb-1'
            }`}
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
