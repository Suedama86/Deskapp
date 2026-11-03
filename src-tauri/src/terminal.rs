use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::workspace::WorkspaceState;

#[derive(Default)]
pub struct PtyRegistry {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, PtyHandles>>,
}

struct PtyHandles {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Box<dyn MasterPty + Send>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    alive: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutputEvent {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    id: u32,
    code: Option<u32>,
}

fn default_shell() -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        (
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
            vec!["/K".into()],
        )
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        (shell, vec!["-l".into()])
    }
}

fn resolve_cwd(state: &WorkspaceState, cwd: Option<String>) -> Result<std::path::PathBuf, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "Workspace lock poisoned".to_string())?
        .clone();

    if let Some(path) = cwd.or(root.clone()) {
        match crate::workspace::resolve_under_workspace_pub(state, &path) {
            Ok(p) => Ok(p),
            Err(_) if root.is_none() => {
                let p = std::path::PathBuf::from(&path);
                if p.is_dir() {
                    std::fs::canonicalize(p).map_err(|e| format!("Invalid working directory: {e}"))
                } else {
                    Err("Invalid working directory".into())
                }
            }
            Err(e) => Err(e),
        }
    } else {
        std::env::current_dir().map_err(|e| e.to_string())
    }
}

pub fn pty_start(
    app: AppHandle,
    registry: &PtyRegistry,
    workspace: &WorkspaceState,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<u32, String> {
    let workdir = resolve_cwd(workspace, cwd)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let (shell, args) = default_shell();
    let mut cmd = CommandBuilder::new(&shell);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.cwd(&workdir);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell ({shell}): {e}"))?;

    let killer = child
        .clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let id = registry.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let alive = Arc::new(AtomicBool::new(true));

    {
        let mut sessions = registry
            .sessions
            .lock()
            .map_err(|_| "PTY registry lock poisoned".to_string())?;
        sessions.insert(
            id,
            PtyHandles {
                writer: Mutex::new(writer),
                master: pair.master,
                killer: Mutex::new(killer),
                alive: alive.clone(),
            },
        );
    }

    let app_out = app.clone();
    let alive_reader = alive.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while alive_reader.load(Ordering::SeqCst) {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_out.emit(
                        "pty-output",
                        PtyOutputEvent {
                            id,
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        alive_reader.store(false, Ordering::SeqCst);
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = app_out.emit("pty-exit", PtyExitEvent { id, code });
    });

    // Banner so the UI can show cwd/shell immediately.
    let (shell_name, _) = default_shell();
    let banner = format!(
        "\r\n\x1b[90mForge PTY · {shell_name}\r\n{}\x1b[0m\r\n",
        workdir.display()
    );
    let _ = app.emit(
        "pty-output",
        PtyOutputEvent {
            id,
            data: banner,
        },
    );

    Ok(id)
}

pub fn pty_write(registry: &PtyRegistry, id: u32, data: String) -> Result<(), String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "PTY registry lock poisoned".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("Unknown PTY session {id}"))?;
    if !session.alive.load(Ordering::SeqCst) {
        return Err("PTY session has exited".into());
    }
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "PTY writer lock poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {e}"))?;
    writer.flush().map_err(|e| format!("Failed to flush PTY: {e}"))
}

pub fn pty_resize(registry: &PtyRegistry, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "PTY registry lock poisoned".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("Unknown PTY session {id}"))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {e}"))
}

pub fn pty_kill(registry: &PtyRegistry, id: u32) -> Result<(), String> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| "PTY registry lock poisoned".to_string())?;
    if let Some(session) = sessions.remove(&id) {
        session.alive.store(false, Ordering::SeqCst);
        let mut killer = session
            .killer
            .lock()
            .map_err(|_| "PTY killer lock poisoned".to_string())?;
        let _ = killer.kill();
        // Brief pause so the reader thread can unwind.
        thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}
