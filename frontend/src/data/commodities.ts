/**
 * Frontend commodity catalog — lightweight mirror of worker/src/data/commodities.ts.
 * Only the fields needed for display and cargo weight calculations.
 */

import type { CommodityInfo, CommodityCategory } from "@/types/economy";

export const COMMODITY_CATEGORIES: CommodityCategory[] = [
  "minerals", "food", "tech", "industrial", "luxury",
];

export const COMMODITIES: CommodityInfo[] = [
  // ── Minerals ──
  { id: "iron",        name: "Iron Ore",        category: "minerals",   icon: "⛏",  unitSize: 2,   basePrice: 45,  description: "Standard ferrous ore. Foundation of industrial production." },
  { id: "titanium",    name: "Titanium",        category: "minerals",   icon: "◆",  unitSize: 1.5, basePrice: 120, description: "High-strength alloy metal. Essential for hull fabrication." },
  { id: "helium3",     name: "Helium-3",        category: "minerals",   icon: "☢",  unitSize: 0.5, basePrice: 200, description: "Fusion fuel isotope harvested from gas giants." },
  { id: "rare-earths", name: "Rare Earths",     category: "minerals",   icon: "✦",  unitSize: 0.8, basePrice: 180, description: "Lanthanide elements critical for electronics manufacturing." },
  { id: "crystals",    name: "Quantum Crystals", category: "minerals",  icon: "💎",  unitSize: 0.2, basePrice: 300, description: "Naturally formed crystalline structures with quantum properties." },

  // ── Food ──
  { id: "grain",         name: "Grain",         category: "food",       icon: "🌾",  unitSize: 3,   basePrice: 25,  description: "Staple carbohydrate crop. Feeds stations and outposts." },
  { id: "protein-packs", name: "Protein Packs", category: "food",       icon: "📦",  unitSize: 1,   basePrice: 40,  description: "Concentrated nutrition rations for deep-space crews." },
  { id: "luxury-food",   name: "Luxury Food",   category: "food",       icon: "🍷",  unitSize: 0.5, basePrice: 90,  description: "Rare delicacies from garden worlds. High demand at wealthy stations." },
  { id: "spice",         name: "Spice",         category: "food",       icon: "🌿",  unitSize: 0.3, basePrice: 150, description: "Exotic biological compound. Culinary and medicinal applications." },

  // ── Tech ──
  { id: "microchips",    name: "Microchips",    category: "tech",       icon: "🔲",  unitSize: 0.1, basePrice: 80,  description: "Standard computation wafers. Every system needs them." },
  { id: "quantum-cores", name: "Quantum Cores", category: "tech",       icon: "⬡",  unitSize: 0.1, basePrice: 350, description: "Entanglement-based processing units. Research-grade hardware." },
  { id: "ai-modules",    name: "AI Modules",    category: "tech",       icon: "🧠",  unitSize: 0.2, basePrice: 250, description: "Pre-trained neural substrates for autonomous systems." },
  { id: "sensors",       name: "Sensor Arrays", category: "tech",       icon: "📡",  unitSize: 0.5, basePrice: 160, description: "Multi-spectrum detection equipment for ships and stations." },

  // ── Industrial ──
  { id: "steel",      name: "Steel",      category: "industrial", icon: "🔩",  unitSize: 3,   basePrice: 60,  description: "Refined iron alloy. Bulk construction material." },
  { id: "polymers",   name: "Polymers",   category: "industrial", icon: "🧪",  unitSize: 2,   basePrice: 55,  description: "Synthetic materials for insulation, seals, and composites." },
  { id: "coolant",    name: "Coolant",    category: "industrial", icon: "❄",   unitSize: 1.5, basePrice: 70,  description: "Thermal management fluid for reactors and engines." },
  { id: "fuel-cells", name: "Fuel Cells", category: "industrial", icon: "🔋",  unitSize: 1,   basePrice: 85,  description: "Portable energy storage. Powers everything from suits to shuttles." },

  // ── Luxury ──
  { id: "wine",    name: "Orbital Wine", category: "luxury", icon: "🍾",  unitSize: 0.5, basePrice: 200, description: "Fermented in zero-gravity vineyards. Status symbol." },
  { id: "jewelry", name: "Jewelry",      category: "luxury", icon: "💍",  unitSize: 0.1, basePrice: 280, description: "Precious metal and gemstone crafts from artisan worlds." },
  { id: "art",     name: "Fine Art",     category: "luxury", icon: "🎨",  unitSize: 0.3, basePrice: 320, description: "Original works from across the colonies. Highly subjective value." },
];

/** Fast lookup by commodity ID */
export const COMMODITY_MAP = new Map(COMMODITIES.map(c => [c.id, c]));

/** Get commodity info by ID */
export function getCommodityInfo(id: string): CommodityInfo | undefined {
  return COMMODITY_MAP.get(id);
}
