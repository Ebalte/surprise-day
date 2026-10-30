import { useEffect, useState } from "react";
import { api, logout, post, type ApiError } from "../api";
import { useGame } from "../ui";
import { asset, dur } from "../util";
import { inTelegram, requestWriteAccess } from "../tg";
import { PetArt } from "../pet/art";
import { GAMES } from "../pet/games";
import { ageText, livePet } from "./PetScreen";

type Row = { place: number; name: string; ms: number; you: boolean };

export function ProfileScreen() {
  const { state: s, refresh, toast, now } = useGame();
  const pet = livePet(s, now()), petFig = s.season.figures.find((f) => f.code === s.pet.active);
  const paused = s.pet.pets.filter((p) => p.code !== s.pet.active).length;
  const [lb, setLb] = useState<Row[] | null>(null);
  useEffect(() => { api<Row[]>("/api/leaderboard").then(setLb).catch(() => setLb([])); }, []);
  const st = s.me.streak, wk = st === 0 ? 0 : st % 7 === 0 ? 7 : st % 7;
  const frame = s.frames.find((f) => f.code === s.me.activeFrame);
  const sets = s.season.album.sets;
  const seasonBadge = s.badges.find((b) => b.code === s.season.badge.code);

  const toggleNotify = async (enabled: boolean) => {
    if (enabled && !(await requestWriteAccess())) return toast("Без разрешения бот не сможет написать");
    try { await post("/api/notifications", { enabled }); await refresh(); toast(enabled ? "Бот напишет, когда яйцо будет готово" : "Уведомления выключены"); }
    catch (e) { toast((e as ApiError).message); }
  };
  const togglePetNotify = async (enabled: boolean) => {
    try { await post("/api/notifications/pet", { enabled }); await refresh(); toast(enabled ? "Бот напомнит, когда питомцу что-то нужно" : "Напоминания о питомце выключены"); }
    catch (e) { toast((e as ApiError).message); }
  };
  const chooseFrame = async (code: string) => {
    try { await post("/api/frame", { code: s.me.activeFrame === code ? null : code }); await refresh(); }
    catch (e) { toast((e as ApiError).message); }
  };

  return (
    <section className="screen">
      <div className="me">
        <span className="ava" style={frame ? { boxShadow: `0 0 0 3px var(--surface), 0 0 0 7px ${frame.color}`, margin: 7 } : undefined}>
          {s.me.photoUrl ? <img src={s.me.photoUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%" }} /> : s.me.name[0]}
        </span>
        <div><h1 style={{ fontSize: 20 }}>{s.me.name}</h1>{s.me.username && <p className="muted">@{s.me.username}</p>}</div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Серия дней</h2><span className="muted">{7 - wk} до бонусного яйца</span></div>
        <div className="week" aria-label={`${wk} из 7 дней`}>{Array.from({ length: 7 }, (_, i) => <i key={i} className={i < wk ? "on" : ""} />)}</div>
        <p className="muted">{s.season.rules.eggIntervalHours === 24
          ? "Открывайте яйцо дня 7 дней подряд и получите бонусное. Пропуск дня обнуляет серию."
          : "Открывайте бесплатное яйцо 7 раз подряд, как только оно готово, и получите бонусное. Если пропустить, серия обнулится."}</p>
        {s.season.rules.streakFreezesPerWeek > 0 && (
          <p className="muted"><b>Заморозка серии:</b> {s.me.freezeAvailable ? "есть на этой неделе. Если пропустите один день, серия не сгорит." : "на этой неделе уже потрачена. Новая появится в понедельник."}</p>
        )}
      </div>

      <div className="stats">
        <div className="stat"><b>{st}</b><span>Серия сейчас</span></div>
        <div className="stat"><b>{s.me.bestStreak}</b><span>Лучшая серия</span></div>
        <div className="stat"><b>{s.me.shards}</b><span>Осколки</span></div>
        <div className="stat"><b>{s.me.totalEggs}</b><span>Открыто яиц</span></div>
      </div>

      <div className="panel">
        <h2>Питомец</h2>
        {pet && petFig ? (
          <>
            <a className="pet-mini" href="#pet" style={{ color: "inherit", textDecoration: "none" }}>
              <PetArt f={petFig} expr="happy" level={pet.level} outfit={s.pet.style.outfit} />
              <span><b>{petFig.name}</b><br /><span className="muted">{s.pet.config.stages[pet.stage].emoji} {s.pet.config.stages[pet.stage].name} · {ageText(pet.ageMs)} · уровень {pet.level}</span></span>
            </a>
            <div className="stats">
              <div className="stat"><b>{s.pet.coins}</b><span>Монеты</span></div>
              <div className="stat"><b>{s.pet.gamesPlayed}</b><span>Сыграно игр</span></div>
            </div>
            {GAMES.map((g) => <div key={g.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{g.emoji} {g.name}</span><b className="num">{s.pet.gameBest[g.id] ?? "—"}</b></div>)}
            {paused > 0 && <p className="muted">Ещё {paused} на паузе. Сменить главного питомца можно в «Коллекции».</p>}
          </>
        ) : <p className="muted">Откройте яйцо: первая фигурка станет вашим питомцем.</p>}
      </div>

      <div className="panel">
        <h2>Бейджи</h2>
        <div className={`badge-card ${seasonBadge ? "" : "locked"}`}>
          <img className="medal" src={asset(s.season.badge.icon ?? "/badges/collector_season1.svg")} alt="" />
          <div><b>{s.season.badge.title}</b>
            <p className="muted">{seasonBadge && s.progress.completedAt && s.progress.startedAt ? `Коллекция собрана за ${dur(Date.parse(s.progress.completedAt) - Date.parse(s.progress.startedAt))}` : `Соберите все ${s.season.mainCount} фигурок. Сейчас ${s.progress.unique}/${s.season.mainCount}`}</p></div>
        </div>
        {s.season.events.map((ev) => {
          const got = s.badges.some((b) => b.code === ev.badge.code);
          // Бейдж события виден, только пока оно идёт или если он уже получен / начат
          if (!got && !ev.active && !ev.figureCodes.some((c) => s.collection[c])) return null;
          return (
            <div key={ev.slug} className={`badge-card ${got ? "" : "locked"}`}>
              <img className="medal" src={asset(ev.badge.icon ?? "/badges/collector_season1.svg")} alt="" />
              <div><b>{ev.badge.title}</b><p className="muted">{got ? `Все фигурки события «${ev.title}» собраны` : `Соберите фигурки события «${ev.title}»`}</p></div>
            </div>
          );
        })}
      </div>

      {sets.length > 0 && (
        <div className="panel">
          <h2>Рамка аватарки</h2>
          <div className="frames">{sets.map((x) => {
            const has = s.frames.some((f) => f.code === x.frame.code);
            return (
              <button key={x.code} className="frame-btn" style={{ ["--fc" as string]: x.frame.color }} aria-pressed={s.me.activeFrame === x.frame.code} disabled={!has} onClick={() => chooseFrame(x.frame.code)}>
                <i className="ring" />{x.frame.title}{has ? "" : ` · ${x.title.toLowerCase()}`}
              </button>
            );
          })}</div>
          <p className="muted">Рамки дают за собранные наборы в коллекции.</p>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>Быстрее всех собрали</h2><span className="muted">{s.season.title}</span></div>
        <div className="lb">
          {!lb ? <div className="spinner" /> : lb.length ? lb.map((r) => (
            <div key={r.place} className={`lb-row ${r.you ? "you" : ""}`}><span className="pos num">{r.place}</span><span className="nm">{r.you ? "Вы" : r.name}</span><span className="num">{dur(r.ms)}</span></div>
          )) : <p className="muted">Пока никто не собрал всю коллекцию. Станьте первым!</p>}
        </div>
        <p className="muted">Время считается от первого яйца сезона до последней фигурки.</p>
      </div>

      <div className="panel">
        <label className="switch" htmlFor="notify"><span><b>Уведомления в Telegram</b><br /><span className="muted">Бот напишет, когда новое яйцо готово</span></span>
          <input type="checkbox" id="notify" checked={s.me.notificationsEnabled} onChange={(e) => toggleNotify(e.target.checked)} /></label>
        <label className="switch" htmlFor="pet-notify"><span><b>Напоминания о питомце</b><br /><span className="muted">{s.me.notificationsEnabled ? "Хочет есть, в ванну, скучает, хочет спать. Ночью бот молчит" : "Сначала включите уведомления в Telegram"}</span></span>
          <input type="checkbox" id="pet-notify" disabled={!s.me.notificationsEnabled} checked={s.me.notificationsEnabled && s.pet.notify} onChange={(e) => void togglePetNotify(e.target.checked)} /></label>
      </div>
      {!inTelegram && <button className="btn ghost" onClick={() => { logout(); location.reload(); }}>Выйти</button>}
    </section>
  );
}
