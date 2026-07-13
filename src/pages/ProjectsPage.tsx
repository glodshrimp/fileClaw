import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Plus, ExternalLink, Edit2, Trash2, Globe, Activity, Code } from 'lucide-react';
import ProjectSystemsDrawer from '../components/project/ProjectSystemsDrawer';
import { useApp } from '../contexts/AppContext';
import { Project } from '../types';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { useWorkspaceStore } from '../contexts/useWorkspaceStore';

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [managingProject, setManagingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    path: '',
    description: '',
    tags: '',
    codePath: '',
  });

  const handleOpenProject = (path: string) => {
    // @ts-ignore
    window.electronAPI?.openDirectory(path);
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const projectData: Project = {
      id: editingProject?.id || Date.now().toString(),
      name: formData.name,
      path: formData.path,
      description: formData.description,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      codePath: formData.codePath,
      createdAt: editingProject?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // @ts-ignore
      if (editingProject) {
        await window.electronAPI?.updateProject(editingProject.id, projectData);
        dispatch({ type: 'UPDATE_PROJECT', payload: projectData });
        
        // Update active workspace if the edited project is the current project
        const activeProj = useWorkspaceStore.getState().currentProject;
        if (activeProj && activeProj.id === editingProject.id) {
          useWorkspaceStore.setState({ currentProject: projectData });
        }
      } else {
        await window.electronAPI?.addProject(projectData);
        dispatch({ type: 'ADD_PROJECT', payload: projectData });
        
        const shouldInit = confirm('新建项目成功！是否按雅安审计默认模板初始化此项目目录结构？');
        if (shouldInit) {
          try {
            // @ts-ignore
            const res = await window.electronAPI?.initProjectDirectory(projectData.path);
            if (res && !res.success) {
              alert('初始化目录失败: ' + res.error);
            }
          } catch (err) {
            console.error('Failed to init directory:', err);
            alert('初始化目录时发生错误');
          }
        }
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      console.error('Failed to save project:', error);
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteTargetId(id);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      // @ts-ignore
      await window.electronAPI?.deleteProject(deleteTargetId);
      dispatch({ type: 'DELETE_PROJECT', payload: deleteTargetId });

      // Clear workspace if the deleted project is currently active
      const activeProj = useWorkspaceStore.getState().currentProject;
      if (activeProj && activeProj.id === deleteTargetId) {
        useWorkspaceStore.getState().setCurrentProject(null);
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setIsDeleteModalOpen(false);
      setDeleteTargetId(null);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', path: '', description: '', tags: '', codePath: '' });
    setEditingProject(null);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      path: project.path,
      description: project.description,
      tags: project.tags.join(', '),
      codePath: project.codePath || '',
    });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <input
              type="text"
              placeholder="搜索项目..."
              className="input-base w-64 pl-10 pr-4"
            />
            <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          </div>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-nexus-blue flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>新增项目</span>
        </button>
      </div>

      {/* 项目列表 */}
      {/* 项目列表 */}
      <div className="flex flex-wrap gap-6">
        {state.projects.length === 0 ? (
          <div className="bg-background-secondary border border-border rounded-lg p-12 text-center w-full">
            <FolderOpen className="w-16 h-16 mx-auto mb-4 text-text-tertiary/30" />
            <p className="text-text-secondary">暂无项目，点击上方按钮添加第一个项目</p>
          </div>
        ) : (
          state.projects.map((project) => (
            <div
              key={project.id}
              className="bg-card border border-border rounded-lg p-6 card-hover shadow-sm flex-1 min-w-[300px] max-w-full 2xl:max-w-[calc(25%-1.2rem)]"
            >
              <div className="flex flex-col items-start justify-between gap-4 h-full">
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-text-primary truncate">{project.name}</h3>
                    <div className="flex flex-wrap gap-1">
                      {project.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full whitespace-nowrap"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-text-secondary mb-3 break-words line-clamp-2">{project.description}</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-text-tertiary">
                    <span className="font-mono bg-background-secondary dark:bg-background-tertiary/30 border border-border px-2 py-0.5 rounded text-xs truncate max-w-full">
                      {project.path}
                    </span>
                    <span className="hidden xl:inline">•</span>
                    <span className="whitespace-nowrap">更新于 {new Date(project.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 flex-shrink-0 w-full xl:w-auto justify-end">
                  <button
                    onClick={() => navigate(`/workspace/${project.id}`)}
                    className="p-2 hover-gradient-primary rounded-lg text-primary"
                    title="进入开发工作区"
                  >
                    <Code className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleOpenProject(project.path)}
                    className="p-2 hover-gradient-primary rounded-lg text-text-secondary"
                    title="打开目录"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setManagingProject(project)}
                    className="p-2 hover-gradient-primary rounded-lg text-primary"
                    title="管理系统与账号"
                  >
                    <Globe className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => navigate(`/tracking?search=${encodeURIComponent(project.id)}`)}
                    className="p-2 hover-gradient-primary rounded-lg text-[var(--neon-green)]"
                    title="项目追踪"
                  >
                    <Activity className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEditModal(project)}
                    className="p-2 hover-gradient-primary rounded-lg text-text-secondary"
                    title="编辑"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteClick(project.id)}
                    className="p-2 hover-gradient-danger rounded-lg text-functional-error"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl w-full max-w-lg shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-border/50 flex-shrink-0">
              <h3 className="text-xl font-bold text-text-primary">
                {editingProject ? '编辑项目' : '新增项目'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto scrollbar-thin space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">项目名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-base"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">项目路径</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={formData.path}
                    onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                    className="input-base flex-1"
                    required
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        // @ts-ignore
                        const path = await window.electronAPI?.selectDirectory();
                        if (path) {
                          setFormData({ ...formData, path: path });
                        }
                      } catch (err) {
                        console.error('Failed to select directory:', err);
                      }
                    }}
                    className="btn-secondary px-4 flex-shrink-0"
                  >
                    选择目录
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">开发代码目录 (可选，为空时默认使用项目路径)</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={formData.codePath}
                    onChange={(e) => setFormData({ ...formData, codePath: e.target.value })}
                    className="input-base flex-1"
                    placeholder="例如: /Users/.../workspace-src"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        // @ts-ignore
                        const path = await window.electronAPI?.selectDirectory();
                        if (path) {
                           setFormData({ ...formData, codePath: path });
                        }
                      } catch (err) {
                        console.error('Failed to select code directory:', err);
                      }
                    }}
                    className="btn-secondary px-4 flex-shrink-0"
                  >
                    选择目录
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-base"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">标签（用逗号分隔）</label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="input-base"
                  placeholder="前端, React, Electron"
                />
              </div>
              </div>
              <div className="px-6 py-4 border-t border-border/50 flex-shrink-0 flex justify-end space-x-3 bg-background rounded-b-xl">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ProjectSystemsDrawer
        project={managingProject}
        onClose={() => setManagingProject(null)}
      />

      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setIsDeleteModalOpen(false);
          setDeleteTargetId(null);
        }}
        title="确定要删除这个项目吗？"
        description="此操作将从数据库中移除项目记录。注意：本地物理目录将不会被删除。"
      />
    </div>
  );
};

export default ProjectsPage;
