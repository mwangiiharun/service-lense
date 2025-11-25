import { invoke } from "@tauri-apps/api/core";
import { EnvSettings } from "./config";

export type BackendConfig = {
  backend_addr: string;
  http_addr: string;
  use_tls: boolean;
  allow_origins: string;
};

/**
 * Restart the Inspector backend with new configuration
 */
export async function restartBackend(config: EnvSettings): Promise<void> {
  const backendConfig: BackendConfig = {
    backend_addr: config.backendAddr,
    http_addr: config.httpAddr,
    use_tls: config.useTLS,
    allow_origins: config.allowOrigins,
  };
  
  await invoke("restart_backend", { config: backendConfig });
}

/**
 * Get the Inspector backend address (where the proxy is running)
 * This is typically http://localhost:8081
 */
export function getInspectorBackendAddress(): string {
  // The Inspector backend HTTP server runs on the HTTP_ADDR port
  // Default is :8081, which means localhost:8081
  return "http://localhost:8081";
}

