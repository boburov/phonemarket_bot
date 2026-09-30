import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN ??= "x";
process.env.TG_API_ID ??= "1";
process.env.TG_API_HASH ??= "x";
process.env.API_LOGIN ??= "x";
process.env.API_PASSWORD ??= "x";
process.env.MONGO_URL ??= "mongodb://localhost/x";
const { scanPosts, parseChannelInput } = await import("./scanner.js");

// Fake channel history, newest first: album of 3 (ids 10-8, text on 8), a text post, album of 2 split across pages.
const HISTORY = [
  { id: 12, groupedId: null, message: "text only", photo: null },
  { id: 11, groupedId: 7n, message: "", photo: {} },
  { id: 10, groupedId: 7n, message: "", photo: {} },
  { id: 9, groupedId: 7n, message: "album caption", photo: {} },
  { id: 8, groupedId: null, message: "single photo", photo: {} },
  { id: 7, groupedId: 5n, message: "", photo: {} },
  { id: 6, groupedId: 5n, message: "split album", photo: {} },
].map((m) => ({ className: "Message", date: 1_700_000_000, ...m }));

const fakeClient = (pageSize) => ({
  getMessages: async (_e, { limit, offsetId }) => {
    const start = offsetId ? HISTORY.findIndex((m) => m.id === offsetId) + 1 : 0;
    return HISTORY.slice(start, start + Math.min(limit, pageSize));
  },
});

const collect = async (opts) => {
  const out = [];
  for await (const p of scanPosts({}, { onWait: async () => {}, ...opts })) out.push(p);
  return out.map((p) => ({ id: p.messageId, text: p.text, photos: p.photoMessages.length }));
};

test("merges albums, including across page boundaries", async () => {
  // Real page size is 100; force tiny pages via maxMessages chunks by using a fake client that returns 6.
  const posts = await collect({ maxMessages: 500, client: fakeClient(6) });
  assert.deepEqual(posts, [
    { id: 12, text: "text only", photos: 0 },
    { id: 9, text: "album caption", photos: 3 },
    { id: 8, text: "single photo", photos: 1 },
    { id: 6, text: "split album", photos: 2 },
  ]);
});

test("respects maxMessages", async () => {
  const posts = await collect({ maxMessages: 2, client: fakeClient(100) });
  assert.equal(posts.length, 2); // "text only" + partial album flushed at the end
});

test("channel input parsing", () => {
  assert.deepEqual(parseChannelInput("@phones_uz"), { username: "phones_uz" });
  assert.deepEqual(parseChannelInput("https://t.me/phones_uz/123"), { username: "phones_uz" });
  assert.deepEqual(parseChannelInput("t.me/s/phones_uz"), { username: "phones_uz" });
  assert.deepEqual(parseChannelInput("https://t.me/+AbCdEf"), { error: "private" });
  assert.deepEqual(parseChannelInput("hello world"), { error: "invalid" });
});
