/**
 * Ссылка-подарок: t.me/<бот>/<игра>?startapp=promo_<код> (в Telegram) или сайт/?promo=<код>.
 * Код запоминаем до входа и забираем подарок, как только игра загрузилась.
 */
import { useEffect, useState } from "react";
import { post, type ApiError } from "../api";
import { Sheet, useGame } from "../ui";
import { wa } from "../tg";
import { PetArt, STYLE_NAMES } from "../pet/art";
import { RoomMetal } from "./PetScreen";

const KEY = "surprise-day-promo";
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* приватный режим */ } },
};
// Читаем код один раз при запуске: из start_param Telegram или из адреса сайта
(() => {
  const sp = wa?.initDataUnsafe.start_param ?? "";
  const code = sp.startsWith("promo_") ? sp.slice(6) : new URLSearchParams(location.search).get("promo");
  if (code && /^[a-z0-9]{4,32}$/.test(code)) store.set(code);
  // Убираем код из адреса, чтобы при обновлении страницы не просить подарок снова
  if (new URLSearchParams(location.search).has("promo")) history.replaceState(null, "", location.pathname + location.hash);
})();
export const pendingPromo = () => !!store.get();

type Claim = { title: string; items: string[] };
let claiming = false; // один запрос за запуск, даже если эффект сработает дважды

export function PromoGift() {
  const { state: s, toast, refresh } = useGame();
  const [gift, setGift] = useState<Claim | null>(null);
  useEffect(() => {
    const code = store.get();
    if (!code || claiming) return;
    claiming = true;
    post<Claim>("/api/promo/claim", { code })
      .then(async (r) => { store.set(null); await refresh(); setGift(r); })
      .catch((e: ApiError) => {
        if (e.status !== 0) store.set(null);
        // Повторно открытая ссылка (тот же запуск в Telegram) — молча, подарок уже у игрока
        if (e.code !== "promo_claimed") toast(e.message);
      });
  }, []);
  if (!gift) return null;
  const f = s.season.figures.find((x) => x.code === s.pet.active);
  const close = () => { setGift(null); location.hash = "pet"; };
  const names = gift.items.map((i) => { const [k, c] = i.split(":"); return STYLE_NAMES[k as "outfit" | "room"]?.[c] ?? i; });
  return (
    <Sheet onClose={close}>
      <h2>🎁 {gift.title}</h2>
      {f && (
        <div className="room theme-metal gift-room">
          <RoomMetal />
          <div className="pet-wrap idle"><PetArt f={f} expr="happy" level={1} outfit={s.pet.style.outfit} /></div>
        </div>
      )}
      <p>{names.join(" и ")} — уже надеты на вашего питомца.</p>
      <p className="muted">{f ? "Снять или надеть снова можно кнопкой «Стиль питомца» на экране питомца." : "Откройте первое яйцо: из него вылупится питомец, и подарок будет на нём."}</p>
      <button className="btn" onClick={close}>{f ? "Посмотреть" : "Отлично"}</button>
    </Sheet>
  );
}
