//! Findly for Windows: the same app as the website, in its own window, with the library as a real folder on the
//! computer (you pick it once). Documents are read straight from disk instead of being kept in the browser's storage,
//! so big libraries don't fill up memory. Paths given to the page are relative to the library folder.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("library-folder.txt"))
}

/// Where the library goes until you pick a folder: a "Findly Library" folder next to Findly.exe, if the app can
/// write there (an install under Program Files can't), otherwise Documents\Findly.
fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("Findly Library"))) {
        let probe = dir.join(".findly-write-test");
        if fs::create_dir_all(&dir).is_ok() && fs::write(&probe, b"").is_ok() {
            let _ = fs::remove_file(&probe);
            return Ok(dir);
        }
    }
    Ok(app.path().document_dir().map_err(|e| e.to_string())?.join("Findly"))
}

fn has_files(dir: &Path) -> bool {
    fs::read_dir(dir).map(|mut r| r.any(|e| e.is_ok())).unwrap_or(false)
}

/// Moves everything in `from` into `to` (folders too), copying where a plain move can't (another drive).
fn move_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if dst.exists() { continue; }
        if fs::rename(&src, &dst).is_err() {
            if e.file_type()?.is_dir() { move_tree(&src, &dst)?; let _ = fs::remove_dir_all(&src); }
            else { fs::copy(&src, &dst)?; fs::remove_file(&src)?; }
        }
    }
    Ok(())
}

static ROOT_READY: std::sync::OnceLock<()> = std::sync::OnceLock::new();

/// The library folder: the one you picked, or the default (see default_root) until you pick one.
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let saved = fs::read_to_string(config_file(app)?).ok().map(|s| PathBuf::from(s.trim())).filter(|p| p.is_dir());
    let dir = match saved {
        Some(p) => p,
        None => {
            let dir = default_root(app)?;
            // once: a library the app used to keep in Documents\Findly (which can sit in OneDrive) moves to the
            // new place, and that place is remembered from then on
            ROOT_READY.get_or_init(|| {
                if let Ok(docs) = app.path().document_dir() {
                    let old = docs.join("Findly");
                    if old != dir && old.is_dir() && has_files(&old) && !has_files(&dir) && move_tree(&old, &dir).is_ok() {
                        let _ = fs::remove_dir(&old); // only if it's now empty
                        if let Ok(cf) = config_file(app) { let _ = fs::write(cf, dir.to_string_lossy().as_bytes()); }
                    }
                }
            });
            dir
        }
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A path inside the library folder (never outside it).
fn at(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("bad path".into());
    }
    Ok(root(app)?.join(rel))
}

fn rel_of(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

/// A name that isn't taken yet: "Name.pdf", "Name 2.pdf"…
fn free(dir: &Path, name: &str) -> PathBuf {
    let clean = name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
    let mut p = dir.join(&clean);
    let stem = Path::new(&clean).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = Path::new(&clean).extension().map(|s| s.to_string_lossy().to_string());
    let mut n = 2;
    while p.exists() {
        p = dir.join(match &ext { Some(e) => format!("{stem} {n}.{e}"), None => format!("{stem} {n}") });
        n += 1;
    }
    p
}

#[derive(Serialize)]
struct Info { root: String, url_root: String }

#[derive(Serialize)]
struct Entry { path: String, size: u64, mtime: f64 }

#[derive(Serialize)]
struct Listing { files: Vec<Entry>, pending: u32, waiting: Vec<String>, cloud: bool }

#[tauri::command]
fn info(app: AppHandle) -> Result<Info, String> {
    let r = root(&app)?;
    let s = r.to_string_lossy().to_string();
    Ok(Info { url_root: s.clone(), root: s })
}

#[tauri::command]
fn list(app: AppHandle) -> Result<Listing, String> {
    let r = root(&app)?;
    let mut files = Vec::new();
    fn walk(dir: &Path, root: &Path, out: &mut Vec<Entry>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('~') || name == "desktop.ini" || name == "Thumbs.db" { continue; }
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() { walk(&p, root, out); continue; }
            let mtime = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0);
            out.push(Entry { path: rel_of(root, &p), size: md.len(), mtime });
        }
    }
    walk(&r, &r, &mut files);
    Ok(Listing { files, pending: 0, waiting: vec![], cloud: false })
}

#[tauri::command]
fn write(app: AppHandle, path: String, data: String, append: Option<bool>) -> Result<serde_json::Value, String> {
    let p = at(&app, &path)?;
    if let Some(dir) = p.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new().create(true).write(true).append(append.unwrap_or(false)).truncate(!append.unwrap_or(false)).open(&p).map_err(|e| e.to_string())?;
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path }))
}

#[tauri::command]
fn free_name(app: AppHandle, name: String, folder: Option<String>) -> Result<serde_json::Value, String> {
    let r = root(&app)?;
    let dir = match folder.filter(|f| !f.is_empty()) { Some(f) => at(&app, &f)?, None => r.clone() };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": rel_of(&r, &free(&dir, &name)) }))
}

#[tauri::command]
fn remove(app: AppHandle, path: String) -> Result<(), String> {
    let p = at(&app, &path)?;
    if p.is_file() { fs::remove_file(p).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn rename(app: AppHandle, from: String, name: String) -> Result<serde_json::Value, String> {
    let r = root(&app)?;
    let src = at(&app, &from)?;
    let dest = free(src.parent().unwrap_or(&r), &name);
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": rel_of(&r, &dest) }))
}

/// Moves a library file into a folder (relative to the library, "" for the top), keeping its name unless one
/// is taken there; then removes folders the move left empty. Answers the file's new path.
#[tauri::command]
fn move_to(app: AppHandle, from: String, folder: String) -> Result<serde_json::Value, String> {
    let r = root(&app)?;
    let src = at(&app, &from)?;
    let dir = if folder.is_empty() { r.clone() } else { at(&app, &folder)? };
    if src.parent() == Some(dir.as_path()) { return Ok(serde_json::json!({ "path": from })); }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let dest = free(&dir, &name);
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    // folders emptied by the move go too (never the library folder itself)
    let mut up = src.parent().map(|p| p.to_path_buf());
    while let Some(d) = up {
        if d == r || !d.starts_with(&r) { break; }
        if fs::read_dir(&d).map(|mut x| x.next().is_some()).unwrap_or(true) { break; }
        let _ = fs::remove_dir(&d);
        up = d.parent().map(|p| p.to_path_buf());
    }
    Ok(serde_json::json!({ "path": rel_of(&r, &dest) }))
}

#[tauri::command]
fn read(app: AppHandle, path: String, offset: u64, length: u64) -> Result<serde_json::Value, String> {
    let mut f = fs::File::open(at(&app, &path)?).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(length as usize);
    f.take(length).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "data": B64.encode(buf) }))
}

#[tauri::command]
fn stat(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let md = fs::metadata(at(&app, &path)?).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path, "size": md.len() }))
}

/// Pick the library folder (any folder on the computer); the app reads documents straight from it.
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("Choose the folder for your Findly library").blocking_pick_folder();
    let Some(fp) = picked else { return Ok(None) };
    let p = fp.into_path().map_err(|e| e.to_string())?;
    fs::write(config_file(&app)?, p.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(p.to_string_lossy().to_string()))
}

/// Show the library folder in File Explorer.
#[tauri::command]
fn reveal(app: AppHandle) -> Result<(), String> {
    let r = root(&app)?;
    #[cfg(target_os = "windows")]
    { std::process::Command::new("explorer").arg(&r).spawn().map_err(|e| e.to_string())?; }
    #[cfg(not(target_os = "windows"))]
    { let _ = r; }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![info, list, write, free_name, remove, rename, move_to, read, stat, pick_folder, reveal])
        .run(tauri::generate_context!())
        .expect("error while running Findly");
}
