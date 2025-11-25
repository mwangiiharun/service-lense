#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::Manager;
use serde::{Deserialize, Serialize};

// Helper function to extract port number from address string like ":9000" or "localhost:9000"
fn extract_port(addr: &str) -> Option<u16> {
    addr.split(':').last()
        .and_then(|p| p.parse::<u16>().ok())
}

// Kill any process using the specified port
fn kill_process_on_port(port: u16) {
    #[cfg(unix)]
    {
        use std::process::Command;
        // Try to find and kill process using the port
        if let Ok(output) = Command::new("lsof")
            .args(&["-ti", &format!(":{}", port)])
            .output()
        {
            if !output.stdout.is_empty() {
                if let Ok(pid_str) = String::from_utf8(output.stdout) {
                    for pid in pid_str.trim().split('\n') {
                        if let Ok(pid_num) = pid.trim().parse::<i32>() {
                            let _ = Command::new("kill")
                                .args(&["-9", &pid_num.to_string()])
                                .output();
                            eprintln!("Killed process {} on port {}", pid_num, port);
                        }
                    }
                }
            }
        }
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        // Windows: use netstat and taskkill
        if let Ok(output) = Command::new("netstat")
            .args(&["-ano"])
            .output()
        {
            // Parse netstat output to find PID and kill it
            // Implementation would parse the output here
        }
    }
}

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
        // Stop any existing backend first
        self.stop();
        
        self.config = config.clone();
        let config = config.unwrap_or_else(|| BackendConfig {
            backend_addr: "localhost:8081".to_string(),  // Target gRPC backend to inspect
            http_addr: ":9000".to_string(),  // ServiceLens proxy port (90XX range) - where frontend connects
            use_tls: false,
            allow_origins: "http://localhost:5173".to_string(),
        });
        
        // Kill any process already using the HTTP port BEFORE starting
        if let Some(port) = extract_port(&config.http_addr) {
            eprintln!("Checking for processes on port {}...", port);
            kill_process_on_port(port);
            // Give it a moment to release the port
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        
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
            // In dev mode, show backend output in console for debugging
            cmd.stdout(std::process::Stdio::inherit());
            cmd.stderr(std::process::Stdio::inherit());
            
            // Use config from UI (if provided) or fall back to environment variables or defaults
            // Priority: config > environment variable > default
            let backend_addr = config.backend_addr.clone();
            let http_addr = config.http_addr.clone();
            let use_tls = config.use_tls; // Use config value directly, don't check env var first
            let allow_origins = config.allow_origins.clone();
            
            // Debug: log the environment variables being set (before moving values)
            eprintln!("Starting backend (dev mode) with env vars:");
            eprintln!("  GRPS_BACKEND_ADDR={}", backend_addr);
            eprintln!("  GRPS_HTTP_ADDR={}", http_addr);
            eprintln!("  GRPS_BACKEND_USE_TLS={}", if use_tls { "true" } else { "false" });
            eprintln!("  GRPS_ALLOW_ORIGINS={}", allow_origins);
            
            cmd.env("GRPS_BACKEND_ADDR", backend_addr);
            cmd.env("GRPS_HTTP_ADDR", http_addr);
            // Set TLS as "true" or "false" string (envBool accepts "true"/"false" strings)
            cmd.env("GRPS_BACKEND_USE_TLS", if use_tls { "true" } else { "false" });
            cmd.env("GRPS_ALLOW_ORIGINS", allow_origins);
            cmd.env("GRPS_AUTO_ALLOW_DEV_ORIGINS", "true");
            
            let child = cmd.spawn()?;
            self.child = Some(child);
            println!("Backend process started (dev mode: go run)");
            
            // Give the backend a moment to start, then check if it's still running
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Some(ref mut child) = self.child {
                if let Ok(Some(status)) = child.try_wait() {
                    eprintln!("Backend process exited immediately with status: {:?}", status);
                    return Err("Backend process failed to start".into());
                }
            }
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
            
            // Look for binary - externalBin places binaries in the same directory as the executable
            // On macOS, this is Contents/MacOS/, and Tauri renames it to just "backend"
            // Try multiple locations in order of preference
            
            let mut backend_bin = None;
            
            // 1. Try executable_dir (where externalBin binaries are placed)
            if let Ok(exe_dir) = app.path().executable_dir() {
                let path = exe_dir.join("backend");
                eprintln!("Checking executable_dir: {:?} (exists: {})", path, path.exists());
                if path.exists() {
                    backend_bin = Some(path);
                }
            }
            
            // 2. Try resource_dir/binaries (fallback for resources approach)
            if backend_bin.is_none() {
                if let Ok(resource_dir) = app.path().resource_dir() {
                    let path = resource_dir.join("binaries").join(&binary_name);
                    eprintln!("Checking resource_dir/binaries: {:?} (exists: {})", path, path.exists());
                    if path.exists() {
                        backend_bin = Some(path);
                    }
                }
            }
            
            // 3. Try resource_dir directly (another fallback)
            if backend_bin.is_none() {
                if let Ok(resource_dir) = app.path().resource_dir() {
                    let path = resource_dir.join(&binary_name);
                    eprintln!("Checking resource_dir: {:?} (exists: {})", path, path.exists());
                    if path.exists() {
                        backend_bin = Some(path);
                    }
                }
            }
            
            // Debug: log all paths we checked
            eprintln!("Looking for backend binary:");
            eprintln!("  Expected name: {}", binary_name);
            
            if let Ok(exe_dir) = app.path().executable_dir() {
                eprintln!("  Executable dir: {:?}", exe_dir);
                if exe_dir.exists() {
                    eprintln!("  Executable dir contents:");
                    if let Ok(entries) = std::fs::read_dir(&exe_dir) {
                        for entry in entries.flatten() {
                            eprintln!("    - {:?}", entry.path());
                        }
                    }
                }
            }
            
            if let Ok(resource_dir) = app.path().resource_dir() {
                eprintln!("  Resource dir: {:?}", resource_dir);
                if resource_dir.exists() {
                    eprintln!("  Resource dir contents:");
                    if let Ok(entries) = std::fs::read_dir(&resource_dir) {
                        for entry in entries.flatten() {
                            eprintln!("    - {:?}", entry.path());
                        }
                    }
                }
            }
            
            let backend_bin = backend_bin.ok_or_else(|| {
                format!("Backend binary not found. Checked executable_dir and resource_dir locations.")
            })?;
            
            eprintln!("  Found backend binary at: {:?}", backend_bin);

            let mut cmd = Command::new(&backend_bin);
            // In production, we can still inherit stderr to see errors in console/logs
            // stdout can be piped to avoid cluttering, but stderr is important for debugging
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::inherit()); // Show backend errors in console
            // Use config from UI (if provided) or fall back to environment variables or defaults
            // Priority: config > environment variable > default
            let backend_addr = config.backend_addr.clone();
            let http_addr = config.http_addr.clone();
            let use_tls = config.use_tls; // Use config value directly, don't check env var first
            let allow_origins = config.allow_origins.clone();
            
            // Debug: log the environment variables being set (before moving values)
            eprintln!("Starting backend with env vars:");
            eprintln!("  GRPS_BACKEND_ADDR={}", backend_addr);
            eprintln!("  GRPS_HTTP_ADDR={}", http_addr);
            eprintln!("  GRPS_BACKEND_USE_TLS={}", if use_tls { "true" } else { "false" });
            eprintln!("  GRPS_ALLOW_ORIGINS={}", allow_origins);
            
            cmd.env("GRPS_BACKEND_ADDR", backend_addr);
            cmd.env("GRPS_HTTP_ADDR", http_addr);
            // Set TLS as "true" or "false" string (envBool accepts "true"/"false" strings)
            cmd.env("GRPS_BACKEND_USE_TLS", if use_tls { "true" } else { "false" });
            cmd.env("GRPS_ALLOW_ORIGINS", allow_origins);
            cmd.env("GRPS_AUTO_ALLOW_DEV_ORIGINS", "true");
            
            let child = cmd.spawn()?;
            self.child = Some(child);
            println!("Backend process started (production mode)");
            
            // Give the backend a moment to start, then check if it's still running
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Some(ref mut child) = self.child {
                if let Ok(Some(status)) = child.try_wait() {
                    eprintln!("Backend process exited immediately with status: {:?}", status);
                    // Try to read stderr to see what went wrong
                    return Err("Backend process failed to start. Check console logs for details.".into());
                }
            }
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
    // Debug: log the config being passed
    eprintln!("Restarting backend with config:");
    eprintln!("  backend_addr: {}", config.backend_addr);
    eprintln!("  http_addr: {}", config.http_addr);
    eprintln!("  use_tls: {}", config.use_tls);
    eprintln!("  allow_origins: {}", config.allow_origins);
    
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
