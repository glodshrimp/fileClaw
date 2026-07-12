import React, { useState } from 'react';
import { Bot, User, Brain, ChevronDown, ChevronRight, Image as ImageIcon, FileText, Loader2, RefreshCw } from 'lucide-react';
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
}

const ThinkingPanel: React.FC<{ content: string }> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="mb-3 overflow-hidden border border-border rounded-xl bg-background-secondary/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-text-secondary hover:bg-background-tertiary transition-colors"
      >
        <div className="flex items-center">
          <Brain className="w-3.5 h-3.5 mr-2 text-primary" />
          <span>AI 思考过程</span>
        </div>
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {isExpanded && (
        <div className="px-4 py-3 text-xs text-text-tertiary border-t border-border bg-background/30 italic whitespace-pre-wrap leading-relaxed animate-in slide-in-from-top-2 duration-200">
          {content}
        </div>
      )}
    </div>
  );
};

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, messagesEndRef, onRetry }) => {
  return (
    <div className="flex-1 overflow-y-auto bg-background-secondary border border-border rounded-2xl p-6 mb-4 space-y-6 shadow-inner scrollbar-thin">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-text-tertiary">
          <Bot className="w-16 h-16 mb-4 opacity-20" />
          <p>有什么可以帮您的？</p>
          <p className="text-[10px] mt-2">新会话已开启，会自动保存历史记录</p>
        </div>
      ) : (
        messages.map((m, index) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex max-w-[90%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                m.role === 'user' ? 'bg-primary text-white ml-3' : 'bg-background-tertiary border border-border mr-3'
              }`}>
                {m.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5 text-primary" />}
              </div>
              <div className={`p-4 rounded-2xl shadow-sm text-sm leading-relaxed relative ${
                m.role === 'user' 
                  ? 'bg-primary text-white rounded-tr-none whitespace-pre-wrap' 
                  : (m.status === 'error' ? 'bg-functional-error/5 border border-functional-error/20 text-text-primary rounded-tl-none' : 'bg-background border border-border text-text-primary rounded-tl-none')
              }`}>
                {m.status === 'pending' ? (
                  <div className="flex items-center space-x-2 text-text-tertiary py-1">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs italic">AI 正在思考中...</span>
                  </div>
                ) : (
                  <>
                    {m.reasoning && m.role === 'assistant' && <ThinkingPanel content={m.reasoning} />}
                    {m.role === 'user' ? (
                      m.content
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code({ node, inline, className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              return !inline && match ? (
                                <div className="rounded-lg overflow-hidden my-4 border border-border shadow-sm">
                                  <div className="bg-background-tertiary px-4 py-1.5 border-b border-border flex justify-between items-center">
                                    <span className="text-[10px] font-mono text-text-tertiary uppercase">{match[1]}</span>
                                    <button 
                                      onClick={(e) => copyToClipboard(String(children).replace(/\n$/, ''), e)}
                                      className="text-[10px] text-primary hover:underline"
                                    >
                                      复制
                                    </button>
                                  </div>
                                  <SyntaxHighlighter
                                    style={vscDarkPlus}
                                    language={match[1]}
                                    PreTag="div"
                                    customStyle={{ margin: 0, borderRadius: 0, fontSize: '12px' }}
                                    {...props}
                                  >
                                    {String(children).replace(/\n$/, '')}
                                  </SyntaxHighlighter>
                                </div>
                              ) : (
                                <code className={`${className} bg-background-tertiary px-1.5 py-0.5 rounded text-primary font-mono text-xs`} {...props}>
                                  {children}
                                </code>
                              );
                            },
                            table({ children }) {
                              return <div className="overflow-x-auto my-4 rounded-lg border border-border"><table className="min-w-full divide-y divide-border">{children}</table></div>;
                            },
                            th({ children }) {
                              return <th className="px-4 py-2 bg-background-tertiary text-left text-xs font-bold uppercase tracking-wider">{children}</th>;
                            },
                            td({ children }) {
                              return <td className="px-4 py-2 border-t border-border text-sm">{children}</td>;
                            }
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    {m.status === 'error' && index === messages.length - 1 && onRetry && (
                      <div className="mt-4 pt-4 border-t border-functional-error/10 flex justify-end">
                        <button
                          onClick={onRetry}
                          className="flex items-center space-x-2 px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:scale-105 active:scale-95 transition-all shadow-md shadow-primary/20"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>重新发送</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
                {m.files && m.files.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/20 flex flex-wrap gap-2">
                    {m.files.map((f, i) => (
                      <div key={i} className={`flex items-center p-2 rounded-lg text-xs ${m.role === 'user' ? 'bg-white/10' : 'bg-background-secondary border border-border'}`}>
                        {f.type === 'image' ? <ImageIcon className="w-3 h-3 mr-1.5" /> : <FileText className="w-3 h-3 mr-1.5" />}
                        <span className="truncate max-w-[120px]">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;
