use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use socket2::{Socket, Domain, Type, Protocol};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
pub struct SshShell {
    write_tx: std::sync::mpsc::Sender<Vec<u8>>,
    resize_tx: std::sync::mpsc::Sender<(u16, u16)>,
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
    
    // Connection parameters to lazy-connect dedicated sessions
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    key_path: Option<String>,
    tunnel_session: Option<ssh2::Session>,
    _tunnel_tcp: Option<TcpStream>,
    shell_session: Option<ssh2::Session>,
    _shell_tcp: Option<TcpStream>,

    connecting_shells: HashSet<String>,
}

#[derive(Default)]
pub struct SshState {
    pub sessions: Arc<Mutex<HashMap<String, SshSession>>>,
    /// Fast, non-blocking lookup table for shell write/resize channels so SFTP/exec never block typing
    pub fast_shells: Arc<Mutex<HashMap<String, SshShell>>>,
    pub cancelled_transfers: Arc<Mutex<HashSet<String>>>,
}

/// Expand leading `~` or `~/` or `~\` to the user's home directory on both Windows and macOS/Linux
fn expand_tilde(path_str: &str) -> std::path::PathBuf {
    let trimmed = path_str.trim();
    if trimmed == "~" || trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            let home_path = std::path::PathBuf::from(home);
            if trimmed == "~" {
                return home_path;
            }
            return home_path.join(&trimmed[2..]);
        }
    }
    std::path::PathBuf::from(trimmed)
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
    
    let addr_str = format!("{}:{}", host, port);
    let mut addrs = addr_str.to_socket_addrs()
        .map_err(|e| format!("Invalid host/port {}: {}", addr_str, e))?;
        
    let addr = addrs.next().ok_or_else(|| format!("Could not resolve host: {}", host))?;
    
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(timeout_secs))
        .map_err(|e| format!("Failed to connect to TCP socket {}: {}", addr_str, e))?;
        
    // Disable Nagle's algorithm for low latency interaction
    let _ = tcp.set_nodelay(true);

    // Enable TCP keepalive at socket level to prevent NAT/firewall idle timeout
    if let Ok(socket) = tcp.try_clone() {
        let socket = socket2::Socket::from(socket);
        let keepalive = socket2::TcpKeepalive::new()
            .with_time(Duration::from_secs(15));
        let _ = socket.set_tcp_keepalive(&keepalive);
    }
        
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
    let fast_shells_arc = state.fast_shells.clone();

    tokio::task::spawn_blocking(move || {
        // Clean old session and its fast_shells entries if it exists
        {
            if let Ok(mut fast) = fast_shells_arc.lock() {
                fast.remove(&id);
                let split_prefix = format!("{}__split__", id);
                fast.retain(|k, _| !k.starts_with(&split_prefix));
            }
            let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
            if let Some(old_session) = sessions.remove(&id) {
                for (_, tunnel) in old_session.tunnels {
                    let _ = tunnel.shutdown_tx.send(());
                }
            }
        }

        let tcp = connect_tcp_with_timeout(&host, port, 10)?;

        let mut session = ssh2::Session::new()
            .map_err(|e| format!("Failed to initialize SSH session: {}", e))?;
        session.set_tcp_stream(tcp.try_clone().unwrap());
        session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Authentication (with ~ home directory expansion for Windows & macOS)
        if let Some(ref path_str) = key_path {
            if !path_str.trim().is_empty() {
                let expanded_path = expand_tilde(path_str);
                session.userauth_pubkey_file(&username, None, &expanded_path, password.as_deref())
                    .map_err(|e| format!("Public key authentication failed ({}): {}", expanded_path.display(), e))?;
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

        session.set_keepalive(true, 10);

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
            connecting_shells: HashSet::new(),
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
        if !path_str.trim().is_empty() {
            let expanded_path = expand_tilde(path_str);
            session.userauth_pubkey_file(
                username,
                None,
                &expanded_path,
                password,
            )
            .map_err(|e| format!("Public key auth failed ({}): {}", expanded_path.display(), e))?;
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

    session.set_keepalive(true, 10);
    
    Ok((session, tcp))
}

#[tauri::command]
pub fn ssh_disconnect(state: tauri::State<'_, SshState>, id: String) -> Result<(), String> {
    if let Ok(mut fast) = state.fast_shells.lock() {
        fast.remove(&id);
        let split_prefix = format!("{}__split__", id);
        fast.retain(|k, _| !k.starts_with(&split_prefix));
    }
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(old_session) = sessions.remove(&id) {
        for (_, tunnel) in old_session.tunnels {
            let _ = tunnel.shutdown_tx.send(());
        }
    }
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
        if !is_shell {
            session.set_blocking(false);
        }
        
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
    let fast_shells_arc = state.fast_shells.clone();
    
    // Acquire the lock to check if the shell is already registered or connecting.
    // If it is, return early to prevent double execution.
    // Otherwise, mark it as connecting and fetch connection parameters.
    let (host, port, username, password, key_path) = {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        
        if ssh_session.shells.contains_key(&shell_id) || ssh_session.connecting_shells.contains(&shell_id) {
            return Ok(());
        }
        
        ssh_session.connecting_shells.insert(shell_id.clone());
        
        (
            ssh_session.host.clone(),
            ssh_session.port,
            ssh_session.username.clone(),
            ssh_session.password.clone(),
            ssh_session.key_path.clone(),
        )
    };

    let shell_id_for_thread = shell_id.clone();
    let id_for_thread = id.clone();
    
    let connect_res = tokio::task::spawn_blocking(move || {
        // Connect a dedicated session just for this shell tab/pane
        let connect_outcome = connect_session(
            &host,
            port,
            &username,
            password.as_deref(),
            key_path.as_deref(),
            10
        );
        let (shell_session, tcp) = match connect_outcome {
            Ok(pair) => pair,
            Err(e) => {
                if let Ok(mut sessions) = sessions_arc.lock() {
                    if let Some(ssh_session) = sessions.get_mut(&id_for_thread) {
                        ssh_session.connecting_shells.remove(&shell_id_for_thread);
                    }
                }
                return Err(e);
            }
        };
        
        // Double-check if the connection request was cancelled in the meantime
        {
            let sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
            if let Some(ssh_session) = sessions.get(&id_for_thread) {
                if !ssh_session.connecting_shells.contains(&shell_id_for_thread) {
                    return Err("Cancelled".to_string());
                }
            } else {
                return Err("Session closed".to_string());
            }
        }
        
        shell_session.set_blocking(true);
        shell_session.set_timeout(1000); // 1000ms timeout for initial shell handshake and prompt loading

        let mut channel = shell_session.channel_session()
            .map_err(|e| format!("Failed to create SSH channel: {}", e))?;
        channel.request_pty("xterm-256color", None, None)
            .map_err(|e| format!("Failed to request PTY: {}", e))?;
        channel.shell()
            .map_err(|e| format!("Failed to open shell: {}", e))?;

        // Print connection success message
        let _ = app_handle.emit(
            &format!("ssh-output-{}", shell_id_for_thread),
            "\r\n\x1b[32m[系统提示: SSH 终端连接已建立!]\x1b[0m\r\n\r\n".to_string()
        );

        let (write_tx, write_rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let (resize_tx, resize_rx) = std::sync::mpsc::channel::<(u16, u16)>();

        let shell_id_clone = shell_id_for_thread.clone();
        let id_clone = id_for_thread.clone();
        let app_handle_clone = app_handle.clone();
        let sessions_cleanup_arc = sessions_arc.clone();
        let fast_shells_cleanup_arc = fast_shells_arc.clone();
        
        let shell_session_clone = shell_session.clone();
        let tcp_clone = tcp.try_clone().unwrap();

        thread::spawn(move || {
            let mut buffer = [0u8; 16384];
            let mut utf8_remainder = Vec::<u8>::with_capacity(32768);
            
            // Keep session and tcp stream in this thread so they are kept alive
            let _session = shell_session_clone;
            let _tcp = tcp_clone;
            
            // Helper closure to flush decoded UTF-8 text while retaining incomplete trailing multi-byte sequences
            let flush_utf8 = |buf: &mut Vec<u8>, app: &AppHandle, target_shell_id: &str| {
                if buf.is_empty() {
                    return;
                }
                match std::str::from_utf8(buf) {
                    Ok(valid_str) => {
                        let output = valid_str.to_string();
                        buf.clear();
                        let _ = app.emit(&format!("ssh-output-{}", target_shell_id), output);
                    }
                    Err(e) => {
                        let valid_len = e.valid_up_to();
                        if valid_len > 0 {
                            let valid_str = String::from_utf8_lossy(&buf[..valid_len]).into_owned();
                            let _ = app.emit(&format!("ssh-output-{}", target_shell_id), valid_str);
                        }
                        if let Some(error_len) = e.error_len() {
                            buf.drain(..valid_len + error_len);
                        } else {
                            buf.drain(..valid_len);
                        }
                    }
                }
            };

            // Perform an initial blocking read with the 1000ms timeout
            // to ensure we capture the login banner and initial prompt
            let mut reader = channel.stream(0);
            if let Ok(n) = reader.read(&mut buffer) {
                if n > 0 {
                    utf8_remainder.extend_from_slice(&buffer[..n]);
                    flush_utf8(&mut utf8_remainder, &app_handle_clone, &shell_id_clone);
                }
            }

            // Set the timeout to 25ms for responsive, low-latency interaction
            _session.set_timeout(25);
            
            loop {
                // 1. Handle any pending resize requests
                loop {
                    match resize_rx.try_recv() {
                        Ok((cols, rows)) => {
                            let _ = channel.request_pty_size(cols as u32, rows as u32, None, None);
                        }
                        Err(std::sync::mpsc::TryRecvError::Empty) => break,
                        Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                            return;
                        }
                    }
                }

                // 2. Handle any pending write requests
                loop {
                    match write_rx.try_recv() {
                        Ok(data) => {
                            let bytes = data.as_slice();
                            let mut written = 0;
                            let mut write_failed = false;
                            while written < bytes.len() {
                                match channel.write(&bytes[written..]) {
                                    Ok(n) if n > 0 => {
                                        written += n;
                                    }
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock 
                                               || e.kind() == std::io::ErrorKind::TimedOut => {
                                        thread::sleep(std::time::Duration::from_millis(1));
                                    }
                                    _ => {
                                        write_failed = true;
                                        break;
                                    }
                                }
                            }
                            if write_failed {
                                break;
                            }
                            let _ = channel.flush();
                        }
                        Err(std::sync::mpsc::TryRecvError::Empty) => break,
                        Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                            return;
                        }
                    }
                }

                // 3. Read from channel (coalescing high-throughput output up to 64KB or 8ms window)
                let mut reader = channel.stream(0);
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // Clean up dead shell registration so it can be reopened
                        if let Ok(mut fast) = fast_shells_cleanup_arc.lock() {
                            fast.remove(&shell_id_clone);
                        }
                        if let Ok(mut sessions) = sessions_cleanup_arc.lock() {
                            if let Some(ssh_session) = sessions.get_mut(&id_clone) {
                                ssh_session.shells.remove(&shell_id_clone);
                                ssh_session.connecting_shells.remove(&shell_id_clone);
                            }
                        }
                        let _ = app_handle_clone.emit(
                            &format!("ssh-output-{}", shell_id_clone),
                            "\r\n\x1b[33m[系统提示: 终端会话已结束 (按回车键可重新打开终端)]\x1b[0m\r\n".to_string()
                        );
                        let _ = app_handle_clone.emit(&format!("ssh-shell-eof-{}", shell_id_clone), ());
                        break;
                    }
                    Ok(n) => {
                        utf8_remainder.extend_from_slice(&buffer[..n]);
                        // If buffer was nearly full, drain available burst chunks up to 64KB within 8ms
                        if n >= 4096 {
                            let burst_start = std::time::Instant::now();
                            _session.set_timeout(2);
                            while utf8_remainder.len() < 65536 && burst_start.elapsed() < Duration::from_millis(8) {
                                match reader.read(&mut buffer) {
                                    Ok(more) if more > 0 => {
                                        utf8_remainder.extend_from_slice(&buffer[..more]);
                                    }
                                    _ => break,
                                }
                            }
                            _session.set_timeout(25);
                        }
                        flush_utf8(&mut utf8_remainder, &app_handle_clone, &shell_id_clone);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock 
                               || e.kind() == std::io::ErrorKind::TimedOut 
                               || e.to_string().contains("timeout") 
                               || e.to_string().contains("WouldBlock") 
                               || e.to_string().contains("-30") => {
                        // Expected timeout when no data is available
                    }
                    Err(ref e) => {
                        let err_detail = format!("I/O Error: {}", e);
                        if let Ok(mut fast) = fast_shells_cleanup_arc.lock() {
                            fast.remove(&shell_id_clone);
                        }
                        if let Ok(mut sessions) = sessions_cleanup_arc.lock() {
                            if let Some(ssh_session) = sessions.get_mut(&id_clone) {
                                ssh_session.shells.remove(&shell_id_clone);
                                ssh_session.connecting_shells.remove(&shell_id_clone);
                            }
                        }
                        let _ = app_handle_clone.emit(
                            &format!("ssh-output-{}", shell_id_clone),
                            format!("\r\n\x1b[33m[系统提示: SSH 连接意外断开 ({})，正在尝试后台自动重连...]\x1b[0m\r\n", err_detail)
                        );
                        let _ = app_handle_clone.emit(&format!("ssh-error-{}", id_clone), err_detail);
                        let _ = app_handle_clone.emit(&format!("ssh-closed-{}", shell_id_clone), ());
                        break;
                    }
                }
            }
        });

        // Register the active SshShell to the session and fast_shells, and remove from connecting set
        {
            let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
            if let Some(ssh_session) = sessions.get_mut(&id_for_thread) {
                if ssh_session.connecting_shells.remove(&shell_id_for_thread) {
                    let shell_handle = SshShell { write_tx, resize_tx };
                    if let Ok(mut fast) = fast_shells_arc.lock() {
                        fast.insert(shell_id_for_thread.clone(), shell_handle.clone());
                    }
                    ssh_session.shells.insert(shell_id_for_thread, shell_handle);
                } else {
                    return Err("Cancelled".to_string());
                }
            }
        }
        
        Ok(())
    })
    .await;

    // Map cancelled result to clean Ok(()) to avoid confusing client console
    match connect_res {
        Ok(Err(ref s)) if s == "Cancelled" => Ok(()),
        Ok(r) => r,
        Err(_) => Err("Task panicked".to_string()),
    }
}

#[tauri::command]
pub fn ssh_write_shell(
    state: tauri::State<'_, SshState>,
    id: String,
    shell_id: String,
    data: String,
) -> Result<(), String> {
    // Fast path: lock only fast_shells (never blocked by SFTP or ssh_exec)
    if let Ok(fast) = state.fast_shells.lock() {
        if let Some(shell) = fast.get(&shell_id) {
            return shell
                .write_tx
                .send(data.into_bytes())
                .map_err(|e| format!("Failed to send write request: {}", e));
        }
    }

    let write_tx = {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        let shell = ssh_session.shells.get(&shell_id).ok_or_else(|| "Shell not found".to_string())?;
        shell.write_tx.clone()
    };

    write_tx.send(data.into_bytes()).map_err(|e| format!("Failed to send write request: {}", e))?;
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
    // Fast path: lock only fast_shells (never blocked by SFTP or ssh_exec)
    if let Ok(fast) = state.fast_shells.lock() {
        if let Some(shell) = fast.get(&shell_id) {
            return shell
                .resize_tx
                .send((cols, rows))
                .map_err(|e| format!("Failed to send resize request: {}", e));
        }
    }

    let resize_tx = {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        let shell = ssh_session.shells.get(&shell_id).ok_or_else(|| "Shell not found".to_string())?;
        shell.resize_tx.clone()
    };

    resize_tx.send((cols, rows)).map_err(|e| format!("Failed to send resize request: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_close_shell(
    state: tauri::State<'_, SshState>,
    id: String,
    shell_id: String,
) -> Result<(), String> {
    if let Ok(mut fast) = state.fast_shells.lock() {
        fast.remove(&shell_id);
    }
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
    ssh_session.shells.remove(&shell_id);
    ssh_session.connecting_shells.remove(&shell_id);
    Ok(())
}

fn run_exec_on_session(session: &ssh2::Session, command: &str) -> Result<ExecResult, String> {
    session.set_blocking(true);
    session.set_timeout(8000);
    let mut channel = session.channel_session().map_err(|e| e.to_string())?;
    channel.exec(command).map_err(|e| e.to_string())?;

    let mut stdout = String::new();
    channel.read_to_string(&mut stdout).map_err(|e| e.to_string())?;

    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr).map_err(|e| e.to_string())?;

    channel.wait_close().unwrap_or(());
    let code = channel.exit_status().unwrap_or(0);

    Ok(ExecResult { stdout, stderr, code })
}

#[tauri::command]
pub async fn ssh_exec(
    state: tauri::State<'_, SshState>,
    id: String,
    command: String,
) -> Result<ExecResult, String> {
    let sessions_arc = state.sessions.clone();

    tokio::task::spawn_blocking(move || {
        // Use dedicated shell_session (exec_session) without holding the global sessions Mutex during network I/O
        let exec_session = get_or_create_dedicated_session(&id, &sessions_arc, true)?;
        match run_exec_on_session(&exec_session, &command) {
            Ok(res) => Ok(res),
            Err(_) => {
                // Invalidate dead exec_session and retry once with a fresh connection
                {
                    let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
                    if let Some(ssh_session) = sessions.get_mut(&id) {
                        ssh_session.shell_session = None;
                        ssh_session._shell_tcp = None;
                    } else {
                        return Err("No active SSH connection".to_string());
                    }
                }
                let retry_session = get_or_create_dedicated_session(&id, &sessions_arc, true)?;
                run_exec_on_session(&retry_session, &command)
            }
        }
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

impl SshSession {
    pub fn reset_and_reconnect(&mut self) -> Result<(), String> {
        self.sftp = None;
        self.tunnel_session = None;
        self._tunnel_tcp = None;
        self.shell_session = None;
        self._shell_tcp = None;
        let (new_session, new_tcp) = connect_session(
            &self.host,
            self.port,
            &self.username,
            self.password.as_deref(),
            self.key_path.as_deref(),
            10,
        )?;
        self.session = new_session;
        self._tcp = new_tcp;
        Ok(())
    }

    pub fn ensure_sftp<'a>(&'a mut self) -> Result<&'a ssh2::Sftp, String> {
        if self.sftp.is_none() {
            match self.session.sftp() {
                Ok(sftp) => {
                    self.sftp = Some(sftp);
                }
                Err(_) => {
                    self.reset_and_reconnect()?;
                    let sftp = self.session.sftp()
                        .map_err(|e| format!("Failed to start SFTP session after reconnect: {}", e))?;
                    self.sftp = Some(sftp);
                }
            }
        }
        Ok(self.sftp.as_ref().unwrap())
    }

    pub fn invalidate_sftp(&mut self) {
        self.sftp = None;
    }
}

fn with_sftp<T, F>(ssh_session: &mut SshSession, f: F) -> Result<T, String>
where
    F: Fn(&ssh2::Sftp) -> Result<T, String>,
{
    let sftp = ssh_session.ensure_sftp()?;
    match f(sftp) {
        Ok(res) => Ok(res),
        Err(err_msg) => {
            ssh_session.invalidate_sftp();
            if let Err(reconnect_err) = ssh_session.reset_and_reconnect() {
                return Err(format!("{}. Reconnect failed: {}", err_msg, reconnect_err));
            }
            let sftp = ssh_session.ensure_sftp()?;
            f(sftp)
        }
    }
}

#[tauri::command]
pub async fn sftp_list(
    state: tauri::State<'_, SshState>,
    id: String,
    path: String,
) -> Result<Vec<SftpFile>, String> {
    let sessions_arc = state.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;

        with_sftp(ssh_session, |sftp| {
            let entries = sftp.readdir(Path::new(&path))
                .map_err(|e| format!("Failed to read SFTP directory: {}", e))?;

            let mut list = Vec::new();
            for (entry_path, stat) in entries {
                let name = entry_path.file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| entry_path.to_string_lossy().into_owned());
                    
                if name == "." || name == ".." {
                    continue;
                }

                let is_dir = stat.is_dir();
                let size = stat.size.unwrap_or(0);
                let mtime = stat.mtime.unwrap_or(0) * 1000;
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
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[tauri::command]
pub async fn sftp_mkdir(state: tauri::State<'_, SshState>, id: String, path: String) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        with_sftp(ssh_session, |sftp| {
            sftp.mkdir(Path::new(&path), 0o755).map_err(|e| e.to_string())?;
            Ok(true)
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

fn sftp_remove_dir_all_recursive(sftp: &ssh2::Sftp, path: &Path) -> Result<(), String> {
    let entries = match sftp.readdir(path) {
        Ok(e) => e,
        Err(_) => return sftp.rmdir(path).map_err(|e| e.to_string()),
    };
    for (entry_path, stat) in entries {
        let name = entry_path.file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name == "." || name == ".." {
            continue;
        }
        if stat.is_dir() {
            sftp_remove_dir_all_recursive(sftp, &entry_path)?;
        } else {
            sftp.unlink(&entry_path).map_err(|e| format!("Failed to delete remote file {:?}: {}", entry_path, e))?;
        }
    }
    sftp.rmdir(path).map_err(|e| format!("Failed to delete remote dir {:?}: {}", path, e))?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_rmdir(state: tauri::State<'_, SshState>, id: String, path: String) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        with_sftp(ssh_session, |sftp| {
            let p = Path::new(&path);
            if let Err(_) = sftp.rmdir(p) {
                sftp_remove_dir_all_recursive(sftp, p)?;
            }
            Ok(true)
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[tauri::command]
pub async fn sftp_unlink(state: tauri::State<'_, SshState>, id: String, path: String) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        with_sftp(ssh_session, |sftp| {
            sftp.unlink(Path::new(&path)).map_err(|e| e.to_string())?;
            Ok(true)
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, SshState>,
    id: String,
    old_path: String,
    new_path: String,
) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        with_sftp(ssh_session, |sftp| {
            sftp.rename(Path::new(&old_path), Path::new(&new_path), None).map_err(|e| e.to_string())?;
            Ok(true)
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[tauri::command]
pub async fn sftp_stat(
    state: tauri::State<'_, SshState>,
    id: String,
    file_path: String,
) -> Result<SftpFile, String> {
    let sessions_arc = state.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        with_sftp(ssh_session, |sftp| {
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
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[tauri::command]
pub async fn sftp_chmod(
    state: tauri::State<'_, SshState>,
    id: String,
    file_path: String,
    mode: u32,
) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
        let ssh_session = sessions.get_mut(&id).ok_or_else(|| "No active SSH connection".to_string())?;
        with_sftp(ssh_session, |sftp| {
            let mut stat = sftp.stat(Path::new(&file_path)).map_err(|e| e.to_string())?;
            stat.perm = Some(mode);
            sftp.setstat(Path::new(&file_path), stat).map_err(|e| e.to_string())?;
            Ok(true)
        })
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct TransferOptions {
    pub resume: Option<bool>,
    #[serde(rename = "remoteSize")]
    pub remote_size: Option<u64>,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    jid: String,
    file: String,
    transferred: u64,
    total: u64,
}

fn calc_local_dir_size(p: &Path) -> u64 {
    if p.is_file() {
        p.metadata().map(|m| m.len()).unwrap_or(0)
    } else if p.is_dir() {
        let mut total = 0;
        if let Ok(entries) = std::fs::read_dir(p) {
            for entry in entries.flatten() {
                total += calc_local_dir_size(&entry.path());
            }
        }
        total
    } else {
        0
    }
}

fn calc_remote_dir_size(sftp: &ssh2::Sftp, p: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = sftp.readdir(p) {
        for (entry_path, stat) in entries {
            let name = entry_path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            if name == "." || name == ".." { continue; }
            if stat.is_dir() {
                total += calc_remote_dir_size(sftp, &entry_path);
            } else {
                total += stat.size.unwrap_or(0);
            }
        }
    }
    total
}

fn upload_dir_recursive(
    sftp: &ssh2::Sftp,
    local_dir: &Path,
    remote_dir: &Path,
    app_handle: &AppHandle,
    jid: &str,
    cancelled_set: &Arc<Mutex<HashSet<String>>>,
    transferred: &mut u64,
    total_size: u64,
    last_emit: &mut std::time::Instant,
) -> Result<(), String> {
    if cancelled_set.lock().unwrap().contains(jid) {
        return Err("Transfer cancelled by user".to_string());
    }

    let _ = sftp.mkdir(remote_dir, 0o755);

    let entries = std::fs::read_dir(local_dir)
        .map_err(|e| format!("Failed to read local dir {:?}: {}", local_dir, e))?;

    for entry in entries {
        if cancelled_set.lock().unwrap().contains(jid) {
            return Err("Transfer cancelled by user".to_string());
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let remote_target = remote_dir.join(&name);

        if path.is_dir() {
            upload_dir_recursive(sftp, &path, &remote_target, app_handle, jid, cancelled_set, transferred, total_size, last_emit)?;
        } else {
            upload_single_file_chunked(sftp, &path, &remote_target, app_handle, jid, cancelled_set, transferred, total_size, last_emit)?;
        }
    }
    Ok(())
}

fn upload_single_file_chunked(
    sftp: &ssh2::Sftp,
    local_file_path: &Path,
    remote_file_path: &Path,
    app_handle: &AppHandle,
    jid: &str,
    cancelled_set: &Arc<Mutex<HashSet<String>>>,
    transferred: &mut u64,
    total_size: u64,
    last_emit: &mut std::time::Instant,
) -> Result<(), String> {
    let mut local_file = File::open(local_file_path)
        .map_err(|e| format!("Failed to open local file {:?}: {}", local_file_path, e))?;
    let mut remote_file = sftp.create(remote_file_path)
        .map_err(|e| format!("Failed to create remote file {:?}: {}", remote_file_path, e))?;

    let mut buffer = vec![0u8; 1048576].into_boxed_slice();
    loop {
        if cancelled_set.lock().unwrap().contains(jid) {
            return Err("Transfer cancelled by user".to_string());
        }
        let n = local_file.read(&mut buffer)
            .map_err(|e| format!("Local read failed: {}", e))?;
        if n == 0 { break; }
        remote_file.write_all(&buffer[..n])
            .map_err(|e| format!("Remote write failed: {}", e))?;
        *transferred += n as u64;

        let now = std::time::Instant::now();
        if now.duration_since(*last_emit) >= std::time::Duration::from_millis(150) {
            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.to_string(),
                file: local_file_path.to_string_lossy().into_owned(),
                transferred: *transferred,
                total: total_size,
            });
            *last_emit = now;
        }
    }
    Ok(())
}

fn download_dir_recursive(
    sftp: &ssh2::Sftp,
    remote_dir: &Path,
    local_dir: &Path,
    app_handle: &AppHandle,
    jid: &str,
    cancelled_set: &Arc<Mutex<HashSet<String>>>,
    transferred: &mut u64,
    total_size: u64,
    last_emit: &mut std::time::Instant,
) -> Result<(), String> {
    if cancelled_set.lock().unwrap().contains(jid) {
        return Err("Transfer cancelled by user".to_string());
    }

    let _ = std::fs::create_dir_all(local_dir);

    let entries = sftp.readdir(remote_dir)
        .map_err(|e| format!("Failed to read remote dir {:?}: {}", remote_dir, e))?;

    for (entry_path, stat) in entries {
        if cancelled_set.lock().unwrap().contains(jid) {
            return Err("Transfer cancelled by user".to_string());
        }
        let name = entry_path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if name == "." || name == ".." { continue; }

        let local_target = local_dir.join(&name);
        if stat.is_dir() {
            download_dir_recursive(sftp, &entry_path, &local_target, app_handle, jid, cancelled_set, transferred, total_size, last_emit)?;
        } else {
            download_single_file_chunked(sftp, &entry_path, &local_target, app_handle, jid, cancelled_set, transferred, total_size, last_emit)?;
        }
    }
    Ok(())
}

fn download_single_file_chunked(
    sftp: &ssh2::Sftp,
    remote_file_path: &Path,
    local_file_path: &Path,
    app_handle: &AppHandle,
    jid: &str,
    cancelled_set: &Arc<Mutex<HashSet<String>>>,
    transferred: &mut u64,
    total_size: u64,
    last_emit: &mut std::time::Instant,
) -> Result<(), String> {
    let mut remote_file = sftp.open(remote_file_path)
        .map_err(|e| format!("Failed to open remote file {:?}: {}", remote_file_path, e))?;
    let mut local_file = File::create(local_file_path)
        .map_err(|e| format!("Failed to create local file {:?}: {}", local_file_path, e))?;

    let mut buffer = vec![0u8; 1048576].into_boxed_slice();
    loop {
        if cancelled_set.lock().unwrap().contains(jid) {
            return Err("Transfer cancelled by user".to_string());
        }
        let n = remote_file.read(&mut buffer)
            .map_err(|e| format!("Remote read failed: {}", e))?;
        if n == 0 { break; }
        local_file.write_all(&buffer[..n])
            .map_err(|e| format!("Local write failed: {}", e))?;
        *transferred += n as u64;

        let now = std::time::Instant::now();
        if now.duration_since(*last_emit) >= std::time::Duration::from_millis(150) {
            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.to_string(),
                file: remote_file_path.to_string_lossy().into_owned(),
                transferred: *transferred,
                total: total_size,
            });
            *last_emit = now;
        }
    }
    Ok(())
}

fn get_or_create_transfer_session(
    id: &str,
    sessions_arc: &Arc<Mutex<HashMap<String, SshSession>>>,
) -> Result<ssh2::Session, String> {
    let mut sessions = sessions_arc.lock().map_err(|e| e.to_string())?;
    let ssh_session = sessions.get_mut(id).ok_or_else(|| "No active SSH connection".to_string())?;

    if ssh_session.ensure_sftp().is_ok() {
        return Ok(ssh_session.session.clone());
    }

    ssh_session.reset_and_reconnect()?;
    Ok(ssh_session.session.clone())
}

// SFTP Upload with chunking, recursive dir and cancellation support
#[tauri::command]
pub async fn sftp_upload(
    app_handle: AppHandle,
    state: tauri::State<'_, SshState>,
    id: String,
    local_path: String,
    remote_path: String,
    jid: String,
    options: Option<TransferOptions>,
) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    let cancelled_set = Arc::clone(&state.cancelled_transfers);

    tokio::task::spawn_blocking(move || {
        let transfer_session = get_or_create_transfer_session(&id, &sessions_arc)?;
        
        let sftp = transfer_session.sftp()
            .map_err(|e| format!("Failed to start SFTP session: {}", e))?;

        {
            let mut cancel_lock = cancelled_set.lock().unwrap();
            cancel_lock.remove(&jid);
        }

        let l_path = Path::new(&local_path);
        let r_path = Path::new(&remote_path);

        if l_path.is_dir() {
            let total_size = calc_local_dir_size(l_path);
            let mut transferred = 0u64;
            let mut last_emit = std::time::Instant::now();

            upload_dir_recursive(
                &sftp,
                l_path,
                r_path,
                &app_handle,
                &jid,
                &cancelled_set,
                &mut transferred,
                total_size,
                &mut last_emit,
            )?;

            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.clone(),
                file: local_path.clone(),
                transferred: total_size,
                total: total_size,
            });
            Ok(true)
        } else {
            let mut local_file = File::open(l_path)
                .map_err(|e| format!("Failed to open local file: {}", e))?;
            let total_size = local_file.metadata().map(|m| m.len()).unwrap_or(0);

            let is_resume = options.as_ref().and_then(|o| o.resume).unwrap_or(false);
            let resume_offset = options.as_ref().and_then(|o| o.remote_size).unwrap_or(0);

            let mut remote_file = if is_resume && resume_offset > 0 {
                use std::io::Seek;
                use std::io::SeekFrom;
                let mut rf = sftp.open_mode(r_path, ssh2::OpenFlags::WRITE | ssh2::OpenFlags::READ, 0o644, ssh2::OpenType::File)
                    .map_err(|e| format!("Failed to open remote file for resume: {}", e))?;
                rf.seek(SeekFrom::Start(resume_offset))
                    .map_err(|e| format!("Failed to seek remote file: {}", e))?;
                local_file.seek(SeekFrom::Start(resume_offset))
                    .map_err(|e| format!("Failed to seek local file: {}", e))?;
                rf
            } else {
                sftp.create(r_path)
                    .map_err(|e| format!("Failed to create remote file: {}", e))?
            };

            let mut transferred = if is_resume { resume_offset } else { 0 };
            let mut buffer = vec![0u8; 1048576].into_boxed_slice();
            let mut last_emit = std::time::Instant::now();

            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.clone(),
                file: local_path.clone(),
                transferred,
                total: total_size,
            });

            loop {
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
                
                let now = std::time::Instant::now();
                if now.duration_since(last_emit) >= std::time::Duration::from_millis(150) {
                    let _ = app_handle.emit("sftp-progress", ProgressPayload {
                        jid: jid.clone(),
                        file: local_path.clone(),
                        transferred,
                        total: total_size,
                    });
                    last_emit = now;
                }
            }

            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.clone(),
                file: local_path.clone(),
                transferred: total_size,
                total: total_size,
            });

            Ok(true)
        }
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
}

// SFTP Download with chunking, recursive dir and cancellation support
#[tauri::command]
pub async fn sftp_download(
    app_handle: AppHandle,
    state: tauri::State<'_, SshState>,
    id: String,
    remote_path: String,
    local_path: String,
    jid: String,
    options: Option<TransferOptions>,
) -> Result<bool, String> {
    let sessions_arc = state.sessions.clone();
    let cancelled_set = Arc::clone(&state.cancelled_transfers);

    tokio::task::spawn_blocking(move || {
        let transfer_session = get_or_create_transfer_session(&id, &sessions_arc)?;
        
        let sftp = transfer_session.sftp()
            .map_err(|e| format!("Failed to start SFTP session: {}", e))?;

        {
            let mut cancel_lock = cancelled_set.lock().unwrap();
            cancel_lock.remove(&jid);
        }

        let r_path = Path::new(&remote_path);
        let l_path = Path::new(&local_path);

        let remote_stat = sftp.stat(r_path).map_err(|e| e.to_string())?;

        if remote_stat.is_dir() {
            let total_size = calc_remote_dir_size(&sftp, r_path);
            let mut transferred = 0u64;
            let mut last_emit = std::time::Instant::now();

            download_dir_recursive(
                &sftp,
                r_path,
                l_path,
                &app_handle,
                &jid,
                &cancelled_set,
                &mut transferred,
                total_size,
                &mut last_emit,
            )?;

            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.clone(),
                file: remote_path.clone(),
                transferred: total_size,
                total: total_size,
            });
            Ok(true)
        } else {
            let total_size = remote_stat.size.unwrap_or(0);
            let is_resume = options.as_ref().and_then(|o| o.resume).unwrap_or(false);
            let resume_offset = options.as_ref().and_then(|o| o.remote_size).unwrap_or(0);

            use std::io::Seek;
            use std::io::SeekFrom;

            let mut remote_file = sftp.open(r_path)
                .map_err(|e| format!("Failed to open remote file: {}", e))?;

            let mut local_file = if is_resume && resume_offset > 0 {
                let mut lf = std::fs::OpenOptions::new()
                    .write(true)
                    .read(true)
                    .open(l_path)
                    .map_err(|e| format!("Failed to open local file for resume: {}", e))?;
                lf.seek(SeekFrom::Start(resume_offset))
                    .map_err(|e| format!("Failed to seek local file: {}", e))?;
                remote_file.seek(SeekFrom::Start(resume_offset))
                    .map_err(|e| format!("Failed to seek remote file: {}", e))?;
                lf
            } else {
                File::create(l_path)
                    .map_err(|e| format!("Failed to create local file: {}", e))?
            };

            let mut transferred = if is_resume { resume_offset } else { 0 };
            let mut buffer = vec![0u8; 1048576].into_boxed_slice();
            let mut last_emit = std::time::Instant::now();

            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.clone(),
                file: remote_path.clone(),
                transferred,
                total: total_size,
            });

            loop {
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
                
                let now = std::time::Instant::now();
                if now.duration_since(last_emit) >= std::time::Duration::from_millis(150) {
                    let _ = app_handle.emit("sftp-progress", ProgressPayload {
                        jid: jid.clone(),
                        file: remote_path.clone(),
                        transferred,
                        total: total_size,
                    });
                    last_emit = now;
                }
            }

            let _ = app_handle.emit("sftp-progress", ProgressPayload {
                jid: jid.clone(),
                file: remote_path.clone(),
                transferred: total_size,
                total: total_size,
            });

            Ok(true)
        }
    })
    .await
    .map_err(|_| "Task panicked".to_string())?
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
        // Stop existing tunnel with the same ID if present
        {
            if let Ok(mut sessions) = sessions_arc.lock() {
                if let Some(ssh_session) = sessions.get_mut(&id) {
                    if let Some(old_tunnel) = ssh_session.tunnels.remove(&tunnel_id) {
                        let _ = old_tunnel.shutdown_tx.send(());
                        drop(sessions);
                        thread::sleep(Duration::from_millis(60));
                    }
                }
            }
        }

        let tunnel_session = get_or_create_dedicated_session(&id, &sessions_arc, false)?;

        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", local_port).parse()
            .map_err(|e| format!("Invalid address: {}", e))?;
        let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
            .map_err(|e| format!("Failed to create socket: {}", e))?;
        socket.set_reuse_address(true)
            .map_err(|e| format!("Failed to set SO_REUSEADDR: {}", e))?;
        if let Err(_) = socket.bind(&addr.into()) {
            // Wait briefly in case a previous listener thread is shutting down after reconnect
            thread::sleep(Duration::from_millis(60));
            socket.bind(&addr.into())
                .map_err(|e| format!("Failed to bind local port {}: {}", local_port, e))?;
        }
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
                                    delay = 1;
                                } else {
                                    thread::sleep(std::time::Duration::from_millis(delay));
                                    if delay < 20 {
                                        delay += 3; // Backoff up to 20ms
                                    }
                                }
                            }
                        }
                    });
                } else {
                    thread::sleep(std::time::Duration::from_millis(accept_delay));
                    if accept_delay < 30 {
                        accept_delay += 5; // Backoff accept loop up to 30ms when idle
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
                                delay = 1;
                            } else {
                                thread::sleep(std::time::Duration::from_millis(delay));
                                if delay < 20 {
                                    delay += 3; // Backoff up to 20ms
                                }
                            }
                        }
                    }
                });
            } else {
                thread::sleep(std::time::Duration::from_millis(accept_delay));
                if accept_delay < 30 {
                    accept_delay += 5; // Backoff accept loop up to 30ms when idle
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
