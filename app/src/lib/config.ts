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
    
    // Migrate old port addresses to new default (9000)
    // Update any profiles that still use old ports (8081, 8082) to use 9000
    const migrated = profiles.map(profile => {
      if (profile.address && (profile.address.includes(':8081') || profile.address.includes(':8082'))) {
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
    return {
      backendAddr: parsed.backendAddr ?? defaultEnvSettings.backendAddr,
      allowOrigins: parsed.allowOrigins ?? defaultEnvSettings.allowOrigins,
      useTLS: parsed.useTLS ?? defaultEnvSettings.useTLS,
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
