// NPC roster shared by the Phaser scene and the React UI.
// Design Ref: requirements 3, 7 — three sages, each with a distinct AI persona.

// Responsive world size: portrait on phones, landscape-ish on larger screens.
// Positions are stored as fractions so they adapt to either aspect.
export type WorldSize = { w: number; h: number };
export const WORLD_DESKTOP: WorldSize = { w: 960, h: 900 };
export const WORLD_PORTRAIT: WorldSize = { w: 720, h: 1180 };

export function getWorldSize(): WorldSize {
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return WORLD_PORTRAIT;
  }
  return WORLD_DESKTOP;
}

export type NpcId = "jesus" | "buddha" | "confucius";

export type Npc = {
  id: NpcId;
  /** Display name shown in hints and the dialogue box. */
  name: string;
  /** Short Korean honorific subtitle. */
  title: string;
  /** Fallback rectangle color (used when no PNG asset is found). */
  color: number;
  /** Spawn position as a fraction of the world (0..1). */
  fx: number;
  fy: number;
  /** Asset key / expected file at public/assets/{id}.png */
  asset: string;
};

export const NPCS: Npc[] = [
  {
    id: "jesus",
    name: "예수님",
    title: "Jesus",
    color: 0xfcd34d, // warm gold
    fx: 0.28,
    fy: 0.6, // lower-mid (slightly raised; chat panel sits above)
    asset: "jesus",
  },
  {
    id: "buddha",
    name: "부처님",
    title: "Buddha",
    color: 0xf59e0b, // amber
    fx: 0.5,
    fy: 0.6, // lower-mid (slightly raised; chat panel sits above)
    asset: "buddha",
  },
  {
    id: "confucius",
    name: "공자님",
    title: "Confucius",
    color: 0x60a5fa, // calm blue
    fx: 0.72,
    fy: 0.6, // lower-mid (slightly raised; chat panel sits above)
    asset: "confucius",
  },
];

// Portrait (mobile) layout: a roomy triangle so big sages don't overlap.
const PORTRAIT_POS: Record<NpcId, { fx: number; fy: number }> = {
  jesus: { fx: 0.26, fy: 0.62 },
  confucius: { fx: 0.74, fy: 0.62 },
  buddha: { fx: 0.5, fy: 0.62 }, // same height as the other two (was 0.74)
};

/** Fractional position for a sage, chosen by orientation. */
export function npcFrac(n: Npc, portrait: boolean): { fx: number; fy: number } {
  return portrait ? PORTRAIT_POS[n.id] : { fx: n.fx, fy: n.fy };
}

export function getNpc(id: string): Npc | undefined {
  return NPCS.find((n) => n.id === id);
}
