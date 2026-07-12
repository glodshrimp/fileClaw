import { invoke } from '@tauri-apps/api/core';

export class TauriLowdbAdapter<T> {
  constructor(private filename: string) {}

  async read(): Promise<T | null> {
    try {
      const dataStr = await invoke<string>('get_db_data');
      if (!dataStr || dataStr.trim() === '' || dataStr === '{}') {
        return null;
      }
      const parsed = JSON.parse(dataStr);
      return parsed as T;
    } catch (err) {
      console.warn('[TauriLowdbAdapter] Failed to read database, returning null:', err);
      return null;
    }
  }

  async write(data: T): Promise<void> {
    try {
      const dataStr = JSON.stringify(data, null, 2);
      await invoke<void>('save_db_data', { data: dataStr });
    } catch (err) {
      console.error('[TauriLowdbAdapter] Failed to write database:', err);
    }
  }
}
