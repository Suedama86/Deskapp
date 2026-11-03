use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Default)]
pub struct WorkspaceState {
    pub root: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub cwd: String,
}

fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                if !out.pop() {
                    return Err("Path escapes workspace root".into());
                }
            }
            Component::CurDir => {}
            Component::Normal(s) => out.push(s),
            Component::RootDir => out = PathBuf::from("/"),
            Component::Prefix(p) => out = PathBuf::from(p.as_os_str()),
        }
    }
    Ok(out)
}

fn resolve_under_workspace(state: &WorkspaceState, path: &str) -> Result<PathBuf, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "Workspace lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No workspace folder open".to_string())?;

    let root_path = fs::canonicalize(&root).map_err(|e| format!("Invalid workspace: {e}"))?;
    let requested = PathBuf::from(path);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        root_path.join(requested)
    };

    let normalized = if candidate.exists() {
        fs::canonicalize(&candidate).map_err(|e| format!("Cannot resolve path: {e}"))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| "Invalid path".to_string())?;
        let parent_canon = fs::canonicalize(parent)
            .map_err(|e| format!("Cannot resolve parent path: {e}"))?;
        let file_name = candidate
            .file_name()
            .ok_or_else(|| "Invalid file name".to_string())?;
        normalize_path(&parent_canon.join(file_name))?
    };

    if !normalized.starts_with(&root_path) {
        return Err("Access denied: path is outside the open workspace".into());
    }

    Ok(normalized)
}

pub fn set_workspace_root(state: &WorkspaceState, path: String) -> Result<String, String> {
    let canon = fs::canonicalize(&path).map_err(|e| format!("Cannot open folder: {e}"))?;
    if !canon.is_dir() {
        return Err("Selected path is not a directory".into());
    }
    let as_string = canon.to_string_lossy().to_string();
    *state
        .root
        .lock()
        .map_err(|_| "Workspace lock poisoned".to_string())? = Some(as_string.clone());
    Ok(as_string)
}

pub fn list_directory(state: &WorkspaceState, path: String) -> Result<Vec<DirNode>, String> {
    let dir = resolve_under_workspace(state, &path)?;
    if !dir.is_dir() {
        return Err("Not a directory".into());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let meta = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        entries.push(DirNode {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

pub fn read_text_file(state: &WorkspaceState, path: String) -> Result<String, String> {
    let file = resolve_under_workspace(state, &path)?;
    if !file.is_file() {
        return Err("Not a file".into());
    }
    fs::read_to_string(&file).map_err(|e| format!("Failed to read file: {e}"))
}

pub fn write_text_file(
    state: &WorkspaceState,
    path: String,
    contents: String,
) -> Result<(), String> {
    let file = resolve_under_workspace(state, &path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {e}"))?;
    }
    let mut handle = fs::File::create(&file).map_err(|e| format!("Failed to open file: {e}"))?;
    handle
        .write_all(contents.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))
}

pub fn run_shell_command(
    state: &WorkspaceState,
    command: String,
    cwd: Option<String>,
) -> Result<CommandResult, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "Workspace lock poisoned".to_string())?
        .clone();

    let workdir = if let Some(path) = cwd.or(root.clone()) {
        // Prefer workspace-scoped resolution; if no workspace is open yet,
        // only allow an absolute directory that already exists.
        match resolve_under_workspace(state, &path) {
            Ok(p) => p,
            Err(_) if root.is_none() => {
                let p = PathBuf::from(&path);
                if p.is_dir() {
                    fs::canonicalize(p).map_err(|e| format!("Invalid working directory: {e}"))?
                } else {
                    return Err("Invalid working directory".into());
                }
            }
            Err(e) => return Err(e),
        }
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?
    };

    if command.trim().is_empty() {
        return Err("Empty command".into());
    }

    // Non-interactive command runner (stdout/stderr capture). Full PTY is not
    // wired here — keeps the surface small and avoids unrestricted shell tooling.
    let mut child = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", &command])
            .current_dir(&workdir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .spawn()
    } else {
        Command::new("sh")
            .args(["-lc", &command])
            .current_dir(&workdir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .spawn()
    }
    .map_err(|e| format!("Failed to spawn command: {e}"))?;

    // Soft timeout guard so a hung process cannot freeze the IDE panel forever.
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(60);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                return Err("Command timed out after 60s".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(format!("Failed waiting for command: {e}")),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to collect command output: {e}"))?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        cwd: workdir.to_string_lossy().to_string(),
    })
}
