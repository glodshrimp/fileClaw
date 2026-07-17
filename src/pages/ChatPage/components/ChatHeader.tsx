import React from 'react';
import { History, Plus, MoreHorizontal, X } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ChatHeaderProps {
  model: string;
  provider?: string;
  displayName?: string;
  models: any[];
  activeModelId: string | null;
  onChangeActiveModel: (id: string) => void;
  onOpenHistory: () => void;
  onNewChat: () => void;
  onClearChat: () => void;
  isSidebarMode?: boolean;
  onClose?: () => void;
  sessionTitle?: string;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  onOpenHistory,
  onNewChat,
  onClose,
  sessionTitle = '新会话',
}) => {
  return (
    <div className="flex items-center justify-between pb-2 border-b border-border-primary/20 mb-3 select-none flex-shrink-0">
      {/* Left: Session Title */}
      <div className="flex items-center min-w-0">
        <span className="text-[13px] font-semibold text-text-primary truncate">
          {sessionTitle}
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center space-x-1">
        <button
          type="button"
          onClick={onNewChat}
          className="p-1 rounded-lg text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-all cursor-pointer"
          title="开启新会话"
        >
          <Plus className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onOpenHistory}
          className="p-1 rounded-lg text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-all cursor-pointer"
          title="查看历史记录"
        >
          <History className="w-4 h-4" />
        </button>
        
        <Link 
          to="/settings"
          className="p-1 rounded-lg text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-all cursor-pointer flex items-center justify-center"
          title="设置"
        >
          <MoreHorizontal className="w-4 h-4" />
        </Link>

        {onClose && (
          <button 
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-all cursor-pointer"
            title="关闭当前视图"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatHeader;
