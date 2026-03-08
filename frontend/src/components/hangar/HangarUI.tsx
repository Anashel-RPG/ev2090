/**
 * HangarUI — shared Button and Panel primitives for the hangar overlay.
 * Ported from ui-demo/hangar/src/components/UI.tsx (Tailwind removed).
 */

import type { ComponentProps } from "react";
import { motion } from "motion/react";

/* ─── Button ─── */

interface ButtonProps extends ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

const BTN_BASE: React.CSSProperties = {
  fontFamily: '"Share Tech Mono", monospace',
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  border: "none",
  position: "relative",
  transition: "box-shadow 0.15s, opacity 0.15s",
  flexShrink: 0,
};

const BTN_VARIANTS: Record<string, React.CSSProperties> = {
  primary: {
    color: "#fff",
    background: "linear-gradient(180deg, #c49a1a 0%, #9a7810 100%)",
    border: "1px solid rgba(240,180,41,0.45)",
    boxShadow: "0 0 14px rgba(240,180,41,0.3), inset 0 1px 0 rgba(255,220,100,0.18)",
  },
  secondary: {
    color: "rgba(200,216,232,0.65)",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  danger: {
    color: "#fff",
    background: "linear-gradient(180deg, #cc1a1a 0%, #991010 100%)",
    border: "1px solid rgba(255,50,50,0.4)",
    boxShadow: "0 0 12px rgba(200,0,0,0.35), inset 0 1px 0 rgba(255,100,100,0.18)",
  },
  ghost: {
    color: "rgba(0,200,255,0.55)",
    background: "transparent",
    border: "1px solid transparent",
  },
};

const BTN_SIZES: Record<string, React.CSSProperties> = {
  sm: { fontSize: "9px", padding: "5px 12px" },
  md: { fontSize: "10px", padding: "7px 16px" },
  lg: { fontSize: "11px", padding: "10px 24px" },
};

export function HangarButton({
  variant = "primary",
  size = "md",
  children,
  style,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileHover={disabled ? {} : { scale: 1.01 }}
      whileTap={disabled ? {} : { scale: 0.97 }}
      className={className}
      style={{
        ...BTN_BASE,
        ...BTN_VARIANTS[variant],
        ...BTN_SIZES[size],
        ...(disabled ? { opacity: 0.35, cursor: "not-allowed" } : {}),
        ...style,
      }}
      disabled={disabled}
      {...(props as any)}
    >
      {children}
    </motion.button>
  );
}

/* ─── Panel ─── */

interface PanelProps extends ComponentProps<"div"> {
  title?: string;
  noPadding?: boolean;
}

export function HangarPanel({
  title,
  children,
  noPadding = false,
  style,
  className,
  ...props
}: PanelProps) {
  return (
    <div
      className={className}
      style={{
        background: "rgba(4, 10, 22, 0.82)",
        backdropFilter: "blur(16px) saturate(110%)",
        WebkitBackdropFilter: "blur(16px) saturate(110%)",
        border: "1px solid rgba(255,255,255,0.055)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...style,
      }}
      {...props}
    >
      {title && (
        <div
          style={{
            background: "rgba(0,0,0,0.35)",
            borderBottom: "1px solid rgba(0,200,255,0.07)",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: '"Share Tech Mono", monospace',
              fontSize: "9px",
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              color: "rgba(0,200,255,0.45)",
            }}
          >
            {title}
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(0,200,255,0.35)" }} />
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(0,200,255,0.12)" }} />
          </div>
        </div>
      )}
      <div style={{ flex: 1, position: "relative", ...(noPadding ? {} : { padding: "16px" }) }}>
        {children}
      </div>
    </div>
  );
}
