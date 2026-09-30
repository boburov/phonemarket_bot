import { parseWithRegex, normalizeContact, normalizeRegion } from "./regex.parser.js";
import { parseWithGemini } from "./gemini.parser.js";
import { detectBrand, prettifyModel } from "../constants/brands.js";

const pick = (a, b) => (a === undefined || a === null || a === "" ? b : a);

// Fill regex gaps with Gemini values - regex wins where it found something.
const merge = (fields, g) => ({
  ...fields,
  brandName: pick(fields.brandName, g.brand ? detectBrand(g.brand) || g.brand : ""),
  model: pick(fields.model, prettifyModel(g.model)),
  price: pick(fields.price, g.price > 0 ? Math.round(g.price) : null),
  currency: fields.price != null ? fields.currency : g.currency || "UZS",
  isNegotiable: fields.isNegotiable || Boolean(g.isNegotiable),
  condition: fields.condition === "new" || g.condition === "new" ? "new" : "used",
  storage: pick(fields.storage, g.storageGb || null),
  ram: pick(fields.ram, g.ramGb || null),
  batteryHealth: pick(fields.batteryHealth, g.batteryHealth > 0 && g.batteryHealth <= 100 ? g.batteryHealth : null),
  color: pick(fields.color, g.color || ""),
  region: pick(fields.region, normalizeRegion(g.region || "")),
  contactPhone: pick(fields.contactPhone, normalizeContact(g.contactPhone)),
  telegram: pick(fields.telegram, g.telegram || ""),
  imei: pick(fields.imei, g.imei || ""),
  documents: pick(fields.documents, g.documents || ""),
  exchange: pick(fields.exchange, g.exchange || ""),
  defects: pick(fields.defects, g.defects || ""),
  extra: pick(fields.extra, g.extra || ""),
});

/**
 * Parse a post. Returns
 *   { ok: true, fields, parsedBy }  or  { ok: false, reason }
 * reason: empty | multiple | not_sale | unparsed
 */
export const parsePost = async (text) => {
  if (!text || text.trim().length < 10) return { ok: false, reason: "empty" };

  const { fields, signals } = parseWithRegex(text);
  // One phone per post - multi-phone posts are skipped (decided, no splitting).
  if (signals.multiple) return { ok: false, reason: "multiple" };

  const complete = signals.hasModel && signals.hasPrice;
  if (complete && !signals.buyPost) return { ok: true, fields, parsedBy: "regex" };

  const g = await parseWithGemini(text);
  if (!g) {
    // Gemini off/failed: keep only posts regex fully understood.
    return complete && !signals.buyPost ? { ok: true, fields, parsedBy: "regex" } : { ok: false, reason: "unparsed" };
  }
  if (!g.isSale) return { ok: false, reason: "not_sale" };
  if (g.multiplePhones) return { ok: false, reason: "multiple" };

  const merged = merge(fields, g);
  if (!merged.model || merged.price == null) return { ok: false, reason: "unparsed" };
  return { ok: true, fields: merged, parsedBy: "gemini" };
};
