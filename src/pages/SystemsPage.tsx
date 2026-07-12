import React, { useState } from 'react';
import { Globe, Plus, ExternalLink, Edit2, Trash2, Copy } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { OnlineSystem } from '../types';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { copyToClipboard } from '../utils/copy';

const SystemsPage: React.FC = () => {
  const { state, dispatch } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingSystem, setEditingSystem] = useState<OnlineSystem | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    description: '',
    tags: '',
  });

  const handleOpenUrl = (url: string) => {
    window.open(url, '_blank');
  };

  const handleCopyUrl = (url: string, e: React.MouseEvent) => {
    copyToClipboard(url, e);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const systemData: OnlineSystem = {
      id: editingSystem?.id || Date.now().toString(),
      name: formData.name,
      url: formData.url,
      description: formData.description,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      createdAt: editingSystem?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // @ts-ignore
      if (editingSystem) {
        await window.electronAPI?.updateSystem(editingSystem.id, systemData);
        dispatch({ type: 'UPDATE_SYSTEM', payload: systemData });
      } else {
        await window.electronAPI?.addSystem(systemData);
        dispatch({ type: 'ADD_SYSTEM', payload: systemData });
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      console.error('Failed to save system:', error);
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
      await window.electronAPI?.deleteSystem(deleteTargetId);
      dispatch({ type: 'DELETE_SYSTEM', payload: deleteTargetId });
    } catch (error) {
      console.error('Failed to delete system:', error);
    } finally {
      setIsDeleteModalOpen(false);
      setDeleteTargetId(null);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', url: '', description: '', tags: '' });
    setEditingSystem(null);
  };

  const openEditModal = (system: OnlineSystem) => {
    setEditingSystem(system);
    setFormData({
      name: system.name,
      url: system.url,
      description: system.description,
      tags: system.tags.join(', '),
    });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <input
              type="text"
              placeholder="搜索系统..."
              className="w-64 pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          </div>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>新增系统</span>
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {state.systems.length === 0 ? (
          <div className="bg-white rounded-lg p-12 text-center col-span-2">
            <Globe className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-text-secondary">暂无系统，点击上方按钮添加第一个系统</p>
          </div>
        ) : (
          state.systems.map((system) => (
            <div
              key={system.id}
              className="bg-white rounded-lg p-6 shadow-sm hover:shadow-md transition-all border border-gray-100 card-hover"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Globe className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-text-primary">{system.name}</h3>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleOpenUrl(system.url)}
                    className="p-2 hover-gradient-primary rounded-lg text-text-secondary"
                    title="访问系统"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleCopyUrl(system.url, e)}
                    className="p-2 hover-gradient-primary rounded-lg text-text-secondary"
                    title="复制URL"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEditModal(system)}
                    className="p-2 hover-gradient-primary rounded-lg text-text-secondary"
                    title="编辑"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteClick(system.id)}
                    className="p-2 hover-gradient-danger rounded-lg text-functional-error"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-text-secondary text-sm mb-3">{system.description}</p>
              <div className="flex items-center justify-between">
                <div className="flex space-x-1 flex-wrap gap-1">
                  {system.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-text-tertiary">
                  {new Date(system.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-lg animate-fade-in flex flex-col max-h-[90vh]">
            <div className="p-6 pb-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="text-lg font-semibold">
                {editingSystem ? '编辑系统' : '新增系统'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto scrollbar-thin space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">系统名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-base"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">URL</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="input-base"
                  required
                />
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
                  placeholder="后台管理, 内部系统"
                />
              </div>
              </div>
              <div className="p-6 pt-4 border-t border-gray-100 flex-shrink-0 flex justify-end space-x-3 bg-white rounded-b-lg">
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

      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setIsDeleteModalOpen(false);
          setDeleteTargetId(null);
        }}
        title="确定要删除这个系统吗？"
        description="删除系统后，关联的账号凭证信息也将一并清除，且无法恢复。"
      />
    </div>
  );
};

export default SystemsPage;
