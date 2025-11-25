import { useEffect, useMemo, useRef, useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Explorer } from "./pages/Explorer";
import { Traffic } from "./pages/Traffic";
import { Playground } from "./pages/Playground";
import { Settings } from "./pages/Settings";
import { BackendProfile, loadProfiles, saveProfiles } from "./lib/config";
import { CapabilityManifest, fetchCapabilities } from "./lib/capabilities";
import { ToastContainer } from "./components/ToastContainer";
import { showToast } from "./lib/toast";

type Tab = "dashboard" | "explorer" | "traffic" | "playground" | "settings";
type Theme = "light" | "dark";
type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

const NAV_ITEMS: { id: Tab; label: string; hint: string; emoji: string }[] = [
  { id: "dashboard", label: "Dashboard", hint: "Overview", emoji: "📊" },
  { id: "explorer", label: "Explorer", hint: "Schema browser", emoji: "🧭" },
  { id: "traffic", label: "Traffic", hint: "Captured calls", emoji: "📡" },
  { id: "playground", label: "Playground", hint: "Manual invokes", emoji: "🧪" },
  { id: "settings", label: "Settings", hint: "Profiles & storage", emoji: "⚙️" }
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [profiles, setProfiles] = useState<BackendProfile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string>("");
  const [targetAddress, setTargetAddress] = useState<string>("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string>("");
  const [lastConnectedAt, setLastConnectedAt] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityManifest | null>(null);

  // Keep refs in sync with state for background polling
  useEffect(() => {
    capabilitiesRef.current = capabilities;
  }, [capabilities]);

  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem("servicelens-theme") as Theme | null;
    if (stored) return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [playgroundMethod, setPlaygroundMethod] = useState<string | null>(null);
  const backgroundPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);
  const capabilitiesRef = useRef<CapabilityManifest | null>(null);
  const connectionStatusRef = useRef<ConnectionStatus>("idle");

  useEffect(() => {
    const p = loadProfiles();
    setProfiles(p);
    if (p.length > 0) {
      setCurrentProfileId(p[0].id);
      setTargetAddress(p[0].address);
    }
  }, []);

  const current = useMemo(
    () => profiles.find(p => p.id === currentProfileId) || profiles[0],
    [currentProfileId, profiles]
  );

  useEffect(() => {
    if (current) setTargetAddress(current.address);
  }, [current?.id, current?.address]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("servicelens-theme", theme);
    }
  }, [theme]);

  const profile =
    current || profiles[0] || { id: "none", name: "No profile", address: "http://localhost:8081" };
  const derivedProfile = { ...profile, address: targetAddress || profile.address };

  const persistAddress = () => {
    if (!current) return;
    if (current.address === targetAddress) return;
    const list = profiles.map(p =>
      p.id === current.id
        ? {
            ...p,
            address: targetAddress || p.address
          }
        : p
    );
    setProfiles(list);
    saveProfiles(list);
  };

  const handleConnect = async () => {
    if (!profile) return;
    persistAddress();
    setConnectionStatus("connecting");
    setConnectionMessage("");
    setCapabilities(null);
    try {
      const target = targetAddress || profile.address;
      const manifest = await fetchCapabilities(target);
      setCapabilities(manifest);
      setConnectionStatus("connected");
      const ts = new Date().toISOString();
      setLastConnectedAt(ts);
      const protocolSummary = manifest.features.protocols.join(", ");
      setConnectionMessage(
        `${manifest.service.name} (${manifest.service.environment}) · ${protocolSummary}`
      );
      showToast("success", `Connected to ${manifest.service.name}`);
      // Start background polling
      startBackgroundPolling(target);
    } catch (err: any) {
      setCapabilities(null);
      setConnectionStatus("error");
      const errorMsg = err?.message || "Failed to load capabilities";
      setConnectionMessage(errorMsg);
      showToast("error", `Connection failed: ${errorMsg}`);
      stopBackgroundPolling();
    }
  };

  // Background introspection polling - silent updates every 10 minutes
  const startBackgroundPolling = (address: string) => {
    stopBackgroundPolling(); // Clear any existing interval
    
    backgroundPollIntervalRef.current = setInterval(async () => {
      // Don't poll if already polling or if user is not connected
      if (isPollingRef.current || connectionStatusRef.current !== "connected") {
        return;
      }

      isPollingRef.current = true;
      try {
        const manifest = await fetchCapabilities(address);
        
        // Silently update capabilities if they've changed
        // Use ref to get current capabilities without closure issues
        const currentCapabilities = capabilitiesRef.current;
        const currentMethodCount = currentCapabilities?.methods.length ?? 0;
        const newMethodCount = manifest.methods.length;
        
        if (newMethodCount !== currentMethodCount) {
          setCapabilities(manifest);
          const diff = newMethodCount - currentMethodCount;
          if (diff > 0) {
            showToast("info", `Discovered ${diff} new ${diff === 1 ? "endpoint" : "endpoints"}`);
          }
          
          // Update connection message if service info changed
          const protocolSummary = manifest.features.protocols.join(", ");
          setConnectionMessage(
            `${manifest.service.name} (${manifest.service.environment}) · ${protocolSummary}`
          );
        } else {
          // Silently update capabilities even if count is same (in case of other changes)
          setCapabilities(manifest);
        }
      } catch (err) {
        // Silent failure - don't show toast or change status
        // Connection might be temporarily unavailable
        console.debug("Background introspection failed:", err);
      } finally {
        isPollingRef.current = false;
      }
    }, 10 * 60 * 1000); // 10 minutes
  };

  const stopBackgroundPolling = () => {
    if (backgroundPollIntervalRef.current) {
      clearInterval(backgroundPollIntervalRef.current);
      backgroundPollIntervalRef.current = null;
    }
    isPollingRef.current = false;
  };

  // Cleanup polling on unmount or when connection status changes
  useEffect(() => {
    if (connectionStatus === "connected" && targetAddress) {
      const address = targetAddress || derivedProfile.address;
      startBackgroundPolling(address);
    } else {
      stopBackgroundPolling();
    }
    
    return () => {
      stopBackgroundPolling();
    };
  }, [connectionStatus, targetAddress, derivedProfile.address]);

  const toggleTheme = () => setTheme(prev => (prev === "dark" ? "light" : "dark"));

  const openMethodInPlayground = (methodId: string) => {
    setPlaygroundMethod(methodId);
    setTab("playground");
  };

  const formatTimestamp = (value: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="app-shell">
      <ToastContainer />
      <aside className="sidebar">
        <div className="sidebar__logo">
          <span className="sidebar__logo-emblem">Service</span>
          <span className="sidebar__logo-text">Lens</span>
        </div>
        <nav className="sidebar__nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? "active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              <span className="nav-item__emoji">{item.emoji}</span>
              <div>
                <div className="nav-item__label">{item.label}</div>
                <div className="nav-item__hint">{item.hint}</div>
              </div>
            </button>
          ))}
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="connection-panel">
            <div className="connection-panel__group">
              <label className="connection-label">Target backend</label>
              <div className="connection-input-row">
          <select
            value={currentProfileId}
                  onChange={e => {
                    setCurrentProfileId(e.target.value);
                    setConnectionStatus("idle");
                    setConnectionMessage("");
                    setCapabilities(null);
                    setLastConnectedAt(null);
                  }}
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
                <input
                  value={targetAddress}
                  onChange={e => {
                    setTargetAddress(e.target.value);
                    setConnectionStatus("idle");
                    setConnectionMessage("");
                    setCapabilities(null);
                  }}
                  onBlur={persistAddress}
                  placeholder="http://localhost:8081"
                />
                <button
                  className="primary-btn"
                  onClick={handleConnect}
                  disabled={connectionStatus === "connecting"}
                >
                  {connectionStatus === "connected" ? "Reconnect" : "Connect"}
                </button>
              </div>
            </div>
            <div className="connection-panel__status">
              <span className={`status-pill status-${connectionStatus}`}>
                {connectionStatus === "idle" && "Idle"}
                {connectionStatus === "connecting" && "Connecting"}
                {connectionStatus === "connected" && "Connected"}
                {connectionStatus === "error" && "Failed"}
              </span>
              {connectionStatus === "connected" && (
                <span className="status-meta">Last introspection · {formatTimestamp(lastConnectedAt)}</span>
              )}
              {connectionMessage && connectionStatus !== "idle" && (
                <span
                  className={
                    connectionStatus === "error" ? "status-error-text" : "status-meta"
                  }
                >
                  {connectionMessage}
                </span>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <button className="ghost-btn" onClick={toggleTheme}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
        </div>
      </header>
        <main className="main-area">
          {tab === "dashboard" && (
            <Dashboard profile={derivedProfile} capabilities={capabilities} />
          )}
          {tab === "explorer" && (
            <Explorer capabilities={capabilities} onMethodJump={openMethodInPlayground} />
          )}
          {tab === "traffic" && (
            <Traffic profile={derivedProfile} capabilities={capabilities} />
          )}
          {tab === "playground" && (
            <Playground
              profile={derivedProfile}
              capabilities={capabilities}
              initialMethod={playgroundMethod}
              onMethodChange={setPlaygroundMethod}
            />
          )}
        {tab === "settings" && <Settings profiles={profiles} setProfiles={setProfiles} />}
      </main>
      <footer className="app-footer">
        <span className="app-footer__copyright">
          © Techbridge {new Date().getFullYear()}
        </span>
      </footer>
      </section>
    </div>
  );
}
