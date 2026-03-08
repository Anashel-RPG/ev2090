import { useState, useCallback } from "react";
import { api } from "../api";

interface AuthGateProps {
  onAuthenticated: () => void;
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!key.trim()) return;

      setLoading(true);
      setError("");
      api.setApiKey(key.trim());

      const ok = await api.testConnection();
      if (ok) {
        onAuthenticated();
      } else {
        setError("Invalid API key or server unreachable");
        api.clearApiKey();
      }
      setLoading(false);
    },
    [key, onAuthenticated],
  );

  return (
    <div className="auth-gate">
      <div className="auth-card panel">
        <div className="auth-title">EV 2090</div>
        <div className="auth-subtitle mono">ADMIN CONSOLE</div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="API KEY"
            autoFocus
            className="auth-input"
          />
          <button
            type="submit"
            className="btn btn-primary auth-btn"
            disabled={loading || !key.trim()}
          >
            {loading ? "CONNECTING..." : "CONNECT"}
          </button>
        </form>

        {error && <div className="auth-error mono">{error}</div>}
      </div>

      <style>{`
        .auth-gate {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .auth-card {
          width: 340px;
          text-align: center;
          padding: 40px 32px;
        }
        .auth-title {
          font-family: var(--font-sans);
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.15em;
          color: var(--text-primary);
          margin-bottom: 4px;
        }
        .auth-subtitle {
          font-size: 11px;
          letter-spacing: 0.2em;
          color: var(--text-dim);
          margin-bottom: 32px;
        }
        .auth-input {
          width: 100%;
          padding: 10px 14px;
          font-size: 14px;
          text-align: center;
          letter-spacing: 0.15em;
          margin-bottom: 14px;
        }
        .auth-btn {
          width: 100%;
          padding: 10px;
          font-size: 13px;
        }
        .auth-error {
          margin-top: 14px;
          font-size: 11px;
          color: var(--accent-red);
        }
      `}</style>
    </div>
  );
}
