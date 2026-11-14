import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';
import { X, AlertTriangle, HelpCircle } from 'lucide-react';

export interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  preventClose?: boolean;
  className?: string;
  bodyClassName?: string;
  ariaLabel?: string;
}

const SIZE_CLASSES: Record<NonNullable<ModalDialogProps['size']>, string> = {
  sm: 'w-[420px] max-w-[94vw]',
  md: 'w-[540px] max-w-[94vw]',
  lg: 'w-[760px] max-w-[94vw]',
  xl: 'w-[960px] max-w-[95vw]',
  full: 'w-[1060px] max-w-[96vw] h-[85vh]',
};

export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  headerExtra,
  footer,
  children,
  size = 'md',
  preventClose = false,
  className = '',
  bodyClassName = '',
  ariaLabel,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOutsideRef = useRef(false);
  const titleId = useId();
  const isFull = size === 'full';

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const isPointerOutside = (e: React.PointerEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog || e.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!preventClose) {
          onClose();
        }
      }}
      onPointerDown={(e) => {
        pointerDownOutsideRef.current = isPointerOutside(e);
      }}
      onPointerUp={(e) => {
        const wasDownOutside = pointerDownOutsideRef.current;
        pointerDownOutsideRef.current = false;
        if (!preventClose && wasDownOutside && isPointerOutside(e)) {
          onClose();
        }
      }}
      className={`m-auto p-0 bg-card text-text-primary border border-border-primary rounded-xl shadow-2xl max-h-[90vh] ${
        isFull ? 'open:flex open:flex-col overflow-hidden' : ''
      } ${SIZE_CLASSES[size]} ${className}`}
    >
      {title !== undefined && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-primary bg-background-secondary/70 rounded-t-xl flex-shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-sm font-semibold text-text-primary truncate flex items-center gap-2"
              >
                {title}
              </h2>
              {subtitle && (
                <div className="text-[11px] text-text-secondary truncate mt-0.5">
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerExtra}
            <button
              type="button"
              onClick={() => {
                if (!preventClose) onClose();
              }}
              disabled={preventClose}
              aria-label="关闭对话框"
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-background-tertiary transition-colors disabled:opacity-40 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div
        className={
          isFull
            ? `flex-1 min-h-0 overflow-y-auto scrollbar-thin ${bodyClassName}`
            : `max-h-[calc(88vh-7rem)] overflow-y-auto scrollbar-thin ${bodyClassName}`
        }
      >
        {children}
      </div>

      {footer && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-primary bg-background-secondary/60 rounded-b-xl flex-shrink-0">
          {footer}
        </div>
      )}
    </dialog>
  );
};

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
}

interface ConfirmState {
  current: (ConfirmOptions & { resolve: (confirmed: boolean) => void }) | null;
  ask: (options: ConfirmOptions) => Promise<boolean>;
  closeWith: (result: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,

  ask: (options) =>
    new Promise<boolean>((resolve) => {
      const prev = get().current;
      if (prev) {
        prev.resolve(false);
      }
      set({ current: { ...options, resolve } });
    }),

  closeWith: (result) => {
    const cur = get().current;
    if (cur) {
      set({ current: null });
      cur.resolve(result);
    }
  },
}));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().ask(options);
}

export const GlobalConfirmModal: React.FC = () => {
  const { current, closeWith } = useConfirmStore();
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => {
      if (current.variant === 'danger') {
        cancelBtnRef.current?.focus();
      } else {
        confirmBtnRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  const isDanger = current.variant === 'danger';
  const isWarning = current.variant === 'warning';

  const confirmClasses = isDanger
    ? 'bg-red-600 hover:bg-red-500 text-white border-red-500/40'
    : isWarning
      ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500/40'
      : 'bg-primary hover:bg-primary/90 text-white border-primary/40';

  return (
    <ModalDialog
      isOpen={Boolean(current)}
      onClose={() => closeWith(false)}
      title={current.title}
      size="sm"
      icon={
        isDanger ? (
          <AlertTriangle className="w-4 h-4 text-red-500" />
        ) : isWarning ? (
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        ) : (
          <HelpCircle className="w-4 h-4 text-primary" />
        )
      }
      footer={
        <>
          <button
            ref={cancelBtnRef}
            type="button"
            autoFocus={isDanger}
            onClick={() => closeWith(false)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary bg-background-tertiary hover:bg-background-secondary border border-border-primary transition-colors cursor-pointer"
          >
            {current.cancelText || '取消'}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            autoFocus={!isDanger}
            onClick={() => closeWith(true)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-sm cursor-pointer ${confirmClasses}`}
          >
            {current.confirmText || '确认'}
          </button>
        </>
      }
    >
      <div className="p-4 space-y-2.5 text-sm">
        <p className="text-text-primary leading-relaxed whitespace-pre-wrap break-words">
          {current.message}
        </p>
        {current.detail && (
          <div className="p-2.5 rounded-lg bg-background-secondary border border-border-primary text-xs font-mono text-text-secondary max-h-36 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words">
            {current.detail}
          </div>
        )}
      </div>
    </ModalDialog>
  );
};
