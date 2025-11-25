import { useEffect, useState } from "react";
import { fetchTraffic, TrafficEntry } from "../lib/api";
import type { BackendProfile } from "../lib/config";
import type { CapabilityManifest } from "../lib/capabilities";

type Props = {
  profile: BackendProfile;
  capabilities: CapabilityManifest | null;
};

export function Traffic({ profile, capabilities }: Props) {
  const [traffic, setTraffic] = useState<TrafficEntry[]>([]);
  const [selected, setSelected] = useState<TrafficEntry | null>(null);

  const telemetryEndpoint = capabilities?.telemetry?.trafficEndpoint ?? "";

  useEffect(() => {
    if (!telemetryEndpoint) {
      setTraffic([]);
      setSelected(null);
      return;
    }
    const load = () =>
      fetchTraffic(profile, telemetryEndpoint).then(setTraffic).catch(console.error);
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [profile, telemetryEndpoint]);

  const formatDuration = (ns: number) => `${(ns / 1e6).toFixed(1)} ms`;
  const formatTimestamp = (iso?: string) => {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString();
  };

  return (
    <div className="traffic">
      <div className="traffic__sidebar">
        <div className="traffic__sidebar-header">
          <div>
            <div className="traffic__label">Live Traffic</div>
            <div className="traffic__count">{traffic.length} captured</div>
          </div>
          {!telemetryEndpoint && (
            <span className="traffic__badge">Telemetry disabled by console</span>
          )}
        </div>
        {telemetryEndpoint ? (
          <div className="traffic__list">
            {traffic
              .slice()
              .reverse()
              .map((t, idx) => {
                const isActive = selected === t;
                return (
                  <button
              key={idx}
                    className={`traffic__item ${isActive ? "traffic__item--active" : ""}`}
              onClick={() => setSelected(t)}
            >
                    <div>
                      <div className="traffic__method">
                        {t.service}/{t.method}
                      </div>
                      <div className="traffic__meta">
                        <span>{formatTimestamp(t.startedAt?.toString())}</span>
                        <span>·</span>
                        <span>{formatDuration(t.duration)}</span>
                      </div>
                    </div>
                    <span
                      className={`traffic__status ${
                        t.error ? "traffic__status--error" : "traffic__status--ok"
                      }`}
                    >
                      {t.error ? "Error" : "OK"}
                    </span>
                  </button>
                );
              })}
            {traffic.length === 0 && (
              <div className="traffic__empty">Waiting for gRPC calls to arrive…</div>
            )}
            </div>
        ) : (
          <div className="traffic__empty">
            This console has not enabled the `/traffic` endpoint.
        </div>
        )}
      </div>
      <div className="traffic__details">
        {selected ? (
          <div className="traffic__details-card">
            <div className="traffic__details-header">
              <div>
                <div className="traffic__method">
              {selected.service}/{selected.method}
            </div>
                <div className="traffic__meta">
                  {formatTimestamp(selected.startedAt?.toString())} · {formatDuration(selected.duration)}
                </div>
              </div>
              <span
                className={`traffic__status ${
                  selected.error ? "traffic__status--error" : "traffic__status--ok"
                }`}
              >
                {selected.error ? selected.error : "Success"}
              </span>
            </div>
            <div className="traffic__payloads">
              <div className="traffic__payload-card">
                <div className="traffic__payload-label">Request</div>
                <pre>{JSON.stringify(selected.request, null, 2)}</pre>
              </div>
              <div className="traffic__payload-card">
                <div className="traffic__payload-label">Response</div>
                <pre>{JSON.stringify(selected.response, null, 2)}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="traffic__placeholder">Select a call to inspect request/response payloads.</div>
        )}
      </div>
    </div>
  );
}
