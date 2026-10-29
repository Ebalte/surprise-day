/**
 * Вход вне Telegram (обычный браузер). Внутри Mini App этот экран не показывается:
 * там пользователь уже известен по подписанным данным запуска.
 */
import { useEffect, useRef, useState } from "react";
import { devLogin, post, saveToken, type ApiError } from "./api";
import { EGG_SVG } from "./ui";

const BOT = import.meta.env.VITE_BOT_USERNAME as string | undefined;
const DEV = import.meta.env.VITE_DEV_LOGIN === "true";
const ref = () => new URLSearchParams(location.search).get("ref") ?? undefined;

declare global {
  interface Window { onTelegramAuth?: (user: Record<string, unknown>) => void }
}

export function Login() {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!BOT || !box.current) return;
    window.onTelegramAuth = async (data) => {
      try {
        const { token } = await post<{ token: string }>("/api/auth/widget", { data, ref: ref() });
        saveToken(token);
        location.replace(location.pathname);
      } catch (e) { setError((e as ApiError).message); }
    };
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.dataset.telegramLogin = BOT;
    s.dataset.size = "large";
    s.dataset.radius = "14";
    s.dataset.onauth = "onTelegramAuth(user)";
    s.dataset.requestAccess = "write"; // разрешение боту присылать напоминания
    box.current.appendChild(s);
  }, []);

  return (
    <div className="center-screen">
      <div>
        <div className="egg-btn ready" style={{ width: 160 }} dangerouslySetInnerHTML={{ __html: EGG_SVG }} />
        <h1>Сюрприз <span style={{ color: "var(--accent)" }}>дня</span></h1>
        <p className="muted">Каждый день новое яйцо с фигуркой внутри. Войдите через Telegram, чтобы начать собирать коллекцию.</p>
        <div ref={box} />
        {BOT && BOT && <p className="muted" style={{ fontSize: 13 }}>Или откройте игру прямо в Telegram: <a href={`https://t.me/${BOT}`}>@{BOT}</a></p>}
        {!BOT && <p className="error-box">Не задан VITE_BOT_USERNAME: виджет входа не настроен.</p>}
        {error && <p className="error-box">{error}</p>}
        {DEV && (
          <button className="btn ghost" onClick={() => { devLogin(111111, ref()); location.reload(); }}>Войти как тестовый игрок (dev)</button>
        )}
      </div>
    </div>
  );
}
