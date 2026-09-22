//! Text/binary file list, preview, atomic write, upload.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;

use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::persist;
use crate::security::AccessService;

const TEXT_PREVIEW_MAX: u64 = 256 * 1024;
const TEXT_EDIT_MAX: u64 = 2 * 1024 * 1024;
const IMAGE_PREVIEW_MAX: u64 = 10 * 1024 * 1024;
const AUDIO_PREVIEW_MAX: u64 = 10 * 1024 * 1024;
const PDF_PREVIEW_MAX: u64 = 20 * 1024 * 1024;
const FILE_UPLOAD_MAX: u64 = 25 * 1024 * 1024;

pub struct FileService {
    access: AccessService,
}

impl FileService {
    pub fn new(access: AccessService) -> Self {
        Self { access }
    }

    pub fn list(&self, directory: &str) -> AppResult<Vec<Value>> {
        let real_dir = self.access.assert_allowed(directory, true)?;
        let meta = fs::metadata(&real_dir)?;
        if !meta.is_dir() {
            return Err(AppError::fs("Not a directory"));
        }
        let mut entries = Vec::new();
        for dirent in fs::read_dir(&real_dir)? {
            let dirent = dirent?;
            let name = dirent.file_name().to_string_lossy().into_owned();
            let full = dirent.path();
            let is_directory = dirent
                .file_type()
                .map(|kind| kind.is_dir())
                .unwrap_or_else(|_| full.is_dir());
            entries.push(json!({
                "name": name,
                "path": full.to_string_lossy().replace('\\', "/"),
                "isDirectory": is_directory
            }));
        }
        entries.sort_by(|a, b| {
            let a_dir = a["isDirectory"].as_bool().unwrap_or(false);
            let b_dir = b["isDirectory"].as_bool().unwrap_or(false);
            match b_dir.cmp(&a_dir) {
                std::cmp::Ordering::Equal => a["name"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(b["name"].as_str().unwrap_or_default()),
                other => other,
            }
        });
        Ok(entries)
    }

    pub fn read_preview(&self, file_path: &str) -> AppResult<Value> {
        let real_path = self.access.assert_allowed(file_path, true)?;
        let meta = fs::metadata(&real_path)?;
        if !meta.is_file() {
            return Err(AppError::fs("Not a file"));
        }
        let name = Path::new(&real_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&real_path)
            .to_string();
        let size = meta.len();
        let ext = Path::new(&real_path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();

        if let Some(mime) = image_mime(&ext) {
            if size > IMAGE_PREVIEW_MAX {
                return Ok(
                    json!({ "kind": "binary", "path": real_path, "name": name, "size": size, "mime": mime }),
                );
            }
            let buf = fs::read(&real_path)?;
            return Ok(json!({
                "kind": "image",
                "path": real_path,
                "name": name,
                "size": size,
                "mime": mime,
                "base64": base64::engine::general_purpose::STANDARD.encode(buf)
            }));
        }
        if let Some(mime) = audio_mime(&ext) {
            if size > AUDIO_PREVIEW_MAX {
                return Ok(
                    json!({ "kind": "binary", "path": real_path, "name": name, "size": size, "mime": mime }),
                );
            }
            let buf = fs::read(&real_path)?;
            return Ok(json!({
                "kind": "audio",
                "path": real_path,
                "name": name,
                "size": size,
                "mime": mime,
                "base64": base64::engine::general_purpose::STANDARD.encode(buf)
            }));
        }
        if ext == "pdf" {
            if size > PDF_PREVIEW_MAX {
                return Ok(
                    json!({ "kind": "binary", "path": real_path, "name": name, "size": size, "mime": "application/pdf" }),
                );
            }
            let buf = fs::read(&real_path)?;
            return Ok(json!({
                "kind": "pdf",
                "path": real_path,
                "name": name,
                "size": size,
                "mime": "application/pdf",
                "base64": base64::engine::general_purpose::STANDARD.encode(buf)
            }));
        }

        if size > TEXT_PREVIEW_MAX {
            let text = read_prefix(&real_path, TEXT_PREVIEW_MAX)?;
            let kind = if looks_binary(text.as_bytes()) {
                "binary"
            } else {
                "text"
            };
            return Ok(json!({
                "kind": kind,
                "path": real_path,
                "name": name,
                "size": size,
                "language": language_for(&ext),
                "text": text,
                "truncated": true
            }));
        }

        let buf = fs::read(&real_path)?;
        if looks_binary(&buf) {
            return Ok(json!({ "kind": "binary", "path": real_path, "name": name, "size": size }));
        }
        Ok(json!({
            "kind": "text",
            "path": real_path,
            "name": name,
            "size": size,
            "language": language_for(&ext),
            "text": String::from_utf8_lossy(&buf),
            "revision": revision(&buf)
        }))
    }

    pub fn write_text(
        &self,
        file_path: &str,
        text: &str,
        expected_revision: &str,
        overwrite: bool,
    ) -> AppResult<Value> {
        let next = text.as_bytes();
        if next.len() as u64 > TEXT_EDIT_MAX {
            return Err(AppError::validation("Edited file exceeds 2 MB"));
        }
        let real_path = self.access.assert_writable(file_path, true)?;
        let meta = fs::symlink_metadata(&real_path)?;
        if meta.file_type().is_symlink() {
            return Err(AppError::validation("Refusing to edit a symbolic link"));
        }
        if !meta.is_file() {
            return Err(AppError::validation("Edit target is not a file"));
        }
        if meta.len() > TEXT_EDIT_MAX {
            return Err(AppError::validation("Edited file exceeds 2 MB"));
        }
        let current = fs::read(&real_path)?;
        if looks_binary(&current) {
            return Err(AppError::validation("Binary files cannot be edited"));
        }
        let current_revision = revision(&current);
        if !overwrite && current_revision != expected_revision {
            return Err(AppError::conflict(
                "File changed externally since it was opened",
            ));
        }
        persist::atomic_write(Path::new(&real_path), next)?;
        Ok(json!({
            "path": real_path,
            "size": next.len(),
            "revision": revision(next)
        }))
    }

    pub fn upload(
        &self,
        directory: &str,
        file_name: &str,
        data_base64: &str,
        overwrite: bool,
    ) -> AppResult<Value> {
        if file_name.is_empty()
            || file_name.len() > 255
            || file_name == "."
            || file_name == ".."
            || file_name.contains('/')
            || file_name.contains('\\')
            || file_name.contains('\0')
        {
            return Err(AppError::validation("Invalid upload file name"));
        }
        let real_dir = self.access.assert_writable(directory, true)?;
        let target = Path::new(&real_dir).join(file_name);
        let target_s = target.to_string_lossy().replace('\\', "/");
        self.access.assert_writable(&target_s, false)?;
        let buf = base64::engine::general_purpose::STANDARD
            .decode(data_base64)
            .map_err(|_| AppError::validation("Invalid upload payload"))?;
        if buf.len() as u64 > FILE_UPLOAD_MAX {
            return Err(AppError::validation("Upload exceeds 25 MB"));
        }
        fs::create_dir_all(&real_dir)?;
        if !overwrite {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            match options.open(&target) {
                Ok(mut file) => {
                    file.write_all(&buf)?;
                    return Ok(json!({ "path": target_s }));
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Err(AppError::validation("File already exists"));
                }
                Err(error) => return Err(error.into()),
            }
        }
        if let Ok(meta) = fs::symlink_metadata(&target) {
            if meta.file_type().is_symlink() {
                return Err(AppError::validation(
                    "Refusing to overwrite a symbolic link",
                ));
            }
        }
        persist::atomic_write(&target, &buf)?;
        Ok(json!({ "path": target_s }))
    }
}

fn looks_binary(buf: &[u8]) -> bool {
    buf.iter().take(8000).any(|byte| *byte == 0)
}

fn revision(buf: &[u8]) -> String {
    let digest = Sha256::digest(buf);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn read_prefix(path: &str, max: u64) -> AppResult<String> {
    let mut file = fs::File::open(path)?;
    let mut buf = vec![0u8; max as usize];
    let read = file.read(&mut buf)?;
    buf.truncate(read);
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn image_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

fn audio_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        _ => return None,
    })
}

fn language_for(ext: &str) -> &'static str {
    match ext {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" => "python",
        "rs" => "rust",
        "go" => "go",
        "json" | "jsonl" => "json",
        "md" | "mdx" => "markdown",
        "vue" => "html",
        _ => "plaintext",
    }
}
