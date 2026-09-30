// Keyword -> parent brand name (as it's named in production `Brand` collection).
// Order matters: first match wins, so sub-brands come before generic words.
//
// `\b` is NOT used: in JavaScript it is defined over [A-Za-z0-9_], so `\bсамсунг\b`,
// `\bайфон\b` and every other Cyrillic keyword below could never match - they were
// dead patterns. L and R are the Unicode-aware equivalents.
const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const word = (body, { open = false } = {}) => new RegExp(`${L}(?:${body})${open ? "" : R}`, "iu");

export const BRAND_PATTERNS = [
  // `open`: "iPhone13" and "iPhone 13 Pro" must both match on the prefix alone.
  { brand: "Apple", re: word("i\\s?phone|iphone|айфон|apple", { open: true }) },
  { brand: "Samsung", re: word("samsung|galaxy|самсунг") },
  { brand: "Samsung", re: word("(?:s|a|m|z\\s?(?:flip|fold))\\s?\\d{1,2}\\s?(?:ultra|plus|\\+|fe)?"), weak: true },
  { brand: "Xiaomi", re: word("xiaomi|redmi|poco|mi\\s?\\d+|сяоми|редми") },
  { brand: "Google", re: word("google|pixel") },
  { brand: "OnePlus", re: word("one\\s?plus") },
  { brand: "Honor", re: word("honor") },
  { brand: "Huawei", re: word("huawei|nova|mate\\s?\\d+|p\\d{2}") },
  { brand: "Realme", re: word("realme") },
  { brand: "Tecno", re: word("tecno|camon|spark|pova|phantom") },
  // The word "Infinix" is unambiguous, and posts glue it to other words
  // ("SAINFINIX SMART 8"), so no boundary at all. "Hot 40" / "Note 12 Pro" are not.
  { brand: "Infinix", re: /infinix/iu },
  { brand: "Infinix", re: word("hot\\s?\\d+|note\\s?\\d+\\s?pro"), weak: true },
  // "Vivi Y27S" is a common misspelling in these channels.
  { brand: "Vivo", re: word("viv[oi]") },
  { brand: "Oppo", re: word("oppo") },
  { brand: "Nothing", re: word("nothing\\s?phone") },
  { brand: "Motorola", re: word("motorola|moto\\s?[gex]\\d*") },
];

// Guess parent brand from free text (model line first, then whole post).
export const detectBrand = (modelText, fullText = "") => {
  for (const source of [modelText, fullText]) {
    if (!source) continue;
    const strong = BRAND_PATTERNS.find((p) => !p.weak && p.re.test(source));
    if (strong) return strong.brand;
  }
  // Weak patterns (e.g. "A52", "S21") only on the model line itself.
  const weak = BRAND_PATTERNS.find((p) => p.weak && modelText && p.re.test(modelText));
  return weak ? weak.brand : "";
};

// True if the text itself names a brand/line ("iPhone", "Galaxy", "Vivo"), ignoring weak guesses like "A52".
export const mentionsBrand = (text) => BRAND_PATTERNS.some((p) => !p.weak && p.re.test(text || ""));

// Tidy up model names: "iPhone13promax" -> "iPhone 13 Pro Max".
export const prettifyModel = (raw) => {
  if (!raw) return "";
  let s = String(raw)
    .replace(/[_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  s = s.replace(/\b(i\s?phone|айфон)\s*/i, "iPhone ");
  // Only split long words from numbers ("iPhone13", "Note12"), keep "X8", "A52", "S21".
  s = s.replace(/([a-z]{3,})(\d)/gi, "$1 $2").replace(/(\d)(pro|max|plus|mini|ultra|lite)/gi, "$1 $2");
  s = s.replace(/promax/gi, "Pro Max");
  s = s.replace(/\b(pro|max|plus|mini|ultra|lite|note|galaxy|redmi|poco|pixel)\b/gi, (w) =>
    w[0].toUpperCase() + w.slice(1).toLowerCase(),
  );
  s = s.replace(/\bse\b/gi, "SE").replace(/\bfe\b/gi, "FE");
  // Keep only the model part if storage/colour leaked into the line.
  s = s.replace(/\s*\d{2,4}\s?(gb|гб|tb)\b.*$/i, "");
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
};
