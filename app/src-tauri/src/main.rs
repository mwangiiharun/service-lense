#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::Manager;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackendConfig {
    backend_addr: String,
    http_addr: String,
    use_tls: bool,
    allow_origins: String,
}

struct BackendProcess {
    child: Option<Child>,
    config: Option<BackendConfig>,
}

impl BackendProcess {
    fn new() -> Self {
        Self { 
            child: None,
            config: None,
        }
    }

    fn start(&mut self, app: &tauri::AppHandle, config: Option<BackendConfig>) -> Result<(), Box<dyn std::error::Error>> {
        self.config = config.clone();
        let config = config.unwrap_or_else(|| BackendConfig {
            backend_addr: "localhost:9090".to_string(),
            http_addr: ":8081".to_string(),
            use_tls: false,
            allow_origins: "http://localhost:5173".to_string(),
        });
        if cfg!(debug_assertions) {
            // Development: run `go run` from the backend directory located at repo_root/backend.
            let backend_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or("Failed to resolve app directory")?
                .join("../backend");

            if !backend_dir.exists() {
                return Err("Backend directory does not exist".into());
            }

            let mut cmd = Command::new("go");
            cmd.args(&["run", "."]);
            cmd.current_dir(&backend_dir);
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());
            
            // Use config from UI or fall back to environment variables or defaults
            let backend_addr = std::env::var("GRPS_BACKEND_ADDR")
                .unwrap_or_else(|_| config.backend_addr.clone());
            let http_addr = std::env::var("GRPS_HTTP_ADDR")
                .unwrap_or_else(|_| config.http_addr.clone());
            let use_tls = std::env::var("GRPS_BACKEND_USE_TLS")
                .map(|v| v == "true")
                .unwrap_or(config.use_tls);
            let allow_origins = std::env::var("GRPS_ALLOW_ORIGINS")
                .unwrap_or_else(|_| config.allow_origins.clone());
            
            cmd.env("GRPS_BACKEND_ADDR", backend_addr);
            cmd.env("GRPS_HTTP_ADDR", http_addr);
            cmd.env("GRPS_BACKEND_USE_TLS", if use_tls { "true" } else { "false" });
            cmd.env("GRPS_ALLOW_ORIGINS", allow_origins);
            cmd.env("GRPS_AUTO_ALLOW_DEV_ORIGINS", "true");
            
            let child = cmd.spawn()?;
            self.child = Some(child);
            println!("Backend process started (dev mode: go run)");
        } else {
            // Production: use sidecar binary
            // Determine the correct binary name based on target architecture
            let target_arch = if cfg!(target_arch = "aarch64") {
                "aarch64"
            } else if cfg!(target_arch = "x86_64") {
                "x86_64"
            } else {
                return Err("Unsupported target architecture".into());
            };
            
            let binary_name = if cfg!(target_os = "windows") {
                format!("backend-{}-pc-windows-msvc.exe", target_arch)
            } else if cfg!(target_os = "macos") {
                format!("backend-{}-apple-darwin", target_arch)
            } else {
                return Err("Unsupported target OS".into());
            };
            
            // Look for binary - externalBin places binaries directly in resource_dir
            // When using externalBin: ["binaries/backend"], Tauri looks for "backend-${TARGET_TRIPLE}"
            // But we're building with full names like "backend-x86_64-apple-darwin"
            let resource_dir = app.path().resource_dir()?;
            
            // Try multiple possible locations:
            // 1. Directly in resource_dir (externalBin location) - Tauri might rename it
            // 2. In resource_dir/binaries (if using resources instead)
            // 3. Direct match with our binary name
            let mut backend_bin = resource_dir.join(&binary_name);
            
            if !backend_bin.exists() {
                // Try in binaries subdirectory
                backend_bin = resource_dir.join("binaries").join(&binary_name);
            }
            
            // Debug: log the paths we're checking
            eprintln!("Looking for backend binary:");
            eprintln!("  Binary name: {}", binary_name);
            eprintln!("  Resource dir: {:?}", resource_dir);
            eprintln!("  Checking path: {:?}", backend_bin);
            eprintln!("  Exists: {}", backend_bin.exists());
            
            // List contents of resource directory for debugging
            if resource_dir.exists() {
                eprintln!("  Resource directory exists, contents:");
                if let Ok(entries) = std::fs::read_dir(&resource_dir) {
                    for entry in entries.flatten() {
                        eprintln!("    - {:?}", entry.path());
                    }
                }
            }
            
            // List contents of binaries directory if it exists
            let binaries_dir = resource_dir.join("binaries");
            if binaries_dir.exists() {
                eprintln!("  Binaries directory exists, contents:");
                if let Ok(entries) = std::fs::read_dir(&binaries_dir) {
                    for entry in entries.flatten() {
                        eprintln!("    - {:?}", entry.path());
                    }
                }
            }
            
            if !backend_bin.exists() {
                return Err(format!("Backend binary not found at: {:?}. Resource dir: {:?}", backend_bin, resource_dir).into());
            }

            let mut cmd = Command::new(&backend_bin);
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());
            // Use config from UI or fall back to environment variables or defaults
            let backend_addr = std::env::var("GRPS_BACKEND_ADDR")
                .unwrap_or_else(|_| config.backend_addr.clone());
            let http_addr = std::env::var("GRPS_HTTP_ADDR")
                .unwrap_or_else(|_| config.http_addr.clone());
            let use_tls = std::env::var("GRPS_BACKEND_USE_TLS")
                .map(|v| v == "true")
                .unwrap_or(config.use_tls);
            let allow_origins = std::env::var("GRPS_ALLOW_ORIGINS")
                .unwrap_or_else(|_| config.allow_origins.clone());
            
            cmd.env("GRPS_BACKEND_ADDR", backend_addr);
            cmd.env("GRPS_HTTP_ADDR", http_addr);
            cmd.env("GRPS_BACKEND_USE_TLS", if use_tls { "true" } else { "false" });
            cmd.env("GRPS_ALLOW_ORIGINS", allow_origins);
            cmd.env("GRPS_AUTO_ALLOW_DEV_ORIGINS", "true");
            
            let child = cmd.spawn()?;
            self.child = Some(child);
            println!("Backend process started (production mode)");
        }
        
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            // Kill the process
            if let Err(e) = child.kill() {
                eprintln!("Failed to kill backend process: {}", e);
            }
            
            // Wait for process to exit
            let _ = child.wait();
            println!("Backend process stopped");
        }
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Start the Go backend with default config
            let mut backend = BackendProcess::new();
            match backend.start(app.handle(), None) {
                Ok(_) => {
                    // Store backend in app state
                    app.manage(Mutex::new(backend));
                }
                Err(e) => {
                    eprintln!("Failed to start backend: {}", e);
                    // In development, warn but continue (user might start backend manually)
                    // In production, this should be fatal
                    #[cfg(not(debug_assertions))]
                    {
                        return Err(Box::new(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            format!("Failed to start backend: {}", e)
                        )));
                    }
                }
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![restart_backend])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Get the backend process from app state and stop it
                if let Some(app) = window.app_handle().try_state::<Mutex<BackendProcess>>() {
                    if let Ok(mut backend) = app.lock() {
                        backend.stop();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn restart_backend(
    app: tauri::AppHandle,
    config: BackendConfig,
) -> Result<(), String> {
    if let Some(state) = app.try_state::<Mutex<BackendProcess>>() {
        let mut backend = state.lock().map_err(|e| format!("Failed to lock backend: {}", e))?;
        backend.stop();
        backend.start(&app, Some(config))
            .map_err(|e| format!("Failed to restart backend: {}", e))?;
        Ok(())
    } else {
        Err("Backend state not found".to_string())
    }
}
