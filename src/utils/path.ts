/**
 * Normalize path separators for consistent cache keys and folder expansion state.
 * Detects Windows paths by backslash or drive letter (e.g. C:).
 */
export function normalizePath(p: string): string {
  if (!p) return p;

  const isWindows = p.includes('\\') || /^[a-zA-Z]:/.test(p);
  const sep = isWindows ? '\\' : '/';
  let normalized = p.replace(/[/\\]+/g, sep);

  // Strip trailing separator except drive roots like C:\
  if (normalized.length > 1 && normalized.endsWith(sep)) {
    const isDriveRoot = /^[a-zA-Z]:\\$/.test(normalized);
    if (!isDriveRoot) {
      normalized = normalized.slice(0, -1);
    }
  }

  return normalized;
}

/** Resolve the workspace root path for a project. */
export function getProjectRootPath(project: { path: string; codePath?: string }): string {
  return normalizePath(project.codePath || project.path);
}

function toForwardNormalized(p: string): { norm: string; isWindows: boolean } {
  const isWindows = p.includes('\\') || /^[a-zA-Z]:/.test(p);
  let norm = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (norm.length > 1 && norm.endsWith('/') && !/^[a-zA-Z]:\/$/.test(norm)) {
    norm = norm.slice(0, -1);
  }
  return { norm: isWindows ? norm.toLowerCase() : norm, isWindows };
}

/** Check whether childPath equals parentPath or sits strictly beneath it cleanly on path boundaries. */
export function isPathEqualOrInside(childPath: string, parentPath: string): boolean {
  if (!childPath || !parentPath) return false;
  const child = toForwardNormalized(childPath).norm;
  const parent = toForwardNormalized(parentPath).norm;
  if (child === parent) return true;
  if (parent === '/') return child.startsWith('/');
  if (/^[a-z]:\/$/.test(parent)) return child.startsWith(parent);
  return child.startsWith(`${parent}/`);
}

/** Pick the deepest Git repository root containing targetPath, with boundary-safe comparison. */
export function findGitRootForPath(
  targetPath: string | null | undefined,
  gitRoots: string[],
  fallbackPath = ''
): string {
  if (!gitRoots || gitRoots.length === 0) return fallbackPath;
  if (targetPath) {
    const sorted = [...gitRoots].sort((a, b) => normalizePath(b).length - normalizePath(a).length);
    const matched = sorted.find((root) => isPathEqualOrInside(targetPath, root));
    if (matched) return matched;
  }
  return gitRoots[0] || fallbackPath;
}

/** Compute POSIX forward-slash relative path inside repoRoot (returns '' when equal). */
export function getRelativePathInRepo(absPath: string, repoRoot: string): string {
  if (!absPath || !repoRoot) return absPath;
  const rawAbs = absPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const rawRoot = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!isPathEqualOrInside(rawAbs, rawRoot)) {
    return rawAbs.replace(/^\//, '');
  }
  if (rawAbs.length === rawRoot.length) return '';
  return rawAbs.slice(rawRoot.length).replace(/^\/+/, '');
}

/** Extract final file or folder name safely on macOS, Windows, and Linux. */
export function getBasename(p: string): string {
  if (!p) return '';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** Return OS-appropriate localized label for revealing a file or directory in the OS file manager. */
export function getRevealInFolderLabel(): string {
  const platform =
    typeof navigator !== 'undefined'
      ? ((navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase()
      : '';
  if (platform.includes('mac')) return '在 Finder 中显示';
  if (platform.includes('win')) return '在资源管理器中显示';
  return '在文件管理器中显示';
}
