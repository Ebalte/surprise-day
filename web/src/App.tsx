import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isLoggedIn, type ApiError, type GameState } from "./api";
import { GameCtx, useToast, type Game } from "./ui";
import { inTelegram } from "./tg";
import { PromoGift, pendingPromo } from "./screens/PromoGift";
import { Login } from "./Login";
import { EggScreen } from "./screens/EggScreen";
import { CollectionScreen } from "./screens/CollectionScreen";
import { FriendsScreen } from "./screens/FriendsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { PetScreen, livePet, needsCare } from "./screens/PetScreen";

const TABS = [
  { id: "pet", label: "Питомец", icon: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10" /><path d="M12 17.5s-3-1.8-3-3.6a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.8-3 3.6-3 3.6z" /></> },
  { id: "egg", label: "Яйцо", icon: <path d="M12 3c3.6 0 6.5 5.2 6.5 9.6A6.5 6.5 0 0 1 5.5 12.6C5.5 8.2 8.4 3 12 3z" /> },
  { id: "collection", label: "Коллекция", icon: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></> },
  { id: "friends", label: "Друзья", icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M16.5 14.6c2.4.2 4.3 1.8 5 4.6" /></> },
  { id: "profile", label: "Профиль", icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.2 4.2-6.5 8-6.5s7 2.3 8 6.5" /></> },
] as const;
type Tab = (typeof TABS)[number]["id"];
const tabFromHash = (): Tab => (TABS.find((t) => t.id === location.hash.slice(1))?.id ?? "pet");

export function App() {
  if (!inTelegram && !isLoggedIn()) return <Login />;
  return <Game />;
}

function Game() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [busy, setBusy] = useState(false);
  const [inbox, setInbox] = useState(0);
  const skew = useRef(0);
  const { toast, node: toastNode } = useToast();
  const [hasPromo] = useState(pendingPromo);

  const refresh = useCallback(async () => {
    try {
      const s = await api<GameState>("/api/state");
      skew.current = Date.parse(s.serverTime) - Date.now();
      setState(s);
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401 && !inTelegram) { location.reload(); return; }
      setError(err.message);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onHash = () => { setTab(tabFromHash()); scrollTo(0, 0); };
    addEventListener("hashchange", onHash);
    // Вернулись в приложение — обновим таймер и запасы
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => { removeEventListener("hashchange", onHash); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  useEffect(() => { if (state) api<{ gifts: unknown[]; incoming: unknown[] }>("/api/friends").then((f) => setInbox(f.gifts.length + f.incoming.length)).catch(() => {}); }, [state?.me.id]);

  const game: Game | null = useMemo(() => state && ({ state, refresh, now: () => Date.now() + skew.current, toast, busy, setBusy }), [state, refresh, toast, busy]);

  if (!game) {
    return (
      <div className="center-screen"><div>
        {error ? (<><h2>Не получилось загрузить игру</h2><p className="muted">{error}</p><button className="btn" onClick={() => void refresh()}>Попробовать ещё раз</button></>)
          : <div className="spinner" aria-label="Загрузка" />}
      </div></div>
    );
  }
  const eggReady = game.now() >= Date.parse(state!.eggs.nextFreeAt) || state!.eggs.grants.length > 0;

  return (
    <GameCtx.Provider value={game}>
      <div className="app">
        <main>
          {tab === "pet" && <PetScreen />}
          {tab === "egg" && <EggScreen />}
          {tab === "collection" && <CollectionScreen />}
          {tab === "friends" && <FriendsScreen onInbox={setInbox} />}
          {tab === "profile" && <ProfileScreen />}
        </main>
        {hasPromo && <PromoGift />}
      </div>
      <nav className="nav" aria-label="Разделы">
        <div className="nav-inner">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{t.icon}</svg>
              {t.label}
              {t.id === "pet" && tab !== "pet" && needsCare(livePet(state!, game.now())) && <i className="dotn" />}
              {t.id === "egg" && eggReady && tab !== "egg" && <i className="dotn" />}
              {t.id === "friends" && inbox > 0 && <i className="dotn" />}
            </a>
          ))}
        </div>
      </nav>
      {toastNode}
    </GameCtx.Provider>
  );
}
