/**
 * LockedPanel — placeholder for locked station facilities.
 *
 * Two variants:
 *   1. "Coming soon" — feature not yet built (no CTA)
 *   2. "Account required" — feature exists but needs login (with CTA button)
 */
import { motion } from 'motion/react';
import { Lock, LogIn } from 'lucide-react';

interface LockedPanelProps {
  label: string;
  /** If provided, shows an account-gating CTA instead of "coming soon" */
  reason?: string;
  /** Callback when the CTA button is clicked (e.g., open login screen) */
  onAction?: () => void;
}

export const LockedPanel = ({ label, reason, onAction }: LockedPanelProps) => (
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '14px' }}
  >
    <Lock size={28} color={reason ? "rgba(0,200,255,0.3)" : "rgba(0,200,255,0.2)"} />
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: '"Rajdhani", sans-serif', fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.04em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(0,200,255,0.25)' }}>
        {reason ?? "Coming soon"}
      </div>
    </div>
    {reason && onAction && (
      <motion.button
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.25 }}
        onClick={onAction}
        style={{
          marginTop: '4px',
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 14px',
          background: 'rgba(0,200,255,0.08)',
          border: '1px solid rgba(0,200,255,0.2)',
          borderRadius: '4px',
          color: 'rgba(0,200,255,0.6)',
          fontFamily: '"Share Tech Mono", monospace',
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(0,200,255,0.14)';
          e.currentTarget.style.borderColor = 'rgba(0,200,255,0.4)';
          e.currentTarget.style.color = 'rgba(0,200,255,0.9)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(0,200,255,0.08)';
          e.currentTarget.style.borderColor = 'rgba(0,200,255,0.2)';
          e.currentTarget.style.color = 'rgba(0,200,255,0.6)';
        }}
      >
        <LogIn size={10} />
        Create Account
      </motion.button>
    )}
  </motion.div>
);
