import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastItem, useToastStore } from '../../contexts/useToastStore';

interface ToastCardProps {
  item: ToastItem;
  suspended: boolean;
  onDismiss: (id: string) => void;
}

const ToastCard: React.FC<ToastCardProps> = ({ item, suspended, onDismiss }) => {
  const [isPaused, setIsPaused] = useState(false);
  const remainingRef = useRef<number>(item.duration);
  const timerStartRef = useRef<number>(0);

  useEffect(() => {
    if (item.duration <= 0 || suspended || isPaused) {
      return;
    }

    timerStartRef.current = Date.now();
    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, Math.max(200, remainingRef.current));

    return () => {
      window.clearTimeout(timer);
      const elapsed = Date.now() - timerStartRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    };
  }, [item.id, item.duration, suspended, isPaused, onDismiss]);

  const iconMap = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />,
    error: <AlertCircle className="w-4 h-4 text-functional-error flex-shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />,
    info: <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />,
  };

  const borderMap = {
    success: 'border-emerald-500/30',
    error: 'border-functional-error/40',
    warning: 'border-amber-500/40',
    info: 'border-primary/30',
  };

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border bg-card text-text-primary shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-150 ${borderMap[item.type]}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsPaused(false);
        }
      }}
    >
      {iconMap[item.type]}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-text-primary leading-snug break-words">
          {item.title}
        </div>
        {item.description && (
          <div className="mt-1 text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap break-words max-h-24 overflow-y-auto scrollbar-thin">
            {item.description}
          </div>
        )}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              onDismiss(item.id);
            }}
            className="mt-1.5 text-[11px] font-medium text-primary hover:underline cursor-pointer"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="关闭通知"
        className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-background-tertiary transition-colors flex-shrink-0 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const ToastViewport: React.FC = () => {
  const { toasts, lastAnnouncement, dismissToast } = useToastStore();
  const [hasOpenModal, setHasOpenModal] = useState(false);

  // Suppress viewport toasts behind native top-layer <dialog open> until modal dismissal
  useEffect(() => {
    const checkModal = () => {
      setHasOpenModal(Boolean(document.querySelector('dialog[open]')));
    };
    checkModal();

    const observer = new MutationObserver(checkModal);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {lastAnnouncement}
      </div>
      {!hasOpenModal && toasts.length > 0 && (
        <div
          role="region"
          aria-label="系统通知"
          className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-24px)] pointer-events-none"
        >
          {toasts.map((item) => (
            <ToastCard
              key={item.id}
              item={item}
              suspended={hasOpenModal}
              onDismiss={dismissToast}
            />
          ))}
        </div>
      )}
    </>
  );
};
