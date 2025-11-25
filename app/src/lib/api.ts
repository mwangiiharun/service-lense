import { BackendProfile } from "./config";

export type TrafficEntry = {
  service: string;
  method: string;
  metadata: Record<string, string[]>;
  request: any;
  response: any;
  error?: string;
  startedAt: string;
  duration: number;
};

export type InvokeRequest = {
  fullMethod: string;
  metadata?: Record<string, string>;
  payload: any;
};

function baseUrl(profile: BackendProfile): string {
  return profile.address.replace(/\/$/, "");
}

function normalizePath(endpoint: string): string {
  if (!endpoint) return "";
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

export async function fetchTraffic(
  profile: BackendProfile,
  telemetryEndpoint: string
): Promise<TrafficEntry[]> {
  if (!telemetryEndpoint) return [];
  const res = await fetch(`${baseUrl(profile)}${normalizePath(telemetryEndpoint)}`);
  if (!res.ok) throw new Error("Failed to load traffic");
  return res.json();
}

export async function invokeMethod(
  profile: BackendProfile,
  endpoint: string,
  req: InvokeRequest
): Promise<any> {
  const path = normalizePath(endpoint || "/invoke");
  const res = await fetch(`${baseUrl(profile)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req)
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      const message =
        data?.error?.message ||
        data?.message ||
        (typeof data === "string" ? data : undefined) ||
        text;
      throw new Error(message || "Invoke failed");
    } catch {
      throw new Error(text || "Invoke failed");
    }
  }
  return res.json();
}
