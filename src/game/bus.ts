// Tiny typed event bus bridging the Phaser scene and the React UI overlay.
// Kept Phaser-free so it is safe to import from React components.
import type { Npc, NpcId } from "./npcs";

export type BusEvents = {
  /** Player entered/left an NPC's range (null = left all). */
  proximity: Npc | null;
  /** Player pressed E next to an NPC → open the 1:1 question modal. */
  ask: Npc;
  /** Player pressed Enter → ask all three sages at once. */
  askAll: void;
  /** React told the game the dialogue/modal closed → resume movement. */
  resume: void;
  /** Touch D-pad movement vector (each axis -1..1). */
  touchMove: { x: number; y: number };
  /** Touch "대화" button → behave like the E key. */
  reqInteract: void;
  /** Touch "동시질문" button → behave like Enter. */
  reqAskAll: void;
  /** A sage finished answering → play "!" emote + particle burst. */
  sageAnswered: { npc: NpcId };
};

type Handler<T> = (payload: T) => void;

class Bus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: { [K in keyof BusEvents]?: Set<Handler<any>> } = {};

  on<K extends keyof BusEvents>(event: K, fn: Handler<BusEvents[K]>): () => void {
    (this.handlers[event] ??= new Set()).add(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof BusEvents>(event: K, fn: Handler<BusEvents[K]>): void {
    this.handlers[event]?.delete(fn);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    this.handlers[event]?.forEach((fn) => fn(payload));
  }
}

export const bus = new Bus();
