import { detectBrand, prettifyModel } from "../constants/brands.js";

// Labels seen in Uzbek phone-sale channels ("📱Telefon: iPhone13", "💰 Narxi: 340$", ...).
// Matched against a normalized label (lowercase, no emoji/apostrophes).
const LABELS = [
  // Not $: channels write "Nomi va modeli", "Telefon nomi". A label that turns out to
  // hold a phone number ("Telefon raqam") is re-routed to `contact` below. The trailing
  // guard is Unicode-aware, since `\b` would reject "телефон" at end of string.
  { key: "model", re: /^(telefon|tel|model|modeli|nomi|rusumi|phone|телефон|модель)(?![\p{L}\p{N}])/u },
  { key: "defects", re: /^(aybi|ayb|nuqsoni|nuqson|holati|sostoyanie|состояние|дефект)/ },
  { key: "storage", re: /^(xotira|xotirasi|pamyat|память|memory|rom|gb)/ },
  { key: "ram", re: /^(ram|operativ|оперативка|ozu)/ },
  { key: "battery", re: /^(batareyka|batareya|batarey|akb|akkumulyator|емкость|батарея|ёмкость|battery|emkost)/ },
  { key: "imei", re: /^(imei|imeyka|imeyi|imey|имей)/ },
  { key: "documents", re: /^(dokument|dokumenti|hujjat|karobka|korobka|kaробка|коробка|документ)/ },
  { key: "price", re: /^(narxi|narx|price|цена|нарх|нархи)/ },
  { key: "exchange", re: /^(obmen|almashish|almashuv|обмен)/ },
  { key: "region", re: /^(manzil|manzili|hudud|shahar|viloyat|adres|address|адрес|манзил)/ },
  { key: "contact", re: /^(aloqa|nomer|raqam|tel\s?raqam|murojaat|contact|связь|номер)/ },
  { key: "telegram", re: /^(telegram|tg|lichka|admin|телеграм)/ },
  { key: "color", re: /^(rangi|rang|color|цвет)/ },
  { key: "extra", re: /^(qoshimcha|qo'shimcha|izoh|malumot|ma'lumot|дополнительно|доп)/ },
];

const BUY_RE = /\b(sotib olaman|olaman|kerak|куплю|izlayman|qidiryapman)\b/i;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const PHONE_RE = /(?:\+?998[\s\-()]*)?\(?\d{2}\)?[\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g;

const normLabel = (s) =>
  s
    .replace(EMOJI_RE, "")
    .replace(/[ʻʼ'`‘’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .toLowerCase();

// Emoji become a space, not nothing: these channels glue them to words
// ("#srochno📱Samsung A 36"), and deleting them hid the brand from detectBrand.
const clean = (s) => String(s || "").replace(EMOJI_RE, " ").replace(/\s+/g, " ").trim();

// "sõm" / "sōm" are written with any of these; fold them so one regex matches all.
const foldLatin = (s) => s.replace(/[õōŏôö]/g, "o").replace(/[ūŭûü]/g, "u");

const isPhoneLike = (s) => (s.replace(/\D/g, "").length >= 9 ? /^[\d\s+\-()]+$/.test(s.trim()) : false);

export const normalizeContact = (raw) => {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return "";
};

export const parseStorage = (raw) => {
  const m = String(raw || "").match(/(\d{1,4})\s*(tb|тб|gb|гб|g\b)?/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (/t/i.test(m[2] || "")) n *= 1024;
  return [16, 32, 64, 128, 256, 512, 1024, 2048].includes(n) ? n : null;
};

export const parseBattery = (raw) => {
  const m = String(raw || "").match(/(\d{2,3})\s*%?/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 100 ? n : null;
};

// "340$", "$340", "4 500 000 so'm", "4.5 mln", "450 ming", "340" (bare small => USD)
export const parsePrice = (raw) => {
  const s = foldLatin(String(raw || "").toLowerCase().replace(/[ʻʼ'`‘’]/g, ""));
  const m = s.match(/(\d[\d\s.,]*)/);
  if (!m) return null;

  const numText = m[1].trim();
  const isMln = /(mln|million|млн|миллион)/.test(s);
  const isMing = /(ming|минг|тыс|k\b)/.test(s);
  let value;
  // The tail may be written without a space ("3mln670" = 3 670 000), so the suffix
  // after the unit must not swallow digits - `\w*` did, turning it into 3 000 000.
  const mlnRest = s.match(/(\d+(?:[.,]\d+)?)\s*(?:mln|million|млн|миллион)[^\d\s]*[ \t]*(\d{1,3})?(?!\d)/);
  if (mlnRest) {
    // "2 mln 800" = 2 800 000
    value = Number(mlnRest[1].replace(",", ".")) * 1_000_000 + Number(mlnRest[2] || 0) * 1_000;
  } else if (isMln || isMing) {
    value = Number(numText.replace(/\s/g, "").replace(",", "."));
    value *= isMln ? 1_000_000 : 1_000;
  } else {
    value = Number(numText.replace(/[\s.,]/g, ""));
  }
  if (!Number.isFinite(value) || value <= 0) return null;

  const usd = /(\$|dollar|долл|usd|у\.?е|y\.?e|\bye\b|\bue\b)/.test(s);
  const uzs = /(som|сум|сўм|uzs|mln|млн|ming|минг)/.test(s);
  // Bare number: phone prices under 20 000 are always dollars in these channels.
  const currency = usd ? "USD" : uzs ? "UZS" : value < 20000 ? "USD" : "UZS";
  return { price: Math.round(value), currency };
};

// Regions as the site stores them, with the spellings these channels actually use.
// Many posts carry no "Manzil:" label at all - just "#Toshkent" or "Buxoro Shahar".
// Unicode-aware boundaries, not \b - see the note in constants/brands.js. With \b the
// Cyrillic spellings ("Тошкент") silently never matched.
const rgn = (body) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "iu");
const REGIONS = [
  ["Toshkent", rgn("toshkent|tashkent|тошкент|ташкент")],
  ["Andijon", rgn("andijon|andijan|андижон")],
  ["Farg'ona", rgn("fargona|far.?gona|fergana|ferghana|фаргона|фергана")],
  ["Namangan", rgn("namangan|наманган")],
  ["Samarqand", rgn("samarqand|samarkand|самарканд")],
  ["Buxoro", rgn("buxoro|buhoro|bukhara|бухоро|бухара")],
  ["Navoiy", rgn("navoiy|navoi|навоий|навои")],
  ["Jizzax", rgn("jizzax|jizzak|djizak|жиззах")],
  ["Sirdaryo", rgn("sirdaryo|syrdarya|сирдарё")],
  ["Surxondaryo", rgn("surxondaryo|surkhandarya|сурхондарё")],
  ["Qashqadaryo", rgn("qashqadaryo|kashkadarya|кашкадарё")],
  ["Xorazm", rgn("xorazm|khorezm|urganch|urgench|хоразм|ургенч")],
  ["Qoraqalpog'iston", rgn("qoraqalpog\\w*|karakalpak\\w*|nukus|нукус")],
];

// Only real district names are appended. Taking "the next capitalised word" instead
// produced "Toshkent, Telegram", "Toshkent, Jiddiy" and "Toshkent, Shaxar".
const TASHKENT_DISTRICTS =
  "yunusobod|chilonzor|mirzo\\s?ulug.?bek|yakkasaroy|shayx?ontohur|olmazor|uchtepa|bektemir|sergeli|yashnobod|mirobod|yangihayot";
// Right after a region name: a known district, or anything ending in "tumani"/"rayoni".
const DISTRICT_RE = new RegExp(`^[\\s,]*((?:${TASHKENT_DISTRICTS})|[\\p{L}'ʻ]{3,}\\s+(?:tumani|rayoni))`, "iu");
// A district on its own, anywhere in the post.
const BARE_DISTRICT_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${TASHKENT_DISTRICTS})(?![\\p{L}\\p{N}])`, "iu");

const titleCase = (s) => {
  const t = s.replace(/\s+/g, " ").trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
};

// Finds a region anywhere in the post ("#Toshkent, Yunusobod" -> "Toshkent, Yunusobod").
const findRegion = (raw) => {
  const text = clean(raw);
  for (const [name, re] of REGIONS) {
    const m = text.match(re);
    if (!m) continue;
    const district = text.slice(m.index + m[0].length).match(DISTRICT_RE);
    return (district ? `${name}, ${titleCase(district[1])}` : name).slice(0, 80);
  }
  // A bare Tashkent district implies the city, otherwise "Chilonzor" would never show
  // up under the site's "Toshkent" filter, which matches on substring.
  const bare = text.match(BARE_DISTRICT_RE);
  return bare ? `Toshkent, ${titleCase(bare[1])}` : "";
};

// "Andijon shaxar, Baliqchi tumani" -> "Andijon, Baliqchi tumani"
export const normalizeRegion = (raw) =>
  clean(raw)
    // Sellers append sales copy to the address ("Chilonzor. Dastavka xizmati bor.").
    .split(/[.!?]/)[0]
    .replace(/\b(shaxar|shahar|shahri|shaxri|viloyati|viloyat)\b/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .split(/\s+/)
    .slice(0, 4)
    .join(" ")
    .slice(0, 80);

const yesNo = (raw) => {
  const s = normLabel(raw);
  if (/^(bor|ha|yes|есть|да|bor+)/.test(s)) return "Bor";
  if (/^(yoq|yo'q|yok|нет|net|no)/.test(s)) return "Yo'q";
  return clean(raw);
};

/**
 * Parses a channel post into Phone fields.
 * Returns { fields, signals } where signals tell the caller whether Gemini is needed.
 */
export const parseWithRegex = (text) => {
  const raw = String(text || "");
  const fields = {};
  const counts = { model: 0, price: 0 };
  const extraLines = [];
  let inExtra = false;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const idx = line.search(/[:：\-–—]\s*/);
    const label = idx > 0 ? normLabel(line.slice(0, idx)) : "";
    const value = idx > 0 ? line.slice(idx + 1).replace(/^[\s:：\-–—]+/, "").trim() : "";
    const def = label && label.length <= 25 ? LABELS.find((l) => l.re.test(label)) : null;

    if (!def) {
      if (inExtra) extraLines.push(clean(line));
      continue;
    }
    inExtra = false;

    let key = def.key;
    // "☎️Telefon: +998..." is the contact, "📱Telefon: iPhone13" is the model.
    if (key === "model" && isPhoneLike(value)) key = "contact";

    switch (key) {
      case "model":
        counts.model++;
        if (!fields.model) fields.model = value;
        break;
      case "price": {
        counts.price++;
        const p = parsePrice(value);
        if (p && fields.price == null) Object.assign(fields, p);
        break;
      }
      case "storage":
        fields.storage ??= parseStorage(value);
        break;
      case "ram":
        fields.ram ??= parseStorage(value);
        break;
      case "battery":
        fields.batteryHealth ??= parseBattery(value);
        break;
      case "contact":
        fields.contactPhone ||= normalizeContact(value);
        break;
      case "telegram": {
        const at = value.match(/@[\w\d_]{3,}/);
        fields.telegram ||= at ? at[0] : clean(value);
        break;
      }
      case "region":
        fields.region ||= normalizeRegion(value);
        break;
      case "imei":
      case "documents":
      case "exchange":
        fields[key] ||= yesNo(value);
        break;
      case "defects":
      case "color":
        fields[key] ||= clean(value);
        break;
      case "extra":
        inExtra = true;
        if (value) extraLines.push(clean(value));
        break;
    }
  }

  // Second pass: labels separated by a space instead of a colon, which this kind of
  // channel writes constantly ("💾 Xotirasi 128", "📲 Nomi va modeli 15pro",
  // "💰 Narxi 1.490.000"). Only empty fields are filled and every value is validated,
  // so a stray "Telefon yaxshi ishlaydi" cannot become the model. `counts` is left
  // alone on purpose - guessing here must never make a post look multi-phone.
  for (const line of raw.split(/\r?\n/)) {
    if (/[:：]/.test(line)) continue; // already handled by the labelled pass
    const words = clean(line).split(" ").filter(Boolean);
    if (words.length < 2) continue;

    for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
      const head = words.slice(0, n).join(" ");
      if (/\d/.test(head)) continue; // "Xotirasi 128" is a label plus its value
      const def = LABELS.find((l) => l.re.test(normLabel(head)));
      if (!def) continue;
      const value = words.slice(n).join(" ");

      switch (def.key) {
        case "model":
          // A model always has letters. Without that check "📞 Tel 994661141" became
          // the model, and listings came out titled "Apple 994661141".
          if (isPhoneLike(value)) {
            fields.contactPhone ||= normalizeContact(value);
          } else if (!fields.model && /\p{L}/u.test(value) && (detectBrand(value) || /\d/.test(value))) {
            fields.model = value;
          }
          break;
        case "price":
          if (fields.price == null) Object.assign(fields, parsePrice(value) || {});
          break;
        case "storage":
          fields.storage ??= parseStorage(value);
          break;
        case "ram":
          fields.ram ??= parseStorage(value);
          break;
        case "battery":
          fields.batteryHealth ??= parseBattery(value);
          break;
        case "contact":
          fields.contactPhone ||= normalizeContact(value);
          break;
        case "region":
          fields.region ||= normalizeRegion(value);
          break;
        case "imei":
        case "documents":
        case "exchange":
          fields[def.key] ||= yesNo(value);
          break;
        case "color":
          if (!fields.color && words.length - n <= 3) fields.color = value;
          break;
        default:
          break; // defects/telegram/extra stay with the labelled pass
      }
      break; // longest matching label wins
    }
  }
  // Whole-text fallbacks for posts that don't use labels.
  if (!fields.contactPhone) {
    const m = raw.match(PHONE_RE);
    if (m) fields.contactPhone = normalizeContact(m[0]);
  }
  if (!fields.telegram) {
    const at = raw.match(/@[a-zA-Z][\w\d_]{3,}/);
    if (at) fields.telegram = at[0];
  }
  if (fields.storage == null) {
    const m = raw.match(/\b(\d{2,4})\s?(gb|гб|tb)\b/i);
    if (m) fields.storage = parseStorage(m[0]);
  }
  if (fields.batteryHealth == null) {
    const m = raw.match(/(?:batare\w*|akb|ёмк\w*|емк\w*)[^\d\n]{0,15}(\d{2,3})\s?%/i) || raw.match(/\b(\d{2,3})\s?%/);
    if (m) fields.batteryHealth = parseBattery(m[1]);
  }
  if (fields.price == null) {
    // Matched against folded text so "680,000 sõm" reads as "som".
    const folded = foldLatin(raw);
    const m =
      folded.match(/(\$\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(mln|млн)\w*([ \t]\d{1,3}(?!\d|\s\d))?|\d[\d\s.,]*\s?(\$|dollar|у\.е|y\.e|so'?m|сум))/i) ||
      // Last resort: a dot/comma grouped number ("3.500.000", "680,000", "2.550,000").
      // Separators are limited to . and , on purpose - a space would swallow phone numbers.
      folded.match(/\b\d{1,3}(?:[.,]\d{3})+\b/);
    if (m) Object.assign(fields, parsePrice(m[0]) || {});
  }

  // One spelling wins, whatever the post wrote: "Тошкент", "Manzil nomi Toshkent",
  // "Toshkent dastavka bor" all become "Toshkent". The site filters regions by
  // substring, so inconsistent values would split the catalogue.
  const canonical = findRegion(fields.region || "") || findRegion(raw);
  if (canonical) fields.region = canonical;
  if (extraLines.length) fields.extra = extraLines.join("\n").slice(0, 800);

  // Model / brand
  const modelLine = fields.model || "";
  fields.brandName = detectBrand(modelLine, raw);
  fields.model = prettifyModel(modelLine) || "";
  if (!fields.model && fields.brandName) {
    // e.g. "iPhone 13 128gb sotiladi" without labels
    const m = raw.match(/\b(i\s?phone\s?\d{1,2}(\s?(pro\s?max|pro|max|plus|mini|e))?|galaxy\s?[a-z]\d{1,2}\s?(ultra|plus|fe)?|redmi\s?(note\s?)?\d{1,2}\w*(\s?pro\+?)?|poco\s?[a-z]\d\w*|pixel\s?\d\w*(\s?pro)?)/i);
    if (m) fields.model = prettifyModel(m[0]);
  }
  if (!fields.model && fields.brandName) {
    // Generic: "Honor X8 6/128 ..." -> words after the brand keyword, up to specs/price.
    const line = raw.split(/\r?\n/).find((l) => detectBrand(l));
    const words = line ? clean(line).split(/\s+/) : [];
    const start = words.findIndex((w) => detectBrand(w));
    if (start >= 0) {
      const model = [];
      for (const w of words.slice(start, start + 4)) {
        if (model.length && !/^[A-Za-z0-9+]+$/.test(w)) break; // "6/128", "170$", "—"
        if (model.length && /^(\d{2,4}(gb|гб|tb)|sotiladi|sotaman|narxi|holati|ideal)$/i.test(w)) break;
        model.push(w);
      }
      // Drop the plain brand word ("Honor X8" -> "X8"); the title adds the brand back.
      if (model.length > 1 && !/^(i\s?phone|galaxy|redmi|poco|pixel)/i.test(model[0])) model.shift();
      fields.model = prettifyModel(model.join(" "));
    }
  }

  // Condition / negotiable
  const lower = raw.toLowerCase();
  fields.condition = /\b(yangi|новый|new)\b/i.test(lower) && !/yangi\s*emas|yangidek|как новый/i.test(lower) ? "new" : "used";
  fields.isNegotiable = /(kelish|torg|торг|kelishamiz|kelishiladi)/i.test(lower);

  const signals = {
    hasModel: Boolean(fields.model && fields.brandName),
    hasPrice: fields.price != null,
    multiple: counts.model > 1 || counts.price > 1,
    buyPost: BUY_RE.test(lower) && !/sotiladi|sotaman|продаю|продается/i.test(lower),
  };

  return { fields, signals };
};
