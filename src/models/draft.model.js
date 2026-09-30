import mongoose from "mongoose";

export const DRAFT_STATUSES = [
  "pending", // waiting for admin review
  "uploading",
  "uploaded",
  "failed", // upload failed after retries - can be retried
  "skipped", // admin skipped
  "expired",
  "deleted", // uploaded, then undone by admin
];

// Parsed fields, already in production `Phone` shape (brand is resolved separately).
const fieldsSchema = new mongoose.Schema(
  {
    brandName: { type: String, default: "" },
    brandId: { type: String, default: null }, // production Brand _id
    model: { type: String, default: "" },
    price: { type: Number, default: null },
    currency: { type: String, enum: ["UZS", "USD"], default: "UZS" },
    isNegotiable: { type: Boolean, default: false },
    condition: { type: String, enum: ["new", "like_new", "used"], default: "used" },
    storage: { type: Number, default: null },
    ram: { type: Number, default: null },
    color: { type: String, default: "" },
    batteryHealth: { type: Number, default: null },
    region: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    // Extra info with no production field - goes into description.
    defects: { type: String, default: "" },
    imei: { type: String, default: "" },
    documents: { type: String, default: "" },
    exchange: { type: String, default: "" },
    telegram: { type: String, default: "" },
    extra: { type: String, default: "" },
  },
  { _id: false },
);

const draftSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", index: true },
    channel: { type: String, required: true },
    messageId: { type: Number, required: true },
    postedAt: { type: Date, default: null },
    sourceUrl: { type: String, default: "" }, // kept only here, never uploaded
    rawText: { type: String, default: "" },
    photos: { type: [String], default: [] }, // local file paths
    fields: { type: fieldsSchema, default: () => ({}) },
    parsedBy: { type: String, enum: ["regex", "gemini"], default: "regex" },
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: "Draft", default: null },

    status: { type: String, enum: DRAFT_STATUSES, default: "pending", index: true },
    reviewMessageId: { type: Number, default: null },
    reviewChatId: { type: Number, default: null },
    phoneId: { type: String, default: null }, // production Phone _id
    uploadedAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

draftSchema.index({ channel: 1, messageId: 1 }, { unique: true });
draftSchema.index({ "fields.contactPhone": 1, "fields.model": 1 });

export default mongoose.model("Draft", draftSchema);
