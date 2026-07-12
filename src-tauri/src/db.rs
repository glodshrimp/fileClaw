use std::fs;
use tauri::Manager;

#[tauri::command]
pub fn get_db_data(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    
    let db_path = app_dir.join("data.json");
    if !db_path.exists() {
        // Try to automatically migrate from the old FileScan path
        if let Ok(old_dir) = app_handle.path().app_local_data_dir() {
            if let Some(parent) = old_dir.parent() {
                let old_db_path = parent.join("project-management-system").join("data.json");
                if old_db_path.exists() {
                    if !app_dir.exists() {
                        let _ = fs::create_dir_all(&app_dir);
                    }
                    if let Ok(_) = fs::copy(&old_db_path, &db_path) {
                        println!("Successfully auto-migrated database from {:?}", old_db_path);
                    }
                }
            }
        }
    }
    
    let exists = db_path.exists();
    let size = db_path.metadata().map(|m| m.len()).unwrap_or(0);
    println!("Rust get_db_data: path={:?}, exists={}, size={}", db_path, exists, size);
    
    if !db_path.exists() {
        return Ok("{}".to_string());
    }
    
    fs::read_to_string(db_path).map_err(|e| format!("Failed to read database file: {}", e))
}

#[tauri::command]
pub fn save_db_data(app_handle: tauri::AppHandle, data: String) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create database directory: {}", e))?;
    }
    
    let db_path = app_dir.join("data.json");
    fs::write(db_path, data).map_err(|e| format!("Failed to write database file: {}", e))
}

#[tauri::command]
pub fn get_db_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;
    Ok(app_dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn print_frontend_log(msg: String) {
    println!("[Frontend Log] {}", msg);
}
