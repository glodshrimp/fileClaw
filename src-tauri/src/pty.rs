use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Serialize)]
pub struct PtySpawnResult {
    pub success: bool,
    pub shell: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn pty_spawn(
    app_handle: AppHandle,
    state: tauri::State<'_, PtyState>,
    id: String,
    cwd: Option<String>,
) -> Result<PtySpawnResult, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;

    // If session already exists, return success
    if sessions.contains_key(&id) {
        return Ok(PtySpawnResult {
            success: true,
            shell: "already_running".to_string(),
            error: None,
        });
    }

    let pty_system = NativePtySystem::default();
    
    // Choose shell based on platform
    let shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    };

    let shell_basename = std::path::Path::new(&shell)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| shell.clone());

    let mut cmd = CommandBuilder::new(&shell);
    
    // login shell arguments
    if !cfg!(target_os = "windows") {
        cmd.arg("--login");
    }

    if let Some(ref path) = cwd {
        if !path.is_empty() {
            cmd.cwd(path);
        }
    }

    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let child = pty_pair.slave.spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell process: {}", e))?;

    let writer = pty_pair.master.take_writer()
        .map_err(|e| format!("Failed to get PTY master writer: {}", e))?;
        
    let mut reader = pty_pair.master.try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY master reader: {}", e))?;

    // Create session (store master handle for resize support)
    let session = PtySession {
        writer,
        _child: child,
        master: pty_pair.master,
    };
    sessions.insert(id.clone(), session);

    // Spawn reading thread
    let id_clone = id.clone();
    let app_handle_clone = app_handle.clone();
    let sessions_map_clone = Arc::clone(&state.sessions);

    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(n) if n > 0 => {
                    let output = String::from_utf8_lossy(&buffer[..n]).into_owned();
                    // Emit output to frontend
                    let _ = app_handle_clone.emit(&format!("pty-output-{}", id_clone), output);
                }
                _ => {
                    // PTY closed or read error, cleanup session
                    let mut lock = sessions_map_clone.lock().unwrap();
                    lock.remove(&id_clone);
                    let _ = app_handle_clone.emit(&format!("pty-exit-{}", id_clone), 0);
                    break;
                }
            }
        }
    });

    Ok(PtySpawnResult {
        success: true,
        shell: shell_basename,
        error: None,
    })
}

#[tauri::command]
pub fn pty_write(state: tauri::State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(&id) {
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&id) {
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Failed to resize PTY: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_destroy(state: tauri::State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.remove(&id);
    Ok(())
}

#[tauri::command]
pub fn pty_destroy_session(state: tauri::State<'_, PtyState>, session_key: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    // Remove session itself
    sessions.remove(&session_key);
    // Remove split-pane sessions associated with this key (e.g. key + "__split__")
    sessions.retain(|k, _| !k.starts_with(&format!("{}__split__", session_key)));
    Ok(())
}
