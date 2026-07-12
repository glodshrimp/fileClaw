import React, { useState } from 'react';
import {
  Archive,
  MapPin,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Trash2,
  RotateCcw,
  Send,
  Plus,
  ListTodo,
  History
} from 'lucide-react';
import { ProjectTrack } from '../../../types';

interface ProjectCardProps {
  track: ProjectTrack;
  onArchive: (track: ProjectTrack) => void;
  onEdit: (track: ProjectTrack) => void;
  onDelete: (id: string) => void;
  onQuickAddTodo: (track: ProjectTrack) => void;
  onQuickUpdate: (track: ProjectTrack) => void;
  quickInputState: Record<string, { todo: string; update: string }>;
  setQuickInputState: React.Dispatch<React.SetStateAction<Record<string, { todo: string; update: string }>>>;
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  track,
  onArchive,
  onEdit,
  onDelete,
  onQuickAddTodo,
  onQuickUpdate,
  quickInputState,
  setQuickInputState
}) => {
  const [showAllUpdates, setShowAllUpdates] = useState(false);

  const getPriorityInfo = (p: number) => {
    switch (p) {
      case 3: return { label: 'P0 - 极度紧急', color: 'text-functional-error bg-functional-error/10 border-functional-error/20' };
      case 2: return { label: 'P1 - 高优先级', color: 'text-orange-500 bg-orange-500/10 border-orange-500/20' };
      case 1: return { label: 'P2 - 普通', color: 'text-primary bg-primary/10 border-primary/20' };
      default: return { label: 'P3 - 低优先级', color: 'text-functional-success bg-functional-success/10 border-functional-success/20' };
    }
  };

  const pInfo = getPriorityInfo(track.priority);

  return (
    <div
      className="group bg-background border border-border rounded-xl p-5 hover:border-[var(--neon-green)]/40 hover:shadow-xl hover:shadow-[var(--neon-green)]/5 transition-all duration-300 relative overflow-hidden"
    >
      {/* Priority Bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${pInfo.color.split(' ')[2].replace('border-', 'bg-')}`}></div>

      <div className="flex justify-between items-start mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-tighter ${pInfo.color}`}>
              {pInfo.label.split(' - ')[0]}
            </span>
            <span className="text-[10px] font-mono text-text-tertiary uppercase">
              ID: {track.id.slice(0, 8)}
            </span>
          </div>
          <h3 className="text-lg font-bold text-text-primary truncate group-hover:text-[var(--neon-green)] transition-colors">
            {track.name}
          </h3>
        </div>
        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onArchive(track)}
            className={`p-1.5 rounded-lg transition-colors ${track.archived
              ? 'hover-gradient-primary text-[var(--neon-green)]'
              : 'hover-gradient-primary text-text-tertiary'
              }`}
            title={track.archived ? '恢复到待办' : '归档项目'}
          >
            {track.archived ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onEdit(track)}
            className="p-1.5 hover-gradient-primary rounded-lg text-text-tertiary"
            title="编辑"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(track.id)}
            className="p-1.5 hover-gradient-danger rounded-lg text-functional-error"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="flex items-center space-x-2 text-xs text-text-secondary bg-background-secondary/50 px-2 py-1.5 rounded-lg">
          <MapPin className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="truncate">{track.location}</span>
        </div>
        <div className="flex items-center space-x-2 text-xs text-text-secondary bg-background-secondary/50 px-2 py-1.5 rounded-lg">
          <Calendar className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="truncate">{track.timeframe}</span>
        </div>
      </div>

      <p className="text-sm text-text-secondary line-clamp-2 mb-4 italic leading-relaxed">
        {track.overview}
      </p>

      {/* Timeline & Quick Todo Preview */}
      <div className="space-y-3 mb-4">
        {track.updates.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-mono text-text-tertiary uppercase flex items-center space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--neon-green)]"></span>
                <span>{showAllUpdates ? '全时追踪 // TIMELINE' : '最新进展 // UPDATE'}</span>
              </p>
              <button 
                onClick={() => setShowAllUpdates(!showAllUpdates)}
                className={`p-1 rounded hover:bg-background-secondary transition-colors ${showAllUpdates ? 'text-[var(--neon-green)]' : 'text-text-tertiary'}`}
                title={showAllUpdates ? '折叠' : '查看历史进展'}
              >
                <History className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <div className={`space-y-4 ${showAllUpdates ? 'max-h-48 overflow-y-auto pr-2 scrollbar-thin' : ''}`}>
              {(showAllUpdates ? track.updates : [track.updates[0]]).map((update, idx) => (
                <div key={update.id} className="relative pl-4 border-l border-[var(--neon-green)]/20 py-0.5">
                  <div className="absolute left-[-4.5px] top-2 w-2 h-2 rounded-full bg-[var(--neon-green)]/40"></div>
                  <p className="text-[9px] font-mono text-text-tertiary uppercase mb-0.5 flex items-center justify-between">
                    <span>{new Date(update.timestamp).toLocaleDateString()} {new Date(update.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  <p className="text-xs text-text-primary leading-relaxed">{update.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Update Input */}
        <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="快速记录进展..."
              value={quickInputState[track.id]?.update || ''}
              onChange={(e) => setQuickInputState(prev => ({
                ...prev,
                [track.id]: { ...prev[track.id], update: e.target.value }
              }))}
              onKeyDown={(e) => e.key === 'Enter' && onQuickUpdate(track)}
              className="w-full bg-background border border-[var(--neon-green)]/20 rounded-md py-1.5 px-3 text-xs text-[var(--neon-green)] placeholder:text-[var(--neon-green)]/20 focus:outline-none focus:border-[var(--neon-green)] focus:ring-1 focus:ring-[var(--neon-green)]/10 transition-all font-mono"
            />
          </div>
          <button
            onClick={() => onQuickUpdate(track)}
            className="p-1 hover:bg-[var(--neon-green)]/10 rounded transition-colors text-[var(--neon-green)]/60 hover:text-[var(--neon-green)]"
            title="发布进展"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-1">
          {track.todos.slice(0, 2).map(todo => (
            <div key={todo.id} className="flex items-center space-x-2 text-[11px] text-text-tertiary">
              <div className={`p-0.5 rounded border ${todo.completed ? 'bg-functional-success border-functional-success text-white' : 'border-border text-transparent'}`}>
                <CheckCircle2 className="w-2.5 h-2.5" />
              </div>
              <span className={`${todo.completed ? 'line-through opacity-50' : ''} truncate`}>{todo.content}</span>
            </div>
          ))}

          {/* Quick Todo Input */}
          <div className="flex items-center space-x-2 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="新增待办..."
                value={quickInputState[track.id]?.todo || ''}
                onChange={(e) => setQuickInputState(prev => ({
                  ...prev,
                  [track.id]: { ...prev[track.id], todo: e.target.value }
                }))}
                onKeyDown={(e) => e.key === 'Enter' && onQuickAddTodo(track)}
                className="w-full bg-background border border-[var(--neon-green)]/20 rounded-md py-1.5 px-3 text-xs text-[var(--neon-green)] placeholder:text-[var(--neon-green)]/20 focus:outline-none focus:border-[var(--neon-green)] focus:ring-1 focus:ring-[var(--neon-green)]/10 transition-all pl-8 font-mono"
              />
              <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
            </div>
            <button
              onClick={() => onQuickAddTodo(track)}
              className="p-1 hover:bg-[var(--neon-green)]/10 rounded transition-colors text-[var(--neon-green)]/60 hover:text-[var(--neon-green)]"
              title="添加待办"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-border/50">
        <div className="flex -space-x-1">
          {track.factors.slice(0, 3).map((f, i) => (
            <span key={i} className="px-2 py-0.5 bg-background-secondary border border-border rounded text-[10px] text-text-tertiary uppercase font-bold tracking-tighter">
              {f}
            </span>
          ))}
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1 text-[10px] font-bold text-text-tertiary uppercase">
            <ListTodo className="w-3 h-3" />
            <span>{track.todos.filter(t => t.completed).length}/{track.todos.length}</span>
          </div>
          <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest border border-current ${track.status === 'BLOCKED' ? 'text-functional-error' :
            track.status === 'IN_PROGRESS' ? 'text-[var(--neon-green)]' :
              'text-functional-success'
            }`}>
            {track.status === 'PLANNING' ? '规划中' :
              track.status === 'IN_PROGRESS' ? '进行中' :
                track.status === 'BLOCKED' ? '已阻塞' : '已完成'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectCard;
