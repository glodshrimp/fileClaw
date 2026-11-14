use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

static GIT_PATH: Mutex<String> = Mutex::new(String::new());

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize, Debug)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_current: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeFile {
    pub path: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: String,
    pub refs: String,
    pub message: String,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderGitStatus {
    pub modified: bool,
    pub added: bool,
    pub untracked: bool,
    pub not_added: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub git_branch: Option<String>,
    pub git_roots: Vec<String>,
    pub git_repo_branches: HashMap<String, String>,
    pub git_file_statuses: HashMap<String, String>,
    pub git_dirty_folders: HashMap<String, FolderGitStatus>,
    pub git_ahead_behind: HashMap<String, (usize, usize)>,
}

#[tauri::command]
pub fn set_git_path(path: String) {
    if let Ok(mut guard) = GIT_PATH.lock() {
        *guard = path.trim().to_string();
    }
}

fn get_git_command() -> String {
    if let Ok(guard) = GIT_PATH.lock() {
        if !guard.is_empty() {
            return guard.clone();
        }
    }

    #[cfg(unix)]
    {
        // On macOS/Linux GUI bundles, PATH can omit Homebrew locations.
        for candidate in ["/opt/homebrew/bin/git", "/usr/local/bin/git"] {
            if Path::new(candidate).is_file() {
                return candidate.to_string();
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for candidate in [
            r"C:\Program Files\Git\cmd\git.exe",
            r"C:\Program Files (x86)\Git\cmd\git.exe",
        ] {
            if Path::new(candidate).is_file() {
                return candidate.to_string();
            }
        }
    }

    "git".to_string()
}

fn build_git_command(git_bin: &str, repo_path: Option<&str>, args: &[&str]) -> Command {
    let mut cmd = Command::new(git_bin);
    if let Some(dir) = repo_path {
        cmd.current_dir(dir);
    }

    // Ensure non-ASCII paths aren't octal-escaped in status/log/diff outputs
    cmd.arg("-c").arg("core.quotepath=false").args(args);

    // Prevent interactive prompts / editor hangs inside GUI subprocesses
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GCM_INTERACTIVE", "never");
    cmd.env("GIT_EDITOR", "true");
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }

    #[cfg(unix)]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let extra = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
        let merged = if current_path.is_empty() {
            extra.to_string()
        } else {
            format!("{}:{}", extra, current_path)
        };
        cmd.env("PATH", merged);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd
}

fn map_spawn_err(git_cmd: &str, err: std::io::Error) -> String {
    if err.kind() == std::io::ErrorKind::NotFound {
        format!(
            "未找到 Git 可执行文件（当前尝试运行: \"{}\"）。\n请确保系统已安装 Git 并配置了环境变量，或者在「设置」中配置正确的 Git 可执行文件路径。",
            git_cmd
        )
    } else {
        format!("执行 Git 命令失败: {}", err)
    }
}

fn run_git_cmd_bytes(repo_path: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let git_cmd = get_git_command();
    let output = build_git_command(&git_cmd, Some(repo_path), args)
        .output()
        .map_err(|e| map_spawn_err(&git_cmd, e))?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if err_msg.is_empty() {
            let out_msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if out_msg.is_empty() {
                Err("Git 命令执行失败，退出码非零".to_string())
            } else {
                Err(out_msg)
            }
        } else {
            Err(err_msg)
        }
    }
}

fn run_git_cmd(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let bytes = run_git_cmd_bytes(repo_path, args)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn run_git_cmd_combined(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let git_cmd = get_git_command();
    let output = build_git_command(&git_cmd, Some(repo_path), args)
        .output()
        .map_err(|e| map_spawn_err(&git_cmd, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        match (stdout.is_empty(), stderr.is_empty()) {
            (false, false) => Ok(format!("{}\n{}", stdout, stderr)),
            (false, true) => Ok(stdout),
            (true, false) => Ok(stderr),
            (true, true) => Ok(String::new()),
        }
    } else if !stderr.is_empty() {
        Err(stderr)
    } else if !stdout.is_empty() {
        Err(stdout)
    } else {
        Err("Git 命令执行失败，退出码非零".to_string())
    }
}

#[tauri::command]
pub async fn test_git_path(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let custom = path.trim().to_string();
        let cmd_bin = if custom.is_empty() {
            get_git_command()
        } else {
            custom
        };

        let output = build_git_command(&cmd_bin, None, &["--version"])
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    format!("未找到可执行文件 \"{}\"", cmd_bin)
                } else {
                    format!("测试失败: {}", e)
                }
            })?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn normalize_rel_for_git(rel_path: &str) -> String {
    let replaced = rel_path.trim().replace('\\', "/");
    if replaced.is_empty() {
        ".".to_string()
    } else {
        replaced
    }
}

fn has_head_commit(repo_path: &str) -> bool {
    run_git_cmd(repo_path, &["rev-parse", "--verify", "HEAD"]).is_ok()
}

fn git_status_impl(repo_path: &str) -> Result<HashMap<String, String>, String> {
    let raw = run_git_cmd(repo_path, &["status", "--porcelain", "-z"])?;
    let mut map = HashMap::new();
    if raw.is_empty() {
        return Ok(map);
    }

    let parts: Vec<&str> = raw.split('\0').collect();
    let mut i = 0;
    while i < parts.len() {
        let entry = parts[i];
        if entry.is_empty() {
            i += 1;
            continue;
        }
        if entry.len() >= 4 {
            let status = &entry[0..2];
            let path = &entry[3..];
            if status.starts_with('R') || status.starts_with('C') || status.ends_with('R') || status.ends_with('C') {
                // Next NUL field is the original source path; keep destination path
                i += 1;
            }
            map.insert(path.to_string(), status.to_string());
        }
        i += 1;
    }
    Ok(map)
}

#[tauri::command]
pub async fn git_status(repo_path: String) -> Result<HashMap<String, String>, String> {
    tokio::task::spawn_blocking(move || git_status_impl(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

fn git_current_branch_impl(repo_path: &str) -> Result<String, String> {
    if let Ok(branch) = run_git_cmd(repo_path, &["branch", "--show-current"]) {
        let trimmed = branch.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    // Unborn branch right after git init
    if let Ok(sym) = run_git_cmd(repo_path, &["symbolic-ref", "--short", "HEAD"]) {
        let trimmed = sym.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    // Detached HEAD
    if let Ok(head) = run_git_cmd(repo_path, &["rev-parse", "--short", "HEAD"]) {
        let trimmed = head.trim();
        if !trimmed.is_empty() {
            return Ok(format!("HEAD ({})", trimmed));
        }
    }
    Ok("HEAD".to_string())
}

#[tauri::command]
pub async fn git_current_branch(repo_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git_current_branch_impl(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branches(repo_path: String) -> Result<Vec<GitBranchInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let raw = run_git_cmd(&repo_path, &["branch", "-a"])?;
        let mut list = Vec::new();
        let mut seen = HashSet::new();

        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let is_current = trimmed.starts_with('*');
            let mut name = trimmed
                .trim_start_matches(|c| c == '*' || c == '+')
                .trim()
                .to_string();

            if name.is_empty()
                || name.contains(" -> ")
                || name.starts_with("(HEAD detached")
                || name.starts_with("(no branch")
            {
                continue;
            }

            let mut is_remote = false;
            if name.starts_with("remotes/") {
                name = name.replacen("remotes/", "", 1);
                is_remote = true;
            }

            if !name.is_empty() && seen.insert(name.clone()) {
                list.push(GitBranchInfo {
                    name,
                    is_remote,
                    is_current,
                });
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let target = branch.trim().to_string();
        if target.is_empty() {
            return Err("目标分支或提交不能为空".to_string());
        }

        // 1. Exact local branch match
        let local_ref = format!("refs/heads/{}", target);
        if run_git_cmd(&repo_path, &["show-ref", "--verify", "--quiet", &local_ref]).is_ok() {
            run_git_cmd(&repo_path, &["checkout", &target])?;
            return Ok(());
        }

        // 2. Exact remote-tracking branch match (supports any remote name & slashes)
        let remote_ref = format!("refs/remotes/{}", target);
        if run_git_cmd(&repo_path, &["show-ref", "--verify", "--quiet", &remote_ref]).is_ok() {
            let remotes_raw = run_git_cmd(&repo_path, &["remote"]).unwrap_or_default();
            let mut remotes: Vec<&str> = remotes_raw
                .lines()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();
            remotes.sort_by(|a, b| b.len().cmp(&a.len()));

            let local_name = remotes
                .iter()
                .find_map(|r| {
                    let prefix = format!("{}/", r);
                    target.strip_prefix(&prefix).map(|s| s.to_string())
                })
                .unwrap_or_else(|| {
                    target
                        .split_once('/')
                        .map(|(_, rest)| rest.to_string())
                        .unwrap_or_else(|| target.clone())
                });

            let derived_local_ref = format!("refs/heads/{}", local_name);
            if run_git_cmd(
                &repo_path,
                &["show-ref", "--verify", "--quiet", &derived_local_ref],
            )
            .is_ok()
            {
                run_git_cmd(&repo_path, &["checkout", &local_name])?;
            } else {
                run_git_cmd(
                    &repo_path,
                    &["checkout", "--track", "-b", &local_name, &target],
                )?;
            }
            return Ok(());
        }

        // 3. Tag / commit hash / HEAD~N fallback
        run_git_cmd(&repo_path, &["checkout", &target])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn git_add_files_impl(repo_path: &str, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let normalized: Vec<String> = files.iter().map(|f| normalize_rel_for_git(f)).collect();
    for chunk in normalized.chunks(100) {
        let mut args = vec!["add", "-A", "--"];
        for f in chunk {
            args.push(f.as_str());
        }
        run_git_cmd(repo_path, &args)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_add(repo_path: String, file_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || git_add_files_impl(&repo_path, &[file_path]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_add_files(repo_path: String, files: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || git_add_files_impl(&repo_path, &files))
        .await
        .map_err(|e| e.to_string())?
}

fn git_unstage_files_impl(repo_path: &str, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let normalized: Vec<String> = files.iter().map(|f| normalize_rel_for_git(f)).collect();
    let has_head = has_head_commit(repo_path);

    for chunk in normalized.chunks(100) {
        if has_head {
            let mut args = vec!["restore", "--staged", "--"];
            for f in chunk {
                args.push(f.as_str());
            }
            if run_git_cmd(repo_path, &args).is_err() {
                let mut fallback_args = vec!["reset", "HEAD", "--"];
                for f in chunk {
                    fallback_args.push(f.as_str());
                }
                run_git_cmd(repo_path, &fallback_args)?;
            }
        } else {
            // Unborn repository before first commit: remove from index without deleting working file
            let mut args = vec!["rm", "--cached", "-r", "--ignore-unmatch", "--"];
            for f in chunk {
                args.push(f.as_str());
            }
            run_git_cmd(repo_path, &args)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(repo_path: String, file_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || git_unstage_files_impl(&repo_path, &[file_path]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unstage_files(repo_path: String, files: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || git_unstage_files_impl(&repo_path, &files))
        .await
        .map_err(|e| e.to_string())?
}

fn remove_untracked_path(repo_path: &str, rel_path: &str) -> Result<(), String> {
    if rel_path.contains("..") {
        return Err(format!("非法路径: {}", rel_path));
    }
    let full_path = Path::new(repo_path).join(rel_path);
    if full_path.exists() {
        if full_path.is_dir() {
            std::fs::remove_dir_all(&full_path).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&full_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn git_restore_files_impl(repo_path: &str, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let status_map = git_status_impl(repo_path)?;
    let mut untracked_or_added = Vec::new();
    let mut tracked = Vec::new();

    for f in files {
        let norm = normalize_rel_for_git(f);
        let st = status_map.get(&norm).map(|s| s.as_str()).unwrap_or("");
        if st == "??" || st == "?" {
            untracked_or_added.push(norm);
        } else if st.starts_with('A') {
            // Staged newly added file: unstage then delete working copy
            let _ = git_unstage_files_impl(repo_path, &[norm.clone()]);
            untracked_or_added.push(norm);
        } else {
            tracked.push(norm);
        }
    }

    for u in untracked_or_added {
        remove_untracked_path(repo_path, &u)?;
    }

    for chunk in tracked.chunks(100) {
        let mut args = vec!["restore", "--worktree", "--"];
        for t in chunk {
            args.push(t.as_str());
        }
        if run_git_cmd(repo_path, &args).is_err() {
            let mut fallback = vec!["checkout", "--"];
            for t in chunk {
                fallback.push(t.as_str());
            }
            run_git_cmd(repo_path, &fallback)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn git_restore(repo_path: String, file_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || git_restore_files_impl(&repo_path, &[file_path]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_restore_files(repo_path: String, files: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || git_restore_files_impl(&repo_path, &files))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(
    repo_path: String,
    files: Vec<String>,
    message: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if files.is_empty() {
            return Err("请选择至少一个要提交的文件".to_string());
        }
        if message.trim().is_empty() {
            return Err("提交说明不能为空".to_string());
        }

        git_add_files_impl(&repo_path, &files)?;

        let in_merge = run_git_cmd(&repo_path, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok();
        if in_merge || files.len() > 200 {
            run_git_cmd(&repo_path, &["commit", "-m", &message])?;
        } else {
            let normalized: Vec<String> = files.iter().map(|f| normalize_rel_for_git(f)).collect();
            let mut args = vec!["commit", "-m", &message, "--"];
            for f in &normalized {
                args.push(f.as_str());
            }
            run_git_cmd(&repo_path, &args)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_push(
    repo_path: String,
    remote: String,
    branch: String,
    force: bool,
    push_tags: Option<bool>,
    set_upstream: Option<bool>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let r = if remote.trim().is_empty() {
            "origin"
        } else {
            remote.trim()
        };
        let b = if branch.trim().is_empty() {
            "HEAD"
        } else {
            branch.trim()
        };

        let mut args = vec!["push"];
        if set_upstream.unwrap_or(true) {
            args.push("-u");
        }
        if force {
            args.push("--force-with-lease");
        }
        if push_tags.unwrap_or(false) {
            args.push("--tags");
        }
        args.push(r);
        args.push(b);

        run_git_cmd_combined(&repo_path, &args)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_pull(
    repo_path: String,
    remote: String,
    branch: String,
    rebase: bool,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let r = if remote.trim().is_empty() {
            "origin"
        } else {
            remote.trim()
        };
        let b = branch.trim();

        let mut args = vec!["pull"];
        if rebase {
            args.push("--rebase");
        }
        args.push(r);
        if !b.is_empty() {
            args.push(b);
        }

        run_git_cmd_combined(&repo_path, &args)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_fetch(repo_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        run_git_cmd_combined(&repo_path, &["fetch", "--all", "--prune", "--tags"])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_remotes(repo_path: String) -> Result<Vec<(String, String)>, String> {
    tokio::task::spawn_blocking(move || {
        let raw = run_git_cmd(&repo_path, &["remote", "-v"])?;
        let mut remotes = Vec::new();
        let mut seen = HashSet::new();
        for line in raw.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let name = parts[0].to_string();
                let url = parts[1].to_string();
                if seen.insert(name.clone()) {
                    remotes.push((name, url));
                }
            }
        }
        Ok(remotes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_set_remote_url(repo_path: String, name: String, url: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if name.trim().is_empty() || url.trim().is_empty() {
            return Err("远端名称和 URL 不能为空".to_string());
        }
        run_git_cmd(&repo_path, &["remote", "set-url", name.trim(), url.trim()])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_add_remote(repo_path: String, name: String, url: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if name.trim().is_empty() || url.trim().is_empty() {
            return Err("远端名称和 URL 不能为空".to_string());
        }
        run_git_cmd(&repo_path, &["remote", "add", name.trim(), url.trim()])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_remove_remote(repo_path: String, name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if name.trim().is_empty() {
            return Err("远端名称不能为空".to_string());
        }
        run_git_cmd(&repo_path, &["remote", "remove", name.trim()])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_history(
    repo_path: String,
    file_path: Option<String>,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<Vec<GitCommitInfo>, String> {
    tokio::task::spawn_blocking(move || {
        if !has_head_commit(&repo_path) {
            return Ok(Vec::new());
        }

        let limit_str = limit.unwrap_or(50).to_string();
        let skip_str = format!("--skip={}", skip.unwrap_or(0));
        let mut args = vec![
            "log",
            "-n",
            &limit_str,
            &skip_str,
            "--pretty=format:%H%x09%an%x09%ad%x09%s",
            "--date=short",
        ];

        let rel_clean;
        if let Some(ref p) = file_path {
            let clean = normalize_rel_for_git(p);
            if !clean.is_empty() && clean != "." {
                let abs = Path::new(&repo_path).join(&clean);
                // --follow in git fails or is invalid for directory pathspecs
                if !abs.is_dir() {
                    args.push("--follow");
                }
                args.push("--");
                rel_clean = clean;
                args.push(&rel_clean);
            }
        }

        let raw = run_git_cmd(&repo_path, &args)?;
        let mut list = Vec::new();
        for line in raw.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 4 {
                list.push(GitCommitInfo {
                    hash: parts[0].to_string(),
                    author: parts[1].to_string(),
                    date: parts[2].to_string(),
                    message: parts[3..].join("\t"),
                });
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_push(
    repo_path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut args = vec!["stash", "push"];
        if include_untracked.unwrap_or(false) {
            args.push("-u");
        }
        let trimmed_msg = message.as_deref().unwrap_or("").trim().to_string();
        if !trimmed_msg.is_empty() {
            args.push("-m");
            args.push(&trimmed_msg);
        }
        run_git_cmd(&repo_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_list(repo_path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let raw = run_git_cmd(&repo_path, &["stash", "list"])?;
        let mut list = Vec::new();
        for line in raw.lines() {
            if !line.trim().is_empty() {
                list.push(line.trim().to_string());
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_pop(repo_path: String, index: usize) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let stash_ref = format!("stash@{{{}}}", index);
        run_git_cmd(&repo_path, &["stash", "pop", &stash_ref])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_apply(repo_path: String, index: usize) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let stash_ref = format!("stash@{{{}}}", index);
        run_git_cmd(&repo_path, &["stash", "apply", &stash_ref])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stash_drop(repo_path: String, index: usize) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let stash_ref = format!("stash@{{{}}}", index);
        run_git_cmd(&repo_path, &["stash", "drop", &stash_ref])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_name_status_z(raw: &str) -> Vec<GitChangeFile> {
    let tokens: Vec<&str> = raw.split('\0').collect();
    let mut list = Vec::new();
    let mut i = 0;

    while i < tokens.len() {
        let token = tokens[i];
        if token.is_empty() {
            i += 1;
            continue;
        }
        let status_char = token.chars().next().unwrap_or('M');
        if (status_char == 'R' || status_char == 'C') && i + 2 < tokens.len() {
            let old_p = tokens[i + 1].to_string();
            let new_p = tokens[i + 2].to_string();
            list.push(GitChangeFile {
                status: status_char.to_string(),
                path: new_p,
                old_path: Some(old_p),
            });
            i += 3;
        } else if i + 1 < tokens.len() {
            list.push(GitChangeFile {
                status: status_char.to_string(),
                path: tokens[i + 1].to_string(),
                old_path: None,
            });
            i += 2;
        } else {
            i += 1;
        }
    }

    list
}

#[tauri::command]
pub async fn git_stash_files(repo_path: String, index: usize) -> Result<Vec<GitChangeFile>, String> {
    tokio::task::spawn_blocking(move || {
        let stash_ref = format!("stash@{{{}}}", index);
        let raw = match run_git_cmd(
            &repo_path,
            &["stash", "show", "-u", "--name-status", "-z", &stash_ref],
        ) {
            Ok(out) => out,
            Err(_) => run_git_cmd(
                &repo_path,
                &["stash", "show", "--name-status", "-z", &stash_ref],
            )?,
        };
        Ok(parse_name_status_z(&raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_init(repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        run_git_cmd(&repo_path, &["init"])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn find_all_git_roots(
    dir: &Path,
    current_depth: usize,
    max_depth: usize,
    roots: &mut Vec<PathBuf>,
) {
    if current_depth > max_depth {
        return;
    }

    let git_dir = dir.join(".git");
    if git_dir.exists() {
        roots.push(dir.to_path_buf());
        return;
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name != "node_modules"
                    && name != "target"
                    && name != "dist"
                    && name != "build"
                    && !name.starts_with('.')
                {
                    find_all_git_roots(&path, current_depth + 1, max_depth, roots);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn git_discover_roots(workspace_path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&workspace_path);
        if !path.exists() {
            return Ok(Vec::new());
        }

        let mut roots = Vec::new();
        find_all_git_roots(path, 0, 4, &mut roots);

        let str_roots = roots
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();

        Ok(str_roots)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_create_branch(
    repo_path: String,
    name: String,
    base: Option<String>,
    checkout: bool,
    force: Option<bool>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let is_force = force.unwrap_or(false);
        let mut args = Vec::new();
        if checkout {
            args.push("checkout");
            args.push(if is_force { "-B" } else { "-b" });
        } else {
            args.push("branch");
            if is_force {
                args.push("-f");
            }
        }
        args.push(name.trim());
        let base_trimmed = base.as_deref().unwrap_or("").trim().to_string();
        if !base_trimmed.is_empty() {
            args.push(&base_trimmed);
        }
        run_git_cmd(&repo_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_delete_branch(repo_path: String, name: String, force: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let flag = if force { "-D" } else { "-d" };
        run_git_cmd(&repo_path, &["branch", flag, name.trim()])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_rename_branch(
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        run_git_cmd(
            &repo_path,
            &["branch", "-m", old_name.trim(), new_name.trim()],
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_merge_branch(repo_path: String, branch: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        run_git_cmd_combined(&repo_path, &["merge", branch.trim()])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_create_tag(
    repo_path: String,
    tag_name: String,
    commit: Option<String>,
    message: Option<String>,
    force: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut args = vec!["tag"];
        if force {
            args.push("-f");
        }

        let msg_val = message.as_deref().unwrap_or("").trim().to_string();
        if !msg_val.is_empty() {
            args.push("-a");
            args.push(tag_name.trim());
            args.push("-m");
            args.push(&msg_val);
        } else {
            args.push(tag_name.trim());
        }

        let commit_val = commit.as_deref().unwrap_or("").trim().to_string();
        if !commit_val.is_empty() {
            args.push(&commit_val);
        }

        run_git_cmd(&repo_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_tags(repo_path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let raw = run_git_cmd(&repo_path, &["tag", "--sort=-creatordate"])?;
        Ok(raw
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_delete_tag(repo_path: String, tag_name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        run_git_cmd(&repo_path, &["tag", "-d", tag_name.trim()])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_cherry_pick(repo_path: String, hash: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || run_git_cmd_combined(&repo_path, &["cherry-pick", hash.trim()]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_revert_commit(repo_path: String, hash: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        run_git_cmd_combined(&repo_path, &["revert", "--no-edit", hash.trim()])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_reset(repo_path: String, target: String, mode: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let flag = match mode.as_str() {
            "soft" => "--soft",
            "mixed" => "--mixed",
            "hard" => "--hard",
            _ => return Err(format!("不支持的 Reset 模式: {}", mode)),
        };
        run_git_cmd(&repo_path, &["reset", flag, target.trim()])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_unpushed_commits(
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<Vec<GitCommitInfo>, String> {
    tokio::task::spawn_blocking(move || {
        if !has_head_commit(&repo_path) {
            return Ok(Vec::new());
        }

        let remote_ref = format!("refs/remotes/{}/{}", remote, branch);
        let has_remote_branch = run_git_cmd(&repo_path, &["rev-parse", "--verify", &remote_ref]).is_ok();

        let mut args = vec![
            "log",
            "--pretty=format:%H%x09%an%x09%ad%x09%s",
            "--date=short",
        ];
        let range;
        if has_remote_branch {
            range = format!("{}..HEAD", remote_ref);
            args.push(&range);
        } else if run_git_cmd(&repo_path, &["rev-parse", "--verify", "@{u}"]).is_ok() {
            args.push("@{u}..HEAD");
        } else {
            let unpushed = run_git_cmd(
                &repo_path,
                &[
                    "log",
                    "HEAD",
                    "--not",
                    "--remotes",
                    "--pretty=format:%H%x09%an%x09%ad%x09%s",
                    "--date=short",
                ],
            );
            match unpushed {
                Ok(ref val) if !val.trim().is_empty() => {
                    let mut list = Vec::new();
                    for line in val.lines() {
                        let parts: Vec<&str> = line.split('\t').collect();
                        if parts.len() >= 4 {
                            list.push(GitCommitInfo {
                                hash: parts[0].to_string(),
                                author: parts[1].to_string(),
                                date: parts[2].to_string(),
                                message: parts[3..].join("\t"),
                            });
                        }
                    }
                    return Ok(list);
                }
                _ => {
                    args.push("-n");
                    args.push("30");
                }
            }
        }

        let raw = run_git_cmd(&repo_path, &args)?;
        let mut list = Vec::new();
        for line in raw.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 4 {
                list.push(GitCommitInfo {
                    hash: parts[0].to_string(),
                    author: parts[1].to_string(),
                    date: parts[2].to_string(),
                    message: parts[3..].join("\t"),
                });
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit_files(repo_path: String, hash: String) -> Result<Vec<GitChangeFile>, String> {
    tokio::task::spawn_blocking(move || {
        let raw = run_git_cmd(
            &repo_path,
            &[
                "diff-tree",
                "--no-commit-id",
                "--name-status",
                "-r",
                "-z",
                "-m",
                "--first-parent",
                "--root",
                "-M",
                hash.trim(),
            ],
        )?;
        Ok(parse_name_status_z(&raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_show_file(
    repo_path: String,
    hash: String,
    file_path: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let revision = if hash.trim().is_empty() {
            "HEAD".to_string()
        } else {
            hash.trim().to_string()
        };
        let norm_file = file_path.replace('\\', "/");
        let ref_spec = format!("{}:{}", revision, norm_file);
        let bytes = run_git_cmd_bytes(&repo_path, &["show", &ref_spec])?;

        const MAX_PREVIEW_BYTES: usize = 2 * 1024 * 1024;
        if bytes.len() > MAX_PREVIEW_BYTES {
            return Err(
                "FILE_TOO_LARGE: 文件超过 2MB，已跳过差异预览以保证流畅度".to_string(),
            );
        }
        let sample_len = bytes.len().min(8000);
        if bytes[..sample_len].contains(&0) {
            return Err("BINARY_FILE: 该文件为二进制文件，暂不支持文本差异预览".to_string());
        }

        Ok(String::from_utf8_lossy(&bytes).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_log_graph(
    repo_path: String,
    branch: Option<String>,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<Vec<GitGraphCommit>, String> {
    tokio::task::spawn_blocking(move || {
        if !has_head_commit(&repo_path) {
            return Ok(Vec::new());
        }

        let limit_str = limit.unwrap_or(200).to_string();
        let skip_str = format!("--skip={}", skip.unwrap_or(0));
        let branch_filter = branch.as_deref().unwrap_or("").trim().to_string();
        let scope_arg = if branch_filter.is_empty() || branch_filter == "all" {
            "--all"
        } else {
            &branch_filter
        };

        let raw = run_git_cmd(
            &repo_path,
            &[
                "log",
                scope_arg,
                "--date-order",
                "-n",
                &limit_str,
                &skip_str,
                "--pretty=format:%H%x09%P%x09%an%x09%ae%x09%ad%x09%D%x09%s",
                "--date=short",
            ],
        )?;

        let mut list = Vec::new();
        for line in raw.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 7 {
                let parents = if parts[1].trim().is_empty() {
                    Vec::new()
                } else {
                    parts[1]
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .collect()
                };

                let message = parts[6..].join("\t");

                list.push(GitGraphCommit {
                    hash: parts[0].to_string(),
                    parents,
                    author: parts[2].to_string(),
                    email: parts[3].to_string(),
                    date: parts[4].to_string(),
                    refs: parts[5].to_string(),
                    message,
                });
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn path_is_equal_or_inside(child: &str, parent: &str) -> bool {
    let norm = |p: &str| -> String {
        let s = p.replace('\\', "/");
        if s.len() > 1 {
            s.trim_end_matches('/').to_string()
        } else {
            s
        }
    };
    let mut c = norm(child);
    let mut p = norm(parent);
    if cfg!(target_os = "windows") {
        c = c.to_lowercase();
        p = p.to_lowercase();
    }
    if c == p {
        return true;
    }
    if p == "/" {
        return c.starts_with('/');
    }
    c.starts_with(&format!("{}/", p))
}

#[tauri::command]
pub async fn git_refresh_status(
    workspace_path: String,
    git_roots: Option<Vec<String>>,
    active_tab_path: Option<String>,
) -> Result<GitStatusResult, String> {
    tokio::task::spawn_blocking(move || {
        let roots = match git_roots {
            Some(r) if !r.is_empty() => r,
            _ => {
                let path = Path::new(&workspace_path);
                if !path.exists() {
                    Vec::new()
                } else {
                    let mut r = Vec::new();
                    find_all_git_roots(path, 0, 4, &mut r);
                    r.into_iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect()
                }
            }
        };

        if roots.is_empty() {
            return Ok(GitStatusResult {
                git_branch: None,
                git_roots: Vec::new(),
                git_repo_branches: HashMap::new(),
                git_file_statuses: HashMap::new(),
                git_dirty_folders: HashMap::new(),
                git_ahead_behind: HashMap::new(),
            });
        }

        let mut merged_statuses = HashMap::new();
        let mut repo_branches = HashMap::new();
        let mut dirty_folders: HashMap<String, FolderGitStatus> = HashMap::new();
        let mut ahead_behind: HashMap<String, (usize, usize)> = HashMap::new();

        let is_windows = cfg!(target_os = "windows");
        let sep = if is_windows { "\\" } else { "/" };

        for root_path in &roots {
            if let Ok(branch) = git_current_branch_impl(root_path) {
                repo_branches.insert(root_path.clone(), branch);
            } else {
                repo_branches.insert(root_path.clone(), "HEAD".to_string());
            }

            if let Ok(counts_raw) = run_git_cmd(
                root_path,
                &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
            ) {
                let nums: Vec<usize> = counts_raw
                    .split_whitespace()
                    .filter_map(|n| n.parse::<usize>().ok())
                    .collect();
                if nums.len() >= 2 {
                    ahead_behind.insert(root_path.clone(), (nums[0], nums[1]));
                }
            }

            if let Ok(statuses) = git_status_impl(root_path) {
                for (rel_path, status) in statuses {
                    let normalized_rel = if is_windows {
                        rel_path.replace('/', "\\")
                    } else {
                        rel_path.replace('\\', "/")
                    };

                    let abs_file_path = if root_path.ends_with(sep) {
                        format!("{}{}", root_path, normalized_rel)
                    } else {
                        format!("{}{}{}", root_path, sep, normalized_rel)
                    };

                    merged_statuses.insert(abs_file_path.clone(), status.clone());

                    let mut parent = Path::new(&abs_file_path).parent();
                    let ws_path = Path::new(&workspace_path);
                    while let Some(p) = parent {
                        if p.starts_with(ws_path) {
                            let parent_str = p.to_string_lossy().into_owned();
                            let entry = dirty_folders.entry(parent_str).or_default();

                            let chars: Vec<char> = status.chars().collect();
                            let x = chars.first().copied().unwrap_or(' ');
                            let y = chars.get(1).copied().unwrap_or(' ');
                            let is_not_added = y == 'M' || y == 'D';
                            let is_modified = x == 'M';
                            let is_added = x == 'A' || x == 'R';
                            let is_untracked = status == "??" || status == "?";

                            if is_not_added {
                                entry.not_added = true;
                            }
                            if is_modified {
                                entry.modified = true;
                            }
                            if is_added {
                                entry.added = true;
                            }
                            if is_untracked {
                                entry.untracked = true;
                            }

                            parent = p.parent();
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        // Resolve active branch based on boundary-safe matching
        let mut active_branch = repo_branches.get(&roots[0]).cloned();
        if let Some(ref active_tab) = active_tab_path {
            let mut sorted_roots = roots.clone();
            sorted_roots.sort_by(|a, b| b.len().cmp(&a.len()));
            if let Some(matched) = sorted_roots
                .iter()
                .find(|r| path_is_equal_or_inside(active_tab, r))
            {
                if let Some(b) = repo_branches.get(matched) {
                    active_branch = Some(b.clone());
                }
            }
        }

        Ok(GitStatusResult {
            git_branch: active_branch,
            git_roots: roots,
            git_repo_branches: repo_branches,
            git_file_statuses: merged_statuses,
            git_dirty_folders: dirty_folders,
            git_ahead_behind: ahead_behind,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
