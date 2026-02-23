import { useState } from "react";
import "./CollapsibleSection.css";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  onReset?: () => void;
}

export function CollapsibleSection({ title, defaultOpen = false, children, onReset }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="config-section">
      <button
        className="config-section-header"
        onClick={() => setOpen(!open)}
      >
        <span className="config-section-arrow">{open ? "\u25BE" : "\u25B8"}</span>
        <span className="config-section-title">{title}</span>
        {onReset && (
          <span
            className="config-section-reset"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            title="Reset to defaults"
          >
            RESET
          </span>
        )}
      </button>
      {open && <div className="config-section-content">{children}</div>}
    </div>
  );
}
