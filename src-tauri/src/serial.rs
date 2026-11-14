use serde::Serialize;
use serialport::{DataBits, FlowControl, Parity, SerialPortType, StopBits};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub enum SerialCommand {
    Write(Vec<u8>),
    SetSignals {
        dtr: Option<bool>,
        rts: Option<bool>,
    },
    Disconnect,
}

pub struct SerialSession {
    pub stop_flag: Arc<AtomicBool>,
    pub cmd_tx: mpsc::Sender<SerialCommand>,
    #[allow(dead_code)]
    pub port_name: String,
    #[allow(dead_code)]
    pub baud_rate: u32,
}

#[derive(Default)]
pub struct SerialState {
    pub sessions: Arc<Mutex<HashMap<String, SerialSession>>>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
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
    #[serde(rename = "isSystem")]
    pub is_system: bool,
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
                let lossy =
                    String::from_utf8_lossy(&buf[valid_len..valid_len + error_len]).into_owned();
                let _ = app.emit(event_name, lossy);
                buf.drain(..valid_len + error_len);
            } else {
                buf.drain(..valid_len);
            }
        }
    }
}

/// Strip redundant trailing `(COM3)` / `（COM3）` suffixes from Windows friendly names.
#[allow(dead_code)]
fn strip_port_suffix(desc: &str, port_name: &str) -> String {
    let mut result = desc.trim().to_string();
    let port_trimmed = port_name.trim();
    if port_trimmed.is_empty() || result.is_empty() {
        return result;
    }
    if result.eq_ignore_ascii_case(port_trimmed) {
        return String::new();
    }

    let suffixes = [
        format!("({})", port_trimmed),
        format!("（{}）", port_trimmed),
    ];
    for suffix in &suffixes {
        if result.len() >= suffix.len() {
            let start = result.len() - suffix.len();
            if result.is_char_boundary(start) && result[start..].eq_ignore_ascii_case(suffix) {
                result = result[..start]
                    .trim_end()
                    .trim_end_matches('-')
                    .trim_end()
                    .to_string();
                break;
            }
        }
    }
    result
}

fn port_type_priority(port_type: &str) -> u8 {
    match port_type {
        "USB" => 0,
        "PCI" | "Standard" => 1,
        "Bluetooth" => 2,
        _ => 1,
    }
}

fn split_trailing_number(s: &str) -> (String, Option<u64>) {
    let digit_start = s
        .char_indices()
        .rev()
        .take_while(|(_, c)| c.is_ascii_digit())
        .last()
        .map(|(idx, _)| idx);
    match digit_start {
        Some(idx) => (
            s[..idx].to_ascii_lowercase(),
            s[idx..].parse::<u64>().ok(),
        ),
        None => (s.to_ascii_lowercase(), None),
    }
}

fn sort_ports(list: &mut [SerialPortInfoDto]) {
    list.sort_by(|a, b| {
        if a.is_system != b.is_system {
            return a.is_system.cmp(&b.is_system);
        }
        let pa = port_type_priority(&a.port_type);
        let pb = port_type_priority(&b.port_type);
        if pa != pb {
            return pa.cmp(&pb);
        }

        let (prefix_a, num_a) = split_trailing_number(&a.port_name);
        let (prefix_b, num_b) = split_trailing_number(&b.port_name);
        if prefix_a == prefix_b {
            match (num_a, num_b) {
                (Some(na), Some(nb)) if na != nb => return na.cmp(&nb),
                _ => {}
            }
        }
        a.port_name.cmp(&b.port_name)
    });
}

#[allow(dead_code)]
fn map_serialport_entry(p: serialport::SerialPortInfo) -> Option<SerialPortInfoDto> {
    let port_name = p.port_name.trim().to_string();
    if port_name.is_empty() || port_name.to_ascii_uppercase().starts_with("LPT") {
        return None;
    }

    let (port_type, description, manufacturer, product, vid, pid, is_system) = match p.port_type {
        SerialPortType::UsbPort(info) => {
            let prod = info
                .product
                .as_deref()
                .map(|s| strip_port_suffix(s, &port_name))
                .unwrap_or_default();
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
                info.product.map(|s| strip_port_suffix(&s, &port_name)),
                Some(info.vid),
                Some(info.pid),
                false,
            )
        }
        SerialPortType::BluetoothPort => (
            "Bluetooth".to_string(),
            "蓝牙串口".to_string(),
            None,
            None,
            None,
            None,
            cfg!(target_os = "macos"),
        ),
        SerialPortType::PciPort => (
            "PCI".to_string(),
            "板载/PCI 串口".to_string(),
            None,
            None,
            None,
            None,
            false,
        ),
        SerialPortType::Unknown => (
            "Standard".to_string(),
            "标准串口".to_string(),
            None,
            None,
            None,
            None,
            false,
        ),
    };

    Some(SerialPortInfoDto {
        port_name,
        port_type,
        description,
        manufacturer,
        product,
        vid,
        pid,
        is_system,
    })
}

#[cfg(target_os = "windows")]
fn collect_platform_ports() -> Vec<SerialPortInfoDto> {
    use std::collections::HashSet;
    use std::ptr;
    use windows_sys::core::GUID;
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        CM_Get_DevNode_Status, SetupDiClassGuidsFromNameW, SetupDiDestroyDeviceInfoList,
        SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, SetupDiGetDeviceInstanceIdW,
        SetupDiGetDeviceRegistryPropertyW, SetupDiOpenDevRegKey, CR_SUCCESS, DICS_FLAG_GLOBAL,
        DIGCF_PRESENT, DIREG_DEV, HDEVINFO, MAX_DEVICE_ID_LEN, SPDRP_FRIENDLYNAME,
        SPDRP_HARDWAREID, SPDRP_MFG, SP_DEVINFO_DATA,
    };
    use windows_sys::Win32::Foundation::{FALSE, FILETIME, INVALID_HANDLE_VALUE, MAX_PATH};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumValueW, RegOpenKeyExW, RegQueryInfoKeyW, RegQueryValueExW, HKEY,
        HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
    };

    const SPDRP_DEVICEDESC_CODE: u32 = 0;
    const REG_MULTI_SZ_CODE: u32 = 7;

    fn as_utf16(utf8: &str) -> Vec<u16> {
        utf8.encode_utf16().chain(Some(0)).collect()
    }

    fn from_utf16_lossy_trimmed(utf16: &[u16]) -> String {
        String::from_utf16_lossy(utf16)
            .trim_end_matches('\0')
            .trim()
            .to_string()
    }

    fn extract_com_from_friendly_name(friendly: &str) -> Option<String> {
        let upper = friendly.to_ascii_uppercase();
        for marker in ["(COM", "（COM"] {
            if let Some(pos) = upper.find(marker) {
                let after = &upper[pos + marker.len()..];
                let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !digits.is_empty() {
                    return Some(format!("COM{}", digits));
                }
            }
        }
        None
    }

    fn parse_vid_pid(text: &str) -> (Option<u16>, Option<u16>) {
        let upper = text.to_ascii_uppercase();
        let vid = upper.find("VID_").and_then(|idx| {
            upper
                .get(idx + 4..idx + 8)
                .and_then(|hex| u16::from_str_radix(hex, 16).ok())
        });
        let pid = upper.find("PID_").and_then(|idx| {
            upper
                .get(idx + 4..idx + 8)
                .and_then(|hex| u16::from_str_radix(hex, 16).ok())
        });
        (vid, pid)
    }

    fn normalize_win_com(name: &str) -> String {
        let trimmed = name.trim();
        if trimmed.len() >= 4
            && trimmed[..3].eq_ignore_ascii_case("COM")
            && trimmed[3..].chars().all(|c| c.is_ascii_digit())
        {
            format!("COM{}", &trimmed[3..])
        } else {
            trimmed.to_string()
        }
    }

    fn get_registry_property_str(
        hdi: HDEVINFO,
        devinfo_data: &SP_DEVINFO_DATA,
        property_id: u32,
    ) -> Option<String> {
        let mut value_type = 0u32;
        let mut buf = [0u16; 1024];
        let mut required_bytes = 0u32;
        let res = unsafe {
            SetupDiGetDeviceRegistryPropertyW(
                hdi,
                devinfo_data,
                property_id,
                &mut value_type,
                buf.as_mut_ptr() as *mut u8,
                (buf.len() * std::mem::size_of::<u16>()) as u32,
                &mut required_bytes,
            )
        };
        if res == FALSE {
            return None;
        }
        if value_type == REG_SZ {
            let s = from_utf16_lossy_trimmed(&buf);
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        } else if value_type == REG_MULTI_SZ_CODE {
            let mut parts = Vec::new();
            for chunk in buf.split(|c| *c == 0) {
                if chunk.is_empty() {
                    break;
                }
                let s = String::from_utf16_lossy(chunk).trim().to_string();
                if !s.is_empty() {
                    parts.push(s);
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(" "))
            }
        } else {
            None
        }
    }

    fn get_port_name_from_devkey(hdi: HDEVINFO, devinfo_data: &SP_DEVINFO_DATA) -> Option<String> {
        let hkey = unsafe {
            SetupDiOpenDevRegKey(
                hdi,
                devinfo_data,
                DICS_FLAG_GLOBAL,
                0,
                DIREG_DEV,
                KEY_READ,
            )
        };
        if hkey == INVALID_HANDLE_VALUE || hkey == 0 {
            return None;
        }
        let mut port_name_buffer = [0u16; MAX_PATH as usize];
        let buffer_byte_len = (port_name_buffer.len() * std::mem::size_of::<u16>()) as u32;
        let mut byte_len = buffer_byte_len;
        let mut value_type = 0u32;
        let value_name = as_utf16("PortName");
        let err = unsafe {
            RegQueryValueExW(
                hkey,
                value_name.as_ptr(),
                ptr::null_mut(),
                &mut value_type,
                port_name_buffer.as_mut_ptr() as *mut u8,
                &mut byte_len,
            )
        };
        unsafe { RegCloseKey(hkey) };
        if err != 0 || value_type != REG_SZ || byte_len % 2 != 0 || byte_len > buffer_byte_len {
            return None;
        }
        let len = (byte_len as usize) / 2;
        let s = from_utf16_lossy_trimmed(&port_name_buffer[..len]);
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    fn get_ports_guids() -> Vec<GUID> {
        let mut guids: Vec<GUID> = Vec::new();
        for class_name in ["Ports", "Modem"] {
            let class_name_w = as_utf16(class_name);
            let mut num_guids: u32 = 1;
            let class_start_idx = guids.len();
            for _ in 0..2 {
                guids.resize(class_start_idx + num_guids as usize, GUID::from_u128(0));
                let guid_buffer = &mut guids[class_start_idx..];
                let res = unsafe {
                    SetupDiClassGuidsFromNameW(
                        class_name_w.as_ptr(),
                        guid_buffer.as_mut_ptr(),
                        guid_buffer.len() as u32,
                        &mut num_guids,
                    )
                };
                if res == FALSE {
                    guids.truncate(class_start_idx);
                    break;
                }
                let len_cmp = guid_buffer.len().cmp(&(num_guids as usize));
                if len_cmp == std::cmp::Ordering::Less {
                    continue;
                } else if len_cmp == std::cmp::Ordering::Greater {
                    guids.truncate(class_start_idx + num_guids as usize);
                }
                break;
            }
        }
        guids
    }

    let mut ports: Vec<SerialPortInfoDto> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for guid in get_ports_guids() {
        let hdi = unsafe { SetupDiGetClassDevsW(&guid, ptr::null(), 0, DIGCF_PRESENT) };
        if hdi == INVALID_HANDLE_VALUE || hdi == 0 {
            continue;
        }

        let mut dev_idx = 0u32;
        loop {
            let mut devinfo_data = SP_DEVINFO_DATA {
                cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                ClassGuid: GUID::from_u128(0),
                DevInst: 0,
                Reserved: 0,
            };
            let res = unsafe { SetupDiEnumDeviceInfo(hdi, dev_idx, &mut devinfo_data) };
            if res == FALSE {
                break;
            }
            dev_idx += 1;

            let mut status = 0u32;
            let mut problem_number = 0u32;
            let devnode_res = unsafe {
                CM_Get_DevNode_Status(&mut status, &mut problem_number, devinfo_data.DevInst, 0)
            };
            if devnode_res == CR_SUCCESS && problem_number != 0 {
                continue;
            }

            let friendly_raw = get_registry_property_str(hdi, &devinfo_data, SPDRP_FRIENDLYNAME);
            let port_name_raw = get_port_name_from_devkey(hdi, &devinfo_data).or_else(|| {
                friendly_raw
                    .as_deref()
                    .and_then(extract_com_from_friendly_name)
            });

            let Some(port_name_unnorm) = port_name_raw else {
                continue;
            };
            let port_name = normalize_win_com(&port_name_unnorm);
            if port_name.is_empty() || port_name.to_ascii_uppercase().starts_with("LPT") {
                continue;
            }
            let key = port_name.to_ascii_uppercase();
            if seen.contains(&key) {
                continue;
            }

            let mut instance_buf = [0u16; MAX_DEVICE_ID_LEN as usize];
            let mut desired_len = 0u32;
            let inst_res = unsafe {
                SetupDiGetDeviceInstanceIdW(
                    hdi,
                    &devinfo_data,
                    instance_buf.as_mut_ptr(),
                    (instance_buf.len() - 1) as u32,
                    &mut desired_len,
                )
            };
            let instance_id = if inst_res != FALSE {
                let actual = ((instance_buf.len() - 1) as usize).min(desired_len as usize);
                Some(from_utf16_lossy_trimmed(&instance_buf[..actual]))
            } else {
                None
            };

            let hardware_id = get_registry_property_str(hdi, &devinfo_data, SPDRP_HARDWAREID);
            let device_desc = get_registry_property_str(hdi, &devinfo_data, SPDRP_DEVICEDESC_CODE);
            let manufacturer = get_registry_property_str(hdi, &devinfo_data, SPDRP_MFG)
                .map(|s| s.split(';').next_back().unwrap_or(&s).trim().to_string())
                .filter(|s| !s.is_empty());

            let id_combined = format!(
                "{} {}",
                instance_id.as_deref().unwrap_or(""),
                hardware_id.as_deref().unwrap_or("")
            );
            let id_upper = id_combined.to_ascii_uppercase();
            let (vid, pid) = parse_vid_pid(&id_combined);

            let friendly_clean = friendly_raw
                .as_deref()
                .map(|s| strip_port_suffix(s, &port_name))
                .filter(|s| !s.is_empty());
            let desc_clean = device_desc
                .as_deref()
                .map(|s| strip_port_suffix(s, &port_name))
                .filter(|s| !s.is_empty());

            let lower_all = format!(
                "{} {} {}",
                friendly_clean.as_deref().unwrap_or(""),
                desc_clean.as_deref().unwrap_or(""),
                manufacturer.as_deref().unwrap_or("")
            )
            .to_ascii_lowercase();

            let is_bluetooth = id_upper.contains("BTHENUM")
                || id_upper.contains("BTHMODEM")
                || lower_all.contains("bluetooth")
                || lower_all.contains("蓝牙");
            let is_usb = !is_bluetooth
                && (vid.is_some()
                    || pid.is_some()
                    || id_upper.contains("USB\\")
                    || id_upper.contains("FTDIBUS\\")
                    || id_upper.contains("USBSER"));

            let port_type = if is_bluetooth {
                "Bluetooth".to_string()
            } else if is_usb {
                "USB".to_string()
            } else {
                "Standard".to_string()
            };

            let product = friendly_clean.clone().or(desc_clean.clone());
            let description = match (&product, &manufacturer) {
                (Some(prod), Some(mfg)) if !prod.contains(mfg.as_str()) => {
                    format!("{} ({})", prod, mfg)
                }
                (Some(prod), _) => prod.clone(),
                (None, Some(mfg)) => mfg.clone(),
                (None, None) => match (vid, pid) {
                    (Some(v), Some(p)) => format!("USB 串口 (VID:{:04X} PID:{:04X})", v, p),
                    _ if is_bluetooth => "蓝牙串口".to_string(),
                    _ => "标准串口".to_string(),
                },
            };

            seen.insert(key);
            ports.push(SerialPortInfoDto {
                port_name,
                port_type,
                description,
                manufacturer,
                product,
                vid,
                pid,
                is_system: false,
            });
        }

        unsafe { SetupDiDestroyDeviceInfoList(hdi) };
    }

    // Always enumerate HKLM\HARDWARE\DEVICEMAP\SERIALCOMM unconditionally
    let reg_key = as_utf16("HARDWARE\\DEVICEMAP\\SERIALCOMM");
    let mut ports_key: HKEY = 0;
    let open_res = unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            reg_key.as_ptr(),
            0,
            KEY_READ,
            &mut ports_key,
        )
    };
    if open_res == 0 {
        let mut class_name_buff = [0u16; MAX_PATH as usize];
        let mut class_name_size = MAX_PATH;
        let mut sub_key_count = 0u32;
        let mut largest_sub_key = 0u32;
        let mut largest_class_string = 0u32;
        let mut num_key_values = 0u32;
        let mut longest_value_name = 0u32;
        let mut longest_value_data = 0u32;
        let mut size_security_desc = 0u32;
        let mut last_write_time = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let query_res = unsafe {
            RegQueryInfoKeyW(
                ports_key,
                class_name_buff.as_mut_ptr(),
                &mut class_name_size,
                ptr::null(),
                &mut sub_key_count,
                &mut largest_sub_key,
                &mut largest_class_string,
                &mut num_key_values,
                &mut longest_value_name,
                &mut longest_value_data,
                &mut size_security_desc,
                &mut last_write_time,
            )
        };
        if query_res == 0 {
            for idx in 0..num_key_values {
                let mut val_name_buff = [0u16; MAX_PATH as usize];
                let mut val_name_size = MAX_PATH;
                let mut value_type = 0u32;
                let mut val_data = [0u16; MAX_PATH as usize];
                let buffer_byte_len = (val_data.len() * std::mem::size_of::<u16>()) as u32;
                let mut byte_len = buffer_byte_len;

                let res = unsafe {
                    RegEnumValueW(
                        ports_key,
                        idx,
                        val_name_buff.as_mut_ptr(),
                        &mut val_name_size,
                        ptr::null(),
                        &mut value_type,
                        val_data.as_mut_ptr() as *mut u8,
                        &mut byte_len,
                    )
                };
                if res != 0
                    || value_type != REG_SZ
                    || byte_len % 2 != 0
                    || byte_len > buffer_byte_len
                {
                    continue;
                }
                let val_name = from_utf16_lossy_trimmed(
                    &val_name_buff[..(val_name_size as usize).min(val_name_buff.len())],
                );
                let utf16_len = (byte_len as usize) / 2;
                let port_raw = from_utf16_lossy_trimmed(&val_data[..utf16_len]);
                let port_name = normalize_win_com(&port_raw);
                if port_name.is_empty() || port_name.to_ascii_uppercase().starts_with("LPT") {
                    continue;
                }
                let key = port_name.to_ascii_uppercase();
                if seen.contains(&key) {
                    continue;
                }
                seen.insert(key);

                let upper_dev = val_name.to_ascii_uppercase();
                let (port_type, description) = if upper_dev.contains("USBSER") {
                    ("USB".to_string(), "USB 串行设备 (USBSER)".to_string())
                } else if upper_dev.contains("VCP") {
                    ("USB".to_string(), "USB 虚拟串口 (VCP)".to_string())
                } else if upper_dev.contains("BTHMODEM") || upper_dev.contains("BTH") {
                    ("Bluetooth".to_string(), "蓝牙串口 (BthModem)".to_string())
                } else if upper_dev.contains("SERIAL") {
                    ("Standard".to_string(), "板载/标准串口".to_string())
                } else if !val_name.is_empty() {
                    let short_dev = val_name
                        .rsplit('\\')
                        .next()
                        .unwrap_or(&val_name)
                        .to_string();
                    ("Standard".to_string(), format!("串口设备 ({})", short_dev))
                } else {
                    ("Standard".to_string(), "串口设备".to_string())
                };

                ports.push(SerialPortInfoDto {
                    port_name,
                    port_type,
                    description,
                    manufacturer: None,
                    product: None,
                    vid: None,
                    pid: None,
                    is_system: false,
                });
            }
        }
        unsafe { RegCloseKey(ports_key) };
    }

    if let Ok(extra) = serialport::available_ports() {
        for p in extra {
            if let Some(mut dto) = map_serialport_entry(p) {
                dto.port_name = normalize_win_com(&dto.port_name);
                let key = dto.port_name.to_ascii_uppercase();
                if !seen.contains(&key) {
                    seen.insert(key);
                    ports.push(dto);
                }
            }
        }
    }

    ports
}

#[cfg(target_os = "macos")]
fn collect_platform_ports() -> Vec<SerialPortInfoDto> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFMutableDictionary};
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_foundation_sys::base::{kCFAllocatorDefault, CFRetain};
    use io_kit_sys::keys::kIOServicePlane;
    use io_kit_sys::serial::keys::{kIOSerialBSDAllTypes, kIOSerialBSDServiceValue, kIOSerialBSDTypeKey};
    use io_kit_sys::types::{io_object_t, io_registry_entry_t};
    use io_kit_sys::{
        kIOMasterPortDefault, kIORegistryIterateParents, kIORegistryIterateRecursively,
        IOIteratorNext, IOObjectGetClass, IOObjectRelease, IOObjectRetain,
        IORegistryEntryCreateCFProperties, IORegistryEntryGetName, IORegistryEntryGetParentEntry,
        IORegistryEntrySearchCFProperty, IOServiceGetMatchingServices, IOServiceMatching,
    };
    use mach2::kern_return::KERN_SUCCESS;
    use mach2::port::MACH_PORT_NULL;
    use std::collections::HashSet;
    use std::ffi::CStr;
    use std::mem::MaybeUninit;
    use std::os::raw::{c_char, c_void};

    struct IoObjectGuard(io_object_t);

    impl Drop for IoObjectGuard {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    IOObjectRelease(self.0);
                }
            }
        }
    }

    fn c_buf_to_string(buf: &[c_char]) -> String {
        unsafe { CStr::from_ptr(buf.as_ptr()) }
            .to_string_lossy()
            .into_owned()
    }

    fn get_dict_string(dict: &CFDictionary<CFString, *const c_void>, key: &str) -> Option<String> {
        let cf_key = CFString::new(key);
        dict.find(cf_key).and_then(|cf_ref| {
            let cf_type = unsafe { CFType::wrap_under_get_rule(*cf_ref) };
            cf_type.downcast::<CFString>().map(|s| s.to_string())
        })
    }

    fn search_parent_string(entry: io_registry_entry_t, keys: &[&str]) -> Option<String> {
        for key in keys {
            let cf_key = CFString::new(key);
            let cf_ref = unsafe {
                IORegistryEntrySearchCFProperty(
                    entry,
                    kIOServicePlane,
                    cf_key.as_concrete_TypeRef(),
                    kCFAllocatorDefault,
                    kIORegistryIterateRecursively | kIORegistryIterateParents,
                )
            };
            if !cf_ref.is_null() {
                let cf_type = unsafe { CFType::wrap_under_create_rule(cf_ref) };
                if let Some(s) = cf_type.downcast::<CFString>() {
                    let val = s.to_string().trim().to_string();
                    if !val.is_empty() {
                        return Some(val);
                    }
                }
            }
        }
        None
    }

    fn search_parent_u16(entry: io_registry_entry_t, keys: &[&str]) -> Option<u16> {
        for key in keys {
            let cf_key = CFString::new(key);
            let cf_ref = unsafe {
                IORegistryEntrySearchCFProperty(
                    entry,
                    kIOServicePlane,
                    cf_key.as_concrete_TypeRef(),
                    kCFAllocatorDefault,
                    kIORegistryIterateRecursively | kIORegistryIterateParents,
                )
            };
            if !cf_ref.is_null() {
                let cf_type = unsafe { CFType::wrap_under_create_rule(cf_ref) };
                if let Some(num) = cf_type.downcast::<CFNumber>().and_then(|n| n.to_i64()) {
                    if (0..=u16::MAX as i64).contains(&num) {
                        return Some(num as u16);
                    }
                }
            }
        }
        None
    }

    let mut ports: Vec<SerialPortInfoDto> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    unsafe {
        let classes_to_match = IOServiceMatching(kIOSerialBSDServiceValue);
        if !classes_to_match.is_null() {
            let mut classes_to_match = CFMutableDictionary::wrap_under_create_rule(classes_to_match);
            if let (Ok(k), Ok(v)) = (
                CStr::from_ptr(kIOSerialBSDTypeKey).to_str(),
                CStr::from_ptr(kIOSerialBSDAllTypes).to_str(),
            ) {
                classes_to_match.set(
                    CFString::from_static_string(k),
                    CFString::from_static_string(v),
                );
            }

            CFRetain(classes_to_match.as_CFTypeRef());
            let mut matching_services = MaybeUninit::uninit();
            let kr = IOServiceGetMatchingServices(
                kIOMasterPortDefault,
                classes_to_match.as_concrete_TypeRef(),
                matching_services.as_mut_ptr(),
            );
            if kr == KERN_SUCCESS {
                let _iter_guard = IoObjectGuard(matching_services.assume_init());

                loop {
                    let modem_service = IOIteratorNext(_iter_guard.0);
                    if modem_service == MACH_PORT_NULL {
                        break;
                    }
                    let _service_guard = IoObjectGuard(modem_service);

                    let mut props_raw = MaybeUninit::uninit();
                    if IORegistryEntryCreateCFProperties(
                        modem_service,
                        props_raw.as_mut_ptr(),
                        kCFAllocatorDefault,
                        0,
                    ) != KERN_SUCCESS
                    {
                        continue;
                    }
                    let props: CFDictionary<CFString, *const c_void> =
                        CFDictionary::wrap_under_create_rule(props_raw.assume_init());

                    let Some(callout_path) = get_dict_string(&props, "IOCalloutDevice") else {
                        continue;
                    };
                    let path = callout_path.trim().to_string();
                    if path.is_empty()
                        || path.starts_with("/dev/tty.")
                        || path == "/dev/cu.debug-console"
                        || path == "/dev/cu.wlan-debug"
                    {
                        continue;
                    }

                    let tty_base = get_dict_string(&props, "IOTTYBaseName")
                        .or_else(|| get_dict_string(&props, "IOTTYDevice"))
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());

                    let mut is_debug_uart = false;
                    let mut is_usb = false;
                    let mut is_bluetooth = false;

                    let mut cur = modem_service;
                    let mut _owned_cur: Option<IoObjectGuard> = None;
                    for _depth in 0..32 {
                        let mut class_buf = [0 as c_char; 128];
                        let class_name = if IOObjectGetClass(cur, class_buf.as_mut_ptr()) == KERN_SUCCESS {
                            c_buf_to_string(&class_buf)
                        } else {
                            String::new()
                        };

                        let mut name_buf = [0 as c_char; 128];
                        let entry_name = if IORegistryEntryGetName(cur, name_buf.as_mut_ptr()) == KERN_SUCCESS {
                            c_buf_to_string(&name_buf)
                        } else {
                            String::new()
                        };

                        if class_name.contains("AppleSimpleUARTSync")
                            || class_name.contains("AppleSamsungSerial")
                            || entry_name == "debug-console"
                            || entry_name == "wlan-debug"
                        {
                            is_debug_uart = true;
                            break;
                        }
                        if class_name.contains("Bluetooth") || entry_name.contains("Bluetooth") {
                            is_bluetooth = true;
                        }
                        if class_name.contains("USB") || entry_name.contains("USB") {
                            is_usb = true;
                        }

                        let mut parent: io_registry_entry_t = MACH_PORT_NULL;
                        if IORegistryEntryGetParentEntry(cur, kIOServicePlane, &mut parent) != KERN_SUCCESS
                            || parent == MACH_PORT_NULL
                        {
                            break;
                        }
                        _owned_cur = Some(IoObjectGuard(parent));
                        cur = parent;
                    }

                    if is_debug_uart {
                        continue;
                    }

                    let lower_path = path.to_ascii_lowercase();
                    if lower_path.contains("usbserial")
                        || lower_path.contains("usbmodem")
                        || lower_path.contains("wchusbserial")
                        || lower_path.contains("slab_usbtouart")
                    {
                        is_usb = true;
                    }
                    if lower_path.contains("bluetooth") {
                        is_bluetooth = true;
                    }

                    let (port_type, description, manufacturer, product, vid, pid, is_system) = if is_usb {
                        // Retain once temporarily only if needed; search_parent_* works directly on modem_service
                        let _ = IOObjectRetain(modem_service);
                        let _tmp_guard = IoObjectGuard(modem_service);
                        let vid = search_parent_u16(modem_service, &["idVendor"]);
                        let pid = search_parent_u16(modem_service, &["idProduct"]);
                        let product = search_parent_string(
                            modem_service,
                            &["USB Product Name", "kUSBProductString", "Product Name"],
                        );
                        let manufacturer = search_parent_string(
                            modem_service,
                            &["USB Vendor Name", "kUSBVendorString", "Vendor Name"],
                        );
                        let desc = match (&product, &manufacturer) {
                            (Some(prod), Some(mfg)) if !prod.contains(mfg.as_str()) => {
                                format!("{} ({})", prod, mfg)
                            }
                            (Some(prod), _) => prod.clone(),
                            (None, Some(mfg)) => mfg.clone(),
                            (None, None) => match (vid, pid) {
                                (Some(v), Some(p)) => {
                                    format!("USB 串口 (VID:{:04X} PID:{:04X})", v, p)
                                }
                                _ => tty_base.clone().unwrap_or_else(|| "USB 串口".to_string()),
                            },
                        };
                        (
                            "USB".to_string(),
                            desc,
                            manufacturer,
                            product,
                            vid,
                            pid,
                            false,
                        )
                    } else if is_bluetooth {
                        (
                            "Bluetooth".to_string(),
                            tty_base.clone().unwrap_or_else(|| "蓝牙串口".to_string()),
                            None,
                            None,
                            None,
                            None,
                            true,
                        )
                    } else {
                        (
                            "Standard".to_string(),
                            tty_base.clone().unwrap_or_else(|| "标准串口".to_string()),
                            None,
                            None,
                            None,
                            None,
                            false,
                        )
                    };

                    if seen.insert(path.clone()) {
                        ports.push(SerialPortInfoDto {
                            port_name: path,
                            port_type,
                            description,
                            manufacturer,
                            product,
                            vid,
                            pid,
                            is_system,
                        });
                    }
                }
            }
        }
    }

    // Fallback scan of /dev/cu.* so user-space virtual serial ports (e.g. socat) also show up
    if let Ok(entries) = std::fs::read_dir("/dev") {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !file_name.starts_with("cu.")
                || file_name == "cu.debug-console"
                || file_name == "cu.wlan-debug"
            {
                continue;
            }
            let full_path = format!("/dev/{}", file_name);
            if seen.contains(&full_path) {
                continue;
            }
            let lower = file_name.to_ascii_lowercase();
            let (port_type, description, is_system) = if lower.contains("usbserial")
                || lower.contains("usbmodem")
                || lower.contains("wchusbserial")
                || lower.contains("slab_usbtouart")
            {
                ("USB".to_string(), "USB 串口".to_string(), false)
            } else if lower.contains("bluetooth") {
                (
                    "Bluetooth".to_string(),
                    file_name.trim_start_matches("cu.").to_string(),
                    true,
                )
            } else {
                ("Standard".to_string(), "标准/虚拟串口".to_string(), false)
            };

            seen.insert(full_path.clone());
            ports.push(SerialPortInfoDto {
                port_name: full_path,
                port_type,
                description,
                manufacturer: None,
                product: None,
                vid: None,
                pid: None,
                is_system,
            });
        }
    }

    ports
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn collect_platform_ports() -> Vec<SerialPortInfoDto> {
    use std::collections::HashSet;

    let mut ports: Vec<SerialPortInfoDto> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if let Ok(extra) = serialport::available_ports() {
        for p in extra {
            if let Some(dto) = map_serialport_entry(p) {
                if seen.insert(dto.port_name.clone()) {
                    ports.push(dto);
                }
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir("/dev") {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !(file_name.starts_with("ttyUSB")
                || file_name.starts_with("ttyACM")
                || file_name.starts_with("ttyAMA"))
            {
                continue;
            }
            let full_path = format!("/dev/{}", file_name);
            if seen.insert(full_path.clone()) {
                let port_type = if file_name.starts_with("ttyUSB") || file_name.starts_with("ttyACM") {
                    "USB"
                } else {
                    "Standard"
                };
                let desc = if port_type == "USB" {
                    "USB 串口"
                } else {
                    "板载串口"
                };
                ports.push(SerialPortInfoDto {
                    port_name: full_path,
                    port_type: port_type.to_string(),
                    description: desc.to_string(),
                    manufacturer: None,
                    product: None,
                    vid: None,
                    pid: None,
                    is_system: false,
                });
            }
        }
    }

    ports
}

fn normalize_port_name(port_name: &str) -> String {
    let trimmed = port_name.trim();
    #[cfg(target_os = "windows")]
    {
        if trimmed.len() >= 4
            && trimmed[..3].eq_ignore_ascii_case("COM")
            && trimmed[3..].chars().all(|c| c.is_ascii_digit())
        {
            return format!("COM{}", &trimmed[3..]);
        }
    }
    trimmed.to_string()
}

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<SerialPortInfoDto>, String> {
    let mut list = collect_platform_ports();
    sort_ports(&mut list);
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
    let normalized_port = normalize_port_name(&port_name);
    if normalized_port.is_empty() {
        return Err("串口端口号不能为空".to_string());
    }

    // 1. Clean up any existing session with the same ID first
    let prev = {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.remove(&id)
    };
    if let Some(old) = prev {
        old.stop_flag.store(true, Ordering::Relaxed);
        let _ = old.cmd_tx.send(SerialCommand::Disconnect);
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

    let open_result = serialport::new(&normalized_port, baud_rate)
        .data_bits(parsed_data_bits)
        .stop_bits(parsed_stop_bits)
        .parity(parsed_parity)
        .flow_control(parsed_flow_control)
        .timeout(Duration::from_millis(8))
        .open();

    #[cfg(target_os = "macos")]
    let mut port = match open_result {
        Ok(p) => p,
        Err(e) if baud_rate > 0 && normalized_port.starts_with("/dev/ttys") => {
            serialport::new(&normalized_port, 0)
                .data_bits(parsed_data_bits)
                .stop_bits(parsed_stop_bits)
                .parity(parsed_parity)
                .flow_control(parsed_flow_control)
                .timeout(Duration::from_millis(8))
                .open()
                .map_err(|_| {
                    format!(
                        "无法打开串口 {} ({} bps): {}",
                        normalized_port, baud_rate, e
                    )
                })?
        }
        Err(e) => {
            return Err(format!(
                "无法打开串口 {} ({} bps): {}",
                normalized_port, baud_rate, e
            ))
        }
    };

    #[cfg(not(target_os = "macos"))]
    let mut port = open_result.map_err(|e| {
        format!(
            "无法打开串口 {} ({} bps): {}",
            normalized_port, baud_rate, e
        )
    })?;

    // Assert DTR (and RTS if not hardware flow control) so USB-CDC / MCU boards start transmitting
    let _ = port.write_data_terminal_ready(true);
    if parsed_flow_control != FlowControl::Hardware {
        let _ = port.write_request_to_send(true);
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let (cmd_tx, cmd_rx) = mpsc::channel::<SerialCommand>();

    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            id.clone(),
            SerialSession {
                stop_flag: stop_flag.clone(),
                cmd_tx,
                port_name: normalized_port.clone(),
                baud_rate,
            },
        );
    }

    let app_clone = app.clone();
    let id_clone = id.clone();
    let port_name_clone = normalized_port.clone();
    let sessions_arc = state.sessions.clone();
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
        normalized_port, baud_rate, data_bits, parity_char, stop_num
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

            let mut should_disconnect = false;
            let mut write_error: Option<String> = None;
            while let Ok(cmd) = cmd_rx.try_recv() {
                match cmd {
                    SerialCommand::Write(bytes) => {
                        if !bytes.is_empty() {
                            if let Err(e) = port.write_all(&bytes) {
                                write_error = Some(format!("串口写入失败: {}", e));
                                break;
                            }
                        }
                    }
                    SerialCommand::SetSignals { dtr, rts } => {
                        if let Some(dtr_val) = dtr {
                            let _ = port.write_data_terminal_ready(dtr_val);
                        }
                        if let Some(rts_val) = rts {
                            let _ = port.write_request_to_send(rts_val);
                        }
                    }
                    SerialCommand::Disconnect => {
                        should_disconnect = true;
                        break;
                    }
                }
            }

            if should_disconnect || stop_clone.load(Ordering::Relaxed) {
                flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, true);
                break;
            }

            if let Some(err_msg) = write_error {
                flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, true);
                if !stop_clone.load(Ordering::Relaxed) {
                    let _ = app_clone.emit(&format!("serial-error-{}", id_clone), err_msg);
                    let _ = app_clone.emit(&format!("serial-closed-{}", id_clone), ());
                }
                break;
            }

            match port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    pending_out.extend_from_slice(&buf[..n]);
                    if pending_out.len() >= 65536
                        || last_flush.elapsed() >= Duration::from_millis(8)
                    {
                        flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, false);
                        last_flush = Instant::now();
                    }
                }
                Ok(_) => {
                    if !pending_out.is_empty()
                        && last_flush.elapsed() >= Duration::from_millis(8)
                    {
                        flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, false);
                        last_flush = Instant::now();
                    }
                    thread::sleep(Duration::from_millis(2));
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::Interrupted =>
                {
                    if !pending_out.is_empty()
                        && last_flush.elapsed() >= Duration::from_millis(8)
                    {
                        flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, false);
                        last_flush = Instant::now();
                    }
                }
                Err(e) => {
                    flush_utf8_buffer(&app_clone, &out_event, &mut pending_out, true);
                    if !stop_clone.load(Ordering::Relaxed) {
                        let _ = app_clone.emit(
                            &format!("serial-error-{}", id_clone),
                            format!("串口连接中断 ({}): {}", port_name_clone, e),
                        );
                        let _ = app_clone.emit(&format!("serial-closed-{}", id_clone), ());
                    }
                    break;
                }
            }
        }

        if let Ok(mut sessions) = sessions_arc.lock() {
            if let Some(current) = sessions.get(&id_clone) {
                if Arc::ptr_eq(&current.stop_flag, &stop_clone) {
                    sessions.remove(&id_clone);
                }
            }
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
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&id) {
        session
            .cmd_tx
            .send(SerialCommand::Write(data.into_bytes()))
            .map_err(|_| "串口连接已关闭".to_string())?;
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
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&id) {
        session
            .cmd_tx
            .send(SerialCommand::SetSignals { dtr, rts })
            .map_err(|_| "串口连接已关闭".to_string())?;
        Ok(())
    } else {
        Err("串口未连接".to_string())
    }
}

#[tauri::command]
pub fn serial_disconnect(state: tauri::State<'_, SerialState>, id: String) -> Result<(), String> {
    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(session) = sessions.remove(&id) {
            session.stop_flag.store(true, Ordering::Relaxed);
            let _ = session.cmd_tx.send(SerialCommand::Disconnect);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_port_suffix_removes_trailing_com_tag() {
        assert_eq!(
            strip_port_suffix("USB-SERIAL CH340 (COM3)", "COM3"),
            "USB-SERIAL CH340"
        );
        assert_eq!(
            strip_port_suffix("Silicon Labs CP210x USB to UART Bridge (com12)", "COM12"),
            "Silicon Labs CP210x USB to UART Bridge"
        );
        assert_eq!(
            strip_port_suffix("调试串口 （COM5）", "COM5"),
            "调试串口"
        );
        assert_eq!(strip_port_suffix("COM3", "COM3"), "");
    }

    #[test]
    fn sort_ports_orders_usb_and_natural_numbers_before_system() {
        let mk = |port_name: &str, port_type: &str, is_system: bool| SerialPortInfoDto {
            port_name: port_name.to_string(),
            port_type: port_type.to_string(),
            description: String::new(),
            manufacturer: None,
            product: None,
            vid: None,
            pid: None,
            is_system,
        };

        let mut list = vec![
            mk("/dev/cu.Bluetooth-Incoming-Port", "Bluetooth", true),
            mk("COM10", "USB", false),
            mk("COM1", "Standard", false),
            mk("COM2", "USB", false),
        ];
        sort_ports(&mut list);

        let names: Vec<&str> = list.iter().map(|p| p.port_name.as_str()).collect();
        assert_eq!(
            names,
            vec!["COM2", "COM10", "COM1", "/dev/cu.Bluetooth-Incoming-Port"]
        );
    }

    #[test]
    fn serial_list_ports_filters_noise_and_marks_system_bluetooth() {
        let ports = serial_list_ports().expect("serial_list_ports should succeed");
        for p in &ports {
            assert!(!p.port_name.trim().is_empty(), "port_name must not be empty");
            assert!(
                !p.port_name.starts_with("/dev/tty."),
                "must not expose blocking /dev/tty.* node: {}",
                p.port_name
            );
            assert_ne!(p.port_name, "/dev/cu.debug-console");
            assert_ne!(p.port_name, "/dev/cu.wlan-debug");
            if p.port_type == "Bluetooth" && cfg!(target_os = "macos") {
                assert!(
                    p.is_system,
                    "macOS bluetooth port {} should be marked as is_system=true",
                    p.port_name
                );
            }
        }
    }
}
