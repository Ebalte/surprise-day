// Генерирует SVG-заглушки фигурок и бейджей в public/. Замените файлы своими картинками
// с теми же именами — или поменяйте пути в seasons/season1.json.
// Запуск: npm run gen:figures -w web
import fs from "node:fs";
  const FIGS = [
    { code: "fox", name: "Лисёнок Рыжик", rarity: "common", d: "Любит прятаться в листьях.", a: { body: "#EF7A2E", belly: "#FFF1E2", ears: "pointy", snout: 1 } },
    { code: "hedgehog", name: "Ёжик Колючка", rarity: "common", d: "Носит на спине яблоко.", a: { body: "#B98560", belly: "#F4DCC2", ears: "small", spikes: "#6B4630" } },
    { code: "bunny", name: "Зайка Пуша", rarity: "common", d: "Быстрее всех в лесу.", a: { body: "#E4DEF0", belly: "#FFFFFF", ears: "long" } },
    { code: "squirrel", name: "Белочка Шишка", rarity: "common", d: "Хранит орехи на зиму.", a: { body: "#C8692E", belly: "#F6D9B9", ears: "tuft", tail: "#B2561F" } },
    { code: "frog", name: "Лягушонок Квак", rarity: "common", d: "Поёт по вечерам.", a: { body: "#6BBF59", belly: "#D8F0C0", ears: "frog" } },
    { code: "mouse", name: "Мышонок Сырок", rarity: "common", d: "Маленький, но храбрый.", a: { body: "#A9A3B8", belly: "#EEE8F4", ears: "big" } },
    { code: "duck", name: "Утёнок Плюх", rarity: "common", d: "Обожает лужи.", a: { body: "#F8D232", belly: "#FFF2A8", ears: "tuftTop", beak: 1 } },
    { code: "snail", name: "Улитка Тихоня", rarity: "common", d: "Никуда не спешит.", a: { body: "#E8B07A", belly: "#F7DDBF", ears: "antennae", shell: "#B5653A" } },
    { code: "owl", name: "Сова Мудрёна", rarity: "rare", d: "Знает все тайны леса.", a: { body: "#8B6A4E", belly: "#E9D6BE", ears: "tuft", beak: 1, bigeyes: 1 } },
    { code: "bear", name: "Мишка Топтыжка", rarity: "rare", d: "Сладкоежка со стажем.", a: { body: "#9A6238", belly: "#DDB48E", ears: "round", snout: 1 } },
    { code: "raccoon", name: "Енот Полоскун", rarity: "rare", d: "Всё моет до блеска.", a: { body: "#8C8C98", belly: "#E9E9EE", ears: "pointy", mask: 1 } },
    { code: "deer", name: "Оленёнок Искра", rarity: "rare", d: "Пятнышки светятся в темноте.", a: { body: "#C68A55", belly: "#F3DEC4", ears: "antler", spots: 1 } },
    { code: "badger", name: "Барсук Копуша", rarity: "rare", d: "Роет самые глубокие норы.", a: { body: "#55555F", belly: "#EDEDED", ears: "small", stripe: 1, eyering: 1 } },
    { code: "wolf", name: "Волчонок Лунный", rarity: "epic", d: "Воет только на полную луну.", a: { body: "#6F7C96", belly: "#DDE3EE", ears: "pointy", snout: 1, moon: 1 } },
    { code: "lynx", name: "Рысь Кисточка", rarity: "epic", d: "Неслышно ходит по ветвям.", a: { body: "#D7A86E", belly: "#F7E8D2", ears: "tuft", spots: 1, snout: 1 } },
    { code: "firebird", name: "Жар-птица", rarity: "legendary", d: "Говорят, её видели лишь однажды.", a: { body: "#FF6A2B", belly: "#FFD15C", ears: "crest", beak: 1, glow: 1 } },
  ];
  const EVENT = {
    title: "Ночь светлячков", days: 7, dropChance: 0.25, badge: "Светлячок",
    figures: [
      { code: "firefly", name: "Светлячок Искорка", rarity: "common", d: "Освещает тропинки после заката.", a: { body: "#B9D35A", belly: "#F4FF9A", ears: "antennae", wings: "#DDEFF7" } },
      { code: "moth", name: "Мотылёк Пыльца", rarity: "rare", d: "Летит на свет любого фонарика.", a: { body: "#B8A6E0", belly: "#EEE6FF", ears: "antennae", wings: "#8E7BD0" } },
      { code: "mushroom", name: "Грибок Боровик", rarity: "epic", d: "Растёт только в ночь светлячков.", a: { body: "#F3E3C8", belly: "#FFF6E6", ears: "cap" } },
    ],
  };
  const EYE = "#2A1B14";
  function art(f) {
    const a = f.a, b = a.body, w = a.belly;
    let back = "", front = "";
    const tri = (x1, y1, x2, y2, x3, y3, c) => `<path d="M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}Z" fill="${c}"/>`;
    switch (a.ears) {
      case "pointy": case "tuft":
        back += tri(20, 44, 28, 10, 46, 32, b) + tri(80, 44, 72, 10, 54, 32, b) + tri(27, 36, 30, 20, 40, 31, w) + tri(73, 36, 70, 20, 60, 31, w);
        if (a.ears === "tuft") back += `<path d="M28 11l-3-8M28 11l3-8M72 11l-3-8M72 11l3-8" stroke="${EYE}" stroke-width="2.4" stroke-linecap="round"/>`;
        break;
      case "round": back += `<circle cx="27" cy="30" r="12" fill="${b}"/><circle cx="73" cy="30" r="12" fill="${b}"/><circle cx="27" cy="30" r="6" fill="${w}"/><circle cx="73" cy="30" r="6" fill="${w}"/>`; break;
      case "small": back += `<circle cx="30" cy="32" r="8" fill="${b}"/><circle cx="70" cy="32" r="8" fill="${b}"/>`; break;
      case "big": back += `<circle cx="22" cy="32" r="17" fill="${b}"/><circle cx="78" cy="32" r="17" fill="${b}"/><circle cx="22" cy="32" r="10" fill="#FFB3C1"/><circle cx="78" cy="32" r="10" fill="#FFB3C1"/>`; break;
      case "long": back += `<ellipse cx="38" cy="18" rx="8" ry="22" fill="${b}" transform="rotate(-10 38 18)"/><ellipse cx="62" cy="18" rx="8" ry="22" fill="${b}" transform="rotate(10 62 18)"/><ellipse cx="38" cy="20" rx="4" ry="15" fill="#FFC7D2" transform="rotate(-10 38 20)"/><ellipse cx="62" cy="20" rx="4" ry="15" fill="#FFC7D2" transform="rotate(10 62 20)"/>`; break;
      case "frog": back += `<circle cx="32" cy="32" r="13" fill="${b}"/><circle cx="68" cy="32" r="13" fill="${b}"/>`; break;
      case "antler": back += `<path d="M36 32C32 22 26 18 22 8M28 20l-8 2M64 32c4-10 10-14 14-24M72 20l8 2" stroke="#7A4A26" stroke-width="4" stroke-linecap="round" fill="none"/>` + tri(24, 42, 22, 28, 38, 34, b) + tri(76, 42, 78, 28, 62, 34, b); break;
      case "antennae": back += `<path d="M42 32L36 12M58 32l6-20" stroke="${b}" stroke-width="4" stroke-linecap="round"/><circle cx="36" cy="11" r="4" fill="${b}"/><circle cx="64" cy="11" r="4" fill="${b}"/>`; break;
      case "tuftTop": back += `<path d="M50 28c-2-8 2-14 6-16-1 5 0 9-2 16z" fill="${b}"/>`; break;
      case "crest": back += `<path d="M50 30C40 18 44 6 50 0c0 10 8 14 6 30z" fill="#FFB020"/><path d="M40 32C28 24 28 12 32 6c2 10 10 14 12 26z" fill="#FF4D2E"/><path d="M60 32c12-8 12-20 8-26-2 10-10 14-12 26z" fill="#FF4D2E"/>`; break;
    }
    if (a.tail) back += `<path d="M78 82c18-6 20-30 8-40-8-7-18-2-14 8 4 9 8 16 2 30z" fill="${a.tail}"/>`;
    if (a.spikes) {
      let pts = [];
      for (let i = 0; i <= 18; i++) {
        const ang = Math.PI + (Math.PI * i) / 18, r = i % 2 ? 46 : 36;
        pts.push((50 + Math.cos(ang) * r).toFixed(1) + "," + (60 + Math.sin(ang) * r * 0.95).toFixed(1));
      }
      back += `<polygon points="${pts.join(" ")}" fill="${a.spikes}"/><circle cx="50" cy="16" r="6" fill="#E53935"/><path d="M50 10q3-5 6-4" stroke="#3F7D20" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    }
    if (a.glow) back += `<path d="M18 74C4 70 0 56 6 48c4 10 10 12 16 14zM82 74c14-4 18-18 12-26-4 10-10 12-16 14z" fill="#FFB020"/>`;
    if (a.wings) back += `<ellipse cx="18" cy="54" rx="15" ry="22" fill="${a.wings}" opacity=".85" transform="rotate(-25 18 54)"/><ellipse cx="82" cy="54" rx="15" ry="22" fill="${a.wings}" opacity=".85" transform="rotate(25 82 54)"/>`;
    let body = `<ellipse cx="50" cy="62" rx="34" ry="31" fill="${b}"/><ellipse cx="50" cy="75" rx="20" ry="15" fill="${w}"/>`;
    if (a.spots) front += `<circle cx="30" cy="50" r="3" fill="${w}"/><circle cx="72" cy="48" r="2.6" fill="${w}"/><circle cx="66" cy="38" r="2.2" fill="${w}"/><circle cx="34" cy="38" r="2.4" fill="${w}"/>`;
    if (a.stripe) front += `<path d="M45 32Q50 28 55 32L54 58H46Z" fill="#F2F2F2"/>`;
    if (a.mask) front += `<path d="M20 52Q50 38 80 52Q76 63 63 61Q50 54 37 61Q24 63 20 52Z" fill="#3B3743"/>`;
    if (a.moon) front += `<path d="M66 34a7 7 0 1 0 6 10a5.5 5.5 0 1 1-6-10z" fill="#FFE082"/>`;
    if (a.ears === "cap") front += `<path d="M12 52C12 26 30 14 50 14S88 26 88 52Q50 42 12 52Z" fill="#E0433B"/><circle cx="32" cy="34" r="5" fill="#fff"/><circle cx="52" cy="24" r="4" fill="#fff"/><circle cx="70" cy="38" r="5.5" fill="#fff"/>`;
    if (a.shell) front += `<circle cx="72" cy="70" r="20" fill="${a.shell}"/><path d="M72 70m-3 0a3 3 0 1 1 6 0a7 7 0 1 1-13 0a11 11 0 1 1 22 0" stroke="#F7DDBF" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    // глаза
    let eyes;
    if (a.ears === "frog") eyes = `<circle cx="32" cy="31" r="8" fill="#fff"/><circle cx="68" cy="31" r="8" fill="#fff"/><circle cx="33" cy="32" r="4.2" fill="${EYE}"/><circle cx="67" cy="32" r="4.2" fill="${EYE}"/>`;
    else if (a.bigeyes) eyes = `<circle cx="38" cy="52" r="11" fill="#fff"/><circle cx="62" cy="52" r="11" fill="#fff"/><circle cx="39" cy="53" r="5.5" fill="${EYE}"/><circle cx="61" cy="53" r="5.5" fill="${EYE}"/><circle cx="41" cy="51" r="1.8" fill="#fff"/><circle cx="63" cy="51" r="1.8" fill="#fff"/>`;
    else {
      eyes = (a.eyering ? `<circle cx="39" cy="54" r="7.5" fill="#F2F2F2"/><circle cx="61" cy="54" r="7.5" fill="#F2F2F2"/>` : "") +
        `<circle cx="39" cy="54" r="4.6" fill="${EYE}"/><circle cx="61" cy="54" r="4.6" fill="${EYE}"/><circle cx="40.5" cy="52.5" r="1.6" fill="#fff"/><circle cx="62.5" cy="52.5" r="1.6" fill="#fff"/>`;
    }
    let face = `<ellipse cx="31" cy="65" rx="5" ry="3" fill="#FF8FA3" opacity=".55"/><ellipse cx="69" cy="65" rx="5" ry="3" fill="#FF8FA3" opacity=".55"/>`;
    if (a.beak) face += `<path d="M43 62H57L50 72Z" fill="#FF9F1C"/>`;
    else {
      if (a.snout) face += `<ellipse cx="50" cy="67" rx="11" ry="8" fill="${w}"/>`;
      face += `<ellipse cx="50" cy="63" rx="3.4" ry="2.4" fill="${EYE}"/><path d="M46 67q4 4 8 0" stroke="${EYE}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    }
    return `<svg viewBox="0 0 100 100" role="img" aria-label="${f.name}">${back}${body}${front}${eyes}${face}</svg>`;
  }

  const MEDAL = `<svg class="medal" viewBox="0 0 64 64"><path d="M20 4h10l4 18H24zM34 4h10l-4 18H30z" fill="#E53935"/><circle cx="32" cy="40" r="20" fill="#F2B92A"/><circle cx="32" cy="40" r="14" fill="#FFD666"/><path d="M32 30l3 6.4 7 .8-5.2 4.7 1.4 6.9L32 45.3l-6.2 3.5 1.4-6.9-5.2-4.7 7-.8z" fill="#C98A00"/></svg>`;
const write = (p, svg) => fs.writeFileSync(new URL("../public/" + p, import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg"${svg.slice(4)}`);
for (const f of FIGS) write(`figures/season1/${f.code}.svg`, art(f));
for (const f of EVENT.figures) write(`figures/season1/events/${f.code}.svg`, art(f));
write("badges/collector_season1.svg", MEDAL.replace(' class="medal"', ""));
write("badges/event_fireflies.svg", MEDAL.replace(' class="medal"', "").replaceAll("#F2B92A", "#B9D35A").replaceAll("#FFD666", "#E8F77A").replaceAll("#C98A00", "#5E7A1E"));
console.log("ok", FIGS.length + EVENT.figures.length, "figures");
