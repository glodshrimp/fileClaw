import React from 'react';

declare global {
  interface Window {
    AppPluginAPI: {
      React: typeof React;
      routes: any[];
      sidebarItems: any[];
      registerRoute: (route: any) => void;
      registerSidebarItem: (item: any) => void;
    };
  }
}

window.AppPluginAPI = {
  React,
  routes: [],
  sidebarItems: [],
  registerRoute: (route: any) => {
    window.AppPluginAPI.routes.push(route);
  },
  registerSidebarItem: (item: any) => {
    window.AppPluginAPI.sidebarItems.push(item);
  }
};

export async function loadFrontendPlugins(): Promise<void> {
  if (!window.electronAPI?.getFrontendPlugins) return;
  
  try {
    const plugins: { name: string, code: string }[] = await window.electronAPI.getFrontendPlugins();
    
    for (const plugin of plugins) {
      console.log(`[Plugin System] Injecting frontend plugin: ${plugin.name}`);
      try {
        // 创建一个 Blob 并生成 URL，避免在严格 CSP/CORS 下直接 eval 或加载 file:// 失败
        const blob = new Blob([plugin.code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.onload = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          script.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Failed to load plugin script ${plugin.name}`));
          };
          document.body.appendChild(script);
        });
      } catch (err) {
        console.error(`[Plugin System] Error executing ${plugin.name}:`, err);
      }
    }
  } catch (err) {
    console.error('[Plugin System] Failed to get frontend plugins', err);
  }
}
