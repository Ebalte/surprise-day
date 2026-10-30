/**
 * Приглашение в пати: t.me/<бот>/<игра>?startapp=pair_<код> (в Telegram) или сайт/?pair=<код>.
 * Код запоминаем до входа; после загрузки игры показываем, кто зовёт, и ждём согласия.
 */
import { useEffect, useState } from "react";
import { api, post, type ApiError } from "../api";
import { Sheet, useGame } from "../ui";
import { wa } from "../tg";
import { PetArt } from "../pet/art";
import { setPetView } from "./PetScreen";

const KEY = "surprise-day-pair-invite";
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* приватный режим */ } },
};
(() => {
  const sp = wa?.initDataUnsafe.start_param ?? "";
  const code = sp.startsWith("pair_") ? sp.slice(5) : new URLSearchParams(location.search).get("pair");
  if (code && /^[A-Za-z0-9]{4,16}$/.test(code)) store.set(code.toUpperCase());
  if (new URLSearchParams(location.search).has("pair")) history.replaceState(null, "", location.pathname + location.hash);
})();
export const pendingPairInvite = () => !!store.get();

type Preview = { owner: string; kind: "couple" | "friends"; figureCode: string; full: boolean; mine: boolean };

export function PairInvite() {
  const { state: s, toast, refresh } = useGame();
  const [inv, setInv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const code = store.get();
  useEffect(() => {
    if (!code) return;
    api<Preview>(`/api/pair/invite/${code}`)
      .then((p) => {
        // Уже в этой пати или это своё приглашение — ничего не показываем
        if (p.mine) { store.set(null); toast("Это ваше приглашение. Отправьте его второму игроку"); return; }
        if (s.pair && s.pair.pet.code === p.figureCode && s.pair.partner?.name === p.owner) { store.set(null); return; }
        setInv(p);
      })
      .catch((e: ApiError) => { if (e.status !== 0) store.set(null); toast(e.message); });
  }, []);
  if (!inv || !code) return null;
  const f = s.season.figures.find((x) => x.code === inv.figureCode);
  const close = () => { store.set(null); setInv(null); };
  const accept = async () => {
    setBusy(true);
    try {
      await post("/api/pair/join", { code });
      store.set(null); setPetView("pair"); await refresh();
      toast(inv.kind === "friends" ? "Вы в пати! Питомец теперь общий 🤝" : "Вы в пати! Питомец теперь общий 💞");
      setInv(null);
      location.hash = "pet";
    } catch (e) { toast((e as ApiError).message); setBusy(false); }
  };
  const heart = inv.kind === "friends" ? "🤝" : "💞";
  return (
    <Sheet onClose={close}>
      <h2>{heart} Приглашение в пати</h2>
      {f && <div className="pet-invite"><PetArt f={f} expr="happy" level={1} /></div>}
      <p><b>{inv.owner}</b> зовёт вас растить вместе {f ? `«${f.name}»` : "питомца"}.</p>
      {inv.full ? <p className="muted">В этой пати уже двое. Попросите новое приглашение.</p>
        : s.pair ? <p className="muted">Вы уже в другой пати. Чтобы принять приглашение, сначала выйдите из неё на экране «Питомец» → «Общий».</p>
        : <>
          <p className="muted">Кормите, мойте и играйте по очереди. Если оба позаботятся в один день, растёт серия заботы. В мини-играх вы вместе набираете очки командной цели.</p>
          <button className="btn" disabled={busy} onClick={() => void accept()}>Принять {heart}</button>
        </>}
    </Sheet>
  );
}
