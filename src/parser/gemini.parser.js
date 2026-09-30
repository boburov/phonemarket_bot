import env from "../config/env.js";
import logger from "../config/logger.js";

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const PROMPT = `You extract phone-sale listings from Uzbek/Russian Telegram posts.
Return JSON only. Rules:
- isSale: true only if the post sells a phone (not buying, not a shop/service ad, not news).
- multiplePhones: true if the post sells more than one different phone.
- brand: parent brand in English (Apple, Samsung, Xiaomi for Redmi/Poco, Google, OnePlus, Huawei, Honor, Realme, Tecno, Infinix, Vivo, Oppo, Nothing, Motorola). Empty if unknown.
- model: clean model name without brand noise, e.g. "iPhone 13 Pro", "Galaxy S21", "Redmi Note 12".
- price: number as written; currency "USD" if $/dollar/y.e or bare number under 20000, else "UZS". Convert "mln" and "ming".
- storageGb/ramGb: integers in GB. batteryHealth: 0-100 percent.
- condition: "new" only if explicitly new/yangi, otherwise "used".
- contactPhone: seller phone digits, telegram: @username.
- region: city/region in Latin Uzbek, e.g. "Andijon, Baliqchi tumani".
- imei, documents, exchange: "Bor" / "Yo'q" / "" if unknown. defects: short text. extra: other useful seller notes.
Use null or "" when a value is not in the post. Never invent values.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    isSale: { type: "BOOLEAN" },
    multiplePhones: { type: "BOOLEAN" },
    brand: { type: "STRING" },
    model: { type: "STRING" },
    price: { type: "NUMBER", nullable: true },
    currency: { type: "STRING", enum: ["USD", "UZS"] },
    isNegotiable: { type: "BOOLEAN" },
    condition: { type: "STRING", enum: ["new", "used"] },
    storageGb: { type: "INTEGER", nullable: true },
    ramGb: { type: "INTEGER", nullable: true },
    batteryHealth: { type: "INTEGER", nullable: true },
    color: { type: "STRING" },
    region: { type: "STRING" },
    contactPhone: { type: "STRING" },
    telegram: { type: "STRING" },
    imei: { type: "STRING" },
    documents: { type: "STRING" },
    exchange: { type: "STRING" },
    defects: { type: "STRING" },
    extra: { type: "STRING" },
  },
  required: ["isSale", "multiplePhones", "brand", "model"],
};

export const geminiEnabled = () => Boolean(env.GEMINI_API_KEY);

/** Returns the raw Gemini extraction, or null if Gemini is off or failed. */
export const parseWithGemini = async (text) => {
  if (!geminiEnabled()) return null;

  const body = {
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: "user", parts: [{ text: String(text).slice(0, 4000) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
    },
  };

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${URL_BASE}/${env.GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`Gemini ${res.status}`);
      const json = await res.json();
      if (!res.ok) {
        logger.error({ status: res.status, error: json?.error?.message }, "Gemini xato");
        return null;
      }
      const out = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
      return out ? JSON.parse(out) : null;
    } catch (err) {
      logger.warn({ err: err.message, attempt }, "Gemini so'rovi muvaffaqiyatsiz");
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  return null;
};
