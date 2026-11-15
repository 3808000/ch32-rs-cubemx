// Tauri 应用主体：前端为纯本地 Vue SPA；桌面端补充原生保存/目录写入命令，
// 因为 WebKitGTK 不支持 File System Access API 与浏览器下载。
use base64::Engine;
use std::path::{Path, PathBuf};

#[derive(serde::Deserialize)]
struct FileEntry {
    /// 相对导出根目录的路径（'a/b/c.rs'）
    path: String,
    /// 文件内容（base64）
    contents: String,
}

fn decode(contents: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(contents)
        .map_err(|e| format!("base64 解码失败：{e}"))
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    if rel.starts_with('/') || rel.split('/').any(|s| s == ".." || s.is_empty()) {
        return Err(format!("非法导出路径：{rel}"));
    }
    Ok(root.join(rel))
}

/// 保存单个文件（ZIP / cube.json）：path 由前端原生保存对话框给出。
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    let bytes = decode(&contents)?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("写入失败：{e}"))
}

/// 把整份生成结果写入用户选择的目录（桌面端替代 File System Access API）。
#[tauri::command]
fn write_files(root: String, files: Vec<FileEntry>) -> Result<usize, String> {
    let root = PathBuf::from(&root);
    let mut written = 0usize;
    for f in &files {
        let dest = safe_join(&root, &f.path)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        std::fs::write(&dest, decode(&f.contents)?).map_err(|e| format!("写入 {} 失败：{e}", f.path))?;
        written += 1;
    }
    Ok(written)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_file, write_files])
        .run(tauri::generate_context!())
        .expect("error while running ch32-rs-CubeMX");
}