use serde::Serialize;
use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub struct SerialSession {
    pub stop_flag: Arc<AtomicBool>,
    pub port_name: String,
    pub baud_rate: u32,
}

#[derive(Default)]
pub struct SerialState {
    pub sessions: Arc<Mutex<HashMap<String, SerialSession>>>,
    /// Lock-free / fast write handles so typing never contends with session management
    pub fast_writers: Arc<Mutex<HashMap<String, Box<dyn SerialPort>>>>,
}

#[derive(Serialize, Clone)]
pub struct SerialPortInfoDto {
    #[serde(rename = "portName")]
    pub port_name: String,
    #[serde(rename = "portType")]
    pub port_type: String,
    pub description: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
}

fn flush_utf8_buffer(app: &AppHandle, event_name: &str, buf: &mut Vec<u8>, force_all: bool) {
    if buf.is_empty() {
        return;
    }
    if force_all {
        let output = String::from_utf8_lossy(buf).into_owned();
        buf.clear();
        let _ = app.emit(event_name, output);
        return;
    }
    match std::str::from_utf8(buf) {
        Ok(valid_str) => {
            let output = valid_str.to_string();
            buf.clear();
            let _ = app.emit(event_name, output);
        }
        Err(e) => {
            let valid_len = e.valid_up_to();
            if valid_len > 0 {
                let valid_str = String::from_utf8_lossy(&buf[..valid_len]).into_owned();
                let _ = app.emit(event_name, valid_str);
            }
            if let Some(error_len) = e.error_len() {
                // Invalid byte sequence (not an incomplete trailing multi-byte char):
                // emit replacement character so binary/non-UTF8 serial output doesn't stall
                let lossy = String::from_utf8_lossy(&buf[valid_len..valid_len + error_len]).into_owned();
                let _ = app.emit(event_name, lossy);
                buf.drain(..valid_len + error_len);
            } else {
                buf.drain(..valid_len);
            }
        }
    }
}

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<SerialPortInfoDto>, String> {
    let ports = serialport::available_ports().map_err(|e| format!("无法枚举串口列表: {}", e))?;
    let mut list: Vec<SerialPortInfoDto> = ports
        .into_iter()
        .map(|p| {
            let (port_type, description, manufacturer, product, vid, pid) = match p.port_type {
                SerialPortType::UsbPort(info) => {
                    let prod = info.product.clone().unwrap_or_default();
                    let mfg = info.manufacturer.clone().unwrap_or_default();
                    let desc = if !prod.is_empty() && !mfg.is_empty() && !prod.contains(&mfg) {
                        format!("{} ({})", prod, mfg)
                    } else if !prod.is_empty() {
                        prod
                    } else if !mfg.is_empty() {
                        mfg
                    } else {
                        format!("USB 串口 (VID:{:04X} PID:{:04X})", info.vid, info.pid)
                    };
                    (
                        "USB".to_string(),
                        desc,
                        info.manufacturer,
                        info.product,
                        Some(info.vid),
                        Some(info.pid),
                    )
                }
                SerialPortType::BluetoothPort => (
                    "Bluetooth".to_string(),
                    "蓝牙串口".to_string(),
                    None,
                    None,
                    None,
                    None,
                ),
                SerialPortType::PciPort => (
                    "PCI".to_string(),
                    "板载/PCI 串口".to_string(),
                    None,
                    None,
                    None,
                    None,
                ),
                SerialPortType::Unknown => (
                    "Standard".to_string(),
                    "标准串口".to_string(),
                    None,
                    None,
                    None,
                    None,
                ),
            };
            SerialPortInfoDto {
                port_name: p.port_name,
                port_type,
                description,
                manufacturer,
                product,
                vid,
                pid,
            }
        })
        .collect();

    // Sort ports nicely (e.g. COM1, COM2, COM10 on Windows; /dev/cu.* before /dev/tty.* on macOS)
    list.sort_by(|a, b| {
        #[cfg(target_os = "macos")]
        {
            let a_cu = a.port_name.starts_with("/dev/cu.");
            let b_cu = b.port_name.starts_with("/dev/cu.");
            if a_cu != b_cu {
                return b_cu.cmp(&a_cu);
            }
        }
        let a_num = a
            .port_name
            .trim_start_matches(|c: char| !c.is_ascii_digit())
            .parse::<u32>();
        let b_num = b
            .port_name
            .trim_start_matches(|c: char| !c.is_ascii_digit())
            .parse::<u32>();
        match (a_num, b_num) {
            (Ok(na), Ok(nb)) if a.port_name.starts_with("COM") && b.port_name.starts_with("COM") => {
                na.cmp(&nb)
            }
            _ => a.port_name.cmp(&b.port_name),
        }
    });

    Ok(list)
}

#[tauri::command]
pub async fn serial_connect(
    app: AppHandle,
    state: tauri::State<'_, SerialState>,
    id: String,
    port_name: String,
    baud_rate: u32,
    data_bits: u8,
    stop_bits: u8,
    parity: String,
    flow_control: String,
) -> Result<(), String> {
    // 1. Clean up any existing session with the same ID first
    {
        let mut writers = state.fast_writers.lock().map_err(|e| e.to_string())?;
        writers.remove(&id);
    }
    let had_existing = {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(old) = sessions.remove(&id) {
            old.stop_flag.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    };
    if had_existing {
        // Give the reader thread up to 30ms to exit and drop its OS port handle
        thread::sleep(Duration::from_millis(30));
    }

    let parsed_data_bits = match data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };

    let parsed_stop_bits = match stop_bits {
        2 => StopBits::Two,
        _ => StopBits::One,
    };

    let parsed_parity = match parity.to_lowercase().as_str() {
        "odd" | "奇" | "奇校验" => Parity::Odd,
        "even" | "偶" | "偶校验" => Parity::Even,
        _ => Parity::None,
    };

    let parsed_flow_control = match flow_control.to_lowercase().as_str() {
        "software" | "xon/xoff" | "软流控" => FlowControl::Software,
        "hardware" | "rts/cts" | "硬流控" => FlowControl::Hardware,
        _ => FlowControl::None,
    };

    let mut reader_port = serialport::new(&port_name, baud_rate)
        .data_bits(parsed_data_bits)
        .stop_bits(parsed_stop_bits)
        .parity(parsed_parity)
        .flow_control(parsed_flow_control)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(|e| format!("无法打开串口 {} ({} bps): {}", port_name, baud_rate, e))?;

    // Assert DTR (and RTS if not hardware flow control) so USB-CDC / MCU boards start transmitting
    let _ = reader_port.write_data_terminal_ready(true);
    if parsed_flow_control != FlowControl::Hardware {
        let _ = reader_port.write_request_to_send(true);
    }

    let writer_port = reader_port
        .try_clone()
        .map_err(|e| format!("无法克隆串口写入句柄 ({}): {}", port_name, e))?;

    let stop_flag = Arc::new(AtomicBool::new(false));

    {
        let mut writers = state.fast_writers.lock().map_err(|e| e.to_string())?;
        writers.insert(id.clone(), writer_port);
    }
    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            id.clone(),
            SerialSession {
                stop_flag: stop_flag.clone(),
                port_name: port_name.clone(),
                baud_rate,
            },
        );
    }

    let app_clone = app.clone();
    let id_clone = id.clone();
    let sessions_arc = state.sessions.clone();
    let writers_arc = state.fast_writers.clone();
    let stop_clone = stop_flag.clone();

    // Emit initial connection banner to terminal
    let parity_char = match parsed_parity {
        Parity::None => 'N',
        Parity::Odd => 'O',
        Parity::Even => 'E',
    };
    let stop_num = match parsed_stop_bits {
        StopBits::One => 1,
        StopBits::Two => 2,
    };
    let banner = format!(
        "\x1b[32m● 串口已连接: {} @ {} bps ({}{}{})\x1b[0m\r\n",
        port_name, baud_rate, data_bits, parity_char, stop_num
    );
    let _ = app.emit(&format!("serial-output-{}", id), banner);

    thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut pending_out = Vec::<u8>::with_capacity(65536);
        let mut last_flush = Instant::now();
        let out_event = format!("serial-output-{}", id_clone);

        loop {
            if stop_clone.load(Ordering::Relaxed) {
                flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, true);
                break;
            }

            match reader_port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    pending_out.extend_from_slice(&buf[..n]);
                    if pending_out.len() >= 65536 || last_flush.elapsed() >= Duration::from_millis(8) {
                        flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, false);
                        last_flush = Instant::now();
                    }
                }
                Ok(_) => {
                    // 0 bytes read — on some platforms indicates port EOF/removal
                    if !pending_out.is_empty() && last_flush.elapsed() >= Duration::from_millis(8) {
                        flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, false);
                        last_flush = Instant::now();
                    }
                    thread::sleep(Duration::from_millis(5));
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::Interrupted =>
                {
                    if !pending_out.is_empty() && last_flush.elapsed() >= Duration::from_millis(8) {
                        flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, false);
                        last_flush = Instant::now();
                    }
                }
                Err(e) => {
                    flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, true);
                    if !stop_clone.load(Ordering::Relaxed) {
                        let _ = app_clone.emit(
                            &format!("serial-error-{}", id_clone),
                            format!("串口连接中断 ({}): {}", port_name, e),
                        );
                        let _ = app_clone.emit(&format!("serial-closed-{}", id_clone), ());
                    }
                    break;
                }
            }
        }

        if let Ok(mut writers) = writers_arc.lock() {
            writers.remove(&id_clone);
        }
        if let Ok(mut sessions) = sessions_arc.lock() {
            sessions.remove(&id_clone);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn serial_write(
    state: tauri::State<'_, SerialState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut writers = state.fast_writers.lock().map_err(|e| e.to_string())?;
    if let Some(port) = writers.get_mut(&id) {
        port.write_all(data.as_bytes())
            .map_err(|e| format!("串口写入失败: {}", e))?;
        let _ = port.flush();
        Ok(())
    } else {
        Err("串口未连接或已关闭".to_string())
    }
}

#[tauri::command]
pub fn serial_set_signals(
    state: tauri::State<'_, SerialState>,
    id: String,
    dtr: Option<bool>,
    rts: Option<bool>,
) -> Result<(), String> {
    let mut writers = state.fast_writers.lock().map_err(|e| e.to_string())?;
    if let Some(port) = writers.get_mut(&id) {
        if let Some(dtr_val) = dtr {
            port.write_data_terminal_ready(dtr_val)
                .map_err(|e| format!("设置 DTR 失败: {}", e))?;
        }
        if let Some(rts_val) = rts {
            port.write_request_to_send(rts_val)
                .map_err(|e| format!("设置 RTS 失败: {}", e))?;
        }
        Ok(())
    } else {
        Err("串口未连接".to_string())
    }
}

#[tauri::command]
pub fn serial_disconnect(
    state: tauri::State<'_, SerialState>,
    id: String,
) -> Result<(), String> {
    if let Ok(mut writers) = state.fast_writers.lock() {
        writers.remove(&id);
    }
    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(session) = sessions.remove(&id) {
            session.stop_flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

