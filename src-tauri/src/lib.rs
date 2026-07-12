mod db;
mod fs;
mod git;
mod pty;
mod ssh;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(pty::PtyState::default())
        .manage(ssh::SshState::default())
        .setup(|app| {
            use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};
            
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        for window in app.webview_windows().values() {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event {
                        for window in tray.app_handle().webview_windows().values() {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                })
                .build(app)?;

            // Set window size to 75% of primary monitor resolution
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let size = monitor.size();
                    let w = (size.width as f64 * 0.75) as u32;
                    let h = (size.height as f64 * 0.75) as u32;
                    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w, height: h }));
                    let _ = window.center();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                window.hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            // DB Commands
            db::get_db_data,
            db::save_db_data,
            db::get_db_path,
            db::print_frontend_log,
            
            // FS Commands
            fs::local_list_dir,
            fs::local_home_dir,
            fs::local_stat,
            fs::local_write_file,
            fs::local_delete_node,
            fs::local_create_node,
            fs::local_copy_file,
            fs::read_file_base64,
            fs::select_directory,
            fs::select_files,
            fs::open_directory,
            
            // PTY Commands
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_destroy,
            pty::pty_destroy_session,
            
            // SSH & SFTP Commands
            ssh::ssh_connect,
            ssh::ssh_disconnect,
            ssh::ssh_open_shell,
            ssh::ssh_write_shell,
            ssh::ssh_resize_shell,
            ssh::ssh_close_shell,
            ssh::ssh_exec,
            ssh::sftp_list,
            ssh::sftp_mkdir,
            ssh::sftp_rmdir,
            ssh::sftp_unlink,
            ssh::sftp_rename,
            ssh::sftp_stat,
            ssh::sftp_chmod,
            ssh::sftp_upload,
            ssh::sftp_download,
            ssh::sftp_cancel_transfer,
            ssh::ssh_forward_local,
            ssh::ssh_forward_remote,
            ssh::ssh_stop_tunnel,
            
            // Git Commands
            git::git_init,
            git::git_discover_roots,
            git::git_unstage,
            git::git_create_branch,
            git::git_delete_branch,
            git::git_rename_branch,
            git::git_create_tag,
            git::git_status,
            git::git_current_branch,
            git::git_branches,
            git::git_checkout,
            git::git_add,
            git::git_restore,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_fetch,
            git::git_remotes,
            git::git_set_remote_url,
            git::git_history,
            git::git_stash_push,
            git::git_stash_list,
            git::git_stash_pop,
            git::git_unpushed_commits,
            git::git_commit_files,
            git::git_show_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows: _, .. } => {
                for window in _app_handle.webview_windows().values() {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
            _ => {}
        });
}
