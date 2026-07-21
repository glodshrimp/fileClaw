use std::process::Command;
use std::collections::{HashMap, HashSet};
use serde::Serialize;
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


#[tauri::command]
pub fn set_git_path(path: String) {
    if let Ok(mut guard) = GIT_PATH.lock() {
        *guard = path.trim().to_string();
    }
}

#[tauri::command]
pub fn test_git_path(path: String) -> Result<String, String> {
    let cmd = if path.trim().is_empty() { "git" } else { path.trim() };
    let output = Command::new(cmd)
        .arg("--version")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("未找到可执行文件 \"{}\"", cmd)
            } else {
                format!("测试失败: {}", e)
            }
        })?;
        
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn get_git_command() -> String {
    if let Ok(guard) = GIT_PATH.lock() {
        if !guard.is_empty() {
            return guard.clone();
        }
    }
    "git".to_string()
}

fn run_git_cmd(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let git_cmd = get_git_command();
    let output = Command::new(&git_cmd)
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "未找到 Git 可执行文件（当前尝试运行: \"{}\"）。\n请确保系统已安装 Git 并配置了环境变量，或者在「设置」中配置正确的 Git 可执行文件路径。",
                    git_cmd
                )
            } else {
                format!("执行 Git 命令失败: {}", e)
            }
        })?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if err_msg.is_empty() {
            Err("Git 命令执行失败，退出码非零".to_string())
        } else {
            Err(err_msg)
        }
    }
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
            break;
        }
        if entry.len() >= 3 {
            let status = &entry[0..2];
            let path = &entry[3..];
            
            // Handle rename/copy which has a second path field separated by \0
            if status.starts_with('R') || status.starts_with('C') {
                i += 1;
            }
            
            map.insert(path.to_string(), status.trim().to_string());
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

#[tauri::command]
pub fn git_current_branch(repo_path: String) -> Result<String, String> {
    let branch = run_git_cmd(&repo_path, &["branch", "--show-current"])?;
    Ok(branch.trim().to_string())
}

#[derive(serde::Serialize)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_current: bool,
}

#[tauri::command]
pub fn git_branches(repo_path: String) -> Result<Vec<GitBranchInfo>, String> {
    let raw = run_git_cmd(&repo_path, &["branch", "-a"])?;
    let mut list = Vec::new();
    let mut seen = HashSet::new();
    
    for line in raw.lines() {
        let is_current = line.trim().starts_with('*') || line.starts_with('*');
        let mut name = line.replace('*', "").trim().to_string();
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
}

#[tauri::command]
pub fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    let target = if branch.starts_with("origin/") {
        branch.replacen("origin/", "", 1)
    } else {
        branch
    };
    
    run_git_cmd(&repo_path, &["checkout", &target])?;
    Ok(())
}

#[tauri::command]
pub fn git_add(repo_path: String, file_path: String) -> Result<(), String> {
    run_git_cmd(&repo_path, &["add", &file_path])?;
    Ok(())
}

#[tauri::command]
pub fn git_restore(repo_path: String, file_path: String) -> Result<(), String> {
    let status_map = git_status_impl(&repo_path)?;
    let is_untracked = status_map.get(&file_path).map(|s| s == "??" || s == "?").unwrap_or(false);
    
    if is_untracked {
        let full_path = std::path::Path::new(&repo_path).join(&file_path);
        if full_path.exists() {
            if full_path.is_dir() {
                std::fs::remove_dir_all(full_path).map_err(|e| e.to_string())?;
            } else {
                std::fs::remove_file(full_path).map_err(|e| e.to_string())?;
            }
        }
    } else {
        run_git_cmd(&repo_path, &["restore", &file_path])?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(repo_path: String, files: Vec<String>, message: String) -> Result<(), String> {
    if files.is_empty() {
        return Err("No files selected for commit".to_string());
    }
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    
    for file in &files {
        run_git_cmd(&repo_path, &["add", file])?;
    }
    
    run_git_cmd(&repo_path, &["commit", "-m", &message])?;
    Ok(())
}

#[tauri::command]
pub fn git_push(repo_path: String, remote: String, branch: String, force: bool) -> Result<(), String> {
    let r = if remote.is_empty() { "origin" } else { &remote };
    let b = if branch.is_empty() { "HEAD" } else { &branch };
    let mut args = vec!["push"];
    if force {
        args.push("--force-with-lease");
    }
    args.push(r);
    args.push(b);
    run_git_cmd(&repo_path, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_pull(repo_path: String, remote: String, branch: String, rebase: bool) -> Result<(), String> {
    let r = if remote.is_empty() { "origin" } else { &remote };
    let b = if branch.is_empty() { "HEAD" } else { &branch };
    
    let mut args = vec!["pull"];
    if rebase {
        args.push("--rebase");
    }
    args.push(r);
    args.push(b);
    
    run_git_cmd(&repo_path, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_fetch(repo_path: String) -> Result<(), String> {
    run_git_cmd(&repo_path, &["fetch", "--all", "--prune"])?;
    Ok(())
}

#[tauri::command]
pub fn git_remotes(repo_path: String) -> Result<Vec<(String, String)>, String> {
    let raw = run_git_cmd(&repo_path, &["remote", "-v"])?;
    let mut remotes = Vec::new();
    let mut seen = HashSet::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let name = parts[0].to_string();
            let url = parts[1].to_string();
            if !seen.contains(&name) {
                seen.insert(name.clone());
                remotes.push((name, url));
            }
        }
    }
    Ok(remotes)
}

#[tauri::command]
pub fn git_set_remote_url(repo_path: String, name: String, url: String) -> Result<(), String> {
    if name.is_empty() || url.is_empty() {
        return Err("Remote name and URL cannot be empty".to_string());
    }
    run_git_cmd(&repo_path, &["remote", "set-url", &name, &url])?;
    Ok(())
}

#[tauri::command]
pub fn git_add_remote(repo_path: String, name: String, url: String) -> Result<(), String> {
    if name.is_empty() || url.is_empty() {
        return Err("Remote name and URL cannot be empty".to_string());
    }
    run_git_cmd(&repo_path, &["remote", "add", &name, &url])?;
    Ok(())
}

#[tauri::command]
pub fn git_history(repo_path: String, file_path: Option<String>) -> Result<Vec<GitCommitInfo>, String> {
    let mut args = vec![
        "log", 
        "-n", "50", 
        "--pretty=format:%h%x09%an%x09%ad%x09%s", 
        "--date=short"
    ];
    
    let path_val;
    if let Some(ref path) = file_path {
        args.push("--follow");
        args.push("--");
        path_val = path.to_string();
        args.push(&path_val);
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
                message: parts[3].to_string(),
            });
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn git_stash_push(repo_path: String, message: Option<String>) -> Result<(), String> {
    let mut args = vec!["stash", "push"];
    let msg_val;
    if let Some(ref msg) = message {
        args.push("-m");
        msg_val = msg.to_string();
        args.push(&msg_val);
    }
    run_git_cmd(&repo_path, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_stash_list(repo_path: String) -> Result<Vec<String>, String> {
    let raw = run_git_cmd(&repo_path, &["stash", "list"])?;
    let mut list = Vec::new();
    for line in raw.lines() {
        if !line.trim().is_empty() {
            list.push(line.trim().to_string());
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn git_stash_pop(repo_path: String, index: usize) -> Result<(), String> {
    let stash_ref = format!("stash@{{{}}}", index);
    run_git_cmd(&repo_path, &["stash", "pop", &stash_ref])?;
    Ok(())
}

#[tauri::command]
pub fn git_init(repo_path: String) -> Result<(), String> {
    run_git_cmd(&repo_path, &["init"])?;
    Ok(())
}

use std::path::{Path, PathBuf};

fn find_all_git_roots(dir: &Path, current_depth: usize, max_depth: usize, roots: &mut Vec<PathBuf>) {
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
pub fn git_discover_roots(workspace_path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&workspace_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let mut roots = Vec::new();
    find_all_git_roots(path, 0, 4, &mut roots);
    
    let str_roots = roots.into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    
    Ok(str_roots)
}

#[tauri::command]
pub fn git_unstage(repo_path: String, file_path: String) -> Result<(), String> {
    run_git_cmd(&repo_path, &["restore", "--staged", &file_path])?;
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(
    repo_path: String, 
    name: String, 
    base: Option<String>, 
    checkout: bool
) -> Result<(), String> {
    let mut args = Vec::new();
    if checkout {
        args.push("checkout");
        args.push("-b");
    } else {
        args.push("branch");
    }
    args.push(&name);
    if let Some(ref b) = base {
        args.push(b);
    }
    run_git_cmd(&repo_path, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_delete_branch(repo_path: String, name: String, force: bool) -> Result<(), String> {
    let flag = if force { "-D" } else { "-d" };
    run_git_cmd(&repo_path, &["branch", flag, &name])?;
    Ok(())
}

#[tauri::command]
pub fn git_rename_branch(repo_path: String, old_name: String, new_name: String) -> Result<(), String> {
    run_git_cmd(&repo_path, &["branch", "-m", &old_name, &new_name])?;
    Ok(())
}

#[tauri::command]
pub fn git_create_tag(
    repo_path: String, 
    tag_name: String, 
    commit: Option<String>, 
    message: Option<String>, 
    force: bool
) -> Result<(), String> {
    let mut args = Vec::new();
    args.push("tag");
    if force {
        args.push("-f");
    }
    
    let msg_str;
    if let Some(ref msg) = message {
        args.push("-a");
        args.push(&tag_name);
        args.push("-m");
        msg_str = msg.clone();
        args.push(&msg_str);
    } else {
        args.push(&tag_name);
    }
    
    let commit_str;
    if let Some(ref c) = commit {
        commit_str = c.clone();
        args.push(&commit_str);
    }
    
    run_git_cmd(&repo_path, &args)?;
    Ok(())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeFile {
    pub path: String,
    pub status: String,
}

#[tauri::command]
pub fn git_unpushed_commits(repo_path: String, remote: String, branch: String) -> Result<Vec<GitCommitInfo>, String> {
    // Check if remote/branch exists
    let remote_ref = format!("refs/remotes/{}/{}", remote, branch);
    let has_remote_branch = run_git_cmd(&repo_path, &["rev-parse", "--verify", &remote_ref]).is_ok();
    
    let mut args = vec!["log", "--pretty=format:%h%x09%an%x09%ad%x09%s", "--date=short"];
    let range;
    if has_remote_branch {
        range = format!("{}..HEAD", remote_ref);
        args.push(&range);
    } else {
        // If remote tracking branch doesn't exist, we check if upstream branch exists
        let has_upstream = run_git_cmd(&repo_path, &["rev-parse", "--verify", "@{u}"]).is_ok();
        if has_upstream {
            args.push("@{u}..HEAD");
        } else {
            // Default fallback: show commits not on any remote branch
            // git log HEAD --not --remotes
            // To be safe, if we get nothing or error, we just get last 30 commits on current branch
            let unpushed = run_git_cmd(&repo_path, &["log", "HEAD", "--not", "--remotes", "--pretty=format:%h%x09%an%x09%ad%x09%s", "--date=short"]);
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
                                message: parts[3].to_string(),
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
                message: parts[3].to_string(),
            });
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn git_commit_files(repo_path: String, hash: String) -> Result<Vec<GitChangeFile>, String> {
    let raw = run_git_cmd(&repo_path, &["diff-tree", "--no-commit-id", "--name-status", "-r", &hash])?;
    let mut list = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            list.push(GitChangeFile {
                status: parts[0].to_string(),
                path: parts[1].to_string(),
            });
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn git_show_file(repo_path: String, hash: String, file_path: String) -> Result<String, String> {
    let revision = if hash.trim().is_empty() { "HEAD".to_string() } else { hash };
    let ref_spec = format!("{}:{}", revision, file_path);
    run_git_cmd(&repo_path, &["show", &ref_spec])
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

#[tauri::command]
pub fn git_log_graph(repo_path: String) -> Result<Vec<GitGraphCommit>, String> {
    let raw = run_git_cmd(&repo_path, &[
        "log",
        "--all",
        "--date-order",
        "-n", "200",
        "--pretty=format:%H%x09%P%x09%an%x09%ae%x09%ad%x09%D%x09%s",
        "--date=short"
    ])?;
    
    let mut list = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 7 {
            let parents = if parts[1].trim().is_empty() {
                Vec::new()
            } else {
                parts[1].split_whitespace().map(|s| s.to_string()).collect()
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
            });
        }

        let mut merged_statuses = HashMap::new();
        let mut repo_branches = HashMap::new();
        let mut dirty_folders: HashMap<String, FolderGitStatus> = HashMap::new();

        let is_windows = cfg!(target_os = "windows");
        let sep = if is_windows { "\\" } else { "/" };

        for root_path in &roots {
            // Get current branch
            if let Ok(branch) = git_current_branch(root_path.clone()) {
                repo_branches.insert(root_path.clone(), branch);
            } else {
                repo_branches.insert(root_path.clone(), "HEAD".to_string());
            }

            // Get status
            if let Ok(statuses) = git_status_impl(root_path) {
                for (rel_path, status) in statuses {
                    // Normalise rel path separators
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

                    // Trace parent folders all the way up to workspace path
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

        // Resolve active branch based on active tab path focus
        let mut active_branch = repo_branches.get(&roots[0]).cloned();
        if let Some(ref active_tab) = active_tab_path {
            let mut sorted_roots = roots.clone();
            sorted_roots.sort_by(|a, b| b.len().cmp(&a.len()));
            if let Some(matched) = sorted_roots.iter().find(|r| active_tab.starts_with(*r)) {
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
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

