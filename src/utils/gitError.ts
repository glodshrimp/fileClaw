export interface ParsedGitError {
  summary: string;
  hint?: string;
  raw: string;
  actionType?: 'pull' | 'stash' | 'settings' | 'remotes' | 'identity' | 'forceDelete';
}

export function parseGitError(err: unknown): ParsedGitError {
  const raw =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err
        ? String((err as any).message)
        : String(err || '未知 Git 错误');

  const lower = raw.toLowerCase();

  if (raw.includes('未找到 Git 可执行文件') || lower.includes('enoent') || lower.includes('command not found')) {
    return {
      summary: '未找到可用的 Git 可执行文件',
      hint: '请检查系统是否正确安装 Git，或前往「设置」页指定 Git 可执行文件路径并点击测试。',
      raw,
      actionType: 'settings',
    };
  }

  if (lower.includes('author identity unknown') || lower.includes('unable to auto-detect email') || lower.includes('please tell me who you are')) {
    return {
      summary: '尚未配置 Git 提交者身份信息 (user.name / user.email)',
      hint: '请在终端运行：git config --global user.name "Your Name" && git config --global user.email "you@example.com"。',
      raw,
      actionType: 'identity',
    };
  }

  if (lower.includes('non-fast-forward') || lower.includes('fetch first') || (lower.includes('rejected') && lower.includes('updates were rejected'))) {
    return {
      summary: '远端存在本地尚未同步的新提交（非快进更新）',
      hint: '建议先执行「拉取 (Pull)」合并或变基远端更新；仅在确认覆盖历史时使用强制推送 (--force-with-lease)。',
      raw,
      actionType: 'pull',
    };
  }

  if (lower.includes('local changes') && (lower.includes('would be overwritten') || lower.includes('please commit your changes or stash'))) {
    return {
      summary: '工作区存在未提交的本地修改，操作会被覆盖',
      hint: '请先「暂存当前改动 (Stash)」或「提交更改」后再执行切换分支、拉取或合并。',
      raw,
      actionType: 'stash',
    };
  }

  if (lower.includes('conflict') || lower.includes('merge_head exists') || lower.includes('unmerged files') || lower.includes('could not apply')) {
    return {
      summary: '存在代码冲突或未完成的操作状态',
      hint: '请在编辑器中解决带有冲突标记 (<<<<<<< / ======= / >>>>>>>) 的文件并暂存，随后完成提交，或在终端中止当前合并/变基。',
      raw,
    };
  }

  if (
    lower.includes('authentication failed') ||
    lower.includes('permission denied (publickey)') ||
    lower.includes('terminal prompts disabled') ||
    lower.includes('could not read username') ||
    lower.includes('invalid username or token') ||
    lower.includes('403') ||
    lower.includes('401')
  ) {
    return {
      summary: 'Git 远程仓库鉴权失败',
      hint: 'GUI 下已禁用交互式密码弹窗。请确认 SSH 密钥已加入 ssh-agent（或免密/Keychain 已解锁），或将 HTTPS Token 写入系统凭据管理器 / 远端 URL。',
      raw,
      actionType: 'remotes',
    };
  }

  if (
    lower.includes('no configured push destination') ||
    lower.includes('does not appear to be a git repository') ||
    lower.includes('could not read from remote repository') ||
    lower.includes('no remote')
  ) {
    return {
      summary: '未配置有效的远程仓库地址或无法连接远端',
      hint: '请检查远端配置 (Remotes) 与网络连接状态。',
      raw,
      actionType: 'remotes',
    };
  }

  if (lower.includes('not fully merged')) {
    return {
      summary: '该分支包含尚未合并到当前分支的提交',
      hint: '如果确认不再需要这些提交，可选择强制删除分支 (-D)。',
      raw,
      actionType: 'forceDelete',
    };
  }

  if (lower.includes('nothing to commit') || lower.includes('no changes added to commit')) {
    return {
      summary: '没有可提交的更改',
      hint: '工作区或选中文件与 HEAD 内容一致。',
      raw,
    };
  }

  if (raw.startsWith('BINARY_FILE:')) {
    return {
      summary: '二进制文件不支持文本差异预览',
      hint: raw.replace(/^BINARY_FILE:\s*/, ''),
      raw,
    };
  }

  if (raw.startsWith('FILE_TOO_LARGE:')) {
    return {
      summary: '文件体积过大，已跳过预览',
      hint: raw.replace(/^FILE_TOO_LARGE:\s*/, ''),
      raw,
    };
  }

  const firstLine = raw.split('\n').find((line) => line.trim())?.trim() || 'Git 操作失败';
  return {
    summary: firstLine,
    raw,
  };
}
