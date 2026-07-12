import React, { useState } from 'react';
import { Key, Plus, Eye, EyeOff, Edit2, Trash2, Copy } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Account } from '../types';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { copyToClipboard } from '../utils/copy';

const AccountsPage: React.FC = () => {
  const { state, dispatch } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    platform: '',
    username: '',
    password: '',
    email: '',
    description: '',
  });

  const togglePasswordVisibility = (id: string) => {
    const newVisible = new Set(visiblePasswords);
    if (newVisible.has(id)) {
      newVisible.delete(id);
    } else {
      newVisible.add(id);
    }
    setVisiblePasswords(newVisible);
  };

  const handleCopy = (text: string, e: React.MouseEvent) => {
    copyToClipboard(text, e);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const accountData: Account = {
      id: editingAccount?.id || Date.now().toString(),
      platform: formData.platform,
      username: formData.username,
      password: formData.password,
      email: formData.email,
      description: formData.description,
      createdAt: editingAccount?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // @ts-ignore
      if (editingAccount) {
        await window.electronAPI?.updateAccount(editingAccount.id, accountData);
        dispatch({ type: 'UPDATE_ACCOUNT', payload: accountData });
      } else {
        await window.electronAPI?.addAccount(accountData);
        dispatch({ type: 'ADD_ACCOUNT', payload: accountData });
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      console.error('Failed to save account:', error);
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
      await window.electronAPI?.deleteAccount(deleteTargetId);
      dispatch({ type: 'DELETE_ACCOUNT', payload: deleteTargetId });
    } catch (error) {
      console.error('Failed to delete account:', error);
    } finally {
      setIsDeleteModalOpen(false);
      setDeleteTargetId(null);
    }
  };

  const resetForm = () => {
    setFormData({ platform: '', username: '', password: '', email: '', description: '' });
    setEditingAccount(null);
  };

  const openEditModal = (account: Account) => {
    setEditingAccount(account);
    setFormData({
      platform: account.platform,
      username: account.username,
      password: account.password,
      email: account.email || '',
      description: account.description,
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
              placeholder="搜索账号..."
              className="w-64 pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          </div>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>新增账号</span>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">平台</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">用户名</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">密码</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">邮箱</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {state.accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <Key className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-text-secondary">暂无账号，点击上方按钮添加第一个账号</p>
                </td>
              </tr>
            ) : (
              state.accounts.map((account) => (
                <tr key={account.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-primary/10 rounded flex items-center justify-center mr-3">
                        <Key className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text-primary">{account.platform}</div>
                        <div className="text-xs text-text-tertiary">{account.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-text-primary">{account.username}</span>
                      <button
                        onClick={(e) => handleCopy(account.username, e)}
                        className="p-1 hover-gradient-primary rounded text-text-tertiary"
                        title="复制"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-mono">
                        {visiblePasswords.has(account.id) ? account.password : '••••••••'}
                      </span>
                      <button
                        onClick={() => togglePasswordVisibility(account.id)}
                        className="p-1 hover-gradient-primary rounded text-text-tertiary"
                        title={visiblePasswords.has(account.id) ? '隐藏' : '显示'}
                      >
                        {visiblePasswords.has(account.id) ? (
                          <EyeOff className="w-3 h-3" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        onClick={(e) => handleCopy(account.password, e)}
                        className="p-1 hover-gradient-primary rounded text-text-tertiary"
                        title="复制"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className="text-sm text-text-secondary"
                      style={{ whiteSpace: 'pre-wrap', display: 'block', maxHeight: '4.5rem', overflowY: 'auto' }}
                    >
                      {account.email || '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => openEditModal(account)}
                        className="p-2 hover-gradient-primary rounded-lg text-text-secondary"
                        title="编辑"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(account.id)}
                        className="p-2 hover-gradient-danger rounded-lg text-functional-error"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-lg animate-fade-in flex flex-col max-h-[90vh]">
            <div className="p-6 pb-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="text-lg font-semibold">
                {editingAccount ? '编辑账号' : '新增账号'}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto scrollbar-thin space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">平台</label>
                <input
                  type="text"
                  value={formData.platform}
                  onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                  className="input-base"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">用户名</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="input-base"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">密码</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="input-base"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">邮箱（可选）</label>
                <textarea
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-base"
                  rows={3}
                  placeholder="可输入多个邮箱或其他账号信息"
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
        title="确定要删除这个账号吗？"
        description="此操作将永久删除该账号凭证，且无法恢复。"
      />
    </div>
  );
};

export default AccountsPage;
