import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  title?: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  title = '确定要删除吗？',
  description = '此操作将永久删除该项，且无法恢复。',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-background-secondary border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-slide-in">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-functional-error/10 rounded-full flex items-center justify-center text-functional-error flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-text-primary break-words">{title}</h3>
            <p className="text-xs text-text-tertiary mt-1 leading-relaxed break-words">{description}</p>
          </div>
        </div>
        <div className="flex space-x-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary flex-1 py-2 text-xs"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="bg-functional-error hover:opacity-90 text-white font-semibold flex-1 py-2 rounded-lg text-xs transition-opacity shadow-sm shadow-functional-error/20"
          >
            确定删除
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;
