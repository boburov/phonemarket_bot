import { Bot, InlineKeyboard } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import env from "../config/env.js";
import logger from "../config/logger.js";
import Draft from "../models/draft.model.js";
import Job from "../models/job.model.js";
import { getBrands } from "../api/prod.client.js";
import { parseChannelInput } from "../userbot/scanner.js";
import { enqueueJob, cancelJob, activeJobFor, setImportHooks, countActiveJobs } from "../services/import.service.js";
import { uploadDraft, skipDraft, undoUpload, canUndo, pendingCount } from "../services/draft.service.js";
import { missingForUpload } from "../services/listing.js";
import {
  parsePrice,
  parseStorage,
  parseBattery,
  normalizeContact,
  normalizeRegion,
} from "../parser/regex.parser.js";
import { esc, EDIT_FIELDS, editKeyboard, optionsKeyboard, brandKeyboard } from "./format.js";
import { sendNextCard, refreshCard } from "./review.js";

// Per-admin conversation state (lost on restart - only the in-progress question).
// { step: "channel" } | { step: "count", channel } | { step: "field", draftId, field }
const state = new Map();

const HELP = `👋 <b>E'lon import boti</b>

/import — kanaldan e'lonlarni yig'ish
/review — ko'rib chiqilmagan e'lonlarni davom ettirish
/jobs — oxirgi importlar
/stats — statistika
/cancel — joriy import yoki amalni bekor qilish`;

const JOB_STATUS = {
  queued: "🕓 navbatda",
  running: "🔎 ishlamoqda",
  done: "✅ tugadi",
  cancelled: "⛔️ bekor qilindi",
  failed: "❗️ xato",
};

const progressText = (job) =>
  `🔎 <b>@${esc(job.channel)}</b> skanerlanmoqda…\n\n` +
  `Ko'rildi: ${job.scanned} xabar\n` +
  `Topildi: <b>${job.found}/${job.requested}</b>\n` +
  `Dublikat: ${job.duplicates} · O'tkazildi: ${job.skipped} · Oldin olingan: ${job.alreadySeen}`;

const summaryText = (job) => {
  if (job.status === "failed") return `❗️ <b>@${esc(job.channel)}</b> importi xato bilan tugadi:\n${esc(job.error)}`;
  const head = job.status === "cancelled" ? "⛔️ Import bekor qilindi" : "✅ Import tugadi";
  let text =
    `${head}: <b>@${esc(job.channel)}</b>\n\n` +
    `${job.found} topildi · ${job.duplicates} dublikat · ${job.skipped} tahlil qilinmadi/mos emas · ` +
    `${job.alreadySeen} oldin olingan\n${job.scanned} xabar ko'rildi`;
  if (job.status === "done" && job.found < job.requested) {
    text += `\n\n<i>${job.requested} ta topilmadi: ${
      job.scanned >= env.MAX_SCAN_MESSAGES ? `${env.MAX_SCAN_MESSAGES} xabar limitiga yetildi` : "kanal tarixi tugadi"
    }.</i>`;
  }
  return text;
};

const NO_BUTTONS = { inline_keyboard: [] };

const cancelJobKb = (job) => new InlineKeyboard().text("❌ Bekor qilish", `jc:${job._id}`);

export const createAdminBot = () => {
  const bot = new Bot(env.BOT_TOKEN);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  // Only whitelisted admins; everyone else is ignored silently.
  bot.use(async (ctx, next) => {
    if (ctx.from && env.ADMIN_IDS.includes(ctx.from.id)) return next();
    if (ctx.chat?.type === "private") logger.warn({ from: ctx.from?.id }, "Admin emas - e'tiborsiz");
  });

  // ---------- Import progress hooks ----------
  const lastEdit = new Map();
  setImportHooks({
    progress: async (job) => {
      const key = String(job._id);
      if (!job.progressMessageId || Date.now() - (lastEdit.get(key) || 0) < 3000) return;
      lastEdit.set(key, Date.now());
      await bot.api
        .editMessageText(job.chatId, job.progressMessageId, progressText(job), {
          parse_mode: "HTML",
          reply_markup: cancelJobKb(job),
        })
        .catch(() => {});
    },
    wait: async (job, seconds) => {
      await bot.api.sendMessage(job.chatId, `⏳ Telegram cheklovi: ${seconds} soniya kutilmoqda, keyin davom etadi…`);
    },
    finished: async (job) => {
      lastEdit.delete(String(job._id));
      if (job.progressMessageId) {
        await bot.api
          .editMessageText(job.chatId, job.progressMessageId, summaryText(job), { parse_mode: "HTML" })
          .catch(() => bot.api.sendMessage(job.chatId, summaryText(job), { parse_mode: "HTML" }));
      } else {
        await bot.api.sendMessage(job.chatId, summaryText(job), { parse_mode: "HTML" });
      }
      if (job.found > 0) await sendNextCard(bot.api, job.chatId);
    },
  });

  // ---------- Commands ----------
  bot.command("start", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("import", async (ctx) => {
    state.set(ctx.from.id, { step: "channel" });
    await ctx.reply("📡 Kanal manzilini yuboring (masalan <code>@kanal</code> yoki <code>https://t.me/kanal</code>):", {
      parse_mode: "HTML",
    });
  });

  bot.command("review", async (ctx) => {
    state.delete(ctx.from.id);
    await sendNextCard(ctx.api, ctx.chat.id);
  });

  bot.command("cancel", async (ctx) => {
    const had = state.delete(ctx.from.id);
    const job = await activeJobFor(ctx.from.id);
    if (job) {
      await cancelJob(job._id);
      return ctx.reply(`⛔️ @${job.channel} importi bekor qilinmoqda…`);
    }
    return ctx.reply(had ? "Bekor qilindi." : "Bekor qilinadigan narsa yo'q.");
  });

  bot.command("jobs", async (ctx) => {
    const jobs = await Job.find().sort({ createdAt: -1 }).limit(10);
    if (!jobs.length) return ctx.reply("Hali import qilinmagan.");
    const lines = jobs.map(
      (j) =>
        `${JOB_STATUS[j.status]} <b>@${esc(j.channel)}</b> — ${j.found}/${j.requested} topildi` +
        ` · ${j.createdAt.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`,
    );
    return ctx.reply(`🗂 <b>Oxirgi importlar</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
  });

  bot.command("stats", async (ctx) => {
    const [byStatus, byChannel] = await Promise.all([
      Draft.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      Draft.aggregate([
        { $match: { status: "uploaded" } },
        { $group: { _id: "$channel", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 10 },
      ]),
    ]);
    const s = Object.fromEntries(byStatus.map((x) => [x._id, x.n]));
    let text =
      `📊 <b>Statistika</b>\n\n` +
      `✅ Yuklangan: ${s.uploaded || 0}\n🕓 Kutilmoqda: ${s.pending || 0}\n` +
      `❌ O'tkazilgan: ${s.skipped || 0}\n⌛️ Muddati o'tgan: ${s.expired || 0}\n` +
      `🗑 O'chirilgan: ${s.deleted || 0}\n❗️ Xato: ${s.failed || 0}`;
    if (byChannel.length) {
      text += `\n\n<b>Kanallar bo'yicha (yuklangan):</b>\n` + byChannel.map((c) => `@${esc(c._id)} — ${c.n}`).join("\n");
    }
    return ctx.reply(text, { parse_mode: "HTML" });
  });

  // ---------- Text input (import dialog + field edits) ----------
  bot.on("message:text", async (ctx, next) => {
    const st = state.get(ctx.from.id);
    if (!st || ctx.message.text.startsWith("/")) return next();
    const text = ctx.message.text.trim();

    if (st.step === "channel") {
      const res = parseChannelInput(text);
      if (res.error === "private") return ctx.reply("🔒 Faqat ochiq (public) kanallar. @username yuboring.");
      if (res.error) return ctx.reply("Noto'g'ri manzil. Masalan: @kanal yoki https://t.me/kanal");
      state.set(ctx.from.id, { step: "count", channel: res.username });
      return ctx.reply(`🔢 Nechta e'lon kerak? (1–${env.MAX_POSTS_PER_JOB})`);
    }

    if (st.step === "count") {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1 || n > env.MAX_POSTS_PER_JOB) {
        return ctx.reply(`1 dan ${env.MAX_POSTS_PER_JOB} gacha son yuboring.`);
      }
      state.delete(ctx.from.id);
      const ahead = await countActiveJobs();
      const draftJob = { channel: st.channel, requested: n, scanned: 0, found: 0, duplicates: 0, skipped: 0, alreadySeen: 0 };
      const msg = await ctx.reply(
        ahead ? `🕓 Navbatga qo'yildi (oldinda ${ahead} ta import).` : progressText(draftJob),
        { parse_mode: "HTML" },
      );
      const job = await enqueueJob({
        adminId: ctx.from.id,
        chatId: ctx.chat.id,
        channel: st.channel,
        requested: n,
        progressMessageId: msg.message_id,
      });
      await ctx.api.editMessageReplyMarkup(ctx.chat.id, msg.message_id, { reply_markup: cancelJobKb(job) }).catch(() => {});
      return;
    }

    if (st.step === "field") {
      const draft = await Draft.findById(st.draftId);
      if (!draft || !["pending", "failed"].includes(draft.status)) {
        state.delete(ctx.from.id);
        return ctx.reply("Bu e'lon endi tahrirlanmaydi.");
      }
      const err = applyTextEdit(draft, st.field, text);
      if (err) return ctx.reply(`⚠️ ${err}`);
      await draft.save();
      state.delete(ctx.from.id);
      await ctx.deleteMessage().catch(() => {});
      await refreshCard(ctx.api, draft);
      return;
    }
    return next();
  });

  // ---------- Buttons ----------
  const loadDraft = async (ctx, id) => {
    const draft = await Draft.findById(id);
    if (!draft) await ctx.answerCallbackQuery({ text: "E'lon topilmadi", show_alert: true });
    return draft;
  };

  bot.callbackQuery(/^ok:(\w+)$/, async (ctx) => {
    const draft = await loadDraft(ctx, ctx.match[1]);
    if (!draft) return;
    const missing = missingForUpload(draft.fields);
    if (missing.length) {
      return ctx.answerCallbackQuery({ text: `Avval to'ldiring: ${missing.join(", ")}`, show_alert: true });
    }
    await ctx.answerCallbackQuery({ text: "Yuklanmoqda…" });
    draft.status = "uploading";
    await refreshCard(ctx.api, draft, { keyboard: NO_BUTTONS });

    const result = await uploadDraft(draft._id).catch((e) => {
      ctx.reply(`⚠️ ${e.message}`);
      return null;
    });
    const fresh = result || (await Draft.findById(draft._id));
    await refreshCard(ctx.api, fresh);
    if (fresh.status === "uploaded") await sendNextCard(ctx.api, ctx.chat.id, { excludeId: fresh._id });
  });

  bot.callbackQuery(/^skip:(\w+)$/, async (ctx) => {
    const draft = await skipDraft(ctx.match[1]);
    await ctx.answerCallbackQuery(draft ? { text: "O'tkazib yuborildi" } : { text: "Allaqachon ko'rilgan" });
    if (!draft) return;
    state.delete(ctx.from.id);
    await refreshCard(ctx.api, draft);
    await sendNextCard(ctx.api, ctx.chat.id, { excludeId: draft._id });
  });

  bot.callbackQuery(/^undo:(\w+)$/, async (ctx) => {
    try {
      const { ok, draft } = await undoUpload(ctx.match[1]);
      if (!ok) {
        return ctx.answerCallbackQuery({
          text: draft && !canUndo(draft) ? `${env.UNDO_WINDOW_HOURS} soatlik muddat o'tgan` : "O'chirib bo'lmaydi",
          show_alert: true,
        });
      }
      await ctx.answerCallbackQuery({ text: "Saytdan o'chirildi" });
      await refreshCard(ctx.api, draft, { keyboard: NO_BUTTONS });
    } catch (err) {
      await ctx.answerCallbackQuery({ text: `Xato: ${err.message}`.slice(0, 190), show_alert: true });
    }
  });

  // Edit menu
  bot.callbackQuery(/^edit:(\w+)$/, async (ctx) => {
    const draft = await loadDraft(ctx, ctx.match[1]);
    if (!draft) return;
    await ctx.answerCallbackQuery();
    await refreshCard(ctx.api, draft, { keyboard: editKeyboard(draft) });
  });

  bot.callbackQuery(/^back:(\w+)$/, async (ctx) => {
    const draft = await loadDraft(ctx, ctx.match[1]);
    if (!draft) return;
    state.delete(ctx.from.id);
    await ctx.answerCallbackQuery();
    await refreshCard(ctx.api, draft);
  });

  bot.callbackQuery(/^f:(\w+):(\w+)$/, async (ctx) => {
    const [, id, field] = ctx.match;
    const draft = await loadDraft(ctx, id);
    if (!draft) return;
    const def = EDIT_FIELDS[field];
    await ctx.answerCallbackQuery();
    if (def.kind === "brand") {
      return refreshCard(ctx.api, draft, { keyboard: brandKeyboard(draft, await getBrands()) });
    }
    if (def.kind === "enum") return refreshCard(ctx.api, draft, { keyboard: optionsKeyboard(draft, field) });
    state.set(ctx.from.id, { step: "field", draftId: id, field });
    return ctx.reply(`✏️ <b>${def.label}</b> uchun yangi qiymatni yuboring (tozalash uchun <code>-</code>):`, {
      parse_mode: "HTML",
    });
  });

  bot.callbackQuery(/^set:(\w+):(\w+):(\w+)$/, async (ctx) => {
    const [, id, field, value] = ctx.match;
    const draft = await loadDraft(ctx, id);
    if (!draft) return;
    if (!EDIT_FIELDS[field]?.options?.[value]) return ctx.answerCallbackQuery();
    draft.fields[field] = value;
    await draft.save();
    await ctx.answerCallbackQuery({ text: "Saqlandi" });
    await refreshCard(ctx.api, draft);
  });

  bot.callbackQuery(/^br:(\w+):(\w+)$/, async (ctx) => {
    const [, id, brandId] = ctx.match;
    const draft = await loadDraft(ctx, id);
    if (!draft) return;
    const brand = (await getBrands()).find((b) => String(b._id) === brandId);
    if (!brand) return ctx.answerCallbackQuery({ text: "Brend topilmadi", show_alert: true });
    draft.fields.brandId = String(brand._id);
    draft.fields.brandName = brand.name;
    await draft.save();
    await ctx.answerCallbackQuery({ text: `Brend: ${brand.name}` });
    await refreshCard(ctx.api, draft);
  });

  // Confirm all: ask first, then upload every ready pending draft.
  bot.callbackQuery("all", async (ctx) => {
    const total = await pendingCount();
    await ctx.answerCallbackQuery();
    await ctx.reply(`⚠️ Kutilayotgan <b>${total}</b> ta e'lonning hammasi saytga yuklansinmi?`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✅ Ha, yuklash", "all:yes").text("Yo'q", "all:no"),
    });
  });

  bot.callbackQuery("all:no", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery("all:yes", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Boshlandi" });
    const drafts = await Draft.find({ status: "pending" }).sort({ createdAt: 1 });
    let ok = 0;
    let failed = 0;
    let notReady = 0;
    await ctx.editMessageText(`⏳ Yuklanmoqda… 0/${drafts.length}`).catch(() => {});
    for (const [i, d] of drafts.entries()) {
      if (missingForUpload(d.fields).length) {
        notReady++;
        continue;
      }
      const res = await uploadDraft(d._id).catch(() => null);
      if (res?.status === "uploaded") ok++;
      else failed++;
      if (res) await refreshCard(ctx.api, res);
      if (i % 3 === 2) await ctx.editMessageText(`⏳ Yuklanmoqda… ${i + 1}/${drafts.length}`).catch(() => {});
    }
    let text = `✅ Yuklandi: <b>${ok}</b>`;
    if (failed) text += `\n❗️ Xato: ${failed} (kartadagi 🔁 tugmasi bilan qayta urinish mumkin)`;
    if (notReady) text += `\n⚠️ To'ldirilmagan (brend/model/narx): ${notReady} — /review orqali tugating`;
    await ctx.editMessageText(text, { parse_mode: "HTML" }).catch(() => ctx.reply(text, { parse_mode: "HTML" }));
  });

  bot.callbackQuery(/^jc:(\w+)$/, async (ctx) => {
    const job = await cancelJob(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: job ? "Bekor qilinmoqda…" : "Import allaqachon tugagan" });
    if (job?.status === "cancelled") {
      await ctx.editMessageText(`⛔️ @${job.channel} importi bekor qilindi.`).catch(() => {});
    }
  });

  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery({ text: "Eskirgan tugma" }));
  bot.on("message", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.catch((err) => logger.error({ err: err.error?.message || err.message }, "Bot xatosi"));

  return bot;
};

// Applies a typed value to a draft field. Returns an error message or null.
function applyTextEdit(draft, field, text) {
  const f = draft.fields;
  const clear = text === "-";
  switch (field) {
    case "model":
      if (clear) return "Model bo'sh bo'lishi mumkin emas";
      f.model = text.slice(0, 80);
      return null;
    case "price": {
      const p = parsePrice(text);
      if (!p) return "Narxni tushunmadim. Masalan: 340$ yoki 4 500 000 so'm";
      f.price = p.price;
      f.currency = p.currency;
      return null;
    }
    case "storage":
    case "ram": {
      if (clear) return void (f[field] = null);
      const n = parseStorage(text);
      if (!n) return "GB da yozing: 64, 128, 256…";
      f[field] = n;
      return null;
    }
    case "batteryHealth": {
      if (clear) return void (f.batteryHealth = null);
      const n = parseBattery(text);
      if (!n) return "1–100 oralig'ida foiz yozing";
      f.batteryHealth = n;
      return null;
    }
    case "contactPhone": {
      if (clear) return void (f.contactPhone = "");
      const p = normalizeContact(text);
      if (!p) return "Raqam formati: +998 90 123 45 67";
      f.contactPhone = p;
      return null;
    }
    case "region":
      f.region = clear ? "" : normalizeRegion(text);
      return null;
    case "color":
    case "defects":
    case "extra":
      f[field] = clear ? "" : text.slice(0, field === "extra" ? 800 : 200);
      return null;
    default:
      return "Bu maydonni tahrirlab bo'lmaydi";
  }
}
