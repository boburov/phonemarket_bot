import mongoose from "mongoose";

// Every processed channel message (incl. skipped ones), so re-scans never
// re-parse or re-bill Gemini for the same post.
const seenSchema = new mongoose.Schema(
  {
    channel: { type: String, required: true },
    messageId: { type: Number, required: true },
    outcome: { type: String, default: "" }, // draft | skipped:<reason>
  },
  { timestamps: true },
);

seenSchema.index({ channel: 1, messageId: 1 }, { unique: true });

export default mongoose.model("Seen", seenSchema);
