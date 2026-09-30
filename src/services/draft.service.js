import fs from "node:fs/promises";
import path from "node:path";
import env from "../config/env.js";
import logger from "../config/logger.js";
import Draft from "../models/draft.model.js";
import { uploadImages, createPhone, deletePhone, ApiError } from "../api/prod.client.js";
import { buildPayload, missingForUpload } from "./listing.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry network errors / 5xx / 429 three times; 4xx validation errors fail at once.
const retry = async (fn) => {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
      if (!retryable || attempt === 3) break;
      await sleep(attempt * 2000);
    }
  }
  throw lastErr;
};

export const removePhotos = async (draft) => {
  if (!draft.photos?.length) return;
  const dir = path.dirname(draft.photos[0]);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
};

export const pendingCount = () => Draft.countDocuments({ status: "pending" });

export const nextPending = (excludeId = null) =>
  Draft.findOne({ status: "pending", ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).sort({
    createdAt: 1,
  });

/** Upload one draft to production. Returns the updated draft (status uploaded|failed). */
export const uploadDraft = async (draftId) => {
  const draft = await Draft.findOneAndUpdate(
    { _id: draftId, status: { $in: ["pending", "failed"] } },
    { status: "uploading", error: "" },
    { new: true },
  );
  if (!draft) return null; // already handled by someone else

  const missing = missingForUpload(draft.fields);
  if (missing.length) {
    draft.status = "pending";
    await draft.save();
    throw new Error(`To'ldirilmagan: ${missing.join(", ")}`);
  }

  try {
    const urls = draft.photos.length ? await retry(() => uploadImages(draft.photos)) : [];
    const phone = await retry(() => createPhone(buildPayload(draft.fields, urls)));
    draft.status = "uploaded";
    draft.phoneId = String(phone._id);
    draft.uploadedAt = new Date();
    await draft.save();
    await removePhotos(draft);
    logger.info({ draft: String(draft._id), phone: draft.phoneId }, "E'lon yuklandi");
  } catch (err) {
    draft.status = "failed";
    draft.error = err.message;
    await draft.save();
    logger.error({ draft: String(draft._id), err: err.message }, "Yuklash xatosi");
  }
  return draft;
};

export const skipDraft = async (draftId) => {
  const draft = await Draft.findOneAndUpdate(
    { _id: draftId, status: { $in: ["pending", "failed"] } },
    { status: "skipped" },
    { new: true },
  );
  if (draft) await removePhotos(draft);
  return draft;
};

export const canUndo = (draft) =>
  draft.status === "uploaded" &&
  draft.uploadedAt &&
  Date.now() - draft.uploadedAt.getTime() < env.UNDO_WINDOW_HOURS * 3_600_000;

/** Undo: delete the listing from production (only inside the undo window). */
export const undoUpload = async (draftId) => {
  const draft = await Draft.findById(draftId);
  if (!draft || !canUndo(draft)) return { ok: false, draft };
  try {
    await deletePhone(draft.phoneId);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err; // 404 = already gone
  }
  draft.status = "deleted";
  await draft.save();
  return { ok: true, draft };
};

/** Pending drafts older than DRAFT_TTL_DAYS expire (phone is probably sold). */
export const expireOldDrafts = async () => {
  const cutoff = new Date(Date.now() - env.DRAFT_TTL_DAYS * 86_400_000);
  const old = await Draft.find({ status: { $in: ["pending", "failed"] }, createdAt: { $lt: cutoff } });
  for (const d of old) {
    d.status = "expired";
    await d.save();
    await removePhotos(d);
  }
  if (old.length) logger.info({ count: old.length }, "Eski draftlar muddati o'tdi");
  return old.length;
};
