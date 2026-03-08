/** Static station data for each planet */

export type FacilityId =
  | "repair"
  | "refuel"
  | "trade"
  | "missions"
  | "shipyard"
  | "comms"
  | "bar";

export interface StationFacility {
  id: FacilityId;
  label: string;
  icon: string; // Unicode character
  description: string;
}

/** Facility templates — reused across stations */
const FAC: Record<FacilityId, StationFacility> = {
  repair: {
    id: "repair",
    label: "REPAIR BAY",
    icon: "\u2699",       // ⚙
    description: "Restore hull integrity and shield systems.",
  },
  refuel: {
    id: "refuel",
    label: "REFUEL",
    icon: "\u26FD",       // ⛽
    description: "Top off fuel reserves.",
  },
  trade: {
    id: "trade",
    label: "TRADE",
    icon: "\u25A6",       // ▦
    description: "Buy and sell commodities.",
  },
  missions: {
    id: "missions",
    label: "MISSIONS",
    icon: "\u2691",       // ⚑
    description: "Browse available contracts and bounties.",
  },
  shipyard: {
    id: "shipyard",
    label: "SHIPYARD",
    icon: "\u2692",       // ⚒
    description: "Upgrade and modify your vessel.",
  },
  comms: {
    id: "comms",
    label: "COMMS",
    icon: "\u25C8",       // ◈
    description: "Station communications and community board.",
  },
  bar: {
    id: "bar",
    label: "BAR",
    icon: "\u2615",       // ☕
    description: "Hear the latest rumours. Unwind.",
  },
};

export interface PlanetInfo {
  className: string;       // e.g. "Class M"
  habitable: boolean;
  lore: string;            // 1-2 sentence flavour text
  temp: string;            // e.g. "286 K"
  gravity: string;         // e.g. "1.12 G"
  rads: string;            // e.g. "0.45 Sv"
  threat: string;          // e.g. "LOW"
}

export interface StationData {
  name: string;
  description: string;
  welcome: string;
  atmosphere: string;
  accentColor: string;
  subtitle: string;
  facilities: StationFacility[];
  planet: PlanetInfo;
}

export const STATIONS: Record<string, StationData> = {
  Nexara: {
    name: "NEXARA STATION",
    subtitle: "MEDICAL RESEARCH \u00B7 INTERSTELLAR TRADE",
    description:
      "Hub of medical research and interstellar trade. Nexara's orbital platform handles most of the system's cargo throughput.",
    welcome:
      "Welcome to Nexara Station. Medical supplies are in high demand. Dock safely, pilot.",
    atmosphere: "warm",
    accentColor: "#88ccff",
    facilities: [
      FAC.repair,
      FAC.refuel,
      FAC.trade,
      FAC.missions,
      FAC.comms,
      FAC.bar,
    ],
    planet: {
      className: "Class M",
      habitable: true,
      lore: "Temperate ocean world. Dense biosphere supports large-scale agriculture and medical research.",
      temp: "294 K",
      gravity: "0.98 G",
      rads: "0.12 Sv",
      threat: "LOW",
    },
  },
  Velkar: {
    name: "VELKAR OUTPOST",
    subtitle: "ORE PROCESSING \u00B7 FRONTIER REFINERY",
    description:
      "Mining outpost on the frontier. Ore processing and fuel refinery. Not much law out here.",
    welcome: "Velkar Outpost. Watch your cargo. Watch your back.",
    atmosphere: "harsh",
    accentColor: "#ff8844",
    facilities: [FAC.repair, FAC.refuel, FAC.trade, FAC.bar],
    planet: {
      className: "Class K",
      habitable: false,
      lore: "Barren volcanic moon. Rich mineral deposits draw mining operations despite extreme surface heat.",
      temp: "487 K",
      gravity: "0.41 G",
      rads: "2.80 Sv",
      threat: "HIGH",
    },
  },
  Zephyra: {
    name: "ZEPHYRA OBSERVATORY",
    subtitle: "DEEP SPACE RESEARCH \u00B7 OUTER NEBULA",
    description:
      "Deep space observatory and research station. Scientists study the outer nebula from here.",
    welcome:
      "Zephyra Observatory. Quiet. Cold. The stars are beautiful from here.",
    atmosphere: "cold",
    accentColor: "#aaddff",
    facilities: [FAC.refuel, FAC.trade, FAC.missions, FAC.comms],
    planet: {
      className: "Class D",
      habitable: false,
      lore: "Frozen gas giant. Orbital station hovers above cloud layer. Rare isotope harvesting site.",
      temp: "72 K",
      gravity: "2.35 G",
      rads: "0.90 Sv",
      threat: "MODERATE",
    },
  },
  Arctis: {
    name: "ARCTIS RELAY",
    subtitle: "AUTOMATED RELAY \u00B7 MINIMAL CREW",
    description:
      "Small lunar relay station. Automated systems handle most operations. Minimal crew.",
    welcome:
      "Arctis Relay. Automated systems online. Not much here but the view.",
    atmosphere: "minimal",
    accentColor: "#8888aa",
    facilities: [FAC.refuel, FAC.trade],
    planet: {
      className: "Class C",
      habitable: false,
      lore: "Dead rock. Automated relay beacon. No atmosphere. Micro-gravity docking only.",
      temp: "118 K",
      gravity: "0.08 G",
      rads: "0.02 Sv",
      threat: "MINIMAL",
    },
  },
};
