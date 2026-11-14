import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration: number;
  action?: ToastAction;
  createdAt: number;
}

interface ToastInput {
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  action?: ToastAction;
}

interface ToastStore {
  toasts: ToastItem[];
  lastAnnouncement: string;
  addToast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
  clearAll: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  lastAnnouncement: '',

  addToast: (input) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const defaultDuration =
      input.type === 'error' || input.type === 'warning' ? 7000 : 4000;
    const item: ToastItem = {
      id,
      type: input.type,
      title: input.title,
      description: input.description,
      duration: input.duration ?? defaultDuration,
      action: input.action,
      createdAt: Date.now(),
    };

    set((state) => ({
      toasts: [...state.toasts.slice(-4), item],
      lastAnnouncement: input.description
        ? `${input.title}：${input.description}`
        : input.title,
    }));

    return id;
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearAll: () => set({ toasts: [] }),
}));

export const toast = {
  success: (title: string, description?: string, action?: ToastAction, duration?: number) =>
    useToastStore.getState().addToast({ type: 'success', title, description, action, duration }),
  error: (title: string, description?: string, action?: ToastAction, duration?: number) =>
    useToastStore.getState().addToast({ type: 'error', title, description, action, duration }),
  warning: (title: string, description?: string, action?: ToastAction, duration?: number) =>
    useToastStore.getState().addToast({ type: 'warning', title, description, action, duration }),
  info: (title: string, description?: string, action?: ToastAction, duration?: number) =>
    useToastStore.getState().addToast({ type: 'info', title, description, action, duration }),
};
