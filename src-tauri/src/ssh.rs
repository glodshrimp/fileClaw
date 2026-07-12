use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use socket2::{Socket, Domain, Type, Protocol};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub struct SshShell {
    channel: ssh2::Channel,
}

pub struct SshTunnel {
    shutdown_tx: std::sync::mpsc::Sender<()>,
}

pub struct SshSession {
    session: ssh2::Session,
    _tcp: TcpStream,
    shells: HashMap<String, SshShell>,
    tunnels: HashMap<String, SshTunnel>,
    sftp: Option<ssh2::Sftp>,
    
    // Connection parameters to lazy-connect a dedicated session for tunnels
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    key_path: Option<String>,
    tunnel_session: Option<ssh2::Session>,
    _tunnel_tcp: Option<TcpStream>,
    shell_session: Option<ssh2::Session>,
    _shell_tcp: Option<TcpStream>,
}

#[derive(Default)]
pub struct SshState {
    pub sessions: Arc<Mutex<HashMap<String, SshSession>>>,
    pub cancelled_transfers: Arc<Mutex<HashSet<String>>>,
}

#[derive(Serialize)]
pub struct SshConnectResult {
    success: bool,
    error: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpFile {
    name: String,
    size: u64,
    mtime: u64,
    is_dir: bool,
    mode: u32,
    octal: String,
}

#[derive(Serialize)]
pub struct ExecResult {
    stdout: String,
    stderr: String,
    code: i32,
}

fn connect_tcp_with_timeout(host: &str, port: u16, timeout_secs: u64) -> Result<TcpStream, String> {
    use std::net::ToSocketAddrs;
    use std::time::Duration;
    
    let addr_str = format!("{}:{}", host, port);
    let mut addrs = addr_str.to_socket_addrs()
        .map_err(|e| format!("Invalid host/port {}: {}", addr_str, e))?;
        
    let addr = addrs.next().ok_or_else(|| format!("Could not resolve host: {}", host))?;
    
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(timeout_secs))
        .map_err(|e| format!("Failed to connect to TCP socket {}: {}", addr_str, e))?;
        
    Ok(tcp)
}

#[tauri::command]
pub async fn ssh_connect(
    state: tauri::State<'_, SshState>,
    id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    key_path: Option<String>,
) -> Result<SshConnectResult, String> {
    let sessions_arc = state.sessions.clone();

    tokio::task::spawn_blocking(move || {
        // Clean old session if it exists
        {
            let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
            sessions.remove(&id);
        }

        let tcp = connect_tcp_with_timeout(&host, port, 10)?;

        let mut session = ssh2::Session::new()
            .map_err(|e| format!("Failed to initialize SSH session: {}", e))?;
        session.set_tcp_stream(tcp.try_clone().unwrap());
        session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Authentication
        if let Some(ref path_str) = key_path {
            if !path_str.is_empty() {
                let path = Path::new(path_str);
                session.userauth_pubkey_file(&username, None, path, password.as_deref())
                    .map_err(|e| format!("Public key authentication failed: {}", e))?;
            } else if let Some(ref pass) = password {
                session.userauth_password(&username, pass)
                    .map_err(|e| format!("Password authentication failed: {}", e))?;
            } else {
                return Ok(SshConnectResult {
                    success: false,
                    error: Some("Authentication method missing".to_string()),
                    message: None,
                });
            }
        } else if let Some(ref pass) = password {
            session.userauth_password(&username, pass)
                .map_err(|e| format!("Password authentication failed: {}", e))?;
        } else {
            return Ok(SshConnectResult {
                success: false,
                error: Some("Authentication method missing".to_string()),
                message: None,
            });
        }

        if !session.authenticated() {
            return Ok(SshConnectResult {
                success: false,
                error: Some("Authentication failed".to_string()),
                message: None,
            });
        }

        let ssh_session = SshSession {
            session,
            _tcp: tcp,
            shells: HashMap::new(),
            tunnels: HashMap::new(),
            sftp: None,
            host,
            port,
            username,
            password,
            key_path,
            tunnel_session: None,
            _tunnel_tcp: None,
            shell_session: None,
            _shell_tcp: None,
        };
        
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        sessions.insert(id, ssh_session);

        Ok(SshConnectResult {
            success: true,
            error: None,
            message: Some("Connected successfully".to_string()),
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

fn connect_session(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    key_path: Option<&str>,
    timeout_secs: u64
) -> Result<(ssh2::Session, TcpStream), String> {
    let tcp = connect_tcp_with_timeout(host, port, timeout_secs)?;

    let mut session = ssh2::Session::new()
        .map_err(|e| format!("Failed to initialize SSH session: {}", e))?;
    session.set_tcp_stream(tcp.try_clone().unwrap());
    session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    if let Some(path_str) = key_path {
        if !path_str.is_empty() {
            let path = Path::new(path_str);
            session.userauth_pubkey_file(
                username,
                None,
                path,
                password,
            )
            .map_err(|e| format!("Public key auth failed: {}", e))?;
        } else if let Some(pass) = password {
            session.userauth_password(username, pass)
                .map_err(|e| format!("Password auth failed: {}", e))?;
        }
    } else if let Some(pass) = password {
        session.userauth_password(username, pass)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else {
        return Err("Authentication method missing".to_string());
    }

    if !session.authenticated() {
        return Err("Authentication failed".to_string());
    }
    
    Ok((session, tcp))
}

#[tauri::command]
pub fn ssh_disconnect(state: tauri::State<'_, SshState>, id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.remove(&id);
    Ok(())
}

fn get_or_create_dedicated_session(
    id: &str,
    sessions_arc: &Arc<Mutex<HashMap<String, SshSession>>>,
    is_shell: bool,
) -> Result<ssh2::Session, String> {
    let (host, port, username, password, key_path, existing_session) = {
        let sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get(id).ok_or_else(|| "No active SSH connection".to_string())?;
        let sess = if is_shell { &ssh_session.shell_session } else { &ssh_session.tunnel_session };
        if let Some(ref s) = sess {
            (String::new(), 0, String::new(), None, None, Some(s.clone()))
        } else {
            (
                ssh_session.host.clone(),
                ssh_session.port,
                ssh_session.username.clone(),
                ssh_session.password.clone(),
                ssh_session.key_path.clone(),
                None
            )
        }
    };
    
    if let Some(sess) = existing_session {
        Ok(sess)
    } else {
        let (session, tcp) = connect_session(
            &host,
            port,
            &username,
            password.as_deref(),
            key_path.as_deref(),
            10
        )?;
        session.set_blocking(false);
        
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        if let Some(ssh_session) = sessions.get_mut(id) {
            if is_shell {
                ssh_session.shell_session = Some(session.clone());
                ssh_session._shell_tcp = Some(tcp);
            } else {
                ssh_session.tunnel_session = Some(session.clone());
                ssh_session._tunnel_tcp = Some(tcp);
            }
        }
        Ok(session)
    }
}

#[tauri::command]
pub async fn ssh_open_shell(
    app_handle: AppHandle,
    state: tauri::State<'_, SshState>,
    id: String,
    shell_id: String,
) -> Result<(), String> {
    let sessions_arc = state.sessions.clone();
    
    tokio::task::spawn_blocking(move || {
        let shell_session = get_or_create_dedicated_session(&id, &sessions_arc, true)?;

        // channel_session loop for non-blocking connection
        let mut channel = loop {
            match shell_session.channel_session() {
                Ok(ch) => break ch,
                Err(ref e) if e.code() == ssh2::ErrorCode::Session(-37) || e.message().contains("WouldBlock") || e.message().contains("EAGAIN") => {
                    thread::sleep(std::time::Duration::from_millis(10));
                }
                _ => return Err("Failed to create SSH channel".to_string()),
            }
        };
        
        // request_pty loop
        loop {
            match channel.request_pty("xterm-256color", None, None) {
                Ok(_) => break,
                Err(ref e) if e.code() == ssh2::ErrorCode::Session(-37) || e.message().contains("WouldBlock") || e.message().contains("EAGAIN") => {
                    thread::sleep(std::time::Duration::from_millis(10));
                }
                _ => return Err("Failed to request PTY".to_string()),
            }
        }
            
        // shell loop
        loop {
            match channel.shell() {
                Ok(_) => break,
                Err(ref e) if e.code() == ssh2::ErrorCode::Session(-37) || e.message().contains("WouldBlock") || e.message().contains("EAGAIN") => {
                    thread::sleep(std::time::Duration::from_millis(10));
                }
                _ => return Err("Failed to open shell".to_string()),
            }
        }

        let mut reader = channel.stream(0); // stdout stream
        let shell_id_clone = shell_id.clone();
        let app_handle_clone = app_handle.clone();
        
        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            let mut delay = 10;
            loop {
                // Lock briefly to read from the channel stream.
                // Since it is non-blocking, it won't block the thread.
                // We just read whatever is available and release the lock immediately.
                match reader.read(&mut buffer) {
                    Ok(n) if n > 0 => {
                        let output = String::from_utf8_lossy(&buffer[..n]).into_owned();
                        let _ = app_handle_clone.emit(&format!("ssh-output-{}", shell_id_clone), output);
                        delay = 5; // Reset delay to 5ms on activity
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(delay));
                        if delay < 100 {
                            delay += 10; // Backoff up to 100ms
                        }
                    }
                    _ => {
                        let _ = app_handle_clone.emit(&format!("ssh-closed-{}", shell_id_clone), ());
                        break;
                    }
                }
            }
        });

        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        if let Some(ssh_session) = sessions.get_mut(&id) {
            ssh_session.shells.insert(shell_id, SshShell { channel });
        }
        Ok(())
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[tauri::command]
pub fn ssh_write_shell(
    state: tauri::State<'_, SshState>,
    id: String,
    shell_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let shell = ssh_session.shells.get_mut(&shell_id).ok_or_else(|| "Shell not found".to_string())?;
    
    let bytes = data.as_bytes();
    let mut written = 0;
    while written < bytes.len() {
        match shell.channel.write(&bytes[written..]) {
            Ok(n) if n > 0 => {
                written += n;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(5));
            }
            _ => return Err("Write failed".to_string()),
        }
    }
    loop {
        match shell.channel.flush() {
            Ok(_) => break,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(5));
            }
            _ => break,
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_resize_shell(
    state: tauri::State<'_, SshState>,
    id: String,
    shell_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let shell = ssh_session.shells.get_mut(&shell_id).ok_or_else(|| "Shell not found".to_string())?;
    
    loop {
        match shell.channel.request_pty_size(cols as u32, rows as u32, None, None) {
            Ok(_) => break,
            Err(ref e) if e.code() == ssh2::ErrorCode::Session(-37) || e.message().contains("WouldBlock") || e.message().contains("EAGAIN") => {
                thread::sleep(std::time::Duration::from_millis(10));
            }
            _ => return Err("Failed to resize shell".to_string()),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_close_shell(
    state: tauri::State<'_, SshState>,
    id: String,
    shell_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    ssh_session.shells.remove(&shell_id);
    Ok(())
}

#[tauri::command]
pub fn ssh_exec(
    state: tauri::State<'_, SshState>,
    id: String,
    command: String,
) -> Result<ExecResult, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;

    let mut channel = ssh_session.session.channel_session()
        .map_err(|e| e.to_string())?;
    channel.exec(&command).map_err(|e| e.to_string())?;

    let mut stdout = String::new();
    channel.read_to_string(&mut stdout).map_err(|e| e.to_string())?;

    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr).map_err(|e| e.to_string())?;

    channel.wait_close().unwrap_or(());
    let code = channel.exit_status().unwrap_or(0);

    Ok(ExecResult { stdout, stderr, code })
}

// Helper to open or cache SFTP
fn get_sftp<'a>(ssh_session: &'a mut SshSession) -> Result<&'a ssh2::Sftp, String> {
    if ssh_session.sftp.is_none() {
        let sftp = ssh_session.session.sftp()
            .map_err(|e| format!("Failed to start SFTP session: {}", e))?;
        ssh_session.sftp = Some(sftp);
    }
    Ok(ssh_session.sftp.as_ref().unwrap())
}

#[tauri::command]
pub fn sftp_list(
    state: tauri::State<'_, SshState>,
    id: String,
    path: String,
) -> Result<Vec<SftpFile>, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;

    let entries = sftp.readdir(Path::new(&path))
        .map_err(|e| format!("Failed to read SFTP directory: {}", e))?;

    let mut list = Vec::new();
    for (entry_path, stat) in entries {
        let name = entry_path.file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| entry_path.to_string_lossy().into_owned());
            
        // Ignore dot files like "." and ".."
        if name == "." || name == ".." {
            continue;
        }

        let is_dir = stat.is_dir();
        let size = stat.size.unwrap_or(0);
        let mtime = stat.mtime.unwrap_or(0) * 1000; // ms
        let mode = stat.perm.unwrap_or(0);
        let octal = format!("{:o}", mode & 0o777);

        list.push(SftpFile {
            name,
            size,
            mtime,
            is_dir,
            mode,
            octal,
        });
    }

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
pub fn sftp_mkdir(state: tauri::State<'_, SshState>, id: String, path: String) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;
    sftp.mkdir(Path::new(&path), 0o755).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn sftp_rmdir(state: tauri::State<'_, SshState>, id: String, path: String) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;
    sftp.rmdir(Path::new(&path)).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn sftp_unlink(state: tauri::State<'_, SshState>, id: String, path: String) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;
    sftp.unlink(Path::new(&path)).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn sftp_rename(
    state: tauri::State<'_, SshState>,
    id: String,
    old_path: String,
    new_path: String,
) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;
    sftp.rename(Path::new(&old_path), Path::new(&new_path), None).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn sftp_stat(
    state: tauri::State<'_, SshState>,
    id: String,
    file_path: String,
) -> Result<SftpFile, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;
    
    let path = Path::new(&file_path);
    let stat = sftp.stat(path).map_err(|e| e.to_string())?;
    let name = path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(SftpFile {
        name,
        size: stat.size.unwrap_or(0),
        mtime: stat.mtime.unwrap_or(0) * 1000,
        is_dir: stat.is_dir(),
        mode: stat.perm.unwrap_or(0),
        octal: format!("{:o}", stat.perm.unwrap_or(0) & 0o777),
    })
}

#[tauri::command]
pub fn sftp_chmod(
    state: tauri::State<'_, SshState>,
    id: String,
    file_path: String,
    mode: u32,
) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;

    let mut stat = sftp.stat(Path::new(&file_path)).map_err(|e| e.to_string())?;
    stat.perm = Some(mode);
    sftp.setstat(Path::new(&file_path), stat).map_err(|e| e.to_string())?;
    Ok(true)
}

// SFTP Upload with chunking and cancellation support
#[tauri::command]
pub fn sftp_upload(
    app_handle: AppHandle,
    state: tauri::State<'_, SshState>,
    id: String,
    local_path: String,
    remote_path: String,
    jid: String,
) -> Result<bool, String> {
    // Acquire a lock temporarily to clone necessary connections
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;
    
    // Open target remote file
    let mut remote_file = sftp.create(Path::new(&remote_path))
        .map_err(|e| format!("Failed to create remote file: {}", e))?;
        
    // Open local file
    let mut local_file = File::open(&local_path)
        .map_err(|e| format!("Failed to open local file: {}", e))?;
        
    let total_size = local_file.metadata().map(|m| m.len()).unwrap_or(0);
    
    // Clear cancelled state if it was there
    let cancelled_set = Arc::clone(&state.cancelled_transfers);
    {
        let mut cancel_lock = cancelled_set.lock().unwrap();
        cancel_lock.remove(&jid);
    }
    
    // Perform copy loop in blocking fashion (Tauri commands can block if spawned on pool)
    let mut buffer = [0u8; 32768]; // 32KB buffer chunks
    let mut transferred = 0;
    
    loop {
        // Check cancellation
        {
            let cancel_lock = cancelled_set.lock().unwrap();
            if cancel_lock.contains(&jid) {
                return Err("Transfer cancelled by user".to_string());
            }
        }

        let n = local_file.read(&mut buffer)
            .map_err(|e| format!("Local read failed: {}", e))?;
        if n == 0 {
            break;
        }
        
        remote_file.write_all(&buffer[..n])
            .map_err(|e| format!("Remote write failed: {}", e))?;
            
        transferred += n as u64;
        
        // Emit progress
        #[derive(Serialize, Clone)]
        struct ProgressPayload {
            jid: String,
            file: String,
            transferred: u64,
            total: u64,
        }
        let _ = app_handle.emit("sftp-progress", ProgressPayload {
            jid: jid.clone(),
            file: local_path.clone(),
            transferred,
            total: total_size,
        });
    }
    
    Ok(true)
}

// SFTP Download with chunking and cancellation support
#[tauri::command]
pub fn sftp_download(
    app_handle: AppHandle,
    state: tauri::State<'_, SshState>,
    id: String,
    remote_path: String,
    local_path: String,
    jid: String,
) -> Result<bool, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    let sftp = get_sftp(ssh_session)?;
    
    let remote_stat = sftp.stat(Path::new(&remote_path)).map_err(|e| e.to_string())?;
    let total_size = remote_stat.size.unwrap_or(0);

    let mut remote_file = sftp.open(Path::new(&remote_path))
        .map_err(|e| format!("Failed to open remote file: {}", e))?;
        
    let mut local_file = File::create(&local_path)
        .map_err(|e| format!("Failed to create local file: {}", e))?;

    let cancelled_set = Arc::clone(&state.cancelled_transfers);
    {
        let mut cancel_lock = cancelled_set.lock().unwrap();
        cancel_lock.remove(&jid);
    }
    
    let mut buffer = [0u8; 32768];
    let mut transferred = 0;
    
    loop {
        // Check cancellation
        {
            let cancel_lock = cancelled_set.lock().unwrap();
            if cancel_lock.contains(&jid) {
                return Err("Transfer cancelled by user".to_string());
            }
        }

        let n = remote_file.read(&mut buffer)
            .map_err(|e| format!("Remote read failed: {}", e))?;
        if n == 0 {
            break;
        }
        
        local_file.write_all(&buffer[..n])
            .map_err(|e| format!("Local write failed: {}", e))?;
            
        transferred += n as u64;
        
        #[derive(Serialize, Clone)]
        struct ProgressPayload {
            jid: String,
            file: String,
            transferred: u64,
            total: u64,
        }
        let _ = app_handle.emit("sftp-progress", ProgressPayload {
            jid: jid.clone(),
            file: remote_path.clone(),
            transferred,
            total: total_size,
        });
    }

    Ok(true)
}

#[tauri::command]
pub fn sftp_cancel_transfer(state: tauri::State<'_, SshState>, jid: String) -> Result<bool, String> {
    let mut cancel_lock = state.cancelled_transfers.lock().map_err(|e| e.to_string())?;
    cancel_lock.insert(jid);
    Ok(true)
}

// SSH Local Port Forwarding: Listen locally, pipe to SSH direct connection channel
#[tauri::command]
pub async fn ssh_forward_local(
    state: tauri::State<'_, SshState>,
    id: String,
    tunnel_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    
    tokio::task::spawn_blocking(move || {
        let tunnel_session = get_or_create_dedicated_session(&id, &sessions_arc, false)?;

        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", local_port).parse()
            .map_err(|e| format!("Invalid address: {}", e))?;
        let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
            .map_err(|e| format!("Failed to create socket: {}", e))?;
        socket.set_reuse_address(true)
            .map_err(|e| format!("Failed to set SO_REUSEADDR: {}", e))?;
        socket.bind(&addr.into())
            .map_err(|e| format!("Failed to bind local port: {}", e))?;
        socket.listen(128)
            .map_err(|e| format!("Failed to listen: {}", e))?;
        let listener: TcpListener = socket.into();
        listener.set_nonblocking(true).unwrap_or(());

        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();
        
        // Dedicated connection session clone
        let session_clone = tunnel_session;
        let r_host = remote_host;
        
        thread::spawn(move || {
            let mut accept_delay = 50;
            loop {
                // Check shutdown channel
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }

                if let Ok((mut local_stream, _)) = listener.accept() {
                    accept_delay = 50; // Reset accept delay on connection
                    let session = session_clone.clone();
                    let r_host_clone = r_host.clone();
                    
                    thread::spawn(move || {
                        // Set non-blocking on local TcpStream
                        local_stream.set_nonblocking(true).unwrap_or(());

                        // Try to open direct tcpip channel, retrying if WouldBlock/EAGAIN
                        let mut channel = None;
                        loop {
                            match session.channel_direct_tcpip(&r_host_clone, remote_port, None) {
                                Ok(ch) => {
                                    channel = Some(ch);
                                    break;
                                }
                                Err(e) => {
                                    let err_msg = e.message().to_string();
                                    let code = e.code();
                                    if code == ssh2::ErrorCode::Session(-37) || err_msg.contains("WouldBlock") || err_msg.contains("EAGAIN") {
                                        thread::sleep(std::time::Duration::from_millis(10));
                                    } else {
                                        println!("[Tunnel Error] channel_direct_tcpip failed (code {}): {}", code, err_msg);
                                        break;
                                    }
                                }
                            }
                        }

                        if let Some(mut channel) = channel {
                            let mut local_buf = [0u8; 4096];
                            let mut channel_buf = [0u8; 4096];

                            let mut delay = 10;
                            loop {
                                let mut active = false;

                                // Read local -> Write remote
                                match local_stream.read(&mut local_buf) {
                                    Ok(0) => break, // EOF
                                    Ok(n) => {
                                        active = true;
                                        let mut written = 0;
                                        while written < n {
                                            match channel.write(&local_buf[written..n]) {
                                                Ok(w) if w > 0 => written += w,
                                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                    thread::sleep(std::time::Duration::from_millis(5));
                                                }
                                                _ => break,
                                            }
                                        }
                                    }
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                    _ => break,
                                }

                                // Read remote -> Write local
                                match channel.read(&mut channel_buf) {
                                    Ok(0) => break, // EOF
                                    Ok(n) => {
                                        active = true;
                                        let mut written = 0;
                                        while written < n {
                                            match local_stream.write(&channel_buf[written..n]) {
                                                Ok(w) if w > 0 => written += w,
                                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                    thread::sleep(std::time::Duration::from_millis(5));
                                                }
                                                _ => break,
                                            }
                                        }
                                    }
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                    _ => break,
                                }

                                if active {
                                    delay = 5;
                                } else {
                                    thread::sleep(std::time::Duration::from_millis(delay));
                                    if delay < 120 {
                                        delay += 15; // Backoff up to 120ms
                                    }
                                }
                            }
                        }
                    });
                } else {
                    thread::sleep(std::time::Duration::from_millis(accept_delay));
                    if accept_delay < 250 {
                        accept_delay += 25; // Backoff accept loop up to 250ms when idle
                    }
                }
            }
        });

        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        if let Some(ssh_session) = sessions.get_mut(&id) {
            ssh_session.tunnels.insert(tunnel_id, SshTunnel { shutdown_tx });
        }
        Ok(true)
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

// SSH Remote Port Forwarding: Ask remote host to listen and forward back
#[tauri::command]
pub async fn ssh_forward_remote(
    state: tauri::State<'_, SshState>,
    id: String,
    tunnel_id: String,
    remote_port: u16,
    local_host: String,
    local_port: u16,
) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();

    tokio::task::spawn_blocking(move || {
        let tunnel_session = get_or_create_dedicated_session(&id, &sessions_arc, false)?;

        tunnel_session.set_blocking(true);
        let mut listener = tunnel_session.channel_forward_listen(remote_port, Some("127.0.0.1"), None)
            .map_err(|e| format!("Failed to request remote listen: {}", e))?;
        tunnel_session.set_blocking(false);

        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();
    
    let l_host = local_host;
    thread::spawn(move || {
        let mut accept_delay = 50;
        loop {
            if shutdown_rx.try_recv().is_ok() {
                break;
            }

            if let Ok(mut channel) = listener.0.accept() {
                accept_delay = 50; // Reset accept delay on connection
                let l_host_clone = l_host.clone();
                thread::spawn(move || {
                    if let Ok(mut local_stream) = TcpStream::connect(format!("{}:{}", l_host_clone, local_port)) {
                        local_stream.set_nonblocking(true).unwrap_or(());

                        let mut local_buf = [0u8; 4096];
                        let mut channel_buf = [0u8; 4096];

                        let mut delay = 10;
                        loop {
                            let mut active = false;

                            // Read local -> Write remote
                            match local_stream.read(&mut local_buf) {
                                Ok(0) => break, // EOF
                                Ok(n) => {
                                    active = true;
                                    let mut written = 0;
                                    while written < n {
                                        match channel.write(&local_buf[written..n]) {
                                            Ok(w) if w > 0 => written += w,
                                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                thread::sleep(std::time::Duration::from_millis(5));
                                            }
                                            _ => break,
                                        }
                                    }
                                }
                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                _ => break,
                            }

                            // Read remote -> Write local
                            match channel.read(&mut channel_buf) {
                                Ok(0) => break, // EOF
                                Ok(n) => {
                                    active = true;
                                    let mut written = 0;
                                    while written < n {
                                        match local_stream.write(&channel_buf[written..n]) {
                                            Ok(w) if w > 0 => written += w,
                                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                                thread::sleep(std::time::Duration::from_millis(5));
                                            }
                                            _ => break,
                                        }
                                    }
                                }
                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                _ => break,
                            }

                            if active {
                                delay = 5;
                            } else {
                                thread::sleep(std::time::Duration::from_millis(delay));
                                if delay < 120 {
                                    delay += 15; // Backoff up to 120ms
                                }
                            }
                        }
                    }
                });
            } else {
                thread::sleep(std::time::Duration::from_millis(accept_delay));
                if accept_delay < 250 {
                    accept_delay += 25; // Backoff accept loop up to 250ms when idle
                }
            }
            }
        });

        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        if let Some(ssh_session) = sessions.get_mut(&id) {
            ssh_session.tunnels.insert(tunnel_id, SshTunnel { shutdown_tx });
        }
        Ok(true)
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[tauri::command]
pub fn ssh_stop_tunnel(
    state: tauri::State<'_, SshState>,
    id: String,
    tunnel_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    if let Some(tunnel) = ssh_session.tunnels.remove(&tunnel_id) {
        let _ = tunnel.shutdown_tx.send(());
    }
    Ok(())
}
