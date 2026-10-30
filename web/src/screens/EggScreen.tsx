import { useEffect, useState } from "react";
import { api, ApiError, post, type GameState, type OpenResult, type PublicAd } from "../api";
import { EGG_SVG, FLAME, Reveal, Sheet, STAR, useGame, useTick, wait, type RevealData } from "../ui";
import { asset, dur, fmtTimer, plural, RLABEL } from "../util";
import { haptic, openLink, payInvoice } from "../tg";

export function revealFromEgg(res: OpenResult, s: GameState): RevealData {
  const f = res.figure;
  const extra: string[] = [];
  let outcome: string;
  if (res.isNew && f.event) {
    const ev = s.season.events.find((e) => e.slug === f.event);
    const have = (ev?.figureCodes ?? []).filter((c) => s.collection[c] || c === f.code).length;
    outcome = `Новая фигурка события! ${have}/${ev?.figureCodes.length ?? 3}`;
  } else if (res.isNew) outcome = `Новая фигурка! ${s.progress.unique + 1}/${s.season.mainCount}`;
  else outcome = `Уже есть (×${res.count}) · +${res.shards} ${plural(res.shards, "осколок", "осколка", "осколков")}`;
  if (res.source !== "DAILY") extra.push(`Бонусное яйцо ${res.label}`);
  if (f.event) extra.push(`Особая фигурка события «${s.season.events.find((e) => e.slug === f.event)?.title ?? ""}»`);
  if (res.pity) extra.push(`Сработал гарант: ${s.season.rules.pityThreshold} яиц подряд без новинки`);
  if (res.minRarity) extra.push(`Гарантия: ${RLABEL[res.minRarity].toLowerCase()} или лучше`);
  if (res.froze) extra.push("Заморозка спасла серию: пропущенный день не считается");
  if (res.streakBonus) extra.push("Серия 7 дней подряд! Бонусное яйцо добавлено в запас");
  if (res.completedNow) extra.push(`Коллекция собрана! Бейдж «${s.season.badge.title}» и место в таблице лидеров`);
  extra.push(...res.rewards);
  if (!s.pet.active) extra.push("🏠 Это ваш первый питомец! Он уже живёт на экране «Питомец».");
  if (!res.isNew && s.season.rules.trading.tradeableRarities.includes(f.rarity)) extra.push("Повторку можно подарить или обменять в разделе «Друзья»");
  return { figure: f, outcome, outcomeNew: res.isNew, extra };
}

function PityChip({ s }: { s: GameState }) {
  if (s.progress.unique >= s.season.mainCount) return null;
  const left = s.season.rules.pityThreshold - s.progress.dryStreak;
  if (left <= 0) return <span className="chip hot">Следующее яйцо: точно новинка</span>;
  if (left + 1 <= s.season.rules.pityHintFrom) return <span className="chip hot">Новинка гарантирована в ближайших {left + 1} яйцах</span>;
  return <span className="chip num">Без новинки: {s.progress.dryStreak}/{s.season.rules.pityThreshold}</span>;
}

function AdLink({ ad, viewId, className = "btn ghost" }: { ad: PublicAd; viewId?: number; className?: string }) {
  if (!ad.url) return null;
  return (
    <button className={className} onClick={() => { void post("/api/ads/click", { campaignId: ad.id, viewId }).catch(() => {}); openLink(ad.url!); }}>
      {ad.buttonText ?? "Подробнее"}
    </button>
  );
}

function AdMedia({ ad }: { ad: PublicAd }) {
  if (!ad.mediaUrl) return null;
  return ad.mediaType === "video"
    ? <video className="ad-media" src={asset(ad.mediaUrl)} autoPlay muted playsInline loop />
    : <img className="ad-media" src={asset(ad.mediaUrl)} alt="" />;
}

function AdSheet({ onClose }: { onClose: (gotEgg: boolean) => void }) {
  const { toast } = useGame();
  const [view, setView] = useState<{ viewId: number; ad: PublicAd } | null>(null);
  const [left, setLeft] = useState(0);
  const [claiming, setClaiming] = useState(false);
  useEffect(() => {
    post<{ viewId: number; ad: PublicAd }>("/api/ads/start")
      .then((v) => { setView(v); setLeft(v.ad.durationSec); })
      .catch((e: ApiError) => { toast(e.message); onClose(false); });
  }, []);
  useEffect(() => {
    if (!view || left <= 0) return;
    const t = setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [view, left]);
  const claim = async () => {
    setClaiming(true);
    try { await post(`/api/ads/${view!.viewId}/complete`); toast("Бонусное яйцо добавлено"); onClose(true); }
    catch (e) { toast((e as ApiError).message); setClaiming(false); }
  };
  return (
    <Sheet onClose={() => onClose(false)}>
      <span className="ad-label">Реклама</span>
      {!view ? <div className="spinner" /> : (
        <>
          <AdMedia ad={view.ad} />
          <div className="ad-text">{view.ad.text}</div>
          <AdLink ad={view.ad} viewId={view.viewId} />
          <p className="muted num">{left > 0 ? `Яйцо можно забрать через ${left} сек` : "Готово"}</p>
          <button className="btn" disabled={left > 0 || claiming} onClick={claim}>{left > 0 ? "Подождите…" : "Забрать яйцо"}</button>
        </>
      )}
    </Sheet>
  );
}

function BuySheet({ s, onClose }: { s: GameState; onClose: () => void }) {
  const { toast, refresh } = useGame();
  const [paying, setPaying] = useState(false);
  const price = s.shop.nextPrice!;
  const buy = async () => {
    setPaying(true);
    try {
      const inv = await post<{ link: string; price: number }>("/api/shop/invoice");
      const status = await payInvoice(inv.link);
      if (status === "paid") {
        toast("Оплата прошла. Яйцо появится через пару секунд");
        // Яйцо выдаёт бот после подтверждения оплаты — подождём его
        for (let i = 0; i < 4; i++) { await wait(1500); await refresh(); }
      } else if (status === "external") toast("Счёт открыт в Telegram. После оплаты яйцо появится здесь");
      else if (status === "failed") toast("Оплата не прошла");
      onClose();
    } catch (e) { toast((e as ApiError).message); setPaying(false); }
  };
  const next = s.shop.prices[s.shop.used + 1];
  return (
    <Sheet onClose={onClose}>
      <h2>Яйцо за {price} Stars</h2>
      <p><b>Покупка {s.shop.used + 1} из {s.shop.prices.length}</b> до следующего яйца дня.{next ? ` Следующее будет стоить ${next} Stars.` : ""}</p>
      <p className="muted">Обычные шансы: 60 / 28 / 10 / 2%. Фигурку выбрать нельзя.</p>
      <button className="btn" disabled={paying} onClick={buy}>{STAR}<span>Оплатить {price} Stars</span></button>
    </Sheet>
  );
}

export function EggScreen() {
  const { state: s, refresh, now, toast, setBusy } = useGame();
  useTick();
  const [cls, setCls] = useState("");
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const [banner, setBanner] = useState<PublicAd | null>(null);
  const [sheet, setSheet] = useState<"ad" | "buy" | null>(null);
  useEffect(() => { api<{ ad: PublicAd | null }>("/api/ads/banner").then((r) => setBanner(r.ad)).catch(() => {}); }, []);

  const t = now();
  const nextFree = Date.parse(s.eggs.nextFreeAt);
  const free = t >= nextFree;
  const grant = s.eggs.grants[0];
  const hasEgg = free || !!grant;
  const event = s.season.events.find((e) => e.active && Date.parse(e.endsAt) > t);
  const showAd = s.ads.perDay > 0 && (s.ads.rewarded || s.ads.left === 0);
  const showShop = s.shop.enabled && s.shop.prices.length > 0;

  const tap = async () => {
    if (cls) return;
    if (s.flags.maintenance) return toast("Игра на техработах. Скоро вернёмся");
    if (!hasEgg) {
      haptic.error();
      setCls("nope"); setTimeout(() => setCls(""), 450);
      return toast(`Яйцо будет готово через ${fmtTimer(nextFree - t)}`);
    }
    setBusy(true);
    haptic.shake();
    setCls("shake");
    const req = post<OpenResult>("/api/eggs/open");
    await wait(900);
    let res: OpenResult;
    try { res = await req; }
    catch (e) { setCls(""); setBusy(false); toast((e as ApiError).message); void refresh(); return; }
    haptic.crack();
    setCls("shake cracked"); await wait(480);
    setCls("shake cracked open"); await wait(380);
    setReveal(revealFromEgg(res, s));
  };
  const closeReveal = async () => {
    setReveal(null); setCls(""); setBusy(false);
    await refresh();
  };
  const claimQuest = async (code: string) => {
    try { const r = await post<{ shards: number }>(`/api/quests/${code}/claim`); toast(`Задание выполнено: +${r.shards} осколков`); await refresh(); }
    catch (e) { toast((e as ApiError).message); }
  };

  return (
    <section className="screen">
      <div className="topbar">
        <div className="brand">Сюрприз <span>дня</span></div>
        <div className="pills">
          <span className="pill num" title="Серия дней">{FLAME}<b>{s.me.streak}</b></span>
          <span className="pill num" title="Коллекция"><span><b>{s.progress.unique}</b>/{s.season.mainCount}</span></span>
        </div>
      </div>
      {s.flags.maintenance && <div className="banner"><div><b>Техработы</b><p className="banner-sub">Скоро вернёмся. Яйца пока открыть нельзя.</p></div></div>}
      {event && (
        <div className="banner"><i className="glow" /><div><b>Событие: {event.title}</b>
          <p className="banner-sub">В яйцах встречаются {event.figureCodes.length} особые фигурки. До конца: <span className="num">{dur(Date.parse(event.endsAt) - t)}</span></p></div></div>
      )}
      <div className="stage">
        <button className={`egg-btn ${hasEgg && !cls ? "ready" : ""} ${!hasEgg ? "resting" : ""} ${cls}`} onClick={tap}
          aria-label={hasEgg ? "Открыть яйцо" : "Яйцо ещё не готово"} dangerouslySetInnerHTML={{ __html: EGG_SVG }} />
        <div className="egg-info" aria-live="polite">
          {free ? (<><h1>Яйцо дня готово</h1><p className="sub">Нажмите на яйцо, чтобы открыть</p></>)
            : grant ? (<><h1>Бонусное яйцо</h1>
                <p className="sub">{grant.label}{grant.minRarity ? `: ${RLABEL[grant.minRarity].toLowerCase()} или лучше` : ""}</p>
                <p className="sub">Бесплатное через <b className="num">{fmtTimer(nextFree - t)}</b></p></>)
            : (<><p className="sub">Следующее яйцо через</p><span className="timer">{fmtTimer(nextFree - t)}</span>
                <p className="sub">{s.me.notificationsEnabled ? "Бот напишет, когда яйцо будет готово" : "Включите уведомления в профиле, и бот напомнит"}</p></>)}
          <div className="chips" style={{ marginTop: 8 }}>
            {s.eggs.grants.length > 0 && <span className="chip hot">Бонусных в запасе: {s.eggs.grants.length}</span>}
            <PityChip s={s} />
            {s.me.shards > 0 && <span className="chip num">Осколки: {s.me.shards}</span>}
          </div>
        </div>
      </div>

      {banner && (
        <div className="panel"><span className="ad-label">Реклама</span><AdMedia ad={banner} /><p>{banner.text}</p><AdLink ad={banner} /></div>
      )}

      {!free && (showAd || showShop) && (
        <div className="panel">
          <h2>Хочется ещё яйцо?</h2>
          <div className="btn-row">
            {showAd && (
              <button className="btn ghost" disabled={!s.ads.rewarded} onClick={() => setSheet("ad")}>{s.ads.rewarded ? "Реклама: +1 яйцо" : "Реклама уже была сегодня"}</button>
            )}
            {showShop && (
              <button className="btn" disabled={s.shop.nextPrice == null} onClick={() => setSheet("buy")}>
                {s.shop.nextPrice != null ? <>{STAR}<span>{s.shop.nextPrice} Stars: яйцо</span></> : `Все ${s.shop.prices.length} куплены`}
              </button>
            )}
          </div>
          {showShop && (
            <>
              <div className="chips" style={{ justifyContent: "flex-start" }}>
                {s.shop.prices.map((p, i) => (
                  <span key={i} className={`chip num ${i === s.shop.used ? "hot" : ""}`} style={i < s.shop.used ? { textDecoration: "line-through", opacity: 0.55 } : undefined}>{i + 1}-е: {p} Stars</span>
                ))}
              </div>
              <p className="muted">Каждое следующее дороже. Цена вернётся к {s.shop.prices[0]} Stars вместе с новым яйцом дня. Шансы как у обычного яйца.</p>
            </>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>Задания недели</h2><span className="muted">обновятся через {dur(Date.parse(s.weekEndsAt) - t)}</span></div>
        {s.quests.map((q) => (
          <div className="quest" key={q.code}>
            <div><b>{q.title}</b><p className="muted num">{q.progress}/{q.goal} · +{q.shards} осколков</p></div>
            {q.claimed ? <span className="status ok">Получено</span> : <button className="btn sm" disabled={q.progress < q.goal} onClick={() => claimQuest(q.code)}>Забрать</button>}
            <div className="progress"><i style={{ width: `${(q.progress / q.goal) * 100}%` }} /></div>
          </div>
        ))}
      </div>

      {sheet === "ad" && <AdSheet onClose={(got) => { setSheet(null); if (got) void refresh(); }} />}
      {sheet === "buy" && showShop && s.shop.nextPrice != null && <BuySheet s={s} onClose={() => { setSheet(null); void refresh(); }} />}
      {reveal && <Reveal data={reveal} onClose={closeReveal} />}
    </section>
  );
}
