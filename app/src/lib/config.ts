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
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return defaultProfiles();
    return JSON.parse(raw);
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
  backendAddr: "localhost:9090",
  allowOrigins: "http://localhost:5173",
  useTLS: false,
  httpAddr: ":9000"  // ServiceLens proxy port (90XX range)
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
    { id: "local", name: "Local Dev", address: "http://localhost:9000" }
  ];
}
