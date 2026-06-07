import * as Phaser from "phaser";
import { NPCS, getWorldSize, npcFrac, type Npc } from "./npcs";
import { bus } from "./bus";

// Design Ref: requirements 1-5, 9 — canvas, arrow-key movement, 3 NPCs,
// proximity hint, E-to-ask, PNG assets with rectangle fallback.
// Sizes/positions are derived from the (responsive) world size at create().
const TILE = 36; // rectangle fallback size
const PLAYER_FPS = 10;

type Dir = "front" | "back" | "left" | "right";
const DIRS: Dir[] = ["front", "back", "left", "right"];

const pad = (n: number) => String(n).padStart(2, "0");
const frameKeys = (base: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${base}_${pad(i + 1)}`);

// Walk animation frames per direction (files in public/assets/player/).
const PLAYER_ANIM: Record<Dir, string[]> = {
  front: frameKeys("player_front", 6), // moving down
  back: frameKeys("player_back", 6), // moving up
  left: frameKeys("player_left", 6),
  right: frameKeys("player_right", 6),
};

type Movable = Phaser.GameObjects.GameObject & {
  x: number;
  y: number;
  setScale: (s: number) => unknown;
};

type NpcSprite = {
  npc: Npc;
  obj: Movable;
  glow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  baseY: number;
  bob?: Phaser.Tweens.Tween;
  emote?: Phaser.GameObjects.Text;
};

export class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.GameObject & { x: number; y: number };
  /** Set when animated walk frames are available. */
  private playerSprite?: Phaser.GameObjects.Sprite;
  private playerDir: Dir = "front";
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private eKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private npcs: NpcSprite[] = [];
  private nearby: Npc | null = null;
  /** When true (modal open), movement + E are ignored. */
  private paused = false;
  /** External (touch D-pad) movement vector. */
  private touch = { x: 0, y: 0 };
  /** Floating ambient light motes. */
  private motes: { s: Phaser.GameObjects.Image; vx: number; vy: number }[] = [];
  /** Footstep dust emitter (follows the player). */
  private dust?: Phaser.GameObjects.Particles.ParticleEmitter;

  // Responsive world + derived sizes (set in create()).
  private W = 960;
  private H = 900;
  private spriteSize = 240;
  private playerSize = 120;
  private speed = 220;
  private interact = 130;

  constructor() {
    super("main");
  }

  preload() {
    // Attempt to load optional PNGs; missing files just fire loaderror (ignored).
    this.load.on("loaderror", () => {
      /* asset missing → rectangle fallback used in create() */
    });
    this.load.image("background", "/assets/background.png");
    this.load.image("player", "/assets/player.png");
    for (const n of NPCS) {
      this.load.image(n.asset, `/assets/${n.asset}.png`);
    }
    // Player walk-cycle frames (4 directions).
    for (const d of DIRS) {
      for (const key of PLAYER_ANIM[d]) {
        this.load.image(key, `/assets/player/${key}.png`);
      }
    }
  }

  create() {
    this.cameras.main.setBackgroundColor("#1a2e1f");

    // Derive world + sizes from the actual canvas size (responsive).
    this.W = this.scale.width;
    this.H = this.scale.height;
    // Portrait (mobile) → much bigger sages (triangle layout has room for it).
    const portrait = this.H > this.W;
    this.spriteSize = Math.round(this.W * (portrait ? 0.42 : 0.25));
    this.playerSize = Math.round(this.spriteSize * (portrait ? 0.6 : 0.5));
    this.speed = Math.round(this.W * (portrait ? 0.36 : 0.23));
    this.interact = Math.round(this.W * (portrait ? 0.22 : 0.16));

    if (this.textures.exists("background")) {
      // "Cover" the world while keeping aspect ratio (overflow is clipped by the
      // canvas), so non-matching aspect ratios don't get squished.
      const bg = this.add.image(this.W / 2, this.H / 2, "background");
      const src = this.textures.get("background").getSourceImage();
      const scale = Math.max(this.W / src.width, this.H / src.height);
      bg.setScale(scale);
      bg.setDepth(-10);
    } else {
      // No background image → simple grass-ish grid so movement is visible.
      const g = this.add.graphics();
      g.lineStyle(1, 0x2c4a35, 0.5);
      for (let x = 0; x <= this.W; x += TILE) {
        g.lineBetween(x, 0, x, this.H);
      }
      for (let y = 0; y <= this.H; y += TILE) {
        g.lineBetween(0, y, this.W, y);
      }
    }

    // Soft radial glow texture (shared) for each sage's light source.
    this.makeGlowTexture();
    this.makeAmbient();

    // NPCs
    for (const n of NPCS) {
      const frac = npcFrac(n, portrait);
      const nx = frac.fx * this.W;
      const ny = frac.fy * this.H;
      // Per-sage light source (colored aura) behind the sprite, gently pulsing.
      const glow = this.add.image(nx, ny, "glow");
      glow.setTint(n.color);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      glow.setDisplaySize(this.spriteSize * 2.6, this.spriteSize * 2.6);
      glow.setDepth(0);
      glow.setAlpha(0.45);
      const base = glow.scaleX;
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.35, to: 0.7 },
        scaleX: { from: base * 0.9, to: base * 1.12 },
        scaleY: { from: base * 0.9, to: base * 1.12 },
        duration: 1600 + Math.random() * 800,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });

      const obj = this.makeActor(nx, ny, n.asset, n.color);
      const label = this.add
        .text(nx, ny - this.spriteSize * 0.42, n.name, {
          fontFamily: '"Gowun Batang", sans-serif',
          fontStyle: "700",
          fontSize: `${Math.max(15, Math.round(this.spriteSize * 0.1))}px`,
          color: "#fff6da",
          stroke: "#1a1206",
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(2);
      label.setShadow(0, 2, "#000000", 4);
      this.npcs.push({ npc: n, obj, glow, label, baseY: ny });
    }

    // Player (visitor) starts near the bottom — animated sprite if frames loaded.
    const px = this.W / 2;
    const py = this.H * 0.85;
    if (this.textures.exists(PLAYER_ANIM.front[0])) {
      for (const d of DIRS) {
        const frames = PLAYER_ANIM[d]
          .filter((k) => this.textures.exists(k))
          .map((key) => ({ key }));
        if (frames.length) {
          this.anims.create({
            key: `walk-${d}`,
            frames,
            frameRate: PLAYER_FPS,
            repeat: -1,
          });
        }
      }
      const spr = this.add.sprite(px, py, PLAYER_ANIM.front[0]);
      const src = this.textures.get(PLAYER_ANIM.front[0]).getSourceImage();
      spr.setScale(this.playerSize / Math.max(src.width, src.height));
      spr.setDepth(1);
      this.playerSprite = spr;
      this.player = spr as unknown as Phaser.GameObjects.GameObject & {
        x: number;
        y: number;
      };
    } else {
      this.player = this.makeActor(px, py, "player", 0xffffff, this.playerSize);
    }

    // Footstep dust — anime-style puffs that bloom outward and fade.
    this.dust = this.add.particles(0, 0, "glow", {
      follow: this.player as unknown as Phaser.Types.Math.Vector2Like,
      followOffset: { x: 0, y: this.playerSize * 0.42 },
      speed: { min: 12, max: 45 },
      angle: { min: 235, max: 305 }, // kicked up and back
      scale: { start: this.playerSize / 1100, end: this.playerSize / 360 }, // bloom out (smaller)
      alpha: { start: 0.7, end: 0 },
      lifespan: 600,
      frequency: 45,
      quantity: 1,
      gravityY: 30,
      tint: [0xeaddbf, 0xd8c39a, 0xbfa275, 0xa98c5f],
    });
    this.dust.setDepth(0);
    this.dust.stop();

    // Input. Capture only the arrows (prevents page scroll); leave E uncaptured
    // so typing "e" in the question textarea is never swallowed.
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.wasd = kb.addKeys(
      { up: KC.W, down: KC.S, left: KC.A, right: KC.D },
      false,
    ) as Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
    this.eKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E, false);
    this.enterKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER, false);
    kb.clearCaptures();
    kb.addCapture("UP,DOWN,LEFT,RIGHT");

    const openChat = () => {
      if (this.paused || !this.nearby) return;
      this.paused = true;
      kb.enabled = false; // stop the game from eating keystrokes while the chat is open
      bus.emit("ask", this.nearby);
    };
    const openAll = () => {
      if (this.paused) return;
      this.paused = true;
      kb.enabled = false;
      bus.emit("askAll", undefined);
    };

    // Open on key-UP, not key-down: the same physical "E" press that opens the
    // chat would otherwise type an "e" into the freshly focused textarea.
    this.eKey.on("up", openChat);
    this.enterKey.on("up", openAll);

    // Touch controls (mobile) drive the same actions.
    const onTouch = (v: { x: number; y: number }) => {
      this.touch = v;
    };
    const onAnswered = (p: { npc: string }) => {
      try {
        this.onSageAnswered(p.npc);
      } catch {
        /* animation must never break gameplay */
      }
    };
    const onResume = () => {
      this.paused = false;
      if (this.input.keyboard) this.input.keyboard.enabled = true;
      this.touch = { x: 0, y: 0 };
    };
    bus.on("touchMove", onTouch);
    bus.on("reqInteract", openChat);
    bus.on("reqAskAll", openAll);
    bus.on("sageAnswered", onAnswered);
    bus.on("resume", onResume);

    // CRITICAL: remove module-singleton bus listeners when the scene/game is torn
    // down, or stale (destroyed) scenes accumulate and throw on later events.
    const cleanup = () => {
      bus.off("touchMove", onTouch);
      bus.off("reqInteract", openChat);
      bus.off("reqAskAll", openAll);
      bus.off("sageAnswered", onAnswered);
      bus.off("resume", onResume);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }

  /** Build a soft white radial-gradient texture (tinted per sage at use). */
  private makeGlowTexture() {
    if (this.textures.exists("glow")) return;
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext("2d")!;
    const grd = c.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.4, "rgba(255,255,255,0.55)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = grd;
    c.fillRect(0, 0, size, size);
    this.textures.addCanvas("glow", canvas);
  }

  /** Soft ambient mood: floating golden light motes. */
  private makeAmbient() {
    // Floating golden light motes drifting gently upward.
    const count = 22;
    for (let i = 0; i < count; i++) {
      const m = this.add.image(
        Phaser.Math.Between(0, this.W),
        Phaser.Math.Between(0, this.H),
        "glow",
      );
      m.setBlendMode(Phaser.BlendModes.ADD);
      m.setTint(0xfff0c0);
      const size = Phaser.Math.Between(8, 26);
      m.setDisplaySize(size, size);
      m.setDepth(20);
      const a = Phaser.Math.FloatBetween(0.08, 0.3);
      m.setAlpha(a);
      this.tweens.add({
        targets: m,
        alpha: { from: a * 0.35, to: a },
        duration: Phaser.Math.Between(1500, 3500),
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
      this.motes.push({
        s: m,
        vx: Phaser.Math.FloatBetween(-10, 10),
        vy: Phaser.Math.FloatBetween(-16, -4),
      });
    }
  }

  /** Reaction when the nearby sage changes: bob + scale pop + "?" emote. */
  private nearbyReact(prev: Npc | null, next: Npc | null) {
    if (prev) {
      const s = this.npcs.find((x) => x.npc.id === prev.id);
      if (s) {
        s.bob?.remove();
        s.bob = undefined;
        s.obj.y = s.baseY;
        s.emote?.destroy();
        s.emote = undefined;
        this.tweens.add({ targets: s.label, scale: 1, duration: 160 });
      }
    }
    if (next) {
      const s = this.npcs.find((x) => x.npc.id === next.id);
      if (s) {
        s.bob = this.tweens.add({
          targets: s.obj,
          y: { from: s.baseY, to: s.baseY - 12 },
          duration: 620,
          yoyo: true,
          repeat: -1,
          ease: "Sine.InOut",
        });
        this.tweens.add({
          targets: s.obj,
          scaleX: "*=1.08",
          scaleY: "*=1.08",
          duration: 150,
          yoyo: true,
        });
        // Name pops up a bit bigger.
        this.tweens.add({
          targets: s.label,
          scale: 1.25,
          duration: 220,
          ease: "Back.Out",
        });
        s.emote = this.makeEmote(s, "?", "#fde68a");
      }
    }
  }

  /** "!" + light burst when a sage finishes answering. */
  private onSageAnswered(npcId: string) {
    const s = this.npcs.find((x) => x.npc.id === npcId);
    if (!s) return;
    const ex = s.obj.x;
    const ey = s.baseY - this.spriteSize * 0.35;
    const burst = this.add.particles(ex, ey, "glow", {
      speed: { min: 60, max: 210 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 750,
      blendMode: "ADD",
      tint: s.npc.color,
      emitting: false,
    });
    burst.setDepth(35);
    burst.explode(22);
    this.time.delayedCall(950, () => burst.destroy());

    // "!" pops above the player (the one who received the answer).
    const bang = this.floatEmote(
      this.player.x,
      this.player.y - this.playerSize * 0.6,
      "!",
      "#fca5a5",
      Math.max(28, this.playerSize * 0.5),
    );
    this.tweens.add({
      targets: bang,
      alpha: 0,
      delay: 1100,
      duration: 400,
      onComplete: () => bang.destroy(),
    });
  }

  /** Floating emote text at a position (pops in + gentle bob). */
  private floatEmote(
    x: number,
    y: number,
    char: string,
    color: string,
    size: number,
  ) {
    const t = this.add
      .text(x, y, char, {
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: `${Math.round(size)}px`,
        color,
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(40)
      .setScale(0);
    this.tweens.add({ targets: t, scale: 1, duration: 240, ease: "Back.Out" });
    this.tweens.add({
      targets: t,
      y: y - 12,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    return t;
  }

  /** Persistent emote above a sage (used for the "?" proximity cue). */
  private makeEmote(s: NpcSprite, char: string, color: string) {
    return this.floatEmote(
      s.obj.x,
      s.baseY - this.spriteSize * 0.58,
      char,
      color,
      this.spriteSize * 0.32,
    );
  }

  /** Create a sprite if its texture loaded, else a colored rectangle. */
  private makeActor(
    x: number,
    y: number,
    key: string,
    color: number,
    size?: number,
  ) {
    const sz = size ?? this.spriteSize;
    if (this.textures.exists(key)) {
      // Real art is shown larger (keeps aspect ratio) than the rectangle stand-in.
      const s = this.add.image(x, y, key);
      const tex = this.textures.get(key).getSourceImage();
      const scale = sz / Math.max(tex.width, tex.height);
      s.setScale(scale);
      s.setDepth(1);
      return s as unknown as Movable;
    }
    const r = this.add.rectangle(x, y, TILE, TILE, color);
    r.setDepth(1);
    r.setStrokeStyle(2, 0x000000, 0.4);
    return r as unknown as Movable;
  }

  update(_time: number, delta: number) {
    const dt = delta / 1000;

    // Ambient light motes drift gently (keep moving even during dialogue).
    for (const m of this.motes) {
      m.s.x += m.vx * dt;
      m.s.y += m.vy * dt;
      if (m.s.y < -24) m.s.y = this.H + 24;
      else if (m.s.y > this.H + 24) m.s.y = -24;
      if (m.s.x < -24) m.s.x = this.W + 24;
      else if (m.s.x > this.W + 24) m.s.x = -24;
    }

    if (this.paused) {
      this.dust?.stop();
      return;
    }

    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy += 1;
    // Touch D-pad contribution.
    vx += this.touch.x;
    vy += this.touch.y;
    vx = Phaser.Math.Clamp(vx, -1, 1);
    vy = Phaser.Math.Clamp(vy, -1, 1);

    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const len = Math.hypot(vx, vy);
      this.player.x = Phaser.Math.Clamp(
        this.player.x + (vx / len) * this.speed * dt,
        TILE / 2,
        this.W - TILE / 2,
      );
      this.player.y = Phaser.Math.Clamp(
        this.player.y + (vy / len) * this.speed * dt,
        TILE / 2,
        this.H - TILE / 2,
      );
    }

    // Footstep dust only while walking.
    if (this.dust) {
      if (moving) this.dust.start();
      else this.dust.stop();
    }

    // Drive the walk animation (4-direction; diagonals use the dominant axis).
    if (this.playerSprite) {
      if (moving) {
        const dir: Dir =
          Math.abs(vy) >= Math.abs(vx)
            ? vy < 0
              ? "back"
              : "front"
            : vx < 0
              ? "left"
              : "right";
        this.playerDir = dir;
        const animKey = `walk-${dir}`;
        if (
          this.playerSprite.anims.currentAnim?.key !== animKey ||
          !this.playerSprite.anims.isPlaying
        ) {
          this.playerSprite.play(animKey, true);
        }
      } else {
        // Idle → stop on the standing (first) frame of the last direction.
        this.playerSprite.anims.stop();
        this.playerSprite.setTexture(PLAYER_ANIM[this.playerDir][0]);
      }
    }

    // Proximity check → nearest NPC within radius.
    let closest: NpcSprite | null = null;
    let closestDist = this.interact;
    for (const s of this.npcs) {
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        s.obj.x,
        s.obj.y,
      );
      if (d < closestDist) {
        closest = s;
        closestDist = d;
      }
    }

    const nextNearby = closest?.npc ?? null;
    if (nextNearby?.id !== this.nearby?.id) {
      const prev = this.nearby;
      this.nearby = nextNearby;
      bus.emit("proximity", this.nearby);
      this.nearbyReact(prev, this.nearby);
    }
  }
}

export function createGame(parent: HTMLElement): Phaser.Game {
  const { w, h } = getWorldSize();
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: w,
    height: h,
    backgroundColor: "#1a2e1f",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [MainScene],
  });
}
