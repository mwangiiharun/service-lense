use std::path::Path;

fn main() {
    // Ensure binaries directory exists
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let binaries_dir = Path::new(&manifest_dir).join("binaries");
    
    // Create binaries directory if it doesn't exist
    if !binaries_dir.exists() {
        std::fs::create_dir_all(&binaries_dir).unwrap_or_else(|e| {
            eprintln!("Warning: Could not create binaries directory: {}", e);
        });
    }
    
    // Add platform-specific binary to resources if it exists
    let target = std::env::var("TARGET").unwrap();
    
    if target.contains("apple-darwin") {
        if target.contains("aarch64") {
            let binary_path = binaries_dir.join("backend-aarch64-apple-darwin");
            if binary_path.exists() {
                println!("cargo:rerun-if-changed={}", binary_path.display());
                println!("cargo:warning=Including backend-aarch64-apple-darwin in bundle");
            }
        } else if target.contains("x86_64") {
            let binary_path = binaries_dir.join("backend-x86_64-apple-darwin");
            if binary_path.exists() {
                println!("cargo:rerun-if-changed={}", binary_path.display());
                println!("cargo:warning=Including backend-x86_64-apple-darwin in bundle");
            }
        }
    } else if target.contains("windows") {
        if target.contains("aarch64") {
            let binary_path = binaries_dir.join("backend-aarch64-pc-windows-msvc.exe");
            if binary_path.exists() {
                println!("cargo:rerun-if-changed={}", binary_path.display());
                println!("cargo:warning=Including backend-aarch64-pc-windows-msvc.exe in bundle");
            }
        } else if target.contains("x86_64") {
            let binary_path = binaries_dir.join("backend-x86_64-pc-windows-msvc.exe");
            if binary_path.exists() {
                println!("cargo:rerun-if-changed={}", binary_path.display());
                println!("cargo:warning=Including backend-x86_64-pc-windows-msvc.exe in bundle");
            }
        }
    }
    
    tauri_build::build()
}
