import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Image as ImageIcon, FileText, Loader2, RefreshCw, Copy, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// @ts-ignore
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
// @ts-ignore
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../types';
import { copyToClipboard } from '../../../utils/copy';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onRetry?: () => void;
  onDeleteMessage?: (id: string) => void;
}

const ThinkingPanel: React.FC<{ content: string }> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="mb-2.5 overflow-hidden rounded-lg bg-background-secondary/30">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-medium text-text-secondary hover:bg-background-tertiary/50 transition-colors"
      >
        <div className="flex items-center">
          <Brain className="w-3 h-3 mr-1.5 text-primary" />
          <span>AI 思考过程</span>
        </div>
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {isExpanded && (
        <div className="px-3 py-2 text-[10px] text-text-tertiary border-t border-border-primary/10 bg-background/10 italic whitespace-pre-wrap leading-relaxed animate-in slide-in-from-top-2 duration-200">
          {content}
        </div>
      )}
    </div>
  );
};

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, messagesEndRef, onRetry, onDeleteMessage }) => {
  return (
    <div className="flex-1 overflow-y-auto bg-transparent border-none px-2 py-1 mb-4 space-y-5 scrollbar-thin">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-text-tertiary">
          <Brain className="w-12 h-12 mb-3 opacity-20 animate-pulse text-primary" />
          <p className="text-xs">有什么可以帮您的？</p>
          <p className="text-[9px] mt-1.5 opacity-60">新会话已开启，会自动保存历史记录</p>
        </div>
      ) : (
        messages.map((m, index) => (
          <div
            key={m.id}
            className={`w-full flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.role === 'user' ? (
              /* User Card Layout - Full width, double row layout, absolute hover action bar */
              <div className="group bg-primary/5 border border-primary/15 text-text-primary rounded-xl px-3.5 pt-2.5 pb-7 flex flex-col w-full relative shadow-sm transition-all duration-200 hover:bg-primary/10">
                {/* Row 1: Files/Images previews and Text Content */}
                <div className="flex flex-col gap-2 min-w-0 w-full">
                  {m.files && m.files.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {m.files.map((f, i) => (
                        <div key={i} className="w-8 h-8 rounded-lg overflow-hidden border border-white/10 bg-black/25 flex items-center justify-center relative">
                          {f.type === 'image' ? (
                            <img src={f.preview} alt={f.name} className="w-full h-full object-cover" />
                          ) : (
                            <FileText className="w-4 h-4 text-primary" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <span className="text-xs text-text-primary whitespace-pre-wrap break-all leading-normal">
                    {m.content}
                  </span>
                </div>
                
                {/* Row 2 / Hover Floating Bar: Timestamp, Copy, Recall */}
                <div className="absolute bottom-1.5 right-3 bg-background-secondary/90 backdrop-blur-sm border border-border-primary/20 rounded-lg px-2 py-0.5 flex items-center space-x-1.5 text-[10px] text-text-tertiary select-none opacity-0 group-hover:opacity-100 transition-all duration-150 shadow-md">
                  <span>{m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <div className="w-[1px] h-2.5 bg-border-primary/30" />
                  
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(m.content, e);
                    }}
                    className="p-0.5 rounded hover:bg-white/10 hover:text-text-primary transition-colors cursor-pointer"
                    title="复制内容"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  
                  {onDeleteMessage && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteMessage(m.id);
                      }}
                      className="p-0.5 rounded hover:bg-white/10 hover:text-functional-error transition-colors cursor-pointer"
                      title="撤回消息"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* Assistant Transparent Text Flow Layout (No Avatar) */
              <div className="w-full text-xs text-text-primary leading-relaxed px-1 py-0.5">
                {m.status === 'pending' ? (
                  <div className="flex items-center space-x-2 text-text-tertiary py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="text-[11px] italic">AI 正在思考中...</span>
                  </div>
                ) : (
                  <>
                    {m.reasoning && <ThinkingPanel content={m.reasoning} />}
                    {m.status === 'error' ? (
                      <div className="px-3 py-2 bg-functional-error/5 border border-functional-error/20 rounded-xl text-text-primary">
                        {m.content}
                      </div>
                    ) : (
                      <div className="prose prose-xs dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code({ node, inline, className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              return !inline && match ? (
                                <div className="rounded-lg overflow-hidden my-3 border border-border-primary/10 bg-background-tertiary">
                                  <div className="bg-background-tertiary px-3 py-1 border-b border-border-primary/15 flex justify-between items-center">
                                    <span className="text-[9px] font-mono text-text-tertiary uppercase">{match[1]}</span>
                                    <button 
                                      type="button"
                                      onClick={(e) => copyToClipboard(String(children).replace(/\n$/, ''), e)}
                                      className="text-[9px] text-primary hover:underline cursor-pointer"
                                    >
                                      复制
                                    </button>
                                  </div>
                                  <SyntaxHighlighter
                                    style={vscDarkPlus}
                                    language={match[1]}
                                    PreTag="div"
                                    customStyle={{ margin: 0, borderRadius: 0, fontSize: '11px' }}
                                    {...props}
                                  >
                                    {String(children).replace(/\n$/, '')}
                                  </SyntaxHighlighter>
                                </div>
                              ) : (
                                <code className={`${className} bg-background-tertiary px-1.5 py-0.5 rounded text-primary font-mono text-[10px]`} {...props}>
                                  {children}
                                </code>
                              );
                            },
                            table({ children }) {
                              return <div className="overflow-x-auto my-3 rounded-lg border border-border-primary/10"><table className="min-w-full divide-y divide-border-primary/10">{children}</table></div>;
                            },
                            th({ children }) {
                              return <th className="px-3 py-1.5 bg-background-tertiary text-left text-[10px] font-bold uppercase tracking-wider">{children}</th>;
                            },
                            td({ children }) {
                              return <td className="px-3 py-1.5 border-t border-border-primary/10 text-xs">{children}</td>;
                            }
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    
                    {/* Action Bar for AI response */}
                    <div className="flex items-center space-x-2 mt-2.5 text-[10px] text-text-tertiary select-none">
                      <span>{m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(m.content, e);
                        }}
                        className="p-1 rounded hover:bg-white/5 hover:text-text-primary transition-colors cursor-pointer"
                        title="复制内容"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {m.status === 'error' && index === messages.length - 1 && onRetry && (
                      <div className="mt-3 pt-3 border-t border-functional-error/10 flex justify-end">
                        <button
                          type="button"
                          onClick={onRetry}
                          className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-primary text-white text-[11px] font-bold hover:scale-105 active:scale-95 transition-all shadow-md shadow-primary/20 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>重新发送</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
                
                {m.files && m.files.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border-primary/10 flex flex-wrap gap-1.5">
                    {m.files.map((f, i) => (
                      <div key={i} className="flex items-center px-2 py-1 rounded text-[10px] bg-background-secondary border border-border-primary/10 text-text-secondary">
                        {f.type === 'image' ? <ImageIcon className="w-3 h-3 mr-1" /> : <FileText className="w-3 h-3 mr-1" />}
                        <span className="truncate max-w-[120px]">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;
