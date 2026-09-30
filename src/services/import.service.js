import path from "node:path";
import env from "../config/env.js";
import logger from "../config/logger.js";
import Job from "../models/job.model.js";
import Draft from "../models/draft.model.js";
import Seen from "../models/seen.model.js";
import { parsePost } from "../parser/index.js";
import { findBrandId } from "../api/prod.client.js";
import { resolveChannel, scanPosts, downloadPhotos } from "../userbot/scanner.js";

// Hooks set by the admin bot so the runner can talk to the admin.
const hooks = {
  progress: async (_job) => {},
  wait: async (_job, _seconds) => {},
  finished: async (_job) => {},
};
export const setImportHooks = (h) => Object.assign(hooks, h);

const cancelRequested = new Set();
let running = false;

export const countActiveJobs = () => Job.countDocuments({ status: { $in: ["queued", "running"] } });

export const enqueueJob = async ({ adminId, chatId, channel, requested, progressMessageId }) => {
  const job = await Job.create({ adminId, chatId, channel, requested, progressMessageId });
  setImmediate(processQueue);
  return job;
};

export const cancelJob = async (jobId) => {
  const job = await Job.findById(jobId);
  if (!job || !["queued", "running"].includes(job.status)) return null;
  if (job.status === "queued") {
    job.status = "cancelled";
    job.finishedAt = new Date();
    await job.save();
  } else {
    cancelRequested.add(String(job._id));
  }
  return job;
};

export const activeJobFor = (adminId) =>
  Job.findOne({ adminId, status: { $in: ["queued", "running"] } }).sort({ createdAt: -1 });

// Jobs left "running" by a crash/restart can't resume - mark them failed.
export const recoverJobs = async () => {
  const res = await Job.updateMany(
    { status: "running" },
    { status: "failed", error: "Bot qayta ishga tushdi", finishedAt: new Date() },
  );
  if (res.modifiedCount) logger.warn({ count: res.modifiedCount }, "To'xtab qolgan importlar failed qilindi");
  setImmediate(processQueue);
};

// One import at a time (decided): pick the oldest queued job until none left.
async function processQueue() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = await Job.findOneAndUpdate(
        { status: "queued" },
        { status: "running", startedAt: new Date() },
        { sort: { createdAt: 1 }, new: true },
      );
      if (!job) break;
      await runJob(job);
    }
  } finally {
    running = false;
  }
}

const markSeen = (channel, messageId, outcome) =>
  Seen.updateOne({ channel, messageId }, { $setOnInsert: { outcome } }, { upsert: true });

const findDuplicate = async (fields) => {
  if (!fields.contactPhone || !fields.model) return null;
  return Draft.findOne({
    "fields.contactPhone": fields.contactPhone,
    "fields.model": fields.model,
    status: { $in: ["pending", "uploading", "uploaded", "failed"] },
  }).select("_id");
};

async function runJob(job) {
  const onWait = (seconds) => hooks.wait(job, seconds).catch(() => {});
  const minDate = env.MAX_POST_AGE_DAYS ? Date.now() - env.MAX_POST_AGE_DAYS * 86_400_000 : 0;

  try {
    const entity = await resolveChannel(job.channel, onWait);
    job.channel = entity.username; // canonical casing

    const posts = scanPosts(entity, {
      maxMessages: env.MAX_SCAN_MESSAGES,
      onWait,
      onScanned: (n) => {
        job.scanned = n;
        hooks.progress(job).catch(() => {});
      },
    });

    for await (const post of posts) {
      if (cancelRequested.has(String(job._id))) break;
      if (job.found >= job.requested) break;
      if (minDate && post.date.getTime() < minDate) break; // history is newest-first

      if (await Seen.exists({ channel: job.channel, messageId: post.messageId })) {
        job.alreadySeen++;
        continue;
      }

      const parsed = await parsePost(post.text);
      if (!parsed.ok) {
        job.skipped++;
        await markSeen(job.channel, post.messageId, `skipped:${parsed.reason}`);
        continue;
      }

      const fields = parsed.fields;
      fields.brandId = await findBrandId(fields.brandName);
      const dup = await findDuplicate(fields);
      const dir = path.join(env.STORAGE_DIR, job.channel, String(post.messageId));
      const photos = await downloadPhotos(post.photoMessages, dir, onWait);

      const created = await Draft.create({
        job: job._id,
        channel: job.channel,
        messageId: post.messageId,
        postedAt: post.date,
        sourceUrl: `https://t.me/${job.channel}/${post.messageId}`,
        rawText: post.text,
        photos,
        fields,
        parsedBy: parsed.parsedBy,
        duplicateOf: dup?._id || null,
      }).catch((err) => {
        if (err.code === 11000) return null; // draft exists (crash before markSeen)
        throw err;
      });
      await markSeen(job.channel, post.messageId, "draft");
      if (!created) {
        job.alreadySeen++;
        continue;
      }

      job.found++;
      if (dup) job.duplicates++;
      hooks.progress(job).catch(() => {});
    }

    job.status = cancelRequested.has(String(job._id)) ? "cancelled" : "done";
  } catch (err) {
    logger.error({ err: err.message, job: String(job._id) }, "Import xatosi");
    job.status = "failed";
    job.error = err.message;
  } finally {
    cancelRequested.delete(String(job._id));
    job.finishedAt = new Date();
    await job.save();
    await hooks.finished(job).catch((e) => logger.error({ err: e.message }, "finished hook xato"));
  }
}
