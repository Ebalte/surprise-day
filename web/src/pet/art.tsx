/**
 * Мордочка питомца поверх картинки фигурки: сон, грусть, радость и аксессуары по уровню.
 * Координаты совпадают с SVG-фигурками (viewBox 0 0 100 100) из scripts/gen-figures.mjs.
 * Для своих картинок фигурок добавьте их глаза в FACES (или оставьте — будет без мимики).
 */
import type { FigureDto } from "../api";
import { asset } from "../util";

export type Expr = "happy" | "ok" | "sad" | "sleep";
type Face = [body: string, kind?: "frog" | "big" | "ring"];
const FACES: Record<string, Face> = {
  fox: ["#EF7A2E"], hedgehog: ["#B98560"], bunny: ["#E4DEF0"], squirrel: ["#C8692E"], frog: ["#6BBF59", "frog"], mouse: ["#A9A3B8"],
  duck: ["#F8D232"], snail: ["#E8B07A"], owl: ["#8B6A4E", "big"], bear: ["#9A6238"], raccoon: ["#8C8C98"], deer: ["#C68A55"],
  badger: ["#55555F", "ring"], wolf: ["#6F7C96"], lynx: ["#D7A86E"], firebird: ["#FF6A2B"], firefly: ["#B9D35A"], moth: ["#B8A6E0"], mushroom: ["#F3E3C8"],
};

/** Названия стилей из ссылок-подарков (сами наряды рисуются ниже, комнаты — в styles.css) */
export const STYLE_NAMES = { outfit: { metal: "Косуха металлиста 🤘" } as Record<string, string>, room: { metal: "Комната металлиста" } as Record<string, string> };

/** Наряд «Металлист»: шипастый ошейник и тёмные очки (во сне очки сняты) */
function metalOutfit(pts: number[][] | null, r: number, expr: Expr) {
  let o = `<path d="M22 83Q50 97 78 83L79 90Q50 105 21 90Z" fill="#1C1C1F"/>`;
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7, x = 22 + 56 * t, y = 84 + Math.sin(Math.PI * t) * 9.5;
    o += `<path d="M${x - 2.6} ${y + 2}L${x} ${y + 9}L${x + 2.6} ${y + 2}Z" fill="#D9DCE3" stroke="#8A8F99" stroke-width=".6"/>`;
  }
  if (pts && expr !== "sleep") {
    const [l, rr] = pts, w = r + 4;
    o += `<path d="M${l[0] + w} ${l[1] - 2}L${rr[0] - w} ${rr[1] - 2}" stroke="#111" stroke-width="2.6"/>`;
    o += pts.map(([x, y]) => `<rect x="${x - w}" y="${y - r - 2}" width="${2 * w}" height="${2 * r + 3}" rx="${r / 1.6}" fill="#111"/><path d="M${x - w + 3} ${y - r + 1}l4 0" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`).join("");
  }
  return o;
}

/** SVG-слой (без обёртки <svg>) с выражением, нарядом и аксессуарами */
export function faceLayer(code: string, expr: Expr, level: number, outfit?: string | null) {
  const face = FACES[code];
  let o = "";
  let eyes: number[][] | null = null, eyeR = 6;
  if (face) {
    const [body, kind] = face;
    const e = kind === "frog" ? { pts: [[32, 31], [68, 31]], r: 9 } : kind === "big" ? { pts: [[38, 52], [62, 52]], r: 12 } : { pts: [[39, 54], [61, 54]], r: kind === "ring" ? 8 : 6 };
    const lid = kind === "ring" ? "#F2F2F2" : body;
    eyes = e.pts; eyeR = e.r;
    if (expr === "sleep") {
      o += e.pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${e.r + 1}" fill="${lid}"/><path d="M${x - e.r + 1} ${y}q${e.r - 1} ${e.r - 1} ${2 * e.r - 2} 0" stroke="#2A1B14" stroke-width="2.4" fill="none" stroke-linecap="round"/>`).join("");
    } else if (expr === "sad") {
      const [l, r] = e.pts;
      o += `<path d="M${l[0] - 7} ${l[1] - e.r - 2}l10 -5M${r[0] + 7} ${r[1] - e.r - 2}l-10 -5" stroke="#2A1B14" stroke-width="2.4" stroke-linecap="round"/>`;
      o += `<path d="M${l[0] - 2} ${l[1] + e.r + 2}q-3 6 0 8q3-2 0-8z" fill="#5BB8F5"/>`;
    } else if (expr === "happy") {
      o += e.pts.map(([x, y]) => `<circle cx="${x + 2}" cy="${y - 2}" r="1.8" fill="#fff"/>`).join("");
    }
  }
  if (outfit === "metal") o += metalOutfit(eyes, eyeR, expr);
  if (level >= 5) o += `<path d="M36 18L40 6l6 8 4-10 4 10 6-8 4 12z" fill="#F2B92A" stroke="#C98A00" stroke-width="1.5"/><circle cx="50" cy="8" r="2.2" fill="#E53935"/>`;
  else if (level >= 3) o += `<path d="M50 24l-12-7v14zM50 24l12-7v14z" fill="#FF6FA5"/><circle cx="50" cy="24" r="3.5" fill="#E2457F"/>`;
  return o;
}

export function PetArt({ f, expr, level, outfit }: { f: FigureDto; expr: Expr; level: number; outfit?: string | null }) {
  return (
    <div className="pet-art">
      <img src={asset(f.image)} alt={f.name} draggable={false} />
      <svg viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: faceLayer(f.code, expr, level, outfit) }} />
    </div>
  );
}

/** Картинка питомца для canvas (мини-игры, сторис) */
export async function petImage(f: FigureDto, expr: Expr, level: number, outfit?: string | null): Promise<HTMLImageElement | null> {
  try {
    let svg = await (await fetch(asset(f.image))).text();
    if (svg.includes("</svg>")) svg = svg.replace("</svg>", faceLayer(f.code, expr, level, outfit) + "</svg>");
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    return img;
  } catch {
    const img = new Image(); img.crossOrigin = "anonymous"; img.src = asset(f.image);
    try { await img.decode(); return img; } catch { return null; }
  }
}
