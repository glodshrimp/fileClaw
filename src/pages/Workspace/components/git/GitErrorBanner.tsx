import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Settings, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { parseGitError } from '../../../../utils/gitError';

interface GitErrorBannerProps {
  error: unknown;
  onDismiss?: () => void;
  onQuickAction?: (action: 'pull' | 'stash' | 'remotes' | 'settings') => void;
  className?: string;
}

export const GitErrorBanner: React.FC<GitErrorBannerProps> = ({
  error,
  onDismiss,
  onQuickAction,
  className = '',
}) => {
  const [showRaw, setShowRaw] = useState(false);
  const navigate = useNavigate();

  if (!error) return null;
  const parsed = parseGitError(error);

  return (
    <div
      role="alert"
      className={`rounded-lg border border-functional-error/35 bg-functional-error/10 p-3 text-xs text-text-primary ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-functional-error flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-medium text-functional-error leading-snug break-words">
            {parsed.summary}
          </div>
          {parsed.hint && (
            <div className="text-[11px] text-text-secondary leading-relaxed break-words">
              建议：{parsed.hint}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {parsed.actionType === 'settings' && (
              <button
                type="button"
                onClick={() => {
                  if (onQuickAction) onQuickAction('settings');
                  else navigate('/settings');
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
              >
                <Settings className="w-3 h-3" />
                <span>打开系统设置</span>
              </button>
            )}

            {parsed.raw && parsed.raw.trim() !== parsed.summary.trim() && (
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
              >
                {showRaw ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span>{showRaw ? '隐藏原始报错' : '查看原始输出'}</span>
              </button>
            )}
          </div>

          {showRaw && parsed.raw && (
            <pre className="mt-2 p-2 rounded bg-background-primary border border-border-primary text-[10px] font-mono text-text-secondary overflow-x-auto max-h-28 scrollbar-thin whitespace-pre-wrap break-all">
              {parsed.raw}
            </pre>
          )}
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭错误提示"
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-background-tertiary transition-colors flex-shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
