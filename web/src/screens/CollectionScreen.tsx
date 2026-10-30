import { useState } from "react";
import { post, type ApiError, type FigureDto, type GameState } from "../api";
import { Fig, Reveal, Sheet, useGame, useTick, type RevealData } from "../ui";
import { dur, ORDER, plural, RLABEL, RPLURAL } from "../util";
import { ageText } from "./PetScreen";

const rewardLabel = (r: GameState["season"]["album"]["rows"][number]["reward"]) =>
  r.type === "shards" ? `${r.amount} осколков` : r.minRarity ? `яйцо «${RLABEL[r.minRarity].toLowerCase()} или лучше»` : "бонусное яйцо";

function Cell({ f, count, onClick }: { f: FigureDto; count: number; onClick: () => void }) {
  const { state: s } = useGame();
  const home = count > 0 && s.pet.active === f.code;
  return (
    <button className={`cell ${count ? "" : "missing"} ${home ? "active" : ""}`} data-rarity={f.rarity} onClick={onClick}
      aria-label={count ? f.name : `Неизвестная фигурка, ${RLABEL[f.rarity].toLowerCase()}`}>
      <Fig f={f} />
      {!count && <span className="q">?</span>}
      {count > 1 && <span className="cnt num">×{count}</span>}
      {home && <span className="home" title="Главный питомец">🏠</span>}
      <span className="nm">{count ? f.name : "???"}</span>
    </button>
  );
}

function FigureSheet({ f, onClose, onCrafted }: { f: FigureDto; onClose: () => void; onCrafted: (r: RevealData) => void }) {
  const { state: s, toast, refresh } = useGame();
  const count = s.collection[f.code] ?? 0;
  const cost = f.event ? undefined : s.season.rules.craftCosts[f.rarity];
  const tradeable = s.season.rules.trading.tradeableRarities.includes(f.rarity);
  const [busy, setBusy] = useState(false);
  const ev = f.event ? s.season.events.find((e) => e.slug === f.event) : null;
  const craft = async () => {
    setBusy(true);
    try {
      const r = await post<{ isNew: boolean; cost: number; rewards: string[]; completedNow: boolean }>("/api/craft", { code: f.code });
      await refresh();
      onCrafted({
        figure: f, outcome: `Получена за ${r.cost} осколков`, outcomeNew: true,
        extra: [...(r.completedNow ? [`Коллекция собрана! Бейдж «${s.season.badge.title}»`] : []), ...r.rewards],
      });
    } catch (e) { toast((e as ApiError).message); setBusy(false); }
  };
  return (
    <Sheet onClose={onClose}>
      <Fig f={f} className={`fig ${count ? "" : "sil"}`} />
      <span className="rar-chip" data-rarity={f.rarity}>{RLABEL[f.rarity]}</span>
      {count ? (
        <>
          <h2>{f.name}</h2>
          {f.description && <p className="muted">{f.description}</p>}
          <p><b className="num">В коллекции: {count} шт.</b></p>
          <PetInfo f={f} onClose={onClose} />
          <p className="muted">{count > 1 ? (tradeable ? `Лишних: ${count - 1}. Их можно подарить или обменять в разделе «Друзья».` : "Легендарную нельзя дарить и обменивать.") : "Повторок нет. Дарить и обменивать можно только лишние копии."}</p>
        </>
      ) : (
        <>
          <h2>Фигурка не найдена</h2>
          {cost ? (
            <>
              <p className="muted">{RLABEL[f.rarity]} стоит {cost} осколков. {s.me.shards >= cost ? `У вас ${s.me.shards}.` : `Нужно ещё ${cost - s.me.shards} ${plural(cost - s.me.shards, "осколок", "осколка", "осколков")}.`}</p>
              <button className="btn" disabled={busy || s.me.shards < cost} onClick={craft}>Купить за {cost} осколков</button>
            </>
          ) : (
            <p className="muted">{ev ? (ev.active ? "Особая фигурка события. Выпадает из яиц, пока идёт событие, или приходит через обмен." : "Событие закончилось. Эту фигурку теперь можно получить только обменом.") : "Легендарную нельзя купить за осколки, её можно только найти в яйце."}</p>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Главный питомец или кнопка «сделать главным» (с возрастом питомца на паузе) */
function PetInfo({ f, onClose }: { f: FigureDto; onClose: () => void }) {
  const { state: s, toast, refresh } = useGame();
  const [busy, setBusy] = useState(false);
  const p = s.pet.pets.find((x) => x.code === f.code);
  const stage = p ? s.pet.config.stages[p.stage] : null;
  if (s.pet.active === f.code) return <p className="age-chip">🏠 Главный питомец{stage ? ` · ${stage.name} · ${ageText(p!.ageMs)}` : ""}</p>;
  const make = async () => {
    setBusy(true);
    try { await post("/api/pet/active", { code: f.code }); await refresh(); toast(`${f.name} теперь главный питомец. Время пошло!`); onClose(); location.hash = "pet"; }
    catch (e) { toast((e as ApiError).message); setBusy(false); }
  };
  return (
    <>
      {p && stage && <p className="muted">На паузе: {stage.name.toLowerCase()}, возраст {ageText(p.ageMs)}, уровень {p.level}. Пока питомец не главный, он не растёт и не голодает.</p>}
      <button className="btn" disabled={busy} onClick={make}>🏠 Сделать главным питомцем</button>
    </>
  );
}

export function CollectionScreen() {
  const { state: s, now } = useGame();
  useTick(30_000);
  const [open, setOpen] = useState<FigureDto | null>(null);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const by = new Map(s.season.figures.map((f) => [f.code, f]));
  const main = s.season.figures.filter((f) => !f.event);
  const rows = s.season.album.rows.length ? s.season.album.rows : [{ figures: main.map((f) => f.code), reward: null }];
  const cnt = (c: string) => s.collection[c] ?? 0;
  const t = now();

  return (
    <section className="screen">
      <div className="topbar">
        <div><h1 style={{ fontSize: 22 }}>Коллекция</h1><p className="muted">{s.season.title}</p></div>
        <span className="pill num"><span><b>{s.progress.unique}</b>/{s.season.mainCount}</span></span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={s.season.mainCount} aria-valuenow={s.progress.unique}>
        <i style={{ width: `${(s.progress.unique / s.season.mainCount) * 100}%` }} />
      </div>

      {rows.map((row, i) => {
        const have = row.figures.filter(cnt).length, done = s.rewards.rows[i];
        return (
          <div key={i} style={{ display: "contents" }}>
            {row.reward && (
              <div className="row-head"><span>Ряд {i + 1} · {have}/{row.figures.length}</span>
                <span className={done ? "ok" : ""}>{done ? "Получено: " : "Награда: "}{rewardLabel(row.reward)}</span></div>
            )}
            <div className="grid">{row.figures.map((c) => by.get(c) && <Cell key={c} f={by.get(c)!} count={cnt(c)} onClick={() => setOpen(by.get(c)!)} />)}</div>
          </div>
        );
      })}

      {s.season.events.map((ev) => {
        const figs = ev.figureCodes.map((c) => by.get(c)).filter(Boolean) as FigureDto[];
        // Событие видно, пока оно идёт, или если у игрока уже есть его фигурки
        if (!figs.length || (!ev.active && !figs.some((f) => cnt(f.code)))) return null;
        const got = s.badges.some((b) => b.code === ev.badge.code);
        return (
          <div className="panel" key={ev.slug}>
            <div className="panel-head"><h2>Событие: {ev.title}</h2>
              <span className="muted num">{ev.active ? "ещё " + dur(Date.parse(ev.endsAt) - t) : Date.parse(ev.startsAt) > t ? "скоро" : "завершено"}</span></div>
            <div className="grid three">{figs.map((f) => <Cell key={f.code} f={f} count={cnt(f.code)} onClick={() => setOpen(f)} />)}</div>
            <p className="muted">{got ? `Бейдж «${ev.badge.title}» получен.`
              : ev.active ? `Пока идёт событие, каждое яйцо с шансом ${Math.round(ev.dropChance * 100)}% приносит фигурку события. Соберите все: бейдж «${ev.badge.title}». Эти фигурки не входят в основную коллекцию.`
              : "Недостающие фигурки события можно получить только обменом."}</p>
          </div>
        );
      })}

      {s.season.album.sets.length > 0 && (
        <div className="panel">
          <h2>Наборы и рамки</h2>
          <div>{s.season.album.sets.map((st, i) => {
            const codes = main.filter((f) => !st.rarity || f.rarity === st.rarity).map((f) => f.code);
            const h = codes.filter(cnt).length;
            return (
              <div className="quest" key={st.code}>
                <div><b>{st.title}</b><p className="muted num">{h}/{codes.length} · {st.frame.title}</p></div>
                {s.rewards.sets[i] ? <span className="status ok">Получено</span> : <span className="muted num">{h}/{codes.length}</span>}
                <div className="progress"><i style={{ width: `${(h / Math.max(1, codes.length)) * 100}%` }} /></div>
              </div>
            );
          })}</div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>Осколки</h2><b className="num">{s.me.shards}</b></div>
        <div className="chips" style={{ justifyContent: "flex-start" }}>
          {ORDER.map((r) => s.season.rules.craftCosts[r]
            ? <span key={r} className="chip num" data-rarity={r}><i className="dot" />{RPLURAL[r]}: {s.season.rules.craftCosts[r]}</span>
            : <span key={r} className="chip" data-rarity={r}><i className="dot" />{RPLURAL[r]}: только из яйца</span>)}
        </div>
        <p className="muted">Повторки превращаются в осколки: {ORDER.map((r) => `${RLABEL[r].toLowerCase()} ${s.season.rules.rarities[r]?.shards ?? 0}`).join(", ")}. Нажмите на силуэт, чтобы купить недостающую фигурку.</p>
      </div>

      <div className="panel">
        <h2>Шансы выпадения</h2>
        <div className="legend">
          {ORDER.map((r) => <span key={r} data-rarity={r}><i className="dot" />{RPLURAL[r]} · {main.filter((f) => f.rarity === r).length} шт · {s.season.rules.rarities[r]?.weight ?? 0}%</span>)}
        </div>
        <p className="muted">Гарант: если {s.season.rules.pityThreshold} яиц подряд без новой фигурки, следующее даст новую.</p>
      </div>

      {open && <FigureSheet f={open} onClose={() => setOpen(null)} onCrafted={(r) => { setOpen(null); setReveal(r); }} />}
      {reveal && <Reveal data={reveal} onClose={() => setReveal(null)} />}
    </section>
  );
}
