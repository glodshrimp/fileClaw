import React from 'react';
import {
  Activity,
  Clock,
  Plus,
  Bot,
  MapPin,
  AlertCircle,
  Tag,
  ListTodo,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { Project, ProjectTrack } from '../../../types';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingTrack: ProjectTrack | null;
  formData: Partial<ProjectTrack>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<ProjectTrack>>>;
  onRunAnalysis: () => void;
  extractText: string;
  setExtractText: (text: string) => void;
  projects: Project[];
}

const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingTrack,
  formData,
  setFormData,
  onRunAnalysis,
  extractText,
  setExtractText,
  projects
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-primary/20 rounded-2xl w-full max-w-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden animate-in fade-in zoom-in duration-300 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-border bg-background-secondary/30 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-xl font-bold text-text-primary italic font-mono tracking-widest flex items-center space-x-2">
              <Activity className="w-5 h-5 text-primary" />
              <span>{editingTrack ? '重新配置 // SECTOR' : '初始化 // 新项目'}</span>
            </h3>
            <p className="text-[10px] text-text-tertiary font-mono flex items-center space-x-1 mt-1">
              <Clock className="w-3 h-3" />
              <span>时间戳: {new Date().toISOString()}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-background-secondary rounded-xl text-text-tertiary hover:text-primary transition-all rotate-0 hover:rotate-90"
          >
            <Plus className="w-8 h-8 rotate-45" />
          </button>
        </div>

        <div className="p-8 overflow-y-auto scrollbar-thin flex-1">
          {/* Auto Extract Section */}
          <div className="mb-10 p-6 bg-primary/5 border border-primary/20 rounded-2xl relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-1 bg-primary/10 border-b border-l border-primary/20 text-[8px] font-mono text-primary uppercase">Algorithm: V2.4</div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-primary/10 rounded-lg animate-pulse">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <span className="text-xs font-black text-primary uppercase tracking-[0.2em] block">自动提取核心</span>
                  <span className="text-[9px] text-text-tertiary font-mono">神经数据解析器</span>
                </div>
              </div>
              <button
                onClick={onRunAnalysis}
                className="text-[10px] bg-primary text-white font-black px-4 py-2 rounded-lg flex items-center space-x-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/30"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>执行分析</span>
              </button>
            </div>
            <textarea
              placeholder=">_ 输入原始数据流...
示例:
项目: 深度扫描
地点: 上海
优先级: 紧急
周期: 2024-03-01 - 2024-06-01
- [ ] 任务一
- [ ] 任务二
进展: 已完成初步调研"
              value={extractText}
              onChange={(e) => setExtractText(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-sm font-mono text-primary placeholder:text-primary/20 min-h-[120px] resize-none leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="col-span-full">
              <label className="text-xs font-black text-text-tertiary uppercase mb-2 flex items-center space-x-2">
                <Activity className="w-3.5 h-3.5" />
                <span>项目主要名称</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="flex-1 bg-background-secondary border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-bold"
                  placeholder="输入项目标识符..."
                />
                <select
                  value={formData.projectId || ''}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const p = projects.find(proj => proj.id === pid);
                    if (p) {
                      setFormData({
                        ...formData,
                        projectId: pid,
                        name: p.name,
                        overview: p.description
                      });
                    } else {
                      setFormData({ ...formData, projectId: undefined });
                    }
                  }}
                  className="w-48 bg-background-secondary border border-border rounded-xl px-2 py-3 text-xs focus:ring-2 focus:ring-primary/20 outline-none transition-all font-mono"
                >
                  <option value="">-- 关联现有项目 --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="text-xs font-black text-text-tertiary uppercase mb-2 flex items-center space-x-2">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>归属地定位</span>
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full bg-background-secondary border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="全球坐标..."
                />
              </div>
              <div>
                <label className="text-xs font-black text-text-tertiary uppercase mb-2 flex items-center space-x-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>优先级协议</span>
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                  className="w-full bg-background-secondary border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono"
                >
                  <option value={3}>协议 P0 [极度紧急]</option>
                  <option value={2}>协议 P1 [高优先级]</option>
                  <option value={1}>协议 P2 [普通]</option>
                  <option value={0}>协议 P3 [低优先级]</option>
                </select>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="text-xs font-black text-text-tertiary uppercase mb-2 flex items-center space-x-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span>运营周期 (开始 - 结束)</span>
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="date"
                    value={formData.timeframe?.includes(' - ') ? formData.timeframe.split(' - ')[0] : (formData.timeframe || '')}
                    onChange={(e) => {
                      const parts = (formData.timeframe || '').includes(' - ') ? (formData.timeframe || '').split(' - ') : ['', ''];
                      setFormData({
                        ...formData,
                        timeframe: `${e.target.value} - ${parts[1] || ''}`
                      });
                    }}
                    className="flex-1 bg-background-secondary border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--neon-green)]/20 focus:border-[var(--neon-green)] outline-none transition-all font-mono"
                  />
                  <span className="text-text-tertiary">-</span>
                  <input
                    type="date"
                    value={(formData.timeframe || '').includes(' - ') ? (formData.timeframe || '').split(' - ')[1] : ''}
                    onChange={(e) => {
                      const parts = (formData.timeframe || '').includes(' - ') ? (formData.timeframe || '').split(' - ') : ['', ''];
                      setFormData({
                        ...formData,
                        timeframe: `${parts[0] || ''} - ${e.target.value}`
                      });
                    }}
                    className="flex-1 bg-background-secondary border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--neon-green)]/20 focus:border-[var(--neon-green)] outline-none transition-all font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-black text-text-tertiary uppercase mb-2 flex items-center space-x-2">
                  <Tag className="w-3.5 h-3.5" />
                  <span>当前状态</span>
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full bg-background-secondary border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all font-mono"
                >
                  <option value="PLANNING">规划中</option>
                  <option value="IN_PROGRESS">进行中</option>
                  <option value="BLOCKED">已阻塞</option>
                  <option value="COMPLETED">已完成</option>
                </select>
              </div>
            </div>

            <div className="col-span-full space-y-4">
              <div>
                <label className="text-xs font-black text-text-tertiary uppercase mb-2 flex items-center space-x-2">
                  <ListTodo className="w-3.5 h-3.5" />
                  <span>待办事项清单 (格式: [ ] 待办, [x] 完成)</span>
                </label>
                <div className="space-y-2">
                  {formData.todos?.map((todo, idx) => (
                    <div key={todo.id} className="flex items-center space-x-2 group">
                      <button
                        type="button"
                        onClick={() => {
                          const newTodos = [...(formData.todos || [])];
                          newTodos[idx] = { ...todo, completed: !todo.completed };
                          setFormData({ ...formData, todos: newTodos });
                        }}
                        className={`p-1 rounded border ${todo.completed ? 'bg-functional-success border-functional-success text-white' : 'border-border text-transparent'}`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                      </button>
                      <input
                        type="text"
                        value={todo.content}
                        onChange={(e) => {
                          const newTodos = [...(formData.todos || [])];
                          newTodos[idx] = { ...todo, content: e.target.value };
                          setFormData({ ...formData, todos: newTodos });
                        }}
                        className={`flex-1 bg-transparent border-none text-sm outline-none ${todo.completed ? 'line-through text-text-tertiary' : 'text-text-primary'}`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newTodos = formData.todos?.filter((_, i) => i !== idx);
                          setFormData({ ...formData, todos: newTodos });
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-functional-error transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      todos: [...(formData.todos || []), { id: Date.now().toString(), content: '', completed: false }]
                    })}
                    className="text-xs font-bold text-[var(--neon-green)] flex items-center space-x-1 hover:underline"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加待办事项</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-black text-text-tertiary uppercase mb-2 flex items-center space-x-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span>时间线更新 (进展记录)</span>
                </label>
                <div className="space-y-3">
                  {formData.updates?.map((update, idx) => (
                    <div key={update.id} className="flex items-start space-x-3 group bg-background-secondary/30 p-2 rounded-lg">
                      <div className="text-[10px] font-mono text-text-tertiary w-24 pt-1">
                        {new Date(update.timestamp).toLocaleDateString()}
                      </div>
                      <textarea
                        value={update.content}
                        onChange={(e) => {
                          const newUpdates = [...(formData.updates || [])];
                          newUpdates[idx] = { ...update, content: e.target.value };
                          setFormData({ ...formData, updates: newUpdates });
                        }}
                        className="flex-1 bg-transparent border-none text-sm outline-none resize-none overflow-hidden"
                        rows={1}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newUpdates = formData.updates?.filter((_, i) => i !== idx);
                          setFormData({ ...formData, updates: newUpdates });
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-functional-error transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      updates: [{ id: Date.now().toString(), content: '', timestamp: new Date().toISOString() }, ...(formData.updates || [])]
                    })}
                    className="text-xs font-bold text-[var(--neon-green)] flex items-center space-x-1 hover:underline"
                  >
                    <Plus className="w-3 h-3" />
                    <span>新增进展记录</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-border bg-background-secondary/30 flex justify-end space-x-4 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-8 py-3 rounded-xl text-sm font-bold text-text-tertiary hover:text-text-primary transition-colors uppercase tracking-widest"
          >
            放弃 // 取消
          </button>
          <button
            onClick={onSave}
            className="px-12 py-3 btn-nexus text-sm hover:scale-105 active:scale-95 transition-all shadow-xl shadow-[var(--neon-green)]/30 uppercase tracking-[0.2em]"
          >
            提交 // 保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectModal;
