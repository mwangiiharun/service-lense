import { useEffect, useMemo, useState, useRef } from "react";
import { invokeMethod, InvokeRequest } from "../lib/api";
import type { BackendProfile, SavedRequest } from "../lib/config";
import { loadRequests, saveRequests } from "../lib/config";
import type { CapabilityManifest, MethodDescriptor } from "../lib/capabilities";

type Props = {
  profile: BackendProfile;
  capabilities: CapabilityManifest | null;
  initialMethod?: string | null;
  onMethodChange?: (methodId: string) => void;
};

export function Playground({ profile, capabilities, initialMethod, onMethodChange }: Props) {
  const [fullMethod, setFullMethod] = useState("");
  const [payload, setPayload] = useState('{"example": true}');
  const [metadata, setMetadata] = useState<{ key: string; value: string }[]>([]);
  const [response, setResponse] = useState<string>("");
  const [saved, setSaved] = useState<SavedRequest[]>([]);
  const [requestName, setRequestName] = useState("");
  const [methodSearch, setMethodSearch] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [fileUploads, setFileUploads] = useState<Record<string, File | null>>({});
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const methods = capabilities?.methods ?? [];

  const invokeEndpoint = capabilities?.inspector?.invokeEndpoint ?? "/invoke";

  useEffect(() => {
    setSaved(loadRequests());
  }, [profile]);

  useEffect(() => {
    if (initialMethod) return;
    if (methods.length && !fullMethod) {
      const next = methods[0];
      setFullMethod(next.id);
      onMethodChange?.(next.id);
    } else if (!methods.length) {
      setFullMethod("");
      setPayload("{}");
    }
  }, [methods, initialMethod, fullMethod, onMethodChange]);

  const selectedMethod = useMemo<MethodDescriptor | null>(() => {
    return methods.find(m => m.id === fullMethod) || null;
  }, [methods, fullMethod]);

  useEffect(() => {
    if (!initialMethod) return;
    if (initialMethod !== fullMethod) {
      const target = methods.find(m => m.id === initialMethod);
      if (target) {
        setFullMethod(initialMethod);
        onMethodChange?.(initialMethod);
      }
    }
  }, [initialMethod, fullMethod, methods, onMethodChange]);

  // Update payload when method changes
  useEffect(() => {
    if (fullMethod && selectedMethod) {
      if (selectedMethod.examples && selectedMethod.examples.length > 0) {
        setPayload(JSON.stringify(selectedMethod.examples[0], null, 2));
      } else {
        setPayload("{}");
      }
      // Clear file uploads when method changes
      setFileUploads({});
    }
  }, [fullMethod, selectedMethod]);

  const filteredMethods = useMemo(() => {
    const query = methodSearch.trim().toLowerCase();
    if (!query) {
      // Show first 15 methods when no search, prioritizing selected method
      const sorted = [...methods];
      if (fullMethod) {
        const selectedIdx = sorted.findIndex(m => m.id === fullMethod);
        if (selectedIdx > 0) {
          const [selected] = sorted.splice(selectedIdx, 1);
          sorted.unshift(selected);
        }
      }
      return sorted.slice(0, 15);
    }
    return methods.filter(m => {
      const haystack = `${m.displayName} ${m.id} ${m.path}`.toLowerCase();
      return haystack.includes(query);
    }).slice(0, 25); // Limit to 25 results
  }, [methods, methodSearch, fullMethod]);

  // Close autocomplete when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node)) {
        setShowAutocomplete(false);
        setHighlightedIndex(-1);
      }
    };

    if (showAutocomplete) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showAutocomplete]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && autocompleteRef.current) {
      const items = autocompleteRef.current.querySelectorAll('.playground__autocomplete-item');
      const item = items[highlightedIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [highlightedIndex]);

  const methodOptions = useMemo(() => {
    if (!fullMethod) return filteredMethods;
    const exists = filteredMethods.some(m => m.id === fullMethod);
    if (exists || !selectedMethod) return filteredMethods;
    return [selectedMethod, ...filteredMethods];
  }, [filteredMethods, fullMethod, selectedMethod]);

  const handleMethodChange = (methodId: string) => {
    setFullMethod(methodId);
    onMethodChange?.(methodId);
    setMethodSearch("");
    setShowAutocomplete(false);
    setHighlightedIndex(-1);
    const method = methods.find(m => m.id === methodId);
    if (method) {
      if (method.examples && method.examples.length > 0) {
        setPayload(JSON.stringify(method.examples[0], null, 2));
      } else {
        setPayload("{}");
      }
    }
  };

  const handleSearchChange = (value: string) => {
    setMethodSearch(value);
    setShowAutocomplete(true);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showAutocomplete || filteredMethods.length === 0) {
      if (e.key === "Escape") {
        setShowAutocomplete(false);
        setMethodSearch("");
        inputRef.current?.blur();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex(prev => 
        prev < filteredMethods.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredMethods.length) {
        handleMethodChange(filteredMethods[highlightedIndex].id);
      } else if (filteredMethods.length === 1) {
        handleMethodChange(filteredMethods[0].id);
      }
    } else if (e.key === "Escape") {
      setShowAutocomplete(false);
      setHighlightedIndex(-1);
      inputRef.current?.blur();
    }
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i}>{part}</mark>
      ) : (
        part
      )
    );
  };

  const handleFileChange = async (fieldPath: string, file: File | null) => {
    setFileUploads(prev => ({ ...prev, [fieldPath]: file }));
    
    if (file) {
      // Convert file to base64 and update payload
      try {
        const base64 = await fileToBase64(file);
        const json = JSON.parse(payload);
        setNestedField(json, fieldPath, base64);
        setPayload(JSON.stringify(json, null, 2));
      } catch (e: any) {
        setResponse("Error reading file: " + e.message);
      }
    } else {
      // Remove the field from payload
      const json = JSON.parse(payload);
      removeNestedField(json, fieldPath);
      setPayload(JSON.stringify(json, null, 2));
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix if present
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const setNestedField = (obj: any, path: string, value: any) => {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  };

  const removeNestedField = (obj: any, path: string) => {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) return;
      current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
  };

  const handleInvoke = async () => {
    if (!fullMethod) {
      setResponse("Error: Please select a method first");
      return;
    }
    setResponse("Invoking...");
    try {
      const json = JSON.parse(payload);
      
      // Process file uploads - convert to base64 if not already in payload
      for (const [fieldPath, file] of Object.entries(fileUploads)) {
        if (file) {
          const base64 = await fileToBase64(file);
          setNestedField(json, fieldPath, base64);
        }
      }
      
      const md: Record<string, string> = {};
      metadata.forEach(m => {
        if (m.key.trim()) md[m.key.trim()] = m.value;
      });
      const req: InvokeRequest = {
        fullMethod,
        payload: json,
        metadata: md
      };
      const res = await invokeMethod(profile, invokeEndpoint, req);
      setResponse(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setResponse("Error: " + e.message);
    }
  };

  const handleSave = () => {
    if (!fullMethod || !requestName.trim()) return;
    const md: Record<string, string> = {};
    metadata.forEach(m => {
      if (m.key.trim()) md[m.key.trim()] = m.value;
    });
    const next: SavedRequest = {
      id: Date.now().toString(),
      name: requestName.trim(),
      fullMethod,
      payload: JSON.parse(payload),
      metadata: md,
      profileId: profile.id
    };
    const list = [...saved, next];
    setSaved(list);
    saveRequests(list);
    setRequestName("");
  };

  const loadSaved = (req: SavedRequest) => {
    setFullMethod(req.fullMethod);
    setPayload(JSON.stringify(req.payload, null, 2));
    setMetadata(Object.entries(req.metadata || {}).map(([key, value]) => ({ key, value })));
  };

  if (!capabilities) {
    return (
      <div className="playground-empty">
        <div className="playground-empty__icon">🧪</div>
        <div className="playground-empty__text">Connect to a backend to start testing methods</div>
      </div>
    );
  }

  return (
    <div className="playground">
      <div className="playground__card">
        {/* Method Selection */}
        <div className="playground__section">
          <label className="playground__label">Select Method</label>
          <div className="playground__method-selector" ref={autocompleteRef}>
            <div className="playground__autocomplete">
              <div className="playground__autocomplete-input-wrapper">
                <span className="playground__autocomplete-icon">🔍</span>
                <input
                  ref={inputRef}
                  className="playground__input playground__input--autocomplete"
                  placeholder={selectedMethod ? selectedMethod.displayName : "Type to search methods…"}
                  value={methodSearch}
                  onChange={e => handleSearchChange(e.target.value)}
                  onFocus={() => setShowAutocomplete(true)}
                  onKeyDown={handleKeyDown}
                />
                {methodSearch && (
                  <button
                    className="playground__autocomplete-clear"
                    onClick={() => {
                      setMethodSearch("");
                      setShowAutocomplete(false);
                      inputRef.current?.focus();
                    }}
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
                <span className="playground__badge playground__badge--muted">
                  {filteredMethods.length}/{methods.length}
                </span>
              </div>
              {showAutocomplete && (
                <div className="playground__autocomplete-dropdown">
                  {filteredMethods.length > 0 ? (
                    <>
                      {methodSearch && (
                        <div className="playground__autocomplete-header">
                          <span>Found {filteredMethods.length} {filteredMethods.length === 1 ? "method" : "methods"}</span>
                          <span className="playground__autocomplete-hint">↑↓ to navigate • Enter to select • Esc to close</span>
                        </div>
                      )}
                      {filteredMethods.map((m, idx) => (
                        <button
                          key={m.id}
                          className={`playground__autocomplete-item ${
                            highlightedIndex === idx ? "playground__autocomplete-item--highlighted" : ""
                          } ${fullMethod === m.id ? "playground__autocomplete-item--selected" : ""}`}
                          onClick={() => handleMethodChange(m.id)}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                        >
                          <div className="playground__autocomplete-item-content">
                            <div className="playground__autocomplete-item-name">
                              {highlightMatch(m.displayName, methodSearch)}
                            </div>
                            <div className="playground__autocomplete-item-path">
                              {highlightMatch(m.path, methodSearch)}
                            </div>
                          </div>
                          <div className="playground__autocomplete-item-actions">
                            {m.protocol && (
                              <span className="playground__autocomplete-item-protocol">{m.protocol}</span>
                            )}
                            {fullMethod === m.id && (
                              <span className="playground__autocomplete-item-check">✓</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </>
                  ) : (
                    <div className="playground__autocomplete-empty">
                      {methodSearch ? (
                        <>
                          <span className="playground__autocomplete-empty-icon">🔍</span>
                          <div>No methods found matching "{methodSearch}"</div>
                          <div className="playground__autocomplete-empty-hint">Try a different search term</div>
                        </>
                      ) : (
                        <>
                          <span className="playground__autocomplete-empty-icon">📋</span>
                          <div>No methods available</div>
                          <div className="playground__autocomplete-empty-hint">Connect to a backend to see methods</div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {selectedMethod && !methodSearch && (
              <div className="playground__method-info">
                <span className="playground__badge">{selectedMethod.protocol}</span>
                <span className="playground__path">{selectedMethod.path}</span>
              </div>
            )}
          </div>
        </div>

        {/* File Uploads for Binary Fields */}
        {selectedMethod && selectedMethod.binaryFields && selectedMethod.binaryFields.length > 0 && (
          <div className="playground__section">
            <label className="playground__label">File Uploads (Binary Fields)</label>
            <div className="playground__file-uploads">
              {selectedMethod.binaryFields.map(fieldPath => (
                <div key={fieldPath} className="playground__file-upload-item">
                  <label className="playground__file-label">
                    <span className="playground__file-field-name">{fieldPath}</span>
                    <input
                      type="file"
                      className="playground__file-input"
                      onChange={e => handleFileChange(fieldPath, e.target.files?.[0] || null)}
                      accept="*/*"
                    />
                    <div className="playground__file-display">
                      {fileUploads[fieldPath] ? (
                        <div className="playground__file-info">
                          <span className="playground__file-name">{fileUploads[fieldPath]!.name}</span>
                          <span className="playground__file-size">
                            {(fileUploads[fieldPath]!.size / 1024).toFixed(2)} KB
                          </span>
                          <button
                            className="playground__file-remove"
                            onClick={() => handleFileChange(fieldPath, null)}
                            type="button"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="playground__file-placeholder">
                          <span>📎</span>
                          <span>Click to select file</span>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request JSON Editor */}
        <div className="playground__section">
          <div className="playground__section-header">
            <label className="playground__label">Request JSON</label>
            <div className="playground__save-group">
              <input
                className="playground__input playground__input--save"
                placeholder="Save as..."
                value={requestName}
                onChange={e => setRequestName(e.target.value)}
              />
              <button
                className="playground__btn playground__btn--secondary"
                onClick={handleSave}
                disabled={!requestName.trim() || !fullMethod}
              >
                💾 Save
              </button>
            </div>
          </div>
          <textarea
            className="playground__textarea"
            value={payload}
            onChange={e => setPayload(e.target.value)}
            placeholder='{"example": "json payload"}'
            spellCheck={false}
          />
        </div>

        {/* Metadata Headers */}
        <div className="playground__section">
          <label className="playground__label">Metadata Headers</label>
          <div className="playground__metadata-list">
            {metadata.map((m, idx) => (
              <div key={idx} className="playground__metadata-item">
                <input
                  className="playground__input"
                  placeholder="Header key (e.g., authorization)"
                  value={m.key}
                  onChange={e => {
                    const next = [...metadata];
                    next[idx] = { ...next[idx], key: e.target.value };
                    setMetadata(next);
                  }}
                />
                <input
                  className="playground__input"
                  placeholder="Header value"
                  value={m.value}
                  onChange={e => {
                    const next = [...metadata];
                    next[idx] = { ...next[idx], value: e.target.value };
                    setMetadata(next);
                  }}
                />
                <button
                  className="playground__btn playground__btn--danger"
                  onClick={() => {
                    const next = metadata.filter((_, i) => i !== idx);
                    setMetadata(next);
                  }}
                  title="Remove header"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="playground__btn playground__btn--ghost"
              onClick={() => setMetadata([...metadata, { key: "", value: "" }])}
            >
              + Add Header
            </button>
          </div>
        </div>

        {/* Invoke Button */}
        <div className="playground__action-bar">
          <button
            className="playground__btn playground__btn--primary"
            onClick={handleInvoke}
            disabled={!fullMethod}
          >
            {response === "Invoking..." ? (
              <>
                <span className="playground__spinner">⏳</span>
                Invoking...
              </>
            ) : (
              <>
                <span>🚀</span>
                Invoke Request
              </>
            )}
          </button>
        </div>
      </div>

      {/* Response Area */}
      <div className="playground__card playground__response">
        <div className="playground__response-header">
          <span className="playground__label">Response</span>
          {response && response !== "Invoking..." && !response.startsWith("Error:") && (
            <span className="playground__badge playground__badge--success">✓ Success</span>
          )}
          {response && response.startsWith("Error:") && (
            <span className="playground__badge playground__badge--error">✕ Error</span>
          )}
        </div>
        <pre className="playground__response-content">
          {response || (
            <span className="playground__placeholder">
              Response will appear here after invoking a method...
            </span>
          )}
        </pre>
      </div>

      {/* Saved Requests */}
      {saved.filter(r => r.profileId === profile.id).length > 0 && (
        <div className="playground__card playground__saved">
          <div className="playground__label">Saved Requests</div>
          <div className="playground__saved-list">
            {saved
              .filter(r => r.profileId === profile.id)
              .map(r => (
                <button
                  key={r.id}
                  className="playground__saved-item"
                  onClick={() => loadSaved(r)}
                  title={`Load: ${r.name}`}
                >
                  <span>📋</span>
                  {r.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
