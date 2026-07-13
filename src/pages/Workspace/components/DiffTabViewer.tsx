import React from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useTheme } from '../../../contexts/ThemeContext';

interface DiffTabViewerProps {
  path: string;
  name: string;
  originalContent: string;
  modifiedContent: string;
  originalLabel: string;
  modifiedLabel: string;
}

const getLanguage = (fileName: string) => {
  const cleanName = fileName.replace(/^Diff:\s*/i, '');
  const ext = cleanName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'html':
    case 'vue': // Fallback to html for vue files
      return 'html';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'java':
    case 'class':
      return 'java';
    case 'py':
      return 'python';
    case 'md':
      return 'markdown';
    case 'xml':
      return 'xml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'sql':
      return 'sql';
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
      return 'cpp';
    case 'ini':
    case 'conf':
    case 'toml':
      return 'ini';
    default:
      return 'plaintext';
  }
};

export const DiffTabViewer: React.FC<DiffTabViewerProps> = ({
  name,
  originalContent,
  modifiedContent,
  originalLabel,
  modifiedLabel,
}) => {
  const { theme } = useTheme();
  return (
    <div className="flex flex-col h-full w-full min-h-0 bg-background-primary">
      {/* Visual Header displaying version tags */}
      <div className="flex border-b border-border-primary bg-background-secondary text-xs font-mono select-none flex-shrink-0">
        <div className="w-1/2 p-2 border-r border-border-primary flex items-center justify-between px-4 text-text-secondary">
          <span className="font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded text-[10px]">
            {originalLabel}
          </span>
          <span className="truncate max-w-[80%] text-text-secondary">{name}</span>
        </div>
        <div className="w-1/2 p-2 flex items-center justify-between px-4 text-text-secondary">
          <span className="font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px]">
            {modifiedLabel}
          </span>
          <span className="truncate max-w-[80%] text-text-secondary">{name}</span>
        </div>
      </div>

      {/* Monaco Diff Editor container */}
      <div className="flex-1 h-full min-h-0 relative">
        <DiffEditor
          original={originalContent}
          modified={modifiedContent}
          language={getLanguage(name)}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          loading={
            <div className="absolute inset-0 flex items-center justify-center bg-background-primary text-xs font-mono text-text-tertiary">
              Loading diff viewer...
            </div>
          }
          options={{
            renderSideBySide: true,
            readOnly: true,
            fontSize: 13,
            fontFamily: 'Monaco, Menlo, Consolas, "Fira Code", monospace',
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            diffWordWrap: 'off',
            renderOverviewRuler: false,
          }}
        />
      </div>
    </div>
  );
};
