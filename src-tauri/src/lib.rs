mod workspace;

use tauri::Manager;
use workspace::{
    list_directory, read_text_file, run_shell_command, set_workspace_root, write_text_file,
    CommandResult, DirNode, WorkspaceState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(WorkspaceState::default())
        .invoke_handler(tauri::generate_handler![
            set_workspace,
            list_dir,
            read_file,
            write_file,
            run_command,
            get_workspace
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Forge IDE");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Forge IDE");
}

#[tauri::command]
fn set_workspace(path: String, state: tauri::State<'_, WorkspaceState>) -> Result<String, String> {
    set_workspace_root(&state, path)
}

#[tauri::command]
fn get_workspace(state: tauri::State<'_, WorkspaceState>) -> Option<String> {
    state.root.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
fn list_dir(path: String, state: tauri::State<'_, WorkspaceState>) -> Result<Vec<DirNode>, String> {
    list_directory(&state, path)
}

#[tauri::command]
fn read_file(path: String, state: tauri::State<'_, WorkspaceState>) -> Result<String, String> {
    read_text_file(&state, path)
}

#[tauri::command]
fn write_file(
    path: String,
    contents: String,
    state: tauri::State<'_, WorkspaceState>,
) -> Result<(), String> {
    write_text_file(&state, path, contents)
}

#[tauri::command]
fn run_command(
    command: String,
    cwd: Option<String>,
    state: tauri::State<'_, WorkspaceState>,
) -> Result<CommandResult, String> {
    run_shell_command(&state, command, cwd)
}
