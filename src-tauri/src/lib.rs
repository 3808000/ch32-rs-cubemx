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

#[derive(serde::Serialize)]
struct ReadFileEntry {
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

/// 校验用户选择的导出根目录：拒绝含 `..` 的路径，且必须已存在为目录。
fn existing_root(root: &str) -> Result<PathBuf, String> {
    if root.contains("..") {
        return Err(format!("非法目录路径：{root}"));
    }
    let path = PathBuf::from(root);
    if !path.is_dir() {
        return Err(format!("目录不存在：{root}"));
    }
    Ok(path)
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

/// 递归收集目录下的普通文件（跳过 target/、.git/ 与符号链接）。
fn collect_files(root: &Path, dir: &Path, out: &mut Vec<ReadFileEntry>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取目录 {} 失败：{e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败：{e}"))?;
        let file_type = entry.file_type().map_err(|e| format!("读取文件类型失败：{e}"))?;
        // 不跟随符号链接，避免读到导出根目录之外的文件。
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if file_type.is_dir() {
            if name == "target" || name == ".git" {
                continue;
            }
            collect_files(root, &path, out)?;
        } else if file_type.is_file() {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| format!("路径解析失败：{e}"))?
                .to_string_lossy()
                .replace('\\', "/");
            let bytes = std::fs::read(&path).map_err(|e| format!("读取 {rel} 失败：{e}"))?;
            let contents = base64::engine::general_purpose::STANDARD.encode(bytes);
            out.push(ReadFileEntry { path: rel, contents });
        }
    }
    Ok(())
}

/// 读取导出目录现状（相对路径 + base64 内容），供前端构建再生成 plan。
#[tauri::command]
fn read_folder(root: String) -> Result<Vec<ReadFileEntry>, String> {
    let root = existing_root(&root)?;
    let mut files = Vec::new();
    collect_files(&root, &root, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// 删除导出目录内的单个文件（仅用于清理不再生成的 generated 文件）。
#[tauri::command]
fn remove_file(root: String, path: String) -> Result<(), String> {
    let root = existing_root(&root)?;
    let dest = safe_join(&root, &path)?;
    match std::fs::remove_file(&dest) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除 {path} 失败：{e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            write_file,
            write_files,
            read_folder,
            remove_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ch32-rs-CubeMX");
}