import { useEffect, useMemo, useState } from "react";
import { fetchTraffic, TrafficEntry } from "../lib/api";
import type { BackendProfile } from "../lib/config";
import type { CapabilityManifest } from "../lib/capabilities";

type Props = {
  profile: BackendProfile;
  capabilities: CapabilityManifest | null;
};

export function Dashboard({ profile, capabilities }: Props) {
  const [traffic, setTraffic] = useState<TrafficEntry[]>([]);

  const telemetryEndpoint = capabilities?.telemetry?.trafficEndpoint ?? "";

  useEffect(() => {
    if (!telemetryEndpoint) {
      setTraffic([]);
      return;
    }
    const load = () =>
      fetchTraffic(profile, telemetryEndpoint).then(setTraffic).catch(console.error);
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [profile, telemetryEndpoint]);

  const stats = useMemo(() => {
    const total = traffic.length;
    const errors = traffic.filter(t => t.error).length;
    const success = total - errors;
    const avgDuration = total > 0
      ? traffic.reduce((sum, t) => sum + t.duration, 0) / total / 1e6
      : 0;
    const recent = traffic.slice(-20).reverse();

    // Method call frequency
    const methodCounts = new Map<string, number>();
    traffic.forEach(t => {
      const key = `${t.service}/${t.method}`;
      methodCounts.set(key, (methodCounts.get(key) || 0) + 1);
    });
    const topMethods = Array.from(methodCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      service: capabilities?.service.name ?? "Inspector",
      env: capabilities?.service.environment ?? "local",
      methods: capabilities?.methods.length ?? 0,
      protocols: capabilities?.features.protocols.length ?? 0,
      totalCalls: total,
      successCalls: success,
      errorCalls: errors,
      errorRate: total > 0 ? ((errors / total) * 100).toFixed(1) : "0.0",
      avgDuration: avgDuration.toFixed(1),
      recentCalls: recent,
      topMethods
    };
  }, [capabilities, traffic]);

  if (!capabilities) {
    return (
      <div className="dashboard-empty">
        <div className="dashboard-empty__icon">📊</div>
        <div className="dashboard-empty__text">Connect to a backend to view dashboard metrics</div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="dashboard__header">
        <div>
          <h1 className="dashboard__title">{stats.service}</h1>
          <div className="dashboard__subtitle">
            <span className="dashboard__badge dashboard__badge--env">{stats.env}</span>
            <span className="dashboard__meta">
              {stats.protocols} {stats.protocols === 1 ? "protocol" : "protocols"} · {stats.methods} {stats.methods === 1 ? "method" : "methods"}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="dashboard__stats">
        <StatCard
          icon="🔧"
          label="Available Methods"
          value={stats.methods}
          color="blue"
        />
        <StatCard
          icon="📡"
          label="Total Calls"
          value={stats.totalCalls}
          color="purple"
          subtitle={stats.totalCalls > 0 ? `${stats.recentCalls.length} recent` : "No calls yet"}
        />
        <StatCard
          icon="✅"
          label="Success Rate"
          value={stats.totalCalls > 0 ? `${((stats.successCalls / stats.totalCalls) * 100).toFixed(1)}%` : "—"}
          color="green"
          subtitle={stats.totalCalls > 0 ? `${stats.successCalls} successful` : ""}
        />
        <StatCard
          icon="⚡"
          label="Avg Response Time"
          value={parseFloat(stats.avgDuration) > 0 ? `${stats.avgDuration} ms` : "—"}
          color="orange"
          subtitle={stats.totalCalls > 0 ? "Across all calls" : ""}
        />
        {stats.errorCalls > 0 && (
          <StatCard
            icon="❌"
            label="Errors"
            value={stats.errorCalls}
            color="red"
            subtitle={`${stats.errorRate}% error rate`}
          />
        )}
      </div>

      {/* Main Content Grid */}
      <div className="dashboard__grid">
        {/* Recent Activity */}
        <div className="dashboard__card">
          <div className="dashboard__card-header">
            <div>
              <div className="dashboard__label">Recent Activity</div>
              <p className="dashboard__description">Live feed of gRPC method invocations</p>
            </div>
            {telemetryEndpoint && (
              <span className="dashboard__badge dashboard__badge--live">
                <span className="dashboard__pulse"></span>
                Live
              </span>
            )}
          </div>
          {telemetryEndpoint ? (
            <div className="dashboard__activity">
              {stats.recentCalls.length > 0 ? (
                stats.recentCalls.map((t, idx) => (
                  <ActivityItem key={idx} entry={t} />
                ))
              ) : (
                <div className="dashboard__empty">
                  <span>⏳</span>
                  <div>Waiting for gRPC calls to arrive…</div>
                </div>
              )}
            </div>
          ) : (
            <div className="dashboard__empty">
              <span>📡</span>
              <div>Telemetry feed is not enabled for this console.</div>
            </div>
          )}
        </div>

        {/* Top Methods */}
        {stats.topMethods.length > 0 && (
          <div className="dashboard__card">
            <div className="dashboard__card-header">
              <div>
                <div className="dashboard__label">Most Called Methods</div>
                <p className="dashboard__description">Top 5 methods by invocation count</p>
              </div>
            </div>
            <div className="dashboard__methods">
              {stats.topMethods.map(([method, count], idx) => (
                <div key={method} className="dashboard__method-item">
                  <div className="dashboard__method-rank">#{idx + 1}</div>
                  <div className="dashboard__method-info">
                    <div className="dashboard__method-name">{method}</div>
                    <div className="dashboard__method-count">{count} {count === 1 ? "call" : "calls"}</div>
                  </div>
                  <div className="dashboard__method-bar">
                    <div
                      className="dashboard__method-bar-fill"
                      style={{ width: `${(count / stats.topMethods[0][1]) * 100}%` }}
                    />
                  </div>
            </div>
          ))}
            </div>
          </div>
        )}

        {/* Service Info */}
        <div className="dashboard__card">
          <div className="dashboard__card-header">
            <div>
              <div className="dashboard__label">Service Information</div>
              <p className="dashboard__description">Capabilities and features</p>
            </div>
          </div>
          <div className="dashboard__info">
            <InfoRow label="Service Name" value={stats.service} />
            <InfoRow label="Environment" value={stats.env} />
            <InfoRow label="Protocols" value={capabilities.features.protocols.join(", ")} />
            <InfoRow label="Invocation Support" value={capabilities.features.supportsInvocation ? "Enabled" : "Disabled"} />
            <InfoRow label="Traffic Feed" value={capabilities.features.trafficFeed ? "Enabled" : "Disabled"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtitle,
  color
}: {
  icon: string;
  label: string;
  value: string | number;
  subtitle?: string;
  color: "blue" | "purple" | "green" | "orange" | "red";
}) {
  return (
    <div className={`dashboard__stat-card dashboard__stat-card--${color}`}>
      <div className="dashboard__stat-icon">{icon}</div>
      <div className="dashboard__stat-content">
        <div className="dashboard__stat-label">{label}</div>
        <div className="dashboard__stat-value">{value}</div>
        {subtitle && <div className="dashboard__stat-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

function ActivityItem({ entry }: { entry: TrafficEntry }) {
  const formatTime = (iso?: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const duration = (entry.duration / 1e6).toFixed(1);
  const isError = !!entry.error;

  return (
    <div className={`dashboard__activity-item ${isError ? "dashboard__activity-item--error" : ""}`}>
      <div className="dashboard__activity-icon">
        {isError ? "❌" : "✓"}
      </div>
      <div className="dashboard__activity-content">
        <div className="dashboard__activity-method">
          {entry.service}/{entry.method}
        </div>
        <div className="dashboard__activity-meta">
          {formatTime(entry.startedAt?.toString())} · {duration} ms
        </div>
      </div>
      <div className={`dashboard__activity-status ${isError ? "dashboard__activity-status--error" : "dashboard__activity-status--success"}`}>
        {isError ? "Error" : "OK"}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard__info-row">
      <div className="dashboard__info-label">{label}</div>
      <div className="dashboard__info-value">{value}</div>
    </div>
  );
}
