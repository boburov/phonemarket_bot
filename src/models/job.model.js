import mongoose from "mongoose";

export const JOB_STATUSES = ["queued", "running", "done", "cancelled", "failed"];

// One /import request: scan `channel` until `requested` phone posts are found.
const jobSchema = new mongoose.Schema(
  {
    adminId: { type: Number, required: true },
    chatId: { type: Number, required: true },
    channel: { type: String, required: true }, // username without @
    requested: { type: Number, required: true },
    status: { type: String, enum: JOB_STATUSES, default: "queued", index: true },
    progressMessageId: { type: Number, default: null },

    scanned: { type: Number, default: 0 }, // messages looked at
    found: { type: Number, default: 0 }, // drafts created
    duplicates: { type: Number, default: 0 },
    alreadySeen: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 }, // not a single phone for sale
    error: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model("Job", jobSchema);
