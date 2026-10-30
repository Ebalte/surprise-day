/**
 * Мини-игры питомца: башня, ASMR, ритм, сортировка и прыжки.
 * Сервер выдаёт runId при старте (и списывает энергию), а при финише сам ограничивает очки по времени.
 * После игры показывается рейтинг дня по этой игре.
 */
import { useEffect, useRef, useState } from "react";
import { API_URL, api, post, type ApiError, type DayBoard, type FigureDto, type PetAction } from "../api";
import { useGame } from "../ui";
import { canShareStory, haptic, shareLink, shareStory, useBackButton } from "../tg";
import { PetArt, petImage } from "./art";

export const GAMES = [
  { id: "tower", emoji: "🎂", name: "Башня вкусняшек", text: "Роняйте сладости ровно и не дайте башне упасть." },
  { id: "asmr", emoji: "🫧", name: "ASMR: пузыри и слайм", text: "Лопайте пузырьки и мните слайм. Со звуком и вибрацией." },
  { id: "rhythm", emoji: "🎵", name: "Ритм-пати", text: "Питомец танцует — жмите на ноты точно в бит." },
  { id: "sort", emoji: "🧺", name: "Сортировка", text: "Вкусняшки питомцу, мусор в корзину. Быстрее и быстрее!" },
  { id: "jump", emoji: "🦘", name: "Прыг-скок", text: "Питомец бежит — прыгайте через камни и собирайте ягоды." },
] as const;
export type GameId = (typeof GAMES)[number]["id"];

// ---------------------------------------------------------------- звук (Web Audio, без файлов)

const MUTE_KEY = "surprise-day-mute";
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } })();
let actx: AudioContext | undefined;
export function sfx(kind: "pop" | "squish" | "ping" | "thump" | "beat") {
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
    gn.gain.setValueAtTime(kind === "beat" ? 0.12 : 0.35, t); gn.gain.exponentialRampToValueAtTime(0.001, t + (ping ? 0.25 : 0.18));
    o.connect(gn).connect(a.destination); o.start(t); o.stop(t + 0.3);
  }
}

// ---------------------------------------------------------------- оболочка игры

type Finish = { score: number; coins: number; xp: number; record: boolean; team: { points: number; total: number; done: boolean } | null };
type GameProps = { pet: FigureDto; level: number; outfit: string | null; onScore: (n: number) => void; onEnd: (score: number) => void };

export function GameRunner({ game, pet, level, target = "own", onClose }: { game: GameId; pet: FigureDto; level: number; target?: "own" | "pair"; onClose: () => void }) {
  const { state: gs, toast, refresh } = useGame();
  const outfit = gs.pet.style.outfit;
  const [run, setRun] = useState<{ id: number; key: number } | null>(null);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<Finish | null>(null);
  const [mute, setMute] = useState(muted);
  const [story, setStory] = useState(false);
  const [board, setBoard] = useState<DayBoard | null>(null);
  const meta = GAMES.find((g) => g.id === game)!;

  const start = async () => {
    try {
      const r = await post<PetAction<{ runId: number }>>("/api/games/start", { game, pet: target });
      setScore(0); setResult(null); setBoard(null); setRun({ id: r.result.runId, key: Date.now() });
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
      api<DayBoard>(`/api/games/${game}/leaderboard`).then(setBoard).catch(() => setBoard({ rows: [], me: null, total: 0 }));
    } catch (e) { toast((e as ApiError).message); onClose(); }
    void refresh();
  };
  const toggleMute = () => { muted = !muted; setMute(muted); try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* приватный режим */ } };

  if (result) {
    return (
      <div className="layer center">
        <div className="pcard" role="dialog" aria-modal="true">
          <div className="pic"><PetArt f={pet} expr="happy" level={level} outfit={outfit} /></div>
          <h2>{result.record ? "Новый рекорд!" : "Игра окончена"}</h2>
          <p>Очки: <b className="num">{result.score}</b></p>
          <p><span className="pill num"><i className="coin" />+{result.coins}</span> <span className="pill num">+{result.xp} опыта</span></p>
          <p className="muted">Настроение питомца +15</p>
          {result.team && <p className="team-line">🏆 В командную цель: +{result.team.points} · {result.team.done ? "цель дня выполнена!" : `${result.team.total}/${gs.pair?.today.goal ?? 300}`}</p>}
          <DayRating board={board} />
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
        {run && (() => {
          const props: GameProps = { pet, level, outfit, onScore: setScore, onEnd: (s) => void end(s) };
          const G = { tower: Tower, asmr: Asmr, rhythm: Rhythm, sort: Sort, jump: Jump }[game];
          return <G key={run.key} {...props} />;
        })()}
        {!run && <div className="spinner" aria-label="Загрузка" />}
      </div>
    </div>
  );
}

/** Рейтинг дня по игре: топ-10 за сегодня и ваше место */
function DayRating({ board }: { board: DayBoard | null }) {
  if (!board) return <div className="day-rating"><div className="spinner" /></div>;
  if (!board.rows.length) return <div className="day-rating"><b>Рейтинг дня</b><p className="muted">Сегодня ещё никто не набрал очков в этой игре. Станьте первым!</p></div>;
  const meIn = board.rows.some((r) => r.you);
  return (
    <div className="day-rating">
      <div className="dr-head"><b>Рейтинг дня</b>{board.me && <span className="muted">вы {board.me.place} из {board.total}</span>}</div>
      {board.rows.map((r) => (
        <div key={r.place} className={`lb-row ${r.you ? "you" : ""}`}>
          <span className="pos num">{r.place <= 3 ? ["🥇", "🥈", "🥉"][r.place - 1] : r.place}</span>
          <span className="nm">{r.you ? "Вы" : r.name}{r.partner ? " 💞" : ""}</span>
          <span className="num">{r.score}</span>
        </div>
      ))}
      {board.me && !meIn && <div className="lb-row you"><span className="pos num">{board.me.place}</span><span className="nm">Вы</span><span className="num">{board.me.score}</span></div>}
    </div>
  );
}

// ---------------------------------------------------------------- сторис

function StorySheet({ game, score, record, pet, level, onClose }: { game: (typeof GAMES)[number]; score: number; record: boolean; pet: FigureDto; level: number; onClose: () => void }) {
  const { state: s, toast } = useGame();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bot = /t\.me\/([^/?]+)/.exec(s.refLink)?.[1];
  useEffect(() => useBackButton(onClose), [onClose]);
  useEffect(() => { void storyCard(game, score, record, pet, level, bot, s.pet.style.outfit).then(setUrl); }, []);
  const text = `${game.emoji} ${record ? "Мой рекорд" : "Мой результат"} в «${game.name}»: ${score}! Сможешь больше?`;
  // Telegram берёт картинку сторис по ссылке, поэтому сначала кладём именно эту карточку на сервер
  const publish = async () => {
    if (!url) return;
    setBusy(true);
    try {
      const r = await post<{ url: string }>("/api/stories", { image: url });
      shareStory(API_URL + r.url, text, { url: s.refLink, name: "Играть" });
    } catch (e) { toast((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div className="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <h2>Сторис готова</h2>
        <div className="story">{url ? <img src={url} alt={`Картинка результата: ${score} очков`} /> : <div className="spinner" />}</div>
        {canShareStory()
          ? <button className="btn" disabled={!url || busy} onClick={() => void publish()}>{busy ? "Готовим сторис…" : "Опубликовать в сторис"}</button>
          : <p className="muted">Нажмите на картинку и удерживайте, чтобы сохранить её и выложить в сторис.</p>}
        <button className="btn ghost" onClick={() => shareLink(s.refLink, text)}>Отправить другу</button>
        <button className="btn ghost" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

/** Карточка 9:16 (JPEG): питомец, счёт и куда идти играть */
async function storyCard(game: (typeof GAMES)[number], score: number, record: boolean, pet: FigureDto, level: number, bot?: string, outfit?: string | null) {
  const cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1920;
  const c = cv.getContext("2d")!, img = await petImage(pet, "happy", level, outfit);
  c.scale(1.5, 1.5);
  const bg = c.createLinearGradient(0, 0, 720, 1280); bg.addColorStop(0, "#FF7A1A"); bg.addColorStop(0.55, "#FF5E9A"); bg.addColorStop(1, "#8B5CF6");
  c.fillStyle = bg; c.fillRect(0, 0, 720, 1280);
  c.fillStyle = "rgba(255,255,255,.12)";
  for (let i = 0; i < 26; i++) { c.beginPath(); c.arc((i * 137) % 720, (i * 211) % 1280, 10 + (i % 5) * 9, 0, 7); c.fill(); }
  c.textAlign = "center"; c.fillStyle = "#fff";
  c.font = "800 44px Unbounded, system-ui"; c.fillText("Сюрприз дня", 360, 150);
  c.font = "700 34px Nunito, system-ui"; c.fillText(`${game.emoji} ${game.name}`, 360, 215);
  if (img) c.drawImage(img, 170, 270, 380, 380);
  c.font = "800 190px Unbounded, system-ui"; c.fillText(String(score), 360, 870);
  c.font = "800 38px Nunito, system-ui"; c.fillText(record ? "Мой новый рекорд!" : "очков", 360, 940);
  c.font = "800 52px Unbounded, system-ui"; c.fillText("Сможешь больше?", 360, 1060);
  // Внизу место под кнопку-ссылку Telegram, поэтому только подсказка, где искать игру
  if (bot) { c.font = "700 32px Nunito, system-ui"; c.globalAlpha = 0.9; c.fillText(`Играй в Telegram: @${bot}`, 360, 1125); c.globalAlpha = 1; }
  return cv.toDataURL("image/jpeg", 0.86);
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
function Tower({ pet, level, outfit, onScore, onEnd }: GameProps) {
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
    void petImage(pet, "happy", level, outfit).then((i) => { img = i; });
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
function Asmr({ onScore, onEnd }: GameProps) {
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

// ---------------------------------------------------------------- общее для canvas-игр

/** Canvas под размер экрана с учётом плотности пикселей */
function fitCanvas(cv: HTMLCanvasElement) {
  const ctx = cv.getContext("2d")!, dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height };
}
type Floater = { t: string; x: number; y: number; life: number };
function drawFloaters(ctx: CanvasRenderingContext2D, list: Floater[], dt: number) {
  ctx.textAlign = "center"; ctx.font = "800 18px Unbounded, system-ui";
  for (const f of list) { f.life -= dt * 1.2; f.y -= 40 * dt; ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = "#fff"; ctx.fillText(f.t, f.x, f.y); }
  ctx.globalAlpha = 1;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].life <= 0) list.splice(i, 1);
}

// ---------------------------------------------------------------- ритм-пати

/**
 * Три дорожки, ноты падают под бит 120 BPM. Точно в линию — 3 очка (+1 при комбо от 10), чуть мимо — 1.
 * Раунд 30 секунд, промах сбрасывает комбо.
 */
function Rhythm({ pet, level, outfit, onScore, onEnd }: GameProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, { ctx, W, H } = fitCanvas(cv);
    const BEAT = 0.5, TOTAL = 30, FALL = 1.6, LANES = 3, COLORS = ["#FF5E9A", "#FFD15C", "#5EC8FF"];
    const lineY = H - 90, laneW = W / LANES;
    let img: HTMLImageElement | null = null;
    void petImage(pet, "happy", level, outfit).then((i) => { img = i; });
    // Партитура: на каждый бит 0–2 ноты, иногда восьмые
    const notes: { t: number; lane: number; hit?: boolean; miss?: boolean }[] = [];
    for (let b = 4; b * BEAT < TOTAL - 0.5; b++) {
      const r = Math.random();
      if (r < 0.15) continue;
      const lane = Math.floor(Math.random() * LANES);
      notes.push({ t: b * BEAT, lane });
      if (r > 0.85) notes.push({ t: b * BEAT, lane: (lane + 1 + Math.floor(Math.random() * 2)) % LANES });
      else if (r > 0.7 && b > 20) notes.push({ t: b * BEAT + BEAT / 2, lane: Math.floor(Math.random() * LANES) });
    }
    const t0 = performance.now() + 600;
    let score = 0, combo = 0, raf = 0, over = false, lastBeat = -1, bounce = 0;
    const flashes = [0, 0, 0], floats: Floater[] = [];
    const song = () => (performance.now() - t0) / 1000;
    const hit = (lane: number) => {
      if (over) return;
      const now = song();
      flashes[lane] = 1;
      let best: (typeof notes)[number] | null = null;
      for (const n of notes) if (n.lane === lane && !n.hit && !n.miss && Math.abs(n.t - now) < 0.18 && (!best || Math.abs(n.t - now) < Math.abs(best.t - now))) best = n;
      if (!best) { combo = 0; return; }
      best.hit = true;
      const d = Math.abs(best.t - now), perfect = d < 0.08;
      combo++;
      const pts = perfect ? 3 + (combo >= 10 ? 1 : 0) : 1;
      score += pts; onScore(score);
      floats.push({ t: perfect ? (combo >= 10 ? `x${combo}!` : "Идеально") : "Неплохо", x: laneW * (lane + 0.5), y: lineY - 30, life: 1 });
      sfx("pop"); haptic.soft(perfect ? 10 : 5);
    };
    const down = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); hit(Math.min(LANES - 1, Math.floor(((e.clientX - r.left) / r.width) * LANES))); };
    const key = (e: KeyboardEvent) => { const i = ["ArrowLeft", "ArrowDown", "ArrowRight"].indexOf(e.key); const j = "asd".indexOf(e.key.toLowerCase()); if (i >= 0 || j >= 0) { e.preventDefault(); hit(i >= 0 ? i : j); } };
    cv.addEventListener("pointerdown", down); addEventListener("keydown", key);
    let last = performance.now();
    function frame(t: number) {
      const dt = Math.min(50, t - last) / 1000; last = t;
      const now = song();
      if (now > TOTAL) { over = true; onEnd(score); return; }
      const beat = Math.floor(now / BEAT);
      if (beat !== lastBeat && now > 0) { lastBeat = beat; bounce = 1; sfx("beat"); }
      bounce = Math.max(0, bounce - dt * 4);
      for (const n of notes) if (!n.hit && !n.miss && now - n.t > 0.18) { n.miss = true; combo = 0; }
      // фон-сцена
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#2B1640"); g.addColorStop(1, "#14101F");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < LANES; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.04 + flashes[i] * 0.18})`; ctx.fillRect(i * laneW + 4, 0, laneW - 8, H);
        flashes[i] = Math.max(0, flashes[i] - dt * 5);
      }
      if (img) { const s = 150 + bounce * 14; ctx.globalAlpha = 0.9; ctx.drawImage(img, W / 2 - s / 2, H * 0.18 - bounce * 10, s, s); ctx.globalAlpha = 1; }
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(8, lineY); ctx.lineTo(W - 8, lineY); ctx.stroke();
      for (let i = 0; i < LANES; i++) { ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(laneW * (i + 0.5), lineY, 24, 0, 7); ctx.stroke(); }
      for (const n of notes) {
        if (n.hit || n.t - now > FALL || now - n.t > 0.3) continue;
        const y = lineY - ((n.t - now) / FALL) * (lineY + 30);
        ctx.globalAlpha = n.miss ? 0.3 : 1; ctx.fillStyle = COLORS[n.lane];
        ctx.beginPath(); ctx.arc(laneW * (n.lane + 0.5), y, 20, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.beginPath(); ctx.arc(laneW * (n.lane + 0.5) - 6, y - 6, 6, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawFloaters(ctx, floats, dt);
      ctx.fillStyle = "#fff"; ctx.font = "800 15px Nunito, system-ui"; ctx.textAlign = "left";
      ctx.fillText(combo >= 3 ? `Комбо ${combo}` : "", 12, 24);
      ctx.textAlign = "right"; ctx.fillText(`${Math.max(0, Math.ceil(TOTAL - now))} с`, W - 12, 24);
      if (now < 0) { ctx.textAlign = "center"; ctx.font = "800 28px Unbounded, system-ui"; ctx.fillText("Готовьтесь!", W / 2, H / 2); }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { over = true; cancelAnimationFrame(raf); cv.removeEventListener("pointerdown", down); removeEventListener("keydown", key); };
  }, []);
  return (
    <>
      <canvas ref={ref} className="gcanvas" aria-label="Три дорожки с нотами: нажимайте на дорожку, когда нота у линии" />
      <p className="muted" style={{ marginTop: 10, textAlign: "center" }}>Жмите на дорожку, когда нота в кружке. Точно в бит — комбо!</p>
    </>
  );
}

// ---------------------------------------------------------------- сортировка

const TREATS = ["🍓", "🍪", "🍰", "🍩", "🍎", "🧁", "🍌", "🍒"];
const JUNK = ["🧦", "👟", "🧽", "🔋", "🪨", "🧻", "🔧", "📎"];

/** Вкусняшку — влево питомцу, мусор — вправо в корзину. Свайп или кнопки. Три ошибки — конец. */
function Sort({ onScore, onEnd }: GameProps) {
  const [item, setItem] = useState<{ em: string; good: boolean; id: number } | null>(null);
  const [lives, setLives] = useState(3);
  const [fly, setFly] = useState<"l" | "r" | "x" | null>(null);
  const [limit, setLimit] = useState(2000);
  const st = useRef({ score: 0, lives: 3, over: false, timer: 0 as ReturnType<typeof setTimeout> | 0, startX: 0, t0: Date.now(), id: 0, item: null as { em: string; good: boolean; id: number } | null });

  const next = () => {
    const s = st.current;
    if (s.over) return;
    const good = Math.random() < 0.55, pool = good ? TREATS : JUNK;
    // Чем больше очков, тем меньше времени на решение: от 2 до 0,7 секунды
    const ms = Math.max(700, 2000 - s.score * 35);
    setLimit(ms); setFly(null);
    s.item = { em: pool[Math.floor(Math.random() * pool.length)], good, id: ++s.id };
    setItem(s.item);
    clearTimeout(s.timer as ReturnType<typeof setTimeout>);
    s.timer = setTimeout(() => answer(null), ms);
  };
  const answer = (left: boolean | null) => {
    const s = st.current, cur = s.item;
    if (s.over || !cur) return;
    s.item = null; // одно решение на вкусняшку
    clearTimeout(s.timer as ReturnType<typeof setTimeout>);
    const ok = left !== null && left === cur.good;
    if (ok) { s.score++; onScore(s.score); sfx("pop"); haptic.soft(); setFly(left ? "l" : "r"); }
    else { s.lives--; setLives(s.lives); sfx("thump"); haptic.error(); setFly("x"); }
    if (s.lives <= 0 || Date.now() - s.t0 > 45_000) { s.over = true; setTimeout(() => onEnd(s.score), 500); }
    else setTimeout(next, 260);
  };
  useEffect(() => {
    st.current.over = false;
    const t = setTimeout(next, 500);
    const key = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") answer(true); if (e.key === "ArrowRight") answer(false); };
    addEventListener("keydown", key);
    return () => { st.current.over = true; clearTimeout(t); clearTimeout(st.current.timer as ReturnType<typeof setTimeout>); removeEventListener("keydown", key); };
  }, []);
  return (
    <div className="sort">
      <div className="sort-top"><span>{"❤️".repeat(lives)}{"🖤".repeat(3 - lives)}</span><span className="muted">Вкусняшки — питомцу, мусор — в корзину</span></div>
      <div className="sort-field"
        onPointerDown={(e) => { st.current.startX = e.clientX; }}
        onPointerUp={(e) => { const dx = e.clientX - st.current.startX; if (Math.abs(dx) > 40) answer(dx < 0); }}>
        <div className="sort-side l">🐾<br />Питомцу</div>
        {item && <div key={item.id} className={`sort-card ${fly ?? ""}`}>{item.em}<i className="sort-timer" style={{ animationDuration: `${limit}ms` }} /></div>}
        <div className="sort-side r">🗑️<br />В корзину</div>
      </div>
      <div className="btn-row" style={{ width: "100%" }}>
        <button className="btn" onClick={() => answer(true)}>⬅ Питомцу</button>
        <button className="btn ghost" onClick={() => answer(false)}>В корзину ➡</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- прыг-скок

/** Питомец бежит сам, нажатие — прыжок. +1 за каждое препятствие, ягоды дают бонус. Столкновение — конец. */
function Jump({ pet, level, outfit, onScore, onEnd }: GameProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, { ctx, W, H } = fitCanvas(cv);
    const GROUND = H - 70, SIZE = 64, X = 60;
    let img: HTMLImageElement | null = null;
    void petImage(pet, "happy", level, outfit).then((i) => { img = i; });
    let y = 0, vy = 0, speed = 260, dist = 0, nextAt = 1.8, score = 0, over = false, raf = 0, last = performance.now(), t = 0;
    const obs: { x: number; w: number; h: number; em: string; passed?: boolean }[] = [];
    const berries: { x: number; y: number; got?: boolean }[] = [];
    const floats: Floater[] = [];
    const jump = () => { if (over) return; if (y <= 0.5) { vy = 720; sfx("ping"); haptic.soft(6); } };
    const key = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === "ArrowUp") { e.preventDefault(); jump(); } };
    cv.addEventListener("pointerdown", jump); addEventListener("keydown", key);
    const finish = () => { if (over) return; over = true; sfx("thump"); haptic.error(); setTimeout(() => onEnd(score), 900); };
    function frame(now: number) {
      const dt = Math.min(40, now - last) / 1000; last = now; t += dt;
      if (!over) {
        speed = Math.min(560, 260 + t * 9); dist += speed * dt;
        vy -= 2000 * dt; y = Math.max(0, y + vy * dt); if (y === 0) vy = 0;
        nextAt -= dt;
        if (nextAt <= 0) {
          const big = Math.random() < 0.35;
          obs.push({ x: W + 20, w: big ? 34 : 26, h: big ? 44 : 30, em: big ? "🌵" : "🪨" });
          if (Math.random() < 0.5) berries.push({ x: W + 20 + 90, y: 60 + Math.random() * 50 });
          nextAt = Math.max(0.55, 1.5 - t * 0.02) + Math.random() * 0.6;
        }
        for (const o of obs) {
          o.x -= speed * dt;
          // столкновение: прямоугольники с небольшим запасом в пользу игрока
          const px = X + 10, pw = SIZE - 20, py = GROUND - y - SIZE + 12;
          if (o.x < px + pw && o.x + o.w > px && GROUND - o.h < py + SIZE - 16) finish();
          if (!o.passed && o.x + o.w < px) { o.passed = true; score++; onScore(score); }
        }
        for (const b of berries) {
          b.x -= speed * dt;
          if (!b.got && Math.abs(b.x - (X + SIZE / 2)) < 30 && Math.abs((GROUND - b.y) - (GROUND - y - SIZE / 2)) < 34) {
            b.got = true; score += 2; onScore(score); sfx("pop"); floats.push({ t: "+2", x: b.x, y: GROUND - b.y - 20, life: 1 });
          }
        }
      }
      while (obs.length && obs[0].x < -60) obs.shift();
      while (berries.length && berries[0].x < -60) berries.shift();
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#BFE6FF"); g.addColorStop(1, "#FFF4E6");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.8)";
      for (let i = 0; i < 4; i++) { const cx = ((i * 170 - dist * 0.2) % (W + 200) + W + 200) % (W + 200) - 100; ctx.beginPath(); ctx.ellipse(cx, 60 + i * 25, 46, 16, 0, 0, 7); ctx.fill(); }
      ctx.fillStyle = "#9BCB6E"; ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = "#86B85A"; for (let x = -(dist % 40); x < W; x += 40) ctx.fillRect(x, GROUND, 20, 6);
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      for (const o of obs) { ctx.font = `${o.h + 6}px system-ui, 'Apple Color Emoji'`; ctx.fillText(o.em, o.x + o.w / 2, GROUND + 4); }
      for (const b of berries) if (!b.got) { ctx.font = "26px system-ui, 'Apple Color Emoji'"; ctx.fillText("🍓", b.x, GROUND - b.y + 13); }
      ctx.textBaseline = "alphabetic";
      if (img) { ctx.save(); ctx.translate(X + SIZE / 2, GROUND - y - SIZE / 2); if (over) ctx.rotate(0.5); ctx.drawImage(img, -SIZE / 2, -SIZE / 2 + (y ? 0 : Math.sin(t * 18) * 2), SIZE, SIZE); ctx.restore(); }
      drawFloaters(ctx, floats, dt);
      ctx.fillStyle = "#2A1B14"; ctx.font = "800 15px Nunito, system-ui"; ctx.textAlign = "right";
      ctx.fillText(`${Math.floor(dist / 100)} м`, W - 12, 24);
      if (t < 1.2) { ctx.textAlign = "center"; ctx.font = "800 20px Unbounded, system-ui"; ctx.fillText("Нажмите — прыжок!", W / 2, H * 0.4); }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { over = true; cancelAnimationFrame(raf); cv.removeEventListener("pointerdown", jump); removeEventListener("keydown", key); };
  }, []);
  return (
    <>
      <canvas ref={ref} className="gcanvas" aria-label="Бегущий питомец: нажмите, чтобы прыгнуть" />
      <p className="muted" style={{ marginTop: 10, textAlign: "center" }}>Нажмите, чтобы прыгнуть. 🍓 в воздухе — +2 очка.</p>
    </>
  );
}
