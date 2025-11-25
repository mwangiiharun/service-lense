export type BackendProfile = {
  id: string;
  name: string;
  address: string; // host:port of the gRPC backend
};

export type SavedRequest = {
  id: string;
  name: string;
  fullMethod: string;
  payload: any;
  metadata: Record<string, string>;
  profileId: string;
};

const PROFILES_KEY = "servicelens_profiles";
const REQUESTS_KEY = "servicelens_requests";
const ENV_SETTINGS_KEY = "servicelens_env_settings";

export function loadProfiles(): BackendProfile[] {
  if (typeof localStorage === "undefined") return defaultProfiles();
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return defaultProfiles();
    const parsed = JSON.parse(raw);
    const profiles = Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultProfiles();
    
    // Migrate old port addresses to new default (8081)
    // Update any profiles that still use old ports (9000, 8082) to use 8081
    const migrated = profiles.map(profile => {
      if (profile.address && (profile.address.includes(':9000') || profile.address.includes(':8082'))) {
        return {
          ...profile,
          address: profile.address.replace(/:9000|:8082/, ':8081')
        };
      }
      return profile;
    });
    
    // Save migrated profiles if any were changed
    if (JSON.stringify(profiles) !== JSON.stringify(migrated)) {
      saveProfiles(migrated);
    }
    
    return migrated;
  } catch {
    return defaultProfiles();
  }
}

export function saveProfiles(profiles: BackendProfile[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function loadRequests(): SavedRequest[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(REQUESTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveRequests(requests: SavedRequest[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
}

export type EnvSettings = {
  backendAddr: string;
  allowOrigins: string;
  useTLS: boolean;
  httpAddr: string;
};

const defaultEnvSettings: EnvSettings = {
  backendAddr: "localhost:9090",  // Console gRPC server (where inspector backend connects TO)
  allowOrigins: "http://localhost:5173",
  useTLS: false,
  httpAddr: ":8081"  // Inspector backend HTTP server (where UI connects)
};

export function loadEnvSettings(): EnvSettings {
  if (typeof localStorage === "undefined") return defaultEnvSettings;
  try {
    const raw = localStorage.getItem(ENV_SETTINGS_KEY);
    if (!raw) return defaultEnvSettings;
    const parsed = JSON.parse(raw);
    
    // Normalize and validate settings
    let backendAddr = (parsed.backendAddr ?? defaultEnvSettings.backendAddr).trim();
    // Remove http:// or https:// prefix if present
    backendAddr = backendAddr.replace(/^https?:\/\//, "");
    // Ensure lowercase
    backendAddr = backendAddr.toLowerCase();
    
    // Ensure useTLS is a boolean (handle string "true"/"false" from old saves)
    // Default to false if not set or invalid
    let useTLS = false;
    if (parsed.useTLS !== undefined && parsed.useTLS !== null) {
      if (typeof parsed.useTLS === "boolean") {
        useTLS = parsed.useTLS;
      } else if (typeof parsed.useTLS === "string") {
        useTLS = parsed.useTLS.toLowerCase() === "true";
      } else if (typeof parsed.useTLS === "number") {
        useTLS = parsed.useTLS !== 0;
      }
    }
    
    return {
      backendAddr: backendAddr || defaultEnvSettings.backendAddr,
      allowOrigins: parsed.allowOrigins ?? defaultEnvSettings.allowOrigins,
      useTLS: useTLS,
      httpAddr: parsed.httpAddr ?? defaultEnvSettings.httpAddr
    };
  } catch {
    return defaultEnvSettings;
  }
}

export function saveEnvSettings(settings: EnvSettings) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENV_SETTINGS_KEY, JSON.stringify(settings));
}

function defaultProfiles(): BackendProfile[] {
  return [
    { id: "local", name: "Local Dev", address: "http://localhost:8081" } // Inspector backend HTTP server address
  ];
}
