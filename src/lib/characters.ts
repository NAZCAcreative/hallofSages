import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { NpcId } from "@/game/npcs";

// RAG-grounded persona definitions (data/rag/characters/characters.json).
type Character = {
  id: NpcId;
  name: string;
  group: string;
  tone: string;
  answer_style: string;
  system_prompt: string;
};

let cache: Record<string, Character> | null = null;

export function getCharacter(npc: NpcId): Character {
  if (!cache) {
    const file = path.join(
      process.cwd(),
      "data",
      "rag",
      "characters",
      "characters.json",
    );
    const arr = JSON.parse(fs.readFileSync(file, "utf-8")) as Character[];
    cache = Object.fromEntries(arr.map((c) => [c.id, c]));
  }
  return cache[npc];
}
