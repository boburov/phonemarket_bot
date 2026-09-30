import "dotenv/config";

const need = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`ENV o'zgaruvchisi yo'q: ${key}`);
  return v;
};

const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || "development",

  // Bot's own database (jobs, drafts, seen messages) - never the production DB.
  MONGO_URL: need("MONGO_URL"),

  // Admin bot (@BotFather token) and the Telegram user IDs allowed to use it.
  BOT_TOKEN: need("BOT_TOKEN"),
  ADMIN_IDS: list(process.env.ADMIN_IDS).map(Number).filter(Boolean),

  // Userbot (MTProto) - api id/hash from my.telegram.org, session from `npm run login`.
  TG_API_ID: Number(need("TG_API_ID")),
  TG_API_HASH: need("TG_API_HASH"),
  TG_SESSION: process.env.TG_SESSION || "",

  // Production API (telefonbozor) and the bot's seller account.
  API_URL: (process.env.API_URL || "https://api.telefonbozor.uz/api").replace(/\/$/, ""),
  SITE_URL: (process.env.SITE_URL || "https://telefonbozor.uz").replace(/\/$/, ""),
  API_LOGIN: need("API_LOGIN"),
  API_PASSWORD: need("API_PASSWORD"),

  // Gemini - fallback parser only.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.6-flash",

  // Import limits
  MAX_POSTS_PER_JOB: Number(process.env.MAX_POSTS_PER_JOB || 50),
  MAX_SCAN_MESSAGES: Number(process.env.MAX_SCAN_MESSAGES || 500),
  // 0 = no age limit. Posts older than this many days are ignored.
  MAX_POST_AGE_DAYS: Number(process.env.MAX_POST_AGE_DAYS || 0),
  DRAFT_TTL_DAYS: Number(process.env.DRAFT_TTL_DAYS || 3),
  UNDO_WINDOW_HOURS: Number(process.env.UNDO_WINDOW_HOURS || 24),

  // Where downloaded photos are kept until the draft is uploaded/skipped/expired.
  STORAGE_DIR: process.env.STORAGE_DIR || "./storage",
});

export const isProd = env.NODE_ENV === "production";

export default env;
