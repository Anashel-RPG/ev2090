/** Summary panel — faction overview, reputation bar, services grid, local feed.
 *  Matches ui-demo/planet SummaryPanel design. */
import React from 'react';
import { motion } from 'motion/react';
import { Shield, Flame, Wrench, UserPlus, ShieldCheck, Crosshair, Map } from 'lucide-react';
import './SummaryPanel.css';

const SERVICES = [
  { label: 'Refinery',  icon: Flame },
  { label: 'Shipyard',  icon: Wrench },
  { label: 'Cloning',   icon: UserPlus },
  { label: 'Insurance', icon: ShieldCheck },
  { label: 'Bounties',  icon: Crosshair },
  { label: 'Maps',      icon: Map },
];

const FEED = [
  { time: '08:41', title: 'Transport Convoy Arrived',   body: 'Heavy freighters carrying refined ore and machinery docked at Bay 4.' },
  { time: '08:43', title: 'Pirate Activity — Sector 9', body: 'Unregistered vessels spotted near the asteroid belt. Security alert issued.' },
  { time: '08:47', title: 'Market Bulletin',            body: 'Nanite prices down 12.5% following overproduction from Caldari refineries.' },
  { time: '08:52', title: 'Station Maintenance',        body: 'Docking Bay 2 offline for scheduled repairs. Expected: 4h.' },
  { time: '09:01', title: 'Diplomatic Communiqué',      body: 'United Sol Federation extends trade agreement with Meridian Alliance.' },
  { time: '09:14', title: 'Jump Gate Anomaly',          body: 'Micro-wormhole detected near Gate Epsilon. Navigation advisory in effect.' },
  { time: '09:28', title: 'Fuel Price Spike',           body: 'H-Fuel up 18% after pipeline disruption in Outer Colonies. Rationing possible.' },
];

export const SummaryPanel = () => (
  <motion.div
    className="summary-panel"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.2 }}
  >

    {/* ── FACTION HERO ─────────────────────────────── */}
    <div className="summary-hero">

      {/* Faction name */}
      <div className="summary-faction-row">
        <div className="summary-faction-name">
          United Sol Federation
        </div>
        <Shield size={20} className="summary-faction-icon" />
      </div>

      {/* Reputation bar */}
      <ReputationBar level={5} label="Neutral" />

      {/* Services label */}
      <div className="summary-services-label">
        Services Available
      </div>

      {/* Services — 3×2 grid */}
      <div className="summary-services-grid">
        {SERVICES.map(({ label, icon: Icon }) => (
          <ServiceTile key={label} label={label} Icon={Icon} />
        ))}
      </div>
    </div>

    {/* ── LOCAL FEED ───────────────────────────────── */}
    <div className="summary-feed-section">

      <div className="summary-feed-header">
        <span className="summary-feed-title">Local Feed</span>
        <LiveDot />
      </div>

      <div className="summary-feed-scroll">
        {FEED.map((item, i) => (
          <div key={i} className="summary-feed-item">
            <span className="summary-feed-time">{item.time}</span>
            <div className="summary-feed-body">
              <div className="summary-feed-item-title">{item.title}</div>
              <div className="summary-feed-item-text">{item.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>

  </motion.div>
);

/* ── Sub-components ──────────────────────────────── */

const ServiceTile = ({ label, Icon }: { label: string; Icon: React.ElementType }) => (
  <div className="summary-service-tile">
    <Icon size={16} className="summary-service-icon" />
    <span className="summary-service-label">{label}</span>
  </div>
);

const ReputationBar = ({ level, label }: { level: number; label: string }) => {
  const TOTAL = 10;
  const currentIdx = level - 1;

  const getCellClass = (i: number): string => {
    if (i > currentIdx) return 'summary-rep-cell summary-rep-cell--empty';
    if (i === currentIdx) return 'summary-rep-cell summary-rep-cell--current';
    if (i < 3) return 'summary-rep-cell summary-rep-cell--low';
    return 'summary-rep-cell summary-rep-cell--mid';
  };

  return (
    <div className="summary-rep-row">
      <div className="summary-rep-bar">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <div key={i} className={getCellClass(i)} />
        ))}
      </div>
      <span className="summary-rep-label">{label}</span>
    </div>
  );
};

const LiveDot = () => (
  <div className="summary-live-dot-wrap">
    <div className="summary-live-dot" />
    <span className="summary-live-label">Live</span>
  </div>
);
