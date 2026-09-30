import { InlineKeyboard } from "grammy";
import { buildTitle, buildDescription, missingForUpload } from "../services/listing.js";
import { listingUrl } from "../api/prod.client.js";
import env from "../config/env.js";

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const fmtNum = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export const fmtPrice = (f) =>
  f.price == null ? "—" : f.currency === "USD" ? `${fmtNum(f.price)} $` : `${fmtNum(f.price)} so'm`;

export const CONDITIONS = { new: "Yangi", like_new: "Yangidek", used: "Ishlatilgan" };

// Editable fields: key -> label. `kind` decides button options vs. text input.
export const EDIT_FIELDS = {
  model: { label: "Model", kind: "text" },
  brand: { label: "Brend", kind: "brand" },
  price: { label: "Narx", kind: "text" },
  currency: { label: "Valyuta", kind: "enum", options: { USD: "USD $", UZS: "UZS so'm" } },
  condition: { label: "Holat", kind: "enum", options: CONDITIONS },
  storage: { label: "Xotira", kind: "text" },
  ram: { label: "RAM", kind: "text" },
  batteryHealth: { label: "Batareya", kind: "text" },
  region: { label: "Hudud", kind: "text" },
  contactPhone: { label: "Telefon", kind: "text" },
  color: { label: "Rang", kind: "text" },
  defects: { label: "Nuqson", kind: "text" },
  extra: { label: "Qo'shimcha", kind: "text" },
};

const STATUS_LINE = {
  uploading: "⏳ <b>Yuklanmoqda…</b>",
  skipped: "❌ <b>O'tkazib yuborildi</b>",
  expired: "⌛️ <b>Muddati o'tdi</b>",
  deleted: "🗑 <b>Saytdan o'chirildi</b>",
};

export const cardText = (draft, { position } = {}) => {
  const f = draft.fields;
  const L = [];
  L.push(`📱 <b>${esc(buildTitle(f) || "Model noma'lum")}</b>`);
  L.push(
    f.brandId
      ? `🏷 Brend: ${esc(f.brandName)}`
      : `🏷 Brend: ⚠️ <b>tanlanmagan</b>${f.brandName ? ` (topildi: ${esc(f.brandName)} — bazada yo'q)` : ""}`,
  );
  L.push(`💰 Narx: <b>${fmtPrice(f)}</b>${f.isNegotiable ? " (kelishiladi)" : ""}`);
  L.push(`💾 Xotira: ${f.storage ? `${f.storage} GB` : "—"}${f.ram ? ` · RAM ${f.ram} GB` : ""}`);
  L.push(`🔋 Batareya: ${f.batteryHealth != null ? `${f.batteryHealth}%` : "—"}`);
  L.push(`✨ Holat: ${CONDITIONS[f.condition] || f.condition}`);
  if (f.color) L.push(`🎨 Rang: ${esc(f.color)}`);
  L.push(`📍 Hudud: ${esc(f.region) || "—"}`);
  L.push(`☎️ Tel: ${esc(f.contactPhone) || "—"}`);

  const desc = buildDescription(f);
  if (desc) L.push("", `📝 <b>Tavsif:</b>`, `<i>${esc(desc.slice(0, 700))}</i>`);

  L.push("", `🖼 Rasmlar: ${draft.photos.length ? `${draft.photos.length} ta` : "yo'q (rasmsiz yuklanadi)"}`);
  L.push(`🔗 Manba: <a href="${esc(draft.sourceUrl)}">@${esc(draft.channel)}/${draft.messageId}</a>`);
  if (draft.parsedBy === "gemini") L.push("🤖 Gemini orqali tahlil qilindi — tekshiring");
  if (draft.duplicateOf) L.push("⚠️ <b>Ehtimoliy dublikat</b> (shu raqam + model avval olingan)");

  const missing = missingForUpload(f);
  if (missing.length && ["pending", "failed"].includes(draft.status)) {
    L.push(`⚠️ To'ldirish kerak: <b>${missing.join(", ")}</b>`);
  }

  if (draft.status === "uploaded") {
    L.push("", `✅ <b>Yuklandi:</b> ${esc(listingUrl(draft.phoneId))}`);
  } else if (draft.status === "failed") {
    L.push("", `❗️ <b>Yuklashda xato:</b> ${esc(draft.error)}`);
  } else if (STATUS_LINE[draft.status]) {
    L.push("", STATUS_LINE[draft.status]);
  }
  if (position) L.push("", `<i>Qolgan: ${position.remaining} ta</i>`);
  return L.join("\n");
};

export const reviewKeyboard = (draft, pendingTotal) => {
  const id = String(draft._id);
  const kb = new InlineKeyboard();
  if (draft.status === "pending") {
    const missing = missingForUpload(draft.fields);
    if (!draft.fields.brandId) kb.text("🏷 Brend tanlash", `f:${id}:brand`).row();
    if (!missing.length) kb.text("✅ Tasdiqlash", `ok:${id}`);
    kb.text("❌ O'tkazib yuborish", `skip:${id}`).row();
    kb.text("✏️ Tahrirlash", `edit:${id}`);
    if (pendingTotal > 1) kb.row().text(`✅ Hammasini tasdiqlash (${pendingTotal})`, "all");
  } else if (draft.status === "failed") {
    kb.text("🔁 Qayta urinish", `ok:${id}`).text("❌ O'tkazib yuborish", `skip:${id}`);
  } else if (draft.status === "uploaded") {
    kb.url("🌐 Saytda ko'rish", listingUrl(draft.phoneId));
    kb.text(`🗑 O'chirish (${env.UNDO_WINDOW_HOURS} soat)`, `undo:${id}`);
  }
  return kb;
};

export const editKeyboard = (draft) => {
  const id = String(draft._id);
  const kb = new InlineKeyboard();
  Object.entries(EDIT_FIELDS).forEach(([key, def], i) => {
    kb.text(def.label, `f:${id}:${key}`);
    if (i % 3 === 2) kb.row();
  });
  return kb.row().text("⬅️ Orqaga", `back:${id}`);
};

export const optionsKeyboard = (draft, field) => {
  const id = String(draft._id);
  const kb = new InlineKeyboard();
  for (const [value, label] of Object.entries(EDIT_FIELDS[field].options)) {
    kb.text(label, `set:${id}:${field}:${value}`).row();
  }
  return kb.text("⬅️ Orqaga", `edit:${id}`);
};

export const brandKeyboard = (draft, brands) => {
  const id = String(draft._id);
  const kb = new InlineKeyboard();
  brands.forEach((b, i) => {
    kb.text(b.name, `br:${id}:${b._id}`);
    if (i % 3 === 2) kb.row();
  });
  return kb.row().text("❌ O'tkazib yuborish", `skip:${id}`).text("⬅️ Orqaga", `back:${id}`);
};
