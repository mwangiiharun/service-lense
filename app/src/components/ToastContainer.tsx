import { useEffect, useState } from "react";
import { toastManager, Toast } from "../lib/toast";
import "./ToastContainer.css";

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return toastManager.subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type}`}
          onClick={() => toastManager.remove(toast.id)}
        >
          <div className="toast__icon">
            {toast.type === "success" && "✓"}
            {toast.type === "error" && "✕"}
            {toast.type === "info" && "ℹ"}
          </div>
          <div className="toast__message">{toast.message}</div>
          <button className="toast__close" onClick={() => toastManager.remove(toast.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

