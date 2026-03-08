interface StatusBadgeProps {
  status: "green" | "yellow" | "red" | "ok" | "delayed" | "stopped";
  label?: string;
}

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  green: { color: "var(--accent-green)", text: "HEALTHY" },
  yellow: { color: "var(--accent-yellow)", text: "WARNING" },
  red: { color: "var(--accent-red)", text: "DOWN" },
  ok: { color: "var(--accent-green)", text: "OK" },
  delayed: { color: "var(--accent-yellow)", text: "DELAYED" },
  stopped: { color: "var(--accent-red)", text: "STOPPED" },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = STATUS_MAP[status] || STATUS_MAP.red!;

  return (
    <span className="status-badge mono">
      <span
        className="status-dot"
        style={{ background: config.color }}
      />
      {label || config.text}
      <style>{`
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          letter-spacing: 0.1em;
          color: var(--text-secondary);
        }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
      `}</style>
    </span>
  );
}
