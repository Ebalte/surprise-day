import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { post, type ApiError, type FigureDto, type GameState, type PetAction, type PetDto } from "../api";
import { EGG_SVG, Fig, Sheet, useGame, useTick } from "../ui";
import { haptic, shareLink } from "../tg";
import { DAY, HOUR, plural, RLABEL } from "../util";
import { PetArt, STYLE_NAMES, type Expr } from "../pet/art";
import { GAMES, GameRunner, type GameId } from "../pet/games";

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Показатели «сейчас»: сервер прислал их на момент serverTime, дальше досчитываем так же, как сервер */
export function livePet(s: GameState, now: number): PetDto | null {
  return liveDto(s, s.pet.pets.find((x) => x.code === s.pet.active), now);
}
/** Общий питомец пати «сейчас» */
export const livePairPet = (s: GameState, now: number) => liveDto(s, s.pair?.pet, now);
function liveDto(s: GameState, p: PetDto | undefined, now: number): PetDto | null {
  if (!p) return null;
  const h = Math.max(0, (now - Date.parse(s.serverTime)) / HOUR);
  const q = { ...p, ageMs: p.ageMs + h * HOUR };
  if (q.asleep) {
    q.energy = clamp(q.energy + 20 * h); q.food = clamp(q.food - 3 * h); q.clean = clamp(q.clean - h);
    if (q.energy >= 100) q.asleep = false;
  } else {
    q.food = clamp(q.food - 6 * h); q.clean = clamp(q.clean - 3 * h); q.energy = clamp(q.energy - (q.stage === 0 ? 6 : 4) * h);
    q.mood = clamp(q.mood - (5 + (q.food < 20 ? 6 : 0) + (q.clean < 20 ? 4 : 0)) * h);
  }
  q.stage = s.pet.config.stages.reduce((i, st, k) => (q.ageMs / DAY >= st.fromDays ? k : i), 0);
  return q;
}
export const needsCare = (p: PetDto | null) => !!p && !p.asleep && Math.min(p.food, p.mood, p.clean, p.energy) < 25;
export function ageText(ms: number) {
  const d = Math.floor(ms / DAY), h = Math.floor(ms / HOUR);
  if (d < 1) return h < 1 ? "меньше часа" : `${h} ${plural(h, "час", "часа", "часов")}`;
  return `${d} ${plural(d, "день", "дня", "дней")}`;
}
const exprOf = (p: PetDto): Expr => {
  if (p.asleep) return "sleep";
  const m = Math.min(p.food, p.mood, p.clean, p.energy);
  return m < 25 ? "sad" : m >= 60 ? "happy" : "ok";
};
const HAPPY = ["Мне хорошо!", "Ты лучший!", "Поиграем?", "Обнимашки?", "Какой чудесный день!"];
function wish(p: PetDto) {
  if (p.asleep) return "Zzz… Не будите, я сплю";
  if (p.food < 25) return "Хочу кушать!";
  if (p.clean < 25) return "Я весь в грязи, помой меня";
  if (p.energy < 20) return "Я так устал… Пора спать";
  if (p.mood < 30) return "Мне скучно, поиграй со мной";
  return HAPPY[(p.level + Math.floor(p.ageMs / HOUR)) % HAPPY.length];
}
const barCls = (v: number) => (v < 25 ? "low" : v < 50 ? "mid" : "");

const VIEW_KEY = "surprise-day-petview";
export type PetTarget = "own" | "pair";
/** Переключить экран питомца (например, после принятия приглашения в пати) */
export const setPetView = (v: PetTarget) => {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* приватный режим */ }
  dispatchEvent(new CustomEvent("petview", { detail: v }));
};
const savedView = (): PetTarget => { try { return localStorage.getItem(VIEW_KEY) === "pair" ? "pair" : "own"; } catch { return "own"; } };

/** Экран «Питомец»: свой питомец или общий питомец пати */
export function PetScreen() {
  const { state: s, now } = useGame();
  useTick(10_000);
  const [view, setView] = useState<PetTarget>(savedView);
  const choose = (v: PetTarget) => setPetView(v);
  useEffect(() => {
    const on = (e: Event) => setView((e as CustomEvent<PetTarget>).detail);
    addEventListener("petview", on);
    return () => removeEventListener("petview", on);
  }, []);
  const figs = new Map(s.season.figures.map((f) => [f.code, f]));
  const pairPet = livePairPet(s, now());
  const pairFig = s.pair ? figs.get(s.pair.pet.code) : undefined;
  const heart = s.pair?.kind === "friends" ? "🤝" : "💞";
  return (
    <>
      <div className="seg" role="tablist" aria-label="Чей питомец">
        <button role="tab" aria-selected={view === "own"} onClick={() => choose("own")}>🏠 Мой питомец</button>
        <button role="tab" aria-selected={view === "pair"} onClick={() => choose("pair")}>
          {heart} Общий{s.pair && needsCare(pairPet) && <i className="dotn" />}
        </button>
      </div>
      {view === "own"
        ? <PetCare key="own" target="own" />
        : s.pair && pairFig ? <PetCare key="pair" target="pair" /> : <PairStart />}
    </>
  );
}

function PetCare({ target }: { target: PetTarget }) {
  const { state: s, now, toast, refresh } = useGame();
  const [say, setSay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"feed" | "games" | "style" | null>(null);
  const [game, setGame] = useState<GameId | null>(null);
  const [washing, setWashing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fx, setFx] = useState<{ id: number; t: string; x: number; y: number }[]>([]);
  const [jump, setJump] = useState(0);
  const room = useRef<HTMLDivElement>(null);
  const lastPat = useRef(0);
  const figs = new Map(s.season.figures.map((f) => [f.code, f]));
  const pair = target === "pair" ? s.pair : null;
  const p = pair ? livePairPet(s, now()) : livePet(s, now());
  const f = pair ? figs.get(pair.pet.code) : s.pet.active ? figs.get(s.pet.active) : undefined;

  const pop = (t: string, x?: number, y?: number) => {
    const r = room.current?.getBoundingClientRect();
    const id = Math.random();
    setFx((a) => [...a, { id, t, x: x ?? (r ? r.width / 2 : 150), y: y ?? (r ? r.height * 0.45 : 120) }]);
    setTimeout(() => setFx((a) => a.filter((z) => z.id !== id)), 1100);
  };
  /** Действие с питомцем на сервере → новые показатели, сообщения о росте */
  const act = async <T,>(path: string, payload: object = {}, line?: string) => {
    setBusy(true);
    try {
      const r = await post<PetAction<T>>(path, { ...payload, pet: target });
      if (line) setSay(line);
      r.messages.forEach((m, i) => setTimeout(() => toast(`${f?.name}: ${m}`), 300 + i * 1800));
      await refresh();
      return r.result;
    } catch (e) { toast((e as ApiError).message); return null; } finally { setBusy(false); }
  };

  if (!p || !f) return pair ? null : <ChoosePet />;
  const stages = s.pet.config.stages, st = stages[p.stage], next = stages[p.stage + 1];
  const left = next ? Math.max(1, Math.ceil(next.fromDays - p.ageMs / DAY)) : 0;

  const pat = (e: ReactPointerEvent) => {
    if (washing) return;
    if (p.asleep) return toast("Тсс, питомец спит");
    const r = room.current!.getBoundingClientRect();
    pop(["💛", "💖", "✨"][Math.floor(Math.random() * 3)], e.clientX - r.left, e.clientY - r.top - 10);
    setJump((j) => j + 1); haptic.tap();
    // Сервер засчитывает поглаживание не чаще раза в секунду — не шлём лишнего
    if (Date.now() - lastPat.current > 1200) { lastPat.current = Date.now(); void post("/api/pet/pat", { pet: target }).then(() => refresh()).catch(() => {}); }
  };
  const sleep = () => {
    if (!p.asleep && p.energy >= 95) return toast("Питомец бодр и не хочет спать");
    void act("/api/pet/sleep", { asleep: !p.asleep }).then((r) => r && toast(p.asleep ? "Доброе утро!" : "Спокойной ночи! Энергия восстанавливается"));
  };

  return (
    <section className="screen">
      <div className="topbar">
        <div><h1 style={{ fontSize: 20 }}>{f.name}</h1><p className="muted">{pair ? `${pair.kind === "friends" ? "🤝 Общий с другом" : "💞 Общий питомец пары"}` : RLABEL[f.rarity]} · уровень {p.level}</p></div>
        <span className="pill num"><i className="coin" />{s.pet.coins}</span>
      </div>
      <div className={`room ${p.asleep ? "night" : ""} ${s.pet.style.room ? `theme-${s.pet.style.room}` : ""}`} ref={room}>
        {s.pet.style.room === "metal" ? <RoomMetal /> : <div className="window" />}
        <div className="pbubble">{washing ? "Ой, щекотно!" : say ?? wish(p)}</div>
        <div className={`pet-wrap ${p.asleep ? "sleep" : "idle"}`} style={{ transform: `scale(${st.scale})` }} onPointerDown={pat}>
          <div key={jump} className={jump ? "jumper jump" : "jumper"}><PetArt f={f} expr={exprOf(p)} level={p.level} outfit={s.pet.style.outfit} /></div>
        </div>
        {p.asleep && <div className="zzz">z Z z</div>}
        {fx.map((z) => <div key={z.id} className="fx" style={{ left: z.x, top: z.y }}>{z.t}</div>)}
        {washing && <Wash clean={p.clean} roomRef={room} onDone={async (full) => {
          setWashing(false);
          if (full) { const r = await act("/api/pet/wash", {}, "Я сияю!"); if (r) toast("Чистенький! +8 опыта"); }
        }} />}
      </div>

      <div className="panel" style={{ gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="age-chip">{st.emoji} {st.name}</span>
          <span className="muted">Возраст: <b className="num">{ageText(p.ageMs)}</b></span>
        </div>
        <div className="stages" aria-label={`Стадия ${p.stage + 1} из ${stages.length}`}>{stages.map((_, i) => <i key={i} className={i <= p.stage ? "on" : ""} />)}</div>
        <div className="vitals">
          {([["🍓", "Сытость", p.food], ["💛", "Настроение", p.mood], ["🫧", "Чистота", p.clean], ["⚡", "Энергия", p.energy]] as const).map(([ico, lbl, v]) => (
            <div className="vital" key={lbl}><span className="ico">{ico}</span>
              <span className="lbl"><span>{lbl}</span><span className="num">{Math.round(v)}</span></span>
              <div className="bar"><i className={barCls(v)} style={{ width: `${v}%` }} /></div></div>
          ))}
        </div>
        <div className="xp"><span>Уровень {p.level}</span><span className="num">{p.xp}/{p.needXp} опыта</span></div>
        <div className="bar xpbar"><i style={{ width: `${(p.xp / p.needXp) * 100}%` }} /></div>
        <p className="pnote">{next ? `Станет «${next.name}» через ${left} ${plural(left, "день", "дня", "дней")} ухода.` : "Самая мудрая стадия."} Монеты в играх ×{st.mult}. {pair ? "Общий питомец живёт всегда: время идёт, даже когда вы заняты своим." : "Остальные питомцы ждут на паузе в коллекции."}</p>
      </div>

      <div className="actions">
        <button className="act" disabled={p.asleep || busy} onClick={() => setSheet("feed")}><span>🍓</span>Покормить</button>
        <button className="act" disabled={p.asleep || busy || washing} onClick={() => p.clean >= 98 ? toast("Питомец и так чистый") : setWashing(true)}><span>🧼</span>Помыть</button>
        <button className="act" disabled={p.asleep || busy} onClick={() => setSheet("games")}><span>🎮</span>Играть</button>
        <button className="act" disabled={busy} onClick={sleep}><span>{p.asleep ? "☀️" : "🌙"}</span>{p.asleep ? "Разбудить" : "Спать"}</button>
      </div>
      <button className="btn ghost" onClick={() => setSheet("style")}>👕 Стиль питомца{s.pet.style.owned.length ? "" : " · скоро"}</button>
      <p className="pnote">Погладьте питомца, коснувшись его. {pair ? "Еду покупаете вы, а заботиться может любой из вас." : "Сменить питомца можно в «Коллекции»."}</p>
      {pair && <PairPanel />}

      {sheet === "feed" && (
        <Sheet onClose={() => setSheet(null)}>
          <h2>Чем угостить?</h2>
          <p className="muted">У вас <b className="num">{s.pet.coins}</b> монет. Монеты дают за мини-игры.</p>
          <div style={{ alignSelf: "stretch", textAlign: "left" }}>
            {Object.entries(s.pet.config.foods).map(([k, it]) => {
              const have = s.pet.food[k] ?? 0;
              return (
                <div className="shop-item" key={k}><span className="em">{it.emoji}</span>
                  <div><b>{it.name}</b> · у вас {have}<p className="muted">{it.toy ? `+${it.mood} настроения, −5 энергии` : `+${it.food} сытости${it.mood ? `, +${it.mood} настроения` : ""}`}</p></div>
                  <div className="acts">
                    <button className="btn sm ghost" disabled={busy || s.pet.coins < it.price} onClick={() => void act("/api/pet/buy", { item: k })}><i className="coin" />{it.price}</button>
                    <button className="btn sm" disabled={busy || !have} onClick={async () => {
                      const r = await act("/api/pet/feed", { item: k }, it.toy ? "Мячик! Обожаю!" : "Ням-ням, спасибо!");
                      if (r) { setSheet(null); pop(it.emoji); setTimeout(() => pop(it.toy ? "Ура!" : "Ням!"), 250); setJump((j) => j + 1); }
                    }}>Дать</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}
      {sheet === "style" && <StyleSheet onClose={() => setSheet(null)} />}
      {sheet === "games" && (
        <Sheet onClose={() => setSheet(null)}>
          <h2>Во что поиграем?</h2>
          <p className="muted">Игра: −{s.pet.config.energyCost} энергии, +15 настроения. Энергия: <b className="num">{Math.round(p.energy)}</b>. Монеты ×{st.mult} за возраст.{pair ? " Очки идут в командную цель дня." : ""}</p>
          <div className="games" style={{ alignSelf: "stretch" }}>
            {GAMES.map((g) => (
              <button key={g.id} className="game-card" onClick={() => {
                if (p.energy < s.pet.config.energyCost) return toast("Питомец устал. Уложите его спать, чтобы восстановить энергию");
                setSheet(null); setGame(g.id);
              }}>
                <span className="gi">{g.emoji}</span>
                <span><b>{g.name}</b><br /><span className="muted">{g.text}</span></span>
                <span className="rec">{s.pet.gameBest[g.id] != null && <>Рекорд<br />{s.pet.gameBest[g.id]}</>}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {game && <GameRunner game={game} pet={f} level={p.level} target={target} onClose={() => setGame(null)} />}
    </section>
  );
}

/** Оформление комнаты «Металлист»: фон-картинка из styles.css и мерцающие прожекторы */
export function RoomMetal() {
  return <div className="lights" aria-hidden="true" />;
}

/** Наряды и оформление комнаты из ссылок-подарков */
function StyleSheet({ onClose }: { onClose: () => void }) {
  const { state: s, toast, refresh } = useGame();
  const [busy, setBusy] = useState(false);
  const st = s.pet.style;
  const owned = (kind: "outfit" | "room") => st.owned.filter((x) => x.startsWith(kind + ":")).map((x) => x.slice(kind.length + 1));
  const set = async (outfit: string | null, room: string | null) => {
    setBusy(true);
    try { await post("/api/pet/style", { outfit, room }); await refresh(); } catch (e) { toast((e as ApiError).message); } finally { setBusy(false); }
  };
  const row = (kind: "outfit" | "room", title: string, none: string) => (
    <div style={{ alignSelf: "stretch", textAlign: "left", display: "flex", flexDirection: "column", gap: 8 }}>
      <b>{title}</b>
      <div className="frames">
        {[null, ...owned(kind)].map((code) => (
          <button key={code ?? "none"} className="frame-btn" disabled={busy} aria-pressed={st[kind] === code}
            onClick={() => kind === "outfit" ? void set(code, st.room) : void set(st.outfit, code)}>
            {code ? STYLE_NAMES[kind][code] ?? code : none}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Sheet onClose={onClose}>
      <h2>Стиль питомца</h2>
      {st.owned.length ? (<>{row("outfit", "Наряд", "Без наряда")}{row("room", "Комната", "Обычная")}</>)
        : <p className="muted">Наряды и оформление комнаты дарят по особым ссылкам. Следите за новостями игры: там бывают ссылки-подарки.</p>}
    </Sheet>
  );
}

/** Мытьё: трите питомца пальцем, пока полоска не заполнится. Засчитывает сервер одним запросом. */
function Wash({ clean, roomRef, onDone }: { clean: number; roomRef: React.RefObject<HTMLDivElement>; onDone: (full: boolean) => void }) {
  const [v, setV] = useState(clean);
  const val = useRef(clean), done = useRef(false);
  useEffect(() => {
    const room = roomRef.current!;
    let n = 0;
    const move = (e: PointerEvent) => {
      const pw = room.querySelector(".pet-wrap")!.getBoundingClientRect();
      if (e.clientX < pw.left || e.clientX > pw.right || e.clientY < pw.top || e.clientY > pw.bottom || ++n % 2) return;
      const r = room.getBoundingClientRect(), b = document.createElement("div"), sz = 12 + Math.random() * 18;
      b.className = "soap"; b.style.cssText = `left:${e.clientX - r.left - sz / 2 + Math.random() * 20 - 10}px;top:${e.clientY - r.top - sz / 2 + Math.random() * 20 - 10}px;width:${sz}px;height:${sz}px`;
      room.appendChild(b); setTimeout(() => b.remove(), 1400);
      val.current = clamp(val.current + 1.5); setV(val.current); haptic.soft(4);
      if (val.current >= 100 && !done.current) { done.current = true; onDone(true); }
    };
    room.addEventListener("pointermove", move);
    return () => room.removeEventListener("pointermove", move);
  }, []);
  return (
    <div className="wash-bar">🧼 Потрите питомца
      <div className="meter"><i style={{ width: `${v}%` }} /></div>
      <button className="btn sm" onClick={() => { if (!done.current) { done.current = true; onDone(val.current >= 100); } }}>Готово</button>
    </div>
  );
}

/** Питомца ещё нет: выбрать из коллекции или открыть первое яйцо */
function ChoosePet() {
  const { state: s, toast, refresh } = useGame();
  const owned = s.season.figures.filter((f) => s.collection[f.code]);
  const choose = async (f: FigureDto) => {
    try { await post("/api/pet/active", { code: f.code }); await refresh(); toast(`${f.name} теперь ваш питомец!`); }
    catch (e) { toast((e as ApiError).message); }
  };
  return (
    <section className="screen">
      <div className="topbar"><div className="brand">Сюрприз <span>дня</span></div><span className="pill num"><i className="coin" />{s.pet.coins}</span></div>
      <div className="room"><div className="window" /><div className="pbubble">Здесь будет жить ваш питомец</div>
        <div className="pet-wrap idle egg-pet" style={{ transform: "scale(.8)" }} dangerouslySetInnerHTML={{ __html: EGG_SVG }} /></div>
      <div className="panel">
        <h2>{owned.length ? "Выберите питомца" : "Откройте первое яйцо"}</h2>
        <p className="muted">{owned.length ? "Любая фигурка из коллекции может стать питомцем. Растёт и стареет только тот, кого вы выбрали главным."
          : "Из яйца вылупится фигурка: она станет вашим питомцем. Кормите его, мойте, играйте — и он будет расти."}</p>
        {owned.length ? (
          <div className="grid">{owned.map((f) => (
            <button key={f.code} className="cell" data-rarity={f.rarity} onClick={() => void choose(f)}><Fig f={f} /><span className="nm">{f.name}</span></button>
          ))}</div>
        ) : <a className="btn" href="#egg">🥚 К яйцу</a>}
      </div>
    </section>
  );
}

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} ч назад` : `${Math.floor(h / 24)} дн назад`;
};

/** Пати: кто с вами, серия заботы, командная цель дня, журнал и приглашение */
function PairPanel() {
  const { state: s, now, toast, refresh } = useGame();
  const [leave, setLeave] = useState(false);
  const pair = s.pair!;
  const heart = pair.kind === "friends" ? "🤝" : "❤️";
  const t = pair.today, total = t.myPoints + t.matePoints;
  const doLeave = async () => {
    try { await post("/api/pair/leave"); toast("Вы вышли из пати"); setLeave(false); await refresh(); }
    catch (e) { toast((e as ApiError).message); }
  };
  return (
    <div className="panel pair-panel">
      <div className="pair-who">
        <span className="ava sm">{s.me.name[0]}</span><span className="heart">{heart}</span>
        <span className={`ava sm ${pair.partner ? "" : "empty"}`}>{pair.partner ? pair.partner.name[0] : "?"}</span>
        <div><b>Вы {heart} {pair.partner?.name ?? "ждём второго"}</b>
          <p className="muted">{pair.kind === "friends" ? "Друзья" : "Пара"} · заботитесь вместе</p></div>
      </div>

      {pair.partner ? (
        <>
          <div className="pair-row"><span>🔥 Серия заботы</span><b className="num">{pair.careStreak} {plural(pair.careStreak, "день", "дня", "дней")}</b></div>
          <div className="care-today">
            <span className={t.meCared ? "ok" : ""}>{t.meCared ? "✓" : "○"} Вы сегодня</span>
            <span className={t.mateCared ? "ok" : ""}>{t.mateCared ? "✓" : "○"} {pair.partner.name}</span>
          </div>
          <p className="pnote">Позаботьтесь о питомце оба в один день — серия растёт. Каждые 7 дней подряд: +100 монет каждому.</p>
          <div className="pair-row"><span>🏆 Командная цель дня</span><b className="num">{Math.min(total, t.goal)}/{t.goal}</b></div>
          <div className="bar xpbar"><i style={{ width: `${Math.min(100, (total / t.goal) * 100)}%` }} /></div>
          <p className="pnote">{t.rewarded ? "Выполнено! Завтра будет новая цель." : `Играйте в мини-игры за общего питомца: вы ${t.myPoints}, ${pair.partner.name} ${t.matePoints}. Нужно, чтобы сыграли оба. Награда: +40 монет каждому.`}</p>
        </>
      ) : (
        <Invite />
      )}

      {pair.log.length > 0 && (
        <details className="pair-log">
          <summary>Кто что делал</summary>
          {pair.log.map((l, i) => <p key={i}><b>{l.name}</b> {l.action} <span className="muted">· {ago(l.at, now())}</span></p>)}
        </details>
      )}
      {leave ? (
        <div className="btn-row">
          <button className="btn ghost" onClick={() => setLeave(false)}>Остаться</button>
          <button className="btn" onClick={() => void doLeave()}>Да, выйти</button>
        </div>
      ) : <button className="btn ghost sm" onClick={() => setLeave(true)}>Выйти из пати</button>}
      {leave && <p className="pnote">{pair.partner ? `Общий питомец останется у ${pair.partner.name}.` : "Вы один в пати: общий питомец пропадёт."}</p>}
    </div>
  );
}

/** Приглашение второго игрока: ссылка в Telegram и код, который можно продиктовать */
function Invite() {
  const { state: s, toast } = useGame();
  const pair = s.pair!;
  const text = pair.kind === "friends" ? "Давай растить питомца вместе! Заходи в мою пати 🤝" : "Давай растить нашего питомца вместе 💞";
  const copy = async () => { try { await navigator.clipboard.writeText(pair.inviteCode!); toast("Код скопирован"); } catch { toast(`Код: ${pair.inviteCode}`); } };
  return (
    <div className="invite">
      <p><b>Позовите второго игрока.</b> Пока его нет, ухаживать можете вы один.</p>
      <button className="btn" onClick={() => shareLink(pair.inviteLink!, text)}>📨 Отправить приглашение</button>
      <button className="code" onClick={() => void copy()} aria-label="Скопировать код">{pair.inviteCode}</button>
      <p className="pnote">Или пусть друг откроет «Питомец» → «Общий» → «Ввести код».</p>
    </div>
  );
}

/** Нет пати: создать свою или войти по коду */
function PairStart() {
  const { state: s, toast, refresh } = useGame();
  const [step, setStep] = useState<"intro" | "kind" | "pet" | "code">("intro");
  const [kind, setKind] = useState<"couple" | "friends">("couple");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const owned = s.season.figures.filter((f) => s.collection[f.code]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); await refresh(); toast(ok); } catch (e) { toast((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <section className="screen">
      <div className="panel pair-intro">
        <div className="big-heart">💞</div>
        <h2>Общий питомец на двоих</h2>
        <p className="muted">Соберите пати с парой или другом и растите питомца вместе: кормите по очереди, играйте в мини-игры за общий счёт и держите серию заботы.</p>
        {step === "intro" && (
          <div className="btn-row" style={{ alignSelf: "stretch" }}>
            <button className="btn" onClick={() => setStep("kind")}>Создать пати</button>
            <button className="btn ghost" onClick={() => setStep("code")}>Ввести код</button>
          </div>
        )}
        {step === "kind" && (
          <>
            <p><b>Кто вы друг другу?</b></p>
            <div className="btn-row" style={{ alignSelf: "stretch" }}>
              <button className="btn ghost" aria-pressed={kind === "couple"} onClick={() => { setKind("couple"); setStep("pet"); }}>❤️ Пара</button>
              <button className="btn ghost" aria-pressed={kind === "friends"} onClick={() => { setKind("friends"); setStep("pet"); }}>🤝 Друзья</button>
            </div>
          </>
        )}
        {step === "pet" && (
          owned.length ? (
            <>
              <p><b>Кто станет общим питомцем?</b> Он начнёт расти с нуля, ваш личный питомец не изменится.</p>
              <div className="grid" style={{ alignSelf: "stretch" }}>{owned.map((f) => (
                <button key={f.code} className="cell" data-rarity={f.rarity} disabled={busy}
                  onClick={() => void run(() => post("/api/pair/create", { code: f.code, kind }), "Пати создана! Позовите второго игрока")}>
                  <Fig f={f} /><span className="nm">{f.name}</span>
                </button>
              ))}</div>
            </>
          ) : <><p className="muted">Сначала откройте яйцо: общим питомцем станет одна из ваших фигурок.</p><a className="btn" href="#egg">🥚 К яйцу</a></>
        )}
        {step === "code" && (
          <form className="code-form" onSubmit={(e) => { e.preventDefault(); void run(() => post("/api/pair/join", { code }), "Вы в пати! Питомец теперь общий"); }}>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Код, например K7M2QX" maxLength={12} autoCapitalize="characters" aria-label="Код приглашения" />
            <button className="btn" disabled={busy || code.trim().length < 4}>Войти</button>
          </form>
        )}
        {step !== "intro" && <button className="btn ghost sm" onClick={() => setStep("intro")}>Назад</button>}
      </div>
    </section>
  );
}
