/**
 * Тонкая обёртка над window.Telegram.WebApp (скрипт telegram-web-app.js в index.html).
 * Вне Telegram все функции тихо ничего не делают, и игра работает как обычный сайт.
 */
type Haptic = {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
};
type WebApp = {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name?: string; is_premium?: boolean } };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  onEvent(e: string, cb: () => void): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  openInvoice(url: string, cb: (status: "paid" | "cancelled" | "failed" | "pending") => void): void;
  requestWriteAccess(cb: (granted: boolean) => void): void;
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  HapticFeedback: Haptic;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
};
declare global {
  interface Window { Telegram?: { WebApp?: WebApp } }
}

export const wa: WebApp | undefined = window.Telegram?.WebApp;
/** Открыто внутри Telegram (есть подписанные данные запуска) */
export const inTelegram = !!wa?.initData;
const supports = (v: string) => !!wa && wa.isVersionAtLeast(v);

export function initTelegram() {
  if (!inTelegram || !wa) return;
  const root = document.documentElement;
  root.classList.add("tg");
  const applyTheme = () => {
    root.dataset.theme = wa.colorScheme;
    const bg = wa.themeParams.secondary_bg_color ?? wa.themeParams.bg_color;
    if (bg && supports("6.1")) {
      wa.setHeaderColor(bg);
      wa.setBackgroundColor(bg);
      wa.setBottomBarColor?.(bg);
    }
  };
  applyTheme();
  wa.onEvent("themeChanged", applyTheme);
  wa.ready();
  wa.expand();
  // Чтобы свайп вниз по коллекции не сворачивал игру
  if (supports("7.7")) wa.disableVerticalSwipes?.();
}

export const haptic = {
  tap: () => supports("6.1") && wa!.HapticFeedback.impactOccurred("light"),
  shake: () => supports("6.1") && wa!.HapticFeedback.impactOccurred("medium"),
  crack: () => supports("6.1") && wa!.HapticFeedback.impactOccurred("heavy"),
  success: () => supports("6.1") && wa!.HapticFeedback.notificationOccurred("success"),
  error: () => supports("6.1") && wa!.HapticFeedback.notificationOccurred("error"),
  /** Короткий щелчок для мини-игр: в Telegram — HapticFeedback, на сайте — вибрация телефона */
  soft: (ms = 6) => { if (supports("6.1")) wa!.HapticFeedback.impactOccurred("soft"); else try { navigator.vibrate?.(ms); } catch { /* нет вибрации */ } },
};

/** Публикация в сторис Telegram (с версии 7.8). mediaUrl — публичная https-картинка. */
export const canShareStory = () => inTelegram && supports("7.8") && !!wa!.shareToStory;
/**
 * Кнопка-ссылка прямо на сторис (widget_link) доступна только с Telegram Premium.
 * Без Premium ссылка идёт в подпись: подпись ограничена 200 символами.
 */
export function shareStory(mediaUrl: string, text: string, link: { url: string; name: string }) {
  if (wa!.initDataUnsafe.user?.is_premium) wa!.shareToStory!(mediaUrl, { text: text.slice(0, 2048), widget_link: link });
  else wa!.shareToStory!(mediaUrl, { text: `${text} ${link.url}`.slice(0, 200) });
}

export function openLink(url: string) {
  if (inTelegram && /^https:\/\/t\.me\//.test(url)) wa!.openTelegramLink(url);
  else if (inTelegram) wa!.openLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Оплата Stars: внутри Telegram — родное окно оплаты, на сайте — ссылка на счёт в Telegram */
export function payInvoice(link: string): Promise<"paid" | "cancelled" | "failed" | "pending" | "external"> {
  if (inTelegram && supports("6.1")) return new Promise((resolve) => wa!.openInvoice(link, resolve));
  window.open(link, "_blank", "noopener");
  return Promise.resolve("external");
}

/** Разрешение боту писать в личку (для напоминаний) */
export function requestWriteAccess(): Promise<boolean> {
  if (!inTelegram || !supports("6.9")) return Promise.resolve(true);
  return new Promise((resolve) => wa!.requestWriteAccess(resolve));
}

/** Системная кнопка «Назад» в шапке Telegram — закрывает открытые окна */
export function useBackButton(onBack: (() => void) | null) {
  if (!inTelegram || !supports("6.1")) return () => {};
  const bb = wa!.BackButton;
  if (!onBack) { bb.hide(); return () => {}; }
  bb.show();
  bb.onClick(onBack);
  return () => { bb.offClick(onBack); bb.hide(); };
}

export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  openLink(share);
}
