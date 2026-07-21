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
