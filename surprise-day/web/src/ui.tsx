import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { FigureDto, GameState, Rarity } from "./api";
import { asset, RLABEL } from "./util";
import { haptic, useBackButton } from "./tg";

// ------------------------------------------------------------------ контекст игры

export type Game = {
  state: GameState;
  refresh: () => Promise<void>;
  /** Время сервера: таймеры считаются от него, а не от часов телефона */
  now: () => number;
  toast: (msg: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
};
export const GameCtx = createContext<Game | null>(null);
export const useGame = () => useContext(GameCtx)!;

export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

// ------------------------------------------------------------------ картинки

export function Fig({ f, className = "fig" }: { f: Pick<FigureDto, "image" | "name">; className?: string }) {
  return <div className={className}><img src={asset(f.image)} alt={f.name} loading="lazy" draggable={false} /></div>;
}
export function Mini({ f }: { f: Pick<FigureDto, "image" | "name"> }) {
  return <span className="mini"><img src={asset(f.image)} alt={f.name} /></span>;
}

const EGG_PATH = "M100 8C162 8 192 110 192 162C192 222 152 252 100 252C48 252 8 222 8 162C8 110 38 8 100 8Z";
const zig = Array.from({ length: 11 }, (_, i) => [i * 20, i % 2 ? 150 : 132]);
const zigStr = zig.map((p) => p.join(",")).join(" ");
const half = (h: "top" | "bot") => `
  <g class="half ${h}" clip-path="url(#c${h})">
    <path d="${EGG_PATH}" class="shell"/>
    <path class="milk" d="M6 150C50 120 120 178 194 136L195 158C124 202 52 146 7 176Z" opacity=".95"/>
    <path d="M30 96C60 84 110 112 168 86" stroke-width="6" opacity=".35" style="stroke:var(--milk);fill:none"/>
    <path d="${EGG_PATH}" fill="url(#shine)"/>
  </g>`;
export const EGG_SVG = `
<svg class="egg-svg" viewBox="0 0 200 260" aria-hidden="true">
  <defs>
    <clipPath id="ctop"><polygon points="0,0 200,0 ${[...zig].reverse().map((p) => p.join(",")).join(" ")}"/></clipPath>
    <clipPath id="cbot"><polygon points="${zigStr} 200,260 0,260"/></clipPath>
    <radialGradient id="shine" cx=".33" cy=".26" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  ${half("top")}${half("bot")}
  <polyline class="crack" points="${zigStr}"/>
</svg>`;

export const FLAME = <svg className="flame" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2s5.5 5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.3 1.1-3.9 2.2-5 0 2.1 1 3.3 2.2 3.3C10.9 7.6 12 5 12 2z" /></svg>;
export const STAR = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" /></svg>;

// ------------------------------------------------------------------ окна

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => useBackButton(onClose), [onClose]);
  return (
    <div className="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        {children}
        <button className="btn ghost" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3200);
  }, []);
  const node = msg ? <div className="toast" role="status" key={msg}>{msg}</div> : null;
  return { toast, node };
}

// ------------------------------------------------------------------ выпала фигурка

export type RevealData = { figure: FigureDto; outcome: string; outcomeNew: boolean; extra: string[] };

export function Reveal({ data, onClose }: { data: RevealData; onClose: () => void }) {
  const r = data.figure.rarity;
  useEffect(() => {
    haptic.success();
    if (r === "epic" || r === "legendary") return confetti(r === "legendary" ? 220 : 110);
  }, [r]);
  useEffect(() => useBackButton(onClose), [onClose]);
  return (
    <div className="reveal" data-rarity={r} role="dialog" aria-modal="true" aria-label={data.figure.name}>
      <div className="rays" />
      <div className="reveal-card">
        <span className="rar-chip">{RLABEL[r]}</span>
        <Fig f={data.figure} />
        <h2>{data.figure.name}</h2>
        {data.figure.description && <p className="muted">{data.figure.description}</p>}
        <p className={`outcome ${data.outcomeNew ? "new" : ""}`}>{data.outcome}</p>
        {data.extra.map((x) => <p className="extra" key={x}>{x}</p>)}
        <button className="btn" autoFocus onClick={onClose}>Забрать</button>
      </div>
    </div>
  );
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function confetti(n: number) {
  if (reduced()) return;
  const c = document.createElement("canvas");
  c.id = "confetti";
  document.body.appendChild(c);
  const ctx = c.getContext("2d")!, dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const cols = ["#FF7A1A", "#F2B92A", "#9446DB", "#2F74E0", "#2E9E5B", "#FF4D6D"];
  const ps = Array.from({ length: n }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.4, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
    r: Math.random() * 6 + 4, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: cols[Math.floor(Math.random() * cols.length)],
  }));
  const t0 = performance.now();
  let raf = 0;
  const frame = (t: number) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (t - t0 < 3200) raf = requestAnimationFrame(frame); else c.remove();
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); c.remove(); };
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, reduced() ? 30 : ms));
export const rarityAttr = (r: Rarity) => ({ "data-rarity": r });
