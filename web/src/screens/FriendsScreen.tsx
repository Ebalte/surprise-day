import { useCallback, useEffect, useState } from "react";
import { api, post, type ApiError, type FriendsView, type MiniFig } from "../api";
import { Fig, Mini, Reveal, Sheet, useGame, type RevealData } from "../ui";
import { shareLink } from "../tg";

const STATUS: Record<string, string> = { PENDING: "Ждём ответа", ACCEPTED: "Принят", DECLINED: "Отклонён", CANCELLED: "Отменён", EXPIRED: "Истёк срок" };

function Pick({ items, selected, onSelect, tag }: {
  items: (MiniFig & { count: number })[]; selected?: string; onSelect: (c: string) => void; tag: (f: MiniFig) => string | null;
}) {
  return (
    <div className="pick">
      {items.map((f) => (
        <button type="button" key={f.code} data-rarity={f.rarity} aria-pressed={selected === f.code} onClick={() => onSelect(f.code)}>
          <Fig f={f} /><span className="cnt num">×{f.count}</span>
          <span className="nm">{f.name}</span>
          {tag(f) && <span className="tag">{tag(f)}</span>}
        </button>
      ))}
    </div>
  );
}

type Friend = FriendsView["friends"][number];

function GiftSheet({ fr, v, onDone, onClose }: { fr: Friend; v: FriendsView; onDone: () => void; onClose: () => void }) {
  const { toast } = useGame();
  const [sel, setSel] = useState<string>();
  const owns = new Set(v.friendOwns[fr.id] ?? []);
  const send = async () => {
    try { await post("/api/gifts", { to: fr.id, code: sel }); toast(`Отправлено: ${fr.name} получит подарок`); onDone(); }
    catch (e) { toast((e as ApiError).message); }
  };
  return (
    <Sheet onClose={onClose}>
      <h2>Подарок другу: {fr.name}</h2>
      <p className="muted">Выберите повторку. Подарков сегодня осталось: {v.giftsLeft} из {v.giftsPerDay}.</p>
      {v.myDupes.length ? <Pick items={v.myDupes} selected={sel} onSelect={setSel} tag={(f) => (owns.has(f.code) ? null : "нет у друга")} />
        : <p className="empty-pick">У вас пока нет повторок. Они появляются, когда из яйца выпадает фигурка, которая уже есть.</p>}
      <button className="btn" disabled={!sel || v.giftsLeft <= 0} onClick={send}>{v.giftsLeft > 0 ? "Подарить" : "Лимит подарков на сегодня исчерпан"}</button>
    </Sheet>
  );
}

function TradeSheet({ fr, v, onDone, onClose }: { fr: Friend; v: FriendsView; onDone: () => void; onClose: () => void }) {
  const { toast } = useGame();
  const [give, setGive] = useState<string>();
  const [want, setWant] = useState<string>();
  const owns = new Set(v.friendOwns[fr.id] ?? []);
  const theirs = v.friendDupes[fr.id] ?? [];
  const send = async () => {
    try { await post("/api/trades", { to: fr.id, give, want }); toast(`Предложение отправлено. ${fr.name} получит уведомление`); onDone(); }
    catch (e) { toast((e as ApiError).message); }
  };
  return (
    <Sheet onClose={onClose}>
      <h2>Обмен с другом: {fr.name}</h2>
      <div className="pick-title"><span>Вы отдаёте</span><span className="muted">ваши повторки</span></div>
      {v.myDupes.length ? <Pick items={v.myDupes} selected={give} onSelect={setGive} tag={(f) => (owns.has(f.code) ? null : "нужна другу")} />
        : <p className="empty-pick">У вас пока нет повторок для обмена.</p>}
      <div className="pick-title"><span>Вы получаете</span><span className="muted">повторки друга</span></div>
      {theirs.length ? <Pick items={theirs} selected={want} onSelect={setWant} tag={(f) => ((f as { isNewForMe?: boolean }).isNewForMe ? "нет у вас" : null)} />
        : <p className="empty-pick">У друга пока нет лишних фигурок.</p>}
      <p className="muted">Пока друг не ответит, ваша фигурка зарезервирована. Предложение действует {v.offerTtlHours} ч.</p>
      <button className="btn" disabled={!give || !want} onClick={send}>Предложить обмен</button>
    </Sheet>
  );
}

export function FriendsScreen({ onInbox }: { onInbox: (n: number) => void }) {
  const { state: s, toast, refresh } = useGame();
  const [v, setV] = useState<FriendsView | null>(null);
  const [sheet, setSheet] = useState<{ kind: "gift" | "trade"; fr: Friend } | null>(null);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const load = useCallback(async () => {
    try { const x = await api<FriendsView>("/api/friends"); setV(x); onInbox(x.gifts.length + x.incoming.length); }
    catch (e) { toast((e as ApiError).message); }
  }, [toast, onInbox]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); if (msg) toast(msg); await Promise.all([load(), refresh()]); }
    catch (e) { toast((e as ApiError).message); void load(); }
  };
  const receive = async (url: string, figure: MiniFig, via: string) => {
    try {
      const r = await post<{ isNew: boolean; count: number; rewards: string[] }>(url);
      setReveal({ figure, outcomeNew: r.isNew, outcome: r.isNew ? "Новая фигурка!" : `Теперь у вас ×${r.count}. Лишнюю можно передарить`, extra: [via, ...r.rewards] });
      await Promise.all([load(), refresh()]);
    } catch (e) { toast((e as ApiError).message); void load(); }
  };
  const copy = () => navigator.clipboard.writeText(s.refLink).then(() => toast("Ссылка скопирована"), () => toast("Не получилось скопировать: выделите ссылку вручную"));
  const byCode = new Map(s.season.figures.map((f) => [f.code, f]));
  const q = v?.qualified ?? 0;

  return (
    <section className="screen">
      <div><h1 style={{ fontSize: 22 }}>Друзья</h1><p className="muted">Приглашайте, дарите повторки и меняйтесь фигурками</p></div>

      {v && (v.gifts.length > 0 || v.incoming.length > 0 || v.suggestions.length > 0) && (
        <div className="panel">
          <div className="panel-head"><h2>Входящие</h2>{v.gifts.length + v.incoming.length > 0 && <span className="chip hot">{v.gifts.length + v.incoming.length}</span>}</div>
          <div>
            {v.gifts.map((g) => (
              <div className="offer" key={`g${g.id}`}><Mini f={g.figure} />
                <div className="txt"><b>{g.from}</b> дарит «{g.figure.name}»{g.isNewForMe && <> <span className="tag">новая для вас</span></>}</div>
                <div className="acts"><button className="btn sm" onClick={() => receive(`/api/gifts/${g.id}/claim`, g.figure, `Подарок, отправитель: ${g.from}`)}>Забрать</button></div>
              </div>
            ))}
            {v.incoming.map((t) => (
              <div className="offer" key={`t${t.id}`}><Mini f={t.get} /><span className="swap">⇄</span><Mini f={t.pay} />
                <div className="txt"><b>{t.from}</b> отдаёт «{t.get.name}»{t.isNewForMe && <> <span className="tag">новая для вас</span></>} за вашу «{t.pay.name}»</div>
                <div className="acts">
                  <button className="btn sm" onClick={() => receive(`/api/trades/${t.id}/accept`, t.get, `Обмен с другом: ${t.from}`)}>Принять</button>
                  <button className="btn sm ghost" onClick={() => act(() => post(`/api/trades/${t.id}/decline`), "Предложение отклонено")}>Отклонить</button>
                </div>
              </div>
            ))}
            {v.suggestions.map((x) => byCode.get(x.give) && byCode.get(x.get) && (
              <div className="offer" key={`s${x.friendId}`}><Mini f={byCode.get(x.give)!} /><span className="swap">⇄</span><Mini f={byCode.get(x.get)!} />
                <div className="txt"><b>{x.name}</b>: выгодный обмен. Ваша «{byCode.get(x.give)!.name}» за «{byCode.get(x.get)!.name}», новинка для обоих</div>
                <div className="acts"><button className="btn sm" onClick={() => act(() => post("/api/trades", { to: x.friendId, give: x.give, want: x.get }), `Предложение отправлено: ${x.name}`)}>Предложить</button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>Друзья</h2><span className="muted num">{v?.friends.length ?? ""}</span></div>
        <div>
          {!v ? <div className="spinner" /> : v.friends.length ? v.friends.map((f) => (
            <div className="friend" key={f.id}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                <span className="ava">{f.photoUrl ? <img src={f.photoUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%" }} /> : f.name[0]}</span>
                <div style={{ minWidth: 0 }}><b>{f.name}</b>
                  <p className="muted" style={{ fontSize: 12 }}>{f.qualified ? `${f.unique}/${s.season.mainCount} · лишних: ${f.dupes}` : "Ещё не открыл(а) первое яйцо"}</p></div>
              </div>
              {f.qualified ? (
                <div className="friend-acts">
                  <button className="btn sm ghost" onClick={() => setSheet({ kind: "gift", fr: f })}>Подарить</button>
                  <button className="btn sm" onClick={() => setSheet({ kind: "trade", fr: f })}>Обмен</button>
                </div>
              ) : <span className="status">Ждём первое яйцо</span>}
            </div>
          )) : <p className="muted">Пока никого. Отправьте другу ссылку ниже: когда он откроет первое яйцо, вам придёт бонусное.</p>}
        </div>
      </div>

      {v && v.outgoing.length > 0 && (
        <div className="panel"><h2>Мои предложения обмена</h2>
          <div>{v.outgoing.slice(0, 6).map((o) => (
            <div className="offer" key={o.id}><Mini f={o.give} /><span className="swap">→</span><Mini f={o.want} />
              <div className="txt"><b>{o.to}</b>: ваша «{o.give.name}» за «{o.want.name}»</div>
              <div className="acts">
                <span className={`status ${o.status === "ACCEPTED" ? "ok" : ""}`}>{STATUS[o.status]}</span>
                {o.status === "PENDING" && <button className="btn sm ghost" onClick={() => act(() => post(`/api/trades/${o.id}/cancel`), "Предложение отменено, фигурка вернулась")}>Отменить</button>}
              </div>
            </div>
          ))}</div>
        </div>
      )}

      <div className="panel">
        <h2>Ваша ссылка</h2>
        <div className="linkbox"><input readOnly value={s.refLink} aria-label="Реферальная ссылка" onFocus={(e) => e.target.select()} /><button className="btn" onClick={copy}>Копировать</button></div>
        <button className="btn ghost" onClick={() => shareLink(s.refLink, "Открывай со мной яйцо-сюрприз каждый день и собирай фигурки!")}>Поделиться в Telegram</button>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Награды за друзей</h2><span className="muted num">Засчитано: {q}</span></div>
        <div className="ladder">
          <div className={`step ${q >= 1 ? "done" : ""}`}><span className="badge-n">+1</span><div><b>Каждый друг</b><p className="muted">Бонусное яйцо, когда друг откроет своё первое</p></div></div>
          <div className={`step ${q >= 3 ? "done" : ""}`}><span className="badge-n num">3</span><div><b>3 друга</b><p className="muted">Яйцо с гарантированной редкой или лучше</p></div></div>
          <div className={`step ${q >= 10 ? "done" : ""}`}><span className="badge-n num">10</span><div><b>10 друзей</b><p className="muted">Яйцо с гарантированной эпической или лучше</p></div></div>
        </div>
      </div>

      <div className="panel">
        <h2>Правила подарков и обмена</h2>
        <ul className="rules">
          <li>Отдавать можно только повторки. Последняя копия остаётся у вас.</li>
          <li>Легендарную нельзя дарить и обменивать.</li>
          <li>Меняться можно с друзьями, которые открыли первое яйцо.</li>
          <li>Подарков в день: {v?.giftsPerDay ?? s.season.rules.trading.giftsPerDay}{v ? `. Сегодня осталось: ${v.giftsLeft}` : ""}.</li>
          <li>Пока обмен ждёт ответа, ваша фигурка зарезервирована.</li>
        </ul>
      </div>

      {sheet?.kind === "gift" && v && <GiftSheet fr={sheet.fr} v={v} onClose={() => setSheet(null)} onDone={() => { setSheet(null); void act(async () => {}); }} />}
      {sheet?.kind === "trade" && v && <TradeSheet fr={sheet.fr} v={v} onClose={() => setSheet(null)} onDone={() => { setSheet(null); void act(async () => {}); }} />}
      {reveal && <Reveal data={reveal} onClose={() => setReveal(null)} />}
    </section>
  );
}
