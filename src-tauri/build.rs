fn main() {
    let _ = std::fs::create_dir_all("resources/runtime");
    let _ = std::fs::create_dir_all("resources/runtime-node");
    tauri_build::build()
}
