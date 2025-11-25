export type CapabilityManifest = {
  version: string;
  updatedAt: string;
  service: ServiceDescriptor;
  features: FeatureDescriptor;
  methods: MethodDescriptor[];
  actions?: ActionDescriptor[];
  telemetry: TelemetryDescriptor;
  inspector: InspectorDescriptor;
};

export type ServiceDescriptor = {
  name: string;
  environment: string;
  description?: string;
  tags?: string[];
};

export type FeatureDescriptor = {
  supportsInvocation: boolean;
  protocols: string[];
  trafficFeed: boolean;
  metadataHeaders?: string[];
};

export type MethodDescriptor = {
  id: string;
  displayName: string;
  protocol: string;
  path: string;
  requestType?: string;
  responseType?: string;
  schema?: Record<string, unknown>;
  binaryFields?: string[]; // Field names that are bytes/binary
  examples?: Record<string, unknown>[];
  supportsStreaming: boolean;
  requiresAuth: boolean;
  tags?: string[];
};

export type ActionDescriptor = {
  id: string;
  label: string;
  type: string;
  payloadSchema?: Record<string, unknown>;
};

export type TelemetryDescriptor = {
  trafficEndpoint: string;
  stream: boolean;
  retentionSeconds: number;
};

export type InspectorDescriptor = {
  capabilitiesEndpoint: string;
  invokeEndpoint: string;
  healthEndpoint: string;
};

export async function fetchCapabilities(address: string): Promise<CapabilityManifest> {
  const base = address.replace(/\/$/, "");
  const res = await fetch(`${base}/inspector/capabilities`);
  if (!res.ok) {
    throw new Error(`Failed to load capabilities (${res.status})`);
  }
  return res.json();
}

