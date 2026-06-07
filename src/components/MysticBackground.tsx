"use client";

import { useEffect, useRef } from "react";

// Canvas hyperspace starfield — stars streaking out from the center, with
// motion trails, for a "racing through the cosmos" backdrop.
export default function MysticBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let fov = 0;
    let maxZ = 0;
    let speed = 0;
    let dpr = 1;

    const COLORS = ["#eef2ff", "#eef2ff", "#eef2ff", "#c4b5fd", "#fcd9a0", "#a7f3d0"];
    type Star = { x: number; y: number; z: number; px: number; py: number; c: string };
    let stars: Star[] = [];

    const project = (s: Star): [number, number] => {
      const f = fov / s.z;
      return [cx + s.x * f, cy + s.y * f];
    };

    const spawn = (s: Star, fresh = false) => {
      s.x = (Math.random() - 0.5) * w;
      s.y = (Math.random() - 0.5) * h;
      s.z = fresh ? Math.random() * maxZ : maxZ;
      s.c = COLORS[(Math.random() * COLORS.length) | 0];
      const [px, py] = project(s);
      s.px = px;
      s.py = py;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      cx = w / 2;
      cy = h / 2;
      fov = Math.max(w, h);
      maxZ = fov;
      speed = Math.max(9, fov * 0.018);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(1200, Math.floor((w * h) / 1000));
      stars = Array.from({ length: count }, () => {
        const s: Star = { x: 0, y: 0, z: 1, px: 0, py: 0, c: "#fff" };
        spawn(s, true);
        return s;
      });
      ctx.fillStyle = "#05040a";
      ctx.fillRect(0, 0, w, h);
    };

    let raf = 0;
    const draw = () => {
      // translucent fill → leaves longer, brighter trails
      ctx.fillStyle = "rgba(5,4,10,0.18)";
      ctx.fillRect(0, 0, w, h);

      for (const s of stars) {
        s.z -= speed;
        if (s.z < 1) {
          spawn(s);
          continue;
        }
        const [x, y] = project(s);
        const depth = 1 - s.z / maxZ; // 0 far → 1 near
        ctx.strokeStyle = s.c;
        ctx.globalAlpha = Math.min(1, depth * 1.4);
        ctx.lineWidth = depth * 2.4 + 0.3;
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(x, y);
        ctx.stroke();
        s.px = x;
        s.py = y;
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    const drawStatic = () => {
      ctx.fillStyle = "#05040a";
      ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        const [x, y] = project(s);
        const depth = 1 - s.z / maxZ;
        ctx.globalAlpha = Math.min(1, depth * 1.4);
        ctx.fillStyle = s.c;
        ctx.fillRect(x, y, depth * 2 + 0.5, depth * 2 + 0.5);
      }
      ctx.globalAlpha = 1;
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) drawStatic();
    else raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#05040a]">
      <canvas ref={canvasRef} className="absolute inset-0" />
      {/* mystical color wash + vignette over the warp field */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 600px at 50% 0%, rgba(139,92,246,0.20), transparent 60%)," +
            "radial-gradient(800px 500px at 90% 100%, rgba(245,185,66,0.12), transparent 55%)," +
            "radial-gradient(800px 500px at 8% 90%, rgba(16,185,129,0.12), transparent 55%)," +
            "radial-gradient(circle at 50% 48%, transparent 60%, rgba(0,0,0,0.35) 100%)",
        }}
      />
    </div>
  );
}
