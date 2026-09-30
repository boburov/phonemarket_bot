import { InputFile, InputMediaBuilder } from "grammy";
import fs from "node:fs";
import logger from "../config/logger.js";
import Draft from "../models/draft.model.js";
import { nextPending, pendingCount } from "../services/draft.service.js";
import { cardText, reviewKeyboard } from "./format.js";

const existing = (paths) => paths.filter((p) => fs.existsSync(p));

/** Sends the next pending draft as photos + a card with buttons. */
export const sendNextCard = async (api, chatId, { excludeId } = {}) => {
  const draft = await nextPending(excludeId);
  if (!draft) {
    await api.sendMessage(chatId, "🎉 Ko'rib chiqiladigan e'lon qolmadi.");
    return null;
  }
  return sendCard(api, chatId, draft);
};

export const sendCard = async (api, chatId, draft) => {
  const photos = existing(draft.photos);
  try {
    if (photos.length === 1) {
      await api.sendPhoto(chatId, new InputFile(photos[0]));
    } else if (photos.length > 1) {
      await api.sendMediaGroup(
        chatId,
        photos.slice(0, 10).map((p) => InputMediaBuilder.photo(new InputFile(p))),
      );
    }
  } catch (err) {
    logger.warn({ err: err.message }, "Rasmlarni yuborib bo'lmadi");
  }

  const total = await pendingCount();
  const msg = await api.sendMessage(chatId, cardText(draft, { position: { remaining: total } }), {
    parse_mode: "HTML",
    reply_markup: reviewKeyboard(draft, total),
    link_preview_options: { is_disabled: true },
  });
  await Draft.updateOne({ _id: draft._id }, { reviewMessageId: msg.message_id, reviewChatId: chatId });
  return draft;
};

/** Re-renders an existing card in place (after edit/confirm/skip). */
export const refreshCard = async (api, draft, { keyboard } = {}) => {
  if (!draft.reviewChatId || !draft.reviewMessageId) return;
  const total = await pendingCount();
  const active = ["pending", "failed"].includes(draft.status);
  try {
    await api.editMessageText(
      draft.reviewChatId,
      draft.reviewMessageId,
      cardText(draft, active ? { position: { remaining: total } } : {}),
      {
        parse_mode: "HTML",
        reply_markup: keyboard || reviewKeyboard(draft, total),
        link_preview_options: { is_disabled: true },
      },
    );
  } catch (err) {
    if (!String(err.description || err.message).includes("message is not modified")) {
      logger.warn({ err: err.message }, "Kartani yangilab bo'lmadi");
    }
  }
};
