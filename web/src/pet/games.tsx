/**
 * Мини-игры питомца: «Башня вкусняшек» и «ASMR: пузыри и слайм».
 * Сервер выдаёт runId при старте (и списывает энергию), а при финише сам ограничивает очки по времени.
 */
import { useEffect, useRef, useState } from "react";
import { post, type ApiError, type FigureDto, type PetAction } from "../api";
import { useGame } from "../ui";
import { canShareStory, haptic, shareLink, shareStory, useBackButton } from "../tg";
import { asset } from "../util";
import { PetArt, petImage } from "./art";

export const GAMES = [
  { id: "tower", emoji: "🎂", name: "Башня вкусняшек", text: "Роняйте сладости ровно и не дайте башне упасть." },
  { id: "asmr", emoji: "🫧", name: "ASMR: пузыри и слайм", text: "Лопайте пузырьки и мните слайм. Со звуком и вибрацией." },
] as const;
export type GameId = (typeof GAMES)[number]["id"];

// ---------------------------------------------------------------- звук (Web Audio, без файлов)

const MUTE_KEY = "surprise-day-mute";
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } })();
let actx: AudioContext | undefined;
export function sfx(kind: "pop" | "squish" | "ping" | "thump") {
  if (muted) return;
  try { actx ??= new AudioContext(); } catch { return; }
  const a = actx, t = a.currentTime;
  if (kind === "pop" || kind === "squish") {
    const pop = kind === "pop", len = pop ? 0.05 : 0.14;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, pop ? 4 : 2);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), gn = a.createGain();
    src.buffer = buf; f.type = pop ? "bandpass" : "lowpass"; f.frequency.value = pop ? 1800 + Math.random() * 1400 : 450 + Math.random() * 300;
    gn.gain.value = pop ? 0.9 : 0.7;
    src.connect(f).connect(gn).connect(a.destination); src.start(t);
  } else {
    const o = a.createOscillator(), gn = a.createGain(), ping = kind === "ping";
    o.type = "sine"; o.frequency.setValueAtTime(ping ? 880 : 150, t);
    o.frequency.exponentialRampToValueAtTime(ping ? 1320 : 60, t + 0.14);
    gn.gain.setValueAtTime(0.35, t); gn.gain.exponentialRampToValueAtTime(0.001, t + (ping ? 0.25 : 0.18));
    o.connect(gn).connect(a.destination); o.start(t); o.stop(t + 0.3);
  }
}

// ---------------------------------------------------------------- оболочка игры

type Finish = { score: number; coins: number; xp: number; record: boolean };

export function GameRunner({ game, pet, level, onClose }: { game: GameId; pet: FigureDto; level: number; onClose: () => void }) {
  const { toast, refresh } = useGame();
  const [run, setRun] = useState<{ id: number; key: number } | null>(null);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<Finish | null>(null);
  const [mute, setMute] = useState(muted);
  const [story, setStory] = useState(false);
  const meta = GAMES.find((g) => g.id === game)!;

  const start = async () => {
    try {
      const r = await post<PetAction<{ runId: number }>>("/api/games/start", { game });
      setScore(0); setResult(null); setRun({ id: r.result.runId, key: Date.now() });
    } catch (e) { toast((e as ApiError).message); await refresh(); onClose(); }
  };
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; void start(); } }, []);
  useEffect(() => useBackButton(onClose), [onClose]);

  const end = async (final: number) => {
    if (!run) return;
    const id = run.id; setRun(null);
    try {
      const r = await post<PetAction<Finish>>(`/api/games/${id}/finish`, { score: final });
      setResult(r.result);
      r.messages.forEach((m, i) => setTimeout(() => toast(m), 600 + i * 1600));
      haptic.success();
    } catch (e) { toast((e as ApiError).message); onClose(); }
    void refresh();
  };
  const toggleMute = () => { muted = !muted; setMute(muted); try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* приватный режим */ } };

  if (result) {
    return (
      <div className="layer center">
        <div className="pcard" role="dialog" aria-modal="true">
          <div className="pic"><PetArt f={pet} expr="happy" level={level} /></div>
          <h2>{result.record ? "Новый рекорд!" : "Игра окончена"}</h2>
          <p>Очки: <b className="num">{result.score}</b></p>
          <p><span className="pill num"><i className="coin" />+{result.coins}</span> <span className="pill num">+{result.xp} опыта</span></p>
          <p className="muted">Настроение питомца +15</p>
          <button className="btn" style={{ width: "100%" }} onClick={() => setStory(true)}>📲 Поделиться в сторис</button>
          <div className="btn-row" style={{ width: "100%" }}>
            <button className="btn ghost" onClick={() => void start()}>Ещё раз</button>
            <button className="btn ghost" onClick={onClose}>Готово</button>
          </div>
        </div>
        {story && <StorySheet game={meta} score={result.score} record={result.record} pet={pet} level={level} onClose={() => setStory(false)} />}
      </div>
    );
  }
  return (
    <div className="game" role="dialog" aria-label={meta.name}>
      <div className="game-head">
        <button className="btn sm ghost" onClick={() => void end(score)} disabled={!run}>✕ Выйти</button>
        <b>{meta.name}</b>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn sm ghost" onClick={toggleMute} aria-label={mute ? "Включить звук" : "Выключить звук"}>{mute ? "🔇" : "🔊"}</button>
          <span className="pill num">{score}</span>
        </span>
      </div>
      <div className="game-body">
        {run && (game === "tower"
          ? <Tower key={run.key} pet={pet} level={level} onScore={setScore} onEnd={(s) => void end(s)} />
          : <Asmr key={run.key} onScore={setScore} onEnd={(s) => void end(s)} />)}
        {!run && <div className="spinner" aria-label="Загрузка" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- сторис

function StorySheet({ game, score, record, pet, level, onClose }: { game: (typeof GAMES)[number]; score: number; record: boolean; pet: FigureDto; level: number; onClose: () => void }) {
  const { state: s } = useGame();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => useBackButton(onClose), [onClose]);
  useEffect(() => { void storyCard(game, score, record, pet, level).then(setUrl); }, []);
  const text = `${game.emoji} ${record ? "Мой рекорд" : "Мой результат"} в «${game.name}»: ${score}! Сможешь больше?`;
  return (
    <div className="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <h2>Сторис готова</h2>
        <div className="story">{url ? <img src={url} alt={`Картинка результата: ${score} очков`} /> : <div className="spinner" />}</div>
        {canShareStory()
          ? <button className="btn" onClick={() => shareStory(new URL(asset(`/stories/${game.id}.png`), location.href).href, `${text} ${s.refLink}`)}>Опубликовать в сторис</button>
          : <p className="muted">Нажмите на картинку и удерживайте, чтобы сохранить её и выложить в сторис.</p>}
        <button className="btn ghost" onClick={() => shareLink(s.refLink, text)}>Отправить другу</button>
        <button className="btn ghost" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

async function storyCard(game: (typeof GAMES)[number], score: number, record: boolean, pet: FigureDto, level: number) {
  const cv = document.createElement("canvas"); cv.width = 720; cv.height = 1280;
  const c = cv.getContext("2d")!, img = await petImage(pet, "happy", level);
  const bg = c.createLinearGradient(0, 0, 720, 1280); bg.addColorStop(0, "#FF7A1A"); bg.addColorStop(0.55, "#FF5E9A"); bg.addColorStop(1, "#8B5CF6");
  c.fillStyle = bg; c.fillRect(0, 0, 720, 1280);
  c.fillStyle = "rgba(255,255,255,.12)";
  for (let i = 0; i < 26; i++) { c.beginPath(); c.arc((i * 137) % 720, (i * 211) % 1280, 10 + (i % 5) * 9, 0, 7); c.fill(); }
  c.textAlign = "center"; c.fillStyle = "#fff";
  c.font = "800 44px Unbounded, system-ui"; c.fillText("Сюрприз дня", 360, 130);
  c.font = "700 34px Nunito, system-ui"; c.fillText(`${game.emoji} ${game.name}`, 360, 200);
  if (img) c.drawImage(img, 160, 260, 400, 400);
  c.font = "800 190px Unbounded, system-ui"; c.fillText(String(score), 360, 880);
  c.font = "800 38px Nunito, system-ui"; c.fillText(record ? "Мой новый рекорд!" : "очков", 360, 950);
  c.fillStyle = "#fff"; c.beginPath(); c.roundRect(110, 1060, 500, 100, 50); c.fill();
  c.fillStyle = "#FF5E9A"; c.font = "800 38px Nunito, system-ui"; c.fillText("Сможешь больше?", 360, 1123);
  return cv.toDataURL("image/png");
}

// ---------------------------------------------------------------- башня вкусняшек

type Block = { w: number; h: number; c: string; s: string; x: number; y?: number };
const KINDS = [
  { w: 128, h: 20, c: "#E9B872", s: "#C98A3E" }, // панкейк
  { w: 112, h: 34, c: "#FF9EC4", s: "#FFF4E6" }, // тортик
  { w: 86, h: 28, c: "#9FD8C8", s: "#FFF8F0" }, // макарон
  { w: 100, h: 26, c: "#7A4428", s: "#A0653D" }, // шоколад
  { w: 94, h: 30, c: "#C9A7F5", s: "#FFE58A" }, // пончик
];

/** Роняем сладости на тарелку; если сладость свесилась больше чем наполовину или центр тяжести башни ушёл за край — конец */
function Tower({ pet, level, onScore, onEnd }: { pet: FigureDto; level: number; onScore: (n: number) => void; onEnd: (score: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, ctx = cv.getContext("2d")!, dpr = devicePixelRatio || 1;
    const r0 = cv.getBoundingClientRect(); cv.width = r0.width * dpr; cv.height = r0.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r0.width, H = r0.height, GROUND = H - 56;
    const base = { x: W / 2, w: Math.min(170, W * 0.5) };
    const stack: Required<Block>[] = [];
    let top = 0, cam = 0, score = 0, combo = 0, state: "move" | "fall" | "lost" = "move", over = false, raf = 0, last = performance.now();
    let cur!: Block, dir = 1, fallY = 0, vy = 0, jumpT = 0, tilt = 0;
    let lost: (Block & { y: number; vy: number; dir: number }) | null = null;
    let img: HTMLImageElement | null = null;
    void petImage(pet, "happy", level).then((i) => { img = i; });
    const texts: { t: string; x: number; y: number; life: number }[] = [];
    const say = (t: string, x: number, y: number) => texts.push({ t, x, y, life: 1 });
    const swing = () => Math.min(W / 2 - cur.w / 2, 70 + stack.length * 4);
    const next = () => { const k = KINDS[Math.floor(Math.random() * KINDS.length)]; dir = Math.random() < 0.5 ? 1 : -1; cur = { ...k, x: base.x }; cur.x = base.x - dir * swing(); state = "move"; };
    next();
    const com = () => { let m = 0, sx = 0; for (const b of stack) { const mm = b.w * b.h; m += mm; sx += b.x * mm; } return m ? sx / m : base.x; };
    const drop = () => { if (state !== "move" || over) return; state = "fall"; fallY = top + 120; vy = 0; };
    const key = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); drop(); } };
    cv.addEventListener("pointerdown", drop);
    addEventListener("keydown", key);
    const finish = () => { if (over) return; over = true; onEnd(score); };
    const lose = (why: string) => { state = "lost"; haptic.error(); sfx("thump"); say(why, W / 2, H * 0.35); setTimeout(finish, 1300); };

    function land() {
      const under = stack.length ? stack[stack.length - 1] : base;
      const off = cur.x - under.x;
      if (Math.abs(off) > under.w / 2) { lost = { ...cur, y: top, vy: 0, dir: Math.sign(off) }; return lose("Упало!"); }
      if (Math.abs(off) < 6) {
        cur.x = under.x; combo++; score += 1 + Math.min(combo, 5);
        say(combo > 1 ? `Идеально ×${combo}` : "Идеально!", cur.x, GROUND - (top - cam) - 40); sfx("ping"); haptic.tap(); jumpT = 1;
      } else { combo = 0; score += 1; sfx("thump"); haptic.soft(8); }
      stack.push({ ...cur, y: top }); top += cur.h; onScore(score);
      const lean = (com() - base.x) / (base.w / 2);
      if (Math.abs(lean) > 0.9) { tilt = Math.sign(lean) * 0.02; return lose("Башня рухнула!"); }
      if (Math.abs(lean) > 0.6) say("Шатается!", W / 2, 60);
      next();
    }
    const block = (b: Block, y: number) => {
      const x = b.x - b.w / 2, sy = GROUND - (y - cam) - b.h;
      ctx.fillStyle = b.c; ctx.beginPath(); ctx.roundRect(x, sy, b.w, b.h, Math.min(12, b.h / 2)); ctx.fill();
      ctx.fillStyle = b.s; ctx.fillRect(x + 4, sy + b.h * 0.42, b.w - 8, Math.max(3, b.h * 0.18));
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x + 10, sy + 3, b.w - 20, 3);
    };
    function frame(t: number) {
      const dt = Math.min(50, t - last) / 1000; last = t;
      if (state === "move") {
        const sp = 120 + stack.length * 8, lim = swing();
        cur.x += dir * sp * dt;
        if (cur.x > base.x + lim) { cur.x = base.x + lim; dir = -1; }
        if (cur.x < base.x - lim) { cur.x = base.x - lim; dir = 1; }
      } else if (state === "fall") {
        vy += 2400 * dt; fallY -= vy * dt;
        if (fallY <= top) { fallY = top; land(); }
      }
      cam += (Math.max(0, top - (GROUND - H * 0.42)) - cam) * Math.min(1, dt * 6);
      if (state === "lost" && tilt) tilt = Math.sign(tilt) * Math.min(0.2, Math.abs(tilt) * (1 + dt * 4));
      const h = Math.min(1, top / 1400), bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, `hsl(${330 - h * 80} 90% ${92 - h * 30}%)`); bg.addColorStop(1, `hsl(${210 - h * 40} 90% ${92 - h * 25}%)`);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(base.x, GROUND + cam); ctx.rotate(tilt * 8); ctx.translate(-base.x, -(GROUND + cam));
      ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.ellipse(base.x, GROUND + cam + 6, base.w / 2 + 14, 12, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.08)"; ctx.beginPath(); ctx.ellipse(base.x, GROUND + cam + 9, base.w / 2, 6, 0, 0, 7); ctx.fill();
      for (const b of stack) block(b, b.y);
      ctx.restore();
      if (state === "move" || state === "fall") block(cur, state === "fall" ? fallY : top + 120);
      if (lost) { lost.vy += 1800 * dt; lost.y -= lost.vy * dt; lost.x += lost.dir * 120 * dt; block(lost, lost.y); }
      jumpT = Math.max(0, jumpT - dt * 2.5);
      if (img) ctx.drawImage(img, 8, H - 86 - Math.sin(jumpT * Math.PI) * 26, 76, 76);
      ctx.textAlign = "center"; ctx.font = "800 20px Unbounded, system-ui";
      for (const tx of texts) { tx.life -= dt * 0.9; tx.y -= 30 * dt; ctx.globalAlpha = Math.max(0, tx.life); ctx.fillStyle = "#2A1B14"; ctx.fillText(tx.t, tx.x, tx.y); }
      ctx.globalAlpha = 1;
      for (let i = texts.length - 1; i >= 0; i--) if (texts[i].life <= 0) texts.splice(i, 1);
      ctx.textAlign = "right"; ctx.font = "800 15px Nunito, system-ui"; ctx.fillStyle = "#2A1B14";
      ctx.fillText(`Этаж ${stack.length}`, W - 12, 24);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { over = true; cancelAnimationFrame(raf); removeEventListener("keydown", key); cv.removeEventListener("pointerdown", drop); };
  }, []);
  return (
    <>
      <canvas ref={ref} className="gcanvas" aria-label="Игровое поле: нажмите, чтобы уронить сладость" />
      <p className="muted" style={{ marginTop: 10, textAlign: "center" }}>Нажмите, чтобы уронить. Ровно в центр — бонус!</p>
    </>
  );
}

// ---------------------------------------------------------------- ASMR

const TOTAL = 25;
const COLORS = ["#7FC8F8", "#FF9EC4", "#9FD8C8", "#C9A7F5", "#FFB86B"];

/** Лопаем пузырчатую плёнку, потом мнём слайм, и так по кругу 25 секунд */
function Asmr({ onScore, onEnd }: { onScore: (n: number) => void; onEnd: (score: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(TOTAL);
  useEffect(() => {
    const box = ref.current!, t0 = Date.now();
    let score = 0, over = false, pressing = false, round = 0;
    let onMove: ((e: PointerEvent) => void) | null = null;
    const add = (n: number, text?: string, x = 0, y = 0) => {
      score += n; onScore(score);
      if (!text) return;
      const r = box.getBoundingClientRect(), d = document.createElement("div");
      d.className = "fx"; d.textContent = text; d.style.left = x - r.left + "px"; d.style.top = y - r.top - 10 + "px";
      box.appendChild(d); setTimeout(() => d.remove(), 1100);
    };
    function bubbles() {
      const color = COLORS[round++ % COLORS.length];
      box.innerHTML = `<div class="wrap-sheet">${Array.from({ length: 48 }, () => `<i class="bub ${Math.random() < 0.07 ? "gold" : ""}" style="--bc:${color}"></i>`).join("")}</div>`;
      let rest = 48;
      onMove = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || !el.classList.contains("bub") || el.classList.contains("popped")) return;
        el.classList.add("popped"); rest--; sfx("pop"); haptic.soft();
        const gold = el.classList.contains("gold");
        add(gold ? 5 : 1, gold ? "+5 ✨" : undefined, e.clientX, e.clientY);
        if (!rest) { add(5, "Лист готов! +5", e.clientX, e.clientY); onMove = null; setTimeout(() => !over && slime(), 350); }
      };
    }
    function slime() {
      const color = COLORS[round % COLORS.length];
      box.innerHTML = `<div class="slime-zone" style="--sc:${color}"><div class="blob"></div><div class="smeter"><i></i></div><p class="muted">Мните слайм пальцем</p></div>`;
      const blob = box.querySelector<HTMLElement>(".blob")!, sm = box.querySelector<HTMLElement>(".smeter i")!;
      let prog = 0, lx: number | null = null, ly = 0, lastS = 0, part = 0;
      onMove = (e) => {
        const r = blob.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { lx = null; return; }
        const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
        blob.classList.add("press");
        blob.style.transform = `translate(${nx * 18}px, ${ny * 18}px) scale(${1 + Math.abs(nx) * 0.22}, ${1 + Math.abs(ny) * 0.22})`;
        blob.style.borderRadius = `${50 + nx * 20}% ${50 - nx * 20}% ${50 + ny * 20}% ${50 - ny * 20}% / ${50 - ny * 18}% ${50 + nx * 18}% ${50 - nx * 18}% ${50 + ny * 18}%`;
        const d = document.createElement("span"); d.className = "dimple"; d.style.left = (nx + 0.5) * 100 + "%"; d.style.top = (ny + 0.5) * 100 + "%";
        blob.appendChild(d); setTimeout(() => d.remove(), 900);
        if (lx != null) prog += Math.hypot(e.clientX - lx, e.clientY - ly) / 2200;
        lx = e.clientX; ly = e.clientY;
        sm.style.width = Math.min(100, prog * 100) + "%";
        if (Date.now() - lastS > 110) { lastS = Date.now(); sfx("squish"); haptic.soft(4); }
        while (part < Math.floor(prog * 10) && part < 10) { part++; add(1); }
        if (prog >= 1) { onMove = null; add(10, "Слайм готов! +10", e.clientX, e.clientY); setTimeout(() => !over && bubbles(), 450); }
      };
    }
    const release = () => {
      pressing = false;
      const b = box.querySelector<HTMLElement>(".blob");
      if (b) { b.classList.remove("press"); b.style.transform = ""; b.style.borderRadius = ""; }
    };
    const down = (e: PointerEvent) => { pressing = true; onMove?.(e); };
    const move = (e: PointerEvent) => { if (pressing || (e.pointerType === "mouse" && e.buttons)) onMove?.(e); };
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointercancel", release);
    addEventListener("pointerup", release);
    const timer = setInterval(() => {
      const l = TOTAL - Math.floor((Date.now() - t0) / 1000);
      setLeft(Math.max(0, l));
      if (l <= 0 && !over) { over = true; clearInterval(timer); onEnd(score); }
    }, 250);
    bubbles();
    return () => {
      over = true; clearInterval(timer);
      box.removeEventListener("pointerdown", down); box.removeEventListener("pointermove", move); box.removeEventListener("pointercancel", release);
      removeEventListener("pointerup", release);
    };
  }, []);
  return (
    <>
      <div ref={ref} className="asmr" />
      <p className="muted" style={{ marginTop: 10, textAlign: "center" }}>Осталось <b className="num">{left}</b> с · золотой пузырь +5</p>
    </>
  );
}
