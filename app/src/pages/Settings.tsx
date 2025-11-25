import { useState } from "react";
import {
  BackendProfile,
  loadProfiles,
  saveProfiles,
  EnvSettings,
  loadEnvSettings,
  saveEnvSettings
} from "../lib/config";
import { restartBackend } from "../lib/backend";

export function Settings({
  profiles,
  setProfiles,
}: {
  profiles: BackendProfile[];
  setProfiles: (p: BackendProfile[]) => void;
}) {
  const [local, setLocal] = useState<BackendProfile[]>(profiles);
  const [envSettings, setEnvSettings] = useState<EnvSettings>(() => loadEnvSettings());

  const addProfile = () => {
    const next: BackendProfile = {
      id: Date.now().toString(),
      name: "New Profile",
      address: "http://localhost:8082"
    };
    const list = [...local, next];
    setLocal(list);
    setProfiles(list);
    saveProfiles(list);
  };

  const updateProfile = (idx: number, patch: Partial<BackendProfile>) => {
    const list = [...local];
    list[idx] = { ...list[idx], ...patch };
    setLocal(list);
    setProfiles(list);
    saveProfiles(list);
  };

  const removeProfile = (idx: number) => {
    const list = [...local];
    list.splice(idx, 1);
    setLocal(list);
    setProfiles(list);
    saveProfiles(list);
  };

  const updateEnv = (patch: Partial<EnvSettings>) => {
    const next = { ...envSettings, ...patch };
    setEnvSettings(next);
    saveEnvSettings(next);
  };

  const handleRestartBackend = async () => {
    try {
      await restartBackend(envSettings);
      alert("Backend restarted with new settings");
    } catch (err: any) {
      alert(`Failed to restart backend: ${err.message}`);
    }
  };

  return (
    <div className="settings">
      <div className="settings__header">
        <div>
          <h2>Inspector Settings</h2>
          <p>Manage saved targets and how the local proxy talks to your console.</p>
        </div>
        <button className="settings__btn settings__btn--ghost" onClick={addProfile}>
            + Add profile
          </button>
        </div>

      <div className="settings__grid">
        <section className="settings__card">
          <div className="settings__section-heading">
            <div>
              <div className="settings__label">Backend Profiles</div>
              <p>Quickly switch between environments or consoles.</p>
            </div>
          </div>
          <div className="settings__profile-list">
          {local.map((p, idx) => (
              <div key={p.id} className="settings__profile-card">
                <div className="settings__profile-row">
                <input
                    className="settings__input"
                  value={p.name}
                  onChange={e => updateProfile(idx, { name: e.target.value })}
                    placeholder="Profile name"
                />
                <button
                    className="settings__btn settings__btn--danger"
                  onClick={() => removeProfile(idx)}
                >
                  Delete
                </button>
              </div>
              <input
                  className="settings__input"
                value={p.address}
                onChange={e => updateProfile(idx, { address: e.target.value })}
                  placeholder="http://localhost:8082"
              />
            </div>
          ))}
            {local.length === 0 && (
              <div className="settings__empty">No profiles yet. Add one to get started.</div>
            )}
          </div>
        </section>

        <section className="settings__card">
          <div className="settings__section-heading">
            <div>
              <div className="settings__label">Backend Environment</div>
              <p>Passed as env vars whenever the Go proxy restarts.</p>
            </div>
            <button className="settings__btn settings__btn--primary" onClick={handleRestartBackend}>
              Restart backend
            </button>
          </div>

          <div className="settings__form">
            <label>
              <span>GRPS_BACKEND_ADDR</span>
              <input
                className="settings__input"
                value={envSettings.backendAddr}
                onChange={e => updateEnv({ backendAddr: e.target.value })}
                placeholder="localhost:9090"
              />
            </label>
            <label>
              <span>GRPS_HTTP_ADDR</span>
              <input
                className="settings__input"
                value={envSettings.httpAddr}
                onChange={e => updateEnv({ httpAddr: e.target.value })}
                placeholder=":8082"
              />
            </label>
            <label>
              <span>GRPS_ALLOW_ORIGINS</span>
              <input
                className="settings__input"
                value={envSettings.allowOrigins}
                onChange={e => updateEnv({ allowOrigins: e.target.value })}
                placeholder="http://localhost:5173"
              />
            </label>
            <label className="settings__checkbox">
              <input
                type="checkbox"
                checked={envSettings.useTLS}
                onChange={e => updateEnv({ useTLS: e.target.checked })}
              />
              <span>GRPS_BACKEND_USE_TLS</span>
            </label>
          </div>

          <div className="settings__snippet">
            <div className="settings__label">Export snippet</div>
            <pre>
export GRPS_BACKEND_ADDR={envSettings.backendAddr}
export GRPS_ALLOW_ORIGINS={envSettings.allowOrigins}
export GRPS_BACKEND_USE_TLS={envSettings.useTLS ? "true" : "false"}
export GRPS_HTTP_ADDR={envSettings.httpAddr}
            </pre>
        </div>
        </section>
      </div>
    </div>
  );
}
