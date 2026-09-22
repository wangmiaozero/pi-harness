//! Atomic JSON persistence matching Electron `services/storage.ts`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> AppResult<T> {
    match fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(T::default()),
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| AppError::fs(format!("Invalid JSON at {}: {error}", path.display()))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_vec_pretty(value).map_err(|error| {
        AppError::fs(format!("Failed to serialise {}: {error}", path.display()))
    })?;
    atomic_write(path, &payload)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(path);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })?;
    Ok(())
}

fn tmp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    path.with_file_name(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        Uuid::new_v4()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::env;

    #[derive(Default, Serialize, Deserialize, PartialEq, Debug)]
    struct Sample {
        n: u32,
    }

    #[test]
    fn round_trips_json_atomically() {
        let dir = env::temp_dir().join(format!("pi-persist-{}", Uuid::new_v4()));
        let path = dir.join("sample.json");
        write_json(&path, &Sample { n: 7 }).expect("write");
        let loaded: Sample = read_json(&path).expect("read");
        assert_eq!(loaded, Sample { n: 7 });
        let _ = fs::remove_dir_all(dir);
    }
}
