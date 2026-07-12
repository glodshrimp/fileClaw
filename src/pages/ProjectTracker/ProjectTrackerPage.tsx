import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Archive,
  Search,
  Activity,
  Import,
  FileSpreadsheet,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { ProjectTrack, GlobalTodo } from '../../types';
import ProjectCard from './components/ProjectCard';
import ProjectModal from './components/ProjectModal';
import DeleteConfirmModal from '../../components/DeleteConfirmModal';

const ProjectTrackerPage: React.FC = () => {
  const { state, dispatch } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState<ProjectTrack | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [extractText, setExtractText] = useState('');
  const [newTodoContent, setNewTodoContent] = useState('');
  const [quickInputState, setQuickInputState] = useState<Record<string, { todo: string; update: string }>>({});
  const [searchParams] = useSearchParams();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'track' | 'todo' } | null>(null);

  useEffect(() => {
    const search = searchParams.get('search');
    if (search) {
      setSearchQuery(search);
    }
  }, [searchParams]);

  const [formData, setFormData] = useState<Partial<ProjectTrack>>({
    name: '',
    location: '',
    priority: 2,
    status: 'IN_PROGRESS',
    timeframe: '',
    overview: '',
    todos: [],
    factors: [],
    updates: [],
    archived: false
  });

  // Filtered tracks
  const filteredTracks = useMemo(() => {
    return state.tracks.filter(track => {
      const matchesSearch = track.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        track.overview.toLowerCase().includes(searchQuery.toLowerCase()) ||
        track.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (track.projectId && track.projectId.toLowerCase().includes(searchQuery.toLowerCase()));
      const isArchived = track.archived === true;
      const matchesStatus = showArchived ? isArchived : !isArchived;
      return matchesSearch && matchesStatus;
    });
  }, [state.tracks, searchQuery, showArchived]);

  const resetForm = () => {
    setFormData({
      name: '',
      location: '',
      priority: 2,
      status: 'IN_PROGRESS',
      timeframe: '',
      overview: '',
      todos: [],
      factors: [],
      updates: [],
      archived: false
    });
    setEditingTrack(null);
    setExtractText('');
  };

  const handleOpenModal = (track?: ProjectTrack) => {
    if (track) {
      setEditingTrack(track);
      setFormData(track);
    } else {
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleSaveTrack = async () => {
    if (!formData.name) return;

    try {
      if (editingTrack) {
        const updatedTrack = { ...editingTrack, ...formData };
        // @ts-ignore
        await window.electronAPI.updateTrack(editingTrack.id, updatedTrack);
        dispatch({ type: 'UPDATE_TRACK', payload: updatedTrack as ProjectTrack });
      } else {
        const newTrack = {
          ...formData,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // @ts-ignore
        const savedTrack = await window.electronAPI.addTrack(newTrack);
        dispatch({ type: 'ADD_TRACK', payload: savedTrack });
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      console.error('Failed to save track:', err);
    }
  };

  const handleToggleArchive = async (track: ProjectTrack) => {
    try {
      const updated = { ...track, archived: !track.archived };
      // @ts-ignore
      await window.electronAPI.updateTrack(track.id, updated);
      dispatch({ type: 'UPDATE_TRACK', payload: updated });
    } catch (err) {
      console.error('Failed to toggle archive:', err);
    }
  };

  const handleQuickAddTodo = async (track: ProjectTrack) => {
    const input = quickInputState[track.id]?.todo || '';
    if (!input.trim()) return;

    try {
      const newTodo = {
        id: Date.now().toString(),
        content: input.trim(),
        completed: false
      };
      const updated = {
        ...track,
        todos: [...track.todos, newTodo],
        updatedAt: new Date().toISOString()
      };
      // @ts-ignore
      await window.electronAPI.updateTrack(track.id, updated);
      dispatch({ type: 'UPDATE_TRACK', payload: updated });
      setQuickInputState(prev => ({
        ...prev,
        [track.id]: { ...prev[track.id], todo: '' }
      }));
    } catch (err) {
      console.error('Failed to quick add todo:', err);
    }
  };

  const handleQuickUpdate = async (track: ProjectTrack) => {
    const input = quickInputState[track.id]?.update || '';
    if (!input.trim()) return;

    try {
      const newUpdate = {
        id: Date.now().toString(),
        content: input.trim(),
        timestamp: new Date().toISOString()
      };
      const updated = {
        ...track,
        updates: [newUpdate, ...track.updates],
        updatedAt: new Date().toISOString()
      };
      // @ts-ignore
      await window.electronAPI.updateTrack(track.id, updated);
      dispatch({ type: 'UPDATE_TRACK', payload: updated });
      setQuickInputState(prev => ({
        ...prev,
        [track.id]: { ...prev[track.id], update: '' }
      }));
    } catch (err) {
      console.error('Failed to quick add update:', err);
    }
  };

  const handleDeleteTrackClick = (id: string) => {
    setDeleteTarget({ id, type: 'track' });
  };

  const handleDeleteGlobalTodoClick = (id: string) => {
    setDeleteTarget({ id, type: 'todo' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, type } = deleteTarget;
    try {
      if (type === 'track') {
        // @ts-ignore
        await window.electronAPI.deleteTrack(id);
        dispatch({ type: 'DELETE_TRACK', payload: id });
      } else {
        // @ts-ignore
        await window.electronAPI.deleteGlobalTodo(id);
        dispatch({ type: 'DELETE_GLOBAL_TODO', payload: id });
      }
    } catch (err) {
      console.error(`Failed to delete ${type}:`, err);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleAddGlobalTodo = async () => {
    if (!newTodoContent.trim()) return;
    try {
      const newTodo = {
        content: newTodoContent,
        completed: false,
        createdAt: new Date().toISOString()
      };
      // @ts-ignore
      const savedTodo = await window.electronAPI.addGlobalTodo(newTodo);
      dispatch({ type: 'ADD_GLOBAL_TODO', payload: savedTodo });
      setNewTodoContent('');
    } catch (err) {
      console.error('Failed to add global todo:', err);
    }
  };

  const handleToggleGlobalTodo = async (todo: GlobalTodo) => {
    try {
      const updated = { ...todo, completed: !todo.completed };
      // @ts-ignore
      await window.electronAPI.updateGlobalTodo(todo.id, updated);
      dispatch({ type: 'UPDATE_GLOBAL_TODO', payload: updated });
    } catch (err) {
      console.error('Failed to toggle global todo:', err);
    }
  };

  // Deleted handleDeleteGlobalTodo as it was merged into handleConfirmDelete

  const runAnalysis = () => {
    if (!extractText) return;

    const lines = extractText.split('\n');
    const newDraft = { ...formData, todos: [...(formData.todos || [])], updates: [...(formData.updates || [])] };

    // Regex for various fields
    const nameRegex = /^(项目|项目名称|名称)[\s:：]+(.+)$/i;
    const locationRegex = /^(地点|归属地|位置)[\s:：]+(.+)$/i;
    const priorityRegex = /^(优先级|控制级别)[\s:：]+(.+)$/i;
    const timeframeRegex = /^(时间|周期|运营周期)[\s:：]+(.+)$/i;
    const overviewRegex = /^(概览|描述|简介)[\s:：]+(.+)$/i;
    const updateRegex = /^(更新|进展|进展记录|记录)[\s:：]+(.+)$/i;
    // Bullet points like: - [ ], [ ], 1., *, +
    const todoRegex = /^[-*+•\d.)\s]*\[\s*([xX\s]?)\s*\]\s*(.+)$/;
    const simpleTodoRegex = /^[-*+•\d.)\s]+(.+)$/;

    let inTodosSection = false;
    let inUpdatesSection = false;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Check section headers
      if (trimmed.match(/^(待办事项|任务清单|TODOS)[:：]?$/i)) {
        inTodosSection = true;
        inUpdatesSection = false;
        return;
      }
      if (trimmed.match(/^(进展历史|历史记录|UPDATES)[:：]?$/i)) {
        inUpdatesSection = true;
        inTodosSection = false;
        return;
      }

      // Match basic fields
      let match;
      if ((match = trimmed.match(nameRegex))) {
        newDraft.name = match[2].trim();
      } else if ((match = trimmed.match(locationRegex))) {
        newDraft.location = match[2].trim();
      } else if ((match = trimmed.match(priorityRegex))) {
        const p = match[2].toLowerCase();
        if (p.includes('p0') || p.includes('紧急') || p.includes('特急')) newDraft.priority = 3;
        else if (p.includes('p1') || p.includes('高')) newDraft.priority = 2;
        else if (p.includes('p2') || p.includes('中')) newDraft.priority = 1;
        else if (p.includes('p3') || p.includes('低')) newDraft.priority = 0;
      } else if ((match = trimmed.match(timeframeRegex))) {
        newDraft.timeframe = match[2].trim();
      } else if ((match = trimmed.match(overviewRegex))) {
        newDraft.overview = match[2].trim();
      } else if ((match = trimmed.match(updateRegex))) {
        newDraft.updates = [{ id: Date.now().toString() + Math.random(), content: match[2].trim(), timestamp: new Date().toISOString() }, ...(newDraft.updates || [])];
      } else if ((match = trimmed.match(todoRegex))) {
        const completed = match[1].toLowerCase() === 'x';
        newDraft.todos = [...(newDraft.todos || []), { id: Date.now().toString() + Math.random(), content: match[2].trim(), completed }];
      } else if (inTodosSection && (match = trimmed.match(simpleTodoRegex))) {
        newDraft.todos = [...(newDraft.todos || []), { id: Date.now().toString() + Math.random(), content: match[1].trim(), completed: false }];
      } else if (inUpdatesSection) {
        newDraft.updates = [{ id: Date.now().toString() + Math.random(), content: trimmed, timestamp: new Date().toISOString() }, ...(newDraft.updates || [])];
      }
    });

    setFormData(newDraft);
    alert('分析完成！已识别到的字段已填充到表单。提示：可以使用 "项目: 名称" 或 "待办事项:" 后接列表等格式。');
  };

  return (
    <div className="flex h-full gap-6 overflow-hidden">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Activity className="w-8 h-8 text-[var(--neon-green)]" />
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">项目追踪器 // NEXUS</h1>
          </div>
          <div className="flex items-center space-x-3">
            <div className="relative mr-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                placeholder="全局搜索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 xl:w-64 pl-10 pr-4 py-1.5 bg-background border border-border rounded-lg text-sm focus:ring-1 focus:ring-[var(--neon-green)] outline-none transition-all"
              />
            </div>
            <button className="btn-nexus py-1.5 px-3 flex items-center space-x-2 text-sm">
              <Import className="w-4 h-4" />
              <span>导入</span>
            </button>
            <button className="btn-nexus-blue py-1.5 px-3 flex items-center space-x-2 text-sm">
              <FileSpreadsheet className="w-4 h-4" />
              <span>导出</span>
            </button>
            <button
              onClick={() => handleOpenModal()}
              className="btn-nexus-blue py-1.5 px-4 flex items-center space-x-2 text-sm shadow-lg shadow-[var(--neon-blue)]/20"
            >
              <Plus className="w-4 h-4" />
              <span>新建</span>
            </button>
          </div>
        </div>

        {/* Board Header */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center space-x-4">
            <h2 className={`text-lg font-bold tracking-tighter ${showArchived ? 'text-text-tertiary' : 'text-text-primary underline decoration-[var(--neon-green)] decoration-2 underline-offset-4'}`}>
              {showArchived ? '历史归档 // ARCHIVE' : '正在进行 // ACTIVE'}
            </h2>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${showArchived
                ? 'bg-[var(--neon-green)] text-black shadow-[0_0_20px_var(--neon-green)]'
                : 'btn-nexus border-border text-text-tertiary'
                }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>{showArchived ? '查看活跃任务' : '查看过往归档'}</span>
            </button>
            <div className="h-4 w-[1px] bg-border mx-1"></div>
            <div className="text-xs font-mono text-text-tertiary uppercase tracking-widest">
              总计: <span className="text-[var(--neon-green)] font-bold">{filteredTracks.length}</span> 个项
            </div>
          </div>
        </div>

        {/* Board Grid */}
        <div className="flex-1 overflow-y-auto pr-2 -mr-2 scrollbar-thin">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pb-10">
            {filteredTracks.map(track => (
              <ProjectCard
                key={track.id}
                track={track}
                onArchive={handleToggleArchive}
                onEdit={handleOpenModal}
                onDelete={handleDeleteTrackClick}
                onQuickAddTodo={handleQuickAddTodo}
                onQuickUpdate={handleQuickUpdate}
                quickInputState={quickInputState}
                setQuickInputState={setQuickInputState}
              />
            ))}

            {filteredTracks.length === 0 && (
              <div className="col-span-full py-32 flex flex-col items-center justify-center text-text-tertiary bg-background-secondary/30 border border-dashed border-border rounded-3xl">
                <Activity className="w-16 h-16 mb-4 opacity-10 animate-pulse" />
                <p className="text-sm font-mono uppercase tracking-[0.2em] opacity-40">未检测到追踪对象</p>
                <button
                  onClick={() => handleOpenModal()}
                  className="mt-6 text-[var(--neon-green)] hover:underline text-xs font-bold"
                >
                  初始化新追踪项目 +
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar - Global Todo */}
      <aside className="w-80 flex flex-shrink-0 flex-col bg-background border border-border rounded-2xl overflow-hidden shadow-2xl shadow-black/5">
        <div className="p-5 border-b border-border bg-background-secondary/30 flex items-center justify-between">
          <h3 className="font-bold text-text-primary flex items-center space-x-3">
            <div className="p-1.5 bg-[var(--neon-green)]/10 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-[var(--neon-green)]" />
            </div>
            <span className="tracking-tight italic uppercase font-mono text-sm">全局 // 待办事项</span>
          </h3>
          <span className="text-[10px] font-mono bg-[var(--neon-green)] text-black px-2 py-0.5 rounded-full shadow-lg shadow-[var(--neon-green)]/20">
            {state.globalTodos.filter(t => !t.completed).length}
          </span>
        </div>

        <div className="p-4 border-b border-border bg-background-secondary/10">
          <div className="relative group">
            <input
              type="text"
              placeholder="添加全局事项 (回车保存)..."
              value={newTodoContent}
              onChange={(e) => setNewTodoContent(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddGlobalTodo()}
              className="w-full pl-4 pr-10 py-2.5 bg-background border border-border rounded-xl text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-text-tertiary/50"
            />
            <button
              onClick={handleAddGlobalTodo}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-tertiary hover:text-primary transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-none">
          {state.globalTodos.map(todo => (
            <div
              key={todo.id}
              className={`group flex items-start space-x-3 p-3 rounded-xl border transition-all ${todo.completed
                ? 'bg-background-secondary/30 border-transparent opacity-60'
                : 'bg-background border-border hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5'
                }`}
            >
              <button
                onClick={() => handleToggleGlobalTodo(todo)}
                className={`mt-0.5 p-0.5 rounded-md border transition-colors ${todo.completed ? 'bg-functional-success border-functional-success text-white' : 'border-border text-transparent hover:border-primary'
                  }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <span className={`flex-1 text-xs leading-relaxed transition-all ${todo.completed ? 'line-through text-text-tertiary' : 'text-text-secondaryFont'}`}>
                {todo.content}
              </span>
              <button
                onClick={() => handleDeleteGlobalTodoClick(todo.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover-gradient-danger rounded text-functional-error transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {state.globalTodos.length === 0 && (
            <div className="text-center py-20 flex flex-col items-center opacity-20">
              <CheckCircle2 className="w-10 h-10 mb-2" />
              <p className="text-[10px] font-mono uppercase tracking-widest italic">Clear of all obstacles</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border bg-background-secondary/20">
          <div className="flex items-center justify-between text-[10px] font-mono text-text-tertiary uppercase tracking-tighter">
            <span>工作效率: 100%</span>
            <span>系统状态: 正常</span>
          </div>
        </div>
      </aside>

      <ProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveTrack}
        editingTrack={editingTrack}
        formData={formData}
        setFormData={setFormData}
        onRunAnalysis={runAnalysis}
        extractText={extractText}
        setExtractText={setExtractText}
        projects={state.projects}
      />

      <DeleteConfirmModal
        isOpen={deleteTarget !== null}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title={deleteTarget?.type === 'track' ? "确定要删除这个追踪项目吗？" : "确定要删除这个待办事项吗？"}
        description={deleteTarget?.type === 'track' 
          ? "此操作将永久从数据库中移除该项目的全部追踪进度和状态，且无法恢复。"
          : "此操作将永久从数据库中移除该全局待办任务记录，且无法恢复。"
        }
      />
    </div>
  );
};

export default ProjectTrackerPage;
