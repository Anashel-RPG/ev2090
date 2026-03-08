/** Station overlay — mobile CRT-terminal docking interface with tabbed panels. */
import { useState, useEffect, useCallback, useMemo } from "react";
import { STATIONS } from "@/data/stations";
import { COMMODITY_MAP } from "@/data/commodities";
import type { CargoItem } from "@/types/economy";
import { CommunityBoard } from "./CommunityBoard";
import "./StationOverlay.css";

type Tab = "ops" | "board" | "cargo" | "hangar";

/* ─── Block-character progress bar ─── */
const FULL = "\u2588"; // █
const DIM = "\u2591"; // ░
const BAR_LEN = 10;

function asciiBar(fraction: number): string {
  const filled = Math.round(fraction * BAR_LEN);
  return FULL.repeat(filled) + DIM.repeat(BAR_LEN - filled);
}

/* ─── Boot sequence lines ─── */
const BOOT_LINES = [
  "INITIALIZING UPLINK...",
  "HANDSHAKE OK",
  "ENCRYPTION: AES-256-GCM",
  "SYSTEMS CHECK: NOMINAL",
  "TERMINAL READY",
];
const BOOT_DELAY = 260; // ms per line

function fmtCR(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en", { maximumFractionDigits: 0 });
}

function fmtWeight(t: number): string {
  return t % 1 === 0 ? String(t) : t.toFixed(1);
}

interface Props {
  planetName: string;
  nickname: string;
  boardApiUrl: string;
  onUndock: () => void;
  onRepair: () => void;
  onRefuel: () => void;
  onOpenHangar?: () => void;
  shields: number;
  armor: number;
  fuel: number;
  // Economy
  credits: number;
  cargo: CargoItem[];
  cargoWeight: number;
  cargoCapacity: number;
}

export function StationOverlay({
  planetName,
  nickname,
  boardApiUrl,
  onUndock,
  onRepair,
  onRefuel,
  onOpenHangar,
  shields,
  armor,
  fuel,
  credits,
  cargo,
  cargoWeight,
  cargoCapacity,
}: Props) {
  const [tab, setTab] = useState<Tab>("ops");
  const [repairDone, setRepairDone] = useState(false);
  const [refuelDone, setRefuelDone] = useState(false);
  const [bootLine, setBootLine] = useState(0);
  const booted = bootLine >= BOOT_LINES.length;

  const station = STATIONS[planetName] ?? {
    name: `${planetName.toUpperCase()} STATION`,
    description: "Unknown station.",
    welcome: "Docking complete.",
    atmosphere: "minimal",
  };

  /* ── Boot sequence timer ── */
  useEffect(() => {
    if (booted) return;
    const id = setInterval(() => {
      setBootLine((prev) => {
        if (prev >= BOOT_LINES.length) {
          clearInterval(id);
          return prev;
        }
        return prev + 1;
      });
    }, BOOT_DELAY);
    return () => clearInterval(id);
  }, [booted]);

  /* ── Keyboard navigation ── */
  const handleRepair = useCallback(() => {
    onRepair();
    setRepairDone(true);
  }, [onRepair]);

  const handleRefuel = useCallback(() => {
    onRefuel();
    setRefuelDone(true);
  }, [onRefuel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't capture keys when typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const tabs: Tab[] = ["ops", "board", "cargo", "hangar"];
      const idx = tabs.indexOf(tab);

      switch (e.key) {
        case "1":
          setTab("ops");
          break;
        case "2":
          setTab("board");
          break;
        case "3":
          setTab("cargo");
          break;
        case "4":
          if (onOpenHangar) onOpenHangar();
          break;
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          setTab(tabs[(idx - 1 + tabs.length) % tabs.length]!);
          break;
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          setTab(tabs[(idx + 1) % tabs.length]!);
          break;
        case "Escape":
          onUndock();
          break;
        case "r":
        case "R":
          if (tab === "ops") handleRepair();
          break;
        case "f":
        case "F":
          if (tab === "ops") handleRefuel();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUndock, tab, handleRepair, handleRefuel, onOpenHangar]);

  const allRepaired = repairDone && shields >= 1 && armor >= 1;
  const allFueled = refuelDone && fuel >= 1;

  return (
    <div className="station-overlay">
      <div className="station-frame">
        {/* Background image */}
        <div className="station-bg" />

        {/* Screen area — positioned over the CRT in the image */}
        <div className="station-screen">
          <div className="station-crt-scanlines" />
          <div className="station-crt-glow" />

          <div className="station-screen-content">
            {!booted ? (
              /* ── Boot sequence ── */
              <div className="station-boot-sequence">
                {BOOT_LINES.slice(0, bootLine).map((line, i) => (
                  <div
                    key={i}
                    className={`station-boot-line ${
                      line.includes("OK") || line.includes("READY") || line.includes("NOMINAL")
                        ? "station-boot-line-ok"
                        : ""
                    }`}
                  >
                    {line}
                  </div>
                ))}
                <span className="station-boot-cursor">{FULL}</span>
              </div>
            ) : (
              /* ── BBS terminal ── */
              <>
                {/* Header */}
                <div className="station-bbs-header">
                  <div className="station-bbs-title">
                    {station.name}
                  </div>
                  <div className="station-bbs-divider">
                    {"-".repeat(32)}
                  </div>
                </div>

                {/* Menu */}
                <div className="station-bbs-menu">
                  <div
                    className={`station-bbs-option ${tab === "ops" ? "station-bbs-option-active" : ""}`}
                    onClick={() => setTab("ops")}
                  >
                    {tab === "ops" ? "> " : "  "}[1] OPERATIONS
                  </div>
                  <div
                    className={`station-bbs-option ${tab === "board" ? "station-bbs-option-active" : ""}`}
                    onClick={() => setTab("board")}
                  >
                    {tab === "board" ? "> " : "  "}[2] COMMUNITY BOARD
                  </div>
                  <div
                    className={`station-bbs-option ${tab === "cargo" ? "station-bbs-option-active" : ""}`}
                    onClick={() => setTab("cargo")}
                  >
                    {tab === "cargo" ? "> " : "  "}[3] CARGO BAY
                  </div>
                  {onOpenHangar && (
                    <div
                      className="station-bbs-option"
                      onClick={onOpenHangar}
                    >
                      {"  "}[4] HANGAR
                    </div>
                  )}
                </div>

                <div className="station-bbs-divider">
                  {"-".repeat(32)}
                </div>

                {/* Tab content */}
                <div className="station-bbs-body">
                  {tab === "ops" && (
                    <div className="station-ops-bbs">
                      <div className="station-ops-row">
                        <span className="station-ops-label">HULL</span>
                        <span className="station-ops-bar-text station-ops-bar-text-armor">
                          {asciiBar(armor)}
                        </span>
                        <span className="station-ops-value">
                          {Math.round(armor * 100)}%
                        </span>
                      </div>
                      <div className="station-ops-row">
                        <span className="station-ops-label">SHLD</span>
                        <span className="station-ops-bar-text station-ops-bar-text-shields">
                          {asciiBar(shields)}
                        </span>
                        <span className="station-ops-value">
                          {Math.round(shields * 100)}%
                        </span>
                      </div>
                      <div className="station-ops-row">
                        <span className="station-ops-label">FUEL</span>
                        <span className="station-ops-bar-text station-ops-bar-text-fuel">
                          {asciiBar(fuel)}
                        </span>
                        <span className="station-ops-value">
                          {Math.round(fuel * 100)}%
                        </span>
                      </div>

                      <div className="station-ops-actions">
                        <button
                          className="station-ops-action"
                          onClick={handleRepair}
                          disabled={allRepaired}
                        >
                          {allRepaired ? (
                            <span className="station-ops-done">
                              SYSTEMS OK
                            </span>
                          ) : (
                            "[R] REPAIR ALL"
                          )}
                        </button>
                        <button
                          className="station-ops-action"
                          onClick={handleRefuel}
                          disabled={allFueled}
                        >
                          {allFueled ? (
                            <span className="station-ops-done">TANKS FULL</span>
                          ) : (
                            "[F] REFUEL"
                          )}
                        </button>
                      </div>

                      {/* Station log */}
                      <div className="station-log">
                        <div className="station-log-header">STATION LOG</div>
                        <div className="station-log-text">
                          {station.welcome}
                        </div>
                        <div className="station-log-text station-log-desc">
                          {station.description}
                        </div>
                      </div>
                    </div>
                  )}

                  {tab === "board" && (
                    <CommunityBoard
                      planet={planetName}
                      nickname={nickname}
                      apiUrl={boardApiUrl}
                    />
                  )}

                  {tab === "cargo" && (
                    <CargoBayTab
                      credits={credits}
                      cargo={cargo}
                      cargoWeight={cargoWeight}
                      cargoCapacity={cargoCapacity}
                    />
                  )}
                </div>

                {/* Footer */}
                <div className="station-bbs-footer" onClick={onUndock}>
                  <span className="station-bbs-cursor">{FULL}</span>
                  <span>[ESC] UNDOCK</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Cargo Bay sub-component — CRT-styled cargo manifest ── */

function CargoBayTab({
  credits,
  cargo,
  cargoWeight,
  cargoCapacity,
}: {
  credits: number;
  cargo: CargoItem[];
  cargoWeight: number;
  cargoCapacity: number;
}) {
  const pct = cargoCapacity > 0 ? Math.round((cargoWeight / cargoCapacity) * 100) : 0;

  const manifest = useMemo(() =>
    cargo.map(item => {
      const comm = COMMODITY_MAP.get(item.commodityId);
      return {
        id: item.commodityId,
        name: (comm?.name ?? item.commodityId).toUpperCase(),
        quantity: item.quantity,
        value: item.quantity * item.avgBuyPrice,
      };
    }),
  [cargo]);

  const totalValue = manifest.reduce((s, m) => s + m.value, 0);

  return (
    <div className="station-cargo-bbs">
      <div className="station-cargo-bbs-header">CARGO BAY</div>
      <div className="station-cargo-bbs-row">
        <span className="station-ops-label">LOAD</span>
        <span>{fmtWeight(cargoWeight)}t / {fmtWeight(cargoCapacity)}t [{pct}%]</span>
      </div>
      <div className="station-cargo-bbs-row">
        <span className="station-ops-label">CR</span>
        <span>{fmtCR(credits)} CR</span>
      </div>

      {cargo.length === 0 ? (
        <div className="station-cargo-bbs-empty">CARGO HOLD EMPTY</div>
      ) : (
        <>
          <div className="station-cargo-bbs-divider">{"-".repeat(28)}</div>
          {manifest.map(item => (
            <div key={item.id} className="station-cargo-bbs-item">
              <span className="station-cargo-bbs-item-name">{item.name}</span>
              <span className="station-cargo-bbs-item-qty">x{item.quantity}</span>
              <span className="station-cargo-bbs-item-val">{fmtCR(item.value)} CR</span>
            </div>
          ))}
          <div className="station-cargo-bbs-divider">{"-".repeat(28)}</div>
          <div className="station-cargo-bbs-row">
            <span>TOTAL VALUE</span>
            <span>{fmtCR(totalValue)} CR</span>
          </div>
        </>
      )}
    </div>
  );
}
