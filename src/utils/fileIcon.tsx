import React from 'react';
import { 
  FileText, FileJson, FileCode, FileImage, 
  FileArchive, FileAudio, FileVideo, FileSpreadsheet, File, Terminal
} from 'lucide-react';

/**
 * Returns a custom VS Code styled file icon based on file suffix and name.
 */
export const getFileIcon = (fileName: string, className: string = "w-3.5 h-3.5 flex-shrink-0") => {
  const ext = fileName.split('.').pop()?.toLowerCase();

  // Special files
  if (fileName.startsWith('Terminal: ') || fileName.toLowerCase() === 'terminal') {
    return <Terminal className={`${className} text-blue-400`} />;
  }
  
  if (fileName.toLowerCase() === 'package.json' || fileName.toLowerCase() === 'package-lock.json') {
    // Green Node/NPM Cube
    return (
      <svg viewBox="0 0 24 24" className={className} stroke="#00c853" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 7 22 17 12 22 2 17 2 7 12 2" />
        <polygon points="12 8 18 11 18 16 12 19 6 16 6 11 12 8" />
        <path d="M 12 2 L 12 8 M 22 7 L 18 11 M 22 17 L 18 16 M 12 22 L 12 19 M 2 17 L 6 16 M 2 7 L 6 11" />
      </svg>
    );
  }

  if (fileName.toLowerCase().startsWith('tsconfig') && ext === 'json') {
    // TS Config Badge (Blue TS square with a tiny gear)
    return (
      <svg viewBox="0 0 100 100" className={className}>
        <rect width="100" height="100" rx="15" fill="#3178c6" />
        <text x="35" y="70" fontWeight="bold" fontSize="45" fontFamily="Arial, sans-serif" fill="#ffffff">T</text>
        <circle cx="75" cy="75" r="12" fill="none" stroke="#ffffff" strokeWidth="6" />
        <path d="M 75,58 L 75,92 M 58,75 L 92,75 M 63,63 L 87,87 M 63,87 L 87,63" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
      </svg>
    );
  }

  if (fileName.toLowerCase().startsWith('vite.config')) {
    // Vite Logo (purple shield + yellow bolt)
    return (
      <svg viewBox="0 0 100 100" className={className}>
        <polygon points="15,20 50,10 85,20 80,75 50,95 20,75" fill="#646cff" />
        <polygon points="50,20 65,45 45,45 55,80 35,50 55,50" fill="#ffd026" />
      </svg>
    );
  }

  if (fileName.toLowerCase() === '.gitignore' || fileName.toLowerCase() === '.gitattributes') {
    // Git orange logo
    return (
      <svg viewBox="0 0 100 100" className={className}>
        <g transform="rotate(45 50 50)">
          <rect x="15" y="15" width="70" height="70" rx="15" fill="#f05032" />
          <circle cx="35" cy="45" r="10" fill="#ffffff" />
          <circle cx="65" cy="35" r="10" fill="#ffffff" />
          <circle cx="35" cy="70" r="10" fill="#ffffff" />
          <path d="M 35,45 L 35,70 M 35,45 C 35,45 43,50 65,35" stroke="#ffffff" strokeWidth="8" fill="none" />
        </g>
      </svg>
    );
  }

  // Extensions
  switch (ext) {
    case 'vue':
      // Vue green-blue V logo
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <polygon points="15,15 50,75 85,15 65,15 50,45 35,15" fill="#41b883" />
          <polygon points="30,15 50,50 70,15 55,15 50,25 45,15" fill="#35495e" />
        </svg>
      );

    case 'java':
    case 'class':
    case 'jar':
      // Java red coffee cup
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <path d="M30,30 Q40,15 35,5 Q48,15 38,30" fill="none" stroke="#5382a1" strokeWidth="6" strokeLinecap="round" />
          <path d="M42,30 Q52,10 47,0 Q60,10 50,30" fill="none" stroke="#5382a1" strokeWidth="6" strokeLinecap="round" />
          <path d="M20,40 L65,40 C65,40 68,60 50,65 C32,70 20,60 20,40 Z" fill="#ea2d2e" />
          <path d="M65,45 C75,45 75,55 65,55" fill="none" stroke="#ea2d2e" strokeWidth="6" strokeLinecap="round" />
          <ellipse cx="40" cy="72" rx="30" ry="6" fill="#5382a1" />
        </svg>
      );

    case 'py':
      // Python blue/yellow dual-snake logo
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <path d="M48,5 C25,5 25,22 35,22 L45,22 A5,5 0 0 1 50,27 L50,35 C50,45 40,45 35,45 L20,45 C5,45 5,60 5,65 L5,70 C5,80 15,80 25,80 L35,80 A5,5 0 0 0 40,75 L40,67 C40,57 50,57 55,57 L70,57 C85,57 85,42 85,37 L85,32 C85,22 75,5 48,5 Z" fill="#306998" />
          <path d="M52,95 C75,95 75,78 65,78 L55,78 A5,5 0 0 1 50,73 L50,65 C50,55 60,55 65,55 L80,55 C95,55 95,40 95,35 L95,30 C95,20 85,20 75,20 L65,20 A5,5 0 0 0 60,25 L60,33 C60,43 50,43 45,43 L30,43 C15,43 15,58 15,63 L15,68 C15,78 25,95 52,95 Z" fill="#ffd43b" />
          <circle cx="35" cy="12" r="3" fill="#ffffff" />
          <circle cx="65" cy="88" r="3" fill="#ffffff" />
        </svg>
      );

    case 'rs':
      // Rust gear logo
      return (
        <svg viewBox="0 0 100 100" className={className} stroke="#ffffff" strokeWidth="4" fill="none">
          <circle cx="50" cy="50" r="30" fill="#e4371b" stroke="none" />
          <text x="50" y="67" fontWeight="bold" fontSize="48" fontFamily="sans-serif" fill="#ffffff" textAnchor="middle">R</text>
          <circle cx="50" cy="50" r="32" stroke="#e4371b" strokeWidth="6" strokeDasharray="6,6" />
        </svg>
      );

    case 'tsx':
    case 'jsx':
      // React atom logo (light blue)
      return (
        <svg viewBox="0 0 100 100" className={className} style={{ color: '#00d8ff' }}>
          <circle cx="50" cy="50" r="8" fill="currentColor" />
          <ellipse cx="50" cy="50" rx="38" ry="14" fill="none" stroke="currentColor" strokeWidth="6" transform="rotate(0, 50, 50)" />
          <ellipse cx="50" cy="50" rx="38" ry="14" fill="none" stroke="currentColor" strokeWidth="6" transform="rotate(60, 50, 50)" />
          <ellipse cx="50" cy="50" rx="38" ry="14" fill="none" stroke="currentColor" strokeWidth="6" transform="rotate(120, 50, 50)" />
        </svg>
      );

    case 'ts':
      // TS blue badge
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <rect width="100" height="100" rx="15" fill="#3178c6" />
          <text x="50" y="70" fontWeight="bold" fontSize="55" fontFamily="Arial, sans-serif" fill="#ffffff" textAnchor="middle">TS</text>
        </svg>
      );

    case 'js':
      // JS yellow badge
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <rect width="100" height="100" rx="15" fill="#f7df1e" />
          <text x="50" y="70" fontWeight="bold" fontSize="55" fontFamily="Arial, sans-serif" fill="#000000" textAnchor="middle">JS</text>
        </svg>
      );

    case 'html':
      // HTML brackets icon (orange)
      return (
        <svg viewBox="0 0 100 100" className={className} stroke="#e34f26" strokeWidth="12" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 30,30 L 10,50 L 30,70" />
          <path d="M 70,30 L 90,50 L 70,70" />
          <path d="M 40,80 L 60,20" />
        </svg>
      );

    case 'css':
    case 'scss':
    case 'less':
      // CSS curly braces icon (blue)
      return (
        <svg viewBox="0 0 100 100" className={className} stroke="#1572b6" strokeWidth="10" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 40,20 C 25,20 25,40 25,50 C 25,60 25,80 40,80" />
          <path d="M 25,50 L 15,50" />
          <path d="M 60,20 C 75,20 75,40 75,50 C 75,60 75,80 60,80" />
          <path d="M 75,50 L 85,50" />
        </svg>
      );

    case 'md':
    case 'markdown':
      // Markdown logo (blue badge M↓)
      return (
        <svg viewBox="0 0 100 100" className={className}>
          <rect width="100" height="100" rx="15" fill="#007acc" />
          <text x="35" y="70" fontWeight="bold" fontSize="55" fontFamily="monospace" fill="#ffffff" textAnchor="middle">M</text>
          <path d="M 75,30 L 75,70 M 60,50 L 75,70 L 90,50" stroke="#ffffff" strokeWidth="12" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'pdf':
      return <FileText className={`${className} text-red-500`} />;
    
    case 'json':
      return <FileJson className={`${className} text-amber-400`} />;
      
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return <FileArchive className={`${className} text-orange-400`} />;
      
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
    case 'm4a':
      return <FileAudio className={`${className} text-violet-400`} />;
      
    case 'mp4':
    case 'mkv':
    case 'avi':
    case 'mov':
    case 'webm':
      return <FileVideo className={`${className} text-purple-400`} />;
      
    case 'xls':
    case 'xlsx':
    case 'csv':
      return <FileSpreadsheet className={`${className} text-emerald-500`} />;
      
    default:
      if (['py', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'sh', 'bat'].includes(ext || '')) {
        return <FileCode className={`${className} text-blue-400`} />;
      }
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '')) {
        return <FileImage className={`${className} text-emerald-400`} />;
      }
      return <File className={`${className} text-slate-400`} />;
  }
};

/**
 * Returns a customized folder icon based on the folder contents category (weight) and name.
 */
export const getFolderIcon = (folderName: string, isOpen: boolean, className: string = "w-3.5 h-3.5 flex-shrink-0") => {
  const name = folderName.toLowerCase();
  
  // Catppuccin mocha pastel folder colors & emblems inside terax-ai
  let color = "#b4befe"; // default Catppuccin Lavender
  let emblem: React.ReactNode = null;

  if (['src', 'source', 'app', 'lib', 'main', 'core', 'api', 'server', 'client'].includes(name)) {
    color = "#89b4fa"; // Catppuccin Blue
    emblem = (
      // Git branch / source control code emblem in white
      <path d="M12 8.5v7M12 11a2.5 2.5 0 0 1 2.5-2.5v-.5M12 13a2.5 2.5 0 0 0-2.5 2.5v.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    );
  } else if (['components', 'views', 'pages', 'screens', 'layouts'].includes(name)) {
    color = "#94e2d5"; // Catppuccin Teal
    emblem = (
      // Visual component center grid dot
      <circle cx="12" cy="13" r="2.2" fill="#ffffff" />
    );
  } else if (['utils', 'helpers', 'tools', 'services', 'hooks', 'store', 'contexts', 'plugins'].includes(name)) {
    color = "#cba6f7"; // Catppuccin Mauve
    emblem = (
      // Wrench setup
      <path fill="#ffffff" d="M14.5 10.3l-2.5 2.5.5.5 2.5-2.5-.5-.5zm1-.9a1 1 0 0 0-1.4 0c-.3.3-.3.8 0 1.1L10 14.5c-.2-.1-.5-.1-.7.1s-.3.5-.3.7a1 1 0 0 0 1.4 0l4.1-4.1c.1.2.1.5-.1.7l-4.1 4.1" />
    );
  } else if (['types', 'interfaces', 'models', 'dto', 'schemas', 'db', 'database'].includes(name)) {
    color = "#f38ba8"; // Catppuccin Red
    emblem = (
      // TS logo
      <text x="12" y="15" fill="#ffffff" fontWeight="bold" fontSize="7" fontFamily="Arial" textAnchor="middle">TS</text>
    );
  } else if (['styles', 'theme', 'css', 'scss', 'sass', 'less'].includes(name)) {
    color = "#89dceb"; // Catppuccin Sky
    emblem = (
      // Brush/Palette dot outline
      <circle cx="12" cy="13" r="1.5" stroke="#ffffff" strokeWidth="1.2" fill="none" />
    );
  } else if (['assets', 'images', 'img', 'static', 'public', 'media', 'fonts', 'docs', 'logs'].includes(name)) {
    color = "#fab387"; // Catppuccin Peach
    emblem = (
      // Photo frame
      <rect x="9.5" y="11" width="5" height="4" rx="0.5" fill="none" stroke="#ffffff" strokeWidth="1.2" />
    );
  } else if (['test', 'tests', 'spec', '__tests__', '__mocks__'].includes(name)) {
    color = "#a6e3a1"; // Catppuccin Green
    emblem = (
      // Checkmark icon
      <path d="M9.5 13l1.5 1.5 3.5-3.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    );
  } else if (['config', 'settings', 'scripts', 'build', 'dist', 'target', 'out', 'release', '.github', '.vscode', '.idea', 'node_modules', '.git'].includes(name)) {
    color = "#74c7ec"; // Catppuccin Sapphire
    emblem = (
      // Small setup dot
      <circle cx="12" cy="13" r="1.5" stroke="#ffffff" strokeWidth="1.2" fill="none" />
    );
  }

  // Draw Catppuccin / terax-ai styled open & closed folders
  if (isOpen) {
    return (
      <svg viewBox="0 0 24 24" className={className} style={{ color }}>
        {/* Open Folder base (semi-transparent back flap) */}
        <path fill="currentColor" d="M3.75 6.5C3.75 5.5335 4.5335 4.75 5.5 4.75H10.1506C10.7495 4.75 11.3106 5.0504 11.6372 5.5513L12.5628 6.97C12.7261 7.2205 13.0067 7.37 13.3061 7.37H18.5C19.4665 7.37 20.25 8.1535 20.25 9.12V17.5C20.25 18.4665 19.4665 19.25 18.5 19.25H5.5C4.5335 19.25 3.75 18.4665 3.75 17.5V6.5Z" opacity="0.45" />
        {/* Open flap in front */}
        <path fill="currentColor" d="M3 9.5C3 8.78 3.58 8.2 4.3 8.2H19.7C20.42 8.2 21 8.78 21 9.5V17.5C21 18.46 20.2 19.25 19.25 19.25H4.75C3.8 19.25 3 18.46 3 17.5V9.5Z" />
        {emblem}
      </svg>
    );
  } else {
    return (
      <svg viewBox="0 0 24 24" className={className} style={{ color }}>
        {/* Closed Folder base */}
        <path fill="currentColor" d="M3.75 6.5C3.75 5.5335 4.5335 4.75 5.5 4.75H10.1506C10.7495 4.75 11.3106 5.0504 11.6372 5.5513L12.5628 6.97C12.7261 7.2205 13.0067 7.37 13.3061 7.37H18.5C19.4665 7.37 20.25 8.1535 20.25 9.12V17.5C20.25 18.4665 19.4665 19.25 18.5 19.25H5.5C4.5335 19.25 3.75 18.4665 3.75 17.5V6.5Z" />
        {emblem}
      </svg>
    );
  }
};
