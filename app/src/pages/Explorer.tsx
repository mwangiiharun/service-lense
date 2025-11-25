import { useEffect, useMemo, useState } from "react";
import type { CapabilityManifest, MethodDescriptor } from "../lib/capabilities";

type Props = {
  capabilities: CapabilityManifest | null;
  onMethodJump?: (methodId: string) => void;
};

export function Explorer({ capabilities, onMethodJump }: Props) {
  const methods = capabilities?.methods ?? [];
  const [selectedMethod, setSelectedMethod] = useState<MethodDescriptor | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (methods.length) {
      setSelectedMethod(methods[0]);
    } else {
      setSelectedMethod(null);
    }
  }, [methods]);

  const filteredMethods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return methods;
    return methods.filter(m => {
      const haystack = `${m.displayName} ${m.id} ${m.path}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [methods, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, MethodDescriptor[]>();
    filteredMethods.forEach(method => {
      const service = method.id.split("/")[0] || method.id;
      map.set(service, [...(map.get(service) || []), method]);
    });
    return Array.from(map.entries()).map(([service, methods]) => ({
      service,
      methods
    }));
  }, [filteredMethods]);

  const handleSelect = (method: MethodDescriptor) => {
    setSelectedMethod(method);
    if (onMethodJump) {
      onMethodJump(method.id);
    }
  };

  if (!capabilities) {
    return (
      <div className="p-4 text-sm text-muted">
        Connect to a console to discover available methods.
      </div>
    );
  }

  return (
    <div className="explorer">
      <div className="explorer__sidebar">
        <div className="explorer__sidebar-header">
          <div>
            <div className="explorer__label">Methods</div>
            <div className="explorer__count">{filteredMethods.length} total</div>
          </div>
          <input
            className="explorer__search"
            placeholder="Search services or methods…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="explorer__list">
          {grouped.map(group => (
            <div key={group.service} className="explorer__group">
              <div className="explorer__group-title">{group.service}</div>
              <div className="explorer__group-items">
                {group.methods.map(m => (
                  <button
                    key={m.id}
                    className={`explorer__method ${
                      selectedMethod?.id === m.id ? "explorer__method--active" : ""
              }`}
                    onClick={() => handleSelect(m)}
            >
                    <span>{m.displayName}</span>
                    <span className="explorer__method-path">{m.path}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {filteredMethods.length === 0 && (
            <div className="explorer__empty">No methods match your search.</div>
          )}
        </div>
      </div>
      <div className="explorer__details">
        {selectedMethod ? (
          <MethodDetails method={selectedMethod} />
        ) : (
          <div className="explorer__placeholder">Select a method to inspect its contract.</div>
        )}
      </div>
    </div>
  );
}

function MethodDetails({ method }: { method: MethodDescriptor }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="explorer__label">Identifier</div>
        <div className="font-mono">{method.id}</div>
      </div>
      <div className="explorer__detail-grid text-xs">
        <Info label="Protocol" value={method.protocol} />
        <Info label="Path" value={method.path} />
        <Info label="Request type" value={method.requestType || "n/a"} />
        <Info label="Response type" value={method.responseType || "n/a"} />
      </div>
      {method.examples && method.examples.length > 0 && (
        <div>
          <div className="explorer__label">Example</div>
          <pre className="bg-black/40 rounded p-3 text-xs overflow-auto max-h-64">
            {JSON.stringify(method.examples[0], null, 2)}
          </pre>
        </div>
      )}
      <div className="text-xs text-muted">
        {method.requiresAuth ? "Authentication required · " : ""}
        {method.supportsStreaming ? "Supports streaming" : "Unary"}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="explorer__detail-card">
      <div className="text-muted uppercase tracking-wide text-[10px]">{label}</div>
      <div className="font-semibold mt-1">{value}</div>
    </div>
  );
}
