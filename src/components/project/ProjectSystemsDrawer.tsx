import React, { useState } from 'react';
import { X, Plus, Globe, Key, Copy, ExternalLink, Edit2, Trash2, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import DeleteConfirmModal from '../DeleteConfirmModal';
import { Project, OnlineSystem, Account } from '../../types';
import { copyToClipboard } from '../../utils/copy';

interface Props {
  project: Project | null;
  onClose: () => void;
}

const ProjectSystemsDrawer: React.FC<Props> = ({ project, onClose }) => {
  const { state, dispatch } = useApp();
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'system' | 'account' } | null>(null);
  
  // Forms state
  const [addingSystem, setAddingSystem] = useState(false);
  const [editingSystemId, setEditingSystemId] = useState<string | null>(null);
  const [systemFormData, setSystemFormData] = useState({ name: '', url: '', description: '', tags: '' });
  
  const [addingAccountFor, setAddingAccountFor] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountFormData, setAccountFormData] = useState({ platform: '', username: '', password: '', email: '', description: '' });
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  if (!project) return null;

  const projectSystems = state.systems.filter(s => s.projectId === project.id);

  // System Handlers
  const handleSaveSystem = async (e: React.FormEvent) => {
    e.preventDefault();
    const systemData: OnlineSystem = {
      id: editingSystemId || Date.now().toString(),
      projectId: project.id,
      name: systemFormData.name,
      url: systemFormData.url,
      description: systemFormData.description,
      tags: systemFormData.tags.split(',').map(t => t.trim()).filter(Boolean),
      createdAt: editingSystemId ? (state.systems.find(s => s.id === editingSystemId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (editingSystemId) {
        // @ts-ignore
        await window.electronAPI?.updateSystem(editingSystemId, systemData);
        dispatch({ type: 'UPDATE_SYSTEM', payload: systemData });
        setEditingSystemId(null);
      } else {
        // @ts-ignore
        await window.electronAPI?.addSystem(systemData);
        dispatch({ type: 'ADD_SYSTEM', payload: systemData });
      }
      setAddingSystem(false);
      setSystemFormData({ name: '', url: '', description: '', tags: '' });
    } catch (error) {
      console.error('Failed to save system:', error);
    }
  };

  const handleEditSystem = (system: OnlineSystem) => {
    setSystemFormData({
      name: system.name,
      url: system.url,
      description: system.description,
      tags: system.tags.join(', ')
    });
    setEditingSystemId(system.id);
    setAddingSystem(true);
  };

  const cancelSystemForm = () => {
    setAddingSystem(false);
    setEditingSystemId(null);
    setSystemFormData({ name: '', url: '', description: '', tags: '' });
  };

  const handleDeleteSystemClick = (id: string) => {
    setDeleteTarget({ id, type: 'system' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, type } = deleteTarget;
    try {
      if (type === 'system') {
        // @ts-ignore
        await window.electronAPI?.deleteSystem(id);
        dispatch({ type: 'DELETE_SYSTEM', payload: id });
        if (expandedSystem === id) setExpandedSystem(null);
      } else {
        // @ts-ignore
        await window.electronAPI?.deleteAccount(id);
        dispatch({ type: 'DELETE_ACCOUNT', payload: id });
      }
    } catch (error) {
      console.error(`Failed to delete ${type}:`, error);
    } finally {
      setDeleteTarget(null);
    }
  };

  // Account Handlers
  const handleSaveAccount = async (e: React.FormEvent, systemId: string) => {
    e.preventDefault();
    const accountData: Account = {
      id: editingAccountId || Date.now().toString(),
      systemId,
      platform: accountFormData.platform,
      username: accountFormData.username,
      password: accountFormData.password,
      email: accountFormData.email,
      description: accountFormData.description,
      createdAt: editingAccountId ? (state.accounts.find(a => a.id === editingAccountId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (editingAccountId) {
        // @ts-ignore
        await window.electronAPI?.updateAccount(editingAccountId, accountData);
        dispatch({ type: 'UPDATE_ACCOUNT', payload: accountData });
        setEditingAccountId(null);
      } else {
        // @ts-ignore
        await window.electronAPI?.addAccount(accountData);
        dispatch({ type: 'ADD_ACCOUNT', payload: accountData });
      }
      setAddingAccountFor(null);
      setAccountFormData({ platform: '', username: '', password: '', email: '', description: '' });
    } catch (error) {
      console.error('Failed to save account:', error);
    }
  };

  const handleEditAccount = (account: Account) => {
    setAccountFormData({
      platform: account.platform,
      username: account.username,
      password: account.password,
      email: account.email || '',
      description: account.description
    });
    setEditingAccountId(account.id);
    if (account.systemId) {
      setAddingAccountFor(account.systemId);
    }
  };

  const cancelAccountForm = () => {
    setAddingAccountFor(null);
    setEditingAccountId(null);
    setAccountFormData({ platform: '', username: '', password: '', email: '', description: '' });
  };

  const handleDeleteAccountClick = (id: string) => {
    setDeleteTarget({ id, type: 'account' });
  };

  const togglePasswordVisibility = (id: string) => {
    const newVisible = new Set(visiblePasswords);
    if (newVisible.has(id)) newVisible.delete(id);
    else newVisible.add(id);
    setVisiblePasswords(newVisible);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="w-[500px] h-full bg-background border-l border-border shadow-2xl flex flex-col transform transition-transform duration-300 translate-x-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-bold text-text-primary mb-1">系统与账号管理</h2>
            <p className="text-sm text-text-secondary">项目: {project.name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-background-secondary rounded-full transition-colors">
            <X className="w-5 h-5 text-text-tertiary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-text-primary">在线系统列表</h3>
            {!addingSystem && (
              <button onClick={() => setAddingSystem(true)} className="btn-secondary py-1.5 px-3 text-xs flex items-center">
                <Plus className="w-3.5 h-3.5 mr-1" /> 添加系统
              </button>
            )}
          </div>

          {addingSystem && (
            <div className="bg-background-secondary p-5 rounded-xl mb-6 border border-border shadow-sm">
              <h4 className="text-sm font-bold text-text-primary mb-4">{editingSystemId ? '编辑系统' : '新增系统'}</h4>
              <form onSubmit={handleSaveSystem} className="space-y-4">
                <input type="text" placeholder="系统名称" required className="input-base text-sm" value={systemFormData.name} onChange={e => setSystemFormData({...systemFormData, name: e.target.value})} />
                <input type="url" placeholder="URL地址" required className="input-base text-sm" value={systemFormData.url} onChange={e => setSystemFormData({...systemFormData, url: e.target.value})} />
                <textarea placeholder="描述" className="input-base text-sm" rows={2} value={systemFormData.description} onChange={e => setSystemFormData({...systemFormData, description: e.target.value})} />
                <input type="text" placeholder="标签 (逗号分隔)" className="input-base text-sm" value={systemFormData.tags} onChange={e => setSystemFormData({...systemFormData, tags: e.target.value})} />
                <div className="flex justify-end space-x-2 pt-2">
                  <button type="button" onClick={cancelSystemForm} className="btn-secondary py-1.5 px-4">取消</button>
                  <button type="submit" className="btn-primary py-1.5 px-4">保存</button>
                </div>
              </form>
            </div>
          )}

          {projectSystems.length === 0 && !addingSystem ? (
            <div className="text-center py-12 text-text-tertiary">
              <Globe className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p>该项目暂无在线系统</p>
            </div>
          ) : (
            <div className="space-y-4">
              {projectSystems.map(system => {
                const isExpanded = expandedSystem === system.id;
                const systemAccounts = state.accounts.filter(a => a.systemId === system.id);

                return (
                  <div key={system.id} className="border border-border rounded-xl overflow-hidden shadow-sm bg-background-secondary">
                    <div className="bg-background-tertiary/10 p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-3 cursor-pointer select-none flex-1 min-w-0" onClick={() => setExpandedSystem(isExpanded ? null : system.id)}>
                        <div className="flex-shrink-0">
                          {isExpanded ? <ChevronDown className="w-5 h-5 text-text-tertiary" /> : <ChevronRight className="w-5 h-5 text-text-tertiary" />}
                        </div>
                        <div className="flex-1 min-w-0 flex items-center">
                          <span className="font-medium text-text-primary truncate">{system.name}</span>
                          <span className="text-xs text-text-tertiary ml-2 flex-shrink-0">({systemAccounts.length} 个账号)</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <button onClick={() => (window as any).electronAPI?.openExternal(system.url)} className="p-1.5 hover-gradient-primary rounded-lg text-text-secondary" title="访问">
                          <ExternalLink className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleEditSystem(system); }} className="p-1.5 hover-gradient-primary rounded-lg text-text-secondary" title="编辑">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteSystemClick(system.id); }} className="p-1.5 hover-gradient-danger rounded-lg text-functional-error" title="删除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 border-t border-border bg-background">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">账号列表</span>
                          {addingAccountFor !== system.id && (
                            <button onClick={() => setAddingAccountFor(system.id)} className="text-[11px] text-primary font-bold flex items-center hover:opacity-80">
                              <Plus className="w-3.5 h-3.5 mr-1" /> 此系统账号
                            </button>
                          )}
                        </div>

                        {addingAccountFor === system.id && (
                          <div className="bg-background-secondary p-4 rounded-xl border border-border shadow-inner mb-4 animate-slide-in">
                            <h4 className="text-xs font-bold mb-3 text-text-primary">{editingAccountId ? '编辑账号' : '新增账号'}</h4>
                            <form onSubmit={(e) => handleSaveAccount(e, system.id)} className="space-y-3">
                              <input type="text" placeholder="平台/途经" required className="input-base text-xs" value={accountFormData.platform} onChange={e => setAccountFormData({...accountFormData, platform: e.target.value})} />
                              <div className="grid grid-cols-2 gap-3">
                                <input type="text" placeholder="用户名" required className="input-base text-xs" value={accountFormData.username} onChange={e => setAccountFormData({...accountFormData, username: e.target.value})} />
                                <input type="text" placeholder="密码" required className="input-base text-xs" value={accountFormData.password} onChange={e => setAccountFormData({...accountFormData, password: e.target.value})} />
                              </div>
                              <textarea placeholder="邮箱/账号信息 (可选，可多行)" className="input-base text-xs" rows={2} value={accountFormData.email} onChange={e => setAccountFormData({...accountFormData, email: e.target.value})} />
                              <div className="flex justify-end space-x-2 pt-2">
                                <button type="button" onClick={cancelAccountForm} className="btn-secondary py-1.5 px-3 text-xs">取消</button>
                                <button type="submit" className="btn-primary py-1.5 px-3 text-xs">保存</button>
                              </div>
                            </form>
                          </div>
                        )}

                        {systemAccounts.length === 0 && addingAccountFor !== system.id ? (
                          <div className="text-center py-6 text-xs text-text-tertiary">暂无账号</div>
                        ) : (
                          <div className="space-y-2">
                            {systemAccounts.map(account => (
                              <div key={account.id} className="text-sm border border-border rounded-xl p-4 flex justify-between items-start hover:bg-background-secondary transition-colors gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-text-primary break-words">{account.platform}</div>
                                  <div className="text-text-secondary mt-1 flex items-start">
                                    <span className="mr-2 break-all">用户名: {account.username}</span>
                                    <button onClick={(e) => copyToClipboard(account.username, e)} className="hover:text-primary flex-shrink-0 mt-0.5"><Copy className="w-3 h-3" /></button>
                                  </div>
                                  <div className="text-text-secondary mt-1 flex items-start">
                                    <span className="mr-2 font-mono break-all">密码: {visiblePasswords.has(account.id) ? account.password : '••••••••'}</span>
                                    <div className="flex items-center flex-shrink-0 mt-0.5">
                                      <button onClick={() => togglePasswordVisibility(account.id)} className="hover:text-primary mr-1">
                                        {visiblePasswords.has(account.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                      </button>
                                      <button onClick={(e) => copyToClipboard(account.password, e)} className="hover:text-primary"><Copy className="w-3 h-3" /></button>
                                    </div>
                                  </div>
                                  {account.email && (
                                    <div className="text-text-secondary mt-1 break-words">
                                      <span className="text-text-tertiary">邮箱: </span>
                                      <span className="break-all" style={{ whiteSpace: 'pre-wrap' }}>{account.email}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col space-y-2 flex-shrink-0">
                                  <button onClick={() => handleEditAccount(account)} className="p-2 hover-gradient-primary rounded-lg text-text-secondary" title="编辑">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleDeleteAccountClick(account.id)} className="p-2 hover-gradient-danger rounded-lg text-functional-error" title="删除">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <DeleteConfirmModal
        isOpen={deleteTarget !== null}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title={deleteTarget?.type === 'system' ? "确定要删除这个系统吗？" : "确定要删除这个账号吗？"}
        description={deleteTarget?.type === 'system'
          ? "删除系统后，该系统下的关联账号凭证信息也将一并被彻底清除，且无法恢复。"
          : "此操作将永久删除该账号凭证，且无法恢复。"
        }
      />
    </div>
  );
};

export default ProjectSystemsDrawer;
