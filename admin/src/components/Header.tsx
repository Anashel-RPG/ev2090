import { useState, useEffect, useCallback } from "react";
import { Activity, BarChart3, Globe, Server, LogOut, Sun, Moon } from "lucide-react";
import type { Page } from "../types";

interface HeaderProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}

const NAV_ITEMS: { page: Page; label: string; icon: typeof Activity }[] = [
  { page: "economy", label: "ECONOMY", icon: BarChart3 },
  { page: "viewer", label: "VIEWER", icon: Globe },
  { page: "infra", label: "INFRA", icon: Server },
];

const THEME_KEY = "ev2090:adminTheme";

function getInitialTheme(): "dark" | "light" {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

export function Header({ currentPage, onNavigate, onLogout }: HeaderProps) {
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);

  // Apply theme to document root on mount and change
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-brand">
          <Activity size={16} className="header-logo" />
          <span className="header-title">EV 2090</span>
          <span className="header-tag mono">ADMIN</span>
          {import.meta.env.DEV && (
            <span className="header-tag header-tag-dev mono">LOCAL</span>
          )}
        </div>

        <nav className="header-nav">
          {NAV_ITEMS.map(({ page, label, icon: Icon }) => (
            <button
              key={page}
              className={`header-nav-btn mono ${currentPage === page || (currentPage === "region" && page === "economy") ? "active" : ""}`}
              onClick={() => onNavigate(page)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        <button
          className="header-nav-btn mono theme-btn"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {!import.meta.env.DEV && (
          <button className="header-nav-btn mono logout-btn" onClick={onLogout}>
            <LogOut size={14} />
            LOGOUT
          </button>
        )}
      </div>

      <style>{`
        .header {
          background: var(--bg-panel);
          border-bottom: 1px solid var(--border);
          padding: 0 24px;
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .header-inner {
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          height: 48px;
          gap: 24px;
        }
        .header-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-right: auto;
        }
        .header-logo {
          color: var(--accent-green);
        }
        .header-title {
          font-weight: 700;
          font-size: 15px;
          letter-spacing: 0.1em;
        }
        .header-tag {
          font-size: 9px;
          letter-spacing: 0.15em;
          color: var(--text-dim);
          border: 1px solid var(--border);
          padding: 1px 6px;
          border-radius: 3px;
        }
        .header-tag-dev {
          color: var(--accent-yellow, #f5c518);
          border-color: var(--accent-yellow, #f5c518);
        }
        .header-nav {
          display: flex;
          gap: 4px;
        }
        .header-nav-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          letter-spacing: 0.08em;
          padding: 6px 12px;
          border: none;
          background: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.15s;
        }
        .header-nav-btn:hover {
          color: var(--text-primary);
          background: var(--hover-bg);
        }
        .header-nav-btn.active {
          color: var(--accent-green);
          background: color-mix(in srgb, var(--accent-green) 6%, transparent);
        }
        .theme-btn {
          padding: 6px 8px;
          color: var(--text-dim);
        }
        .theme-btn:hover {
          color: var(--accent-yellow);
        }
        .logout-btn {
          color: var(--text-dim);
        }
        .logout-btn:hover {
          color: var(--accent-red);
        }
      `}</style>
    </header>
  );
}
