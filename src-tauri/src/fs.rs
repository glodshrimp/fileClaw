use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    mtime: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    size: u64,
    mtime: u64,
    ctime: u64,
    is_dir: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    #[serde(rename = "type")]
    file_type: String,
    data: String,
    mime_type: Option<String>,
}

#[tauri::command]
pub fn local_list_dir(dir_path: String) -> Result<Vec<FileNode>, String> {
    let path = Path::new(&dir_path);
    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            
            // Skip hidden files (.DS_Store, etc.) if desired, or keep them.
            // Let's match typical FileScan behavior (show everything except maybe dot files depending on user settings, but let's include them for completeness)
            
            let mtime = metadata.modified()
                .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
                .unwrap_or(0);

            list.push(FileNode {
                name: file_name,
                path: entry.path().to_string_lossy().into_owned(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                mtime,
            });
        }
    }

    // Sort: directories first, then alphabetical
    list.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(list)
}

#[tauri::command]
pub fn local_home_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle.path().home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("Failed to get home dir: {}", e))
}

#[tauri::command]
pub fn local_stat(file_path: String) -> Result<FileStat, String> {
    let path = Path::new(&file_path);
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    
    let mtime = metadata.modified()
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
        .unwrap_or(0);
        
    let ctime = metadata.created()
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
        .unwrap_or(mtime); // fallback to mtime if ctime not supported on platform

    Ok(FileStat {
        size: metadata.len(),
        mtime,
        ctime,
        is_dir: metadata.is_dir(),
    })
}

#[tauri::command]
pub fn local_write_file(file_path: String, content: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn local_create_node(parent_path: String, name: String, is_dir: bool) -> Result<bool, String> {
    let parent = Path::new(&parent_path);
    let new_path = parent.join(name);
    
    if is_dir {
        fs::create_dir_all(new_path).map_err(|e| e.to_string())?;
    } else {
        // Create an empty file
        fs::write(new_path, "").map_err(|e| e.to_string())?;
    }
    
    Ok(true)
}

#[tauri::command]
pub fn local_delete_node(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Ok(true);
    }
    
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    
    Ok(true)
}

#[tauri::command]
pub fn local_copy_file(src_path: String, dest_path: String) -> Result<bool, String> {
    let src = Path::new(&src_path);
    let dest = Path::new(&dest_path);
    if src.is_dir() {
        copy_dir_all(src, dest).map_err(|e| e.to_string())?;
    } else {
        std::fs::copy(src, dest).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub fn local_write_file_to_clipboard(path: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!("set the clipboard to (POSIX file \"{}\")", path);
        let output = std::process::Command::new("osascript")
            .args(&["-e", &script])
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;
        
        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("AppleScript failed: {}", err_msg));
        }
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        let script = format!("Set-Clipboard -Path \"{}\"", path);
        let output = std::process::Command::new("powershell")
            .args(&["-Command", &script])
            .output()
            .map_err(|e| format!("Failed to execute powershell: {}", e))?;
        
        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("PowerShell failed: {}", err_msg));
        }
        return Ok(true);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let output = std::process::Command::new("sh")
            .args(&["-c", &format!("echo -n \"{}\" | xclip -selection clipboard", path)])
            .output()
            .map_err(|e| e.to_string())?;
        return Ok(output.status.success());
    }
}

#[tauri::command]
pub fn local_read_file_from_clipboard() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .args(&[
                "-e", "try",
                "-e", "return POSIX path of (the clipboard as «class furl»)",
                "-e", "on error",
                "-e", "try",
                "-e", "return the clipboard as text",
                "-e", "on error",
                "-e", "return \"\"",
                "-e", "end try",
                "-e", "end try"
            ])
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;
        
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() && std::path::Path::new(&path_str).exists() {
            return Ok(path_str);
        }
        return Ok(String::new());
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(&["-Command", "(Get-Clipboard -Format FileDropList).Path"])
            .output()
            .map_err(|e| format!("Failed to execute powershell: {}", e))?;
        
        let mut path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path_str.is_empty() {
            let txt_output = std::process::Command::new("powershell")
                .args(&["-Command", "Get-Clipboard -Format Text"])
                .output()
                .map_err(|e| format!("Failed to execute powershell text fallback: {}", e))?;
            path_str = String::from_utf8_lossy(&txt_output.stdout).trim().to_string();
        }
        
        if !path_str.is_empty() && std::path::Path::new(&path_str).exists() {
            return Ok(path_str);
        }
        return Ok(String::new());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let output = std::process::Command::new("sh")
            .args(&["-c", "xclip -selection clipboard -o"])
            .output()
            .map_err(|e| e.to_string())?;
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() && std::path::Path::new(&path_str).exists() {
            return Ok(path_str);
        }
        return Ok(String::new());
    }
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    std::fs::create_dir_all(&dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn read_file_base64(file_path: String) -> Result<ReadFileResult, String> {
    let path = Path::new(&file_path);
    let ext = path.extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let is_image = match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico" => true,
        _ => false,
    };

    if is_image {
        let data_bytes = fs::read(path).map_err(|e| e.to_string())?;
        // Use base64 encoding (standard base64)
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        let b64 = STANDARD.encode(&data_bytes);
        
        let mime_type = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "ico" => "image/x-icon",
            _ => "image/png",
        };

        Ok(ReadFileResult {
            file_type: "image".to_string(),
            data: b64,
            mime_type: Some(mime_type.to_string()),
        })
    } else {
        // Try reading as UTF-8 text
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        match String::from_utf8(bytes) {
            Ok(text) => {
                Ok(ReadFileResult {
                    file_type: "text".to_string(),
                    data: text,
                    mime_type: None,
                })
            }
            Err(e) => {
                // If it's invalid UTF-8, fall back to base64 encoding
                use base64::{Engine as _, engine::general_purpose::STANDARD};
                let b64 = STANDARD.encode(e.as_bytes());
                Ok(ReadFileResult {
                    file_type: "binary".to_string(),
                    data: b64,
                    mime_type: Some("application/octet-stream".to_string()),
                })
            }
        }
    }
}

#[tauri::command]
pub async fn select_directory(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app_handle.dialog().file().pick_folder(move |p| {
        let res = p.map(|path_val| {
            let path_buf = match path_val {
                tauri_plugin_dialog::FilePath::Path(path) => path,
                tauri_plugin_dialog::FilePath::Url(url) => url.to_file_path().unwrap_or_default(),
            };
            path_buf.to_string_lossy().into_owned()
        });
        let _ = tx.send(res);
    });
    rx.await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SelectedFile {
    name: String,
    path: String,
}

#[tauri::command]
pub async fn select_files(app_handle: tauri::AppHandle) -> Result<Vec<SelectedFile>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app_handle.dialog().file().pick_files(move |paths| {
        let res = paths.map(|list| {
            list.into_iter()
                .map(|p| {
                    let path_buf = match p {
                        tauri_plugin_dialog::FilePath::Path(path) => path,
                        tauri_plugin_dialog::FilePath::Url(url) => url.to_file_path().unwrap_or_default(),
                    };
                    let name = path_buf.file_name()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    SelectedFile {
                        name,
                        path: path_buf.to_string_lossy().into_owned(),
                    }
                })
                .collect::<Vec<SelectedFile>>()
        }).unwrap_or_default();
        let _ = tx.send(res);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_directory(app_handle: tauri::AppHandle, dir_path: String) -> Result<(), String> {
    // Normalize path separators on Windows to avoid explorer.exe parsing issues/freezes
    let normalized_path = if cfg!(target_os = "windows") {
        dir_path.replace("/", "\\")
    } else {
        dir_path
    };

    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .open_path(&normalized_path, None::<&str>)
        .map_err(|e| format!("Failed to open path: {}", e))
}

#[tauri::command]
pub fn execute_bash_command(command: String, cwd: Option<String>) -> Result<String, String> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("powershell");
        c.args(&["-Command", &command]);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.args(&["-c", &command]);
        c
    };

    if let Some(ref path) = cwd {
        if !path.is_empty() {
            cmd.current_dir(path);
        }
    }

    let output = cmd.output().map_err(|e| format!("Failed to execute command: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("Exit code {}:\nStdout: {}\nStderr: {}", output.status.code().unwrap_or(-1), stdout, stderr))
    }
}

