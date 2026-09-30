import { mentionsBrand } from "../constants/brands.js";

// Draft fields -> production `Phone` create payload (see server phones.validators.js).

export const buildTitle = (f) => {
  const model = f.model || "";
  // "iPhone 13", "Galaxy A52", "Vivo Y20" already name the brand - don't prepend.
  const withBrand = !f.brandName || mentionsBrand(model) ? model : `${f.brandName} ${model}`;
  const storage = f.storage ? ` ${f.storage >= 1024 ? `${f.storage / 1024}TB` : `${f.storage}GB`}` : "";
  return `${withBrand}${storage}`.trim().slice(0, 120);
};

// Info without a production field goes into the description (decided: schema later).
export const buildDescription = (f) => {
  const lines = [];
  if (f.defects) lines.push(`🛠 Nuqsoni: ${f.defects}`);
  if (f.imei) lines.push(`❗️ IMEI: ${f.imei}`);
  if (f.documents) lines.push(`📦 Hujjat/karobka: ${f.documents}`);
  if (f.exchange) lines.push(`🔄 Obmen: ${f.exchange}`);
  if (f.telegram) lines.push(`📩 Telegram: ${f.telegram}`);
  if (f.extra) lines.push("", `ℹ️ ${f.extra}`);
  return lines.join("\n").trim().slice(0, 2000);
};

export const buildPayload = (fields, imageUrls = []) => {
  const payload = {
    title: buildTitle(fields),
    brand: fields.brandId,
    model: (fields.model || "").slice(0, 80),
    description: buildDescription(fields),
    price: fields.price,
    currency: fields.currency || "UZS",
    isNegotiable: Boolean(fields.isNegotiable),
    condition: fields.condition || "used",
    storage: fields.storage ?? null,
    ram: fields.ram ?? null,
    batteryHealth: fields.batteryHealth ?? null,
    images: imageUrls.slice(0, 10),
    region: (fields.region || "").slice(0, 80),
    contactPhone: (fields.contactPhone || "").slice(0, 30),
  };
  if (fields.color) payload.color = fields.color.slice(0, 40);
  return payload;
};

// What's missing before a draft can be uploaded (shown on the review card).
export const missingForUpload = (f) => {
  const missing = [];
  if (!f.brandId) missing.push("brend");
  if (!f.model) missing.push("model");
  if (f.price == null) missing.push("narx");
  return missing;
};
